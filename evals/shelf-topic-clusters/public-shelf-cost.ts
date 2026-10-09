/**
 * **What a re-think of the public shelf's topics would cost, measured** — PAID,
 * about three cents for the full invocation:
 *
 *     npx tsx evals/shelf-topic-clusters/public-shelf-cost.ts --out <result.json>
 *
 * Runs the shipped `rethink` (src/shelf-terms/model-topics.ts) with no reader
 * profile, as a public tree would have none, on:
 *
 * - **public-6**: the articles on production's public shelf today, read
 *   read-only with the listing's own conditions, 200-row ceiling and card text
 *   caps (src/store/public-library.ts). These are already shown to anyone.
 * - **wide-8, wide-20, wide-45, wide-96**: seeded samples of the synthetic
 *   `greg-wide` shelf (twelve areas), standing in for a mixed public shelf as it
 *   grows. 8 is the smallest shelf that shows pills; 96 is the whole shelf.
 *
 * and then **filing**: three different new articles put into the wide-20 tree
 * one at a time with `fileWorks`, examples of what an owner sharing one more
 * article would cost between re-thinks.
 *
 * Each run's spend is the collector's own total, the figure `npm run cost`
 * counts, recorded in the local ledger as `eval`. Nothing is written to
 * production. Written for docs/plans/261008j (Greg's answer to q-deh67j: is a
 * public re-think half a cent or less?).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { productionClient } from "../../scripts/feedback-reporter.js";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { isLocalDatabaseUrl } from "../../src/db/ssl.js";
import { loadEnvLocal } from "../../src/env.js";
import { environmentOwnerId } from "../../src/owner.js";
import { fileWorks, realCalls, rethink, TOPIC_SET_PROMPT_VERSION, type TopicWork } from "../../src/shelf-terms/model-topics.js";
import { costStore } from "../../src/store/ai-calls.js";
import { PUBLIC_CARD_CHARS } from "../../src/store/public-library.js";
import { EVAL_DIR as TOPICS_EVAL_DIR } from "../shelf-topics/case.js";

loadEnvLocal();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function publicShelf(): Promise<TopicWork[]> {
  const { client, target } = productionClient();
  console.log(`Target: ${target} (read only)`);
  await client.connect();
  try {
    await client.query("begin read only");
    try {
      const rows = (
        await client.query<{ id: string; title: string; gist: string | null }>(
          `select a.id,
                  coalesce(
                    left(r.title, $1),
                    (select left(b.text, $1)
                       from spideryarn.revision_blocks b
                      where b.revision_id = r.id and b.kind = 'heading' and b.level = 1
                      order by b.ordinal
                      limit 1),
                    a.slug) as title,
                  left(r.root_gist, $2) as gist
             from spideryarn.articles a
             join spideryarn.article_revisions r on r.id = a.current_revision_id
            where a.visibility = 'public' and a.archived_at is null and r.tree is not null
              and exists (select 1 from spideryarn.revision_blocks b where b.revision_id = r.id)
            order by a.public_at desc nulls last, a.slug
            limit 200`,
          [PUBLIC_CARD_CHARS.title, PUBLIC_CARD_CHARS.gist],
        )
      ).rows;
      return rows.map((r) => ({ id: r.id, title: r.title, gist: r.gist }));
    } finally {
      /* A rollback failure replaces the result: without a confirmed rollback,
         the production-read safety contract did not complete. */
      await client.query("rollback");
    }
  } finally {
    await client.end();
  }
}

function wide(): TopicWork[] {
  const j = JSON.parse(readFileSync(path.join(TOPICS_EVAL_DIR, "synthetic", "greg-wide.json"), "utf8")) as {
    articles: { slug: string; title: string; gist: string }[];
  };
  return j.articles.map((a) => ({ id: a.slug, title: a.title, gist: a.gist }));
}

/** A seeded shuffle, so a sample is the same sample on every run. */
function sample<T>(xs: readonly T[], n: number, seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

async function spent<T>(fn: () => Promise<T>): Promise<{ result: T; usd: number; calls: number; unpriced: number; seconds: number }> {
  const t0 = performance.now();
  const { result, report } = await collectSpend(fn, {
    attribution: { scopeKind: "eval", ownerId: environmentOwnerId() },
    sink: (row) => costStore.record(row),
  });
  if (report.pending.length > 0) throw new Error(`${report.pending.length} model call(s) were still pending when the run ended`);
  const { nanos, unpriced } = totalSpend(report.calls);
  return { result, usd: nanos / 1e9, calls: report.calls.length, unpriced, seconds: (performance.now() - t0) / 1000 };
}

async function main(): Promise<void> {
  const out = arg("out");
  if (!out) throw new Error("--out <result.json> is required");
  const ledgerUrl = process.env.DATABASE_URL;
  if (!ledgerUrl || !isLocalDatabaseUrl(ledgerUrl)) {
    throw new Error("DATABASE_URL must point at the local database: the eval writes its spend rows there.");
  }
  const all = wide();
  const shelves: { id: string; works: TopicWork[]; runs: number }[] = [
    { id: "public-6", works: await publicShelf(), runs: 3 },
    { id: "wide-8", works: sample(all, 8, 1), runs: 2 },
    { id: "wide-20", works: sample(all, 20, 2), runs: 2 },
    { id: "wide-45", works: sample(all, 45, 3), runs: 2 },
    { id: "wide-96", works: all, runs: 1 },
  ];
  const results: unknown[] = [];
  let tree20: Awaited<ReturnType<typeof rethink>> | null = null;
  for (const shelf of shelves) {
    for (let run = 1; run <= shelf.runs; run++) {
      const r = await spent(() => rethink(shelf.works, realCalls(), { profile: null }));
      if (shelf.id === "wide-20") tree20 = r.result;
      const line = { kind: "rethink", shelf: shelf.id, works: shelf.works.length, run, usd: r.usd, calls: r.calls, unpriced: r.unpriced, seconds: r.seconds, topics: r.result.topics.length };
      console.log(JSON.stringify(line));
      results.push(line);
    }
  }
  if (tree20) {
    const newcomers = all.filter((w) => !shelves.find((s) => s.id === "wide-20")!.works.some((x) => x.id === w.id));
    for (let run = 1; run <= 3; run++) {
      const one = [newcomers[run - 1]!];
      const r = await spent(() => fileWorks(tree20!.topics, one, realCalls()));
      const line = { kind: "file-one", shelf: "wide-20", run, usd: r.usd, calls: r.calls, unpriced: r.unpriced, seconds: r.seconds };
      console.log(JSON.stringify(line));
      results.push(line);
    }
  }
  writeFileSync(out, JSON.stringify({ promptVersion: TOPIC_SET_PROMPT_VERSION, measuredAt: new Date().toISOString(), results }, null, 1));
}

await main();
