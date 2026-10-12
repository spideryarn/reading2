/**
 * **`search_web`: a conversation's web search, run by a subagent.**
 *
 * The model in the conversation calls `search_web({ query })`. This module
 * runs one forced-search model call on a small model (`web-search-subagent`,
 * quick tier). The model may issue more than one Exa search request inside
 * that call; two of the spike's six Luna calls did. It writes at most five
 * `[title](url) — sentence` lines. What
 * goes back to the conversation is built here from those lines and from the
 * search's own annotations, and it arrives as an ordinary `tool` message.
 * Plan docs/plans/261012g-web-search-through-a-subagent-for-chat-and-the-guide.md;
 * the spikes behind the shape are docs/investigations/261012b-web-search-subagent-spikes.md.
 *
 * ## Why a tool message rather than OpenRouter's own search
 *
 * OpenRouter's search runs inside the model's reply, and its results exist only
 * in that reply. The guide searched, called `offer_next_steps` without writing a
 * word, and the results were gone by the round that wrote the answer, which
 * then said "I haven't looked this up" (plan 261011t § The guide). A `tool`
 * message is replayed into every later round of the turn, whatever else the
 * model called beside it.
 *
 * ## What the conversation is handed, and what it is not
 *
 * - **Only links the search returned.** A line is kept only if its URL is one
 *   `collectSearchEvidence` accepted (http(s), deduped), and its title is the
 *   search's, not the model's. Haiku mistyped 1 link in 30 in the spike, and a
 *   mistyped link is a dead one with a confident sentence beside it.
 * - **Fenced as untrusted.** The sentences are a model's paraphrase of pages
 *   strangers wrote, so for the reading model they are a stranger's words.
 * - **No page text beyond the sentence.** The point is to hand back a short list
 *   the caller can choose from — "for the caller-agent to retrieve if it
 *   chooses to" (Greg, 2026-10-12) — not ten thousand characters of extracts
 *   re-sent on every later round.
 *
 * ## What may be logged
 *
 * Counts, times and the model. **Never the query** — it is the reader's
 * question in other words (src/chat-tools.ts § What may be logged).
 */

import {
  type AiRequestBody,
  type ChatJob,
  type JsonCall,
  ProviderRefused,
  openRouterJson,
} from "./ai-call.js";
import { log, since } from "./log.js";
import { type ModelPower, modelFor } from "./models.js";
import { type Usage, collectSearchEvidence, whereSearchCountCameFrom } from "./openrouter-stream.js";
import type { SearchEvidence } from "./types.js";
import { untrusted } from "./untrusted-fence.js";

/** At most this many results come back. Exa's price covers up to ten; five is a list a reader reads. */
export const SEARCH_WEB_RESULTS = 5;

/** The subagent's whole call, search and lines. The spike's slowest was 10.9 s. */
export const SEARCH_WEB_TIMEOUT_MS = 25_000;

/** A query longer than this is not a search, it is a message. */
export const SEARCH_WEB_MAX_QUERY_CHARS = 300;

/** One result's sentence, clipped. Two plain sentences fit comfortably. */
const MAX_SENTENCE_CHARS = 400;

/** The fallback's page extract, when the subagent's lines did not survive. */
const MAX_FALLBACK_EXCERPT_CHARS = 300;

/** Room for the lines and nothing else; the spike's lines ran to about 1.7k. */
const MAX_TOKENS = 3_000;

const SYSTEM = `You are a research assistant searching the web for another model, which is \
talking to a reader about an article. Search for the query, then reply with at most \
${SEARCH_WEB_RESULTS} results, most useful first, one per line, in exactly this form:

- [title](url) — one or two plain sentences: what this page says that bears on the query.

Use only URLs your search returned, copied exactly. Say what each page says, not what you know. \
If nothing useful came back, reply "Nothing useful found." and nothing else.`;

/** The request, in one place so a test can read what goes on the wire. */
export function searchWebRequest(query: string, power: ModelPower): AiRequestBody {
  return {
    model: modelFor("web-search-subagent", power),
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: query },
    ],
    tools: [
      {
        type: "openrouter:web_search",
        /* Exa, because its annotations arrive at search time with a URL, a
           title and an extract, and they are what every kept line is checked
           against (src/converse.ts § webSearchTool has the probe). */
        parameters: { engine: "exa", max_total_results: SEARCH_WEB_RESULTS, max_results: SEARCH_WEB_RESULTS },
      },
    ],
    /* Forced: the tool is called because a search is wanted, and a small model
       left to decide answers what it thinks it knows. */
    tool_choice: "required",
  };
}

