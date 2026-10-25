/**
 * Trial 261025a: **what each Sources sub-mode finds on the same six articles**,
 * on the local stack. docs/investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md
 *
 * The paid steps run through the ordinary queue, one at a time, exactly as a
 * press would (and so land in the local `ai_calls` ledger by step):
 *
 *     npx tsx scripts/stage.ts bibliography <slug>
 *     npx tsx scripts/stage.ts citation-blurbs <slug>
 *     npx tsx scripts/stage.ts reception <slug>
 *     npx tsx scripts/stage.ts situate <slug>
 *
 * This script does the two free ones and the reading-out:
 *
 *     npx tsx scripts/spikes/261025a-sources-trial.ts free <slug>   # Cited by + Not cited (OpenAlex, no model)
 *     npx tsx scripts/spikes/261025a-sources-trial.ts dump <slug>   # every artefact + the ledger, to output/sources-trial/
 *
 * **Local only**: it refuses a DATABASE_URL that is not 127.0.0.1 or localhost.
 * Output is gitignored (it holds article prose and model text); the
 * investigation quotes what it needs.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();
const target = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(target)) throw new Error("261025a: refusing a database that is not local");

const [command, slug] = process.argv.slice(2);
if ((command !== "free" && command !== "dump") || !slug) throw new Error("usage: 261025a-sources-trial.ts free|dump <slug>");

const { runAsOwner, environmentOwnerId } = await import("../../src/owner.js");
const OUT = "output/sources-trial";
mkdirSync(OUT, { recursive: true });

if (command === "free") {
  const { citersOf } = await import("../../src/citation-index.js");
  const { searchRelatedWork } = await import("../../src/related-work.js");
  const store = await import("../../src/store/index.js");
  const owner = environmentOwnerId();
  const result = await runAsOwner(owner, async () => {
    const identity = await store.loadArticleIdentity(slug);
    const t0 = Date.now();
    const citedBy = await citersOf(identity);
    const citedByMs = Date.now() - t0;
    const t1 = Date.now();
    const notCited = await searchRelatedWork(await store.loadRelatedWork(slug), {
      store: store.relatedWorkStore,
      allowance: store.fetchAllowanceStore,
    });
    return { identity, citedBy, citedByMs, notCited, notCitedMs: Date.now() - t1 };
  });
  writeFileSync(`${OUT}/${slug}-free.json`, JSON.stringify(result, null, 2));
  const c = result.citedBy;
  const n = result.notCited;
  console.log(
    `cited by: ${c.kind}${c.kind === "found" ? ` via ${c.via}, count ${c.count}, returned ${c.returned}` : ""} (${result.citedByMs} ms)\n` +
      `not cited: ${n.kind}${n.kind === "found" ? `, ${n.works.length} listed, ${n.excluded} excluded` : ""} (${result.notCitedMs} ms)`,
  );
  process.exit(0);
}

/* dump */
const { getDb } = await import("../../src/db/client.js");
const { sql } = await import("drizzle-orm");
const db = getDb();
const rev = (
  await db.execute(sql`
    select r.title, r.doi, r.published_year, r.published_at, r.word_count, r.final_url,
           r.bibliography, r.reception, r.situate, r.citation_blurbs
    from spideryarn.articles a join spideryarn.article_revisions r on r.id = a.current_revision_id
    where a.slug = ${slug}`)
).rows[0] as Record<string, unknown> | undefined;
if (!rev) throw new Error(`no such article: ${slug}`);
const ledger = (
  await db.execute(sql`
    select step_name, count(*)::int as calls, sum(coalesce(credits_used_nanos, computed_cost_nanos, 0))::bigint as nanos,
           sum(duration_ms)::int as ms, sum(web_searches)::int as searches, min(created_at) as first, max(created_at) as last
    from spideryarn.ai_calls where article_slug = ${slug} and created_at > now() - interval '2 days'
    group by step_name order by step_name`)
).rows;
writeFileSync(`${OUT}/${slug}-dump.json`, JSON.stringify({ ...rev, ledger }, null, 2));
console.log(
  ledger
    .map((l) => `${String(l.step_name).padEnd(18)} ${l.calls} calls  $${(Number(l.nanos) / 1e9).toFixed(3)}  ${l.searches ?? 0} searches  ${l.ms} ms`)
    .join("\n"),
);
process.exit(0);
