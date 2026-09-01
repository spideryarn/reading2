/**
 * The repair's catalogue probes, watched failing.
 *
 * **Why this file exists.** The first version of those probes asked whether an
 * object of a given *name* existed and answered with a row count, and GPT Sol's
 * review of the built code is a NO-SHIP on it
 * (docs/plans/260831ag-migration-watermark-repair-code-review-sol.md § 1). The
 * sharpest case: "`revision_step_runs_step` no longer allows `'summary'`" was a
 * `like '%''summary''%'` expecting no rows, which a **missing** constraint
 * satisfies just as well as a correct one — and a missing one admits every step
 * name there is. Every absence-shaped probe in that table had the same hole.
 *
 * So there are two halves here. The first is pure and needs nothing: it feeds
 * `probeFailure` the shapes it exists to reject, including that one. The second
 * runs every real probe against the live catalogue and then **breaks the thing
 * each probe is about, inside a transaction that is rolled back**, to watch it
 * go red. A probe nobody has seen fail is the evidence
 * docs/reusable/silent-success.md warns about, and this whole piece of work
 * exists because `db:migrate` reported success while doing nothing.
 *
 * The live half is skipped unless `DATABASE_URL` is local and reachable. It
 * never leaves anything behind: every mutation is `begin` … `rollback`, which
 * is the same bargain `scripts/db-corpus-readiness.ts --seed-a-bad-row` makes
 * and for the same reason.
 */

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isLocalDatabaseUrl, sslDecisionFor } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import {
  columnShape,
  constraintShape,
  probeFailure,
  RECONCILIATIONS,
  shapeGuards,
  sqlLiteral,
  whitelistShape,
  type Probe,
  type ProbeRow,
} from "../scripts/migration-reconciliations.js";

/* ------------------------------------------------------------------ */
/* The comparison itself                                               */
/* ------------------------------------------------------------------ */

describe("probeFailure", () => {
  const present: Probe = { what: "the column", sql: "…", want: "jsonb NULL" };
  const absent: Probe = { what: "the column is gone", sql: "…", want: null };

  it("passes a presence probe whose value is exactly right", () => {
    expect(probeFailure(present, [{ actual: "jsonb NULL" }])).toBeNull();
  });

  it("fails a presence probe on a value that merely contains the right one", () => {
    expect(probeFailure(present, [{ actual: "jsonb NULL default=false" }])).toContain(
      "expected",
    );
  });

  it("says 'nothing is there' rather than a diff when the object is missing", () => {
    expect(probeFailure(present, [])).toContain("nothing is there");
  });

  it("passes an absence probe only when no row comes back", () => {
    expect(probeFailure(absent, [])).toBeNull();
  });

  /**
   * **The regression, stated as a test.** An absence probe must not be
   * satisfiable by a row whose value happens to be NULL — that is an object
   * that exists and declined to describe itself, which is the shape a
   * `select 1 … where <text> like '%x%'` produced when the constraint was gone.
   */
  it("fails an absence probe on a row whose value is NULL", () => {
    expect(probeFailure(absent, [{ actual: null }])).toContain("expected nothing");
  });

  it("fails any probe that returns more than one row, because it is not identifying one object", () => {
    expect(probeFailure(present, [{ actual: "a" }, { actual: "b" }])).toContain(
      "not identifying one object",
    );
  });
});

describe("shapeGuards", () => {
  it("makes no guard for an absence probe, where the effect probe is already the guard", () => {
    expect(
      shapeGuards({ tag: "t", why: "", effects: [{ what: "gone", sql: "select 1", want: null }], refuseIf: [], repair: [] }),
    ).toEqual([]);
  });

  it("quotes a want containing single quotes, so the guard is valid SQL and not an injection", () => {
    const [g] = shapeGuards({
      tag: "t",
      why: "",
      effects: [{ what: "c", sql: "select x as actual", want: "in ('a','b')" }],
      refuseIf: [],
      repair: [],
    });
    expect(g!.sql).toContain(`'in (''a'',''b'')'`);
  });

  it("escapes every quote, not the first", () => {
    expect(sqlLiteral("a'b'c")).toBe("'a''b''c'");
  });
});

/* ------------------------------------------------------------------ */
/* Against the live catalogue                                          */
/* ------------------------------------------------------------------ */

loadEnvLocal();
const URL_ = process.env.DATABASE_URL;

/**
 * Local only, and skipped rather than failed when there is no container.
 *
 * A refusal to run is not a pass, so the first test in the block below asserts
 * that the connection happened at all — otherwise "0 tests, all green" would
 * read the same as "every probe verified".
 */
