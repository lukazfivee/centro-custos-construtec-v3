package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.Settings;

import java.io.File;
import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Atualizacao do app por dentro do app: consulta a versao mais nova no Worker (no maximo 1 vez a cada 6 h,
 * mais o botao manual do Menu), avisa, baixa o APK para o cache, confere o SHA-256 e abre o instalador do
 * Android. O APK e assinado pela mesma chave fixa da CI, entao o Android aceita como atualizacao.
 * O aviso nunca aparece por cima da tela de PIN: espera o desbloqueio (flush).
 */
final class AppUpdater {
    interface Host {
        /** Falso enquanto a tela de entrada/PIN esta visivel. */
        boolean canShowDialog();
        /** Vai para as configuracoes do Android: nao bloquear pelo PIN so por causa da ida e volta. */
        void suppressLock();
        void toast(String message);
    }

    private static final String PREFS = "suite_update";
    private static final String LAST_CHECK = "last_check_at";
    private static final String FILE_PREFIX = "suite-construtec-";

    private final Activity activity;
    private final Host host;
    private final SharedPreferences prefs;
    private final String apiBase = BuildConfig.CENTRAL_API_BASE.replaceAll("/+$", "");
    private final String client = "suite-android/" + BuildConfig.VERSION_NAME;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private AlertDialog dialog;
    private UpdateApi.Latest pending;            // versao nova achada enquanto o PIN estava aberto
    private UpdateApi.Latest awaitingPermission; // foi para "Instalar apps desconhecidos"
    private File ready;                          // APK baixado e conferido, esperando o desbloqueio
    private boolean busy;
    private boolean destroyed;
    private volatile boolean cancelled;

