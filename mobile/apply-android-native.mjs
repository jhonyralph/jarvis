import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const android = join(here, "android");
const app = join(android, "app");
const main = join(app, "src", "main");
const assetsDir = join(main, "assets");
const javaDir = join(main, "java", "chat", "jarvis", "app");

const wakeAssets = [
  {
    name: "melspectrogram.onnx",
    url: "https://huggingface.co/Soulcreek2/speechkit-wakeword-models/resolve/main/melspectrogram.onnx",
  },
  {
    name: "embedding_model.onnx",
    url: "https://huggingface.co/Soulcreek2/speechkit-wakeword-models/resolve/main/embedding_model.onnx",
  },
  {
    name: "hey_jarvis.onnx",
    url: "https://huggingface.co/Soulcreek2/speechkit-wakeword-models/resolve/main/hey_jarvis.onnx",
  },
];

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current !== text) writeFileSync(path, text);
}

function remove(path) {
  if (existsSync(path)) unlinkSync(path);
}

function patch(path, fn) {
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(path, after);
}

function insertBefore(text, marker, chunk) {
  if (text.includes(chunk.trim())) return text;
  return text.replace(marker, `${chunk}\n${marker}`);
}

function insertAfter(text, marker, chunk) {
  if (text.includes(chunk.trim())) return text;
  return text.replace(marker, `${marker}\n${chunk}`);
}

function removeLineContaining(text, needle) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.includes(needle))
    .join("\n");
}

