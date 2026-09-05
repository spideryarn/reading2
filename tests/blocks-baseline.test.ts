/**
 * Stage 3 gets the previous run's blocks from the **store**, not from a path.
 *
 * This is the file that stands behind
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters
 * once the artefacts stop being files. Stage 3 keeps a paragraph's id across a
 * re-extraction by matching this run's blocks against the previous run's, and
 * until 2026-08-28 it got the previous run by reading
 * `output/<slug>.blocks.json` inside a `try/catch` whose `catch` said *first run
 * for this article*. The day the pipeline's artefacts move to Postgres that read
 * fails on every run, every article silently becomes a first ingest, and every
 * comment, saved search and ToC row in the database stops naming anything.
 * Nothing throws. See docs/plans/260827aa-delete-the-importer.md § Three stages carry
 * identity in a file.
 *
 * ## Each of these was watched failing, and against what
 *
 * A check that has never been red is not evidence
 * (docs/reusable/silent-success.md), and the shape of bug here is precisely one
 * that agrees with the code. So:
 *
 * | mutation | what fails |
 * |---|---|
 * | `previousBlocksFrom` returns `undefined` instead of reading | *carries every id across a re-extraction…* (both stores) |
 * | drop the `hasEarlierBlocks` question | *refuses to mint when a baseline it should have had is missing* |
 * | swallow a throwing store read | *lets an infrastructure fault through untouched* |
 * | drop `assertIdsCarried` | *stops a run that kept none of the previous ids* |
 * | drop `assertSomethingWasProduced` | *refuses a first ingest that produced no blocks at all* — and this one was watched red **before** the guard existed: `runBlocks` resolved with `stats.total: 0` and wrote `{"sanitizer":3,"blocks":[]}` |
 *
 * ## The Postgres half needs a database and says so out loud
 *
 * It skips when there is none — but unlike every other Postgres suite here, it
 * says so under the reporter `npm test` actually uses. Those all warn with
 * `console.warn`, which vitest's default reporter does not print, so in practice
 * they skip in silence. `process.stderr.write` is what gets through; the
 * measurement behind that is beside the probe below.
 *
 * The distinction is worth the paragraph, because "0 failures" from a suite that
 * never ran looks exactly like a pass.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  BLOCKS_INPUT_HTML,
  BaselineMissing,
  type BlocksRun,
  IdsNotCarried,
  NoBlocksProduced,
  blocksArtefact,
  previousBlocksFrom,
  runBlocks,
  splitIntoBlocks,
} from "../src/blocks.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import type { Db } from "../src/db/client.js";
import { mintId } from "../src/ids.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STEPS } from "../src/pipeline.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { type MemoryArtifactStore, memoryArtefacts } from "./helpers/memory-artefacts.js";
import { pgReady } from "./helpers/pg-ready.js";
import { insertWhenSlotFree } from "./helpers/running-slot.js";
import { type AstNode, lineOf, parseSource, walkAst } from "./helpers/ts-ast.js";
import type { Block, OwnerId } from "../src/types.js";

/** The transaction type, derived the same way `src/store/artifacts-pg.ts` derives it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Thrown to unwind a fixture transaction; never an error anybody has to see. */
class RollBack extends Error {}

/* ------------------------------------------------------------ the article -- */

/**
 * What stage 2 hands over: two paragraphs and a heading, no ids anywhere.
 *
 * **No ids is the whole point.** Readability writes a fresh document on every
 * extraction, so after a re-extraction there is nothing in the HTML to preserve
 * and the `isSpideryarnId` branch in `splitIntoBlocks` has nothing to do. Every
 * id in the second run has to come from the baseline or be minted, which is the
 * one condition under which this test can tell the two apart.
 */
const EXTRACTED = `<!doctype html><html><body>
<h2>The opening</h2>
<p>A first paragraph, which does not change between the two runs.</p>
<p>A second paragraph, which does not change either.</p>
</body></html>`;

/**
 * What a page that never gave up its prose leaves stage 2 holding: the shell of
 * a JS-rendered paywall. No text anywhere, so extraction produces no blocks.
 *
 * Deliberately not an empty `<body>` — this is the shape a real fetch returns,
 * and it has to be one that genuinely reaches stage 3 rather than a document
 * nobody would ever hand it.
 */
const SHELL = `<!doctype html><html><body>
<div id="app"></div><script>window.__PAYWALL__ = true;</script>
</body></html>`;

/* -------------------------------------------------------- the filesystem -- */

interface Workspace {
  root: string;
  dir: string;
  htmlFile: string;
  store: ArtifactStore;
}

/**
 * A store over a throwaway directory, laid out the way the real one is:
 * stage 3's `a.blocks.json` beside the HTML, stage 4's inside `data/`.
 */
async function aWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-baseline-"));
  const dir = path.join(root, "data");
  await mkdir(dir, { recursive: true });
  const htmlFile = path.join(root, "a.html");
  return { root, dir, htmlFile, store: createFsArtifactStore(() => ({ dir, htmlFile })) };
}

const idsIn = (blocks: readonly Block[]): string[] => blocks.map((b) => b.id);

/**
 * What a caller does *around* `runBlocks`, which since 2026-08-31 reads nothing
 * and writes nothing: hand it the HTML, write back the stamped document and the
 * blocks. This is `main()`'s shape (src/blocks.ts); the pipeline's is the same
 * three moves with the artefact store where the disk is.
 *
 * **Here rather than exported from `src/`, on purpose.** Production has no file
 * paths left in this stage and must not grow one back. What the tests below
 * need it for is the half of the refusals that is about *absence*: "nothing was
 * written" cannot be observed of a pure function, so they observe it of the
 * thinnest possible caller that would have written something.
 *
 * The signature is the one `runBlocks` itself had until today, so a call site
 * that changed nothing but the name is doing the same thing it did before.
 */
async function runBlocksOverFile(opts: {
  htmlFile: string;
  jsonFile?: string;
  previous: Block[] | undefined;
}): Promise<BlocksRun & { jsonFile: string }> {
  const { htmlFile, previous } = opts;
  const jsonFile = opts.jsonFile ?? `${htmlFile.replace(/\.html$/, "")}.blocks.json`;

  const run = runBlocks({
    slug: path.basename(htmlFile).replace(/\.html$/, ""),
    extractedHtml: await readFile(htmlFile, "utf-8"),
    previous,
  });

  /* Both artefacts, and the HTML first — the order stage 3 wrote them in, and
     the one `blocksMatchTheirHtml` reasons about (src/pipeline.ts). */
  await writeFile(htmlFile, run.html, "utf-8");
  await writeFile(jsonFile, JSON.stringify(blocksArtefact(run.blocks), null, 2), "utf-8");
  return { ...run, jsonFile };
}

