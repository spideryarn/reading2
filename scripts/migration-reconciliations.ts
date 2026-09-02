/**
 * What each out-of-order migration has to have *built*, stated exactly enough
 * that a database which merely looks right cannot pass.
 *
 * **Why this is a module and not a table inside the repair script.** Same
 * reason `migration-ledger.ts` is one: the judgements here have to be seen
 * failing, and a file that connects to Postgres at import time cannot be
 * unit-tested. Everything below is data and pure functions; the queries are run
 * by `scripts/db-repair-migration-ledger.ts` and by
 * `tests/migration-reconciliations.test.ts`, which watches every one of them go
 * red against the live catalogue before trusting any of them green.
 *
 * ## The mistake this file exists to correct
 *
 * The first version of these probes asked *does an object with this name
 * exist*, and answered with a row count. GPT Sol's review of the built code
 * (docs/plans/260831ag-migration-watermark-repair-code-review-sol.md § 1) is a
 * NO-SHIP on exactly that, and the sharpest instance is worth keeping in front
 * of whoever edits this next:
 *
 * ```sql
 * -- "revision_step_runs_step no longer allows 'summary'"  … want: NO ROWS
 * select 1 from pg_constraint where conname='revision_step_runs_step'
 *   and pg_get_constraintdef(oid) like '%''summary''%'
 * ```
 *
 * That returns nothing when the constraint correctly excludes `summary` **and
 * when the constraint does not exist at all**. A database with no
 * `revision_step_runs_step` — which admits every step name there is — passed it.
 * Every `want: false` probe in that table had the same shape.
 *
 * So a probe here returns **one value**, and the expected value is written out
 * in full:
 *
 * - **columns** — `format_type` with its typmod, nullability, the default
 *   expression or `(none)`, identity, generated, and the collation (which is
 *   how a `text` column built under a different `lc_collate` shows up);
 * - **CHECKs** — the owning schema and table, `contype`, the expression, and
 *   **`convalidated`**, because a `NOT VALID` constraint satisfies any name
 *   check while admitting rows the migration would have rejected. `conislocal`
 *   and `coninhcount` come along so that an inherited constraint is not read as
 *   a local one. Two forms: {@link constraintShape} pins the whole normalised
 *   `pg_get_constraintdef` text, and {@link whitelistShape} pins only that the
 *   expression is still a whitelist over a named column and that one named
 *   value is not in it. **Which form is right is not a matter of taste** — see
 *   the warning above RECONCILIATIONS. Pin the whole text where no later
 *   migration is entitled to change it, and the property where one is.
 *
 * ## Where the expected strings came from
 *
 * Not from reading the live catalogue and writing down what was there — that is
 * the circularity this whole piece of work is about. Each one was **derived
 * from the migration file**, and then certified by replaying that file's exact
 * DDL inside a rolled-back transaction and comparing the catalogue text it
 * produced (2026-08-31, Postgres 17.6, all eleven matched). The audit is in
 * docs/plans/260831ag-migration-watermark-repair-code-review-sol.md's answer.
 *
 * **They are deparsed forms, so they are Postgres-version-sensitive.** A server
 * that formats `pg_get_constraintdef` differently will make these refuse rather
 * than pass — loudly, which is the right way round for a script that is about
 * to write "this migration ran here".
 */

/**
 * One yes/no about the live catalogue, answered by comparing a **value**.
 *
 * `sql` must return at most one row with a single column named `actual`.
 */
export interface Probe {
  /** The postcondition, in the words you would want to read in a failure. */
  what: string;
  sql: string;
  /**
   * The exact text `actual` must equal, or `null` for "there must be no row" —
   * an absence, which is only ever used where the migration removed something.
   */
  want: string | null;
}

/**
 * What this repair knows how to reconcile.
 *
 * `effects` are the postconditions — probed before, to decide whether any DDL
 * is needed at all, and again after, to prove it happened. `repair` runs only
 * when an effect is missing. `refuseIf` is the starting-state assumption: if
 * one of these answers rows, the database is not in the state this
 * reconciliation was written for and we stop rather than improvise. The
 * "object exists with the wrong shape" half of `refuseIf` is not written out —
 * {@link shapeGuards} derives it from `effects`, so the two cannot drift.
 */
