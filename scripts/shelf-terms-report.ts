/**
 * **How good would one reader's shelf topics be?** — computed in memory from
 * their articles, and **writes nothing**.
 *
 *     npm run shelf-terms:report -- --owner <uuid>
 *     npm run shelf-terms:report -- --owner <uuid> --archived     # active + archived
 *     DATABASE_URL=<production> npm run shelf-terms:report -- --owner <uuid>
 *
 * docs/plans/260928a-shelf-facet-terms.md § Measurements. Greg's real shelf is
 * in production, which the box cannot read, so this is how anybody holding the
 * production `DATABASE_URL` measures it. The shell's `DATABASE_URL` wins over
 * `.env.local` (src/env.ts § `resolveTargetUrl`), and the `Target:` line says
 * which database was actually read.
 *
 * **Why it writes nothing**, not even to the candidate cache the route fills:
 * pointed at production, a report is a read, and a read that populated
 * `revision_phrase_runs` would be a write to real readers' data nobody asked
 * for (CLAUDE.md § Real data belongs to the reader). So it reads the owner's
 * current revisions with the route's own owner-scoped query, reads each one's
 * blocks, and runs the same extractor and chooser in memory. It imports only
 * the read halves of src/store/pg-shelf-terms.ts.
 *
 * What it prints: the target, the scope (articles, distinct works, skipped),
 * the metrics from `shelfTermMetrics` — the one definition — at K = 20, 30 and
 * 40, the K = 30 topic list with counts, the articles no topic covers, and
 * timings.
 */
import { withoutPassword, isLocalDatabaseUrl } from "../src/db/ssl.js";
import { loadEnvLocal, resolveTargetUrl } from "../src/env.js";
import { isUuid } from "../src/ids.js";
import type { OwnerId } from "../src/owner.js";

loadEnvLocal();
const url = resolveTargetUrl({ shellWins: true });
if (!url) {
  console.error("No DATABASE_URL.");
  process.exit(1);
}
/* getDb() reads process.env; make it the database the Target line names. */
process.env.DATABASE_URL = url;

const argv = process.argv.slice(2);
const ownerAt = argv.indexOf("--owner");
const owner = ownerAt >= 0 ? argv[ownerAt + 1] : undefined;
const archived = argv.includes("--archived");
if (!owner || !isUuid(owner)) {
  console.error("Usage: npm run shelf-terms:report -- --owner <uuid> [--archived]");
  process.exit(1);
}

/* Imported after the URL is settled, so nothing can open a pool on the other one. */
const { closeDb, getDb } = await import("../src/db/client.js");
const { runAsOwner } = await import("../src/owner.js");
const { currentShelfRevisions, readRevisionBlocks } = await import("../src/store/pg-shelf-terms.js");
const { extractCandidates, segmentsFromBlocks, EXTRACTOR_VERSION } = await import("../src/shelf-terms/extract.js");
const { byArticleCount, candidateTopics, chooseTerms, maxCoverageOrder, shelfTermHeadMetrics, shelfTermMetrics } =
  await import(
  "../src/shelf-terms/choose.js"
);
const { sql } = await import("drizzle-orm");

const ms = (n: number) => `${n.toFixed(0)} ms`;
const pct = (n: number) => n.toFixed(2);

