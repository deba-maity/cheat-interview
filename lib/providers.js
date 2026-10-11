"use strict";

// Models remain editable in Settings: provider catalogues can change independently.
const PROVIDERS = {
  groq: {
    label: "Groq", baseURL: "https://api.groq.com/openai/v1",
    textModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    visionModels: [], transcriptionModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
  },
  gemini: {
    label: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    textModels: ["gemini-3.8-flash", "gemini-2.5-flash"],
    visionModels: ["gemini-3.8-flash", "gemini-2.5-flash"], transcriptionModels: [],
  },
  openai: {
    label: "OpenAI", baseURL: "https://api.openai.com/v1",
    textModels: ["gpt-4o-mini", "gpt-4.1-mini"],
    visionModels: ["gpt-4o-mini", "gpt-4.1-mini"],
    transcriptionModels: ["gpt-4o-mini-transcribe", "whisper-1"],
  },
  openrouter: {
    label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1",
    textModels: ["openai/gpt-4o-mini", "google/gemini-2.5-flash"],
    visionModels: ["openai/gpt-4o-mini", "google/gemini-2.5-flash"], transcriptionModels: [],
  },
};
const DEFAULT_ORDER = Object.keys(PROVIDERS);

function list(value, fallback = []) {
  if (value === undefined || value === null) return [...fallback];
  const parts = Array.isArray(value) ? value : String(value).split(/[\n,]+/);
  return [...new Set(parts.map(v => String(v).trim()).filter(Boolean))];
}

function boundedNumber(value, fallback, min, max) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function fromEnvironment(env = process.env) {
  const providers = {};
  for (const [id, defaults] of Object.entries(PROVIDERS)) {
    const prefix = id.toUpperCase();
    providers[id] = {
      ...defaults,
      keys: list(env[`${prefix}_API_KEYS`] || env[`${prefix}_API_KEY`]),
      baseURL: env[`${prefix}_BASE_URL`] || defaults.baseURL,
      textModels: list(env[`${prefix}_TEXT_MODELS`], defaults.textModels),
      visionModels: list(env[`${prefix}_VISION_MODELS`], defaults.visionModels),
      transcriptionModels: list(env[`${prefix}_TRANSCRIPTION_MODELS`], defaults.transcriptionModels),
    };
  }
  return {
    providers,
    order: list(env.AI_PROVIDER_ORDER, DEFAULT_ORDER).filter(id => PROVIDERS[id]),
    timeoutMs: boundedNumber(env.AI_TIMEOUT_MS, 18000, 1000, 60000),
    budgetMs: boundedNumber(env.AI_BUDGET_MS, 90000, 5000, 180000),
    maxAttempts: boundedNumber(env.AI_MAX_ATTEMPTS, 12, 1, 30),
  };
}

module.exports = { PROVIDERS, DEFAULT_ORDER, list, boundedNumber, fromEnvironment };
