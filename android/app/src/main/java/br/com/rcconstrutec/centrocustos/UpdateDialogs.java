package br.com.rcconstrutec.centrocustos;

import android.app.Activity;
import android.app.AlertDialog;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** Dialogos nativos sobrios da atualizacao do app: aviso, erro com nova tentativa e progresso do download. */
final class UpdateDialogs {
    private UpdateDialogs() {}

    /** Dialogo simples; negative nulo esconde o segundo botao. cancelable false prende a escolha aos botoes. */
    static AlertDialog message(Activity activity, String title, String message, String positive, Runnable onPositive,
                               String negative, Runnable onNegative, boolean cancelable) {
        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(message)
                .setCancelable(cancelable)
                .setPositiveButton(positive, (dialog, which) -> { if (onPositive != null) onPositive.run(); });
        if (negative != null) builder.setNegativeButton(negative, (dialog, which) -> { if (onNegative != null) onNegative.run(); });
        return builder.create();
    }

    static final class ProgressUi {
        final AlertDialog dialog;
        private final TextView text;
        private final ProgressBar bar;

        ProgressUi(AlertDialog dialog, TextView text, ProgressBar bar) {
            this.dialog = dialog; this.text = text; this.bar = bar;
        }

        void set(long done, long total) {
            if (total > 0) {
                int percent = (int) Math.min(100, done * 100 / total);
                bar.setIndeterminate(false);
                bar.setProgress(percent);
                text.setText(percent + "%  ·  " + UpdatePolicy.megabytes(done) + " de " + UpdatePolicy.megabytes(total));
            } else {
                text.setText(UpdatePolicy.megabytes(done) + " baixados");
            }
        }

        void verifying() {
            bar.setIndeterminate(true);
            text.setText("Conferindo o arquivo...");
        }
    }

    static ProgressUi progress(Activity activity, String title, Runnable onCancel) {
        float density = activity.getResources().getDisplayMetrics().density;
        int pad = Math.round(24 * density);
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, Math.round(12 * density), pad, 0);
        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setIndeterminate(true);
        TextView text = new TextView(activity);
        text.setText("Baixando...");
        text.setGravity(Gravity.START);
        text.setPadding(0, Math.round(8 * density), 0, 0);
        box.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        box.addView(text, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle(title)
                .setView(box)
                .setCancelable(false)
                .setNegativeButton("Cancelar", (d, which) -> onCancel.run())
                .create();
        return new ProgressUi(dialog, text, bar);
    }
}
