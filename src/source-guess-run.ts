/**
 * **Look for an uploaded paper on the web, once** — the impure half of the
 * guessed web address, `POST /api/source-guess/:slug`.
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § Decisions 2.
 * The judge is src/source-guess.ts and this file only feeds it and stores what
 * it says.
 *
 *   claim → allowance → findWorkPage → readPaperText → isSamePaper → fenced finish
 *
 * - **Free refusals first**: not the owner's (404), not an upload (409),
 *   already answered (the stored answer), somebody else searching (`searching`),
 *   a title that cannot be matched (`none`, settled with no search and no
 *   allowance).
 * - **One deadline** from the claim to the last byte read. The claim goes
 *   stale a margin after it, so a process that died mid-search frees the
 *   article for the next open.
 * - **The answer is written only while our claim still holds**
 *   (`SourceGuessStore.finish`), so a search that outlived its claim cannot
 *   overwrite its successor's answer.
 *
 * ## What never reaches the log
 *
 * The title, the authors, the URL and any text: they are what somebody
 * uploaded. One line per call with the host of a kept page, the outcome, the
 * reason, the search count and the time — citation-find.ts's line.
 */
import type { AiRequestBody, JsonCall } from "./ai-call.js";
import { openRouterJson } from "./ai-call.js";
import { type FoundWorkPage, findWorkPage, hostOfPage, type WorkToFind } from "./citation-find.js";
import { jsdom } from "./jsdom-lazy.js";
import { errorFields, log, since } from "./log.js";
import { SOURCE_GUESS_BUSY, SOURCE_GUESS_LIMITED, SOURCE_GUESS_RESTING, tookTooLong } from "./messages.js";
import { articlePower, type ModelPower, modelFor } from "./models.js";
import { normaliseWhitespace, type PaperText, readPaperText } from "./paper-text.js";
import { pass0 } from "./pdf.js";
import { isSamePaper, type PaperIdentity, paperIdentity } from "./source-guess.js";
import type {
  AllowanceTaken,
  FetchAllowanceStore,
  RatePolicy,
  RawSource,
  SourceGuessOutcome,
  SourceGuessStore,
} from "./store/contracts.js";
import { SOURCE_GUESS_MAX_ATTEMPTS } from "./store/contracts.js";
import type { Article, Block, Meta, SourceGuess } from "./types.js";
import { isWebUrl } from "./urls.js";

/**
 * **The one deadline**, from the claim to the end of the page read. A title
 * search answers in 5–15 s and a paper's PDF reads in a few more; a minute is
 * the ceiling `FIND_TIMEOUT_MS` already chose for the same search.
 */
export const GUESS_TIMEOUT_MS = 60_000;
/** A claim older than the deadline plus this is a process that died, and is reclaimable. */
export const GUESS_STALE_MARGIN_MS = 30_000;

/**
 * **How often one owner's uploads may search the web** — its own bucket,
 * because the search is billed per search and the provider can run several
 * for one call (src/citation-find.ts § One call, not one search).
 *
 * The numbers are **guesses**, as every `RatePolicy`'s are (src/store/
 * contracts.ts § `RatePolicy`): nothing has measured how many uploads an owner
 * opens for the first time in an hour. Ten an hour is a reader working through
 * a stack of freshly uploaded papers; thirty a day is a heavy day of it; each
 * upload is looked for at most twice ever, so the steady state spends nothing.
 * The global fuse is a day's worst case, at a few cents a search, that nobody
 * would notice until the bill. Concurrency two is two tabs, not two readers.
 */
export const GUESS_RATE_POLICY: RatePolicy = {
  fills: 10,
  windowMs: 60 * 60 * 1000,
  concurrency: 2,
  leaseMs: GUESS_TIMEOUT_MS + GUESS_STALE_MARGIN_MS,
  daily: { fills: 30, globalFills: 300, windowMs: 24 * 60 * 60 * 1000 },
};

