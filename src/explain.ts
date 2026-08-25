/**
 * The one LLM call that happens in a request handler rather than in the
 * pipeline — explaining a stretch of prose the reader selected.
 *
 * architecture.md says "LLM calls happen in the pipeline, not in request
 * handlers", and this is the deliberate exception: the input is the reader's
 * selection, which does not exist until they make it, so there is nothing to
 * precompute. See docs/project/comments.md § Why this call is not a pipeline stage.
 *
 * ## Provider
 *
 * OpenRouter, not the Anthropic SDK the pipeline uses, because `OPENROUTER_API_KEY`
 * is the key this project has. Same OpenAI-shaped request either way.
 *
 * ## Web research
 *
 * Greg, 2026-08-25, asked for the search to be **model-invoked** — "but encourage
 * the model to ask for it unless it's very sure". So the encouragement lives in
 * the system prompt and the choice stays with the model.
 *
 * That is `tools: [{ type: "openrouter:web_search" }]`, the server tool. It is
 * *not* the `plugins: [{ id: "web" }]` form this file used first: the plugin
 * always runs exactly one search per request, whatever the model wanted. Both
 * shapes return url citations and both look fine in a dialog, which is why the
 * mistake survived — see docs/reusable/silent-success.md.
 *
 * The count is read from `usage.server_tool_use_details.web_search_requests`,
 * **and** from `usage.server_tool_use.web_search_requests`, because OpenRouter's
 * docs and OpenRouter's actual responses disagree about which one it is: the
 * docs show `server_tool_use`, a live Sonnet call on 2026-08-25 came back with
 * `server_tool_use_details`. Reading both is not defensive padding — it is the
 * only way to be right today and stay right if they reconcile the two.
 *
 * Getting that path wrong is invisible, which is why it is spelled out here: a
 * missing field reads as `0`, and "no web search needed" is exactly what a
 * reader expects to see sometimes, so nothing looks broken.
 *
 * ## Logging
 *
 * This is the only model call in the app with a person waiting on it, so it is
 * the only one whose latency is a *reader-facing* fact. Every call writes one
 * line under the `model` component — see docs/project/logging.md — carrying the
 * model actually used, the wall-clock milliseconds, the token counts, the number
 * of web searches, and **which usage field that number came from**
 * (`searchesFrom`). That last field exists to make the invisible failure above
 * visible: if it ever reads `neither` on every call, OpenRouter has moved the
 * field again and the count has quietly become a permanent zero.
 *
 * **What never reaches the log: the prompt, the article text, the reader's
 * selected quote, the model's answer, and the API key.** A selection is the most
 * private thing in this app — it is what somebody was puzzled by. Counts, ids,
 * timings, model name and HTTP status only.
 */
import type { Block, Citation, Meta } from "./types.js";
import { loadEnvLocal } from "./env.js";
import { OPENROUTER_MODEL } from "./models.js";
import { errorFields, log, since } from "./log.js";

/**
 * Overridable with `SPIDERYARN_EXPLAIN_MODEL`. The default is the app-wide one
 * in src/models.ts — this call used to name its own model, which is how it came
 * to be a version behind the rest of the app without anyone noticing.
 */
export const DEFAULT_MODEL = OPENROUTER_MODEL;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * How long to wait for the model before giving up.
 *
 * `fetch` has no deadline of its own, so without this a request that never
 * comes back leaves the comment `pending` on disk and a spinner on screen for
 * as long as the tab is open — and a reload finds the same spinner, because
 * `pending` is exactly what a crash mid-answer leaves behind too. A deadline is
 * what turns "never finished" into a stored `error` the reader can retry.
 *
 * Ninety seconds because the model may run several web searches before it says
 * anything, and cutting off a search that was going to answer the question is
 * worse than waiting.
 */
export const EXPLAIN_TIMEOUT_MS = 90_000;

