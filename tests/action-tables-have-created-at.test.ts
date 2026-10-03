/**
 * **Store when it happened** — AGENTS.md § Writing code, and
 * docs/plans/261003j-store-when-it-happened-timestamp-audit.md.
 *
 * Every table in src/db/schema.ts either has a `created_at` timestamp, or is
 * named in `WITHOUT_CREATED_AT` below with the existing timestamp column that
 * plays that part, or with the reason it needs none. A new table that arrives
 * with no time fails here, and so does an entry in the map that has gone stale.
 *
 * No database: this reads the declaration. Whether the database *has* the
 * column, and still defaults it, is src/db/schema-drift.ts's question.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/db/schema.js";

/** A table as this rule needs to see it: its name, and each column's SQL type. */
type TableShape = { name: string; columns: { name: string; sqlType: string }[] };

/** Either another column says when, or the table has a reason to say nothing. */
type Allowance = { column: string } | { exempt: string };

/**
 * The tables with no `created_at`, and why that is fine.
 *
 * `column` is the timestamp that says when the row's event happened, under the
 * name the table already had for it. `exempt` is a reason, in words, that the
 * row is not something a person or a model did at a moment.
 */
const WITHOUT_CREATED_AT: Record<string, Allowance> = {
  article_visibility_changes: { column: "at" },
  /* A fetch cache rather than an action, but it does say when it fetched. */
  bibliographic_records: { column: "fetched_at" },
  bibliographic_service_slots: { exempt: "a lease on a rate-limited service, not an action" },
  bibliographic_services: { exempt: "one row of rate-limit state per outside service, not an action" },
  billing_tier_prices: { exempt: "a price list, not an action" },
  block_identities: { column: "first_seen_at" },
  ingest_events: { column: "reserved_at" },
  link_previews: { column: "fetched_at" },
  queue_state: { column: "updated_at" },
  rate_limit_events: { column: "started_at" },
  reader_arrivals: { column: "first_seen_at" },
  reading_time: {
    exempt:
      "the privacy page promises 'the totals, not a history' (docs/project/privacy.md § Reading time); " +
      "a time per passage is the start of that history, so adding one is a product decision for Greg",
  },
  revision_blocks: { exempt: "part of a revision, and article_revisions.created_at times the revision" },
  revision_phrase_runs: { column: "computed_at" },
  revision_step_runs: { column: "started_at" },
  shelf_topic_scores: { column: "computed_at" },
  upload_source_guesses: { column: "claimed_at" },
  uploads: { column: "minted_at" },
};

function isTimestamp(sqlType: string): boolean {
  return sqlType.startsWith("timestamp");
}

/**
 * The judgement, with nothing read from the real schema — so it can be shown
 * failing on a table that does not exist.
 */
function createdAtProblems(tables: TableShape[], allowances: Record<string, Allowance>): string[] {
  const problems: string[] = [];
  const byName = new Map(tables.map((t) => [t.name, t]));

  for (const table of tables) {
    const createdAt = table.columns.find((c) => c.name === "created_at");
    const allowance = allowances[table.name];

    if (createdAt && !isTimestamp(createdAt.sqlType)) {
      problems.push(`${table.name}.created_at is ${createdAt.sqlType}, not a timestamp`);
      continue;
    }
    if (createdAt && allowance) {
      problems.push(
        `${table.name} has created_at now, so its entry in WITHOUT_CREATED_AT is stale — delete the entry`,
      );
      continue;
    }
    if (createdAt) continue;

    if (!allowance) {
      problems.push(
        `${table.name} has no created_at. Store when it happened (AGENTS.md § Writing code): add ` +
          '`createdAt: timestamp("created_at", { withTimezone: true })` — `.defaultNow()`, and nullable if the ' +
          "table already has rows, so none is given an invented time (docs/project/sql.md § Store when it " +
          "happened). If another timestamp column already says when, or the row is not an action at all, " +
          "add the table to WITHOUT_CREATED_AT in tests/action-tables-have-created-at.test.ts as " +
          '`{ column: "…" }` or `{ exempt: "the reason, in words" }`.',
      );
      continue;
    }
    if ("column" in allowance) {
      const stand = table.columns.find((c) => c.name === allowance.column);
      if (!stand) {
        problems.push(
          `${table.name}: WITHOUT_CREATED_AT says ${allowance.column} is its time, and the table has no such column`,
        );
      } else if (!isTimestamp(stand.sqlType)) {
        problems.push(
          `${table.name}: WITHOUT_CREATED_AT says ${allowance.column} is its time, but it is ${stand.sqlType}, not a timestamp`,
        );
      }
    } else if (allowance.exempt.trim().length < 10) {
      problems.push(`${table.name}: an exemption needs a reason in words, not "${allowance.exempt}"`);
    }
  }

  for (const name of Object.keys(allowances)) {
    if (!byName.has(name)) {
      problems.push(`WITHOUT_CREATED_AT names ${name}, which is not a table in src/db/schema.ts — delete the entry`);
    }
  }
  return problems.sort();
}

