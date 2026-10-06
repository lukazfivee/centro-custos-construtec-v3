package br.com.rcconstrutec.centrocustos;

import java.util.Locale;

/** Regras puras da atualizacao do app (sem Android): quando consultar, se ha versao nova, hash e endereco confiaveis. */
final class UpdatePolicy {
    /** Consulta automatica no maximo uma vez a cada 6 horas. */
    static final long CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L;

    private UpdatePolicy() {}

    /** lastCheckAt = 0 significa que nunca consultou; relogio que voltou no tempo tambem libera a consulta. */
    static boolean shouldAutoCheck(long lastCheckAt, long now) {
        return lastCheckAt <= 0 || now < lastCheckAt || now - lastCheckAt >= CHECK_INTERVAL_MS;
    }

    static boolean isNewer(long installedCode, long remoteCode) {
        return remoteCode > installedCode;
    }

    /** minVersionCode (opcional, 0 = nao exige) maior que o instalado: a atualizacao e obrigatoria. */
    static boolean isRequired(long installedCode, long minVersionCode) {
        return minVersionCode > 0 && minVersionCode > installedCode;
    }

    static boolean isSha256(String value) {
        return value != null && value.matches("[0-9a-fA-F]{64}");
    }

    static boolean sameHash(String expected, String actual) {
        return isSha256(expected) && actual != null && expected.trim().toLowerCase(Locale.ROOT).equals(actual.trim().toLowerCase(Locale.ROOT));
    }

    static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return out.toString();
    }

    /** O APK so vem do mesmo servidor da API: HTTPS, ou o mesmo endereco quando a API de teste usa HTTP (emulador). */
    static boolean isTrustedApkUrl(String apkUrl, String apiBase) {
        String url = apkUrl == null ? "" : apkUrl.toLowerCase(Locale.ROOT);
        String api = apiBase == null ? "" : apiBase.toLowerCase(Locale.ROOT).replaceAll("/+$", "");
        if (url.isEmpty() || api.isEmpty()) return false;
        if (!url.startsWith(api + "/")) return false;
        return url.startsWith("https://") || api.startsWith("http://");
    }

    /** Notas curtas para o dialogo: sem excesso de linhas e com reticencias no corte. */
    static String shortNotes(String notes, int max) {
        String text = notes == null ? "" : notes.replace("\r", "").trim();
        if (text.length() <= max) return text;
        int cut = text.lastIndexOf('\n', max);
        if (cut < max / 2) cut = max;
        return text.substring(0, cut).trim() + "\n...";
    }

    /** 12,3 MB para a barra de progresso. */
    static String megabytes(long bytes) {
        return String.format(Locale.forLanguageTag("pt-BR"), "%.1f MB", bytes / 1048576.0);
    }
}
