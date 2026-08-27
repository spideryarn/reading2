/**
 * Does the database have the columns this code expects?
 *
 * Twice on 2026-08-27 the deployed code selected a column the remote did not
 * have, and both times the first thing to notice was a reader getting a 500:
 *
 *     GET /api/jobs 500   column "profile" does not exist   (42703)
 *
 * The cause each time was migrations not applied to the database the code was
 * about to talk to. See docs/plans/schema-drift-guard.md for the plan and
 * docs/postmortems/unguarded-job-store-and-the-migration-that-migrated-the-laptop.md
 * for the first incident.
 *
 * **Why columns rather than the migration ledger.** `spideryarn_app` — the role
 * Vercel runs as — gets `permission denied for schema spideryarn_migrations`,
 * verified against the remote 2026-08-27, and granting it access would open up
 * a schema deliberately kept outside `schemaFilter` (drizzle.config.ts explains
 * why). It can already read `information_schema`. The two checks also answer
 * different questions, and this is the one that answers *can the running code
 * read what it is about to select*: it catches a hand-dropped column and a bad
 * restore as well as an unapplied migration. It does NOT catch a pending
 * migration that only adds constraints, indexes or backfills, and it does not
 * notice a database ahead of the checked-out commit — for those, compare the
 * ledger under the migration credential at deploy time. Both, not either.
 *   — GPT Sol's review, findings 2 and 4, 2026-08-27.
 */

