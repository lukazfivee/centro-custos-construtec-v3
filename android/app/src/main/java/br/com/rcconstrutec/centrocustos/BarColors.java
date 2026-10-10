package br.com.rcconstrutec.centrocustos;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.Window;
import android.webkit.WebView;
import android.widget.FrameLayout;

import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/**
 * Cor da barra de status (e da de navegacao): acompanha o que a pagina desenha logo abaixo da barra, em vez de ficar sempre escura.
 * Amostra o pixel real (PixelCopy), entao o escurecimento de janelas e paineis tambem chega a faixa. Se a amostra falhar,
 * le o theme-color / fundo da pagina por evaluateJavascript. Sem ponte JavaScript.
 */
final class BarColors {
    private static final String PAGE_COLOR_JS = "(function(){var m=document.querySelector('meta[name=\"theme-color\"]');"
        + "var c=m&&m.content;if(c)return c;var b=document.body&&getComputedStyle(document.body).backgroundColor;"
        + "if(b&&b!=='rgba(0, 0, 0, 0)')return b;return getComputedStyle(document.documentElement).backgroundColor;})()";
    private static final int SETUP_BG = Color.rgb(242, 246, 247); // tela de endereco da instalacao local e clara
    private static final long POLL_MS = 250;
    private static final int EDGE_PX = 6; // coluna junto a borda: so fundo da pagina, sem cartoes

    private final Window window;
    private final FrameLayout layer;
    private final int dark;
    private final BooleanSupplier authVisible;
    private final Supplier<WebView> activeWeb;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Bitmap sample = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
    private final Runnable poll = new Runnable() {
        @Override public void run() { sync(); ui.postDelayed(this, POLL_MS); }
    };
    private int current;
    private boolean copying;

    BarColors(Window window, FrameLayout layer, int dark, BooleanSupplier authVisible, Supplier<WebView> activeWeb) {
        this.window = window;
        this.layer = layer;
        this.dark = dark;
        this.authVisible = authVisible;
        this.activeWeb = activeWeb;
    }

    void start() { ui.post(poll); }
    void stop() { ui.removeCallbacks(poll); }

    void sync() {
        if (authVisible.getAsBoolean()) { apply(dark); return; } // as telas de entrada sao sempre escuras
        WebView web = activeWeb.get();
        if (web == null) { apply(SETUP_BG); return; }
        if (copying) return;
        int y = layer.getPaddingTop() + 2;
        copying = true;
        try {
            PixelCopy.request(window, new Rect(EDGE_PX, y, EDGE_PX + 1, y + 1), sample, result -> {
                copying = false;
                if (result == PixelCopy.SUCCESS) apply(0xFF000000 | sample.getPixel(0, 0));
                else fromPage(web);
            }, ui);
        } catch (IllegalArgumentException notReady) { // janela ainda sem superficie
            copying = false;
            fromPage(web);
        }
    }

    private void fromPage(WebView web) {
        web.evaluateJavascript(PAGE_COLOR_JS, value -> {
            Integer color = SystemBars.parseColor(value);
            apply(color == null ? dark : color);
        });
    }

    private void apply(int color) {
        if (color == current) return;
        current = color;
        layer.setBackgroundColor(color);
        SystemBars.iconsFor(window, color);
    }
}
