import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "../lib/constants";

function toAbsoluteUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${BACKEND_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

export default function useRadioPlayback({ onTrackEnded, onStateChange }) {
  const introAudioRef = useRef(null);
  const musicAudioRef = useRef(null);
  const trackRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const analyserDataRef = useRef(null);
  const analyserRafRef = useRef(null);
  const fallbackRafRef = useRef(null);
  const fallbackTickRef = useRef(0);
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [rhythmLevel, setRhythmLevel] = useState(0);
  const endNotifiedRef = useRef(false);

  const stopRhythm = useCallback(() => {
    if (analyserRafRef.current) {
      cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = null;
    }
    if (fallbackRafRef.current) {
      cancelAnimationFrame(fallbackRafRef.current);
      fallbackRafRef.current = null;
    }
    setRhythmLevel(0);
  }, []);

  const startFallbackRhythm = useCallback(() => {
    stopRhythm();
    const tick = () => {
      fallbackTickRef.current += 1;
      const t = fallbackTickRef.current;
      const pulse = 0.35 + Math.abs(Math.sin(t * 0.12)) * 0.45 + Math.abs(Math.sin(t * 0.031)) * 0.2;
      setRhythmLevel(Math.min(1, pulse));
      fallbackRafRef.current = requestAnimationFrame(tick);
    };
    fallbackRafRef.current = requestAnimationFrame(tick);
  }, [stopRhythm]);

  const attachRhythmAnalyser = useCallback((audio) => {
    try {
      if (!audio) return false;
      if (!audioContextRef.current) {
        audioContextRef.current = new window.AudioContext();
      }
      const ctx = audioContextRef.current;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      analyserDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      const readEnergy = () => {
        if (!analyserRef.current || !analyserDataRef.current) return;
        analyserRef.current.getByteFrequencyData(analyserDataRef.current);
        let sum = 0;
        for (let i = 2; i < 18 && i < analyserDataRef.current.length; i += 1) {
          sum += analyserDataRef.current[i];
        }
        const avg = sum / 16 || 0;
        const normalized = Math.max(0, Math.min(1, avg / 210));
        setRhythmLevel((prev) => prev * 0.58 + normalized * 0.42);
        analyserRafRef.current = requestAnimationFrame(readEnergy);
      };
      analyserRafRef.current = requestAnimationFrame(readEnergy);
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopAll = useCallback(() => {
    stopRhythm();
    [introAudioRef.current, musicAudioRef.current].forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    });
    setProgressMs(0);
    setDurationMs(0);
  }, [stopRhythm]);

  const syncVolume = useCallback(
    (nextVolume, nextMuted) => {
      [introAudioRef.current, musicAudioRef.current].forEach((audio) => {
        if (!audio) return;
        audio.volume = nextVolume;
        audio.muted = nextMuted;
      });
    },
    []
  );

  const setVolume = useCallback(
    (nextVolume) => {
      const clamped = Math.max(0, Math.min(1, nextVolume));
      setVolumeState(clamped);
      syncVolume(clamped, isMuted);
    },
    [isMuted, syncVolume]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      syncVolume(volume, next);
      return next;
    });
  }, [syncVolume, volume]);

  const playTrack = useCallback(
    async (track) => {
      trackRef.current = track;
      endNotifiedRef.current = false;
      stopAll();

      const intro = new Audio(toAbsoluteUrl(track.introAudioUrl));
      const music = new Audio(track.songUrl);
      intro.preload = "auto";
      music.preload = "auto";
      music.crossOrigin = "anonymous";
      introAudioRef.current = intro;
      musicAudioRef.current = music;
      syncVolume(volume, isMuted);

      const startMusic = async () => {
        setDurationMs(track.durationMs || 0);
        const attached = attachRhythmAnalyser(music);
        if (!attached) startFallbackRhythm();
        try {
          await music.play();
        } catch (err) {
          stopRhythm();
          onStateChange("error");
          throw err;
        }
      };

      const notifyEndedOnce = () => {
        if (endNotifiedRef.current) return;
        endNotifiedRef.current = true;
        setProgressMs(0);
        onTrackEnded?.(trackRef.current);
      };

      music.ontimeupdate = () => {
        setProgressMs(Math.floor((music.currentTime || 0) * 1000));
        if (!durationMs && Number.isFinite(music.duration) && music.duration > 0) {
          setDurationMs(Math.floor(music.duration * 1000));
        }
      };

      music.onended = () => {
        stopRhythm();
        notifyEndedOnce();
      };
      music.onplaying = () => {
        onStateChange("playing");
      };
      music.onpause = () => {
        if (!music.ended) setRhythmLevel((prev) => prev * 0.6);
        if (!endNotifiedRef.current) onStateChange("paused");
      };

      // Keep queue continuity without premature skip:
      // only fallback to next track when playback has reached almost the end.
      music.onerror = () => {
        const currentMs = Math.floor((music.currentTime || 0) * 1000);
        const totalMs = Math.floor(
          ((Number.isFinite(music.duration) && music.duration > 0 ? music.duration : 0) || 0) * 1000
        );
        const expectedMs = track.durationMs || totalMs || 0;
        if (expectedMs > 0 && currentMs >= Math.max(0, expectedMs - 1500)) {
          notifyEndedOnce();
        } else {
          onStateChange("error");
        }
      };

      if (track.introAudioUrl) {
        onStateChange("intro");
        intro.onended = () => {
          startMusic().catch(() => {});
        };
        try {
          await intro.play();
          return;
        } catch {
          await startMusic();
          return;
        }
      }

      await startMusic();
    },
    [attachRhythmAnalyser, durationMs, isMuted, onStateChange, onTrackEnded, startFallbackRhythm, stopAll, stopRhythm, syncVolume, volume]
  );

  const pause = useCallback(() => {
    if (musicAudioRef.current && !musicAudioRef.current.paused) {
      musicAudioRef.current.pause();
      stopRhythm();
      onStateChange("paused");
      return true;
    }
    return false;
  }, [onStateChange, stopRhythm]);

  const resume = useCallback(async () => {
    if (!musicAudioRef.current) return false;
    startFallbackRhythm();
    await musicAudioRef.current.play();
    return true;
  }, [startFallbackRhythm]);

  useEffect(
    () => () => {
      stopAll();
    },
    [stopAll]
  );

  return {
    playTrack,
    pause,
    resume,
    stopAll,
    progressMs,
    durationMs,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    rhythmLevel
  };
}
