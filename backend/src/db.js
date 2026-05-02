const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { config } = require("./config");

fs.mkdirSync(path.dirname(config.DATABASE_PATH), { recursive: true });
const db = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration_ms INTEGER,
      cover_url TEXT,
      source_playlist_id TEXT,
      raw_json TEXT,
      synced_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER,
      song_name TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      source TEXT NOT NULL DEFAULT 'netease',
      selected_reason TEXT,
      played_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS dj_sessions (
      id TEXT PRIMARY KEY,
      socket_id TEXT,
      state TEXT NOT NULL DEFAULT 'idle',
      current_song_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS radio_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'checking',
      payload_json TEXT,
      fail_reason TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      played_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'chat',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
}

function getMusicProfile() {
  const row = db
    .prepare("SELECT value, updated_at FROM user_profile WHERE key = ?")
    .get("music_profile");
  if (!row) return { profile: null, updatedAt: null };
  try {
    return { profile: JSON.parse(row.value), updatedAt: row.updated_at };
  } catch {
    return { profile: null, updatedAt: row.updated_at };
  }
}

function upsertMusicProfile(profile) {
  const statement = db.prepare(`
    INSERT INTO user_profile (key, value, updated_at)
    VALUES ('music_profile', ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  statement.run(JSON.stringify(profile));
}

function insertOrReplaceFavorites(songs, sourcePlaylistId) {
  const insert = db.prepare(`
    INSERT INTO favorites
      (id, name, artist, album, duration_ms, cover_url, source_playlist_id, raw_json, synced_at)
    VALUES
      (@id, @name, @artist, @album, @duration_ms, @cover_url, @source_playlist_id, @raw_json, strftime('%s','now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      artist = excluded.artist,
      album = excluded.album,
      duration_ms = excluded.duration_ms,
      cover_url = excluded.cover_url,
      source_playlist_id = excluded.source_playlist_id,
      raw_json = excluded.raw_json,
      synced_at = excluded.synced_at
  `);

  const tx = db.transaction((items) => {
    for (const song of items) {
      const artistList = Array.isArray(song.ar) ? song.ar.map((a) => a.name).join(" / ") : song.artist || "";
      const albumName = song.al && song.al.name ? song.al.name : song.album || "";
      const coverUrl =
        (song.al && (song.al.picUrl || song.al.pic_str)) ||
        song.cover_url ||
        null;
      insert.run({
        id: song.id,
        name: song.name,
        artist: artistList,
        album: albumName,
        duration_ms: song.dt || song.duration_ms || null,
        cover_url: coverUrl,
        source_playlist_id: String(sourcePlaylistId || ""),
        raw_json: JSON.stringify(song),
      });
    }
  });

  tx(songs);
}

function appendPlayHistory(track) {
  db.prepare(`
    INSERT INTO play_history (song_id, song_name, artist, album, source, selected_reason, played_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
  `).run(
    track.id || null,
    track.song_name,
    track.artist,
    track.album || null,
    track.source || "netease",
    track.reason || null
  );
}

function createOrUpdateSession({ sessionId, socketId, state = "idle", currentSongId = null }) {
  db.prepare(`
    INSERT INTO dj_sessions (id, socket_id, state, current_song_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
    ON CONFLICT(id) DO UPDATE SET
      socket_id = excluded.socket_id,
      state = excluded.state,
      current_song_id = excluded.current_song_id,
      updated_at = excluded.updated_at
  `).run(sessionId, socketId || null, state, currentSongId);
}

function updateSessionState(sessionId, state, currentSongId = null) {
  db.prepare(`
    UPDATE dj_sessions
    SET state = ?, current_song_id = ?, updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(state, currentSongId, sessionId);
}

function getRecentPlayHistory(limit = 20) {
  return db
    .prepare(
      `
        SELECT song_id, song_name, artist, album, source, selected_reason, played_at
        FROM play_history
        ORDER BY played_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit);
}

function getRecentArtists(limit = 10) {
  return db
    .prepare(
      `
        SELECT artist
        FROM play_history
        WHERE artist IS NOT NULL
        ORDER BY played_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit)
    .map((row) => row.artist);
}

function getFavoritesSample(limit = 80) {
  return db
    .prepare(
      `
        SELECT id, name, artist, album, duration_ms, cover_url
        FROM favorites
        ORDER BY RANDOM()
        LIMIT ?
      `
    )
    .all(limit);
}

function getRecentFavorites(limit = 200) {
  return db
    .prepare(
      `
        SELECT id, name, artist, album, duration_ms, cover_url, raw_json, synced_at
        FROM favorites
        ORDER BY synced_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit);
}

function getRandomFavorites(limit = 200) {
  return db
    .prepare(
      `
        SELECT id, name, artist, album, duration_ms, cover_url, raw_json, synced_at
        FROM favorites
        ORDER BY RANDOM()
        LIMIT ?
      `
    )
    .all(limit);
}

function countFavorites() {
  const row = db.prepare("SELECT COUNT(1) as total FROM favorites").get();
  return row ? row.total : 0;
}

function countPlayHistory() {
  const row = db.prepare("SELECT COUNT(1) as total FROM play_history").get();
  return row ? row.total : 0;
}

function enqueueRadioTrack({ sessionId, status = "checking", payload = null, failReason = null }) {
  db.prepare(`
    INSERT INTO radio_queue (session_id, status, payload_json, fail_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
  `).run(sessionId, status, payload ? JSON.stringify(payload) : null, failReason);
}

function updateRadioQueueStatus(id, status, failReason = null) {
  db.prepare(`
    UPDATE radio_queue
    SET status = ?, fail_reason = ?, updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(status, failReason, id);
}

function getNextReadyRadioTrack(sessionId) {
  const row = db.prepare(`
    SELECT id, payload_json
    FROM radio_queue
    WHERE session_id = ? AND status = 'ready'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(sessionId);
  if (!row) return null;
  try {
    return { id: row.id, payload: JSON.parse(row.payload_json || "{}") };
  } catch {
    return { id: row.id, payload: null };
  }
}

function markRadioTrackPlayed(id) {
  db.prepare(`
    UPDATE radio_queue
    SET status = 'played', played_at = strftime('%s','now'), updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(id);
}

function getRadioQueueStats(sessionId) {
  const rows = db.prepare(`
    SELECT status, COUNT(1) AS total
    FROM radio_queue
    WHERE session_id = ?
    GROUP BY status
  `).all(sessionId);
  const stats = { checking: 0, ready: 0, failed: 0, played: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(stats, row.status)) {
      stats[row.status] = row.total;
    }
  }
  return stats;
}

function clearSessionRadioQueue(sessionId) {
  db.prepare("DELETE FROM radio_queue WHERE session_id = ?").run(sessionId);
}

function appendSessionMessage({ sessionId, role, type = "chat", content }) {
  db.prepare(`
    INSERT INTO session_messages (session_id, role, type, content, created_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
  `).run(sessionId, role, type, content);
}

function getRecentSessionMessages(sessionId, limit = 12) {
  return db.prepare(`
    SELECT role, type, content, created_at
    FROM session_messages
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(sessionId, limit).reverse();
}

function getRecentRadioQueueItems(sessionId, limit = 20) {
  return db.prepare(`
    SELECT id, session_id, status, payload_json, fail_reason, created_at, updated_at, played_at
    FROM radio_queue
    WHERE session_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(sessionId, limit).map((row) => {
    let payload = null;
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : null;
    } catch {
      payload = null;
    }
    return {
      id: row.id,
      session_id: row.session_id,
      status: row.status,
      fail_reason: row.fail_reason || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      played_at: row.played_at || null,
      payload,
    };
  });
}

module.exports = {
  db,
  initDb,
  getMusicProfile,
  upsertMusicProfile,
  insertOrReplaceFavorites,
  appendPlayHistory,
  createOrUpdateSession,
  updateSessionState,
  getRecentPlayHistory,
  getRecentArtists,
  getFavoritesSample,
  getRecentFavorites,
  getRandomFavorites,
  countFavorites,
  countPlayHistory,
  enqueueRadioTrack,
  updateRadioQueueStatus,
  getNextReadyRadioTrack,
  markRadioTrackPlayed,
  getRadioQueueStats,
  clearSessionRadioQueue,
  appendSessionMessage,
  getRecentSessionMessages,
  getRecentRadioQueueItems,
};
