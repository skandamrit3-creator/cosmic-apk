package com.cosmic.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.accessibility.AccessibilityManager;
import android.provider.Settings;
import android.content.Context;
import android.net.Uri;
import android.view.accessibility.AccessibilityNodeInfo;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.*;

@CapacitorPlugin(name = "CosmicVoice",
 permissions = {@Permission(alias = "microphone",
 strings = {Manifest.permission.RECORD_AUDIO})})
public class CosmicVoicePlugin extends Plugin {
    private TextToSpeech tts;

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

    @PluginMethod
    public void startBackgroundMode(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "startBackgroundMicPermission");
            return;
        }
        startWakeWordService(call);
    }

    @PermissionCallback
    private void startBackgroundMicPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startWakeWordService(call);
        else call.reject("Microphone permission denied");
    }

    private void startWakeWordService(PluginCall call) {
        String phrase = call.getString("wakePhrase", "hey myraa");
        Intent service = new Intent(getContext(), CosmicWakeWordService.class);
        service.setAction(CosmicWakeWordService.ACTION_START);
        service.putExtra(CosmicWakeWordService.EXTRA_PHRASE, phrase);
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(service);
            else getContext().startService(service);
            call.resolve(new JSObject().put("success", true).put("wakePhrase", phrase));
        } catch (Exception e) {
            call.reject("Could not start foreground wake-word service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopBackgroundMode(PluginCall call) {
        Intent service = new Intent(getContext(), CosmicWakeWordService.class);
        service.setAction(CosmicWakeWordService.ACTION_STOP);
        try {
            getContext().startService(service);
            call.resolve(new JSObject().put("success", true));
        } catch (Exception e) {
            call.reject("Could not stop wake-word service: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        super.handleOnDestroy();
    }
}
