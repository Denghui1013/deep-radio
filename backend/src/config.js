const path = require("path");
const dotenv = require("dotenv");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, "..");

dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function resolveFromBackendRoot(inputPath) {
  if (!inputPath) return null;
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(BACKEND_ROOT, inputPath);
}

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/+$/, "");
}

function expandLocalOrigins(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname;
    const port = parsed.port;
    const protocol = parsed.protocol;
    if (host === "localhost") {
      variants.add(`${protocol}//127.0.0.1${port ? `:${port}` : ""}`);
    } else if (host === "127.0.0.1") {
      variants.add(`${protocol}//localhost${port ? `:${port}` : ""}`);
    }
  } catch {
    // Ignore malformed custom values and keep original.
  }
  return [...variants];
}

function buildAllowedOrigins(frontendUrlValue) {
  const rawOrigins = String(frontendUrlValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const expanded = new Set();
  for (const origin of rawOrigins) {
    for (const variant of expandLocalOrigins(origin)) {
      expanded.add(variant);
    }
  }
  return [...expanded];
}

const config = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: toInt(process.env.PORT, 4000),
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  NETEASE_API_URL: process.env.NETEASE_API_URL || "http://localhost:3000",
  NETEASE_COOKIE: process.env.NETEASE_COOKIE || "",
  NETEASE_COOKIE_FILE: process.env.NETEASE_COOKIE_FILE
    ? resolveFromBackendRoot(process.env.NETEASE_COOKIE_FILE)
    : "",
  FAVORITE_PLAYLIST_ID: process.env.FAVORITE_PLAYLIST_ID || "",
  AI_PROVIDER: process.env.AI_PROVIDER || "deepseek",
  AI_BASE_URL: process.env.AI_BASE_URL || "https://api.deepseek.com",
  AI_API_KEY: process.env.AI_API_KEY || "",
  AI_MODEL: process.env.AI_MODEL || "deepseek-chat",
  AI_DJ_COPY_MODEL: process.env.AI_DJ_COPY_MODEL || "deepseek-v4-pro",
  AI_MODEL_FLASH: process.env.AI_MODEL_FLASH || process.env.AI_MODEL || "deepseek-chat",
  AI_MODEL_PRO: process.env.AI_MODEL_PRO || process.env.AI_DJ_COPY_MODEL || "deepseek-v4-pro",
  TTS_PROVIDER: (process.env.TTS_PROVIDER || "none").toLowerCase(),
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID || "",
  ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
  EDGE_TTS_VOICE: process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural",
  MINIMAX_API_BASE_URL: process.env.MINIMAX_API_BASE_URL || "https://api.minimax.io",
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || "",
  MINIMAX_TTS_MODEL: process.env.MINIMAX_TTS_MODEL || "speech-2.6-turbo",
  MINIMAX_TTS_VOICE_ID: process.env.MINIMAX_TTS_VOICE_ID || "female-shaonv",
  MINIMAX_TTS_LANGUAGE_BOOST: process.env.MINIMAX_TTS_LANGUAGE_BOOST || "auto",
  DATABASE_PATH: resolveFromBackendRoot(process.env.DATABASE_PATH || "./src/data/claudio.db"),
  TEMP_AUDIO_DIR: resolveFromBackendRoot(process.env.TEMP_AUDIO_DIR || "./src/temp_audio"),
  MAX_TRACK_RETRY: Math.max(1, toInt(process.env.MAX_TRACK_RETRY, 3)),
  INTRO_AUDIO_TTL_SECONDS: Math.max(60, toInt(process.env.INTRO_AUDIO_TTL_SECONDS, 3600)),
  AUDIO_CLEANER_INTERVAL_MS: 10 * 60 * 1000,
  BACKEND_ROOT,
  PROJECT_ROOT,
};

config.ALLOWED_ORIGINS = buildAllowedOrigins(config.FRONTEND_URL);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return config.ALLOWED_ORIGINS.includes(normalized);
}

function validateConfig() {
  const missing = [];
  if (!config.AI_API_KEY) missing.push("AI_API_KEY");
  if (!config.AI_BASE_URL) missing.push("AI_BASE_URL");
  if (!config.AI_MODEL) missing.push("AI_MODEL");
  if (!config.AI_DJ_COPY_MODEL) missing.push("AI_DJ_COPY_MODEL");
  if (!config.AI_MODEL_FLASH) missing.push("AI_MODEL_FLASH");
  if (!config.AI_MODEL_PRO) missing.push("AI_MODEL_PRO");

  if (config.TTS_PROVIDER === "elevenlabs") {
    if (!config.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
    if (!config.ELEVENLABS_VOICE_ID) missing.push("ELEVENLABS_VOICE_ID");
  } else if (config.TTS_PROVIDER === "minimax") {
    if (!config.MINIMAX_API_KEY) missing.push("MINIMAX_API_KEY");
  }

  if (missing.length > 0) {
    console.warn(`[config] Missing env for full feature support: ${missing.join(", ")}`);
  }
}

module.exports = {
  config,
  validateConfig,
  isAllowedOrigin,
};
