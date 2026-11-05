package com.cosmic.ai;

import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;

public class CosmicVoiceInteractionSession extends VoiceInteractionSession {
    public CosmicVoiceInteractionSession(android.content.Context context) {
        super(context);
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startVoiceActivity(open);
        finish();
    }
}
