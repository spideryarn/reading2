/**
 * **Turning a reader's voice into words.** The second half of dictation —
 * the browser's own recogniser gives live text while they talk, and this gives
 * the version that gets saved.
 *
 * The full reasoning, the measurements and the alternatives are in
 * [docs/plans/260827x-dictation-two-pass.md](../docs/plans/260827x-dictation-two-pass.md). The
 * three things worth knowing from here:
 *
 * ## It is a transcriber again, and the reason is a parameter that did not exist
 *
 * This file used to say, at length, that dictation went to a *chat* model
 * rather than to one of the dedicated transcribers, because the transcribers
 * had nowhere to put a vocabulary — `prompt` answered 200 and changed nothing.
 * That paragraph ended with the sentence that turned out to matter: *"some
 * providers have their own biasing parameter under `provider.options` … which
 * nothing here has ever tried, so 'has nowhere to put one' is more than was
 * measured."*
 *
 * It was. `openai/gpt-transcribe` takes a **`keywords` array**, and dictation
 * moved onto it on 2026-09-07 (docs/plans/260907c-dictation-onto-an-openai-transcriber.md).
 * The measurement is one line long and is the whole argument: on the clip that
 * says *Spideryarn*, without keywords it comes back **"Spiderrion"**, and with
 * them it comes back right — through OpenRouter and through OpenAI directly,
 * identically. `evals/dictation/probe-stt-routes.ts` re-runs it.
 *
 * **The same field is why live conversation hears jargon**, and it was found
 * there first: see `vocabularyTermsFor` in vocabulary-sources.ts, which records
 * that putting the list in `prompt` instead makes `gpt-4o-transcribe` read the
 * whole vocabulary back as a transcript when handed silence. Dictation now uses
 * that function rather than the joined-string one, so both halves of this app's
 * speech-to-text ask for their words the same way.
 *
 * ## What went away with the chat endpoint
 *
 * A system prompt saying three times over *never answer a question in the
 * audio*, a strict JSON schema so that a model which answered anyway had to put
 * the answer in a field labelled `transcript`, `require_parameters` so no
 * upstream could silently drop that schema, and a truncation check. All four
 * existed for one failure — a chat model handed a dictated question answers it,
 * and a good answer looks exactly like a working feature.
 *
 * They went because **this endpoint offers none of those controls**, which is a
 * smaller claim than the one the first draft of this comment made. It said a
 * transcription endpoint "cannot answer a question", and GPT Sol's plan review
 * was right to refuse that: `gpt-transcribe` is still a generative model
 * returning free text, and it can hallucinate, follow something it heard, or
 * emit whatever it likes. The schema never proved a string was a transcript
 * either — it only proved a string existed. So the honest position is that the
 * *defence* is gone along with the machinery that carried it, the exposure is
 * **smaller** rather than absent (there is no system prompt to override and the
 * vocabulary is a list of strings in a request field rather than text beside an
 * instruction), and what stands in for the schema is `MAX_TRANSCRIPT_CHARS`
 * below plus the tests for dictated questions and commands in
 * `tests/transcribe.test.ts`.
 *
 * What remains besides is `tidy` and `stripFillers`, which are about the
 * reader's words rather than the model's manners.
 *
 * ## The vocabulary is assembled here, never sent by the client
 *
 * The client says *where* the reader is dictating — a `Where` — and this file
 * turns that into words. Two reasons, and the second is the one that matters:
 * a box adopting dictation should not have to know how to build a vocabulary,
 * and a vocabulary accepted from a client is a string a caller chooses landing
 * in a system prompt, which is a prompt-injection surface built on purpose for
 * no gain, since the server has the glossary already.
 *
 * ## The audio is never kept
 *
 * It arrives base64 in one request, goes out base64 in one more, and is gone
 * when the request ends. Nothing writes it down and nothing logs it — the same
 * rule that keeps a reader's question and the article's prose out of the log
 * covers a transcript exactly as well. docs/project/logging.md.
 */
