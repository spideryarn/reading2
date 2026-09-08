/**
 * v0.5f of the fleet dashboard: the caller `SteeringQueue` was built for.
 *
 * **THE QUEUE HAD NO DRAIN, AND THAT IS THE BUG THIS FILE IS.** `queue.next()`
 * was called from one test and from nowhere in the product: items were
 * accepted, rendered, cancelled, and thirty minutes later dropped as stale. A
 * button that says *queued* and means *never* is worse than no button, because
 * the person who pressed it goes away — `docs/reusable/silent-success.md`
 * arriving inside the product rather than inside a check.
 * docs/plans/260907e-agent-fleet-dashboard.md § Stage v0.5f.
 *
 * WHAT THIS IS. One pass over the fresh snapshot, delivering **at most one item
 * per session**, called from `server.ts`'s refresh loop after a successful
 * collection — and after that collection has already been published, so nothing
 * the page shows waits on a keystroke. It closes the seam the queue was written
 * around — `next()` says whether there is anything to send, `sendMessage` sends
 * it, `settle()` (or `release()`) closes the lease — and it adds no policy of
 * its own: every refusal here is `deliveryGate`'s or `steer.ts`'s, asked rather
 * than restated.
 *
 * WHY ONE ITEM PER SESSION PER PASS, AND NO RATE LIMITER. A pass happens when a
 * collection succeeds. **The real cadence is ~73 seconds, not 60**: the
 * collection itself takes about 13 seconds and the loop then waits 60 from the
 * end of it, so eight queued items take about ten minutes to drain, not eight.
 * (The design doc said 60 and was wrong; the number matters because it is what
 * somebody will compare against `MIN_INTERVAL_MS`.) Either way it is far inside
 * the limiter's window, and spending a limiter token here would let the drain
 * push a *person's* own urgent message further away — the enqueue path's Sol
 * F18 pointing backwards. The gap is the feature: the point of the queue is
 * that an agent gets a turn between instructions.
 *
 * SYNCHRONOUS, BECAUSE `sendMessage` IS — AND THAT IS WHY IT IS BOUNDED TWICE.
 * `sendMessage` runs up to six `execFileSync` calls with ten-second timeouts
 * each (three identity checks, a capture, two `send-keys`), so one item is ~60
 * seconds of worst case and this process has one thread, which also serves the
 * page, the stream and every route. **A `Promise.race` cannot bound it** — the
 * timer cannot fire while the event loop is blocked — so the only honest bound
 * is to send fewer things: `MAX_SENDS_PER_PASS` and `DRAIN_BUDGET_MS`, both
 * checked BETWEEN sends. Sol's answer was a child process, which is right and
 * is a bigger change than this stage should carry.
 *
 * **AND IT IS WHY THERE IS NO PER-PANE LOCK.** Two passes cannot overlap
 * because a pass never yields, so nothing else can lease the item this one is
 * delivering. That is load-bearing rather than lucky: **the day any part of
 * this becomes `async`, a per-pane mutex has to arrive in the same commit**, or
 * two overlapping passes will interleave keystrokes into one input box.
 *
 * THE ROW IS THE ADDRESS AND THE ITEM IS THE CLAIM. Everything the send is
 * aimed at comes from the row the collector has just produced — `paneId`,
 * `id` (the tmux SESSION handle), `claudeSessionId`, `panePid` — and the item
 * only says which conversation it was queued *for*. `next()` compares the two
 * and refuses `orphaned` when the pane has been resumed into a different
 * conversation since; `steer.ts` then re-checks the whole address against the
 * live box in the moment before the keys go out. Nothing here trusts a stored
 * address, because a stored address is how the right text reaches the wrong
 * session.
 *
 * NO KEYSTROKE IS EVER RETRIED. A throw leaves the lease open for a person; a
 * refusal that reached the pane settles and is gone. The single exception is a
 * refusal the transport says sent NOTHING, which goes back to the head of its
 * queue through `queue.release` — not a retry, because there was no attempt.
 * That distinction is argued in queue.ts's header next to the rule it bends,
 * and without it the commonest refusal on this box destroys the person's
 * message rather than delaying it.
 *
 * THE GENERATION IS CHECKED FIRST. `FleetSnapshot.tmuxServerPid` is the tmux
 * server every `$…` and `%…` in the rows belongs to; a restart re-issues those
 * handles to different sessions. So the whole snapshot is passed in, not just
 * its rows, and a snapshot that cannot say which server it read refuses to
 * deliver at all — "we could not tell which tmux server this is" is not
 * permission to type into it.
 *
 * NO CLOCK, NO TRANSPORT, NO IMPORT SIDE EFFECTS. `now`, `sendMessage`, `log`
 * and the queue are all injected, matching queue.ts and routes-actions.ts, so a
 * test drives the whole pass with fabricated rows and no tmux. There are ~35
 * live agent sessions on this box doing other people's work.
 */
