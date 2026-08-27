#!/usr/bin/env -S npx tsx
/**
 * What the model calls have cost — read out of the ledger.
 *
 *     npm run cost                      the current UTC month
 *     npm run cost -- --month 2026-07   one month
 *     npm run cost -- --since 2026-08-01 --until 2026-08-15
 *     npm run cost -- --all             everything there is
 *     npm run cost -- --reconcile       ask OpenRouter what it thinks (network, free)
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

interface Args {
  since?: string;
  until?: string;
  all: boolean;
  reconcile: boolean;
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

function thisMonth(): { since: string; until: string; label: string } {
  const now = new Date();
  const label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { ...monthRange(label), label };
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { all: false, reconcile: false, label: "" };
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
      default:
        throw new Error(`Unknown flag ${JSON.stringify(flag)}`);
    }
  }
  if (out.all) return { all: true, reconcile: out.reconcile, label: "all time" };
  if (!out.since && !out.until) {
    const m = thisMonth();
    return { ...out, since: m.since, until: m.until, label: `${m.label} (UTC)` };
  }
  return { ...out, label: out.label || `${out.since ?? "the beginning"} → ${out.until ?? "now"}` };
}

/** Sum by one facet, biggest first. One implementation for every breakdown. */
function by(
  rows: readonly AiCallRow[],
  key: (r: AiCallRow) => string | null,
): { name: string; calls: number; nanos: number }[] {
  const groups = new Map<string, AiCallRow[]>();
  for (const r of rows) {
    const name = key(r) ?? "—";
    const list = groups.get(name);
    if (list) list.push(r);
    else groups.set(name, [r]);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      const { credits, upstream } = totalRows(list);
      return { name, calls: list.length, nanos: credits + upstream };
    })
    .sort((a, b) => b.nanos - a.nanos);
}

function table(title: string, rows: { name: string; calls: number; nanos: number }[]): void {
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  const width = Math.min(44, Math.max(...rows.map((r) => r.name.length)));
  for (const r of rows) {
    const name = r.name.length > width ? `${r.name.slice(0, width - 1)}…` : r.name.padEnd(width);
    console.log(`  ${name}  ${formatNanos(r.nanos).padStart(10)}  ${String(r.calls).padStart(5)} call(s)`);
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
async function reconcile(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("\n--reconcile needs OPENROUTER_API_KEY, and there is none set.");
    process.exitCode = 1;
    return;
  }
  const { keyFingerprint } = await import("../src/ai-spend.js");
  const fingerprint = keyFingerprint(key);

  let body: { data?: Record<string, unknown> };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      console.error(`\n--reconcile: OpenRouter answered ${response.status}. Nothing was compared.`);
      process.exitCode = 1;
      return;
    }
    body = (await response.json()) as { data?: Record<string, unknown> };
  } catch (err) {
    console.error(`\n--reconcile: could not reach OpenRouter — ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const month = thisMonth();
  const { rows } = await costStore.read(month.since, month.until);
  const mine = rows.filter((r) => r.credentialFingerprint === fingerprint);
  const others = rows.length - mine.length;
  const { credits, upstream } = totalRows(mine);

  const theirs = (name: string): number | null => {
    const v = body.data?.[name];
    return typeof v === "number" ? v : null;
  };
  const theirCredits = theirs("usage_monthly");
  const theirByok = theirs("byok_usage_monthly");

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

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const { rows, unreadable } = await costStore.read(args.since, args.until);

  console.log(`AI spend — ${args.label}`);
  console.log(`Ledger: ${costStore.describe()}`);
  const bytes = await costStore.size();
  if (bytes !== null) console.log(`        ${(bytes / 1024).toFixed(0)} KB`);

  /* **Before the early return, not after it.** A ledger whose every line is
     damaged has no rows *and* a non-zero count, and the first version returned
     before saying so — the one state where the count matters most was the one
     state it was never printed in. GPT Sol. */
  if (unreadable > 0)
    console.log(
      `\n${unreadable} line(s) of the ledger could not be read, and are in no total below.`,
    );

  if (rows.length === 0) {
    console.log("\nNo calls recorded in this range.");
    /* **Not the same as "nothing was spent", and it must not read as it.** An
       empty ledger is what a misconfigured store looks like too. */
    console.log("(An empty range and an unwired ledger look identical from here.)");
    if (args.reconcile) await reconcile();
    return;
  }

  const { credits, upstream, unpriced } = totalRows(rows);
  console.log(`\nTotal:  ${formatNanos(credits + upstream)} over ${rows.length} call(s)`);
  console.log(`  credits consumed   ${formatNanos(credits)}`);
  if (upstream > 0) console.log(`  billed upstream    ${formatNanos(upstream)}  (BYOK — a different pocket)`);
  if (unpriced > 0)
    console.log(`  ${unpriced} call(s) reported no cost, so the total above is short by an unknown amount.`);

  const failed = rows.filter((r) => r.outcome !== "ok");
  if (failed.length > 0) {
    /* **Both pockets.** Taking only `credits` printed "having spent at least
       $0.0000" for a failed BYOK call that had cost real money upstream — the
       same zero-that-is-not-free the whole ledger is arranged against, put back
       at the last step. GPT Sol. */
    const w = totalRows(failed);
    console.log(
      `  ${failed.length} call(s) ended in error or a cancel, having spent at least ${formatNanos(w.credits + w.upstream)}.`,
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

  /* Said every time rather than only when it looks wrong. `evals/` calls models
     outside the two gateways, so nothing it spends reaches this — and a report
     that is silently partial is the failure this whole ledger is arranged
     against. docs/plans/ai-cost-tracking.md, question 4. */
  console.log("\nNot counted here: anything evals/ spends — it does not go through the gateways.");

  if (args.reconcile) await reconcile();
  else console.log("\n(--reconcile asks OpenRouter what it thinks this key has spent.)");
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) void main();
