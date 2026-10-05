/* Recompute EVERY production row with cost_source='computed' from the row's
   own token / seconds columns and src/pricing.ts, and compare with the stored
   computed_cost_nanos. Read-only. What it does not check: whether the price
   table matches the vendor's price list, or whether the browser's counts were
   true.
   Run:  npx tsx evals/cost/audit-261005/computed-recompute.ts */
// biome-ignore-all lint/suspicious/noExplicitAny: a one-off audit script over untyped database rows
import { productionClient } from "../../../scripts/feedback-reporter.js";
import * as pricing from "../../../src/pricing.js";

const { client, target } = productionClient();
console.log("Target:", target);
await client.connect();
let rows: Record<string, any>[] = [];
try {
  await client.query("begin read only");
  rows = (
    await client.query(`select id, requested_model, event_kind, price_version, computed_cost_nanos, started_at, finished_at,
      reported_input_tokens, output_tokens, cache_read_tokens, input_text_tokens, input_audio_tokens, input_image_tokens,
      cached_text_tokens, cached_audio_tokens, output_text_tokens, output_audio_tokens, transcription_seconds, voice_seconds
      from spideryarn.ai_calls where cost_source = 'computed' order by started_at`)
  ).rows;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
const n = (v: unknown) => Number(v ?? 0);
const tally = new Map<
  string,
  { rows: number; agree: number; disagree: number; stored: number; recomputed: number; versions: Set<string>; imageTokens: number }
>();
for (const r of rows) {
  const at = new Date(r.finished_at);
  let priced: { totalNanos: number; priceVersion: string } | null = null;
  if (r.event_kind === "response")
    priced = pricing.priceRealtimeResponse(
      r.requested_model,
      {
        freshTextTokens: n(r.input_text_tokens) - n(r.cached_text_tokens),
        freshAudioTokens: n(r.input_audio_tokens) - n(r.cached_audio_tokens),
        cachedTextTokens: n(r.cached_text_tokens),
        cachedAudioTokens: n(r.cached_audio_tokens),
        outputTextTokens: n(r.output_text_tokens),
        outputAudioTokens: n(r.output_audio_tokens),
      },
      at,
    );
  else if (r.event_kind === "transcription")
    priced = pricing.priceRealtimeTranscription(r.requested_model, Number(r.transcription_seconds), at);
  else if (r.event_kind === "voice")
    priced = pricing.priceLiveVoice(r.requested_model, Number(r.voice_seconds), at);
  else if (r.event_kind === "backend")
    priced = pricing.priceLiveBackend(
      r.requested_model,
      {
        freshInputTokens: n(r.reported_input_tokens) - n(r.cache_read_tokens),
        cachedInputTokens: n(r.cache_read_tokens),
        outputTokens: n(r.output_tokens),
      },
      at,
    );
  const k = `${r.event_kind} | ${r.requested_model}`;
  const t = tally.get(k) ?? {
    rows: 0,
    agree: 0,
    disagree: 0,
    stored: 0,
    recomputed: 0,
    versions: new Set<string>(),
    imageTokens: 0,
  };
  t.rows++;
  t.stored += Number(r.computed_cost_nanos);
  t.recomputed += priced?.totalNanos ?? 0;
  t.versions.add(`${r.price_version}${priced && priced.priceVersion !== r.price_version ? ` (now ${priced.priceVersion})` : ""}`);
  t.imageTokens += n(r.input_image_tokens);
  if (priced && priced.totalNanos === Number(r.computed_cost_nanos)) t.agree++;
  else {
    t.disagree++;
    console.log("DISAGREE", String(r.id).slice(0, 8), k, r.computed_cost_nanos, priced?.totalNanos ?? null);
  }
  tally.set(k, t);
}
for (const [k, t] of tally)
  console.log(
    k,
    "=>",
    `rows ${t.rows}, agree ${t.agree}, disagree ${t.disagree}, stored $${(t.stored / 1e9).toFixed(6)}, recomputed $${(t.recomputed / 1e9).toFixed(6)}, versions ${[...t.versions].join("; ")}, image input tokens ${t.imageTokens}`,
  );
console.log("REALTIME_PRICE_CHECKED:", pricing.REALTIME_PRICE_CHECKED, "PRICE_CHECKED:", pricing.PRICE_CHECKED);
