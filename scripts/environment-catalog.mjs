import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
export const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const DOC_FILE = "docs/environment.md";
const EXAMPLE_FILE = ".env.example";
const TICK = String.fromCharCode(96);

function entries(group, base, rows) {
  return rows.map(([name, values]) => Object.freeze({
    name,
    group,
    requirement: "optional",
    classification: "public",
    scope: "",
    defaultValue: "none",
    format: "string",
    secret: "no",
    provider: "Jarvis/local",
    cost: "no direct metered cost",
    configure: "hub",
    description: "",
    userSettable: true,
    detect: true,
    ...base,
    ...values,
  }));
}

const CATALOG = [
  ...entries("Hub e seguranca", {
    scope: "Hub",
    configure: "hub",
  }, [
    ["JARVIS_PORT", { defaultValue: "4577", format: "TCP port integer", description: "HTTP UI and WebSocket listener.", example: "4577" }],
    ["JARVIS_ADMIN_PORT", { defaultValue: "4578", format: "TCP port integer", description: "Loopback-only recovery/admin API and its local CLI.", example: "4578" }],
    ["JARVIS_PUBLIC_URL", { defaultValue: "none", format: "absolute HTTP(S) base URL", description: "Base used to build complete invite links; Android build also accepts it as a fallback Hub URL.", configure: "hub-mobile-build", example: "https://jarvis.example.invalid" }],
    ["JARVIS_CWD", { scope: "Hub and runner", defaultValue: "Hub: process cwd; runner: OS home; runner image: /workspace", format: "existing directory path", description: "Default agent working directory. The Windows Hub launcher overwrites it with the repository root after loading hub.env.", configure: "hub-runner", example: "C:/work" }],
    ["JARVIS_HOME", { scope: "Hub, runner and Core", defaultValue: "OS home", format: "readable/writable directory path", description: "Base directory; Jarvis state is stored below its .jarvis child. It does not relocate hub.env/runner.env.", configure: "hub-runner", example: "C:/Users/me" }],
    ["JARVIS_AUTH", { defaultValue: "on", format: "off disables; every other value enables", description: "Device and runner authentication. Turning it off trusts every connection.", example: "on" }],
    ["JARVIS_DEVICE_TTL_DAYS", { defaultValue: "0 (no idle expiry)", format: "non-negative number of days", description: "Revokes a device after the configured idle period.", example: "0" }],
    ["JARVIS_AUDIT_MAX_MB", { defaultValue: "5", format: "non-negative number in MB; 0 disables rotation", description: "Size threshold for one-generation audit log rotation.", example: "5" }],
    ["JARVIS_HISTORY_CAP", { defaultValue: "120", format: "positive integer", description: "Maximum message count sent when a session is opened.", example: "120" }],
    ["JARVIS_ALLOWED_ORIGINS", { defaultValue: "empty (no allowlist)", format: "comma-separated HTTP(S) origins", description: "Optional Origin allowlist for UI clients.", example: "https://jarvis.example.invalid" }],
    ["JARVIS_REQUIRE_TLS", { defaultValue: "off", format: "on, 1 or true enables", description: "Rejects non-loopback plaintext requests when enabled.", example: "off" }],
    ["JARVIS_TRUST_PROXY", { defaultValue: "off", format: "on, 1 or true enables", description: "Trusts the first X-Forwarded-For value. Set only behind a trusted proxy.", example: "off" }],
    ["JARVIS_MAX_PAYLOAD_MB", { defaultValue: "20", format: "number; effective minimum 1 MB", description: "Maximum WebSocket payload size.", example: "20" }],
    ["JARVIS_MAX_CONN_PER_IP", { defaultValue: "40", format: "number", description: "Concurrent connection cap per resolved client IP.", example: "40" }],
    ["JARVIS_MAX_CONN", { defaultValue: "800", format: "number", description: "Total concurrent connection cap.", example: "800" }],
  ]),

  ...entries("Agentes, busca e execucoes", {
    scope: "Hub and runner",
    configure: "hub-runner",
    cost: "selected CLI/provider plan may charge; no price is encoded here",
  }, [
    ["JARVIS_AGENT", { defaultValue: "claude-code", format: "registered adapter id", description: "Default coding-agent adapter.", example: "claude-code" }],
    ["JARVIS_AGENT_PERMISSION_MODE", { defaultValue: "full-access", format: "full-access or provider-default (provider_default also accepted)", description: "Controls whether Jarvis injects unattended/full-access flags or leaves sandbox/approvals to the provider.", example: "provider-default" }],
    ["JARVIS_SEARCH_AGENT", { defaultValue: "claude-code when registered, otherwise JARVIS_AGENT", format: "registered adapter id", description: "Adapter for cross-session search, summaries and helper passes.", example: "claude-code" }],
    ["JARVIS_SEARCH_MODEL", { defaultValue: "haiku", format: "provider model id", description: "Low-cost model preference for search and helper passes.", example: "haiku" }],
    ["JARVIS_SUMMARY_MODEL", { defaultValue: "JARVIS_SEARCH_MODEL, then haiku", format: "provider model id", description: "Startup default for summaries; persisted summary.json values override it.", example: "haiku" }],
    ["JARVIS_DIGEST_N", { scope: "Hub", configure: "hub", defaultValue: "10", format: "positive integer", description: "Managed-session count used to build the search digest.", example: "10" }],
    ["JARVIS_SESSION_COST_CAP", { scope: "Hub", configure: "hub", defaultValue: "0 (disabled)", format: "non-negative USD amount", description: "Blocks another turn after reported billable spend reaches the per-session cap.", example: "0" }],
    ["JARVIS_TERMINAL_MAX", { defaultValue: "4", format: "integer; effective minimum 1", description: "Maximum active managed terminals per process.", example: "4", cost: "no direct metered cost" }],
    ["JARVIS_TERMINAL_SHELL", { defaultValue: "Windows: powershell.exe; Unix: SHELL or bash", format: "executable name or path", description: "Default shell for managed terminals.", example: "powershell.exe", cost: "no direct metered cost" }],
    ["JARVIS_MANAGED_CONTEXT_CHARS", { defaultValue: "16000", format: "integer >= 1000", description: "Maximum injected history for adapters without addressable native resume.", example: "16000", cost: "larger prompts can increase provider usage" }],
    ["JARVIS_AGENT_CATALOG_FRESH_MS", { defaultValue: "600000", format: "milliseconds; effective minimum 5000", description: "Fresh window for the cached agent capability catalog.", example: "600000", cost: "catalog probes can call provider CLIs" }],
    ["JARVIS_AGENT_CATALOG_STALE_MS", { defaultValue: "3600000", format: "milliseconds; at least the fresh window", description: "Stale-while-revalidate limit for the agent catalog.", example: "3600000", cost: "catalog probes can call provider CLIs" }],
    ["JARVIS_NATIVE_LIMIT", { defaultValue: "40", format: "positive integer", description: "Limit for native Claude/Codex session listing and staged search.", example: "40", cost: "local disk scanning only" }],
    ["JARVIS_UPDATE_RETRY_SEC", { scope: "Hub", configure: "hub", defaultValue: "300", format: "seconds; effective minimum 30", description: "Retry delay for queued runner updates.", example: "300", cost: "network/git usage only" }],
    ["JARVIS_RUNNER_SELF_UPDATE_MS", { scope: "Runner", configure: "runner", defaultValue: "600000", format: "0 disables; otherwise milliseconds clamped to 60000..86400000", description: "Runner self-update check interval.", example: "600000", cost: "network/git usage only" }],
    ["JARVIS_OFFLINE_ALERT_MIN", { scope: "Hub", configure: "hub", defaultValue: "10", format: "non-negative minutes", description: "Delay before a disconnected runner produces an offline alert.", example: "10", cost: "no direct metered cost" }],
    ["JARVIS_HUB", { scope: "Runner and Jarvis MCP server", configure: "runner-mcp", requirement: "conditional", defaultValue: "ws://127.0.0.1:4577", format: "absolute ws:// or wss:// URL", description: "Hub endpoint. Required by runner Compose and for any non-local Hub.", example: "ws://127.0.0.1:4577", cost: "network transport only" }],
    ["JARVIS_TOKEN", { scope: "Runner", configure: "runner", requirement: "conditional", defaultValue: "empty", format: "owner-minted runner token", secret: "yes", description: "Required when the Hub has authentication enabled.", example: "replace-with-generated-runner-token", cost: "no provider charge" }],
    ["JARVIS_LABEL", { scope: "Runner", configure: "runner", defaultValue: "none; runner Compose uses Sandbox", format: "short display text", description: "Friendly registration hint; the Hub can persist/override the label.", example: "Runner", cost: "no direct metered cost" }],
    ["JARVIS_MCP_TOKEN", { scope: "Jarvis MCP server", configure: "mcp", requirement: "conditional", defaultValue: "empty", format: "paired device token", secret: "yes", description: "Required by the MCP bridge when Hub authentication is enabled.", example: "replace-with-paired-device-token", cost: "no provider charge" }],
    ["JARVIS_EXECUTIONS", { defaultValue: "enabled", format: "0 disables; any other value enables", description: "Enables managed execution tracking/listing.", example: "1", cost: "local storage plus selected agent usage" }],
    ["JARVIS_EXECUTION_RETENTION_DAYS", { defaultValue: "30", format: "days; runner clamps to 1..3650, Hub enforces minimum 1", description: "Age before detailed terminal execution events are compacted.", example: "30", cost: "local storage only" }],
    ["JARVIS_EXECUTION_MAX_EVENTS", { defaultValue: "5000", format: "integer; runner clamps to 100..100000, Hub enforces minimum 100", description: "In-memory event window per execution root.", example: "5000", cost: "local memory/storage only" }],
    ["JARVIS_EXECUTION_MAX_CONCURRENCY", { defaultValue: "6", format: "integer; runner clamps to 1..32, Hub enforces minimum 1", description: "Concurrent Jarvis-managed tasks per process.", example: "6" }],
    ["JARVIS_EXECUTION_MAX_DEPTH", { defaultValue: "3", format: "integer; runner clamps to 1..10, Hub enforces minimum 1", description: "Maximum managed execution DAG depth.", example: "3" }],
    ["JARVIS_EXECUTION_DEFAULT_WRITE", { defaultValue: "0", format: "1 enables; every other value disables", description: "Default write permission for managed tasks that omit it.", example: "0", cost: "no direct metered cost" }],
    ["JARVIS_EXECUTION_WORKTREE_ROOT", { defaultValue: "<JARVIS_HOME or OS home>/.jarvis/worktrees", format: "directory path", description: "Validated root for isolated writer worktrees.", example: "C:/work/jarvis-worktrees", cost: "local disk only" }],
    ["JARVIS_CODEX_PRICE_IN", { defaultValue: "1.25", format: "non-negative USD per 1M non-cached input tokens", provider: "Jarvis Codex estimator", description: "Local estimate coefficient from code; it does not alter OpenAI billing.", example: "1.25", cost: "display estimate only; source labels it ballpark, not a quoted price" }],
    ["JARVIS_CODEX_PRICE_CACHED", { defaultValue: "JARVIS_CODEX_PRICE_IN / 10", format: "non-negative USD per 1M cached input tokens", provider: "Jarvis Codex estimator", description: "Cached-input coefficient for the local Codex estimate.", example: "0.125", cost: "display estimate only; not a quoted price" }],
    ["JARVIS_CODEX_PRICE_OUT", { defaultValue: "10", format: "non-negative USD per 1M output tokens", provider: "Jarvis Codex estimator", description: "Output coefficient for the local Codex estimate.", example: "10", cost: "display estimate only; not a quoted price" }],
    ["JARVIS_CODEX_PRICING_VERSION", { defaultValue: "jarvis-ballpark-v1", format: "free-form version label", provider: "Jarvis Codex estimator", description: "Labels the estimate table shown in usage provenance.", example: "jarvis-ballpark-v1", cost: "display metadata only" }],
    ["ANTHROPIC_MODEL", { defaultValue: "none; Jarvis catalog default is opus", format: "Claude model id or alias", provider: "Anthropic / Claude Code", description: "Adds/selects the configured Claude model in Jarvis capability metadata.", configure: "hub-runner", example: "opus" }],
    ["COPILOT_MODEL", { defaultValue: "none (Copilot auto model)", format: "model id listed by Copilot CLI", provider: "GitHub Copilot CLI", description: "Marks a discovered Copilot model as default.", example: "" }],
    ["AIDER_MODEL", { defaultValue: "none; then ~/.aider.conf.yml model", format: "Aider provider/model id", provider: "Aider and its selected model provider", description: "Configured Aider model preference.", example: "" }],
  ]),

  ...entries("Voz e fala", {
    scope: "Hub voice services",
    configure: "hub",
    provider: "Local Python/Piper/Whisper unless stated",
    cost: "local CPU, memory, disk and model downloads; no API price encoded",
  }, [
    ["JARVIS_PYTHON", { defaultValue: "python", format: "Python executable name or path", description: "Interpreter used by STT, TTS, embeddings and speaker identification.", example: "python" }],
    ["JARVIS_VOICE", { defaultValue: "installed pt_BR-faber-medium if available, then another installed voice; code seed en_GB-alan-medium", format: "Piper voice id or openai:<profile>", description: "Startup spoken voice; persisted voice-cfg.json selection has precedence.", example: "pt_BR-faber-medium" }],
    ["JARVIS_TTS_LENGTH", { defaultValue: "1.06", format: "number accepted by Piper length_scale", description: "Piper speech duration/pace tuning.", example: "1.06" }],
    ["JARVIS_TTS_SILENCE", { defaultValue: "0.32", format: "seconds as number", description: "Piper sentence-silence tuning.", example: "0.32" }],
    ["JARVIS_TTS_NOISEW", { defaultValue: "0.9", format: "number accepted by Piper noise_w", description: "Piper prosody/noise-width tuning.", example: "0.9" }],
    ["OPENAI_API_KEY", { requirement: "conditional", defaultValue: "none (OpenAI voices unavailable)", format: "OpenAI API secret", secret: "yes", provider: "OpenAI API", cost: "TTS API usage may be billed by OpenAI; no price is encoded", description: "Preferred credential for optional OpenAI TTS profiles.", example: "replace-with-openai-api-key" }],
    ["JARVIS_OPENAI_TTS_MODEL", { defaultValue: "gpt-4o-mini-tts", format: "OpenAI TTS model id", provider: "OpenAI API", cost: "TTS API usage may be billed by OpenAI; no price is encoded", description: "Model sent to the OpenAI audio/speech endpoint.", example: "gpt-4o-mini-tts" }],
    ["JARVIS_STT_MODEL", { defaultValue: "deepdml/faster-whisper-large-v3-turbo-ct2", format: "faster-whisper model id or local model path", provider: "faster-whisper / model host", description: "Speech-to-text model loaded by the persistent Python service.", example: "deepdml/faster-whisper-large-v3-turbo-ct2" }],
    ["JARVIS_STT_DEVICE", { defaultValue: "cpu", format: "device accepted by faster-whisper", description: "STT execution device.", example: "cpu" }],
    ["JARVIS_STT_COMPUTE", { defaultValue: "int8", format: "compute_type accepted by faster-whisper", description: "STT numeric compute mode.", example: "int8" }],
    ["JARVIS_STT_BEAM", { defaultValue: "1", format: "integer beam size", description: "Default Whisper decode beam.", example: "1" }],
    ["JARVIS_STT_CORRECT", { defaultValue: "enabled", format: "0 disables; any other value enables", provider: "Selected summary agent/provider", cost: "enabled corrections can consume an agent turn; no price is encoded", description: "Best-effort post-STT model correction.", example: "1" }],
    ["JARVIS_EMBED_MODEL", { defaultValue: "all-MiniLM-L6-v2", format: "SentenceTransformer model id or path", provider: "sentence-transformers / model host", description: "Local semantic-memory embedding model.", example: "all-MiniLM-L6-v2" }],
    ["JARVIS_VOICEPRINTS", { defaultValue: "OS home/.jarvis/voiceprints", format: "directory path", description: "Local biometric voiceprint directory; this Python default does not use JARVIS_HOME.", example: "C:/Users/me/.jarvis/voiceprints" }],
    ["JARVIS_VOICE_THRESHOLD", { defaultValue: "0.75 in Python; Hub leaves it unset unless configured", format: "floating-point similarity threshold", description: "Speaker-match threshold shared by Hub voice gate and Python voiceprints; persisted UI config overrides the Hub startup value.", example: "0.75" }],
    ["JARVIS_VOICE_GATE", { defaultValue: "off", format: "1 enables; every other value disables", description: "Hub-side rejection of voice messages from unknown speakers.", example: "0" }],
    ["JARVIS_WAKE", { defaultValue: "enabled", format: "0 disables; any other value enables", description: "Arms/disarms Hub wake-word handling.", example: "1" }],
    ["JARVIS_WAKE_SESSION", { scope: "Hub and Python wake listener", defaultValue: "voice", format: "Jarvis session id", description: "Dedicated wake/voice session id.", example: "voice" }],
    ["JARVIS_WAKE_AGENT", { defaultValue: "JARVIS_AGENT", format: "registered adapter id", provider: "Selected agent provider", cost: "voice turns use the selected provider plan", description: "Startup agent for the voice session; persisted voice config wins.", example: "claude-code" }],
    ["JARVIS_WAKE_CWD", { defaultValue: "JARVIS_CWD", format: "existing directory path", description: "Working directory for proactive voice turns.", example: "C:/work" }],
    ["JARVIS_WAKE_EFFORT", { defaultValue: "none", format: "provider effort id", provider: "Selected agent provider", cost: "higher effort may affect provider usage", description: "Startup effort for voice turns; persisted voice config wins.", example: "low" }],
    ["JARVIS_WAKE_MODEL", { scope: "Hub and Python wake listener", defaultValue: "Hub: none; Python: hey_jarvis", format: "Hub provider model id OR Python openWakeWord model id", provider: "Selected agent provider / openWakeWord", cost: "Hub model can affect provider usage; wakeword inference is local", description: "Overloaded name: Hub voice-turn model and Python wakeword model. Isolate processes or prefer persisted Hub voice config when customizing.", example: "" }],
    ["JARVIS_VOICE_FAST_MODEL", { defaultValue: "haiku", format: "provider model id", provider: "Selected agent provider", cost: "provider usage; no price encoded", description: "Fast-stage model for voice processing.", example: "haiku" }],
    ["JARVIS_VOICE_UPGRADE_MODEL", { defaultValue: "opus", format: "provider model id", provider: "Selected agent provider", cost: "provider usage; no price encoded", description: "Upgrade-stage model for complex voice turns.", example: "opus" }],
    ["JARVIS_VOICE_RELEVANCE", { defaultValue: "on", format: "off disables; other values keep filtering", provider: "Selected agent provider", cost: "relevance checks can consume provider usage", description: "Startup relevance filter for voice utterances; persisted config wins.", example: "on" }],
    ["JARVIS_VOICE_INTENT_MODEL", { defaultValue: "JARVIS_SEARCH_MODEL; ignored if not in adapter catalog", format: "provider model id", provider: "Selected search agent provider", cost: "intent checks can consume provider usage", description: "Preferred model for structured voice-intent parsing.", example: "haiku" }],
    ["JARVIS_ASK", { defaultValue: "enabled", format: "0 disables; any other value enables", provider: "Selected summary agent/provider", cost: "decision extraction can consume an agent turn", description: "Best-effort conversion of assistant questions into decision cards.", example: "1" }],
    ["JARVIS_HUB_WS", { scope: "Python wake listener", configure: "wake", defaultValue: "ws://127.0.0.1:4577", format: "absolute ws:// or wss:// URL", provider: "Jarvis/local", cost: "network transport only", description: "Hub WebSocket endpoint used by the machine wake listener.", example: "ws://127.0.0.1:4577" }],
    ["JARVIS_WAKE_MODEL_FILE", { scope: "Python wake listener", configure: "wake", defaultValue: "none", format: "path to custom .onnx model", provider: "openWakeWord", description: "Optional custom wakeword model file.", example: "C:/models/jarvis.onnx" }],
    ["JARVIS_WAKE_THRESHOLD", { scope: "Python wake listener", configure: "wake", defaultValue: "0.5", format: "floating-point detection threshold", provider: "openWakeWord", description: "Wakeword score threshold.", example: "0.5" }],
    ["JARVIS_WAKE_LANG", { scope: "Python wake listener", configure: "wake", defaultValue: "pt", format: "Whisper language code", provider: "faster-whisper", description: "Language hint for wake-listener transcription.", example: "pt" }],
    ["JARVIS_WAKE_GATE", { scope: "Python wake listener", configure: "wake", defaultValue: "0", format: "1 enables; every other value disables", provider: "Local speaker identification", description: "Drops wake-listener utterances from unknown speakers.", example: "0" }],
  ]),

  ...entries("Contexto pessoal e push", {
    scope: "Hub",
    configure: "hub",
    provider: "Configured local/open-data service",
    cost: "provider policy, quota or self-hosting resources may apply; no price is encoded",
  }, [
    ["JARVIS_CONTEXT_TIMEZONE", { defaultValue: "Mapas Culturais: America/Sao_Paulo; generic feed: UTC", format: "IANA time-zone id", description: "Default timezone for built-in event adapters.", example: "America/Sao_Paulo" }],
    ["JARVIS_EVENTS_ATTRIBUTION", { defaultValue: "Configured open event feed", format: "plain attribution text", description: "Attribution attached to the global event feed.", example: "My event feed" }],
    ["JARVIS_EVENTS_FEED_FORMAT", { defaultValue: "jsonld behavior", format: "ics, rss or jsonld", description: "Parser selected for the global event feed; other values fall back to JSON-LD.", example: "jsonld" }],
    ["JARVIS_EVENTS_FEED_URL", { defaultValue: "none (source disabled)", format: "absolute HTTP(S) URL", description: "Enables a global ICS/RSS/JSON-LD event feed.", example: "https://events.example.invalid/feed.json" }],
    ["JARVIS_MAPAS_CULTURAIS_URL", { defaultValue: "none (source disabled)", format: "absolute HTTP(S) URL", provider: "Configured Mapas Culturais deployment", description: "Enables the global Mapas Culturais adapter.", example: "https://mapas.example.invalid/api/event/find" }],
    ["JARVIS_NOMINATIM_EMAIL", { defaultValue: "none", format: "contact email (not a secret)", provider: "Nominatim / OSMF policy", description: "Optional request identification for a configured public Nominatim endpoint.", example: "operator@example.invalid" }],
    ["JARVIS_NOMINATIM_URL", { defaultValue: "none (integrated geocoding disabled)", format: "credential-free absolute HTTP(S) URL", provider: "Nominatim/OpenStreetMap or self-hosted", description: "Registers the Hub Nominatim source.", example: "http://127.0.0.1:8080/" }],
    ["JARVIS_VALHALLA_URL", { defaultValue: "none (routing disabled)", format: "credential-free absolute HTTP(S) URL", provider: "Valhalla/OpenStreetMap or self-hosted", description: "Registers route and matrix sources.", example: "http://127.0.0.1:8002/" }],
    ["JARVIS_OVERPASS_URL", { defaultValue: "https://overpass-api.de/api/interpreter", format: "credential-free absolute HTTP(S) URL", provider: "Configured Overpass API", description: "Nearby-search endpoint.", example: "https://overpass-api.de/api/interpreter" }],
    ["JARVIS_OPEN_METEO_URL", { defaultValue: "https://api.open-meteo.com/v1/forecast", format: "credential-free absolute HTTP(S) URL", provider: "Open-Meteo or compatible endpoint", description: "Weather forecast endpoint.", example: "https://api.open-meteo.com/v1/forecast" }],
    ["JARVIS_OCM_URL", { defaultValue: "https://api.openchargemap.io/v3/poi/ when key is set", format: "absolute HTTP(S) URL", provider: "Open Charge Map", description: "Open Charge Map endpoint.", example: "https://api.openchargemap.io/v3/poi/" }],
    ["JARVIS_OCM_API_KEY", { requirement: "conditional", defaultValue: "none (OCM source disabled)", format: "Open Charge Map API key", secret: "yes", provider: "Open Charge Map", description: "Enables the dedicated Open Charge Map source.", example: "replace-with-ocm-api-key" }],
    ["JARVIS_PMTILES_FILE", { defaultValue: "none (Hub map archive route disabled)", format: "path to a valid PMTiles v3 file", provider: "Local PMTiles", cost: "local storage only", description: "Archive served by the Hub at the context map route.", example: "./ops/context/runtime/pmtiles/region.pmtiles" }],
    ["JARVIS_MAP_STYLE_FILE", { defaultValue: "none (network-free fallback style)", format: "path to MapLibre style JSON", provider: "Local MapLibre assets", cost: "local storage only", description: "Map style JSON served by the Hub.", example: "./ops/context/map/style.json" }],
    ["JARVIS_PERSONAL_PROACTIVE", { defaultValue: "enabled for opted-in devices", format: "0 disables; 1/enabled otherwise", provider: "Jarvis plus configured personal sources", description: "Global kill switch for the proactive personal scheduler.", example: "1" }],
    ["JARVIS_PERSONAL_PROACTIVE_INTERVAL_MIN", { defaultValue: "5", format: "minutes; runtime minimum 1, doctor accepts 1..10080", provider: "Jarvis plus configured personal sources", description: "Proactive scheduler polling interval.", example: "5" }],
    ["JARVIS_FCM_SA", { requirement: "conditional", defaultValue: "none (native push disabled)", format: "path to Firebase service-account JSON with client_email, private_key and project_id", secret: "pointer", provider: "Google Firebase Cloud Messaging", cost: "Firebase project quota/pricing may apply; no price is encoded", description: "Server credential file for Android/iOS native push. The source explicitly records that live FCM end-to-end verification has not been performed.", example: "C:/secrets/firebase-service-account.json" }],
  ]),

  ...entries("Docker Compose de contexto", {
    scope: "ops/context Compose interpolation",
    configure: "context-compose",
    provider: "Docker plus the selected open-source sidecar",
    cost: "local/self-hosted CPU, memory, storage and network; no price is encoded",
  }, [
    ["COMPOSE_PROJECT_NAME", { defaultValue: "jarvis-context", format: "Docker Compose project name", description: "Namespace for context-sidecar resources.", example: "jarvis-context" }],
    ["COMPOSE_PROFILES", { defaultValue: "empty (no sidecar)", format: "comma-separated nominatim, valhalla, pmtiles or all", description: "Selects optional context sidecars.", example: "" }],
    ["CONTEXT_BIND_HOST", { defaultValue: "127.0.0.1", format: "host bind address", description: "Address used to publish sidecar ports.", example: "127.0.0.1" }],
    ["CONTEXT_NOMINATIM_IMAGE", { defaultValue: "mediagis/nominatim:5.3.2", format: "pinned image tag or digest", provider: "Docker / mediagis Nominatim image", description: "Nominatim container image.", example: "mediagis/nominatim:5.3.2" }],
    ["CONTEXT_NOMINATIM_IMPORT_STYLE", { defaultValue: "full", format: "admin, street, address, full or extratags", provider: "Nominatim", description: "Nominatim import style.", example: "full" }],
    ["CONTEXT_NOMINATIM_PASSWORD", { requirement: "conditional", defaultValue: "empty", format: "database password", secret: "yes", provider: "Nominatim/PostgreSQL container", description: "Required when the nominatim profile is selected; setup generates it.", example: "replace-with-generated-password" }],
    ["CONTEXT_NOMINATIM_PORT", { defaultValue: "8080", format: "host TCP port 1..65535", provider: "Nominatim", description: "Published Nominatim port.", example: "8080" }],
    ["CONTEXT_NOMINATIM_SHM_SIZE", { defaultValue: "1gb", format: "Docker byte-size string", provider: "Docker / Nominatim", description: "Shared-memory size for the Nominatim container.", example: "1gb" }],
    ["CONTEXT_NOMINATIM_THREADS", { defaultValue: "4", format: "integer 1..256", provider: "Nominatim", description: "Nominatim import threads.", example: "4" }],
    ["CONTEXT_NOMINATIM_WORKERS", { defaultValue: "2", format: "integer 1..256", provider: "Nominatim", description: "Nominatim HTTP workers.", example: "2" }],
    ["CONTEXT_PBF_FILE", { requirement: "conditional", defaultValue: "./runtime/imports/region.osm.pbf", format: "path to non-empty .osm.pbf file", provider: "OpenStreetMap extract", description: "Read-only PBF mounted for Nominatim/Valhalla profiles.", example: "./runtime/imports/region.osm.pbf" }],
    ["CONTEXT_PMTILES_ARCHIVE", { defaultValue: "region.pmtiles", format: "basename ending in .pmtiles", provider: "PMTiles", description: "Archive name inside CONTEXT_PMTILES_DIR.", example: "region.pmtiles" }],
    ["CONTEXT_PMTILES_CORS", { defaultValue: "http://127.0.0.1:4577", format: "comma-separated credential-free HTTP(S) origins", provider: "go-pmtiles", description: "CORS origins for the sidecar tile server.", example: "http://127.0.0.1:4577" }],
    ["CONTEXT_PMTILES_DIR", { requirement: "conditional", defaultValue: "./runtime/pmtiles", format: "directory path", provider: "PMTiles", description: "Read-only archive directory mounted by the pmtiles profile.", example: "./runtime/pmtiles" }],
    ["CONTEXT_PMTILES_IMAGE", { defaultValue: "protomaps/go-pmtiles:v1.31.2", format: "pinned image tag or digest", provider: "Docker / Protomaps go-pmtiles", description: "PMTiles sidecar image.", example: "protomaps/go-pmtiles:v1.31.2" }],
    ["CONTEXT_PMTILES_PORT", { defaultValue: "8081", format: "host TCP port 1..65535", provider: "go-pmtiles", description: "Published PMTiles sidecar port.", example: "8081" }],
    ["CONTEXT_PMTILES_PUBLIC_URL", { defaultValue: "http://127.0.0.1:8081", format: "credential-free absolute HTTP(S) URL", provider: "go-pmtiles", description: "Public URL advertised in TileJSON.", example: "http://127.0.0.1:8081" }],
    ["CONTEXT_VALHALLA_DIR", { requirement: "conditional", defaultValue: "./runtime/valhalla", format: "directory path", provider: "Valhalla", description: "Persistent graph/config directory.", example: "./runtime/valhalla" }],
    ["CONTEXT_VALHALLA_IMAGE", { defaultValue: "ghcr.io/valhalla/valhalla-scripted:3.8.3", format: "pinned image tag or digest", provider: "Docker / Valhalla scripted image", description: "Valhalla container image.", example: "ghcr.io/valhalla/valhalla-scripted:3.8.3" }],
    ["CONTEXT_VALHALLA_PORT", { defaultValue: "8002", format: "host TCP port 1..65535", provider: "Valhalla", description: "Published Valhalla port.", example: "8002" }],
    ["CONTEXT_VALHALLA_THREADS", { defaultValue: "2", format: "integer 1..256", provider: "Valhalla", description: "Valhalla service/build thread count.", example: "2" }],
  ]),

  ...entries("Clientes e build", {
    scope: "Desktop/mobile/tooling",
    configure: "shell",
    classification: "tool",
    provider: "Platform tooling",
    cost: "no direct metered cost; downloads/build infrastructure may apply",
  }, [
    ["JARVIS_APP_HUB_URL", { scope: "Electron desktop and Capacitor build", configure: "desktop-mobile", defaultValue: "Desktop: http://127.0.0.1:4577; mobile: no remote server URL", format: "HTTP(S) origin; ws(s) is normalized to http(s)", classification: "public", description: "Desktop target and build-time Capacitor server.url. It is not a mobile runtime variable.", example: "https://jarvis.example.invalid" }],
    ["ANDROID_HOME", { defaultValue: "none; SDK auto-discovery follows", format: "Android SDK directory", provider: "Android SDK", description: "First explicit Android SDK candidate.", example: "C:/Users/me/AppData/Local/Android/Sdk" }],
    ["ANDROID_SDK_ROOT", { defaultValue: "none; checked after ANDROID_HOME", format: "Android SDK directory", provider: "Android SDK", description: "Second explicit Android SDK candidate.", example: "C:/Users/me/AppData/Local/Android/Sdk" }],
    ["ANDROID_SDK", { defaultValue: "none; checked after ANDROID_SDK_ROOT", format: "Android SDK directory", provider: "Android SDK", description: "Compatibility SDK-path candidate; prefer ANDROID_HOME or ANDROID_SDK_ROOT.", example: "C:/Users/me/AppData/Local/Android/Sdk" }],
    ["ELECTRON_MIRROR", { defaultValue: "Electron installer default", format: "download mirror base URL", provider: "Electron npm installer", description: "Optional installer mirror mentioned for proxy/firewall environments; consumed by Electron tooling, not Jarvis code.", example: "https://mirror.example.invalid/electron/", detect: false, sources: ["scripts/install-desktop.ps1", "scripts/install-desktop.sh"] }],
  ]),

  ...entries("Internas e legadas", {
    scope: "Tests/subprocesses/provider internals",
    configure: "do-not-set",
    classification: "internal",
    userSettable: false,
    provider: "Jarvis/internal",
    cost: "no direct metered cost",
  }, [
    ["JARVIS_ENABLE_MOCK", { defaultValue: "off", format: "1 enables", description: "Test-only gate for the mock adapter." }],
    ["NODE_ENV", { defaultValue: "not set by Jarvis", format: "test has special meaning", classification: "internal", provider: "Node.js/tooling", description: "Only exact test enables the mock adapter without JARVIS_ENABLE_MOCK." }],
    ["JARVIS_CLAUDE_HOME", { defaultValue: "OS home/.claude", format: "directory path", description: "Test override for Claude command/skill discovery; production comments say to leave unset." }],
    ["JARVIS_CODEX_HOME", { defaultValue: "OS home/.codex", format: "directory path", description: "Test override for Codex discovery; production comments say to leave unset." }],
    ["JARVIS_CLAUDE_JSON", { defaultValue: "OS home/.claude.json", format: "JSON file path", description: "Test override for Claude MCP discovery." }],
    ["JARVIS_CODEX_CONFIG", { defaultValue: "<JARVIS_CODEX_HOME>/config.toml", format: "TOML file path", description: "Test/advanced override for Codex MCP discovery." }],
    ["JARVIS_CLAUDE_DIR", { defaultValue: "OS home/.claude/projects", format: "directory path", description: "Test override for native Claude session history." }],
    ["JARVIS_CODEX_DIR", { defaultValue: "OS home/.codex/sessions", format: "directory path", description: "Test override for native Codex session history." }],
    ["JARVIS_FRAMEWORK_HOME", { defaultValue: "<JARVIS_HOME or OS home>/.jarvis/framework", format: "directory path", description: "Dedicated framework-root test override." }],
    ["JARVIS_PERSONAL_UI_PORT", { defaultValue: "43917", format: "local TCP port 1..65535", description: "Playwright personal-assistant fixture port; injected by the test runner." }],
    ["JARVIS_MCP_SECRET", { defaultValue: "not created without a source secretRef", format: "resolved secret value", secret: "yes", description: "Fixed child-process key populated internally for a configured personal MCP source." }],
    ["PYTHONUTF8", { defaultValue: "set to 1 for Jarvis Python children", format: "1", provider: "Python runtime", description: "Injected by the Hub; do not place it in Jarvis env files." }],
    ["PYTHONIOENCODING", { defaultValue: "set to utf-8 for Jarvis Python children", format: "encoding name", provider: "Python runtime", description: "Injected by the Hub for Python stdio." }],
    ["GIT_TERMINAL_PROMPT", { defaultValue: "set to 0 for update/install probes", format: "0", provider: "Git", description: "Injected internally so unattended Git checks never prompt." }],
    ["CAP_PLUGIN_PUBLISH", { defaultValue: "unset/false", format: "true selects published Capacitor dependency", provider: "Capacitor/Gradle", description: "Plugin-publishing build switch; regular app builds must not set it." }],
    ["CAPACITOR_VERSION", { requirement: "conditional", defaultValue: "none", format: "Capacitor dependency version", provider: "Capacitor/Gradle", description: "Used only with CAP_PLUGIN_PUBLISH=true by plugin publishing." }],
    ["JARVIS_OPENAI_API_KEY", { defaultValue: "none", format: "OpenAI API secret", secret: "yes", classification: "legacy", provider: "OpenAI API", cost: "TTS API usage may be billed; no price is encoded", description: "Compatibility alias for OpenAI TTS. OPENAI_API_KEY has precedence; do not set both." }],
  ]),

  ...entries("Ambiente do SO e CI", {
    scope: "Operating system or CI",
    configure: "do-not-set",
    classification: "os",
    userSettable: false,
    provider: "Operating system/toolchain",
    cost: "no direct metered cost",
  }, [
    ["HOME", { defaultValue: "provided by OS", format: "home directory path", description: "Unix home and Android SDK/build fallback." }],
    ["USERPROFILE", { defaultValue: "provided by Windows", format: "home directory path", description: "Windows state/config root and Android build fallback." }],
    ["USERNAME", { defaultValue: "provided by Windows", format: "account name", description: "Scheduled-task owner." }],
    ["USER", { defaultValue: "provided by Unix", format: "account name", description: "Shown in the loginctl enable-linger hint." }],
    ["PATH", { defaultValue: "provided by OS; Windows launchers prepend Node and user-local bin", format: "OS path list", description: "CLI resolution and child-process environment." }],
    ["PATHEXT", { defaultValue: ".EXE;.CMD;.BAT on Windows when absent", format: "semicolon-separated extensions", description: "Windows CLI executable resolution." }],
    ["ComSpec", { defaultValue: "cmd.exe when absent", format: "Windows command processor path", description: "Executes .cmd/.bat provider shims without shell string interpolation." }],
    ["SHELL", { defaultValue: "bash when absent on Unix", format: "shell executable path", description: "Unix managed-terminal default." }],
    ["APPDATA", { defaultValue: "OS value; fallback OS home/AppData/Roaming", format: "directory path", description: "Windows Start Menu shortcut directory base." }],
    ["LOCALAPPDATA", { defaultValue: "OS value; fallback OS home/AppData/Local", format: "directory path", description: "Windows Android SDK auto-discovery base." }],
    ["XDG_DATA_HOME", { defaultValue: "OS home/.local/share when absent", format: "directory path", description: "Linux desktop-entry base." }],
    ["BASH_VERSION", { defaultValue: "provided by Bash", format: "version string", description: "Selects .bashrc instead of .zshrc in the desktop installer." }],
    ["GITHUB_OUTPUT", { defaultValue: "provided by GitHub Actions", format: "file path", classification: "ci", provider: "GitHub Actions", description: "Workflow command file for release outputs." }],
    ["GITHUB_TOKEN", { defaultValue: "provided by GitHub Actions secrets context", format: "GitHub token", secret: "yes", classification: "ci", provider: "GitHub Actions / semantic-release", cost: "GitHub plan/runner billing may apply; no price is encoded", description: "Mapped into semantic-release for repository release operations." }],
    ["GH_TOKEN", { defaultValue: "mapped from GITHUB_TOKEN in release workflow", format: "GitHub token", secret: "yes", classification: "ci", provider: "GitHub Actions / electron-builder", cost: "GitHub plan/runner billing may apply; no price is encoded", description: "Electron-builder GitHub publishing credential." }],
    ["CSC_IDENTITY_AUTO_DISCOVERY", { defaultValue: "false in release workflow", format: "boolean string", classification: "ci", provider: "electron-builder", description: "Disables signing-identity auto-discovery for currently unsigned builds." }],
  ]),

  ...entries("Internas dos containers", {
    scope: "Container environment generated by ops/context/compose.yaml",
    configure: "do-not-set",
    classification: "internal",
    userSettable: false,
    provider: "Nominatim or Valhalla container",
    cost: "covered by local/self-hosted container resources",
  }, [
    ["PBF_PATH", { defaultValue: "/nominatim/data/region.osm.pbf", format: "container path", description: "Nominatim internal PBF path." }],
    ["NOMINATIM_PASSWORD", { defaultValue: "copied from CONTEXT_NOMINATIM_PASSWORD", format: "database password", secret: "yes", description: "Nominatim container credential mapping." }],
    ["UPDATE_MODE", { defaultValue: "none", format: "Nominatim mode", description: "Disables replication updates in the pinned sidecar." }],
    ["FREEZE", { defaultValue: "false", format: "boolean string", description: "Nominatim image control." }],
    ["IMPORT_STYLE", { defaultValue: "copied from CONTEXT_NOMINATIM_IMPORT_STYLE", format: "Nominatim import style", description: "Nominatim container import style." }],
    ["IMPORT_WIKIPEDIA", { defaultValue: "false", format: "boolean string", description: "Nominatim optional import disabled." }],
    ["IMPORT_SECONDARY_WIKIPEDIA", { defaultValue: "false", format: "boolean string", description: "Nominatim optional import disabled." }],
    ["IMPORT_US_POSTCODES", { defaultValue: "false", format: "boolean string", description: "Nominatim optional import disabled." }],
    ["IMPORT_GB_POSTCODES", { defaultValue: "false", format: "boolean string", description: "Nominatim optional import disabled." }],
    ["IMPORT_TIGER_ADDRESSES", { defaultValue: "false", format: "boolean string", description: "Nominatim optional import disabled." }],
    ["THREADS", { defaultValue: "copied from CONTEXT_NOMINATIM_THREADS", format: "integer", description: "Nominatim internal thread setting." }],
    ["GUNICORN_WORKERS", { defaultValue: "copied from CONTEXT_NOMINATIM_WORKERS", format: "integer", description: "Nominatim internal HTTP worker setting." }],
    ["serve_tiles", { defaultValue: "True", format: "boolean string", description: "Valhalla scripted-image server switch." }],
    ["use_tiles_ignore_pbf", { defaultValue: "True", format: "boolean string", description: "Valhalla scripted-image tile preference." }],
    ["force_rebuild", { defaultValue: "False", format: "boolean string", description: "Valhalla graph rebuild control." }],
    ["build_tar", { defaultValue: "True", format: "boolean string", description: "Valhalla tile archive build control." }],
    ["build_admins", { defaultValue: "True", format: "boolean string", description: "Valhalla admin database build control." }],
    ["build_time_zones", { defaultValue: "True", format: "boolean string", description: "Valhalla timezone build control." }],
    ["build_elevation", { defaultValue: "False", format: "boolean string", description: "Valhalla elevation build disabled." }],
    ["build_transit", { defaultValue: "False", format: "boolean string", description: "Valhalla transit build disabled." }],
    ["use_default_speeds_config", { defaultValue: "False", format: "boolean string", description: "Valhalla default-speeds config switch." }],
    ["update_existing_config", { defaultValue: "True", format: "boolean string", description: "Valhalla existing-config update switch." }],
    ["traffic_name", { defaultValue: "empty", format: "text", description: "Valhalla traffic dataset name." }],
    ["server_threads", { defaultValue: "copied from CONTEXT_VALHALLA_THREADS", format: "integer", description: "Valhalla internal server thread count." }],
    ["tileset_name", { defaultValue: "jarvis_context", format: "identifier", description: "Valhalla internal tileset name." }],
  ]),
];

