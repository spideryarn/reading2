/**
 * **Turning a recording into words, for this dashboard's own text boxes.**
 *
 * One OpenRouter call, our own vocabulary, and no part of the product's server.
 * The browser half is `src/web/useDictation.ts`, reused rather than copied —
 * docs/plans/260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md
 * § Stage E — what the fleet now depends on.
 *
 * ## Why this is not `src/transcribe.ts`
 *
 * That file does the same job and is better tested, and importing it was the
 * first candidate. It was ruled out by measurement rather than principle: its
 * import closure is **162 files and 118,171 lines** (GPT Sol's AST walk;
 * a regex walk here first said 161 and 118,082), pulling `pg`,
 * `drizzle-orm`, `stripe`, `jsdom`, `@mozilla/readability`, `pino` and the
 * Anthropic SDK into a tool whose entire claim is that it runs on the box with
 * the product's server absent — overseer-direction.md § Principles. A
 * dashboard that needs a Postgres driver installed in order to hear a sentence
 * is not that tool. Even the smallest useful piece of it, `transcribeWith`,
 * still reaches `ai-call.ts` at 21 files and 20,505 lines.
 *
 * `transcribeWith` used standalone writes no database row, and the honest
 * consequence is worth saying out loud: **going through it would not have
 * metered this spend either.** (The mechanism is not a process-global sink
 * waiting to be installed, which is what this comment said until GPT Sol
 * corrected it: a sink belongs to `collectSpend`'s async scope, and a call
 * outside one increments an unscoped counter, warns, and drops the record.) No `ai_calls` row, nothing for
 * `npm run cost` to count. The fleet's OpenRouter spend is invisible to the
 * product's ledger whichever shape is chosen, so that is a property of being a
 * separate tool rather than a cost of this decision. A dictation is about
 * $0.0005.
 *
 * ## What IS borrowed
 *
 * The three files under `src/` that import nothing at all:
 * [`dictation-limits.ts`](../../src/dictation-limits.ts) (the size cap and the
 * container list, which the browser half checks against too, so they cannot be
 * two numbers), [`dictation-fillers.ts`](../../src/dictation-fillers.ts) (the
 * ums, deleted — a function that can only ever *delete* words) and
 * [`vocabulary.ts`](../../src/vocabulary.ts) via `./vocabulary.ts`.
 *
 * ## Still through the gateway
 *
 * `POST https://openrouter.ai/api/v1/audio/transcriptions`, so
 * docs/project/ai-gateway.md's rule is not weakened and no second gateway
 * appears. The route, the model and the `keywords` shape are all copied from
 * `outgoingTranscription` in `src/ai-call.ts` — which is a duplication, and is
 * named as one in the plan doc rather than pretended away. It is about forty
 * lines of request shape against twenty thousand of closure.
 *
 * ## The audio is not logged, in any form
 *
 * Not the bytes, not the transcript, and **not a size that accumulates** — a
 * running tally of request sizes is a picture of when somebody was talking.
 * What this file logs is a failure's reason and nothing else. Asked for by
 * `claude-agents-dashboard`, and it is the same rule
 * docs/project/logging.md states for the product.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripFillers } from "../../src/dictation-fillers.js";
import {
  type AudioFormat,
  MAX_AUDIO_BASE64,
  tooLongMessage,
} from "../../src/dictation-limits.js";

/** What the model is asked. `openai/gpt-transcribe`, the same one the product settled on. */
export const FLEET_DICTATION_MODEL = "openai/gpt-transcribe";

const OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

/**
 * How long to wait for the transcriber before giving up.
 *
 * Shorter than the product's ninety seconds. A dictation into this page is a
 * sentence or two of steering, not a paragraph of reading notes, and the person
 * waiting is looking at a phone.
 */
const TIMEOUT_MS = 45_000;

