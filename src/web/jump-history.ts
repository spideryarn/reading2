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
 * running when the entry comes back, and those need not be the same deploy. An
 * older bundle's chip was `history.go(-depth)`; handed this shape it must draw
 * nothing rather than guess a depth and step to somewhere its label does not
 * name — failing **closed**. Both older parsers do: the one before 2026-09-16
 * looks for `from` and finds none, and the v2 one sees a `v` it does not know.
 * GPT Sol's first finding on the 260916a plan.
 *
 * **3 since 2026-10-08**, when the chip stopped travelling the stack at all
 * (docs/plans/261008g-the-way-back-chip-moves-the-position-and-leaves-the-modes-alone.md):
 * the depth went, and `earlier` came.
 *
 * **Under the same `STAMP_KEY`, deliberately.** A second key would be invisible
 * to an old `withStamp(state, null)`, which deletes `STAMP_KEY` and nothing
 * else — so an old bundle would carry an unfamiliar stamp forward through every
 * push of the session with nothing able to clear it.
 */
const VERSION = 3;

/**
 * **How many journeys a stamp remembers behind the current one.** A bound on a
 * state object the browser stores per entry, not a policy anybody will reach by
 * reading: fifty jumps without once pressing the chip or leaving the article.
 * Past it the oldest journey is forgotten, which is the least valuable one.
 */
export const MAX_EARLIER = 50;

/**
 * **Where the reader jumped from, and the journeys before that one.**
 *
 * `origin` is what the chip offers now. `earlier` is the origins of the jumps
 * made before it, nearest first: pressing the chip moves the reader to `origin`
 * and leaves `earlier[0]` as the next way back, so repeated presses unwind the
 * journeys in order — the "dropdown" Greg imagined when the chip was built
 * (260906g).
 *
 * Until 2026-10-08 this carried a `depth` instead, the number of entries back
 * the origin's entry lay, because the chip was `history.go(-depth)` and the
 * earlier journeys lived on the earlier entries. That brought the reader's old
 * modes back with the position, which is what Greg asked it not to do
 * (spya-q3dfmw); a press now writes only `?at=`, and the chain it needs has to
 * travel with the entry, since nothing can read another entry's state without
 * going there.
 */
