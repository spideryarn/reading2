/**
 * Copying an article between two stores, through the seam and nothing else.
 *
 * This is the replacement for `db:import` in the three suites that use it to
 * get an article into Postgres — docs/plans/260827aa-delete-the-importer.md § What it
 * costs. Here it is exercised filesystem-to-filesystem, because that half needs
 * no database and can therefore be proved before the Postgres adapter exists.
 *
 * ## What it is really testing
 *
 * Two things, and the second is a bonus that matters.
 *
 * 1. **`readParts` and `copyArtefacts` preserve everything.** Every artefact of
 *    every step arrives at the other end equal to what it left as.
 * 2. **`ArtifactStore.write` works at all.** It has *no production caller* —
 *    docs/plans/260827j-transactional-stage-runner.md says so in as many words — and
 *    the first time anything called it, it failed: `writeAtomic` never created
 *    its directory, because every stage `mkdir`s for itself before its own
 *    `writeFile`. Landing D deletes those stage-level `mkdir`s. Fixed in the
 *    same commit as this file.
 *
 * ## The first version of this test proved nothing, and the reason is the point
 *
 * It compared `readParts(source, …)` against `readParts(destination, …)` — the
 * function under test, on both sides of the equals. Deleting a kind from
 * `readParts` deleted it from *both* readings, and all thirteen assertions
 * stayed green. Checked against the broken state, as this repo's rule says, and
 * the check itself was blind: docs/reusable/silent-success.md, one layer up
 * from where it usually bites.
 *
 * So the expected result is now **a written-out list of files**. It is a
 * fixture; a literal is exactly right, it cannot agree with a bug in the code
 * it is checking, and if the copy drops an artefact the list says which one.
 *
 * ## How to watch it go red
 *
 * Make `readParts` skip a kind — `if (kind === "meta") continue;` — and
 * *"writes every file the store owns"* fails naming `meta.json`. Make
 * `copyArtefacts` write an empty part set instead of skipping, and *"does not
 * invent a step"* fails. Both were watched failing that way, after the first
 * version of this file was watched **passing** against both.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STEPS, STEP_ORDER } from "../src/pipeline.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { StepName } from "../src/types.js";
import { copyArtefacts, readParts } from "../src/store/copy-artefacts.js";
import { FIXTURE_ROOT, requireFixture } from "./helpers/require-fixture.js";

const SLUG = "writes";

/** `data/` and `output/` under one root — the filesystem store's `locate`. */
const locate = (root: string) => () => ({
  dir: path.join(root, "data", SLUG),
  htmlFile: path.join(root, "output", `${SLUG}.html`),
});

/**
 * Every file the artefact store owns for `data/writes`, written out rather than
 * derived — see the header. Both columns are relative to a store's root.
 *
 * Absent on purpose: `chat.json`, `comments.json`, `searches.json`,
 * `shelf.json`, `glossary-lookups.json` are the **reader's** state and the
 * store explicitly excludes them (src/store/artifacts.ts). `raw.html` is
 * absent too, and that is the one genuinely interesting omission: the `raw`
 * artefact is the *manifest*, and the bytes it names are not the store's to
 * move. Under Postgres they will be in the bucket instead.
 */
const OWNED = [
  "data/writes/raw.json",
  "data/writes/meta.json",
  "data/writes/tree.json",
  "data/writes/labels.json",
  "data/writes/blocks.json",
  "data/writes/arc.json",
  "data/writes/tweets.json",
  "data/writes/glossary.json",
  /* **No `summary.json`.** The stage that wrote it and the `summary` artefact
     kind both went on 2026-08-31 (docs/plans/260831s-gist-only-summaries.md), so the
     store no longer owns the file — `data/writes/summary.json` is still on disk
     and is now just a file in the directory, like `chat.json`. The Postgres
     column that held it was kept and travels by `db:export`/`db:import`
     instead. */
  "data/writes/ideas.json",
  /* **`quotes.json` is deliberately NOT here yet**, and the reason is this
     list's own first assertion: every row asserts the fixture HAS the file
     before it asserts the copy does, so a row for an artefact nothing has
     generated fails rather than passing vacuously. Nothing has run
     `npm run quotes` against `data/writes`. Add the row on the first real run
     — `quotes` is already in the store's own maps and in
     tests/store-roundtrip.test.ts, so what is missing is the fixture and not
     the wiring. docs/project/quotes.md § What is still open. */
  "output/writes.html",
  "output/writes.blocks.json",
] as const;

/**
 * The source is the **committed corpus**, not `data/`.
 *
 * Until 2026-09-01 this file read `fsArtifacts` — the default store, rooted at
 * the repository — and compared against `path.join(ROOT, relative)`, also the
 * repository. So on a laptop it copied a developer's own working `data/writes`,
 * and on a fresh clone `data/` is gitignored and there was nothing to copy at
 * all. `OWNED` guarded the second case ("`${relative}` is missing from the
 * fixture"), which is why it failed loudly rather than passing empty — but it
 * never made the first case visible.
 *
 * The parts are derived from `OWNED` rather than listed twice: a row added
 * there is a file this asks the corpus for, in the same edit.
 * docs/plans/260901b-committed-fixture-corpus.md.
 */
requireFixture(
  SLUG,
  OWNED.map((relative) =>
    /* `data/writes/tree.json` → `tree.json`; `output/writes.blocks.json` →
       `output.blocks.json`, which is `fixturePath`'s name for the two files the
       store keeps outside the article's directory. */
    relative.startsWith("data/")
      ? path.basename(relative)
      : `output${path.basename(relative).slice(SLUG.length)}`,
  ),
);

let out = "";
let destination: ArtifactStore;
let copied: StepName[] = [];

