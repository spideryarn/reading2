/**
 * **One `revision_blocks` row, as each read that turns it into a `Block` hands
 * it back** — the exact object, absent keys included.
 *
 * Five places in `src/store/` read block rows and build a `Block` from each
 * (docs/plans/261006j-sixth-sweep-s5-citation-depth-block-mapper-null-checks.md).
 * Until 2026-10-06 each wrote the mapping out for itself, so a new column was
 * five edits and a miss dropped a field from one read with nothing raised: the
 * export would simply stop carrying it. This file is what says they agree, and
 * it was written against the five copies before they became one function
 * (`src/store/block-rows.ts`), so that the move could be shown to change
 * nothing.
 *
 * Three rows, through four of the five reads:
 *
 *  - **every optional column set**, a `note` included;
 *  - **every optional column null** — the keys must be *absent*, not
 *    `undefined` and not `null`, which is why this is `toStrictEqual`;
 *  - **only a `note`**, which is the one column the visitor's read must never
 *    carry, and never selects.
 *
 * ## The fifth read, and the row this cannot seed
 *
 * `storedBlocks` in src/store/pg-revisions.ts is private and its result goes
 * only to the publication guard, which looks at ids. There is no exact `Block`
 * to observe there without exporting it for a test, so it is not driven here;
 * since the extraction it is one line calling the same function as the
 * pipeline's read below.
 *
 * A row with **one** of `context_id` and `context_type` null cannot exist: the
 * CHECK `revision_blocks_context` refuses it, and the last test here says so.
 * What the mapper does with one anyway is a unit test, in
 * tests/block-rows.test.ts.
 *
 * ## What the visitor's case here cannot see
 *
 * A visitor's block is rebuilt a second time on its way out, field by field,
 * by `publicBlock` in src/public/dto.ts. So the visitor's case below pins the
 * read as a whole and **not** the mapper: with the visitor's SELECT changed to
 * take `note` and the mapper changed to emit it, this file stayed green
 * (tried, 2026-10-06), because the second rebuild dropped it. That the mapper
 * itself cannot emit a note is tests/block-rows.test.ts, which failed under the
 * same change. The other three reads have no second rebuild, and each went red
 * here against a mapper that dropped a field or wrote `level: undefined`.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { readArtefact } from "../src/store/artifacts-pg.js";
import { exportArticle } from "../src/store/export.js";
import { loadArticle } from "../src/store/index.js";
import { PUBLIC_ONLY } from "../src/store/public-access.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import type { Block } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/block-row-mapper-pg.test.ts",
  columns: [{ table: "spideryarn.revision_blocks", column: "context_type" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-block-row-mapper-${RUN}`;
/* Shaped like no real note, so a search of a whole payload for it cannot match
   anything else. */
const NOTE = `extractor-note-${RUN}`;
const CONTEXT_ID = "c-0123456789";

let article: ScratchArticle | undefined;
let revisionId = "";

/** The three rows as they should come back to the owner. */
let full: Block;
let bare: Block;
let noted: Block;

const without = (block: Block): Omit<Block, "note"> => {
  const { note: _note, ...rest } = block;
  return rest;
};

/** Three blocks out of a longer answer, by id. Fails loudly if one is missing. */
function pick(blocks: readonly { id: string }[]): unknown[] {
  return [full, bare, noted].map((want) => {
    const found = blocks.find((b) => b.id === want.id);
    if (!found) throw new Error(`block ${want.id} is not in the answer`);
    return found;
  });
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const db = getDb();
  const [row] = await db
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  revisionId = row.id;

  /* The required columns as stored, read here column by column and not through
     any of the reads under test. */
  const stored = await db
    .select({
      id: revisionBlocks.blockId,
      tag: revisionBlocks.tag,
      kind: revisionBlocks.kind,
      text: revisionBlocks.text,
      words: revisionBlocks.words,
      html: revisionBlocks.html,
      gistable: revisionBlocks.gistable,
    })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.ordinal))
    .limit(3);
  const [a, b, c] = stored;
  if (!a || !b || !c) throw new Error(`${SLUG} has fewer than three blocks`);

  const set = (blockId: string, values: Partial<typeof revisionBlocks.$inferInsert>) =>
    db
      .update(revisionBlocks)
      .set(values)
      .where(and(eq(revisionBlocks.revisionId, revisionId), eq(revisionBlocks.blockId, blockId)));
  const NONE = {
    level: null,
    note: null,
    role: null,
    treatment: null,
    noteId: null,
    contextId: null,
    contextType: null,
  };
  await set(a.id, {
    level: 2,
    note: NOTE,
    role: "footnote",
    treatment: "supplement",
    noteId: "n-1",
    contextId: CONTEXT_ID,
    contextType: "callout",
  });
  await set(b.id, NONE);
  await set(c.id, { ...NONE, note: NOTE });

  /* Key order is the mapper's, which `toStrictEqual` does not read; it is kept
     so a failure's diff lines up. */
  full = {
    id: a.id,
    tag: a.tag,
    kind: a.kind,
    level: 2,
    text: a.text,
    words: a.words,
    html: a.html,
    gistable: a.gistable,
    note: NOTE,
    role: "footnote",
    treatment: "supplement",
    noteId: "n-1",
    context: { id: CONTEXT_ID, type: "callout" },
  };
  bare = { ...b };
  noted = { ...c, note: NOTE };
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("a block row, read back as a Block", () => {
  it("is exact through the pipeline's artefact read", async () => {
    const artefact = await readArtefact(
      /* The job and attempt ids are not read by a `blocks` read; the slug is,
         and must match. */
      { slug: SLUG, articleId: article?.articleId ?? "", revisionId, jobId: randomUUID(), attemptId: randomUUID() },
      getDb(),
      SLUG,
      "blocks",
      "blocks",
    );
    if (!artefact) throw new Error("no blocks artefact");
    expect(Object.keys(artefact)).toEqual(["blocks"]);
    expect(pick(artefact.blocks)).toStrictEqual([full, bare, noted]);
  });

  it("is exact through the owner's article load", async () => {
    const loaded = await runAsOwner(DEV_OWNER_ID, () => loadArticle(SLUG));
    expect(pick(loaded.blocks)).toStrictEqual([full, bare, noted]);
  });

  it("is exact in the export's blocks.json", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-block-rows-"));
    try {
      await runAsOwner(DEV_OWNER_ID, () =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const file = JSON.parse(await readFile(path.join(out, SLUG, "blocks.json"), "utf8")) as {
        blocks: Block[];
      };
      expect(pick(file.blocks)).toStrictEqual([full, bare, noted]);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("is the same for a visitor, minus the note, which is nowhere in the payload", async () => {
    await getDb()
      .update(articles)
      .set({ visibility: "public", publicAt: new Date() })
      .where(eq(articles.slug, SLUG));
    const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
    expect(pick(shared.blocks)).toStrictEqual([without(full), bare, without(noted)]);
    /* The control: the note really is in the row, and the owner's read of this
       same article carries it. */
    const owned = await runAsOwner(DEV_OWNER_ID, () => loadArticle(SLUG));
    expect(JSON.stringify(owned)).toContain(NOTE);
    expect(JSON.stringify(shared)).not.toContain(NOTE);
  });

  it("cannot be handed half a context, because the table refuses the row", async () => {
    const half = getDb()
      .update(revisionBlocks)
      .set({ contextId: CONTEXT_ID, contextType: null })
      .where(and(eq(revisionBlocks.revisionId, revisionId), eq(revisionBlocks.blockId, bare.id)));
    await expect(half).rejects.toThrow();
  });
});
