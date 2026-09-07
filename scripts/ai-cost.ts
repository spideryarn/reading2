#!/usr/bin/env -S npx tsx
/**
 * What the model calls have cost — read out of the ledger.
 *
 *     npm run cost                      the current UTC month
 *     npm run cost -- --month 2026-07   one month
 *     npm run cost -- --since 2026-08-01 --until 2026-08-15
 *     npm run cost -- --all             everything there is
 *     npm run cost -- --reconcile       ask OpenRouter what it thinks (network, free)
 *     npm run cost -- --owners          what each owner cost, by category, with the spread
 *     npm run cost -- --owners --price 20   …and the margin at a $20/month price
 *     npm run cost -- --owners --price 20 --month 2026-08    …over a month that finished
 *
 * A `--price` is a MONTH's price, and the margin is only a monthly margin over a
 * whole finished month. Over anything else — a custom range, `--all`, or the
 * default current month, which is two days long on the 3rd — the heading says so
 * in those words. `marginPeriod` below has the argument.
 *
 * ## `--owners` is a different report, not a flag on this one
 *
 * Everything else here is a developer asking "where did the money go". `--owners`
 * is the **pricing** report: per-owner spend over an arbitrary half-open range,
 * split by what kind of work it bought, with a median/p95/max spread across
 * *every account* rather than only the ones that spent something.
 *
 * It is Postgres-only, deliberately — src/store/ai-calls-spend-pg.ts says why —
 * and it never calls `costStore.read()`. Two reasons, and the second is the
 * interesting one: a `GROUP BY` in the database is the point (a fold over every
 * row in JavaScript is fine at four thousand rows and not at four hundred
 * thousand), and reading whole rows would make the report fail on any box whose
 * migrations are behind, which is precisely the box that most needs to be told
 * what its own coverage is.
 *
 * ## UTC, and half-open
 *
 * "What did August cost" needs a timezone, and a call at 00:30 BST on 1
 * September is an August call in UTC. This picks **UTC** and says so on every
 * line, for a reason beyond consistency: OpenRouter's own key limits reset at
 * midnight UTC, so it is the only boundary the reconciliation below can share.
 * Ranges are `[since, until)` — the end is the first instant *not* counted — so
 * two adjacent months can never both claim the same call.
 *
 * ## The two counters this cannot print, and what stands in for them
 *
 * `unscopedCalls()` and `lateCalls()` in [src/ai-spend.ts](../src/ai-spend.ts)
 * count the calls that fell outside a collector or finished after one closed.
 * Both live in **one server process's memory**, and this is a different process
 * that starts them at zero — so printing them here would be a reassuring pair of
 * noughts with nothing behind them. GPT Sol pointed that out.
 *
 * They are a *server-side* signal: the warn line beside each one is what reaches
 * a person. What this report asks instead is the question the rows can answer —
 * how many of them reported no money, and how much was spent on calls that
 * failed — which is the same worry from the other end.
 */

import { formatNanos } from "../src/ai-spend.js";
import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import { costStore, totalRows } from "../src/store/ai-calls.js";
import type { LedgerRead } from "../src/store/contracts.js";
import {
  type AccountTally,
  type CredentialTally,
  type RealtimeCoverage,
  accountsInWindow,
  credentialsInWindow,
  currentUtcMonth,
  realtimeSessionCoverage,
  spendGroupedByOwner,
} from "../src/store/ai-calls-spend-pg.js";
import { CATEGORY_MEANING, COST_CATEGORIES } from "../src/cost-categories.js";
import {
  OPENROUTER_CREDIT_FEE,
  type SpendFold,
  billReport,
  cashNanos,
  foldSpend,
  partitionByScope,
  spendPerAccount,
  spread,
  totalNanos,
} from "../src/cost-report.js";
import { DECLARATIONS, UNMETERED_SPEND } from "../src/spend-declarations.js";
import { isMain } from "../src/is-main.js";

interface Args {
  since?: string;
  until?: string;
  all: boolean;
  reconcile: boolean;
  /** `--owners` — the pricing report. See the header. */
  owners: boolean;
  /**
   * `--price 20` — a candidate monthly subscription, in dollars.
   *
   * Only ever used to subtract: *price minus what the models cost this account*.
   * It is **not** a scenario engine and must not become one — GPT Sol cut that
   * from this stage, and the candidate-price arithmetic belongs in a measured
   * plan document rather than in code. In particular it is never prorated: see
   * `marginPeriod`, which says what period the subtraction was actually over
   * instead of scaling it into one nobody measured.
   */
  price?: number;
  label: string;
}

