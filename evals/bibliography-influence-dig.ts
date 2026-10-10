/**
 * **How often does one *Dig deeper* press find a cited work's influence on
 * the web, and why not when it does not?** Plan 261003m stage 2's probe
 * (docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md
 * § A probe before it is called done).
 *
 *   npx tsx evals/bibliography-influence-dig.ts --run=1 <slug> <work id or title words> [more works …]
 *
 * **PAID.** For each work: production's own forced search (`searchFirst`,
 * aimed with `digSubject` and the first citing passage, as a press aims it),
 * then production's own influence request (`citationInfluenceRequest`) on
 * `DIG_DEEPER_MODEL`, read by `readInfluenceAnswer` and checked by
 * `keepInfluence`. About a cent for the search and up to three for the call,
 * per work. As in a press, **no influence call is made when no page shown has
 * a title naming the work**.
 *
 * **What it writes.** One file, `evals/results/citations-influence/dig-<n>-<slug>.json`,
 * and never over one that is there. It stores nothing else in the database: no
 * investigation, no find. Its one database write is the `ai_calls` row each
 * call records, under `withLedger` (docs/project/cost-tracking.md).
 *
 * **What it leaves out of a press**: the quick check, the paper read and the
 * streamed answer (none feeds the influence call), and the search of the
 * reader's other articles (the influence call is not shown it). The row is
 * read once, so there is no second read to disagree with the first.
 *
 * A work is named by its id (`spya-…`) or by words from its title, matched
 * without case; words that match no row or more than one stop the run before
 * anything is spent.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import type { CitedWork } from "../src/types.js";

const OUT = path.join(import.meta.dirname, "results", "citations-influence");

interface PageSeen {
  host: string;
  hasTitle: boolean;
  /** `pageIsAboutWork`: could this page be a kept source? */
  titleNamesWork: boolean;
  extractChars: number;
}

interface WorkResult {
  id: string;
  title: string;
  authors: string | null;
  year: string | null;
  /** The list's own influence, or null when the list says unknown. */
  listInfluence: number | null;
  searches: number;
  pages: PageSeen[];
  /** null when no call was made, or the answer could not be read. */
  rawAnswer: { influence: number | null; source: number | null; quote: string | null } | null;
  /** The answer's text when it could not be read as the three fields. */
  unreadable?: string;
  kept: boolean;
  /** Why nothing was kept: an `InfluenceNone`, or `search-failed`. */
  why?: string;
  keptValue?: number;
  keptQuote?: string;
  keptHost?: string;
  ms: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "(not a URL)";
  }
}

/** The one row a name picks: an exact id, else the rows whose title contains the words. */
export function pickWork(works: readonly CitedWork[], name: string): CitedWork {
  const byId = works.find((w) => w.id === name);
  if (byId) return byId;
  const want = name.toLowerCase();
  const hits = works.filter((w) => w.title.toLowerCase().includes(want));
  if (hits.length === 1 && hits[0]) return hits[0];
  throw new Error(
    hits.length === 0
      ? `no cited work has the id or title words "${name}"`
      : `"${name}" matches ${hits.length} works: ${hits.map((w) => `${w.id} ${w.title}`).join("; ")}`,
  );
}