export interface Reconciliation {
  tag: string;
  why: string;
  effects: Probe[];
  refuseIf: { what: string; sql: string }[];
  repair: string[];
}

/* ------------------------------------------------------------------ */
/* The shape queries                                                   */
/* ------------------------------------------------------------------ */

/**
 * A column's whole shape as one string.
 *
 * `attidentity` and `attgenerated` are `"char"`, and `text || "char"` is
 * ambiguous in Postgres (42725) — hence the explicit `::text`. `attcollation`
 * is 0 for a non-collatable type, which is why the join is a LEFT one and the
 * missing case prints `-` rather than dropping the row.
 */
export function columnShape(table: string, column: string): string {
  return (
    `select format_type(a.atttypid, a.atttypmod)` +
    ` || case when a.attnotnull then ' NOT NULL' else ' NULL' end` +
    ` || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '(none)')` +
    ` || ' identity=' || coalesce(nullif(a.attidentity::text, ''), '-')` +
    ` || ' generated=' || coalesce(nullif(a.attgenerated::text, ''), '-')` +
    ` || ' collation=' || coalesce(co.collname, '-') as actual` +
    ` from pg_attribute a` +
    ` join pg_class c on c.oid = a.attrelid` +
    ` join pg_namespace n on n.oid = c.relnamespace` +
    ` left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum` +
    ` left join pg_collation co on co.oid = a.attcollation` +
    ` where n.nspname = 'spideryarn' and c.relname = '${table}'` +
    ` and a.attname = '${column}' and a.attnum > 0 and not a.attisdropped`
  );
}

/**
 * A constraint's whole shape as one string, **scoped to its owning table**.
 *
 * Constraint names are unique per table, not per schema, so a query on
 * `conname` alone can be answered by a same-named constraint on something else
 * entirely. `convalidated` is in the string because `NOT VALID` is the quiet
 * way to have a constraint that does not constrain what is already there.
 */
export function constraintShape(table: string, name: string): string {
  return (
    `select con.contype::text || ' on ' || n.nspname || '.' || rel.relname || ' '` +
    ` || pg_get_constraintdef(con.oid)` +
    ` || ' validated=' || con.convalidated` +
    ` || ' local=' || con.conislocal` +
    ` || ' inherited=' || con.coninhcount as actual` +
    ` from pg_constraint con` +
    ` join pg_class rel on rel.oid = con.conrelid` +
    ` join pg_namespace n on n.oid = rel.relnamespace` +
    ` where con.conname = '${name}' and n.nspname = 'spideryarn'` +
    ` and rel.relname = '${table}'`
  );
}

/**
 * **A whitelist CHECK, asked only what the migration actually promised.**
 *
 * `constraintShape` pins the *whole* deparsed expression, which is right for a
 * constraint nothing later touches and wrong for one that is a **list the
 * pipeline keeps adding to**. `revision_step_runs_step` has been re-added twice
 * since `0036` — `0041_rename_toc_step_to_hierarchy` and `0046_quiz` — so a
 * probe pinning `0036`'s twelve names goes red on a schema that is entirely
 * correct, and the fix everybody reaches for is to paste today's list in. That
 * is a probe teaching the next person to edit the expectation without reading
 * it.
 *
 * `0036_drop_summary_column` never promised a particular list. It promised that
 * **`'summary'` is not in it**. So this asks three things and nothing else:
 *
 * - the constraint **is there**, on the right table, validated and local — the
 *   half a `like '%''summary''%' … want: no rows` probe could never see, and
 *   the reason the predecessor passed on a database with no constraint at all;
 * - its expression **is still a whitelist over `column`** — `CHECK (true)` has
 *   the right name, is validated, mentions no step at all and admits every step
 *   name there is, so "does not mention summary" is not enough;
 * - `forbidden` **is not among the names it admits** — by membership of the
 *   parsed list rather than by substring, so a name that merely contains the
 *   word cannot answer for it.
 *
 * Which leaves the *other* names free to change, because whether the pipeline
 * has twelve steps or fourteen is nothing to do with `0036`.
 * `tests/db-step-constraint.test.ts` is what holds the newest migration's list
 * to `STEP_ORDER`; that is where "the list is today's list" belongs.
 *
 * Parsing note: Postgres deparses `in (…)` of two or more values as
 * `= ANY (ARRAY['a'::text, …])`, which is what the pattern below reads. A
 * one-element list deparses as a bare `=` and would read here as "not a
 * whitelist" — loudly wrong rather than quietly wrong, which is the right way
 * round for this file.
 */
