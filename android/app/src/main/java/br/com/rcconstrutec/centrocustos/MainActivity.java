package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URI;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 42;
    private static final String PREFS = "centro_custos_android";
    private static final String SERVER_URL = "server_url";
    private final int navy = Color.rgb(2, 29, 38);
    private final int cyan = Color.rgb(50, 169, 205);
    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private SharedPreferences preferences;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(242, 246, 247));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        String savedUrl = preferences.getString(SERVER_URL, "");
        if (savedUrl.isEmpty()) showSetup(null); else showWebApp(savedUrl);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(sp); view.setTextColor(color); view.setLineSpacing(0, 1.15f);
        return view;
    }
    private LinearLayout.LayoutParams params(int width, int height, int top) {
        LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(width, height); value.topMargin = dp(top); return value;
    }

    private void showSetup(String error) {
        destroyWebView();
        root.removeAllViews();
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL); screen.setGravity(Gravity.CENTER_HORIZONTAL); screen.setPadding(dp(28), dp(36), dp(28), dp(32));
        FrameLayout.LayoutParams screenParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(screen, screenParams);

        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.app_icon); logo.setContentDescription("Construtec"); logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        screen.addView(logo, params(dp(78), dp(78), 10));
        TextView title = text("Centro de Custos", 28, navy); title.setGravity(Gravity.CENTER); title.setTypeface(null, android.graphics.Typeface.BOLD);
        screen.addView(title, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 18));
        TextView intro = text("Conecte este celular à instalação Windows da Construtec.", 16, Color.rgb(82, 104, 113)); intro.setGravity(Gravity.CENTER);
        screen.addView(intro, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));

        EditText address = new EditText(this); address.setSingleLine(true); address.setText(preferences.getString(SERVER_URL, "")); address.setHint("http://192.168.1.10:3333"); address.setTextSize(16); address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); address.setMinHeight(dp(52));
        screen.addView(address, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 28));
        TextView help = text("Na mesma rede Wi-Fi, copie o endereço mostrado em Configurações > Acesso pelo celular. Fora da empresa, use somente HTTPS.", 13, Color.rgb(82, 104, 113));
        screen.addView(help, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 8));
        if (error != null) { TextView errorView = text(error, 13, Color.rgb(180, 55, 55)); screen.addView(errorView, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 14)); }
        Button connect = new Button(this); connect.setText("Conectar"); connect.setTextSize(15); connect.setTextColor(navy); connect.setBackgroundColor(cyan); connect.setMinHeight(dp(52)); connect.setAllCaps(false);
        screen.addView(connect, params(ViewGroup.LayoutParams.MATCH_PARENT, dp(52), 22));
        connect.setOnClickListener(v -> {
            String normalized = normalizeUrl(address.getText().toString());
            if (normalized == null) { address.setError("Use HTTPS ou um endereço privado da rede Wi-Fi."); return; }
            preferences.edit().putString(SERVER_URL, normalized).apply();
            showWebApp(normalized);
        });
    }

    private String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = URI.create(value);
            String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
            String host = String.valueOf(uri.getHost()).toLowerCase(Locale.ROOT);
            if (host.isEmpty() || !(scheme.equals("https") || (scheme.equals("http") && isPrivateHost(host)))) return null;
            String clean = value.replaceAll("/+$", "");
            return clean;
        } catch (RuntimeException ignored) { return null; }
    }

    private boolean isPrivateHost(String host) {
        if (host.equals("10.0.2.2") || host.equals("127.0.0.1")) return true;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]); int second = Integer.parseInt(parts[1]);
            return first == 10 || (first == 192 && second == 168) || (first == 172 && second >= 16 && second <= 31);
        } catch (NumberFormatException ignored) { return false; }
    }

    private void showWebApp(String serverUrl) {
        root.removeAllViews();
        webView = new WebView(this);
        ProgressBar progress = new ProgressBar(this);
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(webView, webParams);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER);
        root.addView(progress, progressParams);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setBuiltInZoomControls(false); settings.setDisplayZoomControls(false);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST); }
                catch (ActivityNotFoundException error) { fileCallback = null; Toast.makeText(MainActivity.this, "Nenhum seletor de arquivos disponível.", Toast.LENGTH_LONG).show(); }
                return true;
            }
            @Override public void onProgressChanged(WebView view, int value) { progress.setVisibility(value >= 100 ? View.GONE : View.VISIBLE); }
        });
        Uri allowed = Uri.parse(serverUrl);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (allowed.getHost().equalsIgnoreCase(target.getHost()) && allowed.getScheme().equalsIgnoreCase(target.getScheme())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, target)); return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); showSetup("O certificado HTTPS não é válido."); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showSetup("Não foi possível acessar esta instalação. Confirme o endereço e a rede Wi-Fi.");
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            else Toast.makeText(this, "Use a versão Windows para baixar este arquivo.", Toast.LENGTH_LONG).show();
        });
        webView.loadUrl(serverUrl);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null;
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else if (webView != null) showSetup(null);
        else super.onBackPressed();
    }

    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading(); webView.loadUrl("about:blank"); webView.destroy(); webView = null;
    }
    @Override protected void onDestroy() { destroyWebView(); super.onDestroy(); }
}
