/**
 * **A short list from why you are reading, asked for** — the one model call
 * behind `POST /api/command-suggest/:slug`, and the prompt it sends. Plan
 * 261005k, Stage 2 (B); the shapes and the reading of the answer are
 * src/command-suggest.ts's.
 *
 * ```
 *   keys the browser sent ──► modes and sub-modes we hold, words from OUR list
 *   the profile, loaded by the route ──► About you + the reason for reading
 *                         │
 *        GPT Luna: up to 3 searches, 2 modes, 1 lens, a short why for each
 *                         │
 *        every field re-read, anything unknown or over length dropped
 * ```
 *
 * **What the model reads is what the reader wrote about themselves and this
 * server's own words for each mode.** Never the article: it is told so, and
 * told not to write as though it had read it.
 *
 * **This is the one prompt that turns a profile into words that leave the
 * conversation**, an exception to src/profile.ts § `PROFILE_RULES` and not a
 * reading of it (docs/project/reader-profile.md § The command bar's
 * suggestions). So it does not carry `PROFILE_RULES`; it carries rules of its
 * own, which ask the model to build the searches and the lens from the topic
 * and leave the person out. **Asked, not enforced**: nothing here can tell a
 * topic from a personal detail, and no doc or page may say otherwise.
 *
 * **Nothing here logs the profile, the reason or the suggestions** — kinds,
 * counts and timings only (docs/project/logging.md).
 */
import { type JsonCall, ProviderRefused, UnreadableAnswer, openRouterJson } from "./ai-call.js";
import catalogue from "./command-pick-catalogue.generated.json" with { type: "json" };
import type { PickKey, PickOption } from "./command-pick.js";
import {
  MAX_SUGGESTED_LENS_CHARS,
  MAX_SUGGESTED_MODES,
  MAX_SUGGESTED_SEARCHES,
  type Suggestions,
  readSuggestions,
} from "./command-suggest.js";
import { log, since } from "./log.js";
import { withChatJsonSchema } from "./messages-structured-output.js";
import { NOT_CONFIGURED, PROVIDER_UNREADABLE, type ReaderFacingFailure, tookTooLong } from "./messages.js";
import { QUICK_MODEL_OPENROUTER } from "./models.js";
import { plainWords } from "./plain-words.js";

/**
 * **The whole answer, or nothing.** The reader pressed a row and is watching
 * the bar. The eval's slowest call of 51 took 2.8 seconds
 * (docs/investigations/261005b-…); fifteen is an upstream that has stopped
 * answering. Its own number, not the pick's five: this call writes sentences.
 */
export const COMMAND_SUGGEST_TIMEOUT_MS = 15_000;

/**
 * **The ceiling on the answer**, its own and not the pick's hundred: six short
 * items with a sentence each come to about 250 tokens, and reasoning is off
 * for this job (src/ai-call.ts § `CHAT_REASONING`), so none of this is spent
 * thinking. An answer that hits it is cut-off JSON, read as unreadable.
 */
export const COMMAND_SUGGEST_MAX_TOKENS = 700;

/** Which prompt wrote a list. Bump it when `SUGGEST_SYSTEM` or the message changes: the eval's numbers belong to one version. */
export const COMMAND_SUGGEST_VERSION = "command-suggest/2";

/* ------------------------------------------------------------- the rows -- */

interface CatalogueRow extends PickOption {
  readonly kind: string;
}

const keyOf = (key: PickKey): string => `${key.id}\n${key.label}`;

/**
 * **The modes and sub-modes this server holds, by (id, label)** — the generated
 * list the pick reads (src/command-pick-call.ts § `CATALOGUE`), narrowed by its
 * own `kind` field. Archive, Export, *Run again*, the pages and the switches
 * are in that list and are **not** in this one.
 */
const SUGGESTABLE: ReadonlyMap<string, PickOption> = new Map(
  (catalogue as readonly CatalogueRow[])
    .filter((row) => row.kind === "mode" || row.kind === "submode")
    .map(({ id, label, description, aliases }) => [keyOf({ id, label }), { id, label, description, aliases }]),
);

/**
 * **The keys a suggestion may name, with this server's words for each** (F1 on
 * the plan). `knownOptions` would let through every row the bar has; a list
 * that may come back as *a mode worth opening* must hold only modes. In the
 * order sent, one per id.
 */
export function suggestableOptions(rows: readonly PickKey[]): readonly PickOption[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const option = SUGGESTABLE.get(keyOf(row));
    if (option === undefined || seen.has(option.id)) return [];
    seen.add(option.id);
    return [option];
  });
}

/* ----------------------------------------------- what the model is asked -- */

/**
 * The prompt. Its own rules about the profile, as Quiz has its own
 * (src/quiz.ts): `PROFILE_RULES` forbids exactly what this call is for.
 *
 * The plain-words core alone (docs/project/prompting-guide.md): the one thing
 * written for a reader here is the `why`, and its shape is set above the
 * section, where the more specific rule wins.
 */
