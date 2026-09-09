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
 * ## Three piles, and `drainGate` makes all three cuts
 *
 * Nothing here decides who may be typed into. `drainGate` (queue.ts) does, and
 * it asks `steerableStatus` (steer.ts), so a shell — where the text would be
 * EXECUTED — and a Claude that has exited fall out carrying **their** sentence
 * rather than one written in this file.
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
 * this fan-out did about the row — attempted, queued, skipped, not-reached —
 * and, on `attempted` only, the steer route's own response embedded whole.**
 * Scheduling above, delivery below, and only the lower half has a delivery
 * reading in it. Folding `working` and `deadline` into `{ok:false, delivery:
 * "none"}` — which is what this file did first — is inventing a second
 * vocabulary while claiming not to. See `BroadcastRecipient`.
 *
 * ## IT MUST NOT HOLD THE SERVER'S ONLY THREAD
 *
 * `sendMessage` is synchronous — three `execFileSync` tmux calls with ten-second
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
import { sharedQuarantineBook, type QuarantineBook, type UncertainSendReading } from "./quarantine.js";
import { drainGate, nothingWasSent, type EnqueueRefusalRule } from "./queue.js";
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
import { describeSend, sendMessage as realSendMessage, type SteerResult, type SteerTarget } from "./steer.js";
import type { FleetStatus } from "./status.js";
import type { Delivery } from "./wire.js";

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
  /** Working, so it went in that session's queue and drains at its next prompt. */
  | { kind: "queued"; position: number }
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
    }
  | {
      ok: false;
      code: string;
      why: string;
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
    ) =>
      | { ok: true; position: number }
      /**
       * `rule` travels because two of its arms want opposite handling in a
       * fan-out. `bad-text` is a fact about the MESSAGE and will fail
       * identically for every recipient — twenty rows saying it is one truth
       * reported twenty times — while a queue cap or the double-tap window is a
       * fact about that recipient. See `enqueueSharedMessage`'s comment.
       */
      | { ok: false; rule: EnqueueRefusalRule; why: string });

