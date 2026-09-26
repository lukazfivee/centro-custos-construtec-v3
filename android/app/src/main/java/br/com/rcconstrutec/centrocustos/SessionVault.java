package br.com.rcconstrutec.centrocustos;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Cofre da sessao (02-ESPEC, secao 5). A senha nunca e guardada.
 * PIN: chave = PBKDF2-SHA256(PIN, sal, 150 mil), que cifra a sessao; o resultado e cifrado de novo
 * por uma chave AES-GCM do Android Keystore que nao pode ser exportada.
 * Biometria: a chave derivada do PIN e cifrada por uma chave do Keystore que exige BiometricPrompt.
 */
final class SessionVault {
    static final int ITERATIONS = 150_000;
    static final int MAX_ATTEMPTS = 3;
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String WRAP = "suite_pin_wrap";
    private static final String META = "suite_meta";
    private static final String BIO = "suite_bio";
    private static final String AES_GCM = "AES/GCM/NoPadding";
    private final SharedPreferences prefs;
    private final SecureRandom random = new SecureRandom();

    static final class Unlock {
        final byte[] key; final String session; final int failures; final boolean locked;
        Unlock(byte[] key, String session, int failures, boolean locked) { this.key = key; this.session = session; this.failures = failures; this.locked = locked; }
        boolean ok() { return session != null; }
    }

    SessionVault(Context context) { prefs = context.getSharedPreferences("suite_vault", Context.MODE_PRIVATE); }

    boolean hasPin() { return prefs.contains("pin_blob"); }
    boolean hasBio() { return prefs.contains("bio_blob"); }
    boolean pinLocked() { return prefs.getBoolean("pin_locked", false); }
    int autoLockSeconds() { return prefs.getInt("auto_lock", 300); }
    void setAutoLockSeconds(int seconds) { prefs.edit().putInt("auto_lock", seconds).apply(); }

    /** Cria o PIN e cifra a sessao. Devolve a chave derivada para uso enquanto o app estiver aberto. */
    byte[] createPin(String pin, String session) throws GeneralSecurityException {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        byte[] key = derive(pin, salt, ITERATIONS);
        deleteBio();
        prefs.edit().putString("pin_salt", b64(salt)).putInt("pin_iter", ITERATIONS).remove("pin_locked").commit();
        store(key, session);
        writeAttempts(0);
        return key;
    }

    /** Troca a sessao guardada mantendo o mesmo PIN (mesmo sal, mesma chave). */
    void store(byte[] key, String session) throws GeneralSecurityException {
        byte[] inner = seal(new SecretKeySpec(key, "AES"), session.getBytes(StandardCharsets.UTF_8));
        prefs.edit().putString("pin_blob", b64(seal(keystoreKey(WRAP), inner))).commit();
    }

    /** Confere o PIN. A tentativa e contada antes da conferencia, para que matar o app nao a apague. */
    Unlock unlock(String pin) throws GeneralSecurityException {
        if (!hasPin()) return new Unlock(null, null, MAX_ATTEMPTS, true);
        int failures = readAttempts();
        if (failures >= MAX_ATTEMPTS) { wipePin(true); return new Unlock(null, null, failures, true); }
        writeAttempts(failures + 1);
        byte[] salt = unb64(prefs.getString("pin_salt", ""));
        byte[] key = derive(pin, salt, prefs.getInt("pin_iter", ITERATIONS));
        String session = open(key);
        if (session == null) {
            int now = failures + 1;
            if (now >= MAX_ATTEMPTS) wipePin(true);
            return new Unlock(null, null, now, now >= MAX_ATTEMPTS);
        }
        writeAttempts(0);
        return new Unlock(key, session, 0, false);
    }

    /** Abre a sessao com a chave liberada pela biometria. */
    String unlockWithKey(byte[] key) throws GeneralSecurityException {
        String session = open(key);
        if (session != null) writeAttempts(0);
        return session;
    }

    private String open(byte[] key) throws GeneralSecurityException {
        byte[] inner = unseal(keystoreKey(WRAP), unb64(prefs.getString("pin_blob", "")));
        try {
            return new String(unseal(new SecretKeySpec(key, "AES"), inner), StandardCharsets.UTF_8);
        } catch (AEADBadTagException wrongPin) {
            return null;
        }
    }

