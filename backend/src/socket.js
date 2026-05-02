const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const { AppError } = require("./errors");
const { isAllowedOrigin } = require("./config");
const {
  createOrUpdateSession,
  updateSessionState,
  getMusicProfile,
  getRecentPlayHistory,
} = require("./db");
const { selectPlayableTrack, getTimeOfDay } = require("./services/radioEngine");
const { respond: agentRespond, appendOpeningMemory } = require("./services/djAgent");
const { getNextReadyTrack, fillReadyQueue, clearQueue, getQueueStatus } = require("./services/radioQueue");
const { generateIntroAudio } = require("./services/tts");

const socketSessionMap = new Map();
const socketBusyMap = new Map();
const socketTtsProviderMap = new Map();

function emitState(socket, state, message) {
  socket.emit("radio:state", { state, message: message || "" });
}

function emitRadioError(socket, err, recoverable = true) {
  socket.emit("radio:error", {
    code: err.code || "INTERNAL_ERROR",
    message: err.message || "Unexpected error",
    recoverable,
  });
}

function emitQueueStatus(socket, sessionId) {
  if (!sessionId) return;
  const stats = getQueueStatus(sessionId);
  socket.emit("radio:status", {
    queue: stats,
  });
}

function fallbackOpeningByTimeOfDay(timeOfDay) {
  const map = {
    morning: [
      "早上好，这里是 Claudio。先给你一首轻一点的歌，让今天慢慢亮起来。",
      "早安，频道已接通。我们用一首温柔的歌，把节奏调到舒服的位置。",
      "清晨好，欢迎上麦。先放一首不打扰但有精神的歌，陪你开机。"
    ],
    afternoon: [
      "下午好，这里是 Claudio。先来一首中速的歌，让你在白天里稳稳前进。",
      "白天好，信号稳定。先放一首有呼吸感的歌，给你一点刚好的松弛。",
      "欢迎回来，我们继续。先听一首不喧哗但有层次的歌，陪你把状态找回来。"
    ],
    evening: [
      "傍晚好，这里是 Claudio。先来一首过渡感舒服的歌，把白天慢慢放下。",
      "晚上好，频道已打开。先给你一首暖一点的歌，陪你从忙碌切到生活。",
      "夜色刚好，欢迎回来。先听一首有氛围的歌，让情绪慢慢落地。"
    ],
    night: [
      "夜晚好，这里是 Claudio。先放一首留白多一点的歌，陪你把节奏放慢。",
      "欢迎来到今晚的频道。先来一首安静但不空的歌，给你一段自己的时间。",
      "晚上好，信号在。我们先听一首低饱和的好歌，把心绪慢慢收回来。"
    ],
    late_night: [
      "深夜好，这里是 Claudio。先放一首安静的歌，陪你把思绪放轻一点。",
      "凌晨时段，频道仍在线。先来一首贴耳朵的歌，让世界先慢下来。",
      "夜深了，欢迎你。我们先听一首有空间感的歌，把未完的心事放一放。"
    ],
  };
  const candidates = map[timeOfDay] || map.night;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function emitImmediateOpening(socket, ttsProvider = null) {
  const text = fallbackOpeningByTimeOfDay(getTimeOfDay());
  socket.emit("dj:message", {
    id: `msg_${nanoid(10)}`,
    type: "opening",
    text,
    audioUrl: null,
    timestamp: new Date().toISOString(),
  });
  generateIntroAudio(text, `opening_${Date.now()}`, ttsProvider)
    .then((generated) => {
      if (!generated || !generated.publicUrl || !socket.connected) return;
      socket.emit("dj:message", {
        id: `msg_${nanoid(10)}`,
        type: "opening",
        text,
        audioUrl: generated.publicUrl,
        timestamp: new Date().toISOString(),
      });
    })
    .catch((err) => {
      console.warn(`[socket] opening tts failed: ${err.message}`);
    });
  const sessionId = socketSessionMap.get(socket.id);
  if (sessionId) appendOpeningMemory({ sessionId, opening: text });
}

async function pushNextTrack(socket, sessionId, userMessage = null, ttsProvider = null, options = {}) {
  if (socketBusyMap.get(socket.id)) return;
  socketBusyMap.set(socket.id, true);
  try {
    emitState(socket, "selecting", "正在选下一首");
    updateSessionState(sessionId, "selecting");
    const forceFresh = Boolean(options && options.forceFresh);
    let track = null;

    if (forceFresh) {
      clearQueue(sessionId);
      track = await selectPlayableTrack({ sessionId, userMessage, ttsProvider });
    } else {
      track = await getNextReadyTrack({ sessionId, userMessage, targetReady: 2 });
      if (!track) {
        track = await selectPlayableTrack({ sessionId, userMessage, ttsProvider });
      }
    }

    updateSessionState(sessionId, "intro", track.id);
    socket.emit("track:new", { track });
    fillReadyQueue({ sessionId, userMessage: null, targetReady: 2 }).catch((err) => {
      console.warn(`[socket] schedule queue fill failed: ${err.message}`);
    });
    emitQueueStatus(socket, sessionId);
  } catch (err) {
    emitState(socket, "error", "选曲失败，稍后重试");
    emitRadioError(socket, err, true);
    setTimeout(() => {
      if (socket.connected) {
        pushNextTrack(socket, sessionId).catch((innerErr) => {
          console.warn(`[socket] delayed retry failed: ${innerErr.message}`);
        });
      }
    }, 30000);
  } finally {
    socketBusyMap.set(socket.id, false);
  }
}

function shouldRequestNext(messageText, explicitRequestNext) {
  if (explicitRequestNext === true) return true;
  const text = (messageText || "").trim();
  if (!text) return false;
  const keywords = ["想听", "换一首", "来首", "来点", "播放", "下一首"];
  return keywords.some((k) => text.includes(k));
}

function buildRealtimeAck(text, requestNext) {
  const cleaned = String(text || "").trim();
  if (requestNext) {
    return cleaned
      ? `收到，你这句我记住了，下一首按这个方向来。`
      : "收到，正在按你的口味切下一首。";
  }
  if (!cleaned) return "收到，我在。";
  return "收到，我马上给你个建议。";
}

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`Origin not allowed: ${origin}`));
      },
    },
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected id=${socket.id} origin=${socket.handshake.headers.origin || "unknown"}`);
    emitState(socket, "connecting", "连接中");

    socket.on("listener:start", async (payload = {}) => {
      try {
        const providedSessionId = payload.sessionId ? String(payload.sessionId) : null;
        const sessionId = providedSessionId || `session_${nanoid(12)}`;
        socketSessionMap.set(socket.id, sessionId);
        socketTtsProviderMap.set(
          socket.id,
          payload.ttsProvider ? String(payload.ttsProvider).toLowerCase() : null
        );
        clearQueue(sessionId);
        createOrUpdateSession({ sessionId, socketId: socket.id, state: "connecting" });
        socket.emit("session:ready", { sessionId });

        emitImmediateOpening(socket, socketTtsProviderMap.get(socket.id) || null);

        fillReadyQueue({ sessionId, userMessage: null, targetReady: 2 }).catch(() => {});
        await pushNextTrack(socket, sessionId, null, socketTtsProviderMap.get(socket.id) || null);
      } catch (err) {
        emitRadioError(socket, err, true);
      }
    });

    socket.on("listener:message", async (payload = {}) => {
      const sessionId = socketSessionMap.get(socket.id);
      if (!sessionId) {
        emitRadioError(socket, new AppError("SESSION_NOT_READY", "Session not ready yet", 400), true);
        return;
      }
      if (payload.ttsProvider) {
        socketTtsProviderMap.set(socket.id, String(payload.ttsProvider).toLowerCase());
      }
      const ttsProvider = socketTtsProviderMap.get(socket.id) || null;

      const text = payload.text ? String(payload.text) : "";
      const requestNext = shouldRequestNext(text, payload.requestNext);
      socket.emit("dj:message", {
        id: `msg_${nanoid(10)}`,
        type: "dj",
        text: buildRealtimeAck(text, requestNext),
        timestamp: new Date().toISOString(),
      });

      if (requestNext) {
        pushNextTrack(socket, sessionId, text, ttsProvider, { forceFresh: true }).catch((err) =>
          emitRadioError(socket, err, true)
        );
        return;
      }

      const { profile } = getMusicProfile();
      const recent = getRecentPlayHistory(1);

      try {
        const { reply, intent } = await agentRespond({
          sessionId,
          userMessage: text,
          profile,
          timeOfDay: getTimeOfDay(),
          latestTrack: recent[0] || null,
        });
        socket.emit("dj:message", {
          id: `msg_${nanoid(10)}`,
          type: "dj",
          text: reply,
          timestamp: new Date().toISOString(),
        });
        if (intent === "request_next") {
          pushNextTrack(socket, sessionId, text, ttsProvider, { forceFresh: true }).catch((err) =>
            emitRadioError(socket, err, true)
          );
        }
      } catch (err) {
        emitRadioError(socket, err, true);
      }
    });

    socket.on("track:ended", async () => {
      const sessionId = socketSessionMap.get(socket.id);
      if (!sessionId) return;
      updateSessionState(sessionId, "selecting");
      await pushNextTrack(socket, sessionId, null, socketTtsProviderMap.get(socket.id) || null);
    });

    socket.on("playback:pause", () => {
      const sessionId = socketSessionMap.get(socket.id);
      if (!sessionId) return;
      updateSessionState(sessionId, "paused");
      emitState(socket, "paused", "已暂停");
    });

    socket.on("playback:resume", () => {
      const sessionId = socketSessionMap.get(socket.id);
      if (!sessionId) return;
      updateSessionState(sessionId, "playing");
      emitState(socket, "playing", "继续播放");
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected id=${socket.id} reason=${reason || "unknown"}`);
      const sessionId = socketSessionMap.get(socket.id);
      if (sessionId) {
        updateSessionState(sessionId, "idle");
        clearQueue(sessionId);
        socketSessionMap.delete(socket.id);
      }
      socketBusyMap.delete(socket.id);
      socketTtsProviderMap.delete(socket.id);
    });
  });

  return io;
}

module.exports = {
  initSocket,
};