export type BroadcastDeps = {
  sendMessage: typeof realSendMessage;
  now: () => number;
  log: (line: string) => void;
  /** The one book of per-session holds. See the fan-out's hold comment. */
  quarantine: QuarantineBook;
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
    sendMessage: realSendMessage,
    now: () => Date.now(),
    log: (line) => console.log(line),
    quarantine: sharedQuarantineBook(),
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
  ): Promise<void> {
    const total = deliverable.length;
    for (let index = 0; index < total; index += 1) {
      const rec = deliverable[index];
      if (rec === undefined) continue;
      const where = { sessionId: rec.target.sessionId, paneId: rec.target.paneId };

      /* CHECKED BEFORE EACH SEND, not after: the point is to stop before
         spending another ten seconds, not to notice afterwards that we did. */
      if (deps.now() - startedAt > BROADCAST_DEADLINE_MS) {
        into.set(rec.target.paneId, {
          ...where,
          kind: "not-reached",
          why: `the fan-out ran past ${Math.round(BROADCAST_DEADLINE_MS / 1000)}s and stopped before reaching this session — nothing was sent to it and nothing was queued for it`,
        });
        continue;
      }
      if (index > 0) await deps.yieldToLoop();

      /**
       * **A PRODUCER OF AMBIGUOUS SENDS, AND IT IS THE SAME BOOK AS THE OTHERS.**
       *
       * A `partial` or `unknown` means the literal text may be sitting in that
       * agent's input box with no Enter behind it. `drain.ts` already refuses to
       * retry such a send; what nothing stops without this is the NEXT queued
       * item draining onto the end of it, so the agent reads one instruction
       * neither person wrote. `quarantine.ts` is the leaf every producer reaches.
       *
       * `what` describes the payload and never contains a word of it.
       */
      const hold = (reading: UncertainSendReading): void => {
        const opened = deps.quarantine.hold({
          sessionId: rec.target.sessionId,
          paneId: rec.target.paneId,
          claudeSessionId: rec.target.claudeSessionId,
          reading,
          origin: "broadcast",
          what: `broadcast (${render(index, total).length} characters)`,
        });
        deps.log(
          `broadcast: HELD session=${rec.target.sessionId} hold=${opened.id} v${opened.version} reading=${reading}`,
        );
      };

      let result: SteerResult;
      try {
        /* RENDERED HERE, ONE LINE ABOVE THE SEND — not above the loop and not
           in the parse. A staggered sentence names a wall-clock time, and a
           fan-out that sat behind thirty ten-second tmux calls would otherwise
           promise the last recipient a moment that has already passed. Free text
           does not need this; the caller that this loop is meant to absorb does,
           and building the seam anywhere else would be building it wrong. */
        result = deps.sendMessage(rec.target, render(index, total), rec.declaredStatus);
      } catch (e) {
        /* A THROW IS THE CASE WITH THE LEAST EVIDENCE BEHIND IT: the call may
           have thrown before the first keystroke or out of the middle of the
           sequence, and nothing here can tell. That is the reason to hold, not
           a reason to assume the first. */
        hold("threw");
        const why = `the delivery module threw: ${(e as Error).message}`;
        deps.log(`broadcast: FAILED session=${rec.target.sessionId} ${oneLine(why)}`);
        into.set(rec.target.paneId, {
          ...where,
          kind: "attempted",
          attempt: { status: 500, ok: false, code: "internal", why, delivery: "unknown" },
        });
        continue;
      }

      if (!result.ok) {
        /* **ASKED OF `nothingWasSent`, NOT OF `result.delivery`.** That function
           is the one audited place that reads both halves — the summary and the
           list of tmux calls that completed — and a `delivery: "none"` with a
           non-empty list is a self-contradicting report whose honest reading is
           that something went out. Comparing the summary here would be a second
           opinion, and the more confident of the two. */
        if (nothingWasSent(result) === null) {
          hold(
            result.delivery === "partial" ? "partial" : result.delivery === "unknown" ? "unknown" : "none-contradicted",
          );
        }
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
        case "not-reached":
          notReached += 1;
          break;
        default:
          break;
      }
    }
    return { asked, submitted, queued, skipped, notReached };
  }

  /** Everything the page asked about, in the page's order, and nothing invented. */
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

    /* **THREE PILES, AND `drainGate` MAKES ALL THREE CUTS.** It is the queue's
       rule and it asks `steerableStatus`, so a shell — where the text would be
       EXECUTED — and a Claude that has exited fall out here carrying THEIR
       sentence rather than one written in this file.

       `later` is the interesting one. A working session cannot usefully be typed
       at — keystrokes into a busy Claude do not queue themselves anywhere — but
       that is an argument for putting the line in its QUEUE, not for dropping
       it. On this box most sessions are working most of the time, so a fan-out
       that silently omitted them would reach a third of the fleet while calling
       itself a broadcast to all agents. GPT Sol's C, and it was right. */
    const outcomes = new Map<string, BroadcastRecipient>();
    const deliverable: Recipient[] = [];
    const queueable: Recipient[] = [];
    for (const rec of request.recipients) {
      const where = { sessionId: rec.target.sessionId, paneId: rec.target.paneId };
      const gate = drainGate(rec.declaredStatus);
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

    deps.log(
      `broadcast: RUN asked=${asked} send=${deliverable.length} queue=${queueable.length} chars=${rendered.text.length}`,
    );

    /* **THE QUEUE HALF GOES FIRST, and the order is a decision.** Enqueueing is
       a few map writes and cannot block; the sends are `execFileSync` tmux calls
       that may each take ten seconds and may hit the deadline. Doing the slow
       half first would let a deadline swallow the fast half for no benefit —
       the working sessions would lose a line that cost nothing to store. */
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
        );
        if (result.ok) {
          deps.log(`broadcast: QUEUED session=${rec.target.sessionId} position=${result.position}`);
          outcomes.set(rec.target.paneId, { ...where, kind: "queued", position: result.position });
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
          deps.log(`broadcast: refused code=bad-text why=${oneLine(result.why)}`);
          respond(res, 400, { ok: false, code: "bad-text", why: result.why });
          return;
        }
        deps.log(`broadcast: queue refused session=${rec.target.sessionId} rule=${result.rule}`);
        outcomes.set(rec.target.paneId, {
          ...where,
          kind: "skipped",
          code: `not-queued-${result.rule}`,
          why: result.why,
        });
      }
    }

    await fanOut(deliverable, render, at, outcomes);
    const rows = ordered(request, outcomes);
    const counts = countOf(rows, asked);
    deps.log(
      `broadcast: done asked=${counts.asked} submitted=${counts.submitted} queued=${counts.queued} ` +
        `skipped=${counts.skipped} notReached=${counts.notReached}`,
    );

    respond(res, 200, { ok: true, op: "broadcast", result: { counts, recipients: rows } });
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
