package com.cosmic.ai;

import android.app.BroadcastReceiver;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class CosmicBootReceiver extends BroadcastReceiver {
    private static final String TAG = "COSMICBoot";
    private static final String CHANNEL = "cosmic_boot_resume";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        try {
            Intent backend = new Intent(context, CosmicBackendService.class);
            backend.setAction(CosmicBackendService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(backend);
            else context.startService(backend);
        } catch (Exception error) {
            Log.e(TAG, "Could not start COSMIC backend after boot", error);
        }

        // Android restricts microphone foreground-service launches directly from boot receivers.
        // Ask the user to tap a notification; MainActivity resumes the explicitly opted-in session.
        boolean resume = context.getSharedPreferences("cosmic_live", Context.MODE_PRIVATE)
                .getBoolean("voice_auto_resume", false);
        if (!resume) return;
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(new NotificationChannel(
                        CHANNEL, "COSMIC voice resume", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(context, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pending = PendingIntent.getActivity(context, 8061, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            Notification notification = new NotificationCompat.Builder(context, CHANNEL)
                    .setSmallIcon(context.getApplicationInfo().icon)
                    .setContentTitle("COSMIC is ready")
                    .setContentText("Tap to resume your opted-in voice session.")
                    .setContentIntent(pending)
                    .setAutoCancel(true)
                    .setCategory(NotificationCompat.CATEGORY_SERVICE)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build();
            manager.notify(8061, notification);
        } catch (Exception error) {
            Log.e(TAG, "Could not post voice-resume notification", error);
        }
    }
}
