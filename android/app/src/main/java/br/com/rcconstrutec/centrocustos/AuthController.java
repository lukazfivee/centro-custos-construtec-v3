package br.com.rcconstrutec.centrocustos;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Arrays;

/**
 * Regras de sessao do app: login, PIN, biometria, redefinicao de senha e aparelhos.
 * Roda numa thread de fundo (AuthBridge). Nunca registra token, PIN, senha ou e-mail.
 */
final class AuthController {
    interface Shell {
        void enterApp(String notice);
        void closeOverlay();
        void logout(boolean forget);
        void openLocalSetup();
        void moveToBack();
        void dropApp();
        boolean online();
    }

    final SessionVault vault;
    final CentralApi api;
    private JSONObject pending;
    private JSONObject active;
    private byte[] activeKey;
    private volatile String reason = "start";
    private volatile String resetToken;
    private volatile boolean enteredOffline;

    AuthController(SessionVault vault, CentralApi api) { this.vault = vault; this.api = api; }

    synchronized boolean unlocked() { return active != null; }
    synchronized String activeToken() { return active == null ? null : active.optString("sessionToken", null); }
    synchronized boolean hasActiveKey() { return activeKey != null; }
    void setReason(String value) { reason = value; }
    void setResetToken(String token) { resetToken = token; }
    void markEnteredOffline(boolean offline) { enteredOffline = offline; }
    boolean enteredOffline() { return enteredOffline; }

    /** Bloqueio automatico: tira a sessao da memoria; volta com PIN ou digital. */
    synchronized void lock() {
        active = null;
        wipeKey();
    }

    synchronized void signOut(boolean forget) {
        active = null; pending = null;
        wipeKey();
        if (forget) vault.forgetAll();
    }

    /** A sessao foi recusada pelo servidor (401): apaga o blob, como pede o contrato. */
    synchronized void sessionRevoked() {
        active = null; pending = null;
        wipeKey();
        vault.wipePin(false);
    }

    private void wipeKey() {
        if (activeKey != null) Arrays.fill(activeKey, (byte) 0);
        activeKey = null;
    }

    synchronized JSONObject state(boolean bioAvailable, boolean online) throws JSONException {
        String profile = vault.profile();
        JSONObject out = ok()
            .put("reason", reason).put("hasPin", vault.hasPin()).put("hasSession", vault.hasPin())
            .put("pinLocked", vault.pinLocked()).put("bioEnabled", vault.hasBio()).put("bioAvailable", bioAvailable)
            .put("autoLock", vault.autoLockSeconds()).put("online", online)
            .put("profile", profile == null ? JSONObject.NULL : new JSONObject(profile));
        if (resetToken != null) { out.put("resetToken", resetToken); resetToken = null; }
        reason = "start";
        return out;
    }

    synchronized JSONObject login(String email, String password) throws JSONException {
        CentralApi.Response r;
        try { r = api.login(email, password); } catch (IOException offline) { return fail("OFFLINE"); }
        if (r.status == 401) return fail("INVALID_CREDENTIALS");
        if (r.status == 409) return fail("ACCOUNT_LEGACY");
        if (!r.ok()) return fail("SERVER_ERROR");
        JSONObject user = r.body.optJSONObject("user");
        JSONObject session = new JSONObject()
            .put("sessionToken", r.body.optString("sessionToken")).put("expiresAt", r.body.optLong("expiresAt"))
            .put("user", user == null ? new JSONObject() : user);
        if (user != null) vault.saveProfile(new JSONObject().put("name", user.optString("name")).put("email", user.optString("email")).toString());
        vault.clearLocked();
        if (vault.hasPin()) pending = session; else active = session;
        return ok().put("user", publicUser());
    }

    synchronized JSONObject createPin(String pin) throws JSONException, GeneralSecurityException {
        if (!validPin(pin)) return fail("PIN_WEAK");
        JSONObject session = pending != null ? pending : active;
        if (session == null) return fail("SESSION_INVALID");
        byte[] key = vault.createPin(pin, session.toString());
        wipeKey();
        activeKey = key; active = session; pending = null;
        return ok();
    }

    synchronized JSONObject checkPin(String pin) throws JSONException, GeneralSecurityException {
        SessionVault.Unlock u = vault.unlock(pin);
        if (u.locked) return fail("PIN_LOCKED");
        if (!u.ok()) return fail("PIN_WRONG").put("failures", u.failures);
        Arrays.fill(u.key, (byte) 0);
        return ok();
    }