async function main(): Promise<void> {
  const where = await getDb().execute(sql`select current_database() as db`);
  const db = (where.rows[0] as { db?: string } | undefined)?.db;
  console.log(`Target: ${withoutPassword(url ?? "")}  (database=${db}, ${isLocalDatabaseUrl(url ?? "") ? "local" : "REMOTE"})`);
  console.log(`Owner:  ${owner}   scope: ${archived ? "active + archived" : "active"}   extractor v${EXTRACTOR_VERSION}`);
  console.log("Writes: nothing.\n");

  await runAsOwner(owner as OwnerId, async () => {
    const t0 = performance.now();
    const set = await currentShelfRevisions({ archived });
    const t1 = performance.now();

    let readMs = 0;
    let extractMs = 0;
    let words = 0;
    const skipped: { slug: string; why: string }[] = [];
    const input: { slug: string; words: number; textHash: string; candidates: ReturnType<typeof extractCandidates>["candidates"] }[] = [];
    for (const entry of set) {
      const r0 = performance.now();
      const blocks = await readRevisionBlocks(entry);
      const r1 = performance.now();
      const run = extractCandidates(segmentsFromBlocks(entry.title, blocks));
      const r2 = performance.now();
      readMs += r1 - r0;
      extractMs += r2 - r1;
      words += run.words;
      if (run.skipped) {
        skipped.push({ slug: entry.slug, why: run.skipped });
      } else {
        input.push({ slug: entry.slug, words: run.words, textHash: run.textHash, candidates: run.candidates });
      }
    }
    /* Coverage describes articles the English extractor can classify. A
       skipped article can never join a topic, so including it would make the
       denominator depend on unsupported input rather than topic quality. */
    const slugs = input.map((a) => a.slug);
    const wordsOf = new Map(input.map((a) => [a.slug, a.words]));

    const works = new Set(input.map((a) => a.textHash)).size;
    console.log(
      `Articles ${set.length - skipped.length} eligible / ${set.length} on shelf   ` +
        `works ${works}   skipped ${skipped.length}   prose words ${words.toLocaleString("en-GB")}`,
    );
    for (const s of skipped) console.log(`  skipped: ${s.slug} (${s.why})`);
    console.log("");

    console.log(" K  | topics | coverage | per article mean/median | ≥ 2 topics | Jaccard mean/max | choose");
    console.log("----|--------|----------|-------------------------|------------|------------------|-------");
    let k30: ReturnType<typeof chooseTerms> | undefined;
    for (const K of [20, 30, 40]) {
      const c0 = performance.now();
      const result = chooseTerms(input, { maxTerms: K });
      const c1 = performance.now();
      if (K === 30) k30 = result;
      const m = shelfTermMetrics(result.terms, slugs);
      console.log(
        ` ${K} | ${String(m.terms).padStart(6)} | ${pct(m.coverage).padStart(8)} | ` +
          `${`${pct(m.meanTermsPerArticle)} / ${m.medianTermsPerArticle}`.padStart(23)} | ` +
          `${pct(m.shareWithTwoOrMore).padStart(10)} | ${`${pct(m.meanPairwiseJaccard)} / ${pct(m.maxPairwiseJaccard)}`.padStart(16)} | ${ms(c1 - c0)}`,
      );
    }

    if (k30) {
      console.log("\nTopics at K = 30, best first — label [key]: articles (top three by count)");
      for (const t of k30.terms) {
        const top = t.articles
          .slice(0, 3)
          .map((a) => `${a.slug}×${a.count}`)
          .join(", ");
        console.log(`  ${t.label} [${t.key}]: ${t.articles.length}  (${top})`);
      }
      const m = shelfTermMetrics(k30.terms, slugs);
      console.log(`\nUncovered at K = 30: ${m.uncovered.length}`);
      for (const s of m.uncovered) console.log(`  ${s} (${wordsOf.get(s) ?? 0} words)`);
    }

    firstFew(input, slugs);

    const per1k = words ? (extractMs / words) * 1000 : 0;
    console.log(
      `\nTimings: shelf query ${ms(t1 - t0)}, block reads ${ms(readMs)}, ` +
        `extraction ${ms(extractMs)} (${per1k.toFixed(1)} ms per 1k words)`,
    );
  });
}

/**
 * Plan 260928d § Stage 1: what the reader sees first, in two orders — by
 * article count (how the row drew them before 260928d) and rank (the
 * chooser's order, which the row draws since) — for the ranking and
 * phrase-bonus variants the plan asks to measure; then the ceiling and an
 * unweighted max-coverage baseline (Sol R5).
 */
