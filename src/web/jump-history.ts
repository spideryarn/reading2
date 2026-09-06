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
 * The origin on a history-state object, or `null` for "no stamp here" — and
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
 */
export function readStamp(state: unknown): JumpOrigin | null {
  if (!isPlainObject(state)) return null;
  const mine = state[STAMP_KEY];
  if (!isPlainObject(mine)) return null;
  const from = mine.from;
  if (from === TOP) return { kind: "top" };
  if (typeof from === "string" && isSpideryarnId(from))
    return { kind: "block", blockId: from as BlockId };
  return null;
}

/**
 * The same state with our stamp **set** (`from` non-null) or **stripped**
 * (`from` null), and every foreign key untouched either way.
 *
 * Two things it deliberately does not do:
 *
 *  - **It never mutates.** `history.state` is handed straight back to
 *    `pushState`, which structured-clones it; editing the object in place would
 *    edit the state of the entry we are still standing on.
 *  - **It returns `null`, not `{}`, when nothing is left.** Every same-path
 *    push strips the inherited stamp (router.ts § `watchHistoryWrites`), so
 *    without this every entry in the session would carry an empty object that
 *    nobody put there and nobody can explain.
 *
 * A state that is not a plain object — a string, a number, an array — has no
 * keys to merge into, so stamping it would mean throwing somebody else's value
 * away. It is returned unchanged: the chip is worth less than a stranger's
 * state. Not reachable today, since only nuqs and router.ts write here.
 */
export function withStamp(state: unknown, from: JumpOrigin | null): unknown {
  /* `null` and `undefined` are *absence*, which is somebody's state only in the
     sense that nobody has written one — so they are merged into, not declined.
     Declining them was a bug for one test run: it made every stamp a no-op,
     because the entry a jump pushes has no state until we give it one. */
  const foreign = state ?? null;
  if (foreign !== null && !isPlainObject(foreign)) return foreign;
  const next: Record<string, unknown> = isPlainObject(foreign) ? { ...foreign } : {};
  if (from === null) delete next[STAMP_KEY];
  else next[STAMP_KEY] = { from: from.kind === "top" ? TOP : from.blockId };
  return Object.keys(next).length === 0 ? null : next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------- the handshake -- */

/** A jump that has been started and is waiting for the push that completes it. */
interface ArmedJump {
  /** The article it belongs to. An excursion belongs to one path. */
  readonly pathname: string;
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
}

/**
 * The armed origin **if this push is the one it was armed for**, taken once.
 *
 * `target` is the `?at=` of the push being made, or null when it names no
 * block; either way a mismatch leaves the arm where it was rather than
 * spending it, so the real push can still find it.
 */
export function consumeArmedJump(pathname: string, target: BlockId | null): JumpOrigin | null {
  if (armed === null || armed.pathname !== pathname || armed.target !== target) return null;
  const { origin } = armed;
  armed = null;
  return origin;
}

/**
 * Forget an arm nobody claimed.
 *
 * Called at the top of every jump: nuqs can coalesce a queued update away, and
 * a component can unmount between the arming and the flush, so an arm that
 * never met its push is possible. One that outlived its jump would attach a
 * stale origin to the *next* jump's push, which is a chip pointing at a place
 * the reader left minutes ago.
 */
export function clearArmedJump(): void {
  armed = null;
}
