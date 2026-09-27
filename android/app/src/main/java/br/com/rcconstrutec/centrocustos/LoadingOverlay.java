package br.com.rcconstrutec.centrocustos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * Tela de carregamento da Suite (assets/loading/index.html): simbolo da Construtec,
 * nome do app e o progresso real da primeira carga do
 * app web. Fica por cima da WebView do app e some quando a pagina termina de carregar.
 * WebView local, sem ponte JavaScript e sem rede.
 */
final class LoadingOverlay {
    private static final int NAVY = Color.rgb(2, 24, 32);
    private final WebView view;
    private final FrameLayout layer;
    private boolean done;

    @SuppressLint("SetJavaScriptEnabled")
    LoadingOverlay(Activity activity, FrameLayout layer, String appName) {
        this.layer = layer;
        view = new WebView(activity);
        view.setBackgroundColor(NAVY);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false); // file:///android_asset continua liberado
        settings.setAllowContentAccess(false);
        settings.setDomStorageEnabled(false);
        view.setVerticalScrollBarEnabled(false);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        layer.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        view.loadUrl("file:///android_asset/loading/index.html?app=" + Uri.encode(appName));
    }

    void progress(int value) {
        if (done) return;
        view.evaluateJavascript("window.setProgress&&window.setProgress(" + Math.max(0, Math.min(100, value)) + ")", null);
        if (value >= 100) finish();
    }

    /** Termina a barra, esmaece e tira a camada; so acontece uma vez por app. */
    void finish() {
        if (done) return;
        done = true;
        view.evaluateJavascript("window.finish&&window.finish()", null);
        view.postDelayed(() -> {
            view.animate().alpha(0f).setDuration(220).withEndAction(() -> {
                layer.removeView(view);
                view.destroy();
            }).start();
        }, 420);
    }
}