function firstFew(input: Parameters<typeof chooseTerms>[0], slugs: string[]): void {
  console.log("\nThe first few (K = 30): coverage@5/8/12, first-12 Jaccard and overlap coefficient mean/max");
  console.log(" variant         | order | total cov | @5   | @8   | @12  | Jaccard mean/max | overlap mean/max");
  console.log("-----------------|-------|-----------|------|------|------|------------------|-----------------");
  const lists: string[] = [];
  /* e = quality exponent (the default ranking: discounted coverage × quality^e);
     lex = lexicographic (new works, discounted, quality) over the q best by
     quality; p = phrase bonus; -sw = the shared-word Jaccard rule off (a
     threshold above 1 never fires) */
  const all = Number.POSITIVE_INFINITY;
  const variants: [string, Parameters<typeof chooseTerms>[1]][] = [["default", {}]];
  for (const e of [0.5, 1, 2])
    for (const p of [1, 0.5, 0])
      variants.push([`e${e} p${p}`, { phraseBonus: p, qualityPool: all, qualityExponent: e }]);
  for (const q of [60, 90, all])
    for (const p of [1, 0.5, 0])
      variants.push([`lex p${p} q${q}`, { phraseBonus: p, qualityPool: q, qualityExponent: null }]);
  variants.push(["e1 p1 -sw", { phraseBonus: 1, qualityPool: all, qualityExponent: 1, sharedWordJaccardMax: 2 }]);
  for (const [variant, opts] of variants) {
    const r = chooseTerms(input, { maxTerms: 30, ...opts });
    const total = shelfTermMetrics(r.terms, slugs).coverage;
    for (const [name, order] of [
      ["count", byArticleCount(r.terms)],
      ["rank", r.terms],
    ] as const) {
      const h = shelfTermHeadMetrics(order, slugs);
      console.log(
        ` ${variant.padEnd(16)}| ${name.padEnd(5)} | ${pct(total).padStart(9)} | ` +
          `${pct(h.coverageAt5)} | ${pct(h.coverageAt8)} | ${pct(h.coverageAt12)} | ` +
          `${`${pct(h.meanJaccard12)} / ${pct(h.maxJaccard12)}`.padStart(16)} | ` +
          `${pct(h.meanOverlap12)} / ${pct(h.maxOverlap12)}`,
      );
      const head = order.slice(0, 12).map((t) => `${t.label} ${t.articles.length}`);
      lists.push(`  ${variant}, ${name} order (${r.terms.length} topics): ${head.join(", ")}`);
    }
    const keys = new Set(r.terms.map((t) => t.key));
    const pairs = [...keys].filter((k) => keys.has(`${k}s`)).map((k) => `${k}/${k}s`);
    lists.push(`  ${variant}: key + "s" pairs both present: ${pairs.length ? pairs.join(", ") : "none"}`);
  }
  /* Works under 500 words earn no coverage gain: coverage over all eligible
     articles and over the ≥ 500-word ones, rank order. */
  const long = input.filter((a) => a.words >= 500).map((a) => a.slug);
  console.log(`\nShort works earn no coverage (min 500 words; ${long.length} of ${slugs.length} articles are ≥ 500)`);
  for (const e of [1, 1.5, 2])
    for (const minCoverageWords of [0, 500]) {
      const r = chooseTerms(input, { maxTerms: 30, qualityExponent: e, minCoverageWords });
      const a = shelfTermHeadMetrics(r.terms, slugs);
      const b = shelfTermHeadMetrics(r.terms, long);
      console.log(
        `  e${e} min${minCoverageWords}: all @5/8/12 ${pct(a.coverageAt5)} ${pct(a.coverageAt8)} ${pct(a.coverageAt12)}` +
          `  ≥500 @5/8/12 ${pct(b.coverageAt5)} ${pct(b.coverageAt8)} ${pct(b.coverageAt12)}` +
          `  total ≥500 ${pct(shelfTermMetrics(r.terms, long).coverage)}  overlap max ${pct(a.maxOverlap12)}` +
          `\n    ${r.terms
            .slice(0, 12)
            .map((t) => `${t.label} ${t.articles.length}`)
            .join(", ")}`,
      );
    }
  for (const qualityPool of [all, 60]) {
    const pool = candidateTopics(input, { qualityPool });
    const ceiling = shelfTermMetrics(pool, slugs).coverage;
    const order = maxCoverageOrder(pool, slugs, 12);
    const base = shelfTermHeadMetrics(order, slugs);
    console.log(
      `\nCandidates, quality pool ${qualityPool}: ${pool.length}; ceiling ${pct(ceiling)} of eligible articles in any` +
        `\n  unweighted max-coverage baseline: @5 ${pct(base.coverageAt5)}  @8 ${pct(base.coverageAt8)}  @12 ${pct(base.coverageAt12)}` +
        `\n  its first 12: ${order.map((t) => `${t.label} ${t.articles.length}`).join(", ")}`,
    );
  }
  console.log(`\nFirst 12\n${lists.join("\n")}`);
}

try {
  await main();
} finally {
  await closeDb();
}
