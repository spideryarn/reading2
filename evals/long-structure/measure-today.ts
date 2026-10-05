/**
 * How the structure step behaves today, read from a database's own records.
 * Counts and timings only: no titles, no prose, no owner ids.
 *
 *   npx tsx evals/long-structure/measure-today.ts            (local, .env.local)
 *   DATABASE_URL=… npx tsx evals/long-structure/measure-today.ts
 *
 * Everything runs inside one `BEGIN READ ONLY` transaction, so it cannot write
 * whichever database it reaches. Read its `Target:` line.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { sslDecisionFor } from "../../src/db/ssl.js";

function urlFrom(envFile: string): string {
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error(`no DATABASE_URL in ${envFile}`);
  return line.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
}

/* `--env-file=<path>` names another database's env file (production's is
   `.env.prod` in the primary checkout); the transaction below is read-only
   whichever it is. */
const envFile = process.argv.find((a) => a.startsWith("--env-file="))?.slice("--env-file=".length);
const url = process.env.DATABASE_URL ?? urlFrom(envFile ?? ".env.local");
console.log(`Target: ${url.replace(/:[^:@/]*@/, ":***@")}`);

const QUERIES: Array<[string, string]> = [
  [
    "structure-step model calls, by purpose and outcome (last 45 days)",
    `select purpose, outcome, scope_kind, count(*)::int as n,
            round(percentile_cont(0.5) within group (order by duration_ms)/1000.0)::int as p50_s,
            round(percentile_cont(0.9) within group (order by duration_ms)/1000.0)::int as p90_s,
            round(max(duration_ms)/1000.0)::int as max_s,
            round(avg(output_tokens))::int as avg_out,
            round(avg(reasoning_tokens))::int as avg_think,
            round(sum(coalesce(credits_used_nanos, computed_cost_nanos, 0))/1e9, 2) as usd
       from spideryarn.ai_calls
      where step_name = 'structure' and started_at > now() - interval '45 days'
      group by 1,2,3 order by 1,2,3`,
  ],
  [
    "structure calls by input size (reported input tokens), wall time and outcome",
    `select case when reported_input_tokens < 20000 then 'a <20k'
                 when reported_input_tokens < 60000 then 'b 20-60k'
                 when reported_input_tokens < 120000 then 'c 60-120k'
                 when reported_input_tokens < 250000 then 'd 120-250k'
                 else 'e 250k+' end as input,
            outcome, count(*)::int as n,
            round(percentile_cont(0.5) within group (order by duration_ms)/1000.0)::int as p50_s,
            round(percentile_cont(0.9) within group (order by duration_ms)/1000.0)::int as p90_s,
            round(avg(output_tokens))::int as avg_out,
            round(avg(reasoning_tokens))::int as avg_think
       from spideryarn.ai_calls
      where step_name = 'structure' and started_at > now() - interval '45 days'
      group by 1,2 order by 1,2`,
  ],
  [
    "the structure step inside jobs: status, and its detail with numbers folded",
    `select s->>'status' as status,
            left(regexp_replace(coalesce(s->>'detail', ''), '[0-9][0-9.,]*', 'N', 'g'), 110) as detail,
            count(*)::int as n
       from spideryarn.jobs j, jsonb_array_elements(j.steps) s
      where s->>'name' = 'structure'
      group by 1,2 order by 3 desc limit 40`,
  ],
  [
    "failed jobs whose structure step is the one that failed, by failure kind",
    `select j.failure_kind,
            left(regexp_replace(coalesce(s->>'error', j.error, ''), '[0-9][0-9.,]*', 'N', 'g'), 140) as error,
            count(*)::int as n
       from spideryarn.jobs j, jsonb_array_elements(j.steps) s
      where s->>'name' = 'structure' and s->>'status' = 'error'
      group by 1,2 order by 3 desc limit 30`,
  ],
  [
    /* Every revision that holds a tree, drafts and superseded ones included
       (GPT Sol's plan review of 261005j, F9). `current` is the ones an article
       points at now, which is what a reader is looking at. */
    "revisions holding a tree, by how it was made (`current`: the ones articles point at now)",
    `select r.tree->>'version' as version, r.tree->>'generator' as generator,
            coalesce(r.tree->>'provisional', '') as provisional, count(*)::int as n,
            count(a.id)::int as current
       from spideryarn.article_revisions r
       left join spideryarn.articles a on a.current_revision_id = r.id
      where r.tree is not null
      group by 1,2,3 order by 4 desc limit 30`,
  ],
];

const client = new pg.Client({ connectionString: url, ssl: sslDecisionFor(url).ssl });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  for (const [title, sql] of QUERIES) {
    console.log(`\n## ${title}`);
    try {
      await client.query("SAVEPOINT q");
      const { rows } = await client.query(sql);
      console.table(rows);
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT q");
      console.log(`  query failed: ${(err as Error).message}`);
    }
  }
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
