/**
 * The chat model call — the second LLM call that happens in a request handler
 * rather than in the pipeline, and the first one that streams.
 *
 * The sibling of src/explain.ts. That file explains a passage the reader
 * selected; this one answers a question they typed. Same provider, same key,
 * same "the whole article goes in the prompt every time" decision, and the same
 * rule about what may reach a log. What is different is worth reading:
 *
 * ## It streams, and that changes where failure lives
 *
 * `explain` either returns an answer or throws, and the caller writes one of
 * two outcomes. A stream has a third state: **it succeeded partly.** Sixty
 * words arrived and then the connection died. So this is an async generator
 * rather than a function returning a string — the caller gets the text as it
 * comes, and when something goes wrong it already holds everything that landed
 * before it did. What the caller does with a half-answer is the caller's
 * decision (src/routes.ts keeps it, marked as failed, because a half-answer the
 * reader watched appear is worse than useless if it vanishes on reload).
 *
 * The generator's contract: zero or more `delta` events, then exactly one of
 * `done`. A throw means no `done` is coming and the deltas so far are all there
 * is.
 *
 * ## The citation contract
 *
 * Every claim must carry a block id — `[spya-k3m9qt]` — and the prompt below
 * spends real space on that because it is the whole difference between this
 * feature and the thing docs/project/vision.md names as an anti-goal:
 *
 * > A chatbot with the article stuffed in the context window.
 *
 * A chat that must point at the passage it is talking about cannot become a
 * substitute for reading the passage; it is an index into the article that
 * happens to answer questions. See docs/plans/chat-mode.md § The citation
 * contract for what happens when the model cites an id that does not exist —
 * short version, the client renders it as plain text rather than a dead link,
 * and **that is a silent failure we chose deliberately**, so the rate is worth
 * watching in the logs (`unknownIds` below).
 *
 * ## Logging
 *
 * One line per finished answer under the `model` component, carrying the same
 * fields explain.ts logs plus `unknownIds`. **Never the question, never the
 * answer, never the article, never the key.** A reader's question is as private
 * as their selection — it is what they did not understand.
 */
import type { Block, ChatMessage, Citation, Meta } from "./types.js";
import { loadEnvLocal } from "./env.js";
import { ID_PATTERN } from "./ids.js";
import { errorFields, log, since } from "./log.js";
import { OPENROUTER_MODEL } from "./models.js";

/** Overridable with `SPIDERYARN_CHAT_MODEL`; the default is app-wide. */
export const DEFAULT_MODEL = OPENROUTER_MODEL;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * How long the whole exchange may take.
 *
 * Longer than explain.ts's ninety seconds, because a chat turn can carry a long
 * history in front of the article and may run several web searches before it
 * says anything. A deadline exists at all for the reason it does there: `fetch`
 * has none of its own, and without one a request that never comes back leaves a
 * `pending` message on disk and a cursor blinking on screen for as long as the
 * tab is open.
 */
export const CHAT_TIMEOUT_MS = 120_000;

/**
 * How long a *silent* stream may go on.
 *
 * This is the one explain.ts does not need. A streamed response can stay open
 * with nothing coming down it — a stalled proxy, a dropped TCP connection that
 * neither end has noticed — and from the inside that is indistinguishable from
 * a model that is thinking. The overall deadline above would eventually fire,
 * but two minutes of a motionless cursor is not a wait, it is a hang. Forty-five
 * seconds is comfortably longer than the gap a web search leaves.
 */
export const CHAT_STALL_MS = 45_000;

/** The most turns of history sent back to the model. See `recentHistory`. */
export const HISTORY_TURNS = 20;

const SYSTEM = `You are a reading companion. A reader is working through an article and has a
question about it. Answer the question.

You are here to make deep reading cheaper, not optional. Never let the reader
substitute talking to you for reading the piece — your job is to send them back
into it better equipped, not to save them the trip.

CITING THE ARTICLE — THE ONE RULE THAT MATTERS

Every block of the article has an id like spya-k3m9qt. When you say what the
article says, CITE THE BLOCK IT IS IN, in square brackets, at the end of the
sentence: "He rejects substrate independence [spya-k3m9qt]."

- Cite ids that appear in the article below. NEVER invent one, and never guess
  at one you half-remember — a wrong id sends the reader to the wrong paragraph,
  which is worse than no id at all.
- Cite the block that actually carries the claim, not the one near it.
- Two or three ids in one bracket is fine when a point is spread across blocks:
  [spya-k3m9qt spya-p7w2dn].
- A sentence of your own reasoning, or something you found on the web, carries
  no block id. Do not decorate it with one.

WHAT A GOOD ANSWER DOES

- Answers the question that was asked, first, in the first sentence.
- Keeps the author's own distinctive vocabulary rather than flattening it into
  your own — those words are what the reader meets again further down the page.
- Points at where in the piece the answer lives, so the reader can go and read
  it. Quoting a few words is good; quoting a paragraph is doing their reading
  for them.
- Says where a claim sits in the argument — what it answers, what it sets up.
- Marks a genuine ambiguity as ambiguous instead of picking a reading and
  sounding confident.
- Says plainly when the article does not address something, rather than
  assembling an answer that sounds like it came from the piece.

WHAT IT MUST NOT DO

- Do not summarise the article unless the reader asks you to. They are reading it.
- Do not praise or grade the writing.
- Do not pad. Two or three short paragraphs is usually right; one is often
  better.
- Do not open with "Great question" or restate the question back.

WEB RESEARCH

You have a web search tool. USE IT unless you are genuinely sure — a name, a
study, a technical term, a book, a live controversy, anything post-dating your
training, or any fact you would hedge about. A search you did not need costs
almost nothing; being unsure and not checking is the worst outcome here. Say
when something came from outside the article rather than from it.

FORMAT

Plain prose paragraphs separated by blank lines. Short bullet lists only when
the answer really is a list. No headings.`;

