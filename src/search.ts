/**
 * Semantic search — the reader describes what they are looking for in ordinary
 * words, and the model points at the passages that match.
 *
 * The third LLM call that happens in a request handler rather than in the
 * pipeline, and it is the exception for the same reason the other two are:
 * **the input does not exist until the reader types it.** A criterion is not
 * something a pipeline stage could have precomputed. See
 * docs/project/architecture.md, and src/explain.ts § the same paragraph.
 *
 * ## Its two siblings, and how this differs
 *
 * | | src/explain.ts | src/converse.ts | here |
 * |---|---|---|---|
 * | what the reader gives | a selection | a question | a criterion |
 * | what comes back | prose | streamed prose | **a streamed list of ids** |
 * | web search | yes | yes | **no** |
 *
 * Those last two rows are the whole design.
 *
 * **The answer is data, not prose**, so this call is the one that has to be
 * validated rather than merely displayed. A hallucinated block id in a chat
 * answer renders as plain text and costs the reader a link
 * (docs/plans/260826a-chat-mode.md § The citation contract); a hallucinated block id
 * *here* would be a highlight over the wrong paragraph, which is worse — it
 * would look like the model's considered judgment about a passage it never
 * read. So every hit is checked against the article before it is stored, and
 * what was dropped is counted and logged.
 *
 * **No web search**, and this is a deliberate difference from both siblings
 * rather than an oversight. The question here is always *where in this piece*,
 * and no page on the internet can answer it. A search tool would only give the
 * model a way to spend the reader's money confirming background it does not
 * need to have.
 *
 * ## Streaming, without changing what is asked for
 *
 * `findPassagesStream` is the one implementation, same shape as
 * `explainStream` in src/explain.ts: `stream: true`, the same deadline and
 * stall clocks, `sseChunks`. `findPassages` below is a thin drainer of it.
 *
 * The model is still asked for exactly one JSON object — nothing about the
 * prompt changes, so nothing about ranking does either. What changes is that
 * `src/search-hits-stream.ts`'s `hitExtractor` watches the same text arrive a
 * chunk at a time and hands back each hit object the instant its closing
 * brace shows up. **Every hit shown mid-stream is run through the same
 * `validateHits` as the final pass** — a single-item list, so the rule is
 * never duplicated — but `done` is **not** a superset of what streamed. It is
 * computed fresh, from an independent strict parse of the whole buffered
 * text, and it is that computation — not a running collection of the hits
 * already shown — that is authoritative. The interesting consequence is that
 * a hit can be shown mid-stream and then simply never make it into a result
 * at all: a response cut off mid-object can stream one perfectly valid hit
 * before the JSON stops arriving, and the whole search still ends in a throw
 * rather than a `done` with that one hit in it, because the final text is not
 * a complete, parseable object. See "the final `done` is authoritative, not a
 * rollup of what streamed" in tests/search-stream.test.ts for exactly that
 * case.
 *
 * ## Logging
 *
 * One line per finished search under the `model` component — the same fields
 * explain.ts logs, plus the drop counts below. **Never the criterion, never a
 * quote, never the article, never the key.** A criterion is as private as a
 * selection: it is what somebody was looking for.
 */
import type { Block, Meta, SearchHit } from "./types.js";
import { loadEnvLocal } from "./env.js";
import { findQuote } from "./quote-match.js";
import { modelFor } from "./models.js";
import { errorFields, log, since } from "./log.js";
import {
  type StreamEnd,
  type Usage,
  explainAbort,
  providerFailedMidAnswer,
  stoppedByReader,
} from "./openrouter-stream.js";
import { ProviderRefused, classifyEnd, openRouterStream } from "./ai-call.js";
import { hitExtractor } from "./search-hits-stream.js";
import { objectEnd, stripFence } from "./parse-json.js";
import {
  ANSWER_OVERFLOWED,
  ANSWER_OVERFLOWED_FIXED_ASK,
  ENDED_UNFINISHED,
  NOT_CONFIGURED,
  PROVIDER_UNREADABLE,
  saidNothing,
} from "./messages.js";
import {
  type OpenRouterMessage,
  articleWithIds,
  cachedText,
  underCacheFloor,
} from "./article-prompt.js";

/**
 * What this call sends: the tier src/models.ts puts `search` on, or
 * `SPIDERYARN_SEARCH_MODEL` if that is set — see `resolveModel` there for why
 * the override is read in that file rather than here.
 */
export const defaultModel = (): string => modelFor("search");

/**
 * How long to wait before giving up.
 *
 * Shorter than explain.ts's ninety seconds because there is no web search to
 * wait for — the whole call is one pass over an article that is already in the
 * prompt. A deadline exists at all for the same reason it does there: `fetch`
 * has none of its own, and without one a request that never comes back leaves
 * the run `pending` on disk and a spinner on screen for as long as the tab is
 * open.
 */
export const SEARCH_TIMEOUT_MS = 60_000;

/**
 * How long a *silent* stream is allowed to stay silent.
 *
 * Shorter than explain.ts's forty-five seconds because there is no web search
 * here to wait through — the whole call is one straight pass over an article
 * already sitting in the prompt, with no tool round-trip to leave a gap. A
 * separate clock from the deadline above for the same reason explain.ts keeps
 * one: "slow" and "dead" are different failures, and a connection that died
 * mid-answer should not sit on the full sixty seconds before anyone is told.
 */