/** The first pages of a PDF: where the title, the byline and any identifier are printed. */
const FIRST_PAGES = 2;
/** The same cap readPaperText uses — a thesis or a book is not what this looks for. */
const PASS0_MAX_PAGES = 150;
/** An HTML upload's "first pages": about two printed pages of its text. */
const HTML_FIRST_CHARS = 12_000;
/** How much of the opening prose the content branch compares. */
export const OPENING_WORDS = 150;
/**
 * **A block is opening prose** when it is a paragraph a byline or an
 * affiliation line never is: at least this many words, and mostly words that
 * start in lower case. Measured on the local database's uploads (2026-09-29):
 * author lists run to ~25 words, and a long affiliation block reached 45 words
 * but is nearly all Capitalised Names — while an abstract or first paragraph is
 * 60–300 words of ordinary sentences.
 */
const PROSE_MIN_WORDS = 30;
const PROSE_LOWER_SHARE = 0.5;
/** How many authors go in the search prompt — enough to disambiguate, short enough to stay one search. */
const PROMPT_AUTHORS = 3;

/** Why nothing was kept — logged, and stored in `why`. Never shown. */
export type GuessWhy =
  | "no-identity"
  | "attempts"
  | "provider-failed"
  | `search:${string}`
  | `read:${string}`
  | `judge:${string}`;

/**
 * What one search is told: its share of the deadline, the log line, and the
 * article's High-powered AI setting (plan 260930f) — required, so a `find`
 * cannot be called without somebody deciding which model searches.
 */
export type FindOpts = { timeoutMs: number; line: ReturnType<typeof log>; power: ModelPower };

