/**
 * **Every column of `revision_blocks` is carried into a draft.**
 *
 * `beginDraftIn` copies block rows forward from the published revision with a
 * hand-written list of column names (`CARRIED_BLOCK_COLUMNS`,
 * src/store/pg-revisions.ts). Its own comment says nothing typechecks it, and
 * that was true: a column left out is dropped from every
 * `{ steps: ["extract"] }` draft, silently — for `role`/`treatment`/`note_id`
 * that puts an article's bibliography back into its argument, and for
 * `context_id`/`context_type` a callout re-reads as ordinary prose.
 *
 * The list is now asserted against the table itself, so adding a column and
 * forgetting the copy is a red test rather than a quiet data loss. GPT Sol's
 * review, 2026-08-31, which is also where "the positive test covers one path and
 * would pass with the others broken" came from.
 *
 * **No database needed.** This reads drizzle's own table definition, so it runs
 * in every environment rather than skipping wherever Postgres is not up — which
 * matters, because the failure it catches arrives with a schema change and
 * schema changes are exactly when somebody is running the fast subset.
 */

import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { revisionBlocks } from "../src/db/schema.js";
import { CARRIED_BLOCK_COLUMNS } from "../src/store/pg-revisions.js";

/**
 * The two that must **not** be carried, and why each.
 *
 * `revision_id` is the draft's own, supplied by the insert — carrying the old
 * one would copy the rows back onto the revision they came from. `fts` is
 * `generatedAlwaysAs`, so Postgres recomputes it from the copied text; naming it
 * would either fail or freeze a stale search vector.
 */
const NOT_CARRIED = new Set(["revision_id", "fts"]);

describe("the block columns a draft carries forward", () => {
  const columns = getTableConfig(revisionBlocks).columns.map((c) => c.name);

  it("covers every column of the table except the two that must not be", () => {
    const expected = columns.filter((name) => !NOT_CARRIED.has(name)).sort();
    expect([...CARRIED_BLOCK_COLUMNS].sort()).toEqual(expected);
  });

  it("names nothing the table does not have", () => {
    // The other direction: a renamed column leaves a name here that no longer
    // exists, and the insert fails at runtime rather than here.
    for (const name of CARRIED_BLOCK_COLUMNS) expect(columns).toContain(name);
  });

  it("does not carry the two that must not be carried", () => {
    for (const name of NOT_CARRIED) expect(CARRIED_BLOCK_COLUMNS).not.toContain(name);
    // And they really are columns of this table, or this test asserts nothing.
    for (const name of NOT_CARRIED) expect(columns).toContain(name);
  });
});
