const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const BACKEND_ENV_PATH = path.join(BACKEND_DIR, ".env");
const BACKEND_ENV_EXAMPLE_PATH = path.join(BACKEND_DIR, ".env.example");
const FRONTEND_ENV_PATH = path.join(FRONTEND_DIR, ".env");
const FRONTEND_ENV_EXAMPLE_PATH = path.join(FRONTEND_DIR, ".env.example");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function getConfig() {
  const backendEnv = {
    ...parseEnvFile(BACKEND_ENV_EXAMPLE_PATH),
    ...parseEnvFile(BACKEND_ENV_PATH),
  };
  const frontendEnv = {
    ...parseEnvFile(FRONTEND_ENV_EXAMPLE_PATH),
    ...parseEnvFile(FRONTEND_ENV_PATH),
  };

  const backendPort = Number.parseInt(backendEnv.PORT || "4000", 10) || 4000;
  const backendUrl = `http://localhost:${backendPort}`;

  return {
    backendEnv,
    frontendEnv,
    backendPort,
    backendUrl,
    frontendBackendUrl: frontendEnv.VITE_BACKEND_URL || backendUrl,
    neteaseUrl: backendEnv.NETEASE_API_URL || "http://localhost:3000",
    favoritePlaylistId: backendEnv.FAVORITE_PLAYLIST_ID || "",
    cookieConfigured: Boolean(backendEnv.NETEASE_COOKIE || backendEnv.NETEASE_COOKIE_FILE),
  };
}

async function fetchStatus(backendUrl) {
  const response = await fetch(`${backendUrl}/api/debug/status`);
  if (!response.ok) {
    throw new Error(`Backend status request failed: ${response.status}`);
  }
  return response.json();
}

function printSummary(payload, config, verbose) {
  const status = payload.status || {};
  const backend = status.backend || {};
  const netease = status.netease || {};
  const data = status.data || {};
  const tts = status.tts || {};

  console.log(`backend: ${backend.status || "unknown"} @ ${config.backendUrl}`);
  console.log(`frontend expects backend: ${config.frontendBackendUrl}`);
  console.log(`netease api: ${netease.baseUrl || config.neteaseUrl}`);
  console.log(`netease reachable: ${netease.isReachable ? "yes" : "no"}`);
  console.log(`netease login: ${netease.login && netease.login.isLoggedIn ? "yes" : "no"}`);
  console.log(`favorites: ${data.favoritesCount ?? "unknown"}`);
  console.log(`play history: ${data.playHistoryCount ?? "unknown"}`);
  console.log(`music profile: ${data.hasMusicProfile ? "present" : "missing"}`);
  console.log(`tts: ${tts.provider || "unknown"} (${tts.isReady ? "ready" : "not ready"})`);

  if (verbose) {
    console.log(`database path: ${data.databasePath || "unknown"}`);
    console.log(`favorite playlist id: ${config.favoritePlaylistId || "missing"}`);
    console.log(`cookie configured: ${config.cookieConfigured ? "yes" : "no"}`);
  }
}

function printOfflineChecks(config) {
  console.log("backend status endpoint is unavailable.");
  console.log(`backend expected url: ${config.backendUrl}`);
  console.log(`frontend expects backend: ${config.frontendBackendUrl}`);
  console.log(`netease api from backend env: ${config.neteaseUrl}`);
  console.log(`favorite playlist id: ${config.favoritePlaylistId || "missing"}`);
  console.log(`cookie configured: ${config.cookieConfigured ? "yes" : "no"}`);
  console.log(`backend .env: ${fs.existsSync(BACKEND_ENV_PATH) ? "present" : "missing"}`);
}

async function main() {
  const mode = process.argv[2] || "status";
  const config = getConfig();

  if (mode === "doctor" && config.frontendBackendUrl !== config.backendUrl) {
    console.error(
      `doctor warning: frontend expects ${config.frontendBackendUrl} but backend default is ${config.backendUrl}`
    );
  }

  try {
    const payload = await fetchStatus(config.backendUrl);
    printSummary(payload, config, mode === "doctor");
  } catch (error) {
    printOfflineChecks(config);
    console.error(`status error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