import { stripFillers } from "./dictation-fillers.js";
import { loadEnvLocal } from "./env.js";
import { errorFields, log, since } from "./log.js";
import { providerHttpFailure } from "./messages.js";
import { DICTATION_MODEL } from "./models.js";
/* **The words, and nothing about where they came from.** Everything that turns
   a place into a term list lives in vocabulary-sources.ts, so this file is
   about the model call and a new box that takes dictation never touches it.
   `Where` and `parseWhere` are re-exported below, because every caller of this
   module needs them and none of them should have to know there are two files. */
import { type Where, vocabularyTermsFor } from "./vocabulary-sources.js";
export { parseWhere, vocabularyFor } from "./vocabulary-sources.js";
export type { Where };
/* **Shared with the browser, and it has to be.** The recorder's cap, the
   request's cap and Vercel's cap are one arithmetic problem with two ends;
   see src/dictation-limits.ts for why a copy on each side is the shape of a
   bug that only appears in production. Re-exported so callers of this module
   need not know there are two files. */
import {
  type AudioFormat,
  MAX_AUDIO_BASE64,
  isAudioFormat,
  tooLongMessage,
} from "./dictation-limits.js";

export { MAX_AUDIO_BASE64, isAudioFormat, tooLongMessage };
export type { AudioFormat };

import {
  ProviderRefused,
  type TranscriptionCall,
  openRouterTranscription,
} from "./ai-call.js";
const line = log("model");

/** Below this there is nothing to transcribe, and asking invites an invention. */
const MIN_AUDIO_BASE64 = 2_000;

/**
 * **What stands in for the JSON schema**, which went with the chat endpoint.
 *
 * A transcription endpoint gives no way to constrain the answer's shape, so the
 * one property still worth enforcing is that a transcript is roughly the size of
 * the thing that was said. The recorder stops at five minutes; speech runs about
 * 150 words a minute, so a very talkative 750 words is ~5,000 characters and
 * this is four times that. A reply longer than this is not a long dictation, it
 * is a model that started writing — the failure the old schema existed to make
 * obvious, arriving by a different door.
 *
 * Deliberately loose. It is a tripwire for a model that has gone somewhere else
 * entirely, not an opinion about how much anybody may say, and the failure it
 * catches is one nobody would otherwise see: the words silently *replace* what
 * the reader said. GPT Sol's plan review, finding 6.
 */
const MAX_TRANSCRIPT_CHARS = 20_000;

/**
 * How long a reader will wait before we say it did not work.
 *
 * Measured round trips for 22 seconds of audio sat at 2.0–3.4 seconds, and
 * OpenRouter's own upstream processing timeout on the audio path is 60. This is
 * the outer bound on the whole request, so a slow network on a five-minute
 * recording is inside it and a hung upstream is not.
 */
const TIMEOUT_MS = 90_000;

/**
 * What a transcription can come back as.
 *
 * `text` is empty for a recording with no speech in it, which is a success and
 * not an error: the reader pressed the button, said nothing, and the box should
 * be left exactly as it was.
 */
export interface Transcription {
  text: string;
  model: string;
  ms: number;
  /* **There is no `usd` here any more, and that is a statement rather than an
     omission.** It carried OpenRouter's `usage.cost` so a benchmark could check
     its own arithmetic (GPT Sol's second review, item 7). The transcription
     endpoint reports `cost: 0` for every call — 3 seconds and 22 both measured
     on 2026-09-07 — so the field could only ever have been a zero that a
     results file then totalled. A benchmark that wants this figure has to ask
     the account for it: `npm run cost --reconcile`. */
  /**
   * **What actually answered**, when OpenRouter says — which is not always what
   * `model` asked for.
   *
   * Also here for a benchmark, and for the same reason as the `model` option on
   * `transcribeWith`: a bake-off that reports a slug it *sent* rather than the
   * one that *replied* can score a fallback and call it a candidate. Nothing in
   * the request path reads it.
   *
   * It used to say this mattered because dictation routed with `zdr: true` and
   * OpenRouter was therefore choosing an upstream under a constraint. That
   * reason is gone with the flag (`AI_JOB_ROUTE`, 2026-09-07) and the field is
   * not: `openai/gpt-transcribe` has one endpoint today and may not tomorrow.
   */
  answeredBy?: string;
}