/**
 * The whole article goes in the prompt every time — Greg asked for the answer to
 * be given "the whole text of the article", and a selection is almost always
 * ambiguous without it ("this move", "the same objection"). At ~15k tokens for
 * the test article that is a few cents a question, which is the right trade for
 * a tool whose entire point is understanding the piece rather than skimming it.
 */
const SYSTEM = `You are a reading assistant. A reader is part-way through an article and has
selected a passage they want explained. Explain it.

You are here to make deep reading cheaper, not optional. The reader can see the
words already; what they lack is whatever the passage assumes they know.

WHAT A GOOD ANSWER DOES

- Says what the passage actually claims, in plainer words, WITHOUT flattening it
  into "the author argues that…". Keep the author's own distinctive vocabulary;
  those words are what the reader will meet again further down the page.
- Supplies the missing context: the term of art, the named person, the debate
  being alluded to, the earlier passage this one is answering.
- Says where it sits in the argument — what it is responding to, what it sets up.
- Marks a genuine ambiguity as ambiguous instead of picking a reading and
  sounding confident about it.

WHAT IT MUST NOT DO

- Do not summarise the article. The reader is reading it.
- Do not praise or grade the writing.
- Do not pad. Two or three short paragraphs is usually right; one is often
  better. Never more than four.
- Do not invent. If the article does not say, say that it does not say.

WEB RESEARCH

You have a web search tool. USE IT unless you are genuinely sure — a name, a
study, a technical term, a book, a live controversy, anything post-dating your
training, or any fact you would hedge about. Being unsure and not checking is
the worst outcome here; a search you did not need costs almost nothing. When you
have searched, ground the relevant sentence in what you found.

FORMAT

Plain prose paragraphs, separated by blank lines. No headings, no bullet lists,
no preamble like "This passage means". Begin with the explanation itself.`;

export interface ExplainRequest {
  meta: Meta;
  blocks: Block[];
  /** The block the selection sits in — marked in the prompt so "this" resolves. */
  blockId: string;
  quote: string;
  model?: string;
  signal?: AbortSignal;
  /** Overridable so a test can use a deadline it can actually wait for. */
  timeoutMs?: number;
}

export interface ExplainResult {
  answer: string;
  citations: Citation[];
  searches: number;
  model: string;
}

