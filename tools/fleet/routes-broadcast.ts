/**
 * **ONE LINE TO EVERY AGENT ON THE BOX** — `POST /api/broadcast`.
 *
 * > there should be a way to send messages directly to the Overseer in the
 * > Overseer tab, and also to broadcast to all agents
 * >
 * > — Greg, 2026-09-08
 *
 * The decisions, and the simpler things each one passed over, are in
 * docs/plans/260909b-messaging-the-overseer-and-broadcasting-to-all-agents-from-the-dashboard.md.
 * This header holds the ones you need before you change a line here.
 *
 * ## Why this is a route at all, rather than a loop in the browser
 *
 * A client-side fan-out over the existing `POST /api/steer/message` needs no
 * server code, which was the attractive part. It is refused by arithmetic:
 * that route carries a whole-box ceiling of six sends per ten seconds and a
 * 1.5s floor per pane, so a broadcast to thirty sessions either gets `429` at
 * the sixth recipient or paces itself over a minute — and while it paces it has
 * spent the entire box's allowance, so Greg's own next message to one session
 * is refused. The limiter is protecting exactly the right thing and a broadcast
 * is not the shape it was written for. So this route has a **cooldown** instead,
 * which is the same choice `broadcastRoute` in routes-actions.ts made for the
 * ease-off broadcast.
 *
 * ## THIS IS THE SECOND FAN-OUT LOOP IN THIS DIRECTORY, AND IT IS MEANT TO
 * ## ABSORB THE FIRST
 *
 * `routes-actions.ts` has one for `resource-broadcast`, whose text differs per
 * recipient because the pause is staggered. The end state, agreed with the
 * session that owns that file (`claude-agents-dashboard`, 2026-09-09), is **one**
 * loop taking a `render(index, total) => string`, called by both: free text is
 * that loop with a constant renderer, and the stagger is a special case of it.
 * `fanOut` below already takes exactly that callback, so the extraction is a
 * move rather than a rewrite. It waits on that session's Stage 5 at its request.
 *
 * **THE BOUNDARY THAT MUST HOLD WHEN IT HAPPENS**, in its words:
 *
 * > The shared thing is the fan-out MECHANICS, never the authority decisions.
 * > […] A general fan-out is a good abstraction and an excellent place to
 * > accidentally launder authority. Keep the loop ignorant of who is allowed to
 * > say what; give it strings that are already rendered and already permitted.
 *
 * So `fanOut` is handed **already-rendered, already-permitted** strings. Who may
 * speak, the `Speaker` prefix, `renderMessage`'s slash-command rule, the
 * confirm/dry-run envelope: all of those are decided in `run` below, before the
 * loop is entered, and none of them may migrate into it. The concrete risk is
 * that `resource-broadcast` carries a fixed, reviewed sentence and this carries
 * whatever somebody typed; a loop that owned "how a broadcast is authorised"
 * would hand the next caller whichever gating it happened to have.
 *
 * ## Three piles, and `deliveryGate` makes all three cuts
 *
 * Nothing here decides who may be typed into. `deliveryGate` (queue.ts) does,
 * and it asks `steerableStatus` (steer.ts), so a shell — where the text would be
 * EXECUTED — and a Claude that has exited fall out carrying **their** sentence
 * rather than one written in this file.
 *
 * **`deliveryGate` AND NOT `drainGate`, and the difference is one status.** The
 * first version of this file used `drainGate`, which answers *may this be
 * QUEUED for* and says `now` for `needs-you`. This loop is asking *may this be
 * DELIVERED now*, where a session sitting on a dialog is `later` — a message
 * typed at a dialog answers it instead of arriving. With the wrong gate a
 * `needs-you` session previewed as *would send*, was refused at send time, and
 * ended up neither delivered nor queued. queue.ts already says those two
 * questions "have been confused once"; this was the second time.
 *
 * **A WORKING SESSION IS QUEUED, NOT DROPPED**, and that was a late correction.
 * Keystrokes into a busy Claude do not queue themselves anywhere useful, which
 * is true and is an argument for putting the line in that session's QUEUE — not
 * for omitting it. The first version of this route skipped them. On this box
 * most sessions are working most of the time, so that version reached about a
 * third of the fleet while calling itself a broadcast to all agents, which is a
 * lie rather than a limitation. GPT Sol's C, 2026-09-09.
 *
 * ## NOTHING HERE INVENTS A WORD FOR WHAT BECAME OF A SEND
 *
 * Three separate delivery vocabularies have had to be removed from this
 * dashboard. So the recipient union splits in two: **an outer arm saying what
 * this fan-out did about the row — attempted, queued, skipped, held,
 * not-reached — and, on `attempted` only, the steer route's own response
 * embedded whole.**
 * Scheduling above, delivery below, and only the lower half has a delivery
 * reading in it. Folding `working` and `deadline` into `{ok:false, delivery:
 * "none"}` — which is what this file did first — is inventing a second
 * vocabulary while claiming not to. See `BroadcastRecipient`.
 *
 * ## NOTHING HERE HOLDS THE TRANSPORT
 *
 * This route does not import `sendMessage` and cannot: every keystroke goes
 * through `send-coordinator.ts`, which asks the quarantine book whether that
 * session is HELD on the line above the transport call. It has to be that way
 * round rather than a check this file remembers to make — a hold was recorded
 * by three producers and enforced by one, and this file was one of the two that
 * could type into a session the page was drawing as held. `SendAttempt`'s
 * `held` arm is the outcome; `kind: "held"` below is what a recipient gets.
 *
 * The coordinator also owns the two readings this file used to make for itself:
 * whether an ambiguous failure means *nothing left this process* (`nothingWasSent`,
 * never `result.delivery` alone) and what to write in the book when it does not.
 *
 * ## IT MUST NOT HOLD THE SERVER'S ONLY THREAD
 *
 * The transport is synchronous — three `execFileSync` tmux calls with ten-second
 * timeouts each — so a fan-out of thirty-six on the box this button exists FOR
 * (load 391, tmux calls timing out) is minutes during which the page, the SSE
 * stream and every other route answer nothing. So the loop hands the event loop
 * back between recipients and gives up at a deadline, naming the rows it never
 * reached. A broadcast that tells thirty of thirty-six is worth having; a
 * dashboard that stops answering is not.
 *
 * ## NO IMPORT SIDE EFFECTS
 *
 * `realBroadcastDeps()` is a function and the routes are built lazily, because
 * the cooldown is state. The rule steer.ts, status.ts and state.ts all keep.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { renderMessage, type Speaker } from "./actions.js";
import { sharedReceiptJournal } from "./action-stores.js";
import { deliveryGate, type EnqueueRefusalRule } from "./queue.js";
import {
  beginRecipientReceipt,
  broadcastParentOutcome,
  recordUnreachedRecipient,
  recordUnattemptedRecipient,
  sendAttemptOutcome,
  summarizeReceipt,
  type ReceiptActor,
  type ReceiptJournal,
  type ReceiptOutcome,
  type RecipientReceipt,
} from "./receipt-journal.js";
import { lookupRequest, readRequestKey, type RequestLookup } from "./request-key.js";
/* **THE ONE DOOR TO THE ONE QUEUE.** Written like `drainSharedQueues` beside
   it, and for the reason both that function and server.ts's mount point already
   state: two `SteeringQueue`s would be two queues, and the one the page can see
   would be the one nothing delivers from. Narrow on purpose — this route has no
   business reaching `settle`, `release` or the quarantine surface. */
