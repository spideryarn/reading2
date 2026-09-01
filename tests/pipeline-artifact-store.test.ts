/**
 * The artefact store seam: the declaration agrees with the paths, the paths
 * round-trip the real artefacts, and a half-written file stops reporting itself
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
 * truncation block below is that bug, written as a test before it was fixed.
 *
 * **It was red for the steps with no freshness check and green for the three
 * that had one**, and that difference is the whole argument for `has()`
 * parsing. `threadIsCurrent` read `tweets.json` itself and answered false when
 * it would not parse, so `tweets` was never exposed; `arc`, `hierarchy`, `extract`
 * and `blocks` had no such function, and were.
 *
 * Written in the past tense since D0, because the accident of protection has
 * gone and the protection has not: `threadIsCurrent` was replaced by a stamp,
 * and `stepIsDone` asks `has()` *before* it computes one. So every step is now
 * covered by the same parsing check rather than a couple of them being covered
 * by a function that happened to parse on its way to asking something else.
 */
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPABLE_MODEL } from "../src/models.js";
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
  inputFingerprint as timelineFingerprint,
  PROMPT_VERSION as TIMELINE_VERSION,
} from "../src/timeline.js";
import {
  inputFingerprint as quizFingerprint,
  PROMPT_VERSION as QUIZ_VERSION,
} from "../src/quiz.js";
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
import {
  type ArtifactLocations,
  createFsArtifactStore,
  fsLocations,
  PATHS,
  pathFor,
} from "../src/store/artifacts-fs.js";
import { metaRawSha256, sameStamp } from "../src/store/artifacts.js";
import type { ArtifactKind, ArtifactMap, ArtifactReads } from "../src/store/artifacts.js";
import type { StepContext } from "../src/pipeline.js";
import type { Block, Meta, StepName, Tree } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

const SLUG = "test-artifact-store";

/**
 * Fixtures go in a temp directory, never in `data/`.
 *
 * `createFsArtifactStore` takes a locator precisely so this is possible, and it
 * is not tidiness: `listArticles` enumerates `data/`, so an article written
 * there mid-run joins the shelf, and tests/library.test.ts starts failing on
 * the order of a list that has a stranger in it. Found the hard way — these
 * fixtures were under `data/test-…` first, and three unrelated test files went
 * red only when the whole suite ran together.
 */
async function tempArticle(name: string): Promise<ArtifactLocations> {
  const root = await mkdtemp(path.join(tmpdir(), `spya-artifacts-${name}-`));
  const at = { dir: path.join(root, "data", SLUG), htmlFile: path.join(root, "output", `${SLUG}.html`) };
  await mkdir(at.dir, { recursive: true });
  await mkdir(path.dirname(at.htmlFile), { recursive: true });
  return at;
}

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

/** What stage 2 leaves behind: the same prose, none of the ids. */
const UNSTAMPED_HTML =
  "<article><h1>A title</h1><p>One paragraph of something to hash.</p></article>";

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

/** A context pointing at a temp article. Nothing here runs, so most of it is
    the type asking rather than anything being used. */
