/**
 * **The paid check: does a real call on each wire land in the ledger, priced,
 * and attributed to the article it was for?**
 *
 *   npm run test:paid
 *
 * Greg, 2026-09-30: *"I'd be fine to have a bunch of tests that don't usually
 * run because they actually do incur costs (using our API keys somehow) that
 * then get tracked & checked."* docs/project/cost-tracking.md.
 *
 * Under `evals/` because that is where anything that spends money lives, and
 * vitest cannot reach it by construction — tests/setup/no-provider-calls.ts
 * refuses a provider host in `tests/`, and docs/project/testing.md says why.
 * It exits non-zero on any failed check, so it can be run like a test.
 *
 * ## What it does
 *
 * One deliberately tiny call on each of three wires — Messages
 * (`streamMessage`), chat (`openRouterJson`) and embeddings (`embedAll`) —
 * inside **one** collector attributed to a fresh synthetic slug, writing to the
 * real ledger through `costStore.record` exactly as a request does. Then it
 * reads the rows back **through `spendForArticle`**, the query behind the
 * metadata page's admin section, and checks:
 *
 * - the collector saw three calls, none pending, no failed writes;
 * - **the persisted rows**, read back by the collector's run id, are exactly
 *   three — one per wire, each `ok`, eval-scoped, on the eval owner, carrying
 *   the slug, and settled by the provider with a positive figure;
 * - those rows add up to what the collector recorded, to the nano-dollar;
 * - the article query sees the same three and the same total.
 *
 * Three readings of one spend — the process that made the calls, the rows it
 * wrote, and the page's aggregate — and they must agree.
 *
 * ## What it costs, and where the money is recorded
 *
 * Well under one cent: 16 output tokens twice and one short embedding. It
 * prints the figure. The rows are `scope_kind = 'eval'` on `EVAL_OWNER_ID`, so
 * `npm run cost` shows them as non-product and `/admin/users` leaves them out
 * (`productSpendByOwner`). Ledger rows are never deleted, and these are no
 * exception — they are the record of what the check spent.
 *
 * Needs the OpenRouter key in `.env.local` (the gateway refuses without it)
 * and a database with the eval owner seeded
 * (`npm run db:seed` or `npx tsx scripts/seed-accounts.ts`).
 */

import { randomUUID } from "node:crypto";

