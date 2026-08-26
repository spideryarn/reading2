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
 * This section was written when `explain` either returned an answer or threw,
 * and the caller wrote one of two outcomes. **That is no longer true** —
 * explain.ts streams now too (`explainStream`), which is why the two files have
 * grown so alike and why they are scheduled to share a transport
 * (docs/plans/simplification-audit.md § 3.4). What follows is still the reason
 * this file is an async generator; it just no longer distinguishes it from its
 * sibling.
 *
 * A stream has a third state a function returning a string does not:
 * **it succeeded partly.** Sixty
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
import {

  type StreamEnd,
  type Usage,
  explainAbort,
  PROVIDER_ORDER,
  providerFailedMidAnswer,
  providerRefused,
  readerAborted,
  searchCount,
  sseChunks,
  stoppedByReader,
} from "./openrouter-stream.js";
import { OPENROUTER_MODEL } from "./models.js";
import { isWebUrl } from "./urls.js";
import {
  type OpenRouterMessage,
  articleWithIds,
  cachedText,
  readerPositionLine,
  underCacheFloor,
} from "./article-prompt.js";

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
      /**
       * The caller's `signal` fired, so this answer is whatever had arrived.
       *
       * **A stop is a `done`, not a throw**, and that is the decision this
       * field records. Aborting the fetch does make the loop below throw, and
       * the obvious handling — let it out, let the route store an `error` —
       * would file the reader's own deliberate act as a failure: a red row, an
       * apology, an offer to try again, for a button they pressed on purpose.
       * So a stop is caught here, told apart from the deadline and the stall by
       * which signal aborted, and finished normally with a flag on it.
       */
      stopped: boolean;
    };

/**
 * The messages a chat turn will send, as a value a test can inspect.
 *
 * **The article message is the same bytes for every turn and every scroll
 * position.** It used to carry `←READER IS HERE` inside the body, so a reader
 * who moved to a new section paid for the whole article again — on a call they
 * were sitting and waiting for. Where the reader is now rides with the
 * question, in the final user message.
 *
 * That placement is deliberate and load-bearing. `recentHistory` is a sliding
 * window (`HISTORY_TURNS`), so once a conversation passes twenty turns the
 * oldest pair drops off and every later message shifts — which moves the bytes
 * after the article. The article message itself sits *before* all of that and
 * is untouched by it, so the cached prefix survives a long conversation even
 * though the tail does not. Putting the position line in the article message
 * would have thrown that away for nothing.
 */
