/**
 * **Stages 1, 2 and 3 in one sequence, through the real artefact store.**
 *
 * Every other test in this repo asks about one seam. This one asks whether the
 * seams *join*: `fetch` stores a document and returns a manifest naming it,
 * `extract` finds that document by content address and returns the article,
 * `blocks` splits the article and stamps ids into it. Each of those passes on
 * its own; a pair that disagrees about what crosses between them passes on its
 * own too.
 *
 * It exists because stage 2 of docs/plans/260831b-finish-the-database-move.md changed
 * what crosses **every** one of those boundaries on the same day — the bytes
 * moved from `data/<slug>/raw.html` to a content-addressed object, the article
 * moved from a file to a return value, and the blocks moved from a file to a
 * `parts` map. The unit tests were converted alongside, by three different
 * agents, which is exactly the arrangement where each half is checked against
 * the other half's *new* assumption and nothing checks the pair.
 *
 * **No network and no model call.** Stage 1's network half is the one thing
 * skipped: the test builds the `FetchedDocument` that `fetchDocument` would
 * have returned and hands it to `writeRaw`, which is where the storage decision
 * actually lives. Stage 2's HTML path is Readability, and stage 3 is a parser;
 * neither costs anything.
 *
 * ## The two questions only this file asks
 *
 * **`isDone` must answer true immediately after a run.** `blocksMatchTheirHtml`
 * re-derives the blocks from the HTML the store holds and compares them against
 * the stored ones. An over-firing version of that guard makes stage 3 re-run for
 * ever while every unit test stays green, because a guard is normally asked
 * about a fixture rather than about the output of the run before it. Two earlier
 * versions of this guard did over-fire, and neither was caught this way.
 *
 * **A second run must carry every id.** Block ids are the spine every comment,
 * highlight and note is anchored to (docs/project/block-ids.md), and the whole
 * reason random ids are survivable is that a re-run matches the previous run's
 * blocks and keeps their ids. `assertIdsCarried` refuses when they do not — but
 * only when it is given a baseline, and `previousBlocksFrom` gets that baseline
 * from the store. So this asserts the ids are *identical*, not merely that the
 * count matches: two equal totals made of entirely different ids is the failure.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FetchedDocument } from "../src/fetch.js";
import { writeRaw } from "../src/fetch.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { STEPS, type StepContext } from "../src/pipeline.js";
import { fsArtifacts } from "../src/store/artifacts-fs.js";
import { DATA_ROOT_ENV } from "../src/store/data-root.js";

const SLUG = "test-end-to-end-probe";

/* Long enough for Readability to keep: it drops short paragraphs, and an
   article that came back empty would fail this file for a reason that has
   nothing to do with what it is about. */
const HTML = `<!doctype html><html><head><title>A Probe Article</title></head><body>
<article><h1>A Probe Article</h1>
<p>The first paragraph says something long enough for Readability to keep it, because a short one is dropped.</p>
<p>The second paragraph is also long enough to survive the extractor's minimum content length rule.</p>
<p>A third paragraph, so that the block splitter has more than two things to give ids to.</p>
</article></body></html>`;

let root = "";
let saved: string | undefined;

/** The document `fetchDocument` would have returned, without the network. */
function fetched(): FetchedDocument {
  return {
    kind: "html",
    requestedUrl: "https://example.test/probe",
    url: "https://example.test/probe",
    contentType: "text/html; charset=utf-8",
    encoding: "utf-8",
    bytes: new TextEncoder().encode(HTML),
    text: HTML,
    chain: ["https://example.test/probe"],
    fetchedAt: new Date().toISOString(),
  } as FetchedDocument;
}

