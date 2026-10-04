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
import {
  ARTICLE_OUTPUT_FORMAT,
  cacheArticleForStep,
  DEFAULT_INGEST_STEPS,
  sharesArticleCache,
} from "../src/pipeline.js";
import type { StepName } from "../src/types.js";

describe("the article cache group", () => {
  it("separates equal-effort, equal-renderer stages when their schemas differ", () => {
    expect(STAGE_EFFORT.tweets).toBe(STAGE_EFFORT.ideas);
    expect(ARTICLE_RENDERER.tweets).toBe(ARTICLE_RENDERER.ideas);
    expect(ARTICLE_OUTPUT_FORMAT.tweets).not.toBeNull();
    expect(ARTICLE_OUTPUT_FORMAT.ideas).not.toBeNull();
    expect(ARTICLE_OUTPUT_FORMAT.tweets).not.toEqual(ARTICLE_OUTPUT_FORMAT.ideas);
    expect(sharesArticleCache("tweets", ["ideas"])).toBe(false);
    expect(sharesArticleCache("ideas", ["tweets"])).toBe(false);
  });

  it("does not share when effort and renderer match but the schemas differ", () => {
    expect(ARTICLE_OUTPUT_FORMAT.tweets).not.toEqual(ARTICLE_OUTPUT_FORMAT.faq);
    expect(sharesArticleCache("faq", ["tweets"])).toBe(false);
  });

  it("no longer puts arc and tweets together, though they still think at the same effort", () => {
    /* They were this file's canonical pair until `tweets/5`, when each post
       started naming its source blocks and tweets moved to the `ids` renderer.
       Same effort, different bytes: arc now has no partner at all.
       docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md. */
    expect(STAGE_EFFORT.arc).toBe(STAGE_EFFORT.tweets);
    expect(sharesArticleCache("arc", ["tweets"])).toBe(false);
    expect(sharesArticleCache("tweets", ["arc"])).toBe(false);
  });

  it("separates two text stages when their schemas differ", () => {
    /* The schema is part of Anthropic's cache key just as effort is. Quotes
       differ, so their formerly shared prefix is no longer compatible even
       though the article bytes still match. */
    expect(STAGE_EFFORT.glossary).toBe(STAGE_EFFORT.quotes);
    expect(ARTICLE_RENDERER.glossary).toBe(ARTICLE_RENDERER.quotes);
    expect(ARTICLE_OUTPUT_FORMAT.glossary).not.toBeNull();
    expect(ARTICLE_OUTPUT_FORMAT.quotes).not.toBeNull();
    expect(ARTICLE_OUTPUT_FORMAT.glossary).not.toEqual(ARTICLE_OUTPUT_FORMAT.quotes);
    expect(sharesArticleCache("glossary", ["quotes"])).toBe(false);
    expect(sharesArticleCache("quotes", ["glossary"])).toBe(false);
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

  it("keeps ideas away from arc even though its effort MATCHES", () => {
    /* **The case that first made the predicate read two dimensions instead of one.**
       `ideas` thinks at `high`, exactly like arc, so an effort-only grouping
       says the two share — and they cannot. `ideas` answers with block ids, so
       it sends `articleWithIds` where arc sends `articleText`; the two
       renderings of one article agree on the head and on nothing after it.
       (It was first written about arc *and* tweets; tweets has since crossed
       over to the ids side, which is the same rule seen from the other end.)

       What that would have cost is not an error: it is `arc` marking the
       article on a job that has `ideas` behind it, paying the 1.25x write
       premium, and collecting no read at all. Nothing throws, nothing looks
       wrong, and the bill goes up. GPT Sol, 2026-08-27. */
    expect(STAGE_EFFORT.ideas).toBe(STAGE_EFFORT.arc);
    expect(ARTICLE_RENDERER.ideas).not.toBe(ARTICLE_RENDERER.arc);
    expect(sharesArticleCache("arc", ["ideas"])).toBe(false);
    expect(sharesArticleCache("ideas", ["arc", "glossary", "quotes"])).toBe(false);
  });

  it("dissolves the former ids/high group because every schema differs", () => {
    /* These stages still match on effort and article bytes. Their answer
       contracts differ, so Anthropic gives each a different cache key. A false
       share here pays the 1.25x write premium and can never collect a read. */
    expect(STAGE_EFFORT.timeline).toBe(STAGE_EFFORT.ideas);
    expect(ARTICLE_RENDERER.timeline).toBe(ARTICLE_RENDERER.ideas);
    expect(ARTICLE_OUTPUT_FORMAT.ideas).not.toBeNull();
    expect(ARTICLE_OUTPUT_FORMAT.timeline).not.toBeNull();
    expect(sharesArticleCache("ideas", ["timeline"])).toBe(false);
    expect(sharesArticleCache("timeline", ["quiz"])).toBe(false);
    expect(sharesArticleCache("timeline", ["arc", "glossary", "quotes"])).toBe(false);
    expect(sharesArticleCache("timeline", ["sketch"])).toBe(false);
  });

  it("puts sketch in no group at all, since it thinks at `low`", () => {
    /* **Same bytes as `ideas`, different effort, so no share** — the same rule
       that keeps glossary away from arc. Sketch was in the `ids` + `high` group
       until 2026-10-01, when the thinking-effort eval found no visible loss at
       `low` (docs/investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).
       Pinned in both directions because the wrong answer either way throws
       nothing: a sketch marked beside `ideas` pays the 1.25x write premium for
       a read that cannot happen. If sketch ever goes back to `high`, this is
       the test that says the group changed, and the comments in src/models.ts
       and src/step-order.ts need to change with it. */
    expect(STAGE_EFFORT.sketch).toBe("low");
    expect(ARTICLE_RENDERER.sketch).toBe(ARTICLE_RENDERER.ideas);
    const others = (Object.keys(STAGE_EFFORT) as ArticleStage[]).filter((s) => s !== "sketch");
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(sharesArticleCache("sketch", [other]), `sketch with ${other}`).toBe(false);
      expect(sharesArticleCache(other, ["sketch"]), `${other} with sketch`).toBe(false);
    }
    expect(cacheArticleForStep(["ideas", "timeline", "sketch"], 2)).toBe(false);
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
    for (const step of ["fetch", "extract", "blocks", "structure", "summary"] as StepName[]) {
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

  it("has no distinct same-group pair after the remaining schemas land", () => {
    /* Generated from all three key dimensions, so a future byte-identical
       schema pair makes this fail and forces the cache policy to be revisited. */
    const stages = Object.keys(STAGE_EFFORT) as ArticleStage[];
    const pairs = stages.flatMap((a) =>
      stages
        .filter(
          (b) =>
            b !== a &&
            STAGE_EFFORT[b] === STAGE_EFFORT[a] &&
            ARTICLE_RENDERER[b] === ARTICLE_RENDERER[a] &&
            JSON.stringify(ARTICLE_OUTPUT_FORMAT[b]) === JSON.stringify(ARTICLE_OUTPUT_FORMAT[a]),
        )
        .map((b) => [a, b] as const),
    );
    expect(pairs).toEqual([]);
    for (const first of stages) {
      for (const second of stages) {
        if (first === second) continue;
        expect(sharesArticleCache(first, [second]), `${first} with ${second}`).toBe(false);
      }
    }
  });

  it("marks none of the former three-mode group once their schemas differ", () => {
    /* Same `ids` rendering and `high` effort are no longer sufficient: every
       format is different, so no request should pay to mark its article. */
    const job: StepName[] = ["tweets", "timeline", "quiz"];
    for (let i = 0; i < job.length; i++) {
      expect(cacheArticleForStep(job, i), `${job[i]} at ${i}`).toBe(false);
    }
  });

  it("does not let a step out of the group into one, from either side", () => {
    /* `glossary` sits between text and ids stages and is the likeliest accidental
       bridge if any cache-key dimension is ignored. */
    expect(cacheArticleForStep(["arc", "glossary"], 0)).toBe(false);
    expect(cacheArticleForStep(["arc", "glossary"], 1)).toBe(false);
    expect(cacheArticleForStep(["tweets", "glossary", "timeline"], 1)).toBe(false);
    expect(cacheArticleForStep(["tweets", "glossary", "timeline"], 0)).toBe(false);
    expect(cacheArticleForStep(["tweets", "glossary", "timeline"], 2)).toBe(false);
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
    expect(cacheArticleForStep(["ideas", "faq"], 7)).toBe(false);
    expect(cacheArticleForStep([], 0)).toBe(false);
  });

  it("does not mark two former group members even when both are in the plan", () => {
    /* `job.steps` is the whole plan and is never filtered before `runStep`, but
       it can hold steps that make no call: freshness skips them, or an earlier
       failure stops the walk reaching them. The predicate cannot see that and
       does not try — it marks on membership, and the wrong guess costs one write
       premium (~1.3¢ on a 17,000-word article, per group). The alternative,
       filtering on `status === "done"`, buys certainty it cannot deliver: a
       resumed job has `done` steps whose entries expired an hour ago.

       Here even the plan cannot justify a marker: the formats differ, so no
       read is possible whether both calls run or not. */
    expect(cacheArticleForStep(["tweets", "faq"], 0)).toBe(false);
    expect(cacheArticleForStep(["tweets", "faq"], 1)).toBe(false);
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

  it("does not mark the former group when a job schedules both stages", () => {
    const job: StepName[] = ["tweets", "faq"];
    expect(cacheArticleForStep(job, 0)).toBe(false);
    expect(cacheArticleForStep(job, 1)).toBe(false);
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
