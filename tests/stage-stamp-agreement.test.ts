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
 * **And a third copy for one stage.** `timeline` is the only stage whose hash
 * folds in the publication date, and `example/meta.json` carries none — so a
 * `dated-meta` copy exists to give that field a value. See `MetaState` and the
 * last test in this file for what a green suite was hiding without it.
 *
 * `assets` is here too, and its hash is **narrower than every other one on
 * purpose**: the image URLs and the PDF figure refs in the blocks, and nothing
 * else (`assetsInputHash`, src/collect-assets.ts). It is the one stamped stage
 * with no prompt, so there is no head and no tree in its question, and its two
 * rows therefore agree with each other across the metadata split rather than
 * differing. That is correct rather than an omission, and this file asserts it
 * as a property so that nobody "fixes" it into `articleFingerprint`.
 *
 * ## The store here is a fake, and the header above already said so
 *
 * *"No network, no directory reads — the store is the only thing either side is
 * given"* is the `store-agnostic-fake` verdict in
 * [store-migration-registry.ts](store-migration-registry.ts) written in this
 * file's own words. Until 2026-09-05 the store that gave was a
 * `createFsArtifactStore` over three copies of `example/`; it is
 * `memoryArtefactsFrom` now, reading each of those same three copies once. The
 * copies stay, because they are how the three fixtures' *inputs* differ — one
 * with `meta.json`, one without, one with a publication date added. Stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * can now delete `src/store/artifacts-fs.ts` without this file noticing.
 *
 * **Mutation.** Run 2026-09-05. (1) `buildThread`'s `sourceHash` in src/tweets.ts
 * made to fingerprint `(blocks, tree, null)` instead of `(blocks, tree, meta)` —
 * an artefact stamped without the metadata its stamp folds in: **2 of 20 red**,
 * *tweets, with metadata* on a hash mismatch and *and the metadata is actually
 * in the hash* on *tweets ignores the metadata*. (2) `memoryArtefactsFrom` made
 * to plant every kind but `meta`, so all three fixtures look metadata-less:
 * **2 red** — *arc ignores the metadata* and *the artefact's own sourceHash
 * ignores the publication date*, which are precisely the two properties that
 * exist to stop the metadata quietly leaving the hash. The eighteen per-stage
 * agreement cases stay green under arm 2, correctly: both sides then hash the
 * same absent metadata, and that is the near-miss this file's own header warns
 * about at length.
 *
 * **Blind to.** Everything the header already disclaims — above all a stub whose
 * prompt carries a field no fingerprint represents, which is
 * `tests/meta-fallback-fingerprint.test.ts`. And now also blind to the
 * filesystem adapter's own behaviour, which is the point rather than a loss.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { partsOf } from "../src/arc.js";
import type { Article } from "../src/article-input.js";
import { readArticle } from "../src/article-input.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { memoryArtefactsFrom } from "./helpers/memory-artefacts.js";
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

/** Three copies of `example/`, differing only in `meta.json` — see `MetaState`. */
let root = "";

interface Fixture {
  store: ArtifactReads;
  article: Article;
}

/**
 * What one copy of the fixture does with `meta.json`.
 *
 * `"dated"` is here for one stage. `example/meta.json` carries **no
 * `publishedAt`** — like almost every article on the shelf, because the field
 * arrives only on re-extraction — so with only the first two states the whole
 * of this file compares two undated articles, and the one field that separates
 * `datedArticleFingerprint` from `articleWithIdsFingerprint` *in value* is
 * never given a value. Measured rather than assumed: deleting `publishedAt`
 * from the head in `datedArticleFingerprint` (src/source-hash.ts) left every
 * assertion in this file green.
 */
type MetaState = "as-is" | "removed" | "dated";

/** With metadata — the ordinary state, and the one every other fixture has. */
let withMeta: Fixture;
/** Without — a real, legitimate input that no ordinary fixture reaches. */
let noMeta: Fixture;
/** With metadata **and a publication date**, which only `timeline` hashes. */
let datedMeta: Fixture;

/** The publisher's own string, in the shape `dayFrame` reads (src/timeline-time.ts). */
const PUBLISHED_AT = "2023-09-14T00:00:00Z";

