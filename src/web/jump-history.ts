/**
 * **Where the reader jumped from, carried on the entry they jumped to.**
 *
 * A reader clicks a glossary term, lands three thousand words away, and cannot
 * find their way home. On a desktop browser they press Back and it mostly
 * works; added to an iOS home screen — `"display": "standalone"` in
 * public/site.webmanifest, which is how Greg reads — there is no Back to press.
 *
 * The mechanism that answers this is almost entirely already here: `jumpTo`
 * pushes a history entry and scrolling never does
 * (docs/project/url-state.md § Position replaces history). **What was missing
 * is a record, on the pushed entry, of where the reader was standing** — so
 * that a later stage can draw a chip saying *back to <section>* while the
 * browser's own stack, which survives a reload and costs nothing, stays the
 * only history this app keeps.
 *
 * Two halves, and the seam between them is the point:
 *
 *  - **The stamp** — `readStamp` / `withStamp` / the arm, all pure, all over an
 *    opaque `history.state` object. Nothing here touches `history` itself.
 *  - **The jump** — `measureOrigin` and `beginJump`, which read the layout and
 *    start the transaction. Those are in keynav.ts, beside `measureRow` and the
 *    one way anything scrolls to a block. The transaction is *finished* by
 *    `watchHistoryWrites` in router.ts, for the reason § the handshake gives.
 *
 * **This file stays pure for a reason a reader would not guess.** router.ts
 * imports it, and router.ts is on `SHARED_WITH_READER` — it is in both the
 * reader's startup bundle and the lazily-loaded /admin and /design ones. A
 * single import of keynav.ts from here dragged keynav, scroll, position, tree,
 * safe-area and supplement into those two admin routes, all six for the sake of
 * a chip nobody on those pages can see. tests/eager-client-graph.test.ts caught
 * it and named all six.
 *
 * docs/plans/260906g-back-to-where-you-jumped-from.md is the plan and the two
 * cross-family reviews that reshaped it.
 *
 * ## The simpler option passed over: `?from=`
 *
 * The obvious way to record where you came from is a query parameter, and it is
 * wrong here for two reasons. It would ride along in every link a reader
 * shares, pointing a stranger's chip at a place they have never been; and it
 * would need clearing rules of its own at every navigation, a second contract
 * beside the one `carriedSearch` already keeps. `history.state` holds this fact
 * **per entry**, which is exactly the shape of the question.
 */
import { isSpideryarnId } from "../ids.js";
import type { BlockId } from "../types.js";

/**
 * **Where a jump started, and `top` is not a block.**
 *
 * A union rather than a `BlockId | null`, because the two cases need different
 * things done to them and a nullable id makes that a matter of everyone
 * remembering. At the top of the article there is no block under the reading
 * line — every row is below it — and yet `measureRow()` answers `0`, because
 * `activeSectionIndex` initialises to zero and clamps there (position.ts).
 * Taking that at face value would record the first block, and Back would then
 * `scrollToBlock` it, aligning that row under the sticky chrome instead of
 * restoring the top of the page: the reader asks to go back to the beginning
 * and loses the masthead. GPT Sol F8, 2026-09-06.
 *
 * So `top` is its own case all the way through — measured here, serialised
 * distinctly in the stamp, and written as the *removal* of `?at=` rather than
 * as a value (router.ts § `originHref`), which is the same shape
 * `positionToWrite` already uses for the top of the article.
 */
export type JumpOrigin =
  | { readonly kind: "top" }
  | { readonly kind: "block"; readonly blockId: BlockId };

/**
 * Our one key on `history.state`, namespaced because the object is not ours.
 *
 * `spya`, matching the prefix every block id already carries
 * (docs/project/block-ids.md), so anybody reading a state object in a debugger
 * can tell at a glance whose it is. **Namespaced rather than a bare `from`**
 * because `history.state` is a shared surface: nuqs hands it back untouched, a
 * router added later would put its own bookkeeping there, and a browser may
 * restore one written by a version of this app that no longer exists. One key
 * we own, everything else preserved byte for byte, is the only arrangement in
 * which both of those stay true.
 */