import { enqueueSharedMessage } from "./routes-actions.js";
/* Imported, never forked. `parseTarget` in particular may move under the
   dashboard's Stage 5 and a merge conflict there is cheaper than a second
   target parser that disagrees with the first about what an address is. */
import {
  checkOrigin,
  parseSpeaker,
  parseStatus,
  parseTarget,
  readBody,
  REFUSAL_STATUS,
  type Parsed,
} from "./routes-steer.js";
/* **THE ONLY WAY THIS FILE CAN TYPE AT A PANE**, and there is no transport
   beside it. `tests/fleet-imports.test.ts` fails if `sendMessage` is imported
   here again. */
import { sharedSendCoordinator, type SendCoordinator, type SendPurpose } from "./send-coordinator.js";
import { checkText, describeSend, type SteerTarget } from "./steer.js";
import type { FleetStatus } from "./status.js";
import type { Delivery, ReceiptSummary } from "./wire.js";

/**
 * How long before the fleet may be told anything again.
 *
 * A broadcast is thirty-six interruptions, each costing that agent a turn and
 * its context. Sent twice in five minutes it is worse than not sent at all: the
 * second arrives while half the fleet is still reacting to the first, in an
 * order nobody controls. Ten minutes is longer than any plausible double-tap.
 *
 * **Deliberately the same number as `BROADCAST_COOLDOWN_MS` in
 * routes-actions.ts and NOT imported from it**, because these are two different
 * cooldowns over two different clocks until the loops converge, and importing
 * would make them look like one. When they do converge, this constant goes with
 * the loop and the duplication goes with it.
 */
export const BROADCAST_COOLDOWN_MS = 10 * 60_000;

/** More recipients than this is a script, not a fleet. Matched to the box route's. */
export const MAX_RECIPIENTS = 80;

/**
 * **THE BOX ROUTE'S BODY LIMIT, NOT THE STEER ROUTE'S.**
 *
 * A steer body is one address and a sentence; sixteen kilobytes is generous for
 * that. A broadcast body carries **eighty addresses** as well, at roughly 130
 * bytes each, and the two caps are much closer together than they look — the
 * first version of this file used the steer default and its own recipient cap
 * was unreachable behind it, which a test then "passed" by hitting 413 instead.
 * GPT Sol's P2 and the comment on `MAX_BOX_BODY_BYTES` next door, which says
 * the same thing about the route that already had this problem.
 */
export const MAX_BROADCAST_BODY_BYTES = 64 * 1024;

/** How long the whole fan-out may take before it stops early. See the header. */
export const BROADCAST_DEADLINE_MS = 90_000;

/**
 * The longest line somebody may broadcast.
 *
 * Not a security boundary — the body cap is that. This is a product one: a
 * paragraph typed at thirty-six agents at once is thirty-six agents reading a
 * paragraph, and anything that long wants a doc and a link to it.
 */
export const MAX_TEXT_CHARS = 2_000;

export type BroadcastMode = "dry-run" | "run";

/**
 * The exact body `POST /api/steer/message` answers with, embedded verbatim.
 *
 * **NOT REBUILT AND NOT REINTERPRETED.** The browser's complete reading of a
 * steer lives in a private `post()` inside steer-client.ts and includes
 * `status` and `from` as well as the fields below; a recipient that carried
 * only `verified` and `delivery` would need the page to invent the other two.
 * So this is the whole response object, plus the HTTP status the fan-out would
 * have answered had this been a request of its own.
 */
export type AttemptedSend = {
  status: number;
} & (
  | { ok: true; op: "message"; verified: unknown; sent: readonly (readonly string[])[] }
  | { ok: false; code: string; why: string; delivery: Delivery }
);

/**
 * What happened to one row the page asked about.
 *
 * **THE OUTER ARMS ARE SCHEDULING AND THE INNER ONE IS DELIVERY, AND THAT LINE
 * IS THE WHOLE POINT OF THIS TYPE.**
 *
 * The first version of this had three arms — `would-send`, `sent`, `refused` —
 * and folded *this session is working*, *this is a dry run* and *the fan-out ran
 * out of time* into `refused` as `{ok:false, code, delivery:"none"}`, on the
 * argument that reusing the steer route's field set meant reusing its
 * vocabulary. GPT Sol's E: that is **inventing a second vocabulary while
 * claiming not to**. `later` has no refusal code, and no steer code truthfully
 * means "the fan-out expired" — those are things the ORCHESTRATOR did, not
 * things the delivery module reported.
 *
 * So: the outer `kind` says what this fan-out did about the row, and only
 * `attempted` carries a delivery reading at all. There is still exactly one
 * delivery vocabulary and it is `steer-client.ts`'s, which was the condition
 * `claude-agents-dashboard` set and is still met.
 *
 * `would-send` and `would-queue` appear ONLY under `op: "broadcast-preview"`.
 * A preview row and a delivered row used the same word once, and a dry run was
 * then indistinguishable from a real fan-out by anything but the envelope.
 */
export type BroadcastRecipient = { sessionId: string; paneId: string } & (
  /** Dry run: at a prompt, would have been typed at. */
  | { kind: "would-send" }
  /** Dry run: working, would have been put in its queue. */
  | { kind: "would-queue" }
  /** Keys went at the pane. The steer response, whole. */
  | { kind: "attempted"; attempt: AttemptedSend }
  /**
   * **NOTHING WAS TYPED AT THIS ONE, AND THE TRANSPORT WAS NEVER REACHED.**
   *
   * The session is HELD: an earlier send to it came back with nobody able to
   * account for it, so the literal text may be sitting in that input box with
   * no Enter behind it, and a broadcast sentence landing behind half of
   * somebody else's would be read by the agent as one instruction neither
   * person wrote. `send-coordinator.ts` refuses on the line above the send.
   *
   * **A SCHEDULING ARM RATHER THAN AN `attempted` REFUSAL, and that is the same
   * rule as everything else in this union.** `{ok:false, delivery:"none"}` would
   * say the send was attempted and refused, when it was never attempted at all
   * — and `delivery` is the steer route's word for what the TRANSPORT reported.
   * It is not `skipped` either: that arm means *could never be typed into*, and
   * a hold is a thing a person releases. `why` is the hold's own sentence.
   */
  | { kind: "held"; why: string }
  /**
   * Working, so it went in that session's queue and drains at its next prompt.
   *
   * **`durable` IS THE QUEUE'S OWN WORD, carried through** — plan 260910d, the
   * Stage 1b review's F36. `false` means that item's receipt lives only in this
   * process's memory and a dashboard restart forgets it, so the row is never a
   * plain *queued*. The door dropped this bit until Stage 3.
   */
  | { kind: "queued"; position: number; durable: boolean }
  /** Could never be typed into — a shell, a dead Claude. `drainGate`'s sentence. */
  | { kind: "skipped"; code: string; why: string }
  /** The fan-out stopped before it got here. Nothing was sent and nothing queued. */
  | { kind: "not-reached"; why: string }
);

/**
 * The counts, which are what a person actually reads.
 *
 * **`submitted` IS NOT `heard`, AND THE WORD MATTERS.** A successful steer means
 * the tmux calls completed; even `verified` is explicitly a pre-send identity
 * check and not a delivery receipt (steer-client.ts). Nothing on this box can
 * establish that an agent read a line. GPT Sol's P2. So the field is named for
 * what was measured, and the page's sentence has to be too.
 */
