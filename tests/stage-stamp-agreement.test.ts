/**
 * **The hash a stage writes and the hash its `stamp` expects must be the same
 * number**, computed over the same article.
 *
 * Every article-reading stage embeds a `sourceHash` inside the artefact it
 * produces (`src/source-hash.ts`), and `PipelineStep.stamp` separately computes
 * an expected `inputHash` from the store. `stepIsDone` compares the two through
 * `sameStamp`. Nothing anywhere compares the *definitions*.
 *
 * So if the two ever compute over different inputs, the artefact is stale for
 * ever while looking perfectly healthy: the step re-runs on every job, spends a
 * model call, writes an artefact whose hash the stamp can never reproduce, and
 * no check goes red — the artefact parses, the ids resolve, the reading view
 * shows it. docs/reusable/silent-success.md.
 *
 * That is not hypothetical: stage 2a of docs/plans/260831b-finish-the-database-move.md
 * moved exactly the code that gets this right or wrong, in seven places, done
 * by three agents.
 *
 * **What this file does not cover, said here because it used to claim it did.**
 * `generateIdeas` and `generateSketch` fall back to a stub
 * `{ title: tree.slug }` for the prompt when there is no metadata, and the note
 * that stood here said hashing that stub instead of the real `null` would make
 * every article without metadata permanently stale, with this file as the thing
 * that would catch it. Neither half is true. `articleWithIdsFingerprint`
 * resolves `fallbackHeadTitle` itself for a `null` meta, so the two hashes are
 * the same sixteen characters and hashing either is correct
 * (src/source-hash.ts). And the mutation that *does* break it — a second field
 * on the stub, which puts a line in the prompt that no fingerprint represents —
 * leaves every one of the assertions below green, because both sides of the
 * comparison here go on hashing the same `null`. That property belongs to
 * tests/meta-fallback-fingerprint.test.ts, which asks it of the head that
 * actually reached the model. GPT Sol, 2026-08-31.
 *
 * ## What this file does
 *
 * For each stage: run the **real** generator against the `example/` fixture
 * with the model stubbed, take the `sourceHash` off the artefact it returns, and
 * assert it equals the `inputHash` that `STEPS.<name>.stamp` returns for the
 * same article and the same store. No network, no directory reads — the store is
 * the only thing either side is given.
 *
 * **Both metadata states, every stage.** Once with `meta.json` present and once
 * with an article that has none. The second is the case the near-miss was about,
 * and an ordinary fixture never exercises it.
 *
 * `assets` is here too. It takes a **blocks-only** hash on purpose — it is the
 * one stamped stage with no prompt, so there is no head and no tree in its
 * question (`inputHashFor` in src/pipeline.ts) — and its two rows therefore
 * agree with each other across the metadata split rather than differing. That is
 * correct rather than an omission, and this file asserts it as a property so
 * that nobody "fixes" it into `articleFingerprint`.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { partsOf } from "../src/arc.js";
import type { Article } from "../src/article-input.js";
import { readArticle } from "../src/article-input.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactReads } from "../src/store/artifacts.js";

/* ------------------------------------------------------- the stubbed model -- */

/** What the next call answers. One entry per call the test expects. */
const answers: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      const text = answers.shift();
      if (text === undefined) throw new Error("the stub ran out of scripted answers");
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

/**
 * **`assets` has no model call and a network one instead**, so it needs its own
 * stub: `collectAssets` fetches every image the article's blocks name, and the
 * fixture has one.
 *
 * A refusal rather than a stored image, deliberately. The manifest's
 * `sourceHash` is `hashBlocks(blocks)` and nothing about it depends on what came
 * back off the wire (`src/collect-assets.ts`), so failing every fetch exercises
 * the same hash with no bucket, no bytes and no network — and if that ever
 * stopped being true, this test would be the thing that noticed.
 */
vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  return {
    ...real,
    fetchAsset: (url: string) =>
      Promise.reject(new real.FetchFailure("not-found", url, "no network in this test")),
  };
});

/* --------------------------------------------------------------- the fixture -- */

const REPO = path.resolve(import.meta.dirname, "..");
const SLUG = "noema-mythology-of-conscious-ai";

/** Two copies of `example/`: one with `meta.json`, one with it removed. */
let root = "";