/** The article as a numbered block list, with the reader's block called out. */
function renderArticle(meta: Meta, blocks: Block[], blockId: string): string {
  const body = blocks
    .map((b, i) => `[${i}]${b.id === blockId ? " ←READER IS HERE" : ""} ${b.id}: ${b.text}`)
    .join("\n\n");
  const head = [
    `TITLE: ${meta.title}`,
    meta.byline ? `BY: ${meta.byline}` : null,
    meta.siteName ? `PUBLISHED IN: ${meta.siteName}` : null,
    meta.url ? `URL: ${meta.url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${head}\n\n---\n\n${body}`;
}

export async function explain({
  meta,
  blocks,
  blockId,
  quote,
  model = process.env.SPIDERYARN_EXPLAIN_MODEL || DEFAULT_MODEL,
  signal,
  timeoutMs = EXPLAIN_TIMEOUT_MS,
}: ExplainRequest): Promise<ExplainResult> {
  // One child per call, carrying the block the selection sits in. An id, not the
  // selection itself: enough to line a log line up with the stored comment,
  // without putting the words the reader was puzzled by into the log.
  const line = log("model").child({ blockId });

  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    // Two audiences, two sentences. The thrown message tells the reader (and
    // whoever is setting the project up) what to do; this line tells whoever is
    // running the server that explanations are failing for a configuration
    // reason rather than a model one, which is a different thing to go and fix.
    line.error("OPENROUTER_API_KEY is not set — every explain request will fail");
    throw new Error(
      "OPENROUTER_API_KEY is not set. Put it in .env.local — see docs/project/setup-dev.md.",
    );
  }

  const user = `Here is the whole article.

${renderArticle(meta, blocks, blockId)}

---

The reader has selected this passage, inside block ${blockId}:

"""
${quote}
"""

Explain it.`;

  // The caller's signal (if any) *and* our deadline — whichever fires first
  // wins. `AbortSignal.any` rather than a bare timeout so a caller that wants to
  // cancel early still can.
  const deadline = AbortSignal.timeout(timeoutMs);

  /* Our own clock, deliberately, rather than any timing the provider reports.
     The original version of this app was burned by exactly that: the SDK left
     its own timestamp fields out of every response, so a latency chart built on
     them was empty and looked like "no slow calls" rather than "no data".
     `Date.now()` here cannot be omitted by anybody else. It starts before the
     request and stops after the body is parsed, because that whole span is what
     the reader spends watching the spinner. */
  const started = Date.now();

  let response: Response;
  try {
    response = await fetchOrExplainWhy(signal ? AbortSignal.any([signal, deadline]) : deadline, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // OpenRouter attributes traffic with these; harmless and useful in its dashboard.
        "HTTP-Referer": "http://localhost:5273",
        "X-Title": "Spideryarn",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        tools: [
          {
            type: "openrouter:web_search",
            // A cap, not a quota: the model still decides whether to search at
            // all. Four is enough for the "who is this person, what is this
            // study" questions a passage actually raises.
            parameters: { max_uses: 4, max_results: 5 },
          },
        ],
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    }, deadline, timeoutMs);
  } catch (err) {
    /* `timedOut` is the field that matters here, and it is why this is logged
       as an object rather than folded into the message. "The model took too
       long" and "the network refused us" want different reactions — wait and
       retry versus go and look at the provider — and by the time the error
       reaches the reader both are just a sentence in a dialog. The headers are
       *not* logged: `redact` is path-based, and one of them carries the key. */
    line.error(
      { ...errorFields(err), model, ms: since(started), timedOut: deadline.aborted },
      `no reply from ${model}${deadline.aborted ? " — deadline fired" : ""}`,
    );
    throw err;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The status, not the body. OpenRouter's error text is the one place a
    // provider might echo part of what we sent back at us, and what we sent is
    // the whole article plus the reader's selection.
    line.error({ model, ms: since(started), status: response.status }, `OpenRouter refused: ${response.status}`);
    throw new Error(`OpenRouter ${response.status}: ${detail.slice(0, 400)}`);
  }

  let body: OpenRouterResponse;
  try {
    body = (await response.json()) as OpenRouterResponse;
  } catch (err) {
    // A 200 whose body is not JSON — a proxy's error page, or a truncated
    // stream. Worth telling apart from a model failure, because nothing about
    // it is the model's doing.
    line.error({ ...errorFields(err), model, ms: since(started) }, `unreadable reply from ${model}`);
    throw err;
  }
  if (body.error) {
    // A 200 carrying a refusal — a bad model id, a quota. The provider's own
    // message stays out of the log for the same reason as above: it is the one
    // string here that could quote what we sent. That is a deliberate loss, and
    // the reader still gets it in the thrown error.
    line.error({ model, ms: since(started) }, `${model} returned an error`);
    throw new Error(`OpenRouter: ${body.error.message}`);
  }

  const message = body.choices?.[0]?.message;
  const answer = message?.content?.trim();
  if (!answer) {
    // An empty completion is the silent-success shape: a 200 with nothing in it.
    // Fail loudly rather than storing a blank comment that looks answered.
    const finishReason = body.choices?.[0]?.finish_reason ?? "?";
    line.error({ model, ms: since(started), finishReason }, `${model} returned no text`);
    throw new Error(`The model returned no text (finish_reason: ${finishReason}).`);
  }

  const { searches, from } = searchCount(body.usage);
  const used = body.model ?? model;
  const result: ExplainResult = {
    answer,
    citations: dedupeCitations(message?.annotations ?? []),
    searches,
    model: used,
  };

  /* The one line per successful explanation.
     `searchesFrom` is the point of it. The header says getting the usage path
     wrong is invisible, because a missing field reads as `0` and "no web search
     needed" is a thing readers see legitimately. This field says *why* the
     number is what it is: `neither` on every call means OpenRouter moved the
     field and the count is now permanently zero, which is exactly the drift
     nobody would otherwise notice.
     Wrapped because logging must not be able to fail an explanation that
     already succeeded — the answer is built above and is returned either way. */
  try {
    line.info(
      {
        model: used,
        ms: since(started),
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        searches,
        searchesFrom: from,
        citations: result.citations.length,
        answerChars: answer.length,
      },
      `explained a selection with ${used} (${searches} web search${searches === 1 ? "" : "es"})`,
    );
  } catch {
    // Nothing to do about it, and nothing worth failing a reader's answer over.
  }

  return result;
}