/**
 * Below this, nothing is sent and the answer is an empty transcript.
 *
 * A press-and-release with nothing said produces a fraction of a second of
 * container header, and a transcriber handed that invents a sentence — the
 * product's `MIN_AUDIO_BASE64` exists for the same reason. ~2 seconds at the
 * recorder's measured ~14 KB/s, base64'd.
 */
export const MIN_AUDIO_BASE64 = 37_000;

/**
 * A transcript far longer than anything that could have been said.
 *
 * The loose tripwire that stands in for the JSON schema the chat endpoint used
 * to enforce: this is still a generative model returning free text, and the
 * failure to catch is one that answers the question instead of transcribing it.
 * A person talking for the maximum recordable time does not produce this many
 * characters.
 */
const MAX_TRANSCRIPT_CHARS = 20_000;

/**
 * The result, and the three shapes a failure is allowed to take.
 *
 * **`status` is what decides whether a Retry is offered**, read off the number
 * rather than out of the sentence — `dictation-upload.ts` in the product makes
 * the same argument, and the fleet's own uploader follows it. A 400 the service
 * found malformed will be found malformed again; a 502 very likely will not.
 */
export type FleetTranscription =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string };

/**
 * **The key, read from one place and never spread into `process.env`.**
 *
 * `src/env.ts`'s `loadEnvLocal` was the obvious reuse and is deliberately not
 * taken. It applies the *whole* of `.env.local` — `DATABASE_URL`, the Supabase
 * service key, Stripe — into the environment of a long-lived process that is
 * reachable over the tailnet. This tool needs one variable, so it reads one
 * variable, and everything else in that file stays where it is.
 *
 * The shell wins if it has an answer, which is how a unit file or a test
 * overrides it without touching the repo.
 */
let cachedKey: string | null | undefined;
export function openRouterKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    cachedKey = fromEnv.trim();
    return cachedKey;
  }
  /* Two directories up from `tools/fleet/` is the repo root, computed from this
     file's own location rather than from `process.cwd()` — which tree this
     server belongs to is a fact about where it sits, not about where the
     command was typed. The same argument vite.fleet.config.ts makes. */
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    const text = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line.startsWith("OPENROUTER_API_KEY")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value !== "") {
        cachedKey = value;
        return cachedKey;
      }
    }
  } catch {
    /* No file is fine; the variable may be set some other way, and the caller
       below turns "no key" into a sentence rather than a crash. */
  }
  cachedKey = null;
  return cachedKey;
}

/** Only for tests, which set the environment after this module has been imported. */
export function forgetOpenRouterKey(): void {
  cachedKey = undefined;
}

/**
 * **What a provider's status code means, in words a person can act on.**
 *
 * A twenty-line mapping rather than an import of `src/messages.ts`, whose
 * closure is 11,591 lines of product domain types. The codes are deliberately
 * the same names the product uses for the same branches — a code names a
 * branch, and Greg quoting `[ai-busy]` should mean one thing on this box
 * whichever page he was looking at (docs/project/copy.md § The bracketed code).
 *
 * `status` is what this returns to the browser, and it carries the Retry
 * decision: anything a second identical request cannot fix comes back as a 503,
 * which the client shows with no Retry button.
 */
function providerFailure(status: number): { status: number; message: string } {
  if (status === 429)
    return { status: 429, message: "The transcriber is busy. Try again in a few seconds. [ai-busy]" };
  if (status === 402)
    return { status: 503, message: "This box's OpenRouter account is out of credit. [ai-no-credit]" };
  if (status === 401 || status === 403)
    return { status: 503, message: "OpenRouter refused this box's API key. [ai-key]" };
  if (status === 413)
    return { status: 413, message: tooLongMessage() };
  if (status >= 400 && status < 500)
    return {
      status: 503,
      message: `The transcriber refused that recording (${status}), and would refuse it again. [ai-bad-request]`,
    };
  return {
    status: 502,
    message: "The transcriber failed. Try again. [ai-upstream]",
  };
}

/**
 * Transcribe one recording.
 *
 * @param audio base64. Checked against the shared cap here as well as in the
 *   browser, because the browser's copy is the one an attacker skips.
 */
