/**
 * **How Simple's fidelity guard is doing** — flags, retries and checker
 * failures, read-only, by construction. Plan 261001i § The record.
 *
 *     npx tsx scripts/simple-check-report.ts                      # the local stack, the last 30 days
 *     npx tsx scripts/simple-check-report.ts --days 7
 *     DATABASE_URL='<remote>' npx tsx scripts/simple-check-report.ts   # production: read the Target line
 *
 * **Two sources, because each sees what the other cannot.**
 *
 * - **The artefacts**: the `check` record on every stored Simple summary
 *   (`article_revisions.simple_summary`), counted once each — a draft copies
 *   the artefact forward, so a record is keyed on its article and its
 *   `generatedAt`. They say what each check *answered*: flagged, passed,
 *   unreadable. They cannot see a press that failed for another reason (it
 *   stored nothing), or a record a re-run replaced.
 * - **The ledger**: product `simple` step rows of purpose `simple-check`. They
 *   see every checker call, failed presses and replaced records included, with
 *   its outcome, latency and cost. Eval and CLI calls are excluded: they are
 *   measurements, not reader presses. The ledger cannot see what a check
 *   answered, because a row is written when the call ends and never amended.
 *
 * Neither is the guard's whole story alone, which is why both are printed.
 * The rates 261001h measured, to compare against: flags on 1–2% of
 * paragraphs, a third of levels on the PID paper, about 2% of control levels;
 * $0.0027 a press; 0 checker failures in 278 calls.
 *
 * **It cannot write.** Every statement runs inside `begin read only` and the
 * script checks `transaction_read_only` first. **It prints no article text, no
 * slugs and no checker reasons** — only counts and money.
 *
 * `console.log`, not `log()` — this is a CLI. CLAUDE.md § Writing code.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { resolveTargetUrl } from "../src/env.js";
import { tallyChecks } from "../src/simple-check.js";
import { isUsableSimpleSummary, SIMPLE_LEVELS, type SimpleLevelCheck } from "../src/types.js";

const daysArg = process.argv.indexOf("--days");
const days = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 30;
if (!Number.isFinite(days) || days <= 0) {
  console.error("--days takes a positive number");
  process.exit(1);
}

/* Shell wins: a URL on the command line names the database to read, and must
   not be buried by `.env.local`. docs/project/database.md. */
const url = resolveTargetUrl({ shellWins: true });
if (!url) {
  console.error("DATABASE_URL is not set. Local: npm run db:start. See docs/project/supabase-local.md.");
  process.exit(1);
}
console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);
console.log(`Window: the last ${days} day(s)`);

const ssl = sslDecisionFor(url);
const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl, application_name: "spideryarn simple-check-report (read-only)" });
const db = drizzle(pool);

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);
const num = (v: unknown) => Number(v ?? 0);

try {
  await db.transaction(
    async (tx) => {
      const [ro] = (await tx.execute(sql`select current_setting('transaction_read_only') as ro`)).rows as { ro: string }[];
      if (ro?.ro !== "on") throw new Error(`refusing to go on: the transaction is not read-only (${ro?.ro})`);

      /* One row per stored artefact, however many revisions carry a copy. */
      const stored = (
        await tx.execute(sql`
          select distinct on (article_id, simple_summary->>'generatedAt') simple_summary as s
          from spideryarn.article_revisions
          where simple_summary ? 'check'
            and (simple_summary->>'generatedAt')::timestamptz > now() - make_interval(days => ${days})
          order by article_id, simple_summary->>'generatedAt'`)
      ).rows as { s: unknown }[];
      const checks: SimpleLevelCheck[] = [];
      let unusable = 0;
      for (const { s } of stored) {
        if (!isUsableSimpleSummary(s) || !s.check) {
          unusable += 1;
          continue;
        }
        for (const level of SIMPLE_LEVELS) checks.push(s.check.levels[level]);
      }
      const t = tallyChecks(checks);
      const presses = stored.length - unusable;

      console.log(`\nStored summaries with a check record: ${presses} (${t.levels} levels)`);
      if (unusable) console.log(`  ✗ ${unusable} record(s) that do not read as a whole check — look at them`);
      console.log(`  first check flagged a level:   ${t.firstFlagged} of ${t.firstAnswered} answered (${pct(t.firstFlagged, t.firstAnswered)})`);
      console.log(`  retried after a flag:          ${t.retriedAfterFlag} (${pct(t.retriedAfterFlag, t.levels)} of levels)`);
      console.log(`    … the retry failed, first kept: ${t.keptFirst}`);
      console.log(`  flag, but validation had spent the retry: ${t.budgetSpent}`);
      console.log(`  stored with a flag:            ${t.storedFlagged} (${pct(t.storedFlagged, t.levels)} of levels)`);
      console.log(`  stored unchecked:              call failed ${t.unchecked.call}, unreadable ${t.unchecked.unreadable}`);

      /* The ledger: every product checker call, whether or not its press stored anything. */
      const calls = (
        await tx.execute(sql`
          select outcome,
                 count(*) as n,
                 coalesce(sum(coalesce(credits_used_nanos, 0) + coalesce(byok_upstream_nanos, 0) + coalesce(computed_cost_nanos, 0)), 0) as nanos,
                 count(*) filter (
                   where cost_source = 'none'
                      or (is_byok is true and byok_upstream_nanos is null)
                 ) as unpriced,
                 percentile_cont(0.5) within group (order by duration_ms) as median_ms
          from spideryarn.ai_calls
          where purpose = 'simple-check'
            and scope_kind = 'job_step'
            and step_name = 'simple'
            and started_at > now() - make_interval(days => ${days})
          group by outcome
          order by outcome`)
      ).rows as Record<string, unknown>[];
      const total = calls.reduce((n, r) => n + num(r.n), 0);
      const pressRow = (
        (await tx.execute(sql`
          select count(distinct run_id) as presses from spideryarn.ai_calls
          where purpose = 'simple-check'
            and scope_kind = 'job_step'
            and step_name = 'simple'
            and started_at > now() - make_interval(days => ${days})`)).rows as { presses: unknown }[]
      )[0];
      const ledgerPresses = num(pressRow?.presses);
      const nanos = calls.reduce((n, r) => n + num(r.nanos), 0);
      const unpriced = calls.reduce((n, r) => n + num(r.unpriced), 0);
      console.log(`\nChecker calls in the product ledger: ${total}, across ${ledgerPresses} checker-active press(es)`);
      for (const r of calls) {
        console.log(
          `  ${String(r.outcome).padEnd(8)} ${String(num(r.n)).padStart(5)}  median ${Math.round(num(r.median_ms))} ms` +
            (num(r.unpriced) ? `  (${num(r.unpriced)} unpriced)` : ""),
        );
      }
      console.log(
        `  known spend: $${(nanos / 1e9).toFixed(4)}` +
          (ledgerPresses ? `, $${(nanos / 1e9 / ledgerPresses).toFixed(4)} per checker-active press` : "") +
          (unpriced ? ` (short by ${unpriced} unpriced call(s))` : ""),
      );
      console.log(
        "\nThe ledger keeps checker calls from presses that stored nothing and records a re-run replaced; the artefacts do not.\n" +
          "A ledger total well above the artefacts' checks is those, not a bug.",
      );
    },
    { accessMode: "read only" },
  );
} finally {
  await pool.end();
}