describe("the baseline, over the filesystem store", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  const workspace = async (): Promise<Workspace> => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    return w;
  };

  it("carries every id across a re-extraction, taking the baseline from the store", async () => {
    const { dir, htmlFile, store } = await workspace();

    // Run one: a genuine first ingest. Nothing to carry, so everything mints.
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile, previous: undefined });
    expect(first.stats.minted).toBe(3);
    expect(first.stats.carried).toBe(0);
    /* Stage 4's copy, which is what `hasEarlierBlocks` reads on this store. It
       exists here because a real article has been through stage 4 by now. */
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify(blocksArtefact(first.blocks)),
      "utf-8",
    );

    /* Stage 2 runs again and overwrites the HTML with an id-free document —
       the case random ids exist for. */
    await writeFile(htmlFile, EXTRACTED, "utf-8");

    const previous = await previousBlocksFrom(store, "a");
    expect(idsIn(previous ?? [])).toEqual(idsIn(first.blocks));

    const second = await runBlocksOverFile({ htmlFile, previous });
    expect(second.stats.carried).toBe(3);
    expect(second.stats.minted).toBe(0);
    /* The exact ids, in order — not a count of survivors. Two runs that each
       produced three ids and share none of them would pass a count. */
    expect(idsIn(second.blocks)).toEqual(idsIn(first.blocks));
  });

  it("refuses to mint when a baseline it should have had is missing", async () => {
    const { dir, htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile, previous: undefined });

    /* Stage 4's copy still lists every id this article ever had; stage 3's own
       copy — the baseline — has gone. block-ids.md calls that file a source
       artefact rather than a cache for exactly this reason. */
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify(blocksArtefact(first.blocks)),
      "utf-8",
    );
    await rm(htmlFile.replace(/\.html$/, ".blocks.json"));

    await expect(previousBlocksFrom(store, "a")).rejects.toBeInstanceOf(BaselineMissing);
  });

  /**
   * **A file that will not parse is not a file that is not there**, and until
   * 2026-08-28 this store gave both answers as `false`: `readOne` returns `null`
   * for absent, corrupt and over-the-ceiling alike, so a `data/<slug>/blocks.json`
   * truncated by a kill mid-write said *first ingest* and stage 3 minted a whole
   * new identity set over an article that had one.
   *
   * The previous version of this seam argued the case was harmless because "in
   * that state there is genuinely nothing left to carry". That is a different
   * question. Whether the ids are *recoverable* is not whether we should
   * *proceed*: somebody with a backup, a Dropbox history or a stash can put the
   * file back, and minting takes that possibility away silently while reporting
   * success. Stopping costs five minutes and keeps every anchor. GPT Sol,
   * 2026-08-28.
   */
  it("refuses when stage 4's copy is there but will not parse", async () => {
    const { dir, htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile, previous: undefined });

    /* Cut off halfway, which is what a `writeFile` killed in the middle leaves.
       Every id this article has ever had is still in those bytes — that is the
       point: the file is unusable, not empty. */
    const whole = JSON.stringify(blocksArtefact(first.blocks));
    await writeFile(path.join(dir, "blocks.json"), whole.slice(0, whole.length >> 1), "utf-8");
    await rm(htmlFile.replace(/\.html$/, ".blocks.json"));

    await expect(previousBlocksFrom(store, "a")).rejects.toBeInstanceOf(BaselineMissing);
  });

  it("refuses when stage 4's copy is over the size this store can read", async () => {
    const { dir, htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile, previous: undefined });

    /* Valid JSON, listing the real ids, and one byte past the 32 MiB ceiling in
       `DECODERS` — so the only thing wrong with it is that this store will not
       read it. The other half of the same misclassification, and the one that
       does not resolve itself: `readOne` warns and returns `null` for ever. */
    const artefact = blocksArtefact(first.blocks);
    const padded = {
      ...artefact,
      blocks: artefact.blocks.map((b, i) =>
        i === 0 ? { ...b, text: `${b.text}${"x".repeat(32 * 1024 * 1024)}` } : b,
      ),
    };
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify(padded), "utf-8");
    await rm(htmlFile.replace(/\.html$/, ".blocks.json"));

    await expect(previousBlocksFrom(store, "a")).rejects.toBeInstanceOf(BaselineMissing);
  });

  it("mints quietly when this really is a first ingest", async () => {
    const { store } = await workspace();
    /* Nothing on disk at all: no baseline and no earlier run to say there
       should have been one. This is the case that must NOT throw, and it is
       what stops the rule above turning every new article into an error. */
    await expect(previousBlocksFrom(store, "a")).resolves.toBeUndefined();
  });

  it("lets an infrastructure fault through untouched, rather than calling it a first ingest", async () => {
    const { store } = await workspace();
    const broken: ArtifactStore = {
      ...store,
      read: () => Promise.reject(new Error("connection terminated unexpectedly")),
    };
    /* The difference that matters: a store that cannot answer is not a store
       that answered "nothing". Swallowing this is how a database hiccup becomes
       permanent identity loss. */
    await expect(previousBlocksFrom(broken, "a")).rejects.toThrow(/connection terminated/);
  });

  it("asks the store, and does not fall back to reading the file itself", async () => {
    const { htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile, previous: undefined });

    /* The baseline is sitting on disk exactly where the old code read it from.
       A store that says there is none must win, or the seam is decorative and
       landing D will take the files away without anything noticing. */
    const empty: ArtifactStore = { ...store, read: () => Promise.resolve(null) };
    await expect(previousBlocksFrom(empty, "a")).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(first.jsonFile, "utf-8")).blocks).toHaveLength(3);
  });
});

/* ------------------------------------------------------------- the guard -- */

