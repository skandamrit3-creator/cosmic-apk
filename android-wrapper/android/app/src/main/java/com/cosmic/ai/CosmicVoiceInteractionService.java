package com.cosmic.ai;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.service.voice.VoiceInteractionService;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * Lightweight system-selected assistant entry point.
 * Heavy audio recognition stays in CosmicWakeWordService.
 */
public class CosmicVoiceInteractionService extends VoiceInteractionService {
    public static final String ACTION_WAKE_DETECTED = "com.cosmic.ai.action.WAKE_DETECTED";
    private static final String TAG = "COSMICAssistant";
    private BroadcastReceiver wakeReceiver;

    @Override
    public void onCreate() {
        super.onCreate();
        wakeReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (intent != null && ACTION_WAKE_DETECTED.equals(intent.getAction())) {
                    try {
                        showSession(new Bundle(), 0);
                    } catch (Exception error) {
                        Log.w(TAG, "Could not display assistant session", error);
                    }
                }
            }
        };
        ContextCompat.registerReceiver(this, wakeReceiver,
                new IntentFilter(ACTION_WAKE_DETECTED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public void onReady() {
        super.onReady();
        if (!isActiveService(this, new ComponentName(this, CosmicVoiceInteractionService.class))) return;
        SharedPreferences prefs = getSharedPreferences("cosmic_live", MODE_PRIVATE);
        if (!prefs.getBoolean("wake_word_enabled", false) || CosmicWakeWordService.isRunning()) return;
        try {
            Intent wake = new Intent(this, CosmicWakeWordService.class);
            wake.setAction(CosmicWakeWordService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(wake);
            else startService(wake);
        } catch (Exception error) {
            Log.w(TAG, "Could not restore opted-in local wake detection", error);
        }
    }

    @Override
    public void onShutdown() {
        super.onShutdown();
        try {
            Intent stop = new Intent(this, CosmicWakeWordService.class);
            stop.setAction(CosmicWakeWordService.ACTION_STOP);
            startService(stop);
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        if (wakeReceiver != null) {
            try { unregisterReceiver(wakeReceiver); } catch (Exception ignored) {}
            wakeReceiver = null;
        }
        super.onDestroy();
    }
}
