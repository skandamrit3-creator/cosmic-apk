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
        if (!getSharedPreferences("cosmic_live", MODE_PRIVATE).getBoolean("voice_auto_resume", false)) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        if (CosmicLiveService.isRunning()) return;
        Intent live = new Intent(this, CosmicLiveService.class);
        live.setAction(CosmicLiveService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(live);
        else startService(live);
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
