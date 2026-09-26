package br.com.rcconstrutec.centrocustos;

import android.content.Context;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;

/** Barra de status transparente com o conteudo por baixo, e leitura das margens do sistema e do teclado. */
final class SystemBars {
    static final class Insets {
        final int left, top, right, bottom, ime;
        Insets(int left, int top, int right, int bottom, int ime) { this.left = left; this.top = top; this.right = right; this.bottom = bottom; this.ime = ime; }
    }

    private SystemBars() {}

    @SuppressWarnings("deprecation")
    static void edgeToEdge(Window window) {
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        WindowManager.LayoutParams attrs = window.getAttributes();
        attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        window.setAttributes(attrs);
    }

    @SuppressWarnings("deprecation")
    static Insets read(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            return new Insets(bars.left, bars.top, bars.right, bars.bottom, ime.bottom);
        }
        int stableBottom = insets.getStableInsetBottom();
        int total = insets.getSystemWindowInsetBottom();
        int ime = total > stableBottom ? total : 0;
        return new Insets(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), stableBottom, ime);
    }

    /** Chama a tarefa quando uma rede fica disponivel. Devolve o callback para cancelar em onDestroy. */
    static ConnectivityManager.NetworkCallback onNetwork(Context context, Runnable task) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) return null;
        ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { task.run(); }
        };
        manager.registerDefaultNetworkCallback(callback);
        return callback;
    }

    static boolean online(Context context) {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        Network network = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /** Token de https://<host>/redefinir-senha#t=<token>, ou null se o link nao for esse. */
    static String resetToken(Uri data, String host) {
        if (data == null || host == null || !"https".equals(data.getScheme()) || !host.equalsIgnoreCase(data.getHost())) return null;
        String path = data.getPath();
        String fragment = data.getEncodedFragment();
        if (path == null || !path.startsWith("/redefinir-senha") || fragment == null) return null;
        for (String part : fragment.split("&")) {
            if (part.startsWith("t=") && part.substring(2).matches("[A-Za-z0-9_-]{16,}")) return part.substring(2);
        }
        return null;
    }
}
