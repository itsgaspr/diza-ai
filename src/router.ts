import type { ModelSlot } from "./models.js";

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

interface CompletionBody {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export class ModelRouter {
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly slots: ModelSlot[],
    private readonly timeoutMs: number,
  ) {}

  async complete(messages: ChatTurn[], preferCheap = false): Promise<{ text: string; label: string }> {
    const order = preferCheap ? cheapFirst(this.slots) : this.slots;
    const available = order.filter((slot) => slot.apiKey);
    if (available.length === 0) {
      throw new Error("Nenhum modelo configurado");
    }

    let lastError: Error | null = null;
    for (const slot of available) {
      if ((this.cooldownUntil.get(slot.label) ?? 0) > Date.now()) {
        continue;
      }
      try {
        const text = await this.call(slot, messages);
        if (!text.trim()) {
          lastError = new Error(`${slot.label} devolveu resposta vazia`);
          console.warn(`[diza] ${lastError.message}`);
          continue;
        }
        console.log(`[diza] respondeu ${slot.label}`);
        return { text: text.trim(), label: slot.label };
      } catch (error) {
        if (error instanceof ModelError && error.status === 400) {
          throw error;
        }
        if (error instanceof ModelError && error.status === 429) {
          const wait = error.retryAfterMs ?? 60_000;
          this.cooldownUntil.set(slot.label, Date.now() + wait);
          console.warn(`[diza] ${slot.label} em cooldown por ${Math.round(wait / 1000)}s`);
        } else {
          console.warn(`[diza] ${slot.label} falhou: ${(error as Error).message}`);
        }
        lastError = error as Error;
      }
    }

    throw lastError ?? new Error("Nenhum modelo disponível");
  }

  private async call(slot: ModelSlot, messages: ChatTurn[]): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL("chat/completions", slot.baseUrl), {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${slot.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Diza",
        },
        body: JSON.stringify({
          model: slot.model,
          messages,
          temperature: 0.9,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as CompletionBody;
      if (!response.ok) {
        const retryAfter = retryAfterMs(response.headers.get("retry-after"));
        const detail = body.error?.message || response.statusText;
        throw new ModelError(`${slot.label}: ${detail}`, response.status, retryAfter);
      }
      return body.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      if (error instanceof ModelError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ModelError(`${slot.label}: timeout`, 408);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function cheapFirst(slots: ModelSlot[]): ModelSlot[] {
  return [...slots.filter((slot) => slot.cheap), ...slots.filter((slot) => !slot.cheap)];
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