describe("the runtime guard", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  /** A previous run of a completely different article, so nothing can match. */
  const strangers: Block[] = [
    {
      id: "spya-zzzzz2",
      tag: "p",
      kind: "text",
      text: "Words from somewhere else entirely.",
      words: 5,
      html: "<p>Words from somewhere else entirely.</p>",
      gistable: true,
    },
  ];

  it("stops a run that kept none of the previous ids", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");

    /* A non-empty baseline and a non-empty output that share nothing. Every
       anchor into this article would be pointing at a block that no longer
       exists, and the step would have reported success. */
    await expect(
      runBlocksOverFile({ htmlFile: w.htmlFile, previous: strangers }),
    ).rejects.toBeInstanceOf(IdsNotCarried);

    /* **And it names the article.** The slug used to be
       `path.basename(htmlFile)`; with the path gone it is a parameter, and a
       parameter is exactly the kind of thing a conversion fills in with
       something plausible and constant. A refusal that says "blocks" and not
       which one is a log line nobody can act on. */
    await expect(
      runBlocksOverFile({ htmlFile: w.htmlFile, previous: strangers }),
    ).rejects.toThrow(/blocks "a":/);
  });

  /**
   * **What "before it writes" means now that stage 3 does not write.** The
   * guards used to stand between `splitIntoBlocks` and two `writeFile`s inside
   * `runBlocks`; they now stand between it and the single `return`, so a refused
   * run hands its caller nothing to store. This exercises that through the
   * thinnest caller there is — one that writes exactly what it is given — which
   * is the shape of both real ones (`main()`, and the step through the store).
   */
  it("refuses before it writes, so the previous artefacts survive the refusal", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const jsonFile = w.htmlFile.replace(/\.html$/, ".blocks.json");
    await writeFile(jsonFile, JSON.stringify(blocksArtefact(strangers)), "utf-8");

    await expect(runBlocksOverFile({ htmlFile: w.htmlFile, previous: strangers })).rejects.toThrow();

    /* Still the baseline, not half of a run that was refused. A guard that
       destroys what it is protecting is worse than no guard. */
    const after = JSON.parse(await readFile(jsonFile, "utf-8"));
    expect(idsIn(after.blocks)).toEqual(["spya-zzzzz2"]);
    expect(await readFile(w.htmlFile, "utf-8")).toBe(EXTRACTED);
  });

  /**
   * **Nothing is not something that carried nothing.** The guard used to return
   * early on an empty output, so a run whose extraction produced no blocks at
   * all — a paywall, an error page, a fetch that came back as a shell —
   * overwrote both artefacts with emptiness against a full baseline and reported
   * success. Zero shared ids is zero shared ids however few there are on the
   * other side. GPT Sol, 2026-08-28.
   */
  it("stops a run that produced no blocks at all against a baseline that had some", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    const jsonFile = w.htmlFile.replace(/\.html$/, ".blocks.json");
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile: w.htmlFile, previous: undefined });

    // What a paywall or an error page extracts to: a document with no prose.
    await writeFile(w.htmlFile, "<!doctype html><html><body></body></html>", "utf-8");
    await expect(
      runBlocksOverFile({ htmlFile: w.htmlFile, previous: first.blocks }),
    ).rejects.toBeInstanceOf(IdsNotCarried);

    /* And it refused before writing, so the article is still the article. */
    const after = JSON.parse(await readFile(jsonFile, "utf-8"));
    expect(idsIn(after.blocks)).toEqual(idsIn(first.blocks));
  });

  /**
   * **The half `assertIdsCarried` cannot reach, by construction.** It returns
   * early when there is no baseline (`if (!previous?.length) return;`), so on a
   * *first* ingest there is nothing to compare against and a run that produced
   * no blocks at all sailed through: `runBlocks` wrote `{"blocks":[]}` over both
   * artefacts and resolved, and every stage after it read an article with no
   * blocks in it. Nothing threw, every path existed and parsed, and the store's
   * shape check takes any array (`SHAPE` in src/store/artifacts.ts).
   *
   * The read-side half of this — `blocksMatchTheirHtml` in src/pipeline.ts —
   * notices only at the *next* skip check, by which time the empty artefact has
   * been the article for however long. This one refuses before `runBlocks`
   * returns, so the empty artefact is never handed to anybody to write.
   */
  it("refuses a first ingest that produced no blocks at all", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    const jsonFile = w.htmlFile.replace(/\.html$/, ".blocks.json");
    await writeFile(w.htmlFile, SHELL, "utf-8");

    await expect(
      runBlocksOverFile({ htmlFile: w.htmlFile, previous: undefined }),
    ).rejects.toBeInstanceOf(NoBlocksProduced);

    /* Refused *before* writing, like the baseline guard beside it: no empty
       artefact on disk, and stage 2's HTML untouched. An article that stopped
       at stage 3 can be re-run; one that recorded emptiness as its answer looks
       finished. */
    await expect(readFile(jsonFile, "utf-8")).rejects.toThrow(/ENOENT/);
    expect(await readFile(w.htmlFile, "utf-8")).toBe(SHELL);
  });

  it("says nothing on a first ingest, where minting everything is correct", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const run = await runBlocksOverFile({ htmlFile: w.htmlFile, previous: undefined });
    expect(run.stats.minted).toBe(3);
  });

  it("says nothing when even one id survives, because a threshold would be a guess", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocksOverFile({ htmlFile: w.htmlFile, previous: undefined });

    /* One paragraph unchanged, the rest of the baseline unrecognisable. A real
       partial loss, deliberately not an error — the numbers are in the step's
       log line instead. */
    const survivor = first.blocks[1]!;
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const run = await runBlocksOverFile({
      htmlFile: w.htmlFile,
      previous: [...strangers, survivor],
    });
    expect(idsIn(run.blocks)).toContain(survivor.id);
  });
});

/* ------------------------------------------------- what stage 3 hands back -- */

/**
 * **The two artefacts are one artefact, and nothing else can tell.**
 *
 * Since 2026-08-31 `runBlocks` returns the stamped HTML and the blocks instead
 * of writing them, and the step gives both to the store as
 * `parts: { stampedHtml, blocks }`. That makes a new way to be silently wrong
 * available for the first time: return the right blocks beside the *input*
 * document, and every id is in the database and none of them is in the HTML.
 * Nothing throws, the blocks are perfect, the article renders, and every
 * `#spya-…` anchor in it points at nothing.
 *
 * Nothing else in the repo catches it at the moment it happens.
 * `blocksMatchTheirHtml` (src/pipeline.ts) would notice — it compares
 * `splitIntoBlocks(extracted).html` against the stored `stampedHtml` — but only
 * at the *next* skip check, and its answer is "not current", so the step re-runs
 * and writes the same wrong pair again for ever. So this is the check at the
 * seam, and both halves below were watched red: returning `extractedHtml`
 * unchanged fails the first, and a `SplitResult.html` copied from the input
 * fails the second.
 */
