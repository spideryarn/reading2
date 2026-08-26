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
import { modelForOpenRouter } from "./models.js";
import { errorFields, log, since } from "./log.js";
import {

  type SearchUsagePath,
  type StreamEnd,
  type Usage,
  explainAbort,
  PROVIDER_ORDER,
  providerFailedMidAnswer,
  providerRefused,
  readerAborted,
  sseChunks,
  stoppedByReader,
  whereSearchCountCameFrom,
} from "./openrouter-stream.js";
import { ENDED_UNFINISHED, saidNothing } from "./messages.js";
import { isWebUrl } from "./urls.js";
import {
  type OpenRouterMessage,
  articleWithIds,
  cachedText,
  readerPositionLine,
  underCacheFloor,
} from "./article-prompt.js";

/**
 * Overridable with `SPIDERYARN_EXPLAIN_MODEL`. The default is whichever tier
 * src/models.ts puts the `explain` task on — this call used to name its own
 * model, which is how it came to be a version behind the rest of the app
 * without anyone noticing.
 */
export const DEFAULT_MODEL = modelForOpenRouter("explain");

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
 * Two minutes, matching chat's, because the model may run up to `MAX_SEARCHES`
 * searches before it says anything, and cutting off a search that was going to
 * answer the question is worse than waiting. It was ninety seconds while the
 * cap was four and the prompt only searched when it felt unsure; both of those
 * changed on 2026-08-26 and this did not, which would have shown up as
 * occasional timeouts on exactly the hard questions the change was for.
 *
 * The reader is not left staring at nothing for two minutes, though — the
 * answer streams, so the deadline is a bound on the *whole* answer rather than
 * on the wait before anything appears. What bounds that is `EXPLAIN_STALL_MS`.
 */
export const EXPLAIN_TIMEOUT_MS = 120_000;

/**
 * How long a *silent* stream is allowed to stay silent.
 *
 * A separate clock from the deadline above, because "slow" and "dead" are
 * different failures and only one of them is worth waiting through. A model
 * running three web searches sends nothing for a while and is working; a
 * connection that dropped mid-answer also sends nothing, forever, and the
 * overall deadline would sit on it for the full ninety seconds.
 *
 * Forty-five seconds because that is comfortably longer than the gap a search
 * leaves — and because OpenRouter sends `: OPENROUTER PROCESSING` keep-alives
 * through those gaps, which `sseChunks` counts as activity. See the note on
 * `onActivity` in src/openrouter-stream.ts: a version that counted only parsed
 * chunks aborted working answers at exactly this boundary.
 */
export const EXPLAIN_STALL_MS = 45_000;

/**
 * The most web searches one explanation may run.
 *
 * The same on every call — see the note where it is used. Eight rather than the
 * four this started at because the prompt now leans towards searching, and
 * because a common name needs two or three searches before "unfindable" is an
 * honest answer rather than a lazy one.
 *
 * The model is not told this number, so it cannot know when it has been cut
 * off — which means a truncated search run and a genuinely unfindable subject
 * produce the same sentence. That is what `cappedOut` in the log line is for.
 */
export const MAX_SEARCHES = 8;

/**
 * The whole article goes in the prompt every time — Greg asked for the answer to
 * be given "the whole text of the article", and a selection is almost always
 * ambiguous without it ("this move", "the same objection"). At ~15k tokens for
 * the test article that is a few cents a question, which is the right trade for
 * a tool whose entire point is understanding the piece rather than skimming it.
 *
 * ## The two questions, and why the second one had to be written down
 *
 * The first version of this prompt asked one question — what does this passage
 * claim, and where does it sit in the argument — and got exactly that. A reader
 * selected the name **Ben Miller** in Paul Graham's acknowledgements line and was
 * told, correctly and uselessly, that it is an acknowledgements line thanking
 * three people who read drafts, and that it does not connect to the argument.
 *
 * The model did not skip the web search because the encouragement was too mild.
 * It skipped it because it was never asked a question whose answer it lacked: it
 * was sure what an acknowledgements line is, and it was right. The gap never
 * opened, so nothing triggered.
 *
 * **We had already solved this once, in the glossary, on this same article.**
 * src/glossary.ts splits an entry in two — *senseHere*, what this author means,
 * from the article; and *background*, what the reader must bring to it, from the
 * model's own knowledge — and its worked example is the Lamport quotation two
 * paragraphs above the line in question. Its verdict on the bad version is the
 * sentence this prompt now borrows: *"That describes the page the reader is
 * looking at. It is the whole failure."* Explain had the first half only, so it
 * gave a senseHere answer to a background question. See
 * docs/project/glossary.md and docs/project/comments.md § The two questions.
 *
 * The other borrowed line is
 * docs/project/original-version/glossary.md § The prompt — "If you need to draw
 * on knowledge from outside the text, be very explicit about it" — which that
 * doc had already recommended for this file and nobody had yet moved across.
 */
