import { loadConfig } from "./config.js";
import { DizaCore } from "./core.js";
import { startGateway } from "./gateway.js";
import { startInitiative } from "./initiative.js";
import { Memory } from "./memory.js";
import { buildSlots } from "./models.js";
import { startPing } from "./ping.js";
import { ModelRouter } from "./router.js";

const locks = new Map<number, Promise<unknown>>();

function lock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    userId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  const memory = new Memory("data/diza.db", config);
  const router = new ModelRouter(buildSlots(config), config.llmTimeoutMs);
  const core = new DizaCore(memory, router, config);

  startPing(config.pingPort);

  await startGateway({
    config,
    memory,
    core,
    startedAt,
    lock,
    onConnected: (ready) => {
      startInitiative({
        config,
        memory,
        core,
        isConnected: () => ready.isConnected(),
        send: (jid, text) => ready.send(jid, text),
        lock,
      });
    },
  });
}

main().catch((error: Error) => {
  console.error(`[diza] ${error.message}`);
  process.exit(1);
});
