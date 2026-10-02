/**
 * **One request to Jev on OpenRouter's Decisions endpoint** — the declared
 * bypass `command-pick-jev` (src/spend-declarations.ts), plan 261002c Stage D.
 *
 * A copy of evals/shelf-topics/jev.ts with its own declaration id, because the
 * register allows each id from one file only. Pinned `typesafe/jev-1.13`, a
 * deadline, no retry (one logical call is one billed attempt), the whole
 * response kept. Its spend is written by `withDeclaredExternalCall`, which
 * refuses to run without a ledger open (`withLedger("eval", …)`), and the
 * request goes out through `declaredFetch`, which refuses to run outside it.
 */
import { declaredFetch, withDeclaredExternalCall } from "../declared-spend.js";

export const JEV_MODEL = "typesafe/jev-1.13";
const URL = "https://openrouter.ai/api/alpha/decisions";
const TIMEOUT_MS = 60_000;

export interface JevChoiceAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface JevResult {
  latencyMs: number;
  /** The parsed body, whatever it was — saved whole. */
  body: unknown;
  answers: Record<string, JevChoiceAnswer>;
  answeredBy: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export async function jevDecide(state: unknown, questions: Record<string, unknown>): Promise<JevResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.");
  return withDeclaredExternalCall("command-pick-jev", { model: JEV_MODEL }, async ({ observe }) => {
    const t0 = performance.now();
    const res = await declaredFetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const latencyMs = Math.round(performance.now() - t0);
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { unparsed: text.slice(0, 2000) };
    }
    const b = body as {
      model?: string;
      provider?: string;
      answers?: Record<string, JevChoiceAnswer>;
      usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
    };
    /* The Decisions usage shape mapped onto the chat one the observer takes. */
    observe.openRouter({
      model: b.model ?? null,
      provider: b.provider ?? null,
      usage: b.usage
        ? {
            prompt_tokens: b.usage.input_tokens ?? null,
            completion_tokens: b.usage.output_tokens ?? null,
            cost: b.usage.cost ?? null,
          }
        : null,
    });
    if (!res.ok) throw new Error(`Jev refused: HTTP ${res.status}: ${text.slice(0, 500)}`);
    return {
      latencyMs,
      body,
      answers: b.answers ?? {},
      answeredBy: b.model ?? null,
      inputTokens: b.usage?.input_tokens ?? null,
      outputTokens: b.usage?.output_tokens ?? null,
      costUsd: b.usage?.cost ?? null,
    };
  });
}
