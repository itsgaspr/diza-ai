import { BufferJSON, initAuthCreds, type AuthenticationState } from "@whiskeysockets/baileys";
import { proto } from "@whiskeysockets/baileys/WAProto/index.js";
import type { Sql } from "./sql.js";

export interface SavedAuth {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

export async function useDbAuthState(sql: Sql): Promise<SavedAuth> {
  await sql.run(`CREATE TABLE IF NOT EXISTS wa_auth (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  const readData = async (file: string): Promise<unknown> => {
    const row = await sql.get<{ value: string }>("SELECT value FROM wa_auth WHERE name = $1", [fileName(file)]);
    if (!row) return null;
    return JSON.parse(row.value, BufferJSON.reviver);
  };

  const writeData = async (data: unknown, file: string): Promise<void> => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await sql.run(
      `INSERT INTO wa_auth (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = excluded.value`,
      [fileName(file), value],
    );
  };

  const removeData = async (file: string): Promise<void> => {
    await sql.run("DELETE FROM wa_auth WHERE name = $1", [fileName(file)]);
  };

  const creds = ((await readData("creds.json")) as AuthenticationState["creds"] | null) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, unknown> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
              }
              data[id] = value;
            }),
          );
          return data as { [id: string]: never };
        },
        set: async (data) => {
          const tasks: Array<Promise<void>> = [];
          for (const category of Object.keys(data)) {
            const group = data[category as keyof typeof data];
            if (!group) continue;
            for (const id of Object.keys(group)) {
              const value = group[id as keyof typeof group];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
  };
}

function fileName(file: string): string {
  return file.replace(/\//g, "__").replace(/:/g, "-");
}