export interface JumpStamp {
  readonly origin: JumpOrigin;
  readonly earlier: readonly JumpOrigin[];
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
 * **Three shapes are read and one is written.** `{ v: 3, origin, earlier }` is
 * ours. `{ v: 2, origin, depth }` (2026-09-16 to 2026-10-08) and `{ from }`
 * (before that) are what a reader who kept a tab open across a deploy still has
 * on their entries; both read as their origin with no earlier journeys, since
 * those lived on other entries this code will never travel to. An `earlier`
 * that is not a list of origins we minted reads as empty rather than failing
 * the whole stamp: the way back it does name is still good.
 */
export function readStamp(state: unknown): JumpStamp | null {
  if (!isPlainObject(state)) return null;
  const mine = state[STAMP_KEY];
  if (!isPlainObject(mine)) return null;

  if (Object.hasOwn(mine, "v")) {
    /* Unknown versions fail closed even if a later format happens to reuse
       a field: interpreting it could make the chip land somewhere its label
       does not name. */
    if (mine.v !== VERSION && mine.v !== 2) return null;
    const origin = originOf(mine.origin);
    if (origin === null) return null;
    return { origin, earlier: mine.v === VERSION ? earlierOf(mine.earlier) : [] };
  }

  /* The pre-2026-09-16 shape: no `v`, the origin under `from`. */
  const origin = originOf(mine.from);
  return origin === null ? null : { origin, earlier: [] };
}

/** The origin a stamp field spells, or `null` if it spells nothing we minted. */
function originOf(value: unknown): JumpOrigin | null {
  if (value === TOP) return { kind: "top" };
  if (typeof value === "string" && isSpideryarnId(value))
    return { kind: "block", blockId: value as BlockId };
  return null;
}

/** The journeys behind a stamp, or none if the field is not a list we wrote. */
function earlierOf(value: unknown): JumpOrigin[] {
  if (!Array.isArray(value) || value.length > MAX_EARLIER) return [];
  const origins = value.map(originOf);
  return origins.every((o) => o !== null) ? (origins as JumpOrigin[]) : [];
}

/** How an origin is spelled inside the stamp. */
function spell(origin: JumpOrigin): string {
  return origin.kind === "top" ? TOP : origin.blockId;
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
 * **It writes only the current shape**, never an older one, so there is one
 * writer and one thing to reason about. `readStamp` is where the shapes meet,
 * and it is the only place they do.
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
      origin: spell(stamp.origin),
      earlier: stamp.earlier.slice(0, MAX_EARLIER).map(spell),
    };
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * **The stamp a new jump writes**: its own origin, with the journey the reader
 * was already on (if any) pushed onto the front of `earlier`.
 *
 * Here rather than in router.ts because the list and the bound it has to
 * respect are one fact, and splitting them is how a bound stops being applied.
 */
export function jumpedFrom(origin: JumpOrigin, current: JumpStamp | null): JumpStamp {
  const earlier = current === null ? [] : [current.origin, ...current.earlier];
  return { origin, earlier: earlier.slice(0, MAX_EARLIER) };
}

/**
 * **The stamp left once the reader has gone back along this one** — the next
 * journey out, or `null` when this was the only one.
 */
export function oneJourneyBack(stamp: JumpStamp): JumpStamp | null {
  const [origin, ...earlier] = stamp.earlier;
  return origin === undefined ? null : { origin, earlier };
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
 * **A press of the return chip, waiting for its push** — the same handshake as
 * a jump, run backwards (keynav.ts § `beginReturn`).
 *
 * It goes through nuqs's queue rather than writing history itself, and that is
 * GPT Sol's first finding on the plan (261008g): a raw push would abort any
 * write nuqs still had queued, so a reader who pressed a mode and then the chip
 * inside 50ms would have the mode taken back, and its address copied from
 * before the mode — the one thing this press promises to leave alone. Through
 * the queue, the mode and `?at=` go out in one push.
 *
 * `target` is `null` for a return to the top of the article, which is written
 * as the absence of `?at=` (router.ts § `originHref`). `next` is the stamp the
 * entry should carry afterwards: the journey before this one, or none.
 */
interface ArmedReturn {
  readonly pathname: string;
  /** As `ArmedJump.from`, for its reason. */
  readonly from: string;
  readonly target: BlockId | null;
  readonly next: JumpStamp | null;
}

/** What the push that claims an arm is for. */
export type ArmedWrite =
  | {
      readonly kind: "jump";
      readonly origin: JumpOrigin;
      /** The journey after a queued return this jump superseded, if there was one. */
      readonly base: JumpStamp | null | undefined;
    }
  | { readonly kind: "return"; readonly next: JumpStamp | null };

/**
 * **The armed jump or return, waiting for the push that will carry it.**
 *
 * Module-level state rather than an argument, and that is not laziness: the
 * `pushState` call that completes a jump is not one we make. `jumpTo` asks
 * **nuqs** for it, and nuqs performs it three call frames away — inside a
 * global throttle queue, on a later task, through a `history.pushState` it read
 * off the global object (nuqs/dist/debounce-*.js § ThrottledQueue.flush). There
 * is no parameter to thread through that. The only place that sees both the
 * intent and the write is `watchHistoryWrites`'s wrapper, which sees every push
 * in the app and knows nothing about jumps or returns; a one-slot handshake is the
 * narrowest thing that can join the two.
 *
 * **Matched, not merely consumed.** The wrapper takes it only for a push from
 * the same address and to the same pathname. A raw push must also name the
 * exact `?at=`; only the marked nuqs batch may carry a later value from its own
 * keyed queue (§ `consumeArmedJump`). Thus an unrelated `cols` push or a
 * navigation out of the article cannot wear somebody else's origin and draw a
 * chip promising a return it cannot make. GPT Sol F3 and F11, 2026-09-06.
 */
let armed:
  | ({ readonly kind: "jump"; readonly base: JumpStamp | null | undefined } & ArmedJump)
  | ({ readonly kind: "return" } & ArmedReturn)
  | null = null;

/** Say that a push is coming, where it starts, and where it is going. */
export function armJump(jump: ArmedJump): void {
  /* A return has already moved the page before nuqs writes its entry. If a new
     jump wins the same queued `?at=` slot, its journey starts from the return's
     result, not from the stale pre-return stamp still on `history.state`. Carry
     that base into the one push that will actually land. */
  const base = armed?.kind === "return" ? armed.next : undefined;
  armed = { kind: "jump", ...jump, base };
  announce();
}

/** Say that the push coming is the return chip's, and what it leaves behind. */
export function armReturn(back: ArmedReturn): void {
  armed = { kind: "return", ...back };
  announce();
}

/**
 * **Is a jump or return write in flight?** — which is to say, has the reader
 * asked to be somewhere else, and has the history write that records it not
 * landed yet.
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
 * For a jump, the obvious answer is to hold the scroll until the push commits — one thing
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
 * Arming a jump or return is not a history write, so nothing else would notice it.
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
 * The armed write **if this push is the one it was armed for**, taken once.
 *
 * Three things have to agree: the push goes to the article the arm was set on,
 * it names the block the arm was aimed at (or, for a return to the top, no
 * block), and the reader has not moved since — `here` is the address being
 * written *from*, and it must still be the one the arm was set at (§ `from`
 * above).
 *
 * A marked nuqs batch has one deliberate exception to the target match. On an
 * older Safari nuqs may hold it for 320ms, while the position spy's debounce
 * is 300ms; if the reader scrolls immediately after a jump or return, that
 * later `?at=` replaces the act's target in nuqs's keyed queue. It is still the
 * same marked push, from the same address and on the same article, and the act
 * still owns the journey transition. `retargetedNuqs` is true only for such a
 * marked nuqs write; an unrelated raw push cannot claim the arm.
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
  retargetedNuqs = false,
): ArmedWrite | null {
  if (armed === null) return null;
  const matchesTarget = armed.target === target || retargetedNuqs;
  const matches = armed.from === here && armed.pathname === pathname && matchesTarget;
  const claimed: ArmedWrite | null = !matches
    ? null
    : armed.kind === "jump"
      ? { kind: "jump", origin: armed.origin, base: armed.base }
      : { kind: "return", next: armed.next };
  armed = null;
  /* No `announce()` here on purpose: the caller is the wrapper, mid-write, and
     it fires `NAVIGATED` immediately afterwards. Announcing first would redraw
     the chip against the entry the push is about to replace. */
  return claimed;
}

/**
 * Forget an arm nobody claimed.
 *
 * Called before a return supersedes any older arm and after every history write
 * that did not claim one (router.ts): nuqs can coalesce a queued update away,
 * an ordinary navigation makes it abandon one outright, and a component can
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
