export default function StatePanel({ radioState, error, onStart, canStart }) {
  const labelMap = {
    idle: "\u5f85\u673a",
    connecting: "\u8fde\u63a5\u4e2d",
    selecting: "\u9009\u6b4c\u4e2d",
    intro: "DJ \u8bf4\u8bdd\u4e2d",
    playing: "\u64ad\u653e\u4e2d",
    paused: "\u5df2\u6682\u505c",
    error: "\u5f02\u5e38"
  };
  const stateLabel = labelMap[radioState] || radioState;

  return (
    <section className="state-panel">
      <div className={`state-pill state-${radioState}`}>{stateLabel}</div>
      <button className="start-btn" onClick={onStart} disabled={!canStart}>
        {"\u5f00\u59cb\u6536\u542c"}
      </button>
      {error ? <p className="error-line">{error.message}</p> : null}
    </section>
  );
}