describe("the stamped HTML stage 3 returns", () => {
  it("is the document the ids are actually in, not the one that came in", () => {
    const run = runBlocks({ slug: "a", extractedHtml: EXTRACTED, previous: undefined });

    expect(run.blocks).toHaveLength(3);
    /* Every id it claims, in the document it hands back. This is the assertion
       that would fail if the input were returned instead: `EXTRACTED` carries no
       ids at all, which is the whole point of the fixture. */
    for (const id of idsIn(run.blocks)) expect(run.html).toContain(`id="${id}"`);
    expect(run.html).not.toBe(EXTRACTED);
  });

  /**
   * The control, and it is not decoration. The assertion above passes just as
   * well against a `splitIntoBlocks` that stamps ids into a document nobody
   * keeps — so this pins that the returned HTML is *usable as stage 3's output*:
   * feed it back in and it is recognised, ids reused rather than re-minted.
   */
  it("is a document stage 3 recognises as already stamped", () => {
    const first = runBlocks({ slug: "a", extractedHtml: EXTRACTED, previous: undefined });
    const again = runBlocks({ slug: "a", extractedHtml: first.html, previous: first.blocks });

    expect(again.stats.reused).toBe(3);
    expect(again.stats.minted).toBe(0);
    expect(idsIn(again.blocks)).toEqual(idsIn(first.blocks));
  });

  /**
   * **The ids are not the pair.** The two above ask about ids, and every
   * assertion in them survives a `runBlocks` that keeps each id exactly where it
   * was and hands back a document whose *paragraphs say something else*: the ids
   * exist, they are in the HTML, all three are reused on a second pass, none is
   * minted. GPT Sol found that mutation on 2026-08-31 and it passed the whole
   * file. What it produces is a Postgres commit — one transaction, so genuinely
   * atomic — of a `stampedHtml` and a `blocks` that describe different text, and
   * then the stage re-runs on every job for ever, because `blocksMatchTheirHtml`
   * refuses it at each following skip check and its answer is *not current*
   * rather than *broken*.
   *
   * So the pair is asked about twice here, and the two questions are not the
   * same one:
   *
   * 1. **The replay**, which is `blocksMatchTheirHtml`'s own question
   *    (src/pipeline.ts § 2 and 3) asked at the seam where the answer still
   *    means something: stage 3 run again over stage 2's document, with these
   *    blocks as its baseline, must give this document and these blocks.
   * 2. **The re-read**, which the replay cannot ask. A replay runs
   *    `splitIntoBlocks` a second time, so anything wrong *inside*
   *    `splitIntoBlocks` is wrong identically on both sides and the comparison
   *    agrees with it — and that is not only a hole in this test, it is the same
   *    hole in `blocksMatchTheirHtml`, which would go on calling the step done.
   *    Parsing the returned HTML back out shares no such assumption: whatever
   *    the document actually says is what comes back.
   *
   * Both were watched red; the messages are in the review write-up.
   */
  it("describes the same text the blocks beside it claim", () => {
    const run = runBlocks({ slug: "a", extractedHtml: EXTRACTED, previous: undefined });

    const replay = splitIntoBlocks(EXTRACTED, run.blocks);
    expect(replay.html).toBe(run.html);
    expect(replay.blocks).toEqual(run.blocks);

    /* No baseline, deliberately. Handing `run.blocks` in would let
       `carryOverIds` put an id back onto a paragraph by matching its words, so a
       document that had lost its ids would still come back looking right; with
       nothing to help it, every id has to be in the bytes and every word beside
       it has to be the word the block claims. */
    const reread = splitIntoBlocks(run.html);
    expect(reread.blocks).toEqual(run.blocks);
  });
});

/* --------------------------------------------------------------- the step -- */

/**
 * **This was `npm run blocks` in a subprocess until 2026-09-05, and it is the
 * step now.**
 *
 * The command read an HTML file and wrote two — the stamped document back over
 * its input, and a `blocks.json` beside it — and `runBlocks` could not tell you
 * whether `main()` still opened and saved what it used to, because `main()` was
 * where all of that lived. So this ran the real command in a child process.
 *
 * That `main()` went with the move onto the queue (`scripts/stage.ts`), and the
 * two claims below moved down one layer to `STEPS.blocks.run`, which is now the
 * only thing that turns `runBlocks`'s answer into artefacts a store is handed.
 * Both are the same claims, and the second is the one worth keeping in front of
 * a store rather than in front of `runBlocks`: **the baseline a re-run reads is
 * what the previous run wrote**, which on the filesystem was a file it had just
 * saved and in Postgres is the draft's own block rows.
 *
 * Proved end to end as well, on 2026-09-05: `npm run blocks -- <slug> --force`
 * twice and then unforced against a corpus clone in the local database gave
 * `19 blocks, 0 new ids (19 kept)`, `19 blocks, 0 new ids (19 kept)`,
 * `skipped`, and **one distinct id set** across every revision of the article.
 */
describe("the step", () => {
  const stage3 = async (store: MemoryArtifactStore) => {
    const dir = await mkdtemp(path.join(tmpdir(), "spya-baseline-step-"));
    cleanUp.push(dir);
    return await STEPS.blocks.run(
      {
        slug: "a",
        dir,
        htmlFile: path.join(dir, "a.html"),
        report: () => {},
        signal: new AbortController().signal,
        cacheArticle: false,
      },
      store,
      nullCheckpointStore(),
    );
  };

  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  it("hands back the stamped HTML and the blocks, naming the same ids", async () => {
    const store = memoryArtefacts();
    store.plant("a", "extract", "extractedHtml", EXTRACTED);

    const first = await stage3(store);
    const blocks = (first.parts?.blocks as { blocks: Block[] }).blocks;
    const html = first.parts?.stampedHtml as string;
    expect(blocks).toHaveLength(3);
    /* The pair, again, and through what the store is handed this time: the ids
       in the artefact are the ids in the document beside it. */
    for (const block of blocks) expect(html).toContain(`id="${block.id}"`);

    /* **And a second run carries them**, which is what makes the command safe to
       type twice. The baseline it reads is what the first run wrote, so this is
       written back into the store the way the queue's commit would. */
    store.plant("a", "blocks", "blocks", blocksArtefact(blocks));
    const second = await stage3(store);
    expect(idsIn((second.parts?.blocks as { blocks: Block[] }).blocks)).toEqual(idsIn(blocks));
  });

  it("refuses a page with no prose in it, and writes nothing at all", async () => {
    const store = memoryArtefacts();
    store.plant("a", "extract", "extractedHtml", SHELL);

    await expect(stage3(store)).rejects.toThrow(/produced no blocks at all/);

    /* Nothing stored, and stage 2's document untouched — the same property the
       guards give the pipeline, observed at the seam where the store would have
       been written. `runBlocks` throws before it returns, so there is no `parts`
       for a caller to store; that is the mechanism, and this is the effect. */
    expect(await store.read("a", "blocks", "blocks")).toBeNull();
    expect(await store.read("a", "blocks", "stampedHtml")).toBeNull();
    expect(await store.read("a", "extract", "extractedHtml")).toBe(SHELL);
  });
});