export function buildConverseMessages(opts: {
  meta: Meta;
  blocks: Block[];
  history: ChatMessage[];
  question: string;
  at?: string;
}): OpenRouterMessage[] {
  const position = readerPositionLine(opts.at);
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Here is the whole article. Keep it in mind for everything I ask.

${articleWithIds(opts.meta, opts.blocks)}`,
    },
    { role: "assistant", content: "Read it. What would you like to know?" },
    ...recentHistory(opts.history).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.text,
    })),
    {
      role: "user",
      content: position ? `${position}\n\n${opts.question}` : opts.question,
    },
  ];
}

/**
 * The turns worth sending back, oldest first — **in whole turns**.
 *
 * The first version filtered messages one at a time: any message that was
 * `done` and non-empty was kept. A user message is `done` the moment it is
 * stored, so a question whose answer failed had its *question* kept and its
 * failed answer dropped. The model then received two user turns in a row, the
 * older of them a question nobody had answered — and cheerfully answered both,
 * so a failed turn came back to haunt the next one. The test that claimed to
 * cover this pinned the broken behaviour. Found by a GPT-5.6 review, 2026-08-26.
 *
 * So the unit is the turn: a user message and the assistant message that
 * answers it, kept only if **both** are `done` and non-empty. An unanswered
 * question is not part of the conversation the model should be continuing.
 *
 * `turns` counts turns, not messages, which is what the name always claimed.
 *
 * A stray message that does not fit the pattern — an assistant reply with no
 * question before it, two questions in a row already on disk — is dropped
 * rather than repaired. This function's job is to build a prompt, and guessing
 * at the shape of a damaged history is how you send the model something worse
 * than nothing.
 */
export function recentHistory(history: ChatMessage[], turns = HISTORY_TURNS): ChatMessage[] {
  const usable = (m: ChatMessage | undefined): m is ChatMessage =>
    m !== undefined && m.status === "done" && m.text.trim() !== "";

  const pairs: ChatMessage[][] = [];
  for (let i = 0; i < history.length; i++) {
    const question = history[i];
    if (question?.role !== "user") continue;
    const answer = history[i + 1];
    if (answer?.role !== "assistant") continue;
    i++; // the answer belongs to this turn either way
    if (usable(question) && usable(answer)) pairs.push([question, answer]);
  }
  return pairs.slice(-turns).flat();
}

/** The block ids an answer cites that this article really has. */
export function citedBlockIds(text: string, known: Set<string>): string[] {
  const good = new Set<string>();
  for (const id of text.match(/spya-[a-z0-9]{6}/g) ?? []) {
    if (ID_PATTERN.test(id) && known.has(id)) good.add(id);
  }
  return [...good];
}

/** Every id in the article, for checking what the model cited. *//** Every id in the article, for checking what the model cited. */
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
  const messages = buildConverseMessages({ meta, blocks, history, question, ...(at && { at }) });

  /* Logged rather than thrown: a short article simply cannot be cached, and the
     zeros that come back look exactly like a cache that has stopped working. */
  const tooShortToCache = underCacheFloor(cachedText(messages));

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
        /* The automatic form, not an explicit breakpoint — and it fits this
           call better than the other two. OpenRouter marks the last cacheable
           block and advances it as the conversation grows, which is exactly
           chat's shape: a fixed article near the front, a tail that gets longer
           every turn. The explicit form would need the messages rebuilt as
           content arrays for no gain here.
           docs/research/prompt-caching-openrouter.md § How OpenRouter exposes it. */
        cache_control: { type: "ephemeral" },
        provider: PROVIDER_ORDER,
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
    /* Stopped before the model said anything — before it was even asked, on a
       slow connection. Not a failure and not a model to blame, so it ends the
       same way a stop always ends: a `done` with nothing in it and the flag on.
       `recentHistory` drops an empty turn, so nothing is sent back to the model
       claiming it once said nothing. */
    if (stoppedByReader(err, signal, deadline, stall.signal)) {
      line.info({ model, ms: since(started) }, `reader stopped before ${model} replied`);
      yield {
        type: "done",
        text: "",
        citations: [],
        searches: 0,
        model,
        unknownIds: [],
        stopped: true,
      };
      return;
    }
    line.error(
      { ...errorFields(err), model, ms: since(started), timedOut: deadline.aborted },
      `no reply from ${model}${deadline.aborted ? " — deadline fired" : ""}`,
    );
    throw explainAbort(err, deadline, stall.signal, timeoutMs, stallMs);
  }

  if (!response.ok || !response.body) {
    clearTimeout(stallTimer);
    /* Drained and dropped without being looked at. The body has to be
       consumed or the connection leaks, but nothing here wants to know
       what it said — see `providerRefused`. */
    await response.text().catch(() => "");
    // The status, not the body. OpenRouter's error text is the one place a
    // provider might echo part of what we sent, and what we sent is the whole
    // article plus the reader's question.
    line.error(
      { model, ms: since(started), status: response.status },
      `OpenRouter refused: ${response.status}`,
    );
    throw providerRefused(response.status);
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

  const end: StreamEnd = { terminated: false };
  /* Set by the catch below when the *caller's* signal is what fired. See the
     `stopped` field on the `done` event for why this is not simply a throw. */
  let stopped = false;
  try {
    for await (const chunk of sseChunks(response.body, composite, touch, end)) {
      if (chunk.model) used = chunk.model;
      // A 200 that carries an error in the stream — a mid-generation provider
      // failure. It arrives as data, not as a broken connection, so nothing
      // else would notice it.
      if (chunk.error) throw providerFailedMidAnswer();
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      for (const a of choice?.delta?.annotations ?? []) {
        const c = a.url_citation;
        if (a.type !== "url_citation" || !c?.url || citations.has(c.url)) continue;
        // Refused here rather than guarded at the point of render, because this
        // is where model output stops being a string and starts being stored.
        if (!isWebUrl(c.url)) {
          line.warn({ model: used }, "dropped a citation whose URL was not http(s)");
          continue;
        }
        citations.set(c.url, { url: c.url, ...(c.title ? { title: c.title } : {}) });
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
    /* Was that the reader? A stop is not an error, so it is not logged as one
       and it does not throw — see `stoppedByReader`. */
    if (stoppedByReader(err, signal, deadline, stall.signal)) {
      stopped = true;
      clearTimeout(stallTimer);
      line.info(
        { model: used, ms: since(started), chars: text.length },
        `reader stopped the answer from ${used}`,
      );
    } else {
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
    }
  } finally {
    clearTimeout(stallTimer);
  }

  /* **The stream can also stop by simply ending.**

     Every version of this before now assumed an abort *throws*, and set
     `stopped` only in the two catches. It does throw under Node's own fetch:
     the pending `read()` rejects with the abort reason. But `onAbort` in
     `sseChunks` also calls `reader.cancel()`, and cancelling a reader makes a
     pending read resolve `{ done: true }` — so an implementation where the
     cancel wins the race exits the loop **cleanly**, `stopped` stays false, and
     the guard immediately below files the reader's own stop as "The answer
     stopped arriving before it was finished."

     There is no error to identify here, so this is the signal-only test: the
     caller's signal aborted, neither of our clocks did, and however the loop
     happened to end, the reader is why. Found by writing the test that goes
     through `converse` rather than constructing the row by hand — which is the
     whole reason that test exists. */
  if (!stopped && readerAborted(signal, deadline, stall.signal)) stopped = true;

  /* **And our own clocks can end it cleanly too**, for the same reason and with
     a worse consequence. When the stall timer fires, `sseChunks` cancels the
     reader; if that cancel wins the race against the pending read's rejection,
     the loop exits with no error at all — and the check immediately below then
     files a 45-second silence as "the answer stopped arriving before it was
     finished". Both sentences end in "try again", so the reader never notices;
     what is lost is the log line, which says `ended without finishing` instead
     of `stalled: true`, and that is the line somebody reads when chat starts
     failing and they want to know whether to blame the network or the provider.

     explain.ts has had this guard since it became a stream (62a5d85) and this
     file did not, which is worth being exact about: it was not missed. The plan
     behind that commit wrote it down —
     *"`src/converse.ts` has the same shape, guarded only for the reader's
     signal"* (docs/plans/explain-deeper-answers.md § 2) — and then nothing
     tracked it, for four months. A known gap with nowhere to live is a gap that
     stays open, which is the argument for
     docs/plans/simplification-audit.md § 3.4: one transport both callers share,
     rather than two copies of an invariant and a note in a plan. Full account:
     docs/postmortems/converse-stall-misfiled-as-incomplete.md. */
  if (!stopped && (deadline.aborted || stall.signal.aborted)) {
    line.error(
      {
        model: used,
        ms: since(started),
        timedOut: deadline.aborted,
        stalled: stall.signal.aborted,
        chars: text.length,
      },
      `stream from ${used} was cut off`,
    );
    throw explainAbort(new Error("aborted"), deadline, stall.signal, timeoutMs, stallMs);
  }

  /* **The stream stopped; did it finish?**

     `[DONE]` is the only clean end an SSE response has, and without this check
     an ordinary EOF looked exactly like one: a connection cut two paragraphs in
     was committed as a complete answer, `status: "done"`, with no error
     anywhere. The reader gets half an explanation that never says it is half.
     Found by a GPT-5.6 review, 2026-08-26.

     `finish_reason` is accepted as a second witness because it is the model
     saying it stopped on purpose — a provider that omits the terminator but
     reports a reason has still told us the answer is whole. Requiring both
     would turn a working provider into a permanent failure; requiring neither
     is what produced the bug. */
  if (!stopped && !end.terminated && finishReason === null) {
    line.error(
      { model: used, ms: since(started), chars: text.length },
      `stream from ${used} ended without finishing`,
    );
    throw new Error("The answer stopped arriving before it was finished. Try again.");
  }

  const answer = text.trim();
  /* Nothing arrived. Which is two completely different events wearing one
     condition, and the branch is what keeps them apart.

     A model that streams cleanly and says nothing is the silent-success shape
     this repo keeps a document about — a 200, a well-formed stream, an empty
     answer — and it fails loudly rather than storing a blank turn that looks
     answered.

     A reader who presses stop before the first word is not that. Nothing is
     wrong, there is no provider to blame, and there is nothing to try again.
     It used to throw here, which meant a fast stop was filed as a model
     failure: a red row and an apology for a button they had just pressed. So it
     falls through instead, and is stored as what it is — a `done` answer, zero
     characters long, flagged `stopped`. `recentHistory` drops it on the empty
     text, so the model is never sent a turn where it said nothing. */
  if (answer === "" && !stopped) {
    line.error({ model: used, ms: since(started), finishReason }, `${used} returned no text`);
    throw new Error(`The model returned no text (finish_reason: ${finishReason ?? "?"}).`);
  }

  const known = idsOf(blocks);
  const unknownIds = unknownCitedIds(answer, known);
  const citedBlocks = citedBlockIds(answer, known).length;

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
        /* Chat is where the article is re-sent most often — once per turn, for
           the life of a conversation. From the second turn on, `cacheReadTokens`
           should be close to the article's own token count; a 0 there means
           every turn is paying full price again and the only symptom is the
           bill. docs/reusable/silent-success.md. */
        cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens: usage?.prompt_tokens_details?.cache_write_tokens ?? null,
        tooShortToCache,
        searches,
        citations: citations.size,
        /* **The number that says the feature is still the feature.**
           `unknownIds` was meant to expose prompt drift and does not expose the
           most obvious kind: a model that stops citing altogether produces zero
           invented ids and looks perfect. `citations` above counts *web* pages,
           not blocks, which made the line read as though something had been
           cited when nothing had. A run of answers with `citedBlocks: 0` is
           chat quietly becoming the uncited chatbot vision.md refuses.
           Added after a GPT-5.6 review, 2026-08-26. */
        citedBlocks,
        answerChars: answer.length,
        historyTurns: recentHistory(history).length,
        unknownIds: unknownIds.length,
        finishReason,
        stopped,
      },
      stopped
        ? `reader stopped an answer from ${used} after ${answer.length} characters`
        : `answered a chat question with ${used} (${searches} web search${searches === 1 ? "" : "es"})`,
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
    stopped,
  };
}

/* ------------------------------------------------------- shared plumbing --
   `sseChunks`, the abort helpers and the usage types moved to
   src/openrouter-stream.ts when explain.ts became a stream too and needed all
   of them. Nothing about them changed.

   `stoppedByReader` is re-exported rather than left to be imported from the new
   module, because tests/converse-stop.test.ts imports it from here and, more to
   the point, it is *about* chat's stop button — this is where a reader looking
   for it will come.

   `readerAborted` was re-exported beside it on the same reasoning and nothing
   ever took it: converse.ts and explain.ts both import it straight from
   openrouter-stream.js, and the test named above imports only `stoppedByReader`.
   Dropped 2026-08-26 — the discoverability argument is real, but it was being
   made on behalf of a reader who never arrived, and a re-export nobody uses is
   one more name to keep true. */
export { stoppedByReader } from "./openrouter-stream.js";
