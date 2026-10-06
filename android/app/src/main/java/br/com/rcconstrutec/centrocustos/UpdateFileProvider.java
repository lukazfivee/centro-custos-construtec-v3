package br.com.rcconstrutec.centrocustos;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Entrega ao instalador do Android o APK baixado em cache/update, so por leitura e so quando o app
 * concede a permissao do Uri (FLAG_GRANT_READ_URI_PERMISSION). Substitui o FileProvider do AndroidX.
 */
public final class UpdateFileProvider extends ContentProvider {
    static final String DIR = "update";
    static final String MIME = "application/vnd.android.package-archive";

    static File dir(Context context) {
        return new File(context.getCacheDir(), DIR);
    }

    static Uri uriFor(Context context, File file) {
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".update")
                .appendPath(DIR).appendPath(file.getName()).build();
    }

    /** Resolve o Uri para um arquivo dentro da pasta de atualizacao; qualquer coisa fora dela e recusada. */
    private File resolve(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        String name = uri.getLastPathSegment();
        if (context == null || name == null || name.contains("/") || name.contains("\\") || !name.endsWith(".apk")) throw new FileNotFoundException();
        try {
            File base = dir(context).getCanonicalFile();
            File file = new File(base, name).getCanonicalFile();
            if (!file.getParentFile().equals(base) || !file.isFile()) throw new FileNotFoundException();
            return file;
        } catch (IOException error) {
            throw new FileNotFoundException();
        }
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new SecurityException("Somente leitura.");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file;
        try { file = resolve(uri); } catch (FileNotFoundException missing) { return null; }
        MatrixCursor cursor = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        cursor.addRow(new Object[] {file.getName(), file.length()});
        return cursor;
    }

    @Override public String getType(Uri uri) { return MIME; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException(); }
}