/* --------------------------------------------------- which HTML stage 3 eats -- */

describe("the HTML stage 3 consumes", () => {
  it("is stage 2's, and never stage 3's own previous output", () => {
    /* Not a tautology, and not a style preference. On the filesystem the two
       are the same path and nobody could choose; in Postgres they are two
       columns, and reading `stampedHtml` would hand stage 3 last week's
       paragraphs already carrying this week's ids — a clean-looking run that
       re-publishes the previous article. Landing D reads this constant. */
    expect(BLOCKS_INPUT_HTML).toBe("extractedHtml");
  });
});

/* --------------------------------------- the argument that must not go missing -- */

/** The name this whole section is about. */
const STAGE_THREE = "splitIntoBlocks";

interface Reference {
  line: number;
  /**
   * How many arguments the call passes — or `null` when the name was handed out
   * as a *value* rather than called, which nothing that reads one file can
   * follow and which is therefore an offence in itself.
   */
  args: number | null;
}

/**
 * Every mention of `splitIntoBlocks` in one file that is a use of it, parsed.
 *
 * **This was a character scan until 2026-08-28, twice, and both versions were
 * wrong in the direction that goes quiet.** The first was a line regex
 * (`/\bsplitIntoBlocks\(\s*[^,()]*\)/`) that could not cross a nested bracket or
 * a newline, so it missed `splitIntoBlocks(await store.read(…))` — *the* shape a
 * conversion to the store actually takes — while passing a red check against a
 * toy. The second counted brackets and commas over raw characters, and GPT Sol
 * took it apart in four lines:
 *
 * ```
 * splitIntoBlocks(html ?? "missing, retry")   ← one argument, the comma in the
 *                                               string read as a separator: missed
 * splitIntoBlocks (html)                      ← missed; the needle glued the
 *                                               bracket to the name
 * const split = splitIntoBlocks; split(html)  ← missed; not a call to look at
 * splitIntoBlocks(")", previous)              ← correct, falsely accused: the
 *                                               `)` in the string ended the scan
 * ```
 *
 * Two more turned up when those were written down as a table:
 * `splitIntoBlocks(html,)` was read as two arguments, and a mention of the name
 * inside a `//` comment was reported as a call. So the docstring that stood here
 * — *the failure direction is a false positive, which somebody reads and
 * corrects, rather than a silent miss* — asserted a safety property the code did
 * not have, and asserting one falsely is worse than saying nothing.
 *
 * **So it parses.** `@babel/parser`, through tests/helpers/ts-ast.ts, which is
 * also where the reason it is not the TypeScript compiler lives (this repo is on
 * TypeScript 7 and its package no longer exposes `createSourceFile`). Strings,
 * template literals, comments, whitespace, line breaks and nested calls stop
 * being this function's problem, because they are not tokens.
 *
 * **What it still cannot see, and this time the list is the real one:**
 *
 * - a call through a value that has lost the name — the function passed to
 *   another module, stored on an object, reached through `import()`. The direct
 *   alias `const split = splitIntoBlocks` *is* caught, because the name appears
 *   in a value position and that is enough to complain about; one more hop and
 *   this is blind. It would take a type checker across the whole program, which
 *   is a different tool from a test.
 * - the *value* passed, as against the shape: an explicit
 *   `splitIntoBlocks(html, undefined)` passes, deliberately — somebody wrote the
 *   word, and the difference between an omission and a decision is the point.
 * - anything in a file it cannot parse at all: `parse` throws and this test goes
 *   red rather than quiet, which is the direction to fail in.
 */
function referencesIn(source: string): Reference[] {
  const found: Reference[] = [];
  walkAst(parseSource(source).program, (node, parent, key) => {
    if (node.type === "CallExpression" && calleeName(node.callee) === STAGE_THREE) {
      found.push({ line: lineOf(node), args: (node.arguments as unknown[]).length });
      return;
    }
    if (node.type !== "Identifier" || node.name !== STAGE_THREE) return;
    if (NOT_A_USE.has(`${parent?.type ?? ""}.${key}`)) return;
    found.push({ line: lineOf(node), args: null });
  });
  return found;
}

/** `f(…)` and `mod.f(…)` alike; anything else is not a call by name. */
function calleeName(callee: unknown): string | null {
  const c = callee as AstNode | undefined;
  if (c?.type === "Identifier") return c.name as string;
  if (c?.type === "MemberExpression" && c.computed !== true) {
    const property = c.property as AstNode | undefined;
    if (property?.type === "Identifier") return property.name as string;
  }
  return null;
}

/**
 * Where the name can appear without anybody calling anything: the callee slot of
 * a call already counted above, the declaration's own name, an import or export
 * specifier, the property of a member expression, and a `typeof` in a type.
 * Every other position hands the function out as a value.
 */
const NOT_A_USE = new Set([
  "CallExpression.callee",
  "FunctionDeclaration.id",
  "ImportSpecifier.imported",
  "ImportSpecifier.local",
  "ExportSpecifier.local",
  "ExportSpecifier.exported",
  "MemberExpression.property",
  "TSTypeQuery.exprName",
]);

