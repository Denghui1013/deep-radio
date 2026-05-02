import { useEffect, useRef, useState } from "react";
import { formatMs } from "../lib/time";
import VinylRecord from "./VinylRecord";

export default function NowPlaying({ track, isActive, progressMs, durationMs, children }) {
  const [isSwitching, setIsSwitching] = useState(false);
  const prevTrackIdRef = useRef(null);
  const progress = durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0;

  useEffect(() => {
    const nextTrackId = track?.id ?? null;
    if (!nextTrackId) {
      prevTrackIdRef.current = null;
      return;
    }
    if (prevTrackIdRef.current && prevTrackIdRef.current !== nextTrackId) {
      setIsSwitching(true);
      const timer = setTimeout(() => setIsSwitching(false), 900);
      prevTrackIdRef.current = nextTrackId;
      return () => clearTimeout(timer);
    }
    prevTrackIdRef.current = nextTrackId;
  }, [track?.id]);

  return (
    <section className="now-playing">
      <div className="np-label">NOW PLAYING</div>
      <div className="np-main">
        <VinylRecord
          coverUrl={track?.coverUrl}
          title={track?.song_name || "vinyl record"}
          isActive={isActive}
          isSwitching={isSwitching}
        />
        <div className="np-info">
          <div className="np-title">{track?.song_name || "Beautiful Song Title"}</div>
          <div className="np-artist">
            {track ? `${track.artist}${track.album ? ` · ${track.album}` : ""}` : "Artist Name · Album"}
          </div>
          <div className="progress-wrap simple-progress">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="time-labels">
            <span>{formatMs(progressMs)}</span>
            <span>{formatMs(durationMs || track?.durationMs || 0)}</span>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
