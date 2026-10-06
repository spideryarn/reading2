/**
 * **One streamed, web-searching model call, from the clocks to the verdict** —
 * the machinery `explainStream` (src/explain.ts) used to hold inline, pulled out
 * so a second caller can have it without touching explain's request.
 *
 * Pulled out rather than parameterised because explain's request bytes are
 * somebody else's cache: comments and the glossary ride on explain's cached
 * prefix, and a seam on `explainStream` would have been one edit away from a
 * second cache write of the whole article on every call. So this takes the job
 * and the **whole request body** from its caller and never builds one, and
 * tests/explain-request-snapshot.test.ts pins what explain hands it.
 * docs/plans/260930a-citations-investigate-one-work-on-demand.md § Mechanism.
 *
 * The shared server shell for a streamed answer; the hand-rolled loops in
 * search and the referee runners are older copies of the same shape —
 * comments.md#streaming.
 *
 * ## What is here, and what is deliberately not
 *
 * Here: the deadline and the stall clock, the `openRouterStream` loop, the
 * citations (and, opt-in, the search extracts), the search count and **which
 * usage field it came from**, the usage, and `classifyEnd`'s verdict on how the
 * stream ended. Everything that is a fact about the transport.
 *
 * **Not here: what an ending means.** Which endings a caller accepts, whether an
 * empty answer is a failure, and every log line are the caller's — explain keeps
 * a truncated answer that another caller would refuse, and that is a decision,
 * not a fact. The failures this does detect are handed to `onFailure` for the
 * caller to log in its own voice, and then thrown exactly as explain threw them.
 *
 * ## Logging
 *
 * This module logs nothing itself, for the reason in src/explain.ts's header:
 * the caller's logger is the one carrying the ids that line a log line up with
 * a stored row, and **what never reaches any log is the prompt, the article,
 * the reader's selection, the answer, or a cited URL** — see `onDroppedCitation`.
 */
import type { Citation, SearchEvidence } from "./types.js";
import { StallReached } from "./call-failure.js";
import { since } from "./log.js";
import {
  type SearchUsagePath,
  type StreamEnd,
  type Usage,
  collectCitations,
  collectSearchEvidence,
  explainAbort,
  providerFailedMidAnswer,
  stoppedByReader,
  whereSearchCountCameFrom,
} from "./openrouter-stream.js";
import {
  type AiRequestBody,
  type ChatJob,
  ProviderRefused,
  type StreamOutcome,
  classifyEnd,
  openRouterStream,
} from "./ai-call.js";

/**
 * A failure this runner saw and is about to throw, handed to the caller first
 * so the log line is the caller's — its logger, its sentence.
 *
 * `refused` is thrown as the `ProviderRefused` itself. `broke` is thrown as
 * `explainAbort(err, …)`: the deadline's or the stall's sentence when one of our
 * clocks caused it, the original error otherwise.
 */
export type StreamFailure =
  | {
      kind: "refused";
      status: number;
      /** The model as far as the stream had said, else the one asked for. */
      model: string;
      ms: number;
    }
  | {
      kind: "broke";
      err: unknown;
      /** The model as far as the stream had said, else the one asked for. */
      model: string;
      /** The model the request asked for, whatever the stream later said. */
      requestedModel: string;
      ms: number;
      timedOut: boolean;
      stalled: boolean;
      /** How much text had already arrived. */
      chars: number;
      /**
       * Whether any chunk arrived at all. "It died before saying anything" and
       * "it died two paragraphs in" want different reactions, and with the
       * fetch inside the generator both surface from the same `catch`.
       */
      answered: boolean;
    };

export interface StreamRun {
  job: ChatJob;
  /** Sent as given. This module never adds to it, reorders it or rebuilds it. */
  request: AiRequestBody;
  /** The caller's own signal — a reader leaving. */
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  stallMs: number;
  /**
   * Also keep each cited page's search extract, capped — `collectSearchEvidence`.
   * Opt-in for the reason written there: a caller that stores citations would
   * otherwise start storing somebody else's page text.
   */
  collectEvidence?: boolean;
  /**
   * A citation was refused because its URL was not http(s). Handed the model,
   * **never the URL** — see `onDropped` on `collectCitations`.
   */
  onDroppedCitation?: (model: string) => void;
  /** Called once, just before the throw, for a failure the caller should log. */
  onFailure?: (failure: StreamFailure) => void;
}

