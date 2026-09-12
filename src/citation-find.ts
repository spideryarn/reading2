/**
 * **Find one cited work's own page on the web** — Citations mode's *Find it*,
 * `POST /api/citations/:slug/:id/find`. docs/plans/260911g-citations-mode.md
 * § Stage 3; docs/project/citations.md § Find it on the web.
 *
 * A row whose article gave no link offers a Scholar search. Pressing *Find it*
 * asks a model to run a web search for that one work and say which result, if
 * any, is the work's own page. What comes back is kept only if **all** of this
 * holds, and every clause is code, not the model:
 *
 * 1. **The URL is one the search returned** — an exact key in the map of the
 *    call's own `url_citation` annotations. A URL the model typed from memory
 *    is refused however right it looks; a remembered DOI looks exactly as
 *    right as a real one (the plan's § The one safety property).
 * 2. **What is stored is the annotation's**, never the model's: its URL and the
 *    title the search result gave itself. The model's answer is a *pointer*
 *    into the result set and nothing more. `readSources` in
 *    src/referee-candidates.ts is the precedent.
 * 3. **The result names the work**: its title, or its excerpt, carries the
 *    work's title words (`pageNamesTitle` in src/citations.ts). An allowed URL
 *    can still be the wrong work — a review of it, a page about its author — and
 *    this is what refuses that (Sol F4).
 *
 * Anything else stores nothing and the reader is told no page matched; the
 * Scholar search stays. **No annotation, nothing kept** — which is also what
 * a fallback that silently dropped the search tool would produce, and the
 * route's `require_parameters` is what stops that one (src/ai-call.ts).
 *
 * ## One call, not one search (Sol F1)
 *
 * The server tool cannot bound the number of searches: a probe asking for 4
 * results ran 36 billed ones (docs/project/ai-gateway.md § The four things that
 * fail silently). So the controls are the ones that exist — Exa with a small
 * `max_total_results`, a short prompt asking for one search for this one work
 * and nothing more, an abort deadline — and the count is the alarm: the meter
 * writes `webSearches` on the ledger row (src/ai-call.ts § Meter) and this
 * file logs it on every call, with which usage field it came from.
 *
 * **Exa, not the default engine**, because the default engine emits
 * annotations only where the model attributes a result in its prose, and an
 * answer that is one JSON field attributes nothing — src/converse.ts §
 * `webSearchTool` has the measurement.
 *
 * ## Not streamed
 *
 * The answer is a link, not prose to start reading, so this is one
 * `openRouterJson` call and one JSON reply.
 *
 * ## What never reaches the log
 *
 * The work's title, the reference text, the URL, and the model's answer — they
 * are what somebody's article cites. The host of a kept page, the counts, the
 * outcome, the model and the time.
 */

import { type AiRequestBody, type JsonCall, openRouterJson, ProviderRefused } from "./ai-call.js";
import { pageNamesTitle } from "./citations.js";
import { errorFields, log, since } from "./log.js";
import {
  CITATION_ALREADY_LINKED,
  CITATION_FIND_BUSY,
  CITATION_FIND_LIMITED,
  CITATION_FIND_RESTING,
  CITATION_NO_MATCH,
  PROVIDER_UNREADABLE,
  providerHttpFailure,
  tookTooLong,
} from "./messages.js";
import { modelFor } from "./models.js";
import {
  collectSearchEvidence,
  type SearchUsagePath,
  type Usage,
  whereSearchCountCameFrom,
} from "./openrouter-stream.js";
import { parseJsonAnswer } from "./parse-json.js";
import type { AllowanceTaken, CitationFindStore, FetchAllowanceStore, RatePolicy } from "./store/contracts.js";
import type {
  Article,
  CitationFind,
  CitationsFound,
  CitedWork,
  FindCitationResponse,
  SearchEvidence,
} from "./types.js";
import { isWebUrl } from "./urls.js";

/**
 * How many results the search may hand back, across however many searches it
 * runs. **A cap on results, not on searches** — see the header. Five is enough
 * for a title search to surface the publisher, a DOI landing page, arXiv and a
 * PDF, and small enough that the prompt stays short.
 */
export const MAX_TOTAL_RESULTS = 5;
/** Per search. The same five, so one search can fill the whole allowance. */
const MAX_RESULTS_PER_SEARCH = 5;

/** The answer is `{"url": …}` — a few dozen tokens. The ceiling is generous. */
const ANSWER_TOKENS = 400;