/** One result as the conversation is shown it. */
export interface WebResult {
  url: string;
  title: string;
  /** The subagent's sentence, or a clip of the page's extract on the fallback path. */
  note: string;
}

/** Query parameters that identify a visit rather than a different page. */
const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;

/**
 * A conservative identity for matching the model's spelling back to a search
 * annotation. The annotation's URL is always what we return. This only forgives
 * the changes models routinely make while copying a result: a trailing slash,
 * the order of query parameters, and known tracking parameters.
 */
function comparableUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

/** Exact first; a normalised match only when it identifies one searched URL. */
function searchedEvidence(url: string, found: ReadonlyMap<string, SearchEvidence>): SearchEvidence | undefined {
  const exact = found.get(url);
  if (exact) return exact;
  const comparable = comparableUrl(url);
  if (comparable === null) return undefined;
  let match: SearchEvidence | undefined;
  for (const evidence of found.values()) {
    if (comparableUrl(evidence.url) !== comparable) continue;
    if (match !== undefined && match.url !== evidence.url) return undefined;
    match = evidence;
  }
  return match;
}

/**
 * The subagent's lines, kept only where the link is one the search returned.
 *
 * The URL is matched up to `) —` rather than to the first `)`, so a Wikipedia
 * address with parentheses in it survives. The title is always the search's.
 */
export function keptResults(text: string, found: ReadonlyMap<string, SearchEvidence>): WebResult[] {
  const kept: WebResult[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    /* Prefixes are deliberately ignored, so bullets and numbered lists both
       work. The characters between the Markdown link and the dash forgive
       emphasis and sentence punctuation, but never become part of the URL. */
    const m = /\]\((https?:\/\/\S+?)\)(?:[*_~.,;:]+\s*)*\s*[—–-]+\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const evidence = searchedEvidence(m[1]!, found);
    if (!evidence || seen.has(evidence.url)) continue;
    seen.add(evidence.url);
    kept.push({
      url: evidence.url,
      title: evidence.title ?? evidence.url,
      note: clip(m[2]!.trim(), MAX_SENTENCE_CHARS),
    });
    if (kept.length === SEARCH_WEB_RESULTS) break;
  }
  return kept;
}

