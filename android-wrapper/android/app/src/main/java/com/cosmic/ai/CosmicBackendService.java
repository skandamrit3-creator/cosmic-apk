package com.cosmic.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

public class CosmicBackendService extends Service {
    public static final String ACTION_START = "com.cosmic.ai.backend.START";
    public static final String ACTION_STOP = "com.cosmic.ai.backend.STOP";
    public static final int BACKEND_PORT = 8160;
    private static final String TAG = "COSMICBackend";
    private static final String CHANNEL_ID = "cosmic_backend";
    private static final int NOTIFICATION_ID = 8059;
    private Thread startupThread;
    private volatile boolean stopping = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification("Starting local AI backend…"));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopping = true;
            stopEmbeddedBackend();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        stopping = false;
        if (startupThread == null || !startupThread.isAlive()) {
            startupThread = new Thread(this::startEmbeddedBackend, "COSMIC-Python-Startup");
            startupThread.start();
        }
        return START_STICKY;
    }

    private void startEmbeddedBackend() {
        try {
            if (!Python.isStarted()) Python.start(new AndroidPlatform(getApplicationContext()));
            if (stopping) return;
            PyObject module = Python.getInstance().getModule("cosmic_android_server");
            PyObject result = module.callAttr("start_server", getFilesDir().getAbsolutePath());
            PyObject urlObject = result.callAttr("get", "url");
            if (urlObject == null || urlObject.isNone()) {
                throw new IllegalStateException("Embedded backend returned no startup URL");
            }
            String url = urlObject.toString();
            Log.i(TAG, "Embedded backend started at " + url);
            updateNotification("Backend running at 127.0.0.1:" + BACKEND_PORT);
        } catch (Throwable error) {
            Log.e(TAG, "Could not start embedded Python backend", error);
            String detail = error.getMessage();
            if (detail == null || detail.trim().isEmpty()) detail = error.getClass().getSimpleName();
            detail = detail.replace('\n', ' ').replace('\r', ' ').trim();
            if (detail.length() > 110) detail = detail.substring(0, 110) + "…";
            updateNotification("Backend startup error: " + detail);
        }
    }

    private void stopEmbeddedBackend() {
        try {
            if (Python.isStarted()) Python.getInstance().getModule("cosmic_android_server").callAttr("stop_server");
        } catch (Throwable error) {
            Log.e(TAG, "Error stopping embedded backend", error);
        }
    }

    private Notification buildNotification(String message) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("COSMIC local backend")
                .setContentText(message)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void updateNotification(String message) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(message));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "COSMIC background backend", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Keeps COSMIC's on-device Python API available.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (!stopping) stopEmbeddedBackend();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
