package com.cosmic.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import android.util.Base64;

public class CosmicScreenShareService extends Service {
    public static final String ACTION_START = "com.cosmic.ai.screen.START";
    public static final String ACTION_STOP = "com.cosmic.ai.screen.STOP";
    public static final String ACTION_FRAME = "com.cosmic.ai.screen.FRAME";
    private static final String CHANNEL = "cosmic_screen_share";
    private static final int NOTIFICATION_ID = 8061;
    private static final String TAG = "COSMICScreen";
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private long lastFrameAt = 0;
    private int width;
    private int height;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "COSMIC screen sharing", NotificationManager.IMPORTANCE_LOW));
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopCapture();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (projection != null) return START_NOT_STICKY;
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }

        startForeground(NOTIFICATION_ID, new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("COSMIC screen sharing")
            .setContentText("Your screen is being shared with COSMIC Live")
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true).setPriority(NotificationCompat.PRIORITY_LOW).build());

        int resultCode = intent.getIntExtra("resultCode", 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= 33) resultData = intent.getParcelableExtra("resultData", Intent.class);
        else resultData = intent.getParcelableExtra("resultData");
        if (resultData == null) { stopSelf(); return START_NOT_STICKY; }

        try {
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = manager.getMediaProjection(resultCode, resultData);
            if (projection == null) throw new IllegalStateException("Android did not provide screen capture permission.");
            startCapture();
        } catch (Throwable error) {
            Log.e(TAG, "Could not start screen capture", error);
            stopCapture();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startCapture() {
        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (wm == null) throw new IllegalStateException("Display service unavailable.");
        wm.getDefaultDisplay().getRealMetrics(metrics);
        float scale = Math.min(1f, 1280f / Math.max(metrics.widthPixels, metrics.heightPixels));
        width = Math.max(2, Math.round(metrics.widthPixels * scale));
        height = Math.max(2, Math.round(metrics.heightPixels * scale));
        if ((width & 1) == 1) width--;
        if ((height & 1) == 1) height--;

        thread = new HandlerThread("COSMIC-ScreenCapture");
        thread.start();
        handler = new Handler(thread.getLooper());
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(this::onImage, handler);
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() {
                stopCapture();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        }, handler);
        display = projection.createVirtualDisplay(
            "COSMIC Live Screen", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.getSurface(), null, handler);
    }

    private void onImage(ImageReader source) {
        Image image = null;
        try {
            image = source.acquireLatestImage();
            if (image == null) return;
            long now = System.currentTimeMillis();
            if (now - lastFrameAt < 900) return;
            lastFrameAt = now;
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int paddedWidth = rowStride / pixelStride;
            Bitmap padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
            buffer.rewind();
            padded.copyPixelsFromBuffer(buffer);
            Bitmap frame = Bitmap.createBitmap(padded, 0, 0, width, height);
            padded.recycle();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            frame.compress(Bitmap.CompressFormat.JPEG, 58, output);
            frame.recycle();
            String encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            Intent event = new Intent(ACTION_FRAME);
            event.setPackage(getPackageName());
            event.putExtra("data", encoded);
            sendBroadcast(event);
        } catch (Throwable error) {
            Log.w(TAG, "Screen frame skipped", error);
        } finally {
            if (image != null) image.close();
        }
    }

    private void stopCapture() {
        if (display != null) { display.release(); display = null; }
        if (reader != null) { reader.setOnImageAvailableListener(null, null); reader.close(); reader = null; }
        if (projection != null) { MediaProjection active = projection; projection = null; try { active.stop(); } catch (Exception ignored) {} }
        if (thread != null) { thread.quitSafely(); thread = null; handler = null; }
    }

    @Override public void onDestroy() {
        stopCapture();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
