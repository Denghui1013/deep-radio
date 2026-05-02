import { useEffect, useMemo, useRef, useState } from "react";

export default function DJFeed({ messages, showStatus = true, statusPulse = false }) {
  const latestMsgRef = useRef(null);
  const touchStartYRef = useRef(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  const statusSlides = useMemo(() => {
    const slideTypes = new Set(["status", "system", "error"]);
    const recent = messages.filter((m) => slideTypes.has(m.type));
    const uniq = [];
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const text = String(recent[i]?.text || "").trim();
      if (!text) continue;
      if (!uniq.includes(text)) uniq.push(text);
      if (uniq.length >= 4) break;
    }
    return uniq.reverse();
  }, [messages]);

  const listMessages = messages.filter(
    (m) => !new Set(["status", "system", "error", "opening"]).has(m.type)
  );

  useEffect(() => {
    latestMsgRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setShowHistory(false);
  }, [listMessages.length]);

  useEffect(() => {
    if (statusSlides.length <= 1) {
      setSlideIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % statusSlides.length);
    }, 2800);
    return () => clearInterval(timer);
  }, [statusSlides]);

  const currentSlide = statusSlides.length > 0 ? statusSlides[slideIndex % statusSlides.length] : "...";
  const latestMessage = listMessages[listMessages.length - 1] || null;
  const olderMessages = listMessages.slice(0, -1);

  return (
    <section className="feed-section">
      <div className="feed-label">claudio live feed</div>
      {showStatus ? (
        <div className={`msg status-fixed status-carousel ${statusPulse ? "is-breathing" : ""}`}>
          <div className="status-slide">{currentSlide}</div>
          {statusSlides.length > 1 ? (
            <div className="status-dots">
              {statusSlides.map((_, i) => (
                <span key={`${i}`} className={`status-dot ${i === (slideIndex % statusSlides.length) ? "is-active" : ""}`} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="feed-messages"
        onWheel={(e) => {
          if (e.deltaY < 0) setShowHistory(true);
        }}
        onTouchStart={(e) => {
          touchStartYRef.current = e.touches?.[0]?.clientY ?? null;
        }}
        onTouchMove={(e) => {
          const startY = touchStartYRef.current;
          const currentY = e.touches?.[0]?.clientY ?? null;
          if (startY != null && currentY != null && currentY - startY > 8) {
            setShowHistory(true);
          }
        }}
      >
        {showHistory ? olderMessages.map((m) => (
          <div key={m.id} className={`msg ${mapTypeToClass(m.type)}`}>
            {m.text}
          </div>
        )) : null}

        {latestMessage ? (
          <div key={latestMessage.id} ref={latestMsgRef} className={`msg ${mapTypeToClass(latestMessage.type)}`}>
            {latestMessage.text}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function mapTypeToClass(type) {
  if (type === "user") return "user";
  if (type === "system") return "system";
  if (type === "status") return "system";
  if (type === "opening") return "dj-intro";
  return "dj";
}