/**
 * **The deadline, and one of the only two real bounds on spend.** A search for
 * one title answers in 5–15 seconds; a minute is four times the slow end, and
 * past it a reader waiting on a button is better told than kept waiting.
 */
export const FIND_TIMEOUT_MS = 60_000;

/**
 * **How many presses of *Find it* one owner may make** — the other bound on
 * spend, on the count of calls where the deadline bounds each one. GPT Sol F11,
 * 2026-09-12: nothing limited it, and a no-match stores nothing, so the same row
 * could be pressed for ever.
 *
 * The numbers are **guesses**, as `SUMMARY_RATE_POLICY`'s are and for its
 * reason (src/store/contracts.ts § `RatePolicy`): nothing has measured how many
 * works a reader looks up. Twenty an hour is most of a long bibliography's
 * searched rows pressed one after another; the panel runs one at a time, so a
 * concurrency of two is a second tab, not a second reader. The global fuse is
 * a day's worst case in money, at a few cents a press, that nobody would
 * notice until the bill.
 */
export const FIND_RATE_POLICY: RatePolicy = {
  fills: 20,
  windowMs: 60 * 60 * 1000,
  concurrency: 2,
  /* The deadline plus a margin: a process that dies mid-call frees its slot
     soon after the call itself could have ended. */
  leaseMs: FIND_TIMEOUT_MS + 30_000,
  daily: { fills: 60, globalFills: 600, windowMs: 24 * 60 * 60 * 1000 },
};

/** A refused allowance as the route's error: 429 for this reader, 503 for everyone. */
function refusedBy(kind: Exclude<AllowanceTaken["kind"], "allowed">): Error {
  switch (kind) {
    case "concurrency":
      return httpError(429, CITATION_FIND_BUSY);
    case "rate":
      return httpError(429, CITATION_FIND_LIMITED);
    case "global":
      return httpError(503, CITATION_FIND_RESTING);
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** The reference entry as the article gives it, capped — enough to disambiguate. */
const REFERENCE_CAP = 500;
/** A search result's own title, capped before it is stored. */
const TITLE_CAP = 300;

/**
 * The prompt. **Short on purpose, because a searching prompt is a cost
 * control**: the 36-search probe was a prompt that said *be thorough*. So this
 * one says the opposite, and says what a good answer is.
 */
export const FIND_SYSTEM = [
  "You find the web page of one cited work.",
  "Run ONE web search for it — its title, with the first author if one is given. Do not search again.",
  "Then answer with only a JSON object and nothing else:",
  '{"url": "<the search result URL that is this work\'s own page>"}',
  "— the publisher's page, its DOI landing page, its arXiv page, or the author's own copy — or",
  '{"url": null}',
  "if no result is this work itself. Copy the URL exactly as the search result gave it.",
  "Never write a URL that was not one of the search results. A page that only mentions,",
  "reviews or summarises the work is not its page.",
].join("\n");

/** The user turn: the work as the article gives it, and nothing else of the article. */
export function findPrompt(work: CitedWork, reference: string | null): string {
  const lines = [`Title: ${work.title}`];
  if (work.authors) lines.push(`Authors: ${work.authors}`);
  if (work.year) lines.push(`Year: ${work.year}`);
  if (reference) lines.push(`The article's reference entry: ${reference.slice(0, REFERENCE_CAP)}`);
  return lines.join("\n");
}

/** The request, in one place so a test can read what goes on the wire. */
export function findRequest(work: CitedWork, reference: string | null, model: string): AiRequestBody {
  return {
    model,
    max_tokens: ANSWER_TOKENS,
    messages: [
      { role: "system", content: FIND_SYSTEM },
      { role: "user", content: findPrompt(work, reference) },
    ],
    tools: [
      {
        type: "openrouter:web_search",
        parameters: {
          engine: "exa",
          max_total_results: MAX_TOTAL_RESULTS,
          max_results: MAX_RESULTS_PER_SEARCH,
        },
      },
    ],
  };
}

/* ---------------------------------------------------------- the verdict -- */

/** Why nothing was kept. Logged; the reader gets one sentence for all four. */
export type NoMatch =
  /** The search returned no annotations at all — or never ran. */
  | "no-results"
  /** The model said none of the results was this work. */
  | "none-picked"
  /** The model named a URL that was not one of the results. Refused. */
  | "not-a-result"
  /** The named result's title and excerpt do not carry the work's title. */
  | "title-mismatch";

export interface FindReading {
  verdict: { kind: "kept"; page: SearchEvidence } | { kind: "none"; why: NoMatch };
  /** Billed searches the provider reported, or `null` when its usage said nothing. */
  searches: number | null;
  searchesFrom: SearchUsagePath;
  /** How many distinct results the search handed back. */
  results: number;
}

/** The shape `openRouterJson` hands back for a chat completion, as much as is read. */
interface ChatAnswer {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string;
      annotations?: Parameters<typeof collectSearchEvidence>[0];
    };
  }[];
  usage?: Usage;
}

