package com.cosmic.ai;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.media.projection.MediaProjectionManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.accessibility.AccessibilityManager;
import android.provider.Settings;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import androidx.core.content.ContextCompat;
import androidx.activity.result.ActivityResult;
import android.net.Uri;
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
            boolean alreadyRunning = CosmicLiveService.isRunning();
            Intent intent = new Intent(getContext(), CosmicLiveService.class);
            intent.setAction(CosmicLiveService.ACTION_START);
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
            Intent intent = new Intent(getContext(), CosmicLiveService.class);
            intent.setAction(CosmicLiveService.ACTION_STOP);
            getContext().startService(intent);
            call.resolve(new JSObject().put("success", true));
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
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermission");
            return;
        }
        startRecognition(call);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED)
            startRecognition(call);
        else call.reject("Microphone permission denied");
    }

    private void startRecognition(PluginCall call) {
        Activity activity = getActivity();
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            call.reject("Android speech recognition is unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            final SpeechRecognizer sr;
            try { sr = SpeechRecognizer.createSpeechRecognizer(activity); }
            catch (Exception e) { call.reject("Could not start speech recognition"); return; }

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            String language = call.getString("language", Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);

            sr.setRecognitionListener(new RecognitionListener() {
                private boolean finished = false;
                private void cleanup() {
                    try { sr.destroy(); } catch (Exception ignored) {}
                }
                @Override public void onResults(Bundle results) {
                    if (finished) return;
                    finished = true;
                    ArrayList<String> list = results.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION);
                    JSObject out = new JSObject();
                    out.put("text", list != null && !list.isEmpty() ? list.get(0) : "");
                    cleanup();
                    call.resolve(out);
                }
                @Override public void onError(int error) {
                    if (finished) return;
                    finished = true;
                    cleanup();
                    call.reject("Speech recognition error: " + error);
                }
                @Override public void onReadyForSpeech(Bundle b) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float v) {}
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onPartialResults(Bundle b) {}
                @Override public void onEvent(int i, Bundle b) {}
            });
            sr.startListening(intent);
        });
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
        int value;
        switch (action) {
            case "back": value = 1; break;
            case "home": value = 2; break;
            case "notifications": value = 4; break;
            case "quicksettings": value = 5; break;
            default: call.reject("Unsupported system action"); return;
        }
        if (action.equals("back")) {
            getActivity().runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
                "history.length>1?history.back():null", null));
            call.resolve(new JSObject().put("success", true));
            return;
        }
        // Home/notification shade require an enabled Accessibility Service.
        call.reject("This action requires an enabled COSMIC Accessibility Service");
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
