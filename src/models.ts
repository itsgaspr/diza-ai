import type { AppConfig } from "./config.js";

export interface ModelSlot {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  cheap: boolean;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GROQ_BASE = "https://api.groq.com/openai/v1/";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1/";

export function buildSlots(config: AppConfig): ModelSlot[] {
  const slots: ModelSlot[] = [];

  if (config.geminiApiKey) {
    slots.push(
      {
        label: "gemini/gemini-3.8-flash",
        baseUrl: GEMINI_BASE,
        apiKey: config.geminiApiKey,
        model: "gemini-3.8-flash",
        cheap: false,
      },
      {
        label: "gemini/gemini-3.5-flash-lite",
        baseUrl: GEMINI_BASE,
        apiKey: config.geminiApiKey,
        model: "gemini-3.5-flash-lite",
        cheap: true,
      },
    );
  }

  if (config.groqApiKey) {
    slots.push(
      {
        label: "groq/gpt-oss-120b",
        baseUrl: GROQ_BASE,
        apiKey: config.groqApiKey,
        model: "openai/gpt-oss-120b",
        cheap: false,
      },
      {
        label: "groq/qwen3.8-27b",
        baseUrl: GROQ_BASE,
        apiKey: config.groqApiKey,
        model: "qwen/qwen3.8-27b",
        cheap: true,
      },
      {
        label: "groq/gpt-oss-20b",
        baseUrl: GROQ_BASE,
        apiKey: config.groqApiKey,
        model: "openai/gpt-oss-20b",
        cheap: false,
      },
    );
  }

  if (config.openRouterApiKey) {
    slots.push(
      {
        label: "openrouter/llama-3.3-70b:free",
        baseUrl: OPENROUTER_BASE,
        apiKey: config.openRouterApiKey,
        model: "meta-llama/llama-3.3-70b-instruct:free",
        cheap: false,
      },
      {
        label: "openrouter/gemma-3-27b:free",
        baseUrl: OPENROUTER_BASE,
        apiKey: config.openRouterApiKey,
        model: "google/gemma-3-27b-it:free",
        cheap: true,
      },
      {
        label: "openrouter/free",
        baseUrl: OPENROUTER_BASE,
        apiKey: config.openRouterApiKey,
        model: "openrouter/free",
        cheap: true,
      },
    );
  }

  return slots;
}
