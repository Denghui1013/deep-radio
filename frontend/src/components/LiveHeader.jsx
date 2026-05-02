import { formatClock } from "../lib/time";

export default function LiveHeader({ now, isConnected, isConnecting, onConnect, uiStyle, onSwitchStyle }) {
  const clock = now || new Date();
  const entryLabel = isConnected ? "LIVE" : isConnecting ? "CONNECTING..." : "JOIN RADIO";
  const weekday = clock.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const dateText = clock
    .toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
  return (
    <header className="header">
      <div className="brand-wrap">
        <div className="brand">Claudio</div>
        <button
          type="button"
          className={`live-entry-btn ${isConnected ? "is-connected" : "is-offline"}`}
          onClick={onConnect}
          disabled={isConnected || isConnecting}
        >
          <span className="live-dot" />
          {entryLabel}
        </button>
      </div>
      <div className="header-actions">
        <div className="ui-switch" role="tablist" aria-label="UI style switcher">
          <button
            type="button"
            className={uiStyle === "classic" ? "is-active" : ""}
            onClick={() => onSwitchStyle("classic")}
          >
            CLASSIC
          </button>
          <button
            type="button"
            className={uiStyle === "claudio" ? "is-active" : ""}
            onClick={() => onSwitchStyle("claudio")}
          >
            CLAUDIO
          </button>
        </div>
        <div className="clock-mini">
          <span>{formatClock(clock)}</span>
          <small>FM 90.5</small>
        </div>
        <div className="clock-date-mini">{weekday} / {dateText}</div>
      </div>
    </header>
  );
}
