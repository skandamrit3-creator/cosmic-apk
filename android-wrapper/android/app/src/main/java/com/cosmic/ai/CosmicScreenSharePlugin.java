package com.cosmic.ai;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name = "CosmicScreen")
public class CosmicScreenSharePlugin extends Plugin {
    private BroadcastReceiver frameReceiver;

    @Override public void load() {
        frameReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                String data = intent.getStringExtra("data");
                if (data == null || data.isEmpty()) return;
                notifyListeners("screenFrame", new JSObject()
                    .put("data", data).put("mimeType", "image/jpeg"));
            }
        };
        IntentFilter filter = new IntentFilter(CosmicScreenShareService.ACTION_FRAME);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(frameReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(frameReceiver, filter);
    }

    @PluginMethod public void startScreenShare(PluginCall call) {
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getContext()
                .getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (manager == null) { call.reject("Android screen sharing is unavailable."); return; }
            startActivityForResult(call, manager.createScreenCaptureIntent(), "screenShareResult");
        } catch (Exception error) {
            call.reject("Could not request Android screen sharing: " + error.getMessage());
        }
    }

    @ActivityCallback private void screenShareResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Screen sharing was cancelled.");
            return;
        }
        try {
            Intent service = new Intent(getContext(), CosmicScreenShareService.class);
            service.setAction(CosmicScreenShareService.ACTION_START);
            service.putExtra("resultCode", result.getResultCode());
            service.putExtra("resultData", result.getData());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(getContext(), service);
            else getContext().startService(service);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception error) {
            call.reject("Could not start screen sharing: " + error.getMessage());
        }
    }

    @PluginMethod public void stopScreenShare(PluginCall call) {
        try {
            Intent service = new Intent(getContext(), CosmicScreenShareService.class);
            service.setAction(CosmicScreenShareService.ACTION_STOP);
            getContext().startService(service);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception error) {
            call.reject("Could not stop screen sharing: " + error.getMessage());
        }
    }

    @Override protected void handleOnDestroy() {
        if (frameReceiver != null) {
            try { getContext().unregisterReceiver(frameReceiver); } catch (Exception ignored) {}
            frameReceiver = null;
        }
        super.handleOnDestroy();
    }
}
