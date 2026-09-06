/**
 * The artefact store seam: what a step declares it produces, what a real
 * artefact of each kind has to look like, and when a step may report itself
 * finished.
 *
 * See docs/plans/260826e-postgres-storage-implementation.md § Step 11, half B.
 *
 * ## The one that started red
 *
 * `stepIsDone` decided a step was finished by asking whether its files exist.
 * A `writeFile` killed halfway leaves a file that exists and will not parse, so
 * the step reported itself done, the pipeline skipped it, and the stage after
 * it read half a JSON document — docs/reusable/silent-success.md, exactly. The
 * first block below is that bug, written as a test before it was fixed.
 *
 * **It was red for the steps with no freshness check and green for the three
 * that had one**, and that difference is the whole argument for `has()` asking
 * `whyUnusable` rather than asking whether something is there. `threadIsCurrent`
 * read `tweets.json` itself and answered false when it would not parse, so
 * `tweets` was never exposed; `arc`, `hierarchy`, `extract` and `blocks` had no
 * such function, and were.
 *
 * Written in the past tense since D0, because the accident of protection has
 * gone and the protection has not: `threadIsCurrent` was replaced by a stamp,
 * and `stepIsDone` asks `has()` *before* it computes one. So every step is now
 * covered by the same check rather than a couple of them being covered by a
 * function that happened to parse on its way to asking something else.
 *
 * ## What this file stopped being about on 2026-09-05
 *
 * It was **the filesystem adapter's own surface** — `PATHS`, `pathFor`,
 * `fsLocations`, and a `has()` that parsed bytes — and it read its fixtures out
 * of a `mkdtemp` directory through `createFsArtifactStore`. That store was
 * deleted when Postgres became the only one
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G),
 * and these claims went with it. They are written out because a deleted
 * assertion is invisible to every check we have — **nothing else in the
 * repository holds any of them**, and the last two are the ones to weigh:
 *
 * - **`produces` agrees with `outputs`, step for step, in order** — including
 *   the meta-test that swapped two of `PATHS.extract`'s destinations and watched
 *   the comparison notice. `PipelineStep.outputs` was deleted in the same stage,
 *   so there is no second list left to disagree with the first. *Vacuous now.*
 * - **`PATHS` has a path for every kind any step declares, and no orphans**, and
 *   **the two `blocks.json` are kept apart while the two HTMLs are one file**,
 *   and **each kind lands where the real article's file actually is.** The
 *   successor table is `LAYOUT` in tests/helpers/fixture-artefacts.ts, which
 *   describes the committed corpus rather than the pipeline, and **no test
 *   asserts any of the three of it.** A wrong row there makes a step's artefacts
 *   unreadable, which nine suites notice by name — but only for the seventeen
 *   rows the corpus populates. *A real gap, cheap to close.*
 * - **A corrupt artefact never reaches a log line**, proved through the
 *   filesystem decoder's own `JSON.parse` — and **a store answers `null` for
 *   text it could not parse.** Nothing decodes text into an artefact any more:
 *   a JSONB column cannot be half-written and a `Map` holds a value, so both
 *   claims are about a thing that no longer exists. The general guard survives
 *   below — `parseJsonFrom` names the breakage without quoting it.
 * - **The per-kind size ceiling** (`DECODERS`, 4 to 32 MiB). Postgres has none
 *   and `whyUnusable` is shape only; the one remaining bound is `MAX_BYTES` in
 *   tests/helpers/fixture-artefacts.ts, which guards the fixture reader.
 * - **Two cases about the ids in the HTML** — see the block called *blocks is
 *   only done if the HTML really carries its ids*, which explains at length why
 *   they were the aliasing rather than the rule, and why porting them would have
 *   turned two red-able cases into two that assert the opposite of the truth.
 *
 * Everything else is here, on `memoryArtefacts()` — a store that keeps
 * `extractedHtml` and `stampedHtml` apart the way Postgres does.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CAPABLE_MODEL, modelFor } from "../src/models.js";
import { ASSETS_VERSION } from "../src/collect-assets.js";
import {
  inputFingerprint as arcFingerprint,
  PROMPT_VERSION as ARC_VERSION,
} from "../src/arc.js";
import { PROMPT_VERSION as GLOSSARY_VERSION } from "../src/glossary.js";
import {
  inputFingerprint as ideasFingerprint,
  PROMPT_VERSION as IDEAS_VERSION,
} from "../src/ideas.js";
import {
  inputFingerprint as sketchFingerprint,
  PROMPT_VERSION as SKETCH_VERSION,
} from "../src/sketch.js";
import {
  inputFingerprint as illustratedFingerprint,
  PROMPT_VERSION as ILLUSTRATED_VERSION,
} from "../src/illustrated.js";
import type { Sketch } from "../src/sketch-scene.js";
import {
  inputFingerprint as timelineFingerprint,
  PROMPT_VERSION as TIMELINE_VERSION,
} from "../src/timeline.js";
import {
  inputFingerprint as quizFingerprint,
  PROMPT_VERSION as QUIZ_VERSION,
} from "../src/quiz.js";
import {
  inputFingerprint as debateFingerprint,
  PROMPT_VERSION as DEBATE_VERSION,
} from "../src/debate.js";
import { PROMPT_VERSION as QUOTES_VERSION } from "../src/quotes.js";
import { PROMPT_VERSION as TWEETS_VERSION } from "../src/tweets.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { STEP_ORDER, STEPS, stepIsDone } from "../src/pipeline.js";
import {
  articleFingerprint,
  articleWithIdsFingerprint,
  hashBlocks,
  structureHash,
} from "../src/source-hash.js";
import { parseJsonFrom } from "../src/parse-json.js";
import { articleText, articleWithIds } from "../src/article-prompt.js";
import { metaRawSha256, sameStamp } from "../src/store/artifacts.js";
import type { ArtifactKind, ArtifactMap, ArtifactReads } from "../src/store/artifacts.js";
import type { StepContext } from "../src/pipeline.js";
import type { Block, Meta, StepName, Tree } from "../src/types.js";
import { memoryArtefacts, type MemoryArtifactStore } from "./helpers/memory-artefacts.js";
import { fixturePath, requireFixture } from "./helpers/require-fixture.js";

const SLUG = "test-artifact-store";

/**
 * **The article this whole file is built on, and stage 3 really run over it.**
 *
 * Every block, every id and the stamped document below come out of
 * `splitIntoBlocks` rather than being written by hand. They were literals until
 * 2026-08-31, and that was a fixture asserting a pair *I* had decided was
 * healthy: `blocks`'s freshness check now re-derives the blocks and the
 * document and compares both exactly, so a hand-built pair fails it for reasons
 * that have nothing to do with what each test is about.
 *
 * **The ids are seeded into the source on purpose.** Stage 3 reuses a
 * Spideryarn-shaped id it finds in the document, so writing them here makes the
 * whole fixture deterministic while still going through the real splitter —
 * `mintUniqueId` is random, and a fixture whose ids move on every run cannot
 * carry a stamp.
 */
const SOURCE_HTML =
  '<article><h1 id="spya-aaaaaa">A title</h1>' +
  '<p id="spya-bbbbbb">One paragraph of something to hash.</p></article>';

/* `[]` rather than an omitted argument: one argument to `splitIntoBlocks` means
   "mint everything", which tests/blocks-baseline.test.ts refuses in `src/` and
   which would make the ids above pointless here. An empty baseline is the
   honest statement — there is no previous run, and the ids come from the
   document. */
const STAGE_THREE = splitIntoBlocks(SOURCE_HTML, []);

const BLOCKS: Block[] = STAGE_THREE.blocks;
const HEAD = BLOCKS[0]!;
const BODY = BLOCKS[1]!;

/** The article HTML **after stage 3 has stamped the ids into it**. */
const STAMPED_HTML = STAGE_THREE.html;

/* **`UNSTAMPED_HTML` stood here until 2026-09-05** — the same prose with none
   of the ids, which is what a re-extraction leaves. Its two readers were the
   two cases the filesystem's aliasing was holding up; see the block called
   *blocks is only done if the HTML really carries its ids* for what happened to
   them, and to the claim. */

const SOURCE_HASH = hashBlocks(BLOCKS);

/**
 * Hoisted out of `writeWholeArticle` so `IDEAS_SOURCE_HASH` below can hash the
 * same object the fixture writes. Two copies of "the tree" here would let the
 * fingerprint and the file disagree, which is the one way this fixture could
 * report a step not-done for a reason that has nothing to do with the step.
 */
const TREE = {
  version: "toc/2",
  generator: CAPABLE_MODEL,
  slug: SLUG,
  rootId: "n0000",
  nodes: {
    n0000: {
      id: "n0000",
      parent: null,
      range: [HEAD.id, BODY.id],
      title: "A title",
      gist: "A gist.",
      children: [],
    },
  },
} as unknown as Tree;

/**
 * Hoisted for the reason `TREE` is, and the reason bites harder here: every
 * article-reading stage's fingerprint covers the metadata (src/source-hash.ts §
 * `articleFingerprint`), so a second copy of "the meta the fixture writes"
 * would let the hash and the file disagree and report a step not-done for a
 * reason that has nothing to do with the step.
 *
 * **Declared above the hashes rather than below them.** It used to sit under
 * them, which was fine while only `ARC_SOURCE_HASH` read it and stopped being
 * fine the moment the other five did: a `const` read before its declaration is
 * a runtime throw, not an `undefined`.
 */
