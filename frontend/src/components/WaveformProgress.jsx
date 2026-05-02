import { useMemo } from "react";

function seeded(seed) {
  let x = 0;
  for (let i = 0; i < seed.length; i += 1) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 0xffffffff;
  };
}

export default function WaveformProgress({ track, progress, isActive, rhythmLevel }) {
  const bars = useMemo(() => {
    const rand = seeded(`${track?.id || "idle"}_${track?.song_name || ""}`);
    const total = 84;
    const peaks = [0.22 + rand() * 0.08, 0.48 + rand() * 0.1, 0.72 + rand() * 0.12];
    return Array.from({ length: total }, (_, i) => {
      const t = i / (total - 1);
      const base = 0.2 + rand() * 0.3 + Math.abs(Math.sin(i * 0.37)) * 0.16;
      const chorus = peaks.reduce((acc, p) => acc + Math.exp(-Math.pow((t - p) * 10, 2)) * (0.35 + rand() * 0.2), 0);
      return Math.min(1, base + chorus);
    });
  }, [track?.id, track?.song_name]);

  const litCount = Math.round((Math.max(0, Math.min(100, progress)) / 100) * bars.length);
  const pulse = 1 + Math.max(0, Math.min(1, rhythmLevel || 0)) * 0.28;

  return (
    <div className={`progress-wrap waveform-wrap ${isActive ? "is-active" : ""}`} style={{ "--pulse": pulse }}>
      <div className="waveform-bars">
        {bars.map((h, idx) => (
          <span
            key={`${idx}_${h.toFixed(3)}`}
            className={`wave-bar ${idx <= litCount ? "is-lit" : ""} ${idx === litCount ? "is-head" : ""}`}
            style={{ "--h": `${Math.max(14, Math.round(h * 100))}%`, "--d": `${idx * 14}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
