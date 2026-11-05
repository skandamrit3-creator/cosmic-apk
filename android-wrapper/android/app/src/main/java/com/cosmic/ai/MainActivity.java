package com.cosmic.ai;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CosmicVoicePlugin.class);
        registerPlugin(CosmicBackendPlugin.class);
        registerPlugin(CosmicHomeAutomationPlugin.class);
        super.onCreate(savedInstanceState);
        startCosmicBackend();
    }

    @Override
    public void onResume() {
        super.onResume();
        CosmicLiveService.refreshFloatingBubble();
        resumeVoiceIfEnabled();
    }

    private void resumeVoiceIfEnabled() {
        android.content.SharedPreferences prefs = getSharedPreferences("cosmic_live", MODE_PRIVATE);
        if (!prefs.contains("wake_word_enabled")) {
            // First install defaults to the visible, user-controllable local wake-word mode.
            prefs.edit().putBoolean("wake_word_enabled", true).apply();
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        if (prefs.getBoolean("voice_auto_resume", false)) {
            if (CosmicLiveService.isRunning()) return;
            Intent live = new Intent(this, CosmicLiveService.class);
            live.setAction(CosmicLiveService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(live);
            else startService(live);
            return;
        }
        if (prefs.getBoolean("wake_word_enabled", false) && !CosmicWakeWordService.isRunning() && !CosmicLiveService.isRunning()) {
            // Allow the WebView's Gemini Live auto-start a moment to take ownership of the mic.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                android.content.SharedPreferences current = getSharedPreferences("cosmic_live", MODE_PRIVATE);
                if (!current.getBoolean("wake_word_enabled", false) || CosmicWakeWordService.isRunning() || CosmicLiveService.isRunning()) return;
                Intent wake = new Intent(this, CosmicWakeWordService.class);
                wake.setAction(CosmicWakeWordService.ACTION_START);
                try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(wake); else startService(wake); }
                catch (Exception error) { android.util.Log.e("COSMIC", "Could not restore local wake listener", error); }
            }, 4500);
        }
    }

    private void startCosmicBackend() {
        Intent service = new Intent(this, CosmicBackendService.class);
        service.setAction(CosmicBackendService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(service);
        } else {
            startService(service);
        }
    }
}
