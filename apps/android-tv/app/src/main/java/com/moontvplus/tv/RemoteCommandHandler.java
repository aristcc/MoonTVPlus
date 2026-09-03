package com.moontvplus.tv;

public interface RemoteCommandHandler {
    void onRemoteKey(String key, boolean repeat, String digit);
    void onRemoteText(String mode, String text);
}
