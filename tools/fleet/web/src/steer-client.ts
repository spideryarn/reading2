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
import {
  makeEnvelope,
  postEnvelope,
  readKeyedArms,
  unreadableAnswer,
  type KeyedOutcome,
  type MintClock,
  type RequestEnvelope,
} from "./request-envelope";
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
 * **A MESSAGE AS AN ENVELOPE** — request-envelope.ts. The body is the same
 * pure function of the row as `steerMessageBody`, built once; a Check resends
 * the envelope's bytes rather than a body rebuilt from a row that has since
 * been refreshed. `ticket` is the composer's `DraftSubmission`.
 */
export function messageEnvelope<T>(
  row: FleetRow,
  text: string,
  ticket: T,
  clock?: MintClock,
): RequestEnvelope<SteerMessageBody, T> {
  return makeEnvelope(MESSAGE_URL, steerMessageBody(row, text), ticket, clock);
}

export function answerEnvelope<T>(
  row: FleetRow,
  optionIndex: number,
  ticket: T,
  clock?: MintClock,
): RequestEnvelope<SteerAnswerBody, T> {
  return makeEnvelope(ANSWER_URL, steerAnswerBody(row, optionIndex), ticket, clock);
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

/**
 * **THE ADDRESS THE SERVER ESTABLISHED IN THE MOMENT BEFORE IT SENT** — or the
 * arm that says it did not tell us.
 *
 * **It is a PRE-SEND identity check and it is not a delivery receipt**, and the
 * difference is the whole reason this comment is long. `verifyTarget` runs
 * *before* the screen capture and before the `send-keys` calls (steer.ts,
 * `sendMessage` and `answerQuestion`), and its result is carried through to the
 * response without being recomputed. So it says *this pane, this session, this
 * pid and this conversation were all true a few milliseconds ago*; it does not
 * say where the keystrokes ended up. steer.ts's own KNOWN GAPS records that
 * window and says tmux offers no compare-and-send that would close it. Nothing
 * on this page may turn that into a claim about what arrived.
 *
 * **It is still the safety half of `sent`.** `sent` is the argv — what was
 * typed. This is the address it was aimed at, resolved by the server against
 * live tmux rather than copied back off the request: `verifyTarget` walks the
 * pane's own process ancestry, so `claudePid` is the Claude that answers to the
 * conversation id the row claimed. A value here that is not the row the person
 * tapped is the one shape of failure a green tick would otherwise hide, and it
 * is the reason this is compared rather than merely printed — see
 * `checkLanding`.
 *
 * The server has sent this on every successful send since `routes-steer.ts` was
 * written (`respond(res, 200, { ok: true, op, verified, sent })`) and this file
 * threw it away: `grep -c verified steer-client.ts` returned **zero** on the
 * evening of 2026-09-08, which is instance 12 in the table in
 * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md.
 *
 * A discriminated union rather than `Verified | null`, for the reason
 * `DeliveryReading` beside it is one: **a renderer has to name the case it is
 * drawing**, and *the server did not say what it resolved* must never render as
 * a confident address. A partially-formed object is `not-told` too — half an
 * address is not an address, and inventing the missing half is the mistake this
 * whole file exists to refuse.
 */
export type VerifiedReading =
  | {
      kind: "verified";
      /** tmux's pane handle, `%2108` — where the keys were typed. */
      paneId: string;
      /** tmux's session handle, `$1643` — which is a different thing. */
      sessionId: string;
      /** The pane's live process, which is what ancestry was walked from. */
      panePid: number;
      /** The pid of the Claude that answers to the conversation id we claimed. */
      claudePid: number;
    }
  /** The server answered `ok` without saying what it resolved. Never rendered as an address. */
  | { kind: "not-told" };

/** The `verified` arm on its own, so a comparison result can carry it. */
export type VerifiedAddress = Extract<VerifiedReading, { kind: "verified" }>;

/**
 * The server's `verified`, or the arm that says there is none.
 *
 * Every field is required, and a missing one collapses the whole reading to
 * `not-told` rather than being filled in: this value's only job is to be
 * COMPARED with the row the person was looking at, and a comparison against a
 * half-invented address would answer a weaker question than the one asked.
 */
export function parseVerified(v: unknown): VerifiedReading {
  if (!isRecord(v)) return { kind: "not-told" };
  const paneId = v["paneId"];
  const sessionId = v["sessionId"];
  const panePid = v["panePid"];
  const claudePid = v["claudePid"];
  if (typeof paneId !== "string" || paneId === "") return { kind: "not-told" };
  if (typeof sessionId !== "string" || sessionId === "") return { kind: "not-told" };
  if (typeof panePid !== "number" || !Number.isFinite(panePid)) return { kind: "not-told" };
  if (typeof claudePid !== "number" || !Number.isFinite(claudePid)) return { kind: "not-told" };
  return { kind: "verified", paneId, sessionId, panePid, claudePid };
}

/* ------------------------------------------------------------------ *
 * Comparing the receipt against the row that was actually tapped.
 * ------------------------------------------------------------------ */

/**
 * **THE ROW'S IDENTITY AT THE MOMENT THE SEND WAS ASKED FOR**, kept so the
 * answer can be compared against what the person was looking at.
 *
 * A snapshot rather than a live read, and it is a correctness fix rather than a
 * tidy-up. The detail pane is keyed by session id alone, so it survives every
 * refresh of the payload — and a `verified` compared against whatever `row` is
 * on screen when the answer lands is a comparison against a DIFFERENT fact from
 * the one the request carried. Both errors follow: a pane rehomed between the
 * tap and the response reads as *it went somewhere else* when the send was
 * perfectly aimed, and a row that has since drifted back into agreement hides a
 * real mismatch. The request body is built from these same three values
 * (`steerTargetBody`), so this is the thing the server was actually asked
 * about.
 */
export type SentTarget = {
  paneId: string | null;
  sessionId: string;
  /** Null when the row carried no pid, which means the pid was never claimed. */
  panePid: number | null;
};

/** The identity half of the request, snapshotted. Pure, like `steerTargetBody`. */
export function sentTarget(row: FleetRow): SentTarget {
  return { paneId: row.paneId, sessionId: row.id, panePid: row.panePid };
}

/**
 * One field of the address. Named rather than positional so the sentence on
 * screen can say which of them the comparison actually used.
 */
export type LandingField = "pane" | "session" | "pane pid";

/**
 * **WHAT THE PRE-SEND CHECK ESTABLISHED, MEASURED AGAINST WHAT WAS ASKED FOR.**
 *
 * Three arms, and the third field on the two informative ones — `unchecked` —
 * is the part that stops this being another overclaim. A comparison that
 * quietly skipped a field it had no value for would report agreement it never
 * tested, which is the same defect one level down from the one this whole
 * function exists to repair.
 *
 * `pane pid` is compared **when the row carried one**, and it is the field the
 * first version of this dropped. `gjd-remote resume` and `tmux respawn-pane`
 * both keep the pane and session handles and replace the process underneath, so
 * pane-and-session alone say *the address is the same box* rather than *the same
 * program*. The server refuses that case itself (`verifyTarget`: "it was
 * respawned"), which is why a disagreement here should be unreachable — and
 * unreachable is exactly when a check earns its keep, because reaching it means
 * a guard upstream did not hold.
 */
export type LandingCheck =
  /** The server said nothing about what it resolved. Draw no address at all. */
  | { kind: "not-told" }
  | {
      kind: "agrees";
      verified: VerifiedAddress;
      /** The fields that took part. Never empty: `session` is always available. */
      compared: LandingField[];
      /** The fields the request could not claim, so nothing was proved about them. */
      unchecked: LandingField[];
    }
  | {
      kind: "disagrees";
      verified: VerifiedAddress;
      target: SentTarget;
      /** The fields that differ. Never empty on this arm. */
      differing: LandingField[];
      unchecked: LandingField[];
    };

/**
 * **`claudePid` IS DELIBERATELY NOT A FOURTH COMPARISON, and the reason is a
 * distinction worth keeping.**
 *
 * `session`, `pane` and `pane pid` are CLAIMS THE CLIENT MADE — it tapped a row
 * that said `$1643`, `%2108`, pid N — and `verifyTarget` checks the box against
 * them. That is what makes agreement mean something.
 *
 * `claudePid` is not a claim anybody made. The client never knew it;
 * `verifyTarget` DISCOVERS it while walking the process table. Putting it on the
 * wire so the client could send it back would have the client echo a value the
 * server told it, and the server then check that value against itself — failure
 * mode 5 in routes-steer.ts's own header, and the reason that file imports no
 * value from collect.ts. It would read as a fourth check and be worth nothing.
 *
 * So it stays an OUTPUT: *this is the process we found and typed at*, useful in a
 * log and to a person reconstructing what happened. Settled 2026-09-08 with
 * `orchestrator-setup`, who own `steer.ts`; the question was mine and the
 * distinction is theirs.
 */
export function checkLanding(verified: VerifiedReading, target: SentTarget): LandingCheck {
  if (verified.kind === "not-told") return { kind: "not-told" };
  const compared: LandingField[] = [];
  const unchecked: LandingField[] = [];
  const differing: LandingField[] = [];

  /* `sessionId` is `row.id`, which every row has by construction — there is no
     absent case to branch on. */
  compared.push("session");
  if (verified.sessionId !== target.sessionId) differing.push("session");

  /* A null `paneId` cannot reach here from this page — a send from a row with
     no pane handle is refused locally as `unaddressable` — but it is recorded
     as unchecked rather than assumed to match, because the sentence must not
     name a pane the request never claimed. */
  if (target.paneId === null) unchecked.push("pane");
  else {
    compared.push("pane");
    if (verified.paneId !== target.paneId) differing.push("pane");
  }

  /* `panePid` is genuinely optional on a row and the server treats a null as
     "no respawn check", so absence here is a real state rather than a defect. */
  if (target.panePid === null) unchecked.push("pane pid");
  else {
    compared.push("pane pid");
    if (verified.panePid !== target.panePid) differing.push("pane pid");
  }

  return differing.length === 0
    ? { kind: "agrees", verified, compared, unchecked }
    : { kind: "disagrees", verified, target, differing, unchecked };
}

/** `a`, `a and b`, `a, b and c` — for naming which fields were compared. */
export function listFields(fields: readonly LandingField[]): string {
  if (fields.length === 0) return "nothing";
  if (fields.length === 1) return fields[0] as string;
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1] as string}`;
}

export type SteerOutcome =
  | {
      ok: true;
      op: "message" | "answer";
      sent: string[][];
      /**
       * WHAT WAS TRUE OF THE TARGET IMMEDIATELY BEFORE THE KEYS WENT — not
       * where they ended up. See `VerifiedReading`; `not-told` is the arm for
       * silence, and `checkLanding` is what may be drawn from it.
       */
      verified: VerifiedReading;
    }
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

/**
 * The keyed half of the seam: each posts an envelope's bytes to the envelope's
 * route and reads every way it can end — request-envelope.ts.
 */
export type KeyedSteerApi = {
  message: (envelope: RequestEnvelope<SteerMessageBody, unknown>) => Promise<KeyedOutcome<SteerOutcome>>;
  answer: (envelope: RequestEnvelope<SteerAnswerBody, unknown>) => Promise<KeyedOutcome<SteerOutcome>>;
};

/**
 * The seam. Two typed actions, so a coordinator has something to call that is not a click.
 *
 * **`message` and `answer` stay unkeyed**, byte for byte what they sent before
 * Stage 4: their other callers (the dialog buttons, QuestionsPanel) keep no
 * envelope, and a keyed request that cannot be given a durable receipt is
 * refused `503` where an unkeyed one goes ahead. `keyed` is optional only so
 * the many existing test fakes still satisfy the type; every instance this file
 * makes has it, and tests/fleet-request-envelope.test.ts pins that, so the
 * composer's fallback (`sendMessageEnvelope`) is reachable only from a fake.
 */
export type SteerApi = {
  message: (row: FleetRow, text: string) => Promise<SteerOutcome>;
  answer: (row: FleetRow, optionIndex: number) => Promise<SteerOutcome>;
  keyed?: KeyedSteerApi;
};

/**
 * Send a message envelope through whatever seam the composer was given. A seam
 * with no keyed half (a test fake written before Stage 4) is sent the text the
 * old way, and its answer is `answered` — it can never produce the arm that
 * keeps an envelope.
 */
export async function sendMessageEnvelope(
  api: SteerApi,
  row: FleetRow,
  envelope: RequestEnvelope<SteerMessageBody, unknown>,
): Promise<KeyedOutcome<SteerOutcome>> {
  if (api.keyed !== undefined) return api.keyed.message(envelope);
  return { kind: "answered", outcome: await api.message(row, envelope.body.text) };
}

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
    return { ok: true, op, sent: parseSent(parsed["sent"]), verified: parseVerified(parsed["verified"]) };
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

/**
 * One keyed POST, and every way it can end. The route's own answer is read as
 * `post` reads it — but only when it IS the route's answer: a success naming
 * this op, or a refusal with the server's code and sentence. Anything else is
 * `not-confirmed`, never a success with blanks filled in.
 */
async function postKeyed(
  envelope: RequestEnvelope<SteerMessageBody | SteerAnswerBody, unknown>,
  op: "message" | "answer",
  fetchImpl: typeof fetch,
): Promise<KeyedOutcome<SteerOutcome>> {
  const heard = await postEnvelope(envelope, fetchImpl);
  if (heard.kind === "not-confirmed") return heard;
  const shared = readKeyedArms(heard.status, heard.parsed);
  if (shared !== null) {
    if (
      shared.kind === "replay" &&
      (shared.receipt.op !== (op === "message" ? "steer-message" : "steer-answer") ||
        shared.receipt.origin !== "direct-steer" ||
        shared.receipt.target?.sessionId !== envelope.body.sessionId)
    ) {
      return unreadableAnswer(heard.status);
    }
    return shared;
  }
  const p = heard.parsed;
  if (heard.status === 200 && isRecord(p) && p["ok"] === true && p["op"] === op) {
    return { kind: "answered", outcome: { ok: true, op, sent: parseSent(p["sent"]), verified: parseVerified(p["verified"]) } };
  }
  if (isRecord(p) && p["ok"] === false && typeof p["code"] === "string" && typeof p["why"] === "string") {
    return {
      kind: "answered",
      outcome: {
        ok: false,
        code: p["code"],
        why: p["why"],
        status: heard.status,
        from: "server",
        delivery: parseDelivery(p["delivery"]),
      },
    };
  }
  return unreadableAnswer(heard.status);
}

/** What the browser uses. `fetchImpl` is for a test that wants the real body built. */
export function makeSteerApi(fetchImpl: typeof fetch = fetch): SteerApi & { keyed: KeyedSteerApi } {
  return {
    message: (row, text) => post(MESSAGE_URL, "message", steerMessageBody(row, text), fetchImpl),
    answer: (row, optionIndex) => post(ANSWER_URL, "answer", steerAnswerBody(row, optionIndex), fetchImpl),
    keyed: {
      message: (envelope) => postKeyed(envelope, "message", fetchImpl),
      answer: (envelope) => postKeyed(envelope, "answer", fetchImpl),
    },
  };
}

/**
 * The default instance.
 *
 * A getter rather than a module-scope `makeSteerApi(fetch)`, because binding
 * `fetch` at import time makes it unstubable in a test that imports this module
 * first — and the failure looks like a network call in a suite that has none.
 */
export const httpSteerApi: SteerApi & { keyed: KeyedSteerApi } = {
  message: (row, text) => makeSteerApi().message(row, text),
  answer: (row, index) => makeSteerApi().answer(row, index),
  keyed: {
    message: (envelope) => makeSteerApi().keyed.message(envelope),
    answer: (envelope) => makeSteerApi().keyed.answer(envelope),
  },
};
