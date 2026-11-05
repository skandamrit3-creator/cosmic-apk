package com.cosmic.ai;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;

import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "CosmicHomeAutomation",
        permissions = {@Permission(alias = "bluetoothConnect", strings = {Manifest.permission.BLUETOOTH_CONNECT})})
public class CosmicHomeAutomationPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile BluetoothSocket socket;
    private volatile OutputStream output;
    private volatile boolean reading = false;

    private boolean hasConnectPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                getContext().checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) ==
                        android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasConnectPermission()) {
            requestPermissionForAlias("bluetoothConnect", call, "pairedPermissionResult");
            return;
        }
        listPaired(call);
    }

    @PermissionCallback
    private void pairedPermissionResult(PluginCall call) {
        if (call == null) return;
        if (hasConnectPermission()) listPaired(call);
        else call.reject("Bluetooth Connect permission was denied.");
    }

    private void listPaired(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) { call.reject("This device does not support Bluetooth."); return; }
            if (!adapter.isEnabled()) { call.reject("Turn on Bluetooth in Android settings first."); return; }
            JSArray devices = new JSArray();
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                JSObject item = new JSObject();
                item.put("name", device.getName() == null ? "Bluetooth device" : device.getName());
                item.put("address", device.getAddress());
                item.put("bonded", true);
                devices.put(item);
            }
            call.resolve(new JSObject().put("devices", devices));
        } catch (SecurityException error) {
            call.reject("Bluetooth permission is required: " + error.getMessage());
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasConnectPermission()) {
            requestPermissionForAlias("bluetoothConnect", call, "connectPermissionResult");
            return;
        }
        connectDevice(call);
    }

    @PermissionCallback
    private void connectPermissionResult(PluginCall call) {
        if (call == null) return;
        if (hasConnectPermission()) connectDevice(call);
        else call.reject("Bluetooth Connect permission was denied.");
    }

    private void connectDevice(PluginCall call) {
        String address = call.getString("address", "");
        if (address == null || !address.matches("(?i)[0-9a-f]{2}(:[0-9a-f]{2}){5}")) {
            call.reject("Select a paired Bluetooth device using its MAC address.");
            return;
        }
        io.execute(() -> {
            BluetoothSocket candidate = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) throw new IllegalStateException("Bluetooth is unavailable or switched off.");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                candidate.connect();
                disconnectSocket();
                socket = candidate;
                output = candidate.getOutputStream();
                reading = true;
                startReader(candidate);
                call.resolve(new JSObject().put("success", true).put("connected", true)
                        .put("name", device.getName()).put("address", address));
            } catch (Exception error) {
                try { if (candidate != null) candidate.close(); } catch (Exception ignored) {}
                call.reject("Bluetooth SPP connection failed: " + error.getMessage());
            }
        });
    }

    private void startReader(BluetoothSocket active) {
        Thread reader = new Thread(() -> {
            try {
                BufferedReader input = new BufferedReader(new InputStreamReader(active.getInputStream(), "US-ASCII"));
                String line;
                while (reading && active == socket && (line = input.readLine()) != null) {
                    JSObject event = new JSObject();
                    event.put("line", line);
                    notifyListeners("homeAutomationData", event);
                }
            } catch (Exception error) {
                if (active == socket) {
                    JSObject event = new JSObject();
                    event.put("error", error.getMessage() == null ? "Bluetooth stream closed" : error.getMessage());
                    notifyListeners("homeAutomationError", event);
                    disconnectSocket();
                }
            }
        }, "COSMIC-HC05-reader");
        reader.setDaemon(true);
        reader.start();
    }

    @PluginMethod
    public void sendCommand(PluginCall call) {
        String rawCommand = call.getString("command", "");
        final String command = rawCommand == null ? "" : rawCommand.trim();
        boolean valid = "COSMIC,1,GET,ALL".equals(command) ||
                command.matches("COSMIC,1,SET,[1-8],(ON|OFF)");
        if (!valid) { call.reject("Unsupported command. Only GET ALL and SET relay 1-8 ON/OFF are allowed."); return; }
        final String frame = command + "\n";
        io.execute(() -> {
            try {
                OutputStream stream = output;
                BluetoothSocket active = socket;
                if (active == null || !active.isConnected() || stream == null)
                    throw new IllegalStateException("No Bluetooth controller is connected.");
                stream.write(frame.getBytes("US-ASCII"));
                stream.flush();
                call.resolve(new JSObject().put("success", true).put("sent", command));
            } catch (Exception error) {
                call.reject("Could not send relay command: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        io.execute(() -> {
            disconnectSocket();
            call.resolve(new JSObject().put("success", true).put("connected", false));
        });
    }

    @PluginMethod
    public void getConnectionStatus(PluginCall call) {
        BluetoothSocket active = socket;
        boolean connected = active != null && active.isConnected();
        call.resolve(new JSObject().put("connected", connected));
    }

    private synchronized void disconnectSocket() {
        reading = false;
        output = null;
        BluetoothSocket active = socket;
        socket = null;
        try { if (active != null) active.close(); } catch (Exception ignored) {}
    }

    @Override
    protected void handleOnDestroy() {
        disconnectSocket();
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