export const SUGGEST_SYSTEM = `You help a reader decide what to do first with an article they have open in Spideryarn, a reading app.

You are given what the reader wrote about themselves and why they are reading this article, and a list of the app's modes. You are NOT given the article. You do not know its title, its subject or what it says, so never write as though you do: make no claim about what the article covers, argues or contains.

Propose a short list of things the reader could do. They will see each one and press the ones they want. Nothing happens unless they press it.

WHAT TO PROPOSE

searches: up to ${MAX_SUGGESTED_SEARCHES} searches to run inside the article. Each is one topic from the reason for reading, written as 2 to 6 words that an article about that topic would plausibly use. Keep the reader's own terms for the topic. If the reason names several things, give each its own search. Not a question, not a sentence, and not the reason copied out.

modes: up to ${MAX_SUGGESTED_MODES} modes from the list, each named by its id, that fit what the reader is after. Use only ids from the list, copied exactly, first word included. Do not name Search or Plain: your searches already open Search, and Plain is the article as the reader already has it. If none clearly fits, give none.

lens: at most one angle for asking what the rest of the web says about this article. A few words naming a topic from the reason for reading, at most ${MAX_SUGGESTED_LENS_CHARS} characters. Give null if the reason offers no such angle.

Each one has a "why": one short sentence, under 15 words, saying how it helps with what the reader wants to find out. Write it to the reader as "you". Say what it is for, not who they are.

If the reason for reading names no topic at all (for example "for work" or "just curious"), give no searches and no lens. A mode may still fit.

Write the searches, the lens and each why in the language the reason for reading is written in.

LEAVE THE PERSON OUT

A search or a lens that the reader presses is sent to other services and can be seen by other people. So build them only from the TOPIC the reader wants to find out about. Put in nothing about the reader as a person, from either line you are given: no name, employer, job, place, age, health, family, money, belief or relationship, and no project, client or product of theirs by name. A why is shown only to the reader, so it may speak of what they want to do; it still must not say who they are or name any of those things.

If the reason for reading mixes a topic with something personal, keep the topic and drop the personal part. If nothing is left once the personal part is gone, propose no search and no lens for it.

For example, for the reason "My mother was just diagnosed with early Alzheimer's and I want to know if this drug trial would apply to her":
GOOD search: "early Alzheimer's trial eligibility"
BAD search: "my mother's Alzheimer's diagnosis"
GOOD why: "Shows who the trial included, so you can judge whether it applies."
BAD why: "Because your mother was recently diagnosed."

What the reader wrote about themselves tells you how much they already know, and so which modes fit. It is never a source of words for a search or a lens.

ANSWER

JSON only, in this shape:
{"searches": [{"words": "...", "why": "..."}], "modes": [{"key": "<an id from the list>", "why": "..."}], "lens": {"words": "...", "why": "..."}}
Use an empty list where you have nothing, and null for lens where you have none.

${plainWords()}`;

const WORDS_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["words", "why"],
  properties: { words: { type: "string" }, why: { type: "string" } },
} as const;

/**
 * **The strict shape of the answer, for the modes offered** (OpenAI's subset:
 * every property required, the optional one nullable).
 *
 * **A mode's `key` is an `enum` of the ids shown**, so an id that was not
 * offered cannot be written at all. The eval's first run is why: in 6 answers
 * of 51 the model wrote a sub-mode's id with the wrong first word
 * (`mode:referee:claims` for `submode:referee:claims`), the reader dropped it
 * as not offered, and a good suggestion was lost
 * (docs/investigations/261005b-…). The prompting guide's rule against an
 * `enum` is about an article's block ids, where a slip forced onto *some* real
 * id is a wrong passage cited silently; here it is a row the reader reads by
 * name before pressing. `readSuggestions` still checks every key.
 */
export function suggestOutputSchema(modes: readonly PickOption[]): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["searches", "modes", "lens"],
    properties: {
      searches: { type: "array", items: WORDS_ITEM },
      modes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "why"],
          properties: { key: { type: "string", enum: modes.map((m) => m.id) }, why: { type: "string" } },
        },
      },
      lens: { anyOf: [WORDS_ITEM, { type: "null" }] },
    },
  };
}

/** One mode's line, as the model reads it: the id it must answer with, then our words. */
const modeLine = (option: PickOption): string => `${option.id} | ${option.label}: ${option.description}`;

/**
 * **The two messages.** `rendered` is `renderProfile`'s text (src/profile.ts):
 * *About the reader* when there is one, and *Why they are reading this piece*.
 * The modes are this server's lines and nothing of the caller's.
 */
export function suggestMessages(
  rendered: string,
  modes: readonly PickOption[],
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SUGGEST_SYSTEM },
    {
      role: "user",
      content: `THE READER\n\n${rendered}\n\nTHE MODES (id | name: what it is)\n\n${modes.map(modeLine).join("\n")}`,
    },
  ];
}