/**
 * Where a search count can come from — and it is worth knowing which.
 *
 * `neither` is the interesting one: `usage` arrived, and neither field was in
 * it. That is what a third rename by OpenRouter would look like, and from the
 * outside it is indistinguishable from a model that chose not to search.
 * `no-usage` is a different fault again — the response carried no accounting at
 * all, so the token counts in the same log line are missing too.
 */
type SearchUsagePath = "server_tool_use_details" | "server_tool_use" | "neither" | "no-usage";

/**
 * How many searches the model ran, under whichever name this response used —
 * and which name that was.
 *
 * See the header: the documented field and the observed one differ, so both are
 * accepted and whichever is actually present wins. The `from` half is returned
 * purely so it can be logged, because "0" on its own is a number a reader
 * believes and an operator cannot check.
 *
 * `typeof … === "number"` rather than `??` so that a genuine `0` counts as
 * *found*. Distinguishing "the model said it searched zero times" from "we
 * could not find the field" is the whole job of this function.
 */
function searchCount(usage: OpenRouterResponse["usage"]): { searches: number; from: SearchUsagePath } {
  const observed = usage?.server_tool_use_details?.web_search_requests;
  if (typeof observed === "number") return { searches: observed, from: "server_tool_use_details" };
  const documented = usage?.server_tool_use?.web_search_requests;
  if (typeof documented === "number") return { searches: documented, from: "server_tool_use" };
  return { searches: 0, from: usage ? "neither" : "no-usage" };
}

/** One entry per URL — the model cites the same page once per sentence it grounds. */
function dedupeCitations(annotations: Annotation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const a of annotations) {
    const c = a.url_citation;
    if (a.type !== "url_citation" || !c?.url || seen.has(c.url)) continue;
    seen.set(c.url, { url: c.url, ...(c.title ? { title: c.title } : {}) });
  }
  return [...seen.values()];
}

/**
 * `fetch`, with an abort turned into a sentence a reader can act on.
 *
 * A timed-out fetch throws `AbortError: This operation was aborted`, which tells
 * the reader nothing and — stored on the comment — reads like a bug rather than
 * a slow model. `deadline` is passed separately so we can tell *our* timeout
 * apart from the caller cancelling.
 */
async function fetchOrExplainWhy(
  signal: AbortSignal,
  init: RequestInit,
  deadline: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(ENDPOINT, { ...init, signal });
  } catch (err) {
    if (deadline.aborted) {
      throw new Error(`The model did not answer within ${Math.round(timeoutMs / 1000)}s. Try again.`);
    }
    throw err;
  }
}

interface Annotation {
  type: string;
  url_citation?: { url?: string; title?: string };
}

interface OpenRouterResponse {
  model?: string;
  error?: { message: string };
  choices?: { finish_reason?: string; message?: { content?: string; annotations?: Annotation[] } }[];
  usage?: {
    // OpenAI-shaped, because OpenRouter is. Optional because nothing guarantees
    // they arrive — hence `null` rather than `0` in the log when they don't, so
    // "we were not told" cannot be read as "the call was free".
    prompt_tokens?: number;
    completion_tokens?: number;
    server_tool_use_details?: { web_search_requests?: number };
    server_tool_use?: { web_search_requests?: number };
  };
}
