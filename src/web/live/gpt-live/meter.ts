/**
 * **What a GPT-Live call spent, as the browser reports it.**
 *
 * The queue is `LiveMeter` in ../meter.ts, unchanged: post at once, retry in
 * memory while the tab lives, one `keepalive` pass at teardown. That file's
 * header says why the browser is the only place this can be measured and what
 * is deliberately not built. This file is only the two things GPT-Live bills
 * that Realtime does not, and how each is read off the wire.
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md § The meter.
 *
 * - **Voice seconds.** `session.usage.updated`, about every fifteen seconds,
 *   and `session.closed`, both carry `usage.seconds`: a running total for the
 *   call. Sent as it is. The server keeps a high-water mark and bills only the
 *   difference, so a repeat or an out-of-order report adds nothing.
 * - **Backend tokens.** The text model behind the voice reports its tokens on
 *   each nested `response.completed`. One report per response id.
 *
 * As with Realtime: no dollar amount, no model, no owner and no article ever
 * leave this file. The server prices from the session row it wrote.
 */
import { LiveMeter, type MeterTransport } from "../meter.js";

/**
 * **What the browser may say about one GPT-Live bill.** The wire shape of
 * `GptLiveUsage` in src/live.ts, declared here because nothing under
 * `src/web/` may import a server module (tests/client-imports.test.ts). The two
 * are pinned to each other, both ways, in tests/gpt-live-meter.test.ts.
 */
export type GptLiveUsageReport =
  | {
      kind: "voice";
      /** Whole seconds since the call began, as OpenAI counted them. Cumulative. */
      seconds: number;
      /** The event's own `event_id`, kept on the row for audit. */
      eventId: string;
    }
  | {
      kind: "backend";
      /** The backend response's id. The server's idempotency key. */
      responseId: string;
      /** The whole prompt, cached part included. */
      inputTokens: number;
      /** The part of `inputTokens` that was cached. */
      cachedInputTokens: number;
      outputTokens: number;
    };

/** The accounting calls a GPT-Live meter needs. `useGptLive` builds it from the wiring (`gptLiveUsage` for the middle one). */
export type GptLiveMeterTransport = MeterTransport<GptLiveUsageReport>;

/** The same queue as Realtime's, carrying GPT-Live's reports. */
export class GptLiveMeter extends LiveMeter<GptLiveUsageReport> {}

/** A non-negative whole number off the wire, or `null` for anything else. */
function whole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function objectAt(parent: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const found = parent?.[key];
  return typeof found === "object" && found !== null ? (found as Record<string, unknown>) : undefined;
}

/**
 * **The call's running total of seconds**, from `session.usage.updated` or
 * `session.closed`. `null` when the event does not carry a whole number of
 * seconds: the server refuses a fraction rather than rounding it, so nothing is
 * invented here to get past that.
 *
 * `event_id` is on every event in the spike traces. If one arrives without it,
 * the id is made from the figure itself. That is safe because the id is kept
 * for audit only; what makes a repeat harmless is the server's high-water mark.
 */
export function voiceReport(event: Record<string, unknown>): GptLiveUsageReport | null {
  const seconds = whole(objectAt(event, "usage")?.seconds);
  if (seconds === null) return null;
  const id = event.event_id;
  return {
    kind: "voice",
    seconds,
    eventId: typeof id === "string" && id !== "" && id.length <= 200 ? id : `seconds-${seconds}`,
  };
}

/**
 * **One backend response's tokens**, from the `usage` on a nested
 * `response.completed` (or on a failed or incomplete one, which is billed for
 * what it used). `null` when the totals are missing.
 *
 * `cached_tokens` is the one count allowed to be absent, and reads as none. The
 * argument is the one ../meter.ts makes for Realtime: an absent cached count
 * prices that input at the fresh rate, so the error can only overstate what was
 * spent. A cached count larger than the input is capped at the input for the
 * same reason, and because the server refuses it outright otherwise.
 */
export function backendReport(responseId: string, usage: Record<string, unknown>): GptLiveUsageReport | null {
  const inputTokens = whole(usage.input_tokens);
  const outputTokens = whole(usage.output_tokens);
  if (responseId === "" || responseId.length > 200 || inputTokens === null || outputTokens === null) return null;
  const cached = whole(objectAt(usage, "input_tokens_details")?.cached_tokens) ?? 0;
  return {
    kind: "backend",
    responseId,
    inputTokens,
    cachedInputTokens: Math.min(cached, inputTokens),
    outputTokens,
  };
}
