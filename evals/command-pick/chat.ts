/**
 * **One request to a small chat model on OpenRouter** — the declared bypass
 * `command-pick-chat` (src/spend-declarations.ts), plan 261003k Stage 1.
 *
 * Not `openRouterJson("eval", …)`, which the first run's chat arm used: that
 * seam decides `reasoning` and `provider` for its caller, and this eval's
 * arms differ in exactly those two. A deadline, no retry (one logical call is
 * one billed attempt), the whole response kept. Its spend is written by
 * `withDeclaredExternalCall`, which refuses to run without a ledger open.
 */
import { declaredFetch, withDeclaredExternalCall } from "../declared-spend.js";

const URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 60_000;

export interface ChatArm {
  readonly name: string;
  readonly model: string;
  /** Sent as `reasoning`; `null` sends no `reasoning` key at all. */
  readonly reasoning: Record<string, unknown> | null;
  readonly provider: Record<string, unknown>;
  /** What the write-up says about the two above. */
  readonly setting: string;
}

export interface ChatResult {
  latencyMs: number;
  status: number;
  body: unknown;
  content: string | null;
  finishReason: string | null;
  answeredBy: string | null;
  upstream: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}

export async function chatAsk(
  arm: ChatArm,
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<ChatResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.");
  return withDeclaredExternalCall("command-pick-chat", { model: arm.model }, async ({ observe }) => {
    const t0 = performance.now();
    const res = await declaredFetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: arm.model,
        max_tokens: maxTokens,
        ...(arm.reasoning ? { reasoning: arm.reasoning } : {}),
        provider: arm.provider,
        response_format: { type: "json_object" },
        usage: { include: true },
        messages,
      }),
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
      error?: { message?: string };
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number | null } | null;
        cost?: number;
        is_byok?: boolean;
        cost_details?: { upstream_inference_cost?: number | null } | null;
      };
    };
    /* Before the refusal check: a refusal that reports usage still cost money. */
    observe.openRouter({ model: b.model ?? null, provider: b.provider ?? null, usage: b.usage ?? null });
    if (!res.ok || b.error) throw new Error(`HTTP ${res.status}: ${(b.error?.message ?? text).slice(0, 400)}`);
    return {
      latencyMs,
      status: res.status,
      body,
      content: b.choices?.[0]?.message?.content ?? null,
      finishReason: b.choices?.[0]?.finish_reason ?? null,
      answeredBy: b.model ?? null,
      upstream: b.provider ?? null,
      inputTokens: b.usage?.prompt_tokens ?? null,
      outputTokens: b.usage?.completion_tokens ?? null,
      reasoningTokens: b.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      /* Luna is served on our own OpenAI key through OpenRouter: `cost` is then
         OpenRouter's fee (0 here) and the model's price is the upstream figure.
         Reporting `cost` alone would print Luna as free. */
      costUsd:
        b.usage?.cost == null
          ? null
          : b.usage.cost + (b.usage.is_byok ? (b.usage.cost_details?.upstream_inference_cost ?? 0) : 0),
    };
  });
}
