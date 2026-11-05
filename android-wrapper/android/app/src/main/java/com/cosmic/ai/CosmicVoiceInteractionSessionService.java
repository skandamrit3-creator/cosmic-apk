package com.cosmic.ai;

import android.service.voice.VoiceInteractionSession;
import android.service.voice.VoiceInteractionSessionService;
import android.os.Bundle;

public class CosmicVoiceInteractionSessionService extends VoiceInteractionSessionService {
    @Override
    public VoiceInteractionSession onNewSession(Bundle args) {
        return new CosmicVoiceInteractionSession(this);
    }
}
