const express = require("express");
const { getMusicProfile, countFavorites } = require("../db");
const { syncFavorites } = require("../scripts/syncFavorites");
const { analyzeProfile } = require("../scripts/analyzeProfile");
const { AppError } = require("../errors");

const router = express.Router();

router.get("/", (req, res) => {
  const result = getMusicProfile();
  if (!result.profile) {
    return res.json({ profile: null, updated_at: null });
  }
  return res.json({
    profile: result.profile,
    updated_at: result.updatedAt,
  });
});

router.post("/analyze", async (req, res, next) => {
  try {
    const playlistId = req.body && req.body.playlistId ? req.body.playlistId : undefined;
    const forceSync = Boolean(req.body && req.body.forceSync);
    const forceAnalyze = Boolean(req.body && req.body.forceAnalyze);
    let syncResult = null;
    if (forceSync) {
      syncResult = await syncFavorites(playlistId);
    }
    const { profile, reused } = await analyzeProfile({ force: forceAnalyze });
    res.json({
      ok: true,
      reused,
      favoritesCount: syncResult ? syncResult.favoritesCount : countFavorites(),
      profile,
    });
  } catch (err) {
    next(
      err instanceof AppError
        ? err
        : new AppError("PROFILE_ANALYZE_FAILED", "偏好档案生成失败", 500, err.message)
    );
  }
});

module.exports = router;