export type BroadcastCounts = {
  /** Rows the page asked about. */
  asked: number;
  /** Rows that were at a prompt and had keys typed at them. */
  submitted: number;
  /** Rows that were working and went into their own queue instead. */
  queued: number;
  /** Rows that could never be typed into. */
  skipped: number;
  /**
   * Rows nothing was typed at because that session is HELD.
   *
   * **COUNTED, AND SEPARATELY.** A held recipient is neither submitted nor
   * skipped, and leaving it out of the counts altogether is how a fan-out
   * reaches most of the fleet and reads as though it reached all of it — the
   * failure this whole route is written against.
   */
  held: number;
  /** Rows the fan-out did not get to before its deadline. */
  notReached: number;
};

export type BroadcastResponse =
  | {
      ok: true;
      op: "broadcast-preview";
      /** Everything the page asked about, in its order. */
      result: { counts: BroadcastCounts; recipients: BroadcastRecipient[]; sample: string | null };
    }
  | {
      ok: true;
      op: "broadcast";
      result: { counts: BroadcastCounts; recipients: BroadcastRecipient[] };
      /** The broadcast's own receipt — present only on a keyed request (plan 260910d Stage 3). */
      receiptId?: string;
    }
  /**
   * **A REPLAY: NOTHING WAS SENT OR QUEUED ON THIS REQUEST.** The same
   * `requestId` and body were accepted before. This is the broadcast's receipt
   * and each recipient's, text-free; the children say what became of each one.
   */
  | { ok: true; op: "receipt"; replay: true; receipt: ReceiptSummary; children: ReceiptSummary[] }
  | {
      ok: false;
      code: string;
      why: string;
      /** Present on a keyed request that got as far as its receipt. */
      receiptId?: string;
      /**
       * **PRESENT ON `not-steerable`, AND THE REASON IT IS OPTIONAL RATHER THAN
       * ABSENT.** When every row is skipped there is no fan-out to report, and
       * the first version of this route answered a bare sentence — which threw
       * away the only thing the person actually needs: *why* nobody could be
       * reached. "Three shells and twelve working" is a diagnosis; "there is
       * nobody to tell" is a shrug. Every other refusal happens before any row
       * has been judged, and carries none.
       */
      result?: { counts: BroadcastCounts; recipients: BroadcastRecipient[] };
    };

/** One row as the page sends it: the row's own claims, and the status it displayed. */
type Recipient = { target: SteerTarget; declaredStatus: FleetStatus };

type BroadcastRequest = {
  text: string;
  speaker: Speaker;
  mode: BroadcastMode;
  confirm: boolean;
  recipients: Recipient[];
};

/**
 * Putting a line in a working session's queue, or the admission that this
 * server cannot.
 *
 * **`null` IS A REAL ARM AND NOT A TODO.** The queue is state, mounted as a
 * singleton behind `handleActionRequest`, and reaching *that* instance from
 * here needs an export `routes-actions.ts` does not have yet — a second
 * `SteeringQueue` would be a second queue, and the one the page renders would
 * be the one nothing ever delivers from. Until it exists, a working session is
 * `skipped` and the page says so; when it does, this becomes a function and the
 * same recipients come back `queued`. Both paths are tested, because the
 * difference is what a broadcast on a busy box actually reaches.
 */
export type EnqueueForBroadcast =
  | null
  | ((
      target: { sessionId: string; claudeSessionId: string },
      text: string,
      speaker: Speaker,
      /** The broadcast's receipt: the item's own receipt is its child. */
      parentReceiptId: string | null,
    ) =>
      /** `durable` and `receiptId` are the queue's own, carried through (F36). */
      | { ok: true; position: number; durable: boolean; receiptId: string }
      /**
       * `rule` travels because two of its arms want opposite handling in a
       * fan-out. `bad-text` is a fact about the MESSAGE and will fail
       * identically for every recipient — twenty rows saying it is one truth
       * reported twenty times — while a queue cap or the double-tap window is a
       * fact about that recipient. See `enqueueSharedMessage`'s comment.
       */
      | { ok: false; rule: EnqueueRefusalRule; why: string });

export type BroadcastDeps = {
  /**
   * **The only thing here that can type into a pane** — `send-coordinator.ts`.
   *
   * There is no `sendMessage` beside it and there must never be one: the
   * coordinator asks the one book of per-session holds whether this session is
   * HELD on the line above the transport call, so a broadcast cannot land
   * behind half a sentence somebody else left in that input box. It owns the
   * recording too — `deps.send.book()` is the same book the drain consults.
   * `tests/fleet-compile-guards.test.ts` fails if a transport reappears here.
   */
  send: SendCoordinator;
  /**
   * Where the broadcast's receipts go — plan 260910d Stage 3: one parent per
   * request, carrying its `requestId`, and a child per recipient. **The same
   * journal the queue writes**, so a queued recipient's own receipt and the
   * parent it names are in one file; production reaches both through
   * `sharedReceiptJournal()`.
   */
  receipts: ReceiptJournal;
  now: () => number;
  log: (line: string) => void;
  /** See `EnqueueForBroadcast`. */
  enqueue: EnqueueForBroadcast;
  /**
   * Whether a real run may go out at all.
   *
   * **A KILL SWITCH THAT HAS TO BE ADDED UNDER PRESSURE IS ONE THAT DOES NOT
   * EXIST** — routes-steer.ts's words about `FLEET_ANSWER_ENABLED`, and the same
   * argument applies harder here, because this is the one control that types at
   * the whole fleet at once. Default ON, and only an explicit `0` turns it off,
   * so a box that has never heard of the variable behaves as it always did.
   * A dry run is never gated: it sends nothing, and being able to see what a
   * broadcast WOULD do while broadcasting is switched off is the point.
   */
  runEnabled: () => boolean;
  /**
   * Hand the event loop back. Injected so a test can drive the deadline by
   * moving a clock rather than by waiting — a suite that actually slept
   * ninety seconds is one nobody runs.
   */
  yieldToLoop: () => Promise<void>;
};

export function realBroadcastDeps(): BroadcastDeps {
  return {
    /* THE SAME BOOK, REACHED THE SAME WAY THE OTHER PRODUCERS REACH IT.
       `sharedSendCoordinator()` is built over `sharedQuarantineBook()`, so a
       hold this route opens is one the drain and the page can see, and one the
       drain opened stops this route. `tests/fleet-send-composition.test.ts`
       asserts that by identity rather than leaving it to this comment. */
    send: sharedSendCoordinator(),
    receipts: sharedReceiptJournal(),
    now: () => Date.now(),
    log: (line) => console.log(line),
    enqueue: null,
    runEnabled: () => process.env["FLEET_BROADCAST_ENABLED"] !== "0",
    /* `setImmediate` rather than `await null`: a microtask does not let the
       server answer another request, which is the whole purpose. */
    yieldToLoop: () => new Promise<void>((r) => setImmediate(r)),
  };
}

function bad<T>(why: string): Parsed<T> {
  return { ok: false, why };
}

function parseMode(v: unknown): Parsed<BroadcastMode> {
  if (v === "dry-run" || v === "run") return { ok: true, value: v };
  return bad(`mode must be 'dry-run' or 'run', not ${JSON.stringify(v)}`);
}

