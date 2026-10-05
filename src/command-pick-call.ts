/**
 * **A sentence from the command bar, answered** — `POST /api/command-pick`'s
 * two model calls. Plan 261003k, Stage 2; the shapes and the words are
 * src/command-pick.ts's.
 *
 * ```
 *   keys the browser sent ──► known ones only, words from OUR list
 *                                     │
 *                 Jev: one `choice` over rows + argument commands + none   (~0.3 s)
 *                                     │
 *        a row ◄──────────────────────┼──────────────────────► none
 *                                     │ an argument command
 *                 GPT Luna: copy the words out of the sentence             (~1 s)
 * ```
 *
 * The arrangement the eval's frozen rule selected
 * (docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md):
 * Jev picks; a small model is asked for the words only when the pick takes
 * some, which is about one request in four.
 *
 * **What the models read is the sentence and this server's own words for each
 * row** — never the article, and never a word about a row that the caller
 * sent (GPT Sol's F1: with caller-written options this route would be a
 * classifier for anybody signed in). A key the list does not hold is dropped
 * without a word.
 *
 * **Nothing here logs the sentence or the words it names** — the outcome's
 * kind, the timings and the counts only (docs/project/logging.md).
 */
import {
  type DecisionCall,
  type JsonCall,
  ProviderRefused,
  UnreadableAnswer,
  openRouterDecisions,
  openRouterJson,
} from "./ai-call.js";
import catalogue from "./command-pick-catalogue.generated.json" with { type: "json" };
import {
  type ArgumentKind,
  NONE_ANSWER,
  type PickAnswer,
  type PickKey,
  type PickOption,
  type PickRequest,
  WORDS_MAX_TOKENS,
  choiceAsk,
  readPick,
  readWords,
  wordsMessages,
} from "./command-pick.js";
import { log, since } from "./log.js";
import { NOT_CONFIGURED, PROVIDER_UNREADABLE, type ReaderFacingFailure, tookTooLong } from "./messages.js";
import { COMMAND_PICK_MODEL, QUICK_MODEL_OPENROUTER } from "./models.js";

/**
 * **The whole answer, both calls, or nothing.** The reader pressed Enter and
 * is watching the bar; the eval's slowest ordinary pair was 1.6 s, so 5 s is
 * an upstream that has stopped answering, and the bar's own list is still
 * there.
 */
export const COMMAND_PICK_TIMEOUT_MS = 5_000;

const keyOf = (key: PickKey): string => `${key.id}\n${key.label}`;

/**
 * **Every row the bar can offer, by (id, label)** — the generated list, which
 * tests/command-pick-catalogue.test.ts rebuilds from the bar's own functions
 * and fails on any difference.
 */
const CATALOGUE: ReadonlyMap<string, PickOption> = new Map(
  (catalogue as readonly PickOption[]).map(({ id, label, description, aliases }) => [
    keyOf({ id, label }),
    { id, label, description, aliases },
  ]),
);

/**
 * **The keys this server holds, with its own words for each** — in the order
 * sent, and one per id: the first stands, so a request naming both *Archive*
 * and *Put back* asks about one of them, not two under one name.
 */
export function knownOptions(rows: readonly PickKey[]): readonly PickOption[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const option = CATALOGUE.get(keyOf(row));
    if (option === undefined || seen.has(option.id)) return [];
    seen.add(option.id);
    return [option];
  });
}

/** Why there is no answer. `abandoned` is the reader leaving, and is nobody's failure. */
export type PickFailure = "abandoned" | "timed-out" | "refused" | "unreadable" | "not-set-up";