/**
 * **Judge one answer** — pure, so every rule is testable without a network.
 * `null` means the answer could not be read at all, which the caller reports
 * as a failure to retry rather than as "no page matched": a claim that nothing
 * matched has to have been checked.
 */
export function readFind(json: unknown, title: string): FindReading | null {
  const answer = json as ChatAnswer | null;
  const choice = answer?.choices?.[0];
  /* An allowlist on the finish, as src/debate.ts § readPass has: any ending the
     provider chose other than `stop` is an answer that stopped early. */
  if (choice?.finish_reason !== "stop") return null;

  const { searches, from } = whereSearchCountCameFrom(answer?.usage);
  const searchesFrom: SearchUsagePath = answer?.usage ? from : "no-usage";

  /* Every annotation, into an exact URL map. `collectSearchEvidence` keeps the
     result's title and its excerpt, and refuses anything that is not http(s). */
  const results = new Map<string, SearchEvidence>();
  collectSearchEvidence(choice.message?.annotations, results);
  const base = { searches, searchesFrom, results: results.size };
  if (results.size === 0) return { ...base, verdict: { kind: "none", why: "no-results" } };

  let picked: unknown;
  try {
    picked = parseJsonAnswer<{ url?: unknown }>(choice.message?.content ?? "", "the find answer");
  } catch {
    return null;
  }
  const url =
    picked && typeof picked === "object" && typeof (picked as { url?: unknown }).url === "string"
      ? ((picked as { url: string }).url.trim() as string)
      : "";
  if (url === "") return { ...base, verdict: { kind: "none", why: "none-picked" } };

  /* Rule 1: a key in the map, exactly. `isWebUrl` first so a `javascript:`
     string can never even be a lookup key. */
  const page = isWebUrl(url) ? results.get(url) : undefined;
  if (!page) return { ...base, verdict: { kind: "none", why: "not-a-result" } };

  // Rule 3: the result has to name the work.
  if (!pageNamesTitle(page, title)) return { ...base, verdict: { kind: "none", why: "title-mismatch" } };

  // Rule 2: what is returned is the annotation, not anything the model wrote.
  return { ...base, verdict: { kind: "kept", page } };
}