/** When no line survived, the search's own results, with a little of each page. */
function fallbackResults(found: ReadonlyMap<string, SearchEvidence>): WebResult[] {
  return [...found.values()].slice(0, SEARCH_WEB_RESULTS).map((e) => ({
    url: e.url,
    title: e.title ?? e.url,
    note: e.excerpt ? clip(e.excerpt.replace(/\s+/g, " ").trim(), MAX_FALLBACK_EXCERPT_CHARS) : "",
  }));
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** What `searchWeb` hands back: the run strip's words and the `tool` message. */
export interface SearchWebOutcome {
  label: string;
  detail: string;
  content: string;
}

export interface SearchWebOptions {
  power: ModelPower;
  signal?: AbortSignal | undefined;
  /** Whether this conversation can open a page, so the result may say how. */
  canReadPages: boolean;
  /** A test's stand-in for the gateway. */
  call?: (job: ChatJob, body: AiRequestBody, options: { signal: AbortSignal }) => Promise<JsonCall>;
  timeoutMs?: number;
}

interface SearchAnswer {
  choices?: { finish_reason?: string; message?: { content?: string | null; annotations?: Parameters<typeof collectSearchEvidence>[0] } }[];
  usage?: Usage;
}

const LABEL = "searched the web";

/** A failure the model is told plainly, so it does not answer as though it had searched. */
const failed = (detail: string, why: string): SearchWebOutcome => ({
  label: LABEL,
  detail,
  content:
    `The web search did not run: ${why}. You have no search results. Tell the reader you could ` +
    `not search just now; do not answer from memory as though you had searched.`,
});

/** Error names are free text too. Keep a fixed class only; never log the message or stack. */
function failureKind(err: unknown): string {
  if (err instanceof TypeError) return "TypeError";
  if (err instanceof DOMException) return "DOMException";
  if (err instanceof Error) return "Error";
  return typeof err;
}

/** Run one search for the conversation. Never throws for a failed search; the reader's stop still aborts. */
export async function searchWeb(query: unknown, opts: SearchWebOptions): Promise<SearchWebOutcome> {
  if (typeof query !== "string" || query.trim() === "") {
    return { label: LABEL, detail: "no query", content: "No query was given. Give search_web a short web search query." };
  }
  if (query.length > SEARCH_WEB_MAX_QUERY_CHARS) {
    return {
      label: LABEL,
      detail: "refused",
      content:
        "That query is too long to be a web search, so it was not sent. Write a short query, a few " +
        "words, the way a person would type it into a search engine.",
    };
  }

  const send = opts.call ?? openRouterJson;
  const body = searchWebRequest(query.trim(), opts.power);
  const line = log("model").child({ tool: "search_web" });
  const started = Date.now();
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? SEARCH_WEB_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;

  let call: JsonCall;
  try {
    call = await send("web-search-subagent", body, { signal });
  } catch (err) {
    /* The reader pressed stop, or the turn ran out of time. Said plainly and
       not thrown: `converse` checks its own signals after every tool, which is
       what ends the turn, and a throw would be logged there as a broken tool. */
    if (opts.signal?.aborted) return { label: LABEL, detail: "stopped", content: "The search was stopped." };
    const ms = since(started);
    if (err instanceof ProviderRefused) {
      line.warn({ model: body.model, ms, status: err.status }, "search_web: the provider refused");
      return failed("failed", "the search service refused the request");
    }
    if (deadline.aborted) {
      line.warn({ model: body.model, ms, timedOut: true }, "search_web: hit its deadline");
      return failed("timed out", "it took too long");
    }
    /* No `errorFields`: an upstream error may repeat the request body, and the
       query is the reader's question in other words. */
    line.warn({ failure: failureKind(err), model: body.model, ms }, "search_web: failed");
    return failed("failed", "something went wrong reaching the search service");
  }

  const used = call.answeredBy ?? body.model;
  let choice: NonNullable<SearchAnswer["choices"]>[number] | undefined;
  let searches: number | null;
  let from: ReturnType<typeof whereSearchCountCameFrom>["from"];
  const found = new Map<string, SearchEvidence>();
  try {
    const answer = call.json as SearchAnswer | null;
    choice = answer?.choices?.[0];
    ({ searches, from } = whereSearchCountCameFrom(answer?.usage));
    collectSearchEvidence(choice?.message?.annotations, found);
    /* The assertion above describes the expected wire, not what crossed it. A
       number here would otherwise throw later, outside the failure boundary. */
    if (choice?.message?.content !== undefined && choice.message.content !== null && typeof choice.message.content !== "string") {
      throw new TypeError("search answer content was not text");
    }
  } catch (err) {
    line.warn(
      { failure: failureKind(err), model: used, ms: since(started) },
      "search_web: unreadable answer",
    );
    return failed("failed", "the search service returned an unreadable answer");
  }

  if (!choice || searches === null || searches <= 0) {
    line.warn({ model: used, ms: since(started), searches, searchesFrom: from }, "search_web: no search ran");
    return failed("failed", "the search service did not search");
  }
  if (found.size === 0) {
    line.info({ model: used, ms: since(started), searches, results: 0 }, "search_web: nothing came back");
    return {
      label: LABEL,
      detail: "nothing found",
      content: "The web search ran and found nothing. Say so; do not answer from memory as though it had found something.",
    };
  }

  const fromLines = keptResults(choice.message?.content ?? "", found);
  const results = fromLines.length > 0 ? fromLines : fallbackResults(found);
  line.info(
    { model: used, ms: since(started), searches, results: results.length, returned: found.size, fallback: fromLines.length === 0 },
    "search_web: done",
  );

  const listed = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.note ? `\n   ${r.note}` : ""}`)
    .join("\n\n");
  const after = opts.canReadPages
    ? "To read one of these in full, call read_web_page with its address. Link any you use in your answer."
    : "Link any you use in your answer.";
  return {
    label: LABEL,
    detail: `${results.length} result${results.length === 1 ? "" : "s"}`,
    content: `${untrusted("web search results", listed)}\n\n${after}`,
  };
}
