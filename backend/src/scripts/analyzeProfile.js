const {
  initDb,
  getRecentFavorites,
  getRandomFavorites,
  upsertMusicProfile,
  getMusicProfile,
  countFavorites,
} = require("../db");
const { config } = require("../config");
const { AppError } = require("../errors");
const { analyzeMusicProfileFromFavorites } = require("../services/ai");

async function analyzeProfile({ force = false } = {}) {
  const existing = getMusicProfile();
  const favoritesTotal = countFavorites();

  if (!force && existing.profile && favoritesTotal > 0) {
    return { profile: existing.profile, reused: true };
  }

  const recentFavorites = getRecentFavorites(200);
  const randomFavorites = getRandomFavorites(200);
  if (recentFavorites.length === 0 && randomFavorites.length === 0) {
    throw new AppError("FAVORITES_EMPTY", "No favorites found, run sync first", 400);
  }

  const profile = await analyzeMusicProfileFromFavorites({
    recentFavorites,
    randomFavorites,
  });
  upsertMusicProfile(profile);
  return { profile, reused: false };
}

async function main() {
  initDb();
  const result = await analyzeProfile({ force: true });
  console.log("[profile:analyze] done");
  console.log(JSON.stringify(result.profile, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[profile:analyze] failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  analyzeProfile,
};
