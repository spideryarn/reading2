/**
 * **Stage 1 follows the pages**: when a fetched web page is only the first
 * page of its piece, ask the judge (src/multi-page.ts) which of its own links
 * carry the rest, and fetch them. Report spya-qkyukr; plan
 * docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md §
 * Stage 1.
 *
 * The fetch step (src/pipeline.ts § `STEPS.fetch`) calls this for fetched HTML
 * that is neither a paper source nor converted, and stores what comes back as
 * `RawManifest.parts`. Nothing here writes anything.
 *
 * **What it may fetch.** Only the links the judge named by id, which are page
 * 1's own links on page 1's own site (`pageLinks`), at most
 * `MAX_CONTINUATION_PAGES` of them, each through the step's own fetcher — so
 * the scheme allow-list, the address guard and its DNS pinning, the redirect
 * limit and the byte cap of src/fetch.ts all apply — and each held to
 * `sameSite` again after its redirects.
 *
 * **What it may cost.** One cheap call; then, one page at a time, at most
 * `MAX_PARTS_BYTES` across every further page, **reserved before each fetch**:
 * each fetch is capped at what is left, so the total cannot pass it (GPT Sol's
 * plan review, F6), and at most `FOLLOW_BUDGET_MS` of wall clock, after which
 * the pages held so far are kept. One at a time rather than four at once,
 * because reserving a share of the budget for each of four fetches would cap
 * the first at a quarter of it; the pages are a few hundred kilobytes each and
 * a fetch is usually under a second.
 *
 * **What it never does is fail the import.** A judge that times out, refuses or
 * answers nonsense, and a page that fails, leaves the site, is not HTML or is a
 * page already held: page 1 is imported as it always was, with whatever pages
 * did arrive. Only the job's own signal stops it, and that is rethrown.
 */
import { ChallengePage, readArticle } from "./extract.js";
import { FetchFailure, type FetchedDocument, type FetchedHtml } from "./fetch.js";
import { judgeInput, judgeMultiPage, type MultiPageGateway, type MultiPageVerdict, pageKey, sameSite } from "./multi-page.js";

/** Every further page together, as the network sent them. Under the 50 MiB a bucket object may be; the largest page measured was 2.2 MB. */
export const MAX_PARTS_BYTES = 30 * 1024 * 1024;
/** How long the further pages may take between them. Inside the fetch step's 360 s (src/jobs.ts § `STEP_BUDGET_MS`). */
export const FOLLOW_BUDGET_MS = 120_000;

/** How the fetch step fetches: `fetchDocument` (src/fetch.ts), with the byte cap this reserves. */
export type PageFetcher = (
  url: string,
  options: { signal: AbortSignal; maxBytes: number; onBytesRead?: (bytes: number) => void },
) => Promise<FetchedDocument>;

/** Why a page the judge picked was not kept. Counted for the log, never written to the article. */
export type SkipReason = "failed" | "not-html" | "off-site" | "duplicate" | "budget" | "out-of-time";

export type Followed =
  /** No call: a bot check, no article, or no link to another page of the site. */
  | { judged: "not-asked" }
  /** The call failed. `error` is the error's class name, never its message. */
  | { judged: "failed"; error: string }
  /** The judge said the page is the whole piece. */
  | { judged: "single" }
  /** It continues: `picked` pages named, `pages` of them kept, in the judge's order. */
  | { judged: "continues"; picked: number; pages: FetchedHtml[]; skipped: Partial<Record<SkipReason, number>> };

export interface FollowDeps {
  signal: AbortSignal;
  fetchDocument: PageFetcher;
  /** The judge's gateway; absent, the real one. */
  gateway?: MultiPageGateway;
  /** For a test. Absent, `MAX_PARTS_BYTES`. */
  budgetBytes?: number;
  /** For a test. Absent, `FOLLOW_BUDGET_MS`. */
  budgetMs?: number;
  /** For a test. Absent, the judge's `TIMEOUT_MS`. */
  judgeTimeoutMs?: number;
}