const META = { slug: SLUG, title: "A title" };

/**
 * Blocks, tree **and** metadata — `articleFingerprint` in src/source-hash.ts,
 * which is what every article-reading stage stamps since 2026-08-31.
 *
 * Computed through each stage's **own** exported function rather than once
 * through the shared one. They agree today; a fixture that assumed they always
 * would is a fixture that goes green on the day one of them stops.
 */
const IDEAS_SOURCE_HASH = ideasFingerprint(BLOCKS, TREE, META);
const SKETCH_SOURCE_HASH = sketchFingerprint(BLOCKS, TREE, META);
/* `quiz` uses the same `articleWithIdsFingerprint` as `ideas` and `sketch`, so
   this is the same number — computed through its own module all the same,
   because the day the two stop agreeing is the day a shared constant would hide
   it. */
const QUIZ_SOURCE_HASH = quizFingerprint(BLOCKS, TREE, META);
/* `debate` uses the same `articleWithIdsFingerprint` again — pass B sends
   `articleWithIds` — so this is the same number a fourth time, and computed
   through its own module for the same reason. */
const DEBATE_SOURCE_HASH = debateFingerprint(BLOCKS, TREE, META);
const ARC_SOURCE_HASH = arcFingerprint(BLOCKS, TREE, META);
/* **The one that is not `articleFingerprint` underneath.** `timeline` stamps
   `datedArticleFingerprint` — the blocks, the tree and a head that carries
   `publishedAt` — because the publication date is the frame its year-less dates
   are read against. `META` here has no date, which is the state most of the
   shelf is in and the one that has to work: the fingerprint hashes an absent
   date as a legitimate input rather than as no input at all, so this matches
   what the stage's `stamp` computes off the same file. */
const TIMELINE_SOURCE_HASH = timelineFingerprint(BLOCKS, TREE, META);
/**
 * What `tweets` and `glossary` stamp. The same three inputs — neither
 * exports a fingerprint function of its own, because neither
 * computed one until the shared definition existed.
 */
const PROSE_SOURCE_HASH = articleFingerprint(BLOCKS, TREE, META);

/**
 * A context naming one article. Nothing here runs, so most of it is the type
 * asking rather than anything being used.
 *
 * **It carried `dir` and `htmlFile` until 2026-09-05**, and that pair was the
 * only reason this file ever had to know where an article's files were: a step
 * is told what it may read by the `ArtifactStore` it is handed, not by a path on
 * its context (src/pipeline.ts § `StepContext`).
 */
