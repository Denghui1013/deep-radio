const { selectTrackCandidates } = require('./ai');
const { getDb } = require('./db');
const { resolvePlayableTrack } = require('./netease');

const queues = new Map();
const DEFAULT_TARGET_SIZE = 2;
const DEFAULT_CANDIDATE_COUNT = 5;

async function getNextReadyTrack(sessionId, options = {}) {
  const queue = queues.get(sessionId) || [];
  if (queue.length > 0) {
    const track = queue.shift();
    queues.set(sessionId, queue);
    markQueueItemPlayed(track.queueId);
    recordPlayHistory(track);
    return track;
  }

  await refillQueue(sessionId, options);

  const nextQueue = queues.get(sessionId) || [];
  const track = nextQueue.shift();
  queues.set(sessionId, nextQueue);

  if (!track) {
    throw new Error('No playable tracks could be prepared');
  }

  markQueueItemPlayed(track.queueId);
  recordPlayHistory(track);
  return track;
}

async function refillQueue(sessionId, options = {}) {
  const queue = queues.get(sessionId) || [];
  const targetSize = options.targetSize || DEFAULT_TARGET_SIZE;
  if (queue.length >= targetSize) return queue;

  const candidates = await selectTrackCandidates(
    options.userMessage || null,
    options.timeOfDay || 'night',
    options.candidateCount || DEFAULT_CANDIDATE_COUNT
  );

  for (const candidate of candidates) {
    const pendingId = insertQueueItem(sessionId, candidate, 'checking');
    const resolved = await resolvePlayableTrack(candidate);

    if (!resolved.ok) {
      markQueueItemFailed(pendingId, resolved.failureReason);
      continue;
    }

    const readyTrack = {
      ...resolved.track,
      queueId: pendingId
    };

    markQueueItemReady(pendingId, readyTrack);
    queue.push(readyTrack);

    if (queue.length >= targetSize) break;
  }

  queues.set(sessionId, queue);
  return queue;
}

function clearQueue(sessionId) {
  queues.delete(sessionId);
}

function getQueueSize(sessionId) {
  return (queues.get(sessionId) || []).length;
}

function insertQueueItem(sessionId, candidate, status) {
  const db = getDb();
  try {
    const info = db.prepare(`
      INSERT INTO radio_queue (session_id, song_name, artist, intro, reason, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      candidate.song_name,
      candidate.artist,
      candidate.intro || '',
      candidate.reason || '',
      status
    );
    return info.lastInsertRowid;
  } finally {
    db.close();
  }
}

function markQueueItemReady(queueId, track) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE radio_queue
      SET status = 'ready',
          provider_track_id = ?,
          audio_url = ?,
          cover_url = ?,
          failure_reason = NULL
      WHERE id = ?
    `).run(String(track.id), track.songUrl, track.coverUrl || null, queueId);
  } finally {
    db.close();
  }
}

function markQueueItemFailed(queueId, reason) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE radio_queue
      SET status = 'failed', failure_reason = ?
      WHERE id = ?
    `).run(reason, queueId);
  } finally {
    db.close();
  }
}

function markQueueItemPlayed(queueId) {
  const db = getDb();
  try {
    db.prepare(`
      UPDATE radio_queue
      SET status = 'played', played_at = strftime('%s','now')
      WHERE id = ?
    `).run(queueId);
  } finally {
    db.close();
  }
}

function recordPlayHistory(track) {
  const db = getDb();
  try {
    db.prepare('INSERT INTO play_history (song_name, artist) VALUES (?, ?)')
      .run(track.song_name, track.artist);
  } finally {
    db.close();
  }
}

module.exports = {
  getNextReadyTrack,
  refillQueue,
  clearQueue,
  getQueueSize
};