/* ------------------------------------------------------------- the call -- */

/** Why there is no list. `abandoned` is the reader leaving, and is nobody's failure. */
export type SuggestFailure = "abandoned" | "timed-out" | "refused" | "unreadable" | "not-set-up";

export type SuggestOutcome =
  /** `null`: the model answered and nothing it wrote could be kept. */
  | { readonly ok: true; readonly suggestions: Suggestions | null }
  | {
      readonly ok: false;
      readonly why: SuggestFailure;
      /** The status the route answers with. */
      readonly status: number;
      /** The sentence for the reader, from src/messages.ts. */
      readonly failure: ReaderFacingFailure;
    };

const READER_LEFT: ReaderFacingFailure = {
  kind: "retry",
  message: "The reader disconnected before this finished.",
};

/**
 * Ask for one list. `rendered` is the profile as the model reads it, never
 * empty: the route answers `nothing` itself when there is no reason for
 * reading, and so does this when no row is a mode — neither makes a call.
 *
 * Never throws for a provider's failure; a bug still throws.
 */
export async function suggestCommands(
  input: { readonly rendered: string; readonly rows: readonly PickKey[] },
  signal?: AbortSignal,
): Promise<SuggestOutcome> {
  const line = log("model");
  const started = Date.now();
  const modes = suggestableOptions(input.rows);
  const facts = { rows: modes.length, dropped: input.rows.length - modes.length, model: QUICK_MODEL_OPENROUTER };
  /* Nothing to choose a mode from means this was not the bar asking (it always
     has modes). No call, no spend. */
  if (modes.length < 1 || input.rendered.trim() === "") {
    line.info({ ...facts, outcome: "nothing", asked: false, ms: 0 }, "command suggest: nothing to ask about");
    return { ok: true, suggestions: null };
  }

  const deadline = AbortSignal.timeout(COMMAND_SUGGEST_TIMEOUT_MS);
  const composite = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const call: JsonCall = await openRouterJson(
      "command-suggest",
      withChatJsonSchema(
        {
          model: QUICK_MODEL_OPENROUTER,
          max_completion_tokens: COMMAND_SUGGEST_MAX_TOKENS,
          messages: suggestMessages(input.rendered, modes),
        },
        "command_suggest",
        suggestOutputSchema(modes),
      ),
      { signal: composite },
    );
    const body = call.json as {
      choices?: { finish_reason?: unknown; message?: { content?: unknown } }[];
    } | null;
    const choice = body?.choices?.[0];
    if (choice === undefined) throw new UnreadableAnswer("the suggestion had no choice in it");
    /* Cut off at the ceiling: half a JSON document, which must not be read as
       a short list that happened to parse. */
    if (choice.finish_reason === "length") throw new UnreadableAnswer("the suggestion was cut off");
    const suggestions = readSuggestions(choice.message?.content, modes);
    line.info(
      {
        ...facts,
        outcome: suggestions === null ? "nothing" : "suggestions",
        asked: true,
        searches: suggestions?.searches.length ?? 0,
        modes: suggestions?.modes.length ?? 0,
        lens: suggestions?.lens ? 1 : 0,
        ms: since(started),
      },
      "command suggested",
    );
    return { ok: true, suggestions };
  } catch (err) {
    const ms = since(started);
    /* The composite keeps the first abort's reason (src/command-pick-call.ts). */
    if (signal?.aborted && composite.reason === signal.reason) {
      line.info({ ...facts, ms }, "command suggest was abandoned");
      return { ok: false, why: "abandoned", status: 499, failure: READER_LEFT };
    }
    if (deadline.aborted && composite.reason === deadline.reason) {
      line.error({ ...facts, ms, timedOut: true }, "command suggest: no answer — deadline fired");
      return {
        ok: false,
        why: "timed-out",
        status: 504,
        failure: tookTooLong(Math.round(COMMAND_SUGGEST_TIMEOUT_MS / 1000)),
      };
    }
    if (err instanceof ProviderRefused) {
      /* The status and our own sentence, never the body: it may echo the profile back. */
      line.error({ ...facts, ms, status: err.status }, `command suggest: OpenRouter refused: ${err.status}`);
      return { ok: false, why: "refused", status: 502, failure: { kind: "retry", message: err.message } };
    }
    if (err instanceof UnreadableAnswer) {
      line.error({ ...facts, ms }, "command suggest: the answer could not be read");
      return { ok: false, why: "unreadable", status: 502, failure: PROVIDER_UNREADABLE };
    }
    if (err instanceof Error && err.message === NOT_CONFIGURED.message) {
      line.error({ ...facts, ms }, "command suggest: the AI service is not set up");
      return { ok: false, why: "not-set-up", status: 503, failure: NOT_CONFIGURED };
    }
    throw err;
  }
}