async function fixtureAt(name: string, meta: MetaState): Promise<Fixture> {
  const at = path.join(root, name);
  const dir = path.join(at, "data", SLUG);
  await cp(path.join(REPO, "example"), dir, { recursive: true });
  const metaFile = path.join(dir, "meta.json");
  if (meta === "removed") await rm(metaFile);
  if (meta === "dated") {
    const asIs = JSON.parse(await readFile(metaFile, "utf8")) as Record<string, unknown>;
    /* The fixture's own metadata plus one field, so the only thing that can
       move a hash between this copy and `with-meta` is the date itself. */
    await writeFile(metaFile, JSON.stringify({ ...asIs, publishedAt: PUBLISHED_AT }, null, 2));
  }
  /* **The three copies on disk are how each fixture's *input* differs**, and
     they still are: `meta.json` removed here, dated there. What changed on
     2026-09-05 is that the copy is read once and then held in memory rather than
     answered from through a filesystem store — see the note on the `describe`. */
  const store: ArtifactReads = await memoryArtefactsFrom(at, SLUG);
  return { store, article: await readArticle(SLUG, store) };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-stamp-"));
  withMeta = await fixtureAt("with-meta", "as-is");
  noMeta = await fixtureAt("no-meta", "removed");
  datedMeta = await fixtureAt("dated-meta", "dated");
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
 * one shape of test covers all eight rather than eight near-copies.
 *
 * **The list is hand-written, and that is how `timeline` went uncovered from
 * the day it shipped (2026-08-31) until it was noticed.** Nothing derives this
 * from `STEPS`, because not every step is stamped and not every stamped step
 * takes an article — so a new stage joins by somebody remembering. If you add
 * one, add it here.
 */
const STAGES = [
  "arc",
  "tweets",
  "glossary",
  "ideas",
  "quotes",
  "sketch",
  "timeline",
  /* Added the day the stage was registered, 2026-09-01, rather than the day
     somebody noticed — the mistake this list's own header records about
     `timeline`, which went uncovered from the day it shipped. */
  "quiz",
  "assets",
] as const;
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
    case "timeline":
      /* One event, anchored to a real block, with **no `phrase`** — so the
         parser reads no date and `dateEvent` answers `untimed`. Dating is
         src/timeline-time.ts's subject and tests/timeline-time.test.ts's;
         asking for a date here would make this row fail the day a parser rule
         moved, for a reason with nothing to do with hashing.

         The event still has to survive `toEvents`, and that is deliberate
         rather than incidental: `buildTimeline` throws when the model names
         events and every one of them is dropped, so a stub whose block id or
         quote stopped resolving fails loudly instead of writing an empty
         timeline. An empty one would carry a perfectly good `sourceHash` and
         this row would go on passing while testing nothing —
         docs/reusable/silent-success.md.

         The label carries no date-shaped words, or `labelStatesAnUncitedDate`
         would drop the event for stating a date its passage does not. */
      return [
        JSON.stringify({
          events: [
            {
              label: "The piece describes something happening",
              order: 1,
              modality: "happened",
              occurrences: [{ blockId: block.id, quote: block.text.slice(0, 60) }],
            },
          ],
        }),
      ];
    case "quiz":
      /* **One question**, anchored to a real block with a real quote, and one
         question only. The spread rule starts at `SPREAD_FROM` questions, so a
         batch of one is required to carry no particular band and this stub
         cannot fail on a spread rule that has nothing to do with hashing — see
         tests/quiz.test.ts, which asks the rule itself.

         The question still has to survive `toQuestions`, and that is deliberate
         rather than incidental: `buildQuiz` throws when nothing is left, so a
         stub whose block id or quote stopped resolving fails loudly instead of
         writing an empty quiz. An empty one would carry a perfectly good
         `sourceHash` and this row would go on passing while testing nothing —
         docs/reusable/silent-success.md. */
      return [
        JSON.stringify({
          questions: [
            {
              question: "What does the piece say about this passage?",
              referenceAnswer: "It says the thing the quoted sentence says. Then it moves on.",
              band: "easy",
              value: 4,
              evidence: [{ blockId: block.id, quote: block.text.slice(0, 60) }],
            },
          ],
        }),
      ];
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
  const result = await STEPS[stage].run(ctx, fixture.store, nullCheckpointStore());
  const artefact = result.parts?.[stage] as { sourceHash?: string } | undefined;
  /* If the stub ran short, `answers` still holds entries — a silent way for a
     stage to have taken a path this file did not intend. */
  expect(answers).toEqual([]);
  const stamp = await STEPS[stage].stamp?.(ctx, fixture.store);
  return { wrote: artefact?.sourceHash, expected: stamp?.inputHash };
}

/**
 * **No mutation of its own** — the file's only block, and the header's two arms
 * are its evidence: 2 of its 20 cases red when a stage's `sourceHash` drops the
 * metadata, and 2 when the store stops holding any.
 */
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
   * is the images and figures in the blocks and nothing else, so its two hashes
   * are equal across the split by design (`assetsInputHash` in
   * src/collect-assets.ts). Asserting that keeps somebody
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

  /**
   * **And the publication date is in `timeline`'s hash — on both sides.**
   *
   * The fourteen rows above cannot ask this. `example/meta.json` has no
   * `publishedAt`, so both metadata states are undated and `timeline`'s hash
   * differs from `ideas`' only by a domain string. Deleting the date from the
   * head of `datedArticleFingerprint` (src/source-hash.ts) leaves every one of
   * them green — I ran that mutation before writing this, and it did.
   *
   * That is the mutation this stage is most exposed to, because the date is the
   * only thing `timeline` hashes that nothing else does, and it is the thing the
   * output actually turns on: it is the reference frame every year-less
   * expression is read against, so a publisher re-dating a post changes almost
   * every row of the artefact. A hash that ignored it would serve the old rows
   * for ever and call them current.
   *
   * Both halves are asserted, because they fail differently. If only the
   * *writing* side read the date, the artefact would be born stale; if only the
   * *stamping* side did, the step would re-run on every job for ever. Either way
   * the two must still agree with each other, which is the first assertion here.
   */
  it("and the publication date is in timeline's hash, on both sides", async () => {
    const dated = await bothHashes("timeline", datedMeta);
    const undated = await bothHashes("timeline", withMeta);
    expect(dated.wrote, "timeline's two sides disagree on a dated article").toBe(dated.expected);
    expect(dated.wrote, "the artefact's own sourceHash ignores the publication date").not.toBe(
      undated.wrote,
    );
    expect(dated.expected, "timeline's stamp ignores the publication date").not.toBe(
      undated.expected,
    );
  }, 30_000);
});