    Cipher bioEncryptCipher() throws GeneralSecurityException {
        deleteKey(BIO);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(BIO, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256)
            .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec.build());
        Cipher cipher = Cipher.getInstance(AES_GCM);
        cipher.init(Cipher.ENCRYPT_MODE, generator.generateKey());
        return cipher;
    }

    void saveBio(Cipher authorized, byte[] key) throws GeneralSecurityException {
        byte[] body = authorized.doFinal(key);
        prefs.edit().putString("bio_iv", b64(authorized.getIV())).putString("bio_blob", b64(body)).commit();
    }

    /** Lanca KeyPermanentlyInvalidatedException se uma digital nova foi cadastrada. */
    Cipher bioDecryptCipher() throws GeneralSecurityException {
        SecretKey key = existingKey(BIO);
        if (key == null || !hasBio()) throw new GeneralSecurityException("sem biometria");
        Cipher cipher = Cipher.getInstance(AES_GCM);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, unb64(prefs.getString("bio_iv", ""))));
        return cipher;
    }

    byte[] readBio(Cipher authorized) throws GeneralSecurityException {
        return authorized.doFinal(unb64(prefs.getString("bio_blob", "")));
    }

    void deleteBio() {
        prefs.edit().remove("bio_blob").remove("bio_iv").commit();
        deleteKey(BIO);
    }

    /** Apaga PIN, sessao cifrada e copia biometrica. Com locked, a tela seguinte e [B2]. */
    void wipePin(boolean locked) {
        SharedPreferences.Editor edit = prefs.edit().remove("pin_blob").remove("pin_salt").remove("pin_iter").remove("attempts");
        if (locked) edit.putBoolean("pin_locked", true); else edit.remove("pin_locked");
        edit.commit();
        deleteBio();
    }

    void clearLocked() { prefs.edit().remove("pin_locked").commit(); }

    void saveProfile(String json) {
        try { prefs.edit().putString("profile", b64(seal(keystoreKey(META), json.getBytes(StandardCharsets.UTF_8)))).commit(); }
        catch (GeneralSecurityException ignored) { /* sem perfil o PIN mostra so "Ola" */ }
    }

    String profile() {
        String stored = prefs.getString("profile", null);
        if (stored == null) return null;
        try { return new String(unseal(keystoreKey(META), unb64(stored)), StandardCharsets.UTF_8); }
        catch (GeneralSecurityException error) { return null; }
    }

    void forgetAll() {
        prefs.edit().clear().commit();
        deleteKey(WRAP); deleteKey(META); deleteKey(BIO);
    }

    private int readAttempts() {
        String stored = prefs.getString("attempts", null);
        if (stored == null) return 0;
        try { return ByteBuffer.wrap(unseal(keystoreKey(META), unb64(stored))).getInt(); }
        catch (GeneralSecurityException | RuntimeException tampered) { return MAX_ATTEMPTS - 1; }
    }

    private void writeAttempts(int value) throws GeneralSecurityException {
        prefs.edit().putString("attempts", b64(seal(keystoreKey(META), ByteBuffer.allocate(4).putInt(value).array()))).commit();
    }

    static byte[] derive(String pin, byte[] salt, int iterations) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, iterations, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        finally { spec.clearPassword(); }
    }

    /** AES-GCM com IV de 12 bytes na frente do texto cifrado. */
    private byte[] seal(SecretKey key, byte[] plain) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(AES_GCM);
        if (key instanceof SecretKeySpec) {
            byte[] iv = new byte[12];
            random.nextBytes(iv);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        } else {
            cipher.init(Cipher.ENCRYPT_MODE, key);
        }
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(plain);
        byte[] out = Arrays.copyOf(iv, iv.length + body.length);
        System.arraycopy(body, 0, out, iv.length, body.length);
        return out;
    }

    private byte[] unseal(SecretKey key, byte[] blob) throws GeneralSecurityException {
        if (blob.length < 13) throw new AEADBadTagException("vazio");
        Cipher cipher = Cipher.getInstance(AES_GCM);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, blob, 0, 12));
        return cipher.doFinal(blob, 12, blob.length - 12);
    }

    private SecretKey keystoreKey(String alias) throws GeneralSecurityException {
        SecretKey existing = existingKey(alias);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }

    private SecretKey existingKey(String alias) throws GeneralSecurityException {
        try {
            KeyStore store = KeyStore.getInstance(KEYSTORE);
            store.load(null);
            return (SecretKey) store.getKey(alias, null);
        } catch (java.io.IOException error) {
            throw new GeneralSecurityException(error);
        }
    }

    private void deleteKey(String alias) {
        try { KeyStore store = KeyStore.getInstance(KEYSTORE); store.load(null); store.deleteEntry(alias); }
        catch (Exception ignored) { /* chave ja inexistente */ }
    }

    private static String b64(byte[] value) { return Base64.getEncoder().encodeToString(value); }
    private static byte[] unb64(String value) { return value == null || value.isEmpty() ? new byte[0] : Base64.getDecoder().decode(value); }
}