async function downloadWakeAssets() {
  mkdirSync(assetsDir, { recursive: true });
  for (const asset of wakeAssets) {
    const target = join(assetsDir, asset.name);
    if (existsSync(target)) continue;

    console.log(`[android-native] downloading ${asset.name}`);
    const response = await fetch(asset.url, {
      headers: { "User-Agent": "jarvis-android-build" },
    });
    if (!response.ok) {
      throw new Error(`Failed to download ${asset.name}: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) {
      throw new Error(`Downloaded ${asset.name} is unexpectedly small (${buffer.length} bytes)`);
    }
    writeFileSync(target, buffer);
  }
}

if (!existsSync(android)) {
  console.warn("[android-native] mobile/android not found; run npx cap add android first.");
  process.exit(0);
}

await downloadWakeAssets();

write(join(javaDir, "JarvisWakeEvents.java"), `package chat.jarvis.app;

final class JarvisWakeEvents {
    static final String ACTION_WAKE = "chat.jarvis.app.JARVIS_WAKE_DETECTED";
    static final String ACTION_STATUS = "chat.jarvis.app.JARVIS_WAKE_STATUS";
    static final String ACTION_STOP = "chat.jarvis.app.JARVIS_WAKE_STOP";
    static final String PREFS = "jarvis_wake";
    static final String PREF_LAST_WAKE_AT = "lastWakeAt";
    static final String EXTRA_AT = "at";
    static final String EXTRA_RUNNING = "running";
    static final String EXTRA_ERROR = "error";

    private JarvisWakeEvents() {}
}
`);

remove(join(javaDir, "JarvisWakeService.java"));
write(join(javaDir, "JarvisWakeService.kt"), `package chat.jarvis.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.rementia.openwakeword.lib.WakeWordEngine
import com.rementia.openwakeword.lib.model.DetectionMode
import com.rementia.openwakeword.lib.model.WakeWordModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class JarvisWakeService : Service() {
    companion object {
        const val ACTION_START = "chat.jarvis.app.JARVIS_WAKE_START"
        const val EXTRA_KEYWORD = "keyword"

        private const val NOTIFICATION_ID = 4217
        private const val CHANNEL_ID = "jarvis_wake"
        private const val DEFAULT_MODEL = "hey_jarvis.onnx"
        private const val DEFAULT_KEYWORD = "Hey Jarvis"
        private const val DEFAULT_THRESHOLD = 0.45f
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var wakeWordEngine: WakeWordEngine? = null
    private var detectionJob: Job? = null
    private var lastError = ""

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ""
        if (JarvisWakeEvents.ACTION_STOP == action) {
            stopWake("")
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, notification("Escutando Hey Jarvis"))
        return try {
            startWake(intent)
            START_STICKY
        } catch (ex: Exception) {
            lastError = ex.message ?: ex.toString()
            broadcastStatus(false, lastError)
            stopWake(lastError)
            stopSelf()
            START_NOT_STICKY
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopWake(lastError)
        scope.cancel()
        super.onDestroy()
    }

    private fun startWake(intent: Intent?) {
        if (wakeWordEngine != null) {
            broadcastStatus(true, "")
            return
        }

        val requestedKeyword = intent?.getStringExtra(EXTRA_KEYWORD)?.trim().orEmpty()
        val keyword = if (requestedKeyword.equals("jarvis", ignoreCase = true)) DEFAULT_KEYWORD else DEFAULT_KEYWORD
        val model = WakeWordModel(keyword, DEFAULT_MODEL, DEFAULT_THRESHOLD)
        val engine = WakeWordEngine(
            context = applicationContext,
            models = listOf(model),
            detectionMode = DetectionMode.SINGLE_BEST,
            detectionCooldownMs = 2000L,
            scope = scope
        )

        detectionJob = scope.launch {
            engine.detections.collect {
                onWakeDetected()
            }
        }
        wakeWordEngine = engine
        engine.start()
        lastError = ""
        broadcastStatus(true, "")
    }

    private fun onWakeDetected() {
        val at = System.currentTimeMillis()
        val prefs = getSharedPreferences(JarvisWakeEvents.PREFS, MODE_PRIVATE)
        prefs.edit().putLong(JarvisWakeEvents.PREF_LAST_WAKE_AT, at).apply()

        val wake = Intent(JarvisWakeEvents.ACTION_WAKE).setPackage(packageName)
        wake.putExtra(JarvisWakeEvents.EXTRA_AT, at)
        sendBroadcast(wake)

        val open = Intent(this, MainActivity::class.java)
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        open.putExtra(JarvisWakeEvents.EXTRA_AT, at)
        startActivity(open)
    }

    private fun stopWake(error: String) {
        detectionJob?.cancel()
        detectionJob = null
        wakeWordEngine?.release()
        wakeWordEngine = null
        broadcastStatus(false, error)
    }

    private fun broadcastStatus(running: Boolean, error: String?) {
        val status = Intent(JarvisWakeEvents.ACTION_STATUS).setPackage(packageName)
        status.putExtra(JarvisWakeEvents.EXTRA_RUNNING, running)
        status.putExtra(JarvisWakeEvents.EXTRA_ERROR, error ?: "")
        sendBroadcast(status)
    }

    private fun notification(text: String): Notification {
        ensureChannel()
        val open = Intent(this, MainActivity::class.java)
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stop = Intent(this, JarvisWakeService::class.java).setAction(JarvisWakeEvents.ACTION_STOP)
        val stopIntent = PendingIntent.getService(
            this,
            1,
            stop,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Jarvis")
            .setContentText(text)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Parar", stopIntent)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Jarvis wake word",
            NotificationManager.IMPORTANCE_LOW
        )
        channel.description = "Mantem o microfone escutando a palavra de ativacao do Jarvis."
        manager.createNotificationChannel(channel)
    }
}
`);

write(join(javaDir, "JarvisWakePlugin.java"), `package chat.jarvis.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "JarvisWake",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class JarvisWakePlugin extends Plugin {
    private BroadcastReceiver receiver;
    private boolean running = false;
    private String lastError = "";

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) {
                    return;
                }
                String action = intent.getAction();
                if (JarvisWakeEvents.ACTION_WAKE.equals(action)) {
                    notifyWake(intent.getLongExtra(JarvisWakeEvents.EXTRA_AT, System.currentTimeMillis()));
                } else if (JarvisWakeEvents.ACTION_STATUS.equals(action)) {
                    running = intent.getBooleanExtra(JarvisWakeEvents.EXTRA_RUNNING, false);
                    lastError = intent.getStringExtra(JarvisWakeEvents.EXTRA_ERROR);
                    if (lastError == null) {
                        lastError = "";
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(JarvisWakeEvents.ACTION_WAKE);
        filter.addAction(JarvisWakeEvents.ACTION_STATUS);
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        emitPendingWake();
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {}
            receiver = null;
        }
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        call.resolve(baseStatus());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(baseStatus());
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Permissao de microfone negada.");
            return;
        }
        startService(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), JarvisWakeService.class).setAction(JarvisWakeEvents.ACTION_STOP);
        getContext().startService(intent);
        running = false;
        lastError = "";
        call.resolve(baseStatus());
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), JarvisWakeService.class).setAction(JarvisWakeService.ACTION_START);
        String keyword = call.getString("keyword", "hey_jarvis");
        intent.putExtra(JarvisWakeService.EXTRA_KEYWORD, keyword);
        ContextCompat.startForegroundService(getContext(), intent);
        running = true;
        lastError = "";
        call.resolve(baseStatus());
    }

    private JSObject baseStatus() {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("running", running);
        result.put("keyword", "hey_jarvis");
        result.put("phrase", "Hey Jarvis");
        result.put("engine", "openwakeword");
        if (lastError != null && !lastError.isEmpty()) {
            result.put("error", lastError);
        }
        return result;
    }

    private void notifyWake(long at) {
        JSObject data = new JSObject();
        data.put("at", at);
        notifyListeners("wake", data, true);
    }

    private void emitPendingWake() {
        SharedPreferences prefs = getContext().getSharedPreferences(JarvisWakeEvents.PREFS, Context.MODE_PRIVATE);
        long at = prefs.getLong(JarvisWakeEvents.PREF_LAST_WAKE_AT, 0L);
        if (at <= 0L || System.currentTimeMillis() - at > 30000L) {
            return;
        }
        prefs.edit().remove(JarvisWakeEvents.PREF_LAST_WAKE_AT).apply();
        notifyWake(at);
    }
}
`);

write(join(javaDir, "MainActivity.java"), `package chat.jarvis.app;