/**
 * **Nothing in `src/` may call `splitIntoBlocks` without its baseline.**
 *
 * The trap this closes, which is specific and worth stating: landing D deletes
 * `dir` and `htmlFile` from `StepContext`, so the code that calls stage 3 *has*
 * to be edited — that part is safe, because it will not compile. What is not
 * safe is the shape of the edit. `splitIntoBlocks(html, previous?: Block[])`
 * takes its baseline **optionally**, so a conversion that reads the HTML from
 * the store and writes `splitIntoBlocks(await store.read(…))` compiles cleanly,
 * runs green, and silently re-mints every id in the article.
 *
 * `runBlocks`'s `previous` is required, which closes the production path the
 * strong way. This closes the one underneath it.
 *
 * **Why a source scan and not a required parameter.** Making the second
 * argument required would touch 81 call sites across four test files — one of
 * which belongs to another session's in-flight work — and those tests pass one
 * argument *legitimately*: they are exercising the first-ingest path, which is a
 * real case. Forcing all of them to write `, undefined` would be noise that
 * looks like rigour and teaches nothing. The precedent for reading the source
 * instead is `tests/sanitize-stale-artefact.test.ts`, for the reason it gives:
 * a rule stated in one function is not a rule the codebase follows.
 *
 * **The honest limit.** This checks the *call shape*, not the value. Somebody
 * can still pass `undefined` explicitly and this will not stop them — but then
 * they have written the word, and the difference between an omission and a
 * decision is the entire point of the check.
 */
