import { setTimeout as delay } from "node:timers/promises";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidStatusBroadcast,
  makeWASocket as makeWASocketExport,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { SavedAuth } from "./auth-state.js";
import type { AppConfig } from "./config.js";
import type { DizaCore } from "./core.js";
import type { Memory, Person } from "./memory.js";
import { digits, phoneForLid, phoneFromUserJid, rememberLidPhone } from "./phone.js";

const makeWASocket = resolveMakeWASocket(makeWASocketExport);

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
  auth: SavedAuth;
  memory: Memory;
  core: DizaCore;
  startedAt: number;
  lock: <T>(userId: number, fn: () => Promise<T>) => Promise<T>;
  onConnected: (gateway: Gateway) => void;
}): Promise<Gateway> {
  const auth = options.auth;
  let sock: WASocket | null = null;
  let connected = false;
  let announced = false;
  let generation = 0;
  const lidPhones = new Map<string, string>();
  for (const known of await options.memory.knownLids()) {
    rememberLidPhone(lidPhones, known.lid, known.phone);
  }
  let lidLookup: Promise<void> = Promise.resolve();
  let lidsLearnedAt = 0;
  const bursts = new Map<number, { parts: string[]; jid: string; timer?: NodeJS.Timeout }>();

  const storeLid = (lid: string | null | undefined, phone: string | null | undefined) => {
    if (!lid || !phone) return;
    rememberLidPhone(lidPhones, lid, phone);
    void options.memory.setLid(phone, lid).catch((error: Error) => {
      console.warn(`[diza] lid não gravou: ${error.message}`);
    });
  };

  const absorbContact = (contact: { id?: string; lid?: string | null; jid?: string | null }) => {
    const phone = phoneFromUserJid(contact.jid) ?? phoneFromUserJid(contact.id);
    const lid = contact.lid || (contact.id?.endsWith("@lid") ? contact.id : undefined);
    storeLid(lid, phone);
  };

  const learnLids = async (socket: WASocket) => {
    try {
      const phones = [options.config.userPhone, options.config.originalDizaPhone];
      const rows = await socket.onWhatsApp(...phones.map((phone) => `${digits(phone)}@s.whatsapp.net`));
      let found = 0;
      for (const row of rows ?? []) {
        const phone = phoneFromUserJid(row.jid);
        const lid = typeof row.lid === "string" ? row.lid : null;
        if (!phone || !lid) continue;
        storeLid(lid, phone);
        found += 1;
        console.log(`[diza] ${digits(lid)}@lid é ${(await options.memory.findByPhone(phone))?.name ?? "lista"}`);
      }
      if (!found) console.warn("[diza] WhatsApp não devolveu o lid dos números da lista");
    } finally {
      lidsLearnedAt = Date.now();
    }
  };

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
      previous.ev.removeAllListeners("contacts.upsert");
      previous.ev.removeAllListeners("contacts.update");
      previous.ev.removeAllListeners("messaging-history.set");
      previous.ev.removeAllListeners("chats.phoneNumberShare");
      previous.end(undefined);
    }
    current.ev.on("creds.update", auth.saveCreds);
    current.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      storeLid(lid, phoneFromUserJid(jid));
    });
    current.ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) absorbContact(contact);
    });
    current.ev.on("contacts.update", (contacts) => {
      for (const contact of contacts) absorbContact(contact);
    });
    current.ev.on("messaging-history.set", ({ contacts }) => {
      for (const contact of contacts) absorbContact(contact);
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
        lidLookup = learnLids(current).catch((error: Error) => {
          console.warn(`[diza] falha ao ligar lid: ${error.message}`);
        });
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

    storeLid(remoteJid.endsWith("@lid") ? remoteJid : null, phoneFromUserJid(key.senderPn));
    let phone = resolvePhone(remoteJid, key.senderPn, lidPhones);
    if (!phone && remoteJid.endsWith("@lid")) {
      await lidLookup;
      phone = resolvePhone(remoteJid, key.senderPn, lidPhones);
      if (!phone && sock && Date.now() - lidsLearnedAt > 15_000) {
        lidLookup = learnLids(sock).catch((error: Error) => {
          console.warn(`[diza] falha ao ligar lid: ${error.message}`);
        });
        await lidLookup;
        phone = resolvePhone(remoteJid, key.senderPn, lidPhones);
      }
    }
    if (!phone) {
      console.warn(`[diza] não achei telefone para ${remoteJid}`);
      return;
    }
    const person = await options.memory.findByPhone(phone);
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
    await options.memory.touchJid(person.id, burst.jid);
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
  return gateway;
}

function resolveMakeWASocket(exported: unknown): typeof makeWASocketExport {
  if (typeof exported === "function") return exported as typeof makeWASocketExport;
  if (exported && typeof exported === "object") {
    const nested = exported as { default?: unknown; makeWASocket?: unknown };
    if (typeof nested.makeWASocket === "function") return nested.makeWASocket as typeof makeWASocketExport;
    if (typeof nested.default === "function") return nested.default as typeof makeWASocketExport;
    if (nested.default && typeof nested.default === "object") {
      const inner = nested.default as { default?: unknown; makeWASocket?: unknown };
      if (typeof inner.makeWASocket === "function") return inner.makeWASocket as typeof makeWASocketExport;
      if (typeof inner.default === "function") return inner.default as typeof makeWASocketExport;
    }
  }
  throw new Error("makeWASocket is not a function");
}

function resolvePhone(
  remoteJid: string,
  senderPn: string | null | undefined,
  lidPhones: Map<string, string>,
): string | null {
  return phoneFromUserJid(remoteJid) ?? phoneFromUserJid(senderPn) ?? phoneForLid(lidPhones, remoteJid);
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
