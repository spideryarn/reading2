/**
 * **`role`, `treatment` and `noteId` through the real Postgres write path.**
 *
 * ## The mutation that survived 293 tests
 *
 * `writeBlocks` in src/store/artifacts-pg.ts could be changed to write
 * `treatment: null` unconditionally and `store-roundtrip`, `store-artefacts-pg`,
 * `block-roles`, `store-parity` and `store-block-reads` all stayed green. The
 * Postgres path could have dropped the column on every write for ever and
 * nothing would have said so. GPT Sol's review of stage 3, 2026-08-28.
 *
 * The cause is not a missing assertion; it is a **missing input**. Every article
 * in the committed `data/` and `example/` corpus predates classification, so
 * every one of those suites round-trips blocks whose three fields are already
 * absent — and "absent went in, absent came out" is satisfied by a store that
 * throws the fields away. `tests/block-roles.test.ts` has a synthetic
 * role-bearing article for exactly this reason, and it drives the **filesystem**
 * store, the import validator and the public DTO. This is the fourth consumer,
 * and it is the one that needs a database.
 *
 * ## So the fixture is classified before it is loaded
 *
 * A copy of `data/writes` under a `test-` slug, with three of its blocks marked
 * as one note's prose and the rest left as body, written into Postgres by
 * `loadArticleIntoPg` — the real path: `storeRawSource`, a fenced job,
 * `openOrBeginJobDraft`, `beginStep`/`write`/`finishStep` per step, then
 * `publishRevision` with its guards run rather than routed around.
 *
 * **Never a real `data/` article**, and `basedOn` is asserted `null`.
 * `beginDraftIn` carries block rows forward from the published revision, so an
 * article a previous run published reads back perfectly from columns *this* run
 * never wrote. That is not hypothetical — it faked a clean parity result on
 * 2026-08-28.
 *
 * **Both copies of `blocks.json` are classified.** The filesystem store keys
 * paths by `(step, kind)` and `blocks` lands in two places — stage 3's
 * `output/<slug>.blocks.json` and stage 4's `data/<slug>/blocks.json`
 * (src/store/artifacts-fs.ts). `copyArtefacts` walks the steps in pipeline
 * order, so stage 4's copy is the one that writes the rows last. Classifying
 * only one would leave the assertion depending on which step happened to go
 * second.
 */

import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { NOTE_ID_PATTERN } from "../src/notes.js";
import { hashBlocks } from "../src/source-hash.js";
import { pgArticleReader } from "../src/store/pg.js";
import type { Block } from "../src/types.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const FROM = "writes";
const SLUG = "test-block-roles-pg";

const { reachable } = await pgReady({
  suite: "tests/store-block-roles-pg.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

const when = reachable ? describe : describe.skip;

/** One note's id, in the shape `mintNoteId` produces — see `NOTE_ID_PATTERN`. */
const NOTE_ID = "spya-note-00ab12cd34";

/** Which blocks become the note's prose. Indices, so the fixture can be re-read. */
const NOTE_ROWS = [16, 17, 18];

/**
 * Copy `data/writes` to `SLUG` and classify three of its blocks as one note.
 *
 * Returns the ids, so the assertions name blocks rather than positions — an
 * assertion by index would still pass if the rows came back in another order,
 * which is a different bug this file is not about but must not be blind to.
 */
async function makeClassifiedFixture(): Promise<{ note: string[]; body: string[] }> {
  const dir = path.join(ROOT, "data", SLUG);
  await rm(dir, { recursive: true, force: true });
  await cp(path.join(ROOT, "data", FROM), dir, { recursive: true });

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const at = path.join(dir, name);
    const value: unknown = JSON.parse(await readFile(at, "utf8"));
    if (value && typeof value === "object" && (value as { slug?: string }).slug === FROM) {
      (value as { slug: string }).slug = SLUG;
      await writeFile(at, JSON.stringify(value, null, 2));
    }
  }
  await cp(path.join(ROOT, "output", `${FROM}.html`), path.join(ROOT, "output", `${SLUG}.html`));

  const note: string[] = [];
  const body: string[] = [];
  const classify = (blocks: Block[]): Block[] =>
    blocks.map((b, i) =>
      NOTE_ROWS.includes(i)
        ? { ...b, role: "footnote" as const, treatment: "supplement" as const, noteId: NOTE_ID }
        : b,
    );

  // Stage 4's copy, and stage 3's. See the header for why both.
  let classified: Block[] = [];
  for (const at of [
    path.join(dir, "blocks.json"),
    path.join(ROOT, "output", `${SLUG}.blocks.json`),
  ]) {
    if (at.startsWith(path.join(ROOT, "output"))) {
      await cp(path.join(ROOT, "output", `${FROM}.blocks.json`), at);
    }
    const parsed = JSON.parse(await readFile(at, "utf8")) as { blocks: Block[] };
    const blocks = classify(parsed.blocks);
    if (note.length === 0) {
      classified = blocks;
      for (const [i, b] of blocks.entries()) (NOTE_ROWS.includes(i) ? note : body).push(b.id);
    }
    await writeFile(at, JSON.stringify({ ...parsed, blocks }));
  }

  await makeTreeAndLabelsAgree(dir, classified, new Set(note));
  return { note, body };
}

/**
 * **Make the rest of the article agree that those three blocks are apparatus.**
 *
 * Not fixture housekeeping — the publish gate refuses the article without it,
 * and both of its reasons are correct:
 *
 * 1. `validateTree` fails a leaf carrying a `navLabel` while anchoring a block
 *    `isStructural` refuses, and `writes` labels all eighteen of its gistable
 *    blocks. Classifying three of them without unlabelling their leaves
 *    describes an article that stage 4 would never produce.
 * 2. `reasonsNotToPublish` compares `toc`'s recorded `input_hash` against
 *    `hashBlocks` of the blocks being published, and `toc`'s stamp comes from
 *    `labels.json`'s `sourceHash` (`STAMP_SOURCE` in src/store/artifacts.ts).
 *    Changing a block without restamping says the tree was built from a
 *    different article, which it was.
 *
 * So this does what stage 3 followed by stage 4 does: drops the notes' labels
 * and restamps. The first version of this test did neither, and the gate caught
 * it — which is worth recording, because a fixture that had been waved through
 * would have been testing a shape the pipeline cannot produce.
 */
async function makeTreeAndLabelsAgree(
  dir: string,
  blocks: Block[],
  note: ReadonlySet<string>,
): Promise<void> {
  const treeAt = path.join(dir, "tree.json");
  const tree = JSON.parse(await readFile(treeAt, "utf8")) as {
    nodes: Record<string, { children: string[]; range: [string, string]; navLabel?: string }>;
  };
  for (const node of Object.values(tree.nodes)) {
    if (node.children.length === 0 && note.has(node.range[0])) delete node.navLabel;
  }
  await writeFile(treeAt, JSON.stringify(tree));

  const labelsAt = path.join(dir, "labels.json");
  const labels = JSON.parse(await readFile(labelsAt, "utf8")) as {
    sourceHash: string;
    labels: Record<string, string>;
  };
  for (const id of note) delete labels.labels[id];
  labels.sourceHash = hashBlocks(blocks);
  await writeFile(labelsAt, JSON.stringify(labels));
}

/** Remove the rows as well as the files — see tests/helpers-load-article.test.ts. */
async function forget(): Promise<void> {
  await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
  await rm(path.join(ROOT, "output", `${SLUG}.html`), { force: true });
  await rm(path.join(ROOT, "output", `${SLUG}.blocks.json`), { force: true });

  const db = getDb();
  await db.delete(jobs).where(eq(jobs.slug, SLUG));
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.slug, SLUG));
  await db.delete(articles).where(eq(articles.slug, SLUG));
}

