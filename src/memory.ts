import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig, PersonRole } from "./config.js";
import { digits, phonesMatch } from "./phone.js";

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
  private readonly db: DatabaseSync;

  constructor(path: string, config: AppConfig) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        phone TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        last_jid TEXT,
        lid TEXT,
        last_extract_message_id INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        initiative INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS initiative_log (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        outcome TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "lid")) {
      this.db.exec("ALTER TABLE users ADD COLUMN lid TEXT");
    }
    this.seed(digits(config.userPhone), "user", config.userName);
    this.seed(digits(config.originalDizaPhone), "original_diza", "Diza");
  }

  knownLids(): Array<{ phone: string; lid: string }> {
    const rows = this.db
      .prepare("SELECT phone, lid FROM users WHERE lid IS NOT NULL AND lid != ''")
      .all() as Array<{ phone: string; lid: string }>;
    return rows.map((row) => ({ phone: row.phone, lid: row.lid }));
  }

  setLid(phone: string, lid: string): void {
    const person = this.findByPhone(phone);
    const user = digits(lid.split("@")[0]?.split(":")[0] ?? "");
    if (!person || !user) return;
    this.db.prepare("UPDATE users SET lid = ? WHERE id = ?").run(`${user}@lid`, person.id);
  }

  people(): Person[] {
    const rows = this.db.prepare("SELECT id, phone, role, name, last_jid FROM users ORDER BY id").all() as unknown as UserRow[];
    return rows.map(toPerson);
  }

  findByPhone(phone: string): Person | null {
    return this.people().find((person) => phonesMatch(person.phone, phone)) ?? null;
  }

  touchJid(userId: number, jid: string): void {
    this.db.prepare("UPDATE users SET last_jid = ? WHERE id = ?").run(jid, userId);
  }

  addMessage(userId: number, role: "user" | "assistant", content: string, initiative: boolean): void {
    this.db
      .prepare(
        "INSERT INTO messages (user_id, role, content, initiative, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(userId, role, content, initiative ? 1 : 0, Date.now());
  }

  recentMessages(userId: number, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, initiative FROM messages
         WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, limit) as Array<{ role: "user" | "assistant"; content: string; initiative: number }>;
    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
      initiative: row.initiative === 1,
    }));
  }

  memoriesOf(userId: number): string[] {
    const rows = this.db
      .prepare("SELECT content FROM memories WHERE user_id = ? ORDER BY id DESC LIMIT 20")
      .all(userId) as Array<{ content: string }>;
    return rows.reverse().map((row) => row.content);
  }

  addMemory(userId: number, content: string): void {
    this.db
      .prepare("INSERT INTO memories (user_id, content, created_at) VALUES (?, ?, ?)")
      .run(userId, content, Date.now());
  }

  userMessagesSinceExtract(userId: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE user_id = ? AND role = 'user' AND id > (
           SELECT last_extract_message_id FROM users WHERE id = ?
         )`,
      )
      .get(userId, userId) as { count: number };
    return row.count;
  }

  markExtracted(userId: number): void {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE user_id = ?")
      .get(userId) as { id: number };
    this.db.prepare("UPDATE users SET last_extract_message_id = ? WHERE id = ?").run(row.id, userId);
  }

  hasUserMessage(userId: number): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE user_id = ? AND role = 'user'")
      .get(userId) as { count: number };
    return row.count > 0;
  }

  lastActivityAt(userId: number): number | null {
    const row = this.db
      .prepare("SELECT MAX(created_at) AS at FROM messages WHERE user_id = ?")
      .get(userId) as { at: number | null };
    return row.at;
  }

  lastInitiativeAt(userId: number): number | null {
    const row = this.db
      .prepare(
        "SELECT MAX(created_at) AS at FROM initiative_log WHERE user_id = ? AND outcome = 'sent'",
      )
      .get(userId) as { at: number | null };
    return row.at;
  }

  initiativeCountSince(userId: number, since: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM initiative_log
         WHERE user_id = ? AND outcome = 'sent' AND created_at >= ?`,
      )
      .get(userId, since) as { count: number };
    return row.count;
  }

  logInitiative(userId: number, outcome: "sent" | "quiet", reason: string): void {
    this.db
      .prepare(
        "INSERT INTO initiative_log (user_id, outcome, reason, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(userId, outcome, reason, Date.now());
  }

  private seed(phone: string, role: PersonRole, name: string): void {
    this.db
      .prepare("INSERT INTO users (phone, role, name) VALUES (?, ?, ?) ON CONFLICT(phone) DO UPDATE SET name = excluded.name")
      .run(phone, role, name);
  }
}

function toPerson(row: UserRow): Person {
  return {
    id: row.id,
    phone: row.phone,
    role: row.role,
    name: row.name,
    lastJid: row.last_jid,
  };
}
