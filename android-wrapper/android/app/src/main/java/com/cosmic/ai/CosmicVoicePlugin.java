package com.cosmic.ai;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.os.StatFs;
import android.os.BatteryManager;
import android.os.PowerManager;
import android.os.Handler;
import android.os.Looper;
import android.app.DownloadManager;
import android.media.projection.MediaProjectionManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.speech.tts.TextToSpeech;
import android.view.accessibility.AccessibilityManager;
import android.provider.Settings;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import androidx.core.content.ContextCompat;
import androidx.activity.result.ActivityResult;
import android.net.Uri;
import android.net.TrafficStats;
import android.webkit.URLUtil;
import android.view.accessibility.AccessibilityNodeInfo;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.*;

@CapacitorPlugin(name = "CosmicVoice",
 permissions = {@Permission(alias = "microphone",
 strings = {Manifest.permission.RECORD_AUDIO})})
public class CosmicVoicePlugin extends Plugin {
    private TextToSpeech tts;
    private BroadcastReceiver liveReceiver;
    private long lastCpuTotal = -1L;
    private long lastCpuIdle = -1L;
    private long lastNetworkRx = -1L;
    private long lastNetworkTx = -1L;
    private long lastNetworkSampleAt = -1L;

    @Override
    public void load() {
        super.load();
        liveReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                JSObject data = new JSObject();
                data.put("type", intent.getStringExtra("type"));
                data.put("message", intent.getStringExtra(CosmicLiveService.EXTRA_MESSAGE));
                notifyListeners("liveEvent", data);
            }
        };
        ContextCompat.registerReceiver(getContext(), liveReceiver,
                new IntentFilter(CosmicLiveService.ACTION_EVENT),
                ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @PluginMethod
    public void enableWakeWord(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "wakeMicPermission");
            return;
        }
        startWakeWordService(call);
    }

    @PermissionCallback
    private void wakeMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startWakeWordService(call);
        else call.reject("Microphone permission is required for local wake-word detection.");
    }

    private void startWakeWordService(PluginCall call) {
        try {
            getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE)
                    .edit().putBoolean("wake_word_enabled", true).putBoolean("voice_auto_resume", false).apply();
            Intent stopLive = new Intent(getContext(), CosmicLiveService.class);
            stopLive.setAction(CosmicLiveService.ACTION_STOP);
            getContext().startService(stopLive);
            Intent wake = new Intent(getContext(), CosmicWakeWordService.class);
            wake.setAction(CosmicWakeWordService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(wake);
            else getContext().startService(wake);
            call.resolve(new JSObject().put("success", true).put("enabled", true)
                    .put("message", "Local wake word enabled. The first start downloads a verified offline speech model."));
        } catch (Exception e) { call.reject("Could not enable local wake word: " + e.getMessage()); }
    }

    @PluginMethod
    public void disableWakeWord(PluginCall call) {
        getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE)
                .edit().putBoolean("wake_word_enabled", false).apply();
        Intent stop = new Intent(getContext(), CosmicWakeWordService.class);
        stop.setAction(CosmicWakeWordService.ACTION_STOP);
        try { getContext().startService(stop); } catch (Exception ignored) {}
        call.resolve(new JSObject().put("success", true).put("enabled", false));
    }

    @PluginMethod
    public void getWakeWordStatus(PluginCall call) {
        boolean enabled = getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE)
                .getBoolean("wake_word_enabled", false);
        call.resolve(new JSObject().put("enabled", enabled)
                .put("running", CosmicWakeWordService.isRunning()));
    }

    @PluginMethod
    public void getLiveStatus(PluginCall call) {
        call.resolve(new JSObject()
                .put("running", CosmicLiveService.isRunning())
                .put("ready", CosmicLiveService.isReady()));
    }

    @PluginMethod
    public void startLive(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "liveMicPermission");
            return;
        }
        startLiveService(call);
    }

    @PermissionCallback
    private void liveMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startLiveService(call);
        else call.reject("Microphone permission denied. Gemini Live cannot start.");
    }

    private void startLiveService(PluginCall call) {
        try {
            Intent stopWake = new Intent(getContext(), CosmicWakeWordService.class);
            stopWake.setAction(CosmicWakeWordService.ACTION_STOP);
            try { getContext().startService(stopWake); } catch (Exception ignored) {}
            boolean wakeEnabled = getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE).getBoolean("wake_word_enabled", false);
            getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE).edit().putBoolean("voice_auto_resume", !wakeEnabled).apply();
            String model = call.getString("model", "gemini-3.8-live");
            if (!"gemini-3.8-live".equals(model) &&
                    !"gemini-3.8-live-extended-thinking".equals(model)) {
                call.reject("Unsupported Gemini Live model.");
                return;
            }
            String voice = call.getString("voice", "Kore");
            if (!Arrays.asList("Kore", "Aoede", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Zephyr").contains(voice)) {
                voice = "Kore";
            }
            boolean alreadyRunning = CosmicLiveService.isRunning();
            Intent intent = new Intent(getContext(), CosmicLiveService.class);
            intent.setAction(CosmicLiveService.ACTION_START);
            intent.putExtra("live_model", model);
            intent.putExtra("live_voice", voice);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(intent);
            else getContext().startService(intent);
            call.resolve(new JSObject().put("success", true).put("alreadyRunning", alreadyRunning)
                    .put("message", alreadyRunning ? "Gemini Live already running" : "Gemini Live starting")
                    .put("connected", CosmicLiveService.isReady()));
        } catch (Exception e) {
            call.reject("Could not start Gemini Live: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopLive(PluginCall call) {
        try {
            boolean wakeEnabled = getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE).getBoolean("wake_word_enabled", false);
            getContext().getSharedPreferences("cosmic_live", Context.MODE_PRIVATE).edit().putBoolean("voice_auto_resume", false).apply();
            Intent intent = new Intent(getContext(), CosmicLiveService.class);
            intent.setAction(CosmicLiveService.ACTION_STOP);
            getContext().startService(intent);
            call.resolve(new JSObject().put("success", true));
            if (wakeEnabled) new Handler(Looper.getMainLooper()).postDelayed(() -> {
                Intent wake = new Intent(getContext(), CosmicWakeWordService.class);
                wake.setAction(CosmicWakeWordService.ACTION_START);
                try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(wake); else getContext().startService(wake); } catch (Exception ignored) {}
            }, 1200);
        } catch (Exception e) {
            call.reject("Could not stop Gemini Live: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openFloatingBubbleSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(getContext())) {
                CosmicLiveService.refreshFloatingBubble();
                call.resolve(new JSObject().put("success", true).put("enabled", true));
                return;
            }
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("success", true).put("openedSettings", true));
        } catch (Exception e) {
            call.reject("Could not open floating bubble permission settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startScreenShare(PluginCall call) {
        if (!CosmicLiveService.isRunning()) {
            call.reject("Start Gemini Live before sharing your screen.");
            return;
        }
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getContext()
                    .getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            startActivityForResult(call, manager.createScreenCaptureIntent(), "screenShareResult");
        } catch (Exception e) {
            call.reject("Could not request Android screen sharing permission: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void screenShareResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Screen sharing was cancelled.");
            return;
        }
        try {
            Intent service = new Intent(getContext(), CosmicLiveService.class);
            service.setAction(CosmicLiveService.ACTION_SCREEN_START);
            service.putExtra("projection_result", result.getResultCode());
            service.putExtra("projection_data", result.getData());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(service);
            else getContext().startService(service);
            call.resolve(new JSObject().put("success", true).put("message", "Screen sharing started with Android approval."));
        } catch (Exception e) {
            call.reject("Could not start screen sharing: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopScreenShare(PluginCall call) {
        try {
            Intent service = new Intent(getContext(), CosmicLiveService.class);
            service.setAction(CosmicLiveService.ACTION_SCREEN_STOP);
            getContext().startService(service);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception e) {
            call.reject("Could not stop screen sharing: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendLiveToolResponse(PluginCall call) {
        String responses = call.getString("responses", "[]");
        if (!CosmicLiveService.sendToolResponses(responses)) {
            call.reject("Gemini Live tool response could not be sent.");
            return;
        }
        call.resolve(new JSObject().put("success", true));
    }

    @PluginMethod
    public void sendLiveText(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) { call.reject("Message is empty"); return; }
        if (!CosmicLiveService.sendText(text)) {
            call.reject("Gemini Live is not connected. Start the Live session first.");
            return;
        }
        call.resolve(new JSObject().put("success", true));
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text.trim().isEmpty()) { call.reject("No text to speak"); return; }
        getActivity().runOnUiThread(() -> {
            if (tts != null) tts.shutdown();
            tts = new TextToSpeech(getContext(), status -> {
                if (status != TextToSpeech.SUCCESS) {
                    call.reject("Text-to-speech initialization failed");
                    return;
                }
                tts.setLanguage(Locale.getDefault());
                tts.setSpeechRate(1.0f);
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "cosmic-reply");
                JSObject out = new JSObject();
                out.put("success", true);
                call.resolve(out);
            });
        });
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String wanted = call.getString("name", "").trim().toLowerCase(Locale.ROOT);
        if (wanted.isEmpty()) { call.reject("App name is empty"); return; }
        PackageManager pm = getContext().getPackageManager();
        Intent query = new Intent(Intent.ACTION_MAIN, null);
        query.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(query, 0);
        ResolveInfo best = null;
        for (ResolveInfo info : apps) {
            String label = info.loadLabel(pm).toString().toLowerCase(Locale.ROOT);
            if (label.equals(wanted)) { best = info; break; }
            if (best == null && label.contains(wanted)) best = info;
        }
        if (best == null) { call.reject("Installed app not found: " + wanted); return; }
        try {
            Intent launch = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
            if (launch == null) { call.reject("App cannot be launched"); return; }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception e) { call.reject("Could not launch app: " + e.getMessage()); }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String raw = call.getString("url", "").trim();
        Uri uri = Uri.parse(raw);
        String scheme = uri.getScheme();
        if (raw.isEmpty() || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
            call.reject("Only valid HTTP or HTTPS links can be opened");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                call.reject("No browser or app can open this link");
                return;
            }
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("success", true).put("url", uri.toString()));
        } catch (Exception e) {
            call.reject("Could not open link: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String raw = call.getString("url", "").trim();
        Uri uri = Uri.parse(raw);
        String scheme = uri.getScheme();
        if (raw.isEmpty() || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
            call.reject("Only HTTP or HTTPS download links are allowed");
            return;
        }
        try {
            String filename = call.getString("fileName", URLUtil.guessFileName(raw, null, null));
            filename = filename == null ? "cosmic-download" : filename.trim();
            filename = filename.replaceAll("[^A-Za-z0-9._-]", "_");
            if (filename.isEmpty() || filename.equals(".") || filename.equals("..")) {
                filename = "cosmic-download";
            }
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Android Download Manager is unavailable");
                return;
            }
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle(filename);
            request.setDescription("Downloaded by COSMIC");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            long id = manager.enqueue(request);
            call.resolve(new JSObject().put("success", true).put("downloadId", id).put("fileName", filename));
        } catch (Exception e) {
            call.reject("Could not start download: " + e.getMessage());
        }
    }

    @PluginMethod
    public void systemAction(PluginCall call) {
        String action = call.getString("action", "").toLowerCase(Locale.ROOT);
        if (!Arrays.asList("back", "home", "notifications", "quicksettings", "recents").contains(action)) {
            call.reject("Unsupported system action");
            return;
        }
        if (CosmicAccessibilityService.perform(action)) {
            call.resolve(new JSObject().put("success", true).put("action", action));
            return;
        }
        call.reject("Enable COSMIC Device Controls in Android Accessibility settings before using " + action + ".");
    }

    @PluginMethod
    public void getDeviceMetrics(PluginCall call) {
        try {
            JSObject out = new JSObject();
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
            if (am != null) {
                am.getMemoryInfo(memory);
                long total = memory.totalMem;
                long used = Math.max(0L, total - memory.availMem);
                out.put("ramTotalBytes", total);
                out.put("ramUsedBytes", used);
                out.put("ramPercent", total > 0 ? Math.round((used * 100.0) / total) : -1);
            } else {
                out.put("ramPercent", -1);
            }

            StatFs fs = new StatFs(Environment.getDataDirectory().getAbsolutePath());
            long totalStorage = fs.getTotalBytes();
            long freeStorage = fs.getAvailableBytes();
            long usedStorage = Math.max(0L, totalStorage - freeStorage);
            out.put("storageTotalBytes", totalStorage);
            out.put("storageUsedBytes", usedStorage);
            out.put("storagePercent", totalStorage > 0 ? Math.round((usedStorage * 100.0) / totalStorage) : -1);

            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader("/proc/stat"))) {
                String line = reader.readLine();
                if (line != null && line.startsWith("cpu ")) {
                    String[] fields = line.trim().split("\\s+");
                    long total = 0L;
                    for (int i = 1; i < fields.length; i++) total += Long.parseLong(fields[i]);
                    long idle = Long.parseLong(fields[4]) + (fields.length > 5 ? Long.parseLong(fields[5]) : 0L);
                    int percent = -1;
                    if (lastCpuTotal >= 0 && total > lastCpuTotal) {
                        long deltaTotal = total - lastCpuTotal;
                        long deltaIdle = idle - lastCpuIdle;
                        percent = (int) Math.max(0, Math.min(100, Math.round((deltaTotal - deltaIdle) * 100.0 / deltaTotal)));
                    }
                    lastCpuTotal = total;
                    lastCpuIdle = idle;
                    out.put("cpuPercent", percent);
                } else out.put("cpuPercent", -1);
            } catch (Exception ignored) {
                out.put("cpuPercent", -1);
            }

            long rxBytes = TrafficStats.getTotalRxBytes();
            long txBytes = TrafficStats.getTotalTxBytes();
            long networkNow = System.currentTimeMillis();
            long rxRate = -1L;
            long txRate = -1L;
            if (rxBytes >= 0 && txBytes >= 0 && lastNetworkSampleAt > 0 && networkNow > lastNetworkSampleAt) {
                long elapsed = networkNow - lastNetworkSampleAt;
                rxRate = Math.max(0L, (rxBytes - lastNetworkRx) * 1000L / elapsed);
                txRate = Math.max(0L, (txBytes - lastNetworkTx) * 1000L / elapsed);
            }
            if (rxBytes >= 0 && txBytes >= 0) {
                lastNetworkRx = rxBytes;
                lastNetworkTx = txBytes;
                lastNetworkSampleAt = networkNow;
            }
            out.put("networkRxBytesPerSecond", rxRate);
            out.put("networkTxBytesPerSecond", txRate);

            BatteryManager battery = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
            out.put("batteryPercent", battery != null ? battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : -1);
            out.put("gpuPercent", -1);
            out.put("gpuAvailable", false);
            out.put("sampledAt", System.currentTimeMillis());
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read Android device metrics: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception e) { call.reject("Could not open Accessibility settings: " + e.getMessage()); }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception e) { call.reject("Could not open app settings: " + e.getMessage()); }
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        if (liveReceiver != null) { try { getContext().unregisterReceiver(liveReceiver); } catch (Exception ignored) {} liveReceiver = null; }
        super.handleOnDestroy();
    }
}