const SYSTEM = `You are a reading assistant. A reader is part-way through an article and has
selected something they want explained. Explain it.

You are here to make deep reading cheaper, not optional. The reader can see the
words already; what they lack is whatever the selection assumes they know.

TWO QUESTIONS, AND THE SECOND IS THE ONE THAT GETS FORGOTTEN

Every selection raises up to two questions. A good answer knows which one it is
being asked, and a selection rarely says which.

  WHAT THE AUTHOR MEANS HERE — the claim in plainer words, the narrowed sense,
  the coinage, what this passage is answering and what it sets up. From the
  article and only the article.

  WHAT THE READER HAS TO BRING TO IT — who this person is, what this work,
  study, organisation or event is, what this term means outside this piece, what
  debate is being alluded to. This is your knowledge and the web's, not the
  article's.

A long selection — a sentence, a clause, an argumentative move — is usually the
first question. A SHORT selection, and especially a proper noun, a title or a
term of art, is almost always the second one wearing the first one's clothes.
Somebody who selects two words is not asking what the sentence around them does.
They are asking who or what that is. Answer the question they have.

THE FAILURE TO AVOID, STATED EXACTLY

Describing the page the reader is looking at. If someone selects a name in a
list of names, "this is the acknowledgements line, thanking three people who
read drafts" tells them nothing they could not see. Not knowing who the person
is, is not a reason to describe the line. It is the reason to search.

WHAT A GOOD ANSWER DOES

- Answers the question the selection actually raises, in plain words, WITHOUT
  flattening it into "the author argues that...". Keep the author's own
  distinctive vocabulary; those words are what the reader meets again later.
- Supplies the missing context: the term of art, the named person, the study,
  the debate, the earlier passage this one is answering.
- Says where it sits in the argument, when the selection is the kind of thing
  that sits in an argument. An acknowledgement is not.
- Marks a genuine ambiguity as ambiguous instead of picking a reading and
  sounding confident about it.

WHAT IT MUST NOT DO

- Do not summarise the article. The reader is reading it.
- Do not praise or grade the writing.
- Do not pad. Two or three short paragraphs is usually right; one is often
  better. Never more than four.
- Do not invent. But "the article does not say" is not an answer on its own —
  it is the point at which you go and find out. Say it only when you have looked
  and the thing is genuinely not establishable.

WEB RESEARCH: LEAN TOWARDS SEARCHING

You have a web search tool. Reach for it BY DEFAULT whenever the answer turns on
a fact you do not hold with specifics:

- a named person, organisation, work, study, product or event you cannot place
  with at least one concrete, checkable fact. A category is not a fact. "One of
  the people thanked" is a category; "co-founded X, wrote Y" is a fact. If all
  you have is the category, search.
- anything that may have happened or changed since your training
- a live argument, a contested number, or any claim you would hedge about

Do not search only to confirm something you could state precisely and would
stake the answer on.

Use the article to aim the search. The author, the date, the subject and the
other names around the selection are what turn a common name into a findable
one, and searching the bare selection on its own usually wastes the call.

Being unsure and not checking is the worst outcome here; a search you did not
need costs almost nothing. When you have searched, ground the relevant sentence
in what you found.

SAY WHERE IT CAME FROM

When you draw on knowledge from outside the article, be explicit about it in the
sentence itself: "Although the article doesn't say so, ...", "As you may know,
...". The reader is separately told whether you searched, but they should be
able to tell your knowledge from the page in front of them without being told.


FORMAT

Plain prose paragraphs, separated by blank lines. No headings, no bullet lists,
no preamble like "This passage means". Begin with the explanation itself.

Do not narrate your own process. The reader is separately told whether you
searched; a sentence about your tools is a sentence not about their question.

WHEN YOU COULD NOT ESTABLISH SOMETHING, THE ORDER IS FIXED

1. What you DID establish, however little. Who the neighbours in the sentence
   are, what kind of thing this is, what the article is doing with it.
2. What you could not, in ONE sentence, LAST, written as a fact about the
   subject rather than a report on your looking.

BAD, and this is the whole shape to avoid — it opens on step 2 and phrases it
as a search report:
  "I found nothing that clearly identifies a Ben Miller as a specific, known
  associate of Paul Graham."

GOOD — step 1, then step 2:
  "Jessica Livingston and Robert Morris, the other two names here, are both
  well known in Graham's world: his wife and Y Combinator co-founder, and the
  MIT computer scientist who wrote the 1988 internet worm. Ben Miller is not a
  public figure in the same way, and the article gives nothing further to go
  on."

Never open with "I", "None of", "The search", "Unfortunately", or "There is no
information". If the very first thing you have to say is a negative, you have
skipped step 1.`;

