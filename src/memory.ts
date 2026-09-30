import type { AppConfig, PersonRole } from "./config.js";
import { digits, phonesMatch } from "./phone.js";
import type { Sql } from "./sql.js";

export interface Person {
  id: number;
  phone: string;
  role: PersonRole;
  name: string;
  lastJid: string | null;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  initiative: boolean;
}

interface UserRow {
  id: number;
  phone: string;
  role: PersonRole;
  name: string;
  last_jid: string | null;
}

export class Memory {
  private constructor(private readonly db: Sql) {}

  static async open(db: Sql, config: AppConfig): Promise<Memory> {
    const memory = new Memory(db);
    await memory.seed(digits(config.userPhone), "user", config.userName);
    await memory.seed(digits(config.originalDizaPhone), "original_diza", "Diza");
    return memory;
  }

  async knownLids(): Promise<Array<{ phone: string; lid: string }>> {
    const rows = await this.db.all<{ phone: string; lid: string }>(
      "SELECT phone, lid FROM users WHERE lid IS NOT NULL AND lid != ''",
    );
    return rows.map((row) => ({ phone: row.phone, lid: row.lid }));
  }

  async setLid(phone: string, lid: string): Promise<void> {
    const person = await this.findByPhone(phone);
    const user = digits(lid.split("@")[0]?.split(":")[0] ?? "");
    if (!person || !user) return;
    await this.db.run("UPDATE users SET lid = $1 WHERE id = $2", [`${user}@lid`, person.id]);
  }

  async people(): Promise<Person[]> {
    const rows = await this.db.all<UserRow>("SELECT id, phone, role, name, last_jid FROM users ORDER BY id");
    return rows.map(toPerson);
  }

  async findByPhone(phone: string): Promise<Person | null> {
    const people = await this.people();
    return people.find((person) => phonesMatch(person.phone, phone)) ?? null;
  }

  async touchJid(userId: number, jid: string): Promise<void> {
    await this.db.run("UPDATE users SET last_jid = $1 WHERE id = $2", [jid, userId]);
  }

  async addMessage(userId: number, role: "user" | "assistant", content: string, initiative: boolean): Promise<void> {
    await this.db.run(
      "INSERT INTO messages (user_id, role, content, initiative, created_at) VALUES ($1, $2, $3, $4, $5)",
      [userId, role, content, initiative ? 1 : 0, Date.now()],
    );
  }

  async recentMessages(userId: number, limit: number): Promise<StoredMessage[]> {
    const rows = await this.db.all<{ role: "user" | "assistant"; content: string; initiative: number }>(
      `SELECT role, content, initiative FROM messages
       WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
      initiative: Number(row.initiative) === 1,
    }));
  }

  async memoriesOf(userId: number): Promise<string[]> {
    const rows = await this.db.all<{ content: string }>(
      "SELECT content FROM memories WHERE user_id = $1 ORDER BY id DESC LIMIT 20",
      [userId],
    );
    return rows.reverse().map((row) => row.content);
  }

  async addMemory(userId: number, content: string): Promise<void> {
    await this.db.run("INSERT INTO memories (user_id, content, created_at) VALUES ($1, $2, $3)", [
      userId,
      content,
      Date.now(),
    ]);
  }

  async userMessagesSinceExtract(userId: number): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM messages
       WHERE user_id = $1 AND role = 'user' AND id > (
         SELECT last_extract_message_id FROM users WHERE id = $2
       )`,
      [userId, userId],
    );
    return Number(row?.count ?? 0);
  }

  async markExtracted(userId: number): Promise<void> {
    const row = await this.db.get<{ id: number }>(
      "SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE user_id = $1",
      [userId],
    );
    await this.db.run("UPDATE users SET last_extract_message_id = $1 WHERE id = $2", [Number(row?.id ?? 0), userId]);
  }

  async hasUserMessage(userId: number): Promise<boolean> {
    const row = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM messages WHERE user_id = $1 AND role = 'user'",
      [userId],
    );
    return Number(row?.count ?? 0) > 0;
  }

  async lastActivityAt(userId: number): Promise<number | null> {
    const row = await this.db.get<{ at: number | null }>(
      "SELECT MAX(created_at) AS at FROM messages WHERE user_id = $1",
      [userId],
    );
    return row?.at == null ? null : Number(row.at);
  }

  async lastInitiativeAt(userId: number): Promise<number | null> {
    const row = await this.db.get<{ at: number | null }>(
      "SELECT MAX(created_at) AS at FROM initiative_log WHERE user_id = $1 AND outcome = 'sent'",
      [userId],
    );
    return row?.at == null ? null : Number(row.at);
  }

  async initiativeCountSince(userId: number, since: number): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM initiative_log
       WHERE user_id = $1 AND outcome = 'sent' AND created_at >= $2`,
      [userId, since],
    );
    return Number(row?.count ?? 0);
  }

  async logInitiative(userId: number, outcome: "sent" | "quiet", reason: string): Promise<void> {
    await this.db.run(
      "INSERT INTO initiative_log (user_id, outcome, reason, created_at) VALUES ($1, $2, $3, $4)",
      [userId, outcome, reason, Date.now()],
    );
  }

  private async seed(phone: string, role: PersonRole, name: string): Promise<void> {
    await this.db.run(
      `INSERT INTO users (phone, role, name) VALUES ($1, $2, $3)
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name`,
      [phone, role, name],
    );
  }
}

function toPerson(row: UserRow): Person {
  return {
    id: Number(row.id),
    phone: row.phone,
    role: row.role,
    name: row.name,
    lastJid: row.last_jid,
  };
}