/** Every exported `PgTable`, as the rule sees it. */
function declaredShapes(): TableShape[] {
  const out: TableShape[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    out.push({
      name: config.name,
      columns: config.columns.map((c) => ({ name: c.name, sqlType: c.getSQLType() })),
    });
  }
  return out;
}

describe("every table says when its rows happened", () => {
  const tables = declaredShapes();

  it("finds the schema's tables at all — an empty discovery would pass everything below", () => {
    expect(tables.length).toBeGreaterThan(40);
    expect(tables.map((t) => t.name)).toContain("glossary_hidden_entries");
    expect(new Set(tables.map((t) => t.name)).size).toBe(tables.length);
  });

  it("has a created_at timestamp on each, or a named stand-in, or a stated reason", () => {
    expect(createdAtProblems(tables, WITHOUT_CREATED_AT)).toEqual([]);
  });

  it("holds the five tables stage 1 of 261003j added it to, nullable and defaulted", () => {
    /* Nullable: a row from before 2026-10-03 has no time, and is not given one.
       Defaulted: no store names the column, so the default is the only writer. */
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      if (
        ![
          "glossary_hidden_entries",
          "reader_profiles",
          "glossary_lookups",
          "citation_finds",
          "citation_investigations",
        ].includes(config.name)
      ) {
        continue;
      }
      const createdAt = config.columns.find((c) => c.name === "created_at");
      expect(createdAt, config.name).toBeDefined();
      expect(createdAt?.getSQLType(), config.name).toBe("timestamp with time zone");
      expect(createdAt?.notNull, config.name).toBe(false);
      expect(createdAt?.hasDefault, config.name).toBe(true);
    }
  });
});

