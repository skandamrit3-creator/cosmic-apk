package com.cosmic.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.Locale;

/** User-started foreground wake phrase listener. Android may still stop/restrict it. */
public class CosmicWakeWordService extends Service {
    public static final String ACTION_START = "com.cosmic.ai.START_WAKE_WORD";
    public static final String ACTION_STOP = "com.cosmic.ai.STOP_WAKE_WORD";
    public static final String EXTRA_PHRASE = "wake_phrase";
    private static final String CHANNEL_ID = "cosmic_voice";
    private static final int NOTIFICATION_ID = 7301;
    private SpeechRecognizer recognizer;
    private String wakePhrase = "hey myraa";
    private boolean active;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopListening();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            String supplied = intent.getStringExtra(EXTRA_PHRASE);
            if (supplied != null && !supplied.trim().isEmpty()) wakePhrase = supplied.trim().toLowerCase(Locale.ROOT);
        }
        createChannel();
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = open == null ? null : PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("COSMIC voice listening")
                .setContentText("Waiting for “" + wakePhrase + "”")
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pending)
                .addAction(0, "Stop", stopPendingIntent())
                .build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTIFICATION_ID, notification);
        active = true;
        startListening();
        return START_NOT_STICKY;
    }

    private PendingIntent stopPendingIntent() {
        Intent stop = new Intent(this, CosmicWakeWordService.class).setAction(ACTION_STOP);
        return PendingIntent.getService(this, 1, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "COSMIC voice service", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private void startListening() {
        if (!active || !SpeechRecognizer.isRecognitionAvailable(this)) return;
        try {
            if (recognizer != null) recognizer.destroy();
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null) for (String match : matches) {
                        if (match != null && match.toLowerCase(Locale.ROOT).contains(wakePhrase)) {
                            sendBroadcast(new Intent("com.cosmic.ai.WAKE_PHRASE_DETECTED").setPackage(getPackageName()));
                            break;
                        }
                    }
                    restartListening();
                }
                @Override public void onError(int error) { restartListening(); }
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });
            Intent speech = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            speech.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            speech.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            speech.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            recognizer.startListening(speech);
        } catch (Exception ignored) { restartListening(); }
    }

    private void restartListening() {
        if (!active) return;
        getMainThreadHandler().postDelayed(this::startListening, 700);
    }

    private android.os.Handler getMainThreadHandler() { return new android.os.Handler(android.os.Looper.getMainLooper()); }

    private void stopListening() {
        active = false;
        if (recognizer != null) {
            try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    @Override public void onDestroy() { stopListening(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}