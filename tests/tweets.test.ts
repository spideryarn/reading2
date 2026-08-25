/**
 * The deterministic half of stage 5c — src/tweets.ts.
 *
 * Nothing here calls a model. What is pinned is everything that happens either
 * side of the call: how a post's characters are counted, what the artefact
 * looks like once the model's array has been numbered, whether a thread still
 * describes the article on disk, and how many posts we ask for.
 *
 * Same split as stage 4, and for the same reason — `buildTree` in src/toc.ts is
 * exported and tested precisely so that only the genuinely nondeterministic
 * part goes untested. See docs/project/testing.md.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildThread,
  countChars,
  hashBlocks,
  isStale,
  LIMIT,
  overLimit,
  suggestedLength,
  TARGET,
  threadIsCurrent,
} from "../src/tweets.js";
import type { Block, TweetThread } from "../src/types.js";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: "", gistable: true };
}

const BLOCKS = [block("spya-aaaaaa", "The first paragraph."), block("spya-bbbbbb", "The second.")];

describe("countChars", () => {
  it("counts what a reader would count", () => {
    expect(countChars("hello")).toBe(5);
    expect(countChars("")).toBe(0);
  });

  it("counts an astral character once, not twice", () => {
    // `"𝕏".length` is 2, because JavaScript stores it as a surrogate pair.
    // That is a fact about the runtime, not about the post, and a per-post
    // counter that reports it would be wrong in a way nobody could explain.
    expect("𝕏".length).toBe(2);
    expect(countChars("𝕏")).toBe(1);
  });

  it("leaves room for the numbering the page adds", () => {
    // TARGET is what the prompt asks for; LIMIT is what the page bars against.
    // The gap is the "12/14 " prefix, which counts on X and is not in `text`.
    expect(TARGET).toBeLessThan(LIMIT);
    expect(LIMIT).toBe(280);
  });
});

describe("buildThread", () => {
  const opts = { slug: "a-slug", sourceHash: "deadbeefdeadbeef", elapsedMs: 1234 };

  it("stores no post number, because the array already has the order", () => {
    // A stored `number` beside the index is a second copy of one fact, and the
    // two can only ever disagree — which is how a page renders "3/12" twice.
    const thread = buildThread({ tweets: ["one", "two", "three"] }, opts);
    expect(thread.tweets.map((t) => t.text)).toEqual(["one", "two", "three"]);
    for (const t of thread.tweets) expect(t).not.toHaveProperty("number");
  });

  it("keeps an overlong post exactly as written", () => {
    // The whole argument of the plan's character-limit section. Their first
    // answer truncated to fit and hid what the model said; their second
    // rejected all twelve posts because one was long. We do neither.
    const long = "x".repeat(LIMIT + 12);
    const thread = buildThread({ tweets: ["short", long] }, opts);
    expect(thread.tweets[1]?.text).toBe(long);
    expect(thread.tweets[1]?.chars).toBe(LIMIT + 12);
    expect(overLimit(thread)).toBe(1);
  });

  it("does not throw away the good posts because of the long one", () => {
    const thread = buildThread({ tweets: ["a", "x".repeat(400), "c"] }, opts);
    expect(thread.tweets).toHaveLength(3);
  });

  it("records the limit it counted against, so the page needn't hardcode one", () => {
    expect(buildThread({ tweets: ["a"] }, opts).limit).toBe(LIMIT);
  });

  it("carries the source hash and the duration into the artefact", () => {
    const thread = buildThread({ tweets: ["a"] }, opts);
    expect(thread.sourceHash).toBe("deadbeefdeadbeef");
    expect(thread.elapsedMs).toBe(1234);
    expect(thread.version).toMatch(/^tweets\//);
  });

  it("trims each post and drops empty ones", () => {
    const thread = buildThread({ tweets: ["  a  ", "", "   ", "b"] }, opts);
    expect(thread.tweets.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("refuses to write an empty thread", () => {
    // A zero-post thread is not a degenerate success. Written to disk it would
    // satisfy the step's existence check for ever, so the stage would report
    // itself done and never run again.
    expect(() => buildThread({ tweets: [] }, opts)).toThrow(/no posts/);
    expect(() => buildThread({ tweets: ["", "  "] }, opts)).toThrow(/no posts/);
  });

  it("has no thread summary at all", () => {
    // Cut deliberately: a sentence summarising a thread that is itself a
    // summary of the article. The tree root's gist already says the whole
    // piece in one sentence, and the library card already uses it.
    expect(buildThread({ tweets: ["a"] }, opts)).not.toHaveProperty("summary");
  });
});

describe("hashBlocks and isStale", () => {
  it("is stable for the same article", () => {
    expect(hashBlocks(BLOCKS)).toBe(hashBlocks(BLOCKS.map((b) => ({ ...b }))));
  });

  it("changes when the text changes", () => {
    const edited = [BLOCKS[0]!, block("spya-bbbbbb", "The second, rewritten.")];
    expect(hashBlocks(edited)).not.toBe(hashBlocks(BLOCKS));
  });

  it("changes when the ids change, even with identical text", () => {
    // A re-split that moved the boundaries produces the same prose under
    // different ids. The thread was written against the old shape either way.
    const resplit = [block("spya-cccccc", "The first paragraph."), BLOCKS[1]!];
    expect(hashBlocks(resplit)).not.toBe(hashBlocks(BLOCKS));
  });

  it("ignores fields a reader never reads", () => {
    // `words` is derived and `html` changes whenever the sanitiser does.
    // Neither means the article a thread describes has changed.
    const rehtml = BLOCKS.map((b) => ({ ...b, html: "<p>anything</p>", words: 99 }));
    expect(hashBlocks(rehtml)).toBe(hashBlocks(BLOCKS));
  });

  it("says a thread is stale once the article moves under it", () => {
    const thread = buildThread(
      { tweets: ["a"] },
      { slug: "s", sourceHash: hashBlocks(BLOCKS), elapsedMs: 0 },
    );
    expect(isStale(thread, BLOCKS)).toBe(false);
    expect(isStale(thread, [...BLOCKS, block("spya-dddddd", "And a third.")])).toBe(true);
  });
});

describe("suggestedLength", () => {
  it("scales with the article rather than being a flat twelve", () => {
    // Theirs asked for 12 every time, tuned on academic papers of roughly one
    // length. This pipeline eats a 500-word blog post and a 13,000-word essay.
    expect(suggestedLength(500)).toBeLessThan(suggestedLength(8000));
  });

  it("never asks for fewer than four posts or more than fifteen", () => {
    expect(suggestedLength(0)).toBe(4);
    expect(suggestedLength(200_000)).toBe(15);
  });

  it("never shrinks as the article grows", () => {
    // Sweep the range rather than sampling it — docs/project/testing.md.
    let previous = 0;
    for (let words = 0; words <= 30_000; words += 50) {
      const n = suggestedLength(words);
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  it("puts our long test article on twelve", () => {
    // 8,275 words — the Noema essay. Landing on the number their own research
    // picked is a sanity check on the divisor, not a target.
    expect(suggestedLength(8275)).toBe(12);
  });
});

/* ---------------------------------------------------------------------------
   `threadIsCurrent` — the step's own freshness check, and the difference
   between a cache and a file that happens to exist.

   Worth real files rather than a stub: it is read as `stepIsDone`'s answer, so
   getting it wrong either serves last week's thread for ever (too permissive)
   or spends a model call on every run (too strict). Both are quiet.
--------------------------------------------------------------------------- */

