package com.cosmic.ai;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CosmicVoicePlugin.class);
        registerPlugin(CosmicScreenSharePlugin.class);
        registerPlugin(CosmicBackendPlugin.class);
        super.onCreate(savedInstanceState);
        startCosmicBackend();
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
