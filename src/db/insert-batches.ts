/**
 * Splitting a many-row insert so that no one statement binds too many parameters.
 *
 * Postgres' wire protocol carries the number of bound parameters of a statement
 * in a 16-bit field, so 65,535 is the most one statement can have. A multi-row
 * `INSERT … VALUES` binds one per column per row, which makes the limit a limit
 * on rows — and one more row than that is not refused with a sentence about
 * rows. The count wraps, and the server answers
 * `08P01: bind message has N parameter formats but 0 parameters`, which reads
 * as a transient protocol fault and was shown to a reader as "try again"
 * (docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md,
 * measured at 3,856 blocks).
 *
 * **No database, no connection**: this file is arithmetic over a table's
 * definition, so a test can import it without either
 * (tests/stated-limits.test.ts).
 */
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** The most parameters one statement may bind. Postgres', not ours. */
export const POSTGRES_MAX_PARAMETERS = 65_535;

/**
 * How many rows of `table` one insert may carry.
 *
 * **Derived from the table, not typed in**, so that a column added to the schema
 * shrinks the batch by itself. Drizzle binds at most one parameter per column
 * per row — a column the row leaves out is written as the keyword `default`,
 * and a generated one is not written at all — so the table's column count is a
 * bound on a row's parameters whatever the caller puts in the row.
 * tests/stated-limits.test.ts builds a full batch of the two tables that use
 * this and counts what Drizzle actually binds, which is what would notice if
 * that ever stopped being true.
 */
export function rowsPerStatement(table: PgTable): number {
  return Math.floor(POSTGRES_MAX_PARAMETERS / Object.keys(getTableColumns(table)).length);
}

/**
 * `rows`, in order, in runs short enough for one insert into `table` each.
 *
 * **Anything that depends on a row's position goes into the row before this is
 * called**, because the index inside a batch starts again at 0.
 */
export function inBatches<T>(table: PgTable, rows: readonly T[]): T[][] {
  const size = rowsPerStatement(table);
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += size) out.push(rows.slice(at, at + size));
  return out;
}
