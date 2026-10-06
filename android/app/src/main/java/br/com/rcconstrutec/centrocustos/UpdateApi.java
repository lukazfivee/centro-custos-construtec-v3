package br.com.rcconstrutec.centrocustos;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Rede da atualizacao: le a versao mais nova (GET /v1/app/android/latest) e baixa o APK conferindo o SHA-256. */
final class UpdateApi {
    /** Falha com mensagem pronta para a pessoa; erros de rede ficam como IOException comum. */
    static final class Failure extends IOException {
        Failure(String message) { super(message); }
    }

    static final class Latest {
        String versionName = "";
        long versionCode;
        long minVersionCode;
        String apkUrl = "";
        String sha256 = "";
        String notes = "";
        long size;
    }

    interface Progress {
        void update(long done, long total);
        boolean cancelled();
    }

    private UpdateApi() {}

    static Latest fetchLatest(String apiBase, String client) throws IOException {
        HttpURLConnection conn = open(apiBase + "/v1/app/android/latest", client, "application/json", 10000, 15000);
        try {
            int status = conn.getResponseCode();
            if (status >= 500) throw new Failure("O servidor de atualização está indisponível agora. Tente de novo em alguns minutos.");
            if (status != 200) throw new Failure("Não foi possível consultar a versão mais nova (código " + status + ").");
            JSONObject body = new JSONObject(readText(conn.getInputStream()));
            Latest out = new Latest();
            out.versionName = body.optString("versionName", "");
            out.versionCode = body.optLong("versionCode", 0);
            out.minVersionCode = body.optLong("minVersionCode", 0);
            out.apkUrl = body.optString("apkUrl", "");
            out.sha256 = body.optString("sha256", "");
            out.notes = body.optString("notes", "");
            out.size = body.optLong("size", 0);
            if (!body.optBoolean("ok", false) || out.versionCode <= 0 || out.versionName.isEmpty()
                    || !UpdatePolicy.isSha256(out.sha256) || !UpdatePolicy.isTrustedApkUrl(out.apkUrl, apiBase)) {
                throw new Failure("A resposta do servidor de atualização não é válida.");
            }
            return out;
        } catch (JSONException invalid) {
            throw new Failure("A resposta do servidor de atualização não é válida.");
        } finally {
            conn.disconnect();
        }
    }

    /** Baixa para target (arquivo .part), conferindo tamanho e hash. Devolve apos o hash bater; senao apaga e falha. */
    static void download(Latest latest, String client, File target, Progress progress) throws IOException {
        HttpURLConnection conn = open(latest.apkUrl, client, "application/vnd.android.package-archive", 15000, 30000);
        try {
            int status = conn.getResponseCode();
            if (status != 200) throw new Failure("O servidor não entregou o aplicativo (código " + status + "). Tente de novo.");
            long total = conn.getContentLengthLong();
            if (total <= 0) total = latest.size;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long done = 0;
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(target)) {
                byte[] chunk = new byte[16384];
                int read;
                while ((read = in.read(chunk)) != -1) {
                    if (progress.cancelled()) throw new Failure("Download cancelado.");
                    out.write(chunk, 0, read);
                    digest.update(chunk, 0, read);
                    done += read;
                    progress.update(done, total);
                }
            }
            if (done == 0 || (total > 0 && done != total)) throw new Failure("O download foi interrompido antes de terminar. Tente de novo.");
            if (!UpdatePolicy.sameHash(latest.sha256, UpdatePolicy.hex(digest.digest()))) {
                throw new Failure("O arquivo baixado não passou na verificação de segurança e não será instalado. Tente de novo.");
            }
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        } catch (IOException | RuntimeException error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw error;
        } finally {
            conn.disconnect();
        }
    }

    private static HttpURLConnection open(String url, String client, String accept, int connectMs, int readMs) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(connectMs);
        conn.setReadTimeout(readMs);
        conn.setUseCaches(false);
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("Accept", accept);
        conn.setRequestProperty("Accept-Encoding", "identity"); // o tamanho confere com o arquivo, sem compressao no meio
        conn.setRequestProperty("x-client", client);
        return conn;
    }

    private static String readText(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = stream.read(chunk)) != -1 && buffer.size() < 256 * 1024) buffer.write(chunk, 0, read);
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