interface Fixture {
  store: ArtifactReads;
  article: Article;
}

/** With metadata — the ordinary state, and the one every other fixture has. */
let withMeta: Fixture;
/** Without — a real, legitimate input that no ordinary fixture reaches. */
let noMeta: Fixture;

async function fixtureAt(name: string, keepMeta: boolean): Promise<Fixture> {
  const at = path.join(root, name);
  await cp(path.join(REPO, "example"), path.join(at, "data", SLUG), { recursive: true });
  if (!keepMeta) await rm(path.join(at, "data", SLUG, "meta.json"));
  const store = createFsArtifactStore((slug) => ({
    dir: path.join(at, "data", slug),
    htmlFile: path.join(at, "output", `${slug}.html`),
  })) as ArtifactReads;
  return { store, article: await readArticle(SLUG, store) };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-stamp-"));
  withMeta = await fixtureAt("with-meta", true);
  noMeta = await fixtureAt("no-meta", false);
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * The context every stage gets. **Its directory does not exist**, and that is
 * on purpose: a stage that reached for `ctx.dir` would fail rather than quietly
 * hash one article and generate from another — the exact confusion this file is
 * about. tests/late-step-on-a-cold-instance.test.ts is the same asymmetry from
 * the other side.
 */
function ctxFor(): StepContext {
  return {
    slug: SLUG,
    dir: path.join(root, "nowhere", "data", SLUG),
    htmlFile: path.join(root, "nowhere", "output", `${SLUG}.html`),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/* ------------------------------------------------- what the model answers -- */

/**
 * The stages this file covers, and the artefact key each returns in `parts`.
 *
 * Every one of them carries a `sourceHash`; the whole point of the list is that
 * one shape of test covers all seven rather than seven near-copies.
 */
const STAGES = ["arc", "tweets", "glossary", "ideas", "quotes", "sketch", "assets"] as const;
type Stage = (typeof STAGES)[number];

/** A block with enough prose in it to quote — chosen from the article, not typed. */
function quotableBlock(article: Article) {
  const block = article.blocks.filter(isBodyEvidence).find((b) => b.text.length > 120);
  if (!block) throw new Error("the fixture has no block long enough to quote");
  return block;
}

/**
 * What the stubbed model says, per stage — derived from the article rather than
 * hard-coded, because `ideas` and `quotes` both refuse an answer whose passages
 * are not in the piece, and `arc` refuses a length that is not one sentence per
 * part. A literal here would fail the day the fixture changed, for a reason with
 * nothing to do with what this file is about.
 */
function scriptFor(stage: Stage, article: Article): string[] {
  const block = quotableBlock(article);
  switch (stage) {
    case "arc":
      return [
        JSON.stringify({
          arc: partsOf(article.tree).map((_, i) => `Part ${i + 1} says something.`),
        }),
      ];
    case "tweets":
      return [JSON.stringify({ tweets: ["A post about the article.", "And a second one."] })];
    case "glossary":
      return [
        JSON.stringify({
          entries: [
            { name: "Consciousness", kind: "concept", gloss: "What it is like to be something." },
          ],
        }),
      ];
    case "ideas":
      return [
        JSON.stringify({
          ideas: [
            {
              name: "The piece rests on something",
              provenance: "introduced",
              statement: "The argument depends on a claim it states rather than assumes.",
              occurrences: [
                { blockId: block.id, quote: block.text.slice(0, 60), reasoning: "States it." },
              ],
            },
          ],
        }),
      ];
    case "quotes":
      return [JSON.stringify({ quotes: [{ text: block.text.slice(0, 120) }] })];
    case "sketch":
      return [JSON.stringify(sketchAnswer(article))];
    case "assets":
      /* No model call at all — the one stamped stage with no prompt. */
      return [];
  }
}

/**
 * The smallest thing `accept` (src/sketch-scene.ts) will call a picture: three
 * nodes, each clickable through to a real block, laid out down the page in
 * document order so `flow` is 1 and `overlap` is 0.
 *
 * Three separate y bands rather than a tidy grid, because two of `accept`'s four
 * refusals are geometric and a picture drawn on top of itself would fail here
 * for a reason that is nothing to do with hashing.
 */
function sketchAnswer(article: Article) {
  const ids = article.blocks.filter(isBodyEvidence).map((b) => b.id);
  const chosen = [ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]];
  return {
    title: "The argument",
    caption: "Three claims, in the order the piece makes them.",
    scenes: [
      {
        id: "overview",
        title: "Overview",
        height: 600,
        items: chosen.map((block, i) => ({
          kind: "node",
          id: `n${i}`,
          x: 120,
          y: 40 + i * 180,
          w: 220,
          h: 60,
          text: `Claim ${i + 1}`,
          block,
        })),
      },
    ],
  };
}

/* ---------------------------------------------------------------- the test -- */

/**
 * Run the stage for real and hand back the two numbers that must agree.
 *
 * `parts[stage].sourceHash` is what the artefact carries; `stamp().inputHash` is
 * what `stepIsDone` will compare it against on the next job. Nothing else in the
 * codebase puts those two side by side.
 */
async function bothHashes(stage: Stage, fixture: Fixture) {
  answers.length = 0;
  answers.push(...scriptFor(stage, fixture.article));
  const ctx = ctxFor();
  const result = await STEPS[stage].run(ctx, fixture.store);
  const artefact = result.parts?.[stage] as { sourceHash?: string } | undefined;
  /* If the stub ran short, `answers` still holds entries — a silent way for a
     stage to have taken a path this file did not intend. */
  expect(answers).toEqual([]);
  const stamp = await STEPS[stage].stamp?.(ctx, fixture.store);
  return { wrote: artefact?.sourceHash, expected: stamp?.inputHash };
}

describe("the hash a stage writes is the hash its stamp expects", () => {
  for (const stage of STAGES) {
    it(`${stage}, with metadata`, async () => {
      const { wrote, expected } = await bothHashes(stage, withMeta);
      /* Asserted before the comparison: two `undefined`s are equal, and that is
         exactly the shape of a stage that has quietly stopped recording one. */
      expect(wrote, `${stage} wrote no sourceHash`).toEqual(expect.any(String));
      expect(expected, `${stage}'s stamp produced no inputHash`).toEqual(expect.any(String));
      expect(wrote).toBe(expected);
    }, 30_000);

    it(`${stage}, with no metadata at all`, async () => {
      /* The legitimate input no ordinary fixture reaches. `generateIdeas` and
         `generateSketch` synthesise a head from `tree.slug` here, and what this
         row asks is only that the two *hashes* still meet — whether the head
         they synthesised is the head those hashes describe is a different
         question, and tests/meta-fallback-fingerprint.test.ts asks it. */
      const { wrote, expected } = await bothHashes(stage, noMeta);
      expect(wrote, `${stage} wrote no sourceHash`).toEqual(expect.any(String));
      expect(expected, `${stage}'s stamp produced no inputHash`).toEqual(expect.any(String));
      expect(wrote).toBe(expected);
    }, 30_000);
  }

  /**
   * **The negative control, and without it the fourteen above prove much less.**
   *
   * They would all pass if every stage hashed a constant, or if the metadata
   * were quietly dropped from both sides at once — agreement is cheap when
   * neither side is looking at anything. This asserts the other half: for the
   * six stages whose prompt has a head, removing the metadata *changes* the
   * hash, so the fingerprints really do read it.
   *
   * `assets` is the exception and it is named rather than skipped: its question
   * is the blocks and nothing else, so its two hashes are equal across the split
   * by design (`inputHashFor` in src/pipeline.ts). Asserting that keeps somebody
   * from "completing" it against `articleFingerprint` and marking every manifest
   * on every shelf stale for a head no image fetcher ever read.
   */
  it("and the metadata is actually in the hash — except for assets, which has no prompt", async () => {
    const seen = new Map<Stage, { with: string | undefined; without: string | undefined }>();
    for (const stage of STAGES) {
      const a = await bothHashes(stage, withMeta);
      const b = await bothHashes(stage, noMeta);
      seen.set(stage, { with: a.wrote, without: b.wrote });
    }
    for (const stage of STAGES) {
      const row = seen.get(stage);
      if (stage === "assets") {
        expect(row?.with, "assets hashes the blocks and nothing else").toBe(row?.without);
      } else {
        expect(row?.with, `${stage} ignores the metadata`).not.toBe(row?.without);
      }
    }
  }, 60_000);
});
