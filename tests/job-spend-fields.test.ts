/**
 * What the "job is over" line says an ingest cost — `jobSpendFields` in
 * [src/jobs.ts](../src/jobs.ts).
 *
 * **Every bug this line has had was in what the number includes**, and none of
 * them showed up in a type: `unreadable` dropped between the store and the line,
 * and then `computed` left out of the total. So the assertions here are about
 * membership rather than formatting.
 *
 * The arithmetic itself is deliberately not repeated. `totalRows` in
 * [src/store/ai-calls.ts](../src/store/ai-calls.ts) is the one place that knows
 * when `upstream_inference_nanos` may be added — it may not be on a non-BYOK row,
 * where OpenRouter writes it equal to the credits and a naive sum double-counts —
 * and a second summing expression anywhere is a second answer waiting to
 * disagree.
 */
import { describe, expect, it } from "vitest";
import type { AiCallRow } from "../src/ai-spend.js";
import { jobSpendFields } from "../src/jobs.js";

/** The five fields the total actually reads; the rest of a row is irrelevant. */
const row = (over: Partial<AiCallRow>): AiCallRow =>
  ({
    job: "hierarchy",
    isByok: false,
    costSource: "provider",
    creditsUsedNanos: 0,
    upstreamInferenceNanos: null,
    computedCostNanos: null,
    ...over,
  }) as AiCallRow;

describe("what an ingest is reported to have cost", () => {
  it("counts our own arithmetic as well as OpenRouter's settled figure", () => {
    /* **The bug this pins.** The line was `credits + upstream`, so a `computed`
       row — the declared bypasses, which have nobody to ask what they cost —
       contributed nothing to the one log line that says what a job cost. Zero
       today, because computed is eval-only; a latent under-report the moment it
       is not, and silent in both directions when it happens. */
    const fields = jobSpendFields(
      [
        row({ creditsUsedNanos: 1_000 }),
        row({ costSource: "computed", creditsUsedNanos: null, computedCostNanos: 32_000 }),
      ],
      0,
    );
    expect(fields.aiCalls).toBe(2);
    expect(fields.aiCostNanos).toBe(33_000);
    /* Named apart from the total it is inside: an estimate and a settled figure
       are not the same kind of fact, and the report keeps them separable. */
    expect(fields.aiComputedNanos).toBe(32_000);
  });

  it("counts BYOK, whose OpenRouter credits are legitimately zero", () => {
    const fields = jobSpendFields(
      [row({ isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: 4_000 })],
      0,
    );
    expect(fields.aiCostNanos).toBe(4_000);
    expect(fields.aiUpstreamNanos).toBe(4_000);
  });

  it("does not add the upstream figure on a non-BYOK row", () => {
    /* The double-count trap, asserted from the caller's side. OpenRouter sets
       `cost_details.upstream_inference_cost` on ordinary calls too, equal to the
       credits — so a total that adds it unconditionally reports twice the money.
       This line gets that right only by going through `totalRows`. */
    const fields = jobSpendFields(
      [row({ isByok: false, creditsUsedNanos: 5_000, upstreamInferenceNanos: 5_000 })],
      0,
    );
    expect(fields.aiCostNanos).toBe(5_000);
    expect(fields).not.toHaveProperty("aiUpstreamNanos");
  });

  it("says a call reported no cost rather than treating it as free", () => {
    const fields = jobSpendFields([row({ creditsUsedNanos: null })], 0);
    expect(fields.aiUnpriced).toBe(1);
  });

  it("keeps an ordinary line short — no zero-valued fields", () => {
    /* Each of the conditional fields is a claim that the total above it is
       wrong. Printed unconditionally they become furniture, and furniture is
       not read. */
    const fields = jobSpendFields([row({ creditsUsedNanos: 1_000 })], 0);
    expect(Object.keys(fields).sort()).toEqual(["aiCalls", "aiCost", "aiCostNanos"]);
  });

  it("tells a damaged ledger apart from a job that spent nothing", () => {
    expect(jobSpendFields([], 0)).toEqual({});
    expect(jobSpendFields([], 3)).toEqual({ aiCostStatus: "partial", aiUnreadable: 3 });
  });
});
