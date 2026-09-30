/**
 * **Does the guessed web link for an uploaded paper come out right on real
 * papers?** The real-page eval of
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § Stages 2, which
 * decides whether the judge's *content* branch ships. Results are written up in
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper-eval.md.
 *
 *     npx tsx scripts/eval-source-guess.ts            # up to 10 papers
 *     npx tsx scripts/eval-source-guess.ts --max=3
 *
 * For up to ten uploaded PDFs in the **local** database, distinct by title, it
 * runs the route's own path — `identityOf` → `findWorkPage` (job
 * `upload-source-guess`) → `readPaperText` → `isSamePaper` — **for real**: a
 * paid web search each, a few cents. Then it runs the judge a second time with
 * the identity's opening shingles emptied, which is what the identifier branch
 * alone would have decided, so the two can be compared paper by paper.
 *
 * **What it does not do**: write an `upload_source_guesses` row, or take the
 * `upload-source-guess` allowance. It calls the pieces, not `makeGuessSource`,
 * so there is no claim to write and no bucket to spend. Its spend is collected
 * in memory (`collectSpend` with no sink) and printed, not written to the
 * ledger.
 *
 * **Bounds**: at most `--max` papers (10), and no new search once the billed
 * searches reach 10 — a call whose usage reports no count is counted as one.
 * It refuses any database whose host is not 127.0.0.1 or localhost.
 *
 * Titles and URLs are printed: this is local test data, read by a developer.
 */
import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

const SEARCH_CAP = 10;
const maxArg = process.argv.find((a) => a.startsWith("--max="));
const MAX_PAPERS = Math.min(10, Number(maxArg?.slice("--max=".length) ?? 10));

function die(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/* The guard comes before any module that opens a connection is imported. */
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) die("No DATABASE_URL.");
let host: string;
try {
  host = new URL(dbUrl).hostname;
} catch {
  die("DATABASE_URL does not parse; refusing.");
}
console.log(`Target: ${host} (database from DATABASE_URL)`);
if (host !== "127.0.0.1" && host !== "localhost") die(`Refusing: ${host} is not the local database.`);

const { sql } = await import("drizzle-orm");
const { closeDb, getDb } = await import("../src/db/client.js");
const { pgArticleReader } = await import("../src/store/pg.js");
const { runAsOwner } = await import("../src/owner.js");
const { collectSpend } = await import("../src/ai-spend.js");
const { log } = await import("../src/log.js");
const { wordsOf } = await import("../src/citations.js");
const { readPaperText } = await import("../src/paper-text.js");
const { defaultFind, defaultFirstPages, identityOf, isAnUpload, workToFind, GUESS_TIMEOUT_MS } = await import(
  "../src/source-guess-run.js"
);
const { isSamePaper, MIN_TITLE_WORDS } = await import("../src/source-guess.js");

import type { SamePaperVerdict } from "../src/source-guess.js";
import type { OwnerId } from "../src/types.js";

interface Row {
  title: string;
  authors: boolean;
  dois: string[];
  arxivs: string[];
  shingles: number;
  kept: string;
  resultTitle: string;
  read: string;
  readTitle: string;
  readDoi: string;
  readAuthors: string;
  full: string;
  idOnly: string;
  searches: number | null;
  link: string;
  costNanos: number;
}

const verdictText = (v: SamePaperVerdict): string => (v.same ? `same (${v.matchedBy})` : `no (${v.why})`);

const candidates = (
  await getDb().execute(sql`
    select a.slug, a.owner_id, r.title
      from spideryarn.articles a
      join spideryarn.article_revisions r on r.id = a.current_revision_id
     where r.raw_source_kind = 'pdf' and r.final_url is null and r.title is not null
     order by a.created_at desc`)
).rows as { slug: string; owner_id: string; title: string }[];
console.log(`${candidates.length} uploaded PDFs with a title in the local database\n`);

const seen = new Set<string>();
const skipped: { title: string; why: string }[] = [];
const rows: Row[] = [];
let billed = 0;