/** The first instant of a UTC month, and of the one after it. */
function monthRange(month: string): { since: string; until: string } {
  /* **`(0[1-9]|1[0-2])`, not `\d{2}`.** The loose version accepted `2026-13`,
     and `Date.UTC` normalises it into January 2027 — so the range came back
     inverted, `since` after `until`, and the report silently covered nothing.
     A test that only rejected "August" was green against all of that. GPT Sol. */
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`--month wants YYYY-MM with a month of 01-12, got ${JSON.stringify(month)}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const since = new Date(Date.UTC(year, mon - 1, 1));
  const until = new Date(Date.UTC(mon === 12 ? year + 1 : year, mon % 12, 1));
  return { since: since.toISOString(), until: until.toISOString() };
}

/**
 * **One definition, shared with the admin page.** `currentUtcMonth` lives in
 * src/store/ai-calls-spend-pg.ts because that is where the query it bounds
 * lives; `/admin/users` labels its spend column with the same period, and a
 * column headed "this month" that meant something slightly different from this
 * report is a discrepancy nobody would ever chase.
 *
 * `monthRange` above stays, and does a different job: it *parses* a `--month`
 * somebody typed, with a regex that has already caught `2026-13` inverting the
 * range. This one constructs rather than parses.
 */
function thisMonth(): { since: string; until: string; label: string } {
  return currentUtcMonth();
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { all: false, reconcile: false, owners: false, label: "" };
  const rest = [...argv];
  const value = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  while (rest.length > 0) {
    const flag = rest.shift() as string;
    switch (flag) {
      case "--month": {
        const label = value("--month");
        Object.assign(out, monthRange(label), { label });
        break;
      }
      case "--since":
        out.since = new Date(value("--since")).toISOString();
        break;
      case "--until":
        out.until = new Date(value("--until")).toISOString();
        break;
      case "--all":
        out.all = true;
        break;
      case "--reconcile":
        out.reconcile = true;
        break;
      case "--owners":
        out.owners = true;
        break;
      case "--price": {
        const raw = value("--price");
        const price = Number(raw);
        /* Refused rather than coerced. `Number("twenty")` is `NaN`, and every
           margin computed from it would print as `$NaN` on a page whose whole
           purpose is a number somebody will act on. Zero is refused for the same
           reason a zero pocket is not printed: it is not a candidate price. */
        if (!Number.isFinite(price) || price <= 0) {
          throw new Error(`--price wants a positive number of dollars, got ${JSON.stringify(raw)}`);
        }
        out.price = price;
        break;
      }
      default:
        throw new Error(`Unknown flag ${JSON.stringify(flag)}`);
    }
  }
  if (out.all) {
    return {
      all: true,
      reconcile: out.reconcile,
      owners: out.owners,
      ...(out.price === undefined ? {} : { price: out.price }),
      label: "all time",
    };
  }
  if (!out.since && !out.until) {
    const m = thisMonth();
    return { ...out, since: m.since, until: m.until, label: `${m.label} (UTC)` };
  }
  return { ...out, label: out.label || `${out.since ?? "the beginning"} → ${out.until ?? "now"}` };
}

/** Sum by one facet, biggest first. One implementation for every breakdown. */
/* Exported for tests/ai-cost-cli.test.ts: the two bugs this file has had were
   both in what a number *includes*, and neither showed up in a type. */
export function by(
  rows: readonly AiCallRow[],
  key: (r: AiCallRow) => string | null,
): Breakdown[] {
  const groups = new Map<string, AiCallRow[]>();
  for (const r of rows) {
    const name = key(r) ?? "—";
    const list = groups.get(name);
    if (list) list.push(r);
    else groups.set(name, [r]);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      /* **All three pockets, not just `credits`.** The first version summed
         credits alone, so every breakdown printed `$0.0000` for the declared
         bypasses — money really spent, itemised by day and by model, showing as
         nothing. Found by running the report after a live probe rather than by
         an assertion, which is the same way `formatNanos` was caught rounding a
         real cost to zero. The pocket lines above keep them apart; a *breakdown*
         wants the whole of what a job or a day cost. */
      const { credits, upstream, computed, unpriced } = totalRows(list);
      return { name, calls: list.length, nanos: credits + upstream + computed, unpriced };
    })
    .sort((a, b) => b.nanos - a.nanos);
}

/** One `(job, step)` that more than one collector ran. */
interface DuplicateJobStep {
  jobId: string;
  stepName: string;
  /** Distinct `run_id`s — one per collector, so one per execution of the step. */
  runs: number;
  calls: number;
  /** What all of those runs cost together, all three pockets. */
  nanos: number;
}

/**
 * **Did any job step run more than once?** — the question nobody had ever asked
 * the ledger.
 *
 * On 2026-08-30 one article's `hierarchy` step ran **eleven times at once**
 * under a single job id, because a dev-server restart re-evaluated the modules
 * holding the queue's locks while the step already in flight kept going.
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md fixed the cause
 * and then ranked *reading the ledger for duplicates at all* as its second
 * remedy, in these words:
 *
 * > nobody had ever asked it, on 565 rows. The two big ones were found by eye
 * > three days later; the six on `read` were never found at all until this.
 *
 * **Distinct `run_id`s, not rows.** A collector is opened once per execution
 * and every call inside it carries that id, so one step legitimately writes
 * several rows sharing a `run_id` — `hierarchy` makes three — and counting rows
 * would report every ordinary step as a duplicate. What is not ordinary is two
 * *collectors* under one `(job_id, step_name)`. See `AiCallRow.runId` in
 * src/ai-spend.ts.
 *
 * **A pure fold over the rows the report already has**, deliberately, rather
 * than a grouped query in the database. The incident happened in `files` mode,
 * in the JSONL ledger, so a Postgres-only `GROUP BY` would not have fired on the
 * one case this is being built for — and `main()` has already loaded the window
 * into memory to draw every table below. One fold covers both stores because
 * both answer `costStore.read()` in the same shape (src/store/ai-calls.ts picks
 * which), and there is no second implementation to disagree with the first.
 *
 * ## Why this cannot become a wall of output
 *
 * It is **a line in a report somebody ran**, not an alert, so there is nothing
 * to tune and nobody to wake — which is most of the answer. The rest: a healthy
 * ledger prints nothing at all, because only groups above one run are returned;
 * the universe is bounded by the distinct `(job, step)` pairs inside the range
 * asked for, not by the row count; and `printDuplicateJobSteps` shows the worst few
 * and counts the rest, so the pathological case — every step duplicated — is a
 * short paragraph rather than a page.
 *
 * **What it deliberately does not try to tell apart** is a duplicate execution
 * from an honest retry after a failure: `advance` really does run a step again
 * when the last attempt was interrupted, and that is a second `run_id` too. Both
 * are worth a human's eye and neither is worth a threshold, so the line reports
 * the shape and says which it cannot distinguish.
 *
 * Exported for tests/ai-cost-cli.test.ts, like `by` above and for the same
 * reason: what a number counts is not something a type can check.
 */
export function duplicateJobSteps(rows: readonly AiCallRow[]): DuplicateJobStep[] {
  const groups = new Map<string, { jobId: string; stepName: string; runs: Set<string>; calls: AiCallRow[] }>();
  for (const r of rows) {
    /* A chat answer, a search, an eval, a CLI stage: not a job step, so there
       is no "ran twice" to ask about. `scopeKind` as well as the two fields,
       because it is the row's own word for what it was — a row carrying a job
       id under some other scope is not a step the queue ran, and would be a
       silent third meaning for this line. Skipped rather than grouped under a
       shared `—` key, which would pile every unattributed call in the ledger
       into one bogus group of hundreds of runs. */
    if (r.scopeKind !== "job_step") continue;
    if (!r.jobId || !r.stepName) continue;
    /* NUL as the separator, because a job id or a step name containing the
       separator would otherwise merge two groups into one. */
    const key = `${r.jobId}\u0000${r.stepName}`;
    const group = groups.get(key);
    if (group) {
      group.runs.add(r.runId);
      group.calls.push(r);
    } else {
      groups.set(key, {
        jobId: r.jobId,
        stepName: r.stepName,
        runs: new Set([r.runId]),
        calls: [r],
      });
    }
  }
  return [...groups.values()]
    .filter((g) => g.runs.size > 1)
    .map((g) => {
      const { credits, upstream, computed } = totalRows(g.calls);
      return {
        jobId: g.jobId,
        stepName: g.stepName,
        runs: g.runs.size,
        calls: g.calls.length,
        nanos: credits + upstream + computed,
      };
    })
    /* Most runs first, and money as the tie-break: eleven runs of one step is
       the shape that matters, and between two of the same shape the expensive
       one is the one to look at. */
    .sort((a, b) => b.runs - a.runs || b.nanos - a.nanos);
}

/** How many duplicated steps are listed before the rest are counted instead. */
const MOST_DUPLICATES_SHOWN = 10;

function printDuplicateJobSteps(rows: readonly AiCallRow[]): void {
  const repeated = duplicateJobSteps(rows);
  /* Nothing at all when there is nothing to say. A "0 steps ran twice" line
     every time is how a reader learns to skip the one that is not zero. */
  if (repeated.length === 0) return;
  console.log(`\n${repeated.length} job step(s) ran more than once in this range:`);
  for (const r of repeated.slice(0, MOST_DUPLICATES_SHOWN)) {
    const step = `${r.jobId} · ${r.stepName}`;
    console.log(
      `  ${step.padEnd(44)}  ${String(r.runs).padStart(3)} runs  ${formatNanos(r.nanos).padStart(10)}  ${String(r.calls).padStart(5)} call(s)`,
    );
  }
  if (repeated.length > MOST_DUPLICATES_SHOWN)
    console.log(`  …and ${repeated.length - MOST_DUPLICATES_SHOWN} more.`);
  note(
    "A step that was interrupted and honestly retried looks exactly like this, so a two " +
      "here is ordinary. A large number is not: on 2026-08-30 one hierarchy step ran eleven " +
      "times at once under one job id, and every run was billed. " +
      "docs/postmortems/260902c-the-truncation-retry-cost-storm.md.",
  );
}

/**
 * One line of a breakdown — and **`unpriced` is not decoration**.
 *
 * `by` computed it and threw it away until 2026-09-02, so a day, a job, a model,
 * an article or an owner could show a total without being able to say the total
 * was short. Only the top-level pocket line survived, which is the one place the
 * shortfall is least useful. GPT Sol's wording for the rule: *"'chat: $4.20, 16
 * calls unpriced' is useful; 'chat: $4.20' is false precision."*
 */
interface Breakdown {
  name: string;
  calls: number;
  nanos: number;
  /** Calls in this line that happened and reported no money at all. */
  unpriced: number;
}

function table(title: string, rows: Breakdown[]): void {
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  const width = Math.min(44, Math.max(...rows.map((r) => r.name.length)));
  for (const r of rows) {
    const name = r.name.length > width ? `${r.name.slice(0, width - 1)}…` : r.name.padEnd(width);
    /* Only when it is not zero. A `0 unpriced` on every line is noise that
       teaches the eye to skip the column, which costs exactly the signal this
       was added for. */
    const short = r.unpriced > 0 ? `  ${r.unpriced} unpriced` : "";
    console.log(
      `  ${name}  ${formatNanos(r.nanos).padStart(10)}  ${String(r.calls).padStart(5)} call(s)${short}`,
    );
  }
}

/**
 * **What OpenRouter thinks this key has spent this month**, next to what we
 * recorded for it.
 *
 * Per key, because that is the only granularity `/api/v1/key` has — which is why
 * every row carries a `credential_fingerprint`. Rows written under a *different*
 * key are excluded and counted, rather than quietly widening the gap: a
 * difference that is always non-zero for a reason nobody names is a check
 * everybody learns to ignore.
 *
 * **It reads the current UTC month, whatever range the report was for.** The
 * first version compared the report's rows with OpenRouter's *all-time* figure,
 * so the gap jumped every month boundary even against a perfect ledger — a
 * difference that moves on its own is not a check. `usage_monthly` and
 * `byok_usage_monthly` reset at midnight UTC, which is the same boundary
 * `--month` uses. GPT Sol found the mismatch.
 *
 * **A reconciliation that cannot run exits non-zero.** No key, a 4xx, a network
 * failure: each of those used to print a line and return success, which is a
 * check that passes when it did not happen.
 *
 * What it still is not: there is **no stored baseline**, so the gap includes
 * everything spent on this key before the ledger existed, and every stage CLI
 * and eval run since. Watch whether the gap *moves*, not whether it is zero.
 */
/**
 * What OpenRouter says about the key in the environment, or `null`.
 *
 * Pulled out of `reconcile()` on 2026-09-02 so that `--owners` can print the
 * same gap without going through `costStore.read()` — which fetches every row in
 * the window, and is the one thing the pricing report is arranged not to do.
 * Extracted rather than copied: two functions asking OpenRouter what a key has
 * spent, in slightly different words, is two answers to reconcile.
 *
 * **Every failure sets a non-zero exit code**, because a reconciliation that
 * could not run must not look like one that found nothing.
 */
async function openRouterKeyUsage(
  why: string,
): Promise<{ fingerprint: string; credits: number | null; byok: number | null } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error(`\n${why} needs OPENROUTER_API_KEY, and there is none set.`);
    process.exitCode = 1;
    return null;
  }
  const { keyFingerprint } = await import("../src/ai-spend.js");
  const fingerprint = keyFingerprint(key);

  let body: { data?: Record<string, unknown> };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      console.error(`\n${why}: OpenRouter answered ${response.status}. Nothing was compared.`);
      process.exitCode = 1;
      return null;
    }
    body = (await response.json()) as { data?: Record<string, unknown> };
  } catch (err) {
    console.error(`\n${why}: could not reach OpenRouter — ${(err as Error).message}`);
    process.exitCode = 1;
    return null;
  }
  const theirs = (name: string): number | null => {
    const v = body.data?.[name];
    return typeof v === "number" ? v : null;
  };
  return { fingerprint, credits: theirs("usage_monthly"), byok: theirs("byok_usage_monthly") };
}

async function reconcile(): Promise<void> {
  const usage = await openRouterKeyUsage("--reconcile");
  if (!usage) return;
  const { fingerprint } = usage;

  const month = thisMonth();
  const read = await costStore.read(month.since, month.until);
  const { rows } = read;
  /* **Above the comparison, because a hole in our side is the first
     explanation of a gap.** This range is the calendar month rather than the
     one the report was asked for, so its own count is asked for rather than
     reusing the one printed at the top. */
  for (const note of shortfallNotes(read)) console.log(`\n${note}`);
  const mine = rows.filter((r) => r.credentialFingerprint === fingerprint);
  const others = rows.length - mine.length;
  const { credits, upstream } = totalRows(mine);

  const theirCredits = usage.credits;
  const theirByok = usage.byok;

  console.log(`\nAgainst OpenRouter, key ${fingerprint}, ${month.label} (UTC):`);
  console.log(`  our credits    ${formatNanos(credits).padStart(12)}  (${mine.length} call(s))`);
  if (theirCredits !== null)
    console.log(`  their credits  ${`$${theirCredits.toFixed(6)}`.padStart(12)}`);
  if (upstream > 0 || theirByok)
    console.log(
      `  our BYOK       ${formatNanos(upstream).padStart(12)}` +
        (theirByok !== null ? `   their BYOK  $${theirByok.toFixed(6)}` : ""),
    );
  if (theirCredits !== null) {
    const gap = theirCredits - credits / 1e9;
    console.log(`  gap            ${`$${gap.toFixed(6)}`.padStart(12)}  (theirs minus ours)`);
  }
  if (others > 0)
    console.log(`  ${others} row(s) this month were paid for with a different key, and are not in ours.`);
  console.log(
    "  There is no stored baseline, so the gap also holds everything spent on this key\n" +
      "  before the ledger existed, plus every stage CLI and eval run since. Watch whether\n" +
      "  the gap moves, not whether it is zero.",
  );
}

/**
 * One pocket's worth of money, with the three kinds of figure kept apart.
 *
 * `credits` is what OpenRouter deducted and can be checked against their own
 * running total. `upstream` is BYOK, where their charge is legitimately zero and
 * somebody else's key was billed. `computed` is **our arithmetic**, for the
 * declared bypasses that do not go through OpenRouter and so have nobody to ask
 * — it is labelled every time, because a price table drifts silently and the
 * day a rate changes every computed figure after it is wrong with nothing
 * failing.
 */
function pocket(label: string, rows: readonly AiCallRow[]): void {
  const { credits, upstream, computed, unpriced } = totalRows(rows);
  console.log(
    `\n${label}:  ${formatNanos(credits + upstream + computed)} over ${rows.length} call(s)`,
  );
  console.log(`  credits consumed   ${formatNanos(credits)}`);
  if (upstream > 0)
    console.log(`  billed upstream    ${formatNanos(upstream)}  (BYOK — a different pocket)`);
  if (computed > 0)
    console.log(
      /* **Two price tables now, not one.** `computed` was the Anthropic-direct
         bypasses only until 2026-09-02, when live conversation started writing
         rows priced from `REALTIME_PRICES` over counts a browser reported. Both
         are our arithmetic and neither is reconciled, which is what the label
         is for — naming only one of them would have quietly made the other
         look settled. */
      `  computed by us     ${formatNanos(computed)}  (not through OpenRouter; priced here from ANTHROPIC_PRICES or REALTIME_PRICES, never reconciled)`,
    );
  if (unpriced > 0)
    console.log(`  ${unpriced} call(s) reported no cost, so the figure above is short by an unknown amount.`);
}

/**
 * **The holes that are not in `DECLARATIONS` and cannot be put there.**
 *
 * A `Declaration` describes a call that could in principle have gone through one
 * of this app's two seams: it is spent through `declaredFetch`, which wraps a
 * `fetch` and hands an `Observer` the response body. The live-mode evals and the
 * Codex CLI are neither — an eval opens a realtime session and talks over it,
 * and `scripts/run-codex.ts` spawns a subprocess. `UNMETERED_SPEND` in
 * src/spend-declarations.ts is where they are written down, with the reason each
 * one cannot be declared.
 *
 * **They are printed here because the alternative is this report lying.**
 * `undeclared()` below reads `DECLARATIONS`, so the day the last
 * `metered: false` entry is wired up this script would otherwise have printed
 * *"Every declared way of spending money in this repo writes a row"* — while
 * every GPT Sol review on this repo was being bought on a third account. A
 * report that goes silently complete while a hole is open is exactly the failure
 * docs/reusable/silent-success.md is about, and this is a report whose whole
 * value is being believed.
 *
 * Until 2026-09-02 only the live-conversation entry was here, and the other two
 * were named solely in the `ALLOWED` map of tests/no-undeclared-spend.test.ts —
 * **which prints nothing**. A green test is not a register.
 *
 * **Live conversation came off this list on 2026-09-02**, and it is worth saying
 * how rather than just that. It did not start using a seam: the audio is still a
 * WebRTC connection from the reader's tab straight to OpenAI, which remains a
 * sanctioned provider bypass. What changed is that the browser now posts what
 * each turn cost to `/api/live/:sessionId/usage`, where the server prices it from
 * its own table and writes an ordinary `ai_calls` row — so live spend is in the
 * totals above, as `computed`. Greg had accepted the gap knowingly on
 * 2026-08-31; Stage 2B of
 * docs/plans/260902g-cost-tracking-that-can-set-a-price.md closed it.
 *
 * **Those rows are our arithmetic over counts a browser sent us**, never a
 * settled figure, and nothing reconciles them — which is exactly what `computed`
 * has always meant in this ledger. The one loss that remains is a turn that was
 * never posted because the tab died first, so the live figure is biased low by a
 * probably-small unknown. docs/project/live-conversation.md § The meter.
 */
/** Indented and wrapped to a terminal width — these reasons are sentences, not labels. */
function wrapped(text: string, width = 84, indent = 6): string[] {
  const lines: string[] = [];
  const pad = " ".repeat(indent);
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line !== "" && `${line} ${word}`.length > width) {
      lines.push(`${pad}${line}`);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }
  if (line !== "") lines.push(`${pad}${line}`);
  return lines;
}

/**
 * A paragraph under a table, wrapped rather than hard-newlined.
 *
 * Hand-broken lines in a template literal go wrong the moment somebody edits the
 * sentence, and every caveat in the `--owners` report is a sentence that will be
 * edited — they are the part a reader is meant to argue with.
 */
function note(text: string, indent = 2): void {
  for (const line of wrapped(text, 92, indent)) console.log(line);
}

function unmetered(): void {
  console.log(
    `\nNot counted here, and NOT in any table above — ${UNMETERED_SPEND.length} way(s) of spending that no seam can see:`,
  );
  const today = Date.now();
  for (const u of UNMETERED_SPEND) {
    /* The age, for the same reason a declaration's is printed: an admission
       opened this morning and one open since the spring read the same in a list
       and are not the same thing. */
    const days = Math.floor((today - Date.parse(`${u.since}T00:00:00Z`)) / 86_400_000);
    const age = days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
    console.log(`  ${u.file}  —  open ${age}`);
    for (const line of wrapped(`billed to: ${u.account}`)) console.log(line);
    for (const line of wrapped(u.what)) console.log(line);
  }
  console.log("  src/spend-declarations.ts says why none of them can be declared.");
}

/**
 * **What is knowably still missing** — by name, every run.
 *
 * This replaced the sentence *"Not counted here: anything evals/ spends"*,
 * which was true, useless and unfinishable: it named nothing, so no amount of
 * work could ever delete it. Every entry below is one file with a reason, and
 * the list empties as they are wired up. `tests/no-undeclared-spend.test.ts`
 * fails if a way of reaching a provider exists that is not in that table, so
 * this cannot go quietly out of date.
 *
 * It is **not** the whole story on its own — see `unmetered` above, which is why
 * the "everything writes a row" line below is careful to say *declared*.
 */
function undeclared(): void {
  const open = DECLARATIONS.filter((d) => !d.metered);
  if (open.length === 0) {
    console.log("\nEvery declared way of spending money in this repo writes a row.");
    return;
  }
  console.log(`\nNot counted here — ${open.length} known way(s) of spending that write no row:`);
  const today = Date.now();
  for (const d of open) {
    /* The age, not just the entry. An admission opened this morning and one
       that has been open since the spring read the same in a list and are not
       the same thing at all — which is what GPT Sol meant by calling
       `metered: false` a loophole with no expiry. No build fails on a date,
       because a gate that trips on the calendar gets muted rather than fixed. */
    const days = Math.floor((today - Date.parse(`${d.since}T00:00:00Z`)) / 86_400_000);
    const age = days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
    const how = d.kind === "unscoped" ? "no ledger open" : "skips the gateway";
    console.log(`  ${d.file}\n      ${d.id} — ${how}, open ${age}`);
  }
  console.log("  src/spend-declarations.ts says why each one is still open.");
}

/* ============================================================ --owners === */

/**
 * The population every per-account figure is divided by, and where it came from.
 *
 * `ids` empty means it could not be obtained and `why` says so — the report then
 * falls back to the owners the ledger has rows for and prints a warning beside
 * every figure, because that fallback silently turns "per account" into "per
 * *spending* account".
 */
interface Denominator {
  ids: string[];
  emails: Map<string, string>;
  source: string;
  why: string;
}

/**
 * `label` in a fixed-width gutter, with continuation lines under the text
 * rather than under the label — the coverage header is a table of sentences,
 * and a caveat that wraps back to column zero reads as a new heading.
 */
function say(label: string, ...lines: string[]): void {
  const [first, ...rest] = lines;
  console.log(`  ${label.padEnd(20)}${first ?? ""}`);
  for (const line of rest) console.log(`  ${" ".repeat(20)}${line}`);
}

/** Cash, which is the figure a price is compared against. Credits + the fee. */
function money(t: { creditsNanos: number; byokNanos: number; computedNanos: number }): number {
  return cashNanos(t);
}


/**
 * **The bill split, from rows rather than from SQL** — the ordinary report's
 * half of `accountsInWindow`.
 *
 * Two implementations of the same question, which is normally the thing to
 * avoid; here it is the lesser of the two evils and worth naming. The
 * alternative was a second `accountsInWindow` call from a report that already
 * holds every row, and that is a **later snapshot** of the ledger than the
 * totals printed above it — a call landing between the two reads makes the page
 * disagree with itself for a reason no reader could reconstruct. GPT Sol, F12.
 *
 * They cannot drift on the part that matters, because **the money and the
 * unpriced count both come from `totalRows`** — the one definition, held against
 * the SQL one by `tests/ai-calls-spend-pg.test.ts`. This function only decides
 * which rows are in which pile.
 */
export function tallyAccounts(rows: readonly AiCallRow[]): AccountTally[] {
  const piles = new Map<string, AiCallRow[]>();
  for (const row of rows) {
    const pile = piles.get(row.providerAccount) ?? [];
    pile.push(row);
    piles.set(row.providerAccount, pile);
  }
  return [...piles.entries()]
    .map(([account, pile]) => {
      const money = totalRows(pile);
      return {
        account,
        calls: pile.length,
        creditsNanos: money.credits,
        byokNanos: money.upstream,
        computedNanos: money.computed,
        unpricedCalls: money.unpriced,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

/**
 * **Which bills this report is a report of, and what the OpenRouter cap does
 * not reach.**
 *
 * ## Why it is here at all
 *
 * On 2026-09-06 Greg declined a per-reader spend cap on the paid endpoints,
 * because the OpenRouter account already carries a global monthly one
 * (docs/project/ai-gateway.md § What stops a reader spending our money). That
 * makes a single global ceiling the only control there is — and until
 * 2026-09-07 this report, the one thing that says what anything costs, never
 * mentioned `provider_account` at all. It printed one credential line, which
 * reads as *this is all of it*.
 *
 * ## What it must not say
 *
 * **Not that anything is safe.** Two separate reasons, and both have to be on
 * the page or the subtotal becomes a reassurance:
 *
 * - The cap is a **monthly account total** and this report answers an arbitrary
 *   `[since, until)`. It cannot see the cap's amount or the headroom left, so no
 *   figure here is a distance from a limit.
 * - Even for OpenRouter the cap does not do what "cap" suggests. It is global,
 *   so the failure it converts a runaway into is *every reader losing every paid
 *   feature until the month turns* — a blast radius, not a throttle. That is the
 *   accepted trade, recorded in ai-gateway.md, and it is not this report's job to
 *   soften it.
 *
 * ## The split is account **and** pocket, never account alone — GPT Sol, F3
 *
 * A BYOK row says `provider_account = 'openrouter'` while its
 * `byok_upstream_nanos` was billed to somebody else's key. So the money outside
 * the cap is *direct Anthropic and OpenAI, plus OpenRouter's BYOK pocket*, and
 * an "outside the cap" line that grouped by account alone would be wrong on our
 * largest non-OpenRouter pocket. The per-account subtotals are printed in full
 * and the total is named for exactly what it is.
 */
function printBills(bills: AccountTally[]): void {
  if (bills.length === 0) {
    say("Billed to", "no rows, so no bill to name");
    return;
  }
  const report = billReport(bills);
  for (const [i, line] of report.lines.entries()) {
    say(
      i === 0 ? "Billed to" : "",
      `${line.account.padEnd(11)} ${line.calls} call(s)  ${line.pockets}` +
        (line.unpricedCalls > 0 ? `  (${line.unpricedCalls} unpriced)` : ""),
    );
  }
  say("", ...report.caveat);
}

/**
 * **The same block, in the ordinary report's shape** — no gutter, one indent.
 *
 * `npm run cost` without `--owners` is the path the header advertises first, and
 * it printed money without ever naming an account until 2026-09-07: Stage 8 wired
 * the bills into `printCoverage`, which only `--owners` calls, so the claim that
 * "the report says which bill" was false for the report most people run. GPT
 * Sol, F6.
 *
 * Both callers take their lines from `billReport`, so there is exactly **one**
 * wording of the caveat. Two would drift, and the thing they would drift about
 * is what the cap does — which is the one sentence here that has to stay true.
 *
 * **The tallies come from the rows this report already has, not from a second
 * query.** It did call `accountsInWindow` again, and GPT Sol's round-two check
 * (F12) pointed out that a second read is a **later snapshot**: a call arriving
 * between the two makes the bill block disagree with every total printed above
 * it, for no reason a reader could ever work out. The ordinary report holds
 * every row already, so it can answer this itself — and the arithmetic goes
 * through `totalRows`, which is the one definition of what a set of rows cost
 * and of what "unpriced" means. `--owners` keeps the SQL version because it
 * never fetches rows at all, deliberately.
 */
export function printBillsPlain(rows: readonly AiCallRow[]): void {
  const bills = tallyAccounts(rows);
  if (bills.length === 0) return;
  const report = billReport(bills);
  console.log("\nBilled to");
  for (const line of report.lines) {
    console.log(
      `  ${line.account.padEnd(11)} ${line.calls} call(s)  ${line.pockets}` +
        (line.unpricedCalls > 0 ? `  (${line.unpricedCalls} unpriced)` : ""),
    );
  }
  for (const line of report.caveat) console.log(`  ${line}`);
}

/**
 * **The coverage header** — printed before any money, and not a preamble.
 *
 * Without it every figure below is unfalsifiable: a total of $2.54 looks
 * identical whether it is the whole truth or the 8% of calls that happened to
 * report a cost, and this ledger has already spent a fortnight in the second
 * state with nobody noticing.
 */
function printCoverage(
  args: Args,
  seen: {
    fold: SpendFold;
    credentials: CredentialTally[];
    bills: AccountTally[];
    realtime: RealtimeCoverage | null;
    accounts: Denominator;
  },
): void {
  const { fold, credentials, bills, realtime, accounts } = seen;
  console.log("\nCoverage — read this before believing any figure below");
  say(
    "Authoritative",
    "Postgres. The filesystem ledger is development evidence and is",
    "deliberately not imported (Stage 1 cutoff, GPT Sol 2026-09-02).",
  );
  say("Reading", costStore.describe());
  say(
    "Period",
    `${args.since ?? "the beginning"} → ${args.until ?? "now"}`,
    "Half-open [start, end) in UTC, so two adjacent periods cannot both",
    "claim a call. Arbitrary bounds, because Stripe periods are not months.",
  );

  let settled = 0;
  let computedCalls = 0;
  let unpriced = 0;
  for (const totals of fold.byCategory.values()) {
    settled += totals.settledCalls;
    computedCalls += totals.computedCalls;
    unpriced += totals.unpricedCalls;
  }
  say("Rows", `${fold.totalCalls} call(s) from ${fold.byOwner.size} owner(s) with spend`);
  say("  settled", `${settled} — OpenRouter answered; reconcilable against their own total`);
  say("  computed by us", `${computedCalls} — priced from our price tables; never reconciled`);
  say(
    "  reported no cost",
    `${unpriced} — every total below is short by an unknown amount`,
    "These three do not partition: a BYOK row where OpenRouter answered",
    "but reported no upstream figure is settled AND unpriced.",
  );

  if (credentials.length === 0) say("Paid with", "no rows, so no credential to name");
  for (const c of credentials) {
    /* Every key, not just the first. `--reconcile` compares one key's month
       against OpenRouter's own figure, and that comparison means nothing if half
       the rows were bought on a different account — printing the tally is
       cheaper than explaining the gap afterwards. */
    say(
      credentials[0] === c ? "Paid with" : "",
      `${c.fingerprint ?? "(no fingerprint recorded)"} — ${c.calls} call(s), ` +
        `${formatNanos(c.creditsNanos)} in credits`,
    );
  }

  printBills(bills);

  if (realtime === null) {
    say(
      "Live sessions",
      "NOT VISIBLE from this database — spideryarn.realtime_sessions is not",
      "there. Run npm run db:migrate. Any voice figure below is whatever",
      "reached ai_calls, with no session count to qualify it.",
    );
  } else {
    say(
      "Live sessions",
      `${realtime.issued} issued, ${realtime.connected} connected, ${realtime.silent} connected ` +
        "and reported nothing",
      "A silent session is a conversation whose meter was lost or a reader",
      "who never spoke; the ledger cannot tell those apart, so the voice",
      "figure below is biased low by up to that many sessions.",
    );
  }

  if (accounts.ids.length === 0) {
    say(
      "Denominator",
      `UNAVAILABLE — ${accounts.why}`,
      "Falling back to the owners the ledger has rows for, which excludes",
      "everyone who spent nothing and biases every per-account figure UP.",
    );
  } else {
    say(
      "Denominator",
      `${accounts.ids.length} account(s), from ${accounts.source}`,
      "EVERY account, not subscribers — Stripe's subscriber set does not",
      "exist yet. Accounts that spent nothing are counted as zero, which is",
      "the whole point: a GROUP BY over the ledger cannot see them at all.",
    );
  }
}

/**
 * **The rows no rule recognised, named one by one.**
 *
 * A subtotal under "unknown" with nothing beside it is unactionable — the reader
 * cannot tell a retired job name from a new feature nobody has classified. These
 * are *not* folded into a neighbouring category, because that would invent the
 * provenance the schema cannot supply, which is the whole thing
 * src/cost-categories.ts is arranged against.
 */
function printUnclassified(fold: SpendFold): void {
  const totals = fold.byCategory.get("unknown");
  if (!totals || totals.calls === 0) return;
  /* **Ledger money, on the headline and on every line under it.**
     The headline used `money()` — credits with OpenRouter's purchase fee
     allocated on top — while `fold.unknownFacts` carries `totalNanos`, the raw
     figures as written on the rows. So the parts did not have to add up to the
     whole they were printed under, and the discrepancy grows with the credits
     share. GPT Sol, 2026-09-03. The uplift is an allocation this report makes
     rather than a fact on any row, and it belongs in the one table that says so
     (`printCategories` below, in its own column); an itemised list of names is
     for finding a name, and the raw figure is the one that can be looked up. */
  const grand = [...fold.byCategory.values()].reduce((n, t) => n + totalNanos(t), 0);
  const share = grand === 0 ? 0 : (totalNanos(totals) / grand) * 100;
  console.log(
    `\nUNCLASSIFIED — ${totals.calls} call(s), ${formatNanos(totalNanos(totals))} ledger, ` +
      `${share.toFixed(1)}% of the money`,
  );
  for (const u of fold.unknownFacts) {
    console.log(
      `  ${u.facts.padEnd(44)}  ${String(u.calls).padStart(5)} call(s)  ${formatNanos(u.nanos)}`,
    );
  }
  note(
    "Each is a scope/job/step that no rule in src/cost-categories.ts recognises — usually a " +
      "retired name from an older row. They are NOT folded into a neighbouring category, " +
      "because that would invent the provenance the schema cannot supply. Classify them there, " +
      "or read this as the noise floor. Ledger figures throughout — the headline and the lines " +
      "under it are the same arithmetic, so they add up; the cash uplift is in the category " +
      "table below.",
  );
}

/**
 * What each kind of work cost, over everything in the period.
 *
 * **The first money column is `ledger`, and it was headed `credits` until
 * 2026-09-03.** It has always printed `totalNanos` — credits *plus* the BYOK
 * pocket *plus* our own computed figures — so on any run with BYOK or realtime
 * rows in it the column was larger than the credits it claimed to be, and a
 * reader comparing it against OpenRouter's own credit spend would have found a
 * gap with no explanation. GPT Sol found the label. Three pockets, one column,
 * and the name now says which. The second column is the same money with the
 * credit-purchase fee allocated onto the credits part.
 */
function printCategories(fold: SpendFold): void {
  console.log("\nBy category, over everything in the period");
  console.log(
    `  ${"category".padEnd(26)}${"calls".padStart(7)}${"ledger".padStart(13)}` +
      `${"cash".padStart(13)}${"unpriced".padStart(10)}`,
  );
  for (const category of COST_CATEGORIES) {
    const totals = fold.byCategory.get(category);
    if (!totals || totals.calls === 0) continue;
    console.log(
      `  ${category.padEnd(26)}${String(totals.calls).padStart(7)}` +
        `${formatNanos(totalNanos(totals)).padStart(13)}${formatNanos(money(totals)).padStart(13)}` +
        `${String(totals.unpricedCalls).padStart(10)}`,
    );
  }
  note(
    "Ledger is what the rows say: credits + BYOK upstream + our own computed figures, the sum " +
      `every other table here uses. Cash is the same money with OpenRouter's ` +
      `${(OPENROUTER_CREDIT_FEE * 100).toFixed(1)}% fee added to the credits part only. That fee is on ` +
      "BUYING credits, not per token, so it is allocated here and never written to a row. BYOK and " +
      "computed rows never bought a credit and carry no uplift, which is why the two columns are " +
      "equal on a category that has none.",
  );
  for (const category of COST_CATEGORIES) {
    const totals = fold.byCategory.get(category);
    if (totals && totals.calls > 0) note(`${category} — ${CATEGORY_MEANING[category]}`, 4);
  }
}