export type PickOutcome =
  | { readonly ok: true; readonly answer: PickAnswer }
  | {
      readonly ok: false;
      readonly why: PickFailure;
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
 * Answer one request. `signal` is the reader's connection; it and the deadline
 * abort whichever call is out.
 *
 * Never throws for a provider's failure — the outcome says which — so the
 * route has one shape to turn into a response. A bug still throws.
 */
export async function pickCommand(request: PickRequest, signal?: AbortSignal): Promise<PickOutcome> {
  const line = log("model");
  const started = Date.now();
  const rows = knownOptions(request.rows);
  const facts = { rows: rows.length, dropped: request.rows.length - rows.length, model: COMMAND_PICK_MODEL };
  /* No row we know means nothing to choose between — and a request made only
     of keys we do not hold is not one this bar sent. No call, no spend. */
  if (rows.length < 1) {
    line.info({ ...facts, outcome: "none", asked: false, ms: 0 }, "command pick: no known row");
    return { ok: true, answer: NONE_ANSWER };
  }

  const deadline = AbortSignal.timeout(COMMAND_PICK_TIMEOUT_MS);
  const composite = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const ask = choiceAsk(request.sentence, rows, request.argumentKinds);
    const call: DecisionCall = await openRouterDecisions(
      "command-pick",
      { model: COMMAND_PICK_MODEL, state: ask.state, questions: ask.questions },
      /* `retryTransport: false`, here and on the words call: the two share one
         deadline of `COMMAND_PICK_TIMEOUT_MS`, and a failure already falls back
         to the bar's own list, which beats two seconds of backoff. */
      { signal: composite, retryTransport: false },
    );
    const raw = call.choice.command;
    if (raw === undefined) throw new UnreadableAnswer("the pick had no choice in it");
    const picked = readPick(raw, { rows, argumentKinds: request.argumentKinds });
    const pickMs = since(started);
    if (picked.kind !== "words-wanted") {
      line.info(
        { ...facts, outcome: picked.kind, ms: pickMs, ...(picked.kind === "row" ? { confidence: picked.confidence } : {}) },
        "command picked",
      );
      return { ok: true, answer: picked };
    }
    const answer = await askForWords(request.sentence, picked.argument, composite);
    line.info(
      { ...facts, outcome: answer.kind, argument: picked.argument, ms: since(started), pickMs, wordsModel: QUICK_MODEL_OPENROUTER },
      "command picked",
    );
    return { ok: true, answer };
  } catch (err) {
    const ms = since(started);
    /* The composite keeps the first abort's reason, so a deadline that fires
       while the reader is also leaving is still named for what came first. */
    if (signal?.aborted && composite.reason === signal.reason) {
      line.info({ ...facts, ms }, "command pick was abandoned");
      return { ok: false, why: "abandoned", status: 499, failure: READER_LEFT };
    }
    if (deadline.aborted && composite.reason === deadline.reason) {
      line.error({ ...facts, ms, timedOut: true }, "command pick: no answer — deadline fired");
      return {
        ok: false,
        why: "timed-out",
        status: 504,
        failure: tookTooLong(Math.round(COMMAND_PICK_TIMEOUT_MS / 1000)),
      };
    }
    if (err instanceof ProviderRefused) {
      /* The status and our own sentence, never the body: it may echo the
         sentence back. */
      line.error({ ...facts, ms, status: err.status }, `command pick: OpenRouter refused: ${err.status}`);
      return { ok: false, why: "refused", status: 502, failure: { kind: "retry", message: err.message } };
    }
    if (err instanceof UnreadableAnswer) {
      line.error({ ...facts, ms }, "command pick: the answer could not be read");
      return { ok: false, why: "unreadable", status: 502, failure: PROVIDER_UNREADABLE };
    }
    /* The gateway's own refusal of a missing key (src/ai-call.ts § `apiKey`),
       which it throws as the reader's sentence before it meters anything. */
    if (err instanceof Error && err.message === NOT_CONFIGURED.message) {
      line.error({ ...facts, ms }, "command pick: the AI service is not set up");
      return { ok: false, why: "not-set-up", status: 503, failure: NOT_CONFIGURED };
    }
    throw err;
  }
}

/**
 * The second call: the words, copied out. The request the eval's `hyb-luna`
 * arm sent — `reasoning` and `provider` are the gateway's rows for this job
 * (src/ai-call.ts § `CHAT_REASONING`, `AI_JOB_ROUTE`), both as measured.
 */
async function askForWords(sentence: string, argument: ArgumentKind, signal: AbortSignal): Promise<PickAnswer> {
  const call: JsonCall = await openRouterJson(
    "command-pick-words",
    {
      model: QUICK_MODEL_OPENROUTER,
      max_tokens: WORDS_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: wordsMessages(sentence, argument),
    },
    { signal, retryTransport: false },
  );
  const body = call.json as { choices?: { message?: { content?: unknown } }[] } | null;
  /* An answer that is not the JSON asked for, or names words the reader did
     not say, is `none`: the bar says it could not tell, which is true. */
  return readWords(sentence, argument, body?.choices?.[0]?.message?.content);
}
