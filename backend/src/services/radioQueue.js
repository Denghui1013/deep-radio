const {
  enqueueRadioTrack,
  updateRadioQueueStatus,
  getNextReadyRadioTrack,
  markRadioTrackPlayed,
  getRadioQueueStats,
  clearSessionRadioQueue,
} = require("../db");
const { selectTrackCandidates } = require("./ai");
const { buildSelectionContext, resolveCandidateToPlayableTrack } = require("./radioEngine");

const sessionFillingMap = new Map();
const DEFAULT_TARGET_READY = 2;
const DEFAULT_CANDIDATE_COUNT = 3;

async function fillReadyQueue({
  sessionId,
  userMessage = null,
  targetReady = DEFAULT_TARGET_READY,
  candidateCount = DEFAULT_CANDIDATE_COUNT,
  maxBatches = 2,
}) {
  if (!sessionId) return;
  if (sessionFillingMap.get(sessionId)) return;
  sessionFillingMap.set(sessionId, true);
  try {
    let batch = 0;
    while (batch < maxBatches) {
      const stats = getRadioQueueStats(sessionId);
      if (stats.ready >= targetReady) break;
      batch += 1;
      const ctx = buildSelectionContext(userMessage);
      const dynamicCandidateCount = Math.max(1, candidateCount + (batch - 1) * 2);
      const candidates = await selectTrackCandidates({
        profile: ctx.normalizedProfile,
        timeOfDay: ctx.timeOfDay,
        recentlyPlayed: ctx.recentlyPlayed,
        recentArtists: ctx.recentArtists,
        favoritesSample: ctx.favoritesSample,
        userMessage,
        sourcePreference: ctx.sourcePreference,
        userConstraintStrength: ctx.userConstraintStrength,
        candidateCount: dynamicCandidateCount,
      });

      for (const candidate of candidates) {
        const latestStats = getRadioQueueStats(sessionId);
        if (latestStats.ready >= targetReady) break;

        enqueueRadioTrack({ sessionId, status: "checking", payload: candidate });
        const checkingId = getLatestCheckingId(sessionId);
        if (!checkingId) continue;

        try {
          const track = await resolveCandidateToPlayableTrack({
            sessionId,
            candidate,
            normalizedProfile: ctx.normalizedProfile,
            timeOfDay: ctx.timeOfDay,
            recentlyPlayed: ctx.recentlyPlayed,
            userMessage,
          });
          updateRadioQueueStatus(checkingId, "ready", null);
          setPayload(checkingId, track);
        } catch (err) {
          updateRadioQueueStatus(checkingId, "failed", err.message || "unknown");
        }
      }
    }
  } finally {
    sessionFillingMap.set(sessionId, false);
  }
}

async function getNextReadyTrack({
  sessionId,
  userMessage = null,
  targetReady = DEFAULT_TARGET_READY,
}) {
  let item = getNextReadyRadioTrack(sessionId);
  if (!item || !item.payload) {
    await fillReadyQueue({ sessionId, userMessage, targetReady });
    item = getNextReadyRadioTrack(sessionId);
  }
  if (!item || !item.payload) return null;
  markRadioTrackPlayed(item.id);
  return item.payload;
}

function clearQueue(sessionId) {
  clearSessionRadioQueue(sessionId);
}

function getQueueStatus(sessionId) {
  return getRadioQueueStats(sessionId);
}

function getLatestCheckingId(sessionId) {
  const { db } = require("../db");
  const row = db.prepare(`
    SELECT id FROM radio_queue
    WHERE session_id = ? AND status = 'checking'
    ORDER BY id DESC
    LIMIT 1
  `).get(sessionId);
  return row ? row.id : null;
}

function setPayload(id, payload) {
  const { db } = require("../db");
  db.prepare(`
    UPDATE radio_queue
    SET payload_json = ?, updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(JSON.stringify(payload || {}), id);
}

module.exports = {
  fillReadyQueue,
  getNextReadyTrack,
  clearQueue,
  getQueueStatus,
};
