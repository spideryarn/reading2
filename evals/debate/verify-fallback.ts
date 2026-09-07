/**
 * **Would fetching the whole page have rescued the rows the search extract lost?**
 *
 * The two-curl experiment of
 * [260906b](../../docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md)
 * § *The two-curl experiment, on the path Stage F would ship*, and the tool that
 * decides whether Stage F gets built at all.
 *
 * Production verifies a row's quotation against the **search engine's page
 * extract** — a 236–4,945 character slice on the one live run we have, not the
 * page. On that run it emptied group one entirely. Two opposite repairs follow
 * from the two possible answers:
 *
 * - the quotations *are* in the full page ⇒ the extract is the constraint, and a
 *   verification fallback (Stage F) fixes it;
 * - they are *not* ⇒ the model paraphrased, and the repair is in the prompt.
 *
 * So this has to be trustworthy rather than encouraging, and almost every rule
 * below is about not flattering the answer.
 *
 * ## Three haystacks, deliberately, and the fourth that is only a diagnostic
 *
 * Every quotation the model reported in the **direct** pass — from the rows
 * production kept *and* the rows it dropped — is looked for in:
 *
 * 1. **the provider extract**, rebuilt from the journalled raw annotations by
 *    `admissibleSources`, which is exactly what production checks today;
 * 2. **Readability's text** — `fetchDocument` → JSDOM → Readability →
 *    `textContent`, the path `src/chat-tools.ts` § `read_web_page` already uses;
 * 3. **the whole document's visible text** — the same markup, with `script`,
 *    `style` and `noscript` removed, read as `body.textContent` (which excludes
 *    comment nodes by specification).
 *
 * **Both 2 and 3, not one.** Readability extracts *the article* and can discard
 * the very section a quotation lives in — a comment thread, an editor's note, a
 * sidebar rebuttal. Whole-body text catches those and also drags in navigation
 * and boilerplate, which is a false-positive risk of its own. Which one Stage F
 * should use is a real design choice, so both are measured and the numbers
 * decide.
 *
 * **The diagnostic fourth.** `textContent` concatenates block elements with no
 * separator, so `<p>…the end.</p><p>Next…</p>` reads as `the end.Next` and a
 * quotation that straddles that join misses in **both** of the haystacks above.
 * A false zero here would defer Stage F for a DOM artefact, so a block-separated
 * copy of the body text is measured too — reported on its own line, labelled a
 * diagnostic, and **never counted in the headline**.
 *
 * ## `findQuote`, one matcher, one mode
 *
 * Every lookup is `findQuote(haystack, quote, undefined, "spaced")` — the same
 * matcher and the same mode `locate` (src/debate.ts) uses in production — so the
 * comparison is about the haystack and nothing else.
 *
 * The one production rule applied *before* the matcher is
 * `isSubstantiveQuote`'s floor, because production applies it too: a quotation
 * below it is dropped whatever any haystack says, so counting it as a
 * recoverable failure would be counting a row Stage F could not save. Those are
 * classed `belowFloor` and kept out of the denominator, with their count printed.
 *
 * ## The safety rules, which are not optional (Sol's F44)
 *
 * Fetching goes through [`fetchDocument`](../../src/fetch.ts) and never a bare
 * `fetch`, so every check it makes still applies — HTTP(S) only, the
 * private-address and DNS-pinning guards on **every** redirect, the redirect
 * cap, the byte cap, the type sniff and the deadline. On top of that this file
 * adds a whole-run budget: concurrency, a fetch count, total bytes and elapsed
 * time.
 *
 * **Fetched text is a verification haystack and never enters a model prompt.**
 * Nothing here calls a model at all.
 *
 * **A PDF is `unsupported`, never an empty page.** `FetchedDocument.text` is
 * `null` for a PDF, and reading that as `""` would report *"the quote is not
 * there"* about a document nobody looked in — the exact shape
 * [silent-success.md](../../docs/reusable/silent-success.md) is about.
 *
 * ## What may be printed
 *
 * Hosts, never full URLs (docs/project/logging.md). Never a page extract, never
 * an article's or a stranger's prose. A quotation is identified by a sha256
 * prefix and a character count, which is enough to line two runs up and carries
 * none of the words.
 */
