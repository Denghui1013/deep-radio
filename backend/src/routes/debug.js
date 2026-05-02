const express = require("express");
const { getAccount, getLoginStatus, probeSongAccess, getResolvedCookieMeta } = require("../services/netease");
const {
  getMusicProfile,
  countFavorites,
  countPlayHistory,
  getRadioQueueStats,
  getRecentRadioQueueItems,
} = require("../db");
const { AppError } = require("../errors");
const { config } = require("../config");

const router = express.Router();

function getTtsStatus() {
  const provider = config.TTS_PROVIDER || "none";
  if (provider === "none") {
    return { provider, isReady: true };
  }
  if (provider === "edge") {
    return {
      provider,
      isReady: Boolean(config.EDGE_TTS_VOICE),
    };
  }
  if (provider === "elevenlabs") {
    return {
      provider,
      isReady: Boolean(config.ELEVENLABS_API_KEY && config.ELEVENLABS_VOICE_ID),
    };
  }
  if (provider === "minimax") {
    return {
      provider,
      isReady: Boolean(config.MINIMAX_API_KEY),
    };
  }
  if (provider === "auto") {
    return {
      provider,
      isReady: Boolean(
        config.MINIMAX_API_KEY ||
        (config.ELEVENLABS_API_KEY && config.ELEVENLABS_VOICE_ID) ||
        config.EDGE_TTS_VOICE
      ),
    };
  }
  return {
    provider,
    isReady: false,
  };
}

router.get("/status", async (req, res, next) => {
  try {
    const [loginStatus, account] = await Promise.all([
      getLoginStatus().catch(() => null),
      getAccount().catch(() => null),
    ]);

    const loginProfile = loginStatus && loginStatus.data && loginStatus.data.profile
      ? loginStatus.data.profile
      : null;
    const accountInfo = account && account.profile ? account.profile : loginProfile;
    const musicProfile = getMusicProfile();

    res.json({
      ok: true,
      status: {
        backend: {
          status: "ok",
          port: config.PORT,
          frontendUrl: config.FRONTEND_URL,
        },
        netease: {
          baseUrl: config.NETEASE_API_URL,
          isReachable: Boolean(loginStatus || account),
          cookie: getResolvedCookieMeta(),
          login: {
            isLoggedIn: Boolean(accountInfo),
            userId: accountInfo ? accountInfo.userId || null : null,
            nickname: accountInfo ? accountInfo.nickname || null : null,
            vipType: accountInfo ? accountInfo.vipType || null : null,
          },
        },
        data: {
          databasePath: config.DATABASE_PATH,
          favoritesCount: countFavorites(),
          playHistoryCount: countPlayHistory(),
          hasMusicProfile: Boolean(musicProfile.profile),
          musicProfileUpdatedAt: musicProfile.updatedAt || null,
        },
        tts: getTtsStatus(),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/netease-auth", async (req, res, next) => {
  try {
    const testSongId = req.query.songId ? Number(req.query.songId) : 447925558;
    if (!Number.isFinite(testSongId) || testSongId <= 0) {
      throw new AppError("INVALID_SONG_ID", "songId must be a positive number", 400);
    }

    const [cookieMeta, loginStatus, account, songProbe] = await Promise.all([
      Promise.resolve(getResolvedCookieMeta()),
      getLoginStatus().catch(() => null),
      getAccount().catch(() => null),
      probeSongAccess(testSongId).catch(() => null),
    ]);

    const profile = loginStatus && loginStatus.data && loginStatus.data.profile
      ? loginStatus.data.profile
      : null;
    const accountInfo = account && account.profile ? account.profile : profile;

    res.json({
      ok: true,
      netease: {
        cookie: cookieMeta,
        login: {
          isLoggedIn: Boolean(accountInfo),
          userId: accountInfo ? accountInfo.userId || null : null,
          nickname: accountInfo ? accountInfo.nickname || null : null,
          vipType: accountInfo ? accountInfo.vipType || null : null,
        },
        probe: {
          songId: testSongId,
          result: songProbe,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/radio-queue", (req, res, next) => {
  try {
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : "";
    if (!sessionId) {
      throw new AppError("MISSING_SESSION_ID", "sessionId is required", 400);
    }
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 20;
    const stats = getRadioQueueStats(sessionId);
    const items = getRecentRadioQueueItems(sessionId, safeLimit);
    res.json({
      ok: true,
      queue: {
        sessionId,
        stats,
        items,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