export const ENVIRONMENT_CATALOG = Object.freeze(CATALOG);
export const CATALOG_BY_NAME = new Map(ENVIRONMENT_CATALOG.map((entry) => [entry.name, entry]));

const SKIP_DIRS = new Set([".git", ".idea", ".vscode", "node_modules", "dist", "build", "coverage", "vendor"]);
const JS_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SHELL_OS_NAMES = new Set(["BASH_VERSION", "GITHUB_OUTPUT", "HOME", "PATH", "SHELL", "USER"]);
const GENERATED_DIRS = new Set(["mobile/android", "mobile/ios", "mobile/www"]);

function normalizedPath(path) {
  return path.replaceAll("\\", "/");
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function addUse(uses, name, path, line, syntax) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
  if (!uses.has(name)) uses.set(name, []);
  const key = path + ":" + line + ":" + syntax;
  if (!uses.get(name).some((item) => item.key === key)) uses.get(name).push({ key, path, line, syntax });
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function unwrap(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current))) current = current.expression;
  return current;
}

function isProcessEnv(node) {
  const value = unwrap(node);
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text === "env"
      && ts.isIdentifier(unwrap(value.expression))
      && unwrap(value.expression).text === "process";
  }
  if (!ts.isElementAccessExpression(value)) return false;
  const object = unwrap(value.expression);
  const argument = value.argumentExpression && unwrap(value.argumentExpression);
  return ts.isIdentifier(object)
    && object.text === "process"
    && Boolean(argument)
    && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    && argument.text === "env";
}

