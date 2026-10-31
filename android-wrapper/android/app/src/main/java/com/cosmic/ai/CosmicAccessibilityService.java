package com.cosmic.ai;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.os.Build;

public class CosmicAccessibilityService extends AccessibilityService {
    private static volatile CosmicAccessibilityService instance;

    @Override public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) { }

    @Override public void onInterrupt() { }

    @Override public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    public static boolean perform(String action) {
        CosmicAccessibilityService service = instance;
        if (service == null) return false;
        int globalAction;
        switch (action) {
            case "back": globalAction = GLOBAL_ACTION_BACK; break;
            case "home": globalAction = GLOBAL_ACTION_HOME; break;
            case "notifications": globalAction = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quicksettings": globalAction = GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "recents": globalAction = GLOBAL_ACTION_RECENTS; break;
            default: return false;
        }
        return service.performGlobalAction(globalAction);
    }
}
