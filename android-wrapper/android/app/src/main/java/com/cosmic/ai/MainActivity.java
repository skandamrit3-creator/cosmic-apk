package com.cosmic.ai;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(CosmicVoicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
