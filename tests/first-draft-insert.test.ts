/**
 * **An article's first draft names only the columns it writes.**
 *
 * drizzle's `insert(table).values({…})` lists *every* declared column, writing
 * `default` for the ones left out. So while `src/db/schema.ts` still declared
 * the retired `citations`, `debate` and `debate_claims` (plan 261009w's expand),
 * the first-draft insert named them, and the code deployed before the contract
 * migration would have failed to start every new article for the minutes
 * between that migration dropping them and Vercel going live. The insert
 * names its own three columns instead, so it keeps working whichever columns
 * the table has beyond them. docs/plans/261011ae-sources-rename-contract.md.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { firstDraftInsert } from "../src/store/pg-revisions.js";

describe("firstDraftInsert", () => {
  it("names id, article_id and status, and no other column", () => {
    const query = new PgDialect().sqlToQuery(firstDraftInsert("r", "a"));
    const columns = /\(([^)]*)\)\s*values/i.exec(query.sql)?.[1];
    expect(columns?.split(",").map((c) => c.trim())).toEqual(['"id"', '"article_id"', '"status"']);
  });
});