const readIfThere = (file: string) => readFile(file, "utf-8").catch(() => null);

describe("copying an article between two artefact stores", () => {
  beforeAll(async () => {
    out = await mkdtemp(path.join(tmpdir(), "spideryarn-copy-"));
    destination = createFsArtifactStore(locate(out));
    copied = await copyArtefacts(
      createFsArtifactStore(locate(FIXTURE_ROOT)),
      destination,
      SLUG,
    );
  }, 60_000);

  afterAll(async () => {
    await rm(out, { recursive: true, force: true });
  });

  it("copies something at all", () => {
    /* First, because every assertion below is vacuously true over an empty
       copy, and an article the source store has never heard of would produce
       exactly that. */
    expect(copied.length).toBeGreaterThan(0);
  });

  it.each(OWNED)("writes every file the store owns: %s", async (relative) => {
    const before = await readIfThere(path.join(FIXTURE_ROOT, relative));
    // Guards the list itself: a fixture that lost a file would otherwise turn
    // this row into "absent equals absent".
    expect(before, `${relative} is missing from the fixture`).not.toBeNull();

    const after = await readIfThere(path.join(out, relative));
    expect(after, `${relative} was not copied`).not.toBeNull();

    /* Parsed, not byte-compared, for the JSON: the store re-serialises with its
       own indent, and a whitespace difference is not a lost artefact. The HTML
       goes through as text and is compared exactly. */
    if (relative.endsWith(".json")) {
      expect(JSON.parse(after as string)).toEqual(JSON.parse(before as string));
    } else {
      expect(after).toBe(before);
    }
  });

  it("copies nothing the reader owns", async () => {
    for (const name of ["chat.json", "comments.json", "searches.json", "shelf.json"]) {
      expect(await readIfThere(path.join(out, "data", SLUG, name))).toBeNull();
    }
  });

  it("leaves every copied step finished, not merely written", async () => {
    /* A written artefact and a completed step are two different facts. The
       filesystem is forgiving — `has` parses the files and says yes — but the
       Postgres adapter cannot be, because carry-forward means a value can be
       present without this step having produced it. So the copy runs
       `beginStep`/`finishStep` around the write, and this is the assertion that
       stops it quietly going back to `write` alone.

       `interrupted` is the honest question here: it is true exactly when a step
       began and never finished. */
    for (const step of copied) {
      expect(await destination.interrupted(SLUG, step), `${step} was left running`).toBe(false);
    }
  });

  it("keeps the raw manifest an object, not a string", async () => {
    /* `ArtifactMap["raw"]` said `string` until 2026-08-27 and nothing caught it,
       because nothing called `read`. This calls it. */
    const raw = await destination.read(SLUG, "fetch", "raw");
    expect(raw).not.toBeNull();
    expect(typeof raw).toBe("object");
    expect(raw).toHaveProperty("kind");
  });
});

describe("copying an article that has only been fetched", () => {
  /* A second, deliberately sparse source. `data/writes` has been through every
     stage, so over it "a step with nothing is skipped" has no case to run on —
     which is how the first version of this file passed while `copyArtefacts`
     wrote empty part sets. */
  let from = "";
  let to = "";
  let sparse: StepName[] = [];

  beforeAll(async () => {
    from = await mkdtemp(path.join(tmpdir(), "spideryarn-sparse-from-"));
    to = await mkdtemp(path.join(tmpdir(), "spideryarn-sparse-to-"));
    await mkdir(path.join(from, "data", SLUG), { recursive: true });
    // The manifest alone: `fetch` produces `raw`, and `raw` *is* the manifest.
    await writeFile(
      path.join(from, "data", SLUG, "raw.json"),
      await readFile(path.join(FIXTURE_ROOT, "data", SLUG, "raw.json"), "utf-8"),
      "utf-8",
    );

    sparse = await copyArtefacts(
      createFsArtifactStore(locate(from)),
      createFsArtifactStore(locate(to)),
      SLUG,
    );
  }, 60_000);

  afterAll(async () => {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  });

  it("refuses a source holding half a step, rather than finishing it", async () => {
    /* `extract` declares two products. A source with one of them is a broken
       fixture, and copying it would call `finishStep` on a step that never
       completed — which `articleMetadata` reads as done for any unstamped step.
       Loud beats plausible. */
    const half = await mkdtemp(path.join(tmpdir(), "spideryarn-half-"));
    const halfTo = await mkdtemp(path.join(tmpdir(), "spideryarn-half-to-"));
    try {
      await mkdir(path.join(half, "data", SLUG), { recursive: true });
      await mkdir(path.join(half, "output"), { recursive: true });
      // `extract` produces extractedHtml *and* meta; give it only the HTML.
      await writeFile(path.join(half, "output", `${SLUG}.html`), "<p>half a step</p>", "utf8");

      await expect(
        copyArtefacts(
          createFsArtifactStore(locate(half)),
          createFsArtifactStore(locate(halfTo)),
          SLUG,
        ),
      ).rejects.toThrow(/some but not all of extract/);
    } finally {
      await rm(half, { recursive: true, force: true });
      await rm(halfTo, { recursive: true, force: true });
    }
  });

  it("copies the one step it has", () => {
    expect(sparse).toEqual(["fetch"]);
  });

  it("does not invent a step the source never had", async () => {
    /* Writing an empty part set would record a step as having run — worse than
       missing, because `stepIsDone` would then skip it. */
    const destination = createFsArtifactStore(locate(to));
    for (const step of STEP_ORDER) {
      if (step === "fetch") continue;
      expect(await destination.has(SLUG, step, STEPS[step].produces)).toBe(false);
      expect(Object.keys(await readParts(destination, SLUG, step))).toEqual([]);
    }
  });
});