function ctxAt(at: ArtifactLocations): StepContext {
  return {
    slug: SLUG,
    dir: at.dir,
    htmlFile: at.htmlFile,
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * A complete, current article on disk: every step's outputs, stamped so that
 * the three steps with a freshness check pass it.
 *
 * **The prompt versions are imported, not written out.** They used to be
 * literals here, with the intact-first assertion as the safety net — and that
 * net worked exactly once, on 2026-08-26, when all three versions moved in one
 * afternoon and five tests went red for a reason that had nothing to do with
 * what they test. A net that catches the drift is worse than not having the
 * drift: `tweets.ts` now exports its version the way `glossary.ts` already
 * did.
 */
async function writeWholeArticle(at: ArtifactLocations): Promise<void> {
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

  await writeJson(pathFor(at, "fetch", "raw"), {
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
  await writeFile(pathFor(at, "extract", "extractedHtml"), STAMPED_HTML, "utf-8");
  await writeJson(pathFor(at, "extract", "meta"), META);
  await writeJson(pathFor(at, "blocks", "blocks"), { blocks: BLOCKS });
  await writeJson(pathFor(at, "hierarchy", "blocks"), { blocks: BLOCKS });
  await writeJson(pathFor(at, "hierarchy", "tree"), TREE);
  await writeJson(pathFor(at, "hierarchy", "labels"), {
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
  await writeJson(pathFor(at, "assets", "assets"), {
    version: ASSETS_VERSION,
    sourceHash: SOURCE_HASH,
    fetchedAt: new Date().toISOString(),
    entries: [],
  });
  await writeJson(pathFor(at, "arc", "arc"), {
    version: ARC_VERSION,
    generator: CAPABLE_MODEL,
    slug: SLUG,
    /* Stamped since 2026-08-29. Before that the arc had no input fingerprint at
       all, so this fixture only had to exist to count as done. */
    sourceHash: ARC_SOURCE_HASH,
    entries: [{ range: [HEAD.id, BODY.id], text: "It begins." }],
  });
  await writeJson(pathFor(at, "tweets", "tweets"), {
    ...stamped,
    version: TWEETS_VERSION,
    limit: 280,
    tweets: [{ text: "One post.", chars: 9 }],
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  await writeJson(pathFor(at, "glossary", "glossary"), {
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
  await writeJson(pathFor(at, "ideas", "ideas"), {
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
  await writeJson(pathFor(at, "quotes", "quotes"), {
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
  await writeJson(pathFor(at, "timeline", "timeline"), {
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
  await writeJson(pathFor(at, "quiz", "quiz"), {
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
  await writeJson(pathFor(at, "sketch", "sketch"), {
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
  });
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

/** Chop a file in half, the way a killed process does. */
async function halve(file: string): Promise<void> {
  const { size } = await stat(file);
  await truncate(file, Math.floor(size / 2));
}

describe("a half-written artefact must not report its step finished", () => {
  let at: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    at = await tempArticle("truncation");
    store = createFsArtifactStore(() => at);
  });
  afterAll(async () => {
    await rm(path.dirname(at.dir), { recursive: true, force: true });
  });

  /* One case per step that writes JSON. `fetch` and the two HTML kinds are not
     here: truncated HTML is still valid text, nothing about the bytes says
     otherwise, and claiming to catch it would be worse than saying we cannot.
     Atomic writes are what protect those. */
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
    it(`${step}: a truncated ${kind}`, async () => {
      // Intact first. If this fails, the fixture is wrong — most likely a
      // prompt version moved — and the real assertion below would then pass
      // for a reason that has nothing to do with truncation.
      await writeWholeArticle(at);
      expect(await stepIsDone(STEPS[step], ctxAt(at), store)).toBe(true);

      await halve(pathFor(at, step, kind));
      expect(await stepIsDone(STEPS[step], ctxAt(at), store)).toBe(false);
    });
  }
});

/**
 * Every way `produces` and `outputs` can disagree, as a list of sentences.
 *
 * A function rather than assertions inline, so the test below can run it
 * against a deliberately broken `PATHS` and watch it come back non-empty.
 *
 * **Ordered, and both sides checked for duplicates.** Comparing sets lets two
 * kinds inside one step swap destinations; checking uniqueness on the declared
 * side only lets `outputs` grow a duplicate unseen.
 */
function pathDisagreements(): string[] {
  const where = fsLocations("nothing-here");
  const ctx = ctxAt(where);
  const problems: string[] = [];
  for (const name of STEP_ORDER) {
    const step = STEPS[name];
    const declared = step.produces.map((kind) => pathFor(where, name, kind));
    const listed = step.outputs(ctx);
    if (declared.join("\u0000") !== listed.join("\u0000")) {
      problems.push(`${name}: produces gives [${declared}], outputs gives [${listed}]`);
    }
    if (new Set(declared).size !== declared.length) problems.push(`${name}: produces repeats a path`);
    if (new Set(listed).size !== listed.length) problems.push(`${name}: outputs repeats a path`);
  }
  return problems;
}

describe("what a step says it produces, and where that lands", () => {
  /**
   * The move that matters: the new declaration checked against the old one
   * before anything depends on it.
   *
   * `outputs(ctx)` is what the pipeline has used since it was written and what
   * `assertProduced` still enforces after every run. `produces` is the same
   * fact said a different way. Rendering one through `PATHS` and comparing it
   * to the other is what stops the two being subtly different lists that agree
   * on the day they were written.
   */
  it("agrees with `outputs`, step for step, in order", () => {
    expect(pathDisagreements()).toEqual([]);
  });

  /**
   * **The check proved red before it is trusted green.**
   *
   * The first version of this compared *sets*, and a set cannot see two kinds
   * inside one step swapping destinations — `extract` writing the HTML to
   * `meta.json` and the meta to `<slug>.html` agrees with `outputs` perfectly
   * as a set, and is the drift the test exists to catch. So the test does the
   * swap itself and asserts it is noticed. A comparison nobody has watched fail
   * is a comparison nobody knows the shape of.
   */
  it("notices when two kinds inside one step swap destinations", () => {
    const extractedHtml = PATHS.extract.extractedHtml;
    const meta = PATHS.extract.meta;
    if (!extractedHtml || !meta) throw new Error("extract lost one of its two paths");
    try {
      PATHS.extract.extractedHtml = meta;
      PATHS.extract.meta = extractedHtml;
      expect(pathDisagreements()).not.toEqual([]);
    } finally {
      PATHS.extract.extractedHtml = extractedHtml;
      PATHS.extract.meta = meta;
    }
    // And back to agreeing, so a broken restore cannot pass quietly.
    expect(pathDisagreements()).toEqual([]);
  });

  it("has a path for every kind any step declares, and no orphans", () => {
    for (const name of STEP_ORDER) {
      const declared = new Set<string>(STEPS[name].produces);
      const known = new Set(Object.keys(PATHS[name]));
      expect([...known].sort(), `${name}: PATHS vs produces`).toEqual([...declared].sort());
    }
  });

  /* Two kinds share one path and one kind has two paths — the reason `PATHS`
     is keyed by `(step, kind)` rather than by kind alone. Asserted rather than
     only commented, because a tidy-up that "simplifies" the key would silently
     lose one of the two blocks.json files, and four stages read the one it
     would lose. */
  it("keeps the two blocks.json files apart", () => {
    const where = fsLocations("x");
    expect(pathFor(where, "blocks", "blocks")).not.toBe(pathFor(where, "hierarchy", "blocks"));
    expect(pathFor(where, "extract", "extractedHtml")).toBe(
      pathFor(where, "blocks", "stampedHtml"),
    );
  });
});

describe("the file store round-trips every kind", () => {
  const scratch = `${SLUG}-roundtrip`;
  let where: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    where = await tempArticle("roundtrip");
    store = createFsArtifactStore(() => where);
  });
  afterAll(async () => {
    await rm(path.dirname(where.dir), { recursive: true, force: true });
  });

  /**
   * Against the artefacts in `data/`, not invented ones.
   *
   * An invented fixture round-trips whatever shape the test author had in mind,
   * which is the shape the decoder was written for. The real files are the only
   * ones that can catch a decoder that is right about an imagined artefact and
   * wrong about the one on disk.
   */
  const REAL: { step: StepName; kind: ArtifactKind; from: string; file: string }[] = [
    { step: "fetch", kind: "raw", from: "writes", file: "data/writes/raw.json" },
    { step: "extract", kind: "meta", from: "writes", file: "data/writes/meta.json" },
    {
      step: "extract",
      kind: "extractedHtml",
      from: "writes",
      file: "output/writes.html",
    },
    { step: "blocks", kind: "blocks", from: "writes", file: "output/writes.blocks.json" },
    { step: "blocks", kind: "stampedHtml", from: "writes", file: "output/writes.html" },
    { step: "hierarchy", kind: "blocks", from: "writes", file: "data/writes/blocks.json" },
    { step: "hierarchy", kind: "tree", from: "writes", file: "data/writes/tree.json" },
    {
      step: "hierarchy",
      kind: "labels",
      from: "noema-mythology-of-conscious-ai",
      file: "data/noema-mythology-of-conscious-ai/labels.json",
    },
    { step: "arc", kind: "arc", from: "writes", file: "data/writes/arc.json" },
    { step: "tweets", kind: "tweets", from: "writes", file: "data/writes/tweets.json" },
    { step: "glossary", kind: "glossary", from: "writes", file: "data/writes/glossary.json" },
  ];

  /**
   * The table's `from` used to be decorative, and that made the round trip
   * weaker than it reads: writing and reading through the *same* mapping
   * round-trips perfectly even when the mapping is wrong. Pinning `pathFor`
   * against the literal path in the table is the independent half.
   */
  it("puts each kind where the table says the real file is", () => {
    for (const { step, kind, from, file } of REAL) {
      expect(pathFor(fsLocations(from), step, kind), `${step}/${kind}`).toBe(
        path.join(ROOT, file),
      );
    }
  });

  for (const { step, kind, file } of REAL) {
    it(`${step}/${kind}`, async () => {
      const raw = await readFile(path.join(ROOT, file), "utf-8");
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
    const arc: unknown = JSON.parse(await readFile(path.join(ROOT, "data/writes/arc.json"), "utf-8"));
    await expect(
      store.write(scratch, "arc", { arc: arc as never }, { promptVersion: "arc/999" }),
    ).rejects.toThrow(/disagrees with the arc itself/);
  });

  it("reads a stamp back off the artefact, and only for steps that carry one", async () => {
    const tweets: unknown = JSON.parse(
      await readFile(path.join(ROOT, "data/writes/tweets.json"), "utf-8"),
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

  it("answers null for everything unhappy, and not-done with it", async () => {
    expect(await store.read(scratch, "glossary", "glossary")).not.toBeNull();
    await writeFile(pathFor(where, "glossary", "glossary"), "{ not json", "utf-8");
    expect(await store.read(scratch, "glossary", "glossary")).toBeNull();
    expect(await store.has(scratch, "glossary", ["glossary"])).toBe(false);

    // Valid JSON of the wrong shape entirely, which a bare parse would accept.
    await writeFile(pathFor(where, "glossary", "glossary"), `{"nope":1}`, "utf-8");
    expect(await store.read(scratch, "glossary", "glossary")).toBeNull();
  });
});

describe("the raw artefact is a manifest, and the type has to say so", () => {
  /**
   * **The cast that was there until 2026-08-27, and why nothing caught it.**
   *
   * `ArtifactMap.raw` was declared `string`. The artefact is a `RawManifest`
   * object — the filesystem decoder has always checked it with
   * `json("file", isString)` — so `read(slug, "fetch", "raw")` handed back an
   * object cast to `string`, whose `.length` is `undefined` and whose
   * `.slice()` throws. Nothing had noticed because `read` has no production
   * caller yet: the stages all open paths.
   *
   * This is a **compile-time** test as much as a runtime one. `manifest.file`
   * does not typecheck against `string`, so the declaration cannot quietly go
   * back to what it was without this file going red — which is the only kind of
   * guard that works on a type nobody calls.
   */
  const at = fsLocations("raw-shape");

  beforeAll(async () => {
    await mkdir(at.dir, { recursive: true });
    await writeJson(pathFor(at, "fetch", "raw"), {
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
  });

  afterAll(async () => {
    await rm(at.dir, { recursive: true, force: true });
  });

  it("comes back with its fields, not as a string", async () => {
    const manifest = await createFsArtifactStore().read("raw-shape", "fetch", "raw");
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
  let where: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

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

  beforeAll(async () => {
    where = await tempArticle("stamp");
    store = createFsArtifactStore(() => where);
  });
  afterAll(async () => {
    await rm(path.dirname(where.dir), { recursive: true, force: true });
  });

  /* The tree and the metadata beside the blocks, because the stamp reads all
     three: this prompt is built from `partsOf(tree)` and carries the metadata
     head. Written on every call rather than once in `beforeAll`, so a case can
     move any of the three. src/source-hash.ts § `articleFingerprint`. */
  async function ask(
    glossary: Record<string, unknown>,
    blocks: Block[] | null,
    over: { tree?: Tree; meta?: unknown } = {},
  ): Promise<boolean> {
    await writeJson(pathFor(where, "glossary", "glossary"), glossary);
    await writeJson(pathFor(where, "hierarchy", "tree"), over.tree ?? TREE);
    await writeJson(pathFor(where, "extract", "meta"), over.meta ?? META);
    if (blocks) await writeJson(pathFor(where, "hierarchy", "blocks"), { blocks });
    else await rm(pathFor(where, "hierarchy", "blocks"), { force: true });
    return stepIsDone(STEPS.glossary, { ...ctxAt(where), slug }, store);
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

describe("a corrupt artefact does not put the article in a log line", () => {
  /* src/store/artifacts-fs.ts § json. The decoder used a bare `JSON.parse`, and
     `read`'s catch logs the thrown message. V8 puts the first characters of the
     offending input into a SyntaxError — `Unexpected token 'S', "SECRET art"...
     is not valid JSON` — so a half-written artefact put article prose into a
     debug log, which docs/project/logging.md forbids outright.

     The same shape as the seven OpenRouter sites and the six Anthropic ones,
     arriving by a route nobody had looked down: not a provider talking, but our
     own file coming back malformed. Found by review, 2026-08-26. */
  let where: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    where = await tempArticle("leak");
    store = createFsArtifactStore(() => where);
  });
  afterAll(async () => {
    await rm(path.dirname(where.dir), { recursive: true, force: true });
  });

  /** A sentence that would be unmistakable if it ever reached a message. */
  const PROSE = "Consciousness is not a spreadsheet and never was";

  it("reads null and says nothing about what the file contained", async () => {
    const file = pathFor(where, "hierarchy", "blocks");
    await mkdir(path.dirname(file), { recursive: true });
    /* A file holding article prose rather than JSON — an artefact clobbered by
       a write that went to the wrong path, or one whose first bytes are the
       article itself. **Which corruption you pick matters**, and picking the
       wrong one is how this test would have passed while proving nothing: V8
       only quotes the input when the text does not begin as JSON. A string
       truncated mid-value gives "Unterminated string in JSON at position 70",
       which names no content at all — so a test built on that corruption is
       green whether or not the bug exists. */
    await writeFile(file, PROSE, "utf-8");

    let raw = "";
    try {
      JSON.parse(PROSE);
    } catch (err) {
      raw = (err as Error).message;
    }
    /* First, prove the hazard is real rather than theoretical: V8 really does
       quote the input. If this ever stops being true, the assertion below is
       no longer testing anything, and it should fail loudly rather than pass
       vacuously. */
    expect(raw).toContain("Consciousn");

    // And now the thing itself: reading through the store surfaces nothing.
    expect(await store.read(SLUG, "hierarchy", "blocks")).toBeNull();
  });

  it("describes the breakage without quoting it", () => {
    // parseJsonFrom is what the decoder uses now. Its message says how the text
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
  let at: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    at = await tempArticle("interrupted");
    store = createFsArtifactStore(() => at);
  });
  afterAll(async () => {
    await rm(path.dirname(at.dir), { recursive: true, force: true });
  });

  /**
   * **The one the review asked for first.** Per-file atomic renames are not
   * atomicity across a step: leave a complete generation A on disk, let a rerun
   * replace exactly one of the step's outputs with a perfectly valid generation
   * B and then die, and every path exists and parses. Under a presence check
   * the step reports done with A and B mixed, and the stage after it consumes
   * a tree built from blocks nobody has.
   */
  it("catches a generation half-replaced by a run that died", async () => {
    await writeWholeArticle(at);
    expect(await stepIsDone(STEPS.hierarchy, ctxAt(at), store)).toBe(true);

    const attempt = await store.beginStep(SLUG, "hierarchy");
    // Generation B's tree, valid in every way, landing beside generation A's
    // labels and blocks.
    await writeJson(pathFor(at, "hierarchy", "tree"), {
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
    expect(await stepIsDone(STEPS.hierarchy, ctxAt(at), store)).toBe(false);

    /* And the marker is the *only* thing holding it back — clearing it says
       done again, over exactly the mixed generation above.

       That is the honest limit of this mechanism and the reason it is asserted
       rather than left implied: the store is not inspecting the artefacts and
       concluding they disagree, it is being told a run finished. What it buys
       is that nothing tells it that unless a run really did return. A review
       read the first version of this test as claiming more than that, which it
       did. */
    await store.finishStep(SLUG, "hierarchy", attempt);
    expect(await stepIsDone(STEPS.hierarchy, ctxAt(at), store)).toBe(true);
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
    await writeWholeArticle(at);

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
    await writeWholeArticle(at);
    for (const name of STEP_ORDER) {
      expect(await stepIsDone(STEPS[name], ctxAt(at), store), `${name} before`).toBe(true);
      const attempt = await store.beginStep(SLUG, name);
      expect(await stepIsDone(STEPS[name], ctxAt(at), store), `${name} during`).toBe(false);
      await store.finishStep(SLUG, name, attempt);
      expect(await stepIsDone(STEPS[name], ctxAt(at), store), `${name} after`).toBe(true);
    }
  });

  it("finishing a step nobody started is not an error", async () => {
    // Every artefact written before markers existed is in this state, and so is
    // a stage run straight off its own CLI.
    await expect(store.finishStep(SLUG, "arc", "spya-nobody")).resolves.toBeUndefined();
  });
});

/**
 * `extractedHtml` and `stampedHtml` are one path on disk, so the filesystem
 * cannot tell them apart — which means a re-extraction leaves stage 2's
 * unstamped HTML sitting beside stage 3's blocks.json, and every path exists
 * and parses. The binding, not the path, is what catches it: the ids in
 * blocks.json have to actually be in the HTML.
 */
describe("blocks is only done if the HTML really carries its ids", () => {
  let at: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    at = await tempArticle("stamping");
    store = createFsArtifactStore(() => at);
  });
  afterAll(async () => {
    await rm(path.dirname(at.dir), { recursive: true, force: true });
  });

  it("not done once a re-extraction has wiped the ids out of the HTML", async () => {
    await writeWholeArticle(at);
    expect(await stepIsDone(STEPS.blocks, ctxAt(at), store)).toBe(true);

    await writeFile(pathFor(at, "extract", "extractedHtml"), UNSTAMPED_HTML, "utf-8");
    expect(await stepIsDone(STEPS.blocks, ctxAt(at), store)).toBe(false);
    // `extract` itself is done — it wrote the HTML it was asked for. Only the
    // step whose output the re-extraction invalidated is not.
    expect(await stepIsDone(STEPS.extract, ctxAt(at), store)).toBe(true);
  });

  /**
   * **`every` over nothing is true**, and that is not an answer about the HTML.
   * A `blocks.json` listing no ids passed the binding check vacuously, so a
   * stage 3 that produced nothing — a first ingest of a paywall or an error
   * page, where the runtime guard has no baseline to refuse against — reported
   * itself done having retained zero ids, and the stages after it read an
   * article with no blocks in it. GPT Sol, 2026-08-28.
   */
  it("not done when blocks.json lists no ids at all", async () => {
    await writeWholeArticle(at);
    await writeJson(pathFor(at, "blocks", "blocks"), { blocks: [] });
    expect(await stepIsDone(STEPS.blocks, ctxAt(at), store)).toBe(false);
  });

  it("not done when the HTML carries only some of the ids", async () => {
    await writeWholeArticle(at);
    await writeFile(
      pathFor(at, "extract", "extractedHtml"),
      `<article><h1 id="${HEAD.id}">A title</h1><p>One paragraph of something to hash.</p></article>`,
      "utf-8",
    );
    expect(await stepIsDone(STEPS.blocks, ctxAt(at), store)).toBe(false);
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
  let at: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    at = await tempArticle("fingerprints");
    store = createFsArtifactStore(() => at);
  });
  afterAll(async () => {
    await rm(path.dirname(at.dir), { recursive: true, force: true });
  });

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

  async function statesAfter(change: () => Promise<void>): Promise<Record<string, boolean>> {
    await writeWholeArticle(at);
    // Intact first: a fixture that was already not-done would make every
    // assertion below pass for a reason that has nothing to do with the change.
    for (const step of [...PROSE_STEPS, "assets" as StepName]) {
      expect(await stepIsDone(STEPS[step], ctxAt(at), store), `${step} before`).toBe(true);
    }
    await change();
    const after: Record<string, boolean> = {};
    for (const step of [...PROSE_STEPS, "assets" as StepName]) {
      after[step] = await stepIsDone(STEPS[step], ctxAt(at), store);
    }
    return after;
  }

  /**
   * The sections re-cut with every block byte-identical. `structureHash` covers
   * the titles and the gists as well as the boundaries, because the prompts are
   * built out of them.
   */
  it("not done once the tree has been re-cut underneath them", async () => {
    const after = await statesAfter(async () => {
      await writeJson(pathFor(at, "hierarchy", "tree"), {
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
    const after = await statesAfter(async () => {
      await writeJson(pathFor(at, "extract", "meta"), { ...META, title: "Renamed since" });
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
    await writeWholeArticle(at);
    await rm(pathFor(at, "extract", "meta"), { force: true });
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
      const file = pathFor(at, step, kind);
      const held = parseJsonFrom<Record<string, unknown>>(await readFile(file, "utf8"), file);
      await writeJson(file, { ...held, sourceHash: hash });
    }
    const after: Record<string, boolean> = {};
    for (const step of PROSE_STEPS) after[step] = await stepIsDone(STEPS[step], ctxAt(at), store);
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
 * beside the filesystem cases it has to agree with.
 *
 * ## What was wrong before
 *
 * `htmlCarriesItsIds` read stage 3's **own** `stampedHtml` and compared it
 * against stage 3's **own** `blocks` — a comparison stage 3 cannot lose. On
 * disk that happened to work, because both names resolve to `at.htmlFile`
 * (`PATHS` in src/store/artifacts-fs.ts), so an `extract` that re-ran without
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
    stepIsDone(STEPS.blocks, ctxAt(fsLocations(SLUG)), twoColumnStore(held));

  const TWO_PARAGRAPHS = "<article><p>Alpha, the first.</p><p>Beta, the second.</p></article>";

  it("done for a healthy Postgres pair — two columns, one extraction", async () => {
    expect(await ask(stage3(TWO_PARAGRAPHS))).toBe(true);
  });

  /**
   * **The filesystem shape, and the property it rests on.** There the two names
   * are one path, so the guard re-derives candidates from stage 3's *own*
   * output rather than from stage 2's. That is only sound if the splitter is
   * idempotent — if `split(split(x).html)` gives the same sequence as
   * `split(x)`. Checked here on a fixture and measured across ten real articles
   * in `output/` (330 to 669 blocks, twice over each): identical every time.
   */
  it("done for a healthy filesystem pair, where both names are one document", async () => {
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
 * The decoders are shallow on purpose, and shallow is not the same as absent.
 *
 * `{"nodes":[]}` was a perfectly good tree until 2026-08-26 and `{"labels":[]}`
 * a perfectly good labels file, because the check was `typeof v === "object"`
 * and an array passes that. Neither writer has ever produced either shape, so
 * the one thing the check existed to say no to was the one thing it said yes to.
 */
describe("valid JSON of the wrong shape is not an artefact", () => {
  let at: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeAll(async () => {
    at = await tempArticle("shapes");
    store = createFsArtifactStore(() => at);
  });
  afterAll(async () => {
    await rm(path.dirname(at.dir), { recursive: true, force: true });
  });

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
      await writeWholeArticle(at);
      // Readable to start with, so a failure below is about the shape rather
      // than about the fixture.
      expect(await store.read(SLUG, step, kind)).not.toBeNull();

      await writeJson(pathFor(at, step, kind), body);
      expect(await store.read(SLUG, step, kind)).toBeNull();
      expect(await store.has(SLUG, step, [kind])).toBe(false);
    });
  }
});
