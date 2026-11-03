package com.cosmic.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class CosmicWakeWordService extends Service {
    public static final String ACTION_START = "com.cosmic.ai.wake.START";
    public static final String ACTION_STOP = "com.cosmic.ai.wake.STOP";
    private static final String TAG = "COSMICWake";
    private static final String CHANNEL = "cosmic_wake";
    private static final int NOTIFICATION_ID = 8062;
    private static final String MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip";
    private static final String MODEL_SHA256 = "20663dcac4d5cb783a579c54d98339344a688e4ec6e1b4a4b059fd1235454cc7";
    private static final String MODEL_DIR_NAME = "vosk-model-small-en-in-0.4";

    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile AudioRecord recorder;
    private volatile Model model;
    private volatile Recognizer recognizer;
    private Thread worker;

    public static boolean isRunning() { return instance != null && instance.running.get(); }
    private static volatile CosmicWakeWordService instance;

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        Notification n = notification("Preparing offline wake-word engine…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopEngine();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running.compareAndSet(false, true)) {
            worker = new Thread(this::runEngine, "COSMIC-Local-Wake-Word");
            worker.start();
        }
        return START_STICKY;
    }

    private void runEngine() {
        try {
            File modelDir = ensureModel();
            if (!running.get()) return;
            LibVosk.setLogLevel(LogLevel.WARNINGS);
            model = new Model(modelDir.getAbsolutePath());
            recognizer = new Recognizer(model, 16000.0f,
                    "[\"ok cosmic\", \"okay cosmic\", \"okay, cosmic\", \"[unk]\"]");
            int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) throw new IllegalStateException("Android microphone buffer is unavailable.");
            int size = Math.max(min, 6400);
            recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size);
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("Could not initialize microphone for local wake detection.");
            recorder.startRecording();
            updateNotification("Listening locally for “OK COSMIC” or “HEY COSMIC” · audio stays on this device");
            byte[] buffer = new byte[3200];
            while (running.get()) {
                int count = recorder.read(buffer, 0, buffer.length);
                if (count <= 0) continue;
                if (recognizer.acceptWaveForm(buffer, count)) {
                    if (containsWakePhrase(recognizer.getResult())) { onWakePhrase(); return; }
                } else if (containsWakePhrase(recognizer.getPartialResult())) {
                    onWakePhrase(); return;
                }
            }
        } catch (Exception e) {
            if (running.get()) {
                Log.e(TAG, "Wake-word engine failed", e);
                emitState("WAKE WORD ERROR · " + (e.getMessage() == null ? "unknown error" : e.getMessage()));
            }
        } finally {
            releaseAudio();
            if (recognizer != null) { try { recognizer.close(); } catch (Exception ignored) {} recognizer = null; }
            if (model != null) { try { model.close(); } catch (Exception ignored) {} model = null; }
            if (running.get()) {
                running.set(false);
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        }
    }

    private boolean containsWakePhrase(String json) {
        try {
            String phrase = new JSONObject(json).optString("partial",
                    new JSONObject(json).optString("text", "")).toLowerCase(Locale.ROOT).trim();
            phrase = phrase.replaceAll("[^a-z ]", " ").replaceAll("\\s+", " ").trim();
            return phrase.equals("ok cosmic") || phrase.equals("okay cosmic") || phrase.equals("hey cosmic");
        } catch (Exception ignored) { return false; }
    }

    private void onWakePhrase() {
        if (!running.compareAndSet(true, false)) return;
        releaseAudio();
        emitState("WAKE PHRASE DETECTED · STARTING GEMINI LIVE");
        Intent live = new Intent(this, CosmicLiveService.class);
        live.setAction(CosmicLiveService.ACTION_START);
        android.content.SharedPreferences prefs = getSharedPreferences("cosmic_live", MODE_PRIVATE);
        live.putExtra("live_model", prefs.getString("live_model", "gemini-3.8-live"));
        live.putExtra("live_voice", prefs.getString("live_voice", "Kore"));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(live);
            else startService(live);
        } catch (Exception e) {
            Log.e(TAG, "Could not hand off wake phrase to Gemini Live", e);
            emitState("WAKE DETECTED · OPEN COSMIC TO START LIVE");
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private File ensureModel() throws Exception {
        File root = new File(getFilesDir(), "cosmic-wake");
        File modelDir = new File(root, MODEL_DIR_NAME);
        File marker = new File(modelDir, "am/final.mdl");
        if (marker.isFile()) return modelDir;
        if (!root.exists() && !root.mkdirs()) throw new IllegalStateException("Cannot create wake model folder.");
        File zip = new File(root, "model.zip.part");
        HttpURLConnection connection = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        try {
            connection.connect();
            if (connection.getResponseCode() != 200) throw new IllegalStateException("Wake model download HTTP " + connection.getResponseCode());
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream out = new FileOutputStream(zip)) {
                byte[] bytes = new byte[32768]; int n;
                while (running.get() && (n = in.read(bytes)) >= 0) out.write(bytes, 0, n);
            }
        } finally { connection.disconnect(); }
        if (!running.get()) throw new IllegalStateException("Wake model download cancelled.");
        if (!MODEL_SHA256.equals(sha256(zip))) { zip.delete(); throw new SecurityException("Wake model checksum verification failed."); }
        File temp = new File(root, "extracting");
        deleteTree(temp);
        if (!temp.mkdirs()) throw new IllegalStateException("Cannot prepare wake model extraction.");
        try (ZipInputStream in = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("/") || name.contains("../") || name.equals(".."))
                    throw new SecurityException("Unsafe path in wake model archive.");
                String prefix = MODEL_DIR_NAME + "/";
                if (!name.startsWith(prefix)) { in.closeEntry(); continue; }
                String relative = name.substring(prefix.length());
                if (relative.isEmpty()) { in.closeEntry(); continue; }
                File target = new File(temp, relative).getCanonicalFile();
                if (!target.getCanonicalPath().startsWith(temp.getCanonicalPath() + File.separator))
                    throw new SecurityException("Wake model archive path escaped its folder.");
                if (entry.isDirectory()) target.mkdirs();
                else {
                    File parent = target.getParentFile(); if (parent != null) parent.mkdirs();
                    try (BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(target))) {
                        byte[] buffer = new byte[32768]; int n;
                        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                    }
                }
                in.closeEntry();
            }
        } finally { zip.delete(); }
        if (!new File(temp, "am/final.mdl").isFile()) { deleteTree(temp); throw new IllegalStateException("Downloaded wake model is incomplete."); }
        deleteTree(modelDir);
        if (!temp.renameTo(modelDir)) throw new IllegalStateException("Could not install offline wake model.");
        return modelDir;
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] b = new byte[32768]; int n;
            while ((n = in.read(b)) > 0) digest.update(b, 0, n);
        }
        StringBuilder out = new StringBuilder();
        for (byte b : digest.digest()) out.append(String.format(Locale.ROOT, "%02x", b));
        return out.toString();
    }

    private void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    private void releaseAudio() {
        AudioRecord r = recorder; recorder = null;
        if (r != null) { try { if (r.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) r.stop(); } catch (Exception ignored) {} try { r.release(); } catch (Exception ignored) {} }
    }

    private void stopEngine() {
        running.set(false);
        releaseAudio();
        if (worker != null) worker.interrupt();
    }

    private void emitState(String message) {
        Intent event = new Intent(CosmicLiveService.ACTION_EVENT);
        event.setPackage(getPackageName());
        event.putExtra("type", "state");
        event.putExtra(CosmicLiveService.EXTRA_MESSAGE, message);
        sendBroadcast(event);
    }

    private Notification notification(String text) {
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("COSMIC · Local wake word")
                .setContentText(text)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW).build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(text));
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL, "COSMIC local wake word", NotificationManager.IMPORTANCE_LOW));
        }
    }

    @Override public void onDestroy() {
        stopEngine();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