/**
 * **The distribution, which is the answer a total is not.**
 *
 * A median says what the typical account costs, a p95 says what a price would be
 * underwriting, and a max says what one account has already managed. An average
 * says none of those and is the statistic a subscription price cannot be set
 * from.
 */
function printSpread(fold: SpendFold, population: string[], denominatorIsReal: boolean): number[] {
  /* **Every category in this fold**, because the fold handed in has already been
     narrowed to product *scopes*. It used to be `COST_CATEGORIES.filter(c => c
     !== "non-product")`, and that negative filter is what let `unknown` into the
     pricing basis — GPT Sol, R1. `non-product` is empty here by construction. */
  const product = COST_CATEGORIES;
  console.log(
    `\nPer-account spread — cash, over ${population.length} account(s), zero-spend included` +
      (denominatorIsReal ? "" : "  ** SPENDING OWNERS ONLY — see Denominator **"),
  );
  console.log(
    `  ${"category".padEnd(26)}${"spending".padStart(9)}${"median".padStart(13)}` +
      `${"p95".padStart(13)}${"max".padStart(13)}${"total".padStart(13)}`,
  );
  const line = (name: string, values: number[]): void => {
    const s = spread(values);
    console.log(
      `  ${name.padEnd(26)}${String(s.spending).padStart(9)}${formatNanos(s.median).padStart(13)}` +
        `${formatNanos(s.p95).padStart(13)}${formatNanos(s.max).padStart(13)}` +
        `${formatNanos(s.total).padStart(13)}`,
    );
  };
  for (const category of product) {
    const totals = fold.byCategory.get(category);
    if (!totals || totals.calls === 0) continue;
    line(category, spendPerAccount(fold, population, [category], money));
  }
  const allProduct = spendPerAccount(fold, population, product, money);
  line("ALL PRODUCT", allProduct);
  /* **Conditional, because it stops being true at 20 accounts.** Nearest rank
     picks element `ceil(0.95n)`, which is `n` — the maximum — only while
     `n <= 19`; at 20 it is the 19th of 20 and the sentence quietly becomes a
     lie about the number Greg underwrites against. Computed from the actual
     population rather than asserted, so it cannot go stale on its own. GPT Sol,
     2026-09-03. */
  const n = population.length;
  /* `spread()` sorts ascending and takes element `ceil(0.95n)`, so counted from
     the expensive end that is the `n - rank + 1`th. */
  const fromTop = n - Math.max(1, Math.ceil(0.95 * n)) + 1;
  note(
    "Non-product spend is excluded from this table on purpose — it is ours, not a reader's, and " +
      "a bake-off landing in the figure a price is set from is how a price gets set wrong. " +
      `Nearest-rank percentiles: at ${n} account(s) the p95 is ` +
      (fromTop <= 1
        ? 'the most expensive account there is, so read it as "the worst we have seen" rather than as a stable statistic.'
        : `the ${ordinal(fromTop)} most expensive of ${n}, so it is a real percentile and the max beside it is the worst.`),
  );
  return allProduct;
}

