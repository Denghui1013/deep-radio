const {
  getMusicProfile,
  getRecentPlayHistory,
  getRecentArtists,
  getFavoritesSample,
  appendPlayHistory,
} = require("../db");
const { config } = require("../config");
const { AppError } = require("../errors");
const { searchSong, getSongUrl } = require("./netease");
const { selectTrackCandidate, generateTrackIntroCopy, normalizeProfile } = require("./ai");
const { generateIntroAudio } = require("./tts");

function getTimeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 9) return "morning";
  if (hour >= 9 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  if (hour >= 21 && hour < 24) return "night";
  return "late_night";
}

function decideSourcePreference(profile, userMessage) {
  const message = (userMessage || "").toLowerCase();
  if (
    message.includes("新的") ||
    message.includes("新歌") ||
    message.includes("陌生") ||
    message.includes("discover") ||
    message.includes("new")
  ) {
    return "new_discovery";
  }
  if (
    message.includes("熟悉") ||
    message.includes("我喜欢") ||
    message.includes("红心") ||
    message.includes("收藏") ||
    message.includes("favorite")
  ) {
    return "favorite_revisit";
  }

  const strategy = (profile && profile.recommendation_strategy) || {};
  const revisit = Number(strategy.favorite_revisit_ratio ?? 0.3);
  const boundedRevisit = Number.isFinite(revisit) ? Math.min(Math.max(revisit, 0), 1) : 0.3;
  return Math.random() < boundedRevisit ? "favorite_revisit" : "new_discovery";
}

function detectUserConstraintStrength(userMessage) {
  const text = String(userMessage || "").toLowerCase().trim();
  if (!text) return "normal";
  const strictKeywords = [
    "只听",
    "仅限",
    "就这类",
    "别推荐别的",
    "只允许",
    "只要这个",
    "only this",
    "nothing else",
  ];
  const hardKeywords = [
    "必须",
    "只要",
    "就要",
    "只能",
    "一定要",
    "不要别的",
    "必须是",
    "must",
    "only",
    "exactly",
  ];
  if (strictKeywords.some((k) => text.includes(k))) return "strict-hard";
  return hardKeywords.some((k) => text.includes(k)) ? "hard" : "normal";
}

function buildSelectionContext(userMessage = null) {
  const { profile } = getMusicProfile();
  const normalizedProfile = normalizeProfile(profile || {});
  const recentlyPlayed = getRecentPlayHistory(20);
  const recentArtists = getRecentArtists(10);
  const favoritesSample = getFavoritesSample(80);
  const timeOfDay = getTimeOfDay();
  const sourcePreference = decideSourcePreference(normalizedProfile, userMessage);
  const userConstraintStrength = detectUserConstraintStrength(userMessage);
  return {
    normalizedProfile,
    recentlyPlayed,
    recentArtists,
    favoritesSample,
    timeOfDay,
    sourcePreference,
    userConstraintStrength,
  };
}

async function resolveCandidateToPlayableTrack({
  sessionId,
  candidate,
  normalizedProfile,
  timeOfDay,
  recentlyPlayed,
  userMessage,
  ttsProvider,
}) {
  if (!candidate || !candidate.song_name || !candidate.artist) {
    throw new AppError("AI_EMPTY_CANDIDATE", "AI did not return valid candidate", 502);
  }

  const matched = await searchSong(candidate.song_name, candidate.artist);
  if (!matched) {
    throw new AppError("TRACK_NOT_FOUND", "Track not found in Netease search", 404);
  }

  const songUrl = matched.songUrl || (await getSongUrl(matched.id));
  if (!songUrl) {
    throw new AppError("TRACK_UNPLAYABLE", "Track url is empty", 409);
  }

  const copy = await generateTrackIntroCopy({
    track: matched,
    profile: normalizedProfile,
    timeOfDay,
    recentlyPlayed,
    selectionReason: candidate.reason || "",
    userMessage,
  });

  let introAudioUrl = null;
  try {
    const generated = await generateIntroAudio(copy.intro, matched.id, ttsProvider);
    introAudioUrl = generated ? generated.publicUrl : null;
  } catch (ttsErr) {
    console.warn(
      `[radio-engine] TTS failed session=${sessionId} song=${matched.id} error=${ttsErr.message}`
    );
  }

  return {
    id: matched.id,
    song_name: matched.song_name,
    artist: matched.artist,
    album: matched.album || "",
    coverUrl: matched.coverUrl || null,
    songUrl,
    intro: copy.intro,
    background: copy.background || "",
    recommendationReason: copy.recommendationReason || "",
    reason: candidate.reason || "",
    source_preference:
      candidate.source_preference === "favorite_revisit" ? "favorite_revisit" : "new_discovery",
    introAudioUrl,
    durationMs: matched.durationMs || null,
  };
}

async function selectPlayableTrack({ sessionId, userMessage = null, ttsProvider = null }) {
  const {
    normalizedProfile,
    recentlyPlayed,
    recentArtists,
    favoritesSample,
    timeOfDay,
    sourcePreference,
    userConstraintStrength,
  } = buildSelectionContext(userMessage);

  let lastFailure = null;

  for (let attempt = 1; attempt <= config.MAX_TRACK_RETRY; attempt += 1) {
    try {
      const candidateCount = attempt === 1 ? 3 : 5;
      const candidate = await selectTrackCandidate({
        profile: normalizedProfile,
        timeOfDay,
        recentlyPlayed,
        recentArtists,
        favoritesSample,
        userMessage,
        sourcePreference,
        userConstraintStrength,
        candidateCount,
      });

      const trackPayload = await resolveCandidateToPlayableTrack({
        sessionId,
        candidate,
        normalizedProfile,
        timeOfDay,
        recentlyPlayed,
        userMessage,
        ttsProvider,
      });

      appendPlayHistory({
        id: trackPayload.id,
        song_name: trackPayload.song_name,
        artist: trackPayload.artist,
        album: trackPayload.album,
        source: "netease",
        reason: trackPayload.reason,
      });

      console.log(
        `[radio-engine] session=${sessionId} attempt=${attempt} selected=${trackPayload.artist} - ${trackPayload.song_name} id=${trackPayload.id}`
      );

      return trackPayload;
    } catch (err) {
      lastFailure = err;
      console.warn(
        `[radio-engine] session=${sessionId} attempt=${attempt} failed: ${err.code || "UNKNOWN"} ${err.message}`
      );
    }
  }

  throw new AppError(
    "TRACK_SELECTION_FAILED",
    "Unable to select a playable track after retries",
    502,
    lastFailure ? lastFailure.message : undefined
  );
}

module.exports = {
  selectPlayableTrack,
  getTimeOfDay,
  buildSelectionContext,
  resolveCandidateToPlayableTrack,
};