    AppUpdater(Activity activity, Host host) {
        this.activity = activity;
        this.host = host;
        this.prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    // ---- Pontos de entrada ----

    /** Ao entrar no app: consulta no maximo a cada 6 h; fora do intervalo so mostra o que ficou pendente. */
    void autoCheck() {
        if (busy) return;
        if (UpdatePolicy.shouldAutoCheck(prefs.getLong(LAST_CHECK, 0), System.currentTimeMillis())) check(false, false);
        else flush();
    }

    /** suite://atualizacao/instalar e /verificar, do Menu do site do celular. Devolve true se o link era da atualizacao. */
    boolean handleLink(String action, boolean allowed) {
        if (!action.startsWith("atualizacao/")) return false;
        if (!allowed) return true;
        if (action.endsWith("/instalar")) installFromMenu();
        else if (action.endsWith("/verificar")) checkManually();
        return true;
    }

    /** Botao manual: sempre consulta e diz o resultado. */
    void checkManually() {
        if (busy) return;
        host.toast("Verificando atualização...");
        check(true, false);
    }

    /** "Atualizar agora" do Menu: a pessoa ja decidiu, vai direto para permissao e download. */
    void installFromMenu() {
        if (busy) return;
        if (ready != null && ready.isFile()) { installWhenAllowed(); return; }
        host.toast("Procurando a versão mais nova...");
        check(true, true);
    }

    /** Depois do desbloqueio: mostra o aviso ou abre o instalador que ficaram esperando. */
    void flush() {
        if (!host.canShowDialog() || busy) return;
        if (ready != null) installWhenAllowed();
        else if (pending != null) offer(pending);
    }

    /** Volta de "Instalar apps desconhecidos": se a permissao foi dada, segue com o download. */
    void resume() {
        UpdateApi.Latest latest = awaitingPermission;
        if (latest == null) return;
        awaitingPermission = null;
        if (canInstall()) download(latest);
        else host.toast("Sem a permissão, a atualização não pode ser instalada.");
    }

    void destroy() {
        destroyed = true;
        cancelled = true;
        if (dialog != null) dialog.dismiss();
        worker.shutdownNow();
    }

    // ---- Consulta ----

    private void check(boolean manual, boolean direct) {
        busy = true;
        worker.execute(() -> {
            cleanCache();
            try {
                UpdateApi.Latest latest = UpdateApi.fetchLatest(apiBase, client);
                prefs.edit().putLong(LAST_CHECK, System.currentTimeMillis()).apply();
                ui(() -> { busy = false; found(latest, manual, direct); });
            } catch (IOException error) {
                ui(() -> {
                    busy = false;
                    if (manual) showError(explain(error), () -> check(manual, direct));
                });
            }
        });
    }

    private void found(UpdateApi.Latest latest, boolean manual, boolean direct) {
        if (!UpdatePolicy.isNewer(BuildConfig.VERSION_CODE, latest.versionCode)) {
            pending = null;
            if (manual) host.toast("Você já está na versão mais recente (" + BuildConfig.VERSION_NAME + ").");
            return;
        }
        if (direct) startInstall(latest);
        else offer(latest);
    }

    private void offer(UpdateApi.Latest latest) {
        if (!host.canShowDialog()) { pending = latest; return; }
        pending = null;
        boolean required = UpdatePolicy.isRequired(BuildConfig.VERSION_CODE, latest.minVersionCode);
        String notes = UpdatePolicy.shortNotes(latest.notes, 600);
        String message = "Você está na versão " + BuildConfig.VERSION_NAME + "." + (notes.isEmpty() ? "" : "\n\n" + notes)
                + (latest.size > 0 ? "\n\nTamanho: " + UpdatePolicy.megabytes(latest.size) : "");
        show(UpdateDialogs.message(activity, "Nova versão " + latest.versionName + " disponível", message,
                "Atualizar agora", () -> startInstall(latest), required ? null : "Depois", null, !required));
    }

    // ---- Permissao, download e instalacao ----

    private boolean canInstall() { return activity.getPackageManager().canRequestPackageInstalls(); }

    private void startInstall(UpdateApi.Latest latest) {
        if (canInstall()) { download(latest); return; }
        show(UpdateDialogs.message(activity, "Permitir a instalação",
                "Para atualizar, o Android precisa da sua permissão para este aplicativo instalar a nova versão.\n\n"
                        + "Toque em \"Abrir configurações\", ative \"Permitir desta fonte\" e volte para o aplicativo: a atualização continua sozinha.",
                "Abrir configurações", () -> openInstallSettings(latest), "Agora não", null, true));
    }

    private void openInstallSettings(UpdateApi.Latest latest) {
        awaitingPermission = latest;
        host.suppressLock();
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
        try { activity.startActivity(intent); }
        catch (ActivityNotFoundException missing) {
            try { activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)); }
            catch (ActivityNotFoundException none) { awaitingPermission = null; host.toast("Abra as configurações do Android e permita instalar apps deste aplicativo."); }
        }
    }

    private void download(UpdateApi.Latest latest) {
        busy = true;
        cancelled = false;
        UpdateDialogs.ProgressUi progress = UpdateDialogs.progress(activity, "Baixando a versão " + latest.versionName, () -> cancelled = true);
        show(progress.dialog);
        File dir = UpdateFileProvider.dir(activity);
        File part = new File(dir, FILE_PREFIX + latest.versionCode + ".apk.part");
        File apk = new File(dir, FILE_PREFIX + latest.versionCode + ".apk");
        worker.execute(() -> {
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new UpdateApi.Failure("Não foi possível preparar o armazenamento do aplicativo.");
                UpdateApi.download(latest, client, part, new UpdateApi.Progress() {
                    private long last;
                    @Override public void update(long done, long total) {
                        long now = SystemClock.uptimeMillis();
                        if (now - last < 150 && done != total) return;
                        last = now;
                        ui(() -> progress.set(done, total));
                    }
                    @Override public boolean cancelled() { return cancelled; }
                });
                ui(progress::verifying);
                if (!part.renameTo(apk)) throw new UpdateApi.Failure("Não foi possível guardar o arquivo baixado.");
                ui(() -> { busy = false; progress.dialog.dismiss(); ready = apk; installWhenAllowed(); });
            } catch (IOException error) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                ui(() -> {
                    busy = false;
                    progress.dialog.dismiss();
                    if (!cancelled) showError(explain(error), () -> download(latest));
                });
            }
        });
    }

    /** Abre o instalador do Android; atras da tela de PIN espera o desbloqueio. */
    private void installWhenAllowed() {
        File apk = ready;
        if (apk == null || !apk.isFile()) { ready = null; return; }
        if (!host.canShowDialog()) return;
        ready = null;
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(UpdateFileProvider.uriFor(activity, apk), UpdateFileProvider.MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { activity.startActivity(intent); }
        catch (ActivityNotFoundException | SecurityException error) {
            ready = apk;
            showError("Não foi possível abrir o instalador do Android.", this::installWhenAllowed);
        }
    }

    // ---- Apoio ----

    private void showError(String message, Runnable retry) {
        show(UpdateDialogs.message(activity, "Atualização do aplicativo", message, "Tentar de novo", retry, "Fechar", null, true));
    }

    private static String explain(IOException error) {
        if (error instanceof UpdateApi.Failure) return error.getMessage();
        if (error instanceof UnknownHostException || error instanceof ConnectException || error instanceof SocketTimeoutException || error instanceof SocketException) {
            return "Sem conexão com a internet. Verifique o Wi-Fi ou os dados móveis e tente de novo.";
        }
        String text = String.valueOf(error.getMessage());
        if (text.contains("ENOSPC") || text.toLowerCase(java.util.Locale.ROOT).contains("no space")) return "Não há espaço livre no celular para baixar a atualização.";
        return "O download foi interrompido. Verifique a internet e tente de novo.";
    }

    private void show(AlertDialog next) {
        if (destroyed || activity.isFinishing() || activity.isDestroyed()) return;
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        dialog = next;
        next.show();
    }

    private void ui(Runnable action) {
        activity.runOnUiThread(() -> { if (!destroyed) action.run(); });
    }

    /** Apaga downloads incompletos e APKs de versoes que ja estao instaladas. */
    private void cleanCache() {
        File[] files = UpdateFileProvider.dir(activity).listFiles();
        if (files == null) return;
        for (File file : files) {
            String name = file.getName();
            boolean stale = name.endsWith(".part");
            if (!stale && name.startsWith(FILE_PREFIX) && name.endsWith(".apk")) {
                try { stale = Long.parseLong(name.substring(FILE_PREFIX.length(), name.length() - 4)) <= BuildConfig.VERSION_CODE; }
                catch (NumberFormatException odd) { stale = true; }
            }
            //noinspection ResultOfMethodCallIgnored
            if (stale) file.delete();
        }
    }
}