import { Readability } from "@mozilla/readability";

import {
  admissibleSources,
  type ArticleIdentity,
  type ChatAnnotation,
  isSubstantiveQuote,
  parsePass,
} from "../../src/debate.js";
import type {
  DebateAttemptStarted,
  DebateJournalEvent,
  DebateProviderResponse,
} from "../../src/debate-journal.js";
import { sha256Of } from "../../src/debate-journal.js";
import { FetchFailure, type FetchedDocument, fetchDocument, type FetchOptions } from "../../src/fetch.js";
import { jsdom } from "../../src/jsdom-lazy.js";
import { findQuote } from "../../src/quote-match.js";
import { hostOf } from "../../src/urls.js";

/* ------------------------------------------------------------------ *
 * What a fetch turned into
 * ------------------------------------------------------------------ */

/**
 * **Every way a fetch can end, named** — because a URL that could not be fetched
 * must never be counted as "not recovered". A network problem that reads as
 * evidence about the model is the one way this tool could mislead in the
 * expensive direction.
 *
 * Only `ok` produces haystacks. Everything else lands in the `not attempted`
 * column of the headline, in its own right.
 */
export type FetchOutcome =
  /** HTML came back and was decoded. The only outcome with haystacks. */
  | "ok"
  /** A PDF, a `text: null`, or a type `fetchDocument` refuses. **Never an empty page.** */
  | "unsupported"
  /** Refused before or by the far end: a private address, a scheme, a 401/403, a 429. */
  | "blocked"
  /** The deadline fired. */
  | "timed-out"
  /** Over the byte cap. */
  | "too-big"
  /** A 404. */
  | "not-found"
  /** DNS, connection, TLS, a 5xx, a redirect loop, an empty body — everything else. */
  | "failed"
  /** The whole-run budget ran out before this URL's turn. Not a fact about the page. */
  | "budget-exhausted";

/** One page, as much of it as a verification needs. Prose never leaves this object. */
export interface PageText {
  outcome: FetchOutcome;
  /** The `FetchFailureCode` or a short authored reason. Never a URL, never page text. */
  detail: string;
  host: string;
  /** Where we ended up, host only. `null` unless something came back. */
  finalHost: string | null;
  /** Readability's `textContent`. `null` when the fetch failed or Readability found nothing. */
  readability: string | null;
  /** `body.textContent` with `script`/`style`/`noscript` gone. `null` unless `ok`. */
  wholeBody: string | null;
  /** **Diagnostic only.** The same, with block boundaries separated. `null` unless `ok`. */
  spacedBody: string | null;
  bytes: number;
}

/* ------------------------------------------------------------------ *
 * HTML to visible text
 * ------------------------------------------------------------------ */

/**
 * Elements whose text is markup rather than prose.
 *
 * `template` is here as well as the three the brief names: its content is inert
 * by definition, and a page that ships a client-side template of the very
 * article would otherwise supply the quotation twice.
 */
const NOT_PROSE = "script, style, noscript, template";

/**
 * Where `textContent` needs a separator invented, for the diagnostic haystack.
 *
 * Not exhaustive and does not need to be: it exists to tell "the model quoted
 * across a paragraph break" from "the page does not say this", and any list that
 * covers paragraphs, headings, list items and table cells does that.
 */
const BLOCKISH =
  "p, div, br, hr, li, ul, ol, h1, h2, h3, h4, h5, h6, tr, td, th, blockquote, section, article, aside, header, footer, nav, main, pre, figure, figcaption, dl, dd, dt, table";

/** The three text views of one HTML document. */
export interface VisibleText {
  /** Readability's own `textContent`, or `null` when it extracted nothing. */
  readability: string | null;
  wholeBody: string;
  /** **Diagnostic.** `wholeBody` with a newline at every block boundary. */
  spacedBody: string;
}