/** "2nd", "3rd", "11th" — for the one sentence that has to count places. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Who cost what, by name where the Auth service could supply one. */
function printOwners(fold: SpendFold, accounts: Denominator, population: string[]): void {
  /* Narrowed by scope before it got here — see `printSpread` above and R1. */
  const product = COST_CATEGORIES;
  console.log("\nBy owner — product spend only, cash");
  const named = [...fold.byOwner.entries()]
    .map(([id, mine]) => {
      let cash = 0;
      let calls = 0;
      let short = 0;
      for (const category of product) {
        const totals = mine.get(category);
        if (!totals) continue;
        cash += money(totals);
        calls += totals.calls;
        short += totals.unpricedCalls;
      }
      return { id, name: accounts.emails.get(id) ?? id, cash, calls, unpriced: short };
    })
    .sort((a, b) => b.cash - a.cash);
  for (const owner of named) {
    console.log(
      `  ${owner.name.slice(0, 40).padEnd(40)}${formatNanos(owner.cash).padStart(13)}` +
        `${String(owner.calls).padStart(7)} call(s)` +
        (owner.unpriced > 0 ? `  ${owner.unpriced} unpriced` : ""),
    );
  }
  const silent = population.filter((id) => !fold.byOwner.has(id)).length;
  if (silent > 0) console.log(`  ${silent} more account(s) spent nothing at all in this period.`);
}