import { renderMessage, renderSpoken, type SpokenAction } from "./actions.js";
import type { FleetRow, FleetSnapshot } from "./collect.js";
import { nothingWasSent, type QueuedItem, type SteeringQueue } from "./queue.js";
import type { RefusalCode, SteerTarget, sendMessage as realSendMessage } from "./steer.js";

/**
 * THE TWO BOUNDS, AND THE ARITHMETIC THEY ARE CHOSEN BY.
 *
 * One `sendMessage` is up to six `execFileSync` calls at a ten-second timeout
 * each, so ~60 seconds of worst case, and it cannot be interrupted: while it
 * blocks, this process serves nothing. Unbounded, a fleet where everybody has
 * something queued is 36 × 60 seconds ≈ 36 minutes of dead dashboard.
 *
 * Bounded at three sends and a five-second budget CHECKED BETWEEN ROWS, the
 * worst case is `budget + one send` — a send already under way is never
 * abandoned, because there is no way to abandon one — which is roughly 5 + 60 =
 * 65 seconds against a refresh interval of 60. That is survivable and it is
 * honest: a bad pass delays the next collection by about one cycle rather than
 * stopping the loop. In the ordinary case a send is milliseconds and neither
 * bound is reached.
 *
 * Rows past either bound are reported held with `out-of-time` rather than
 * skipped in silence, and they are first in line next pass. Nothing is lost.
 */
export const MAX_SENDS_PER_PASS = 3;
export const DRAIN_BUDGET_MS = 5_000;

/**
 * WHERE THE PASS STARTS, AND WHY IT IS NOT ALWAYS THE TOP OF THE SNAPSHOT.
 *
 * `MAX_SENDS_PER_PASS` is what stops the page hanging, and a slot is spent by
 * an ATTEMPT rather than by a delivery — a refused send costs the same six
 * `execFileSync` timeouts as a delivered one. Walk the rows in the same order
 * every pass and those two facts combine into starvation: three sessions whose
 * sends are refused-unsent go back to the head of their own queues, are
 * candidates again next pass, and spend all three slots again, so a fourth row
 * is **never attempted at all** until its item goes stale at thirty minutes.
 * That is this stage's own bug arriving one level up — a page that says
 * *queued* about something nothing will ever try. GPT Sol's D1, 2026-09-08.
 *
 * So the pass remembers the last row it spent a slot on and the next one starts
 * AFTER it, wrapping. Every queued row then gets a turn within a bounded number
 * of passes, and the send bound is untouched.
 *
 * **THE STATE IS INJECTED, NOT A MODULE-LEVEL `let`.** `drainOnce` is otherwise
 * a pure function of `(snapshot, deps)`, and a module-level cursor would be
 * shared by every test in a file — the shape that made the original hole
 * invisible to the suite, and the same reason `SteeringQueue` is a class rather
 * than a module of `Map`s. One of these is built beside the queue in
 * `makeActionRoutes`, so it lives exactly as long as the queue it rotates over
 * and there is exactly one per server.
 */
