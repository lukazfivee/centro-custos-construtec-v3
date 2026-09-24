package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;

/**
 * Ponte JavaScript das telas locais. So responde quando a pagina carregada e a dos assets
 * (AuthWebView.trusted); paginas remotas usam outra WebView, sem esta ponte.
 */
final class AuthBridge {
    private final Activity activity;
    private final AuthWebView host;
    private final AuthController auth;
    private final AuthController.Shell shell;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    AuthBridge(Activity activity, AuthWebView host, AuthController auth, AuthController.Shell shell) {
        this.activity = activity; this.host = host; this.auth = auth; this.shell = shell;
    }

    @JavascriptInterface
    public void call(String id, String method, String argsJson) {
        if (!host.trusted() || id == null || method == null) return;
        worker.execute(() -> {
            JSONObject args;
            try { args = new JSONObject(argsJson == null ? "{}" : argsJson); } catch (JSONException bad) { args = new JSONObject(); }
            try {
                JSONObject result = dispatch(id, method, args);
                if (result != null) reply(id, result);
            } catch (Exception error) {
                reply(id, fail("SERVER_ERROR"));
            }
        });
    }

    /** Devolve null quando a resposta sai depois (biometria). */
    private JSONObject dispatch(String id, String method, JSONObject a) throws Exception {
        switch (method) {
            case "state": return auth.state(BiometricGate.available(activity), shell.online());
            case "login": return auth.login(a.optString("email").trim(), a.optString("password"));
            case "createPin": return auth.createPin(a.optString("pin"));
            case "checkPin": return auth.checkPin(a.optString("pin"));
            case "unlockPin": return auth.unlockPin(a.optString("pin"));
            case "forgetPin": return auth.forgetPin();
            case "bioEnroll": bioEnroll(id); return null;
            case "bioUnlock": bioUnlock(id); return null;
            case "bioDisable": auth.vault.deleteBio(); return AuthController.ok();
            case "resetRequest": return auth.resetRequest(a.optString("email").trim());
            case "resetConfirm": {
                JSONObject result = auth.resetConfirm(a.optString("token"), a.optString("password"));
                if (result.optBoolean("ok")) ui(shell::dropApp);
                return result;
            }
            case "sessions": return auth.sessions();
            case "revokeOthers": {
                // O handoff cria uma sessao "Centro de Custos web" neste aparelho; ela tambem cai, entao o site reabre com handoff novo.
                JSONObject result = auth.revokeOthers();
                if (result.optBoolean("ok")) ui(shell::dropApp);
                return result;
            }
            case "setAutoLock": auth.vault.setAutoLockSeconds(Math.max(0, a.optInt("seconds", 300))); return AuthController.ok();
            case "enterApp": {
                String notice = a.optString("notice", "");
                if (auth.unlocked()) ui(() -> shell.enterApp(notice));
                return auth.unlocked() ? AuthController.ok() : fail("SESSION_INVALID");
            }
            case "close": if (auth.unlocked()) ui(shell::closeOverlay); return AuthController.ok();
            case "logout": {
                boolean forget = a.optBoolean("forget", false);
                auth.signOut(forget);
                ui(() -> shell.logout(forget));
                return AuthController.ok();
            }
            case "moveToBack": ui(shell::moveToBack); return AuthController.ok();
            case "openLocalSetup": ui(shell::openLocalSetup); return AuthController.ok();
            default: return fail("UNKNOWN_METHOD");
        }
    }

    private void bioEnroll(String id) throws Exception {
        byte[] key = auth.activeKeyCopy();
        if (key == null || !auth.vault.hasPin()) { reply(id, fail("SESSION_INVALID")); return; }
        if (!BiometricGate.available(activity)) { reply(id, fail("BIO_UNAVAILABLE")); return; }
        Cipher cipher = auth.vault.bioEncryptCipher();
        ui(() -> BiometricGate.authenticate(activity, cipher, "Ativar a digital", "Confirme para entrar mais rápido na Suíte Construtec", (authorized, code) -> worker.execute(() -> {
            try {
                if (authorized == null) { reply(id, fail(code)); return; }
                auth.vault.saveBio(authorized, key);
                reply(id, AuthController.ok());
            } catch (Exception error) {
                auth.vault.deleteBio();
                reply(id, fail("BIO_ERROR"));
            } finally {
                java.util.Arrays.fill(key, (byte) 0);
            }
        })));
    }

    private void bioUnlock(String id) throws Exception {
        if (!auth.vault.hasBio()) { reply(id, fail("BIO_UNAVAILABLE")); return; }
        Cipher cipher;
        try {
            cipher = auth.vault.bioDecryptCipher();
        } catch (KeyPermanentlyInvalidatedException changed) {
            auth.vault.deleteBio();
            reply(id, fail("BIO_INVALIDATED"));
            return;
        }
        final Cipher ready = cipher;
        ui(() -> BiometricGate.authenticate(activity, ready,"Entrar na Suíte Construtec", "Use a digital cadastrada neste aparelho", (authorized, code) -> worker.execute(() -> {
            try {
                if (authorized == null) { reply(id, fail(code)); return; }
                byte[] key = auth.vault.readBio(authorized);
                String session = auth.vault.unlockWithKey(key);
                if (session == null) { auth.vault.deleteBio(); reply(id, fail("BIO_INVALIDATED")); return; }
                reply(id, auth.adopt(key, session));
            } catch (Exception error) {
                reply(id, fail("BIO_ERROR"));
            }
        })));
    }

    private void reply(String id, JSONObject result) {
        String script = "window.__nativeReply&&window.__nativeReply(" + JSONObject.quote(id) + "," + result.toString() + ")";
        ui(() -> host.evaluate(script));
    }

    private void ui(Runnable task) { activity.runOnUiThread(task); }

    private static JSONObject fail(String code) {
        try { return AuthController.fail(code); } catch (JSONException impossible) { return new JSONObject(); }
    }

    void shutdown() { worker.shutdownNow(); }
}