/**
 * Turn markup into the text a reader sees, three ways.
 *
 * **Two JSDOM parses of the same string, deliberately.** `Readability.parse()`
 * mutates the document it is given — it strips, rewrites and reparents — so a
 * whole-body read taken afterwards would be reading Readability's leftovers and
 * quietly agreeing with it. That is exactly the disagreement this function
 * exists to measure.
 *
 * `url` is the base relative links resolve against and is what Readability wants;
 * it is never fetched from here.
 */
export function visibleText(html: string, url: string): VisibleText {
  const { JSDOM } = jsdom();

  const forReadability = new JSDOM(html, { url });
  const parsed = new Readability(forReadability.window.document).parse();
  const readable = parsed?.textContent?.trim();

  const forBody = new JSDOM(html, { url });
  const doc = forBody.window.document;
  for (const el of doc.querySelectorAll(NOT_PROSE)) el.remove();
  /* Comment nodes need no removal: `Node.textContent` on an Element is the
     concatenation of its descendant **Text** nodes, so a comment is already
     invisible to it. `tests/debate-verify-fallback.test.ts` pins that rather
     than trusting the sentence. */
  const root = doc.body ?? doc.documentElement;
  const wholeBody = root.textContent ?? "";

  for (const el of doc.querySelectorAll(BLOCKISH)) {
    el.before(doc.createTextNode("\n"));
    el.after(doc.createTextNode("\n"));
  }
  const spacedBody = root.textContent ?? "";

  return { readability: readable && readable !== "" ? readable : null, wholeBody, spacedBody };
}

/* ------------------------------------------------------------------ *
 * The budget
 * ------------------------------------------------------------------ */

/**
 * The whole-run ceiling, on top of every per-request check `fetchDocument`
 * already makes.
 *
 * F44's caps are **12 per pass and 24 per run**. This tool reads one journal,
 * which may hold several passes, so `maxFetches` is the run figure and a bigger
 * journal simply stops early and says so — `budget-exhausted` is a named
 * outcome, not a silent truncation.
 */
export interface VerifyBudget {
  concurrency: number;
  /** Distinct URLs fetched, over the whole run. */
  maxFetches: number;
  /** Bytes summed across every fetch that returned any. */
  maxBytesTotal: number;
  /** Wall clock for the fetching phase. */
  maxElapsedMs: number;
  /** Handed to `fetchDocument` per request. */
  perFetchMaxBytes: number;
  perFetchTimeoutMs: number;
}

export const DEFAULT_BUDGET: VerifyBudget = {
  concurrency: 3,
  maxFetches: 24,
  maxBytesTotal: 48 * 1024 * 1024,
  maxElapsedMs: 5 * 60_000,
  /* The same cap `read_web_page` sets, and for the same reason: nothing here is
     being kept, it is being read once and thrown away. */
  perFetchMaxBytes: 4 * 1024 * 1024,
  perFetchTimeoutMs: 20_000,
};

/** A `FetchFailureCode`, or an unclassified throw, as one of the named outcomes. */
export function outcomeOf(err: unknown): { outcome: FetchOutcome; detail: string } {
  if (!(err instanceof FetchFailure)) return { outcome: "failed", detail: "unclassified" };
  switch (err.code) {
    case "unsupported-type":
      return { outcome: "unsupported", detail: err.code };
    case "blocked-address":
    case "unsupported-scheme":
    case "unauthorized":
    case "forbidden":
    case "rate-limited":
      return { outcome: "blocked", detail: err.code };
    case "timeout":
      return { outcome: "timed-out", detail: err.code };
    case "too-large":
      return { outcome: "too-big", detail: err.code };
    case "not-found":
      return { outcome: "not-found", detail: err.code };
    default:
      return { outcome: "failed", detail: err.code };
  }
}

/**
 * Fetch every URL once, under the budget, and turn each into haystacks.
 *
 * **One fetch per distinct URL**, because several rows routinely cite the same
 * page and a second request would buy nothing but somebody else's bandwidth.
 *
 * The budget is checked *before* each fetch is dispatched rather than after, so
 * exhaustion cannot bill a request it then refuses to count.
 */