export interface GuessSourceDeps {
  /** Owner-scoped: a stranger's slug is a 404 before anything is spent. */
  readonly reader: {
    loadArticle(slug: string): Promise<Article>;
    loadSource(slug: string): Promise<RawSource | null>;
  };
  readonly guesses: SourceGuessStore;
  /** Required, so nothing can build this without a bound on spend. */
  readonly allowance: Pick<FetchAllowanceStore, "take" | "finish">;
  /** The search. Overridable so a test drives every outcome without a network. */
  readonly find?: (work: WorkToFind, opts: FindOpts) => Promise<FoundWorkPage>;
  /** The candidate page's read. Overridable for the same reason. */
  readonly read?: (url: string, opts: { signal: AbortSignal; timeoutMs: number }) => Promise<PaperText>;
  /** The stored source's first pages as text. Overridable so a test needs no pdf.js. */
  readonly firstPages?: (source: RawSource) => Promise<string>;
  readonly timeoutMs?: number;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function refusedBy(kind: Exclude<AllowanceTaken["kind"], "allowed">): Error {
  switch (kind) {
    case "concurrency":
      return httpError(429, SOURCE_GUESS_BUSY);
    case "rate":
      return httpError(429, SOURCE_GUESS_LIMITED);
    case "global":
      return httpError(503, SOURCE_GUESS_RESTING.message);
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/**
 * **Did this come off the owner's disk, with no address of its own?** The
 * server's `cameOffADisk` (src/web/SourceLink.tsx): `raw_filename` is the
 * evidence, and a PDF from before that column existed counts too — but only
 * when it has no web address, so a PDF fetched from a web URL is never searched
 * for the address it already has.
 */
export function isAnUpload(meta: Meta): boolean {
  if (meta.url && isWebUrl(meta.url)) return false;
  return meta.filename !== undefined || meta.source === "pdf";
}

/** The default search: `findWorkPage` under this job's own name and model. Exported for scripts/eval-source-guess.ts. */
export function defaultFind(work: WorkToFind, opts: FindOpts): Promise<FoundWorkPage> {
  return findWorkPage(work, null, {
    call: (body: AiRequestBody, o: { signal: AbortSignal }): Promise<JsonCall> =>
      openRouterJson("upload-source-guess", body, o),
    model: modelFor("upload-source-guess", opts.power),
    power: opts.power,
    timeoutMs: opts.timeoutMs,
    line: opts.line,
  });
}

/**
 * **The stored source's first pages, as the judge wants them: raw.** Pass 0's
 * upright text of pages 1–2 for a PDF (not the blocks, which drop DOI lines and
 * arXiv stamps as furniture — plan § What counts as "an exact match"). For an
 * HTML upload, the document's own text, scripts and styles removed.
 *
 * **An HTML upload's `citation_*` meta tags are not read yet**: the parser for
 * them is private to src/paper-text.ts, and an identifier only in a meta tag
 * is therefore missed — a missed link, never a wrong one.
 */
export async function defaultFirstPages(source: RawSource): Promise<string> {
  if (source.kind === "pdf") {
    const pass = await pass0(source.bytes, { maxPages: PASS0_MAX_PAGES });
    return pass.pages
      .slice(0, FIRST_PAGES)
      .map((p) => p.text)
      .join("\n\n");
  }
  const { JSDOM } = jsdom();
  const document = new JSDOM(new TextDecoder().decode(source.bytes)).window.document;
  for (const el of Array.from(document.querySelectorAll("script, style, noscript, template"))) el.remove();
  return normaliseWhitespace(document.body?.textContent ?? "").slice(0, HTML_FIRST_CHARS);
}

/**
 * **The opening prose: ~150 words of body text after the front matter.**
 *
 * The blocks carry no front-matter role — a PDF's title is a heading and its
 * byline, affiliations, correspondence line and keywords are ordinary `text`
 * blocks — so this skips to the first block that reads as a paragraph
 * (`PROSE_MIN_WORDS`, `PROSE_LOWER_SHARE`) and takes prose blocks from there.
 * An abstract usually qualifies, which is what we want: it is the passage a
 * landing page is most likely to print too. Notes, references, supplements and
 * boxed asides are never opening prose.
 */
export function openingProse(blocks: readonly Block[]): string {
  const words: string[] = [];
  for (const b of blocks) {
    if (words.length >= OPENING_WORDS) break;
    if (b.kind !== "text" || b.role !== undefined || b.treatment !== undefined || b.context !== undefined) continue;
    /* Skipped wherever it falls — a keywords line between the abstract and
       the introduction is not prose either. */
    if (!looksLikeProse(b.text)) continue;
    words.push(...b.text.split(/\s+/).filter(Boolean));
  }
  return words.slice(0, OPENING_WORDS).join(" ");
}

/**
 * Licence, copyright and permissions paragraphs are prose by shape, and the
 * same words are on thousands of unrelated pages — so a same-titled page that
 * carries the same licence could pass the text check on boilerplate alone
 * (Sol code review F6). Skipped wherever they fall.
 */
const BOILERPLATE =
  /creative commons|open access|all rights reserved|©|\(c\)\s*\d{4}|copyright|licen[cs]e|permission (?:of|from) the|reproduced without/i;

function looksLikeProse(text: string): boolean {
  if (BOILERPLATE.test(text)) return false;
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < PROSE_MIN_WORDS) return false;
  const lower = words.filter((w) => /^[^\p{L}]*\p{Ll}/u.test(w)).length;
  return lower >= PROSE_LOWER_SHARE * words.length;
}

/** What the search is asked to find: the title, and the first few authors. Exported for scripts/eval-source-guess.ts. */
export function workToFind(meta: Meta): WorkToFind {
  const authors = (meta.authors ?? []).slice(0, PROMPT_AUTHORS).map((a) => a.name);
  return { title: meta.title, ...(authors.length ? { authors: authors.join(", ") } : {}) };
}

/** What one search has cost so far — written as it happens, so a failure part-way still records it. */
interface Meter {
  searches: number | null;
  model: string | null;
}

type Tools = { find: NonNullable<GuessSourceDeps["find"]>; read: NonNullable<GuessSourceDeps["read"]> };
type Clock = { deadline: AbortSignal; remaining: () => number; timeoutMs: number; line: ReturnType<typeof log> };

function deadlineError(timeoutMs: number): Error {
  return httpError(504, tookTooLong(Math.ceil(timeoutMs / 1000)).message);
}

function requireTime(clock: Clock): void {
  if (clock.deadline.aborted) throw deadlineError(clock.timeoutMs);
}

/**
 * Bound work that cannot itself take the shared signal. `pass0` is the important
 * case: its callers can check the clock only after PDF parsing. The work may
 * finish its own cleanup later, but its answer cannot buy a search or settle the
 * claimed row after the request's deadline.
 */
function withinDeadline<T>(start: () => Promise<T>, clock: Clock): Promise<T> {
  if (clock.deadline.aborted) return Promise.reject(deadlineError(clock.timeoutMs));
  const work = start();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(deadlineError(clock.timeoutMs));
    clock.deadline.addEventListener("abort", onAbort, { once: true });
    void work.then(
      (value) => {
        clock.deadline.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        clock.deadline.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * **Search, read, judge** — the paid half, under the one deadline. Answers the
 * outcome to store; throws for a failure of ours or the provider's, which the
 * caller must not store as "no page matched".
 */
async function searchAndJudge(
  identity: PaperIdentity,
  meta: Meta,
  tools: Tools,
  clock: Clock,
  meter: Meter,
  power: ModelPower,
): Promise<SourceGuessOutcome> {
  const none = (why: GuessWhy): SourceGuessOutcome => ({ status: "none", why, ...meter });
  requireTime(clock);
  const found = await tools.find(workToFind(meta), { timeoutMs: clock.remaining(), line: clock.line, power });
  requireTime(clock);
  meter.searches = found.reading.searches;
  meter.model = found.model;
  const { verdict } = found.reading;
  if (verdict.kind === "none") return none(`search:${verdict.why}`);
  const page = verdict.page;

  const paper = await tools.read(page.url, { signal: clock.deadline, timeoutMs: clock.remaining() });
  requireTime(clock);
  if (paper.kind === "unreadable") return none(`read:${paper.why}`);

  const judged = isSamePaper(identity, { read: paper, result: page });
  if (!judged.same) return none(`judge:${judged.why}`);

  /* Stored: the link we built from a verified identifier, or the search
     result's own address — never anything the model wrote. */
  const url = judged.canonicalUrl ?? page.url;
  return {
    status: "found",
    url,
    host: hostOfPage(url),
    kind: judged.canonicalUrl ? "canonical" : "matching",
    matchedBy: judged.matchedBy,
    searches: meter.searches,
    model: meter.model ?? modelFor("upload-source-guess", power),
  };
}

function guessOf(outcome: SourceGuessOutcome): SourceGuess {
  return outcome.status === "found"
    ? { status: "found", url: outcome.url, host: outcome.host, kind: outcome.kind, matchedBy: outcome.matchedBy }
    : { status: "none" };
}

/** The upload's identity, from the revision and the stored source's first pages. Exported for scripts/eval-source-guess.ts, which must judge exactly what the route judges. */
export async function identityOf(
  article: Article,
  source: RawSource | null,
  firstPages: NonNullable<GuessSourceDeps["firstPages"]>,
): Promise<PaperIdentity | null> {
  return paperIdentity({
    title: article.meta.title,
    filename: article.meta.filename ?? null,
    authors: article.meta.authors ?? [],
    firstPagesText: source ? await firstPages(source) : "",
    opening: openingProse(article.blocks),
  });
}

/**
 * **Look for one upload's page, once.** Answers the settled guess, or
 * `searching` when somebody else holds the claim. Throws with an HTTP status
 * for a refusal (404, 409, 429, 503) and for a provider failure (502, 504).
 */
export function makeGuessSource(deps: GuessSourceDeps): (slug: string) => Promise<SourceGuess> {
  const tools: Tools = {
    find: deps.find ?? defaultFind,
    read: deps.read ?? ((url, opts) => readPaperText(url, opts)),
  };
  const firstPages = deps.firstPages ?? defaultFirstPages;
  const timeoutMs = deps.timeoutMs ?? GUESS_TIMEOUT_MS;

  return async function guessSource(slug) {
    const article = await deps.reader.loadArticle(slug);
    /* 409, not 400: nothing is malformed; a fetched article has its address. */
    if (!isAnUpload(article.meta)) throw httpError(409, "This article was not uploaded, so it has its own web address.");
    const stored = article.sourceGuess;
    if (stored?.status === "found" || stored?.status === "none") return stored;

    const claim = await deps.guesses.claim(slug, { staleMs: timeoutMs + GUESS_STALE_MARGIN_MS });
    if (claim.kind === "busy") return { status: "searching" };
    if (claim.kind === "settled") return claim.guess;
    const { token, attempt } = claim;

    const started = Date.now();
    const clock: Clock = {
      deadline: AbortSignal.timeout(timeoutMs),
      remaining: () => Math.max(1, timeoutMs - (Date.now() - started)),
      timeoutMs,
      line: log("model").child({ slug }),
    };
    const meter: Meter = { searches: null, model: null };

    /** Write the answer under our claim, log the one line, and say what the row now holds. */
    const settle = async (outcome: SourceGuessOutcome): Promise<SourceGuess> => {
      const won = await deps.guesses.finish(slug, token, outcome);
      clock.line.info(
        {
          attempt,
          outcome: outcome.status,
          ...(outcome.status === "none"
            ? { why: outcome.why }
            : { matchedBy: outcome.matchedBy, kind: outcome.kind, host: outcome.host }),
          searches: meter.searches,
          ...(meter.model ? { model: meter.model } : {}),
          ms: since(started),
          ...(won ? {} : { lostClaim: true }),
        },
        "upload source guess",
      );
      if (!won) return (await deps.guesses.read(slug)) ?? { status: "searching" };
      return guessOf(outcome);
    };

    /* **A failure of ours or the provider's is not "no page matched."** On the
       first attempt the claim is handed straight back, counted, so the next
       open tries again at once; on the last, the row settles. Leaving it
       `searching` would only make the next open wait out the stale margin for
       nothing. */
    const failed = async (err: unknown): Promise<never> => {
      if (attempt < SOURCE_GUESS_MAX_ATTEMPTS) {
        await deps.guesses.release(slug, token, { refund: false });
        clock.line.warn({ ...errorFields(err), attempt, ms: since(started) }, "upload source guess: failed, released");
      } else {
        await settle({ status: "none", why: "provider-failed", ...meter });
      }
      throw err;
    };

    let identity: PaperIdentity | null;
    try {
      identity = await withinDeadline(
        () => deps.reader.loadSource(slug).then((source) => identityOf(article, source, firstPages)),
        clock,
      );
    } catch (err) {
      return failed(err);
    }
    /* A title that fell back to the filename, or is too short to be evidence:
       nothing to search for, so nothing is spent. */
    if (!identity) return settle({ status: "none", why: "no-identity", ...meter });

    /* **The allowance, after every refusal that is free** and before the one
       thing that costs. A refused allowance spent nothing, so the attempt is
       given back with the claim. */
    const allowance = await deps.allowance.take("upload-source-guess", GUESS_RATE_POLICY);
    if (allowance.kind !== "allowed") {
      await deps.guesses.release(slug, token, { refund: true });
      clock.line.warn({ why: allowance.kind }, "upload source guess: allowance spent");
      throw refusedBy(allowance.kind);
    }

    let result: { ok: true; outcome: SourceGuessOutcome } | { ok: false; err: unknown };
    try {
      result = {
        ok: true,
        outcome: await withinDeadline(() => searchAndJudge(
            identity,
            article.meta,
            tools,
            clock,
            meter,
            /* The reader seam is owner-scoped, so the ambient owner is this
               article's (plan 260930f, Sol F4). */
            articlePower(article.highPowerSince),
          ), clock),
      };
    } catch (err) {
      result = { ok: false, err };
    } finally {
      /* Frees the concurrency slot whatever happened; the fill still counts. */
      await deps.allowance.finish(allowance.id);
    }
    return result.ok ? settle(result.outcome) : failed(result.err);
  };
}