export interface ExplainRequest {
  meta: Meta;
  blocks: Block[];
  /** The block the selection sits in — marked in the prompt so "this" resolves. */
  blockId: string;
  quote: string;
  /**
   * The reader pressed "Search the web properly" — they have read an answer and
   * said it was not good enough.
   *
   * Adds an instruction after the cache breakpoint, and nothing else — see
   * `DEEP` for why "and nothing else" is load-bearing rather than minimal.
   */
  deep?: boolean;
  model?: string;
  signal?: AbortSignal;
  /** Overridable so a test can use a deadline it can actually wait for. */
  timeoutMs?: number;
  /** Overridable for the same reason as `timeoutMs`. */
  stallMs?: number;
}

export interface ExplainResult {
  answer: string;
  citations: Citation[];
  searches: number;
  model: string;
}

/**
 * What a streamed explanation emits: any number of `delta`, then exactly one
 * `done`. A throw means no `done`, and the deltas so far are all there is —
 * the same contract `converse` in src/converse.ts keeps, deliberately, so the
 * two routes that consume them can be read side by side.
 */
export type ExplainEvent =
  | { type: "delta"; text: string }
  | ({ type: "done" } & ExplainResult);

/**
 * The extra instruction for a deep search, and where it has to go.
 *
 * **It rides in the LAST user part, after the cache breakpoint — never in
 * `SYSTEM`.** `buildExplainMessages` puts the breakpoint on the article part,
 * so the cached prefix is *system + article*. A `SYSTEM` that differed between
 * an ordinary call and a deep one would be a different prefix, which means a
 * cache miss **and a second cache write of the entire article** — paying twice
 * for the thing docs/project/prompt-caching.md exists to stop us paying for
 * once. Nothing about that failure is visible from outside: the answer is fine,
 * it just costs more.
 */
const DEEP = `The reader has read an answer to this already and asked you to go and look properly.
Treat that as a statement that your own knowledge was not enough. Search, more
than once if the first result does not settle it, and use the article to narrow
it: the author, the date, the publication, the other names in the same sentence.
If the thing is genuinely unfindable, say so and say what you ruled out — that
is a better answer than the one they have just rejected.`;

/**
 * The messages this call will send, as a value a test can inspect.
 *
 * **The article part is identical for every selection in a piece.** It used to
 * carry the selected block inline, as `←READER IS HERE` inside the body, which
 * meant no two explain calls in this app's history ever shared a prefix. The
 * position now travels in the second part, with the quote — which tells the
 * model the same thing and leaves the first part alone.
 *
 * `deep` travels in that second part too, for the reason on `DEEP` above.
 *
 * See src/article-prompt.ts for why that matters, and
 * tests/article-prompt.test.ts for the test that stops it coming back.
 */
