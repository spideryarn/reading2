/**
 * **What OpenRouter itself says one call cost** — `GET /api/v1/generation?id=`.
 * Free, read-only, buys no inference.
 *
 * The one copy of this lookup. `npm run cost:analyse -- --lookup-unpriced`
 * uses it to put a figure on calls the ledger recorded with no money
 * (docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md,
 * check 1), and the audit's own scripts under evals/cost/audit-261005/ use it
 * rather than each naming the host and the key.
 *
 * **A lookup that did not complete is `failed`, never a zero.** "They have no
 * record" (a 404) and "we could not ask" are different answers, and neither is
 * "it was free".
 *
 * The key is read from `.env.local` and is never printed, logged or returned.
 */

import { loadEnvLocal } from "../src/env.js";

/** The fields of their record this repo reads. Everything is optional: it is their shape, not ours. */
export interface GenerationRecord {
  total_cost?: number | null;
  upstream_inference_cost?: number | null;
  is_byok?: boolean | null;
  model?: string | null;
  provider_name?: string | null;
  tokens_prompt?: number | null;
  tokens_completion?: number | null;
  native_tokens_prompt?: number | null;
  native_tokens_completion?: number | null;
  native_tokens_cached?: number | null;
  native_tokens_reasoning?: number | null;
  cancelled?: boolean | null;
  finish_reason?: string | null;
  api_type?: string | null;
  num_search_results?: number | null;
}

export type GenerationLookup =
  | {
      kind: "found";
      /** What they deducted from our credits, in nano-dollars; null when the record has no figure. */
      totalCostNanos: number | null;
      /** What the provider charged upstream, in nano-dollars; null when the record has no figure. */
      upstreamCostNanos: number | null;
      isByok: boolean | null;
      promptTokens: number | null;
      completionTokens: number | null;
      cachedTokens: number | null;
      /** Their whole record, for a caller that wants a field not lifted above. */
      record: GenerationRecord;
    }
  /** They answered, and hold nothing under this id. */
  | { kind: "no-record" }
  /** We could not find out. `status` is the last HTTP status, or null when no response arrived. */
  | { kind: "failed"; status: number | null };

const ENDPOINT = "https://openrouter.ai/api/v1/generation";

const nanos = (dollars: unknown): number | null =>
  typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 1e9) : null;
const whole = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

export interface LookupOptions {
  /** Tries in all; a 404 is an answer and is not retried. */
  attempts?: number;
  /** Milliseconds between tries. */
  pauseMs?: number;
  fetch?: typeof fetch;
}

/** Ask about one generation id. Never throws: a failure is the `failed` answer. */
export async function lookupGeneration(
  id: string,
  key: string,
  opts: LookupOptions = {},
): Promise<GenerationLookup> {
  const attempts = opts.attempts ?? 3;
  const ask = opts.fetch ?? fetch;
  let status: number | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, opts.pauseMs ?? 1500));
    try {
      const response = await ask(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      status = response.status;
      if (response.status === 404) return { kind: "no-record" };
      if (!response.ok) continue;
      const body = (await response.json()) as { data?: GenerationRecord | null };
      const record = body.data;
      /* A 404 is the provider's "no record" answer. A nominally successful
         response without the promised record is a malformed answer: retry it,
         then report that the lookup failed rather than inventing an answer. */
      if (!record) continue;
      return {
        kind: "found",
        totalCostNanos: nanos(record.total_cost),
        upstreamCostNanos: nanos(record.upstream_inference_cost),
        isByok: typeof record.is_byok === "boolean" ? record.is_byok : null,
        promptTokens: whole(record.native_tokens_prompt),
        completionTokens: whole(record.native_tokens_completion),
        cachedTokens: whole(record.native_tokens_cached),
        record,
      };
    } catch {
      /* A network error or a body that is not JSON: try again, then `failed`. */
    }
  }
  return { kind: "failed", status };
}

/**
 * The local OpenRouter key, from `.env.local`, or null when there is none.
 * The caller says what it could not do; the value goes nowhere but a request.
 */
export function localOpenRouterKey(): string | null {
  loadEnvLocal();
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

/**
 * Ask about many ids, a few at a time. Results are keyed by whatever `keyOf`
 * returns (a ledger row's id, usually), in no particular order.
 */
export async function lookupGenerations<T>(
  items: readonly T[],
  generationIdOf: (item: T) => string,
  keyOf: (item: T) => string,
  key: string,
  opts: LookupOptions & { concurrency?: number } = {},
): Promise<Map<string, GenerationLookup>> {
  const results = new Map<string, GenerationLookup>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      results.set(keyOf(item), await lookupGeneration(generationIdOf(item), key, opts));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return results;
}
