package com.johnyuapril.screenwriter;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** 앱 안에서 새 APK를 받아 설치 화면을 띄운다. */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject r = new JSObject();
            r.put("versionName", pi.versionName);
            r.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("url 없음"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("NEED_PERMISSION");
            return;
        }
        new Thread(() -> {
            try {
                File out = new File(getContext().getCacheDir(), "update.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("Accept", "application/octet-stream");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = c.getHeaderField("Location");
                    c.disconnect();
                    c = (HttpURLConnection) new URL(loc).openConnection();
                    code = c.getResponseCode();
                }
                if (code != 200) { call.reject("다운로드 실패 (" + code + ")"); return; }
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) { call.reject("다운로드 실패: " + e.getMessage()); }
        }).start();
    }

    private static final int SIDE = Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT | Intent.FLAG_ACTIVITY_MULTIPLE_TASK;

    /** 파일을 다른 앱으로 보내기. 받는 앱은 옆 화면(분할 화면)에 열림 */
    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            String path = call.getString("uri", "");
            if (path.startsWith("file://")) path = Uri.parse(path).getPath();
            File f = new File(path);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "*/*"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TITLE, f.getName());
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | SIDE);
            Intent chooser = Intent.createChooser(send, call.getString("title", "보내기"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | SIDE);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    /** AI 앱(없으면 웹)을 옆 화면에 열기 */
    @PluginMethod
    public void openSide(PluginCall call) {
        try {
            String pkg = call.getString("pkg", "");
            Intent i = pkg.isEmpty() ? null : getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", "https://chatgpt.com")));
            i.addFlags(SIDE);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url")));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