function ctxOf(slug: string = SLUG): StepContext {
  return {
    slug,
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * A complete, current article in a store: every step's products, stamped so
 * that the steps with a freshness check pass it.
 *
 * **`plant`, not `write`**, and the distinction is worth a line. `write` runs
 * `assertStampAgrees`, which is a real check with a test of its own below; this
 * is a *fixture writer*, and it has to be able to put an artefact of the wrong
 * shape in so that the cases about unusable artefacts have something to be
 * about. It is the same hatch the old version of this file had by writing
 * bytes to a file behind the store's back — tests/helpers/memory-artefacts.ts
 * § `plant` and `forget`.
 *
 * **The prompt versions are imported, not written out.** They used to be
 * literals here, with the intact-first assertion as the safety net — and that
 * net worked exactly once, on 2026-08-26, when all three versions moved in one
 * afternoon and five tests went red for a reason that had nothing to do with
 * what they test. A net that catches the drift is worse than not having the
 * drift: `tweets.ts` now exports its version the way `glossary.ts` already
 * did.
 */
function writeWholeArticle(store: MemoryArtifactStore): void {
  /* `PROSE_SOURCE_HASH`, not `SOURCE_HASH`: the artefacts built from this
     are `tweets` and `glossary`, whose prompts read the tree and the
     metadata head as well as the blocks. `SOURCE_HASH` — the blocks alone — is
     still what `assets` and `labels` carry, because those two really are
     written from the blocks and nothing else. */
  const stamped = {
    version: "",
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: PROSE_SOURCE_HASH,
  };

  store.plant(SLUG, "fetch", "raw", {
    kind: "html",
    file: "raw.html",
    requestedUrl: "https://example.test/a",
    url: "https://example.test/a",
    contentType: "text/html",
    encoding: "UTF-8",
    bytes: 29,
    sha256: "0".repeat(64),
    fetchedAt: "2026-08-26T00:00:00.000Z",
  });
  /* **Two documents, not one.** On the filesystem store these two names were
     one `output/<slug>.html`, so this fixture wrote it once and both steps read
     it back; here, as in Postgres, they are separate values and a fixture that
     planted only one would leave `blocks` missing half its products.

     `SOURCE_HTML` for stage 2 rather than a second copy of the stamped page,
     because the fixture is stronger for the two being genuinely different
     strings: stage 3 parses and re-serialises, so `STAMPED_HTML` is what the
     splitter makes of `SOURCE_HTML` and never byte-identical to it. A guard
     that confused the two columns is then visible here rather than invisible.
     `blocksMatchTheirHtml` re-derives from stage 2's copy, so what it computes
     is exactly `STAGE_THREE`. */
  store.plant(SLUG, "extract", "extractedHtml", SOURCE_HTML);
  store.plant(SLUG, "blocks", "stampedHtml", STAMPED_HTML);
  store.plant(SLUG, "extract", "meta", META);
  store.plant(SLUG, "blocks", "blocks", { blocks: BLOCKS });
  store.plant(SLUG, "hierarchy", "blocks", { blocks: BLOCKS });
  store.plant(SLUG, "hierarchy", "tree", TREE);
  store.plant(SLUG, "hierarchy", "labels", {
    version: "labels/1",
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: SOURCE_HASH,
    structureHash: "0000000000000000",
    structureVersion: "toc/2",
    labels: { n0000: "A title" },
    batches: null,
  });
  /* **No `generator`**, and that is the shape rather than an omission: this
     step makes no model call, so its `stamp` names only `inputHash` and
     `promptVersion`. Adding a `generator` here would be recorded and never
     compared, which is the quieter half of the same drift. */
  store.plant(SLUG, "assets", "assets", {
    version: ASSETS_VERSION,
    sourceHash: SOURCE_HASH,
    fetchedAt: new Date().toISOString(),
    entries: [],
  });
  store.plant(SLUG, "arc", "arc", {
    version: ARC_VERSION,
    generator: CAPABLE_MODEL,
    slug: SLUG,
    /* Stamped since 2026-08-29. Before that the arc had no input fingerprint at
       all, so this fixture only had to exist to count as done. */
    sourceHash: ARC_SOURCE_HASH,
    entries: [{ range: [HEAD.id, BODY.id], text: "It begins." }],
  });
  store.plant(SLUG, "tweets", "tweets", {
    ...stamped,
    version: TWEETS_VERSION,
    limit: 280,
    tweets: [{ text: "One post.", chars: 9 }],
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  store.plant(SLUG, "glossary", "glossary", {
    ...stamped,
    version: GLOSSARY_VERSION,
    entries: [],
    passes: 1,
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  /* **Not `...stamped`**, and this is the one artefact here that cannot use it.
     `ideas` hashes the blocks AND the tree (src/ideas.ts § inputFingerprint),
     so `SOURCE_HASH` alone would never match what its `stamp` computes and the
     step would report itself not-done however complete the fixture was. It also
     carries a `profileHash`, which is the other half of the same stamp — `null`
     meaning "written deliberately without a profile", which is what a context
     with no profile expects to find. */
  store.plant(SLUG, "ideas", "ideas", {
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: IDEAS_SOURCE_HASH,
    profileHash: null,
    version: IDEAS_VERSION,
    ideas: [],
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  /* **`quotes` arrived on 2026-08-31, from another session's work.** It sends
     `articleText` like the four above it, so it stamps `PROSE_SOURCE_HASH` and
     nothing about it is a special case — which is the point of the rule this
     file holds: a stage added later gets the fingerprint its own prompt head
     implies, and needs no new machinery to say so. `quotes` must be non-empty,
     because `ARTEFACT_SHAPE` in src/store/artifacts.ts refuses a list with
     none. */
  store.plant(SLUG, "quotes", "quotes", {
    ...stamped,
    version: QUOTES_VERSION,
    profileHash: null,
    quotes: [
      {
        id: "spya-qqqqqq",
        blockId: BODY.id,
        text: "One paragraph of something to hash.",
        start: 0,
      },
    ],
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  /* Same two reasons as `ideas` above, and one of its own. The fingerprint is
     the blocks AND the tree, so `...stamped` cannot be used; the `profileHash`
     is `null` for the same "deliberately without a profile" reason; and
     **`scenes` must be non-empty**, because `ARTEFACT_SHAPE` in
     src/store/artifacts.ts refuses a picture with none — a rule that exists at
     the store boundary precisely so a fixture cannot slip past it. */
  /* Same two reasons as `ideas` — its own fingerprint function, and a fixture
     that hashes anything else would report the step not-done however complete
     it is — plus one difference worth stating: **there is no `profileHash`**,
     because this stage was never written for a profile, and an artefact
     carrying one would be recording a field its `stamp` never compares.

     `events` is deliberately EMPTY, unlike `quotes` and `sketch` below. Most
     articles have no chronology, so an empty timeline is the expected answer for
     them and `SHAPE.timeline` in src/store/artifacts.ts accepts it — this
     fixture is what holds that decision to being true on both sides. */
  store.plant(SLUG, "timeline", "timeline", {
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: TIMELINE_SOURCE_HASH,
    version: TIMELINE_VERSION,
    events: [],
    orderConflicts: 0,
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  /* Same two reasons as `ideas` — its own fingerprint function, and no
     `profileHash`, because this stage was never written for one — plus a third
     that is `quotes`' and `sketch`'s rather than `timeline`'s: **`questions`
     must be non-empty**, because `SHAPE.quiz` in src/store/artifacts.ts refuses
     a quiz with none. An empty quiz is indistinguishable from a working one
     until a reader opens the panel, which is why that rule lives at the store
     boundary where a fixture cannot slip past it.

     `batchId` is here because it is a field on the artefact from the start —
     the mark route binds to it — and not because anything in this file reads
     it. */
  store.plant(SLUG, "quiz", "quiz", {
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: QUIZ_SOURCE_HASH,
    version: QUIZ_VERSION,
    batchId: "spya-bbbbbb",
    questions: [
      {
        id: "spya-zzzzzz",
        question: "What does the paragraph say?",
        referenceAnswer: "It says one thing. Then it stops.",
        evidence: [{ blockId: BODY.id, quote: "One paragraph", start: 0 }],
        band: "easy",
        value: 3,
      },
    ],
    dropped: {
      unknownIds: 0,
      unquoted: 0,
      truncated: 0,
      overCap: 0,
      malformed: 0,
      duplicate: 0,
      unanchored: 0,
    },
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  store.plant(SLUG, "sketch", "sketch", SKETCH);
  /* **The one artefact here whose fingerprint is not the article's**, and the
     fixture has to say so or it says nothing. `illustrated` hashes the *Sketch*
     — src/illustrated.ts § `inputFingerprint` — so `SKETCH` above is written
     first and this is stamped against exactly those bytes. `profileHash` is
     `null` because it is INHERITED from that Sketch, which is `null` too; a
     fixture that took the context's profile instead would report the step
     not-done however complete it was.

     `plates` must be non-empty, because `SHAPE.illustrated` in
     src/store/artifacts.ts refuses a set of pictures with no pictures in it —
     the same rule `quotes`, `quiz` and `sketch` meet above. The plate carries
     no `image`: a plate whose call failed is still a plate, and the store must
     accept the artefact a partly-failed run writes. */
  store.plant(SLUG, "illustrated", "illustrated", {
    generator: CAPABLE_MODEL,
    illustrator: "openai/gpt-image-2",
    slug: SLUG,
    sourceHash: illustratedFingerprint(SKETCH),
    profileHash: null,
    version: ILLUSTRATED_VERSION,
    style: "An illuminated page.",
    plates: [
      {
        sceneId: "overview",
        title: "Overview",
        prompt: "One vellum page, top to bottom.",
        vignettes: [],
        failed: "the images endpoint answered with no picture in it",
      },
    ],
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  /* `ideas`' two reasons again — its own fingerprint function, and no
     `profileHash` because this stage was never written for one — plus three
     things of its own worth stating, because all three are decisions rather
     than the shape of a fixture.

     **Both groups are EMPTY**, like `timeline`'s events and unlike `quotes`,
     `quiz`, `sketch` and `illustrated`. Most pieces have no critical reception
     at all, so an artefact that honestly says so is the commonest correct
     answer — `SHAPE.debate` in src/store/artifacts.ts accepts it, and this
     fixture is what holds that decision to being true on both sides.

     **`generator` is `modelFor("debate")`, not `CAPABLE_MODEL`.** Every other
     artefact here stamps the constant; this is the one stage on the chat wire,
     where `SPIDERYARN_DEBATE_MODEL` can override the model, and its `stamp`
     resolves the same way. A `CAPABLE_MODEL` here would report the step
     not-done on any machine with that variable set.

     **`searchedAt` and no `generatedAt`** — the two would be one instant
     written twice, so this artefact carries the one that means something to a
     reader. */
  store.plant(SLUG, "debate", "debate", {
    generator: modelFor("debate"),
    slug: SLUG,
    sourceHash: DEBATE_SOURCE_HASH,
    version: DEBATE_VERSION,
    searchedAt: new Date().toISOString(),
    direct: { rows: [], counts: EMPTY_DEBATE_COUNTS },
    claims: { rows: [], counts: EMPTY_DEBATE_COUNTS },
    elapsedMs: 1,
  });
}

/** One group's counts for a pass that ran, found pages, and kept no row from them. */
const EMPTY_DEBATE_COUNTS = {
  returnedSources: 0,
  reportedRows: 0,
  keptRows: 0,
  omittedOverCap: 0,
  lost: {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
  },
  webSearches: 3,
};

/**
 * The Sketch this fixture writes — a `const` rather than an object literal at
 * the call site, because the illustration above is stamped against **these
 * bytes** and a second copy would drift from them silently.
 */
const SKETCH = {
  generator: CAPABLE_MODEL,
  slug: SLUG,
  sourceHash: SKETCH_SOURCE_HASH,
  profileHash: null,
  version: SKETCH_VERSION,
  title: "A picture",
  caption: "What it claims.",
  scenes: [{ id: "overview", title: "Overview", height: 400, items: [] }],
  generatedAt: new Date().toISOString(),
  elapsedMs: 1,
} as unknown as Sketch;

/**
 * An artefact of the right kind that is not a usable one, for each kind a case
 * below needs to break.
 *
 * **The successor to `halve`**, which chopped a file in two the way a killed
 * process does. That was the filesystem's own way of producing an unusable
 * artefact and it went with the filesystem store; the *state* it produced is
 * the one that matters and both remaining stores can be in it. In Postgres a
 * JSONB column cannot be half-written, so `unusable` there means a value of
 * entirely the wrong shape — src/store/artifacts.ts § `ArtifactOutcome`, which
 * says the two states differ in what can corrupt them rather than in the rule.
 *
 * Each value below is refused by `SHAPE` for that kind, so `whyUnusable` names
 * a field and `has` answers false.
 */
const BROKEN: Partial<Record<ArtifactKind, unknown>> = {
  meta: { slug: 42 },
  blocks: { blocks: "not a list" },
  tree: { nodes: [] },
  labels: { labels: [] },
  arc: { entries: {} },
  tweets: { tweets: {} },
  glossary: { entries: {} },
};

describe("an artefact that cannot be used must not report its step finished", () => {
  const store = memoryArtefacts();

  /* One case per step whose product is a JSON document. `fetch` and the two
     HTML kinds are not here, and that is the same exclusion this block opened
     with when the corruption was truncation: an HTML artefact is text, any text
     is a usable one, and there is no shape to be wrong. */
  const cases: { step: StepName; kind: ArtifactKind }[] = [
    { step: "extract", kind: "meta" },
    { step: "blocks", kind: "blocks" },
    { step: "hierarchy", kind: "tree" },
    { step: "hierarchy", kind: "labels" },
    { step: "arc", kind: "arc" },
    { step: "tweets", kind: "tweets" },
    { step: "glossary", kind: "glossary" },
  ];

  for (const { step, kind } of cases) {
    it(`${step}: an unusable ${kind}`, async () => {
      // Intact first. If this fails, the fixture is wrong — most likely a
      // prompt version moved — and the real assertion below would then pass
      // for a reason that has nothing to do with the broken artefact.
      writeWholeArticle(store);
      expect(await stepIsDone(STEPS[step], ctxOf(), store)).toBe(true);

      store.plant(SLUG, step, kind, BROKEN[kind]);
      expect(await stepIsDone(STEPS[step], ctxOf(), store)).toBe(false);
    });
  }
});

/**
 * **`PATHS`, `pathFor`, `fsLocations` and `PipelineStep.outputs` stood here
 * until 2026-09-05**, in a block called *what a step says it produces, and
 * where that lands*. Its four cases are named in this file's header, with what
 * each asserted and where — for two of them, nowhere — the claim lives now.
 */

describe("a real artefact of every kind goes into a store and comes back", () => {
  const scratch = `${SLUG}-roundtrip`;
  const store = memoryArtefacts();

  /**
   * Against real artefacts, not invented ones.
   *
   * An invented fixture round-trips whatever shape the test author had in mind,
   * which is the shape `SHAPE` was written for. Real artefacts are the only
   * ones that can catch a rule that is right about an imagined artefact and
   * wrong about the one a stage actually writes.
   *
   * **Out of the committed corpus since 2026-09-05, not out of `data/`.** These
   * paths were `data/writes/…` under the repository root — a directory that is
   * gitignored, so every article in it is whatever the person running the suite
   * happens to have read. docs/postmortems/260902c-a-test-whose-evidence-was-one-laptop.md
   * is that failure, and tests/fixtures/data-root/ is the answer to it.
   */
  const REAL: { step: StepName; kind: ArtifactKind; from: string; part: string }[] = [
    { step: "fetch", kind: "raw", from: "writes", part: "raw.json" },
    { step: "extract", kind: "meta", from: "writes", part: "meta.json" },
    { step: "extract", kind: "extractedHtml", from: "writes", part: "output.html" },
    { step: "blocks", kind: "blocks", from: "writes", part: "output.blocks.json" },
    { step: "blocks", kind: "stampedHtml", from: "writes", part: "output.html" },
    { step: "hierarchy", kind: "blocks", from: "writes", part: "blocks.json" },
    { step: "hierarchy", kind: "tree", from: "writes", part: "tree.json" },
    {
      step: "hierarchy",
      kind: "labels",
      from: "noema-mythology-of-conscious-ai",
      part: "labels.json",
    },
    { step: "arc", kind: "arc", from: "writes", part: "arc.json" },
    { step: "tweets", kind: "tweets", from: "writes", part: "tweets.json" },
    { step: "glossary", kind: "glossary", from: "writes", part: "glossary.json" },
  ];

  /* Loudly, at registration, rather than as eleven confusing failures inside
     the cases — tests/helpers/require-fixture.ts says why this throws where
     `pgReady` skips. */
  for (const { from, part } of REAL) requireFixture(from, [part]);

  for (const { step, kind, from, part } of REAL) {
    it(`${step}/${kind}`, async () => {
      const raw = await readFile(fixturePath(from, part), "utf-8");
      const isText = kind === "extractedHtml" || kind === "stampedHtml";
      const value: unknown = isText ? raw : JSON.parse(raw);

      // The stamp the artefact already carries, so `write`'s consistency check
      // has something true to agree with.
      const carried = value as { sourceHash?: string; version?: string; generator?: string };
      await store.write(
        scratch,
        step,
        { [kind]: value },
        {
          ...(carried?.sourceHash ? { inputHash: carried.sourceHash } : {}),
          ...(carried?.version ? { promptVersion: carried.version } : {}),
          ...(carried?.generator ? { model: carried.generator } : {}),
        },
      );

      expect(await store.read(scratch, step, kind)).toEqual(value);
      expect(await store.has(scratch, step, [kind])).toBe(true);
    });
  }

  it("refuses a stamp that contradicts the artefact it is writing", async () => {
    const arc: unknown = JSON.parse(await readFile(fixturePath("writes", "arc.json"), "utf-8"));
    await expect(
      store.write(scratch, "arc", { arc: arc as never }, { promptVersion: "arc/999" }),
    ).rejects.toThrow(/disagrees with the arc itself/);
  });

  it("reads a stamp back off the artefact, and only for steps that carry one", async () => {
    const tweets: unknown = JSON.parse(
      await readFile(fixturePath("writes", "tweets.json"), "utf-8"),
    );
    const t = tweets as { sourceHash: string; version: string; generator: string };
    await store.write(scratch, "tweets", { tweets: tweets as never }, {});

    expect(await store.stampFor(scratch, "tweets")).toEqual({
      inputHash: t.sourceHash,
      promptVersion: t.version,
      model: t.generator,
    });
    // fetch, extract and blocks record nothing about what they were made from.
    expect(await store.stampFor(scratch, "fetch")).toBeNull();
    expect(await store.stampFor(scratch, "blocks")).toBeNull();
  });

  /**
   * **A case called *answers null for everything unhappy, and not-done with it*
   * stood here until 2026-09-05**, and it had two arms.
   *
   * The first wrote `{ not json` over the glossary file: a store that could not
   * parse what it held answered `null` rather than throwing. That arm has no
   * subject any more — a JSONB column cannot be half-written and a `Map` holds
   * a value rather than bytes — so no store parses text and none can fail to.
   *
   * The second wrote `{"nope":1}`: **valid JSON of entirely the wrong shape**,
   * which a bare parse would accept. That arm is the shared `SHAPE` rule, it is
   * very much alive, and the last block in this file is six cases of it.
   */
});

describe("the raw artefact is a manifest, and the type has to say so", () => {
  /**
   * **The cast that was there until 2026-08-27, and why nothing caught it.**
   *
   * `ArtifactMap.raw` was declared `string`. The artefact is a `RawManifest`
   * object — `SHAPE.raw` checks its `file` with `isString` — so
   * `read(slug, "fetch", "raw")` handed back an object cast to `string`, whose
   * `.length` is `undefined` and whose `.slice()` throws. Nothing had noticed
   * because `read` had no production caller yet: the stages all opened paths.
   *
   * This is a **compile-time** test as much as a runtime one. `manifest.file`
   * does not typecheck against `string`, so the declaration cannot quietly go
   * back to what it was without this file going red — which is the only kind of
   * guard that works on a type nobody calls.
   */
  const store = memoryArtefacts();

  it("comes back with its fields, not as a string", async () => {
    store.plant("raw-shape", "fetch", "raw", {
      kind: "html",
      file: "raw.html",
      requestedUrl: "https://example.test/a",
      url: "https://example.test/a",
      contentType: "text/html",
      encoding: "UTF-8",
      bytes: 29,
      sha256: "0".repeat(64),
      fetchedAt: "2026-08-26T00:00:00.000Z",
    });
    const manifest = await store.read("raw-shape", "fetch", "raw");
    expect(manifest).not.toBeNull();
    // Each of these is a type error if `raw` goes back to `string`.
    expect(manifest?.file).toBe("raw.html");
    expect(manifest?.kind).toBe("html");
    expect(manifest?.bytes).toBe(29);
    expect(manifest?.url).toBe("https://example.test/a");
  });

  it("names a document rather than carrying it", () => {
    /* Said in a test because it is the thing a reader of the type would assume
       and be wrong about: a `raw` artefact is a *manifest*, and the bytes are
       somewhere else. When this was written that somewhere was
       `article_revisions.raw_bytes`, which the manifest could not fill, so no
       Postgres adapter could be written against it
       (docs/plans/260827j-transactional-stage-runner.md § B). It is a
       content-addressed object in the `sources` bucket now, and the manifest
       names it by `storedSha256` — which is exactly why
       src/store/artifacts-pg.ts refuses a manifest without one
       (`NoStoredDocument`) rather than recording a fetch with no document
       behind it. The column was dropped on 2026-09-01. */
    const manifest: ArtifactMap["raw"] = {
      kind: "html",
      file: "raw.html",
      contentType: null,
      encoding: null,
      bytes: 29,
      sha256: null,
      fetchedAt: "2026-08-26T00:00:00.000Z",
    };
    expect(Object.keys(manifest)).not.toContain("payload");
    expect(manifest.file).toBe("raw.html");
  });
});

describe("sameStamp", () => {
  it("compares only what the caller declared", () => {
    const recorded = { inputHash: "abc", promptVersion: "v1", model: "m" };
    expect(sameStamp(recorded, { inputHash: "abc" })).toBe(true);
    expect(sameStamp(recorded, { inputHash: "xyz" })).toBe(false);
    expect(sameStamp(recorded, { inputHash: "abc", model: "other" })).toBe(false);
  });

  /* The rule that stops "nobody checked anything" reading as "current". Two
     all-undefined stamps are trivially equal field by field, and an artefact
     with no stamp — an arc, a tree — would then report itself fresh for ever. */
  it("says no when there is nothing to compare", () => {
    expect(sameStamp({ inputHash: "abc" }, {})).toBe(false);
    expect(sameStamp(null, { inputHash: "abc" })).toBe(false);
  });
});

/**
 * **The web page with a hash, which is the whole bug.**
 *
 * `article_revisions.raw_sha256` is stage 1's hash of whatever it fetched and
 * an HTML page has one; `Meta.rawSha256` is PDFs only (src/types.ts). All three
 * places that rebuild a `Meta` from columns read the column straight through,
 * so every HTML article came back carrying a PDF field — through
 * `pgArticleReader.loadArticle`, through `readMeta`, and into the `meta.json`
 * that `db:export` writes to disk.
 *
 * **Written here, and not left to the two corpus tests that caught it.**
 * tests/store-parity.test.ts and tests/store-roundtrip.test.ts only went red
 * because one article in the gitignored `data/` happened to be an HTML page
 * fetched after the raw manifest landed — the first one ever, on 2026-08-28.
 * Every other fixture with a hash is a PDF, where the field belongs. Delete
 * that one directory and the bug is silent again, so the case that decides it
 * should not depend on which articles somebody has on their laptop.
 */
describe("metaRawSha256", () => {
  it("keeps the hash for a PDF and withholds it from a web page", () => {
    const hash = "65c45ef7b1bbe4016f42724f4a11d24806fd276db8dbd95e13b116b53927f76f";
    /* The two rows differ in `source` and in nothing else — that is the field
       the rule arbitrates, so a fixture that varied the hash too could pass
       with the condition inverted. */
    expect(metaRawSha256({ source: "pdf", rawSha256: hash })).toBe(hash);
    expect(metaRawSha256({ source: null, rawSha256: hash })).toBe(null);
  });

  /* A PDF whose stage 1 recorded no hash still has no hash. The `?? null` this
     replaces was never the part that was wrong. */
  it("has nothing to give when the column is null", () => {
    expect(metaRawSha256({ source: "pdf", rawSha256: null })).toBe(null);
    expect(metaRawSha256({ source: null, rawSha256: null })).toBe(null);
  });
});

/**
 * `glossary` is the first step whose freshness goes through `stamp` +
 * `sameStamp` rather than through a `…IsCurrent` function of its own, so these
 * were `glossaryIsCurrent`'s own conditions, and since that function was deleted
 * on 2026-08-28 this is now the only place they are asserted at all.
 *
 * Worth writing out rather than trusting: the mechanism is new, and a `stamp` that
 * answered "current" too readily would show up as a stale glossary served for
 * ever — while one that answered too rarely would show up only on the bill.
 */
describe("glossary currency, through the stamp rather than a function", () => {
  const slug = `${SLUG}-stamp`;
  const store = memoryArtefacts();

  const glossaryOf = (over: Record<string, unknown>) => ({
    version: GLOSSARY_VERSION,
    generator: CAPABLE_MODEL,
    slug,
    sourceHash: PROSE_SOURCE_HASH,
    entries: [],
    passes: 1,
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
    ...over,
  });

  /* The tree and the metadata beside the blocks, because the stamp reads all
     three: this prompt is built from `partsOf(tree)` and carries the metadata
     head. Planted on every call rather than once up front, so a case can move
     any of the three. src/source-hash.ts § `articleFingerprint`. */
  function ask(
    glossary: Record<string, unknown>,
    blocks: Block[] | null,
    over: { tree?: Tree; meta?: unknown } = {},
  ): Promise<boolean> {
    store.plant(slug, "glossary", "glossary", glossary);
    store.plant(slug, "hierarchy", "tree", over.tree ?? TREE);
    store.plant(slug, "extract", "meta", over.meta ?? META);
    /* `forget` is what `rm` on the file was — tests/helpers/memory-artefacts.ts
       § the escape hatches. The *absent* case is what the last-but-one test
       below is about, and there is no other way to reach it. */
    if (blocks) store.plant(slug, "hierarchy", "blocks", { blocks });
    else store.forget(slug, "hierarchy", "blocks");
    return stepIsDone(STEPS.glossary, ctxOf(slug), store);
  }

  it("says done when the blocks, the prompt and the model all still match", async () => {
    expect(await ask(glossaryOf({}), BLOCKS)).toBe(true);
  });

  it("says not-done when the article has moved underneath it", async () => {
    const changed: Block[] = [HEAD, { ...BODY, text: "Rewritten since." }];
    expect(await ask(glossaryOf({}), changed)).toBe(false);
  });

  /* The two halves of the fingerprint this step gained on 2026-08-31. Both were
     green — wrongly — while the stamp hashed the blocks alone.
     docs/plans/260831b-finish-the-database-move.md § stage 1. */
  it("says not-done when the sections have been re-cut", async () => {
    const recut = {
      ...TREE,
      nodes: { n0000: { ...TREE.nodes.n0000!, gist: "A different gist." } },
    } as Tree;
    expect(await ask(glossaryOf({}), BLOCKS, { tree: recut })).toBe(false);
  });

  it("says not-done when the article has been renamed", async () => {
    expect(await ask(glossaryOf({}), BLOCKS, { meta: { ...META, title: "Renamed" } })).toBe(false);
  });

  it("says not-done when the prompt or the model has moved", async () => {
    expect(await ask(glossaryOf({ version: "glossary/1" }), BLOCKS)).toBe(false);
    expect(await ask(glossaryOf({ generator: "some-older-model" }), BLOCKS)).toBe(false);
  });

  /* "We cannot tell" and "it is stale" both answer not-done, and they must:
     the alternative is a glossary that reports itself current because the
     blocks it would have been checked against are missing. */
  it("says not-done when there are no blocks to check against", async () => {
    expect(await ask(glossaryOf({}), null)).toBe(false);
  });

  it("says not-done when the glossary carries no stamp at all", async () => {
    expect(await ask({ entries: [], passes: 1 }, BLOCKS)).toBe(false);
  });
});

describe("text that will not parse does not put the article in a log line", () => {
  /* The bug, and it was the filesystem store's. Its decoder used a bare
     `JSON.parse`, and `read`'s catch logged the thrown message. V8 puts the
     first characters of the offending input into a SyntaxError — `Unexpected
     token 'S', "SECRET art"... is not valid JSON` — so a half-written artefact
     put article prose into a debug log, which docs/project/logging.md forbids
     outright.

     The same shape as the seven OpenRouter sites and the six Anthropic ones,
     arriving by a route nobody had looked down: not a provider talking, but our
     own file coming back malformed. Found by review, 2026-08-26.

     **The store-shaped half of this block went with that store on 2026-09-05.**
     It planted article prose in place of a `blocks.json`, proved that V8 really
     does quote such input, and then asserted the store's own read surfaced
     nothing. Nothing decodes text into an artefact any more — Postgres hands
     back a decoded JSONB value — so there is no longer a store that could leak
     one. What is left is the general guard, below: `parseJsonFrom` is still the
     shared way this codebase turns text into JSON, and it still must not quote
     what it could not read. */

  /** A sentence that would be unmistakable if it ever reached a message. */
  const PROSE = "Consciousness is not a spreadsheet and never was";

  it("describes the breakage without quoting it", () => {
    /* **The hazard proved real before the guard is trusted**, which is the half
       this case inherited from the one that stood beside it. V8 only quotes the
       input when the text does not begin as JSON: a string truncated mid-value
       gives "Unterminated string in JSON at position 70", which names no content
       at all, so a test built on *that* corruption is green whether or not the
       bug exists. This prose is the corruption that does leak, and if V8 ever
       stops leaking it the assertion below should fail loudly rather than pass
       for nothing. */
    let raw = "";
    try {
      JSON.parse(PROSE);
    } catch (err) {
      raw = (err as Error).message;
    }
    expect(raw, "a bare JSON.parse no longer quotes its input").toContain("Consciousn");

    // parseJsonFrom is the shared parse. Its message says how the text
    // failed — empty, cut off, breaks at position N — and never what it said.
    let message = "";
    try {
      parseJsonFrom(PROSE, "an artefact");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("Consciousness");
    expect(message).not.toContain("spreadsheet");
    expect(message).toMatch(/an artefact/);
  });
});

/**
 * The three criticals a review of this seam found on 2026-08-26, written as
 * tests before they were fixed.
 *
 * See docs/plans/260826e-postgres-storage-implementation.md
 * § What the review of the *built* seam found.
 */
describe("a step that started and did not finish must not report itself done", () => {
  const store = memoryArtefacts();

  /**
   * **The one the review asked for first.** A per-artefact atomic write is not
   * atomicity across a step: leave a complete generation A in the store, let a
   * rerun replace exactly one of the step's products with a perfectly valid
   * generation B and then die, and every artefact is there and usable. Under a
   * presence check the step reports done with A and B mixed, and the stage
   * after it consumes a tree built from blocks nobody has.
   */
  it("catches a generation half-replaced by a run that died", async () => {
    writeWholeArticle(store);
    expect(await stepIsDone(STEPS.hierarchy, ctxOf(), store)).toBe(true);

    const attempt = await store.beginStep(SLUG, "hierarchy");
    // Generation B's tree, valid in every way, landing beside generation A's
    // labels and blocks.
    store.plant(SLUG, "hierarchy", "tree", {
      version: "toc/2",
      generator: CAPABLE_MODEL,
      slug: SLUG,
      rootId: "n0000",
      nodes: {
        n0000: {
          id: "n0000",
          parent: null,
          range: [HEAD.id, BODY.id],
          title: "A different title",
          gist: "A different gist.",
          children: [],
        },
      },
    });
    expect(await stepIsDone(STEPS.hierarchy, ctxOf(), store)).toBe(false);

    /* And the marker is the *only* thing holding it back — clearing it says
       done again, over exactly the mixed generation above.

       That is the honest limit of this mechanism and the reason it is asserted
       rather than left implied: the store is not inspecting the artefacts and
       concluding they disagree, it is being told a run finished. What it buys
       is that nothing tells it that unless a run really did return. A review
       read the first version of this test as claiming more than that, which it
       did. */
    await store.finishStep(SLUG, "hierarchy", attempt);
    expect(await stepIsDone(STEPS.hierarchy, ctxOf(), store)).toBe(true);
  });

  /**
   * The six-step sequence a review took the first version apart with.
   *
   * Two runners, one slug. The second overwrites the first's marker; the first
   * finishes and — in the first version — removed *the second's*; the second
   * then dies half-way through its writes and the step reports done holding two
   * generations with nothing left to say so. The token is what stops step four.
   */
  it("will not let one runner's success clear another runner's attempt", async () => {
    writeWholeArticle(store);

    const first = await store.beginStep(SLUG, "hierarchy");
    const second = await store.beginStep(SLUG, "hierarchy"); // overwrites the marker

    await store.finishStep(SLUG, "hierarchy", first);
    expect(await store.interrupted(SLUG, "hierarchy"), "the second attempt is still live").toBe(
      true,
    );

    await store.finishStep(SLUG, "hierarchy", second);
    expect(await store.interrupted(SLUG, "hierarchy")).toBe(false);
  });

  it("says so for every step, artefacts or no artefacts", async () => {
    writeWholeArticle(store);
    for (const name of STEP_ORDER) {
      expect(await stepIsDone(STEPS[name], ctxOf(), store), `${name} before`).toBe(true);
      const attempt = await store.beginStep(SLUG, name);
      expect(await stepIsDone(STEPS[name], ctxOf(), store), `${name} during`).toBe(false);
      await store.finishStep(SLUG, name, attempt);
      expect(await stepIsDone(STEPS[name], ctxOf(), store), `${name} after`).toBe(true);
    }
  });

  it("finishing a step nobody started is not an error", async () => {
    // Every artefact written before markers existed is in this state, and so is
    // a stage run straight off its own CLI.
    await expect(store.finishStep(SLUG, "arc", "spya-nobody")).resolves.toBeUndefined();
  });
});

/**
 * A stage 3 whose document no longer carries the ids its blocks name is not
 * finished, however complete the article looks. The **binding**, not presence,
 * is what catches it.
 *
 * ## Two of this block's three cases were about the filesystem, and went with it
 *
 * They were *not done once a re-extraction has wiped the ids out of the HTML*
 * and *not done when the HTML carries only some of the ids*, and both worked by
 * replacing `extract/extractedHtml`. On disk that was the same
 * `output/<slug>.html` `blocks/stampedHtml` resolved to, so writing an id-free
 * document there wiped stage 3's stamped page too, and the missing ids gave it
 * away.
 *
 * With the two kept apart — two columns in Postgres, two values here — that
 * state is not stale at all, and **both cases go green in the wrong direction**
 * rather than staying red: `blocksMatchTheirHtml` re-derives with the stored
 * blocks as the baseline, and `splitIntoBlocks` **matches an id-free document
 * against that baseline and carries the old ids over** (measured 2026-09-05:
 * `["spya-aaaaaa","spya-bbbbbb"]` again, and a byte-identical document). That is
 * the carry-forward contract working, not a guard failing —
 * docs/project/block-ids.md — and the block below says so from the other side,
 * in *still done when a re-extraction produced the same article*.
 *
 * So the honest form of the question is asked of the document stage 3 actually
 * wrote, which is what the first case is now.
 */
describe("blocks is only done if the HTML really carries its ids", () => {
  const store = memoryArtefacts();

  /**
   * **And `extract` is untouched, which is why this case is here and not only
   * in the block below.** That block's stub answers `null` for `extract/meta`,
   * so it cannot be asked whether stage 2 is still done — and "one step went
   * stale" is a different and much better answer than "the article did".
   */
  it("not done once stage 3's document has lost an id its blocks name", async () => {
    writeWholeArticle(store);
    expect(await stepIsDone(STEPS.blocks, ctxOf(), store)).toBe(true);

    store.plant(
      SLUG,
      "blocks",
      "stampedHtml",
      STAMPED_HTML.replace(/ id="spya-[a-z0-9]{6}"/g, ""),
    );
    expect(await stepIsDone(STEPS.blocks, ctxOf(), store)).toBe(false);
    // `extract` itself is done — it produced the document it was asked for.
    // Only the step whose own output went bad is not.
    expect(await stepIsDone(STEPS.extract, ctxOf(), store)).toBe(true);
  });

  /**
   * **`every` over nothing is true**, and that is not an answer about the HTML.
   * A blocks artefact listing no ids passed the binding check vacuously, so a
   * stage 3 that produced nothing — a first ingest of a paywall or an error
   * page, where the runtime guard has no baseline to refuse against — reported
   * itself done having retained zero ids, and the stages after it read an
   * article with no blocks in it. GPT Sol, 2026-08-28.
   *
   * **An empty list is a perfectly usable artefact** — `SHAPE.blocks` is
   * `isArray`, deliberately, since the pipeline has to be able to store one —
   * so `has` says true here and the answer below really does come from the
   * binding check rather than from the shape check standing in for it.
   */
  it("not done when the blocks artefact lists no ids at all", async () => {
    writeWholeArticle(store);
    store.plant(SLUG, "blocks", "blocks", { blocks: [] });
    expect(
      await store.has(SLUG, "blocks", ["blocks"]),
      "an empty blocks list must still be a usable artefact, or this proves nothing",
    ).toBe(true);
    expect(await stepIsDone(STEPS.blocks, ctxOf(), store)).toBe(false);
  });

});

/**
 * A step's stamp has to cover **every** input its prompt reads, not just the
 * blocks.
 *
 * `tweets` and `glossary` both read `tree.json` and `meta.json` as
 * well as `blocks.json` and put both into the prompt — the tree as the
 * skeleton, the metadata as the `TITLE:`/`BY:`/`PUBLISHED IN:` head that
 * `articleText` writes (src/article-prompt.ts). `ideas` and `sketch` covered
 * the tree and not the metadata. So the sections could be re-cut, or the
 * article re-extracted under a new headline, and every one of those artefacts
 * went on reporting itself current.
 *
 * Harmless only while the pipeline's reads answer `null` and the stage re-runs
 * regardless. The moment they succeed an incomplete stamp lets a **stale
 * artefact skip** — docs/plans/260831b-finish-the-database-move.md § stage 1,
 * docs/reusable/silent-success.md.
 *
 * **`assets` is in here as the control.** It reads the blocks and nothing else
 * (`collectAssets` takes `blocks`), so it must stay done through both changes —
 * otherwise this test would pass just as well against a stamp that invalidates
 * everything on any change at all.
 */
describe("every stamped step covers everything its prompt reads", () => {
  const store = memoryArtefacts();

  /** Every step whose prompt reads the article's prose, its shape and its head. */
  const PROSE_STEPS: StepName[] = ["arc", "tweets", "glossary", "ideas", "sketch"];

  /**
   * All of them not-done, as one object.
   *
   * **Compared whole rather than asserted in a loop**, because a loop stops at
   * the first failure and the first failure is not the finding — "which of them
   * noticed" is. Run against the fingerprints as they stood on 2026-08-30,
   * a loop reported `tweets` and said nothing about the rest.
   */
  const ALL_STALE = Object.fromEntries(PROSE_STEPS.map((s) => [s, false]));

  async function statesAfter(change: () => void): Promise<Record<string, boolean>> {
    writeWholeArticle(store);
    // Intact first: a fixture that was already not-done would make every
    // assertion below pass for a reason that has nothing to do with the change.
    for (const step of [...PROSE_STEPS, "assets" as StepName]) {
      expect(await stepIsDone(STEPS[step], ctxOf(), store), `${step} before`).toBe(true);
    }
    await change();
    const after: Record<string, boolean> = {};
    for (const step of [...PROSE_STEPS, "assets" as StepName]) {
      after[step] = await stepIsDone(STEPS[step], ctxOf(), store);
    }
    return after;
  }

  /**
   * The sections re-cut with every block byte-identical. `structureHash` covers
   * the titles and the gists as well as the boundaries, because the prompts are
   * built out of them.
   */
  it("not done once the tree has been re-cut underneath them", async () => {
    const after = await statesAfter(() => {
      store.plant(SLUG, "hierarchy", "tree", {
        ...TREE,
        nodes: {
          n0000: { ...(TREE as Tree).nodes.n0000, gist: "A different gist entirely." },
        },
      });
    });
    expect(after).toEqual({ ...ALL_STALE, assets: true });
  });

  /**
   * The extracted title changed. Reachable rather than theoretical: `title`,
   * `byline` and `siteName` are stage 2's reading of the page, so a
   * re-extraction moves them — a publisher editing a headline is enough — and
   * they go straight into the head of every one of these prompts. **Not** the
   * reader's own rename, which is a shelf override no generator reads
   * (src/shelf.ts); an earlier version of this comment said otherwise.
   */
  it("not done once the metadata has changed underneath them", async () => {
    const after = await statesAfter(() => {
      store.plant(SLUG, "extract", "meta", { ...META, title: "Renamed since" });
    });
    expect(after).toEqual({ ...ALL_STALE, assets: true });
  });

  /**
   * **No metadata is an input, not a failure**, and this is the case where the
   * writing side and the checking side can quietly disagree.
   *
   * Every one of these stages tolerates a missing `meta.json` — `generateArc`
   * and `generateTweets` pass `null` down, `generateIdeas` and `generateSketch`
   * render a stub head with the slug in it so the prompt still has a head. The
   * stub is a *prompt* fallback and must stop at the prompt: the stamp asks the
   * store and hashes `null`, so a stage that hashed its stub would write a
   * fingerprint the stamp can never produce, and every article without a
   * `meta.json` would report that stage stale for ever while looking healthy.
   *
   * What this can hold is the checking side: with no metadata in the store, the
   * stamps must equal `articleFingerprint(blocks, tree, null)` — which is
   * what the fixture writes here. It cannot reach inside `generateIdeas`, so
   * the writing half is held by the comment on `onDiskMeta` in src/ideas.ts and
   * src/sketch.ts.
   */
  it("treats an article with no metadata as its own input, not as unknowable", async () => {
    writeWholeArticle(store);
    /* `forget`, which is what `rm` on `meta.json` was — an article the store
       holds no metadata for at all. */
    store.forget(SLUG, "extract", "meta");
    /* **Per head, not one value for all of them.** `ideas` and `sketch`
       synthesise `TITLE: <tree.slug>` rather than omitting the head, so "no
       metadata" is a different input for them than for the ones that simply
       drop it — which is
       the whole of why there are two fingerprint functions. A single value here
       would have hidden that. */
    const noMeta = articleFingerprint(BLOCKS, TREE, null);
    const noMetaWithIds = articleWithIdsFingerprint(BLOCKS, TREE, null);
    expect(noMeta, "the two heads are not the same question").not.toBe(noMetaWithIds);
    for (const [step, kind, hash] of [
      ["arc", "arc", noMeta],
      ["tweets", "tweets", noMeta],
      ["glossary", "glossary", noMeta],
      ["ideas", "ideas", noMetaWithIds],
      ["sketch", "sketch", noMetaWithIds],
    ] as [StepName, ArtifactKind, string][]) {
      const held = (await store.read(SLUG, step, kind)) as Record<string, unknown> | null;
      expect(held, `${step}/${kind} is not in the fixture`).not.toBeNull();
      store.plant(SLUG, step, kind, { ...held, sourceHash: hash });
    }
    const after: Record<string, boolean> = {};
    for (const step of PROSE_STEPS) after[step] = await stepIsDone(STEPS[step], ctxOf(), store);
    expect(after).toEqual(Object.fromEntries(PROSE_STEPS.map((s) => [s, true])));
  });
});

/**
 * **There are two prompt heads in this pipeline, and a fingerprint per head.**
 *
 * `articleText` (arc, tweets, glossary) prints `TITLE:`, `BY:` and
 * `PUBLISHED IN:`. `articleWithIds` (ideas, sketch) prints those three **and a
 * fourth `URL:` line** — and when there is no `meta.json` at all those two
 * stages do not skip the head, they synthesise `TITLE: <tree.slug>` so the
 * model still has one (src/ideas.ts, src/sketch.ts).
 *
 * One fingerprint for all of them missed both of those, so the URL could be
 * rewritten by a redirect, or the article re-slugged with no metadata, and the
 * prompt changed while the hash did not. GPT Sol's probe over `tree.slug`
 * returned `{"hashEqual":true,"promptEqual":false}` — the artefact skipping
 * against a question it was never asked.
 *
 * Each case below asserts the **prompt** moves and the hash moves with it, in
 * that order, so neither half can be true on its own.
 * docs/plans/260831b-finish-the-database-move.md § stage 1.
 */
describe("a fingerprint per prompt head, not one for both", () => {
  const headOf = (meta: Meta): string => articleWithIds(meta, BLOCKS).split("\n\n---\n\n")[0]!;
  const ONE = { ...META, url: "https://one.example/piece" };
  const TWO = { ...META, url: "https://two.example/piece" };

  it("ideas and sketch cover the URL, which their head prints", () => {
    expect(headOf(ONE)).not.toBe(headOf(TWO));
    expect(ideasFingerprint(BLOCKS, TREE, ONE)).not.toBe(ideasFingerprint(BLOCKS, TREE, TWO));
    expect(sketchFingerprint(BLOCKS, TREE, ONE)).not.toBe(sketchFingerprint(BLOCKS, TREE, TWO));
  });

  /**
   * **The synthetic title, which is the half that looks like nothing.** With no
   * metadata these two send `TITLE: <tree.slug>`, and `structureHash` does not
   * hash `tree.slug` — so re-slugging an article with no `meta.json` moved the
   * prompt and nothing else. Sol's exact probe.
   */
  it("ideas and sketch cover the title they fall back to when there is no metadata", () => {
    const other = { ...TREE, slug: "a-different-slug" } as Tree;
    expect(structureHash(TREE), "the tree hash cannot see the slug").toBe(structureHash(other));
    expect(headOf({ title: TREE.slug } as Meta)).not.toBe(headOf({ title: other.slug } as Meta));
    expect(ideasFingerprint(BLOCKS, TREE, null)).not.toBe(ideasFingerprint(BLOCKS, other, null));
    expect(sketchFingerprint(BLOCKS, TREE, null)).not.toBe(sketchFingerprint(BLOCKS, other, null));
  });

  /**
   * **And the other four must NOT cover the URL**, which is the reason there
   * are two functions rather than one widened one. `articleText` never prints
   * it, so folding it in would spend a model call — four of them — on a change
   * the model was never shown.
   */
  it("the articleText stages ignore a URL their head never prints", () => {
    expect(articleText(ONE, BLOCKS)).toBe(articleText(TWO, BLOCKS));
    expect(articleFingerprint(BLOCKS, TREE, ONE)).toBe(articleFingerprint(BLOCKS, TREE, TWO));
    expect(arcFingerprint(BLOCKS, TREE, ONE)).toBe(arcFingerprint(BLOCKS, TREE, TWO));
  });

  /**
   * Those four have no synthetic fallback either — `articleText` takes
   * `Meta | null` and simply omits the head — so "no metadata" stays one
   * distinct input for them rather than becoming a function of the slug.
   */
  it("the articleText stages are unmoved by the slug when there is no metadata", () => {
    const other = { ...TREE, slug: "a-different-slug" } as Tree;
    expect(articleFingerprint(BLOCKS, TREE, null)).toBe(articleFingerprint(BLOCKS, other, null));
  });
});

/**
 * The same question asked of a store that keeps the two HTMLs **apart** — which
 * is what Postgres does (`extracted_html` and `stamped_html` are two columns,
 * src/db/schema.ts) and what the filesystem cannot do.
 *
 * ## Why a stub rather than the real Postgres adapter
 *
 * The thing under test is `blocks`'s freshness rule in src/pipeline.ts, and the
 * only property of a store it depends on is whether `read(…, "extract",
 * "extractedHtml")` and `read(…, "blocks", "stampedHtml")` can differ. A stub
 * says exactly that and needs no database, so this runs in the ordinary suite
 * beside the block above, which asks the same thing of `memoryArtefacts()`.
 *
 * ## What was wrong before
 *
 * `htmlCarriesItsIds` read stage 3's **own** `stampedHtml` and compared it
 * against stage 3's **own** `blocks` — a comparison stage 3 cannot lose. On the
 * filesystem store that happened to work, because both names resolved to one
 * `output/<slug>.html`, so an `extract` that re-ran without
 * ids was visible through the alias. Split into two columns the alias goes and
 * the check returns `true` always: a vacuous guard over
 * docs/project/block-ids.md, arriving exactly when it is needed.
 * docs/plans/260831b-finish-the-database-move.md § stage 1.
 */
describe("blocks is only done if it was built from the HTML the store holds now", () => {
  /**
   * **Stage 3, really run.** Every fixture below is built by the splitter
   * rather than written out by hand, because what is being tested is whether
   * the guard agrees with stage 3 — and a hand-written "healthy pair" is a pair
   * I decided was healthy. The first version of this guard was validated
   * against exactly one real article and was wrong about several others.
   */
  const stage3 = (html: string) => {
    const run = splitIntoBlocks(html);
    return { extractedHtml: html, stampedHtml: run.html, blocks: run.blocks };
  };

  /** Enough of an `ArtifactReads` for `stepIsDone`, with the two HTMLs apart. */
  function twoColumnStore(held: {
    extractedHtml: string;
    stampedHtml: string;
    blocks: Block[];
  }): ArtifactReads {
    const read = (step: StepName, kind: ArtifactKind): unknown => {
      if (step === "extract" && kind === "extractedHtml") return held.extractedHtml;
      if (step === "blocks" && kind === "stampedHtml") return held.stampedHtml;
      if (step === "blocks" && kind === "blocks") return { blocks: held.blocks };
      return null;
    };
    return {
      interrupted: async () => false,
      has: async (_slug, step, kinds) => kinds.every((kind) => read(step, kind) !== null),
      read: (async (_slug: string, step: StepName, kind: ArtifactKind) =>
        read(step, kind)) as ArtifactReads["read"],
      readBaseline: (async () => null) as unknown as ArtifactReads["readBaseline"],
      hasEarlierBlocks: async () => true,
      stampFor: async () => null,
    };
  }

  const ask = (held: Parameters<typeof twoColumnStore>[0]): Promise<boolean> =>
    stepIsDone(STEPS.blocks, ctxOf(), twoColumnStore(held));

  const TWO_PARAGRAPHS = "<article><p>Alpha, the first.</p><p>Beta, the second.</p></article>";

  it("done for a healthy Postgres pair — two columns, one extraction", async () => {
    expect(await ask(stage3(TWO_PARAGRAPHS))).toBe(true);
  });

  /**
   * **The splitter is idempotent**, which is the property, and it outlives the
   * store that made it load-bearing.
   *
   * On the filesystem the two names were one path, so the guard re-derived its
   * candidates from stage 3's *own* output rather than from stage 2's, and that
   * was only sound if `split(split(x).html)` gives the same sequence as
   * `split(x)`. Checked here on a fixture and measured across ten real articles
   * in `output/` (330 to 669 blocks, twice over each): identical every time.
   *
   * The store is gone and the state is still reachable — a page ingested with
   * Spideryarn ids already in it hands stage 2's column a document stage 3 has
   * effectively already stamped — and `writeWholeArticle` above leans on the
   * same property. So the case stays, under the name of the thing it proves.
   */
  it("done when stage 2's document already carries the ids, which the splitter reuses", async () => {
    const run = stage3(TWO_PARAGRAPHS);
    expect(
      await ask({ ...run, extractedHtml: run.stampedHtml }),
    ).toBe(true);
  });

  it("not done once stage 2 has replaced the HTML the blocks came from", async () => {
    expect(
      await ask({
        ...stage3(TWO_PARAGRAPHS),
        extractedHtml: "<article><p>Entirely different prose.</p></article>",
      }),
    ).toBe(false);
  });

  /**
   * **Two paragraphs re-extracted as one.** The words are identical and in the
   * same order, so any comparison of the documents' *text* sees no change at
   * all — while the blocks artefact genuinely has to go from two blocks to one,
   * and every id, comment and highlight on the second paragraph depends on it.
   *
   * Red against the first version of this guard, which compared parsed visible
   * text: GPT Sol ran this exact state through `STEPS.blocks.isDone` and got
   * `{"done":true,"oldBlocks":["Alpha","Beta"],"newBlocks":["AlphaBeta"]}`.
   */
  it("not done once two paragraphs have been re-extracted as one", async () => {
    expect(
      await ask({
        ...stage3(TWO_PARAGRAPHS),
        extractedHtml: "<article><p>Alpha, the first.Beta, the second.</p></article>",
      }),
    ).toBe(false);
  });

  /**
   * **A heading demoted to a paragraph, same words.** The block's `kind` goes
   * from `heading` to `text`, which is what stage 4 builds the whole table of
   * contents out of — and the text of the document does not move by a
   * character. The other half of the same finding.
   */
  it("not done once a heading has become a paragraph", async () => {
    expect(
      await ask({
        ...stage3("<article><h2>The turn</h2><p>Body of it.</p></article>"),
        extractedHtml: "<article><p>The turn</p><p>Body of it.</p></article>",
      }),
    ).toBe(false);
  });

  /**
   * **A link repointed, the words unchanged.** `block.html` is what the reader
   * actually gets rendered, so a changed `href` is a changed artefact even
   * though nothing about the prose moved. Same for `src` and `alt`.
   */
  it("not done once a link in the prose points somewhere else", async () => {
    expect(
      await ask({
        ...stage3('<article><p><a href="https://one.example/">The source</a> says so.</p></article>'),
        extractedHtml:
          '<article><p><a href="https://two.example/">The source</a> says so.</p></article>',
      }),
    ).toBe(false);
  });

  /**
   * **The over-fire, which is the worse half.** Stage 3 sanitises what it is
   * handed (`splitIntoBlocks` in src/blocks.ts), and `FORBID_TAGS` in
   * src/sanitize-policy.ts removes `style` outright — so a healthy stamped HTML
   * legitimately holds less than the extraction it came from.
   *
   * Any comparison that reduces both documents to their text calls that pair
   * **stale**, and under Postgres it can never cure: `extracted_html` stays
   * unsanitised while `stamped_html` stays sanitised, so stage 3 re-runs for
   * ever and never reports itself done. Red against the first version of this
   * guard; GPT Sol found it with `<script>`, and `<style>` is the same rule.
   *
   * The fix is that both sides now go through the sanitiser, because the
   * candidates are derived by the same code stage 3 uses.
   */
  it("still done when the sanitiser legitimately removed something", async () => {
    const withStyle = "<article><style>p{color:red}</style><p>Alpha, the first.</p></article>";
    const run = stage3(withStyle);
    expect(run.blocks.map((b) => b.text)).toEqual(["Alpha, the first."]);
    expect(run.stampedHtml).not.toContain("color:red");
    expect(await ask(run)).toBe(true);
  });

  /**
   * A re-extraction that produced the identical article is not a reason to
   * re-run stage 3. "Not current" has to mean the input moved, not that a
   * command was typed twice.
   */
  it("still done when a re-extraction produced the same article", async () => {
    const run = stage3(TWO_PARAGRAPHS);
    expect(await ask({ ...run, extractedHtml: TWO_PARAGRAPHS })).toBe(true);
  });

  /**
   * **Serialisation is not content.** Stage 3 parses stage 2's string and
   * writes `dom.serialize()` back, so a named entity in the extraction comes
   * back as the character it names and the two columns differ byte for byte.
   * Both sides are re-derived through the same parser, so this is invisible to
   * the comparison — which is the property, not a coincidence.
   */
  it("still done when stage 3's serialiser rewrote the entities", async () => {
    const run = stage3("<article><p>Alpha &middot; Beta &amp; Gamma.</p></article>");
    expect(run.stampedHtml).toContain("·");
    expect(await ask(run)).toBe(true);
  });

  /**
   * **A block id that moved, with every other byte identical.**
   *
   * Stage 3 reuses a Spideryarn-shaped id it finds in the document, so an
   * extraction carrying `spya-bbbbbb` where the stored blocks say `spya-aaaaaa`
   * produces a genuinely different artefact — and orphans every comment,
   * highlight and note anchored to the old one (docs/project/block-ids.md).
   *
   * Red against the version that compared blocks with the ids stripped out:
   * GPT Sol ran this state through the real `STEPS.blocks` guard and got
   * `true`. The ids are in the comparison now, which is what passing the stored
   * blocks as the baseline makes possible — unchanged content comes back
   * carrying the *old* ids, so an exact match is the honest test.
   */
  it("not done once a block's id has moved under it", async () => {
    const stored = stage3('<article><p id="spya-aaaaaa">Alpha, the first.</p></article>');
    expect(stored.blocks.map((b) => b.id)).toEqual(["spya-aaaaaa"]);
    expect(
      await ask({
        ...stored,
        extractedHtml: '<article><p id="spya-bbbbbb">Alpha, the first.</p></article>',
      }),
    ).toBe(false);
  });

  /**
   * **An internal link repointed at a different heading.**
   *
   * `retargetAnchors` rewrites the article's own `#fragment` links onto the
   * block ids of whatever they point at, so a link moved from one heading to
   * another changes the `html` the reader is served. Red against the version
   * that collapsed every `#spya-…` to one token — GPT Sol's second probe.
   */
  it("not done once an internal link points at a different heading", async () => {
    const page = (target: string) =>
      "<article>" +
      '<h2 id="first">The first heading</h2><p>Something under it.</p>' +
      '<h2 id="second">The second heading</h2><p>Something else.</p>' +
      `<p><a href="#${target}">jump</a></p>` +
      "</article>";
    const stored = stage3(page("first"));
    expect(await ask(stored)).toBe(true);
    expect(await ask({ ...stored, extractedHtml: page("second") })).toBe(false);
  });

  /**
   * **The document around the blocks, which no per-block comparison can see.**
   *
   * Stage 3 writes a whole serialised document, not a list of fragments, and
   * `stampedHtml` is that document — so a `<title>` or anything else outside a
   * block can move while every block stays identical. Comparing the candidate's
   * own serialisation against the stored one is what catches it, and it is the
   * only part of this guard that looks at the stamped HTML as a document rather
   * than as a bag of ids. GPT Sol, 2026-08-31.
   */
  it("not done once the document around the blocks has changed", async () => {
    const page = (title: string) =>
      `<html><head><title>${title}</title></head>` +
      "<body><article><p>Alpha, the first.</p></article></body></html>";
    const stored = stage3(page("The first title"));
    const moved = stage3(page("A corrected title"));
    expect(
      moved.blocks.map((b) => b.text),
      "the blocks themselves are untouched",
    ).toEqual(stored.blocks.map((b) => b.text));
    expect(await ask({ ...stored, extractedHtml: page("A corrected title") })).toBe(false);
  });

  /** The two old rules still hold when the HTMLs are apart. */
  it("not done when the stamped HTML has lost an id the blocks name", async () => {
    const run = stage3(TWO_PARAGRAPHS);
    expect(
      await ask({ ...run, stampedHtml: run.stampedHtml.replace(/ id="spya-[a-z0-9]{6}"/g, "") }),
    ).toBe(false);
  });

  it("not done when the blocks artefact lists nothing", async () => {
    expect(await ask({ ...stage3(TWO_PARAGRAPHS), blocks: [] })).toBe(false);
  });
});

/**
 * The shape checks are shallow on purpose, and shallow is not the same as
 * absent.
 *
 * `{"nodes":[]}` was a perfectly good tree until 2026-08-26 and `{"labels":[]}`
 * a perfectly good labels file, because the check was `typeof v === "object"`
 * and an array passes that. Neither writer has ever produced either shape, so
 * the one thing the check existed to say no to was the one thing it said yes to.
 *
 * **`SHAPE` is the shared table both remaining stores apply** — it lives in
 * src/store/artifacts.ts rather than in either adapter for exactly this reason,
 * so a case here is a case about Postgres as much as about the fake it runs
 * against (tests/helpers/memory-artefacts.ts § *what it does keep*). It is also
 * where the second half of a case this file lost on 2026-09-05 ended up: the
 * round-trip block above used to write `{"nope":1}` over a glossary file and
 * assert the store answered `null`, which is this rule with one fixture.
 */
describe("valid JSON of the wrong shape is not an artefact", () => {
  const store = memoryArtefacts();

  const wrong: { step: StepName; kind: ArtifactKind; body: unknown }[] = [
    { step: "hierarchy", kind: "tree", body: { nodes: [] } },
    { step: "hierarchy", kind: "labels", body: { labels: [] } },
    { step: "blocks", kind: "blocks", body: { blocks: {} } },
    { step: "arc", kind: "arc", body: { entries: {} } },
    { step: "extract", kind: "meta", body: { slug: "" } },
    { step: "fetch", kind: "raw", body: { file: null } },
  ];

  for (const { step, kind, body } of wrong) {
    it(`${step}/${kind}: ${JSON.stringify(body)}`, async () => {
      writeWholeArticle(store);
      // Readable to start with, so a failure below is about the shape rather
      // than about the fixture.
      expect(await store.read(SLUG, step, kind)).not.toBeNull();

      /* `plant`, not `write` — `write` refuses a bad shape and that is the
         point of `write`. This is the only way to produce *there is an
         artefact and it cannot be used*, and it is what writing the bytes
         behind the store's back used to do. */
      store.plant(SLUG, step, kind, body);
      expect(await store.read(SLUG, step, kind)).toBeNull();
      expect(await store.has(SLUG, step, [kind])).toBe(false);
    });
  }
});