export const STAMP_KEY = "spya";

/**
 * How `top` is spelled inside the stamp.
 *
 * A sentinel in the same field rather than a second field, and it cannot
 * collide: every block id starts `spya-`, so `isSpideryarnId("top")` is false
 * and the two cases are told apart by the same check that validates the id.
 */
const TOP = "top";

/**
 * **The version marker on the shape below, and it is a compatibility device
 * rather than bookkeeping.**
 *
 * A stamp is written by the code that is running and read by whatever code is
 * running when the entry comes back, and those need not be the same deploy: an
 * entry stamped at depth 2 can be reloaded onto the *previous* bundle, whose
 * `readStamp` knows only `from` and whose chip is `history.back()`. It would
 * draw a chip, ignore the depth, step one entry, and land the reader somewhere
 * the label does not name — failing **open**, which is the bad direction.
 *
 * So the new shape carries no `from` at all. The old parser looks for one,
 * finds nothing, and returns `null`: no chip, which is the honest answer from
 * code that cannot honour this stamp. GPT Sol's first finding on the plan,
 * 2026-09-16.
 *
 * **Under the same `STAMP_KEY`, deliberately.** A second key would be invisible
 * to the old `withStamp(state, null)`, which deletes `STAMP_KEY` and nothing
 * else — so an old bundle would carry an unfamiliar stamp forward through every
 * push of the session with nothing able to clear it.
 */
const VERSION = 2;

/**
 * **The ceiling on how far back the origin may be**, and it is plausibility
 * rather than policy.
 *
 * The plan's first draft capped inheritance at ten, so that one press could not
 * undo eleven deliberate acts. That was refused in review and the refusal is
 * right: at depth eleven the origin is exactly as reachable as at depth one, so
 * a cap takes a working way back away for a feeling, and the reader already has
 * the × for a return that has outlived its use. What is left here is only a
 * guard against a number that cannot have come from us — `history.state`
 * survives a browser restore and an older deploy — because `history.go(-n)` for
 * an absurd `n` walks the reader out of the session. GPT Sol's fifth finding.
 */
const MAX_PLAUSIBLE_DEPTH = 4096;

/**
 * **Where the reader jumped from, and how many entries back that is now.**
 *
 * The depth is a claim about *the stack*, not about the page, and that is what
 * makes it safe to carry while the entries remain available: every successful
 * same-document push adds exactly one entry, so `depth + 1` names the origin's
 * distance whatever the push changed — a mode, a column, a sort, or something
 * added next year that this file has never heard of.
 *
 * The History API has one platform ceiling this count cannot observe. Browsers
 * may evict old same-document state entries at an implementation-defined
 * limit, and expose neither the entries nor the current index. If eviction
 * removes the origin, no local counter can discover that; router.ts records
 * the boundary beside `stampFor` rather than pretending the arithmetic solves
 * retention too.
 */
export interface JumpStamp {
  readonly origin: JumpOrigin;
  /** Entries between here and the origin: `1` on the entry a jump landed on. */
  readonly depth: number;
}

/**
 * The stamp on a history-state object, or `null` for "no stamp here" — and
 * **never a throw**.
 *
 * Every input is untrusted: `history.state` is whatever the last writer left,
 * which after a browser restore or a session from an older deploy may be a
 * shape this code has never seen. The id is validated rather than trusted, for
 * the same reason `?at=` is (params.ts § parseAsBlockId): a stamp naming
 * something that is not a block id would send `scrollToBlock` after a selector
 * that cannot match, and the chip would be a button that does nothing.
 *
 * A stamp naming a block **this article no longer has** is a different problem
 * and is not this function's: it is a syntactically fine id, and only the
 * caller that resolves it against the article can tell.
 *
 * **Two shapes are read and one is written.** `{ v: 2, origin, depth }` is
 * ours; `{ from }` is what the deploy before 2026-09-16 wrote, and it reads as
 * depth 1 because that is what it meant — the chip of that era could only ever
 * step one entry. Costs a line, and spares a reader who kept a tab open across
 * the deploy a chip that does nothing.
 */
