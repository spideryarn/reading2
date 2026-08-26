/**
 * **Which stages share a cached article, and when it is worth paying for one.**
 *
 * Both halves of this were wrong in the first implementation, and neither could
 * fail: the article bytes were identical across three stages that were
 * nonetheless in two different caches, and every ingest paid a write premium for
 * a read that the normal path never performs. Nothing threw either time.
 *
 * See docs/project/prompt-caching.md and docs/plans/prompt-caching-sol-review.md.
 */
import { describe, expect, it } from "vitest";
import { effortFor, STAGE_EFFORT } from "../src/models.js";
import { DEFAULT_INGEST_STEPS, sharesArticleCache } from "../src/pipeline.js";
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
       docs/research/prompt-caching-anthropic.md. */
    expect(STAGE_EFFORT.glossary).not.toBe(STAGE_EFFORT.arc);
    expect(sharesArticleCache("arc", ["glossary"])).toBe(false);
    expect(sharesArticleCache("glossary", ["arc", "tweets"])).toBe(false);
  });

  it("treats a stage that does not read the article as sharing nothing", () => {
    for (const step of ["fetch", "extract", "blocks", "toc", "summary"] as StepName[]) {
      expect(sharesArticleCache(step, ["arc", "tweets", "glossary"])).toBe(false);
      expect(sharesArticleCache("arc", [step])).toBe(false);
    }
  });

  it("looks only at what comes after, never at what already ran", () => {
    // tweets has already been paid for; caching now buys nobody anything.
    expect(sharesArticleCache("arc", [])).toBe(false);
  });

  it("does not mark a prefix during an ordinary ingest, where nothing reads it", () => {
    /* The whole point of the flag. DEFAULT_INGEST_STEPS stops at `arc` — tweets
       and glossary are things a reader asks for later — so an ingest that marked
       the article would pay 1.25x for an entry that expires unread. If this test
       ever goes red because a stage was appended to the default, check that the
       new stage is in the same effort group before celebrating. */
    const steps = DEFAULT_INGEST_STEPS;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as StepName;
      expect(sharesArticleCache(step, steps.slice(i + 1))).toBe(false);
    }
  });

  it("marks it when a job really does schedule two of the group together", () => {
    const job: StepName[] = ["arc", "tweets"];
    expect(sharesArticleCache("arc", job.slice(1))).toBe(true);
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
