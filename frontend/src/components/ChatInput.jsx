import { Send } from "lucide-react";
import { useState } from "react";

export default function ChatInput({ onSend, disabled }) {
  const [text, setText] = useState("");

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
  };

  return (
    <section className="chat-area">
      <div className="chat-inner">
        <input
          className="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={"\u548c DJ \u8bf4\u70b9\u4ec0\u4e48..."}
          disabled={disabled}
        />
        <button className="send-btn" onClick={submit} disabled={disabled}>
          <Send size={14} />
        </button>
      </div>
    </section>
  );
}
