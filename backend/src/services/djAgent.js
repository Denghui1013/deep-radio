const OpenAI = require("openai");
const { config } = require("../config");
const { AppError } = require("../errors");
const { appendSessionMessage, getRecentSessionMessages } = require("../db");

let client = null;

function getClient() {
  if (!client) {
    if (!config.AI_API_KEY) {
      throw new AppError("AI_API_KEY_MISSING", "AI_API_KEY is not configured", 500);
    }
    client = new OpenAI({
      apiKey: config.AI_API_KEY,
      baseURL: config.AI_BASE_URL,
    });
  }
  return client;
}

function stripCodeFence(text) {
  if (!text) return "";
  return String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
}

function safeParseJson(text) {
  return JSON.parse(stripCodeFence(text));
}

function getTimeLabel(timeOfDay) {
  const map = {
    morning: "清晨",
    afternoon: "白天",
    evening: "傍晚",
    night: "夜晚",
    late_night: "深夜",
  };
  return map[timeOfDay] || "当前时段";
}

async function respond({ sessionId, userMessage, profile, timeOfDay, latestTrack }) {
  const api = getClient();
  const memory = getRecentSessionMessages(sessionId, 6);
  const memoryText = memory
    .map((m) => `${m.role === "user" ? "用户" : "DJ"}: ${m.content}`)
    .join("\n");

  const systemPrompt = [
    "你是 AI 电台 DJ「Claudio」。",
    "你像一个懂歌、懂分寸的朋友：不端着，也不吵闹。",
    "目标：让用户听得舒服、聊得轻松，而不是被分析。",
    "说话规则：每次 1-2 句中文，总字数尽量不超过50字。先回应用户，再给建议；不抢话，不自嗨。不要说“作为AI”，不要机械复读用户原话。",
    "推荐规则：按时间段和用户近期偏好选歌。说清推荐理由，比如“这首鼓点更稳，适合现在这个状态”。用户说“换一首/下一首”时直接执行。",
    "情绪规则：如果用户情绪低落，优先陪伴感，不要强行打鸡血。",
    "输出规则：只输出 JSON，不要 markdown，不要多余文本。JSON 结构必须是 {\"reply\":\"...\",\"intent\":\"chat|request_next\"}。",
  ].join("\n");

  const userPrompt = `
当前时段: ${getTimeLabel(timeOfDay)}
用户最新消息: ${userMessage}
用户画像: ${JSON.stringify(profile || {}, null, 2)}
最近播放: ${latestTrack ? `${latestTrack.artist} - ${latestTrack.song_name}` : "无"}
最近会话记忆:
${memoryText || "无"}

请输出:
{
  "reply": "1-2句简短自然中文回复（<=50字）",
  "intent": "chat|request_next"
}
`;

  const response = await api.chat.completions.create({
    model: config.AI_MODEL_FLASH || config.AI_MODEL,
    temperature: 0.55,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices && response.choices[0] && response.choices[0].message
    ? response.choices[0].message.content
    : "";
  const parsed = safeParseJson(raw);
  const reply = parsed && parsed.reply ? String(parsed.reply) : "收到，我们继续听。";
  const intent = parsed && parsed.intent ? String(parsed.intent) : "chat";

  appendSessionMessage({ sessionId, role: "user", type: "chat", content: userMessage });
  appendSessionMessage({ sessionId, role: "assistant", type: "chat", content: reply });

  return { reply, intent };
}

function appendOpeningMemory({ sessionId, opening }) {
  if (!opening) return;
  appendSessionMessage({ sessionId, role: "assistant", type: "opening", content: opening });
}

module.exports = {
  respond,
  appendOpeningMemory,
};
