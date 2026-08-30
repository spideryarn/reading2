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
import { ASSETS_BUDGET_MS } from "../src/collect-assets.js";
import { DEADLINE_MARGIN_MS, LEASE_MS } from "../src/jobs.js";

const ROOT = path.resolve(import.meta.dirname, "..");

interface ApiFunctionConfig {
  maxDuration?: number;
  supportsCancellation?: boolean;
}

function apiFunctionConfig(): ApiFunctionConfig {
  const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
    functions?: Record<string, ApiFunctionConfig>;
  };
  const entry = config.functions?.["api/**"];
  if (!entry) throw new Error('vercel.json has no functions["api/**"] block');
  return entry;
}

function maxDurationSeconds(): number {
  const entry = apiFunctionConfig();
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

  /**
   * **The whole default ingest, not one step — and this is the assertion that
   * will bind.**
   *
   * Today every step gets its own fresh deadline, because each `/advance` takes
   * its own claim. Under the claim-once coordinator the whole job runs inside
   * **one** claim, so the budget stops being per-step and becomes per-job, and
   * the sum below is what has to fit. It is asserted against `maxDuration`
   * because that bound is true in both worlds: the job has to fit one
   * invocation either way.
   *
   * Requested by the session that owns the coordinator, for the reason that
   * makes it worth having: without it, **the next person to add a step to
   * `DEFAULT_INGEST_STEPS` breaks the budget silently**, and it surfaces as a
   * job aborting near the end of a long article — the most expensive possible
   * way to find out.
   *
   * The costs are measurements, not guesses, and each is the worst observed:
   * `toc` from the ledger, `assets` from a real run against the 10-image
   * article (7.1s measured, but its 180s cap is what bounds it), and the three
   * cheap steps rounded generously upward.
   */
  it("leaves room for the whole default ingest inside one invocation", () => {
    /* **Each number says where it came from and when, because this plan has
       twice been bitten by not being able to tell a measurement from a guess.**
       `summarise` was quoted at 240.3s for a day before anyone noticed it was
       ten overlapping calls summed (91.3s), and `assets` carried a 300s budget
       derived from policy constants until the step was run for the first time
       and took 7.1s. A reader who cannot tell which of these is observed will
       reason about the guesses as though they were facts. */
    const worstStepMs = {
      /* GUESS, generous. Network only, no model call. Never measured. */
      fetch: 10_000,
      /* GUESS, generous. Readability on HTML; a long PDF is slower and is not
         covered by this number — see the PDF note below. */
      extract: 5_000,
      /* GUESS, generous. Deterministic, no model call. */
      blocks: 5_000,
      /* MEASURED 2026-08-30, worst in data/_ai-calls.jsonl: one call, so sum
         and wall clock agree and no grouping argument applies. This is the
         number the whole budget turns on. */
      toc: 320_400,
      /* A CAP, not a measurement — the step's own wall clock. Measured cost on
         the corpus's worst article (10 images) is 7.1s; the cap exists for a
         hanging publisher, where 10 images cost ~151s. */
      assets: ASSETS_BUDGET_MS,
    };
    const wholeJobMs = Object.values(worstStepMs).reduce((a, b) => a + b, 0);
    expect(wholeJobMs).toBeLessThan(maxDurationSeconds() * 1000);
  });

  /**
   * **An import survives its reader closing the tab, and that is a property of
   * something `vercel.json` does *not* say.**
   *
   * Vercel aborts a function on client disconnect **only if you opt in**, with
   * `"supportsCancellation": true` on the function path. We have not, so a
   * proxy cutting a twelve-minute import — or a reader closing the tab — leaves
   * the job running server-side with its claim held. `drive()` retries, is told
   * `busy`, backs off, and the card catches up when the poll sees it finish.
   * The work lands and the model spend is not thrown away.
   *
   * **Turning it on would silently make every disconnect fatal**, mid-`toc`,
   * with the money already spent — and somebody will one day have an entirely
   * good reason to add it for an unrelated route. It is a one-line change in a
   * file that looks like deployment trivia, with nothing local to warn them.
   * This test is that warning.
   *
   * If a route genuinely needs cancellation, give it its own entry rather than
   * widening `api/**`, or make `/advance` ignore its own abort signal
   * deliberately — and note that streaming `/advance` would want this signal,
   * so streaming is a trade rather than an upgrade.
   */
  it("does not let the platform kill an import when the reader walks away", () => {
    expect(apiFunctionConfig().supportsCancellation).toBeUndefined();
  });

  it("covers the longest step this project has actually measured", () => {
    /* **Wall time per step, grouped by `runId`** — which is the unit the
       deadline actually bounds, and getting that wrong is how this number was
       first derived. From data/_ai-calls.jsonl on 2026-08-30, the longest step
       any real run has taken is a `toc` of **320.4s in a single call**.

       Two corrections worth keeping, because both were reported to other
       sessions before they were checked. `summarise` was cited as 240.3s and
       does **not** belong here: that is ten calls *summed*, and its wall time
       is 91.3s, because they overlap. And the earlier `toc` figure of "324.0s
       over three calls" was three unrelated runs five hours apart, collapsed
       together by a null slug. Sum a step's calls and you overstate a
       concurrent step and understate nothing; only wall time answers "did this
       step fit". */
    const longestMeasuredStepMs = 320_400;
    expect(LEASE_MS - DEADLINE_MARGIN_MS).toBeGreaterThan(longestMeasuredStepMs);
  });
});
