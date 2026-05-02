const axios = require("axios");
const fs = require("fs");
const { config } = require("../config");
const { AppError } = require("../errors");

const api = axios.create({
  baseURL: config.NETEASE_API_URL,
  timeout: 20000,
});
const MIN_PLAYABLE_DURATION_MS = 60 * 1000;

function isLikelyPreviewUrl(url) {
  if (!url) return false;
  return /musicrep|jd-musicrep|\/trial\//i.test(String(url));
}

function parseNetscapeCookieFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const kv = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    const name = parts[5];
    const value = parts[6];
    if (!name || !value) continue;
    kv.push(`${name}=${value}`);
  }
  return kv.join("; ");
}

const resolvedCookie =
  config.NETEASE_COOKIE || parseNetscapeCookieFile(config.NETEASE_COOKIE_FILE);

function withCookie(params = {}) {
  if (!resolvedCookie) return params;
  return { ...params, cookie: resolvedCookie };
}

function normalizeArtist(song) {
  if (Array.isArray(song.artists)) return song.artists.map((a) => a.name).join(" / ");
  if (Array.isArray(song.ar)) return song.ar.map((a) => a.name).join(" / ");
  return song.artist || "";
}

function normalizeAlbum(song) {
  if (song.album && song.album.name) return song.album.name;
  if (song.al && song.al.name) return song.al.name;
  return song.album || "";
}

function normalizeCover(song) {
  if (song.album && song.album.picUrl) return song.album.picUrl;
  if (song.al && song.al.picUrl) return song.al.picUrl;
  return song.cover || null;
}

async function getAccount() {
  const { data } = await api.get("/user/account", {
    params: withCookie(),
  });
  return data;
}

async function getLoginStatus() {
  const { data } = await api.get("/login/status", {
    params: withCookie(),
  });
  return data;
}

async function getUserPlaylists(uid) {
  const { data } = await api.get("/user/playlist", {
    params: withCookie({ uid }),
  });
  return data;
}

async function getPlaylistTracks(playlistId, limit = 1000, offset = 0) {
  const { data } = await api.get("/playlist/track/all", {
    params: withCookie({ id: playlistId, limit, offset }),
  });
  return data;
}

async function getSongUrl(songId) {
  const { data } = await api.get("/song/url/v1", {
    params: withCookie({ id: songId, br: 320000 }),
  });
  const item = data && data.data && data.data[0] ? data.data[0] : null;
  if (!item || !item.url) return null;
  if (item.freeTrialInfo) return null;
  if (item.time && item.time < MIN_PLAYABLE_DURATION_MS) return null;
  return item.url;
}

async function probeSongAccess(songId) {
  const { data } = await api.get("/song/url/v1", {
    params: withCookie({ id: songId, level: "exhigh" }),
  });
  const item = data && data.data && data.data[0] ? data.data[0] : null;
  if (!item) return null;
  return {
    id: item.id,
    code: item.code,
    level: item.level || null,
    time: item.time || 0,
    hasUrl: Boolean(item.url),
    isTrial: Boolean(item.freeTrialInfo),
    freeTrialInfo: item.freeTrialInfo || null,
    cannotListenReason:
      item.freeTrialPrivilege && typeof item.freeTrialPrivilege.cannotListenReason !== "undefined"
        ? item.freeTrialPrivilege.cannotListenReason
        : null,
    urlHost: item.url ? (() => {
      try {
        return new URL(item.url).host;
      } catch {
        return null;
      }
    })() : null,
  };
}

function getResolvedCookieMeta() {
  const cookie = resolvedCookie || "";
  const hasMusicU = /(?:^|;\s*)MUSIC_U=/.test(cookie);
  const hasCsrf = /(?:^|;\s*)__csrf=/.test(cookie);
  const cookieLength = cookie.length;
  return {
    hasCookie: cookieLength > 0,
    hasMusicU,
    hasCsrf,
    cookieLength,
    source: config.NETEASE_COOKIE ? "env:NETEASE_COOKIE" : (config.NETEASE_COOKIE_FILE ? "file:NETEASE_COOKIE_FILE" : "none"),
  };
}

