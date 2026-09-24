package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Shell da Suite: telas de entrada locais (AuthWebView) por cima do app web (WebView remota, sem ponte). */
public final class MainActivity extends Activity implements AuthController.Shell {
    private static final int FILE_CHOOSER_REQUEST = 42;
    private static final String PREFS = "centro_custos_android";
    private static final String SERVER_URL = "server_url";
    private static final String MODE = "mode";
    private final int navy = Color.rgb(2, 29, 38);
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private FrameLayout appLayer;
    private WebView webView;
    private AuthWebView authView;
    private AuthBridge bridge;
    private AuthController auth;
    private ValueCallback<Uri[]> fileCallback;
    private SharedPreferences preferences;
    private ConnectivityManager.NetworkCallback networkCallback;
    private long backgroundAt;
    private boolean suppressLock;
    private boolean centralMode;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        SystemBars.edgeToEdge(getWindow());
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(2, 24, 32));
        appLayer = new FrameLayout(this);
        appLayer.setBackgroundColor(navy);
        root.addView(appLayer, match());
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            SystemBars.Insets bars = SystemBars.read(insets);
            appLayer.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, bars.ime));
            if (authView != null) {
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) authView.view().getLayoutParams();
                lp.bottomMargin = bars.ime > bars.bottom ? bars.ime : 0;
                authView.view().setLayoutParams(lp);
            }
            pushInsets(bars);
            return insets;
        });
        setContentView(root);
        auth = new AuthController(new SessionVault(this), new CentralApi(this));
        String saved = preferences.getString(SERVER_URL, "");
        centralMode = !"local".equals(preferences.getString(MODE, saved.isEmpty() ? "central" : "local"));
        boolean resetLink = handleLink(getIntent());
        if (!centralMode && !resetLink) {
            if (saved.isEmpty()) showSetup(null); else showWebApp(saved, false);
        } else {
            centralMode = true;
            showAuth(resetLink ? "reset" : "start", null);
        }
        watchNetwork();
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    // ---- Telas de entrada locais ----

    private void showAuth(String reason, String notice) {
        auth.setReason(reason);
        if (authView == null) {
            authView = new AuthWebView(this);
            bridge = new AuthBridge(this, authView, auth, this);
            authView.attachBridge(bridge);
            root.addView(authView.view(), match());
            authView.load(() -> root.requestApplyInsets());
        } else if (authView.loaded()) {
            authView.event("show", "{\"reason\":" + JSONObject.quote(reason) + ",\"notice\":" + JSONObject.quote(notice == null ? "" : notice) + "}");
        }
        authView.view().setVisibility(View.VISIBLE);
        authView.view().bringToFront();
        authView.view().requestFocus();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    private void hideAuth() {
        if (authView != null) authView.view().setVisibility(View.GONE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    private boolean authVisible() { return authView != null && authView.view().getVisibility() == View.VISIBLE; }

    private void pushInsets(SystemBars.Insets bars) {
        if (authView == null || !authView.loaded()) return;
        float density = getResources().getDisplayMetrics().density;
        int bottom = bars.ime > bars.bottom ? 0 : bars.bottom;
        authView.evaluate("window.__setInsets&&window.__setInsets(" + Math.round(bars.top / density) + "," + Math.round(bottom / density) + ")");
    }

    @Override public void enterApp(String notice) {
        if (webView != null) { hideAuth(); toast(notice); return; }
        String base = BuildConfig.CENTRAL_WEB_BASE.replaceAll("/+$", "");
        io.execute(() -> {
            String url = base + "/";
            boolean offline = false;
            try {
                String code = auth.handoffCode();
                if (code != null) url = base + "/#handoff=" + Uri.encode(code);
            } catch (AuthController.SessionRejected rejected) {
                runOnUiThread(this::sessionRejected);
                return;
            } catch (IOException noNetwork) {
                offline = true;
            }
            auth.markEnteredOffline(offline);
            String target = url;
            runOnUiThread(() -> { showWebApp(target, true); hideAuth(); toast(notice); });
        });
    }

    private void sessionRejected() {
        auth.sessionRevoked();
        dropApp();
        showAuth("start", "Sua sessão terminou. Entre com e-mail e senha.");
    }

    @Override public void closeOverlay() { if (webView != null) hideAuth(); }

    @Override public void logout(boolean forget) {
        dropApp();
        showAuth("start", forget ? "Este aparelho foi esquecido" : null);
    }

    @Override public void openLocalSetup() {
        preferences.edit().putString(MODE, "local").apply();
        centralMode = false;
        auth.signOut(false);
        dropApp();
        hideAuth();
        showSetup(null);
    }

    @Override public void moveToBack() { moveTaskToBack(true); }

    @Override public void dropApp() {
        destroyWebView();
        appLayer.removeAllViews();
        WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
    }

    @Override public boolean online() { return SystemBars.online(this); }

    private void toast(String message) {
        if (message != null && !message.isEmpty()) Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    /** App Link https://<base>/redefinir-senha#t=<token>: o token so vem no fragmento. */
    private boolean handleLink(Intent intent) {
        String token = SystemBars.resetToken(intent == null ? null : intent.getData(), Uri.parse(BuildConfig.CENTRAL_API_BASE).getHost());
        if (token == null) return false;
        auth.setResetToken(token);
        return true;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (handleLink(intent)) {
            if (!centralMode) { centralMode = true; preferences.edit().putString(MODE, "central").apply(); }
            showAuth("reset", null);
        }
    }

    // ---- Servidor local (instalacao Windows) ----

    private void showSetup(String error) {
        destroyWebView();
        appLayer.removeAllViews();
        appLayer.addView(LocalSetup.build(this, preferences.getString(SERVER_URL, ""), error, new LocalSetup.Listener() {
            @Override public String connect(String rawUrl) {
                String normalized = normalizeUrl(rawUrl);
                if (normalized == null) return "Use HTTPS ou um endereço privado da rede Wi-Fi.";
                preferences.edit().putString(SERVER_URL, normalized).putString(MODE, "local").apply();
                showWebApp(normalized, false);
                return null;
            }
            @Override public void useCentral() {
                preferences.edit().putString(MODE, "central").apply();
                centralMode = true;
                appLayer.removeAllViews();
                showAuth("start", null);
            }
        }), match());
    }

    private String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = URI.create(value);
            String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
            String host = String.valueOf(uri.getHost()).toLowerCase(Locale.ROOT);
            if (host.isEmpty() || !(scheme.equals("https") || (scheme.equals("http") && isPrivateHost(host)))) return null;
            return value.replaceAll("/+$", "");
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

    // ---- App web (remoto): nunca recebe a ponte AndroidAuth ----

    private void showWebApp(String url, boolean central) {
        destroyWebView();
        appLayer.removeAllViews();
        webView = new WebView(this);
        appLayer.addView(webView, match());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setBuiltInZoomControls(false); settings.setDisplayZoomControls(false);
        AppWebView.attach(this, webView, appLayer, url, new AppWebView.Host() {
            @Override public boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                suppressLock = true;
                try { startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST); }
                catch (ActivityNotFoundException error) { fileCallback = null; suppressLock = false; toast("Nenhum seletor de arquivos disponível."); }
                return true;
            }
            @Override public void loadFailed(String message) {
                if (central) toast(message != null ? message : "Sem conexão com o Centro de Custos. Tente de novo quando conectar.");
                else showSetup(message != null ? message : "Não foi possível acessar esta instalação. Confirme o endereço e a rede Wi-Fi.");
            }
            @Override public void message(String message) { toast(message); }
        });
        if (central) AppWebView.addMenuButton(this, appLayer, v -> showAuth("menu", null));
        webView.loadUrl(url);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null;
    }

    // ---- Bloqueio automatico, voltar e rede ----

    @Override protected void onStop() {
        super.onStop();
        backgroundAt = SystemClock.elapsedRealtime();
    }

    @Override protected void onStart() {
        super.onStart();
        if (backgroundAt == 0) return;
        long away = SystemClock.elapsedRealtime() - backgroundAt;
        backgroundAt = 0;
        if (suppressLock) { suppressLock = false; return; }
        boolean canLock = centralMode && webView != null && auth.unlocked() && auth.vault.hasPin();
        if (canLock && away >= auth.vault.autoLockSeconds() * 1000L) {
            auth.lock();
            showAuth("lock", null);
        }
    }

    @Override public void onBackPressed() {
        if (authVisible()) {
            authView.back(handled -> {
                if ("true".equals(handled)) return;
                if (auth.unlocked() && webView != null) hideAuth(); else moveTaskToBack(true);
            });
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else if (centralMode) {
            moveTaskToBack(true);
        } else if (webView != null) {
            showSetup(null);
        } else {
            super.onBackPressed();
        }
    }

    /** Entrou sem internet: valida a sessao quando a conexao voltar (contrato, secao 2). */
    private void watchNetwork() {
        networkCallback = SystemBars.onNetwork(this, () -> {
            if (!auth.enteredOffline() || !auth.unlocked()) return;
            io.execute(() -> {
                try { auth.validateSession(); }
                catch (AuthController.SessionRejected rejected) { runOnUiThread(this::sessionRejected); }
                catch (IOException stillOffline) { /* tenta na proxima conexao */ }
            });
        });
    }

    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading(); webView.loadUrl("about:blank"); webView.destroy(); webView = null;
    }

    @Override protected void onDestroy() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager != null && networkCallback != null) manager.unregisterNetworkCallback(networkCallback);
        destroyWebView();
        if (authView != null) authView.destroy();
        if (bridge != null) bridge.shutdown();
        io.shutdownNow();
        super.onDestroy();
    }
}