export function whitelistShape(
  table: string,
  name: string,
  column: string,
  forbidden: string,
): string {
  const def = "pg_get_constraintdef(con.oid)";
  /* The capture is the ARRAY body. A non-match yields NULL, and NULL travels
     `string_to_array` → `unnest` (no rows) → `array_agg` (NULL) to arrive as a
     null `list`, which is the "not a whitelist" branch below.

     The trailing ` NOT VALID` is matched and thrown away — non-capturing,
     because `substring(… from …)` returns the *first* group and a second one
     would steal the answer. It is allowed for so that a `NOT VALID` whitelist
     reports itself as a whitelist that is not validated, which is the true
     complaint, rather than as "not a whitelist", which is not. Both fail; only
     one of them tells you what to fix. */
  const pattern = sqlLiteral(
    `^CHECK \\(\\(${column} = ANY \\(ARRAY\\[(.*)\\]\\)\\)\\)(?: NOT VALID)?$`,
  );
  return (
    `select con.contype::text || ' on ' || n.nspname || '.' || rel.relname || ' '` +
    ` || case when items.list is null` +
    `           then ${sqlLiteral(`not a ${column} whitelist: `)} || ${def}` +
    `         when ${sqlLiteral(forbidden)} = any (items.list)` +
    `           then ${sqlLiteral(`${column} whitelist ADMITTING '${forbidden}'`)}` +
    `         else ${sqlLiteral(`${column} whitelist without '${forbidden}'`)} end` +
    ` || ' validated=' || con.convalidated` +
    ` || ' local=' || con.conislocal` +
    ` || ' inherited=' || con.coninhcount as actual` +
    ` from pg_constraint con` +
    ` join pg_class rel on rel.oid = con.conrelid` +
    ` join pg_namespace n on n.oid = rel.relnamespace` +
    ` left join lateral (` +
    `   select array_agg(btrim(replace(x, '::text', ''), '''')) as list` +
    `     from unnest(string_to_array(substring(${def} from ${pattern}), ', ')) x` +
    ` ) items on true` +
    ` where con.conname = '${name}' and n.nspname = 'spideryarn'` +
    ` and rel.relname = '${table}'`
  );
}

const COLUMN_JSONB_NULLABLE = "jsonb NULL default=(none) identity=- generated=- collation=-";
const COLUMN_TEXT_NULLABLE = "text NULL default=(none) identity=- generated=- collation=default";

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

