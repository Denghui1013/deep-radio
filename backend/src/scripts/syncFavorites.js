const { config } = require("../config");
const { initDb, insertOrReplaceFavorites } = require("../db");
const { AppError } = require("../errors");
const { listAllPlaylistTracks } = require("../services/netease");

async function syncFavorites(playlistId) {
  const targetPlaylistId = playlistId || config.FAVORITE_PLAYLIST_ID;
  if (!targetPlaylistId) {
    throw new AppError("MISSING_PLAYLIST_ID", "FAVORITE_PLAYLIST_ID is required", 400);
  }

  const songs = await listAllPlaylistTracks(targetPlaylistId);
  insertOrReplaceFavorites(songs, targetPlaylistId);
  return { favoritesCount: songs.length };
}

async function main() {
  initDb();
  const playlistId = process.argv[2] || config.FAVORITE_PLAYLIST_ID;
  const result = await syncFavorites(playlistId);
  console.log(`[sync:favorites] done count=${result.favoritesCount}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[sync:favorites] failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  syncFavorites,
};
