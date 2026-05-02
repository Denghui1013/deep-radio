const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { nanoid } = require("nanoid");
const { EdgeTTS } = require("node-edge-tts");
const { config } = require("../config");
const { AppError } = require("../errors");
const SUPPORTED_PROVIDERS = new Set(["none", "minimax", "elevenlabs", "edge", "auto"]);

function ensureAudioDir() {
  fs.mkdirSync(config.TEMP_AUDIO_DIR, { recursive: true });
}

function toAudioFilename(songId) {
  return `intro_${songId || "track"}_${Date.now()}_${nanoid(6)}.mp3`;
}

async function writeElevenLabs(text, outputPath) {
  if (!config.ELEVENLABS_API_KEY || !config.ELEVENLABS_VOICE_ID) {
    throw new AppError("ELEVENLABS_CONFIG_MISSING", "ElevenLabs env is missing", 500);
  }
  let response;
  try {
    response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.ELEVENLABS_VOICE_ID}`,
      {
        text,
        model_id: config.ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          "xi-api-key": config.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );
  } catch (err) {
    const status = err?.response?.status;
    const raw = err?.response?.data;
    const detail = raw
      ? Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : typeof raw === "string"
          ? raw
          : JSON.stringify(raw)
      : err.message;
    console.warn(`[tts] elevenlabs failed status=${status || "UNKNOWN"} detail=${detail}`);
    throw err;
  }

  fs.writeFileSync(outputPath, Buffer.from(response.data));
}

async function writeEdgeTts(text, outputPath) {
  const tts = new EdgeTTS({
    voice: config.EDGE_TTS_VOICE,
    lang: "zh-CN",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    timeout: 15000,
  });
  await tts.ttsPromise(text, outputPath);
}

async function writeMiniMax(text, outputPath) {
  if (!config.MINIMAX_API_KEY) {
    throw new AppError("MINIMAX_CONFIG_MISSING", "MiniMax env is missing", 500);
  }
  const apiBase = String(config.MINIMAX_API_BASE_URL || "https://api.minimax.io").replace(/\/+$/, "");
  const response = await axios.post(
    `${apiBase}/v1/t2a_v2`,
    {
      model: config.MINIMAX_TTS_MODEL,
      text,
      stream: false,
      output_format: "hex",
      language_boost: config.MINIMAX_TTS_LANGUAGE_BOOST || "auto",
      voice_setting: {
        voice_id: config.MINIMAX_TTS_VOICE_ID,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${config.MINIMAX_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const statusCode = response?.data?.base_resp?.status_code;
  if (statusCode !== 0) {
    const message = response?.data?.base_resp?.status_msg || "MiniMax TTS failed";
    throw new AppError("MINIMAX_TTS_FAILED", message, 502);
  }
  const hexAudio = response?.data?.data?.audio;
  if (!hexAudio || typeof hexAudio !== "string") {
    throw new AppError("MINIMAX_AUDIO_EMPTY", "MiniMax returned empty audio", 502);
  }
  fs.writeFileSync(outputPath, Buffer.from(hexAudio, "hex"));
}

function normalizeProvider(provider) {
  const value = String(provider || "").trim().toLowerCase();
  if (!value) return config.TTS_PROVIDER;
  if (!SUPPORTED_PROVIDERS.has(value)) {
    throw new AppError("UNSUPPORTED_TTS_PROVIDER", `Unsupported TTS_PROVIDER: ${value}`, 400);
  }
  return value;
}

async function generateIntroAudio(text, songId, providerOverride = null) {
  if (!text || !text.trim()) return null;
  const provider = normalizeProvider(providerOverride);
  if (provider === "none") return null;

  ensureAudioDir();
  const filename = toAudioFilename(songId);
  const outputPath = path.join(config.TEMP_AUDIO_DIR, filename);

  if (provider === "elevenlabs") {
    await writeElevenLabs(text, outputPath);
  } else if (provider === "edge") {
    await writeEdgeTts(text, outputPath);
  } else if (provider === "minimax") {
    await writeMiniMax(text, outputPath);
  } else if (provider === "auto") {
    const providers = [
      { name: "minimax", fn: () => writeMiniMax(text, outputPath) },
      { name: "elevenlabs", fn: () => writeElevenLabs(text, outputPath) },
      { name: "edge", fn: () => writeEdgeTts(text, outputPath) },
    ];
    let lastErr = null;
    for (const provider of providers) {
      try {
        await provider.fn();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`[tts] provider=${provider.name} failed: ${err.code || "UNKNOWN"} ${err.message}`);
      }
    }
    if (lastErr) {
      throw new AppError("ALL_TTS_PROVIDERS_FAILED", "All TTS providers failed", 502, lastErr.message);
    }
  } else {
    throw new AppError("UNSUPPORTED_TTS_PROVIDER", `Unsupported TTS_PROVIDER: ${provider}`, 500);
  }

  return {
    filename,
    absolutePath: outputPath,
    publicUrl: `/api/radio/audio/${filename}`,
  };
}

module.exports = {
  generateIntroAudio,
};
