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
    private SuiteViews views;
    private AuthWebView authView;
    private AuthBridge bridge;
    private AuthController auth;
    private AppUpdater updater;
    private ValueCallback<Uri[]> fileCallback;
    private SharedPreferences preferences;
    private ConnectivityManager.NetworkCallback networkCallback;
    private long backgroundAt;
    private boolean suppressLock;
    private boolean centralMode;
    private String[] pushTarget; // destino do toque numa notificacao, aberto ao entrar

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        SystemBars.edgeToEdge(getWindow());
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(2, 24, 32));
        appLayer = new FrameLayout(this);
        appLayer.setBackgroundColor(navy);
        views = new SuiteViews(this, appLayer);
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
        updater = new AppUpdater(this, new AppUpdater.Host() {
            @Override public boolean canShowDialog() { return auth.unlocked() && !authVisible(); }
            @Override public void suppressLock() { suppressLock = true; }
            @Override public void toast(String message) { MainActivity.this.toast(message); }
        });
        String saved = preferences.getString(SERVER_URL, "");
        centralMode = !"local".equals(preferences.getString(MODE, saved.isEmpty() ? "central" : "local"));
        String linkReason = handleLink(getIntent());
        pushTarget = SuitePush.target(getIntent());
        if (!centralMode && linkReason == null) {
            if (saved.isEmpty()) showSetup(null); else showWebApp(SuiteViews.CENTRO_CUSTOS, saved, false);
        } else {
            centralMode = true;
            showAuth(linkReason != null ? linkReason : "start", null);
        }
        watchNetwork();
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    // ---- Telas de entrada locais ----
    private void showAuth(String reason, String notice) { showAuth(reason, notice, false); }
    /** fresh recarrega as telas, para nao sobrar nada da conta na memoria da pagina (ex.: e-mail digitado). */
    private void showAuth(String reason, String notice, boolean fresh) {
        auth.setReason(reason);
        if (authView != null && fresh) authView.reload();
        else if (authView == null) {
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
        String[] target = pushTarget;
        pushTarget = null;
        if (target != null) openApp(target[0], notice, target[1]);
        else openApp(views.activeApp() == null ? SuiteViews.CENTRO_CUSTOS : views.activeApp(), notice, null);
    }

    /** Abre (ou so mostra, sem recarregar) o app da Suite, no destino (proposta=/obra=) se houver; a 1a abertura entra pelo handoff. */
    private void openApp(String app, String notice, String fragment) {
        if (views.has(app)) { views.show(app); views.go(app, fragment); hideAuth(); toast(notice); updater.autoCheck(); return; }
        String start = SuiteViews.start(app);
        io.execute(() -> {
            String url = start + (fragment == null ? "" : "#" + fragment);
            boolean offline = false;
            try {
                String code = auth.handoffCode(app);
                if (code != null) url = start + "#handoff=" + Uri.encode(code) + (fragment == null ? "" : "&" + fragment);
            } catch (AuthController.SessionRejected rejected) {
                runOnUiThread(this::sessionRejected);
                return;
            } catch (IOException noNetwork) { offline = true; }
            auth.markEnteredOffline(offline);
            String target = url;
            runOnUiThread(() -> { showWebApp(app, target, true); hideAuth(); toast(notice); updater.autoCheck(); });
        });
    }

    @Override public void sessionExpired() { sessionRejected(); }
    @Override public void openSecurity() { showAuth("security", null); }
    @Override public void openTour() { showAuth("tour", null); }
    private void sessionRejected() {
        auth.sessionRevoked();
        dropApp();
        showAuth("start", "Sua sessão terminou. Entre com e-mail e senha.");
    }

    @Override public void closeOverlay() {
        if (!views.isEmpty()) { hideAuth(); updater.flush(); }
        else if (auth.unlocked()) enterApp(null);
    }

    @Override public void logout(boolean forget) {
        dropApp();
        if (forget) WebStorage.getInstance().deleteAllData();
        showAuth("start", null, forget);
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
        views.destroyAll();
        appLayer.removeAllViews(); // o armazenamento do site (fila offline) so e apagado ao esquecer o aparelho
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
    }

    @Override public boolean online() { return SystemBars.online(this); }

    private void toast(String message) {
        if (message != null && !message.isEmpty()) Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    /** App Links (so no fragmento): /redefinir-senha#t=<token> e /cadastro#convite=<token>. Devolve a tela ou null. */
    private String handleLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        String host = Uri.parse(BuildConfig.CENTRAL_API_BASE).getHost();
        String token = SystemBars.resetToken(data, host);
        if (token != null) { auth.setResetToken(token); return "reset"; }
        String invite = SystemBars.invite(data, host);
        if (invite == null) return null;
        auth.setInvite(invite);
        return "signup";
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String linkReason = handleLink(intent);
        if (linkReason != null) {
            if (!centralMode) { centralMode = true; preferences.edit().putString(MODE, "central").apply(); }
            showAuth(linkReason, null);
        } else if ((pushTarget = SuitePush.target(intent)) != null && auth.unlocked() && !authVisible()) {
            enterApp(null);
        }
    }

    private void showSetup(String error) {
        views.destroyAll();
        appLayer.removeAllViews();
        appLayer.addView(LocalSetup.build(this, preferences.getString(SERVER_URL, ""), error, new LocalSetup.Listener() {
            @Override public String connect(String rawUrl) {
                String normalized = LocalSetup.normalizeUrl(rawUrl);
                if (normalized == null) return "Use HTTPS ou um endereço privado da rede Wi-Fi.";
                preferences.edit().putString(SERVER_URL, normalized).putString(MODE, "local").apply();
                showWebApp(SuiteViews.CENTRO_CUSTOS, normalized, false);
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

    // ---- App web (remoto): nunca recebe a ponte AndroidAuth ----
    private void showWebApp(String app, String url, boolean central) {
        if (!central) { views.destroyAll(); appLayer.removeAllViews(); }
        WebView webView = new WebView(this);
        FrameLayout frame = views.create(app, webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setBuiltInZoomControls(false); settings.setDisplayZoomControls(false);
        AppWebView.attach(this, webView, frame, url, SuiteViews.ORCAMENTOS.equals(app) ? "Orçamentos" : "Centro de Custos", new AppWebView.Host() {
            @Override public boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                suppressLock = true;
                try { startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST); }
                catch (ActivityNotFoundException error) { fileCallback = null; suppressLock = false; toast("Nenhum seletor de arquivos disponível."); }
                return true;
            }
            @Override public void loadFailed(String message) {
                if (central) toast(message != null ? message : "Sem conexão com " + (SuiteViews.ORCAMENTOS.equals(app) ? "o Orçamentos" : "o Centro de Custos") + ". Tente de novo quando conectar.");
                else showSetup(message != null ? message : "Não foi possível acessar esta instalação. Confirme o endereço e a rede Wi-Fi.");
            }
            @Override public void message(String message) { toast(message); }
            @Override public void suiteLink(String action) {
                if (updater.handleLink(action, central && auth.unlocked())) return; // suite://atualizacao/instalar
                String[] other = action.startsWith("app/") ? SuiteViews.parse(action.substring(4)) : null; // suite://app/<id>?destino
                if (central && other != null && SuiteViews.known(other[0]) && auth.unlocked()) openApp(other[0], null, other[1]);
                else if (central && other == null && bridge != null) bridge.webAction(action);
            }
        });
        if (central) settings.setUserAgentString(settings.getUserAgentString() + " SuiteConstrutec/" + BuildConfig.VERSION_NAME + " SuiteBuild/" + BuildConfig.VERSION_CODE);
        webView.loadUrl(url);
    }

    @Override protected void onResume() { super.onResume(); updater.resume(); }
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
        boolean canLock = centralMode && !views.isEmpty() && auth.unlocked() && auth.vault.hasPin();
        if (canLock && away >= auth.vault.autoLockSeconds() * 1000L) {
            auth.lock();
            showAuth("lock", null);
        }
    }

    @Override public void onBackPressed() {
        if (authVisible()) {
            authView.back(handled -> {
                if ("true".equals(handled)) return;
                if (auth.unlocked() && !views.isEmpty()) hideAuth(); else moveTaskToBack(true);
            });
        } else if (views.active() != null && views.active().canGoBack()) {
            views.active().goBack();
        } else if (centralMode) {
            moveTaskToBack(true);
        } else if (!views.isEmpty()) {
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

    @Override protected void onDestroy() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager != null && networkCallback != null) manager.unregisterNetworkCallback(networkCallback);
        views.destroyAll();
        if (authView != null) authView.destroy();
        if (bridge != null) bridge.shutdown();
        io.shutdownNow();
        updater.destroy();
        super.onDestroy();
    }
}