import { getTableColumns, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "./schema.js";

/** The one schema this project owns. Matches `schemaFilter` in drizzle.config.ts. */
export const SCHEMA = "spideryarn";

/** A column as the database describes it. */
export type ActualColumn = {
  table: string;
  column: string;
  nullable: boolean;
  hasDefault: boolean;
  generated: boolean;
  identity: boolean;
  /** Can the connecting role actually SELECT it? Visible is not readable. */
  selectable: boolean;
};

export type ActualSchema = {
  /** False when the role cannot even USAGE the schema — every column would look missing. */
  schemaUsable: boolean;
  columns: ActualColumn[];
};

export type DriftReport = {
  /** How many tables the code declares. Zero means discovery broke, not that all is well. */
  declaredTables: number;
  /**
   * `table.column` that the code declares and the database does not offer.
   *
   * **"or inaccessible", not merely "missing".** `information_schema.columns`
   * shows only columns the current role holds some privilege on, so a privilege
   * gap and a dropped column are indistinguishable from here. That is the right
   * answer for this check either way — a column the app cannot see is one it
   * cannot select — but the wording must not promise more than it knows.
   */
  missingOrInaccessible: string[];
  /**
   * `table.column` the database *requires* and the code does not declare.
   *
   * Extra columns are normally harmless, and a rollback creates them routinely.
   * A `NOT NULL` column with no default is the exception: code that does not
   * know about it cannot insert a row at all. Only those are reported.
   */
  requiredButUndeclared: string[];
  /**
   * `table.column` the code expects the DATABASE to default, where it no longer
   * does. The column exists, so an existence check calls this healthy — and
   * every insert that omits the column fails.
   */
  defaultLost: string[];
  /** `table.column` where code and database disagree about NOT NULL. */
  nullabilityMismatch: string[];
  schemaUsable: boolean;
};

/** A column as the code declares it. */
export type DeclaredColumn = {
  name: string;
  notNull: boolean;
  /** The code expects the DATABASE to supply a value when an insert omits one. */
  hasDefault: boolean;
};

export type DeclaredTable = { table: string; columns: DeclaredColumn[] };

/** Every `PgTable` this project declares, with its database identifiers. */
export function declaredTables(): DeclaredTable[] {
  const out: DeclaredTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.schema !== SCHEMA) continue;
    out.push({
      table: config.name,
      /* `getTableColumns` keys by the TYPESCRIPT name — `rawSourceSha256` —
         while `.name` is the database's `raw_source_sha256`. 21 of the 39
         columns on `article_revisions` differ, so `Object.keys()` here would
         invent 21 missing columns and cry wolf on a healthy database. Found by
         GPT Sol's review and measured before it was believed. */
      columns: Object.values(getTableColumns(value)).map((c) => ({
        name: c.name,
        notNull: c.notNull,
        hasDefault: c.hasDefault,
      })),
    });
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * One query, and it asks two things a column list alone cannot answer.
 *
 * `BASE TABLE` matters because `information_schema.columns` includes view
 * columns, so a view of the right shape standing where a table should be would
 * otherwise pass silently. `has_schema_privilege` matters because object names
 * stay visible without `USAGE`, so without it a role that had lost access would
 * report every column missing and read as catastrophic drift.
 *
 * The schema name is interpolated rather than bound, so that one string can be
 * handed both to raw `pg` (scripts/db-check.ts) and to Drizzle's `sql.raw`
 * (src/vercel-health.ts) without each caller re-deciding how to bind it. Safe
 * because {@link SCHEMA} is a constant this repo owns — no caller supplies it,
 * and there is deliberately no parameter for one to supply.
 */
export const ACTUAL_SCHEMA_SQL = `
  select
    has_schema_privilege(current_user, '${SCHEMA}', 'USAGE') as schema_usable,
    c.table_name,
    c.column_name,
    c.is_nullable,
    c.column_default,
    c.is_generated,
    c.is_identity,
    /* "Visible" is weaker than "readable": information_schema shows a column
       the role holds ANY privilege on, so an INSERT-only grant lists a column
       that every select will refuse. Asked explicitly rather than assumed.
       GPT Sol's review, finding 3. */
    has_column_privilege(
      current_user,
      format('%I.%I', c.table_schema, c.table_name),
      c.column_name,
      'SELECT'
    ) as selectable
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
  where c.table_schema = '${SCHEMA}'
    and t.table_type = 'BASE TABLE'
`;

/** Shape the rows of {@link ACTUAL_SCHEMA_SQL} into an {@link ActualSchema}. */
export function readActualSchema(rows: Record<string, unknown>[]): ActualSchema {
  return {
    /* No rows at all is not proof of usability — assume unusable and let the
       caller's empty-result guard speak. */
    schemaUsable: rows[0]?.schema_usable === true,
    columns: rows.map((r) => ({
      table: String(r.table_name),
      column: String(r.column_name),
      nullable: r.is_nullable === "YES",
      hasDefault: r.column_default !== null,
      generated: r.is_generated === "ALWAYS",
      identity: r.is_identity === "YES",
      selectable: r.selectable === true,
    })),
  };
}

/**
 * Compare, exactly. Identifiers are never case-folded: Postgres folds unquoted
 * names to lower case on the way in, so by the time both sides are read back
 * they already agree — and folding here would hide a genuinely quoted
 * `"camelCase"` mismatch, which is the one case where the difference is real.
 */
export function compareSchema(declared: DeclaredTable[], actual: ActualSchema): DriftReport {
  /* Only SELECTable columns count as present. A column the role can insert into
     but not read is one every query in src/store/ will fail on. */
  const have = new Map(
    actual.columns.filter((c) => c.selectable).map((c) => [`${c.table}.${c.column}`, c]),
  );

  const missingOrInaccessible: string[] = [];
  const defaultLost: string[] = [];
  const nullabilityMismatch: string[] = [];

  for (const { table, columns } of declared) {
    for (const column of columns) {
      const key = `${table}.${column.name}`;
      const found = have.get(key);
      if (!found) {
        missingOrInaccessible.push(key);
        continue;
      }
      /* **The false green this check would otherwise have shipped.**
         `jobs.cancelling` is declared `.notNull().default(false)` and
         src/store/pg-jobs.ts `tryEnqueue` never sets it — the database default
         is the only thing that fills it in. Drop that default and the column
         still EXISTS, so an existence check stays green while every insert
         fails. GPT Sol's second review, finding 2. */
      if (column.notNull && column.hasDefault && !found.hasDefault && !found.generated && !found.identity) {
        defaultLost.push(key);
      }
      /* Declared nullable but required in the database: a write of `null` that
         the types permit will fail. Declared non-null but nullable in the
         database: a `null` can arrive where the types promise it cannot. */
      if (column.notNull !== !found.nullable) {
        nullabilityMismatch.push(
          `${key} (code says ${column.notNull ? "not null" : "nullable"}, database says ${found.nullable ? "nullable" : "not null"})`,
        );
      }
    }
  }

  const declaredSet = new Set(
    declared.flatMap(({ table, columns }) => columns.map((c) => `${table}.${c.name}`)),
  );
  const declaredTableNames = new Set(declared.map((d) => d.table));
  const requiredButUndeclared = actual.columns
    /* Only tables the code knows about. A table it has never heard of is
       somebody else's, and its NOT NULL columns are not our problem. */
    .filter((c) => declaredTableNames.has(c.table))
    .filter((c) => !declaredSet.has(`${c.table}.${c.column}`))
    .filter((c) => !c.nullable && !c.hasDefault && !c.generated && !c.identity)
    .map((c) => `${c.table}.${c.column}`);

  return {
    declaredTables: declared.length,
    missingOrInaccessible: missingOrInaccessible.sort(),
    requiredButUndeclared: requiredButUndeclared.sort(),
    defaultLost: defaultLost.sort(),
    nullabilityMismatch: nullabilityMismatch.sort(),
    schemaUsable: actual.schemaUsable,
  };
}

/** One line, suitable for a CLI or a health `warnings` entry. Empty when clean. */
export function driftWarnings(report: DriftReport): string[] {
  const warnings: string[] = [];
  if (report.declaredTables === 0) {
    warnings.push(
      "schema check found no declared tables — discovery is broken, so a clean result proves nothing",
    );
    return warnings;
  }
  if (!report.schemaUsable) {
    warnings.push(
      `the database role cannot USAGE schema ${SCHEMA}, so every column below may be a privilege gap rather than a missing column`,
    );
  }
  if (report.missingOrInaccessible.length > 0) {
    warnings.push(
      `the database is missing (or hides) ${report.missingOrInaccessible.length} column(s) this code selects: ` +
        `${report.missingOrInaccessible.join(", ")} — migrations are probably not applied to this database`,
    );
  }
  if (report.requiredButUndeclared.length > 0) {
    warnings.push(
      `the database requires ${report.requiredButUndeclared.length} column(s) this code does not set: ` +
        `${report.requiredButUndeclared.join(", ")} — inserts will fail`,
    );
  }
  if (report.defaultLost.length > 0) {
    warnings.push(
      `${report.defaultLost.length} column(s) this code relies on the database to default no longer have one: ` +
        `${report.defaultLost.join(", ")} — inserts that omit them will fail`,
    );
  }
  if (report.nullabilityMismatch.length > 0) {
    warnings.push(
      `${report.nullabilityMismatch.length} column(s) disagree about NOT NULL: ` +
        `${report.nullabilityMismatch.join(", ")}`,
    );
  }
  return warnings;
}