import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { openRouterJson } from "../../src/ai-call.js";
import { eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "../../src/db/client.js";
import { aiCalls } from "../../src/db/schema.js";
import { embedAll } from "../../src/embeddings.js";
import { loadEnvLocal } from "../../src/env.js";
import { streamMessage } from "../../src/messages-stream.js";
import { QUICK_MODEL_OPENROUTER } from "../../src/models.js";
import { EVAL_OWNER_ID } from "../../src/owner.js";
import { costStore } from "../../src/store/ai-calls.js";
import { spendForArticle } from "../../src/store/ai-calls-spend-pg.js";

const PROMPT = "Reply with the single word: ok";

function dollars(nanos: number): string {
  return `$${(nanos / 1e9).toFixed(6)}`;
}

async function main(): Promise<number> {
  loadEnvLocal();
  console.log(`Ledger: ${costStore.describe()}`);

  /* **Before spending anything**: the rows are owned by the eval account, and
     `ai_calls.owner_id` is a foreign key, so without it every write would fail
     after the money had gone. */
  const owner = await getDb().execute<{ n: string }>(
    sql`select count(*) as n from auth.users where id = ${EVAL_OWNER_ID}`,
  );
  const ownerRows = (owner as unknown as { rows?: { n: string }[] }).rows ?? [];
  if (Number(ownerRows[0]?.n ?? 0) !== 1) {
    console.error(
      `The eval owner ${EVAL_OWNER_ID} is not in this database — run npx tsx scripts/seed-accounts.ts first.`,
    );
    return 2;
  }

  const slug = `ledger-check-${randomUUID().slice(0, 8)}`;
  /* A synthetic article: no `articles` row has this slug, so every row is
     written with the slug and no id, and the admin query finds them by its
     fallback — the owner's slug since the article's birth, which is now. */
  const article = {
    id: randomUUID(),
    slug,
    ownerId: EVAL_OWNER_ID,
    createdAt: new Date(Date.now() - 1000),
  };
  console.log(`Attributing to the synthetic slug ${slug}\n`);

  const { report } = await collectSpend(
    async () => {
      await streamMessage(
        "labels",
        {
          max_tokens: 16,
          messages: [{ role: "user", content: PROMPT }],
        },
        { power: "standard" },
      ).finalMessage();
      await openRouterJson("eval", {
        model: QUICK_MODEL_OPENROUTER,
        max_tokens: 16,
        messages: [{ role: "user", content: PROMPT }],
      });
      await embedAll(["ledger check"], { inputType: "query" });
    },
    {
      attribution: { scopeKind: "eval", ownerId: EVAL_OWNER_ID, articleSlug: slug },
      sink: costStore.record,
    },
  );

  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? "✓" : "✗"} ${what}`);
    if (!ok) failures.push(what);
  };

  check(report.calls.length === 3, `the collector saw 3 calls (saw ${report.calls.length})`);
  check(report.pending.length === 0, `no call left pending (${report.pending.length})`);
  check(report.writeFailures === 0, `every ledger write landed (${report.writeFailures} failed)`);
  const collected = totalSpend(report.calls);
  check(collected.unpriced === 0, `the collector priced every call (${collected.unpriced} unpriced)`);

  /* **The persisted rows, read back by the collector's run id** — independent
     of the article query, so a row that was written wrongly (lost its slug,
     its wire, its price) is caught here rather than averaged away in a group.
     GPT Sol, plan review P1. */
  const persisted = await getDb().select().from(aiCalls).where(eq(aiCalls.runId, report.runId));
  check(
    persisted.length === 3,
    `3 rows persisted under run ${report.runId} (found ${persisted.length})`,
  );
  const expected: [job: string, wire: string][] = [
    ["labels", "messages"],
    ["eval", "chat"],
    ["embeddings", "embeddings"],
  ];
  for (const [job, wire] of expected) {
    const found = persisted.filter((r) => r.purpose === job);
    const r = found[0];
    const nanos = r ? (r.creditsUsedNanos ?? 0) + (r.byokUpstreamNanos ?? 0) : 0;
    check(
      found.length === 1 &&
        r !== undefined &&
        r.wire === wire &&
        r.costSource === "provider" &&
        r.outcome === "ok" &&
        r.scopeKind === "eval" &&
        r.ownerId === EVAL_OWNER_ID &&
        r.articleSlug === slug &&
        r.creditsUsedNanos !== null &&
        nanos > 0,
      `${job}: one ${wire}-wire row, ok, eval scope, attributed, settled by the provider at ${dollars(nanos)}`,
    );
  }
  const rowNanos = persisted.reduce(
    (n, r) =>
      n + (r.creditsUsedNanos ?? 0) + (r.byokUpstreamNanos ?? 0) + (r.computedCostNanos ?? 0),
    0,
  );
  check(
    rowNanos === collected.nanos,
    `the persisted rows add up to what the collector recorded (${dollars(rowNanos)} vs ${dollars(collected.nanos)})`,
  );

  /* **Then the admin view's own query**, which must agree with the rows. */
  const groups = await spendForArticle(article);
  const groupCalls = groups.reduce((n, g) => n + g.calls, 0);
  const groupNanos = groups.reduce(
    (n, g) => n + g.creditsNanos + g.byokNanos + g.computedNanos,
    0,
  );
  check(groupCalls === 3, `the article query sees the 3 rows (saw ${groupCalls})`);
  check(
    groupNanos === rowNanos && groups.every((g) => g.unpricedCalls === 0),
    `the article query's total equals the rows' (${dollars(groupNanos)} vs ${dollars(rowNanos)})`,
  );

  console.log(`\nThis check spent ${dollars(collected.nanos)}.`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    return 1;
  }
  console.log("All checks passed.");
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (e: unknown) => {
    console.error(e);
    await closeDb().catch(() => {});
    process.exit(1);
  });
