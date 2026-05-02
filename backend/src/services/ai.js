const OpenAI = require("openai");
const { config } = require("../config");
const { AppError } = require("../errors");

let client = null;
const MODEL_BY_TASK = Object.freeze({
  profile_analysis: "pro",
  track_intro_copy: "pro",
  opening_copy: "pro",
  track_selection: "flash",
  dj_reply: "flash",
});

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

function resolveModel(task, explicitModel) {
  if (explicitModel) return explicitModel;
  const tier = MODEL_BY_TASK[task] || "flash";
  return tier === "pro" ? config.AI_MODEL_PRO : config.AI_MODEL_FLASH;
}

async function chatJsonWithRetry({
  model,
  task = "track_selection",
  systemPrompt,
  userPrompt,
  maxParseRetry = 1,
  temperature = 0.6,
}) {
  const api = getClient();
  let lastRaw = "";
  const resolvedModel = resolveModel(task, model);

  for (let attempt = 0; attempt <= maxParseRetry; attempt += 1) {
    const reinforce = attempt > 0 ? "\n请仅返回合法 JSON，不要返回 markdown 或解释文本。" : "";
    const response = await api.chat.completions.create({
      model: resolvedModel,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userPrompt}${reinforce}` },
      ],
    });
    lastRaw = response.choices && response.choices[0] && response.choices[0].message
      ? response.choices[0].message.content
      : "";

    try {
      return safeParseJson(lastRaw);
    } catch (err) {
      if (attempt >= maxParseRetry) {
        throw new AppError(
          "AI_JSON_PARSE_FAILED",
          "AI response is not valid JSON",
          502,
          stripCodeFence(lastRaw).slice(0, 1000)
        );
      }
    }
  }

  throw new AppError("AI_EMPTY_RESPONSE", "AI returned empty response", 502);
}

function normalizeProfile(profile) {
  const defaults = {
    genres: [],
    moods: [],
    avoid: [],
    artists_style: "",
    favorite_patterns: [],
    discovery_note: "",
    recommendation_strategy: {
      favorite_revisit_ratio: 0.3,
      new_discovery_ratio: 0.7,
      notes: "红心歌单用于理解口味，不作为唯一播放池。",
    },
  };
  const merged = Object.assign({}, defaults, profile || {});
  if (!merged.recommendation_strategy) {
    merged.recommendation_strategy = defaults.recommendation_strategy;
  }
  if (typeof merged.recommendation_strategy.favorite_revisit_ratio !== "number") {
    merged.recommendation_strategy.favorite_revisit_ratio = 0.3;
  }
  if (typeof merged.recommendation_strategy.new_discovery_ratio !== "number") {
    merged.recommendation_strategy.new_discovery_ratio = 0.7;
  }
  return merged;
}

async function analyzeMusicProfileFromFavorites({ recentFavorites, randomFavorites }) {
  const systemPrompt = [
    "你是音乐偏好分析助手。",
    "你只输出 JSON，不输出 markdown，不输出额外解释。",
    "请根据用户红心歌单总结稳定偏好与新歌探索倾向。",
  ].join("\n");

  const userPrompt = `
输入数据：
- 最近红心歌曲（用于近期偏好）
- 随机红心歌曲（用于长期偏好）

recentFavorites:
${JSON.stringify(recentFavorites || [], null, 2)}

randomFavorites:
${JSON.stringify(randomFavorites || [], null, 2)}

输出 JSON 结构必须包含：
{
  "genres": string[],
  "moods": string[],
  "avoid": string[],
  "artists_style": string,
  "favorite_patterns": string[],
  "discovery_note": string,
  "recommendation_strategy": {
    "favorite_revisit_ratio": number,
    "new_discovery_ratio": number,
    "notes": string
  }
}
`;

  const parsed = await chatJsonWithRetry({
    task: "profile_analysis",
    systemPrompt,
    userPrompt,
    maxParseRetry: 1,
    temperature: 0.2,
  });

  return normalizeProfile(parsed);
}

function getTimeDesc(timeOfDay) {
  const map = {
    morning: "清晨，轻柔明亮",
    afternoon: "白天，中速不打扰",
    evening: "傍晚，放松过渡",
    night: "夜间，沉浸安静",
    late_night: "深夜，内省氛围",
  };
  return map[timeOfDay] || map.night;
}

function compactProfileForPrompt(profile) {
  const p = normalizeProfile(profile || {});
  return {
    genres: (p.genres || []).slice(0, 8),
    moods: (p.moods || []).slice(0, 8),
    avoid: (p.avoid || []).slice(0, 6),
    artists_style: p.artists_style || "",
    favorite_patterns: (p.favorite_patterns || []).slice(0, 8),
    discovery_note: p.discovery_note || "",
    recommendation_strategy: {
      favorite_revisit_ratio: Number(p?.recommendation_strategy?.favorite_revisit_ratio ?? 0.3),
      new_discovery_ratio: Number(p?.recommendation_strategy?.new_discovery_ratio ?? 0.7),
      notes: String(p?.recommendation_strategy?.notes || ""),
    },
  };
}

function compactTracksForPrompt(list, limit = 12) {
  return (list || []).slice(0, limit).map((t) => ({
    song_name: t.song_name || t.name || "",
    artist: t.artist || "",
    album: t.album || "",
  }));
}

function compactFavoritesForPrompt(list, limit = 30) {
  return (list || []).slice(0, limit).map((t) => ({
    name: t.name || t.song_name || "",
    artist: t.artist || "",
    album: t.album || "",
  }));
}

async function selectTrackCandidate(input) {
  const requestedCount =
    input && Number.isFinite(Number(input.candidateCount))
      ? Number(input.candidateCount)
      : 1;
  const list = await selectTrackCandidates({ ...input, candidateCount: requestedCount });
  return list[0] || null;
}

async function selectTrackCandidates({
  profile,
  timeOfDay,
  recentlyPlayed,
  recentArtists,
  favoritesSample,
  userMessage,
  sourcePreference,
  userConstraintStrength = "normal",
  candidateCount = 5,
}) {
  const systemPrompt = [
    "你是音乐选曲助手。",
    "只输出 JSON。",
    "返回多首候选歌曲，供后端逐首验证可播放性。",
    "不要只从红心歌单中选歌，要兼顾新发现。",
    "如果用户输入了明确偏好（风格/语种/艺人/情绪/场景），候选必须优先贴合该偏好，匹配权重高于常规画像偏好。",
    "当约束强度=hard时，把用户输入视为硬约束：候选需严格匹配，不要给泛化候选。",
    "当约束强度=strict-hard时，执行近乎白名单策略：候选几乎只围绕用户指定艺人/语种/风格，不要扩展到相邻风格。",
  ].join("\n");

  const userPrompt = `
当前时段：${getTimeDesc(timeOfDay)}
推荐方向：${sourcePreference}
约束强度：${userConstraintStrength}
候选数量：${candidateCount}
用户画像（摘要）：${JSON.stringify(compactProfileForPrompt(profile), null, 2)}
最近播放（摘要）：${JSON.stringify(compactTracksForPrompt(recentlyPlayed, 10), null, 2)}
最近艺人：${JSON.stringify((recentArtists || []).slice(0, 10), null, 2)}
红心样本（摘要）：${JSON.stringify(compactFavoritesForPrompt(favoritesSample, 24), null, 2)}
用户输入：${userMessage || "无"}

输出：
{
  "candidates": [
    {
      "song_name": string,
      "artist": string,
      "reason": string,
      "source_preference": "favorite_revisit" | "new_discovery"
    }
  ]
}
`;

  try {
    const parsed = await chatJsonWithRetry({
      task: "track_selection",
      systemPrompt,
      userPrompt,
      maxParseRetry: 1,
      temperature: 0.75,
    });
    const raw = Array.isArray(parsed && parsed.candidates) ? parsed.candidates : [];
    const normalized = raw
      .filter((x) => x && x.song_name && x.artist)
      .slice(0, Math.max(1, Math.min(candidateCount, 10)));
    if (normalized.length > 0) return normalized;
  } catch (_) {
    // fallback below
  }

  return [];
}

async function generateOpeningMessage({ timeOfDay, profile, latestTrack }) {
  const systemPrompt = [
    "你是 AI 电台 DJ Claudio。",
    "表达自然、有温度，不油腻。",
    "只输出 JSON。",
  ].join("\n");

  const userPrompt = `
请生成 1-3 句开场白。
当前时段：${getTimeDesc(timeOfDay)}
用户画像：${JSON.stringify(profile || {}, null, 2)}
最近一首歌：${latestTrack ? `${latestTrack.artist} - ${latestTrack.song_name}` : "无"}

输出：
{
  "opening": "开场白文本"
}
`;

  const result = await chatJsonWithRetry({
    task: "opening_copy",
    systemPrompt,
    userPrompt,
    maxParseRetry: 1,
    temperature: 0.9,
  });
  return result.opening || "晚上好，信号接通，我们慢慢开始。";
}

async function generateTrackIntroCopy({
  track,
  profile,
  timeOfDay,
  recentlyPlayed,
  selectionReason,
  userMessage,
}) {
  const systemPrompt = [
    "你是 AI 电台 DJ Claudio。",
    "只输出 JSON。",
    "中文表达，歌名和艺人名保留原文。",
    "文案包含背景和推荐理由，但不要编造不可证实事实。",
    "文案要短：1-2句，总字数尽量控制在60字以内。",
  ].join("\n");

  const userPrompt = `
已确认可播放歌曲：${JSON.stringify(track, null, 2)}
当前时段：${getTimeDesc(timeOfDay)}
用户画像（摘要）：${JSON.stringify(compactProfileForPrompt(profile), null, 2)}
最近播放（摘要）：${JSON.stringify(compactTracksForPrompt(recentlyPlayed, 10), null, 2)}
选曲理由：${selectionReason || ""}
用户输入：${userMessage || "无"}

输出：
{
  "intro": "1-2句简短播报（<=60字）",
  "background": "背景摘要",
  "recommendationReason": "推荐理由摘要"
}
`;

  return chatJsonWithRetry({
    task: "track_intro_copy",
    systemPrompt,
    userPrompt,
    maxParseRetry: 1,
    temperature: 0.9,
  });
}

async function generateDjReply({ userMessage, profile }) {
  const systemPrompt = [
    "你是 AI 电台 DJ Claudio。",
    "在直播中简短回复听众。",
    "2-3句中文，有温度，不说教。",
    "只输出 JSON。",
  ].join("\n");

  const userPrompt = `
用户消息：${userMessage}
用户画像：${JSON.stringify(profile || {}, null, 2)}

输出：
{
  "reply": "DJ 回复文本"
}
`;

  const result = await chatJsonWithRetry({
    task: "dj_reply",
    systemPrompt,
    userPrompt,
    maxParseRetry: 1,
    temperature: 0.85,
  });
  return result.reply || "收到，我们继续听。";
}

module.exports = {
  analyzeMusicProfileFromFavorites,
  selectTrackCandidate,
  selectTrackCandidates,
  generateOpeningMessage,
  generateTrackIntroCopy,
  generateDjReply,
  normalizeProfile,
};