const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** A data directory holding these blocks and, optionally, a thread. */
async function fixture(blocks: Block[], thread?: Partial<TweetThread>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "spya-tweets-"));
  dirs.push(dir);
  await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks }), "utf8");
  if (thread) {
    const full = buildThread(
      { tweets: ["a post"] },
      { slug: "s", sourceHash: hashBlocks(blocks), elapsedMs: 0 },
    );
    await writeFile(path.join(dir, "tweets.json"), JSON.stringify({ ...full, ...thread }), "utf8");
  }
  return dir;
}

describe("threadIsCurrent", () => {
  it("says yes for a thread written against these very blocks", async () => {
    expect(await threadIsCurrent(await fixture(BLOCKS, {}))).toBe(true);
  });

  it("says no once the article has changed underneath it", async () => {
    // THE bug this whole predicate exists for. Without it the file is present,
    // so the step skips, reports "already done" with a green tick, and the
    // page serves a thread about text that has since moved —
    // docs/reusable/silent-success.md.
    const dir = await fixture(BLOCKS, {});
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify({ blocks: [...BLOCKS, block("spya-dddddd", "A new paragraph.")] }),
      "utf8",
    );
    expect(await threadIsCurrent(dir)).toBe(false);
  });

  it("says no when the prompt has changed", async () => {
    expect(await threadIsCurrent(await fixture(BLOCKS, { version: "tweets/0" }))).toBe(false);
  });

  it("says no when the model has changed", async () => {
    expect(await threadIsCurrent(await fixture(BLOCKS, { generator: "some-old-model" }))).toBe(
      false,
    );
  });

  it("says no when there is no thread, and when there are no blocks", async () => {
    expect(await threadIsCurrent(await fixture(BLOCKS))).toBe(false);
    expect(await threadIsCurrent(path.join(tmpdir(), "spya-nothing-here-at-all"))).toBe(false);
  });

  it("says no for an unreadable thread rather than throwing", async () => {
    // Not-current is the safe way to be wrong: it costs one model call, where
    // the other way round serves a wrong thread for ever.
    const dir = await fixture(BLOCKS, {});
    await writeFile(path.join(dir, "tweets.json"), "{ not json", "utf8");
    expect(await threadIsCurrent(dir)).toBe(false);
  });
});
