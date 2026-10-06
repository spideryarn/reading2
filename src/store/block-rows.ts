/**
 * **One `revision_blocks` row, as a `Block`.** The only place that mapping is
 * written; every read in `src/store/` that selects block rows calls it.
 *
 * It was written out five times until 2026-10-06 — the pipeline's artefact read
 * (artifacts-pg.ts), the publication guard (pg-revisions.ts), the owner's
 * article (pg.ts), the export (export.ts) and the visitor's article
 * (public-reader.ts) — so a new block column was five edits, and a miss dropped
 * the field from one read with nothing raised.
 * docs/plans/261006j-sixth-sweep-s5-citation-depth-block-mapper-null-checks.md.
 *
 * ## Two functions, and no argument that chooses between them
 *
 * `publicBlockOf` cannot produce a `note`: it never reads one, and its row type
 * has no such column. `blockOf` is the owner's, and its row type **requires**
 * the column, so it does not compile against the visitor's SELECT, which leaves
 * `note` out. That is the whole protection, and it is why this is not one
 * function taking `{ note: boolean }` — src/store/public-reader.ts's header says
 * why a privacy decision must not be an argument a call site can get wrong.
 *
 * ## What is deliberately not here
 *
 * - **The SELECT lists.** Each read names its own columns, so a new column is
 *   still an edit to each query — and then one edit here.
 * - **The id's column alias.** Some reads select `block_id` as `id` and some as
 *   `blockId`; the caller passes whichever it has.
 * - **The visitor's second rebuild.** `publicBlock` in src/public/dto.ts takes a
 *   block apart and names each field again on its way out. That is a different
 *   mapping (a `Block` to a `PublicBlock`, not a row to either) and a
 *   deliberate second gate; it is not a sixth copy of this one.
 * - **What an empty result means** (absent, `[]`, a 404, no file) **and whether
 *   the HTML is cleaned.** Those differ between the five on purpose, and stay
 *   with the read that decides them.
 *
 * Pure, and it imports types only, so the visitor's reader may import it
 * (tests/public-imports.test.ts).
 */
import type { PublicBlock } from "../public-types.js";
import type { Block, BlockId, BlockKind } from "../types.js";

/**
 * The columns of a block row a visitor's read selects: all of them but `note`
 * (and `fts`, which nothing selects). `null` is how Postgres says a nullable
 * column is empty; the `Block` has no key at all there.
 */
export interface PublicBlockColumns {
  tag: string;
  kind: BlockKind;
  level: number | null;
  text: string;
  words: number;
  html: string;
  gistable: boolean;
  role: NonNullable<Block["role"]> | null;
  treatment: NonNullable<Block["treatment"]> | null;
  noteId: string | null;
  contextId: string | null;
  contextType: string | null;
}

/** The same, with the extractor's per-block `note`: an owner's read only. */
export interface BlockColumns extends PublicBlockColumns {
  note: string | null;
}

/* Conditional spreads throughout, because `exactOptionalPropertyTypes` is on:
   `level: undefined` is a different type from no `level`, and a JSON reader
   sees a different file. The two halves exist only so that `note` keeps the
   place it has always had between them, which is the key order of every
   exported blocks.json. */
function upToNote(id: BlockId, row: PublicBlockColumns) {
  return {
    id,
    tag: row.tag,
    /* No cast on `kind`, `role` or `treatment`: the columns carry the unions
       (`$type` in src/db/schema.ts § revisionBlocks), on the strength of the
       CHECK each one has. */
    kind: row.kind,
    ...(row.level === null ? {} : { level: row.level }),
    text: row.text,
    words: row.words,
    html: row.html,
    gistable: row.gistable,
  };
}

function afterNote(row: PublicBlockColumns) {
  return {
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.treatment === null ? {} : { treatment: row.treatment }),
    ...(row.noteId === null ? {} : { noteId: row.noteId }),
    /* Both halves or no context. The table refuses a row with one
       (`revision_blocks_context`), so the `||` is for a row that did not come
       from it. The cast is on the strength of `revision_blocks_context_type`. */
    ...(row.contextId === null || row.contextType === null
      ? {}
      : { context: { id: row.contextId, type: row.contextType as "callout" } }),
  };
}

/** A block row as anybody may be shown it: a `Block` with no `note`. */
export function publicBlockOf(id: BlockId, row: PublicBlockColumns): PublicBlock {
  return { ...upToNote(id, row), ...afterNote(row) };
}

/** A block row as its owner reads it, the extractor's `note` included. */
export function blockOf(id: BlockId, row: BlockColumns): Block {
  return {
    ...upToNote(id, row),
    ...(row.note === null ? {} : { note: row.note }),
    ...afterNote(row),
  };
}
