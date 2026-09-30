import { useDbAuthState, useFileAuthState, type SavedAuth } from "./auth-state.js";
import { loadConfig, storagePaths } from "./config.js";
import { DizaCore } from "./core.js";
import { startGateway } from "./gateway.js";
import { startInitiative } from "./initiative.js";
import { Memory } from "./memory.js";
import { buildSlots } from "./models.js";
import { startPing } from "./ping.js";
import { ModelRouter } from "./router.js";
import { openPostgres, openSqlite } from "./sql.js";

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
  const paths = storagePaths(config.dataDir);
  let memory: Memory;
  let auth: SavedAuth;
  if (config.databaseUrl) {
    const sql = await openPostgres(config.databaseUrl);
    memory = await Memory.open(sql, config);
    auth = await useDbAuthState(sql);
    console.log("[diza] sessão e memória no Neon");
  } else if (process.env.RENDER) {
    throw new Error("Falta DATABASE_URL. Copia a connection string do Neon para o Render.");
  } else {
    memory = await Memory.open(openSqlite(paths.dbPath), config);
    auth = await useFileAuthState(paths.authDir);
    console.log(`[diza] sessão em ${paths.authDir}, memória em ${paths.dbPath}`);
  }
  const router = new ModelRouter(buildSlots(config), config.llmTimeoutMs);
  const core = new DizaCore(memory, router, config);

  startPing(config.pingPort);

  await startGateway({
    config,
    auth,
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
