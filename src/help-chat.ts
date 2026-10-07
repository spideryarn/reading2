/**
 * **Ask about Spideryarn — the shapes**: the request, the corpus the model is
 * handed, and the frames the answer streams in. Plan
 * docs/plans/261007k-help-chatbot.md (§ After the plan review overrides its
 * design where they differ).
 *
 * The split is command-pick's: this file holds what the browser, the server
 * and the corpus test all read, and imports nothing that calls a model; the
 * prompt, the call and the allowance are src/help-chat-call.ts.
 *
 * ## One question, no history
 *
 * The body is `{ question }` and nothing else (the plan's F1). A conversation
 * the caller sends back would be few-shot material written by whoever holds
 * the account, which is the easiest way to turn a Help-only model into a
 * general one; so the page shows the last question and answer, and a new
 * question replaces them.
 */

/** Where the Help page posts a question. Signed in only. */
export const HELP_CHAT_PATH = "/api/help-chat";

/** The longest question taken, in characters, after trimming. */
export const MAX_HELP_QUESTION_CHARS = 1_000;

export interface HelpChatRequest {
  /** Trimmed, 1 to `MAX_HELP_QUESTION_CHARS` characters. */
  readonly question: string;
}

export type HelpChatParse =
  | { readonly ok: true; readonly request: HelpChatRequest }
  /** Fixed prose, never a string the caller sent — it reaches a log. */
  | { readonly ok: false; readonly reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * **The body of `POST /api/help-chat`, exactly** — `POST /api/command-pick`'s
 * rule: a key we do not know is refused rather than ignored.
 */
export function parseHelpChatRequest(body: unknown): HelpChatParse {
  if (!isRecord(body)) return { ok: false, reason: "Expected a JSON object" };
  if (!Object.keys(body).every((k) => k === "question")) {
    return { ok: false, reason: "That request has a field this endpoint does not take" };
  }
  const { question } = body;
  if (typeof question !== "string") return { ok: false, reason: "question must be some words" };
  const trimmed = question.trim();
  if (trimmed === "") return { ok: false, reason: "question must be some words" };
  if (trimmed.length > MAX_HELP_QUESTION_CHARS) {
    return { ok: false, reason: `A question can be at most ${MAX_HELP_QUESTION_CHARS} characters` };
  }
  return { ok: true, request: { question: trimmed } };
}

/**
 * **One Help page as the model is handed it** — an entry of
 * src/help-corpus.generated.json, which tests/help-corpus.test.ts builds from
 * the Help's own sources (it cannot be built outside Vitest: the pages are
 * Vite `?raw` imports).
 */
export interface HelpCorpusPage {
  /** The Help anchor, as help-anchors.ts names it. */
  readonly anchor: string;
  /**
   * The page's canonical address, `helpHref(anchor)`: `/help/spine`, or
   * `/help/questions#faq-…` for a question. The only links the answer may draw.
   */
  readonly href: string;
  /** The contents page's heading the page sits under. */
  readonly group: string;
  readonly title: string;
  /** Its line on the contents page; null for a question, which is its own line. */
  readonly summary: string | null;
  /** The words a reader brings that the title does not say — the search box's. */
  readonly keywords: string;
  /** A mode behind the Experimental switch. */
  readonly experimental: boolean;
  /** The page's Markdown, every `{{…}}` token expanded; a mode's starts with the catalog's two sentences. */
  readonly body: string;
}

/**
 * **What `POST /api/help-chat` streams**, as `sse` frames that
 * `readAnswerStream` (src/web/lib/sse.ts) reads: any number of `delta`, then
 * exactly one `done` or `error`. A refusal before the stream opens (a bad
 * body, the allowance) is ordinary JSON with a status instead.
 */
export type HelpChatFrame =
  | { readonly name: "delta"; readonly data: { readonly text: string } }
  /**
   * `answer` is everything that arrived, trimmed. `complete` is false when the
   * answer stopped at the output ceiling or the provider's filter: it is shown,
   * and the page may say it was cut short.
   */
  | { readonly name: "done"; readonly data: HelpChatDone }
  /** A sentence written for the reader (src/reader-sentence.ts § sayToReader). */
  | { readonly name: "error"; readonly data: { readonly error: string } };

export interface HelpChatDone {
  readonly answer: string;
  readonly complete: boolean;
}