export async function fetchPages(
  urls: readonly string[],
  opts: { budget?: Partial<VerifyBudget>; fetchOptions?: FetchOptions; now?: () => number } = {},
): Promise<Map<string, PageText>> {
  const budget: VerifyBudget = { ...DEFAULT_BUDGET, ...opts.budget };
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const pages = new Map<string, PageText>();
  const queue = [...new Set(urls)];

  let dispatched = 0;
  let bytes = 0;
  let cursor = 0;

  const exhausted = (): string | null => {
    if (dispatched >= budget.maxFetches) return `the run's ${String(budget.maxFetches)}-fetch cap`;
    if (bytes >= budget.maxBytesTotal) return "the run's byte budget";
    if (now() - startedAt >= budget.maxElapsedMs) return "the run's time budget";
    return null;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const url = queue[index];
      if (url === undefined) return;
      const host = hostOf(url) || "(unparseable host)";

      const why = exhausted();
      if (why !== null) {
        pages.set(url, blankPage("budget-exhausted", why, host));
        continue;
      }
      dispatched += 1;

      let doc: FetchedDocument;
      try {
        doc = await fetchDocument(url, {
          ...opts.fetchOptions,
          /* **After the caller's options, not before.** `fetchOptions` is a test
             seam for `fetchImpl` and `resolve`; putting it last would let a
             caller raise this tool's own ceilings by accident. */
          timeoutMs: budget.perFetchTimeoutMs,
          maxBytes: budget.perFetchMaxBytes,
          /* One try. A retry here would double the load on a stranger's server
             to answer a question a second sample cannot change. */
          attempts: 1,
        });
      } catch (err) {
        const { outcome, detail } = outcomeOf(err);
        pages.set(url, blankPage(outcome, detail, host));
        continue;
      }

      bytes += doc.bytes.byteLength;
      const finalHost = hostOf(doc.url) || null;

      /* **The rule that must not be softened.** A PDF has no `text`, and reading
         its absence as an empty string would answer "the quotation is not on
         this page" about a document nothing looked inside. */
      if (doc.kind === "pdf" || doc.text === null) {
        pages.set(url, {
          ...blankPage("unsupported", `served a ${doc.kind.toUpperCase()}`, host),
          finalHost,
          bytes: doc.bytes.byteLength,
        });
        continue;
      }

      const text = visibleText(doc.text, doc.url);
      pages.set(url, {
        outcome: "ok",
        detail: text.readability === null ? "Readability extracted nothing" : "read",
        host,
        finalHost,
        readability: text.readability,
        wholeBody: text.wholeBody,
        spacedBody: text.spacedBody,
        bytes: doc.bytes.byteLength,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(budget.concurrency, queue.length || 1)) }, () => worker()),
  );
  return pages;
}

