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
 * `plugins: [{ id: "web", engine: "native" }]`. The engine matters: the plugin
 * engines (exa, parallel, …) run a search on **every** request whether or not
 * one is wanted, while `native` hands the model the provider's own search tool
 * and lets it decide. Greg, 2026-08-25, asked for exactly that — model-invoked,
 * "but encourage the model to ask for it unless it's very sure" — so the
 * encouragement lives in the system prompt and the choice stays with the model.
 * `usage.server_tool_use_details.web_search_requests` reports what it actually
 * did, and that number is shown in the dialog: a claim about research that
 * nobody can check is worth nothing.
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

  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal,
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
      plugins: [{ id: "web", engine: "native", max_results: 5 }],
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });

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
    searches: body.usage?.server_tool_use_details?.web_search_requests ?? 0,
    model: body.model ?? model,
  };
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

interface Annotation {
  type: string;
  url_citation?: { url?: string; title?: string };
}

interface OpenRouterResponse {
  model?: string;
  error?: { message: string };
  choices?: { finish_reason?: string; message?: { content?: string; annotations?: Annotation[] } }[];
  usage?: { server_tool_use_details?: { web_search_requests?: number } };
}
