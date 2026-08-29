/**
 * The artefact store seam: the declaration agrees with the paths, the paths
 * round-trip the real artefacts, and a half-written file stops reporting itself
 * finished.
 *
 * See docs/plans/postgres-storage-implementation.md § Step 11, half B.
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
 * it would not parse, so `tweets` was never exposed; `arc`, `toc`, `extract`
 * and `blocks` had no such function, and were.
 *
 * Written in the past tense since D0, because the accident of protection has
 * gone and the protection has not: `threadIsCurrent` and `summariesAreCurrent`
 * were replaced by stamps, and `stepIsDone` asks `has()` *before* it computes
 * one. So every step is now covered by the same parsing check rather than three
 * of them being covered by a function that happened to parse on its way to
 * asking something else.
 */
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPABLE_MODEL } from "../src/models.js";
import { PROMPT_VERSION as GLOSSARY_VERSION } from "../src/glossary.js";
import {
  inputFingerprint as ideasFingerprint,
  PROMPT_VERSION as IDEAS_VERSION,
} from "../src/ideas.js";
import { PROMPT_VERSION as SUMMARY_VERSION } from "../src/summarise.js";
import { PROMPT_VERSION as TWEETS_VERSION } from "../src/tweets.js";
import { STEP_ORDER, STEPS, stepIsDone } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { parseJsonFrom } from "../src/parse-json.js";
import {
  type ArtifactLocations,
  createFsArtifactStore,
  fsLocations,
  PATHS,
  pathFor,
} from "../src/store/artifacts-fs.js";
import { metaRawSha256, sameStamp } from "../src/store/artifacts.js";
import type { ArtifactKind, ArtifactMap } from "../src/store/artifacts.js";
import type { StepContext } from "../src/pipeline.js";
import type { Block, StepName, Tree } from "../src/types.js";

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

const HEAD: Block = {
    id: "spya-aaaaaa",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A title",
    words: 2,
    html: `<h1 id="spya-aaaaaa">A title</h1>`,
    gistable: true,
};

const BODY: Block = {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: "One paragraph of something to hash.",
    words: 6,
    html: `<p id="spya-bbbbbb">One paragraph of something to hash.</p>`,
    gistable: true,
};

const BLOCKS: Block[] = [HEAD, BODY];

/**
 * The article HTML **after stage 3 has stamped the ids into it**.
 *
 * The fixture used to be `<article><p>hi</p></article>`, which is what stage 2
 * writes — ids nowhere in it. That made every `blocks` assertion below pass
 * against an artefact pair that could not have come from a real run, and it is
 * the state `blocks` now has to notice: see the `blocks` binding test.
 */
const STAMPED_HTML = [
  "<article>",
  `<h1 id="${HEAD.id}">A title</h1>`,
  `<p id="${BODY.id}">One paragraph of something to hash.</p>`,
  "</article>",
].join("");

/** What stage 2 leaves behind: the same prose, none of the ids. */
const UNSTAMPED_HTML = "<article><h1>A title</h1><p>One paragraph of something to hash.</p></article>";

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

/** Blocks **and** tree — src/ideas.ts § `inputFingerprint`. */
const IDEAS_SOURCE_HASH = ideasFingerprint(BLOCKS, TREE);

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
 * drift: `tweets.ts` and `summarise.ts` now export their version the way
 * `glossary.ts` already did.
 */