/**
 * What a run yields: any number of `delta`, then exactly one `end`. A throw
 * means no `end`.
 *
 * `end` is a report, not a verdict. `outcome` is `classifyEnd`'s answer and
 * every kind reaches the caller, including the ones it will throw on — the
 * caller's `switch` is where that is decided, and `clockError()` is the sentence
 * for the two of them that our own clocks caused.
 */
export type StreamRunEvent =
  | { type: "delta"; text: string }
  | {
      type: "end";
      outcome: StreamOutcome;
      /** Everything that arrived, untrimmed. */
      text: string;
      citations: Citation[];
      /** Only when `collectEvidence` was asked for; `null` otherwise. */
      evidence: SearchEvidence[] | null;
      /**
       * The last search count the usage reported, or **`null` when none did** —
       * which is not zero, and is what `searchesFrom` explains.
       */
      searches: number | null;
      searchesFrom: SearchUsagePath;
      /** The model actually used, as the stream reported it. */
      model: string;
      usage: Usage | undefined;
      finishReason: string | null;
      /** `Date.now()` when the run began, for the caller's `since(started)`. */
      started: number;
      timedOut: boolean;
      stalled: boolean;
      /** The reader-facing error for a `timed-out` or `went-quiet` ending. */
      clockError: () => unknown;
    };

