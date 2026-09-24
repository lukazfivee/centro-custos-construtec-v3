package br.com.rcconstrutec.centrocustos;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;

/** Chamadas ao diretorio central (docs/suite-mobile/04-CONTRATO-API.md), feitas pelo lado nativo. */
final class CentralApi {
    static final class Response {
        final int status; final JSONObject body;
        Response(int status, JSONObject body) { this.status = status; this.body = body; }
        boolean ok() { return status >= 200 && status < 300 && body.optBoolean("ok", false); }
        String code() { return body.optString("code", status >= 500 ? "SERVER_ERROR" : ""); }
    }

    private final String base;
    private final String instanceId;
    private final String instanceName;
    private final String client;

    CentralApi(Context context) {
        base = BuildConfig.CENTRAL_API_BASE.replaceAll("/+$", "");
        SharedPreferences prefs = context.getSharedPreferences("suite_device", Context.MODE_PRIVATE);
        String id = prefs.getString("instance_id", null);
        if (id == null) { id = UUID.randomUUID().toString(); prefs.edit().putString("instance_id", id).apply(); }
        instanceId = id;
        instanceName = "Android · " + capitalize(Build.MANUFACTURER) + " " + Build.MODEL;
        client = "suite-android/" + BuildConfig.VERSION_NAME;
    }

    String base() { return base; }

    Response login(String email, String password) throws IOException {
        return send("POST", "/v1/auth/login", json("email", email, "password", password), null);
    }
    Response session(String token) throws IOException { return send("GET", "/v1/auth/session", null, token); }
    Response resetRequest(String email) throws IOException { return send("POST", "/v1/auth/password-reset/request", json("email", email), null); }
    Response resetConfirm(String token, String password) throws IOException {
        return send("POST", "/v1/auth/password-reset/confirm", json("token", token, "password", password), null);
    }
    Response sessions(String token) throws IOException { return send("GET", "/v1/auth/sessions", null, token); }
    Response revokeOthers(String token) throws IOException { return send("POST", "/v1/auth/sessions/revoke-others", new JSONObject(), token); }
    Response handoff(String token) throws IOException { return send("POST", "/v1/auth/handoff", json("target", "centro-custos"), token); }

    private Response send(String method, String path, JSONObject body, String bearer) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("x-instance-id", instanceId);
            conn.setRequestProperty("x-instance-name", instanceName);
            conn.setRequestProperty("x-client", client);
            if (bearer != null) conn.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = conn.getOutputStream()) { out.write(bytes); }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            return new Response(status, parse(in));
        } finally {
            conn.disconnect();
        }
    }

    private static JSONObject parse(InputStream in) throws IOException {
        if (in == null) return new JSONObject();
        try (InputStream stream = in) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = stream.read(chunk)) != -1 && buffer.size() < 256 * 1024) buffer.write(chunk, 0, read);
            String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8).trim();
            return text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (JSONException notJson) {
            return new JSONObject();
        }
    }

    static JSONObject json(String... pairs) {
        JSONObject out = new JSONObject();
        try { for (int i = 0; i + 1 < pairs.length; i += 2) out.put(pairs[i], pairs[i + 1]); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        return out;
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) return "";
        return value.substring(0, 1).toUpperCase(Locale.ROOT) + value.substring(1);
    }
}
