const fs = require("fs");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { config, validateConfig, isAllowedOrigin } = require("./config");
const { initDb } = require("./db");
const { initSocket } = require("./socket");
const { AppError, toAppError } = require("./errors");
const { startAudioCleaner } = require("./services/audioCleaner");

const healthRouter = require("./routes/health");
const profileRouter = require("./routes/profile");
const radioRouter = require("./routes/radio");
const debugRouter = require("./routes/debug");

function ensureRuntimeDirs() {
  fs.mkdirSync(config.TEMP_AUDIO_DIR, { recursive: true });
  fs.mkdirSync(require("path").dirname(config.DATABASE_PATH), { recursive: true });
}

function buildApp() {
  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new AppError("CORS_ORIGIN_FORBIDDEN", `Origin not allowed: ${origin}`, 403));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", healthRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/radio", radioRouter);
  app.use("/api/debug", debugRouter);

  app.use((req, res, next) => {
    next(new AppError("NOT_FOUND", `Route not found: ${req.method} ${req.originalUrl}`, 404));
  });

  app.use((err, req, res, next) => {
    const appError = toAppError(err);
    const body = {
      ok: false,
      error: {
        code: appError.code || "INTERNAL_ERROR",
        message: appError.message || "Unexpected server error",
      },
    };
    if (appError.detail && config.NODE_ENV !== "production") {
      body.error.detail = appError.detail;
    }
    if (config.NODE_ENV !== "production") {
      console.error(`[error] ${body.error.code}: ${body.error.message}`);
      if (err && err.stack) console.error(err.stack);
    }
    res.status(appError.status || 500).json(body);
  });

  return app;
}

function start() {
  validateConfig();
  ensureRuntimeDirs();
  initDb();
  startAudioCleaner();

  const app = buildApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(config.PORT, () => {
    console.log(`[server] running at http://localhost:${config.PORT}`);
  });
}

start();