    synchronized JSONObject unlockPin(String pin) throws JSONException, GeneralSecurityException {
        SessionVault.Unlock u = vault.unlock(pin);
        if (u.locked) { signOut(false); return fail("PIN_LOCKED"); }
        if (!u.ok()) return fail("PIN_WRONG").put("failures", u.failures);
        return adopt(u.key, u.session);
    }

    /** Depois do PIN ou da digital: usa a sessao guardada, ou guarda a nova se acabou de entrar por e-mail. */
    synchronized JSONObject adopt(byte[] key, String stored) throws JSONException, GeneralSecurityException {
        if (pending != null) {
            vault.store(key, pending.toString());
            active = pending; pending = null;
        } else {
            active = new JSONObject(stored);
        }
        wipeKey();
        activeKey = key;
        long expiresAt = active.optLong("expiresAt", 0);
        if (expiresAt > 0 && expiresAt * 1000L <= System.currentTimeMillis()) {
            sessionRevoked();
            return fail("SESSION_EXPIRED");
        }
        return ok().put("user", publicUser());
    }

    synchronized byte[] activeKeyCopy() { return activeKey == null ? null : activeKey.clone(); }

    synchronized JSONObject forgetPin() throws JSONException {
        vault.wipePin(false);
        wipeKey();
        return ok();
    }

    JSONObject resetRequest(String email) throws JSONException {
        try {
            CentralApi.Response r = api.resetRequest(email);
            if (r.status == 404) return fail("NOT_AVAILABLE");
            if (r.status == 202 || r.ok()) return ok();
            return fail(r.code());
        } catch (IOException offline) { return fail("OFFLINE"); }
    }

    JSONObject resetConfirm(String token, String password) throws JSONException {
        try {
            CentralApi.Response r = api.resetConfirm(token, password);
            if (r.status == 404) return fail("NOT_AVAILABLE");
            if (!r.ok()) return fail(r.code());
            // O servidor encerrou todas as sessoes, inclusive a deste aparelho.
            sessionRevoked();
            return ok().put("revokedSessions", r.body.optInt("revokedSessions", 0));
        } catch (IOException offline) { return fail("OFFLINE"); }
    }

    JSONObject sessions() throws JSONException {
        String token = activeToken();
        if (token == null) return fail("SESSION_INVALID");
        try {
            CentralApi.Response r = api.sessions(token);
            if (r.status == 404) return fail("FEATURE_UNAVAILABLE");
            if (!r.ok()) return fail(r.code());
            JSONArray list = r.body.optJSONArray("sessions");
            return ok().put("sessions", list == null ? new JSONArray() : list);
        } catch (IOException offline) { return fail("OFFLINE"); }
    }

    JSONObject revokeOthers() throws JSONException {
        String token = activeToken();
        if (token == null) return fail("SESSION_INVALID");
        try {
            CentralApi.Response r = api.revokeOthers(token);
            if (r.status == 404) return fail("FEATURE_UNAVAILABLE");
            if (!r.ok()) return fail(r.code());
            return ok().put("revoked", r.body.optInt("revoked", 0));
        } catch (IOException offline) { return fail("OFFLINE"); }
    }

    /** Pede o codigo de uso unico para o Centro de Custos web. Nulo se o servidor ainda nao tiver a rota. */
    String handoffCode() throws IOException, SessionRejected {
        String token = activeToken();
        if (token == null) return null;
        CentralApi.Response r = api.handoff(token);
        if (r.status == 401) throw new SessionRejected();
        return r.ok() ? r.body.optString("code", null) : null;
    }

    /** Valida a sessao quando a internet volta depois de entrar sem conexao. */
    void validateSession() throws IOException, SessionRejected {
        String token = activeToken();
        if (token == null) return;
        CentralApi.Response r = api.session(token);
        if (r.status == 401) throw new SessionRejected();
        enteredOffline = false;
    }

    static final class SessionRejected extends Exception {}

    private JSONObject publicUser() throws JSONException {
        JSONObject session = active != null ? active : pending;
        JSONObject user = session == null ? null : session.optJSONObject("user");
        if (user == null) return new JSONObject();
        return new JSONObject().put("name", user.optString("name")).put("email", user.optString("email"));
    }

    static boolean validPin(String pin) {
        if (pin == null || !pin.matches("\\d{6}")) return false;
        if (pin.matches("(\\d)\\1{5}")) return false;
        return !"0123456789".contains(pin) && !"9876543210".contains(pin);
    }

    static JSONObject ok() throws JSONException { return new JSONObject().put("ok", true); }
    static JSONObject fail(String code) throws JSONException { return new JSONObject().put("ok", false).put("code", code == null || code.isEmpty() ? "SERVER_ERROR" : code); }
}
