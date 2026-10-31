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
import android.media.MediaRecorder;
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

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class CosmicLiveService extends Service {
    public static final String ACTION_START = "com.cosmic.ai.live.START";
    public static final String ACTION_STOP = "com.cosmic.ai.live.STOP";
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
    private Thread sessionThread;
    private String apiKey;
    private String resumeHandle = "";

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
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
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
            apiKey = readGeminiKey();
            if (apiKey.isEmpty()) {
                emit("error", "Gemini API key is missing. Open COSMIC API SETUP and save a Gemini key.");
                stopLive();
                return;
            }
            resumeHandle = getSharedPreferences("cosmic_live", MODE_PRIVATE).getString("resume_handle", "");
            prepareAudio();
            client = new OkHttpClient.Builder()
                    .pingInterval(20, TimeUnit.SECONDS)
                    .connectTimeout(20, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build();

            while (running.get()) {
                CountDownLatch configured = new CountDownLatch(1);
                AtomicBoolean setupFailed = new AtomicBoolean(false);
                String url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + apiKey;
                Request request = new Request.Builder().url(url).build();
                socket = client.newWebSocket(request, new WebSocketListener() {
                    @Override public void onOpen(WebSocket webSocket, Response response) {
                        try {
                            JSONObject setup = new JSONObject();
                            JSONObject config = new JSONObject();
                            config.put("model", "models/gemini-3.8-live");
                            config.put("responseModalities", new JSONArray().put("AUDIO"));
                            config.put("contextWindowCompression", new JSONObject().put("slidingWindow", new JSONObject()));
                            JSONObject resume = new JSONObject();
                            if (!resumeHandle.isEmpty()) resume.put("handle", resumeHandle);
                            config.put("sessionResumption", resume);
                            config.put("systemInstruction", new JSONObject().put("parts",
                                    new JSONArray().put(new JSONObject().put("text",
                                            "You are COSMIC, a fast, warm, highly capable personal assistant. Speak naturally and concisely. You can answer questions and help plan actions. Never claim to have performed a phone action unless a connected tool confirms it. The user can interrupt you at any time."))));
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
                                            String encoded = inline.optString("data", "");
                                            if (!encoded.isEmpty() && player != null) {
                                                byte[] pcm = Base64.decode(encoded, Base64.DEFAULT);
                                                player.write(pcm, 0, pcm.length);
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

    private void prepareAudio() {
        int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 6400));
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

    private String readGeminiKey() throws Exception {
        File file = new File(new File(getFilesDir(), "cosmic"), "provider-keys.json");
        if (!file.isFile()) return "";
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream in = new FileInputStream(file)) { int n = in.read(bytes); }
        JSONObject saved = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        return saved.optString("gemini", "").trim();
    }

    private void stopLive() {
        running.set(false);
        ready.set(false);
        WebSocket ws = socket;
        socket = null;
        if (ws != null) ws.close(1000, "user stopped");
        releaseAudio();
        getSharedPreferences("cosmic_live", MODE_PRIVATE).edit().remove("resume_handle").apply();
        emit("audio_end", "");
        emit("state", "LIVE · STOPPED");
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void releaseAudio() {
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
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("COSMIC · Gemini Live")
                .setContentText(message)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW).build();
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
        releaseAudio();
        if (client != null) client.dispatcher().executorService().shutdown();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