export type DrainCursor = {
  /** The session the previous pass stopped after, or null before the first one. */
  after(): string | null;
  /** Called for every row that spends a send slot, whatever the outcome. */
  advanceTo(sessionId: string): void;
};

export function createDrainCursor(): DrainCursor {
  let last: string | null = null;
  return {
    after: () => last,
    advanceTo: (sessionId) => {
      last = sessionId;
    },
  };
}

/**
 * The rows, beginning after the cursor.
 *
 * A cursor naming a session that is no longer in the snapshot falls back to the
 * top rather than to nothing: a session can end between passes, and "the row I
 * stopped after has gone" is not a reason to deliver nothing at all.
 */
function rotated(rows: readonly FleetRow[], after: string | null): FleetRow[] {
  if (after === null) return [...rows];
  const at = rows.findIndex((r) => r.id === after);
  if (at < 0) return [...rows];
  return [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
}

export type DrainDeps = {
  /** The one queue per server. It MUST be the one the routes filled. */
  queue: SteeringQueue;
  /** Where this pass starts. State, owned by whoever owns the queue — see above. */
  cursor: DrainCursor;
  /**
   * The delivery module, injected so this file's tests prove what it passes
   * down without a single keystroke going out.
   */
  sendMessage: typeof realSendMessage;
  log: (line: string) => void;
  /** Injected, always. There is no `Date.now()` below. */
  now: () => number;
};

/**
 * Why a pass sent nothing to a session, in machine-readable form.
 *
 * Six of these are `NextResult`'s own arms, named the same so nobody has to
 * translate; the other three are this file's, and each one is a thing the queue
 * cannot know about because it never sees a row.
 */
export type DrainHoldReason =
  /** An earlier pass leased something and it has not been settled yet. */
  | "in-flight"
  /** A lease nobody settled. It waits for a person; it is NOT retried. */
  | "stuck"
  /** The pane holds a different conversation now. */
  | "orphaned"
  /** It has waited past `maxAgeMs`. `revive()` re-arms it, and only a person may. */
  | "stale"
  /** The session is working — `drainGate`'s `later` arm, and the reason the queue exists. */
  | "held"
  /** This session cannot be typed into at all, in steer.ts's words. */
  | "blocked"
  /** The row has no pane handle, so there is no address to send to. */
  | "no-pane"
  /** The row has no conversation uuid, so nothing can be matched against the item's. */
  | "no-conversation"
  /** The snapshot could not say which tmux server it read, so no handle means anything. */
  | "no-generation"
  /** The pass ran out of its budget, or its send count, before reaching this row. */
  | "out-of-time";

/**
 * What happened to one session in one pass.
 *
 * A union rather than a record of optionals, so that reading a refusal's code
 * forces you to have established that it *was* a refusal: `delivered` has no
 * code, `held` has no item id when nothing was at the head, and `threw` carries
 * the one fact that matters about it — the lease is still open.
 *
 * **`what` and `why` never contain a word of what was said.** These strings are
 * logged, and steer.ts's header promises that the messages people send their
 * agents do not reach a log. A message is described by its length.
 */
export type DrainOutcome =
  | { kind: "delivered"; sessionId: string; itemId: string; what: string }
  /** The transport refused AFTER something may have reached the pane. Gone; never retried. */
  | { kind: "refused"; sessionId: string; itemId: string; code: RefusalCode; why: string }
  /**
   * The transport refused having provably sent NOTHING, so the item is back at
   * the head of its queue and will be tried again next pass. The distinction
   * from `refused` is the whole of `queue.release` — see it, and the header
   * paragraph it sits under.
   */
  | { kind: "put-back"; sessionId: string; itemId: string; code: RefusalCode; why: string }
  /** The queue held something this pass can never deliver. Settled, not left to rot. */
  | { kind: "undeliverable"; sessionId: string; itemId: string; why: string }
  | { kind: "held"; sessionId: string; itemId: string | null; reason: DrainHoldReason; why: string }
  /** The send threw. **The lease is deliberately left open** — see `deliverOne`. */
  | { kind: "threw"; sessionId: string; itemId: string | null; why: string };

export type DrainResult = {
  /** Rows in the snapshot. */
  rows: number;
  /** Rows with something in their queue, which are the only ones `next()` was asked about. */
  considered: number;
  /**
   * The tmux server the snapshot belonged to, or null — in which case nothing
   * was delivered at all, and every considered row is held `no-generation`.
   */
  generation: number | null;
  /** How many waiting items `noteGeneration` invalidated on this pass. Nearly always 0. */
  invalidated: number;
  outcomes: DrainOutcome[];
};

/** A payload, as a sendable line — or a reason it can never be one. */
type Sendable = { ok: true; text: string; what: string } | { ok: false; why: string };

/**
 * The words to type, from the payload.
 *
 * **THERE IS NO `enacted` ARM AND THERE CANNOT BE ONE.** `QueuedPayload`'s
 * action is a `SpokenAction`, so an action that runs commands rather than
 * typing a sentence is not merely refused at the door — it cannot be
 * represented as a queued item, and a `case "enacted":` here would not compile.
 * That is the boundary being structural rather than remembered, and it is why
 * this function still returns a `Sendable` union with a failure arm it never
 * takes today: the arm is what the `never` below hands the failure to.
 *
 * The `never` is the load-bearing line. Widen `QueuedPayload` back to `Action`,
 * or add a fourth `effect`, and this stops compiling — so somebody decides
 * whether the drain may deliver it, rather than inheriting a yes or, worse, a
 * silent no.
 */
function sendable(item: QueuedItem): Sendable {
  const payload = item.payload;
  if (payload.kind === "message") {
    // RENDERED HERE, at the moment of the send, from the speaker the item has
    // carried since the request. Everything a person or a coordinator says to
    // one session comes through this function, so this is the line that decides
    // whether the agent can tell whose instruction it is reading.
    const rendered = renderMessage(payload.text, item.speaker);
    if (!rendered.ok) return { ok: false, why: rendered.why };
    return { ok: true, text: rendered.text, what: `message (${payload.text.length} characters)` };
  }
  const action = payload.action;
  // The annotation is the guard, and it is where the compile error lands: widen
  // `QueuedPayload` back to `Action` and this line stops compiling, because
  // `Action["effect"]` is not assignable to `SpokenAction["effect"]`. The
  // `never` below then catches the other direction — a fourth effect added to a
  // union this one is drawn from.
  const effect: SpokenAction["effect"] = action.effect;
  switch (effect) {
    case "spoken":
      // The action's OWN words, which is the whole reason `SpokenAction.text`
      // exists as a reviewed sentence rather than being assembled from a label,
      // behind the line that says who is asking for them. `renderSpoken` keeps
      // the one named exception: a slash command must be first on the line.
      return { ok: true, text: renderSpoken(action, item.speaker), what: `action ${action.id}` };
    default: {
      const never: never = effect;
      return { ok: false, why: `'${String(never)}' is not something the drain knows how to type` };
    }
  }
}

/** `NextResult`'s non-ready arms, as a hold reason. Kept next to the union it mirrors. */
function held(sessionId: string, reason: DrainHoldReason, item: QueuedItem | null, why: string): DrainOutcome {
  return { kind: "held", sessionId, itemId: item?.id ?? null, reason, why };
}

/**
 * One session, one item, one pass.
 *
 * Split out from the loop so that the ordering below — build the address, send,
 * settle — is readable in one screen, and so the `try` around the send has
 * nothing else inside it.
 */
function deliverOne(row: FleetRow, address: { paneId: string; claudeSessionId: string }, item: QueuedItem, deps: DrainDeps): DrainOutcome {
  const words = sendable(item);
  if (!words.ok) {
    // Settled `refused` rather than left leased: it will never become
    // deliverable, so leaving it would be exactly the promise this stage exists
    // to stop making.
    deps.queue.settle(row.id, item.id, "refused");
    return { kind: "undeliverable", sessionId: row.id, itemId: item.id, why: words.why };
  }

  // BUILT FROM THE ROW, not from the item and not from anything a browser sent.
  // `row.id` is the tmux SESSION handle (`$1643`) and `row.paneId` is the PANE
  // handle (`%2108`) — different things, and getting them the wrong way round
  // is the classic error here. `panePid` is spread conditionally because it is
  // optional under `exactOptionalPropertyTypes` and an explicit `undefined` is
  // a different thing from an absent field; steer.ts degrades to "no respawn
  // check" when it is absent rather than refusing the row.
  // The conversation is the ROW's — the one the collector has just observed in
  // that pane — not the one stored on the item. `next()` has already refused
  // the case where they differ (`orphaned`), so they are equal here; taking it
  // from the row means every field of the address came from one observation of
  // the box rather than three quarters of one and a quarter of a memory.
  const target: SteerTarget = {
    paneId: address.paneId,
    sessionId: row.id,
    claudeSessionId: address.claudeSessionId,
    ...(row.panePid === null ? {} : { panePid: row.panePid }),
  };

  let result: ReturnType<typeof realSendMessage>;
  try {
    result = deps.sendMessage(target, words.text, row.status);
  } catch (e) {
    // **NEITHER SETTLED NOR REQUEUED, AND THAT IS DELIBERATE.** A throw is the
    // one outcome where nothing here can tell a request that died before the
    // keystrokes from one that died after — the message may be in that agent's
    // input box already. So the lease stays open, `next()` reports it as
    // in-flight and then `stuck`, and a person decides with
    // `settle(…, "abandoned")`. Requeueing it would be an automatic retry of a
    // keystroke, which queue.ts's header forbids for exactly this reason, and
    // settling it `refused` would claim knowledge we do not have. A later
    // reader will be tempted to "fix" this line; this is why it is not broken.
    return { kind: "threw", sessionId: row.id, itemId: item.id, why: `the delivery module threw: ${(e as Error).message}` };
  }

  if (result.ok) {
    deps.queue.settle(row.id, item.id, "delivered");
    return { kind: "delivered", sessionId: row.id, itemId: item.id, what: words.what };
  }
  // THE TWO KINDS OF REFUSAL, AND THE DIFFERENCE IS THE WHOLE OF P0-1.
  //
  // When the transport says it sent NOTHING — `delivery: "none"` with an empty
  // `sent` — the item goes back to the head of its queue. That is not a retry
  // of a keystroke; there was no keystroke. It matters because the commonest
  // refusal here is `pane-is-asking`: the row said idle, and in the thirteen
  // seconds since the collection the agent opened a dialog. Settling that
  // `refused` would DESTROY the person's instruction — one item per pass, at
  // exactly the moment they most wanted it delivered — and the queue's own gate
  // cannot close the window because the window is the collection's own age.
  //
  // `partial` and `unknown` are the ambiguous arms: something may be sitting in
  // that agent's input box unsent. Those settle and are gone, which is the
  // never-retry rule doing its job.
  const unsent = nothingWasSent(result);
  if (unsent) {
    deps.queue.release(row.id, item.id, unsent);
    return { kind: "put-back", sessionId: row.id, itemId: item.id, code: result.reason.code, why: result.reason.why };
  }
  deps.queue.settle(row.id, item.id, "refused");
  return { kind: "refused", sessionId: row.id, itemId: item.id, code: result.reason.code, why: result.reason.why };
}

/**
 * One delivery pass over a fresh snapshot.
 *
 * **THE WHOLE SNAPSHOT, NOT ITS ROWS**, because `tmuxServerPid` is what makes
 * every `$…` and `%…` in those rows mean anything: a tmux restart re-issues
 * both handles together, and a `panePid` is optional while a resumed
 * conversation can carry the same uuid — so the generation is the only thing
 * that closes the chain. It is the first thing this function looks at.
 *
 * Every row is wrapped, because **one row throwing must not stop the others
 * draining** — thirty-five sessions' instructions should not be lost to one
 * malformed row — and because this runs inside the refresh loop, where an
 * escaping exception used to cost the collection.
 */
export function drainOnce(snapshot: FleetSnapshot, deps: DrainDeps): DrainResult {
  const rows = snapshot.rows;
  const outcomes: DrainOutcome[] = [];
  const startedAt = deps.now();
  let considered = 0;
  let sends = 0;

  // A NULL GENERATION REFUSES TO DELIVER AT ALL. `tmuxServerPid` is null when
  // the collector could not ask which tmux server it was reading, and "we could
  // not tell" has never been permission to act on this box — it is the reading
  // status.ts, steer.ts and collect.ts all refuse to fold into a yes. The items
  // stay queued, marked held, and go out on the next pass that can say.
  const generation = snapshot.tmuxServerPid;
  if (generation === null) {
    for (const row of rows) {
      if (deps.queue.size(row.id) === 0) continue;
      considered += 1;
      outcomes.push(held(row.id, "no-generation", null, "this collection could not say which tmux server it read, so no session handle in it can be trusted to mean what it meant"));
    }
    return { rows: rows.length, considered, generation: null, invalidated: 0, outcomes };
  }
  // Before anything is leased. A restart makes every waiting item undeliverable
  // at once, and they are marked rather than dropped so the page can say so.
  const invalidated = deps.queue.noteGeneration(generation);
  if (invalidated > 0) {
    deps.log(`drain: tmux server is ${generation} now — ${invalidated} queued item(s) can no longer be delivered and are marked on the page`);
  }

  // NOT `rows` — see `DrainCursor`. The first pass of a server's life reads
  // exactly like the snapshot; every later one begins after the row the
  // previous pass last spent a send slot on.
  for (const row of rotated(rows, deps.cursor.after())) {
    try {
      // `size()` rather than `next()` for the empty case: a fleet of thirty-six
      // rows is mostly rows with nothing queued, and `next()` is also what
      // LEASES. It is not merely a cost saving — see the `paneId` check below,
      // which must happen before anything can be leased.
      if (deps.queue.size(row.id) === 0) continue;
      considered += 1;

      // BOTH BOUNDS, CHECKED BETWEEN ROWS — never inside a send, because a
      // synchronous `execFileSync` cannot be interrupted by anything. So the
      // worst case is the budget plus one send, and the arithmetic for that is
      // on the constants.
      if (sends >= MAX_SENDS_PER_PASS) {
        outcomes.push(held(row.id, "out-of-time", null, `this pass has already delivered ${MAX_SENDS_PER_PASS} items, which is its limit; this one goes next pass`));
        continue;
      }
      if (deps.now() - startedAt > DRAIN_BUDGET_MS) {
        outcomes.push(held(row.id, "out-of-time", null, `the pass ran out of its ${DRAIN_BUDGET_MS}ms budget before reaching this row`));
        continue;
      }

      // BEFORE `next()`, so nothing is leased that cannot be sent. A row with
      // no pane handle has no address — `paneId` is a join against a separate
      // pane listing and can be transiently null on a live session — and
      // leasing an item we then cannot deliver would make it `stuck`, which
      // only a person can clear, over a row that will very likely have a pane
      // again in sixty seconds.
      const paneId = row.paneId;
      if (paneId === null) {
        outcomes.push(held(row.id, "no-pane", null, "the collector could not resolve this session's pane, so there is no address to send to"));
        continue;
      }
      // Same reasoning. `next()` needs a conversation to compare the item's
      // against, and a row without one cannot supply it; the honest answer is
      // to wait rather than to invent a match.
      const claudeSessionId = row.claudeSessionId;
      if (claudeSessionId === null) {
        outcomes.push(held(row.id, "no-conversation", null, "the collector could not name the conversation in this pane, so nothing can be matched against what was queued"));
        continue;
      }

      const next = deps.queue.next(row.id, { status: row.status, claudeSessionId });
      switch (next.kind) {
        case "empty":
          // Something was there when `size()` was asked and is not now. Not
          // possible today (this is single-threaded), and not worth a special
          // case if it becomes possible: the next pass is a minute away.
          break;
        case "in-flight":
          outcomes.push(held(row.id, "in-flight", next.item, next.why));
          break;
        case "stuck":
          // Worth a log line of its own: a stuck lease blocks its session's
          // queue and only a person can clear it.
          outcomes.push(held(row.id, "stuck", next.item, next.why));
          break;
        case "orphaned":
          outcomes.push(held(row.id, "orphaned", next.head, next.why));
          break;
        case "stale":
          outcomes.push(held(row.id, "stale", next.head, next.why));
          break;
        case "held":
          outcomes.push(held(row.id, "held", next.head, next.why));
          break;
        case "blocked":
          outcomes.push(held(row.id, "blocked", next.head, next.reason.why));
          break;
        case "ready":
          // Counted whatever the outcome: a refused send costs the same
          // ten-second timeouts as a delivered one, and it is the SPENDING that
          // the bound is about, not the success.
          sends += 1;
          // MOVED FOR THE SAME REASON THE SLOT IS SPENT, and before the send
          // rather than after it: a send that throws has still cost the pass its
          // time, so the next pass must not start on this row again.
          deps.cursor.advanceTo(row.id);
          outcomes.push(deliverOne(row, { paneId, claudeSessionId }, next.item, deps));
          break;
        default: {
          const never: never = next;
          return never;
        }
      }
    } catch (e) {
      outcomes.push({ kind: "threw", sessionId: row.id, itemId: null, why: `draining this row threw: ${(e as Error).message}` });
    }
  }

  return { rows: rows.length, considered, generation, invalidated, outcomes };
}

/**
 * One line for the server log: counts and codes, never a word of what was said.
 *
 * Every send that did not simply work is named individually, because the whole
 * value of this pass over the one it replaces is that a person can tell "it was
 * sent" from "it is still waiting" — a summary that said `delivered=0` and
 * nothing else would be the same silence in a shorter form.
 */
export function summariseDrain(r: DrainResult): string {
  const counts = { delivered: 0, refused: 0, "put-back": 0, undeliverable: 0, held: 0, threw: 0 };
  const notes: string[] = [];
  for (const o of r.outcomes) {
    counts[o.kind] += 1;
    switch (o.kind) {
      case "delivered":
        notes.push(`${o.sessionId}:${o.itemId} delivered ${o.what}`);
        break;
      case "refused":
        notes.push(`${o.sessionId}:${o.itemId} refused ${o.code}`);
        break;
      case "put-back":
        notes.push(`${o.sessionId}:${o.itemId} put back after ${o.code} (nothing was sent)`);
        break;
      case "undeliverable":
        notes.push(`${o.sessionId}:${o.itemId} undeliverable`);
        break;
      case "threw":
        notes.push(`${o.sessionId}:${o.itemId ?? "-"} THREW ${o.why}`);
        break;
      case "held":
        // The ordinary case — a working session — is a count rather than a
        // line, so a fleet of held queues does not fill the log every minute.
        if (o.reason !== "held") notes.push(`${o.sessionId} ${o.reason}`);
        break;
      default: {
        const never: never = o;
        return never;
      }
    }
  }
  return (
    `drain: rows=${r.rows} queued=${r.considered} tmux=${r.generation ?? "unknown"} delivered=${counts.delivered} ` +
    `refused=${counts.refused} putBack=${counts["put-back"]} undeliverable=${counts.undeliverable} ` +
    `held=${counts.held} threw=${counts.threw}` +
    (r.invalidated > 0 ? ` invalidated=${r.invalidated}` : "") +
    (notes.length > 0 ? ` — ${notes.join("; ")}` : "")
  );
}