function ctx(): StepContext {
  return {
    slug: SLUG,
    url: "https://example.test/probe",
    dir: path.join(root, "data", SLUG),
    htmlFile: path.join(root, "output", `${SLUG}.html`),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * Run one step the way the coordinator does: begin, run, write what it
 * returned, finish.
 *
 * **Deliberately not `fsStoreSession`.** That would bring the job store in, and
 * a job row is not what this file is about; what matters is that the artefacts
 * a step returns are the artefacts the next step reads. `checkProduct` is
 * asserted separately below rather than borrowed from the session.
 */
async function runStep(name: "extract" | "blocks"): Promise<Record<string, unknown>> {
  const attempt = await fsArtifacts.beginStep(SLUG, name);
  const product = await STEPS[name].run(ctx(), fsArtifacts);
  /* Every step in this pipeline is converted, so `parts` is required by the
     compiler — this asserts it at runtime too, because a `parts` that arrived
     as `undefined` through an `as` cast somewhere would otherwise write nothing
     and pass the postcondition against what the last run left. */
  expect(product.parts, `${name} returned no parts`).toBeDefined();
  await fsArtifacts.write(SLUG, name, product.parts ?? {}, product.stamp ?? {});
  await fsArtifacts.finishStep(SLUG, name, attempt);
  return product.parts as Record<string, unknown>;
}

beforeAll(async () => {
  saved = process.env[DATA_ROOT_ENV];
  root = await mkdtemp(path.join(tmpdir(), "spya-end-to-end-"));
  process.env[DATA_ROOT_ENV] = root;
});

afterAll(async () => {
  if (saved === undefined) delete process.env[DATA_ROOT_ENV];
  else process.env[DATA_ROOT_ENV] = saved;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("acquiring, extracting and splitting one article in one sequence", () => {
  let firstIds: string[] = [];

  it("stage 1 stores the document and returns a manifest that names it", async () => {
    const manifest = await writeRaw(fetched());
    /* The reference, not a path. This is the field stage 2 dereferences and the
       one `writeRawSource` turns into the Postgres row; a manifest without it
       reaches the artefact store naming no object and is refused outright. */
    expect(manifest.storedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.storedBytes).toBe(new TextEncoder().encode(HTML).byteLength);

    const attempt = await fsArtifacts.beginStep(SLUG, "fetch");
    await fsArtifacts.write(SLUG, "fetch", { raw: manifest }, {});
    await fsArtifacts.finishStep(SLUG, "fetch", attempt);
    expect(await fsArtifacts.read(SLUG, "fetch", "raw")).toMatchObject({
      storedSha256: manifest.storedSha256,
    });
  });

  it("stage 2 finds that document by content address and returns the article", async () => {
    const parts = await runStep("extract");
    expect(Object.keys(parts).sort()).toEqual(["extractedHtml", "meta"]);
    expect(parts.extractedHtml as string).toContain("A Probe Article");
  });

  it("stage 3 splits it and puts every id it minted into the HTML it returns", async () => {
    const parts = await runStep("blocks");
    expect(Object.keys(parts).sort()).toEqual(["blocks", "stampedHtml"]);

    const stored = await fsArtifacts.read(SLUG, "blocks", "blocks");
    firstIds = (stored?.blocks ?? []).map((b) => b.id);
    expect(firstIds.length).toBeGreaterThan(2);

    /* **The pair, not either half.** Returning the blocks without the ids in the
       document, or returning stage 2's HTML unchanged where the stamped HTML
       belongs, both compile — and the second is what nothing in this repository
       caught until 2026-08-31, because the guard that notices runs at the *next*
       skip check and answers "not current", so the step re-runs and writes the
       same wrong pair for ever. */
    const stamped = await fsArtifacts.read(SLUG, "blocks", "stampedHtml");
    for (const id of firstIds) expect(stamped ?? "", `${id} is not in the HTML`).toContain(id);

    /* **And the ids are not enough.** A pair whose ids all match while the
       *text* differs passes every id-level check here and in
       `blocksMatchTheirHtml`, which re-derives with `splitIntoBlocks(extracted,
       stored)` and so corrupts both sides identically if the corruption is
       inside the splitter. The step would then report itself **done**, for
       ever, holding a document and a block list that describe different words.

       Asking the stored HTML what it says — no baseline, so nothing can be
       carried over from the very list under test — has no such assumption. It
       is the one question in this file that the production guard cannot ask of
       itself. GPT Sol and the agent that found the variant Sol's own shape
       missed, 2026-08-31. */
    const reread = splitIntoBlocks(stamped ?? "");
    expect(reread.blocks.map((b) => b.text)).toEqual(
      (await fsArtifacts.read(SLUG, "blocks", "blocks"))?.blocks.map((b) => b.text),
    );
  });

  it("and then reports itself done, rather than stale for ever", async () => {
    expect(await STEPS.blocks.isDone?.(ctx(), fsArtifacts)).toBe(true);
  });

  /**
   * **Re-extract first, and the re-extraction is the whole point.**
   *
   * A second `blocks` run on its own proves nothing here, and the first version
   * of this test did exactly that and was vacuous. On the filesystem
   * `extractedHtml` and `stampedHtml` are the same file, so stage 3 re-reads a
   * document that *already carries the ids it wrote last time* and
   * `splitIntoBlocks` simply reuses them. Deleting the baseline entirely —
   * `previous = undefined` — left this green, which is how the hole was found.
   *
   * Running stage 2 again puts an id-free document back in place, which is what
   * a real re-extraction does and what the contract exists for. Now the only
   * place the old ids can come from is the baseline `previousBlocksFrom` reads
   * out of the store, so the assertion has something to be about.
   *
   * This is also fault 2 of docs/plans/260831b-finish-the-database-move.md in miniature:
   * in Postgres `extractedHtml` is a separate column that never carries ids, so
   * *every* run is this run, and a baseline that silently answers "first ingest"
   * mints a fresh id for every paragraph and reports success.
   */
  it("carries every id across a re-extraction, rather than minting new ones", async () => {
    await runStep("extract");
    const extracted = await fsArtifacts.read(SLUG, "extract", "extractedHtml");
    for (const id of firstIds) {
      expect(extracted ?? "", "re-extraction must put an id-free document back").not.toContain(id);
    }

    await runStep("blocks");
    const stored = await fsArtifacts.read(SLUG, "blocks", "blocks");
    /* The ids themselves, in order — not the count. Two equal totals made of
       entirely different ids is the failure this guards, and it is the one that
       silently orphans every comment, highlight and note in the database. */
    expect((stored?.blocks ?? []).map((b) => b.id)).toEqual(firstIds);
  });
});
