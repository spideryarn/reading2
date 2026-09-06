/**
 * Copying an article between two stores, through the seam and nothing else.
 *
 * This is the replacement for `db:import` in the three suites that use it to
 * get an article into Postgres — docs/plans/260827aa-delete-the-importer.md § What it
 * costs. Here it is exercised **fixture-to-memory**, because that half needs no
 * database and can therefore be proved without one.
 *
 * ## What it is really testing
 *
 * Two things, and the second is a bonus that matters.
 *
 * 1. **`readParts` and `copyArtefacts` preserve everything.** Every artefact of
 *    every step arrives at the other end equal to what it left as.
 * 2. **`ArtifactStore.write` works at all.** It had *no production caller* when
 *    this file was written — docs/plans/260827j-transactional-stage-runner.md
 *    says so in as many words — and the first time anything called it, it
 *    failed: `writeAtomic` in the filesystem store never created its directory,
 *    because every stage `mkdir`ed for itself before its own `writeFile`. Fixed
 *    in the same commit as this file, and both that store and those stage-level
 *    `mkdir`s are gone now.
 *
 * ## Both ends changed on 2026-09-05, and the list is what stayed
 *
 * It ran filesystem-to-filesystem until the filesystem store was deleted
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § G). The source is `helpers/fixture-artefacts.ts` — a reader over the same
 * committed corpus, and the one production callers already pass to
 * `copyArtefacts` as an `ArtifactSource`; the destination is
 * `helpers/memory-artefacts.ts`. Neither end has paths in it, so the written-out
 * expectation is a list of **`(step, kind)` pairs** rather than of files, with
 * the fixture's filename beside each so `requireFixture` still names a missing
 * one at module scope.
 *
 * **That is one more row than the eleven files, and the extra row is real
 * coverage.** On disk `extract/extractedHtml` and `blocks/stampedHtml` were
 * the same `output/writes.html` — stage 3 overwrites stage 2's page in place —
 * so a single row stood for two artefacts and a copy that dropped either one
 * still left the file there, written by the other. They are two values in
 * Postgres and two in the memory store, and now two rows.
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
 * So the expected result is a **written-out list**. It is a fixture; a literal
 * is exactly right, it cannot agree with a bug in the code it is checking, and
 * if the copy drops an artefact the list says which one.
 *
 * ## How to watch it go red
 *
 * Make `readParts` skip a kind — `if (kind === "meta") continue;` — and
 * *"carries every artefact the store owns"* fails naming `extract/meta`. Make
 * `copyArtefacts` write an empty part set instead of skipping, and *"does not
 * invent a step"* fails. Both were watched failing that way, after the first
 * version of this file was watched **passing** against both.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { STEPS, STEP_ORDER } from "../src/pipeline.js";
import type { ArtifactKind } from "../src/store/artifacts.js";
import type { StepName } from "../src/types.js";
import { copyArtefacts, readParts } from "../src/store/copy-artefacts.js";
import { fixtureArtefacts } from "./helpers/fixture-artefacts.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import type { MemoryArtifactStore } from "./helpers/memory-artefacts.js";
import { FIXTURE_ROOT, requireFixture } from "./helpers/require-fixture.js";

const SLUG = "writes";

/**
 * Every artefact the store owns for `data/writes`, written out rather than
 * derived — see the header.
 *
 * `part` is the fixture's own filename, in `requireFixture`'s vocabulary, and it
 * is here so that a corpus missing a file is named at module scope rather than
 * three assertions later. Two rows share `output.html`; that is the aliasing the
 * filesystem had and neither store has.
 *
 * Absent on purpose: `chat.json`, `comments.json`, `searches.json`,
 * `shelf.json`, `glossary-lookups.json` are the **reader's** state and the
 * store explicitly excludes them (src/store/artifacts.ts). `raw.html` is
 * absent too, and that is the one genuinely interesting omission: the `raw`
 * artefact is the *manifest*, and the bytes it names are not the store's to
 * move — they are in the bucket instead.
 */
const OWNED = [
  { step: "fetch", kind: "raw", part: "raw.json" },
  { step: "extract", kind: "extractedHtml", part: "output.html" },
  { step: "extract", kind: "meta", part: "meta.json" },
  { step: "blocks", kind: "blocks", part: "output.blocks.json" },
  /* **The row the eleven-file list could not have.** It shared
     `output/writes.html` with `extract/extractedHtml` above. */
  { step: "blocks", kind: "stampedHtml", part: "output.html" },
  { step: "hierarchy", kind: "tree", part: "tree.json" },
  { step: "hierarchy", kind: "labels", part: "labels.json" },
  { step: "hierarchy", kind: "blocks", part: "blocks.json" },
  { step: "arc", kind: "arc", part: "arc.json" },
  { step: "tweets", kind: "tweets", part: "tweets.json" },
  { step: "glossary", kind: "glossary", part: "glossary.json" },
  /* **No `summary`.** The stage that wrote it and the `summary` artefact kind
     both went on 2026-08-31 (docs/plans/260831s-gist-only-summaries.md), so the
     store no longer owns it — `data/writes/summary.json` is still in the corpus
     and is now just a file in the directory, like `chat.json`. The Postgres
     column that held it was kept. */
  { step: "ideas", kind: "ideas", part: "ideas.json" },
  /* **`quotes` is deliberately NOT here yet**, and the reason is this list's own
     first assertion: every row asserts the fixture HAS the artefact before it
     asserts the copy does, so a row for something nothing has generated fails
     rather than passing vacuously. Nothing has run `npm run quotes` against
     `data/writes`. Add the row on the first real run — `quotes` is already in
     the store's own maps and in tests/store-roundtrip.test.ts, so what is
     missing is the fixture and not the wiring.
     docs/project/quotes.md § What is still open. */
] as const satisfies readonly { step: StepName; kind: ArtifactKind; part: string }[];