describe("createdAtProblems, shown failing", () => {
  const timed: TableShape = {
    name: "made_up_actions",
    columns: [
      { name: "id", sqlType: "uuid" },
      { name: "created_at", sqlType: "timestamp with time zone" },
    ],
  };
  const untimed: TableShape = {
    name: "made_up_actions",
    columns: [
      { name: "id", sqlType: "uuid" },
      { name: "note", sqlType: "text" },
    ],
  };

  it("is red on a table with no time column, and says what to do about it", () => {
    const problems = createdAtProblems([untimed], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("made_up_actions has no created_at");
    expect(problems[0]).toContain("Store when it happened");
    expect(problems[0]).toContain("WITHOUT_CREATED_AT");
  });

  it("is green once the table has one", () => {
    expect(createdAtProblems([timed], {})).toEqual([]);
  });

  it("is green on a stand-in column that exists and is a timestamp, red when it is neither", () => {
    const withAt: TableShape = {
      name: "made_up_actions",
      columns: [
        { name: "at", sqlType: "timestamp with time zone" },
        { name: "label", sqlType: "text" },
      ],
    };
    expect(createdAtProblems([withAt], { made_up_actions: { column: "at" } })).toEqual([]);
    expect(createdAtProblems([withAt], { made_up_actions: { column: "gone_at" } })[0]).toContain(
      "has no such column",
    );
    expect(createdAtProblems([withAt], { made_up_actions: { column: "label" } })[0]).toContain(
      "not a timestamp",
    );
  });

  it("accepts an exemption with a reason, and refuses one without", () => {
    expect(createdAtProblems([untimed], { made_up_actions: { exempt: "a price list, not an action" } })).toEqual([]);
    expect(createdAtProblems([untimed], { made_up_actions: { exempt: "" } })[0]).toContain("needs a reason");
  });

  it("is red on a stale entry: a table that has gained created_at, or one that is gone", () => {
    expect(createdAtProblems([timed], { made_up_actions: { column: "at" } })[0]).toContain("stale");
    expect(createdAtProblems([timed], { dropped_table: { exempt: "it was a price list" } })[0]).toContain(
      "not a table",
    );
  });

  it("is red on a created_at that is not a timestamp", () => {
    const wrong: TableShape = { name: "made_up_actions", columns: [{ name: "created_at", sqlType: "text" }] };
    expect(createdAtProblems([wrong], {})[0]).toContain("not a timestamp");
  });
});

/**
 * **A migration must not invent a time.** `ADD COLUMN … timestamp … DEFAULT
 * now()` is what drizzle generates for `.defaultNow()`, and on a table with
 * rows it writes the migration's own time into every one of them — a time for
 * an event that happened earlier, indistinguishable afterwards from a real
 * one. The form to hand-edit it into is two statements: add the column with no
 * default, then `ALTER COLUMN … SET DEFAULT now()`. docs/project/sql.md
 * § Store when it happened.
 */
function inventedTimes(file: string, sqlText: string): string[] {
  return sqlText
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .filter((line) =>
      /ADD COLUMN\s+"[^"]+"\s+timestamp[^;]*DEFAULT\s*\(*\s*(now\s*\(\s*\)|CURRENT_TIMESTAMP)/i.test(line),
    )
    .map(
      (line) =>
        `${file}: \`${line.replace(/--> statement-breakpoint/, "").trim().replace(/\s+/g, " ")}\` stamps every existing row with the ` +
        "migration's own time. Split it: ADD COLUMN with no default, then ALTER COLUMN … SET DEFAULT now() — " +
        "docs/project/sql.md § Store when it happened.",
    );
}

describe("no migration invents a time for rows that already exist", () => {
  const DRIZZLE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const files = readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql"));

  it("reads the migrations at all", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("20261003170347_store_when_it_happened.sql");
  });

  it("finds no `ADD COLUMN … timestamp … DEFAULT now()` in any of them", () => {
    expect(files.flatMap((f) => inventedTimes(f, readFileSync(path.join(DRIZZLE, f), "utf8")))).toEqual([]);
  });

  it("is red on the line drizzle generates, and green on the two-statement form", () => {
    const generated =
      'ALTER TABLE "spideryarn"."citation_finds" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint';
    expect(inventedTimes("made_up.sql", generated)).toHaveLength(1);
    expect(inventedTimes("made_up.sql", generated)[0]).toContain("SET DEFAULT now()");

    const split = [
      '-- ADD COLUMN "created_at" timestamp with time zone DEFAULT now() is what this used to say',
      'ALTER TABLE "spideryarn"."citation_finds" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint',
      'ALTER TABLE "spideryarn"."citation_finds" ALTER COLUMN "created_at" SET DEFAULT now();',
    ].join("\n");
    expect(inventedTimes("made_up.sql", split)).toEqual([]);
    /* Statements, not lines: a statement broken across lines, or a bracketed
       default, backfills just the same (GPT Sol's code review, F9). A formatting
       guard, not a SQL parser. */
    expect(
      inventedTimes(
        "made_up.sql",
        'ALTER TABLE "spideryarn"."citation_finds"\nADD COLUMN "created_at" timestamp with time zone\nDEFAULT now();',
      ),
    ).toHaveLength(1);
    expect(
      inventedTimes(
        "made_up.sql",
        'ALTER TABLE "spideryarn"."citation_finds"\nADD COLUMN "created_at" timestamp with time zone DEFAULT (now());',
      ),
    ).toHaveLength(1);
    /* A new table is not an existing row: `CREATE TABLE` may default freely. */
    expect(
      inventedTimes("made_up.sql", '\t"created_at" timestamp with time zone DEFAULT now() NOT NULL,'),
    ).toEqual([]);
  });
});
