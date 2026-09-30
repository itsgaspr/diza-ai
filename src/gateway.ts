import { setTimeout as delay } from "node:timers/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidStatusBroadcast,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { AppConfig } from "./config.js";
import type { DizaCore } from "./core.js";
import type { Memory, Person } from "./memory.js";
import { phoneFromUserJid } from "./phone.js";

const logger = pino({ level: "silent" });

const originalConsoleError = console.error.bind(console);
let decryptNoticeAt = 0;
console.error = (...args: unknown[]) => {
  const text = args.map((item) => (typeof item === "string" ? item : item instanceof Error ? item.message : "")).join(" ");
  if (text.includes("Bad MAC") || text.includes("Failed to decrypt")) {
    const now = Date.now();
    if (now - decryptNoticeAt > 15_000) {
      decryptNoticeAt = now;
      console.warn("[diza] mensagem antiga não abriu, a chave da sessão mudou. manda de novo");
    }
    return;
  }
  originalConsoleError(...args);
};

export interface Gateway {
  send(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
}

export async function startGateway(options: {
  config: AppConfig;
  memory: Memory;
  core: DizaCore;
  startedAt: number;
  lock: <T>(userId: number, fn: () => Promise<T>) => Promise<T>;
  onConnected: (gateway: Gateway) => void;
}): Promise<void> {
  const auth = await useMultiFileAuthState("auth");
  let sock: WASocket | null = null;
  let connected = false;
  let announced = false;
  let generation = 0;
  const lidPhones = new Map<string, string>();
  const bursts = new Map<number, { parts: string[]; jid: string; timer?: NodeJS.Timeout }>();

  const gateway: Gateway = {
    isConnected: () => connected,
    send: async (jid, text) => {
      if (!sock || !connected) throw new Error("WhatsApp desconectado");
      const chunks = bubbles(text);
      for (let index = 0; index < chunks.length; index += 1) {
        if (index > 0) await delay(700);
        await sock.sendMessage(jid, { text: chunks[index] });
      }
    },
  };

  const connect = async () => {
    const mine = ++generation;
    const { version } = await fetchLatestBaileysVersion();
    const previous = sock;
    const current = makeWASocket({
      version,
      auth: auth.state,
      logger,
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
    });
    sock = current;
    if (previous && previous !== current) {
      previous.ev.removeAllListeners("connection.update");
      previous.ev.removeAllListeners("messages.upsert");
      previous.end(undefined);
    }
    current.ev.on("creds.update", auth.saveCreds);
    current.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      const phone = phoneFromUserJid(jid) ?? jid.replace(/\D/g, "");
      if (lid && phone) lidPhones.set(lid, phone);
    });
    current.ev.on("connection.update", (update) => {
      if (mine !== generation) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log("[diza] escaneia o QR com o WhatsApp da Diza");
        qrcode.generate(qr, { small: true });
      }
      if (connection === "open") {
        connected = true;
        console.log("[diza] WhatsApp conectado");
        if (!announced) {
          announced = true;
          options.onConnected(gateway);
        }
      }
      if (connection === "close") {
        connected = false;
        const status = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;
        const loggedOut = status === DisconnectReason.loggedOut;
        console.warn(`[diza] WhatsApp caiu (${status ?? "sem código"})`);
        if (!loggedOut) {
          const wait = status === DisconnectReason.timedOut ? 5_000 : 2_000;
          setTimeout(() => {
            void connect().catch((error: Error) => {
              console.error(`[diza] reconexão falhou: ${error.message}`);
            });
          }, wait);
        }
      }
    });
    current.ev.on("messages.upsert", ({ messages, type }) => {
      if (mine !== generation || type !== "notify") return;
      for (const message of messages) {
        void accept(message).catch((error: Error) => {
          console.warn(`[diza] mensagem ignorada: ${error.message}`);
        });
      }
    });
  };

  const accept = async (message: WAMessage) => {
    const key = message.key;
    if (key.fromMe) return;
    const remoteJid = key.remoteJid;
    if (!remoteJid || isJidGroup(remoteJid) || isJidStatusBroadcast(remoteJid)) return;
    if (!remoteJid.endsWith("@s.whatsapp.net") && !remoteJid.endsWith("@lid")) return;
    const stamp = messageTimestampMs(message);
    if (stamp === null || stamp < options.startedAt) return;
    const text = messageText(message);
    if (!text) return;

    const phone = resolvePhone(remoteJid, key.senderPn, lidPhones);
    if (!phone) {
      console.warn(`[diza] não achei telefone para ${remoteJid}`);
      return;
    }
    const person = options.memory.findByPhone(phone);
    if (!person) {
      console.log(`[diza] número fora da lista: ${phone}`);
      return;
    }

    let burst = bursts.get(person.id);
    if (!burst) {
      burst = { parts: [], jid: remoteJid };
      bursts.set(person.id, burst);
    }
    burst.jid = remoteJid;
    burst.parts.push(text);
    if (burst.timer) clearTimeout(burst.timer);
    burst.timer = setTimeout(() => {
      void flush(person).catch((error: Error) => {
        console.error(`[diza] falha ao responder: ${error.message}`);
      });
    }, options.config.debounceMs);
  };

  const flush = async (person: Person) => {
    const burst = bursts.get(person.id);
    if (!burst) return;
    if (!sock || !connected) {
      burst.timer = setTimeout(() => {
        void flush(person);
      }, 2_000);
      return;
    }
    bursts.delete(person.id);
    const text = burst.parts.join("\n").trim();
    if (!text) return;
    options.memory.touchJid(person.id, burst.jid);
    await options.lock(person.id, async () => {
      try {
        await sock?.sendPresenceUpdate("composing", burst.jid);
        const answer = await options.core.reply(person, text);
        await gateway.send(burst.jid, answer);
      } finally {
        await sock?.sendPresenceUpdate("paused", burst.jid).catch(() => undefined);
      }
    });
  };

  await connect();
}

function resolvePhone(
  remoteJid: string,
  senderPn: string | null | undefined,
  lidPhones: Map<string, string>,
): string | null {
  return phoneFromUserJid(remoteJid) ?? phoneFromUserJid(senderPn) ?? lidPhones.get(remoteJid) ?? null;
}

function messageText(message: WAMessage): string | null {
  const content = message.message;
  if (!content) return null;
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  return null;
}

function messageTimestampMs(message: WAMessage): number | null {
  const raw = message.messageTimestamp;
  if (raw === undefined || raw === null) return null;
  const seconds =
    typeof raw === "number"
      ? raw
      : typeof (raw as { toNumber?: () => number }).toNumber === "function"
        ? (raw as { toNumber: () => number }).toNumber()
        : Number(raw);
  if (!Number.isFinite(seconds)) return null;
  return seconds * 1000;
}

function bubbles(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const lines = blocks.length > 1 ? blocks : text.split("\n").map((part) => part.trim()).filter(Boolean);
  const chosen = (lines.length > 0 ? lines : [text.trim()]).slice(0, 4);
  return chosen.flatMap(splitLong);
}

function splitLong(text: string): string[] {
  const limit = 4000;
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += limit) {
    chunks.push(text.slice(index, index + limit));
  }
  return chunks;
}
