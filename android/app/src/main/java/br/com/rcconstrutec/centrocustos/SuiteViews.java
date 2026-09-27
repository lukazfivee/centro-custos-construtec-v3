package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * As WebViews remotas da Suite, uma por app (Centro de Custos e Orcamentos).
 * A ativa fica visivel; a outra fica escondida sem recarregar, para a troca
 * entre apps nao perder o estado da tela.
 */
final class SuiteViews {
    static final String CENTRO_CUSTOS = "centro-custos";
    static final String ORCAMENTOS = "orcamentos";

    private final Activity activity;
    private final FrameLayout layer;
    private final Map<String, FrameLayout> frames = new LinkedHashMap<>();
    private final Map<String, WebView> views = new LinkedHashMap<>();
    private String active;

    SuiteViews(Activity activity, FrameLayout layer) {
        this.activity = activity;
        this.layer = layer;
    }

    static boolean known(String app) { return CENTRO_CUSTOS.equals(app) || ORCAMENTOS.equals(app); }

    boolean isEmpty() { return views.isEmpty(); }
    boolean has(String app) { return views.containsKey(app); }
    String activeApp() { return active; }
    WebView active() { return active == null ? null : views.get(active); }

    /** Cria a WebView do app (substituindo a anterior do mesmo app) e a mostra. O frame recebe a WebView e o indicador de carregamento. */
    FrameLayout create(String app, WebView view) {
        destroy(app);
        FrameLayout frame = new FrameLayout(activity);
        frame.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        layer.addView(frame, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        frames.put(app, frame);
        views.put(app, view);
        show(app);
        return frame;
    }

    void show(String app) {
        if (!frames.containsKey(app)) return;
        active = app;
        for (Map.Entry<String, FrameLayout> entry : frames.entrySet()) {
            boolean visible = entry.getKey().equals(app);
            entry.getValue().setVisibility(visible ? View.VISIBLE : View.GONE);
            if (visible) entry.getValue().bringToFront();
        }
    }

    void destroyAll() {
        for (String app : views.keySet().toArray(new String[0])) destroy(app);
        active = null;
    }

    private void destroy(String app) {
        WebView view = views.remove(app);
        FrameLayout frame = frames.remove(app);
        if (view != null) { view.stopLoading(); view.loadUrl("about:blank"); view.destroy(); }
        if (frame != null) layer.removeView(frame);
        if (app.equals(active)) active = views.isEmpty() ? null : views.keySet().iterator().next();
    }
}
