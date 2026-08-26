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
 * **It is red for the steps with no freshness check and green for the three
 * that have one**, and the difference is the whole argument for `has()`
 * parsing. `threadIsCurrent` already reads `tweets.json` and answers false when
 * it will not parse, so `tweets` was never exposed. `arc`, `toc`, `extract` and
 * `blocks` have no such function, and were.
 */
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPABLE_MODEL } from "../src/models.js";
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
import { sameStamp } from "../src/store/artifacts.js";
import type { ArtifactKind } from "../src/store/artifacts.js";
import type { StepContext } from "../src/pipeline.js";
import type { Block, StepName } from "../src/types.js";

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
    html: "<h1>A title</h1>",
    gistable: true,
};

const BODY: Block = {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: "One paragraph of something to hash.",
    words: 6,
    html: "<p>One paragraph of something to hash.</p>",
    gistable: true,
};

const BLOCKS: Block[] = [HEAD, BODY];

const SOURCE_HASH = hashBlocks(BLOCKS);

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
 * The prompt versions are written out here rather than imported, because
 * `tweets.ts` and `summarise.ts` keep theirs private. That would be a drift
 * hazard if the tests only asserted `false`; each truncation case therefore
 * asserts the **intact** artefact reports done first, so a version that moves
 * fails loudly at the setup rather than passing the real assertion for the
 * wrong reason.
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
  await writeFile(pathFor(at, "extract", "extractedHtml"), "<article><p>hi</p></article>", "utf-8");
  await writeJson(pathFor(at, "extract", "meta"), { slug: SLUG, title: "A title" });
  await writeJson(pathFor(at, "blocks", "blocks"), { blocks: BLOCKS });
  await writeJson(pathFor(at, "toc", "blocks"), { blocks: BLOCKS });
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
        title: "A title",
        gist: "A gist.",
        children: [],
      },
    },
  });
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
    version: "tweets/1",
    limit: 280,
    tweets: [{ text: "One post.", chars: 9 }],
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  await writeJson(pathFor(at, "glossary", "glossary"), {
    ...stamped,
    version: "glossary/2",
    entries: [],
    passes: 1,
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  });
  await writeJson(pathFor(at, "summary", "summary"), {
    ...stamped,
    version: "summary/2",
    entries: [],
    missing: 0,
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
  it("agrees with `outputs`, step for step", () => {
    const where = fsLocations("nothing-here");
    const ctx = ctxAt(where);
    for (const name of STEP_ORDER) {
      const step = STEPS[name];
      const declared = step.produces.map((kind) => pathFor(where, name, kind));
      expect(new Set(declared), `${name}: produces vs outputs`).toEqual(
        new Set(step.outputs(ctx)),
      );
      // Sets hide a duplicate. `outputs` has none and neither may `produces`.
      expect(declared.length, `${name}: duplicate path`).toBe(new Set(declared).size);
    }
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
 * `glossary` is the first step whose freshness goes through `stamp` +
 * `sameStamp` rather than through a `…IsCurrent` function of its own, so these
 * are `glossaryIsCurrent`'s own conditions asserted against the new path.
 *
 * Worth writing out rather than trusting: the mechanism is new, the old
 * function is still there and still passing its own tests, and a `stamp` that
 * answered "current" too readily would show up as a stale glossary served for
 * ever — while one that answered too rarely would show up only on the bill.
 */
describe("glossary currency, through the stamp rather than a function", () => {
  const slug = `${SLUG}-stamp`;
  let where: ArtifactLocations;
  let store: ReturnType<typeof createFsArtifactStore>;

  const glossaryOf = (over: Record<string, unknown>) => ({
    version: "glossary/2",
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