async function run(n: number, slug: string, names: string[]): Promise<void> {
  loadEnvLocal();
  const out = path.join(OUT, `dig-${n}-${slug}.json`);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);

  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const store = await import("../src/store/index.js");
  const { closeDb } = await import("../src/db/client.js");
  const { openRouterJson } = await import("../src/ai-call.js");
  const { DIG_DEEPER_MODEL, searchFirst } = await import("../src/dig-deeper.js");
  const { investigateContext } = await import("../src/citation-investigate-context.js");
  const { digSubject } = await import("../src/citation-investigate.js");
  const influence = await import("../src/citation-influence.js");
  const { withLedger } = await import("../src/cli-ledger.js");

  const results: WorkResult[] = [];
  /* The ledger closes, and its writes land, before `closeDb` below. */
  await withLedger("eval", () => runAsOwner(environmentOwnerId(), async () => {
    const article = await store.loadArticle(slug);
    const { bibliography } = await store.loadBibliography(slug);
    /* Every name resolved before the first paid call. */
    const works = names.map((name) => pickWork(bibliography.citations, name));
    const text = new Map(article.blocks.map((b) => [b.id as string, b.text]));

    for (const work of works) {
      const started = Date.now();
      const context = investigateContext(work, (id) => text.get(id));
      const about = { title: context.title, authors: context.authors, year: context.year };
      const base = {
        id: work.id,
        title: work.title,
        authors: work.authors ?? null,
        year: work.year ?? null,
        listInfluence: work.influence ?? null,
      };
      console.log(`${work.id} ${work.title}`);
      let findings: Awaited<ReturnType<typeof searchFirst>>;
      try {
        findings = await searchFirst({
          slug,
          subject: digSubject(context),
          article: { title: article.meta.title, author: article.meta.byline, date: article.meta.publishedAt },
          context: context.passages[0],
        });
      } catch (err) {
        console.log(`  the search failed: ${err instanceof Error ? err.message : String(err)}`);
        results.push({ ...base, searches: 0, pages: [], rawAnswer: null, kept: false, why: "search-failed", ms: Date.now() - started });
        continue;
      }
      const pages = influence.influencePages(findings.sources);
      const seen: PageSeen[] = pages.map((p) => ({
        host: hostOf(p.url),
        hasTitle: !!p.title,
        titleNamesWork: influence.pageIsAboutWork(p, about),
        extractChars: (p.excerpt ?? "").length,
      }));
      const record: WorkResult = { ...base, searches: findings.searches, pages: seen, rawAnswer: null, kept: false, ms: 0 };
      if (!seen.some((p) => p.titleNamesWork)) {
        record.why = "no-page-about-work";
      } else {
        try {
          const call = await openRouterJson("citation-influence", influence.citationInfluenceRequest(pages, about, DIG_DEEPER_MODEL), {
            signal: AbortSignal.timeout(influence.INFLUENCE_TIMEOUT_MS),
          });
          const claim = influence.readInfluenceAnswer(call.json);
          if (!claim) {
            record.why = "unreadable";
            record.unreadable = JSON.stringify(call.json).slice(0, 2000);
          } else {
            record.rawAnswer = claim;
            const checked = influence.keepInfluence(claim, pages, about);
            if (checked.kept) {
              record.kept = true;
              record.keptValue = checked.kept.value;
              record.keptQuote = checked.kept.quote;
              record.keptHost = hostOf(checked.kept.sourceUrl);
            } else {
              record.why = checked.why;
            }
          }
        } catch (err) {
          record.why = `call-failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      record.ms = Date.now() - started;
      results.push(record);
      console.log(
        `  ${seen.length} pages, ${seen.filter((p) => p.titleNamesWork).length} about the work; ` +
          (record.kept ? `kept ${record.keptValue} from ${record.keptHost}` : `nothing kept: ${record.why}`),
      );
    }
  }));
  await closeDb();

  fs.mkdirSync(OUT, { recursive: true });
  const kept = results.filter((r) => r.kept).length;
  const record = {
    slug,
    run: n,
    influenceVersion: influence.INFLUENCE_VERSION,
    model: DIG_DEEPER_MODEL,
    at: new Date().toISOString(),
    kept,
    asked: results.length,
    works: results,
  };
  /* `wx`: a file that arrived since the check above is still not overwritten. */
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${kept} of ${results.length} kept`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const n = Number(args.find((a) => a.startsWith("--run="))?.slice("--run=".length));
  const [slug, ...names] = args.filter((a) => !a.startsWith("--"));
  if (!Number.isInteger(n) || n < 1 || !slug || names.length === 0) {
    throw new Error("usage: bibliography-influence-dig.ts --run=<n> <slug> <work id or title words> [more …]   (PAID: about 1–4¢ a work)");
  }
  await run(n, slug, names);
}

if (isMain(import.meta.url)) await main();
