## Your zone: the database schema and database structures

Greg, the owner, 2026-10-06: "Also pay attention to the database schema and database structures."

Follow `docs/reusable/improve-the-codebase.md` § Look at the schema, not only the code, with
`docs/project/database.md` and `docs/project/sql.md` ("columns over JSON, keys over good
intentions"). Read `src/db/schema.ts` (7.2k lines) IN FULL, the `drizzle/` migrations (154 files:
all of the last 40, the rest as needed), and the store files under `src/store/` plus `scripts/` for
who reads and writes each column. The schema was explicitly NOT swept by the sixth sweep ("Not
swept: the SQL of the migrations").

For every table, decide and record in a compact table:

- its purpose and the rows' owner key;
- any column nothing reads, and any nothing writes. An "unused" is an absence: grep `src/`,
  `scripts/`, `tools/`, `evals/`, `tests/` and raw SQL strings, for both the camelCase property and
  the snake_case column, and show the grep;
- JSON / JSONB columns, and whether each holds what should be columns or keys (per sql.md);
- foreign keys, UNIQUE, NOT NULL and CHECK the code assumes but the database does not enforce. Find
  the assumption in the code: a `!`, a read that takes the first row, an "exactly one" comment, an
  upsert target with no unique index;
- one fact stored twice;
- CHECK / enum values nothing produces any more (known lead: the retired `citation-find` rate
  bucket; find every other like it);
- names that no longer match the code (known: the step `hierarchy` became `structure` on
  2026-10-02, `trajectory` became `skim`, and before those `toc`);
- timestamp columns missing where a reader does or a model makes something (house rule: store when
  it happened);
- indexes: for each hot query in the request path and the job queue (list them with the store
  function), which index serves it, which queries have none, which indexes no query can use, and
  duplicates or prefix-redundant ones.

For each index or constraint finding give the **exact SQL** to run: an `EXPLAIN (ANALYZE, BUFFERS)`
for the local database, and a read-only `SELECT count(*)` for production (counts only, never prose
columns) that decides whether today's data satisfies the constraint.

Classify every proposed change: **additive-safe** (an index; a constraint, FK, NOT NULL or CHECK the
data already satisfies; `NOT VALID` then `VALIDATE` where a table is large) versus **needs the
owner** (drops a column or table, rewrites or deletes rows, changes a type). For the second kind
write what it removes and what it costs. Also say how a migration is written and applied here (read
database.md) and what in that process is error-prone.

Finding IDs: DB1, DB2, ...
