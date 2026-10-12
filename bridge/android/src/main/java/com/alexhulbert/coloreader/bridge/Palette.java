package com.alexhulbert.coloreader.bridge;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import java.util.Locale;

final class Palette {
    static final int PORT = 7521;
    // Read system colors directly so custom palette generators can override them
    static int[] colors(Context context) {
        return new int[] {context.getColor(Build.VERSION.SDK_INT >= 34 ? android.R.color.system_surface_dark
                                                                       : android.R.color.system_neutral1_900),
                          context.getColor(android.R.color.system_neutral1_100),
                          context.getColor(android.R.color.system_neutral1_10),
                          context.getColor(android.R.color.system_neutral1_900)};
    }
    static String hex(int color) {
        return String.format(Locale.ROOT, "#%06x", color & 0xffffff);
    }
    static String snapshot(Context context) {
        int[] c = colors(context);
        boolean dark = (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) ==
                       Configuration.UI_MODE_NIGHT_YES;
        return "{\"v\":1,\"mode\":\"" + (dark ? "dark" : "light") + "\",\"bgDark\":\"" + hex(c[0]) + "\",\"fgDark\":\"" + hex(c[1]) +
            "\",\"bgLight\":\"" + hex(c[2]) + "\",\"fgLight\":\"" + hex(c[3]) + "\"}";
    }
}