async function getSongUrls(songIds) {
  if (!Array.isArray(songIds) || songIds.length === 0) return {};
  const uniqueIds = [...new Set(songIds.filter(Boolean))];
  const { data } = await api.get("/song/url/v1", {
    params: withCookie({ id: uniqueIds.join(","), level: "exhigh" }),
  });
  const rows = (data && data.data) || [];
  const map = {};
  for (const row of rows) {
    map[row.id] = {
      url: row.url || null,
      time: row.time || 0,
      freeTrialInfo: row.freeTrialInfo || null,
      level: row.level || null,
    };
  }
  return map;
}

function scoreSong(candidate, requestedName, requestedArtist) {
  const name = (candidate.name || "").toLowerCase();
  const artist = normalizeArtist(candidate).toLowerCase();
  const requestedNameLc = (requestedName || "").toLowerCase().trim();
  const requestedArtistLc = (requestedArtist || "").toLowerCase().trim();

  let score = 0;
  if (name === requestedNameLc) score += 100;
  else if (name.includes(requestedNameLc)) score += 50;
  if (requestedArtistLc && artist.includes(requestedArtistLc)) score += 40;
  if (requestedArtistLc && artist === requestedArtistLc) score += 20;
  return score;
}

async function searchSong(songName, artist) {
  const keywords = [songName, artist].filter(Boolean).join(" ").trim();
  if (!keywords) return null;

  const { data } = await api.get("/search", {
    params: withCookie({ keywords, limit: 10, type: 1 }),
  });

  const candidates = (data && data.result && data.result.songs) || [];
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreSong(candidate, songName, artist),
    }))
    .sort((a, b) => b.score - a.score);

  const urlMap = await getSongUrls(scored.map((item) => item.candidate.id));
  const playable = scored.find((item) => {
    const row = urlMap[item.candidate.id];
    const url = row && row.url ? row.url : null;
    const durationMs = item.candidate.duration || item.candidate.dt || 0;
    if (!url) return false;
    if (row && row.freeTrialInfo) return false;
    if (row && row.time > 0 && row.time < MIN_PLAYABLE_DURATION_MS) return false;
    if (isLikelyPreviewUrl(url)) return false;
    if (durationMs > 0 && durationMs < MIN_PLAYABLE_DURATION_MS) return false;
    return true;
  });
  if (!playable) return null;
  const chosen = playable.candidate;
  const selectedRow = urlMap[chosen.id];
  const songUrl = selectedRow ? selectedRow.url : null;

  return {
    id: chosen.id,
    song_name: chosen.name,
    artist: normalizeArtist(chosen),
    album: normalizeAlbum(chosen),
    coverUrl: normalizeCover(chosen),
    durationMs: (selectedRow && selectedRow.time) || chosen.duration || chosen.dt || null,
    songUrl,
  };
}

async function getLyric(songId) {
  const { data } = await api.get("/lyric", {
    params: withCookie({ id: songId }),
  });
  return data;
}

async function listAllPlaylistTracks(playlistId) {
  if (!playlistId) {
    throw new AppError("MISSING_PLAYLIST_ID", "FAVORITE_PLAYLIST_ID is required", 400);
  }

  const limit = 1000;
  let offset = 0;
  let merged = [];
  while (true) {
    const payload = await getPlaylistTracks(playlistId, limit, offset);
    const songs = payload && payload.songs ? payload.songs : [];
    merged = merged.concat(songs);
    if (songs.length < limit) break;
    offset += limit;
  }
  return merged;
}

module.exports = {
  getAccount,
  getLoginStatus,
  getUserPlaylists,
  getPlaylistTracks,
  listAllPlaylistTracks,
  searchSong,
  getSongUrl,
  getSongUrls,
  probeSongAccess,
  getResolvedCookieMeta,
  getLyric,
};