/**
 * Transcribe one recording.
 *
 * @param audio base64, already checked against {@link MAX_AUDIO_BASE64}.
 * @param format the container, already checked by {@link isAudioFormat}.
 */
export async function transcribe(
  audio: string,
  format: AudioFormat,
  where: Where,
  signal?: AbortSignal,
): Promise<Transcription> {
  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    line.error("OPENROUTER_API_KEY is not set — every dictation will fail");
    throw Object.assign(
      new Error("Dictation is not configured on this server. [mic-not-set-up]"),
      { status: 503 },
    );
  }
  if (audio.length < MIN_AUDIO_BASE64)
    return { text: "", model: DICTATION_MODEL, ms: 0 };

  /* **The clock starts before the vocabulary, not after it.** It used to start
     after, which hid the one part of this request that ships an article's worth
     of blocks: `loadArticle` sanitises every block through jsdom, measured at
     76–184 ms locally in docs/plans/260828c-library-read-latency.md, and none of it
     appeared in the `ms` we log or in the eval's timings. A cost that is not in
     the number is a cost nobody will ever be asked about. GPT Sol's review,
     item 9. */
  const started = Date.now();
  const vocabulary = await vocabularyTermsFor(where);
  const vocabularyMs = Math.round(since(started));
  /* **An empty vocabulary is a bug, and it has no other symptom.**
     `RECIPES` gives every place `site` — the app's own words, a constant, no
     store read and nothing to fail — so there is no legitimate way to arrive
     here with nothing to say. If we ever do, the transcript is merely a bit
     worse and nobody finds out: docs/reusable/silent-success.md, and
     docs/project/dictation.md § The ways it fails, failure 3, which is the class
     Greg's 2026-09-04 report ("often when I mention Spideryarn, it spells it
     wrong") suspected. The length rather than the words, for the reason every
     other line in this file gives: a vocabulary carries an article's prose.
     The successful case is counted on the `dictation transcribed` line below;
     this one fires whether or not the call that follows it succeeds. */
  if (vocabulary.length === 0) {
    line.warn(
      { where: where.kind, vocabularyMs },
      "dictation vocabulary came back empty",
    );
  }
  return transcribeWith(audio, format, vocabulary, {
    signal,
    startedAt: started,
    vocabularyMs,
    where: where.kind,
  });
}

/**
 * The transcription itself, given the words rather than the place.
 *
 * **Split out so that the eval can send the production request.** It used to be
 * one function, and `evals/dictation/bench-vocabulary-sources.ts` therefore
 * built its own `fetch` with its own system prompt and no JSON schema — which
 * meant every number it produced was about a request this app never sends. GPT
 * Sol's review, item 3, found it by reading the two side by side. The eval now
 * calls this, so the prompt, the schema, `require_parameters`, the truncation
 * and refusal checks and `tidy()` are the same code in both.
 *
 * Not exported for any other reason. Callers in the app should use
 * {@link transcribe}, which is the one that knows how to build a vocabulary and
 * therefore the one that cannot be called with somebody else's.
 */