export function readStamp(state: unknown): JumpStamp | null {
  if (!isPlainObject(state)) return null;
  const mine = state[STAMP_KEY];
  if (!isPlainObject(mine)) return null;

  if (Object.hasOwn(mine, "v") && mine.v === VERSION) {
    const origin = originOf(mine.origin);
    if (origin === null) return null;
    const depth = mine.depth;
    /* An implausible depth draws nothing rather than being clamped to
       something: clamping would aim the labelled button at an entry nobody
       chose, which is the failure the label makes worse. */
    if (typeof depth !== "number" || !Number.isSafeInteger(depth)) return null;
    if (depth < 1 || depth > MAX_PLAUSIBLE_DEPTH) return null;
    return { origin, depth };
  }

  /* A version marker means this is not the legacy shape. Unknown versions
     fail closed even if a later format happens to reuse `from`: interpreting
     that field as a one-entry legacy stamp could make the chip land somewhere
     its label does not name. */
  if (Object.hasOwn(mine, "v")) return null;

  /* The pre-2026-09-16 shape: no `v`, the origin under `from`, and a chip that
     could only ever step one entry — so depth 1 is what it meant. */
  const origin = originOf(mine.from);
  return origin === null ? null : { origin, depth: 1 };
}

/** The origin a stamp field spells, or `null` if it spells nothing we minted. */
function originOf(value: unknown): JumpOrigin | null {
  if (value === TOP) return { kind: "top" };
  if (typeof value === "string" && isSpideryarnId(value))
    return { kind: "block", blockId: value as BlockId };
  return null;
}

/**
 * The same state with our stamp **set** (`stamp` non-null) or **stripped**
 * (`stamp` null), and every foreign key untouched either way.
 *
 * Two things it deliberately does not do:
 *
 *  - **It never mutates.** `history.state` is handed straight back to
 *    `pushState`, which structured-clones it; editing the object in place would
 *    edit the state of the entry we are still standing on.
 *  - **It returns `null`, not `{}`, when nothing is left.** A push that leaves
 *    the article strips the stamp (router.ts § `watchHistoryWrites`), so
 *    without this those entries would carry an empty object that nobody put
 *    there and nobody can explain.
 *
 * A state that is not a plain object — a string, a number, an array — has no
 * keys to merge into, so stamping it would mean throwing somebody else's value
 * away. It is returned unchanged: the chip is worth less than a stranger's
 * state. Not reachable today, since only nuqs and router.ts write here.
 *
 * **It writes only the current shape**, never the legacy `{ from }` one, so
 * there is one writer and one thing to reason about. `readStamp` is where the
 * two shapes meet, and it is the only place they do.
 */
