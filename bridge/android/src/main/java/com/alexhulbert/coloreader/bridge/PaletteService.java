package com.alexhulbert.coloreader.bridge;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.os.*;
import java.net.InetSocketAddress;
import org.java_websocket.WebSocket;
import org.java_websocket.drafts.Draft;
import org.java_websocket.exceptions.InvalidDataException;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.handshake.ServerHandshakeBuilder;
import org.java_websocket.server.WebSocketServer;

public final class PaletteService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebSocketServer server;
    private String last = "";
    private final Runnable refresh = () -> {
        String next = Palette.snapshot(this);
        if (!next.equals(last) && server != null) {
            last = next;
            server.broadcast(next);
        }
    };
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            schedule();
        }
    };
    private final WallpaperManager.OnColorsChangedListener wallpaper = (colors, which) -> schedule();
    private void schedule() {
        handler.removeCallbacks(refresh);
        handler.postDelayed(refresh, 400);
    }
    private void reply(WebSocket connection) {
        handler.post(() -> {
            if (connection.isOpen())
                connection.send(Palette.snapshot(this));
        });
    }
    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(
            new NotificationChannel("palette", "Coloreader bridge", NotificationManager.IMPORTANCE_LOW));
        Notification notification =
            new Notification.Builder(this, "palette")
                .setSmallIcon(R.drawable.icon)
                .setContentTitle("Coloreader bridge")
                .setContentText("Sharing Android colors locally with Firefox")
                .setOngoing(true)
                .setShowWhen(false)
                .build();
        startForeground(1, notification);
        if (Build.VERSION.SDK_INT >= 33)
            registerReceiver(screen, new IntentFilter(Intent.ACTION_SCREEN_ON), Context.RECEIVER_NOT_EXPORTED);
        else
            registerReceiver(screen, new IntentFilter(Intent.ACTION_SCREEN_ON));
        getSystemService(WallpaperManager.class).addOnColorsChangedListener(wallpaper, handler);
        server = new WebSocketServer(new InetSocketAddress("127.0.0.1", Palette.PORT)) {
            @Override
            public ServerHandshakeBuilder onWebsocketHandshakeReceivedAsServer(
                WebSocket connection, Draft draft, ClientHandshake request) throws InvalidDataException {
                if (!request.getFieldValue("Origin").startsWith("moz-extension://"))
                    throw new InvalidDataException(1008, "Only the Firefox extension may connect");
                return super.onWebsocketHandshakeReceivedAsServer(connection, draft, request);
            }
            @Override
            public void onOpen(WebSocket connection, ClientHandshake request) {
                reply(connection);
            }
            @Override
            public void onMessage(WebSocket connection, String message) {
                if ("get".equals(message))
                    reply(connection);
                else
                    connection.close(1008);
            }
            @Override
            public void onClose(WebSocket connection, int code, String reason, boolean remote) {
            }
            @Override
            public void onError(WebSocket connection, Exception error) {
                if (connection == null)
                    handler.post(PaletteService.this::stopSelf);
            }
            @Override
            public void onStart() {
                schedule();
            }
        };
        server.setReuseAddr(true);
        server.setConnectionLostTimeout(0);
        server.start();
    }
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        schedule();
    }
    @Override
    public int onStartCommand(Intent intent, int flags, int id) {
        return START_STICKY;
    }
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        unregisterReceiver(screen);
        getSystemService(WallpaperManager.class).removeOnColorsChangedListener(wallpaper);
        WebSocketServer closing = server;
        server = null;
        new Thread(() -> {
            try {
                if (closing != null)
                    closing.stop(1000);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }, "palette-stop").start();
        super.onDestroy();
    }
}