/**
 * ## ⚠ NO STEP NAME IN A `repair` OR A `refuseIf` MAY BE RENAMED. NOT EVER.
 *
 * `repair` is a migration's **own DDL, replayed**, and `refuseIf` is the
 * starting state that DDL needs in order to run. Both describe a migration that
 * has already happened. They are not descriptions of what the pipeline calls
 * things today and must never be brought into line with what it calls things
 * today.
 *
 * The reason is what a repaired ledger row *means*. When this script records
 * `0036_drop_summary_column` as applied, it stamps that file's sha256 and
 * asserts "this database has been brought to the state `0036` produced".
 * `0036`'s DDL writes a CHECK listing `'toc'` among its step names, because
 * that is the word the migration wrote. Modernise the literal to whatever the
 * step is called now and the row still carries `0036`'s hash while the database
 * carries a constraint `0036` never built — a lie, in the one table whose
 * entire job is to be believed, discovered later by somebody debugging a
 * `DROP CONSTRAINT` that cannot find its object.
 *
 * **This is live right now.** `569458f` renamed the `toc` step to `hierarchy`
 * across the repo, code and docs. GPT Sol stopped that rename at the door of
 * this table and of `drizzle/*.sql`, and was right to. The step-name *string*
 * then moved too, on 2026-08-31, in
 * `drizzle/0041_rename_toc_step_to_hierarchy.sql` — a new migration with a new
 * row, which is the only way it was ever allowed to move. **The `repair` and
 * `refuseIf` literals did not move with it and never will.**
 *
 * ## But an `effects` probe is a different kind of thing, and this warning used
 * to cover it too, which is how it came to be red for a whole day.
 *
 * An effect is a **postcondition, evaluated against the database as it is
 * now** — not against the database as it was the day the migration ran.
 * Everything later has also happened to it. So an effect may only assert the
 * part of the migration's postcondition that **later migrations are not
 * entitled to change**, and it must say that part exactly, in full, as a value.
 *
 * `0036`'s postcondition, written as the whole deparsed step list, failed that
 * test the moment `0041` renamed a step and `0046` added one: the probe went
 * red on a schema with nothing whatever wrong with it, and the tempting repair
 * — paste today's list in — is a habit of editing expectations without reading
 * them. What `0036` is actually entitled to assert for ever is that the CHECK
 * exists, still whitelists `step_name`, and **no longer admits `'summary'`**.
 * That is what {@link whitelistShape} asks. See the probe itself.
 *
 * The rule, then: **a `repair` literal is history and is frozen; an `effects`
 * literal is a claim about today and must be narrowed to what its migration
 * still owns.** Pinning more than that is not extra rigour, it is a fuse.
 *
 * The freeze also covers `drizzle/*.sql` and the snapshots in `drizzle/meta/`.
 * A migration file is a record of what ran; editing one changes its hash and
 * makes every ledger row that names it wrong.
 */