/**
 * The body, checked field by field, because every one of these arrives as JSON
 * from a browser where the TypeScript type is a comment.
 *
 * **The recipients are the client's and the server does not supply its own.**
 * The count in the confirmation somebody read is the count off the page in front
 * of them; a server that filled in from its own snapshot would deliver to a set
 * nobody agreed to, and the two would differ exactly when the box is changing
 * fastest. Same rule the box action route already keeps.
 */
function parseBody(raw: unknown): Parsed<BroadcastRequest> {
  if (typeof raw !== "object" || raw === null) return bad("the body is not an object");
  const o = raw as Record<string, unknown>;

  const text = o["text"];
  if (typeof text !== "string") return bad("text must be a string");
  const trimmed = text.trim();
  if (trimmed === "") return bad("there is nothing to say: text is empty");
  if (trimmed.length > MAX_TEXT_CHARS) {
    return bad(`${trimmed.length} characters is more than the ${MAX_TEXT_CHARS} this will say to a whole fleet at once`);
  }

  const speaker = parseSpeaker(o["speaker"]);
  if (!speaker.ok) return speaker;
  const mode = parseMode(o["mode"]);
  if (!mode.ok) return mode;

  const raws = o["recipients"];
  if (!Array.isArray(raws)) {
    return bad("recipients must be an array: send the rows the page is showing, with the status each one had");
  }
  if (raws.length === 0) {
    return bad("a broadcast needs recipients: send the rows the page is showing, with the status each one had");
  }
  if (raws.length > MAX_RECIPIENTS) {
    return bad(`${raws.length} recipients is more than the ${MAX_RECIPIENTS} this will speak to at once`);
  }

  const recipients: Recipient[] = [];
  const seen = new Set<string>();
  for (const item of raws) {
    if (typeof item !== "object" || item === null) return bad("every recipient must be an object");
    const target = parseTarget(item as Record<string, unknown>);
    if (!target.ok) return target;
    const status = parseStatus((item as Record<string, unknown>)["status"]);
    if (status === null) return bad(`recipient ${target.value.sessionId} sent no status this build can read`);
    /* **A DUPLICATE IS A BUG IN THE CALLER AND IS REFUSED, NOT DEDUPLICATED.**
       The same pane twice means two lines into one input box, back to back, and
       silently dropping the second would hide whatever produced it. */
    if (seen.has(target.value.paneId)) return bad(`pane ${target.value.paneId} appears twice in the recipients`);
    seen.add(target.value.paneId);
    recipients.push({ target: target.value, declaredStatus: status });
  }

  /* **CONFIRM IS READ AND NOT DEFAULTED TRUE.** A run that nobody confirmed is
     refused below; a dry run needs no confirmation because it sends nothing. */
  return {
    ok: true,
    value: { text: trimmed, speaker: speaker.value, mode: mode.value, confirm: o["confirm"] === true, recipients },
  };
}