/**
 * **What period the margin is a margin over** — a monthly price is only a
 * monthly margin against a month.
 *
 * `--price` is a candidate *monthly* subscription, and `printMargin` subtracts
 * whatever the report's range cost from it. The range is whatever was asked for:
 * a custom fortnight, `--all`, or — by default — the whole current calendar
 * month, which on the 3rd contains two days of spend. GPT Sol's review found
 * `$20 minus two days` presented as the contribution margin, and Greg
 * reproduced it independently the same morning.
 *
 * ## Labelled rather than refused, and why
 *
 * The other option was to refuse `--price` outside a completed month. Rejected:
 * `npm run cost -- --owners --price 20` is the command in this file's own
 * header and the one that gets run, and on most days of most months it would
 * simply fail — which teaches people to pass `--month <last month>` and read a
 * figure about a month whose product was different. The spend is real either
 * way; the only thing that was ever wrong is the **sentence around it**. So the
 * heading names the period, says outright when it is not a whole month, and
 * points at the flag that would give a real monthly figure. A reader who wants
 * the arithmetic still gets it, and cannot mistake what it is of.
 *
 * The one thing this must never do is prorate. Scaling two days up to a month
 * would invent a number nobody measured, and `Args.price` is explicit that this
 * is not a scenario engine.
 */