export async function transcribeWith(
  audio: string,
  format: AudioFormat,
  /**
   * The spellings, as a list — the shape `keywords` wants and the shape
   * `vocabularyTermsFor` has always produced. It was a joined string while this
   * went to a chat model, because a chat model reads a sentence.
   */
  vocabulary: readonly string[],
  opts: {
    signal?: AbortSignal | undefined;
    startedAt?: number;
    vocabularyMs?: number;
    where?: string;
    /**
     * **Which model, for a bake-off — and for nothing else.**
     *
     * It defaults to {@link DICTATION_MODEL} and every caller in `src/` leaves
     * it alone; `evals/dictation/bench-models.ts` is the one that sets it.
     *
     * It is here because the alternative silently lies. That benchmark used to
     * have a `MODEL` constant at the top of the file which was a *label*: the
     * call went through this function to `DICTATION_MODEL` regardless, so a
     * results file could name one model and have measured another. A benchmark
     * whose model is a comment is the same failure as an eval that reimplements
     * the request it is measuring — docs/reusable/silent-success.md — and the
     * fix in both cases is that the eval sends the app's own request, with the
     * one thing it is varying actually varied.
     */
    model?: string;
  } = {},
): Promise<Transcription> {
  const {
    signal,
    vocabularyMs = 0,
    where = "direct",
    model = DICTATION_MODEL,
  } = opts;
  const started = opts.startedAt ?? Date.now();

  /* Two aborts, one signal. The caller's covers a reader who navigated away;
     ours covers an upstream that stopped answering. `AbortSignal.any` rather
     than a hand-rolled pair, so the fetch sees one thing and there is no state
     to keep in step. */
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;

  /* **The request, the status check and the spend record are one operation now**
     — src/ai-call.ts. `provider` moved to `AI_JOB_ROUTE` there, comment and
     all: `zdr` is what lets the copy beside the microphone say the reader's
     voice is not stored, and a routing flag that load-bearing should not be one
     of six independent copies of a routing flag. */
  let call: TranscriptionCall;
  try {
    call = await openRouterTranscription(
      "dictation",
      {
        model,
        audio,
        format,
        /* **The vocabulary goes in a field of its own, and that is the whole
           point of this endpoint.** It used to be interpolated into a `<vocabulary>`
           fence inside a user message, capped and delimited and labelled as
           data, because glossary terms come out of articles this app did not
           write and a chat model reads whatever is next to its instructions.
           `keywords` is a list of strings in a request field: there is no
           instruction for it to be next to. The fencing in `packTerms` stays
           anyway — angle brackets to spaces, control characters out — and now
           earns its keep twice over, because OpenAI documents rejecting the
           *entire request* when a keyword contains `<`, `>`, CR or LF. */
        keywords: vocabulary,
      },
      { signal: abort },
    );
  } catch (err) {
    if (err instanceof ProviderRefused) {
      /* **The provider's body never reaches this line**, and the first version
         of this got it exactly backwards: it wrote 300 characters of the
         response into a field, on the reasoning that the reader's copy cannot
         tell a 400 from a 429 and somebody has to be able to.

         That reasoning is fine and the conclusion was wrong, because a provider
         may echo the request back — and the request here is a reader's **voice**,
         their article's vocabulary, and possibly a transcript of what they just
         said. docs/project/logging.md states the rule as *"do not interpolate
         untrusted content into an error you intend to throw"*, and names the two
         places that had already made this mistake; this would have been the
         third. GPT Sol's code review, 2026-08-27, item 2. `ProviderRefused`
         carries the status and nothing else, which is the whole of what
         distinguishes a 400 from a 429, and is structured, ours, and enough. */
      line.error(
        { status: err.status, model, ms: since(started) },
        "dictation service refused",
      );
      /* **429 and 402 get their own words**, from the file that owns
         reader-facing model-failure copy. "Could not transcribe that" is right
         for a 400 and wrong for a busy service: it reads as *your recording is
         the problem*, when the fix is to wait ten seconds. `providerHttpFailure`
         already says exactly that and already carries the `kind` that decides
         whether a retry is offered. GPT Sol's code review, item 10. */
      const known =
        err.status === 429 || err.status === 402 || err.status === 401;
      throw Object.assign(
        new Error(
          known
            ? providerHttpFailure(err.status).message
            : "The transcription service could not transcribe that. [mic-upstream]",
        ),
        /* **401 and 402 keep their own status**, and that is not cosmetic: the
           browser decides whether to offer a Retry from the status alone
           (`retryable` in `web/dictation-upload.ts`), and flattening a dead key
           or an exhausted balance into 502 made both look like a service that
           had merely broken. The reader would then be invited to press a button
           that cannot work, which is the mistake docs/project/copy.md singles
           out. GPT Sol's code review, R2. */
        {
          status:
            err.status === 429 || err.status === 402 || err.status === 401
              ? err.status
              : 502,
        },
      );
    }
    line.error(
      { ...errorFields(err), model, ms: since(started) },
      "dictation call did not complete",
    );
    /* **Its own code, because it is its own sentence.** Until 2026-09-05 this
       and the refusal below both said `[mic-upstream]`, so a reader quoting
       four characters named two branches — a service that answered "no" and a
       service that did not answer at all, which are different things to look
       into. `tests/dictation-codes.test.ts`. */
    throw Object.assign(
      new Error(
        "The transcription service could not be reached. [mic-no-upstream]",
      ),
      { status: 502 },
    );
  }

  /* **The unwrapping that used to live here is gone with the chat endpoint.**
     It read `choices[0].message.content`, parsed that string as JSON, and took
     a `transcript` field out of it — four places for an answer to be shaped
     wrongly, each with its own thrown sentence. This endpoint answers `{text}`,
     and `openRouterTranscription` is where a `text` that is not a string
     becomes an error, so there is nothing left to unwrap.

     The truncation check went with it, and that is worth one line because it
     was load-bearing: `finish_reason: "length"` meant a chat model had run out
     of room mid-sentence and the result silently *replaced* what the reader
     said. A transcription endpoint has no token budget to run out of and
     returns no `finish_reason` at all. */
  const text = call.text;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    /* The length, never the words — this is the one branch where the words are
       most likely to be something other than the reader's, and that is not a
       reason to log them. */
    line.error(
      { model, chars: text.length, ms: since(started) },
      "dictation answer was far longer than anything that could have been said",
    );
    throw Object.assign(
      new Error(
        "The transcription service could not transcribe that. [mic-upstream]",
      ),
      { status: 502 },
    );
  }

  /* **`tidy` undoes what the model did to the transcript; `stripFillers`
     removes what the *reader* said and did not mean.** Two functions and not
     one, because they answer to different people: `tidy` is repairing our own
     request's side effects (a chat model wraps its answer in quotation marks),
     and this is a product decision about a reader's words, made deterministically
     so that it cannot become a paraphrase. `src/dictation-fillers.ts` has the
     argument, including why it is not a line in `SYSTEM` above. */
  const spoken = tidy(text);
  const cleaned = stripFillers(spoken);
  line.info(
    {
      model,
      ms: since(started),
      // Lengths, never words. A transcript is as private as the question it
      // might be. What these catch is a pass that stops working: audio going up
      // and nothing coming back reads as a broken microphone from the client.
      audioKb: Math.round((audio.length * 3) / 4 / 1024),
      chars: cleaned.length,
      /* **Whether the stripper fired**, as a count of characters and never a
         word of it. A filler pass that quietly stopped matching would return a
         slightly worse transcript and have no other symptom —
         docs/reusable/silent-success.md, which is the class this feature's
         vocabulary already fell into once. */
      fillerChars: spoken.length - cleaned.length,
      /* **The count of terms, where this used to log their joined length.**
         Still a number and never a word of them, for the reason every other
         line in this file gives — a vocabulary carries an article's prose. */
      vocabularyTerms: vocabulary.length,
      /* Its own field, because it is the half of `ms` that is ours to fix. */
      vocabularyMs,
      where,
      /* **No `cost` field, and its absence is the honest reading.** This
         endpoint answers `usage: {seconds, cost}` with `cost: 0` — measured at
         3 seconds and at 22 — so logging it would put a zero beside every
         dictation and invite somebody to sum them. What the call really cost is
         recoverable from the account by `npm run cost --reconcile`; what it
         cost *this request* is not something OpenRouter tells us here. */
    },
    "dictation transcribed",
  );
  return {
    text: cleaned,
    model,
    ms: Math.round(since(started)),
    ...(call.answeredBy ? { answeredBy: call.answeredBy } : {}),
  };
}

/**
 * Undo the two things a chat model does to a transcript even when it obeys.
 *
 * It wraps the whole thing in quotation marks, and it adds a trailing newline.
 * Neither is what the reader said, and both land in the middle of a sentence
 * they are still writing.
 *
 * Deliberately **not** a general clean-up. Anything more ambitious would be
 * this file deciding what the reader meant, which is the one thing a
 * transcriber may not do.
 */
export function tidy(text: string): string {
  let out = text.trim();
  /* Only when *both* ends are quoted and the quotes are not doing work inside
     — `"yes," he said` is a sentence somebody dictated, not a wrapper. */
  const wrapped = /^"([^"]*)"$/.exec(out) ?? /^'([^']*)'$/.exec(out);
  if (wrapped?.[1]) out = wrapped[1].trim();
  return out;
}

