package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.net.URI;
import java.util.Locale;

/** "Configurar servidor local": a antiga tela de conexao com a instalacao Windows, agora opcional. */
final class LocalSetup {
    /** Endereco do servidor local: HTTPS, ou HTTP so em rede privada (Wi-Fi da obra/escritorio). */
    static String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = URI.create(value);
            String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
            String host = String.valueOf(uri.getHost()).toLowerCase(Locale.ROOT);
            if (host.isEmpty() || !(scheme.equals("https") || (scheme.equals("http") && isPrivateHost(host)))) return null;
            return value.replaceAll("/+$", "");
        } catch (RuntimeException ignored) { return null; }
    }

    private static boolean isPrivateHost(String host) {
        if (host.equals("10.0.2.2") || host.equals("127.0.0.1")) return true;
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        try {
            int first = Integer.parseInt(parts[0]); int second = Integer.parseInt(parts[1]);
            return first == 10 || (first == 192 && second == 168) || (first == 172 && second >= 16 && second <= 31);
        } catch (NumberFormatException ignored) { return false; }
    }


    interface Listener {
        /** Devolve a mensagem de erro, ou null se o endereco foi aceito. */
        String connect(String rawUrl);
        void useCentral();
    }

    private static final int NAVY = Color.rgb(2, 29, 38);
    private static final int CYAN = Color.rgb(50, 169, 205);
    private static final int MUTED = Color.rgb(82, 104, 113);

    private LocalSetup() {}

    static View build(Activity activity, String savedUrl, String error, Listener listener) {
        float density = activity.getResources().getDisplayMetrics().density;
        LinearLayout screen = new LinearLayout(activity);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = dp(28, density);
        screen.setPadding(pad, dp(36, density), pad, dp(32, density));

        ImageView logo = new ImageView(activity);
        logo.setImageResource(R.drawable.app_icon);
        logo.setContentDescription("Construtec");
        logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        screen.addView(logo, params(dp(78, density), dp(78, density), dp(10, density)));

        TextView title = text(activity, "Servidor local", 28, NAVY);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(null, Typeface.BOLD);
        screen.addView(title, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, dp(18, density)));
        TextView intro = text(activity, "Conecte este celular à instalação Windows da Construtec.", 16, MUTED);
        intro.setGravity(Gravity.CENTER);
        screen.addView(intro, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, dp(8, density)));

        EditText address = new EditText(activity);
        address.setSingleLine(true);
        address.setText(savedUrl);
        address.setHint("http://192.168.1.10:3333");
        address.setTextSize(16);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setMinHeight(dp(52, density));
        screen.addView(address, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, dp(28, density)));
        TextView help = text(activity, "Na mesma rede Wi-Fi, copie o endereço mostrado em Configurações > Acesso pelo celular. Fora da empresa, use somente HTTPS.", 13, MUTED);
        screen.addView(help, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, dp(8, density)));
        if (error != null) {
            TextView errorView = text(activity, error, 13, Color.rgb(180, 55, 55));
            screen.addView(errorView, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, dp(14, density)));
        }

        Button connect = new Button(activity);
        connect.setText("Conectar");
        connect.setTextSize(15);
        connect.setTextColor(NAVY);
        connect.setBackgroundColor(CYAN);
        connect.setAllCaps(false);
        screen.addView(connect, params(ViewGroup.LayoutParams.MATCH_PARENT, dp(52, density), dp(22, density)));
        connect.setOnClickListener(v -> {
            String problem = listener.connect(address.getText().toString());
            if (problem != null) address.setError(problem);
        });

        Button central = new Button(activity);
        central.setText("Usar o login central da Construtec");
        central.setTextSize(14);
        central.setTextColor(CYAN);
        central.setBackgroundColor(Color.TRANSPARENT);
        central.setAllCaps(false);
        screen.addView(central, params(ViewGroup.LayoutParams.MATCH_PARENT, dp(48, density), dp(12, density)));
        central.setOnClickListener(v -> listener.useCentral());

        ScrollView scroll = new ScrollView(activity);
        scroll.setBackgroundColor(Color.rgb(242, 246, 247));
        scroll.setFillViewport(true);
        scroll.addView(screen);
        return scroll;
    }

    private static int dp(int value, float density) { return Math.round(value * density); }

    private static TextView text(Activity activity, String value, int sp, int color) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    private static LinearLayout.LayoutParams params(int width, int height, int top) {
        LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(width, height);
        value.topMargin = top;
        return value;
    }
}
