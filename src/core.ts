import type { AppConfig } from "./config.js";
import { Memory, type Person } from "./memory.js";
import { failLine, initiativeInstruction, personLabel, systemPrompt } from "./personality.js";
import { ModelRouter, type ChatTurn } from "./router.js";

export class DizaCore {
  constructor(
    private readonly memory: Memory,
    private readonly router: ModelRouter,
    private readonly config: AppConfig,
  ) {}

  async reply(person: Person, text: string): Promise<string> {
    this.memory.addMessage(person.id, "user", text, false);
    try {
      const { text: answer } = await this.router.complete(this.thread(person, "reply"));
      this.memory.addMessage(person.id, "assistant", answer, false);
      void this.maybeExtract(person).catch((error: Error) => {
        console.warn(`[diza] memória não gravou: ${error.message}`);
      });
      return answer;
    } catch (error) {
      console.error(`[diza] sem resposta: ${(error as Error).message}`);
      return failLine(text);
    }
  }

  async initiate(person: Person): Promise<string | null> {
    try {
      const { text } = await this.router.complete(this.thread(person, "initiative"));
      return text.trim() || null;
    } catch (error) {
      console.warn(`[diza] iniciativa não saiu: ${(error as Error).message}`);
      return null;
    }
  }

  private thread(person: Person, kind: "reply" | "initiative"): ChatTurn[] {
    const fresh = this.memory.findByPhone(person.phone) ?? person;
    const memories = this.memory.memoriesOf(fresh.id);
    const history = this.memory.recentMessages(fresh.id, this.config.historyLimit);
    const otherPerson = this.memory.people().find((item) => item.id !== fresh.id) ?? null;
    const other = otherPerson
      ? {
          label: personLabel(otherPerson),
          memories: this.memory.memoriesOf(otherPerson.id),
          messages: this.memory.recentMessages(otherPerson.id, this.config.historyLimit),
        }
      : null;
    const base = systemPrompt(fresh, memories, other);
    const prompt = kind === "initiative" ? `${base}\n\n${initiativeInstruction()}` : base;
    const messages: ChatTurn[] = [{ role: "system", content: prompt }];
    for (const item of history) {
      messages.push({ role: item.role, content: item.content });
    }
    return messages;
  }

  private async maybeExtract(person: Person): Promise<void> {
    if (this.memory.userMessagesSinceExtract(person.id) < this.config.memoryEvery) return;
    const recent = this.memory.recentMessages(person.id, 16);
    const transcript = recent.map((item) => `${item.role}: ${item.content}`).join("\n");
    const { text } = await this.router.complete(
      [
        {
          role: "system",
          content:
            "Extract up to 3 short memories about this person: facts, preferences, or inside jokes worth keeping. Write each memory in the language of the transcript, English or French. One per line, no numbering. If nothing new is worth keeping, reply with only NADA.",
        },
        { role: "user", content: transcript },
      ],
      true,
    );
    if (text.trim().toUpperCase() !== "NADA") {
      const lines = text
        .split("\n")
        .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
        .filter((line) => line && line.toUpperCase() !== "NADA")
        .slice(0, 3);
      for (const line of lines) this.memory.addMemory(person.id, line);
    }
    this.memory.markExtracted(person.id);
  }
}