/** The job was told to stop: rethrow, whatever we were in the middle of. */
function stopIfAsked(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

/**
 * **Ask, then fetch what was picked.** `page1` is the document as it arrived;
 * its `url` is where its fetch ended, which is the base its links were read
 * against and the site every further page must stay on.
 */
export async function followPages(page1: FetchedHtml, deps: FollowDeps): Promise<Followed> {
  /* `readArticle`, the exact call the eval measured (Sol F7), and `judgeInput`,
     the one way both build what the judge is shown. Stage 2 runs it again. */
  const read = readArticle(page1.text, page1.url);
  if (read.refusal instanceof ChallengePage || read.article === null) return { judged: "not-asked" };
  const { page, links } = judgeInput(page1.text, page1.url, read.article);
  if (links.length === 0) return { judged: "not-asked" };

  let verdict: MultiPageVerdict;
  try {
    verdict = await judgeMultiPage(page, links, {
      signal: deps.signal,
      ...(deps.gateway ? { gateway: deps.gateway } : {}),
      ...(deps.judgeTimeoutMs === undefined ? {} : { timeoutMs: deps.judgeTimeoutMs }),
    });
  } catch (err) {
    stopIfAsked(deps.signal);
    return { judged: "failed", error: err instanceof Error ? err.name : typeof err };
  }
  if (!verdict.continues) return { judged: "single" };

  const deadline = AbortSignal.timeout(deps.budgetMs ?? FOLLOW_BUDGET_MS);
  const run: Run = {
    deps,
    site: new URL(page1.url),
    held: new Set([pageKey(new URL(page1.url))]),
    budget: deps.budgetBytes ?? MAX_PARTS_BYTES,
    used: 0,
    deadline,
    signal: AbortSignal.any([deps.signal, deadline]),
  };
  const pages: FetchedHtml[] = [];
  const skipped: Partial<Record<SkipReason, number>> = {};
  for (const link of verdict.pages) {
    const got = await fetchOne(run, link.url);
    if ("skip" in got) skipped[got.skip] = (skipped[got.skip] ?? 0) + 1;
    else pages.push(got.kept);
  }
  return { judged: "continues", picked: verdict.pages.length, pages, skipped };
}

/** One follow's state: the site, what is held, and the budget spent so far. */
interface Run {
  deps: FollowDeps;
  site: URL;
  /** `pageKey`s of page 1 and of every page kept. */
  held: Set<string>;
  budget: number;
  used: number;
  deadline: AbortSignal;
  /** The job's signal or the deadline, whichever fires first. */
  signal: AbortSignal;
}

/** **One picked page**: fetched within what is left of the budget, and kept only if it is still this site's HTML and new. */
async function fetchOne(run: Run, url: string): Promise<{ kept: FetchedHtml } | { skip: SkipReason }> {
  stopIfAsked(run.deps.signal);
  if (run.deadline.aborted) return { skip: "out-of-time" };
  /* **Reserved before the fetch**: this fetch may bring at most what is left. */
  const left = run.budget - run.used;
  if (left < 1) return { skip: "budget" };
  let doc: FetchedDocument;
  let accounted = 0;
  try {
    doc = await run.deps.fetchDocument(url, {
      signal: run.signal,
      maxBytes: left,
      onBytesRead: (bytes) => {
        accounted += bytes;
        run.used = Math.min(run.budget, run.used + bytes);
        /* `fetchDocument` may retry. Its per-attempt cap is not an aggregate
           cap, so stop the logical fetch if earlier failed attempts plus this
           chunk have spent the reservation. */
        if (accounted > left) throw new FetchFailure("too-large", url, "The continuation-page byte budget was spent.");
      },
    });
  } catch (err) {
    stopIfAsked(run.deps.signal);
    /* A page over what was left spent it: it was read up to the cap. */
    if (err instanceof FetchFailure && err.code === "too-large") run.used = run.budget;
    return { skip: run.deadline.aborted ? "out-of-time" : "failed" };
  }
  /* Counted whether it is kept or not: it was downloaded. A fetcher that
     handed back more than it was allowed has spent the lot, and the page is not
     kept, so the total held can never pass the budget. */
  if (doc.bytes.byteLength > left || accounted > left) {
    run.used = run.budget;
    return { skip: "budget" };
  }
  /* Injected test fetchers need not implement the byte observer. Production's
     fetchDocument does, including for failed attempts; fill only the gap. */
  run.used = Math.min(run.budget, run.used + Math.max(0, doc.bytes.byteLength - accounted));
  if (doc.kind !== "html") return { skip: "not-html" };
  const final = URL.canParse(doc.url) ? new URL(doc.url) : null;
  /* **After its redirects**, and against page 1's own final address. */
  if (final === null || !sameSite(run.site, final)) return { skip: "off-site" };
  const key = pageKey(final);
  if (run.held.has(key)) return { skip: "duplicate" };
  run.held.add(key);
  return { kept: doc };
}

/**
 * What the fetch step adds to its detail: *"4 pages"*, or *"3 of 4 pages"*
 * when some of those the judge picked were not kept. Counts page 1. `null` for
 * a single page, which says nothing it never said.
 */
export function pagesDetail(followed: Followed): string | null {
  if (followed.judged !== "continues") return null;
  const picked = followed.picked + 1;
  const kept = followed.pages.length + 1;
  return kept === picked ? `${picked} pages` : `${kept} of ${picked} pages`;
}
