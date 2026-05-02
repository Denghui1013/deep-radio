const express = require("express");
const fs = require("fs");
const path = require("path");
const { config } = require("../config");
const { AppError } = require("../errors");
const { selectPlayableTrack } = require("../services/radioEngine");

const router = express.Router();

router.post("/next", async (req, res, next) => {
  try {
    const sessionId = req.body && req.body.sessionId ? String(req.body.sessionId) : "http-debug-session";
    const userMessage = req.body && req.body.userMessage ? String(req.body.userMessage) : null;
    const ttsProvider = req.body && req.body.ttsProvider ? String(req.body.ttsProvider) : null;
    const track = await selectPlayableTrack({ sessionId, userMessage, ttsProvider });
    res.json({ track });
  } catch (err) {
    next(err);
  }
});

router.get("/audio/:filename", (req, res, next) => {
  try {
    const filename = req.params.filename;
    if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new AppError("INVALID_AUDIO_FILENAME", "Invalid filename", 400);
    }
    const audioRoot = path.resolve(config.TEMP_AUDIO_DIR);
    const absolutePath = path.resolve(audioRoot, filename);
    if (!absolutePath.startsWith(audioRoot + path.sep) && absolutePath !== audioRoot) {
      throw new AppError("AUDIO_PATH_FORBIDDEN", "Path traversal detected", 400);
    }
    if (!fs.existsSync(absolutePath)) {
      throw new AppError("AUDIO_NOT_FOUND", "Audio file not found", 404);
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.sendFile(absolutePath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