function aliasInitializer(node, aliases) {
  const value = unwrap(node);
  if (isProcessEnv(value)) return true;
  if (ts.isIdentifier(value)) return aliases.has(value.text);
  if (ts.isBinaryExpression(value)
    && (value.operatorToken.kind === ts.SyntaxKind.BarBarToken || value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return aliasInitializer(value.left, aliases) || aliasInitializer(value.right, aliases);
  }
  if (ts.isConditionalExpression(value)) {
    return aliasInitializer(value.whenTrue, aliases) || aliasInitializer(value.whenFalse, aliases);
  }
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.some((property) => ts.isSpreadAssignment(property) && aliasInitializer(property.expression, aliases));
  }
  return false;
}

function scanJavaScript(text, path, uses) {
  const testFile = /\.(?:test|spec)\.[^/]+$/.test(path);
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX
    : path.endsWith(".jsx") ? ts.ScriptKind.JSX
      : path.endsWith(".js") || path.endsWith(".cjs") || path.endsWith(".mjs") ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const candidates = [];
  const collect = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node))
      && ts.isIdentifier(node.name)
      && node.initializer) candidates.push({ name: node.name.text, initializer: node.initializer });
    ts.forEachChild(node, collect);
  };
  collect(source);
  const aliases = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (!aliases.has(candidate.name) && aliasInitializer(candidate.initializer, aliases)) {
        aliases.add(candidate.name);
        changed = true;
      }
    }
  }
  const record = (name, node, syntax) => {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    addUse(uses, name, path, pos.line + 1, syntax);
  };
  const objectLiterals = (node, output = []) => {
    const value = unwrap(node);
    if (ts.isObjectLiteralExpression(value)) output.push(value);
    else if (ts.isConditionalExpression(value)) {
      objectLiterals(value.whenTrue, output);
      objectLiterals(value.whenFalse, output);
    } else if (ts.isBinaryExpression(value)
      && (value.operatorToken.kind === ts.SyntaxKind.BarBarToken || value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      objectLiterals(value.left, output);
      objectLiterals(value.right, output);
    }
    return output;
  };
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node))
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && aliasInitializer(node.initializer, aliases)) {
      for (const element of node.name.elements) {
        if (element.dotDotDotToken) continue;
        const name = propertyName(element.propertyName || element.name);
        if (name) record(name, element, "javascript-destructure");
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const base = unwrap(node.expression);
      if (isProcessEnv(base) || (ts.isIdentifier(base) && aliases.has(base.text))) record(node.name.text, node, "javascript");
    } else if (ts.isElementAccessExpression(node)) {
      const base = unwrap(node.expression);
      const argument = node.argumentExpression && unwrap(node.argumentExpression);
      if ((isProcessEnv(base) || (ts.isIdentifier(base) && aliases.has(base.text)))
        && argument
        && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) record(argument.text, node, "javascript");
    } else if (ts.isPropertyAssignment(node)) {
      const key = propertyName(node.name);
      const value = unwrap(node.initializer);
      const environmentObject = key === "env"
        && ts.isObjectLiteralExpression(value)
        && value.properties.some((property) => ts.isSpreadAssignment(property) && aliasInitializer(property.expression, aliases));
      const secretObjects = key === "secretEnv" && !testFile ? objectLiterals(value) : [];
      const objects = environmentObject ? [value] : secretObjects;
      for (const object of objects) {
        for (const property of object.properties) {
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
            const name = propertyName(property.name);
            if (name) record(name, property, secretObjects.length ? "secret-env-object" : "child-env-object");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function scanRegex(text, path, uses, regex, syntax, group = 1) {
  for (const match of text.matchAll(regex)) addUse(uses, match[group], path, lineAt(text, match.index), syntax);
}

function scanPython(text, path, uses) {
  scanRegex(text, path, uses, /\bos\.(?:getenv|environ\.get)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g, "python");
  scanRegex(text, path, uses, /\bos\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g, "python");
}

function stripPowerShellComments(text) {
  return text.replace(/<#[\s\S]*?#>/g, "").split(/\r?\n/).map((line) => line.replace(/\s+#.*$/, "")).join("\n");
}

function scanPowerShell(text, path, uses) {
  const code = stripPowerShellComments(text);
  scanRegex(code, path, uses, /\$env:([A-Za-z_][A-Za-z0-9_]*)/g, "powershell");
  scanRegex(code, path, uses, /\[Environment\]::SetEnvironmentVariable\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g, "powershell");
}

function stripShellComments(text) {
  return text.split(/\r?\n/).map((line) => /^\s*#/.test(line) ? "" : line.replace(/\s+#.*$/, "")).join("\n");
}

function scanShell(text, path, uses) {
  const code = stripShellComments(text);
  const locals = new Set();
  for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=/g)) locals.add(match[1]);
  const references = [
    ...code.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g),
    ...code.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g),
  ];
  for (const match of references) {
    const name = match[1];
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
    if (locals.has(name) && !name.startsWith("JARVIS_") && !SHELL_OS_NAMES.has(name)) continue;
    addUse(uses, name, path, lineAt(code, match.index), "shell");
  }
  for (const match of code.matchAll(/\bexport\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (name.startsWith("JARVIS_")) addUse(uses, name, path, lineAt(code, match.index), "shell-export");
  }
}

function scanYaml(text, path, uses) {
  scanRegex(text, path, uses, /\$\{([A-Za-z_][A-Za-z0-9_]*)(?=[:}])/g, "compose-interpolation");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = /^(\s*)(env|environment):\s*(?:#.*)?$/.exec(lines[i]);
    if (!header) continue;
    const indent = header[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const childIndent = /^\s*/.exec(line)[0].length;
      if (childIndent <= indent) break;
      const map = /^\s+([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
      const list = /^\s+-\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
      const name = map?.[1] || list?.[1];
      if (name) addUse(uses, name, path, j + 1, "yaml-env-map");
    }
  }
  scanRegex(text, path, uses, /\$([A-Z][A-Z0-9_]*)\b/g, "yaml-shell");
}

function scanGradle(text, path, uses) {
  scanRegex(text, path, uses, /\bSystem\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\)/g, "gradle");
}

function scanDockerfile(text, path, uses) {
  scanRegex(text, path, uses, /^\s*ENV\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm, "dockerfile");
}

function scanDotenv(text, path, uses) {
  scanRegex(text, path, uses, /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm, "dotenv-example");
}

function shouldSkip(relativePath, entryName, isDirectory) {
  const normalized = normalizedPath(relativePath);
  if (isDirectory && SKIP_DIRS.has(entryName)) return true;
  if (isDirectory && GENERATED_DIRS.has(normalized)) return true;
  if (normalized === "docs" || normalized.startsWith("docs/")) return true;
  if (normalized === "scripts/environment-catalog.mjs" || normalized === "scripts/environment-catalog.test.mjs") return true;
  if (/(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json)$/.test(normalized)) return true;
  if (/\.(?:tgz|zip|gz|png|jpg|jpeg|gif|ico|pdf|apk|aab|ipa)$/i.test(normalized)) return true;
  if (normalized === EXAMPLE_FILE) return true;
  if (entryName === ".env" || (/^\.env\./.test(entryName) && !entryName.endsWith(".example"))) return true;
  return false;
}

async function listFiles(root, directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const rel = relative(root, full);
    if (shouldSkip(rel, entry.name, entry.isDirectory())) continue;
    if (entry.isDirectory()) output.push(...await listFiles(root, full));
    else if (entry.isFile()) output.push(full);
  }
  return output.sort((left, right) => left.localeCompare(right));
}

export async function scanRepository(repoRoot = DEFAULT_REPO_ROOT) {
  const root = resolve(repoRoot);
  const uses = new Map();
  for (const file of await listFiles(root)) {
    const rel = normalizedPath(relative(root, file));
    const ext = extname(file).toLowerCase();
    const name = basename(file);
    const dotenv = name === "env.example" || (/^\.env(?:\..+)?\.example$/.test(name)) || name === ".env.runner.example";
    const supported = JS_EXTENSIONS.has(ext)
      || [".py", ".ps1", ".sh", ".bash", ".yaml", ".yml", ".gradle", ".json"].includes(ext)
      || dotenv
      || /^Dockerfile(?:\.|$)/.test(name)
      || ext === "";
    if (!supported) continue;
    let text;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    if (JS_EXTENSIONS.has(ext)) scanJavaScript(text, rel, uses);
    if (ext === ".py") scanPython(text, rel, uses);
    if (ext === ".ps1") scanPowerShell(text, rel, uses);
    if (ext === ".sh" || ext === ".bash" || (ext === "" && /^#!.*\b(?:ba|z|k)?sh\b/.test(text))) scanShell(text, rel, uses);
    if (ext === ".yaml" || ext === ".yml") scanYaml(text, rel, uses);
    if (ext === ".gradle") scanGradle(text, rel, uses);
    if (ext === ".json") scanRegex(text, rel, uses, /\$([A-Z][A-Z0-9_]*)\b/g, "json-shell");
    if (/^Dockerfile(?:\.|$)/.test(name)) scanDockerfile(text, rel, uses);
    if (dotenv) scanDotenv(text, rel, uses);
  }
  for (const records of uses.values()) records.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.syntax.localeCompare(right.syntax));
  return new Map([...uses.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function validateCatalog() {
  const problems = [];
  const names = new Set();
  const requirements = new Set(["optional", "conditional", "internal"]);
  const classifications = new Set(["public", "tool", "internal", "legacy", "os", "ci"]);
  const secretValues = new Set(["no", "yes", "pointer"]);
  const fields = ["group", "scope", "defaultValue", "format", "provider", "cost", "configure", "description"];
  for (const entry of ENVIRONMENT_CATALOG) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)) problems.push("invalid name: " + entry.name);
    if (names.has(entry.name)) problems.push("duplicate catalog entry: " + entry.name);
    names.add(entry.name);
    if (!requirements.has(entry.requirement)) problems.push(entry.name + ": invalid requirement");
    if (!classifications.has(entry.classification)) problems.push(entry.name + ": invalid classification");
    if (!secretValues.has(entry.secret)) problems.push(entry.name + ": invalid secret marker");
    for (const field of fields) if (typeof entry[field] !== "string" || !entry[field].trim()) problems.push(entry.name + ": missing " + field);
    if (entry.userSettable && !Object.hasOwn(entry, "example")) problems.push(entry.name + ": user-settable entry has no example");
    if (!entry.userSettable && Object.hasOwn(entry, "example")) problems.push(entry.name + ": do-not-set entry has an example");
    if (entry.detect === false && (!Array.isArray(entry.sources) || !entry.sources.length)) problems.push(entry.name + ": undetected entry needs explicit sources");
  }
  return problems;
}

function uniquePaths(records) {
  return [...new Set((records || []).map((record) => record.path))].sort((left, right) => left.localeCompare(right));
}

function markdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function code(value) {
  return TICK + String(value).replaceAll(TICK, "") + TICK;
}

function requirementLabel(entry) {
  if (entry.requirement === "conditional") return "conditional";
  if (!entry.userSettable) return "managed";
  return "optional";
}

function secretLabel(value) {
  if (value === "yes") return "yes";
  if (value === "pointer") return "credential file path";
  return "no";
}

function sourceLabel(entry, uses) {
  const paths = uniquePaths(uses.get(entry.name));
  const sources = paths.length ? paths : (entry.sources || []);
  return sources.map((path) => code(path)).join("<br>") || "catalog metadata";
}

const CONFIGURATION_LOCATIONS = [
  ["hub", "%USERPROFILE%\\.jarvis\\hub.env", "$HOME/.jarvis/hub.env", "not injected automatically", "server-side only"],
  ["runner", "%USERPROFILE%\\.jarvis\\runner.env", "$HOME/.jarvis/runner.env", "root .env for docker-compose.runner.yml", "not applicable"],
  ["hub-runner", "the applicable hub.env and/or runner.env", "the applicable hub.env and/or runner.env", "runner root .env only for values passed by runner Compose", "not applicable"],
  ["runner-mcp", "runner.env or MCP client env map", "runner.env or MCP client env map", "root .env for runner; MCP is separate", "not applicable"],
  ["mcp", "MCP client/server env map", "MCP client/server env map", "not applicable", "not applicable"],
  ["hub-mobile-build", "hub.env; mobile build process can inherit it", "hub.env; mobile build process can inherit it", "not applicable", "build-time fallback only"],
  ["wake", "hub.env is loaded by start-wake.ps1", "export for the manually managed wake process", "not applicable", "not a phone runtime env"],
  ["context-compose", "ops/context/.env", "ops/context/.env", "docker compose --env-file ops/context/.env", "not applicable"],
  ["desktop-mobile", "User env or install-desktop.ps1 -HubUrl", "shell rc or install-desktop.sh --hub", "not applicable", "set in the build process; embedded by Capacitor"],
  ["shell", "current/user shell environment", "current shell environment", "not loaded from Compose unless explicitly mapped", "build tooling only"],
  ["do-not-set", "provided or injected internally", "provided or injected internally", "provided or injected internally", "no runtime setting"],
];

export function renderDocumentation(uses) {
  const lines = [
    "# Catalogo central de variaveis de ambiente",
    "",
    "Este arquivo e gerado por " + code("scripts/environment-catalog.mjs") + ". A fonte estruturada de metadados e " + code("ENVIRONMENT_CATALOG") + "; os caminhos de uso abaixo vem de uma varredura estatica do repositorio. Edite o catalogo e rode " + code("node scripts/environment-catalog.mjs --write") + ", nao altere as tabelas manualmente.",
    "",
    "Nenhuma variavel e obrigatoria para todo o produto. Entradas " + code("conditional") + " sao obrigatorias apenas para o recurso indicado (por exemplo, runner autenticado, MCP autenticado, OpenAI TTS ou um profile de contexto). Valor vazio e ausencia podem ter comportamentos diferentes; remova a variavel quando quiser o fallback descrito.",
    "",
    "## Onde configurar",
    "",
    "| Codigo | Windows | Linux/macOS | Compose | Mobile |",
    "|---|---|---|---|---|",
    ...CONFIGURATION_LOCATIONS.map((row) => "| " + row.map(markdown).join(" | ") + " |"),
    "",
    "O arquivo raiz " + code(".env") + " e lido automaticamente apenas pelo Docker Compose do runner. O Hub nao le o " + code(".env") + " raiz: os launchers carregam " + code("hub.env") + ". O Compose de contexto usa " + code("ops/context/.env") + ". O app mobile nao possui ambiente de runtime; " + code("JARVIS_APP_HUB_URL") + " e incorporada no build.",
    "",
    "## Custo e segredo",
    "",
    "Os defaults de custo abaixo sao apenas os coeficientes literalmente presentes no codigo. O catalogo nao fixa precos de fornecedores. Frases como \"provider plan may charge\" indicam que plano, quota e tarifa ficam fora deste repositorio. " + code("secret: pointer") + " significa que o valor e um caminho para um arquivo de credencial, que deve receber a mesma protecao do segredo.",
    "",
  ];
  for (const groupName of [...new Set(ENVIRONMENT_CATALOG.map((entry) => entry.group))]) {
    lines.push("## " + groupName, "");
    lines.push("| Variavel | Req./classe | Escopo / configurar | Default efetivo | Formato / segredo | Fornecedor / custo | Uso real | Detectada em |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const entry of ENVIRONMENT_CATALOG.filter((item) => item.group === groupName)) {
      const req = requirementLabel(entry) + " / " + entry.classification + (entry.userSettable ? "" : " / nao definir");
      const scope = entry.scope + " / " + entry.configure;
      const format = entry.format + " / secret: " + secretLabel(entry.secret);
      const provider = entry.provider + "; " + entry.cost;
      lines.push("| " + code(entry.name) + " | " + markdown(req) + " | " + markdown(scope) + " | " + markdown(entry.defaultValue) + " | " + markdown(format) + " | " + markdown(provider) + " | " + markdown(entry.description) + " | " + sourceLabel(entry, uses) + " |");
    }
    lines.push("");
  }
  lines.push(
    "## Nomes dinamicos e ambiente herdado",
    "",
    "Conexoes CalDAV, Home Assistant e MCP podem apontar " + code("secretRef") + " para qualquer nome que respeite " + code("^[A-Z][A-Z0-9_]{1,100}$") + ". O acesso e computado (" + code("env[secretRef]") + "), portanto esses nomes escolhidos pelo operador nao sao entradas estaticas do catalogo. O nome e o valor devem existir apenas no ambiente do processo do Hub. Para MCP stdio, o valor resolvido e repassado internamente como " + code("JARVIS_MCP_SECRET") + ".",
    "",
    "O Hub tambem repassa o ambiente herdado para terminais, CLIs e subprocessos. Chaves de autenticacao que pertencem a uma CLI de terceiros podem, portanto, funcionar sem aparecer aqui. Esse conjunto depende da maquina e da versao do fornecedor e nao pode ser enumerado estaticamente sem inventar um contrato que o Jarvis nao possui.",
    "",
    "O detector reconhece apenas nomes literais: " + code("process.env.NAME") + ", " + code("process.env['NAME']") + ", desestruturacao e aliases estaticos de " + code("process.env") + ", APIs Python/PowerShell/Gradle, expansoes de shell, " + code("ENV") + " de Dockerfile, interpolacao/mapeamento de Compose, dotenv de exemplo e blocos " + code("env:") + " de workflow. Expressoes construidas como " + code("process.env[prefix + name]") + " e " + code("env[secretRef]") + " sao ignoradas de proposito.",
    "",
    "Dependencias, artefatos e arvores geradas nao fazem parte da auditoria: " + code("node_modules") + ", " + code("dist") + ", " + code("build") + ", " + code("vendor") + ", " + code("mobile/android") + ", " + code("mobile/ios") + " e " + code("mobile/www") + ". Documentacao e lockfiles tambem nao sao tratados como consumidores. Testes do projeto sao varridos; apenas os dois arquivos do proprio catalogo sao excluidos para que fixtures negativas nao se autocataloguem.",
    "",
    "## Colisoes e precedencia",
    "",
    "- " + code("JARVIS_WAKE_MODEL") + " tem dois significados: modelo do agente de voz no Hub e modelo wakeword no listener Python. O listener Windows carrega hub.env; ao customizar, use configuracao persistida do Hub ou ambientes de processo isolados.",
    "- " + code("JARVIS_VOICE_THRESHOLD") + " e compartilhada pelo gate do Hub e pelo voiceprint Python; a configuracao persistida pela UI vence no Hub.",
    "- No launcher Windows do Hub, " + code("JARVIS_CWD") + " e forçada para a raiz do repositorio depois da leitura de hub.env.",
    "- " + code("OPENAI_API_KEY") + " tem precedencia sobre o alias legado " + code("JARVIS_OPENAI_API_KEY") + ".",
    "- Variaveis ja exportadas no shell tem precedencia sobre valores do env-file na interpolacao do Docker Compose.",
    "",
    "## Auditoria",
    "",
    "Execute offline:",
    "",
    "    node scripts/environment-catalog.mjs --check",
    "    node --test scripts/environment-catalog.test.mjs",
    "",
    "Use " + code("--json") + " para obter catalogo, arquivos/linhas detectados e lacunas em formato estruturado. Use " + code("--write") + " depois de atualizar os metadados. O teste nao esta ligado a " + code("package.json") + " porque esse arquivo esta fora do ownership desta entrega.",
    "",
  );
  return lines.join("\n");
}

export function renderEnvExample() {
  const lines = [
    "# Central reference generated by scripts/environment-catalog.mjs.",
    "# Nothing here is loaded universally. Copy only the relevant lines to:",
    "#   Hub Windows: %USERPROFILE%\\.jarvis\\hub.env",
    "#   Hub Linux/macOS: $HOME/.jarvis/hub.env",
    "#   Runner: the matching runner.env; runner Compose: root .env",
    "#   Context Compose: ops/context/.env (prefer scripts/context-setup.mjs)",
    "#   Mobile/Desktop build values: the build/user shell environment",
    "# Every assignment is commented so copying this file cannot enable a secret or unsafe mode.",
    "",
  ];
  for (const groupName of [...new Set(ENVIRONMENT_CATALOG.filter((entry) => entry.userSettable).map((entry) => entry.group))]) {
    lines.push("## " + groupName);
    for (const entry of ENVIRONMENT_CATALOG.filter((item) => item.group === groupName && item.userSettable)) {
      const marker = entry.requirement === "conditional" ? "conditional" : "optional";
      const secret = entry.secret === "no" ? "" : "; SECRET=" + entry.secret;
      lines.push("# " + marker + "; scope=" + entry.scope + "; configure=" + entry.configure + "; default=" + entry.defaultValue + secret);
      lines.push("# " + entry.name + "=" + entry.example);
    }
    lines.push("");
  }
  lines.push(
    "# Dynamic secretRef names are intentionally absent: choose the name in the source",
    "# configuration and define its value only in the Hub process environment.",
    "",
  );
  return lines.join("\n");
}

async function readOrMissing(path) {
  try { return await readFile(path, "utf8"); } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function auditRepository(repoRoot = DEFAULT_REPO_ROOT) {
  const root = resolve(repoRoot);
  const uses = await scanRepository(root);
  const catalogProblems = validateCatalog();
  const detectedNames = [...uses.keys()];
  const catalogNames = [...CATALOG_BY_NAME.keys()];
  const missingCatalog = detectedNames.filter((name) => !CATALOG_BY_NAME.has(name));
  const staleCatalog = ENVIRONMENT_CATALOG.filter((entry) => entry.detect !== false && !uses.has(entry.name)).map((entry) => entry.name);
  const expectedDoc = renderDocumentation(uses);
  const expectedExample = renderEnvExample();
  const actualDoc = await readOrMissing(join(root, DOC_FILE));
  const actualExample = await readOrMissing(join(root, EXAMPLE_FILE));
  return {
    ok: !catalogProblems.length
      && !missingCatalog.length
      && !staleCatalog.length
      && actualDoc === expectedDoc
      && actualExample === expectedExample,
    root,
    catalogProblems,
    missingCatalog,
    staleCatalog,
    docsCurrent: actualDoc === expectedDoc,
    exampleCurrent: actualExample === expectedExample,
    detectedCount: detectedNames.length,
    catalogCount: catalogNames.length,
    uses,
    expectedDoc,
    expectedExample,
  };
}

export async function writeGeneratedFiles(repoRoot = DEFAULT_REPO_ROOT) {
  const root = resolve(repoRoot);
  const uses = await scanRepository(root);
  const missing = [...uses.keys()].filter((name) => !CATALOG_BY_NAME.has(name));
  const problems = validateCatalog();
  if (missing.length || problems.length) {
    throw new Error(["catalog cannot be rendered", ...problems, ...missing.map((name) => "missing catalog entry: " + name)].join("\n"));
  }
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, DOC_FILE), renderDocumentation(uses), "utf8");
  await writeFile(join(root, EXAMPLE_FILE), renderEnvExample(), "utf8");
}

function serializableAudit(audit) {
  return {
    ok: audit.ok,
    root: audit.root,
    catalogProblems: audit.catalogProblems,
    missingCatalog: audit.missingCatalog,
    staleCatalog: audit.staleCatalog,
    docsCurrent: audit.docsCurrent,
    exampleCurrent: audit.exampleCurrent,
    detectedCount: audit.detectedCount,
    catalogCount: audit.catalogCount,
    catalog: ENVIRONMENT_CATALOG.map((entry) => ({
      ...entry,
      uses: audit.uses.get(entry.name) || [],
    })),
  };
}

async function main(args) {
  const command = args[0] || "--check";
  if (command === "--write") {
    await writeGeneratedFiles();
    const audit = await auditRepository();
    if (!audit.ok) throw new Error("generated files still fail audit");
    console.log("environment catalog written: " + audit.catalogCount + " entries, " + audit.detectedCount + " statically detected names");
    return;
  }
  const audit = await auditRepository();
  if (command === "--json") {
    console.log(JSON.stringify(serializableAudit(audit), null, 2));
    if (!audit.ok) process.exitCode = 1;
    return;
  }
  if (command === "--scan") {
    for (const [name, records] of audit.uses) console.log(name + "\t" + records.map((record) => record.path + ":" + record.line).join(", "));
    return;
  }
  if (command !== "--check") throw new Error("unknown option: " + command);
  if (!audit.ok) {
    if (audit.catalogProblems.length) console.error("catalog metadata:\n  " + audit.catalogProblems.join("\n  "));
    if (audit.missingCatalog.length) console.error("used without catalog entry:\n  " + audit.missingCatalog.join("\n  "));
    if (audit.staleCatalog.length) console.error("catalog entries with no static use:\n  " + audit.staleCatalog.join("\n  "));
    if (!audit.docsCurrent) console.error(DOC_FILE + " is missing or stale; run --write");
    if (!audit.exampleCurrent) console.error(EXAMPLE_FILE + " is missing or stale; run --write");
    process.exitCode = 1;
    return;
  }
  console.log("environment catalog ok: " + audit.catalogCount + " entries, " + audit.detectedCount + " statically detected names");
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) main(process.argv.slice(2)).catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