const live = URL_ && isLocalDatabaseUrl(URL_) ? describe : describe.skip;

live("every probe, against the schema this laptop actually has", () => {
  let client: Client | null = null;
  let connected = false;

  beforeAll(async () => {
    const c = new Client({ connectionString: URL_!, ssl: sslDecisionFor(URL_!).ssl });
    try {
      await c.connect();
      client = c;
      connected = true;
    } catch {
      /* No container running. Reported by the first test rather than hidden. */
    }
  });

  afterAll(async () => {
    await client?.end();
  });

  const ask = async (p: Probe) =>
    probeFailure(p, (await client!.query<ProbeRow>(p.sql)).rows);

  /** Break something, ask, roll back. Nothing survives the call. */
  const whileBroken = async (ddl: string[], p: Probe): Promise<string | null> => {
    await client!.query("begin");
    try {
      for (const sql of ddl) await client!.query(sql);
      return await ask(p);
    } finally {
      await client!.query("rollback");
    }
  };

  const probe = (tag: string, what: string): Probe => {
    const r = RECONCILIATIONS.find((x) => x.tag === tag)!;
    const p = r.effects.find((e) => e.what.startsWith(what));
    if (!p) throw new Error(`no probe on ${tag} starting "${what}"`);
    return p;
  };

  it("is talking to a database at all", () => {
    expect(connected, "no local Postgres — start it with npm run db:start").toBe(true);
  });

  it("passes on the schema as it stands, or the reds below prove nothing", async () => {
    const failures: string[] = [];
    for (const r of RECONCILIATIONS) {
      for (const e of r.effects) {
        const why = await ask(e);
        if (why) failures.push(`${r.tag}: ${why}`);
      }
    }
    expect(failures).toEqual([]);
  });

  /* ── the absence probes, which is where the hole was ─────────────── */

  /**
   * **The finding, reproduced.** Drop `revision_step_runs_step` entirely and
   * the old probe — "no same-named constraint mentions 'summary'" — is
   * satisfied, because there is no constraint to mention anything. The
   * replacement asks for the whole list and so notices.
   */
  it("goes red when revision_step_runs_step is dropped altogether", async () => {
    const p = probe("0036_drop_summary_column", "revision_step_runs_step");
    const old = `select 1 as actual from pg_constraint where conname='revision_step_runs_step'` +
      ` and pg_get_constraintdef(oid) like '%''summary''%'`;
    const ddl = [`alter table "spideryarn"."revision_step_runs" drop constraint "revision_step_runs_step"`];

    /* What the predecessor would have said: nothing, i.e. "all is well". */
    expect(await whileBroken(ddl, { what: "old", sql: old, want: null })).toBeNull();
    /* What this one says. */
    expect(await whileBroken(ddl, p)).toContain("nothing is there");
  });

  /**
   * **The live step list, read independently of the probe.**
   *
   * A control that parses the constraint the same way the probe does shares the
   * probe's blind spots, so this reads the deparsed text with its own regexp.
   * It exists because of the asymmetry that made the old control impossible to
   * run: **adding a name to a CHECK is free, removing one is not.** Postgres
   * validates a re-added CHECK against the rows already in the table, and this
   * laptop now has step runs saying `hierarchy` and `quiz` — so the old
   * mutation, which re-added `0036`'s twelve historical names plus `summary`,
   * died with a 23514 before the probe was ever asked anything. Widening the
   * *current* list can never be refused by a row that is already there.
   */
  const liveStepNames = async (): Promise<string[]> => {
    const { rows } = await client!.query<{ def: string }>(
      `select pg_get_constraintdef(con.oid) as def from pg_constraint con` +
        ` join pg_class rel on rel.oid = con.conrelid` +
        ` join pg_namespace n on n.oid = rel.relnamespace` +
        ` where n.nspname='spideryarn' and rel.relname='revision_step_runs'` +
        ` and con.conname='revision_step_runs_step'`,
    );
    const names = [...(rows[0]?.def ?? "").matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
    /* Nothing parsed means the mutations below would be built from an empty
       list and would prove nothing at all. */
    if (names.length < 5) throw new Error(`could not read the live step list: ${rows[0]?.def}`);
    return names;
  };

  const dropStepCheck =
    `alter table "spideryarn"."revision_step_runs" drop constraint "revision_step_runs_step"`;
  const stepCheck = (names: readonly string[]) =>
    `alter table "spideryarn"."revision_step_runs" add constraint "revision_step_runs_step" ` +
    `check ("spideryarn"."revision_step_runs"."step_name" in (${names.map((n) => `'${n}'`).join(",")}))`;

  it("goes red when the step list lets 'summary' back in", async () => {
    const p = probe("0036_drop_summary_column", "revision_step_runs_step");
    const why = await whileBroken(
      [dropStepCheck, stepCheck([...(await liveStepNames()), "summary"])],
      p,
    );
    expect(why).toContain("ADMITTING 'summary'");
  });

  /**
   * **The coupling, gone, stated as a test.** This probe used to pin `0036`'s
   * whole twelve-name list, so every migration that added a step turned it red
   * on a correct schema — `0041` and `0046` both did — and the reflex fix was to
   * paste today's list in, which is how an expectation stops being read. A
   * step `0036` never heard of is not `0036`'s business.
   */
  it("stays green when a step the pipeline gained later is added to the list", async () => {
    const p = probe("0036_drop_summary_column", "revision_step_runs_step");
    expect(
      await whileBroken([dropStepCheck, stepCheck([...(await liveStepNames()), "fourteenth"])], p),
    ).toBeNull();
  });

  /**
   * **`NOT VALID` on this one too**, because it is the constraint the hole was
   * in. The list is right, the name is right, and `convalidated` is the only
   * field that says the rows already in the table were never checked against
   * it — so the probe names that rather than the list, which is the complaint
   * somebody can act on.
   */
  it("goes red on a step list re-added NOT VALID", async () => {
    const p = probe("0036_drop_summary_column", "revision_step_runs_step");
    const why = await whileBroken(
      [dropStepCheck, `${stepCheck(await liveStepNames())} not valid`],
      p,
    );
    expect(why).toContain("validated=false");
    /* And it still reads as the whitelist it is, rather than as gibberish. */
    expect(why).toContain("whitelist without 'summary' validated=false");
  });

  /**
   * **The other direction, which is where a narrowed probe could go wrong.**
   * `CHECK (true)` has the right name, is validated, is local, and mentions no
   * step name at all — so "the definition does not contain `'summary'`" calls
   * it correct while it admits every step name there is. That is the original
   * hole in a second costume, and it is why the probe asks whether the
   * expression is *still a whitelist* rather than only what is missing from it.
   */
  it("goes red on a constraint of the right name that whitelists nothing", async () => {
    const p = probe("0036_drop_summary_column", "revision_step_runs_step");
    const why = await whileBroken(
      [
        dropStepCheck,
        `alter table "spideryarn"."revision_step_runs" add constraint "revision_step_runs_step" check (true)`,
      ],
      p,
    );
    expect(why).toContain("not a step_name whitelist");
    expect(why).toContain("CHECK (true)");
  });

  /**
   * **`NOT VALID` is the quiet one.** A constraint added `NOT VALID` has the
   * right name and the right expression and does not apply to the rows already
   * in the table — so it admits exactly what the migration would have rejected,
   * and every name-based check calls it present.
   */
  it("goes red on a NOT VALID constraint that a name check would call present", async () => {
    const p = probe("0038_block_contexts", "revision_blocks_context_type");
    const why = await whileBroken(
      [
        `alter table "spideryarn"."revision_blocks" drop constraint "revision_blocks_context_type"`,
        `alter table "spideryarn"."revision_blocks" add constraint "revision_blocks_context_type" ` +
          `check ("spideryarn"."revision_blocks"."context_type" is null or ` +
          `"spideryarn"."revision_blocks"."context_type" in ('callout')) not valid`,
      ],
      p,
    );
    expect(why).toContain("validated=false");
  });

  it("goes red on a kind list that contains 'callout' among the wrong other kinds", async () => {
    const p = probe("0037_experimental_features_and_callout_blocks", "revision_blocks_kind");
    const why = await whileBroken(
      [
        `alter table "spideryarn"."revision_blocks" drop constraint "revision_blocks_kind"`,
        `update "spideryarn"."revision_blocks" set kind = 'text' ` +
          `where kind not in ('heading','text','callout')`,
        `alter table "spideryarn"."revision_blocks" add constraint "revision_blocks_kind" ` +
          `check ("spideryarn"."revision_blocks"."kind" in ('heading','text','callout'))`,
      ],
      p,
    );
    expect(why).toContain("expected");
    /* The old test was `definition like '%callout%'`, which this passes. */
    expect(why).toContain("callout");
  });

  /* ── the column probes ───────────────────────────────────────────── */

  it("goes red on a column of the right name and the wrong type", async () => {
    const p = probe("0033_quotes", "article_revisions.quotes");
    const why = await whileBroken(
      [
        `alter table "spideryarn"."article_revisions" drop column "quotes"`,
        `alter table "spideryarn"."article_revisions" add column "quotes" json`,
      ],
      p,
    );
    expect(why).toContain("found \"json NULL");
  });

  it("goes red on a column that gained a default the migration did not give it", async () => {
    const p = probe("0034_flowery_wolfsbane", "chat_messages.passages");
    const why = await whileBroken(
      [`alter table "spideryarn"."chat_messages" alter column "passages" set default '{}'::jsonb`],
      p,
    );
    expect(why).toContain("default='{}'::jsonb");
  });

  it("goes red on a not-null column whose default was dropped", async () => {
    const p = probe("0034_flowery_wolfsbane", "chat_messages.interrupted");
    const why = await whileBroken(
      [`alter table "spideryarn"."chat_messages" alter column "interrupted" drop default`],
      p,
    );
    expect(why).toContain("default=(none)");
  });

  it("goes red when a dropped column is claimed to be there", async () => {
    const p = probe("0037_experimental_features_and_callout_blocks", "reader_profiles.experimental_since");
    expect(
      await whileBroken(
        [`alter table "spideryarn"."reader_profiles" drop column "experimental_since"`],
        p,
      ),
    ).toContain("nothing is there");
  });

  /* ── 0036's absence probes ───────────────────────────────────────── */

  it("goes red if article_revisions.summary comes back", async () => {
    const p = probe("0036_drop_summary_column", "article_revisions.summary");
    expect(
      await whileBroken([`alter table "spideryarn"."article_revisions" add column "summary" jsonb`], p),
    ).toContain("expected nothing");
  });

  /* ── 0032, which is a rule rather than a name ────────────────────── */

  it("goes red if the index 0032 dropped is put back", async () => {
    const p = probe("0032_jobs_concurrency_cap", "the jobs_only_one_running index");
    expect(
      await whileBroken(
        [
          `create unique index "jobs_only_one_running" on "spideryarn"."jobs" ((true)) ` +
            `where status = 'running'`,
        ],
        p,
      ),
    ).toContain("expected nothing");
  });

  /**
   * **The name was never the rule.** An index enforcing "at most one running
   * job in the whole table" under any other name is the same cap, and the
   * name-only probe would have called 0032 applied. Sol asked for this one
   * explicitly.
   */
  it("goes red on an equivalent global cap under a different name", async () => {
    const p = probe("0032_jobs_concurrency_cap", "no other unique index");
    expect(
      await whileBroken(
        [
          `create unique index "jobs_at_most_one_busy" on "spideryarn"."jobs" ((1)) ` +
            `where status = 'running'`,
        ],
        p,
      ),
    ).toContain("jobs_at_most_one_busy");
  });

  it("does not mistake the per-owner, per-slug unique index for a global cap", async () => {
    /* `jobs_active_slug` is unique over (owner_id, slug) with a predicate that
       mentions `running`, and it is on the live schema — so the probe above
       passing at all is the assertion. Stated separately because a probe that
       flagged it would make every future run of this repair refuse. */
    const p = probe("0032_jobs_concurrency_cap", "no other unique index");
    expect(await ask(p)).toBeNull();
  });

  /* ── the derived shape guards ────────────────────────────────────── */

  it("has a shape guard that fires on the wrong shape and stays quiet on absence", async () => {
    const r = RECONCILIATIONS.find((x) => x.tag === "0033_quotes")!;
    const guard = shapeGuards(r)[0]!;
    await client!.query("begin");
    try {
      await client!.query(`alter table "spideryarn"."article_revisions" drop column "quotes"`);
      /* Absent: no refusal, because the repair's own ADD COLUMN is the answer. */
      expect((await client!.query(guard.sql)).rowCount).toBe(0);
      await client!.query(`alter table "spideryarn"."article_revisions" add column "quotes" text`);
      /* There, and wrong: refuse rather than let ADD COLUMN fail with a 42701. */
      expect((await client!.query(guard.sql)).rowCount).toBe(1);
    } finally {
      await client!.query("rollback");
    }
  });

  /* ── the shape queries name their table, not just their object ───── */

  it("does not answer a column question with a same-named column on another table", async () => {
    const rows = await client!.query<ProbeRow>(columnShape("chat_messages", "quotes"));
    expect(rows.rowCount).toBe(0);
  });

  it("does not answer a constraint question with a same-named constraint on another table", async () => {
    const rows = await client!.query<ProbeRow>(
      constraintShape("article_revisions", "revision_step_runs_step"),
    );
    expect(rows.rowCount).toBe(0);
  });

  it("does not answer a whitelist question with a same-named constraint on another table", async () => {
    const rows = await client!.query<ProbeRow>(
      whitelistShape("article_revisions", "revision_step_runs_step", "step_name", "summary"),
    );
    expect(rows.rowCount).toBe(0);
  });
});