export async function* runStream({
  job,
  request,
  signal,
  timeoutMs,
  stallMs,
  collectEvidence = false,
  onDroppedCitation,
  onFailure,
}: StreamRun): AsyncGenerator<StreamRunEvent> {
  const model = request.model;
  const deadline = AbortSignal.timeout(timeoutMs);
  /* The stall clock, and it has to be its own controller rather than another
     `AbortSignal.timeout`: a stall timer is one that gets *restarted* every
     time a chunk lands, and a timeout signal cannot be restarted. */
  const stall = new AbortController();
  let stallTimer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stall.abort(new StallReached()), stallMs);
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

  /* **The request, the status check and the spend record are one operation now**
     — src/ai-call.ts. What used to be here was a `fetch`, a `!response.ok`
     branch and a `sseChunks` loop, with three chances to return early between
     paying for a call and recording it. The clocks above stay here, because a
     deadline is this feature's policy and not the transport's; `provider` moved
     into `AI_JOB_ROUTE`, because six callers each keeping their own copy of a
     routing preference is how three of them ended up differing. */
  touch();
  /* Which of two sentences the failure log gets. "It died before saying
     anything" and "it died two paragraphs in" want different reactions, and
     with the fetch inside the generator both now surface from the same `catch`. */
  let answered = false;

  let text = "";
  const citations = new Map<string, Citation>();
  const evidence = collectEvidence ? new Map<string, SearchEvidence>() : null;
  let searches: number | null = null;
  let from: SearchUsagePath = "no-usage";
  let used = model;
  /* Local, NOT module-scope: two readers asking about two passages at once run
     two of these generators in one process, and a shared accumulator would
     report one selection's token counts against the other's log line. */
  let usage: Usage | undefined;

  const end: StreamEnd = { terminated: false };
  try {
    for await (const chunk of openRouterStream(job, request, {
      signal: composite,
      onActivity: touch,
      end,
    })) {
      answered = true;
      if (chunk.model) used = chunk.model;
      // A 200 that carries an error in the stream — a mid-generation provider
      // failure. It arrives as data, not as a broken connection, so nothing
      // else would notice it.
      if (chunk.error) throw providerFailedMidAnswer();
      const choice = chunk.choices?.[0];
      /* No `finish_reason` scrape here any more: `openRouterStream` writes it
         onto `end` for every caller, and `classifyEnd` below is what reads it.
         This line was one of seven identical copies —
         docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md. */
      /* The rules are in `collectCitations`, beside the wire shape they are
         about; the warning is the caller's, because its logger is a child
         carrying its own ids (explain's carries the blockId, and chat's does
         not). It says nothing about *which* URL — see the note on `onDropped`. */
      collectCitations(choice?.delta?.annotations, citations, () => onDroppedCitation?.(used));
      /* The same annotations again, with their extracts, only for a caller that
         asked. No `onDropped` here: the same URL has just been refused above,
         and one refusal is one warning. */
      if (evidence) collectSearchEvidence(choice?.delta?.annotations, evidence);
      const piece = choice?.delta?.content;
      if (typeof piece === "string" && piece.length > 0) {
        text += piece;
        yield { type: "delta", text: piece };
      }
      const counted = whereSearchCountCameFrom(chunk.usage);
      if (counted.searches !== null) searches = counted.searches;
      /* **Assigned whenever accounting arrived, not only when a count was
         found** — and the difference is the whole point of the field.

         `from` used to be written inside the `if` above. `whereSearchCountCameFrom`
         returns `searches: null` in exactly the case where `from` is `"neither"`,
         so the one branch that reports the alarm was the one branch that skipped
         the assignment, and `"neither"` — the value whose only job is to say
         *OpenRouter has renamed the field again* — could never be logged. What
         production printed instead was `no-usage`, beside populated token counts
         out of the same `usage` object: the tripwire lying about which fault it
         had seen. docs/reusable/silent-success.md, and
         tests/search-usage-tripwire.test.ts.

         Guarded on `chunk.usage` rather than assigned unconditionally, because
         most chunks carry no usage at all and would otherwise reset a real
         answer to `"no-usage"` on the way past. */
      if (chunk.usage) from = counted.from;
      // Held for the caller's log line after the loop: the usage chunk is
      // normally the last of all and carries no choices, so it would otherwise
      // be seen and dropped.
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (err) {
    if (stoppedByReader(err, signal, deadline, stall.signal)) {
      /* The caller gave up — the reader closed the dialog, or navigated away.
         Not an error, and not logged as one. **Nothing is said or decided
         here**: this falls through to `classifyEnd`, which reaches `abandoned`
         from the same signals, so the throwing path and the clean-end path
         cannot come to say different things about one event. */
      clearTimeout(stallTimer);
    } else if (err instanceof ProviderRefused) {
      /* The status, not the body. OpenRouter's error text is the one place a
         provider might echo part of what we sent back at us, and what we sent is
         the whole article plus the reader's selection — so `ProviderRefused`
         carries the number and nothing else. */
      onFailure?.({ kind: "refused", status: err.status, model: used, ms: since(started) });
      throw err;
    } else {
      onFailure?.({
        kind: "broke",
        err,
        model: used,
        requestedModel: model,
        ms: since(started),
        timedOut: deadline.aborted,
        stalled: stall.signal.aborted,
        chars: text.length,
        answered,
      });
      throw explainAbort(err, deadline, stall.signal, timeoutMs, stallMs);
    }
  } finally {
    clearTimeout(stallTimer);
  }

  /* **How did this stream end?** One question with one true answer, asked of
     the shared classifier rather than re-derived here from three signals, a
     boolean and a string. explain.ts used to do that re-derivation in the same
     order as six others, with the same broken guard in it —
     docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md,
     and docs/plans/260901g-one-stream-end-classification-shared-by-five-callers.md
     for why the classifier reports and never decides.

     What each ending *means* is the caller's — explain's differs from quiz's on
     three of them. So the verdict is handed back, not acted on. */
  const outcome = classifyEnd(end, { signal, deadline, stalled: stall.signal });

  yield {
    type: "end",
    outcome,
    text,
    citations: [...citations.values()],
    evidence: evidence ? [...evidence.values()] : null,
    searches,
    searchesFrom: from,
    model: used,
    usage,
    finishReason: end.finishReason ?? null,
    started,
    timedOut: deadline.aborted,
    stalled: stall.signal.aborted,
    clockError: () => explainAbort(new Error("aborted"), deadline, stall.signal, timeoutMs, stallMs),
  };
}
