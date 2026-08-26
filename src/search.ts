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
 * | what comes back | prose | streamed prose | **a list of ids** |
 * | web search | yes | yes | **no** |
 *
 * Those last two rows are the whole design.
 *
 * **The answer is data, not prose**, so this call is the one that has to be
 * validated rather than merely displayed. A hallucinated block id in a chat
 * answer renders as plain text and costs the reader a link
 * (docs/plans/chat-mode.md § The citation contract); a hallucinated block id
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
 * ## Logging
 *
 * One line per finished search under the `model` component — the same fields
 * explain.ts logs, plus the four counts below. **Never the criterion, never a
 * quote, never the article, never the key.** A criterion is as private as a
 * selection: it is what somebody was looking for.
 */
import type { Block, Meta, SearchHit } from "./types.js";
import { loadEnvLocal } from "./env.js";
import { findQuote } from "./quote-match.js";
import { OPENROUTER_MODEL } from "./models.js";
import { errorFields, log, since } from "./log.js";
import {
  PROVIDER_ORDER,
  providerFailedMidAnswer,
  providerRefused,
} from "./openrouter-stream.js";
import {
  type OpenRouterMessage,
  articleWithIds,
  cachedText,
  underCacheFloor,
} from "./article-prompt.js";

/** Overridable with `SPIDERYARN_SEARCH_MODEL`; the default is app-wide. */
export const DEFAULT_MODEL = OPENROUTER_MODEL;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

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
  timeoutMs?: number;
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
  const dropped: Dropped = { unknownIds: 0, unquoted: 0, clamped: 0, subOne: 0, truncated: 0 };
  const list = Array.isArray((raw as { hits?: unknown })?.hits)
    ? ((raw as { hits: unknown[] }).hits)
    : [];
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
 */
export function parseHits(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const from = trimmed.indexOf("{");
  const to = trimmed.lastIndexOf("}");
  /* Three outcomes, not two, and the third is the one worth naming: an object
     that starts and never finishes is a response cut off by `max_tokens`, and
     saying "the model did not return a JSON object" would send whoever reads
     the error hunting through the prompt rather than at the token ceiling. It
     is the most likely real failure here, because the answer's size grows with
     the number of hits and nothing else. */
  if (from !== -1 && to <= from) {
    throw new Error("The model's answer was cut off before it finished.");
  }
  if (from === -1) {
    throw new Error("The model did not return a JSON object of passages.");
  }
  try {
    return JSON.parse(trimmed.slice(from, to + 1));
  } catch {
    throw new Error("The model's list of passages was not valid JSON.");
  }
}

