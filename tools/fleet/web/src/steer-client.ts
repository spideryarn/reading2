/**
 * The two things this page can now do to a session: say something to it, and
 * answer the dialog it is parked on.
 *
 * ## THE RULE THIS FILE EXISTS TO KEEP
 *
 * **Every identifying value in a request body comes verbatim out of the row the
 * person tapped, and nothing here refetches or rebuilds any of them.**
 *
 * The server's entire safety model is that those values are *stale-but-honest
 * claims*, which it checks against live tmux before it types anything. There is
 * a long comment saying so at the top of tools/fleet/routes-steer.ts:
 *
 * > THE CLIENT'S CLAIMS ARE THE INPUT, AND THIS FILE NEVER LOOKS THEM UP. […]
 * > If this route re-read them from live tmux at send time, `verifyTarget`
 * > would be comparing the box against itself and every guard in `steer.ts`
 * > would pass unconditionally.
 *
 * So a client that helpfully asked `/api/state` for fresh ids first would turn
 * every one of those guards into a tautology, and the page would still show a
 * green tick. That is why `steerMessageBody` and `steerAnswerBody` below are
 * pure functions of a row: there is no clock, no fetch and no `await` in front
 * of them, and there is nowhere for a refresh to be inserted.
 *
 * **And `question` goes back as the object the server sent** — `row.rawQuestion`,
 * never anything rebuilt from `row.question`. Two reasons, and the second is
 * the one that bites later: `sameQuestion` on the server compares with
 * `JSON.stringify`, and, more importantly, the server is about to add a field
 * describing *what is actually being approved* — a diff, a command — because an
 * approval today binds only to the question sentence and can be accepted for
 * different material than was displayed. A client that re-derived the object
 * would drop that field silently, and the fix would land and do nothing.
 *
 * ## Every failure is the SERVER'S sentence
 *
 * `{ok: false, code, why}` comes back written for a person, and `why` knows
 * things this page cannot: *"pane %1646 is in session $1643 now, not $1"*. So
 * nothing here paraphrases one. The only sentences this file writes are for
 * failures the server never saw — the fetch itself, or an answer that is not
 * this API — and each of those says plainly that it is local.
 *
 * ## The seam
 *
 * `SteerApi` is the injection point, the same shape of seam as `Transport` in
 * transport.ts and for the same reason: a test drives the page without a
 * network, and it exercises the extension point rather than a stub of `fetch`.
 * `httpSteerApi` is what the browser gets.
 */
import type { FleetRow } from "./types";

export const MESSAGE_URL = "api/steer/message";
export const ANSWER_URL = "api/steer/answer";

/**
 * The five fields that say WHO the person was looking at.
 *
 * `sessionId` is `row.id` — tmux's session handle, which is what the row is
 * keyed by. `paneId` is a different thing (`%2108` against `$1643`) and both
 * are required, because checking the pair is what catches a pane that has been
 * moved between sessions and a row built against a previous tmux server.
 *
 * `panePid` and `claudeSessionId` are passed through as they arrived, nulls
 * included: the server treats a null pid as "no respawn check" and a null
 * `claudeSessionId` as a refusal, and both of those are better answers than
 * anything this file could invent.
 */
export type SteerTargetBody = {
  paneId: string | null;
  sessionId: string;
  claudeSessionId: string | null;
  panePid: number | null;
  status: unknown;
};

/** The identity half of both bodies. Pure, and deliberately impossible to await. */
export function steerTargetBody(row: FleetRow): SteerTargetBody {
  return {
    paneId: row.paneId,
    sessionId: row.id,
    claudeSessionId: row.claudeSessionId,
    panePid: row.panePid,
    // The server's own object, not `row.status`. See the header.
    status: row.rawStatus,
  };
}

/**
 * `speaker` for the same reason `actions-client.ts` sends one: this route hands
 * the text straight to a pane, and the server's prefix is what tells the agent
 * whether it is reading Greg or an automated coordinator. An absent field
 * defaults to the weaker claim, so leaving it out would label every message a
 * person typed as the Overseer's.
 */
export type SteerMessageBody = SteerTargetBody & { text: string; speaker: "greg" };
export type SteerAnswerBody = SteerTargetBody & { question: unknown; optionIndex: number };

export function steerMessageBody(row: FleetRow, text: string): SteerMessageBody {
  return { ...steerTargetBody(row), text, speaker: "greg" };
}

export function steerAnswerBody(row: FleetRow, optionIndex: number): SteerAnswerBody {
  // `row.rawQuestion` and NOT `{kind: "question", ...row.question}`. The whole
  // of the header's second argument is about this one line.
  return { ...steerTargetBody(row), question: row.rawQuestion, optionIndex };
}

/**
 * What became of a send.
 *
 * `why` is always the sentence to put on screen, and `from` says who wrote it —
 * so a reader can tell "the box moved under you" from "this browser could not
 * reach the dashboard", which are different problems with the same shape.
 */
