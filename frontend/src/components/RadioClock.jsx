import { formatClock, formatDate } from "../lib/time";

export default function RadioClock({ now }) {
  const [hh, mm] = formatClock(now).split(":");
  return (
    <section className="clock-section">
      <div className="clock-time">
        <span>{hh}</span>
        <span className="colon">:</span>
        <span>{mm}</span>
      </div>
      <div className="clock-meta">
        <div className="clock-date">{formatDate(now)}</div>
        <div className="on-air-tag">ON AIR</div>
      </div>
    </section>
  );
}