export type MarginPeriod =
  | { kind: "month"; label: string }
  | { kind: "part-month"; label: string; elapsed: number; of: number }
  | { kind: "other"; label: string };

/** The `YYYY-MM` a `[since, until)` covers exactly, or `null` if it is not one month. */
function calendarMonthOf(since: string, until: string): string | null {
  const from = new Date(since);
  const to = new Date(until);
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1);
  if (from.getTime() !== first) return null;
  const next = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1);
  if (to.getTime() !== next) return null;
  return `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/* Exported for tests/ai-cost-cli.test.ts, which is where the boundary cases
   live: the first half of a month starts on the 1st, so "does it start on the
   1st" is not the question, and `--all` has no bounds to ask it of at all. */
export function marginPeriod(args: Args, now: Date): MarginPeriod {
  if (!args.since || !args.until) return { kind: "other", label: args.label };
  const month = calendarMonthOf(args.since, args.until);
  if (!month) return { kind: "other", label: args.label };
  const until = Date.parse(args.until);
  if (until <= now.getTime()) return { kind: "month", label: month };
  const since = Date.parse(args.since);
  return {
    kind: "part-month",
    label: month,
    /* One decimal, not a whole number of days: "2 of 30" on the evening of the
       3rd reads as a fact about complete days and is short by most of one. */
    elapsed: Math.max(0, (now.getTime() - since) / DAY_MS),
    of: Math.round((until - since) / DAY_MS),
  };
}

/** Price minus what the models cost over `period`, and nothing else. */
export function printMargin(price: number, allProduct: number[], period: MarginPeriod): void {
  const priceNanos = Math.round(price * 1e9);
  /* **Derived from the COST spread, not from a spread of the margins.** A
     nearest-rank p95 over margins returns the *largest* margin, which is the
     cheapest account — the opposite of the number anybody wants. Subtracting the
     p95 cost gives the margin on the account at the 95th percentile of spend,
     which is what "what am I underwriting" means. Getting this backwards would
     have printed a reassuring figure with nothing red anywhere. */
  const cost = spread(allProduct);
  console.log(
    period.kind === "month"
      ? `\nModel-cost contribution margin at $${price.toFixed(2)} per account per month — ${period.label} (UTC)`
      : `\nModel-cost margin at $${price.toFixed(2)} per account against ${
          period.kind === "part-month"
            ? `${period.elapsed.toFixed(1)} of ${period.of} days of ${period.label}`
            : period.label
        } — NOT a monthly margin`,
  );
  console.log(
    `  at the median account ${formatNanos(priceNanos - cost.median)}   ` +
      `at the p95 account ${formatNanos(priceNanos - cost.p95)}   ` +
      `at the worst ${formatNanos(priceNanos - cost.max)}   ` +
      `underwater ${allProduct.filter((c) => c > priceNanos).length} of ${allProduct.length}`,
  );
  if (period.kind !== "month") {
    note(
      `$${price.toFixed(2)} is a MONTH's price and the spend above is ` +
        (period.kind === "part-month"
          ? `${period.elapsed.toFixed(1)} of the ${period.of} days of ${period.label}`
          : `over ${period.label}`) +
        ". The subtraction is still arithmetic anybody can check, but it is not a monthly " +
        "margin and must not be quoted as one — a short period flatters it and a long one " +
        "buries it. Nothing here is prorated, deliberately: scaling a part-month up would " +
        "invent a number nobody measured. For a real monthly figure ask for a month that " +
        "has finished, e.g. --month " +
        previousMonthOf(period.label) +
        ".",
    );
  }
  note(
    "MODEL-COST contribution margin, not gross margin. It is the price minus what the models " +
      "cost and nothing else: Stripe's fees, hosting, storage, bandwidth and every unmetered " +
      "spend listed below are all still to come out of it.",
  );
}

