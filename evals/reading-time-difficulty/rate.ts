/**
 * **Does the reading-difficulty call give the same answer twice, and does its
 * order make sense?** — the paid check for plan
 * docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md
 * § Stages, 3.
 *
 *     npx tsx evals/reading-time-difficulty/rate.ts            # refuses: prints what it would buy
 *     npx tsx evals/reading-time-difficulty/rate.ts --paid     # buys it
 *
 * It calls production's own `rateReadingDifficulty` (src/reading-difficulty.ts)
 * on real articles in the LOCAL database, twice each, and prints one row per
 * article with both runs side by side. Nothing is stored on any article.
 *
 * ## What it measures
 *
 * - **Agreement between two runs of one prompt.** A rating that moves between
 *   runs would move the minutes on a card between imports. Counted per scale:
 *   how many articles got the same level twice, and how many moved by more
 *   than one.
 * - **Whether `language` tracks the one thing we can measure without a model**:
 *   mean letters per word, which is most of what the published reading-rate
 *   equations use (docs/research/261005a-reading-time-estimates-and-text-difficulty.md).
 *   Spearman's rank correlation, because the levels are ordered, not spaced.
 * - **Whether the order makes sense to a person.** That is the table: read it.
 *
 * ## Which articles
 *
 * Every article of the environment's owner with at least `MIN_BODY_WORDS` body
 * words, sorted by mean word length, and when there are more than `MAX_ARTICLES`
 * an even spread across that order, so the set runs from the plainest prose here
 * to the densest. Chosen by arithmetic, so a second run rates the same set.
 *
 * ## What it costs, and where the money is recorded
 *
 * Two calls an article of about 4,500 input tokens each: about a fifth of a
 * cent an article, under ten cents for 24. The rows are `scope_kind = 'eval'`
 * on `EVAL_OWNER_ID`, written through `costStore.record`, so `npm run cost`
 * shows them as non-product. It stops if the first article costs more than
 * `FIRST_ARTICLE_LIMIT_NANOS`, and after `REFUSALS_BEFORE_STOPPING` provider
 * refusals in a row (a spent key refuses every call in under a second).
 *
 * Needs the OpenRouter key in `.env.local` and the eval owner seeded
 * (`npx tsx scripts/seed-accounts.ts`).
 */
import fs from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";

import { collectSpend, currentSpend, formatNanos, totalSpend } from "../../src/ai-spend.js";
import { closeDb, getDb } from "../../src/db/client.js";
import { isLocalDatabaseUrl, withoutPassword } from "../../src/db/ssl.js";
import { loadEnvLocal } from "../../src/env.js";
import { READING_DIFFICULTY_MODEL } from "../../src/models.js";
import { EVAL_OWNER_ID, environmentOwnerId, runAsOwner } from "../../src/owner.js";
import {
  READING_DIFFICULTY_PROMPT_VERSION,
  rateReadingDifficulty,
  ratingParagraphs,
  type RatingOutcome,
} from "../../src/reading-difficulty.js";
import { costStore } from "../../src/store/ai-calls.js";
import { currentShelfRevisions, readRevisionBlocks } from "../../src/store/pg-shelf-terms.js";

const MIN_BODY_WORDS = 400;
const MAX_ARTICLES = 24;
const REFUSALS_BEFORE_STOPPING = 3;
/** Two cents. An article should cost about a fifth of one. */
const FIRST_ARTICLE_LIMIT_NANOS = 20_000_000;
const OUT_DIR = path.join(import.meta.dirname, "..", "results");

interface Candidate {
  slug: string;
  title: string;
  paragraphs: string[];
  words: number;
  /** Mean letters per word over the body, counting letters and digits only. */
  meanWordLength: number;
}

interface Row extends Omit<Candidate, "paragraphs"> {
  a: RatingOutcome;
  b: RatingOutcome;
}

function measure(paragraphs: readonly string[]): { words: number; meanWordLength: number } {
  let words = 0;
  let letters = 0;
  for (const paragraph of paragraphs) {
    for (const token of paragraph.split(/\s+/)) {
      const core = token.replace(/[^\p{L}\p{N}]/gu, "");
      if (!core) continue;
      words += 1;
      letters += core.length;
    }
  }
  return { words, meanWordLength: words ? letters / words : 0 };
}

