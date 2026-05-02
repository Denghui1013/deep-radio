export default function RhythmFlow({ isActive, rhythmLevel }) {
  const clamped = Math.max(0, Math.min(1, rhythmLevel || 0));
  const amp = 8 + clamped * 22;
  const glow = 0.18 + clamped * 0.45;

  return (
    <div className={`rhythm-flow ${isActive ? "is-active" : ""}`} style={{ "--amp": `${amp}px`, "--glow": glow }}>
      <div className="rhythm-track" />
      <div className="rhythm-wave rhythm-wave-a" />
      <div className="rhythm-wave rhythm-wave-b" />
      <div className="rhythm-wave rhythm-wave-c" />
    </div>
  );
}
