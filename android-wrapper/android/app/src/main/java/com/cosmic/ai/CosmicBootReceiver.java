package com.cosmic.ai;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class CosmicBootReceiver extends BroadcastReceiver {
    private static final String TAG = "COSMICBoot";
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        try {
            Intent service = new Intent(context, CosmicBackendService.class);
            service.setAction(CosmicBackendService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
        } catch (Exception error) {
            Log.e(TAG, "Could not start COSMIC backend after boot", error);
        }
    }
}
