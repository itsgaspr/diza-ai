import type { AppConfig } from "./config.js";
import type { DizaCore } from "./core.js";
import type { Memory, Person } from "./memory.js";
import { digits } from "./phone.js";
import { hourInZone, isQuietHour, startOfLocalDay } from "./time.js";

export interface GateInput {
  now: number;
  timezone: string;
  quietStartHour: number;
  quietEndHour: number;
  liveConversationMs: number;
  minInitiativeGapMs: number;
  maxInitiativePerDay: number;
  hasUserMessage: boolean;
  lastActivityAt: number | null;
  lastInitiativeAt: number | null;
  initiativeToday: number;
}

export function initiativeBlockReason(input: GateInput): string | null {
  const hour = hourInZone(input.now, input.timezone);
  if (isQuietHour(hour, input.quietStartHour, input.quietEndHour)) return "quiet-hours";
  if (!input.hasUserMessage) return "no-history";
  if (input.lastActivityAt !== null && input.now - input.lastActivityAt < input.liveConversationMs) {
    return "live";
  }
  if (input.lastInitiativeAt !== null && input.now - input.lastInitiativeAt < input.minInitiativeGapMs) {
    return "recent";
  }
  if (input.initiativeToday >= input.maxInitiativePerDay) return "cap";
  return null;
}

export interface SendText {
  (jid: string, text: string): Promise<void>;
}

export function startInitiative(options: {
  config: AppConfig;
  memory: Memory;
  core: DizaCore;
  isConnected: () => boolean;
  send: SendText;
  lock: <T>(userId: number, fn: () => Promise<T>) => Promise<T>;
}): void {
  const { config } = options;
  const tick = () => {
    void runTick(options).catch((error: Error) => {
      console.warn(`[diza] tick de iniciativa falhou: ${error.message}`);
    });
  };
  setTimeout(() => {
    tick();
    setInterval(tick, config.initiativeTickMs);
  }, config.initiativeGraceMs);
  console.log(`[diza] iniciativa começa em ${Math.round(config.initiativeGraceMs / 1000)}s`);
}

async function runTick(options: {
  config: AppConfig;
  memory: Memory;
  core: DizaCore;
  isConnected: () => boolean;
  send: SendText;
  lock: <T>(userId: number, fn: () => Promise<T>) => Promise<T>;
}): Promise<void> {
  if (!options.isConnected()) return;
  for (const person of options.memory.people()) {
    await options.lock(person.id, () => consider(person, options));
  }
}

async function consider(
  person: Person,
  options: {
    config: AppConfig;
    memory: Memory;
    core: DizaCore;
    send: SendText;
  },
): Promise<void> {
  const { config, memory, core, send } = options;
  const now = Date.now();
  const reason = initiativeBlockReason({
    now,
    timezone: config.timezone,
    quietStartHour: config.quietStartHour,
    quietEndHour: config.quietEndHour,
    liveConversationMs: config.liveConversationMs,
    minInitiativeGapMs: config.minInitiativeGapMs,
    maxInitiativePerDay: config.maxInitiativePerDay,
    hasUserMessage: memory.hasUserMessage(person.id),
    lastActivityAt: memory.lastActivityAt(person.id),
    lastInitiativeAt: memory.lastInitiativeAt(person.id),
    initiativeToday: memory.initiativeCountSince(person.id, startOfLocalDay(now, config.timezone)),
  });
  if (reason) {
    memory.logInitiative(person.id, "quiet", reason);
    return;
  }

  const text = await core.initiate(person);
  if (!text) {
    memory.logInitiative(person.id, "quiet", "model-failed");
    return;
  }

  const jid = person.lastJid ?? `${digits(person.phone)}@s.whatsapp.net`;
  try {
    await send(jid, text);
  } catch (error) {
    console.warn(`[diza] não enviei iniciativa: ${(error as Error).message}`);
    memory.logInitiative(person.id, "quiet", "send-failed");
    return;
  }
  memory.addMessage(person.id, "assistant", text, true);
  memory.logInitiative(person.id, "sent", "spontaneous");
  console.log(`[diza] iniciativa para ${person.role}`);
}
