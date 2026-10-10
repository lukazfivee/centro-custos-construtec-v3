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
import android.view.WindowInsetsController;
import android.view.WindowManager;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Barra de status transparente com o conteudo por baixo, e leitura das margens do sistema e do teclado. */
final class SystemBars {
    private static final Pattern RGB = Pattern.compile("rgba?\\(\\s*(\\d+)[ ,]+(\\d+)[ ,]+(\\d+)(?:[ ,/]+([0-9.]+))?\\s*\\)");

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

    /** Cor da pagina (theme-color, ou o fundo do corpo) devolvida pelo evaluateJavascript, ou null se nao der para usar. */
    static Integer parseColor(String json) {
        if (json == null) return null;
        String value = json.replace("\"", "").trim();
        try {
            if (value.startsWith("#")) return 0xFF000000 | Color.parseColor(value);
            Matcher rgb = RGB.matcher(value);
            if (!rgb.matches()) return null;
            if (rgb.group(4) != null && Float.parseFloat(rgb.group(4)) < 0.5f) return null; // transparente: sem cor propria
            return Color.rgb(Integer.parseInt(rgb.group(1)), Integer.parseInt(rgb.group(2)), Integer.parseInt(rgb.group(3)));
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    /** Icones escuros (fundo claro) ou claros (fundo escuro) na barra de status e na de navegacao. */
    @SuppressWarnings("deprecation")
    static void iconsFor(Window window, int background) {
        boolean lightBackground = Color.luminance(background) > 0.5f;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance(lightBackground ? mask : 0, mask);
        } else {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(lightBackground ? flags | mask : flags & ~mask);
        }
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

    /** Fragmento de https://<host>/cadastro#convite=<token>&codigo=..&email=.. (as telas leem), ou null. */
    static String invite(Uri data, String host) {
        if (data == null || host == null || !"https".equals(data.getScheme()) || !host.equalsIgnoreCase(data.getHost())) return null;
        String fragment = data.getEncodedFragment();
        if (!"/cadastro".equals(data.getPath()) || fragment == null || fragment.length() > 600) return null;
        return fragment.matches("(^|.*&)convite=[A-Za-z0-9_-]{16,}(&.*|$)") ? fragment : null;
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