export function withStamp(state: unknown, stamp: JumpStamp | null): unknown {
  if (!canStamp(state)) return state;
  /* `null` and `undefined` are *absence*, which is somebody's state only in the
     sense that nobody has written one — so they are merged into, not declined.
     Declining them was a bug for one test run: it made every stamp a no-op,
     because the entry a jump pushes has no state until we give it one. */
  const next: Record<string, unknown> = isPlainObject(state) ? { ...state } : {};
  if (stamp === null) delete next[STAMP_KEY];
  else
    next[STAMP_KEY] = {
      v: VERSION,
      origin: stamp.origin.kind === "top" ? TOP : stamp.origin.blockId,
      depth: stamp.depth,
    };
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * **The same stamp, one entry further from its origin** — what an ordinary push
 * does with the stamp it inherits, and `null` when there is nothing to carry.
 *
 * Here rather than in router.ts because the arithmetic and the bound it has to
 * respect are one fact, and splitting them is how a bound stops being applied.
 * A stamp already at the ceiling is dropped rather than grown past it, so
 * nothing this file writes can fail this file's own reader.
 */
export function oneFurtherBack(stamp: JumpStamp | null): JumpStamp | null {
  if (stamp === null) return null;
  const depth = stamp.depth + 1;
  return depth > MAX_PLAUSIBLE_DEPTH ? null : { origin: stamp.origin, depth };
}

/**
 * **Whether a stamp can be written onto this state without destroying it** —
 * and the caller has to ask *before* it does anything else.
 *
 * `withStamp` returns a state it cannot merge into unchanged, which is the
 * right answer on its own; but a jump is two writes, and the wrapper used to
 * rewrite the predecessor entry before discovering that the destination could
 * not be stamped. That leaves half a pair: a predecessor truthfully rewritten
 * to somewhere the reader can no longer get back to, and no chip to take them
 * there. GPT Sol F16, 2026-09-06.
 */
export function canStamp(state: unknown): boolean {
  return state === null || state === undefined || isPlainObject(state);
}

/**
 * A state object we may copy keys out of and back into.
 *
 * **Plain, in the strict sense: an object literal or a `null`-prototype bag.**
 * `typeof x === "object"` is true of a `Date`, a `Map`, a typed array and every
 * class instance, and spreading one of those into `{}` yields an object with
 * none of its behaviour and usually none of its data — a `Date` spreads to
 * `{}`, which this file would then store as `null`, silently throwing away
 * somebody else's state to make room for a chip. Nothing in this repo writes
 * such a state today; the browser restoring one, or a router added later, is
 * not something the chip gets to break. GPT Sol F15, 2026-09-06.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/* ------------------------------------------------------- the handshake -- */

/** A jump that has been started and is waiting for the push that completes it. */
interface ArmedJump {
  /** The article it belongs to. An excursion belongs to one path. */
  readonly pathname: string;
  /**
   * **The whole address the reader was standing at when they asked**, which is
   * what makes the arm belong to a moment rather than merely to a page.
   *
   * The push is not made until nuqs flushes its queue — 50ms here, 120ms on
   * Safari, 320ms on an older one — and an ordinary navigation in that window
   * makes nuqs abandon the write altogether. The arm outlived it, and a later
   * push that happened to name the same article and the same block could then
   * wear an origin from minutes ago: a chip on a mode toggle, promising a
   * return it never made, and a predecessor entry rewritten to a place the
   * reader had already left. Requiring the address to be *unchanged* since the
   * arm was set closes it, because getting back to that article again cannot
   * be done without changing the address on the way. GPT Sol F14, 2026-09-06.
   */
  readonly from: string;
  readonly origin: JumpOrigin;
  /** Which block the push is expected to name, so a stranger cannot claim it. */
  readonly target: BlockId;
}

/**
 * **The armed jump, waiting for the push that will carry it.**
 *
 * Module-level state rather than an argument, and that is not laziness: the
 * `pushState` call that completes a jump is not one we make. `jumpTo` asks
 * **nuqs** for it, and nuqs performs it three call frames away — inside a
 * global throttle queue, on a later task, through a `history.pushState` it read
 * off the global object (nuqs/dist/debounce-*.js § ThrottledQueue.flush). There
 * is no parameter to thread through that. The only place that sees both the
 * intent and the write is `watchHistoryWrites`'s wrapper, which sees every push
 * in the app and knows nothing about jumps; a one-slot handshake is the
 * narrowest thing that can join the two.
 *
 * **Matched, not merely consumed.** The wrapper takes it only for a push whose
 * pathname and `?at=` are the ones this jump asked for, so an unrelated push
 * landing in the same window — a `cols` toggle, a `navigate` out of the article
 * — cannot wear somebody else's origin and draw a chip promising a return it
 * cannot make. GPT Sol F3 and F11, 2026-09-06.
 */
let armed: ArmedJump | null = null;

/** Say that a push is coming, where it starts, and where it is going. */
export function armJump(jump: ArmedJump): void {
  armed = jump;
  announce();
}

/**
 * **Is a jump in flight?** — which is to say, has the reader asked to be
 * somewhere else, and has the history write that records it not landed yet.
 *
 * The window is 50ms here and up to 320ms on an older Safari, and in it the
 * page is already scrolling towards the destination while the current entry
 * still describes the jump *before* this one. Anything drawn from that entry is
 * therefore describing a journey the reader has already left: the chip would
 * name the previous origin, and pressing it would go back one place further
 * than the reader meant and cancel the jump they just asked for. GPT Sol F19,
 * 2026-09-06.
 *
 * ## The simpler fix, and why it was passed over
 *
 * The obvious answer is to hold the scroll until the push commits — one thing
 * happening once, no window at all. It was refused because nuqs **abandons** a
 * queued write when the page navigates, so a jump whose push never lands would
 * become a tap that silently does nothing: a worse failure than the one being
 * fixed, and of exactly the class this repo names silent-success. Withholding
 * the *claim* costs nothing when the push is abandoned, because there was
 * never anything to claim.
 */
export function isJumpArmed(): boolean {
  return armed !== null;
}

/* ---------------------------------------------------------- who to tell -- */

/**
 * Arming is not a history write, so nothing else would notice it.
 *
 * `watchHistoryWrites` fires `NAVIGATED` on every write and that is what
 * redraws the chip — but an arm changes what the chip should say *without*
 * writing anything, which is the whole of F19. A listener set here rather than
 * a DOM event because this file has to stay clear of the DOM (see the header):
 * router.ts imports it, and router.ts is in the reader's startup bundle and in
 * the lazy admin one.
 */
const armListeners = new Set<() => void>();

/** Hear about arming and disarming. Returns the unsubscribe. */
export function onArmedJumpChange(listener: () => void): () => void {
  armListeners.add(listener);
  return () => armListeners.delete(listener);
}

function announce(): void {
  for (const listener of armListeners) listener();
}

/**
 * The armed origin **if this push is the one it was armed for**, taken once.
 *
 * Three things have to agree: the push goes to the article the jump was armed
 * on, it names the block the jump was aimed at, and the reader has not moved
 * since — `here` is the address being written *from*, and it must still be the
 * one the arm was set at (§ `from` above).
 *
 * `target` is the `?at=` of the push being made, or null when it names no
 * block. Match or not, an actual push ends the arm: nuqs has one global queue,
 * so if this is not the expected flush then that flush has been superseded or
 * abandoned. Leaving the arm behind would withhold the chip indefinitely.
 */
export function consumeArmedJump(
  here: string,
  pathname: string,
  target: BlockId | null,
): JumpOrigin | null {
  if (armed === null) return null;
  const matches = armed.from === here && armed.pathname === pathname && armed.target === target;
  const origin = matches ? armed.origin : null;
  armed = null;
  /* No `announce()` here on purpose: the caller is the wrapper, mid-write, and
     it fires `NAVIGATED` immediately afterwards. Announcing first would redraw
     the chip against the entry the push is about to replace. */
  return origin;
}

/**
 * Forget an arm nobody claimed.
 *
 * Called at the top of every jump and after every history write that did not
 * claim the arm (router.ts): nuqs can coalesce a queued update away, an
 * ordinary navigation makes it abandon one outright, and a component can
 * unmount between the arming and the flush, so an arm that never met its push
 * is ordinary rather than exotic. One that outlived its jump would withhold
 * the chip and rail mark indefinitely, and could attach a stale origin to a
 * later matching push.
 */
export function clearArmedJump(): void {
  if (armed === null) return;
  armed = null;
  announce();
}
