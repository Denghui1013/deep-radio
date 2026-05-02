const fs = require("fs");
const path = require("path");
const { config } = require("../config");

function cleanupExpiredAudio() {
  fs.mkdirSync(config.TEMP_AUDIO_DIR, { recursive: true });
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = config.INTRO_AUDIO_TTL_SECONDS;
  const entries = fs.readdirSync(config.TEMP_AUDIO_DIR, { withFileTypes: true });

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".mp3")) continue;
    const absolutePath = path.join(config.TEMP_AUDIO_DIR, entry.name);
    const stat = fs.statSync(absolutePath);
    const modifiedSec = Math.floor(stat.mtimeMs / 1000);
    if (nowSec - modifiedSec > ttlSec) {
      try {
        fs.unlinkSync(absolutePath);
        removed += 1;
      } catch (err) {
        console.warn(`[audio-cleaner] remove failed: ${absolutePath} ${err.message}`);
      }
    }
  }
  return removed;
}

function startAudioCleaner() {
  cleanupExpiredAudio();
  return setInterval(() => {
    const removed = cleanupExpiredAudio();
    if (removed > 0) {
      console.log(`[audio-cleaner] removed ${removed} expired files`);
    }
  }, config.AUDIO_CLEANER_INTERVAL_MS);
}

module.exports = {
  startAudioCleaner,
  cleanupExpiredAudio,
};
