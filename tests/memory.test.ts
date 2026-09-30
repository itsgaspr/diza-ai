import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { Memory } from "../src/memory.js";
import { openSqlite } from "../src/sql.js";

function config(): AppConfig {
  return {
    userPhone: "+351 910 000 001",
    userName: "Raki",
    originalDizaPhone: "351910000002",
    timezone: "UTC",
    quietStartHour: 23,
    quietEndHour: 8,
    debounceMs: 1000,
    historyLimit: 10,
    memoryEvery: 6,
    initiativeTickMs: 1000,
    initiativeGraceMs: 1000,
    liveConversationMs: 1000,
    minInitiativeGapMs: 1000,
    maxInitiativePerDay: 2,
    llmTimeoutMs: 1000,
    pingPort: 0,
  };
}

test("conversas ficam separadas por pessoa", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diza-"));
  try {
    const memory = await Memory.open(openSqlite(join(dir, "diza.db")), config());
    const me = await memory.findByPhone("351910000001");
    const original = await memory.findByPhone("351910000002");
    assert.ok(me);
    assert.ok(original);
    assert.equal(me.role, "user");
    assert.equal(me.name, "Raki");
    assert.equal(original.role, "original_diza");
    assert.equal(await memory.findByPhone("351910000099"), null);

    await memory.addMessage(me.id, "user", "oi, sou eu", false);
    await memory.addMessage(original.id, "user", "oi, sou a outra", false);
    assert.deepEqual(
      (await memory.recentMessages(me.id, 10)).map((item) => item.content),
      ["oi, sou eu"],
    );
    assert.deepEqual(
      (await memory.recentMessages(original.id, 10)).map((item) => item.content),
      ["oi, sou a outra"],
    );
    assert.equal(await memory.hasUserMessage(me.id), true);
    assert.equal(await memory.userMessagesSinceExtract(me.id), 1);
    await memory.setLid("351910000001", "155255065026685@lid");
    assert.deepEqual(await memory.knownLids(), [{ phone: "351910000001", lid: "155255065026685@lid" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
