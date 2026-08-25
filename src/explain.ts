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
 */
import type { Block, Citation, Meta } from "./types.js";
import { loadEnvLocal } from "./env.js";

/**
 * Overridable with `SPIDERYARN_EXPLAIN_MODEL`. Sonnet by default: fast enough
 * that the spinner isn't painful, and cheap enough to fire on every selection.
 */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

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
  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
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
  const response = await fetchOrExplainWhy(signal ? AbortSignal.any([signal, deadline]) : deadline, {
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

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status}: ${detail.slice(0, 400)}`);
  }
  const body = (await response.json()) as OpenRouterResponse;
  if (body.error) throw new Error(`OpenRouter: ${body.error.message}`);

  const message = body.choices?.[0]?.message;
  const answer = message?.content?.trim();
  if (!answer) {
    // An empty completion is the silent-success shape: a 200 with nothing in it.
    // Fail loudly rather than storing a blank comment that looks answered.
    throw new Error(
      `The model returned no text (finish_reason: ${body.choices?.[0]?.finish_reason ?? "?"}).`,
    );
  }

  return {
    answer,
    citations: dedupeCitations(message?.annotations ?? []),
    searches: searchCount(body.usage),
    model: body.model ?? model,
  };
}

/**
 * How many searches the model ran, under whichever name this response used.
 *
 * See the header: the documented field and the observed one differ, so both are
 * accepted and whichever is actually present wins.
 */
function searchCount(usage: OpenRouterResponse["usage"]): number {
  return (
    usage?.server_tool_use_details?.web_search_requests ??
    usage?.server_tool_use?.web_search_requests ??
    0
  );
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
    server_tool_use_details?: { web_search_requests?: number };
    server_tool_use?: { web_search_requests?: number };
  };
}