function blankPage(outcome: FetchOutcome, detail: string, host: string): PageText {
  return {
    outcome,
    detail,
    host,
    finalHost: null,
    readability: null,
    wholeBody: null,
    spacedBody: null,
    bytes: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Classifying one quotation
 * ------------------------------------------------------------------ */

/**
 * What the **provider extract** — the thing production checks — had to say
 * about one quotation.
 *
 * `missingFromExtract` is the only class that is an *observed failure*, and the
 * two above it are excluded from the denominator for opposite reasons:
 * `belowFloor` is a row production drops whatever a page says, so no fallback
 * could rescue it; `noExtract` had nothing to check against, so the row died of
 * something else (`uncited`, or `selfSource`) and never reached this rule.
 */
export type QuoteClass = "belowFloor" | "noExtract" | "inExtract" | "missingFromExtract";

/** Where a quotation turned up, once the page was fetched. */
export interface PageVerdict {
  outcome: FetchOutcome;
  inReadability: boolean;
  inWholeBody: boolean;
  /** **Diagnostic only** — never in the headline. See the header. */
  inSpacedBody: boolean;
  /** `ok` **and** found in one of the two real haystacks. */
  recovered: boolean;
}

/** One quotation, checked. Carries a handle to the words and never the words. */
export interface QuotationCheck {
  attemptId: string;
  /** Index in the model's own reported list, so a row can be found again in the journal. */
  rowIndex: number;
  field: "sourceQuote" | "articleReferenceQuote";
  host: string;
  /** Held for fetching. **Never printed** — the reports use `host`. */
  url: string;
  chars: number;
  /** sha256 prefix of the quotation. A handle for lining two runs up. */
  digest: string;
  klass: QuoteClass;
  /** Present only for `missingFromExtract`. */
  page: PageVerdict | null;
}

/** Present in this haystack, by production's matcher in production's mode. */
export function present(haystack: string | null, quote: string): boolean {
  if (haystack === null || haystack === "") return false;
  return findQuote(haystack, quote, undefined, "spaced") !== null;
}

/* ------------------------------------------------------------------ *
 * Reading a journal
 * ------------------------------------------------------------------ */

/** One quotation a direct-pass row reported, before any haystack was consulted. */
interface ReportedQuote {
  attemptId: string;
  rowIndex: number;
  field: "sourceQuote" | "articleReferenceQuote";
  url: string;
  quote: string;
  /** The provider extract for this row's URL, or `null` when the URL was not admissible. */
  extract: string | null;
}

/** What an attempt contributed, or why it contributed nothing. */
export interface AttemptSummary {
  attemptId: string;
  pass: "direct" | "claims";
  /** `null` when the attempt was read; a sentence when it was not. */
  skipped: string | null;
  reportedRows: number;
  quotations: number;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Every quotation the **direct** pass reported, with the extract production
 * would have checked it against.
 *
 * Direct-pass only, because that is the group the live run emptied and the
 * question is about. Claims-pass attempts are listed as `skipped` with that
 * reason in words, so nobody reads the denominator as covering the whole run.
 *
 * **Every row the model reported, including ones production never examined.**
 * `readDirectGroup` stops at `MAX_DIRECT_ROWS`, so a thirteenth row is
 * `omittedOverCap` in production and is read here all the same — the question is
 * what the model wrote down, not what survived the cap.
 */
export function reportedQuotes(events: readonly DebateJournalEvent[]): {
  quotes: ReportedQuote[];
  attempts: AttemptSummary[];
} {
  const starts = new Map<string, DebateAttemptStarted>();
  const responses = new Map<string, DebateProviderResponse>();
  const order: string[] = [];
  for (const event of events) {
    if (event.event === "attempt-started") {
      if (!starts.has(event.attemptId)) {
        starts.set(event.attemptId, event);
        order.push(event.attemptId);
      }
    } else if (event.event === "provider-response") {
      if (!responses.has(event.attemptId)) responses.set(event.attemptId, event);
    }
  }

  const quotes: ReportedQuote[] = [];
  const attempts: AttemptSummary[] = [];

  for (const attemptId of order) {
    const start = starts.get(attemptId);
    if (!start) continue;
    const summary: AttemptSummary = {
      attemptId,
      pass: start.pass,
      skipped: null,
      reportedRows: 0,
      quotations: 0,
    };
    attempts.push(summary);

    const read = readOneAttempt(start, responses.get(attemptId));
    if (read.skipped !== null) {
      summary.skipped = read.skipped;
      continue;
    }
    summary.reportedRows = read.reportedRows;
    summary.quotations = read.quotes.length;
    quotes.push(...read.quotes);
  }

  return { quotes, attempts };
}

/** One attempt's quotations, or the sentence saying why it has none. */
function readOneAttempt(
  start: DebateAttemptStarted,
  response: DebateProviderResponse | undefined,
): { quotes: ReportedQuote[]; reportedRows: number; skipped: string | null } {
  const none = (skipped: string) => ({ quotes: [], reportedRows: 0, skipped });

  if (start.pass !== "direct") {
    return none("not a direct pass — this tool answers a question about group one only");
  }
  if (!response) return none("the attempt has no provider-response — it never heard back");
  if (response.response.kind === "refused") {
    return none(`the provider refused with ${String(response.response.status)} — there is no answer to read`);
  }
  if (response.response.json === null) {
    return none("the body was not JSON and the bytes are not in the journal");
  }

  const answer = response.response.json as {
    choices?: { message?: { content?: string; annotations?: ChatAnnotation[] } }[];
  };
  const choice = answer.choices?.[0];
  if (!choice) return none("the answer carried no choices");

  const identity: ArticleIdentity = {
    url: start.article.url,
    title: start.article.title,
    byline: start.article.byline,
  };
  const admissible = admissibleSources(choice.message?.annotations, identity.url);

  let rows: unknown[];
  try {
    rows = parsePass(choice.message?.content ?? "");
  } catch {
    /* The thrown message is not carried out: the fence it failed on is a
       stranger's page and the article, and this is a file somebody reads. */
    return none("the answer's fence would not parse");
  }

  const quotes: ReportedQuote[] = [];
  for (const [rowIndex, item] of rows.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const url = str(row.url);
    if (url === "") continue;
    const evidence = admissible.get(url);
    const extract = evidence ? (evidence.excerpt ?? null) : null;
    for (const field of ["sourceQuote", "articleReferenceQuote"] as const) {
      const quote = str(row[field]);
      if (quote === "") continue;
      quotes.push({ attemptId: start.attemptId, rowIndex, field, url, quote, extract });
    }
  }
  return { quotes, reportedRows: rows.length, skipped: null };
}

/* ------------------------------------------------------------------ *
 * The whole job
 * ------------------------------------------------------------------ */

/** The counts a report is made of. Every one of them is a denominator somebody could misread. */
export interface VerifySummary {
  /** Every quotation the direct pass reported. */
  quotations: number;
  /** Below `isSubstantiveQuote`'s floor. Production drops these whatever a page says. */
  belowFloor: number;
  /** The row's URL was not among this pass's admissible sources — there was no extract. */
  noExtract: number;
  /** Found in the provider extract. Production keeps these already. */
  inExtract: number;
  /** **Y** — quotations that miss in the provider extract and had an extract to miss in. */
  observedFailures: number;
  /** **X** — of those, found in Readability's text or the whole body. */
  recovered: number;
  /** Fetched fine, present in neither. The paraphrase reading. */
  notRecovered: number;
  /** The page could not be fetched. **Never counted as not recovered.** */
  notAttempted: number;
  /** Of the recovered: which haystack found them. */
  byReadability: number;
  byWholeBody: number;
  byBoth: number;
  readabilityOnly: number;
  wholeBodyOnly: number;
  /** **Diagnostic** — found only once block boundaries were separated. Not in `recovered`. */
  spacedBodyOnly: number;
  /** One count per fetch outcome, over distinct URLs. */
  outcomes: Record<FetchOutcome, number>;
}

export interface VerifyReport {
  attempts: AttemptSummary[];
  checks: QuotationCheck[];
  /** One entry per distinct URL fetched. Host only. */
  pages: { host: string; finalHost: string | null; outcome: FetchOutcome; detail: string }[];
  summary: VerifySummary;
  budget: VerifyBudget;
}

const EVERY_OUTCOME: FetchOutcome[] = [
  "ok",
  "unsupported",
  "blocked",
  "timed-out",
  "too-big",
  "not-found",
  "failed",
  "budget-exhausted",
];

/**
 * Read a journal, resolve every direct-pass quotation against three haystacks,
 * and say what was recovered.
 *
 * `fetchOptions` is the seam every test uses: `fetchImpl` and `resolve` are
 * `fetchDocument`'s own injection points, so a test drives **the real fetch
 * path** — every guard, every redirect check, the type sniff — with no network
 * behind it. There is deliberately no way to substitute `fetchDocument` itself.
 */
export async function verifyFallback(input: {
  events: readonly DebateJournalEvent[];
  budget?: Partial<VerifyBudget>;
  fetchOptions?: FetchOptions;
  now?: () => number;
}): Promise<VerifyReport> {
  const budget: VerifyBudget = { ...DEFAULT_BUDGET, ...input.budget };
  const { quotes, attempts } = reportedQuotes(input.events);

  /* Classify first, fetch second — so nothing is fetched for a quotation whose
     fate the extract already settled. That is Stage F's own order (F53: the
     extract first, and only a miss invokes the fallback), and it is what keeps
     the fetch count proportionate to the failures rather than to the rows. */
  const staged = quotes.map((q) => ({ q, klass: classify(q) }));
  const needed = staged.filter((s) => s.klass === "missingFromExtract").map((s) => s.q.url);

  const pages = await fetchPages(needed, {
    budget,
    ...(input.fetchOptions ? { fetchOptions: input.fetchOptions } : {}),
    ...(input.now ? { now: input.now } : {}),
  });

  const checks: QuotationCheck[] = staged.map(({ q, klass }) => {
    const base = {
      attemptId: q.attemptId,
      rowIndex: q.rowIndex,
      field: q.field,
      host: hostOf(q.url) || "(unparseable host)",
      url: q.url,
      chars: q.quote.length,
      digest: sha256Of(q.quote).slice(0, 8),
      klass,
    };
    if (klass !== "missingFromExtract") return { ...base, page: null };
    const page = pages.get(q.url);
    if (!page) {
      /* Unreachable: `needed` is built from these same rows. Named rather than
         defaulted, because a silent `recovered: false` here would be a bug in
         this file reported as a fact about the model. */
      return {
        ...base,
        page: { outcome: "failed", inReadability: false, inWholeBody: false, inSpacedBody: false, recovered: false },
      };
    }
    const inReadability = present(page.readability, q.quote);
    const inWholeBody = present(page.wholeBody, q.quote);
    const inSpacedBody = present(page.spacedBody, q.quote);
    return {
      ...base,
      page: {
        outcome: page.outcome,
        inReadability,
        inWholeBody,
        inSpacedBody,
        recovered: page.outcome === "ok" && (inReadability || inWholeBody),
      },
    };
  });

  const outcomes = Object.fromEntries(EVERY_OUTCOME.map((o) => [o, 0])) as Record<FetchOutcome, number>;
  for (const page of pages.values()) outcomes[page.outcome] += 1;

  const failures = checks.filter((c) => c.klass === "missingFromExtract");
  const recoveredChecks = failures.filter((c) => c.page?.recovered === true);
  const summary: VerifySummary = {
    quotations: checks.length,
    belowFloor: checks.filter((c) => c.klass === "belowFloor").length,
    noExtract: checks.filter((c) => c.klass === "noExtract").length,
    inExtract: checks.filter((c) => c.klass === "inExtract").length,
    observedFailures: failures.length,
    recovered: recoveredChecks.length,
    notRecovered: failures.filter((c) => c.page?.outcome === "ok" && !c.page.recovered).length,
    notAttempted: failures.filter((c) => c.page !== null && c.page.outcome !== "ok").length,
    byReadability: recoveredChecks.filter((c) => c.page?.inReadability === true).length,
    byWholeBody: recoveredChecks.filter((c) => c.page?.inWholeBody === true).length,
    byBoth: recoveredChecks.filter((c) => c.page?.inReadability === true && c.page.inWholeBody).length,
    readabilityOnly: recoveredChecks.filter((c) => c.page?.inReadability === true && !c.page.inWholeBody).length,
    wholeBodyOnly: recoveredChecks.filter((c) => c.page?.inWholeBody === true && !c.page.inReadability).length,
    spacedBodyOnly: failures.filter(
      (c) => c.page?.outcome === "ok" && !c.page.recovered && c.page.inSpacedBody,
    ).length,
    outcomes,
  };

  return {
    attempts,
    checks,
    pages: [...pages.values()].map((p) => ({
      host: p.host,
      finalHost: p.finalHost,
      outcome: p.outcome,
      detail: p.detail,
    })),
    summary,
    budget,
  };
}

function classify(q: ReportedQuote): QuoteClass {
  /* Production's own order. `locate` asks `isSubstantiveQuote` before it goes
     near a haystack, so a quotation under the floor never had a chance in the
     extract and would not get one from a fetch either. */
  if (!isSubstantiveQuote(q.quote)) return "belowFloor";
  if (q.extract === null || q.extract === "") return "noExtract";
  return present(q.extract, q.quote) ? "inExtract" : "missingFromExtract";
}

/* ------------------------------------------------------------------ *
 * Saying it
 * ------------------------------------------------------------------ */

/** **The headline, and its wording is fixed.** X of Y, and nothing else on the line. */
export function headline(summary: VerifySummary): string {
  return `recovered ${String(summary.recovered)} of ${String(summary.observedFailures)} observed failures`;
}

/**
 * How to read the headline — **printed, not left in a comment**.
 *
 * Both sentences, every time, because the asymmetry is the whole finding: one
 * recovery is enough to justify Stage F, and zero recoveries is not proof of the
 * opposite. A run that printed only the sentence matching its own result would
 * let a zero be read as a settled negative.
 */
export const HOW_TO_READ = [
  "One recovery establishes that the fallback can fix the observed class.",
  "Zero recoveries defers Stage F and does NOT establish that full-page fetching can never help.",
];

/** The whole report as lines. Hosts, counts and digests — never a URL, never prose. */
export function verifyLines(report: VerifyReport): string[] {
  const s = report.summary;
  const lines: string[] = [];

  lines.push("Attempts");
  if (report.attempts.length === 0) lines.push("  (none — this journal holds no attempt-started line)");
  for (const a of report.attempts) {
    const name = `${a.pass} ${a.attemptId.slice(0, 8)}`.padEnd(24);
    lines.push(
      a.skipped === null
        ? `  ${name} ${String(a.reportedRows)} reported row(s), ${String(a.quotations)} quotation(s)`
        : `  ${name} NOT READ — ${a.skipped}`,
    );
  }

  lines.push("");
  lines.push("Quotations, against the provider extract — what production checks today");
  lines.push(`  ${pad(s.quotations)} reported by the model in the direct pass`);
  lines.push(`  ${pad(s.inExtract)} found in the extract (production keeps these)`);
  lines.push(`  ${pad(s.observedFailures)} MISSING from the extract — the observed failures, Y`);
  lines.push(`  ${pad(s.noExtract)} had no extract to check (the row's URL was not an admissible source)`);
  lines.push(`  ${pad(s.belowFloor)} below the substantive-quote floor (production drops these whatever a page says)`);

  lines.push("");
  lines.push("Pages fetched, by outcome");
  for (const outcome of EVERY_OUTCOME) {
    const n = s.outcomes[outcome];
    if (n > 0) lines.push(`  ${pad(n)} ${outcome}`);
  }
  if (report.pages.length === 0) lines.push("  (nothing needed fetching)");
  for (const p of report.pages) {
    const moved = p.finalHost && p.finalHost !== p.host ? ` → ${p.finalHost}` : "";
    lines.push(`    ${p.host}${moved} — ${p.outcome} (${p.detail})`);
  }

  lines.push("");
  lines.push("The observed failures, resolved against the full page");
  lines.push(`  ${pad(s.recovered)} recovered`);
  lines.push(`  ${pad(s.notRecovered)} not recovered — the page was read and does not contain the words`);
  lines.push(`  ${pad(s.notAttempted)} NOT ATTEMPTED — the page could not be fetched; this is not evidence about the model`);

  lines.push("");
  lines.push("Which haystack found them — the Stage F design choice");
  lines.push(`  ${pad(s.byReadability)} in Readability's text`);
  lines.push(`  ${pad(s.byWholeBody)} in the whole document's visible text`);
  lines.push(`  ${pad(s.byBoth)} in both`);
  lines.push(`  ${pad(s.readabilityOnly)} in Readability only (whole-body text missed it)`);
  lines.push(`  ${pad(s.wholeBodyOnly)} in whole-body text only (Readability discarded that section)`);
  lines.push(
    `  ${pad(s.spacedBodyOnly)} DIAGNOSTIC: found in neither, but found once block boundaries were separated —` +
      " a textContent artefact rather than a paraphrase, and not counted above",
  );

  lines.push("");
  lines.push(headline(s));
  for (const line of HOW_TO_READ) lines.push(`  ${line}`);

  const skipped = report.attempts.filter((a) => a.skipped !== null).length;
  if (skipped > 0) {
    lines.push(
      `  ${String(skipped)} attempt(s) contributed nothing — see above. The denominator is not the whole journal.`,
    );
  }
  return lines;
}

function pad(n: number): string {
  return String(n).padStart(3);
}
