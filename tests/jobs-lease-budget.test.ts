/**
 * The one arithmetic relationship between this repo's job lease and its host.
 *
 * `LEASE_MS - DEADLINE_MARGIN_MS` is when a claimant aborts its own step.
 * `maxDuration` in vercel.json is when the platform kills the function. The
 * first must happen before the second, or the lease stops meaning *the process
 * is gone* — the one reading `settleExpired` is safe to act on.
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
import { DEADLINE_MARGIN_MS, LEASE_MS, STEP_BUDGET_MS } from "../src/jobs.js";
import { DEFAULT_INGEST_STEPS } from "../src/pipeline.js";

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
   * **The whole default ingest of an ordinary web page, not one step — and this
   * is the assertion that will bind.**
   *
   * **"Of an ordinary web page" was implicit and is now written down**, along
   * with the check that makes the promise below true rather than aspirational
   * ⟨Sol, 2026-09-04⟩. `DEFAULT_INGEST_STEPS` is imported and asserted against
   * the keys of `worstStepMs`, because this comment claimed a new default step
   * would break the test and nothing made that so: the list was hand-typed, and
   * a sixth step would have left every assertion here green. The PDF branch of
   * `extract` is a fan-out of model calls that does **not** fit one invocation,
   * has never claimed to, and is what the per-chunk checkpoints and the
   * hand-back exist for.
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
   * `hierarchy` from the ledger, `assets` from a real run against the 10-image
   * article (7.1s measured, but its 180s cap is what bounds it), and the three
   * cheap steps rounded generously upward.
   */
  /* **"Fits one invocation" is about elapsed time, not about how many requests
     it actually takes** — and since 2026-09-04 those are different answers. The
     sum below still fits the deadline, which is what this case asserts and what
     `maxDuration` is about; but `STEP_BUDGET_MS.hierarchy` is now 700 s, so a
     walk that has spent ~125 s on `fetch → extract → blocks` hands the claim
     back rather than starting `hierarchy`, and the ordinary article takes two
     requests. That is deliberate (src/jobs.ts § `STEP_BUDGET_MS`) and it does
     not weaken this assertion: a budget that stopped fitting one invocation
     would still be a budget nothing could recover from. */
  it("leaves room for the whole default ingest inside one invocation", () => {
    /* **Each number says where it came from and when, because this plan has
       twice been bitten by not being able to tell a measurement from a guess.**
       `summarise` was quoted at 240.3s for a day before anyone noticed it was
       ten overlapping calls summed (91.3s), and `assets` carried a 300s budget
       derived from policy constants until the step was run for the first time
       and took 7.1s. A reader who cannot tell which of these is observed will
       reason about the guesses as though they were facts. */
    const worstStepMs = {
      /* MEASURED 2026-09-04: 107-893 ms over five real addresses, plus up to
         1.8 s for the page count stage 1 now does. Written as 110 s because
         that is what `src/fetch.ts` actually allows a hanging retryable origin
         — three attempts of `DEFAULTS.timeoutMs` = 30 s, with `retryDelayMs`
         capped at 10 s between them. An earlier draft said 30 s, having read the
         timeout and not the loop around it. */
      fetch: 110_000,
      /* MEASURED 2026-09-04, **the HTML branch only**: 0.95-5.2 s over four real
         pages, the worst being Wikipedia's 1.3 MB *Consciousness*. Rounded up.

         **Not `STEP_BUDGET_MS.extract`, and the difference is the point of this
         comment.** That number is 700 s and answers a different question — how
         much of a claim must remain before the walk moves on to this step — and
         it is a ceiling sized for the PDF branch. (Not a guarantee that a PDF is
         never begun in a short window: the walk runs its *first* step ungated,
         so a claim that begins at `extract` starts it regardless ⟨Sol,
         2026-09-04⟩.) This one is elapsed time for the HTML branch. Importing
         the other table here would assert something false about the case this
         test is about. */
      extract: 10_000,
      /* GUESS, generous. Deterministic, no model call. */
      blocks: 5_000,
      /* MEASURED 2026-08-30, worst in data/_ai-calls.jsonl: one call, so sum
         and wall clock agree and no grouping argument applies. This is the
         number the whole budget turns on. */
      hierarchy: 320_400,
      /* A CAP, not a measurement — the step's own wall clock. Measured cost on
         the corpus's worst article (10 images) is 7.1s; the cap exists for a
         hanging publisher, where 10 images cost ~151s. */
      assets: ASSETS_BUDGET_MS,
    };
    /* **The guard the comment above promised and did not have.** A step added
       to the default ingest and not costed here is a budget that goes on
       agreeing with itself — the same shape as every other pair of hand-typed
       lists this repo has been bitten by. Sorted on both sides so the order of
       either is nobody's business. */
    expect(
      Object.keys(worstStepMs).sort(),
      "a step joined or left DEFAULT_INGEST_STEPS — cost it here, or this budget is about a " +
        "pipeline that no longer exists",
    ).toEqual([...DEFAULT_INGEST_STEPS].sort());

    const wholeJobMs = Object.values(worstStepMs).reduce((a, b) => a + b, 0);
    expect(wholeJobMs).toBeLessThan(maxDurationSeconds() * 1000);
    /* **And against the claimant's own deadline, which is the tighter of the
       two and the one this test's prose is actually about.** It compared only
       with `maxDuration` until 2026-09-04, so a future total of 750 s would have
       passed while disproving the sentence above it ⟨Sol⟩ — the claimant aborts
       itself at `LEASE_MS - DEADLINE_MARGIN_MS`, 60 s before the platform does.
       Today's HTML total is 630.4 s and clears both. */
    expect(
      wholeJobMs,
      "the default HTML ingest no longer fits ONE claim — it would now be split across requests, " +
        "which works but is not what the sentence above claims",
    ).toBeLessThan(LEASE_MS - DEADLINE_MARGIN_MS);
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
   * **Turning it on would silently make every disconnect fatal**, mid-`hierarchy`,
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
       any real run has taken is a `hierarchy` of **320.4s in a single call**.

       Two corrections worth keeping, because both were reported to other
       sessions before they were checked. `summarise` was cited as 240.3s and
       does **not** belong here: that is ten calls *summed*, and its wall time
       is 91.3s, because they overlap. And the earlier `hierarchy` figure of "324.0s
       over three calls" was three unrelated runs five hours apart, collapsed
       together by a null slug. Sum a step's calls and you overstate a
       concurrent step and understate nothing; only wall time answers "did this
       step fit". */
    const longestMeasuredStepMs = 320_400;
    expect(LEASE_MS - DEADLINE_MARGIN_MS).toBeGreaterThan(longestMeasuredStepMs);
  });

  /**
   * **The hand-back threshold for `hierarchy` may not admit a step the same
   * evidence says cannot finish.**
   *
   * ⟨GPT Sol, reviewing the built stage 3 of
   * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md, finding 2⟩
   * `STEP_BUDGET_MS.hierarchy` was 320.4 s, measured on *ordinary* articles.
   * Measured on Kuhn's *A Landscape of Consciousness* — 142 pages, two
   * production ingests on 2026-09-04 — the structure call alone is **508 s** and
   * the whole step is **658–778 s**, against a 740 s deadline. Those same two
   * ingests recorded `extract` at 305–347 s, so the walk reached `hierarchy`
   * with 393–435 s left, admitted it on a 320.4 s budget, bought most of a
   * structure call it could not finish, and spent one of only two requeues.
   *
   * So the rule is: **after the worst measured PDF extract, `hierarchy` is
   * handed back rather than started.** Everything below is measured, and the
   * assertion is the relationship rather than the number, so re-tuning either
   * side is free and breaking the pair is not.
   */
  it("refuses to start hierarchy on what a long PDF's extract leaves behind", () => {
    /* MEASURED 2026-09-04, production, release `436d6b56`: `spya-y807kg` at
       09:26 and `spya-bub4bd` at 10:42, the same 142-page paper. The whole
       `POST /api/jobs/:id/advance` returned 200 in 347 s and 305 s. The
       **shorter** of the two is the one that binds — it leaves the *most* window
       behind, so it is the case most likely to admit the next step. */
    const measuredPdfExtractMs = 305_000;
    const leftAfterIt = LEASE_MS - DEADLINE_MARGIN_MS - measuredPdfExtractMs;
    expect(
      STEP_BUDGET_MS.hierarchy,
      "the walk would start `hierarchy` with less window than the 142-page paper's " +
        "structure call alone took (508 s) — it buys most of one and spends a requeue",
    ).toBeGreaterThan(leftAfterIt);

    /* **And it still has to be startable.** A budget at or over the claimant's
       own deadline is never satisfied by any claim, so the step could only ever
       run as the *first* of a claim — which is the walk's ungated slot and is
       exactly what this threshold hands it to. Over the deadline the reasoning
       stops being "reserve nearly the whole window" and becomes "this table no
       longer decides anything", which is worth failing on. */
    expect(
      STEP_BUDGET_MS.hierarchy,
      "a budget at or over the claimant's deadline can never be met, so the table has " +
        "stopped saying anything about this step",
    ).toBeLessThan(LEASE_MS - DEADLINE_MARGIN_MS);
  });
});