/** `url`'s host without `www.`, as the row prints it. */
export function hostOfPage(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

/* ------------------------------------------------------- the orchestration -- */

export interface FindCitationDeps {
  /** Where the list and the article come from — owner-scoped, so a stranger's slug is a 404. */
  readonly reader: {
    loadCitations(slug: string): Promise<CitationsFound>;
    loadArticle(slug: string): Promise<Article>;
  };
  /** Where a kept find goes. */
  readonly finds: CitationFindStore;
  /**
   * **The bound on presses** — required, so a caller cannot build this without
   * one. Each press is a billed web search, and ownership says *which* article,
   * not *how many* times. GPT Sol F11, 2026-09-12.
   */
  readonly allowance: Pick<FetchAllowanceStore, "take" | "finish">;
  /** The model call. Overridable so a test can drive every outcome without a network. */
  readonly call?: (body: AiRequestBody, options: { signal: AbortSignal }) => Promise<JsonCall>;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * **The call, under its deadline, with every failure turned into the house
 * copy** (src/messages.ts) — a refused call by its status, the deadline as
 * `tookTooLong`, anything else rethrown for the route's catch-all. Logged by
 * status and time only: the body of a refusal is the one place a provider
 * might echo back what we sent.
 */
async function callOnce(
  send: NonNullable<FindCitationDeps["call"]>,
  body: AiRequestBody,
  ctx: { timeoutMs: number; line: ReturnType<typeof log>; model: string; started: number },
): Promise<JsonCall> {
  const deadline = AbortSignal.timeout(ctx.timeoutMs);
  try {
    return await send(body, { signal: deadline });
  } catch (err) {
    const ms = since(ctx.started);
    if (err instanceof ProviderRefused) {
      ctx.line.error({ model: ctx.model, ms, status: err.status }, `OpenRouter refused a citation find: ${err.status}`);
      throw httpError(502, providerHttpFailure(err.status).message);
    }
    if (deadline.aborted) {
      ctx.line.error({ model: ctx.model, ms, timedOut: true }, "a citation find hit its deadline");
      throw httpError(504, tookTooLong(Math.round(ctx.timeoutMs / 1000)).message);
    }
    ctx.line.error({ ...errorFields(err), model: ctx.model, ms }, "a citation find failed");
    throw err;
  }
}

export function makeFindCitation(
  deps: FindCitationDeps,
): (slug: string, entryId: string) => Promise<FindCitationResponse> {
  const send = deps.call ?? ((body, options) => openRouterJson("citations-find", body, options));
  const now = deps.now ?? (() => new Date().toISOString());
  const timeoutMs = deps.timeoutMs ?? FIND_TIMEOUT_MS;

  return async function findCitation(slug, entryId) {
    /* Ownership is this read: every one joins through `ownedSlug`, so somebody
       else's slug — or an article with no list — is a 404 before anything is
       spent. */
    const { citations } = await deps.reader.loadCitations(slug);
    const work = citations.citations.find((w) => w.id === entryId);
    if (!work) throw httpError(404, `No cited work "${entryId}" in "${slug}".`);
    /* Only a row whose link is a search. A link the article gave is the work's
       address already, and a row already found has its page. 409, not 400:
       nothing is malformed, the row is just not one this can improve. */
    if (work.linkFrom !== "search") throw httpError(409, CITATION_ALREADY_LINKED);

    /* The bibliography entry, as the article gives it, when there is one — the
       best disambiguator there is for "Smith 2019". */
    let reference: string | null = null;
    if (work.reference) {
      const article = await deps.reader.loadArticle(slug);
      reference = article.blocks.find((b) => b.id === work.reference?.blockId)?.text ?? null;
    }

    const model = modelFor("citations-find");
    const line = log("model").child({ slug, entryId });

    /* **The allowance, after every check that can refuse for free** — a 404 or
       a 409 spends none of it — and before the one thing that costs. */
    const allowance = await deps.allowance.take("citation-find", FIND_RATE_POLICY);
    if (allowance.kind !== "allowed") {
      line.warn({ why: allowance.kind }, "citation find: allowance spent");
      throw refusedBy(allowance.kind);
    }

    const started = Date.now();
    let call: JsonCall;
    try {
      call = await callOnce(send, findRequest(work, reference, model), { timeoutMs, line, model, started });
    } finally {
      /* Frees the concurrency slot whatever happened; the fill still counts. */
      await deps.allowance.finish(allowance.id);
    }

    const used = call.answeredBy ?? model;
    const reading = readFind(call.json, work.title);
    if (!reading) {
      line.error({ model: used, ms: since(started) }, "a citation find's answer could not be read");
      throw httpError(502, PROVIDER_UNREADABLE.message);
    }

    const kept = reading.verdict.kind === "kept" ? reading.verdict.page : null;
    /* One line per call, and `searches` is on it because it is the alarm: the
       prompt asks for one, and nothing else in the request enforces that. */
    line.info(
      {
        model: used,
        ms: since(started),
        searches: reading.searches,
        searchesFrom: reading.searchesFrom,
        results: reading.results,
        outcome: reading.verdict.kind === "kept" ? "kept" : reading.verdict.why,
        ...(kept ? { host: hostOfPage(kept.url) } : {}),
      },
      "citation find",
    );

    if (!kept) return { outcome: "no-match", message: CITATION_NO_MATCH };

    const title = kept.title?.trim().slice(0, TITLE_CAP);
    const find: CitationFind = {
      url: kept.url,
      ...(title ? { title } : {}),
      host: hostOfPage(kept.url),
      searches: reading.searches,
      model: used,
      at: now(),
    };
    /* Awaited before the answer: a save that fails is the request's failure,
       and the row is never drawn as found when it was not kept. */
    await deps.finds.save(slug, entryId, find);
    const { url, ...found } = find;
    return { outcome: "found", work: { ...work, url, linkFrom: "web", found } };
  };
}