/** An even spread of `n` from a sorted list: both ends, and the steps between. */
function evenSpread<T>(sorted: readonly T[], n: number): T[] {
  if (sorted.length <= n) return [...sorted];
  const picked: T[] = [];
  for (let i = 0; i < n; i++) {
    const item = sorted[Math.round((i * (sorted.length - 1)) / (n - 1))];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/** Ranks with ties given their mean rank, as Spearman's correlation needs. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.value === order[i]?.value) j += 1;
    for (let k = i; k <= j; k++) {
      const at = order[k]?.index;
      if (at !== undefined) out[at] = (i + j) / 2 + 1;
    }
    i = j + 1;
  }
  return out;
}

/** Spearman's rank correlation, or `null` when either side does not vary. */
function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (v: readonly number[]) => v.reduce((s, n) => s + n, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let top = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    const x = (rx[i] ?? 0) - mx;
    const y = (ry[i] ?? 0) - my;
    top += x * y;
    dx += x * x;
    dy += y * y;
  }
  return dx === 0 || dy === 0 ? null : top / Math.sqrt(dx * dy);
}

const level = (o: RatingOutcome, scale: "language" | "ideas") => (o.kind === "rated" ? String(o[scale]) : "-");
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

async function candidates(): Promise<Candidate[]> {
  const found: Candidate[] = [];
  /* The shelf's narrow readers (src/store/pg-shelf-terms.ts), not
     `loadArticle`: this needs each current revision's block text and nothing
     else, and they are the readers the shelf-topics report uses for the same
     reason. Archived articles too; an eval wants every piece there is. */
  for (const entry of await currentShelfRevisions({ archived: true })) {
    const paragraphs = ratingParagraphs(await readRevisionBlocks(entry));
    const { words, meanWordLength } = measure(paragraphs);
    if (words < MIN_BODY_WORDS) continue;
    found.push({ slug: entry.slug, title: entry.title ?? entry.slug, paragraphs, words, meanWordLength });
  }
  found.sort((x, y) => x.meanWordLength - y.meanWordLength || x.slug.localeCompare(y.slug));
  return evenSpread(found, MAX_ARTICLES);
}

async function main(): Promise<number> {
  loadEnvLocal();
  const url = process.env.DATABASE_URL ?? "";
  console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);
  if (!isLocalDatabaseUrl(url)) {
    console.error("This eval reads the local database only. Refusing a target that is not local.");
    return 2;
  }
  console.log(`Ledger: ${costStore.describe()}`);
  console.log(`Prompt: ${READING_DIFFICULTY_PROMPT_VERSION}   model: ${READING_DIFFICULTY_MODEL}\n`);

  const chosen = await runAsOwner(environmentOwnerId(), candidates);
  console.log(`${chosen.length} article(s) with at least ${MIN_BODY_WORDS} body words, by mean word length:`);
  for (const c of chosen) {
    console.log(`  ${cut(c.slug, 48).padEnd(48)} ${String(c.words).padStart(7)} words  ${c.meanWordLength.toFixed(2)} letters/word`);
  }
  if (!process.argv.includes("--paid")) {
    console.error(`\nThis would make ${chosen.length * 2} paid calls. Pass --paid to buy them.`);
    return 2;
  }
  if (chosen.length === 0) return 1;

  /* Before spending anything: the rows are owned by the eval account, and
     `ai_calls.owner_id` is a foreign key, so without it every ledger write
     would fail after the money had gone. evals/cost/ledger-check.ts. */
  const owner = await getDb().execute(sql`select count(*) as n from auth.users where id = ${EVAL_OWNER_ID}`);
  if (Number((owner.rows[0] as { n?: string } | undefined)?.n ?? 0) !== 1) {
    console.error(`The eval owner ${EVAL_OWNER_ID} is not in this database — run npx tsx scripts/seed-accounts.ts first.`);
    return 2;
  }

  const rows: Row[] = [];
  let stopped: string | null = null;
  const { report } = await collectSpend(
    async () => {
      let refusedInARow = 0;
      for (const c of chosen) {
        const { paragraphs, ...facts } = c;
        const outcomes: RatingOutcome[] = [];
        for (const _run of ["a", "b"]) {
          const outcome = await rateReadingDifficulty(paragraphs, { title: c.title });
          outcomes.push(outcome);
          refusedInARow = outcome.kind === "unrated" && outcome.why === "refused" ? refusedInARow + 1 : 0;
          if (refusedInARow >= REFUSALS_BEFORE_STOPPING) break;
        }
        const [a, b] = outcomes;
        if (a && b) rows.push({ ...facts, a, b });
        if (refusedInARow >= REFUSALS_BEFORE_STOPPING) {
          stopped = `${REFUSALS_BEFORE_STOPPING} provider refusals in a row`;
          return;
        }
        /* The first article is the price check, read while the collector is
           still open so the other twenty-three are not bought first. */
        if (rows.length === 1) {
          const first = totalSpend(currentSpend()?.calls ?? []).nanos;
          if (first > FIRST_ARTICLE_LIMIT_NANOS) {
            stopped = `the first article cost ${formatNanos(first)}, above ${formatNanos(FIRST_ARTICLE_LIMIT_NANOS)}`;
            return;
          }
        }
        process.stdout.write(".");
      }
    },
    {
      attribution: { scopeKind: "eval", ownerId: EVAL_OWNER_ID },
      sink: costStore.record,
    },
  );
  const spent = totalSpend(report.calls);
  console.log("\n");

  const header = `${"slug".padEnd(40)} ${"words".padStart(7)} ${"len".padStart(5)}  lang A/B  ideas A/B  reason (run A)`;
  const lines = rows.map((r) => {
    const reason = r.a.kind === "rated" ? r.a.reason : `unrated: ${r.a.why}`;
    return (
      `${cut(r.slug, 40).padEnd(40)} ${String(r.words).padStart(7)} ${r.meanWordLength.toFixed(2).padStart(5)}  ` +
      `${`${level(r.a, "language")}/${level(r.b, "language")}`.padEnd(8)}  ${`${level(r.a, "ideas")}/${level(r.b, "ideas")}`.padEnd(9)}  ${reason}`
    );
  });
  console.log([header, "-".repeat(header.length), ...lines].join("\n"));

  const both = rows.filter(
    (r): r is Row & { a: Extract<RatingOutcome, { kind: "rated" }>; b: Extract<RatingOutcome, { kind: "rated" }> } =>
      r.a.kind === "rated" && r.b.kind === "rated",
  );
  const same = (scale: "language" | "ideas") => both.filter((r) => r.a[scale] === r.b[scale]).length;
  const far = (scale: "language" | "ideas") => both.filter((r) => Math.abs(r.a[scale] - r.b[scale]) > 1).length;
  const rho = spearman(
    both.map((r) => (r.a.language + r.b.language) / 2),
    both.map((r) => r.meanWordLength),
  );
  const unrated = new Map<string, number>();
  for (const r of rows) {
    for (const o of [r.a, r.b]) if (o.kind === "unrated") unrated.set(o.why, (unrated.get(o.why) ?? 0) + 1);
  }
  const summary = [
    `Articles rated twice: ${both.length} of ${rows.length} attempted (${chosen.length} chosen)`,
    `Language: ${same("language")} of ${both.length} agree exactly between run A and run B; ${far("language")} differ by more than 1`,
    `Ideas:    ${same("ideas")} of ${both.length} agree exactly between run A and run B; ${far("ideas")} differ by more than 1`,
    `Spearman, language (mean of A and B) against mean word length: ${rho === null ? "not defined (one side does not vary)" : rho.toFixed(2)}`,
    `Spend the collector recorded: ${formatNanos(spent.nanos)} over ${report.calls.length} call(s)` +
      (spent.unpriced > 0 ? `, ${spent.unpriced} with no cost reported` : "") +
      (report.writeFailures > 0 ? `, ${report.writeFailures} ledger write(s) failed` : ""),
    `Unrated outcomes: ${unrated.size === 0 ? "none" : [...unrated].map(([why, n]) => `${why} ${n}`).join(", ")}`,
    ...(stopped ? [`STOPPED EARLY: ${stopped}`] : []),
  ];
  console.log(`\n${summary.join("\n")}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString();
  const byDay = path.join(OUT_DIR, `reading-time-difficulty-${stamp.slice(0, 10)}.json`);
  /* Never overwrite a run: a second one on the same day gets the time too. */
  const out = fs.existsSync(byDay)
    ? path.join(OUT_DIR, `reading-time-difficulty-${stamp.replace(/[:.]/g, "-")}.json`)
    : byDay;
  const record = {
    at: stamp,
    promptVersion: READING_DIFFICULTY_PROMPT_VERSION,
    model: READING_DIFFICULTY_MODEL,
    runId: report.runId,
    spentNanos: spent.nanos,
    rows,
    summary,
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
  return stopped ? 1 : 0;
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