when("a classified article through Postgres", () => {
  afterAll(async () => {
    await forget();
    await closeDb();
  });

  it("carries all three fields into the rows and back out again", async () => {
    await forget();
    const { note, body } = await makeClassifiedFixture();

    const loaded = await loadArticleIntoPg(SLUG);
    expect(loaded.published).toBe(true);
    /* A genuine first write. Without this the whole suite could be reading
       columns carried forward from a revision some earlier run published. */
    expect(loaded.basedOn).toBeNull();
    expect(loaded.copied).toContain("toc");

    /* **The columns, read directly**, before any projection gets a chance to
       reconstruct them. The mutation this file exists for is in the *write*, so
       the rows are what has to be looked at. */
    const rows = await getDb()
      .select({
        id: revisionBlocks.blockId,
        role: revisionBlocks.role,
        treatment: revisionBlocks.treatment,
        noteId: revisionBlocks.noteId,
      })
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, loaded.revisionId));

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(note.length + body.length);

    for (const id of note) {
      expect(byId.get(id)).toEqual({
        id,
        role: "footnote",
        treatment: "supplement",
        noteId: NOTE_ID,
      });
    }

    /* The control, and it is not decoration: every one of the five suites this
       mutation survived was asserting the body case only, which a store that
       writes `null` to all three satisfies perfectly. */
    for (const id of body) {
      expect(byId.get(id)).toEqual({ id, role: null, treatment: null, noteId: null });
    }
  }, 180_000);

  it("comes back through the reader with the fields the article was written with", async () => {
    /* The other half of the round trip. The columns above prove the write; this
       proves the production read projects them, which is ten hand-written
       projections' worth of opportunity to drop one. */
    const blocks = (await pgArticleReader.loadArticle(SLUG)).blocks;

    const notes = blocks.filter((b) => b.treatment === "supplement");
    expect(notes).toHaveLength(NOTE_ROWS.length);
    expect(notes.every((b) => b.role === "footnote")).toBe(true);
    expect(new Set(notes.map((b) => b.noteId))).toEqual(new Set([NOTE_ID]));
    expect(NOTE_ID_PATTERN.test(NOTE_ID)).toBe(true);

    // And the body is untouched — the same control as above, one layer up.
    expect(blocks.filter((b) => b.role !== undefined)).toHaveLength(NOTE_ROWS.length);
  }, 60_000);

  it("gives the same fingerprint as the file it was loaded from", async () => {
    /**
     * **The reason this belongs here rather than in a hash suite.**
     *
     * `hashBlocks` folds in `role` and `treatment`, and the narrow Postgres
     * read selects four columns to feed it (src/store/pg.ts `blockHashQuery`).
     * The filesystem carries an absent key where Postgres carries a null, and
     * the two must normalise to the same bytes — if they do not, every artefact
     * reports itself stale against whichever store did not write it, for ever,
     * and both stores look right on their own.
     *
     * Over today's unclassified corpus this holds whatever the code does, which
     * is why it is asserted over a **classified** article or not at all.
     */
    const onDisk = JSON.parse(
      await readFile(path.join(ROOT, "data", SLUG, "blocks.json"), "utf8"),
    ) as { blocks: Block[] };
    const fromPg = (await pgArticleReader.loadArticle(SLUG)).blocks;

    expect(hashBlocks(onDisk.blocks)).toBe(hashBlocks(fromPg));
    /* And it is the classified fingerprint, not the legacy one — otherwise this
       passes on a pair of stores that both dropped the fields. */
    expect(hashBlocks(fromPg)).not.toBe(
      hashBlocks(onDisk.blocks.map((b) => ({ id: b.id, text: b.text }))),
    );
  }, 60_000);
});
