import { Pause, Play, SkipForward, Volume2 } from "lucide-react";

export default function PlaybackControls({
  isPlaying,
  onTogglePlay,
  onNext,
  onToggleMute,
  isMuted,
  canControl,
}) {
  return (
    <section className="controls-section">
      <div className="controls">
        <button
          className="ctrl-btn play"
          onClick={onTogglePlay}
          disabled={!canControl}
          aria-pressed={isPlaying}
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button className="ctrl-btn" onClick={onNext} disabled={!canControl} title="下一首">
          <SkipForward size={14} />
        </button>

        <button
          className={`ctrl-btn ${isMuted ? "is-on" : ""}`}
          onClick={onToggleMute}
          disabled={!canControl}
          title={isMuted ? "取消静音" : "静音"}
        >
          <Volume2 size={14} />
        </button>
      </div>
    </section>
  );
}