export async function findPassages({
  meta,
  blocks,
  criterion,
  model = process.env.SPIDERYARN_SEARCH_MODEL || DEFAULT_MODEL,
  signal,
  timeoutMs = SEARCH_TIMEOUT_MS,
}: SearchRequest): Promise<SearchResult> {
  const line = log("model");

  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    line.error("OPENROUTER_API_KEY is not set — every search will fail");
    throw new Error(
      "OPENROUTER_API_KEY is not set. Put it in .env.local — see docs/project/setup-dev.md.",
    );
  }

  const messages = buildSearchMessages(meta, blocks, criterion);

  /* Whether the article is even long enough to cache. Logged, never thrown: a
     short piece is a fine piece, it just cannot be cached, and below the floor
     the breakpoint is accepted and does nothing — zeros in both usage fields,
     which is indistinguishable from a cache that has broken. Saying it out loud
     here is what makes the difference visible. */
  const tooShortToCache = underCacheFloor(cachedText(messages));

  const deadline = AbortSignal.timeout(timeoutMs);
  /* Our own clock rather than anything the provider reports — see explain.ts
     for the outage that rule came from. It starts before the request and stops
     after the body is parsed, because that whole span is what the reader
     spends watching the spinner. */
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5273",
        "X-Title": "Spideryarn",
      },
      body: JSON.stringify({
        model,
        /* Room for twenty hits, each carrying a quote and a sentence. Set with
           MAX_HITS in mind rather than picked round: a ceiling too low truncates
           the JSON mid-object, and a truncated object is not a short list, it is
           a parse error — which `parseHits` reports as one rather than as an
           empty result. */
        max_tokens: 4000,
        // No tools. See the header: the question is always "where in this
        // piece", and no page on the web can answer it.
        provider: PROVIDER_ORDER,
        messages,
      }),
    });
  } catch (err) {
    line.error(
      { ...errorFields(err), model, ms: since(started), timedOut: deadline.aborted },
      `no reply from ${model}${deadline.aborted ? " — deadline fired" : ""}`,
    );
    if (deadline.aborted) {
      throw new Error(
        `The model did not answer within ${Math.round(timeoutMs / 1000)}s. Try again.`,
      );
    }
    throw err;
  }

  if (!response.ok) {
    /* Drained and dropped without being looked at. The body has to be
       consumed or the connection leaks, but nothing here wants to know
       what it said — see `providerRefused`. */
    await response.text().catch(() => "");
    // The status, not the body. OpenRouter's error text is the one place a
    // provider might echo part of what we sent, and what we sent is the whole
    // article plus the reader's criterion.
    line.error(
      { model, ms: since(started), status: response.status },
      `OpenRouter refused: ${response.status}`,
    );
    throw providerRefused(response.status);
  }

  let body: OpenRouterResponse;
  try {
    body = (await response.json()) as OpenRouterResponse;
  } catch (err) {
    line.error({ ...errorFields(err), model, ms: since(started) }, `unreadable reply from ${model}`);
    throw err;
  }
  if (body.error) {
    line.error({ model, ms: since(started) }, `${model} returned an error`);
    throw providerFailedMidAnswer();
  }

  const answer = body.choices?.[0]?.message?.content?.trim();
  const finishReason = body.choices?.[0]?.finish_reason ?? "?";
  if (!answer) {
    line.error({ model, ms: since(started), finishReason }, `${model} returned no text`);
    throw new Error(`The model returned no text (finish_reason: ${finishReason}).`);
  }

  const { hits, dropped } = validateHits(parseHits(answer), blocks);
  const used = body.model ?? model;

  /* One line per finished search.
     The four `dropped` counts are the point of it, and each is invisible from
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
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        /* The only alarm there is. A cache that has silently stopped hitting
           looks exactly like one that is working — same response, no error,
           just a bigger bill. `cacheReadTokens` sitting at 0 across repeated
           searches of one article is the signal, and `tooShortToCache` says
           whether that 0 is expected. docs/reusable/silent-success.md. */
        cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens: body.usage?.prompt_tokens_details?.cache_write_tokens ?? null,
        tooShortToCache,
        hits: hits.length,
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

  return {
    hits,
    model: used,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? null,
      completionTokens: body.usage?.completion_tokens ?? null,
      cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? null,
      cacheWriteTokens: body.usage?.prompt_tokens_details?.cache_write_tokens ?? null,
    },
  };
}

interface OpenRouterResponse {
  model?: string;
  error?: { message: string };
  choices?: { finish_reason?: string; message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /* What the cache actually did. **Both live inside `prompt_tokens_details`**
       — `cached_tokens` for reads, `cache_write_tokens` for writes.

       Worth stating because the first version of this read the write count from
       `usage.cache_write_tokens`, one level too high. The research had it right
       (docs/research/prompt-caching-openrouter.md § Pricing); it was read
       carelessly. The wrong path is `undefined` forever, so every log line said
       `cacheWriteTokens: null` while the reads beside it were real — and `null`
       here means "we were not told", which is exactly what a provider that had
       genuinely not sent the field would look like. Nothing was red: the unit
       tests never see a response. It was caught by running
       evals/prompt-caching.ts against the live API and asking why a number was
       missing. docs/reusable/silent-success.md. */
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
}