import android.os.Bundle;
import android.webkit.PermissionRequest;
import java.util.ArrayList;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(JarvisWakePlugin.class);
        super.onCreate(savedInstanceState);
        // The UI is loaded from a remote origin (server.url = Hub). A remote page calling
        // navigator.mediaDevices.getUserMedia({audio}) triggers WebChromeClient.onPermissionRequest;
        // Capacitor's default client does not grant it for remote origins, so voice/audio capture is
        // denied even with RECORD_AUDIO held at the OS level. We extend Capacitor's client and grant
        // only audio/video capture, keeping every other Capacitor behavior intact.
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    ArrayList<String> grant = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                                || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            grant.add(resource);
                        }
                    }
                    if (grant.isEmpty()) request.deny();
                    else request.grant(grant.toArray(new String[0]));
                });
            }
        });
    }
}
`);

patch(join(main, "AndroidManifest.xml"), (text) => {
  let out = text;
  out = insertBefore(
    out,
    "    </application>",
    `
        <service
            android:name=".JarvisWakeService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="microphone" />`
  );
  for (const permission of [
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.WAKE_LOCK",
  ]) {
    if (!out.includes(permission)) {
      out = out.replace("</manifest>", `    <uses-permission android:name="${permission}" />\n</manifest>`);
    }
  }
  return out;
});

patch(join(android, "build.gradle"), (text) => {
  let out = text;
  if (!out.includes("org.jetbrains.kotlin:kotlin-gradle-plugin")) {
    out = out.replace(
      /classpath 'com\.google\.gms:google-services:[^']+'/,
      `$&\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.23'`
    );
  }
  return out;
});

// Pin the Kotlin toolchain for every Capacitor plugin subproject. Plugins such as
// @capacitor/geolocation read rootProject.ext.kotlin_version and otherwise fall back to
// Kotlin 2.2.x, producing class metadata the app (compiled with 1.9.23) cannot read.
patch(join(android, "variables.gradle"), (text) => {
  return insertAfter(
    text,
    "ext {",
    "    kotlin_version = '1.9.23'\n    kotlinxCoroutinesVersion = '1.9.0'"
  );
});

patch(join(app, "build.gradle"), (text) => {
  let out = text;
  out = insertAfter(out, "apply plugin: 'com.android.application'", "apply plugin: 'org.jetbrains.kotlin.android'");
  out = removeLineContaining(out, "JARVIS_PICOVOICE_ACCESS_KEY");
  out = removeLineContaining(out, "picovoiceAccessKey");
  out = removeLineContaining(out, "ai.picovoice:porcupine-android");
  if (!out.includes("kotlinOptions")) {
    out = out.replace(
      /(\n\s*buildFeatures\s*\{[\s\S]*?\n\s*\}\n)(\s*\}\n)/,
      `$1    kotlinOptions {\n        jvmTarget = "21"\n    }\n$2`
    );
  } else {
    out = out.replace(/jvmTarget\s*=\s*["'][^"']+["']/, 'jvmTarget = "21"');
  }
  if (!out.includes("xyz.rementia:openwakeword")) {
    out = out.replace(
      /implementation\s+"androidx\.core:core-splashscreen:\$coreSplashScreenVersion"/,
      `$&\n    implementation "xyz.rementia:openwakeword:0.1.5"\n    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0"`
    );
  }
  return out;
});

console.log("[android-native] applied JarvisWake Android native plugin with openWakeWord");