for (const c of candidates) {
  if (rows.length >= MAX_PAPERS) break;
  if (billed >= SEARCH_CAP) {
    console.log(`Search cap of ${SEARCH_CAP} reached; stopping.`);
    break;
  }
  const key = wordsOf(c.title).join(" ");
  if (seen.has(key)) continue;
  seen.add(key);

  await runAsOwner(c.owner_id as OwnerId, async () => {
    const article = await pgArticleReader.loadArticle(c.slug);
    if (!isAnUpload(article.meta)) {
      skipped.push({ title: c.title, why: "not an upload (has an address)" });
      return;
    }
    const identity = await identityOf(article, await pgArticleReader.loadSource(c.slug), defaultFirstPages);
    if (!identity) {
      const why =
        wordsOf(article.meta.title).length < MIN_TITLE_WORDS
          ? `title under ${MIN_TITLE_WORDS} significant words`
          : "title is the filename";
      skipped.push({ title: c.title, why });
      return;
    }

    const row: Row = {
      title: article.meta.title,
      authors: identity.surname !== null,
      dois: identity.dois,
      arxivs: identity.arxivs,
      shingles: identity.shingles.length,
      kept: "",
      resultTitle: "",
      read: "",
      readTitle: "",
      readDoi: "",
      readAuthors: "",
      full: "",
      idOnly: "",
      searches: null,
      link: "none",
      costNanos: 0,
    };
    const started = Date.now();
    const deadline = AbortSignal.timeout(GUESS_TIMEOUT_MS);
    const remaining = () => Math.max(1, GUESS_TIMEOUT_MS - (Date.now() - started));
    const line = log("model").child({ slug: c.slug });

    try {
      const { result: found, report } = await collectSpend(() =>
        defaultFind(workToFind(article.meta), { power: "standard", timeoutMs: remaining(), line }),
      );
      for (const call of report.calls) {
        if (call.cost.source === "provider") row.costNanos += call.cost.costNanos;
        else if (call.cost.source === "computed") row.costNanos += call.cost.computedCostNanos;
      }
      row.searches = found.reading.searches;
      billed += found.reading.searches ?? 1;
      const { verdict } = found.reading;
      if (verdict.kind === "none") {
        row.kept = `none (${verdict.why}; ${found.reading.results} results)`;
      } else {
        const page = verdict.page;
        row.kept = page.url;
        row.resultTitle = page.title ?? "";
        const paper = await readPaperText(page.url, { signal: deadline, timeoutMs: remaining() });
        if (paper.kind === "unreadable") {
          row.read = `unreadable (${paper.why}${paper.detail ? `: ${paper.detail}` : ""})`;
        } else {
          row.read = `ok (${paper.format}, ${paper.words} words)`;
          row.readTitle = paper.meta?.title ?? paper.title ?? "";
          row.readDoi = paper.meta?.doi ?? "";
          row.readAuthors = (paper.meta?.authors ?? []).slice(0, 3).join("; ");
          const full = isSamePaper(identity, { read: paper, result: page });
          const idOnly = isSamePaper({ ...identity, shingles: [] }, { read: paper, result: page });
          row.full = verdictText(full);
          row.idOnly = verdictText(idOnly);
          if (full.same) row.link = full.canonicalUrl ?? page.url;
        }
      }
    } catch (err) {
      row.kept = `error: ${err instanceof Error ? err.message : String(err)}`;
      billed += 1;
    }
    rows.push(row);
  });
}

console.log("\n==== per paper ====\n");
for (const [i, r] of rows.entries()) {
  console.log(`#${i + 1} ${r.title}`);
  console.log(
    `   identity: authors=${r.authors ? "yes" : "no"} dois=[${r.dois.join(", ")}] arxivs=[${r.arxivs.join(", ")}] shingles=${r.shingles}`,
  );
  console.log(`   search kept: ${r.kept}${r.resultTitle ? `  — result title: ${r.resultTitle}` : ""}`);
  if (r.read) console.log(`   read: ${r.read}`);
  if (r.readTitle || r.readDoi || r.readAuthors) {
    console.log(`   read title: ${r.readTitle || "-"} | meta doi: ${r.readDoi || "-"} | meta authors: ${r.readAuthors || "-"}`);
  }
  if (r.full) console.log(`   verdict full: ${r.full}   identifier-only: ${r.idOnly}`);
  console.log(`   searches billed: ${r.searches ?? "unreported"}   cost: $${(r.costNanos / 1e9).toFixed(4)}`);
  console.log(`   link shown: ${r.link}\n`);
}

console.log("==== skipped ====");
for (const s of skipped) console.log(`   ${s.title} — ${s.why}`);

const found = rows.filter((r) => r.link !== "none").length;
const totalCost = rows.reduce((n, r) => n + r.costNanos, 0) / 1e9;
console.log(
  `\n==== totals ====\n   papers ${rows.length}, links shown ${found}, skipped ${skipped.length}, ` +
    `searches billed ${billed}, cost $${totalCost.toFixed(4)}`,
);
await closeDb();