/** The month before a `YYYY-MM`, for the "ask for a finished month" hint. */
function previousMonthOf(label: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return "<YYYY-MM>";
  const year = Number(m[1]);
  const mon = Number(m[2]);
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
}

/**
 * **The pricing report.** One command that answers "what did each owner cost
 * over this period, by category, with the spread" — and, first, how much of
 * itself it could not see.
 *
 * ## Non-product spend is printed and then excluded
 *
 * Eval and dev-CLI rows are ours. They are shown, because a report that hid them
 * would be hiding real money on the OpenRouter bill, and they are kept out of
 * the per-account spread, because a bake-off over forty PDF pages landing in the
 * figure Greg prices against is how a price gets set wrong. The same argument
 * `pocket()` above makes for the ordinary report.
 */
async function ownersReport(args: Args): Promise<void> {
  /* There was a refusal here until 2026-09-05, for a process on the filesystem
     ledger. GPT Sol settled the cutoff behind it — **Postgres is authoritative
     and the JSONL history was never imported** — and that is still true; what
     went is the other store it was refusing on behalf of. */
  const [groups, credentials, bills, realtime] = await Promise.all([
    spendGroupedByOwner(args.since, args.until),
    credentialsInWindow(args.since, args.until),
    accountsInWindow(args.since, args.until),
    realtimeSessionCoverage(args.since, args.until),
  ]);
  const fold = foldSpend(groups);
  const accounts = await accountDenominator();

  console.log(`AI spend by owner — ${args.label}`);
  printCoverage(args, { fold, credentials, bills, realtime, accounts });
  await reconciliationLine(args);

  if (fold.totalCalls === 0) {
    /* **Said, rather than drawn as a table of zeroes.** The same rule
       `pocket()` follows above: a `$0.0000` with a label on it reads as a
       measurement, and "we recorded nothing here" is the one thing it is not.
       The second line is the one that matters — a misconfigured store and a
       genuinely quiet month are indistinguishable from this side, and the
       coverage header above is where to look for which one it is. */
    console.log("\nNo calls recorded in this range.");
    console.log("(An empty range and an unwired ledger look identical from here.)");
    unmetered();
    undeclared();
    return;
  }

  printUnclassified(fold);
  printCategories(fold);

  /* **The population, and the fallback said out loud.** Without the Auth
     service the only owners this process can name are the ones the ledger has
     rows for, which excludes everybody who spent nothing — so every figure in
     the spread is biased upward by exactly the population a subscription price
     cares most about. Falling back silently would be the worse half of that. */
  const population = accounts.ids.length > 0 ? accounts.ids : [...fold.byOwner.keys()];
  /* **The pricing basis is chosen by SCOPE, not by category** — the same one
     definition the ordinary report uses, which is what Stage 6 claimed and did
     not deliver. `printSpread` and `printOwners` used to take the full fold and
     subtract `non-product` by name, and that negative filter let **`unknown`**
     through: a retired scope name, or a job nobody has placed yet, went straight
     into `ALL PRODUCT` and into the spread a subscription price is read off.
     GPT Sol reproduced it with `scopeKind: "retired-in-2025"` (R1) — the exact
     mirror of the F2 defect, in the report next door.

     Scope rather than category, deliberately: a *new job* in request scope is
     `unknown` and is still a reader's cost, so it belongs in the basis; an
     unrecognised *scope* does not, and `partitionByScope` puts it in `other`
     where the ordinary report prints it. The full `fold` stays behind the
     coverage header and the category table, which have to show everything. */
  const priced = foldSpend(partitionByScope(groups).product);
  const allProduct = printSpread(priced, population, accounts.ids.length > 0);
  printOwners(priced, accounts, population);
  if (args.price !== undefined) printMargin(args.price, allProduct, marginPeriod(args, new Date()));

  unmetered();
  undeclared();
}

/**
 * **The population every per-account figure is divided by**, and where it came
 * from.
 *
 * From the Auth service over HTTP rather than a join, because `auth.users`
 * belongs to Supabase and the deployed role has no grants into that schema —
 * src/store/admin-accounts.ts has the measurement. So this cannot be one SQL
 * statement however much a per-owner report would like it to be.
 *
 * **A failure here is reported, never swallowed.** Losing the denominator does
 * not make the report wrong in a way anybody would see; it silently turns every
 * "per account" figure into a "per *spending* account" figure, which is biased
 * upward by exactly the population that matters most to a subscription price.
 */
async function accountDenominator(): Promise<Denominator> {
  const none = { ids: [] as string[], emails: new Map<string, string>() };
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return {
      ...none,
      source: "",
      why: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, and the accounts live in the Auth service rather than in a table",
    };
  }
  try {
    const { gotruePages, listAccounts } = await import("../src/store/admin-accounts.js");
    const rows = await listAccounts(gotruePages(url, key));
    return {
      ids: rows.map((r) => r.id),
      emails: new Map(rows.flatMap((r) => (r.email ? [[r.id, r.email] as const] : []))),
      source: `the Supabase Auth service at ${new URL(url).host}`,
      why: "",
    };
  } catch (err) {
    return { ...none, source: "", why: `the Auth service could not be read — ${(err as Error).message}` };
  }
}

/**
 * The reconciliation gap, **with the three conditions it holds under printed
 * beside it** — or a line saying why it is not shown.
 *
 * `GET /api/v1/key` answers for the *current key*, over the *current UTC month*,
 * *as of now*. It cannot answer for August, for an arbitrary Stripe period, or
 * for a key that has been rotated. A gap printed under a report covering some
 * other range would be a number that looks like a check and is not one — GPT
 * Sol's condition on this stage, and the same failure mode as the first version
 * of `reconcile()`, which compared one month's rows against an all-time figure.
 */
async function reconciliationLine(args: Args): Promise<void> {
  const say = (label: string, ...lines: string[]): void => {
    const [first, ...rest] = lines;
    console.log(`  ${label.padEnd(20)}${first ?? ""}`);
    for (const line of rest) console.log(`  ${" ".repeat(20)}${line}`);
  };
  const month = thisMonth();
  const current = args.since === month.since && args.until === month.until;
  if (!current) {
    say(
      "Reconciliation",
      "omitted. OpenRouter's /api/v1/key answers for the CURRENT key over the",
      "CURRENT UTC month AS OF NOW, and this report covers another range.",
      "For the gap: npm run cost -- --owners --reconcile (no --month/--since).",
    );
    return;
  }
  if (!args.reconcile) {
    say("Reconciliation", "not asked for. Add --reconcile (network, free).");
    return;
  }
  const usage = await openRouterKeyUsage("--reconcile");
  if (!usage) return;
  const spend = await import("../src/store/ai-calls-spend-pg.js");
  const tallies = await spend.credentialsInWindow(month.since, month.until);
  const mine = tallies.find((t) => t.fingerprint === usage.fingerprint);
  const others = tallies.filter((t) => t.fingerprint !== usage.fingerprint);
  const ours = (mine?.creditsNanos ?? 0) / 1e9;
  if (usage.credits === null) {
    say("Reconciliation", `key ${usage.fingerprint} — OpenRouter reported no monthly usage figure.`);
    return;
  }
  say(
    "Reconciliation",
    `key ${usage.fingerprint}, ${month.label} (UTC), as of now:`,
    `ours $${ours.toFixed(6)} in credits over ${mine?.calls ?? 0} call(s)`,
    `theirs $${usage.credits.toFixed(6)}   gap $${(usage.credits - ours).toFixed(6)} (theirs minus ours)`,
    ...(others.length > 0
      ? [`${others.reduce((n, o) => n + o.calls, 0)} call(s) this month were paid on another key.`]
      : []),
    "There is no stored baseline, so the gap also holds everything spent on",
    "this key before the ledger existed, plus every CLI and eval run since.",
    "Watch whether the gap MOVES, not whether it is zero.",
  );
}