export const RECONCILIATIONS: Reconciliation[] = [
  {
    tag: "0032_jobs_concurrency_cap",
    why: "Verbatim. One DROP INDEX, nothing to back-fill.",
    effects: [
      {
        what: "the jobs_only_one_running index is gone",
        sql:
          `select indexname as actual from pg_indexes` +
          ` where schemaname='spideryarn' and indexname='jobs_only_one_running'`,
        want: null,
      },
      /* **The name was never the point.** What 0032 removed was the *rule* "at
         most one running job in the whole table", expressed as a unique index
         on a constant. An equivalent index under any other name enforces the
         same cap and would make `several articles at once` fail in production
         while this script recorded 0032 as applied. So the probe describes the
         shape instead: a unique index on `jobs`, predicated on `status`, whose
         key cannot tell two jobs apart — every key column is either an
         expression (attnum 0) or `status` itself. `jobs_one_running_per_slug`
         is unique on (slug) with a `running` predicate and is correctly not
         matched, because the slug distinguishes rows: it is the *article*
         mutex, not a global cap. (This named `jobs_active_slug` until
         2026-09-02, when that index was replaced — the reasoning is the same
         and the example had to move with it.) GPT Sol, § 1. */
      {
        what: "no other unique index still enforces one running job across the whole table",
        sql:
          `select i.relname || ' :: ' || pg_get_indexdef(ix.indexrelid) as actual` +
          ` from pg_index ix` +
          ` join pg_class i on i.oid = ix.indexrelid` +
          ` join pg_class t on t.oid = ix.indrelid` +
          ` join pg_namespace n on n.oid = t.relnamespace` +
          ` where n.nspname='spideryarn' and t.relname='jobs' and ix.indisunique` +
          ` and coalesce(pg_get_expr(ix.indpred, ix.indrelid), '') like '%running%'` +
          ` and not exists (` +
          `   select 1 from unnest(ix.indkey::int[]) k` +
          `    where k <> 0 and k is distinct from (` +
          `      select attnum from pg_attribute` +
          `       where attrelid = ix.indrelid and attname = 'status' and not attisdropped))`,
        want: null,
      },
    ],
    refuseIf: [],
    repair: [`DROP INDEX "spideryarn"."jobs_only_one_running"`],
  },
  {
    tag: "0033_quotes",
    why:
      "RECONCILED, not verbatim. The file's third statement re-adds " +
      "revision_step_runs_step with a step list written before `timeline` existed. " +
      "Replaying it after 0035_timeline rejects every timeline row (23514), and if " +
      "it did succeed it would forbid a step the pipeline still runs until 0036 " +
      "put it back. Only the column is taken; 0036 installs the correct final CHECK.",
    effects: [
      {
        what: "article_revisions.quotes is a nullable jsonb with no default",
        sql: columnShape("article_revisions", "quotes"),
        want: COLUMN_JSONB_NULLABLE,
      },
    ],
    refuseIf: [],
    repair: [`ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "quotes" jsonb`],
  },
  {
    tag: "0034_flowery_wolfsbane",
    why: "Verbatim. Two ADD COLUMNs on chat_messages.",
    effects: [
      {
        what: "chat_messages.passages is a nullable jsonb with no default",
        sql: columnShape("chat_messages", "passages"),
        want: COLUMN_JSONB_NULLABLE,
      },
      {
        what: "chat_messages.interrupted is boolean not-null default false",
        sql: columnShape("chat_messages", "interrupted"),
        want: "boolean NOT NULL default=false identity=- generated=- collation=-",
      },
    ],
    /* One present and one absent is a partial state somebody made by hand, not
       permission to replay the pair — the second statement would fail and take
       the transaction with it, which is the good outcome, but saying why up
       front is better than a 42701 nobody expected. Sol § 1. */
    refuseIf: [
      {
        what: "exactly one of chat_messages.passages / .interrupted exists",
        sql:
          `select c.n::text as actual from (select count(*) n from information_schema.columns` +
          ` where table_schema='spideryarn' and table_name='chat_messages'` +
          ` and column_name in ('passages','interrupted')) c where c.n = 1`,
      },
    ],
    repair: [
      `ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "passages" jsonb`,
      `ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "interrupted" boolean DEFAULT false NOT NULL`,
    ],
  },
  {
    tag: "0036_drop_summary_column",
    why:
      "Verbatim, and it is the destructive one: it DELETEs the summary step runs " +
      "and DROPs article_revisions.summary. Its final CHECK is the correct end " +
      "state — it is the one that has both `quotes` and `timeline` in it.",
    effects: [
      {
        what: "article_revisions.summary is gone",
        sql: columnShape("article_revisions", "summary"),
        want: null,
      },
      /* **The property, not the literal.** Two things went wrong here in turn.
         The predecessor asked for a same-named constraint whose text contains
         `'summary'` and wanted no rows — which a *missing* constraint answers
         just as well as a correct one, and a missing one lets every step name
         through (Sol § 1, the finding that made the review a NO-SHIP). The
         replacement pinned `0036`'s whole deparsed expression, which fixed that
         and bought a second fault: it asserted the other eleven step names too,
         and `0041_rename_toc_step_to_hierarchy` and `0046_quiz` have since
         re-added this constraint with a different, entirely correct list. The
         probe was red all day on a schema with nothing wrong with it.

         `0036` is "drop the summary column". Its postcondition is that
         `article_revisions.summary` is gone, that no summary step runs are
         left, and that this CHECK **no longer admits `'summary'`** — and not
         one word about which other steps exist. `whitelistShape` checks exactly
         that, so a fourteenth step does not make this red and `CHECK (true)`
         still does. The list belonging to *today* is
         `tests/db-step-constraint.test.ts`'s job, against `STEP_ORDER`. */
      {
        what:
          "revision_step_runs_step is still a step_name whitelist and no longer admits 'summary'",
        sql: whitelistShape("revision_step_runs", "revision_step_runs_step", "step_name", "summary"),
        want:
          "c on spideryarn.revision_step_runs step_name whitelist without 'summary'" +
          " validated=true local=true inherited=0",
      },
      {
        what: "no summary step runs are left",
        sql:
          `select count(*)::text as actual from "spideryarn"."revision_step_runs"` +
          ` where step_name = 'summary'`,
        want: "0",
      },
    ],
    /* The DELETE covers `summary` and nothing else, so any OTHER value outside
       the final list would fail the ADD CONSTRAINT. Finding one means the
       starting state is not what this reconciliation assumes; Sol § 2 is
       explicit that the answer then is to stop, not to widen the DELETE. */
    refuseIf: [
      {
        what: "revision_step_runs holds a step_name the new CHECK would reject and 0036 does not delete",
        /* ⚠ HISTORICAL STEP NAMES — DO NOT RENAME. 0036's list plus the one
           value its DELETE removes. See the warning above RECONCILIATIONS. */
        sql:
          `select distinct step_name as actual from "spideryarn"."revision_step_runs"` +
          ` where step_name not in ('fetch','extract','blocks','toc','assets','arc',` +
          `'tweets','glossary','quotes','ideas','timeline','sketch','summary')`,
      },
      {
        what: "something in the catalogue still depends on article_revisions.summary",
        sql:
          `select viewname as actual from pg_views where schemaname='spideryarn'` +
          ` and definition like '%summary%'`,
      },
    ],
    /* ⚠ HISTORICAL SQL — this is 0036_drop_summary_column's own DDL, and the
       step names in it are the ones that migration wrote. DO NOT RENAME them to
       match today's pipeline; see the warning above RECONCILIATIONS. */
    repair: [
      `ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step"`,
      `DELETE FROM "spideryarn"."revision_step_runs" WHERE "step_name" = 'summary'`,
      `ALTER TABLE "spideryarn"."article_revisions" DROP COLUMN "summary"`,
      `ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" ` +
        `CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks',` +
        `'toc','assets','arc','tweets','glossary','quotes','ideas','timeline','sketch'))`,
    ],
  },
  {
    tag: "0037_experimental_features_and_callout_blocks",
    why:
      "Usually reconcile-only on a laptop that had the two pre-renumbering local " +
      "migrations: their effects are already here under ledger rows whose files no " +
      "longer exist. Elsewhere — production — nothing has run and the DDL is needed.",
    effects: [
      {
        what: "reader_profiles.experimental_since is a nullable timestamptz with no default",
        sql: columnShape("reader_profiles", "experimental_since"),
        want: "timestamp with time zone NULL default=(none) identity=- generated=- collation=-",
      },
      /* Not "the text contains callout", which was the old test and which a
         constraint listing `callout` among the wrong seven other kinds would
         also pass. Sol called this one the worst offender. */
      {
        what: "revision_blocks_kind is 0037's full kind list, validated",
        sql: constraintShape("revision_blocks", "revision_blocks_kind"),
        want:
          "c on spideryarn.revision_blocks CHECK ((kind = ANY (ARRAY['heading'::text, " +
          "'text'::text, 'quote'::text, 'callout'::text, 'code'::text, 'media'::text, " +
          "'caption'::text, 'other'::text]))) validated=true local=true inherited=0",
      },
    ],
    refuseIf: [],
    repair: [
      `ALTER TABLE "spideryarn"."revision_blocks" DROP CONSTRAINT "revision_blocks_kind"`,
      `ALTER TABLE "spideryarn"."reader_profiles" ADD COLUMN "experimental_since" timestamp with time zone`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_kind" ` +
        `CHECK ("spideryarn"."revision_blocks"."kind" in ('heading','text','quote','callout',` +
        `'code','media','caption','other'))`,
    ],
  },
  {
    tag: "0038_block_contexts",
    why:
      "Another session's migration, whose columns and both CHECKs arrived here from " +
      "`drizzle-kit push` rather than from the file — so the postcondition holds and the " +
      "ledger row does not exist. Reconcile-only where that is true; the DDL is the " +
      "file's, verbatim, for anywhere it is not. If that file is edited later its hash " +
      "changes and the guard will say so, which is the right noise to make.",
    effects: [
      {
        what: "revision_blocks.context_id is a nullable text with no default",
        sql: columnShape("revision_blocks", "context_id"),
        want: COLUMN_TEXT_NULLABLE,
      },
      {
        what: "revision_blocks.context_type is a nullable text with no default",
        sql: columnShape("revision_blocks", "context_type"),
        want: COLUMN_TEXT_NULLABLE,
      },
      {
        what: "revision_blocks_context is the both-or-neither CHECK, validated",
        sql: constraintShape("revision_blocks", "revision_blocks_context"),
        want:
          "c on spideryarn.revision_blocks CHECK (((context_id IS NULL) = (context_type IS NULL)))" +
          " validated=true local=true inherited=0",
      },
      /* Postgres deparses a one-element `in (…)` as `=`, which is why the
         expected text is not the file's text. Certified by replaying the file's
         own statement in a rolled-back transaction, not by copying what was
         found here. */
      {
        what: "revision_blocks_context_type is the null-or-callout CHECK, validated",
        sql: constraintShape("revision_blocks", "revision_blocks_context_type"),
        want:
          "c on spideryarn.revision_blocks CHECK (((context_type IS NULL) OR " +
          "(context_type = 'callout'::text))) validated=true local=true inherited=0",
      },
    ],
    refuseIf: [],
    repair: [
      `ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "context_id" text`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "context_type" text`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_context" ` +
        `CHECK (("spideryarn"."revision_blocks"."context_id" is null) = ` +
        `("spideryarn"."revision_blocks"."context_type" is null))`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_context_type" ` +
        `CHECK ("spideryarn"."revision_blocks"."context_type" is null or ` +
        `"spideryarn"."revision_blocks"."context_type" in ('callout'))`,
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Reading a probe's answer                                            */
/* ------------------------------------------------------------------ */

/** One row of a probe's answer. `actual` is null when the SQL returned NULL. */
export interface ProbeRow {
  actual: string | null;
}

/**
 * Why this probe is not satisfied, or `null` if it is.
 *
 * More than one row is a failure of its own: a probe that cannot name a single
 * object is not answering the question it was written to ask.
 */
export function probeFailure(probe: Probe, rows: readonly ProbeRow[]): string | null {
  if (rows.length > 1) {
    return `${probe.what}: ${rows.length} rows came back, so the probe is not identifying one object`;
  }
  const actual = rows.length === 0 ? null : rows[0]!.actual;
  if (probe.want === null) {
    /* On `rows.length`, never on `actual`: a row whose single column is NULL is
       still an object that is there, and reading "no value" as "no object" is
       the whole family of mistake this file was rewritten to remove. */
    return rows.length === 0
      ? null
      : `${probe.what}: expected nothing, found ${JSON.stringify(actual)}`;
  }
  if (actual === probe.want) return null;
  return rows.length === 0
    ? `${probe.what}: nothing is there. Expected ${JSON.stringify(probe.want)}`
    : `${probe.what}: found ${JSON.stringify(actual)}, expected ${JSON.stringify(probe.want)}`;
}

/** A single-quoted SQL string literal. */
export function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * **"The object is there and it is the wrong thing"**, derived rather than
 * written out.
 *
 * Without these, a column of the right name and the wrong type simply reads as
 * "effect missing", the repair runs its `ADD COLUMN`, and Postgres answers
 * 42701 — a duplicate-column error that says nothing about the real disagreement.
 * With them the script stops and prints the shape it found beside the shape it
 * wanted. Derived from `effects` so that adding a probe cannot leave a guard
 * behind.
 *
 * Absence probes get none: for those the effect probe already *is* the guard.
 */
export function shapeGuards(r: Reconciliation): { what: string; sql: string }[] {
  return r.effects.flatMap((p) =>
    p.want === null
      ? []
      : [
          {
            what: `${p.what} — an object is there and it is not what ${r.tag} would have built`,
            sql: `select probe.actual from (${p.sql}) probe where probe.actual is distinct from ${sqlLiteral(p.want)}`,
          },
        ],
  );
}