function respond(res: ServerResponse, status: number, body: BroadcastResponse, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

/** A refusal's sentence, flattened, because it may quote another process's argv. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ");
}

export type BroadcastRoutes = { handle(req: IncomingMessage, res: ServerResponse): boolean };


export function makeBroadcastRoutes(overrides: Partial<BroadcastDeps> = {}): BroadcastRoutes {
  const deps: BroadcastDeps = { ...realBroadcastDeps(), ...overrides };
  let lastBroadcastAt: number | null = null;

  /* ---------------- receipts — plan 260910d Stage 3 ---------------- */

  /** The broadcast's own receipt, and who its children are attributed to. */
  type ParentReceipt = { receiptId: string; actor: ReceiptActor; speaker: Speaker; what: string };

  /** Fail-open: a lost outcome line recovers as `outcome-unknown`, which is true. */
  function settleReceipt(receiptId: string, arm: ReceiptOutcome): void {
    if (!deps.receipts.outcome(receiptId, arm)) {
      deps.log(`broadcast: receipt=${receiptId} outcome ${arm.state}/${arm.reason} was not recorded`);
    }
  }

  function childOf(parent: ParentReceipt, rec: Recipient): RecipientReceipt {
    return {
      parentReceiptId: parent.receiptId,
      actor: parent.actor,
      speaker: parent.speaker,
      what: parent.what,
      target: {
        sessionId: rec.target.sessionId,
        paneId: rec.target.paneId,
        claudeSessionId: rec.target.claudeSessionId,
        tmuxGeneration: deps.send.book().knownGeneration() ?? deps.receipts.lastGeneration(),
      },
    };
  }

  /**
   * A known request id, answered. A replay is the broadcast's receipt AND its
   * children's, and nothing else happens: no parse, no cooldown, no send.
   */
  function answerLookup(res: ServerResponse, found: Exclude<RequestLookup, { kind: "fresh" }>): void {
    switch (found.kind) {
      case "replay": {
        const receipt = summarizeReceipt(found.receipt);
        const children = deps.receipts.childrenOf(found.receipt.receiptId).map(summarizeReceipt);
        deps.log(`broadcast: REPLAY receipt=${receipt.receiptId} state=${receipt.state} children=${children.length} — nothing was sent on this request`);
        respond(res, 200, { ok: true, op: "receipt", replay: true, receipt, children });
        return;
      }
      case "conflict":
        deps.log("broadcast: refused code=request-id-conflict");
        respond(res, 409, { ok: false, code: "request-id-conflict", why: found.why });
        return;
      case "expired":
        deps.log("broadcast: refused code=request-id-expired");
        respond(res, 409, { ok: false, code: "request-id-expired", why: found.why });
        return;
      default: {
        const never: never = found;
        void never;
      }
    }
  }

  /**
   * **THE LOOP, AND IT KNOWS NOTHING ABOUT AUTHORITY.**
   *
   * It is handed a `render` that produces the line for one recipient, already
   * attributed and already permitted, and it does not ask who is speaking or
   * whether they may. That ignorance is the whole of the boundary in the header,
   * and it is what makes this safe to share with `resource-broadcast` later —
   * the stagger is `render` reading `index`, and nothing else changes.
   *
   * It does not own the cooldown either. GPT Sol's D4 verdict, and it is a
   * sharper point than it looks: the ease-off cooldown exists to stop two
   * conflicting resume times, and a free-text one exists to stop the fleet being
   * interrupted twice. Those are different policies over the same number, and a
   * shared loop that owned "the cooldown" would quietly give the next caller
   * whichever one it happened to hold.
   */
  async function fanOut(
    deliverable: Recipient[],
    render: (index: number, total: number) => string,
    startedAt: number,
    into: Map<string, BroadcastRecipient>,
    /** The broadcast's receipt. Each recipient gets a child of it. */
    parent: ParentReceipt,
  ): Promise<void> {
    const total = deliverable.length;
    for (let index = 0; index < total; index += 1) {
      const rec = deliverable[index];
      if (rec === undefined) continue;
      const where = { sessionId: rec.target.sessionId, paneId: rec.target.paneId };

      /* **YIELD FIRST, THEN CHECK THE CLOCK.** These were the other way round
         until GPT Sol's P2, and the order matters on exactly the box this
         button exists for: the yield hands the event loop to a server under
         load, and it can come back long after the deadline has passed — at
         which point a check made BEFORE it has approved another synchronous
         send worth up to thirty seconds of tmux timeouts. Reading the clock on
         the line adjacent to the send is the same discipline `verifyTarget`
         keeps about the moment before the keys go out. */
      if (index > 0) await deps.yieldToLoop();
      if (deps.now() - startedAt > BROADCAST_DEADLINE_MS) {
        // Accounted for by a child that was never attempted: `not-sent`/`not-reached`.
        if (!recordUnreachedRecipient(deps.receipts, childOf(parent, rec))) {
          deps.log(`broadcast: receipt for the unreached ${rec.target.sessionId} was not recorded`);
        }
        into.set(rec.target.paneId, {
          ...where,
          kind: "not-reached",
          why: `the fan-out ran past ${Math.round(BROADCAST_DEADLINE_MS / 1000)}s and stopped before reaching this session — nothing was sent to it and nothing was queued for it`,
        });
        continue;
      }

      /* RENDERED HERE, ONE LINE ABOVE THE SEND — not above the loop and not
         in the parse. A staggered sentence names a wall-clock time, and a
         fan-out that sat behind thirty ten-second tmux calls would otherwise
         promise the last recipient a moment that has already passed. Free text
         does not need this; the caller that this loop is meant to absorb does,
         and building the seam anywhere else would be building it wrong. */
      const text = render(index, total);

      /**
       * What this send is, for the coordinator — and therefore for the hold.
       *
       * **A PRODUCER OF AMBIGUOUS SENDS, AND IT IS THE SAME BOOK AS THE OTHERS.**
       * A `partial` or `unknown` means the literal text may be sitting in that
       * agent's input box with no Enter behind it. `drain.ts` already refuses to
       * retry such a send; what nothing stops without a hold is the NEXT queued
       * item draining onto the end of it, so the agent reads one instruction
       * neither person wrote. That recording is the coordinator's now — it
       * happens on the line above the transport call, where this loop cannot
       * forget it.
       *
       * **AND THE READING GOES THE OTHER WAY TOO**, which is the half this route
       * was missing: a recipient that is ALREADY held is not typed at, at all.
       * This file recorded holds and never consulted them, so a broadcast typed
       * into every session the page was drawing as quarantined.
       *
       * `onThrow: "hold"` because there is no lease here to leave open — an
       * exception out of the transport cannot say whether it happened before the
       * first keystroke or out of the middle of the sequence, and a hold is the
       * only record there is. `what` describes the payload by its length and
       * never contains a word of it: this sentence is stored on the hold, logged
       * and drawn on a page.
       */
      const purpose: SendPurpose = {
        origin: "broadcast",
        what: `broadcast (${text.length} characters)`,
        onThrow: "hold",
        record: { kind: "book" },
      };
      /* THIS RECIPIENT'S OWN RECEIPT — accepted and attempted on the line above
         the send, settled on the line below it, exactly as a direct steer is
         (plan 260910d Stage 3). No receipt, no send: the row carries the 503
         the steer route would have answered, because nothing was typed. */
      const child = beginRecipientReceipt(deps.receipts, childOf(parent, rec));
      if (!child.ok) {
        deps.log(`broadcast: not sent session=${rec.target.sessionId} code=receipt-unavailable`);
        into.set(rec.target.paneId, {
          ...where,
          kind: "attempted",
          attempt: { status: 503, ok: false, code: "receipt-unavailable", why: child.why, delivery: "none" },
        });
        continue;
      }
      const attempt = deps.send.message(rec.target, text, rec.declaredStatus, purpose);
      settleReceipt(child.receiptId, sendAttemptOutcome(attempt));

      if (attempt.kind === "held") {
        /* **NOTHING WAS TYPED AT THIS ONE**, and the loop carries on to the
           rest: one session holding half of somebody else's sentence is a
           reason not to speak to that session, never a reason to say nothing to
           the other thirty-five. The sentence is the hold's own, so the page
           reads why rather than a word this file made up. */
        deps.log(
          `broadcast: not sent session=${rec.target.sessionId} code=session-held ` +
            `hold=${attempt.hold.id} v${attempt.hold.version} reading=${attempt.hold.reading}`,
        );
        into.set(rec.target.paneId, { ...where, kind: "held", why: attempt.why });
        continue;
      }

      /* THE HOLD THIS SEND OPENED, if the coordinator opened one — logged here
         rather than decided here. Never the standing hold above: that one
         stopped a send, and this one is a consequence of one. */
      const opened = attempt.hold;
      if (opened !== null) {
        deps.log(
          `broadcast: HELD session=${rec.target.sessionId} hold=${opened.id} v${opened.version} reading=${opened.reading}`,
        );
      }

      if (attempt.kind === "threw") {
        /* A THROW IS THE CASE WITH THE LEAST EVIDENCE BEHIND IT: the call may
           have thrown before the first keystroke or out of the middle of the
           sequence, and nothing here can tell. That is the reason the hold above
           was opened — `onThrow: "hold"` — not a reason to assume the first. */
        // An arbitrary transport error can quote its argv, whose literal-text
        // argument is the broadcast. Keep both the log and response text-free.
        const why = "the delivery module threw; nothing here can tell whether any of the message reached the pane";
        deps.log(`broadcast: FAILED session=${rec.target.sessionId} ${oneLine(why)}`);
        into.set(rec.target.paneId, {
          ...where,
          kind: "attempted",
          attempt: { status: 500, ok: false, code: "internal", why, delivery: "unknown" },
        });
        continue;
      }

      const result = attempt.result;
      if (!result.ok) {
        /* **THE HOLD ABOVE WAS DECIDED BY `nothingWasSent`, NOT BY
           `result.delivery`.** That function is the one audited place that reads
           both halves — the summary and the list of tmux calls that completed —
           and a `delivery: "none"` with a non-empty list is a self-contradicting
           report whose honest reading is that something went out. The reading is
           the coordinator's; a second opinion here would be the more confident
           of the two. */
        /* `describeSend`, never `result.sent` — THE ARGV IS THE MESSAGE, and
           this file promises no word of it reaches the log. `oneLine`, because a
           refusal's `why` names what it found, and that comes out of another
           process's argv, which anyone who can start a process here chooses. */
        deps.log(
          `broadcast: refused session=${rec.target.sessionId} code=${result.reason.code} ` +
            `delivery=${result.delivery} landed=${describeSend(result.sent)} why=${oneLine(result.reason.why)}`,
        );
        into.set(rec.target.paneId, {
          ...where,
          kind: "attempted",
          attempt: {
            status: REFUSAL_STATUS[result.reason.code],
            ok: false,
            code: result.reason.code,
            why: result.reason.why,
            delivery: result.delivery,
          },
        });
        continue;
      }

      deps.log(
        `broadcast: SENT session=${rec.target.sessionId} pane=${result.verified.paneId} calls=${result.sent.length}`,
      );
      into.set(rec.target.paneId, {
        ...where,
        kind: "attempted",
        attempt: { status: 200, ok: true, op: "message", verified: result.verified, sent: result.sent },
      });
    }
  }

  /** The counts, derived from the rows rather than tallied alongside them. */
  function countOf(rows: BroadcastRecipient[], asked: number): BroadcastCounts {
    let submitted = 0;
    let queued = 0;
    let skipped = 0;
    let held = 0;
    let notReached = 0;
    for (const row of rows) {
      switch (row.kind) {
        case "attempted":
          if (row.attempt.ok) submitted += 1;
          break;
        case "queued":
          queued += 1;
          break;
        case "skipped":
          skipped += 1;
          break;
        case "held":
          held += 1;
          break;
        case "not-reached":
          notReached += 1;
          break;
        default:
          break;
      }
    }
    return { asked, submitted, queued, skipped, held, notReached };
  }

  /**
   * Everything the page asked about, in the page's order, and nothing invented.
   *
   * **A ROW SHOULD NEVER BE MISSING, and the `filter` is what happens if one
   * is.** The three piles are exhaustive over `request.recipients` — `never` and
   * a doorless `later` are set during the partition, `queued`/`skipped` by the
   * enqueue loop, `attempted`/`not-reached` by the fan-out, and every branch of
   * both loops sets exactly once before continuing. Duplicates are impossible
   * because the parse refuses a repeated pane.
   *
   * So the drop is unreachable. What makes it safe to leave as a `filter`
   * rather than a throw is that `counts.asked` comes from
   * `request.recipients.length` and not from this array: a row that went
   * missing shows up as a list shorter than the number beside it, which is a
   * visible discrepancy rather than a smaller fleet quietly reported as the
   * whole one.
   */
  function ordered(request: BroadcastRequest, into: Map<string, BroadcastRecipient>): BroadcastRecipient[] {
    return request.recipients
      .map((r) => into.get(r.target.paneId))
      .filter((x): x is BroadcastRecipient => x !== undefined);
  }

  async function run(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Logged BEFORE anything can refuse it, so an attempt turned away at the
    // door still leaves a trace. A write path whose log records only the
    // successes is a write path you cannot investigate.
    deps.log(`broadcast: attempt from=${req.socket?.remoteAddress ?? "-"}`);

    const headers = checkOrigin(req.headers);
    if (!headers.ok) {
      deps.log(`broadcast: refused code=${headers.code}`);
      respond(res, headers.status, { ok: false, code: headers.code, why: headers.why });
      return;
    }

    const body = await readBody(req, MAX_BROADCAST_BODY_BYTES);
    if (!body.ok) {
      respond(res, body.code === "body-too-large" ? 413 : 400, { ok: false, code: body.code, why: body.why });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch (e) {
      respond(res, 400, { ok: false, code: "bad-request", why: `the body is not JSON: ${(e as Error).message}` });
      return;
    }
    /* THE KEY IS READ AND LOOKED UP BEFORE THE PARSE — plan 260910d § The
       fingerprint (Sol F16). A replay is answered from the receipts before the
       cooldown, the gates or the kill switch are asked anything, so a retry
       after a lost response gets the broadcast back and types at nobody. A
       malformed key is refused, never downgraded to an unkeyed broadcast. */
    const key = readRequestKey("broadcast", raw);
    if (key.kind === "bad") {
      deps.log("broadcast: refused code=bad-request-id");
      respond(res, 400, { ok: false, code: "bad-request-id", why: key.why });
      return;
    }
    if (key.kind === "keyed") {
      const found = lookupRequest(deps.receipts, key, deps.now());
      if (found.kind !== "fresh") {
        answerLookup(res, found);
        return;
      }
    }
    const parsed = parseBody(raw);
    if (!parsed.ok) {
      deps.log(`broadcast: refused code=bad-request why=${oneLine(parsed.why)}`);
      respond(res, 400, { ok: false, code: "bad-request", why: parsed.why });
      return;
    }
    const request = parsed.value;

    /* **THE ATTRIBUTION AND THE SLASH RULE, DECIDED HERE AND NOT IN THE LOOP.**
       `renderMessage` puts the line saying who is speaking in front of the words,
       and refuses a slash command from any speaker but Greg — such a message is
       a command to Claude Code rather than words to weigh, and it cannot carry
       the attribution. Refused whole rather than stripped: silently removing the
       character would send something nobody typed. */
    const rendered = renderMessage(request.text, request.speaker);
    if (!rendered.ok) {
      deps.log("broadcast: refused code=cannot-attribute");
      respond(res, 400, { ok: false, code: "cannot-attribute", why: rendered.why });
      return;
    }

    /* **`checkText` ON THE RENDERED LINE, ONCE, BEFORE ANYTHING IS CLASSIFIED
       OR SPENT** — and it was missing until GPT Sol's P1-1, which found that
       the same bad message behaved two different ways depending on the fleet.
       `parseBody` above checks emptiness and length; `checkText` is the one that
       refuses a newline (each one submits the message early) and a control
       character (which is a keystroke, not a letter). Without it:

         - a fleet with anything working hit `enqueueMessage`'s own `checkText`,
           came back `bad-text`, and was refused globally — correct;
         - an ALL-IDLE fleet skipped the queue entirely, reached `sendMessage`,
           and got one failed row per recipient, HTTP 200, and a spent cooldown.

       The multi-line textarea on the card makes that trivially reachable. So it
       is asked here, of the RENDERED text — the prefix counts toward the 4,000
       limit, and a newline in the raw line survives into it either way. */
    const bad = checkText(rendered.text);
    if (bad) {
      deps.log(`broadcast: refused code=${bad.code} why=${oneLine(bad.why)}`);
      respond(res, 400, { ok: false, code: bad.code, why: bad.why });
      return;
    }

    if (request.mode === "run" && !request.confirm) {
      respond(res, 400, {
        ok: false,
        code: "not-confirmed",
        why: "a broadcast is not one tap: send confirm:true once somebody has read how many sessions it reaches",
      });
      return;
    }
    /* THE KILL SWITCH, AND ONLY ON A REAL RUN. A dry run sends nothing, and
       being able to see what a broadcast WOULD do while broadcasting is off is
       exactly what somebody turning it back on needs. */
    if (request.mode === "run" && !deps.runEnabled()) {
      deps.log("broadcast: refused code=broadcast-disabled");
      respond(res, 503, {
        ok: false,
        code: "broadcast-disabled",
        why: "broadcasting is switched off on this server (FLEET_BROADCAST_ENABLED=0). One session at a time still works from the Sessions tab.",
      });
      return;
    }

    /* **THREE PILES, AND `deliveryGate` MAKES ALL THREE CUTS — NOT
       `drainGate`.** Both exist, they differ on exactly one status, and this
       route had the wrong one until GPT Sol's P1-2.

       `drainGate` answers *may this session be QUEUED for*, and says `now` for
       `needs-you`, which is right for the enqueue route: a session sitting on a
       dialog is one you may queue for. `deliveryGate` answers the different
       question this loop is asking — *may this be DELIVERED right now* — and
       says `later` for `needs-you`, because `sendMessage` refuses a pane with a
       dialog on it (`pane-is-asking`) and a message typed AT a dialog would
       answer it rather than arrive as a message.

       With the wrong gate, a `needs-you` session previewed as `would-send`, was
       refused at send time, and ended up neither delivered nor queued — the one
       outcome a broadcast must not produce silently. queue.ts says the two
       questions "have already been confused once"; this was the second time.

       `later` is the interesting arm, and it is why this is a fan-out and not a
       filter. A working session cannot usefully be typed at — keystrokes into a
       busy Claude do not queue themselves anywhere — but that is an argument for
       putting the line in its QUEUE, not for dropping it. On this box most
       sessions are working most of the time, so a fan-out that omitted them
       would reach a third of the fleet while calling itself a broadcast to all
       agents. GPT Sol's C. */
    const outcomes = new Map<string, BroadcastRecipient>();
    const deliverable: Recipient[] = [];
    const queueable: Recipient[] = [];
    for (const rec of request.recipients) {
      const where = { sessionId: rec.target.sessionId, paneId: rec.target.paneId };
      const gate = deliveryGate(rec.declaredStatus);
      if (gate.kind === "now") {
        deliverable.push(rec);
        continue;
      }
      if (gate.kind === "later") {
        if (deps.enqueue !== null) {
          queueable.push(rec);
          continue;
        }
        /* No door to the shared queue on this build. Reported as skipped with
           the queue's own sentence, never as sent and never silently: what a
           broadcast reaches is the whole question on a busy box. */
        outcomes.set(rec.target.paneId, {
          ...where,
          kind: "skipped",
          code: "declared-not-steerable",
          why: `${gate.why}, and this server has no door to that session's queue`,
        });
        continue;
      }
      outcomes.set(rec.target.paneId, {
        ...where,
        kind: "skipped",
        code: gate.reason.code,
        why: gate.reason.why,
      });
    }

    const asked = request.recipients.length;
    const reachable = deliverable.length + queueable.length;
    if (reachable === 0) {
      deps.log(`broadcast: refused code=not-steerable asked=${asked}`);
      const rows = ordered(request, outcomes);
      respond(res, 409, {
        ok: false,
        code: "not-steerable",
        why: `none of the ${asked} rows you sent can be reached right now, so there is nobody to tell`,
        /* **THE PER-SESSION REASONS TRAVEL WITH THE REFUSAL.** A bare "there is
           nobody to tell" is a shrug; "three shells and twelve working" is a
           diagnosis somebody can act on. This route answered the shrug for about
           an hour on 2026-09-09. */
        result: { counts: countOf(rows, asked), recipients: rows },
      });
      return;
    }

    /* THE SAME FUNCTION THE SEND WILL CALL, so a preview cannot promise a
       different sentence from the one that goes out. Free text is the constant
       renderer; the `index`/`total` arguments exist for the staggered caller
       this loop is meant to absorb — see the header. */
    const render = (): string => rendered.text;

    if (request.mode === "dry-run") {
      for (const rec of deliverable) {
        outcomes.set(rec.target.paneId, {
          sessionId: rec.target.sessionId,
          paneId: rec.target.paneId,
          kind: "would-send",
        });
      }
      for (const rec of queueable) {
        outcomes.set(rec.target.paneId, {
          sessionId: rec.target.sessionId,
          paneId: rec.target.paneId,
          kind: "would-queue",
        });
      }
      const rows = ordered(request, outcomes);
      deps.log(`broadcast: preview asked=${asked} send=${deliverable.length} queue=${queueable.length}`);
      respond(res, 200, {
        ok: true,
        op: "broadcast-preview",
        result: {
          /* The preview's counts are the counts of what WOULD happen, and the
             `would-*` arms are not counted as `submitted` or `queued` — those
             two words mean something was done. A preview whose numbers matched
             a delivery's exactly is how a dry run gets read as a fan-out. */
          counts: countOf(rows, asked),
          recipients: rows,
          // One recipient's exact words, so a person can read what is about to
          // be said to thirty-six agents before it is said.
          sample: render(),
        },
      });
      return;
    }

    const at = deps.now();
    if (lastBroadcastAt !== null && at - lastBroadcastAt < BROADCAST_COOLDOWN_MS) {
      const left = BROADCAST_COOLDOWN_MS - (at - lastBroadcastAt);
      deps.log(`broadcast: refused code=cooldown leftMs=${left}`);
      respond(
        res,
        429,
        {
          ok: false,
          code: "cooldown",
          why: `the fleet was last broadcast to ${Math.round((at - lastBroadcastAt) / 60_000)} minutes ago; the floor is ${Math.round(BROADCAST_COOLDOWN_MS / 60_000)} minutes, because every one of these costs each agent a turn and its context`,
        },
        { "retry-after": String(Math.max(1, Math.ceil(left / 1000))) },
      );
      return;
    }
    /* TAKEN BEFORE THE SENDS, not after, and before the first `await`. A fan-out
       of thirty-six takes a while, and a second request arriving halfway through
       must find the cooldown already spent — otherwise the two interleave, which
       is the exact failure the cooldown exists to prevent. Kept so the one path
       that sends nothing at all can hand it back; see the `bad-text` arm. */
    const cooldownWas = lastBroadcastAt;
    lastBroadcastAt = at;

    /* **THE PARENT RECEIPT, ACCEPTED AND ATTEMPTED BEFORE ANY RECIPIENT** —
       plan 260910d Stage 3. Accepted synchronously: nothing has awaited since
       the request id was looked up. A keyed accept that cannot land sends and
       queues nothing (Sol F1), and `attempted` is fail-closed when the accept
       is durable, so a crash mid fan-out reads on restart as an attempt that
       began, never as a broadcast proven not to have started. Either refusal
       hands the cooldown back: nobody was interrupted. */
    const keyed = key.kind === "keyed" ? key : null;
    const actor: ReceiptActor = { kind: "client-claimed", id: request.speaker };
    const accepted = deps.receipts.accept({
      requestId: keyed?.requestId ?? null,
      fingerprint: keyed?.fingerprint ?? null,
      op: "broadcast",
      origin: "broadcast",
      target: null,
      actor,
      speaker: request.speaker,
      what: `broadcast (${rendered.text.length} characters) to ${reachable} recipient(s)`,
      queue: null,
    });
    if (!accepted.ok) {
      lastBroadcastAt = cooldownWas;
      if (keyed !== null) {
        const again = lookupRequest(deps.receipts, keyed, deps.now());
        if (again.kind === "replay") {
          answerLookup(res, again);
          return;
        }
      }
      deps.log(`broadcast: refused code=receipt-unavailable why=${oneLine(accepted.why)}`);
      respond(res, 503, {
        ok: false,
        code: "receipt-unavailable",
        why: `nothing was sent or queued: this broadcast could not be given a receipt first (${accepted.why})`,
      });
      return;
    }
    const parent: ParentReceipt = {
      receiptId: accepted.receiptId,
      actor,
      speaker: request.speaker,
      what: `broadcast (${rendered.text.length} characters), one recipient`,
    };
    /** Only a keyed request is told its receipt id: that is the request that can ask again. */
    const tag: { receiptId?: string } = keyed === null ? {} : { receiptId: parent.receiptId };
    if (!deps.receipts.attempted(parent.receiptId).landed) {
      lastBroadcastAt = cooldownWas;
      settleReceipt(parent.receiptId, {
        state: "not-sent",
        reason: "attempt-not-recorded",
        code: null,
        why: "the record that this broadcast was being attempted could not be written, so nothing was sent or queued",
      });
      deps.log(`broadcast: refused code=receipt-unavailable receipt=${parent.receiptId} why=attempt-not-recorded`);
      respond(res, 503, {
        ok: false,
        code: "receipt-unavailable",
        why: "nothing was sent or queued: the record that this broadcast was being attempted could not be written",
        ...tag,
      });
      return;
    }

    // Rows rejected by the delivery gate are recipients too. Give each one
    // durable, linked evidence before the queue or direct-send halves begin.
    for (const rec of request.recipients) {
      const row = outcomes.get(rec.target.paneId);
      if (row?.kind !== "skipped") continue;
      if (!recordUnattemptedRecipient(deps.receipts, childOf(parent, rec), {
        state: "not-sent",
        reason: "undeliverable",
        code: row.code,
        why: "the delivery gate refused this recipient before the transport",
      })) {
        deps.log(`broadcast: receipt for skipped session=${rec.target.sessionId} was not recorded`);
      }
    }

    deps.log(
      `broadcast: RUN asked=${asked} send=${deliverable.length} queue=${queueable.length} chars=${rendered.text.length} receipt=${parent.receiptId}`,
    );

    /* **THE QUEUE HALF GOES FIRST, and the order is a decision.** Enqueueing is
       a few map writes and cannot block; the sends are `execFileSync` tmux calls
       that may each take ten seconds and may hit the deadline. Doing the slow
       half first would let a deadline swallow the fast half for no benefit —
       the working sessions would lose a line that cost nothing to store.

       **AND A HELD SESSION IS STILL QUEUED FOR, DELIBERATELY.** A hold stops
       delivery at `SteeringQueue.next()`, not at enqueue: the item waits and
       goes out when somebody releases the hold. Refusing here would throw
       away a line because of a fault in a different send. That is why nothing
       in this loop asks the quarantine book — the half that must ask is the
       fan-out below, and it asks through the coordinator. */
    const enqueue = deps.enqueue;
    if (enqueue !== null) {
      for (const rec of queueable) {
        const where = { sessionId: rec.target.sessionId, paneId: rec.target.paneId };
        /* **`request.text`, THE RAW LINE — NOT `rendered.text`.** The queue
           stores what it is given and the drain renders the speaker's prefix at
           delivery, so handing it an already-prefixed string prefixes it twice
           and the agent reads "Greg says: Greg says: …". The send path above is
           the opposite case and takes the rendered one, because `sendMessage`
           renders nothing. */
        const result = enqueue(
          { sessionId: rec.target.sessionId, claudeSessionId: rec.target.claudeSessionId },
          request.text,
          request.speaker,
          parent.receiptId,
        );
        if (result.ok) {
          /* **`durable` IS CARRIED, NEVER ASSUMED** (F36): an item whose receipt
             lives only in memory is one a restart forgets, and the row says so. */
          deps.log(
            `broadcast: QUEUED session=${rec.target.sessionId} position=${result.position} receipt=${result.receiptId}` +
              (result.durable ? "" : " NOT DURABLE"),
          );
          outcomes.set(rec.target.paneId, { ...where, kind: "queued", position: result.position, durable: result.durable });
          continue;
        }
        /* **`bad-text` IS ONE TRUTH, NOT ONE PER RECIPIENT**, and it ends the
           whole broadcast here. It is a fact about the message — the queue's own
           `checkText` and `renderMessage` refused it — so it will fail
           identically for every session, and rendering twenty identical rows
           would report one problem twenty times.

           Ending here is clean rather than lucky: this loop runs BEFORE the
           fan-out, so nothing has been typed at anybody yet. And the cooldown is
           handed back, because a broadcast that sent nothing must not lock the
           fleet out for ten minutes — safe to do because nothing between taking
           it and here awaits, so no second request can have seen it. */
        if (result.rule === "bad-text") {
          lastBroadcastAt = cooldownWas;
          settleReceipt(parent.receiptId, {
            state: "not-sent",
            reason: "undeliverable",
            code: "bad-text",
            why: "the queue refused the message itself before anything was sent or queued",
          });
          deps.log(`broadcast: refused code=bad-text why=${oneLine(result.why)}`);
          respond(res, 400, { ok: false, code: "bad-text", why: result.why, ...tag });
          return;
        }
        deps.log(`broadcast: queue refused session=${rec.target.sessionId} rule=${result.rule}`);
        if (!recordUnattemptedRecipient(deps.receipts, childOf(parent, rec), {
          state: "not-sent",
          reason: "undeliverable",
          code: `not-queued-${result.rule}`,
          why: "the queue refused this recipient before anything was queued",
        })) {
          deps.log(`broadcast: receipt for queue-refused session=${rec.target.sessionId} was not recorded`);
        }
        outcomes.set(rec.target.paneId, {
          ...where,
          kind: "skipped",
          code: `not-queued-${result.rule}`,
          why: result.why,
        });
      }
    }

    try {
      await fanOut(deliverable, render, at, outcomes, parent);
    } catch (e) {
      /* A throw is a bug, not a crash: this process is alive to say the fan-out
         did not finish. (A crash is concluded `interrupted` at the next start.) */
      settleReceipt(parent.receiptId, {
        state: "outcome-unknown",
        reason: "threw",
        code: null,
        why: "the fan-out threw part-way; each recipient's own receipt says how far it got",
      });
      throw e;
    }
    const rows = ordered(request, outcomes);
    const counts = countOf(rows, asked);
    /* **A RUN THAT REACHED NOBODY HANDS THE COOLDOWN BACK.** GPT Sol's P2: a
       queue-only broadcast whose every enqueue was refused — session full, fleet
       full, double-tap — answered 200 and held the fleet for ten minutes having
       done nothing at all. The cooldown is there to stop the fleet being
       interrupted twice, and nothing that interrupted nobody has spent it. A
       fan-out whose every recipient turned out to be HELD is the same case and
       comes out the same way: the transport was not reached once, so no agent
       was interrupted and the fleet is not locked out for ten minutes.

       Safe at this point for the same reason the `bad-text` rollback is: the
       only thing that can have moved `lastBroadcastAt` since we took it is
       another request, and one arriving during the awaits above would have been
       refused by the cooldown we are about to release rather than setting it. */
    if (counts.submitted === 0 && counts.queued === 0) {
      lastBroadcastAt = cooldownWas;
      deps.log("broadcast: cooldown returned — nothing was submitted and nothing was queued");
    }
    deps.log(
      `broadcast: done asked=${counts.asked} submitted=${counts.submitted} queued=${counts.queued} ` +
        `skipped=${counts.skipped} held=${counts.held} notReached=${counts.notReached}`,
    );

    /* THE PARENT IS ONLY AS CERTAIN AS ITS CHILDREN. Missing, non-durable,
       pending-direct or unknown evidence makes it unknown too; its `why`
       carries text-free counts. */
    settleReceipt(parent.receiptId, broadcastParentOutcome(deps.receipts, parent.receiptId, asked));
    respond(res, 200, { ok: true, op: "broadcast", result: { counts, recipients: rows }, ...tag });
  }

  return {
    handle(req, res) {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (path !== "/api/broadcast") return false;
      if (req.method !== "POST") {
        // A GET at this URL is a link somebody sent, or a browser prefetching.
        // Neither may type into a fleet.
        respond(
          res,
          405,
          { ok: false, code: "method-not-allowed", why: "broadcasting is POST only" },
          { allow: "POST" },
        );
        return true;
      }
      // Floating on purpose: `handler` in server.ts is synchronous, `run`
      // cannot reject, and there is nothing to await. Same shape as
      // `handleSteerRequest`. The `catch` is for a bug, not for a refusal.
      void run(req, res).catch((e: unknown) => {
        deps.log(`broadcast: FAILED ${oneLine((e as Error).message)}`);
      });
      return true;
    },
  };
}

/**
 * The mounted route, built once, on first use rather than at import.
 *
 * Lazy because the cooldown is state, and a module-scope instance would be
 * built by anything that so much as imports a type from here. NO IMPORT SIDE
 * EFFECTS is the rule the rest of this directory keeps.
 */
let shared: BroadcastRoutes | null = null;

export function handleBroadcastRequest(req: IncomingMessage, res: ServerResponse): boolean {
  shared ??= makeBroadcastRoutes({ enqueue: enqueueSharedMessage });
  return shared.handle(req, res);
}