describe("the baseline argument", () => {
  it("is never omitted by anything in src/", async () => {
    const { readdir } = await import("node:fs/promises");
    const root = path.join(import.meta.dirname, "..", "src");

    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    await walk(root);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf-8");
      /* **A prefilter that cannot change the answer**, which is the only kind
         worth having. `referencesIn` matches the name and nothing else, so a
         file without those characters in it has no references by construction —
         and parsing all ~150 files in `src/` took five seconds against the
         hundred milliseconds the three that mention it take. */
      if (!source.includes(STAGE_THREE)) continue;
      for (const ref of referencesIn(source)) {
        const where = `${path.relative(root, file)}:${ref.line}`;
        /* The two offences are different mistakes and want different sentences:
           one is a call that dropped its baseline, the other is the function
           handed out as a value, where the call this cannot see is somewhere
           else entirely. */
        if (ref.args === null) offenders.push(`${where}: used as a value, not called`);
        else if (ref.args < 2) offenders.push(`${where}: called with ${ref.args} argument`);
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * Every shape the scanner has to get right, in one table.
   *
   * A check that has never been red is not evidence, and a scan over a directory
   * that happens to be clean is exactly that — so the scanner is exercised here
   * on every shape, in this file, where it cannot rot without failing. Anything
   * added should be a shape somebody might really write.
   *
   * **One assertion over the whole table rather than a line of `expect` each**,
   * because a sequence stops at the first failure and the four shapes GPT Sol
   * found were four separate bugs. Reading three of them only after fixing the
   * first is how a rewrite ends up fixing one and calling it done.
   */
  const SHAPES: { source: string; omits: boolean[]; why: string }[] = [
    { why: "the plain miss", source: "const r = splitIntoBlocks(html);", omits: [true] },
    { why: "the plain call", source: "const r = splitIntoBlocks(html, previous);", omits: [false] },

    /* **The realistic post-D shape**: the HTML read inline, in one call. It is
       what a conversion actually looks like, and the first version of this check
       missed it while passing a red test against a toy. */
    {
      why: "read inline from the store, baseline dropped",
      source: 'const r = splitIntoBlocks(await store.read(slug, "extract", "extractedHtml"));',
      omits: [true],
    },
    {
      why: "read inline from the store, baseline passed",
      source: 'const r = splitIntoBlocks(await store.read(slug, "extract", "extractedHtml"), prev);',
      omits: [false],
    },

    // Split across lines, which a line-based check cannot see at all.
    { why: "one argument, wrapped", source: "const r = splitIntoBlocks(\n  html\n);", omits: [true] },
    /* **A trailing comma is one argument, not two.** The character scan said two
       — a silent miss nobody had noticed, because "contains a comma at depth
       zero" is a different question from "how many arguments are there". */
    {
      why: "one argument, wrapped, trailing comma",
      source: "const r = splitIntoBlocks(\n  html,\n);",
      omits: [true],
    },

    // An object or array argument holds commas that separate nothing.
    {
      why: "an object argument's commas separate nothing",
      source: "const r = splitIntoBlocks(pick({ a: 1, b: 2 }));",
      omits: [true],
    },
    {
      why: "an array baseline",
      source: "const r = splitIntoBlocks(html, [a, b]);",
      omits: [false],
    },

    /* Four shapes GPT Sol found the character scan getting wrong, 2026-08-28.
       Two are silent misses — the direction the old comment swore could not
       happen — and one is a false accusation of code that is correct. */
    {
      why: "a comma inside a string separates nothing (was missed)",
      source: 'const r = splitIntoBlocks(html ?? "missing, retry");',
      omits: [true],
    },
    {
      why: "a bracket inside a string closes nothing (was falsely accused)",
      source: 'const r = splitIntoBlocks(")", previous);',
      omits: [false],
    },
    {
      why: "a space before the bracket is still a call (was missed)",
      source: "const r = splitIntoBlocks (html);",
      omits: [true],
    },
    {
      why: "the name handed out as a value, called under another name (was missed)",
      source: "const split = splitIntoBlocks;\nsplit(html);",
      omits: [true],
    },

    // Naming it is not calling it.
    { why: "an import", source: 'import { splitIntoBlocks } from "./blocks.js";', omits: [] },
    {
      why: "a mention in a comment",
      source: "// splitIntoBlocks(html) would be wrong here\nconst x = 1;",
      omits: [],
    },
    {
      why: "the declaration",
      source: "export function splitIntoBlocks(html: string, previous?: Block[]) {}",
      omits: [],
    },

    // Two calls in one file are two answers, not one.
    {
      why: "two calls, one right and one wrong",
      source: "splitIntoBlocks(a, b);\nsplitIntoBlocks(c);",
      omits: [false, true],
    },
  ];

  it("would notice each shape a real conversion could take", () => {
    const omits = (source: string) =>
      referencesIn(source).map((ref) => ref.args === null || ref.args < 2);

    expect(SHAPES.map(({ why, source }) => ({ why, omits: omits(source) }))).toEqual(
      SHAPES.map(({ why, omits }) => ({ why, omits })),
    );
  });
});

/* ------------------------------------------------------------- Postgres -- */

const { loadEnvLocal } = await import("../src/env.js");
loadEnvLocal();

/**
 * **These have never run, and the reason is written here rather than only in
 * somebody's report.**
 *
 * As of 2026-08-28 they cannot execute on a laptop whose database is behind
 * `drizzle/0027_block_roles.sql`. That migration adds `role`, `treatment` and
 * `note_id` to `revision_blocks`, and `readBlocks` in
 * `src/store/artifacts-pg.ts` selects all three — so *every* read of a block row
 * fails with `column "role" does not exist`, whatever the test is about. The
 * repo's own drift guard says the same thing independently
 * (`tests/db-schema-drift.test.ts`).
 *
 * **What has to be true before this describe block can run:**
 *
 * 1. `drizzle/0027_block_roles.sql` is applied to the database in
 *    `DATABASE_URL` — `npm run db:migrate`, after reading its `Target:` line.
 * 2. Nothing else is holding the single `running` job slot (`withClaim` below
 *    waits it out, up to 20 seconds).
 *
 * The probe checks for the column itself, not merely for the table, precisely
 * so that a half-migrated database **skips loudly** instead of producing three
 * red lines that read like a bug in the code under test. A suite that reports
 * "0 failures" because it never ran is the thing this project keeps writing
 * postmortems about, so the console line is not optional decoration.
 */
/**
 * **The column, not merely the table.** `readBlocks` selects `role`, so a
 * database that has `revision_blocks` and not that column fails every assertion
 * below for a reason that has nothing to do with the baseline — which is exactly
 * what `pgReady`'s `columns` is for.
 *
 * This was forty lines of hand-rolled probe until 2026-09-05, written before the
 * helper could ask for a column and kept because it had to *skip loudly*. It
 * does not skip any more: there is one store, so a database this suite cannot
 * use is a failure. tests/helpers/pg-ready.ts.
 */
await pgReady({
  suite: "tests/blocks-baseline.test.ts",
  tables: ["spideryarn.revision_blocks"],
  columns: [{ table: "spideryarn.revision_blocks", column: "role" }],
});

describe("the baseline, over the Postgres store", () => {
  const SLUG = "test-blocks-baseline";
  const FRESH_SLUG = "test-blocks-baseline-new";

  let db: Awaited<ReturnType<typeof importDb>>["db"];
  let mod: Awaited<ReturnType<typeof importDb>>;

  async function importDb() {
    const client = await import("../src/db/client.js");
    const schema = await import("../src/db/schema.js");
    const pg = await import("../src/store/artifacts-pg.js");
    const revisions = await import("../src/store/pg-revisions.js");
    const admin = await import("../src/admin.js");
    const owner = await import("../src/owner.js");
    return { db: client.getDb(), client, schema, pg, revisions, admin, owner };
  }

  /* Ids from the alphabet `block_identities_id_format` allows, and deliberately
     not in the order the paragraphs appear: an assertion that reads back the
     ids in document order cannot be satisfied by an accident of sorting. */
  const H = "spya-zbaaa2";
  const P1 = "spya-mbaaa2";
  const P2 = "spya-cbaaa2";

  /** The published article, exactly as stage 3 left it three paragraphs ago. */
  const PUBLISHED: { blockId: string; ordinal: number; tag: string; text: string }[] = [
    { blockId: H, ordinal: 0, tag: "h2", text: "The opening" },
    { blockId: P1, ordinal: 1, tag: "p", text: "A first paragraph, which does not change between the two runs." },
    { blockId: P2, ordinal: 2, tag: "p", text: "A second paragraph, which does not change either." },
  ];

  let articleId = "";
  let publishedId = "";

  async function wipe(slug: string): Promise<void> {
    const { schema } = mod;
    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug));
    for (const { id } of rows) {
      await db.execute(sql`update ${schema.articles} set current_revision_id = null where id = ${id}::uuid`);
      await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, id));
      await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, id));
      await db.delete(schema.blockIdentities).where(eq(schema.blockIdentities.articleId, id));
      await db.delete(schema.articles).where(eq(schema.articles.id, id));
    }
  }

  beforeAll(async () => {
    mod = await importDb();
    db = mod.db;
    const { schema, admin } = mod;
    await wipe(SLUG);
    await wipe(FRESH_SLUG);

    const [article] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: SLUG })
      .returning();
    if (!article) throw new Error("could not create the fixture article");
    articleId = article.id;

    const [revision] = await db
      .insert(schema.articleRevisions)
      .values({ articleId, status: "published", extractedHtml: EXTRACTED })
      .returning();
    if (!revision) throw new Error("could not create the fixture revision");
    publishedId = revision.id;

    await db
      .insert(schema.blockIdentities)
      .values(PUBLISHED.map((b) => ({ articleId, blockId: b.blockId })));

    /* **Column names spelled out, not a drizzle `.values()`.** Drizzle names
       every column of the table, including ones a pending migration has not
       added to this database yet, so a fixture written that way fails for a
       reason that has nothing to do with what it is testing. `beginDraftIn`
       writes its copy the same way and for the same kind of reason. */
    for (const b of PUBLISHED) {
      await db.execute(sql`
        insert into ${schema.revisionBlocks}
          (article_id, revision_id, block_id, ordinal, tag, kind, text, words, html, gistable)
        values (${articleId}::uuid, ${publishedId}::uuid, ${b.blockId}, ${b.ordinal},
                ${b.tag}, 'text', ${b.text}, ${b.text.split(" ").length},
                ${`<${b.tag} id="${b.blockId}">${b.text}</${b.tag}>`}, true)
      `);
    }

    /* The pointer `hasEarlierBlocks` reads. Set directly rather than through
       `publishRevision`, which wants a tree, labels and a step run — none of
       which this is about. */
    await db.execute(
      sql`update ${schema.articles} set current_revision_id = ${publishedId}::uuid where id = ${articleId}::uuid`,
    );

    await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID_LOCAL, slug: FRESH_SLUG })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    if (mod) {
      await wipe(SLUG);
      await wipe(FRESH_SLUG);
      await mod.client.closeDb();
    }
  });

  /**
   * A draft based on the published revision, and a store bound to it.
   *
   * **`runAsOwner`, explicitly.** `lockArticle` filters by `currentOwnerId()`,
   * which outside a request falls back to `SPIDERYARN_OWNER_ID` — and
   * `vite.config.ts` loads `.env.local` into vitest, so a suite that relied on
   * that would pass on this laptop and fail on one where the variable names
   * somebody else. Naming the owner here is the only version of this that is
   * about the code rather than about the environment.
   */
  async function aDraft(slug: string) {
    const { pg, revisions, admin, owner } = mod;
    /* `asOwnerId` is module-private, and the brand exists so an owner cannot be
       invented by accident — which is what a test fixture is doing here on
       purpose, with a uuid the migrations put in `auth.users`. */
    const begun = await owner.runAsOwner(admin.ADMIN_USER_ID_LOCAL as OwnerId, () =>
      revisions.beginRevision({ slug }),
    );
    void pg;
    return { begun, revisionId: begun.revisionId, articleId: begun.articleId };
  }

  /**
   * A live claim on a draft, and everything it touches rolled back.
   *
   * **`writeArtefacts` will not write without one.** It calls
   * `requireLiveJobOwnsDraft` first — this job, this attempt, still `running`,
   * still pointed at this draft — so a test that wants the production write path
   * has to supply a real job row rather than a plausible-looking `JobDraftRef`.
   * That is the check doing its job, and it is exactly why the store cannot be
   * hand-built here.
   *
   * `jobs_active_slug` allows one job in flight per article, and another
   * `npm test` on the same laptop is running these same fixture slugs.
   * `insertWhenSlotFree` waits instead of failing with a duplicate-key error
   * that points at the wrong suite. It used to be waiting for something wider —
   * `jobs_only_one_running`, one running row in the whole table — which was
   * dropped on 2026-08-30.
   */
  async function withClaim(
    slug: string,
    revisionId: string,
    articleId: string,
    body: (tx: Tx, ref: JobDraftRef) => Promise<void>,
  ): Promise<void> {
    const { schema } = mod;
    await insertWhenSlotFree(slug, async () => {
      const id = mintId();
      const attemptId = mintAttempt();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(schema.jobs).values({
            id,
            ownerId: mod.admin.ADMIN_USER_ID_LOCAL,
            slug,
            steps: [{ name: "blocks", label: "Splitting into blocks", status: "pending" }],
            status: "running",
            attemptId,
            leaseExpiresAt: new Date(Date.now() + 600_000),
            workKey: `wk-${id}`,
            draftRevisionId: revisionId,
          });
          await body(tx, { slug, articleId, revisionId, jobId: id, attemptId });
          throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
      }
    });
  }

  it("carries every id through stage 3 and back out of the store it wrote them to", async () => {
    const { begun, revisionId, articleId } = await aDraft(SLUG);
    /* `beginDraftIn` copies the published revision's block rows into the new
       draft before any stage runs — the baseline is already there, and this is
       the number that says so. */
    expect(begun.blocksCopied).toBe(3);

    await withClaim(SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);

      const previous = await previousBlocksFrom(store, SLUG);
      expect(previous?.map((b) => b.id)).toEqual([H, P1, P2]);

      /* Stage 2's output: the same words, no ids anywhere — as a string, which
         is how the step gets it now. There is no file in this test any more,
         and there is none in the path it models either. */
      const run = runBlocks({ slug: SLUG, extractedHtml: EXTRACTED, previous });
      expect(run.stats.minted).toBe(0);
      expect(run.blocks.map((b) => b.id)).toEqual([H, P1, P2]);

      /* **Through `writeArtefacts`, which is the point of this test.** Stopping
         at `runBlocks` would prove the matcher works and say nothing about the
         path landing D actually takes: `write` deletes every block row for this
         revision and inserts the new ones, so an id that survived the match and
         then failed to survive the write would look identical from outside. */
      await store.beginStep(SLUG, "blocks");
      await store.write(SLUG, "blocks", { blocks: { blocks: run.blocks }, stampedHtml: run.html }, {});

      const readBack = await store.read(SLUG, "blocks", "blocks");
      /* The exact ids, in document order, read out of the table the write put
         them in. This is the assertion the whole change exists for. */
      expect(readBack?.blocks.map((b) => b.id)).toEqual([H, P1, P2]);
      expect(readBack?.blocks.map((b) => b.text)).toEqual(PUBLISHED.map((b) => b.text));
    });
  }, 60_000);

  it("stays idempotent — a second stage 3 over the rows the first one wrote", async () => {
    /* The case the plan's existing acceptance list cannot reach: item 8 runs the
       pipeline with `data/<slug>/` empty, and a *fresh* ingest mints everything
       by design, so it cannot tell "carries ids correctly" from "re-mints every
       time". This runs the stage a second time against unchanged text and
       asserts the same exact ids, not merely that some were carried. */
    const { revisionId, articleId } = await aDraft(SLUG);

    await withClaim(SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);
      await store.beginStep(SLUG, "blocks");

      const first = runBlocks({
        slug: SLUG,
        extractedHtml: EXTRACTED,
        previous: await previousBlocksFrom(store, SLUG),
      });
      await store.write(
        SLUG,
        "blocks",
        { blocks: { blocks: first.blocks }, stampedHtml: first.html },
        {},
      );

      /* Stage 2 runs again and hands over an id-free document, exactly as
         Readability does — the same `EXTRACTED` string, with nothing of stage
         3's in it. The only way the ids can come back is the baseline. */
      const second = runBlocks({
        slug: SLUG,
        extractedHtml: EXTRACTED,
        previous: await previousBlocksFrom(store, SLUG),
      });
      await store.write(
        SLUG,
        "blocks",
        { blocks: { blocks: second.blocks }, stampedHtml: second.html },
        {},
      );

      expect(second.stats.minted).toBe(0);
      const readBack = await store.read(SLUG, "blocks", "blocks");
      expect(readBack?.blocks.map((b) => b.id)).toEqual([H, P1, P2]);
    });
  }, 60_000);

  it("refuses to mint when the draft's carried baseline is not there", async () => {
    const { revisionId, articleId } = await aDraft(SLUG);
    const { schema } = mod;
    /* The carry-forward did not happen — a failed copy, a bad migration, a
       hand-edit. The article has a published revision, so this is not a first
       ingest, and minting would orphan every anchor into it. */
    await db
      .delete(schema.revisionBlocks)
      .where(eq(schema.revisionBlocks.revisionId, revisionId));

    await withClaim(SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);
      await expect(previousBlocksFrom(store, SLUG)).rejects.toBeInstanceOf(BaselineMissing);
    });
  }, 60_000);

  it("mints quietly for an article with no published revision", async () => {
    const { begun, revisionId, articleId } = await aDraft(FRESH_SLUG);
    expect(begun.basedOn).toBeNull();
    expect(begun.blocksCopied).toBe(0);

    await withClaim(FRESH_SLUG, revisionId, articleId, async (tx, ref) => {
      const store = mod.pg.pgArtifactsIn(ref, tx);
      await expect(previousBlocksFrom(store, FRESH_SLUG)).resolves.toBeUndefined();
    });
  }, 60_000);
});
