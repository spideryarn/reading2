/**
 * **`revision_blocks.kind`, `.role` and `.treatment` come back as the unions
 * `Block` declares, and the database's CHECKs list the same values.**
 *
 * The three were plain `text` columns, so every reader of the table cast them
 * (`row.kind as Block["kind"]`) — seventeen times across five files by
 * 2026-10-04, two more than the day before. `$type` on the column says once
 * what each cast said separately.
 * docs/plans/261004d-sweep-cluster-17-boundary-types-and-false-comments.md.
 *
 * **`$type` validates nothing.** It is a claim to the compiler, and the thing
 * that makes it true is the CHECK constraint on each column. So this file has
 * two halves: the type-level half is `npm run typecheck`'s (vitest does not
 * type-check), and the runtime half reads each constraint's SQL off the table
 * and compares its value list with the union — which is what goes red when
 * somebody widens one without the other.
 */
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { revisionBlocks } from "../src/db/schema.js";
import type { Block, BlockKind } from "../src/types.js";

type Row = typeof revisionBlocks.$inferSelect;
type Role = NonNullable<Block["role"]>;
type Treatment = NonNullable<Block["treatment"]>;

/**
 * Every member of a union, checked both ways by the compiler: `T extends readonly U[]`
 * refuses a value that is not in the union, and the `Exclude` refuses a union
 * member that is not in the list.
 */
function allOf<U extends string>() {
  return <const T extends readonly U[]>(values: T & ([Exclude<U, T[number]>] extends [never] ? unknown : never)) =>
    values;
}

const KINDS = allOf<BlockKind>()(["heading", "text", "quote", "callout", "code", "media", "caption", "other"]);
const ROLES = allOf<Role>()(["footnote", "reference", "acknowledgment", "credit", "appendix"]);
const TREATMENTS = allOf<Treatment>()(["supplement"]);

/** The quoted values inside a CHECK's `in (…)`, as the schema renders it. */
function checkValues(name: string): string[] {
  const constraint = getTableConfig(revisionBlocks).checks.find((c) => c.name === name);
  if (!constraint) throw new Error(`missing constraint ${name}`);
  const rendered = new PgDialect().sqlToQuery(constraint.value).sql;
  const list = rendered.match(/ in \(([^)]*)\)\s*$/)?.[1];
  if (list === undefined) throw new Error(`${name} is not an \`in (…)\` list: ${rendered}`);
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

describe("revision_blocks' closed columns", () => {
  it("select as the unions, so no reader casts", () => {
    expectTypeOf<Row["kind"]>().toEqualTypeOf<BlockKind>();
    expectTypeOf<Row["role"]>().toEqualTypeOf<Role | null>();
    expectTypeOf<Row["treatment"]>().toEqualTypeOf<Treatment | null>();
  });

  it.each([
    ["revision_blocks_kind", KINDS],
    ["revision_blocks_role", ROLES],
    ["revision_blocks_treatment", TREATMENTS],
  ] as const)("%s allows exactly the union's values", (name, union) => {
    expect(checkValues(name).sort()).toEqual([...union].sort());
  });
});