export async function transcribeForFleet(args: {
  audio: string;
  format: AudioFormat;
  vocabulary: readonly string[];
  signal?: AbortSignal;
  /** Injected by tests. Nothing in the server passes these. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<FleetTranscription> {
  const key = args.apiKey ?? openRouterKey();
  if (key === null || key === undefined) {
    return {
      ok: false,
      status: 503,
      message:
        /* **The product's exact sentence, for the product's exact branch.**
           `tests/dictation-codes.test.ts` scans both trees since 2026-09-08, and
           the reason is the reader rather than the code: Greg quotes four
           characters off a phone and does not know which of the two servers
           produced them. Mine said "on this box — there is no
           OPENROUTER_API_KEY", which is more useful to me and less useful to
           him, and made one code name two sentences. */
        "Dictation is not configured on this server. [mic-not-set-up]",
    };
  }
  if (args.audio.length > MAX_AUDIO_BASE64) {
    return { ok: false, status: 413, message: tooLongMessage() };
  }
  /* **An empty transcript is a success, not an error.** Somebody who pressed the
     button and said nothing gets their box left exactly as it was. */
  if (args.audio.length < MIN_AUDIO_BASE64) return { ok: true, text: "" };

  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const abort = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline;
  const doFetch = args.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(OPENROUTER_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8787",
        "X-Title": "Spideryarn fleet dashboard",
      },
      body: JSON.stringify({
        model: FLEET_DICTATION_MODEL,
        input_audio: { data: args.audio, format: args.format },
        /* `json`, not `verbose_json`: the extra field is timestamps nothing here
           reads, and OpenRouter documents some models rejecting the verbose form
           outright. Copied from src/ai-call.ts's `outgoingTranscription`. */
        response_format: "json",
        /* **The vocabulary, and the whole reason this endpoint was worth using.**
           `provider.options.openai.keywords` is forwarded by OpenRouter to
           `gpt-transcribe`; the same list in the chat route's `prompt` field was
           accepted with a 200 and changed nothing. Measured 2026-09-07,
           docs/project/dictation.md. Omitted rather than sent empty, because an
           empty block is a shape nothing has been measured against. */
        ...(args.vocabulary.length === 0
          ? {}
          : { provider: { options: { openai: { keywords: [...args.vocabulary] } } } }),
      }),
      signal: abort,
    });
    /* **No binding, because nothing may be read off it.** `catch {}` rather than
       `catch (err)` says that out loud: on this wire a thrown message can carry
       a prefix of the request body, and the request body is somebody talking.
       An unused binding would be a warning; an unused binding somebody later
       "fixed" by logging it would be a voice in a log file. */
  } catch {
    /* The caller's abort is somebody navigating away and needs no sentence; our
       own deadline is a person watching a spinner and does. */
    if (args.signal?.aborted === true) {
      return { ok: false, status: 499, message: "" };
    }
    /* Nothing from `err` is quoted. On this wire a thrown message can carry a
       prefix of the request body, and the request body is somebody talking. */
    return {
      ok: false,
      status: 502,
      message: "The transcription service could not be reached. [mic-no-upstream]",
    };
  }

  if (!response.ok) {
    const failure = providerFailure(response.status);
    return { ok: false, ...failure };
  }

  let text: unknown;
  try {
    text = ((await response.json()) as { text?: unknown }).text;
  } catch {
    text = undefined;
  }
  if (typeof text !== "string") {
    /* **Reached, answered 200, and said nothing we can read** — which is a
       different problem from never being reached, and telling them apart sends
       somebody to check a network that is fine. The product split these on
       2026-09-07 for exactly that reason. */
    return {
      ok: false,
      status: 502,
      message: "The transcription service sent back something we could not read. [mic-unreadable]",
    };
  }
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      status: 502,
      message: "The transcription service could not transcribe that. [mic-upstream]",
    };
  }
  return { ok: true, text: stripFillers(text.trim()) };
}