/**
 * WHAT BECAME OF THE KEYSTROKES, as four arms rather than a missing field.
 *
 * The server sends `delivery` only when the delivery module got as far as
 * having an opinion; a request refused before that carries none. **Those are
 * four facts, not three plus a hole**, and the fourth one — *the server did not
 * say* — must not read as `none`. `none` is a claim that nothing left this box,
 * and a page that made that claim on silence would be making it exactly when it
 * has least basis to.
 *
 * A discriminated union rather than `Delivery | null`, so a renderer has to
 * name the case it is drawing. This field existed on the wire, correctly, for
 * as long as the page had been throwing it away.
 */
export type DeliveryReading =
  | { kind: "none" }
  | { kind: "partial" }
  | { kind: "unknown" }
  | { kind: "not-told" };

export type SteerOutcome =
  | { ok: true; op: "message" | "answer"; sent: string[][] }
  | {
      ok: false;
      code: string;
      why: string;
      status: number | null;
      from: "server" | "client";
      /** See `DeliveryReading`. Never absent — `not-told` is the arm for that. */
      delivery: DeliveryReading;
    };

/**
 * The server's `delivery`, or the arm that says it sent none.
 *
 * A value this build does not recognise is `not-told` rather than `none`, for
 * the same reason absence is: the page has been given something it cannot
 * interpret, and the safe reading of that is *I do not know what happened to
 * the keystrokes*, never *nothing happened*.
 */
export function parseDelivery(v: unknown): DeliveryReading {
  if (v === "none") return { kind: "none" };
  if (v === "partial") return { kind: "partial" };
  if (v === "unknown") return { kind: "unknown" };
  return { kind: "not-told" };
}

/** The seam. Two typed actions, so a coordinator has something to call that is not a click. */
export type SteerApi = {
  message: (row: FleetRow, text: string) => Promise<SteerOutcome>;
  answer: (row: FleetRow, optionIndex: number) => Promise<SteerOutcome>;
};

/** A thrown thing, as a sentence. Never "[object Object]". */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The argv of every tmux call the server made, when it says.
 *
 * Shown on success because "what did you actually press" is the first question
 * anybody asks about a session that then did something surprising, and
 * reconstructing it from prose is guesswork (steer.ts's own words).
 */
function parseSent(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  const out: string[][] = [];
  for (const call of v) {
    if (!Array.isArray(call)) continue;
    out.push(call.filter((a): a is string => typeof a === "string"));
  }
  return out;
}

/**
 * One POST, and every way it can end.
 *
 * The status code is kept on the outcome rather than interpreted here: 409
 * means the world moved and refreshing is the move, 429 means too fast, 400
 * means the request was wrong — and which sentence goes with which is the
 * server's job, not this file's.
 */
async function post(
  url: string,
  op: "message" | "answer",
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<SteerOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      // Both routes require this exact type: it is half the CSRF defence, since
      // a cross-site HTML form cannot set a header. The browser adds `Origin`.
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch (cause) {
    return {
      ok: false,
      code: "unreachable",
      why: `this browser could not reach the dashboard: ${describe(cause)}`,
      status: null,
      from: "client",
      /* THE REQUEST MAY WELL HAVE ARRIVED. A fetch that throws has failed to
         read a RESPONSE; it has not established that nothing was sent. A phone
         that loses signal after the keystrokes land and before the answer comes
         back arrives here, and calling that `none` would be the exact wrong
         advice. */
      delivery: { kind: "unknown" },
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    return {
      ok: false,
      code: "not-json",
      why: `the server answered ${response.status} and the body was not JSON: ${describe(cause)}`,
      status: response.status,
      from: "client",
      // Same argument as above: an unreadable body says nothing about the pane.
      delivery: { kind: "unknown" },
    };
  }

  if (isRecord(parsed) && parsed["ok"] === true) {
    return { ok: true, op, sent: parseSent(parsed["sent"]) };
  }

  // The server's own words, verbatim. The fallbacks below fire only when the
  // answer is not this API's shape at all — which is itself worth saying.
  const why = isRecord(parsed) && typeof parsed["why"] === "string" ? parsed["why"] : null;
  const code = isRecord(parsed) && typeof parsed["code"] === "string" ? parsed["code"] : null;
  return {
    ok: false,
    code: code ?? "unknown",
    why: why ?? `the server answered ${response.status} without saying why`,
    status: response.status,
    from: why === null ? "client" : "server",
    delivery: parseDelivery(isRecord(parsed) ? parsed["delivery"] : undefined),
  };
}

/** What the browser uses. `fetchImpl` is for a test that wants the real body built. */
export function makeSteerApi(fetchImpl: typeof fetch = fetch): SteerApi {
  return {
    message: (row, text) => post(MESSAGE_URL, "message", steerMessageBody(row, text), fetchImpl),
    answer: (row, optionIndex) => post(ANSWER_URL, "answer", steerAnswerBody(row, optionIndex), fetchImpl),
  };
}

/**
 * The default instance.
 *
 * A getter rather than a module-scope `makeSteerApi(fetch)`, because binding
 * `fetch` at import time makes it unstubable in a test that imports this module
 * first — and the failure looks like a network call in a suite that has none.
 */
export const httpSteerApi: SteerApi = {
  message: (row, text) => makeSteerApi().message(row, text),
  answer: (row, index) => makeSteerApi().answer(row, index),
};
