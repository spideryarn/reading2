/**
 * **Which stages share a cached article, and when it is worth paying for one.**
 *
 * Both halves of this were wrong in the first implementation, and neither could
 * fail: the article bytes were identical across three stages that were
 * nonetheless in two different caches, and every ingest paid a write premium for
 * a read that the normal path never performs. Nothing threw either time.
 *
 * See docs/project/prompt-caching.md and docs/plans/260826i-prompt-caching-sol-review.md.
 */
import { describe, expect, it } from "vitest";
import { ARTICLE_RENDERER, effortFor, STAGE_EFFORT } from "../src/models.js";
import type { ArticleStage } from "../src/models.js";
import { orderSteps } from "../src/jobs.js";
import { cacheArticleForStep, DEFAULT_INGEST_STEPS, sharesArticleCache } from "../src/pipeline.js";
import type { StepName } from "../src/types.js";

describe("the article cache group", () => {
  it("puts arc and tweets together, because they think at the same effort", () => {
    expect(STAGE_EFFORT.arc).toBe(STAGE_EFFORT.tweets);
    expect(sharesArticleCache("arc", ["tweets"])).toBe(true);
    expect(sharesArticleCache("tweets", ["arc"])).toBe(true);
  });

  it("keeps glossary out of it, because effort is part of the cache key", () => {
    /* Not a preference — measured. Four calls, one identical 7,291-token cached
       block, only `effort` varying: changing it paid a full write. So a stage
       whose effort differs cannot share, however identical its article is.
       docs/research/260826b-prompt-caching-anthropic.md. */
    expect(STAGE_EFFORT.glossary).not.toBe(STAGE_EFFORT.arc);
    expect(sharesArticleCache("arc", ["glossary"])).toBe(false);
    expect(sharesArticleCache("glossary", ["arc", "tweets"])).toBe(false);
  });

  it("keeps ideas out of it even though its effort MATCHES arc and tweets", () => {
    /* **The case that made the predicate read two tables instead of one.**
       `ideas` thinks at `high`, exactly like arc and tweets, so an
       effort-only grouping says all three share — and they cannot. `ideas`
       answers with block ids, so it sends `articleWithIds` where the other
       three send `articleText`; the two renderings of one article agree on the
       head and on nothing after it.

       What that would have cost is not an error: it is `arc` marking the
       article on a job that has `ideas` behind it, paying the 1.25x write
       premium, and collecting no read at all. Nothing throws, nothing looks
       wrong, and the bill goes up. GPT Sol, 2026-08-27. */
    expect(STAGE_EFFORT.ideas).toBe(STAGE_EFFORT.arc);
    expect(ARTICLE_RENDERER.ideas).not.toBe(ARTICLE_RENDERER.arc);
    expect(sharesArticleCache("arc", ["ideas"])).toBe(false);
    expect(sharesArticleCache("ideas", ["arc", "tweets"])).toBe(false);
    expect(sharesArticleCache("ideas", ["glossary"])).toBe(false);
  });

  it("puts timeline in the ids group with ideas and sketch, and in no other", () => {
    /* **Measured rather than asserted**, which is what this file is for. The
       claim in src/models.ts is that `timeline` shares one cached article
       prefix with `ideas` and `sketch` — same `high` effort, same `ids`
       renderer — and shares nothing with the four `articleText` stages.

       It is worth pinning in both directions. Sharing where it should not marks
       the article, pays the 1.25x write premium and collects no read. Not
       sharing where it should is the opposite mistake and is invisible: three
       stages in one job each paying for the same 4,000-word article. */
    expect(STAGE_EFFORT.timeline).toBe(STAGE_EFFORT.ideas);
    expect(ARTICLE_RENDERER.timeline).toBe(ARTICLE_RENDERER.ideas);
    expect(sharesArticleCache("ideas", ["timeline"])).toBe(true);
    expect(sharesArticleCache("timeline", ["sketch"])).toBe(true);
    expect(sharesArticleCache("timeline", ["arc", "tweets", "glossary", "quotes"])).toBe(false);
  });

  it("agrees with itself about which renderer every article stage uses", () => {
    /* The table is the claim; this is the check that it still describes the
       code. A stage added to `STAGE_EFFORT` and forgotten here would be
       `undefined` in the renderer table and would then share a cache with every
       other forgotten stage — which is the same shape of accident as the one
       above, one level further out. */
    for (const stage of Object.keys(STAGE_EFFORT) as (keyof typeof STAGE_EFFORT)[]) {
      expect(ARTICLE_RENDERER[stage]).toBeDefined();
    }
  });

  it("treats a stage that does not read the article as sharing nothing", () => {
    for (const step of ["fetch", "extract", "blocks", "hierarchy", "summary"] as StepName[]) {
      expect(sharesArticleCache(step, ["arc", "tweets", "glossary", "ideas"])).toBe(false);
      expect(sharesArticleCache("arc", [step])).toBe(false);
    }
  });

  it("shares nothing when it is the only article stage in the job", () => {
    /* Nobody else is here to read the entry, so the 1.25x write premium buys
       nothing. This is the case the conditional breakpoint exists for and the
       only one it was ever right about.

       It used to read "looks only at what comes after, never at what already
       ran", with a comment explaining that a stage behind you "has already been
       paid for" so caching now "buys nobody anything" — which is exactly
       backwards. What an earlier same-group stage leaves behind is a *warm
       entry*, and the whole reason to mark is to read it. That sentence was the
       bug, written down and asserted. See `cacheArticleForStep`. */
    expect(sharesArticleCache("arc", [])).toBe(false);
    expect(cacheArticleForStep(["arc"], 0)).toBe(false);
  });

  it("marks BOTH members of every same-group pair, the reader as well as the writer", () => {
    /* **The test that was missing, and the reason the bug survived review.**
       Every case in this file asked the writer's question — "is a later step
       going to read what I write" — so a predicate that answered it perfectly
       and never asked the reader's looked complete. Caching is a two-party
       protocol: the entry is only worth writing if the second request carries a
       breakpoint of its own, because a request with no `cache_control` performs
       no lookup at all.

       Generated from the tables rather than hardcoded, so a stage added to a
       group is covered the day it arrives rather than the day somebody
       remembers this file. */
    const stages = Object.keys(STAGE_EFFORT) as ArticleStage[];
    const pairs = stages.flatMap((a) =>
      stages
        .filter(
          (b) => b !== a && STAGE_EFFORT[b] === STAGE_EFFORT[a] && ARTICLE_RENDERER[b] === ARTICLE_RENDERER[a],
        )
        .map((b) => [a, b] as const),
    );
    /* If this ever hits zero the loop below passes vacuously and proves
       nothing — the failure mode of every generated test. */
    expect(pairs.length).toBeGreaterThan(0);

    for (const [first, second] of pairs) {
      const job: StepName[] = [first, second];
      expect(cacheArticleForStep(job, 0), `${first} (writer) in [${job.join(", ")}]`).toBe(true);
      expect(cacheArticleForStep(job, 1), `${second} (reader) in [${job.join(", ")}]`).toBe(true);
    }
  });

  it("marks all three of a three-mode job, not just the two that write", () => {
    /* The shape that made "never worked" the wrong word and "never worked for a
       pair" the right one: in `[ideas, timeline, sketch]` the middle step is both
       a reader and a writer, so the old later-only predicate did mark it. Only
       `sketch`, the last, went out blind. All three read the same `ids`
       rendering at the same `high` effort. */
    const job: StepName[] = ["ideas", "timeline", "sketch"];
    for (let i = 0; i < job.length; i++) {
      expect(cacheArticleForStep(job, i), `${job[i]} at ${i}`).toBe(true);
    }
  });

  it("does not let a step out of the group into one, from either side", () => {
    /* `glossary` sits between arc/tweets and ideas/timeline on the two tables at
       once — same renderer as the first pair, same nothing as the second — so it
       is the stage most likely to be swept in by a predicate that got sloppy
       about direction when it stopped only looking forwards. */
    expect(cacheArticleForStep(["arc", "glossary"], 0)).toBe(false);
    expect(cacheArticleForStep(["arc", "glossary"], 1)).toBe(false);
    expect(cacheArticleForStep(["ideas", "glossary", "timeline"], 1)).toBe(false);
    // ...while the pair straddling it still finds each other.
    expect(cacheArticleForStep(["ideas", "glossary", "timeline"], 0)).toBe(true);
    expect(cacheArticleForStep(["ideas", "glossary", "timeline"], 2)).toBe(true);
  });

  it("filters by position, so a repeated step would not be filtered away with itself", () => {
    /* **Defensive, and labelled as such rather than dressed up as a real job
       shape.** `orderSteps` puts every job's names through a `Set`, so a job
       cannot actually hold one step twice — a forced re-run is a flag on the one
       entry. GPT Sol caught the first version of this test claiming otherwise.

       Pinned anyway, because position is the shape that stays correct if that
       ever changes: filtering by *name* would remove the other copy along with
       this one, reporting a lone step where two calls would share a prefix. */
    expect(orderSteps(["arc", "arc"])).toEqual(["arc"]);
    expect(cacheArticleForStep(["arc", "arc"], 0)).toBe(true);
    expect(cacheArticleForStep(["arc", "arc"], 1)).toBe(true);
  });

  it("answers false for an index that is not in the job", () => {
    // Also unreachable from production, where the index comes from the array itself.
    expect(cacheArticleForStep(["arc", "tweets"], 7)).toBe(false);
    expect(cacheArticleForStep([], 0)).toBe(false);
  });

  it("does not mark a job whose only same-group sibling never runs — nor pretend that is free", () => {
    /* `job.steps` is the whole plan and is never filtered before `runStep`, but
       it can hold steps that make no call: freshness skips them, or an earlier
       failure stops the walk reaching them. The predicate cannot see that and
       does not try — it marks on membership, and the wrong guess costs one write
       premium (~1.3¢ on a 17,000-word article, per group). The alternative,
       filtering on `status === "done"`, buys certainty it cannot deliver: a
       resumed job has `done` steps whose entries expired an hour ago.

       What this pins is that the plan, not the outcome, is the input — so the
       flag is a pure function of the step list and reading it needs no job. */
    expect(cacheArticleForStep(["arc", "tweets"], 0)).toBe(true);
    expect(cacheArticleForStep(["arc", "tweets"], 1)).toBe(true);
  });

  it("does not mark a prefix during an ordinary ingest, where nothing reads it", () => {
    /* The whole point of the flag. `DEFAULT_INGEST_STEPS` ends at `assets` and
       holds no article stage at all — arc, tweets and glossary are things a
       reader asks for later — so an ingest that marked the article would pay
       1.25x for an entry that expires unread.

       Asked through `cacheArticleForStep`, which looks in both directions: since
       the fix, "nothing later reads it" is no longer enough to keep a marker off
       an ingest, and this has to hold against the stronger predicate to still
       mean anything. If it ever goes red because a stage was appended to the
       default, check whether the new stage shares a group with one already there
       before celebrating — two article stages in the default would be a real
       saving, and one would be a real waste. */
    const steps = DEFAULT_INGEST_STEPS;
    for (let i = 0; i < steps.length; i++) {
      expect(cacheArticleForStep(steps, i), `${steps[i]} in an ordinary ingest`).toBe(false);
    }
  });

  it("marks it when a job really does schedule two of the group together", () => {
    const job: StepName[] = ["arc", "tweets"];
    expect(cacheArticleForStep(job, 0)).toBe(true);
    expect(cacheArticleForStep(job, 1)).toBe(true);
  });

  it("lets the environment override every stage at once, for comparison runs", () => {
    const before = process.env.SPIDERYARN_PIPELINE_EFFORT;
    try {
      process.env.SPIDERYARN_PIPELINE_EFFORT = "medium";
      expect(effortFor("arc")).toBe("medium");
      expect(effortFor("glossary")).toBe("medium");
    } finally {
      if (before === undefined) delete process.env.SPIDERYARN_PIPELINE_EFFORT;
      else process.env.SPIDERYARN_PIPELINE_EFFORT = before;
    }
    expect(effortFor("arc")).toBe(STAGE_EFFORT.arc);
  });
});
