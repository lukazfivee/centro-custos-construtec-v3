package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.content.Context;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;

import java.util.concurrent.Executor;

import javax.crypto.Cipher;

/** BiometricPrompt do sistema (Android 9+) sempre com CryptoObject: sem digital, a chave nao abre. */
final class BiometricGate {
    interface Result { void done(Cipher authorized, String errorCode); }

    private BiometricGate() {}

    @SuppressWarnings("deprecation")
    static boolean available(Context context) {
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricManager manager = context.getSystemService(BiometricManager.class);
            return manager != null && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        if (Build.VERSION.SDK_INT == 29) {
            BiometricManager manager = context.getSystemService(BiometricManager.class);
            return manager != null && manager.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
        }
        FingerprintManager fingerprints = context.getSystemService(FingerprintManager.class);
        return fingerprints != null && fingerprints.isHardwareDetected() && fingerprints.hasEnrolledFingerprints();
    }

    /** Deve ser chamado na thread principal. O resultado tambem volta na thread principal. */
    static void authenticate(Activity activity, Cipher cipher, String title, String subtitle, Result result) {
        Executor main = activity.getMainExecutor();
        final boolean[] finished = { false };
        Result once = (authorized, code) -> {
            if (finished[0]) return;
            finished[0] = true;
            result.done(authorized, code);
        };
        CancellationSignal cancel = new CancellationSignal();
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(activity)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButton("Usar PIN", main, (dialog, which) -> once.done(null, "BIO_CANCELED"));
        if (Build.VERSION.SDK_INT >= 29) builder.setConfirmationRequired(false);
        if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        builder.build().authenticate(new BiometricPrompt.CryptoObject(cipher), cancel, main, new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult auth) {
                BiometricPrompt.CryptoObject crypto = auth.getCryptoObject();
                once.done(crypto == null ? null : crypto.getCipher(), crypto == null ? "BIO_ERROR" : null);
            }
            @Override public void onAuthenticationError(int code, CharSequence message) {
                once.done(null, mapError(code));
            }
            @Override public void onAuthenticationFailed() {
                // Digital nao reconhecida: o proprio sistema pede de novo.
            }
        });
    }

    private static String mapError(int code) {
        switch (code) {
            case BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT:
            case BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT:
                return "BIO_LOCKOUT";
            case BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED:
            case BiometricPrompt.BIOMETRIC_ERROR_CANCELED:
                return "BIO_CANCELED";
            case BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS:
            case BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "BIO_UNAVAILABLE";
            default:
                return "BIO_ERROR";
        }
    }
}