export interface ConverseRequest {
  meta: Meta;
  blocks: Block[];
  /** The turns before this one, oldest first. The new question is not in it. */
  history: ChatMessage[];
  question: string;
  /**
   * Where the reader is in the article, if known — the block `?at=` is holding.
   * Marked in the prompt so "this bit", "here" and "what he just said" resolve
   * to somewhere rather than to the whole piece.
   */
  at?: string | undefined;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  stallMs?: number;
}

export type ConverseEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      text: string;
      citations: Citation[];
      searches: number;
      model: string;
      /** Block ids the model cited that this article does not have. */
      unknownIds: string[];
    };

/**
 * The article as a numbered block list, with the reader's position called out.
 *
 * Same shape as explain.ts's, deliberately — one article rendering the model
 * has to learn, not two. The marker differs because the anchor differs: there,
 * the reader had selected a passage; here, they are simply somewhere.
 */
function renderArticle(meta: Meta, blocks: Block[], at?: string): string {
  const body = blocks
    .map((b, i) => `[${i}]${b.id === at ? " ←READER IS HERE" : ""} ${b.id}: ${b.text}`)
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

/**
 * The turns worth sending back, oldest first.
 *
 * A cap, because the article is already the expensive part of this prompt and a
 * long afternoon's conversation would eventually double it. Failed and
 * unfinished turns are dropped rather than sent as empty assistant messages:
 * OpenRouter rejects an empty `content`, and a turn that never got an answer is
 * not part of the conversation the model should be continuing.
 */
export function recentHistory(history: ChatMessage[], turns = HISTORY_TURNS): ChatMessage[] {
  return history.filter((m) => m.status === "done" && m.text.trim() !== "").slice(-turns);
}

/** Every id in the article, for checking what the model cited. */
function idsOf(blocks: Block[]): Set<string> {
  return new Set(blocks.map((b) => b.id));
}

/**
 * The ids an answer cites that the article does not contain.
 *
 * Exported for the tests, and read by the log line. The pattern deliberately
 * matches the *shape* of one of our ids rather than anything the model was
 * asked to produce, so a hallucinated id that looks right is caught and a
 * stray `[see above]` is not mistaken for one.
 */
export function unknownCitedIds(text: string, known: Set<string>): string[] {
  const cited = text.match(/spya-[a-z0-9]{6}/g) ?? [];
  const bad = new Set<string>();
  for (const id of cited) {
    if (!ID_PATTERN.test(id)) continue; // not one of ours; the client shows it as text
    if (!known.has(id)) bad.add(id);
  }
  return [...bad];
}

export async function* converse({
  meta,
  blocks,
  history,
  question,
  at,
  model = process.env.SPIDERYARN_CHAT_MODEL || DEFAULT_MODEL,
  signal,
  timeoutMs = CHAT_TIMEOUT_MS,
  stallMs = CHAT_STALL_MS,
}: ConverseRequest): AsyncGenerator<ConverseEvent> {
  // No thread id and no message id in this logger: this module is handed a
  // conversation, not a file, and the ids belong to whoever stored it. The
  // route's own line carries them.
  const line = log("model");

  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    line.error("OPENROUTER_API_KEY is not set — every chat message will fail");
    throw new Error(
      "OPENROUTER_API_KEY is not set. Put it in .env.local — see docs/project/setup-dev.md.",
    );
  }

  /* The article goes in the FIRST user message and the conversation follows it,
     rather than the article going in the system prompt. Two reasons, and the
     second is the one that matters:

      - the system prompt is the same bytes for every article and every reader,
        so keeping it article-free is what makes it cacheable;
      - and a reader can see the whole conversation in the panel, so the
        article's own text arriving as a "user" turn is the honest description
        of what happened — the reader did put the article there. */
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Here is the whole article. Keep it in mind for everything I ask.

${renderArticle(meta, blocks, at)}`,
    },
    { role: "assistant", content: "Read it. What would you like to know?" },
    ...recentHistory(history).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.text,
    })),
    { role: "user", content: question },
  ];

  const deadline = AbortSignal.timeout(timeoutMs);
  /* Our own stall clock, and it has to be its own controller rather than another
     `AbortSignal.timeout`: a stall timer is one that gets *restarted* every time
     a chunk lands, and a timeout signal cannot be restarted. */
  const stall = new AbortController();
  let stallTimer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stall.abort(new Error("stalled")), stallMs);
  };

  const started = Date.now();
  const composite = AbortSignal.any(
    signal ? [signal, deadline, stall.signal] : [deadline, stall.signal],
  );

  let response: Response;
  touch();
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      signal: composite,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // OpenRouter attributes traffic with these; harmless, and useful in its
        // dashboard for telling this call apart from explain's.
        "HTTP-Referer": "http://localhost:5273",
        "X-Title": "Spideryarn",
      },
      body: JSON.stringify({
        model,
        stream: true,
        // Without this the usage block never arrives on a streamed response, and
        // every token count in the log line below is silently null — which reads
        // exactly like a free call. Same family of invisible failure as the
        // `searchesFrom` field in explain.ts.
        stream_options: { include_usage: true },
        max_tokens: 2000,
        tools: [
          {
            type: "openrouter:web_search",
            // A cap, not a quota — the model still decides whether to search.
            parameters: { max_uses: 4, max_results: 5 },
          },
        ],
        messages,
      }),
    });
  } catch (err) {
    clearTimeout(stallTimer);
    line.error(
      { ...errorFields(err), model, ms: since(started), timedOut: deadline.aborted },
      `no reply from ${model}${deadline.aborted ? " — deadline fired" : ""}`,
    );
    throw explainAbort(err, deadline, stall.signal, timeoutMs, stallMs);
  }

  if (!response.ok || !response.body) {
    clearTimeout(stallTimer);
    const detail = await response.text().catch(() => "");
    // The status, not the body. OpenRouter's error text is the one place a
    // provider might echo part of what we sent, and what we sent is the whole
    // article plus the reader's question.
    line.error(
      { model, ms: since(started), status: response.status },
      `OpenRouter refused: ${response.status}`,
    );
    throw new Error(`OpenRouter ${response.status}: ${detail.slice(0, 400)}`);
  }

  let text = "";
  const citations = new Map<string, Citation>();
  let searches = 0;
  let used = model;
  let finishReason: string | null = null;
  /* Local, NOT module-scope, and this is the whole reason it is called out: two
     readers chatting at once run two of these generators in one process, and a
     shared accumulator would report one conversation's token counts against the
     other's log line. Every piece of state in this function is per-call for the
     same reason. */
  let usage: Usage | undefined;

  try {
    for await (const chunk of sseChunks(response.body, composite)) {
      touch();
      if (chunk.model) used = chunk.model;
      // A 200 that carries an error in the stream — a mid-generation provider
      // failure. It arrives as data, not as a broken connection, so nothing
      // else would notice it.
      if (chunk.error) throw new Error(`OpenRouter: ${chunk.error.message}`);
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      for (const a of choice?.delta?.annotations ?? []) {
        const c = a.url_citation;
        if (a.type === "url_citation" && c?.url && !citations.has(c.url)) {
          citations.set(c.url, { url: c.url, ...(c.title ? { title: c.title } : {}) });
        }
      }
      const piece = choice?.delta?.content;
      if (typeof piece === "string" && piece.length > 0) {
        text += piece;
        yield { type: "delta", text: piece };
      }
      const counted = searchCount(chunk.usage);
      if (counted !== null) searches = counted;
      // Held for the log line after the loop: the usage chunk is normally the
      // last one of all and carries no choices, so it would otherwise be seen
      // and dropped.
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (err) {
    line.error(
      {
        ...errorFields(err),
        model: used,
        ms: since(started),
        timedOut: deadline.aborted,
        stalled: stall.signal.aborted,
        // How much the reader already watched arrive. The difference between
        // "it died before saying anything" and "it died two paragraphs in" is
        // the difference between a provider problem and a network one.
        chars: text.length,
      },
      `stream from ${used} broke off`,
    );
    throw explainAbort(err, deadline, stall.signal, timeoutMs, stallMs);
  } finally {
    clearTimeout(stallTimer);
  }

  const answer = text.trim();
  if (answer === "") {
    // The silent-success shape: a 200, a clean stream, and nothing in it. Fail
    // loudly rather than storing a blank turn that looks answered.
    line.error({ model: used, ms: since(started), finishReason }, `${used} returned no text`);
    throw new Error(`The model returned no text (finish_reason: ${finishReason ?? "?"}).`);
  }

  const unknownIds = unknownCitedIds(answer, idsOf(blocks));

  /* One line per answered question.
     `unknownIds` is the point of it: a cited id this article does not have
     renders as plain text in the panel, which looks like the model choosing not
     to link rather than like a hallucination. Nobody would ever notice from the
     outside. A count creeping up here is the signal that the citation prompt
     has stopped working — after a model change, say.
     Wrapped, because logging must not be able to fail an answer that already
     arrived; the reader has watched it appear. */
  try {
    line.info(
      {
        model: used,
        ms: since(started),
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        searches,
        citations: citations.size,
        answerChars: answer.length,
        historyTurns: recentHistory(history).length,
        unknownIds: unknownIds.length,
        finishReason,
      },
      `answered a chat question with ${used} (${searches} web search${searches === 1 ? "" : "es"})`,
    );
  } catch {
    // Nothing to do about it, and nothing worth failing a reader's answer over.
  }

  yield {
    type: "done",
    text: answer,
    citations: [...citations.values()],
    searches,
    model: used,
    unknownIds,
  };
}

/**
 * An abort turned into a sentence a reader can act on.
 *
 * A cut-off fetch throws `AbortError: This operation was aborted`, which tells
 * the reader nothing and — stored on the message — reads like a bug rather than
 * a slow model. The three causes want three different sentences, and only the
 * signals can tell them apart.
 */
function explainAbort(
  err: unknown,
  deadline: AbortSignal,
  stalled: AbortSignal,
  timeoutMs: number,
  stallMs: number,
): unknown {
  if (deadline.aborted) {
    return new Error(`The model did not finish within ${Math.round(timeoutMs / 1000)}s. Try again.`);
  }
  if (stalled.aborted) {
    return new Error(
      `The answer stopped arriving after ${Math.round(stallMs / 1000)}s of silence. Try again.`,
    );
  }
  return err;
}

/**
 * Server-sent events, parsed into the JSON objects OpenRouter puts in them.
 *
 * Three things here are not obvious, and each one produced a real bug somewhere
 * before it was written down:
 *
 *  - **A chunk of bytes is not a line.** A `data:` line can be split across two
 *    reads, so the tail of each read is held over. Parsing per-read works
 *    perfectly until the day a long answer is fast enough to fill the buffer
 *    mid-object.
 *  - **`: OPENROUTER PROCESSING` is a comment, not data.** OpenRouter sends
 *    these as keep-alives. They are not JSON and must be skipped rather than
 *    parsed — and note they also count as activity for the stall timer, which
 *    is correct: the connection is alive.
 *  - **`data: [DONE]` is not JSON either.** It is the terminator.
 */
async function* sseChunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A reader is not cancelled by the signal the fetch was given — the response
  // has already arrived, so aborting is our job from here.
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      buffer += decoder.decode(value, { stream: true });
      // Everything up to the last newline is complete; the remainder is a
      // partial line and waits for the next read.
      const cut = buffer.lastIndexOf("\n");
      if (cut === -1) continue;
      const lines = buffer.slice(0, cut).split("\n");
      buffer = buffer.slice(cut + 1);
      for (const raw of lines) {
        const line = raw.trim();
        if (line === "" || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          yield JSON.parse(payload) as StreamChunk;
        } catch {
          // A malformed chunk is not worth ending a working answer over — the
          // stream carries many, and one unparseable line loses a few words
          // rather than the reply. It is not logged: at one line per token this
          // could be thousands of lines, and the answer's own length is already
          // in the summary line above.
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * How many web searches the model ran, or `null` if this chunk did not say.
 *
 * Both spellings, exactly as explain.ts reads both — OpenRouter's docs say
 * `server_tool_use` and OpenRouter's responses have been observed to say
 * `server_tool_use_details`. `null` rather than `0` for "not stated" so a chunk
 * without usage cannot reset a count a previous chunk gave us.
 */
function searchCount(usage: Usage | undefined): number | null {
  const observed = usage?.server_tool_use_details?.web_search_requests;
  if (typeof observed === "number") return observed;
  const documented = usage?.server_tool_use?.web_search_requests;
  if (typeof documented === "number") return documented;
  return null;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  server_tool_use_details?: { web_search_requests?: number };
  server_tool_use?: { web_search_requests?: number };
}

interface Annotation {
  type: string;
  url_citation?: { url?: string; title?: string };
}

interface StreamChunk {
  model?: string;
  error?: { message: string };
  usage?: Usage;
  choices?: {
    finish_reason?: string;
    delta?: { content?: string; annotations?: Annotation[] };
  }[];
}
