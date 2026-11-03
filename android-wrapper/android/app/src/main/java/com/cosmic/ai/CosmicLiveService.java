package com.cosmic.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.media.audiofx.AutomaticGainControl;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.view.Gravity;
import android.view.View;
import android.view.MotionEvent;
import android.widget.TextView;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.net.Uri;
import android.app.PendingIntent;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.os.IBinder;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class CosmicLiveService extends Service {
    public static final String ACTION_START = "com.cosmic.ai.live.START";
    public static final String ACTION_STOP = "com.cosmic.ai.live.STOP";
    public static final String ACTION_USER_STOP_LISTENING = "com.cosmic.ai.live.USER_STOP_LISTENING";
    public static final String ACTION_SCREEN_START = "com.cosmic.ai.live.SCREEN_START";
    public static final String ACTION_SCREEN_STOP = "com.cosmic.ai.live.SCREEN_STOP";
    public static final String ACTION_EVENT = "com.cosmic.ai.live.EVENT";
    public static final String EXTRA_MESSAGE = "message";
    private static final String TAG = "COSMICLive";
    private static final String CHANNEL = "cosmic_live";
    private static final int NOTIFICATION_ID = 8060;
    private static volatile CosmicLiveService instance;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean ready = new AtomicBoolean(false);
    private OkHttpClient client;
    private volatile WebSocket socket;
    private AudioRecord recorder;
    private AudioTrack player;
    private AcousticEchoCanceler echoCanceler;
    private NoiseSuppressor noiseSuppressor;
    private AutomaticGainControl gainControl;
    private Thread sessionThread;
    private String resumeHandle = "";
    private volatile String liveModel = "gemini-3.8-live";
    private volatile String liveVoice = "Kore";
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private long lastFrameAt = 0;
    private WindowManager windowManager;
    private TextView bubbleView;

    public static boolean isRunning() { CosmicLiveService service = instance; return service != null && service.running.get(); }
    public static boolean isReady() { CosmicLiveService service = instance; return service != null && service.ready.get(); }

    public static boolean sendToolResponses(String responsesJson) {
        CosmicLiveService service = instance;
        WebSocket ws = service == null ? null : service.socket;
        if (service == null || !service.ready.get() || ws == null) return false;
        try {
            JSONArray responses = new JSONArray(responsesJson);
            JSONObject message = new JSONObject().put("toolResponse",
                    new JSONObject().put("functionResponses", responses));
            return ws.send(message.toString());
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean sendText(String text) {
        CosmicLiveService service = instance;
        WebSocket ws = service == null ? null : service.socket;
        if (service == null || !service.ready.get() || ws == null) return false;
        try {
            JSONObject message = new JSONObject();
            message.put("realtimeInput", new JSONObject().put("text", text));
            return ws.send(message.toString());
        } catch (Exception e) {
            return false;
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        Notification notification = notification("Starting Gemini Live…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            String requestedModel = intent.getStringExtra("live_model");
            String requestedVoice = intent.getStringExtra("live_voice");
            boolean changed = false;
            boolean modelChanged = false;
            if ("gemini-3.8-live".equals(requestedModel) ||
                    "gemini-3.8-live-extended-thinking".equals(requestedModel)) {
                modelChanged = !requestedModel.equals(liveModel);
                changed |= modelChanged;
                liveModel = requestedModel;
            }
            if (requestedVoice != null && ("Kore".equals(requestedVoice) ||
                    "Aoede".equals(requestedVoice) || "Puck".equals(requestedVoice) ||
                    "Charon".equals(requestedVoice) || "Fenrir".equals(requestedVoice) ||
                    "Leda".equals(requestedVoice) || "Orus".equals(requestedVoice) ||
                    "Zephyr".equals(requestedVoice))) {
                changed |= !requestedVoice.equals(liveVoice);
                liveVoice = requestedVoice;
            }
            android.content.SharedPreferences.Editor livePrefs = getSharedPreferences("cosmic_live", MODE_PRIVATE).edit()
                    .putString("live_model", liveModel).putString("live_voice", liveVoice);
            if (changed) {
                resumeHandle = "";
                livePrefs.remove("resume_handle");
            }
            livePrefs.apply();
            if (changed && socket != null) socket.close(1012, "COSMIC Live voice settings changed");

        }
        if (intent != null && ACTION_SCREEN_STOP.equals(intent.getAction())) {
            stopScreenCapture();
            return START_STICKY;
        }
        if (intent != null && ACTION_SCREEN_START.equals(intent.getAction())) {
            int resultCode = intent.getIntExtra("projection_result", 0);
            Intent data = intent.getParcelableExtra("projection_data");
            startScreenCapture(resultCode, data);
            if (running.compareAndSet(false, true)) {
                sessionThread = new Thread(this::runSession, "COSMIC-Gemini-Live");
                sessionThread.start();
            }
            return START_STICKY;
        }
        if (intent != null && ACTION_USER_STOP_LISTENING.equals(intent.getAction())) {
            // The visible notification action means stop ALL microphone capture, including
            // the offline wake-word standby. The in-app Live toggle uses ACTION_STOP and
            // may intentionally return to the opted-in wake-word standby.
            getSharedPreferences("cosmic_live", MODE_PRIVATE).edit()
                    .putBoolean("wake_word_enabled", false)
                    .putBoolean("voice_auto_resume", false)
                    .apply();
            Intent stopWake = new Intent(this, CosmicWakeWordService.class);
            stopWake.setAction(CosmicWakeWordService.ACTION_STOP);
            try { startService(stopWake); } catch (Exception ignored) {}
            stopLive();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopLive();
            return START_NOT_STICKY;
        }
        if (running.compareAndSet(false, true)) {
            sessionThread = new Thread(this::runSession, "COSMIC-Gemini-Live");
            sessionThread.start();
        }
        return START_STICKY;
    }

    private void runSession() {
        try {
            resumeHandle = getSharedPreferences("cosmic_live", MODE_PRIVATE).getString("resume_handle", "");
            liveModel = getSharedPreferences("cosmic_live", MODE_PRIVATE).getString("live_model", liveModel);
            liveVoice = getSharedPreferences("cosmic_live", MODE_PRIVATE).getString("live_voice", liveVoice);
            showFloatingBubble();
            prepareAudio();
            client = new OkHttpClient.Builder()
                    .pingInterval(20, TimeUnit.SECONDS)
                    .connectTimeout(20, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build();

            while (running.get()) {
                CountDownLatch configured = new CountDownLatch(1);
                AtomicBoolean setupFailed = new AtomicBoolean(false);
                String liveToken = requestLiveToken();
                String memoryContext = requestMemoryContext();
                String url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" + Uri.encode(liveToken);
                Request request = new Request.Builder().url(url).build();
                socket = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket webSocket, Response response) {
                        try {
                            JSONObject setup = new JSONObject();
                            JSONObject config = new JSONObject();
                            config.put("model", "models/" + liveModel);
                            config.put("responseModalities", new JSONArray().put("AUDIO"));
                            config.put("inputAudioTranscription", new JSONObject());
                            config.put("outputAudioTranscription", new JSONObject());
                            config.put("speechConfig", new JSONObject().put("voiceConfig",
                                    new JSONObject().put("prebuiltVoiceConfig", new JSONObject().put("voiceName", liveVoice))));
                            config.put("contextWindowCompression", new JSONObject().put("slidingWindow", new JSONObject()));
                            JSONObject resume = new JSONObject();
                            if (!resumeHandle.isEmpty()) resume.put("handle", resumeHandle);
                            config.put("sessionResumption", resume);
                            JSONArray functions = new JSONArray();
                            functions.put(new JSONObject().put("name", "open_app")
                                    .put("description", "Open an installed Android app by its visible name.")
                                    .put("parameters", new JSONObject().put("type", "OBJECT")
                                            .put("properties", new JSONObject().put("name", new JSONObject().put("type", "STRING")))
                                            .put("required", new JSONArray().put("name"))));
                            functions.put(new JSONObject().put("name", "open_url")
                                    .put("description", "Open a website or HTTP/HTTPS link in the appropriate app.")
                                    .put("parameters", new JSONObject().put("type", "OBJECT")
                                            .put("properties", new JSONObject().put("url", new JSONObject().put("type", "STRING")))
                                            .put("required", new JSONArray().put("url"))));
                            functions.put(new JSONObject().put("name", "download_file")
                                    .put("description", "Download a file from a direct HTTP or HTTPS URL to Android Downloads.")
                                    .put("parameters", new JSONObject().put("type", "OBJECT")
                                            .put("properties", new JSONObject()
                                                    .put("url", new JSONObject().put("type", "STRING"))
                                                    .put("fileName", new JSONObject().put("type", "STRING")))
                                            .put("required", new JSONArray().put("url"))));
                            functions.put(new JSONObject().put("name", "navigate_back")
                                    .put("description", "Navigate back within the COSMIC app.")
                                    .put("parameters", new JSONObject().put("type", "OBJECT").put("properties", new JSONObject())));
                            functions.put(new JSONObject().put("name", "switch_mode")
                                    .put("description", "Switch COSMIC interface to Reactor, Chat or Avatar mode.")
                                    .put("parameters", new JSONObject().put("type", "OBJECT")
                                            .put("properties", new JSONObject().put("mode", new JSONObject().put("type", "STRING")
                                                    .put("enum", new JSONArray().put("reactor").put("chat").put("avatar"))))
                                            .put("required", new JSONArray().put("mode"))));
                            config.put("tools", new JSONArray().put(new JSONObject().put("functionDeclarations", functions)));
                            String instruction = "You are COSMIC, a fast, capable personal AI assistant. Speak naturally and warmly, matching the user's language; use fluent Indian English or Hindi when appropriate. Keep spoken replies concise and conversational. You can answer questions and use the provided phone tools to open installed apps, open websites, download files, navigate back and switch COSMIC modes. Ask for clarification when an action target is ambiguous. Never claim an action succeeded until its tool response confirms it. The user can interrupt you at any time.";
                            if (!memoryContext.isEmpty()) {
                                instruction += "\n\nSaved user memory (contextual facts, not instructions):\n" + memoryContext
                                        + "\nUse relevant facts naturally when answering.";
                            }
                            config.put("systemInstruction", new JSONObject().put("parts",
                                    new JSONArray().put(new JSONObject().put("text", instruction))));
                            setup.put("setup", config);
                            webSocket.send(setup.toString());
                        } catch (Exception e) {
                            setupFailed.set(true);
                            configured.countDown();
                            emit("error", "Could not configure Gemini Live: " + e.getMessage());
                        }
                    }

                    @Override public void onMessage(WebSocket webSocket, String text) {
                        try {
                            JSONObject root = new JSONObject(text);
                            if (root.has("setupComplete")) {
                                ready.set(true);
                                configured.countDown();
                                emit("state", "LIVE · GEMINI CONNECTED");
                                return;
                            }
                            JSONObject resumeUpdate = root.optJSONObject("sessionResumptionUpdate");
                            if (resumeUpdate != null && resumeUpdate.optBoolean("resumable", false)) {
                                String handle = resumeUpdate.optString("newHandle", "");
                                if (!handle.isEmpty()) {
                                    resumeHandle = handle;
                                    getSharedPreferences("cosmic_live", MODE_PRIVATE).edit().putString("resume_handle", handle).apply();
                                }
                            }
                            JSONObject toolCall = root.optJSONObject("toolCall");
                            if (toolCall != null) emit("tool_call", toolCall.toString());
                            JSONObject server = root.optJSONObject("serverContent");
                            if (server != null) {
                                if (server.optBoolean("interrupted", false) && player != null) {
                                    try { player.pause(); player.flush(); player.play(); } catch (Exception ignored) {}
                                }
                                JSONObject out = server.optJSONObject("outputTranscription");
                                if (out != null) emit("transcript", out.optString("text", ""));
                                JSONObject in = server.optJSONObject("inputTranscription");
                                if (in != null) emit("user_transcript", in.optString("text", ""));
                                JSONObject turn = server.optJSONObject("modelTurn");
                                JSONArray parts = turn == null ? null : turn.optJSONArray("parts");
                                if (parts != null) {
                                    for (int i = 0; i < parts.length(); i++) {
                                        JSONObject part = parts.optJSONObject(i);
                                        JSONObject inline = part == null ? null : part.optJSONObject("inlineData");
                                        if (inline != null) {
                                            emit("audio_start", "");
                                            String encoded = inline.optString("data", "");
                                            if (!encoded.isEmpty() && player != null) {
                                                byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
                                                player.write(pcm, 0, pcm.length);
                                                double sum = 0;
                                                int samples = pcm.length / 2;
                                                for (int sample = 0; sample < samples; sample++) {
                                                    int lo = pcm[sample * 2] & 0xff;
                                                    int hi = pcm[sample * 2 + 1];
                                                    short value = (short) ((hi << 8) | lo);
                                                    sum += (double) value * value;
                                                }
                                                double rms = samples == 0 ? 0 : Math.sqrt(sum / samples);
                                                emit("audio_level", String.valueOf(Math.min(1.0, rms / 9000.0)));
                                            }
                                        }
                                        if (part != null && part.has("text")) emit("transcript", part.optString("text"));
                                    }
                                }
                                if (server.optBoolean("turnComplete", false)) { emit("audio_end", ""); emit("turn_complete", ""); }
                            }
                            if (root.has("error")) emit("error", root.optJSONObject("error").toString());
                        } catch (Exception e) {
                            Log.w(TAG, "Could not parse Live message", e);
                        }
                    }

                    @Override public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                        ready.set(false);
                        configured.countDown();
                        emit("state", "RECONNECTING · " + (t.getMessage() == null ? "connection lost" : t.getMessage()));
                    }

                    @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                        ready.set(false);
                        configured.countDown();
                    }
                });

                boolean connected = configured.await(25, TimeUnit.SECONDS);
                if (!running.get()) break;
                if (connected && ready.get() && !setupFailed.get()) {
                    emit("state", "LIVE · LISTENING");
                    captureUntilDisconnected();
                } else if (running.get()) {
                    emit("state", "RECONNECTING…");
                }
                ready.set(false);
                WebSocket old = socket;
                socket = null;
                if (old != null) old.close(1000, "reconnect");
                if (running.get()) Thread.sleep(1200);
            }
        } catch (SecurityException e) {
            emit("error", "Microphone permission is required: " + e.getMessage());
        } catch (Exception e) {
            if (running.get()) emit("error", "Gemini Live stopped: " + e.getMessage());
        } finally {
            releaseAudio();
            if (client != null) client.dispatcher().executorService().shutdown();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void captureUntilDisconnected() throws Exception {
        if (recorder == null) prepareAudio();
        if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) recorder.startRecording();
        byte[] buffer = new byte[3200]; // 100 ms, mono PCM16 at 16 kHz.
        while (running.get() && ready.get()) {
            int count = recorder.read(buffer, 0, buffer.length);
            if (count <= 0) continue;
            WebSocket ws = socket;
            if (ws == null || !ready.get()) break;
            byte[] chunk = new byte[count];
            System.arraycopy(buffer, 0, chunk, 0, count);
            JSONObject audio = new JSONObject();
            JSONObject input = new JSONObject();
            input.put("data", Base64.encodeToString(chunk, Base64.NO_WRAP));
            input.put("mimeType", "audio/pcm;rate=16000");
            audio.put("audio", input);
            ws.send(new JSONObject().put("realtimeInput", audio).toString());
        }
        if (recorder != null && recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
            try { recorder.stop(); } catch (Exception ignored) {}
        }
    }

    public static void refreshFloatingBubble() {
        CosmicLiveService service = instance;
        if (service != null) service.showFloatingBubble();
    }

    private void showFloatingBubble() {
        if (Looper.myLooper() != Looper.getMainLooper()) { new Handler(Looper.getMainLooper()).post(this::showFloatingBubble); return; }
        if (Build.VERSION.SDK_INT < 23 || !Settings.canDrawOverlays(this)) {
            emit("bubble_permission_required", "Allow COSMIC to display its floating assistant bubble.");
            return;
        }
        if (bubbleView != null) { emit("bubble", "Floating COSMIC bubble is active."); return; }
        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            TextView bubble = new TextView(this);
            bubble.setText("C");
            bubble.setTextColor(android.graphics.Color.WHITE);
            bubble.setTextSize(21);
            bubble.setGravity(Gravity.CENTER);
            GradientDrawable background = new GradientDrawable();
            background.setShape(GradientDrawable.OVAL);
            background.setColor(android.graphics.Color.rgb(13, 39, 61));
            background.setStroke(3, android.graphics.Color.rgb(106, 207, 232));
            bubble.setBackground(background);
            bubble.setElevation(12);
            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    58, 58, Build.VERSION.SDK_INT >= 26
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.END;
            params.x = 14;
            params.y = 210;
            final int[] down = new int[2];
            final float[] touch = new float[2];
            final boolean[] moved = new boolean[1];
            bubble.setOnTouchListener((view, event) -> {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        down[0] = params.x; down[1] = params.y;
                        touch[0] = event.getRawX(); touch[1] = event.getRawY();
                        moved[0] = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (touch[0] - event.getRawX());
                        int dy = (int) (event.getRawY() - touch[1]);
                        if (Math.abs(dx) + Math.abs(dy) > 8) moved[0] = true;
                        params.x = Math.max(0, down[0] + dx);
                        params.y = Math.max(40, down[1] + dy);
                        try { windowManager.updateViewLayout(bubble, params); } catch (Exception ignored) {}
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved[0]) {
                            Intent launch = new Intent(CosmicLiveService.this, MainActivity.class);
                            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                            PendingIntent openApp = PendingIntent.getActivity(CosmicLiveService.this, NOTIFICATION_ID + 1,
                                    launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                            try { openApp.send(); } catch (PendingIntent.CanceledException ignored) {}
                        }
                        return true;
                }
                return false;
            });
            windowManager.addView(bubble, params);
            bubbleView = bubble;
            emit("bubble", "Floating COSMIC bubble is active.");
        } catch (Exception e) {
            emit("error", "Floating bubble could not start: " + e.getMessage());
        }
    }

    private void hideFloatingBubble() {
        if (Looper.myLooper() != Looper.getMainLooper()) { new Handler(Looper.getMainLooper()).post(this::hideFloatingBubble); return; }
        try { if (bubbleView != null && windowManager != null) windowManager.removeView(bubbleView); } catch (Exception ignored) {}
        bubbleView = null;
    }

    private void startScreenCapture(int resultCode, Intent data) {
        if (data == null || resultCode != android.app.Activity.RESULT_OK) {
            emit("error", "Screen sharing permission was not granted.");
            return;
        }
        try {
            if (projection != null) stopScreenCapture();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification("Microphone and screen sharing active"),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification("Screen sharing active"),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            }
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            projection = manager.getMediaProjection(resultCode, data);
            if (projection == null) throw new IllegalStateException("Android did not create a screen capture session.");
            DisplayMetrics metrics = new DisplayMetrics();
            WindowManager window = (WindowManager) getSystemService(WINDOW_SERVICE);
            window.getDefaultDisplay().getRealMetrics(metrics);
            int width = Math.max(1, metrics.widthPixels);
            int height = Math.max(1, metrics.heightPixels);
            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            imageReader.setOnImageAvailableListener(this::sendScreenFrame, new Handler(Looper.getMainLooper()));
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() {
                    stopScreenCapture();
                    emit("state", "SCREEN SHARE STOPPED");
                }
            }, new Handler(Looper.getMainLooper()));
            virtualDisplay = projection.createVirtualDisplay("COSMIC Live Screen",
                    width, height, metrics.densityDpi,
                    android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(), null, null);
            emit("state", "LIVE · SCREEN SHARING");
        } catch (Exception e) {
            stopScreenCapture();
            emit("error", "Could not start screen sharing: " + e.getMessage());
        }
    }

    private void sendScreenFrame(ImageReader reader) {
        Image image = null;
        try {
            long now = System.currentTimeMillis();
            if (now - lastFrameAt < 1000 || !ready.get()) return;
            image = reader.acquireLatestImage();
            if (image == null) return;
            lastFrameAt = now;
            Image.Plane plane = image.getPlanes()[0];
            java.nio.ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = rowStride - pixelStride * image.getWidth();
            Bitmap padded = Bitmap.createBitmap(image.getWidth() + rowPadding / pixelStride,
                    image.getHeight(), Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buffer);
            Bitmap frame = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
            int targetWidth = Math.min(960, frame.getWidth());
            int targetHeight = Math.max(1, frame.getHeight() * targetWidth / frame.getWidth());
            Bitmap scaled = Bitmap.createScaledBitmap(frame, targetWidth, targetHeight, true);
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 55, output);
            byte[] bytes = output.toByteArray();
            if (scaled != frame) scaled.recycle();
            frame.recycle();
            padded.recycle();
            JSONObject video = new JSONObject();
            video.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            video.put("mimeType", "image/jpeg");
            WebSocket ws = socket;
            if (ws != null && ready.get()) ws.send(new JSONObject()
                    .put("realtimeInput", new JSONObject().put("video", video)).toString());
        } catch (Exception e) {
            Log.w(TAG, "Screen frame could not be sent", e);
        } finally {
            if (image != null) image.close();
        }
    }

    private void stopScreenCapture() {
        try { if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; } } catch (Exception ignored) {}
        try { if (imageReader != null) { imageReader.setOnImageAvailableListener(null, null); imageReader.close(); imageReader = null; } } catch (Exception ignored) {}
        try { if (projection != null) { MediaProjection oldProjection = projection; projection = null; oldProjection.stop(); } } catch (Exception ignored) {}
        emit("state", "SCREEN SHARE STOPPED");
    }

    private void prepareAudio() {
        int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 6400));
        int audioSession = recorder.getAudioSessionId();
        try { if (AcousticEchoCanceler.isAvailable()) { echoCanceler = AcousticEchoCanceler.create(audioSession); if (echoCanceler != null) echoCanceler.setEnabled(true); } } catch (Exception ignored) {}
        try { if (NoiseSuppressor.isAvailable()) { noiseSuppressor = NoiseSuppressor.create(audioSession); if (noiseSuppressor != null) noiseSuppressor.setEnabled(true); } } catch (Exception ignored) {}
        try { if (AutomaticGainControl.isAvailable()) { gainControl = AutomaticGainControl.create(audioSession); if (gainControl != null) gainControl.setEnabled(true); } } catch (Exception ignored) {}
        int outMin = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        player = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(24000)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(Math.max(outMin, 12000))
                .setTransferMode(AudioTrack.MODE_STREAM).build();
        player.play();
    }

    private String requestMemoryContext() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:8059/api/memory/context").openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(2500);
            connection.setReadTimeout(2500);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) return "";
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[2048];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                JSONObject response = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
                return response.optBoolean("success", false)
                        ? response.optString("memory_context", "") : "";
            }
        } catch (Exception ignored) {
            return "";
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String requestLiveToken() throws Exception {
        Exception lastError = null;
        for (int attempt = 0; attempt < 6; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL("http://127.0.0.1:8059/api/ai/live-token").openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(7000);
                connection.setReadTimeout(15000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(new JSONObject().put("model", liveModel).toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = connection.getResponseCode();
                InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                if (stream != null) {
                    try (InputStream input = stream) {
                        byte[] buffer = new byte[2048];
                        int count;
                        while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
                    }
                }
                JSONObject response = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException(response.optString("error", "Gemini Live token request failed · HTTP " + code));
                }
                String token = response.optString("token", "").trim();
                if (token.isEmpty()) throw new IllegalStateException("Gemini did not issue a Live token.");
                return token;
            } catch (java.net.ConnectException | java.net.SocketTimeoutException error) {
                lastError = error;
                if (attempt < 5) Thread.sleep(Math.min(8000, 1000L * (attempt + 1)));
            } catch (IllegalStateException error) {
                lastError = error;
                String detail = String.valueOf(error.getMessage());
                if (detail.contains("HTTP 400") || detail.contains("HTTP 401") ||
                        detail.contains("HTTP 403") || detail.contains("HTTP 404")) throw error;
                if (attempt < 5) Thread.sleep(Math.min(8000, 1000L * (attempt + 1)));
            } catch (java.io.IOException error) {
                lastError = error;
                if (attempt < 5) Thread.sleep(Math.min(8000, 1000L * (attempt + 1)));
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        throw new IllegalStateException("COSMIC local AI backend is not ready for Gemini Live.", lastError);
    }

    private void stopLive() {
        running.set(false);
        ready.set(false);
        WebSocket ws = socket;
        socket = null;
        if (ws != null) ws.close(1000, "user stopped");
        stopScreenCapture();
        hideFloatingBubble();
        releaseAudio();
        getSharedPreferences("cosmic_live", MODE_PRIVATE).edit().remove("resume_handle").apply();
        emit("audio_end", "");
        emit("state", "LIVE · STOPPED");
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void releaseAudio() {
        try { if (echoCanceler != null) { echoCanceler.release(); echoCanceler = null; } } catch (Exception ignored) {}
        try { if (noiseSuppressor != null) { noiseSuppressor.release(); noiseSuppressor = null; } } catch (Exception ignored) {}
        try { if (gainControl != null) { gainControl.release(); gainControl = null; } } catch (Exception ignored) {}
        try { if (recorder != null) { recorder.release(); recorder = null; } } catch (Exception ignored) {}
        try { if (player != null) { player.pause(); player.flush(); player.release(); player = null; } } catch (Exception ignored) {}
    }

    private void emit(String type, String message) {
        Intent event = new Intent(ACTION_EVENT);
        event.setPackage(getPackageName());
        event.putExtra("type", type);
        event.putExtra(EXTRA_MESSAGE, message == null ? "" : message);
        sendBroadcast(event);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && "state".equals(type)) manager.notify(NOTIFICATION_ID, notification(message));
    }

    private Notification notification(String message) {
        Intent stopIntent = new Intent(this, CosmicLiveService.class);
        stopIntent.setAction(ACTION_USER_STOP_LISTENING);
        PendingIntent stopPending = PendingIntent.getService(this, NOTIFICATION_ID, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("COSMIC · Gemini Live")
                .setContentText(message)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(android.R.drawable.ic_media_pause, "STOP LISTENING", stopPending)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "COSMIC Live voice", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Visible notification while COSMIC is actively listening and speaking.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    @Override public void onDestroy() {
        running.set(false);
        ready.set(false);
        WebSocket ws = socket;
        if (ws != null) ws.close(1000, "service destroyed");
        stopScreenCapture();
        hideFloatingBubble();
        releaseAudio();
        if (client != null) client.dispatcher().executorService().shutdown();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
