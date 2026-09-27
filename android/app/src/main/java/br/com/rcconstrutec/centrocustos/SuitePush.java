package br.com.rcconstrutec.centrocustos;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.concurrent.ExecutorService;

/**
 * Notificacoes da Suite (Fase 4) pelo Firebase Cloud Messaging. O token do aparelho
 * vai para o servidor central a cada entrada no app (POST /v1/push/register). Com o
 * app aberto, o proprio app mostra o aviso; fechado, o Android mostra. O toque abre
 * o destino do aviso ("centro-custos?obra=12", "orcamentos?proposta=..."), extra "link".
 */
public final class SuitePush extends FirebaseMessagingService {
    static final String CHANNEL = "avisos";
    private static final String PREFS = "suite_push";
    private static final int PERMISSION_REQUEST = 77;

    @Override public void onNewToken(String token) {
        // O registro so acontece com sessao aberta: na proxima entrada o app pede o token de novo.
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("token_changed", true).apply();
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        RemoteMessage.Notification n = message.getNotification();
        if (n == null) return;
        ensureChannel(this);
        Map<String, String> data = message.getData();
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("link", data.get("link"));
        PendingIntent tap = PendingIntent.getActivity(this, (int) (System.currentTimeMillis() & 0xfffffff), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.app_icon)
                .setContentTitle(n.getTitle())
                .setContentText(n.getBody())
                .setStyle(new Notification.BigTextStyle().bigText(n.getBody()))
                .setAutoCancel(true)
                .setContentIntent(tap)
                .build();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify((int) (System.currentTimeMillis() & 0xfffffff), notification);
    }

    static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Avisos da Suite Construtec", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Propostas aprovadas, contas a vencer, itens acima do orcado e novos acessos.");
        manager.createNotificationChannel(channel);
    }

    /** Ao entrar no app: pede a permissao (Android 13+, uma vez) e registra o token do aparelho. */
    static void onEnter(Activity activity, AuthController auth, ExecutorService worker) {
        ensureChannel(activity);
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("permission_asked", false)
                && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean("permission_asked", true).apply();
            activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, PERMISSION_REQUEST);
        }
        try {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> worker.execute(() -> {
                String session = auth.activeToken();
                if (session == null || token == null) return;
                try { if (auth.api.registerPush(session, token).ok()) prefs.edit().putBoolean("token_changed", false).apply(); }
                catch (java.io.IOException offline) { /* tenta de novo na proxima entrada */ }
            }));
        } catch (RuntimeException unavailable) { /* aparelho sem Google Play services: segue sem push */ }
    }

    /** Destino do toque na notificacao, ja validado como no seletor Suite; nulo se nao houver. */
    static String[] target(Intent intent) {
        String link = intent == null ? null : intent.getStringExtra("link");
        if (link == null || link.isEmpty()) return null;
        String[] parsed = SuiteViews.parse(link);
        return SuiteViews.known(parsed[0]) ? parsed : null;
    }
}
