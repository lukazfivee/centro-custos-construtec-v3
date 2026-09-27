package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** Clientes da WebView remota (Centro de Custos web) e o botao de menu do shell. Sem ponte JavaScript. */
final class AppWebView {
    interface Host {
        boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params);
        void loadFailed(String message);
        void message(String message);
        /** Links suite://seguranca, suite://sair, suite://entrar e suite://app/<id> vindos dos sites; action e "host" ou "host/caminho". */
        void suiteLink(String action);
    }

    private AppWebView() {}

    /** appName aparece na tela de carregamento ("Abrindo o Centro de Custos"). */
    static void attach(Activity activity, WebView webView, FrameLayout layer, String url, String appName, Host host) {
        LoadingOverlay loading = new LoadingOverlay(activity, layer, appName);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return host.openFileChooser(callback, params);
            }
            @Override public void onProgressChanged(WebView view, int value) { loading.progress(value); }
        });
        Uri allowed = Uri.parse(url);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if ("suite".equals(target.getScheme())) { String path = target.getPath() == null ? "" : target.getPath(); String query = target.getEncodedQuery() == null ? "" : "?" + target.getEncodedQuery(); host.suiteLink(target.getHost() + path + query); return true; }
                if (allowed.getHost().equalsIgnoreCase(target.getHost()) && allowed.getScheme().equalsIgnoreCase(target.getScheme())) return false;
                try { activity.startActivity(new Intent(Intent.ACTION_VIEW, target)); } catch (ActivityNotFoundException ignored) { /* sem app para abrir */ }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
                loading.finish();
                host.loadFailed("O certificado HTTPS não é válido.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { loading.finish(); host.loadFailed(null); }
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
}