export function buildExplainMessages(
  meta: Meta,
  blocks: Block[],
  blockId: string,
  quote: string,
  deep = false,
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
          text: `${readerPositionLine(blockId)}\n\nThe reader has selected this passage, inside block ${blockId}:\n\n"""\n${quote}\n"""\n\nExplain it.${deep ? `\n\n${DEEP}` : ""}`,
        },
      ],
    },
  ];
}

/**
 * Explain a selection, a few words at a time.
 *
 * This is the whole implementation; `explain` below drains it. There is one
 * code path deliberately, because the alternative — a streaming version beside
 * a non-streaming one — is two sets of the invariants at the bottom of this
 * function, and those invariants are the reason a half-arrived answer is not
 * filed as a complete one.
 *
 * Modelled line for line on `converse` in src/converse.ts, including the two
 * clocks and the checks after the loop. Where the two differ, the difference is
 * commented rather than left to be noticed.
 */
export async function* explainStream({
  meta,
  blocks,
  blockId,
  quote,
  deep = false,
  model = process.env.SPIDERYARN_EXPLAIN_MODEL || DEFAULT_MODEL,
  signal,
  timeoutMs = EXPLAIN_TIMEOUT_MS,
  stallMs = EXPLAIN_STALL_MS,
}: ExplainRequest): AsyncGenerator<ExplainEvent> {
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

  const messages = buildExplainMessages(meta, blocks, blockId, quote, deep);

  /* Logged, not thrown — below the floor the breakpoint is accepted and does
     nothing, and the zeros that result are indistinguishable from a cache that
     has broken. Saying which it is costs one boolean. */
  const tooShortToCache = underCacheFloor(cachedText(messages));

  const deadline = AbortSignal.timeout(timeoutMs);
  /* The stall clock, and it has to be its own controller rather than another
     `AbortSignal.timeout`: a stall timer is one that gets *restarted* every
     time a chunk lands, and a timeout signal cannot be restarted. */
  const stall = new AbortController();
  let stallTimer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stall.abort(new Error("stalled")), stallMs);
  };

  /* Our own clock, deliberately, rather than any timing the provider reports.
     The original version of this app was burned by exactly that: the SDK left
     its own timestamp fields out of every response, so a latency chart built on
     them was empty and looked like "no slow calls" rather than "no data".
     `Date.now()` here cannot be omitted by anybody else. */
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
        // OpenRouter attributes traffic with these; harmless and useful in its dashboard.
        "HTTP-Referer": "http://localhost:5273",
        "X-Title": "Spideryarn",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        stream: true,
        /* Without this, a streamed response carries no `usage` at all — so the
           token counts, the cache counts and the web-search count all come back
           null and the log line says the call was free. The one flag whose
           absence looks like good news. */
        stream_options: { include_usage: true },
        tools: [
          {
            /* **Byte-identical on every call, including a deep one, and that is
               not a stylistic preference.** Tools render at position 0, ahead of
               the system prompt and the article, and editing a tool definition
               invalidates all three cache tiers — see the invalidation table in
               docs/research/prompt-caching-anthropic.md and note that neither of
               Anthropic's escape hatches applies on Sonnet 5. A `max_uses` that
               varied per request would mean two cached prefixes, each paying the
               1.25x write premium, and the only symptom would be the bill: the
               answer stays correct and `tooShortToCache` still reads false.

               This file's first draft did exactly that — `deep ? 8 : 4` — after
               taking pains to keep the deep instruction out of `SYSTEM` for the
               weaker version of the same reason. Caught in review, 2026-08-26.

               So the cap is a cap, not a quota: eight for everyone, and the
               model still decides whether to search at all. `deep` buys an
               instruction after the cache breakpoint and nothing else. */
            type: "openrouter:web_search",
            parameters: { max_uses: MAX_SEARCHES, max_results: 5 },
          },
        ],
        provider: PROVIDER_ORDER,
        messages,
      }),
    });
  } catch (err) {
    clearTimeout(stallTimer);
    /* `timedOut` is the field that matters here, and it is why this is logged
       as an object rather than folded into the message. "The model took too
       long" and "the network refused us" want different reactions — wait and
       retry versus go and look at the provider — and by the time the error
       reaches the reader both are just a sentence in a dialog. The headers are
       *not* logged: `redact` is path-based, and one of them carries the key. */
    line.error(
      {
        ...errorFields(err),
        model,
        ms: since(started),
        timedOut: deadline.aborted,
        stalled: stall.signal.aborted,
      },
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
    // provider might echo part of what we sent back at us, and what we sent is
    // the whole article plus the reader's selection.
    line.error(
      { model, ms: since(started), status: response.status },
      `OpenRouter refused: ${response.status}`,
    );
    throw providerRefused(response.status);
  }

  let text = "";
  const citations = new Map<string, Citation>();
  let searches = 0;
  let from: SearchUsagePath = "no-usage";
  let used = model;
  let finishReason: string | null = null;
  /* Local, NOT module-scope: two readers asking about two passages at once run
     two of these generators in one process, and a shared accumulator would
     report one selection's token counts against the other's log line. */
  let usage: Usage | undefined;

  const end: StreamEnd = { terminated: false };
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
      const counted = whereSearchCountCameFrom(chunk.usage);
      if (counted.searches !== null) {
        searches = counted.searches;
        from = counted.from;
      }
      // Held for the log line after the loop: the usage chunk is normally the
      // last of all and carries no choices, so it would otherwise be seen and
      // dropped.
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (err) {
    if (stoppedByReader(err, signal, deadline, stall.signal)) {
      /* The caller gave up — the reader closed the dialog, or navigated away.
         Not an error, and not logged as one. Unlike chat there is no stop
         button, so this is a disconnect rather than a decision, and there is no
         partial answer worth keeping: it falls out below with whatever arrived. */
      stopped = true;
      clearTimeout(stallTimer);
      line.info(
        { model: used, ms: since(started), chars: text.length },
        `explanation from ${used} was abandoned`,
      );
    } else {
      line.error(
        {
          ...errorFields(err),
          model: used,
          ms: since(started),
          timedOut: deadline.aborted,
          stalled: stall.signal.aborted,
          // How much the reader already watched arrive. "It died before saying
          // anything" and "it died two paragraphs in" are different faults.
          chars: text.length,
        },
        `stream from ${used} broke off`,
      );
      throw explainAbort(err, deadline, stall.signal, timeoutMs, stallMs);
    }
  } finally {
    clearTimeout(stallTimer);
  }

  /* An abort can also end the loop *cleanly*, because `sseChunks` cancels the
     reader on abort and a cancelled read resolves `{ done: true }` rather than
     throwing. Without this the reader's own disconnect gets filed as "the
     answer stopped arriving before it was finished". See the same guard, and
     the longer account of how it was found, in src/converse.ts. */
  if (!stopped && readerAborted(signal, deadline, stall.signal)) stopped = true;

  /* **And our own clocks can end it cleanly too**, for the same reason and with
     a worse consequence. When the stall timer fires, `sseChunks` cancels the
     reader; if that cancel wins the race against the pending read's rejection,
     the loop exits with no error at all — and the check immediately below then
     files a 45-second silence as "the answer stopped arriving before it was
     finished". Both sentences end in "try again", so the reader never notices;
     what is lost is the log line, which says `ended without finishing` instead
     of `stalled: true`, and that is the line somebody reads when explanations
     start failing and they want to know whether to blame the network or the
     provider.

     Caught by tests/explain.test.ts § says a silence is a silence — which is
     the test that mocks a body that opens and then says nothing, i.e. the one
     failure a mock made of whole frames cannot produce. */
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
    throw explainAbort(
      new Error("aborted"),
      deadline,
      stall.signal,
      timeoutMs,
      stallMs,
    );
  }

  /* **The stream stopped; did it finish?** `[DONE]` is the only clean end an
     SSE response has, and without this an ordinary EOF looks exactly like one:
     a connection cut two paragraphs in would be stored as a complete answer,
     `status: "done"`, with no error anywhere. `finish_reason` counts as a
     second witness — a provider that omits the terminator but says why it
     stopped has still told us the answer is whole. */
  if (!stopped && !end.terminated && finishReason === null) {
    line.error(
      { model: used, ms: since(started), chars: text.length },
      `stream from ${used} ended without finishing`,
    );
    throw new Error(ENDED_UNFINISHED.message);
  }

  const answer = text.trim();
  /* An empty completion is the silent-success shape: a 200, a well-formed
     stream, and nothing in it. Fail loudly rather than storing a blank comment
     that looks answered.

     Unlike chat, an abandoned explanation with no text throws too — there is no
     stop button here, so a reader cannot have meant it, and a comment stored as
     a `done` answer zero characters long would be a row nobody could act on. */
  if (answer === "") {
    line.error({ model: used, ms: since(started), finishReason }, `${used} returned no text`);
    throw new Error(saidNothing(finishReason).message);
  }

  /* The one line per successful explanation.
     `searchesFrom` is the point of it. A missing usage field reads as `0`, and
     "no web search needed" is a thing readers legitimately see, so a broken
     count looks exactly like a model that was sure. This field says *why* the
     number is what it is: `neither` on every call means OpenRouter moved the
     field and the count is now permanently zero, which is exactly the drift
     nobody would otherwise notice.
     Wrapped because logging must not be able to fail an explanation that has
     already arrived — the reader watched it appear. */
  try {
    line.info(
      {
        model: used,
        ms: since(started),
        deep,
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        /* Explain is the call prompt caching was introduced for: before it, the
           article was rendered afresh for every selection, so a reader who asked
           about ten sentences paid for the article ten times. A `cacheReadTokens`
           of 0 on a second selection in one article means that is still
           happening and nothing else will say so. */
        cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens:
          usage?.prompt_tokens_details?.cache_write_tokens ?? usage?.cache_write_tokens ?? null,
        tooShortToCache,
        searches,
        searchesFrom: from,
        /* Did it want more searching than it was allowed? The model is not told
           `MAX_SEARCHES`, so from inside the answer a run that was cut off and a
           subject that is genuinely unfindable produce the same honest sentence.
           This is the only place the two can be told apart, and if it starts
           reading `true` often the cap is the thing to raise. */
        cappedOut: searches >= MAX_SEARCHES,
        /* `length` means the answer stopped because it ran out of room, not
           because it was finished — and it is stored as a clean `done` either
           way, because there is nowhere on a `Comment` to say otherwise. Logged
           so that "answers keep trailing off" is a thing somebody can check
           rather than a thing somebody feels. */
        finishReason,
        citations: citations.size,
        answerChars: answer.length,
      },
      `explained a selection with ${used} (${searches} web search${searches === 1 ? "" : "es"})`,
    );
  } catch {
    // Nothing to do about it, and nothing worth failing a reader's answer over.
  }

  yield { type: "done", answer, citations: [...citations.values()], searches, model: used };
}

/**
 * The same explanation, waited for rather than watched.
 *
 * A thin drain of `explainStream`, so there is one implementation of the
 * request, the clocks and the end-of-stream invariants rather than two. The
 * glossary's per-term web lookup (`lookUpTerm`, src/api.ts) uses this: its panel
 * shows one answer appearing at a time and has nowhere to put a half-written
 * one, so it waits.
 */
export async function explain(req: ExplainRequest): Promise<ExplainResult> {
  for await (const event of explainStream(req)) {
    if (event.type === "done") {
      const { type: _type, ...result } = event;
      return result;
    }
  }
  /* Unreachable by the generator's own contract — it yields `done` or throws —
     and here so that a future edit which breaks that contract fails loudly
     instead of returning `undefined` as an answer. */
  throw new Error("The explanation ended without an answer.");
}