export const SEARCH_STALL_MS = 30_000;

/**
 * The most passages one search may return.
 *
 * A cap on the *answer*, and the reason is the one the glossary learned the
 * expensive way: their extraction hit gateway timeouts because the output grew
 * with the entry count, not because the article was long
 * (docs/project/original-version/glossary.md). Here the risk is milder — a hit
 * is a quote and a sentence, not two explanations — but the shape is identical
 * and the cap costs nothing.
 *
 * It is also a reading argument. Thirty highlighted passages in a twenty-block
 * article is not a search result, it is a highlighter emptied over the page,
 * and a reader cannot act on it. If a criterion genuinely matches everything,
 * the honest answer is the strongest twenty.
 */
export const MAX_HITS = 20;

const SYSTEM = `You are helping a reader find passages in an article they are reading. They
have described what they are looking for. Find it.

You are pointing at the article, not summarising it. Everything you return is an
INDEX INTO THE PIECE — the reader is going to press each result and land on that
paragraph and read it. Nothing you write replaces the reading.

WHAT TO RETURN

A JSON object, and nothing else — no prose before it, no code fence around it:

{"hits": [
  {"blockId": "spya-k3m9qt",
   "quote": "the exact words from that block, copied character for character",
   "confidence": 85,
   "reasoning": "one short sentence on why this matches"}
]}

THE RULES THAT MATTER

- blockId MUST be one of the ids listed in the article below. Never invent one,
  never guess at one you half-remember. A wrong id highlights the wrong
  paragraph, which is worse than returning nothing.
- quote MUST be copied verbatim from that block — the exact characters, not a
  paraphrase and not a tidied-up version. It is used to find the words on the
  page. If you cannot copy it exactly, do not return the hit.
- Quote the SENTENCE OR PHRASE that matches, not the whole paragraph. If a whole
  paragraph genuinely matches throughout, quote the sentence that carries it.
- confidence is an INTEGER FROM 0 TO 100. Not a fraction, not 0.85 — 85. Use the
  range: 90+ for a passage that plainly is what was asked for, 40-60 for one
  that is arguably it, and leave out anything you would put below about 30.
- reasoning is ONE short sentence, in plain words, saying what makes this a
  match. Not a summary of the passage — the reader can see the passage.
- Order the hits by how well they match, best first.
- Return the passages that match and no others. A criterion that matches nothing
  in this article gets {"hits": []}, and saying so plainly is a good answer.
  Padding a thin result with weak matches is the one thing that would make this
  feature useless.
- At most 20 hits.

WHAT COUNTS AS A MATCH

Meaning, not words. "Arguments against the main claim" should find the paragraph
that objects without ever using the word "argument". "Statistical evidence"
should find the sentence with the numbers in it. If the reader wanted a literal
string they would have searched for one.`;

export interface SearchRequest {
  meta: Meta;
  blocks: Block[];
  /** What the reader typed. */
  criterion: string;
  model?: string;
  signal?: AbortSignal;
  /** Overridable so a test can use a deadline it can actually wait for. */
  timeoutMs?: number;
  /** Overridable for the same reason as `timeoutMs`. */
  stallMs?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  model: string;
  /**
   * What the call cost and what the cache did.
   *
   * Returned as well as logged so `evals/prompt-caching.ts` reads the same
   * numbers the log line reports, rather than deriving its own and being able
   * to disagree with the app about whether caching is working.
   */
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
}

/**
 * The messages this stage will send, as a value — so a test can look at them
 * without a network.
 *
 * **The split into two content parts is the caching contract**, not formatting.
 * The first part is the article and nothing else, and it is byte-identical for
 * every search of the same piece; the second part is the reader's criterion,
 * which is different every time. The breakpoint goes between them, so the
 * article is written to the cache once and read back on every later search.
 *
 * Put the criterion in the first part and the whole thing stops working while
 * continuing to look right — see docs/reusable/silent-success.md, and
 * tests/article-prompt.test.ts, which pins the boundary.
 */
