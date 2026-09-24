package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ProgressBar;

/** Clientes da WebView remota (Centro de Custos web) e o botao de menu do shell. Sem ponte JavaScript. */
final class AppWebView {
    interface Host {
        boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params);
        void loadFailed(String message);
        void message(String message);
    }

    private AppWebView() {}

    static void attach(Activity activity, WebView webView, FrameLayout layer, String url, Host host) {
        float density = activity.getResources().getDisplayMetrics().density;
        ProgressBar progress = new ProgressBar(activity);
        layer.addView(progress, new FrameLayout.LayoutParams(Math.round(48 * density), Math.round(48 * density), Gravity.CENTER));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return host.openFileChooser(callback, params);
            }
            @Override public void onProgressChanged(WebView view, int value) { progress.setVisibility(value >= 100 ? View.GONE : View.VISIBLE); }
        });
        Uri allowed = Uri.parse(url);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (allowed.getHost().equalsIgnoreCase(target.getHost()) && allowed.getScheme().equalsIgnoreCase(target.getScheme())) return false;
                try { activity.startActivity(new Intent(Intent.ACTION_VIEW, target)); } catch (ActivityNotFoundException ignored) { /* sem app para abrir */ }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                host.loadFailed("O certificado HTTPS não é válido.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) host.loadFailed(null);
            }
        });
        webView.setDownloadListener((link, userAgent, contentDisposition, mimeType, length) -> {
            if (link != null && (link.startsWith("http://") || link.startsWith("https://"))) {
                try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(link))); } catch (ActivityNotFoundException ignored) { /* sem app */ }
            } else {
                host.message("Use a versão Windows para baixar este arquivo.");
            }
        });
    }

    static void addMenuButton(Activity activity, FrameLayout layer, View.OnClickListener onClick) {
        float density = activity.getResources().getDisplayMetrics().density;
        ImageButton menu = new ImageButton(activity);
        menu.setImageResource(R.drawable.ic_menu);
        menu.setContentDescription("Menu da Suíte");
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.argb(170, 2, 24, 32));
        bg.setStroke(Math.max(1, Math.round(density)), Color.argb(60, 255, 255, 255));
        menu.setBackground(bg);
        int size = Math.round(44 * density);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(size, size, Gravity.TOP | Gravity.END);
        lp.topMargin = Math.round(8 * density);
        lp.rightMargin = Math.round(8 * density);
        menu.setOnClickListener(onClick);
        layer.addView(menu, lp);
    }
}