/**
 * **The lines that say which figures below are short, and why** — nothing when
 * the read was whole.
 *
 * Two notes and never one merged count, because they send a reader to two
 * different places. `unreadable` is a line that exists on disk and will not
 * parse: the money happened, the evidence is damaged, go and look at the ledger.
 * `lateCalls` is a call that finished after its collector had already reported,
 * so **no row was ever written** — there is nothing on disk to look at, and the
 * warn line from `recordSpend` is the only trace. `LedgerRead` in
 * src/store/contracts.ts is where that distinction is argued at length.
 *
 * **The second note says "this process" and it means it.** `lateCalls()` is a
 * counter in one process's memory, and this report is a fresh process reading a
 * ledger the server wrote — so it reads zero however many rows the server lost,
 * and a zero here is not evidence of anything. That is the honest limit of a
 * stopgap; the fix that would let any process see the hole is a row written when
 * the call opens (docs/plans/260827q-ai-cost-tracking.md).
 *
 * Its own exported function for the reason `by` is one: `main` prints and cannot
 * be asserted on, and a caveat nobody tests is a caveat that quietly stops
 * appearing.
 */
export function shortfallNotes(read: LedgerRead): string[] {
  const notes: string[] = [];
  if (read.unreadable > 0)
    notes.push(
      `${read.unreadable} line(s) of the ledger could not be read, and are in no total below.`,
    );
  if (read.lateCalls > 0)
    notes.push(
      `${read.lateCalls} model call(s) in this process finished after their spend collector ` +
        "had reported, so no row was ever written for them and they are in no total below. " +
        "(This count only covers this process; a call the server lost is invisible here.)",
    );
  return notes;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  if (args.owners) {
    await ownersReport(args);
    return;
  }
  const read = await costStore.read(args.since, args.until);

  console.log(`AI spend — ${args.label}`);
  console.log(`Ledger: ${costStore.describe()}`);
  const bytes = await costStore.size();
  if (bytes !== null) console.log(`        ${(bytes / 1024).toFixed(0)} KB`);

  await ledgerReport(args, read);
}

/**
 * **The ordinary report**, everything below the two lines naming the store.
 *
 * Its own exported function so a test can run **the whole page** against fixture
 * rows and read what came out. It was inline in `main()`, and GPT Sol's
 * round-two check (F11) named exactly what that cost: `tests/cost-report.test.ts`
 * tests the bill builder thoroughly and never reaches a renderer, so *"deleting
 * `printBills(bills)` or the ordinary `printBillsPlain(rows)` call would still
 * leave the suite green"* — which is the same deletion mutation the review one
 * round earlier had asked the tests to catch. A pure builder with no caller is
 * a page that prints nothing and a suite that says everything is fine.
 *
 * It needs no database and no network: `read` is handed in, and `reconcile()`
 * runs only behind `args.reconcile`.
 */
export async function ledgerReport(args: Args, read: LedgerRead): Promise<void> {
  const { rows } = read;

  /* **Before the early return, not after it.** A ledger whose every line is
     damaged has no rows *and* a non-zero count, and the first version returned
     before saying so — the one state where the count matters most was the one
     state it was never printed in. GPT Sol. */
  for (const note of shortfallNotes(read)) console.log(`\n${note}`);

  /* **Above the money, and above the early return.** Above the money because it
     changes how every figure below should be read: a `By article` total that is
     eleven times what it should be is not a story about that article. Above the
     early return because everything else that must be said whatever the rows
     look like is up here too — the unreadable count above, `unmetered()` and
     `undeclared()` inside the branch — and a duplicate-run line that only
     appears on some paths is one somebody will one day not see. */
  printDuplicateJobSteps(rows);

  if (rows.length === 0) {
    console.log("\nNo calls recorded in this range.");
    /* **Not the same as "nothing was spent", and it must not read as it.** An
       empty ledger is what a misconfigured store looks like too. */
    console.log("(An empty range and an unwired ledger look identical from here.)");
    /* **Before the early return, for the same reason the unreadable count is.**
       A report with no rows is exactly when somebody is asking "is anything
       being recorded at all", and the list of things that are knowably *not*
       is the most useful thing on the page. It was after the return until GPT
       Sol reproduced the output. */
    unmetered();
    undeclared();
    if (args.reconcile) await reconcile();
    return;
  }

  /* **Product and eval are printed apart, and there is no line called
     "Total".** Greg's use for this number is to set a price, and a bake-off
     over forty PDF pages landing in the figure he prices against is how a price
     gets set wrong. Storing eval rows and separating them at the report is the
     right way round: a scope can always be excluded from a total, and a row
     that was never written cannot be recovered. GPT Sol, 2026-08-28, on the
     open question Greg has not answered (260827q-ai-cost-tracking.md, question 4). */
  /* ⟨This was `rows.filter((r) => r.scopeKind !== "eval")` until 2026-09-07, so
     **dev-CLI spend was counted as Product** — $2.85 of 837 calls on the day it
     was found — while the `--owners` report next door correctly called the same
     rows non-product. A negative predicate three lines under the paragraph
     above, which is the argument against it. `partitionByScope` in
     src/cost-report.ts is now the one definition, enumerated positively and
     tested against the categoriser so the two cannot drift again. GPT Sol, F2.⟩ */
  const { product, devCli, evals, other } = partitionByScope(rows);
  /* An empty pocket is not printed as `$0.0000 over 0 call(s)`: a zero with a
     label reads as a measurement, and "we recorded nothing here" is the one
     thing it is not. */
  if (product.length > 0) pocket("Product spend", product);
  else console.log("\nProduct spend:  no calls recorded in this range.");
  if (devCli.length > 0) pocket("Dev CLI spend", devCli);
  if (evals.length > 0) pocket("Eval spend", evals);
  /* A scope this build does not recognise. Named rather than folded, for
     src/cost-report.ts's reason: either fold is silent and one of them inflates
     the number a price is set from. */
  if (other.length > 0) {
    pocket("UNRECOGNISED SCOPE", other);
    const names = [...new Set(other.map((r) => r.scopeKind))].sort();
    console.log(`  scope_kind ${names.join(", ")} — in the unrecognised pocket above, and in`);
    console.log("  no other. It is NOT in Product, which is what a price is set from. Classify in");
    console.log("  src/cost-report.ts § partitionByScope, or read this as the noise floor.");
  }
  if (rows.length > product.length && product.length > 0) {
    const all = totalRows(rows);
    console.log(
      `\nAll recorded:  ${formatNanos(all.credits + all.upstream + all.computed)} over ${rows.length} call(s)`,
    );
  }


  const failed = rows.filter((r) => r.outcome !== "ok");
  if (failed.length > 0) {
    /* **Both pockets.** Taking only `credits` printed "having spent at least
       $0.0000" for a failed BYOK call that had cost real money upstream — the
       same zero-that-is-not-free the whole ledger is arranged against, put back
       at the last step. GPT Sol. */
    const w = totalRows(failed);
    console.log(
      `  ${failed.length} call(s) ended in error or a cancel, having spent at least ${formatNanos(w.credits + w.upstream + w.computed)}.`,
    );
  }

  table("By day (UTC)", by(rows, (r) => r.startedAt.slice(0, 10)));
  table("By job", by(rows, (r) => r.job));
  table("By model answered", by(rows, (r) => r.answeredModel ?? r.requestedModel));
  table("By article", by(rows.filter((r) => r.articleSlug), (r) => r.articleSlug));
  table("By owner", by(rows, (r) => r.ownerId));
  table("By scope", by(rows, (r) => r.scopeKind));

  const cacheRead = rows.reduce((n, r) => n + (r.cacheReadTokens ?? 0), 0);
  const cacheWrite = rows.reduce((n, r) => n + (r.cacheWriteTokens ?? 0), 0);
  if (cacheRead > 0 || cacheWrite > 0)
    console.log(
      `\nPrompt cache: ${cacheRead.toLocaleString()} tokens read, ${cacheWrite.toLocaleString()} written.` +
        "\n  A read that falls to zero is the cache silently switching off — docs/project/prompt-caching.md.",
    );

  /* **Before the unmetered list, not after it.** The two answer the same
     question from opposite ends — this is money we recorded on a bill the cap
     cannot see, that is money no seam sees at all — and the recorded half has to
     come first or the caveat's reference to "every entry under 'no seam can
     see' below" points at nothing. */
  printBillsPlain(rows);

  unmetered();
  undeclared();

  if (args.reconcile) await reconcile();
  else console.log("\n(--reconcile asks OpenRouter what it thinks this key has spent.)");
}

if (isMain(import.meta.url)) void main();