export function buildSearchMessages(
  meta: Meta,
  blocks: Block[],
  criterion: string,
): OpenRouterMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Here is the whole article.\n\n${articleWithIds(meta, blocks)}`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `The reader is looking for:\n\n"""\n${criterion}\n"""\n\nFind the passages that match. Reply with the JSON object and nothing else.`,
        },
      ],
    },
  ];
}

/** What validation threw away, so the log can say it out loud. */
export interface Dropped {
  /** Hits naming a block this article does not have. */
  unknownIds: number;
  /** Hits whose quote is not in the block they named. */
  unquoted: number;
  /** Hits whose confidence was outside 0–100 and had to be clamped. */
  clamped: number;
  /**
   * Hits whose confidence came back as 1 or less.
   *
   * **The unit-drift alarm**, and the reason it is counted rather than
   * corrected. See `SearchHit.confidence` in src/types.ts: the version this is
   * borrowed from documented the field as 0–1 and read it as 0–100, and the
   * conversion between the two was undocumented and invisible. If this model
   * ever starts answering in fractions, every wash on the page becomes
   * imperceptible and every number in the results list reads "1%" — visible to
   * a reader, but only if somebody knows to look. This makes it countable.
   *
   * It is deliberately **not** rescaled. Rescaling is a guess about which unit
   * the model meant, and a confident guess that is wrong paints the whole
   * article at the wrong intensity with nothing at all to see. A genuine 1%
   * match and a mis-scaled 100% match are indistinguishable from here.
   */
  subOne: number;
  /** Hits beyond MAX_HITS. Counted so a cap is never silent. */
  truncated: number;
}

/**
 * The hits worth keeping, and an account of what was thrown away.
 *
 * Exported for the tests, because this is the half of the file with the rules
 * in it and the half that must not be allowed to drift quietly.
 *
 * **The top-level shape is asserted, not defaulted.** `raw.hits` must be
 * present and an array — anything else (`{}`, `{hits:null}`, `{hits:"nope"}`,
 * a bare array, `null`) throws `PROVIDER_UNREADABLE` rather than silently
 * becoming `[]`. That used to be exactly the failure `parseHits`'s own
 * docstring names as the one a reader could not possibly diagnose: a broken
 * reply stored as the legitimate, meaningful answer "nothing in this article
 * matches" — which is precisely what `{"hits": []}` is supposed to mean, and
 * still does; only a genuinely missing or non-array `hits` is a failure here.
 * Found by a GPT Sol review, 2026-08-26.
 *
 * The order of the checks matters in one place: `quote` is checked against
 * `block.text` using src/quote-match.ts, which is **the same function the
 * browser uses to decide which characters to wash**. So a hit that survives
 * here is one the client can definitely draw, and a hit the client cannot draw
 * is one that never got stored. Without that agreement the panel would list a
 * passage the article does not mark, which looks like a rendering bug and is
 * not one.
 */
export function validateHits(
  raw: unknown,
  blocks: Block[],
): { hits: SearchHit[]; dropped: Dropped } {
  const list = (raw as { hits?: unknown } | null | undefined)?.hits;
  if (!Array.isArray(list)) {
    throw new Error(PROVIDER_UNREADABLE.message, { cause: "hits-not-an-array" });
  }
  const dropped: Dropped = { unknownIds: 0, unquoted: 0, clamped: 0, subOne: 0, truncated: 0 };
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const hits: SearchHit[] = [];

  for (const item of list) {
    const { blockId, quote, confidence, reasoning } = (item ?? {}) as Record<string, unknown>;
    if (typeof blockId !== "string" || typeof quote !== "string") continue;
    const block = byId.get(blockId);
    if (!block) {
      dropped.unknownIds++;
      continue;
    }
    const span = findQuote(block.text, quote);
    if (!span) {
      dropped.unquoted++;
      continue;
    }
    const asNumber = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 50;
    if (asNumber <= 1) dropped.subOne++;
    const bounded = Math.round(Math.min(100, Math.max(0, asNumber)));
    if (bounded !== Math.round(asNumber)) dropped.clamped++;
    hits.push({
      blockId,
      // The words as they appear in the block, not as the model retyped them.
      // `findQuote` is forgiving about whitespace and curly quotes, so the two
      // can differ — and storing the model's version would mean the stored
      // quote does not appear in the article, which is exactly the property
      // this validation is here to guarantee.
      quote: block.text.slice(span.start, span.end),
      confidence: bounded,
      reasoning: typeof reasoning === "string" ? reasoning.trim() : "",
      start: span.start,
    });
  }

  if (hits.length > MAX_HITS) {
    dropped.truncated = hits.length - MAX_HITS;
    hits.length = MAX_HITS;
  }
  return { hits, dropped };
}

/**
 * **Whose question produced the answer being parsed** — and specifically,
 * whether the reader can edit it.
 *
 * `parseHits` is Search's parser *and* Referee mode's: a criterion run, a claims
 * pull and a Mirror run all end in it. Only Search's reader typed the ask and
 * can make it smaller. Claims pulls the paper's own claims, Mirror reads the
 * referee's own comments, and a criterion is a saved row whose error state
 * offers *Try again* and nothing else — narrowing any of those three means
 * abandoning the thing and asking something different.
 *
 * The default is `"fixed"` deliberately: a caller that forgets to say gets the
 * message that promises the least, so a new sub-mode cannot inherit advice about
 * a control it does not have. Only src/search.ts's own `runSearch` passes
 * `"editable"`, and it gets `ANSWER_OVERFLOWED`; everything else gets
 * `ANSWER_OVERFLOWED_FIXED_ASK`, which is a different sentence under a different
 * code, for the reason src/messages.ts § `ANSWER_OVERFLOWED` gives.
 */
export type AskKind = "editable" | "fixed";

/**
 * The model's reply, parsed.
 *
 * Lenient about a code fence and about prose either side of the object, because
 * a model that has been told "JSON and nothing else" still sometimes says
 * "Here you go:" first — and losing a good answer to a preamble would be a
 * silly way to fail. **Not** lenient about the object itself: if there is no
 * parseable object in there, this throws, because the alternative is storing an
 * empty result that looks exactly like "nothing in this article matches".
 * That is the silent-success shape (docs/reusable/silent-success.md) and it is
 * the one failure a reader could not possibly diagnose.
 *
 * Three outcomes, not two, and the third is the one worth naming: an object
 * that starts and never finishes is a response cut off by `max_tokens`, and it
 * gets its own reader-facing sentence — which says the lever the reader actually
 * has, rather than sending them hunting for a JSON object that was never going
 * to be there. It is also the most likely real failure here, because the
 * answer's size grows with the number of hits and nothing else.
 *
 * **Which sentence depends on `ask`, and that is the whole of what the parameter
 * is for.** This parser is Search's and Referee mode's alike, and only Search's
 * caller has an ask the reader can edit; see `AskKind`.
 *
 * **Detected by walking forward from the opening `{` until IT balances to
 * zero, not by `lastIndexOf("}")` and not by checking whether the WHOLE
 * remainder balances.** Both of those were tried, in that order, and each had
 * a bug of its own:
 *
 * `lastIndexOf("}")` broke once streaming made "cut off after one complete
 * hit" a real case rather than a hypothetical one: once one hit closes, ITS
 * `}` is the last one anywhere in the text, so a genuinely truncated answer —
 * `{"hits":[{...one whole hit...},{"blockId":"spy` — read as a *complete*
 * object with trailing junk, fell into `JSON.parse` and failed there, and was
 * reported as `[ai-unreadable]` ("could not be read at all") rather than
 * `[ai-overflowed]` ("the answer was longer than there was room for") — sending
 * the reader to blame the provider for a limit this app itself set. See
 * tests/search.test.ts § "says cut off, not malformed, once a complete hit
 * has already streamed" for the case this fixes.
 *
 * The fix for that — balance the whole remainder of the text — broke the
 * trailing-prose leniency this very docstring promises two paragraphs up: a
 * perfectly complete `{"hits":[]}` followed by a chatty sign-off containing a
 * stray `{` ("Let me know if I can help with anything else! {") made the
 * *remainder* fail to balance, even though the object itself was whole, and
 * reported `[ai-overflowed]` for an answer that was actually fine.
 *
 * `objectEnd` is the version that survives both cases: it scans forward
 * from the opening `{` and returns the index where THAT bracket's own nesting
 * first returns to zero — the object's own matching `}` — ignoring everything
 * before `from` and everything after that point, trailing prose included.
 * Braces and brackets inside a quoted string don't count, the same way
 * `hitExtractor` in src/search-hits-stream.ts ignores them, for the same
 * reason — a literal `{` in a quoted example must not be counted as nesting.
 * If the text runs out before nesting returns to zero, the object never
 * closed — that is the cut-off case.
 *
 * **`objectEnd` lives in src/parse-json.ts now**, not below. It was private to
 * this file while `parseHits` was the only caller that dug its JSON out of a
 * longer response — and src/parse-json.ts said as much, in a sentence that two
 * paid production steps disproved on 2026-09-03. Eleven stages reach the same
 * scan through `parseJsonAnswer` there. What `parseHits` keeps for itself is
 * the three-way mapping below — no `{` at all and balanced-but-invalid both
 * become `PROVIDER_UNREADABLE`, while never closing becomes
 * `ANSWER_OVERFLOWED` — because those are reader-facing sentences and a
 * `MalformedJson` cannot tell them apart. **Do not re-express this in terms of
 * `parseJsonAnswer`**: it is also deliberately more lenient, reading a
 * trailing sign-off with a stray `{` in it that a stage's parse now refuses.
 * Search shows the reader its result and an empty one is arguable; a stage
 * writes an artefact nobody sees again.
 */
export function parseHits(text: string, ask: AskKind = "fixed"): unknown {
  const trimmed = stripFence(text);
  const from = trimmed.indexOf("{");
  if (from === -1) {
    throw new Error(PROVIDER_UNREADABLE.message, { cause: "no-object" });
  }
  const end = objectEnd(trimmed.slice(from));
  if (end === -1) {
    const overflowed = ask === "editable" ? ANSWER_OVERFLOWED : ANSWER_OVERFLOWED_FIXED_ASK;
    throw new Error(overflowed.message, { cause: "cut-off" });
  }
  const to = from + end;
  try {
    return JSON.parse(trimmed.slice(from, to + 1));
  } catch {
    throw new Error(PROVIDER_UNREADABLE.message, { cause: "malformed-json" });
  }
}

/**
 * What a hit is, for the purpose of noticing that two lists of them differ.
 *
 * `blockId:start` rather than the quote: the quote is article prose and must
 * not reach a log (docs/project/logging.md), and the pair is already unique —
 * a block cannot hold two hits beginning at the same character.
 */
export function hitIdentities(hits: SearchHit[]): string[] {
  return hits.map((h) => `${h.blockId}:${h.start}`);
}

/**
 * Did what the reader was shown differ from what got stored?
 *
 * **Order matters**, which is why this is not a set comparison: hits are ranked
 * best-first and the ranking is most of the value, so the same hits in a
 * different order is a divergence worth knowing about.
 *
 * Exported, and that is the whole point of it existing as a function at all.
 * An alarm that has never been observed to fire is indistinguishable from an
 * alarm that cannot — and this one lives in a log line, which nothing in these
 * tests reads. Pulling the judgement out means the judgement can be tested even
 * though the wiring cannot.
 */
export function disagree(streamed: string[], final: string[]): boolean {
  return streamed.length !== final.length || streamed.some((id, i) => id !== final[i]);
}

/**
 * A hit that arrived mid-stream. Provisional: best-first, already through the
 * same per-item validation as the final pass, but the final `done` is
 * authoritative and may differ. Exactly one `done` event, last, ever — see
 * the module docstring § Streaming.
 */
export type SearchEvent =
  | { type: "hit"; hit: SearchHit }
  | { type: "done"; result: SearchResult };

/**
 * Thrown when the reader has disconnected and there is nothing left to say to
 * them. Deliberately NOT one of the `[ai-*]` reader-facing sentences in
 * src/messages.ts — those exist for somebody who is still there to read one
 * and act on it, and a disconnect is neither the model's failure nor the
 * reader's mistake. See where `stopped` is declared in `findPassagesStream`
 * for the three outcomes this is one of.
 */
const READER_LEFT = "The reader disconnected before this search finished.";

/**
 * Search a whole article, a few hits at a time.
 *
 * This is the whole implementation; `findPassages` below drains it. Modelled
 * line for line on `explainStream` in src/explain.ts, including the two
 * clocks and the checks after the loop — see that file for why each one is
 * there and what broke before it was.
 *
 * **What's different from `explainStream`:** no tools, so no annotations to
 * collect; and the payload is not prose to show as it arrives, it's one JSON
 * object, so `hitExtractor` (src/search-hits-stream.ts) sits between the raw
 * text and what gets yielded. `validateHits` runs on every candidate the
 * extractor completes, one item at a time, and only a survivor is yielded —
 * so a hit shown mid-stream has already passed the exact check the final
 * pass will run again on the whole text.
 */
export async function* findPassagesStream({
  meta,
  blocks,
  criterion,
  model = defaultModel(),
  signal,
  timeoutMs = SEARCH_TIMEOUT_MS,
  stallMs = SEARCH_STALL_MS,
}: SearchRequest): AsyncGenerator<SearchEvent> {
  const line = log("model");

  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    // Two audiences, two sentences — see NOT_CONFIGURED in src/messages.ts.
    // This one is for whoever runs the server; the thrown message is for the
    // reader, and does not name an environment variable or a dotfile.
    line.error("OPENROUTER_API_KEY is not set — every search will fail");
    throw new Error(NOT_CONFIGURED.message);
  }

  const messages = buildSearchMessages(meta, blocks, criterion);

  /* Whether the article is even long enough to cache. Logged, never thrown: a
     short piece is a fine piece, it just cannot be cached, and below the floor
     the breakpoint is accepted and does nothing — zeros in both usage fields,
     which is indistinguishable from a cache that has broken. Saying it out loud
     here is what makes the difference visible. */
  const tooShortToCache = underCacheFloor(cachedText(messages));

  const deadline = AbortSignal.timeout(timeoutMs);
  /* A separate clock from the deadline, restartable on every chunk — see
     SEARCH_STALL_MS and explain.ts's EXPLAIN_STALL_MS for why a stall timer
     has to be its own controller rather than another `AbortSignal.timeout`. */
  const stall = new AbortController();
  let stallTimer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stall.abort(new Error("stalled")), stallMs);
  };

  /* Our own clock rather than anything the provider reports — see explain.ts
     for the outage that rule came from. It starts before the request and stops
     after the stream ends, because that whole span is what the reader spends
     watching the spinner (or, now, watching hits arrive). */
  const started = Date.now();
  const composite = AbortSignal.any(
    signal ? [signal, deadline, stall.signal] : [deadline, stall.signal],
  );

  /* **The request, the status check and the spend record are one operation now**
     — src/ai-call.ts. What used to be here was a `fetch`, its own copy of the
     attribution headers, its own copy of `PROVIDER_ORDER`, and a `!response.ok`
     branch that could return between paying for a call and recording it. The
     clocks stay here; the transport does not. */
  touch();
  /* Which of two sentences a failure gets logged with. With the fetch inside the
     generator, "no reply at all" and "the stream broke off" arrive at the same
     `catch`, so the difference has to be remembered rather than inferred. */
  let answered = false;
  const request = {
    model,
    /* Room for twenty hits, each carrying a quote and a sentence. Set with
       MAX_HITS in mind rather than picked round: a ceiling too low truncates
       the JSON mid-object, and a truncated object is not a short list, it is
       a parse error — which `parseHits` reports as one rather than as an
       empty result. */
    max_tokens: 4000,
    // No tools. See the header: the question is always "where in this
    // piece", and no page on the web can answer it.
    messages,
  };

  const extractor = hitExtractor();
  let emitted = 0;
  /* The ordered identity of every hit shown mid-stream — blockId plus its
     offset into the block (disambiguates two hits landing on the same
     block) — so the mismatch alarm on the final log line can say WHICH hits
     diverged, not just that the counts happened to differ. See its use
     below. */
  const emittedIds: string[] = [];
  let used = model;
  let usage: Usage | undefined;
  const end: StreamEnd = { terminated: false };
  /* Three deliberate outcomes when the reader disconnects, not two by
     accident and a third nobody designed:
       - the buffered text already parses and validates cleanly → treated
         exactly like an ordinary finished search — nothing was lost, so
         nothing is thrown away. See the cancellation test "cancelling once
         the text is already complete still produces a `done`".
       - it does not (empty, incomplete, or malformed) → NOT a provider
         failure and NOT the reader's mistake: logged at `info`, never
         `error`, and thrown as `READER_LEFT` rather than one of the
         ai-coded reader-facing sentences below, which would misreport a
         disconnect as the model's fault or invite a retry nobody asked for.
       - the initial fetch never replies before the reader leaves → the same
         rule, in the catch around it above.
     `stopped` is what the checks below share. It is no longer a flag set in
     two places: it is one reading of `classifyEnd`'s answer, taken once after
     the loop — see the switch below, and
     docs/plans/260901g-one-stream-end-classification-shared-by-five-callers.md. */
  try {
    // malformedFrames: "throw" — a dropped SSE frame here can drop a whole
    // hits-array element while leaving JSON either side that still parses,
    // which is the opposite of the trade chat and explain make. See
    // `SseChunksOptions` in src/openrouter-stream.ts.
    for await (const chunk of openRouterStream("search", request, {
      signal: composite,
      onActivity: touch,
      end,
      /* **Strict, unlike the other two.** Their payload is prose, where a dropped
         frame costs a few words; this one carries a single JSON object, where a
         dropped frame can lose a whole hit and still leave text that parses. */
      malformedFrames: "throw",
    })) {
      answered = true;
      if (chunk.model) used = chunk.model;
      // A 200 that carries an error in the stream — a mid-generation provider
      // failure. It arrives as data, not as a broken connection.
      if (chunk.error) throw providerFailedMidAnswer();
      const choice = chunk.choices?.[0];
      /* No `finish_reason` scrape here any more: `openRouterStream` writes it
         onto `end` for every caller, and `classifyEnd` below is what reads it.
         This line was one of seven identical copies —
         docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md. */
      const piece = choice?.delta?.content;
      if (typeof piece === "string" && piece.length > 0) {
        // Fed unconditionally, cap or no cap — `text()` has to stay complete
        // for the final strict parse below regardless of how much has already
        // been shown to the reader.
        for (const raw of extractor.push(piece)) {
          if (emitted >= MAX_HITS) break; // MAX_HITS respected while streaming too.
          // The one rule, run on a single candidate. Not a copy of validateHits
          // — see the module docstring § Streaming.
          const survivor = validateHits({ hits: [raw] }, blocks).hits[0];
          if (!survivor) continue;
          emitted++;
          emittedIds.push(...hitIdentities([survivor]));
          yield { type: "hit", hit: survivor };
        }
      }
      // Held for the log line and the return value after the loop: the usage
      // chunk is normally the last of all and carries no choices, so it would
      // otherwise be seen and dropped.
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (err) {
    if (stoppedByReader(err, signal, deadline, stall.signal)) {
      /* The caller gave up — see explain.ts's note on the same check. Not an
         error, and not logged as one. **Nothing is said or decided here**: this
         falls through to `classifyEnd`, which reaches `abandoned` from the same
         signals, so the throwing path and the clean-end path cannot come to say
         different things about one event. They used to be two branches, and
         only one of them logged. */
      clearTimeout(stallTimer);
    } else if (err instanceof ProviderRefused) {
      /* The status, not the body. OpenRouter's error text is the one place a
         provider might echo part of what we sent, and what we sent is the whole
         article plus the reader's criterion — so `ProviderRefused` carries the
         number and nothing else. */
      line.error(
        { model, ms: since(started), status: err.status },
        `OpenRouter refused: ${err.status}`,
      );
      throw err;
    } else {
      line.error(
        {
          ...errorFields(err),
          model: used,
          ms: since(started),
          timedOut: deadline.aborted,
          stalled: stall.signal.aborted,
          chars: extractor.text().length,
        },
        answered
          ? `stream from ${used} broke off`
          : `no reply from ${model}${deadline.aborted ? " — deadline fired" : ""}`,
      );
      throw explainAbort(err, deadline, stall.signal, timeoutMs, stallMs);
    }
  } finally {
    clearTimeout(stallTimer);
  }

  /* **How did this stream end?** One question with one true answer, asked of
     the shared classifier rather than re-derived here from three signals, a
     boolean and a string. This file used to do that re-derivation in the same
     order as six others, with the same broken guard in it —
     docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md.

     What each ending *means* is still search's. It differs from everybody
     else's in one way that matters: the payload is a single JSON object, so a
     reply that stopped early usually fails the strict parse below and is caught
     there, with a sentence about the answer rather than about the stream. */
  const outcome = classifyEnd(end, { signal, deadline, stalled: stall.signal });
  const finishReason = end.finishReason ?? null;
  /* The three deliberate outcomes described where this used to be declared, now
     read once from the classifier instead of set in two places. */
  const stopped = outcome.kind === "abandoned";

  switch (outcome.kind) {
    case "abandoned":
      /* **This line is new on one of the two paths, and that is the point.** A
         reader-abort that *threw* was logged in the catch; one that ended the
         loop cleanly — `sseChunks` cancels its reader, and a cancelled read
         resolves `{ done: true }` — set a flag and said nothing. Same event,
         two paths, one of them silent.

         So a clean abort can now produce this line *and* one of the specific
         abandonment lines below (duplicate key, empty text, unparseable). That
         pairing is not new: it is what the throwing path has always done, and
         the two carry different things — this one has `chars` and whether the
         model ever answered, those have what the buffer turned out to be. */
      line.info(
        { model: used, ms: since(started), chars: extractor.text().length },
        answered
          ? `search from ${used} was abandoned`
          : `search was abandoned before ${model} replied`,
      );
      break;

    case "timed-out":
    case "went-quiet":
      line.error(
        {
          model: used,
          ms: since(started),
          timedOut: deadline.aborted,
          stalled: stall.signal.aborted,
          chars: extractor.text().length,
        },
        `stream from ${used} was cut off`,
      );
      throw explainAbort(new Error("aborted"), deadline, stall.signal, timeoutMs, stallMs);

    case "provider-failed":
      /* The same failure as the `chunk.error` throw in the loop, arriving in a
         field instead of as data — so the same sentence, deliberately. This is
         the one behaviour this migration changed: under the old guard a
         non-null reason could only make the conjunction *less* likely to fire,
         so a provider that said `error` was handed to the strict parse and
         reported, if it happened to parse, as a finished search. */
      line.error(
        { model: used, ms: since(started), chars: extractor.text().length, finishReason },
        `the provider gave up mid-search from ${used}`,
      );
      throw providerFailedMidAnswer();

    case "unterminated":
      line.error(
        { model: used, ms: since(started), chars: extractor.text().length },
        `stream from ${used} ended without finishing`,
      );
      throw new Error(ENDED_UNFINISHED.message);

    case "truncated":
    case "filtered":
      /* **Left to the parse below, which is a better witness here than the
         reason is.** A search reply is one JSON object: cut it off anywhere and
         it does not parse, and the reader gets ANSWER_OVERFLOWED, which names
         the actual problem. A `length` that lands *after* the object closed is
         a legitimately short result — refusing it would throw away hits the
         reader can already see. Quiz refuses both because a mark is prose with
         no parse to fail. */
      break;

    case "unknown-finish-reason":
      /* Accepted as a clean stop, on the deny-list reasoning quiz-mark spells
         out: a gateway spelling `stop` as `end_turn` would otherwise fail every
         search for that model. The reason is on the success log line. */
      break;

    case "wants-tools":
      /* This request sends no tools. The web-search tool explain uses is not
         offered here, so a model asking for one is a provider oddity. */
      break;

    case "finished":
      break;

    default: {
      /* The point of the union. A tenth way for a stream to end becomes a
         compile error here rather than a branch somebody forgot. */
      const never: never = outcome;
      throw new Error(`unhandled stream outcome: ${JSON.stringify(never)}`);
    }
  }

  /* Two top-level `hits` keys. `JSON.parse` keeps the last silently, and the
     extractor previewed from the first — so storing the final parse would mean
     the reader was shown one set of passages and a different set was saved.
     There is no repairing that from here: the preview has already been on
     screen. Refusing the whole reply is the only answer that leaves nothing
     wrong *stored*, which is the guarantee the streaming design actually makes.
     Found by review, 2026-08-26; see src/search-hits-stream.ts § the safety
     property. */
  if (extractor.duplicateHitsKey()) {
    /* `stopped` first, like the two checks below it. This one was written an
       hour before they were and did not have the guard, which is how an
       inconsistency of exactly this kind gets in: the window is narrow — a
       duplicate key can only be seen after a first array has fully closed — so
       nobody would have found it by using the app. A reader who disconnected in
       that window would have been told the model misbehaved, and the log would
       have carried it at `error`. Flagged in review by the agent that wrote the
       other two guards, which is the argument for having them read each
       other's work. */
    if (stopped) {
      line.info(
        { model: used, ms: since(started) },
        `search from ${used} was abandoned before the duplicate key mattered`,
      );
      throw new Error(READER_LEFT);
    }
    line.error(
      { model: used, ms: since(started), chars: extractor.text().length },
      `${used} sent more than one "hits" key`,
    );
    throw new Error(PROVIDER_UNREADABLE.message, { cause: "duplicate-hits-key" });
  }

  const rawText = extractor.text();
  if (rawText.trim() === "") {
    if (stopped) {
      // The reader left before any content arrived at all. Not "the model
      // returned no text" — the model may never have been asked to finish.
      // See where `stopped` is declared for the three outcomes.
      line.info({ model: used, ms: since(started) }, `search from ${used} was abandoned`);
      throw new Error(READER_LEFT);
    }
    line.error({ model: used, ms: since(started), finishReason }, `${used} returned no text`);
    throw new Error(saidNothing(finishReason).message);
  }

  // The authoritative pass — a strict whole-text parse, not the extractor's
  // best-effort one, then the same shape-and-content validation the mid-
  // stream preview ran per item. See the module docstring § Streaming.
  let hits: SearchHit[];
  let dropped: Dropped;
  try {
    /* `"editable"` — the reader typed this ask and can make it smaller, which is
       the one caller of `parseHits` that is true of. See `AskKind`. */
    ({ hits, dropped } = validateHits(parseHits(rawText, "editable"), blocks));
  } catch (err) {
    if (stopped) {
      /* The reader already left, and what's buffered is an incomplete or
         otherwise unparseable object — the ORDINARY shape a disconnect
         leaves behind, not a provider failure and not something the model
         got wrong. Logging it as a parse error and reporting
         ANSWER_OVERFLOWED/PROVIDER_UNREADABLE, as the branch below does for
         a genuine failure, would blame the model for an answer nobody is
         waiting on any more. See where `stopped` is declared. */
      line.info(
        { model: used, ms: since(started), chars: rawText.length },
        `search from ${used} was abandoned before its answer finished`,
      );
      throw new Error(READER_LEFT);
    }
    /* Two different throws land here, both reduced to one reader-facing
       sentence — PROVIDER_UNREADABLE, or ANSWER_OVERFLOWED for a cut-off
       answer — because none of "no object", "malformed JSON", or "hits is
       missing or not an array" is a distinction a reader can act on
       differently. The distinction IS real and worth keeping for whoever
       reads this log, so it travels on the Error's `cause` rather than being
       lost when the messages were merged: see parseHits's docstring for the
       first two, and validateHits's for the third. */
    line.error(
      { model: used, ms: since(started), reason: (err as Error).cause ?? "?" },
      `${used}'s answer could not be parsed`,
    );
    throw err;
  }

  // Same identity shape as `emittedIds` above, computed from the
  // authoritative final `hits` — used only to build the mismatch alarm below.
  const finalIds = hitIdentities(hits);
  const streamedMismatch = disagree(emittedIds, finalIds);

  /* One line per finished search.
     The `dropped` counts are the point of it, and each is invisible from
     the outside: a dropped hit looks exactly like a passage the model chose not
     to return, and "nothing in this article matches that" is a legitimate
     answer a reader sees. `unknownIds` climbing means the id contract has
     stopped working; `unquoted` climbing means the model has started
     paraphrasing what it claims to be quoting; `subOne` at all means the
     confidence unit has drifted. See docs/reusable/silent-success.md.
     Wrapped, because logging must not be able to fail a search that already
     succeeded. */
  try {
    line.info(
      {
        model: used,
        ms: since(started),
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        /* The only alarm there is. A cache that has silently stopped hitting
           looks exactly like one that is working — same response, no error,
           just a bigger bill. `cacheReadTokens` sitting at 0 across repeated
           searches of one article is the signal, and `tooShortToCache` says
           whether that 0 is expected. docs/reusable/silent-success.md. */
        cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        // Two spellings of the write count — see the `Usage` type in
        // openrouter-stream.ts for why both are read.
        cacheWriteTokens:
          usage?.prompt_tokens_details?.cache_write_tokens ?? usage?.cache_write_tokens ?? null,
        tooShortToCache,
        hits: hits.length,
        /* How many hits were already shown to the reader before this strict
           final parse ran. A count next to `hits` is not the alarm on its
           own — the SAME count with different hits inside it would look
           identical and be exactly the silent kind of wrong
           (docs/reusable/silent-success.md), so `streamedMismatch` compares
           the actual ordered identity (blockId + offset, which disambiguates
           two hits landing on the same block) shown mid-stream against what
           the authoritative pass kept, and the two lists ride along so a
           mismatch is diagnosable rather than just detectable. They SHOULD
           always agree — every mid-stream hit already passed validateHits —
           and a `true` here means the extractor (search-hits-stream.ts) is
           completing an object that JSON.parse over the whole text reads
           differently. There is nothing sensitive in a block id or an
           offset — see the module docstring's own privacy rule, which is
           about the criterion, the quote and the reasoning, none of which
           are here. */
        streamedHits: emitted,
        streamedMismatch,
        streamedIds: emittedIds,
        finalIds,
        criterionChars: criterion.length,
        blocks: blocks.length,
        ...dropped,
        finishReason,
      },
      `searched an article with ${used} (${hits.length} passage${hits.length === 1 ? "" : "s"})`,
    );
  } catch {
    // Nothing worth failing a reader's search over.
  }

  yield {
    type: "done",
    result: {
      hits,
      model: used,
      usage: {
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens:
          usage?.prompt_tokens_details?.cache_write_tokens ?? usage?.cache_write_tokens ?? null,
      },
    },
  };
}

/**
 * The same search, waited for rather than watched.
 *
 * A thin drain of `findPassagesStream`, so there is one implementation of the
 * request, the clocks and the end-of-stream invariants rather than two.
 * Everything that called `findPassages` before streaming existed keeps
 * working unchanged.
 */
export async function findPassages(req: SearchRequest): Promise<SearchResult> {
  for await (const event of findPassagesStream(req)) {
    if (event.type === "done") return event.result;
  }
  /* Unreachable by the generator's own contract — it yields `done` or throws —
     and here so that a future edit which breaks that contract fails loudly
     instead of returning `undefined` as a result. */
  throw new Error("The search ended without a result.");
}
