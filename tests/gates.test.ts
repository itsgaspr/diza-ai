import assert from "node:assert/strict";
import test from "node:test";
import { initiativeBlockReason } from "../src/initiative.js";
import { phoneForLid, phoneFromUserJid, phonesMatch, rememberLidPhone } from "../src/phone.js";
import { hourInZone, isQuietHour, startOfLocalDay } from "../src/time.js";

const base = {
  now: Date.UTC(2026, 8, 30, 12, 0, 0),
  timezone: "UTC",
  quietStartHour: 23,
  quietEndHour: 8,
  liveConversationMs: 45 * 60 * 1000,
  minInitiativeGapMs: 4 * 60 * 60 * 1000,
  maxInitiativePerDay: 2,
  hasUserMessage: true,
  lastActivityAt: Date.UTC(2026, 8, 30, 8, 0, 0),
  lastInitiativeAt: null as number | null,
  initiativeToday: 0,
};

test("números batem com ou sem o código do país", () => {
  assert.equal(phonesMatch("+55 11 98888-7777", "5511988887777"), true);
  assert.equal(phonesMatch("11988887777", "5511988887777"), true);
  assert.equal(phonesMatch("5511988887777", "5511988886666"), false);
});

test("jid de telefone vira dígitos e lid não", () => {
  assert.equal(phoneFromUserJid("5511988887777@s.whatsapp.net"), "5511988887777");
  assert.equal(phoneFromUserJid("5511988887777:12@s.whatsapp.net"), "5511988887777");
  assert.equal(phoneFromUserJid("123@lid"), null);
});

test("lid guarda o telefone em qualquer forma", () => {
  const map = new Map<string, string>();
  rememberLidPhone(map, "155255065026685", "258853692104@s.whatsapp.net");
  assert.equal(phoneForLid(map, "155255065026685@lid"), "258853692104");
  assert.equal(phoneForLid(map, "155255065026685:0@lid"), "258853692104");
});

test("horário quieto atravessa a meia-noite", () => {
  assert.equal(isQuietHour(23, 23, 8), true);
  assert.equal(isQuietHour(2, 23, 8), true);
  assert.equal(isQuietHour(8, 23, 8), false);
  assert.equal(isQuietHour(12, 23, 8), false);
});

test("hora no fuso", () => {
  assert.equal(hourInZone(Date.UTC(2026, 8, 30, 22, 30, 0), "UTC"), 22);
  assert.equal(hourInZone(Date.UTC(2026, 8, 30, 22, 30, 0), "Europe/Lisbon"), 23);
});

test("início do dia local", () => {
  const now = Date.UTC(2026, 8, 30, 1, 30, 0);
  assert.equal(startOfLocalDay(now, "UTC"), Date.UTC(2026, 8, 30, 0, 0, 0));
});

test("iniciativa passa quando a conversa esfriou", () => {
  assert.equal(initiativeBlockReason(base), null);
});

test("portões da iniciativa", () => {
  assert.equal(initiativeBlockReason({ ...base, now: Date.UTC(2026, 8, 30, 23, 30, 0) }), "quiet-hours");
  assert.equal(initiativeBlockReason({ ...base, hasUserMessage: false }), "no-history");
  assert.equal(
    initiativeBlockReason({ ...base, lastActivityAt: base.now - 10 * 60 * 1000 }),
    "live",
  );
  assert.equal(
    initiativeBlockReason({ ...base, lastInitiativeAt: base.now - 60 * 60 * 1000 }),
    "recent",
  );
  assert.equal(initiativeBlockReason({ ...base, initiativeToday: 2 }), "cap");
});
