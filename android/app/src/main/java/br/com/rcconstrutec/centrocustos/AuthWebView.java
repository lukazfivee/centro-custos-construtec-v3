package br.com.rcconstrutec.centrocustos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * WebView so das telas de entrada. Serve android/app/src/main/assets/auth/ numa origem HTTPS local
 * e recusa qualquer outro endereco, entao a ponte AndroidAuth nunca fica exposta a pagina remota.
 */
final class AuthWebView {
    static final String HOST = "appassets.androidplatform.net";
    static final String START = "https://" + HOST + "/auth/index.html";
    private final Activity activity;
    private final WebView view;
    private volatile boolean trusted;
    private boolean loaded;
    private Runnable onLoaded;

    @SuppressLint("SetJavaScriptEnabled")
    AuthWebView(Activity activity) {
        this.activity = activity;
        view = new WebView(activity);
        view.setBackgroundColor(Color.TRANSPARENT);
        view.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setTextZoom(100);
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                Uri url = request.getUrl();
                return isLocal(url) ? serve(url) : response(403, "text/plain", new byte[0]);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap favicon) {
                trusted = url != null && isLocal(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView v, String url) {
                loaded = trusted;
                if (loaded && onLoaded != null) { Runnable run = onLoaded; onLoaded = null; run.run(); }
            }
        });
    }

    WebView view() { return view; }
    boolean trusted() { return trusted; }
    boolean loaded() { return loaded; }

    void attachBridge(Object bridge) { view.addJavascriptInterface(bridge, "AndroidAuth"); }

    void load(Runnable afterLoad) {
        onLoaded = afterLoad;
        loaded = false;
        view.loadUrl(START);
    }

    void evaluate(String script) {
        if (trusted) view.evaluateJavascript(script, null);
    }

    void event(String name, String jsonData) {
        evaluate("window.__nativeEvent&&window.__nativeEvent(" + org.json.JSONObject.quote(name) + "," + jsonData + ")");
    }

    void back(android.webkit.ValueCallback<String> handled) {
        if (trusted) view.evaluateJavascript("window.__onBack?window.__onBack():false", handled);
        else handled.onReceiveValue("false");
    }

    void destroy() { view.stopLoading(); view.destroy(); }

    static boolean isLocal(Uri url) {
        if (url == null) return false;
        String path = url.getPath();
        return "https".equals(url.getScheme()) && HOST.equals(url.getHost()) && url.getPort() == -1
            && path != null && path.startsWith("/auth/") && !path.contains("..");
    }

    private WebResourceResponse serve(Uri url) {
        String asset = url.getPath().substring(1);
        if (asset.endsWith("/")) asset += "index.html";
        try {
            InputStream in = activity.getAssets().open(asset);
            WebResourceResponse out = new WebResourceResponse(mime(asset), "utf-8", in);
            out.setResponseHeaders(headers());
            return out;
        } catch (IOException missing) {
            return response(404, "text/plain", new byte[0]);
        }
    }

    private static WebResourceResponse response(int status, String mime, byte[] body) {
        return new WebResourceResponse(mime, "utf-8", status, status == 404 ? "Not Found" : "Forbidden", headers(), new ByteArrayInputStream(body));
    }

    private static Map<String, String> headers() {
        Map<String, String> out = new HashMap<>();
        out.put("Cache-Control", "no-store");
        out.put("X-Content-Type-Options", "nosniff");
        return out;
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }
}