/**
 * The source is the **committed corpus**, not `data/`.
 *
 * Until 2026-09-01 this file read `fsArtifacts` — the default store, rooted at
 * the repository — and compared against paths under the repository too. So on a
 * laptop it copied a developer's own working `data/writes`, and on a fresh clone
 * `data/` is gitignored and there was nothing to copy at all. `OWNED` guarded
 * the second case, which is why it failed loudly rather than passing empty — but
 * it never made the first case visible.
 * docs/plans/260901b-committed-fixture-corpus.md.
 *
 * The parts are derived from `OWNED` rather than listed twice: a row added there
 * is a file this asks the corpus for, in the same edit. De-duplicated because
 * two rows name `output.html`.
 */
requireFixture(SLUG, [...new Set(OWNED.map((row) => row.part))]);

const source = fixtureArtefacts(FIXTURE_ROOT);

let destination: MemoryArtifactStore;
let copied: StepName[] = [];

describe("copying an article between two artefact stores", () => {
  beforeAll(async () => {
    destination = memoryArtefacts();
    copied = await copyArtefacts(source, destination, SLUG);
  }, 60_000);

  it("copies something at all", () => {
    /* First, because every assertion below is vacuously true over an empty
       copy, and an article the source has never heard of would produce
       exactly that. */
    expect(copied.length).toBeGreaterThan(0);
  });

  it.each(OWNED)("carries every artefact the store owns: $step/$kind", async ({ step, kind }) => {
    const before = await source.read(SLUG, step, kind);
    // Guards the list itself: a corpus that lost a file would otherwise turn
    // this row into "absent equals absent".
    expect(before, `${step}/${kind} is missing from the fixture`).not.toBeNull();

    const after = await destination.read(SLUG, step, kind);
    expect(after, `${step}/${kind} was not copied`).not.toBeNull();

    /* Deep equality of the decoded artefacts, which is what the copy moves.
       The filesystem comparison this replaced had to parse the JSON by hand to
       avoid failing on the store's own indent; there are no bytes here to
       differ in whitespace. The two HTML kinds are strings and compare as
       strings. */
    expect(after).toEqual(before);
  });

  /**
   * ***copies nothing the reader owns* stood here until 2026-09-05, and this is
   * the weaker thing that replaced it.**
   *
   * It listed `chat.json`, `comments.json`, `searches.json` and `shelf.json` and
   * asserted none of them appeared in the destination *directory*. There is no
   * directory now, and no way to ask a store for a file it was never given a
   * name for — the exclusion is upstream of the copy, in what `ArtifactKind` is
   * allowed to be. So the question this can still ask is the one the copy
   * inherits: **is any of the reader's state a thing a step claims to produce?**
   * A `chat` added to some step's `produces` is exactly how the old case would
   * have gone red, and it is the only way it could have.
   */
  it("has no kind for anything the reader owns", () => {
    const produced = new Set<string>(STEP_ORDER.flatMap((step) => [...STEPS[step].produces]));
    for (const readers of ["chat", "comments", "searches", "shelf", "glossaryLookups"]) {
      expect(produced.has(readers), `${readers} is the reader's, not the store's`).toBe(false);
    }
  });

  it("leaves every copied step finished, not merely written", async () => {
    /* A written artefact and a completed step are two different facts. The
       filesystem was forgiving — `has` parsed the files and said yes — but the
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
     wrote empty part sets.

     It was a `mkdtemp` holding one `raw.json` until 2026-09-05; it is a memory
     store holding one planted artefact now, and `plant` is the same act — a
     value the store has that this run did not write. */
  let to: MemoryArtifactStore;
  let sparse: StepName[] = [];

  beforeAll(async () => {
    const from = memoryArtefacts();
    // The manifest alone: `fetch` produces `raw`, and `raw` *is* the manifest.
    from.plant(SLUG, "fetch", "raw", await source.read(SLUG, "fetch", "raw"));

    to = memoryArtefacts();
    sparse = await copyArtefacts(from, to, SLUG);
  }, 60_000);

  it("refuses a source holding half a step, rather than finishing it", async () => {
    /* `extract` declares two products. A source with one of them is a broken
       fixture, and copying it would call `finishStep` on a step that never
       completed — which `articleMetadata` reads as done for any unstamped step.
       Loud beats plausible. */
    const half = memoryArtefacts();
    // `extract` produces extractedHtml *and* meta; give it only the HTML.
    half.plant(SLUG, "extract", "extractedHtml", "<p>half a step</p>");

    await expect(copyArtefacts(half, memoryArtefacts(), SLUG)).rejects.toThrow(
      /some but not all of extract/,
    );
  });

  it("copies the one step it has", () => {
    expect(sparse).toEqual(["fetch"]);
  });

  it("does not invent a step the source never had", async () => {
    /* Writing an empty part set would record a step as having run — worse than
       missing, because `stepIsDone` would then skip it. */
    for (const step of STEP_ORDER) {
      if (step === "fetch") continue;
      expect(await to.has(SLUG, step, STEPS[step].produces)).toBe(false);
      expect(Object.keys(await readParts(to, SLUG, step))).toEqual([]);
    }
  });
});
