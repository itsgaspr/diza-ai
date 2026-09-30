import "dotenv/config";

export type PersonRole = "user" | "original_diza";

export interface AppConfig {
  userPhone: string;
  userName: string;
  originalDizaPhone: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openRouterApiKey?: string;
  timezone: string;
  quietStartHour: number;
  quietEndHour: number;
  debounceMs: number;
  historyLimit: number;
  memoryEvery: number;
  initiativeTickMs: number;
  initiativeGraceMs: number;
  liveConversationMs: number;
  minInitiativeGapMs: number;
  maxInitiativePerDay: number;
  llmTimeoutMs: number;
  pingPort: number;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(`Falta ${name} no .env`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} precisa ser um número`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const geminiApiKey = optional("GEMINI_API_KEY");
  const groqApiKey = optional("GROQ_API_KEY");
  const openRouterApiKey = optional("OPENROUTER_API_KEY");
  if (!geminiApiKey && !groqApiKey && !openRouterApiKey) {
    throw new Error(
      "Precisa de pelo menos uma chave: GEMINI_API_KEY, GROQ_API_KEY ou OPENROUTER_API_KEY",
    );
  }

  return {
    userPhone: required("USER_PHONE"),
    userName: optional("USER_NAME") ?? "",
    originalDizaPhone: required("ORIGINAL_DIZA_PHONE"),
    geminiApiKey,
    groqApiKey,
    openRouterApiKey,
    timezone:
      optional("DIZA_TIMEZONE") ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC",
    quietStartHour: intEnv("QUIET_START_HOUR", 23),
    quietEndHour: intEnv("QUIET_END_HOUR", 8),
    debounceMs: intEnv("DEBOUNCE_MS", 4_000),
    historyLimit: intEnv("HISTORY_LIMIT", 24),
    memoryEvery: intEnv("MEMORY_EVERY", 6),
    initiativeTickMs: intEnv("INITIATIVE_TICK_MS", 20 * 60 * 1000),
    initiativeGraceMs: intEnv("INITIATIVE_GRACE_MS", 2 * 60 * 1000),
    liveConversationMs: intEnv("LIVE_CONVERSATION_MS", 45 * 60 * 1000),
    minInitiativeGapMs: intEnv("MIN_INITIATIVE_GAP_MS", 4 * 60 * 60 * 1000),
    maxInitiativePerDay: intEnv("MAX_INITIATIVE_PER_DAY", 2),
    llmTimeoutMs: intEnv("LLM_TIMEOUT_MS", 45_000),
    pingPort: intEnv("PORT", intEnv("PING_PORT", 3080)),
  };
}
