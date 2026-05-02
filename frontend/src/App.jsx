import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import ChatInput from "./components/ChatInput";
import DJFeed from "./components/DJFeed";
import LiveHeader from "./components/LiveHeader";
import NowPlaying from "./components/NowPlaying";
import PlaybackControls from "./components/PlaybackControls";
import useRadioPlayback from "./hooks/useRadioPlayback";
import { BACKEND_URL, RADIO_STATES } from "./lib/constants";

function safeState(next) {
  return RADIO_STATES.includes(next) ? next : "error";
}

export default function App() {
  const [uiStyle, setUiStyle] = useState(() => {
    if (typeof window === "undefined") return "classic";
    const saved = window.localStorage.getItem("ui_style");
    return saved === "claudio" ? "claudio" : "classic";
  });
  const [sessionId, setSessionId] = useState(null);
  const [socketStatus, setSocketStatus] = useState("idle");
  const [radioState, setRadioState] = useState("idle");
  const [currentTrack, setCurrentTrack] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isRequestingNext, setIsRequestingNext] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(new Date());
  const socketRef = useRef(null);
  const openingAudioRef = useRef(null);
  const delayedPlayTimerRef = useRef(null);

  const addMessage = useCallback((type, text) => {
    setMessages((prev) => [...prev, mkMessage(type, text)]);
  }, []);

  const upsertStatusMessage = useCallback((text) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.type === "status");
      if (idx === -1) return [...prev, mkMessage("status", text)];
      if (prev[idx]?.text === text) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], text };
      return next;
    });
  }, []);

  const playback = useRadioPlayback({
    onTrackEnded: (track) => {
      if (!track || !socketRef.current) return;
      socketRef.current.emit("track:ended", {
        trackId: track.id,
        endedAt: new Date().toISOString(),
      });
    },
    onStateChange: (state) => setRadioState(safeState(state)),
  });

  const connect = useCallback(async () => {
    if (socketRef.current) {
      if (socketRef.current.connected) return;
      setError(null);
      setSocketStatus("connecting");
      setRadioState("connecting");
      upsertStatusMessage("连接中...");
      socketRef.current.connect();
      return;
    }

    setError(null);
    setSocketStatus("connecting");
    setRadioState("connecting");
    upsertStatusMessage("连接中...");

    try {
      await axios.get(`${BACKEND_URL}/health`, { timeout: 4000 });
    } catch (_) {
      addMessage("system", "后端健康检查失败，仍尝试建立 Socket 连接。");
    }

    const socket = io(BACKEND_URL, {
      autoConnect: false,
      transports: ["polling", "websocket"],
      tryAllTransports: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      setRadioState("selecting");
      upsertStatusMessage("已连接，正在选歌...");
      socket.emit("listener:start", { sessionId: sessionId || undefined });
    });

    socket.on("disconnect", (reason) => {
      setSocketStatus("disconnected");
      upsertStatusMessage(`已断开: ${reason || "unknown reason"}`);
    });

    socket.on("connect_error", (err) => {
      setSocketStatus("disconnected");
      upsertStatusMessage(`连接失败: ${err?.message || "unknown error"}`);
    });

    socket.on("session:ready", (payload) => {
      if (payload?.sessionId) setSessionId(payload.sessionId);
    });

    socket.on("radio:state", (payload) => {
      setRadioState(safeState(payload?.state || "error"));
      if (payload?.message) upsertStatusMessage(payload.message);
    });

    socket.on("dj:message", (payload) => {
      if (payload?.type === "opening" && payload?.audioUrl) {
        try {
          if (openingAudioRef.current) {
            openingAudioRef.current.pause();
            openingAudioRef.current.src = "";
          }
          const audio = new Audio(
            /^https?:\/\//i.test(payload.audioUrl)
              ? payload.audioUrl
              : `${BACKEND_URL}${payload.audioUrl.startsWith("/") ? payload.audioUrl : `/${payload.audioUrl}`}`
          );
          openingAudioRef.current = audio;
          audio.play().catch(() => {});
        } catch {
          // ignore opening voice playback error
        }
        return;
      }
      addMessage(payload?.type || "dj", payload?.text || "");
    });

    socket.on("track:new", async (payload) => {
      const track = payload?.track;
      if (!track) return;
      setIsRequestingNext(false);
      setCurrentTrack(track);
      if (track.intro) addMessage("dj", track.intro);
      if (delayedPlayTimerRef.current) {
        clearTimeout(delayedPlayTimerRef.current);
        delayedPlayTimerRef.current = null;
      }
      delayedPlayTimerRef.current = setTimeout(async () => {
        try {
          await playback.playTrack(track);
        } catch (err) {
          setRadioState("error");
          addMessage("error", `音频播放失败: ${err?.message || "unknown error"}`);
        }
      }, 2000);
    });

    socket.on("radio:error", (payload) => {
      setIsRequestingNext(false);
      const nextError = {
        code: payload?.code || "RADIO_ERROR",
        message: payload?.message || "播放出错",
      };
      setError(nextError);
      setRadioState("error");
      upsertStatusMessage(nextError.message);
    });

    socket.connect();
  }, [addMessage, playback, sessionId, upsertStatusMessage]);

  const sendMessage = useCallback(
    (text) => {
      addMessage("user", text);
      socketRef.current?.emit("listener:message", { text, requestNext: true });
    },
    [addMessage]
  );

  const togglePlay = useCallback(async () => {
    if (radioState === "playing") {
      const paused = playback.pause();
      if (paused) socketRef.current?.emit("playback:pause", { trackId: currentTrack?.id });
      return;
    }
    if (radioState === "paused" || radioState === "error") {
      const resumed = await playback.resume();
      if (resumed) socketRef.current?.emit("playback:resume", { trackId: currentTrack?.id });
    }
  }, [currentTrack?.id, playback, radioState]);

  const requestNext = useCallback(() => {
    if (isRequestingNext) return;
    setIsRequestingNext(true);
    socketRef.current?.emit("listener:message", {
      text: "下一首",
      requestNext: true,
    });
    upsertStatusMessage("正在请求下一首...");
  }, [isRequestingNext, upsertStatusMessage]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("ui_style", uiStyle);
  }, [uiStyle]);

  useEffect(
    () => () => {
      playback.stopAll();
      if (openingAudioRef.current) {
        openingAudioRef.current.pause();
        openingAudioRef.current.src = "";
      }
      if (delayedPlayTimerRef.current) {
        clearTimeout(delayedPlayTimerRef.current);
        delayedPlayTimerRef.current = null;
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
    },
    [playback.stopAll]
  );

  const canControl = useMemo(() => Boolean(socketRef.current && currentTrack), [currentTrack]);
  const isConnected = socketStatus === "connected";
  const isConnecting = socketStatus === "connecting";
  const vibeBars = useMemo(() => {
    const base = Math.max(0.08, playback.rhythmLevel || 0);
    return Array.from({ length: 28 }, (_, i) => {
      const wave = Math.abs(Math.sin((i + 1) * 0.65 + base * 6.2));
      const boost = radioState === "playing" || radioState === "intro" ? 0.24 : 0;
      return Math.min(1, 0.16 + wave * 0.68 * base + boost);
    });
  }, [playback.rhythmLevel, radioState]);
  return (
    <main className={`radio-wrap theme-dark ui-style-${uiStyle}`}>
      <LiveHeader
        now={now}
        isConnected={isConnected}
        isConnecting={isConnecting}
        onConnect={connect}
        uiStyle={uiStyle}
        onSwitchStyle={setUiStyle}
      />
      {error ? <p className="error-line">{error.message}</p> : null}
      <section className={`vibe-strip ${(radioState === "playing" || radioState === "intro") ? "is-active" : ""}`}>
        <div className="vibe-head">LIVE VIBE</div>
        <div className="vibe-bars">
          {vibeBars.map((h, i) => (
            <span
              key={`vb_${i}`}
              className="vibe-bar"
              style={{
                "--vh": `${Math.round(14 + h * 66)}%`,
                "--vd": `${(i % 7) * 80}ms`,
              }}
            />
          ))}
        </div>
      </section>

      <div className="content-stack">
        <section className="player-panel">
          <NowPlaying
            track={currentTrack}
            isActive={
              radioState === "playing" ||
              radioState === "intro" ||
              (Boolean(currentTrack) && socketStatus === "connected")
            }
            progressMs={playback.progressMs}
            durationMs={playback.durationMs}
          >
            <PlaybackControls
              isPlaying={radioState === "playing"}
              isMuted={playback.isMuted}
              volume={playback.volume}
              onTogglePlay={togglePlay}
              onNext={requestNext}
              onToggleMute={playback.toggleMute}
              canControl={canControl}
            />
          </NowPlaying>
        </section>

        <section className="chat-panel">
          <DJFeed
            messages={messages}
            showStatus={radioState === "selecting" || isRequestingNext || isConnecting}
            statusPulse={radioState === "selecting" || isRequestingNext}
          />
        </section>
      </div>

      <ChatInput onSend={sendMessage} disabled={socketStatus !== "connected"} />
    </main>
  );
}

function mkMessage(type, text) {
  return {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type,
    text,
  };
}


