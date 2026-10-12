package com.alexhulbert.coloreader.bridge;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public final class MainActivity extends Activity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        startForegroundService(new Intent(this, PaletteService.class));
        finish();
    }
}