async function writeWholeArticle(at: ArtifactLocations): Promise<void> {
  const stamped = { version: "", generator: CAPABLE_MODEL, slug: SLUG, sourceHash: SOURCE_HASH };

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
  await writeJson(pathFor(at, "extract", "meta"), { slug: SLUG, title: "A title" });
  await writeJson(pathFor(at, "blocks", "blocks"), { blocks: BLOCKS });
  await writeJson(pathFor(at, "toc", "blocks"), { blocks: BLOCKS });
  await writeJson(pathFor(at, "toc", "tree"), TREE);
  await writeJson(pathFor(at, "toc", "labels"), {
    version: "labels/1",
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: SOURCE_HASH,
    structureHash: "0000000000000000",
    structureVersion: "toc/2",
    labels: { n0000: "A title" },
    batches: null,
  });
  await writeJson(pathFor(at, "arc", "arc"), {
    version: "arc/2",
    generator: CAPABLE_MODEL,
    slug: SLUG,
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
  await writeJson(pathFor(at, "summary", "summary"), {
    ...stamped,
    version: SUMMARY_VERSION,
    entries: [],
    missing: 0,
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
    { step: "toc", kind: "tree" },
    { step: "toc", kind: "labels" },
    { step: "arc", kind: "arc" },
    { step: "tweets", kind: "tweets" },
    { step: "glossary", kind: "glossary" },
    { step: "summary", kind: "summary" },
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
    expect(pathFor(where, "blocks", "blocks")).not.toBe(pathFor(where, "toc", "blocks"));
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
    { step: "toc", kind: "blocks", from: "writes", file: "data/writes/blocks.json" },
    { step: "toc", kind: "tree", from: "writes", file: "data/writes/tree.json" },
    {
      step: "toc",
      kind: "labels",
      from: "noema-mythology-of-conscious-ai",
      file: "data/noema-mythology-of-conscious-ai/labels.json",
    },
    { step: "arc", kind: "arc", from: "writes", file: "data/writes/arc.json" },
    { step: "tweets", kind: "tweets", from: "writes", file: "data/writes/tweets.json" },
    { step: "glossary", kind: "glossary", from: "writes", file: "data/writes/glossary.json" },
    { step: "summary", kind: "summary", from: "writes", file: "data/writes/summary.json" },
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

  it("names a file rather than carrying the bytes, which is the unfinished half", () => {
    /* Said in a test because it is the thing a reader of the type would assume
       and be wrong about. `article_revisions.raw_bytes` needs the payload, and
       a manifest has only its *name* — so a Postgres adapter cannot be written
       against this. docs/plans/transactional-stage-runner.md § B. */
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
    sourceHash: SOURCE_HASH,
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

  async function ask(glossary: Record<string, unknown>, blocks: Block[] | null): Promise<boolean> {
    await writeJson(pathFor(where, "glossary", "glossary"), glossary);
    if (blocks) await writeJson(pathFor(where, "toc", "blocks"), { blocks });
    else await rm(pathFor(where, "toc", "blocks"), { force: true });
    return stepIsDone(STEPS.glossary, { ...ctxAt(where), slug }, store);
  }

  it("says done when the blocks, the prompt and the model all still match", async () => {
    expect(await ask(glossaryOf({}), BLOCKS)).toBe(true);
  });

  it("says not-done when the article has moved underneath it", async () => {
    const changed: Block[] = [HEAD, { ...BODY, text: "Rewritten since." }];
    expect(await ask(glossaryOf({}), changed)).toBe(false);
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
    const file = pathFor(where, "toc", "blocks");
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
    expect(await store.read(SLUG, "toc", "blocks")).toBeNull();
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
 * See docs/plans/postgres-storage-implementation.md
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
    expect(await stepIsDone(STEPS.toc, ctxAt(at), store)).toBe(true);

    const attempt = await store.beginStep(SLUG, "toc");
    // Generation B's tree, valid in every way, landing beside generation A's
    // labels and blocks.
    await writeJson(pathFor(at, "toc", "tree"), {
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
    expect(await stepIsDone(STEPS.toc, ctxAt(at), store)).toBe(false);

    /* And the marker is the *only* thing holding it back — clearing it says
       done again, over exactly the mixed generation above.

       That is the honest limit of this mechanism and the reason it is asserted
       rather than left implied: the store is not inspecting the artefacts and
       concluding they disagree, it is being told a run finished. What it buys
       is that nothing tells it that unless a run really did return. A review
       read the first version of this test as claiming more than that, which it
       did. */
    await store.finishStep(SLUG, "toc", attempt);
    expect(await stepIsDone(STEPS.toc, ctxAt(at), store)).toBe(true);
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

    const first = await store.beginStep(SLUG, "toc");
    const second = await store.beginStep(SLUG, "toc"); // overwrites the marker

    await store.finishStep(SLUG, "toc", first);
    expect(await store.interrupted(SLUG, "toc"), "the second attempt is still live").toBe(
      true,
    );

    await store.finishStep(SLUG, "toc", second);
    expect(await store.interrupted(SLUG, "toc")).toBe(false);
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
    { step: "toc", kind: "tree", body: { nodes: [] } },
    { step: "toc", kind: "labels", body: { labels: [] } },
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
