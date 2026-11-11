package com.cosmic.ai;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name = "CosmicBackend")
public class CosmicBackendPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), CosmicBackendService.class);
            intent.setAction(CosmicBackendService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
            else getContext().startService(intent);
            call.resolve(new JSObject().put("success", true).put("url", "http://127.0.0.1:8160"));
        } catch (Exception error) {
            call.reject("Could not start COSMIC backend service: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), CosmicBackendService.class);
            intent.setAction(CosmicBackendService.ACTION_STOP);
            getContext().startService(intent);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception error) {
            call.reject("Could not stop COSMIC backend service: " + error.getMessage());
        }
    }
}
