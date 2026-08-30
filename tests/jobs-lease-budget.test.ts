/**
 * The one arithmetic relationship between this repo's job lease and its host.
 *
 * `LEASE_MS - DEADLINE_MARGIN_MS` is when a claimant aborts its own step.
 * `maxDuration` in vercel.json is when the platform kills the function. The
 * first must happen before the second, or the lease stops meaning *the process
 * is gone* — the one reading `failExpired` is safe to act on.
 *
 * **This test exists because raising either constant alone is a silent
 * regression.** Raise `LEASE_MS` without `maxDuration` and the self-abort moves
 * past the kill, so it never fires: instead of a step ending itself cleanly as
 * interrupted, the function dies mid-step with a live lease and the job sits
 * `running`. That deploys green and only appears on a long step. Spotted in
 * review by the session that owns the job store, 2026-08-29, before it shipped.
 *
 * It pins the **relationship**, not the numbers, so tuning either is free and
 * breaking the pair is not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEADLINE_MARGIN_MS, LEASE_MS } from "../src/jobs.js";

const ROOT = path.resolve(import.meta.dirname, "..");

function maxDurationSeconds(): number {
  const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
    functions?: Record<string, { maxDuration?: number }>;
  };
  const entry = config.functions?.["api/**"];
  /* Not `?? 300`. A default here would let the key be deleted or renamed and
     still pass, which is the failure this file is about. */
  if (typeof entry?.maxDuration !== "number") {
    throw new Error('vercel.json has no numeric functions["api/**"].maxDuration');
  }
  return entry.maxDuration;
}

describe("the job lease and the platform's kill", () => {
  it("aborts the step before the platform kills the function", () => {
    const deadlineMs = LEASE_MS - DEADLINE_MARGIN_MS;
    expect(deadlineMs).toBeLessThan(maxDurationSeconds() * 1000);
  });

  it("leaves the claimant time to unwind", () => {
    expect(DEADLINE_MARGIN_MS).toBeGreaterThan(0);
    expect(DEADLINE_MARGIN_MS).toBeLessThan(LEASE_MS);
  });

  it("covers the longest step this project has actually measured", () => {
    /* `toc` totalled 324.0s over three calls and `summarise` 240.3s over ten,
       per-article, from data/_ai-calls.jsonl on 2026-08-29. A deadline under
       either means that article cannot be ingested through a job on any
       machine — which is what these constants used to do. */
    const longestMeasuredStepMs = 324_000;
    expect(LEASE_MS - DEADLINE_MARGIN_MS).toBeGreaterThan(longestMeasuredStepMs);
  });
});
