/**
 * A block id, drawn the way you want to read one and behaving the way you want
 * to click one.
 *
 * Ids are drawn as characters in four places — the range under a gist in both
 * the table's cells and a column panel, the same range under each entry of the
 * summary panel, and the ids the model cites inside a chat answer or a summary
 * (Cited.tsx) — so they get one component rather than four spans that drift
 * apart.
 *
 * **The gutter beside every paragraph was the fifth and is no longer one of
 * them.** Since 2026-08-31 it is a permalink icon with the id in its `title`
 * (BlockGutter.tsx), which uses `blockHref` below and renders none of this.
 * The gutter is also the one place a plain left-click no longer jumps, so read
 * the third bullet as being about the four that are left.
 *
 * Three things it does:
 *
 *  - **Drops the `spya-` prefix.** Every id on screen has it, so it carries no
 *    information and costs five characters of the six that do. The full id is
 *    still in the `title`, and still in the `href`, which is where anything
 *    that needs to be pasted comes from anyway.
 *  - **Renders a real `<a href>`**, so the browser's own affordances work:
 *    the status bar shows where it goes, right-click offers "copy link
 *    address", ⌘-click opens the block in a new tab. That was the point of the
 *    change — see docs/project/block-ids.md#showing-an-id.
 *  - **Left-click jumps in place.** A reload to move down the page you are
 *    already on would be a waste, so a plain left-click hands off to the same
 *    `onJump` a gist cell uses: push history, scroll smoothly. Every other kind
 *    of click is left to the browser.
 *
 * It always stops the click from bubbling. Both range links sit inside a cell
 * whose own handler jumps to the *start* of the range, so without that, clicking
 * the end of a range would jump to the beginning of it.
 *
 * The link is the copy affordance now: `user-select: all` used to be on the
 * gutter id so a click selected the whole thing, and it cannot coexist with a
 * click that navigates. Right-click → copy gives the URL, which is more useful
 * than the bare id it replaced.
 *
 * `blockPermalink` below is the same address with an origin on it, for the one
 * caller that puts it on the clipboard rather than in an `href`.
 */
import type { MouseEvent } from "react";
import { ID_PREFIX } from "../ids.js";
import type { BlockId } from "../types.js";
import { navigate, searchWithout } from "./router.js";

/** `spya-k3m9qt` → `k3m9qt`. Anything not ours is shown untouched. */
export function shortBlockId(id: BlockId): string {
  return id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : id;
}

/**
 * This address, with `?at=` pointed at one block — every other bit of view
 * state (columns, mode, open dialog) carried along, so the link shows the block
 * *as the reader is currently looking at it*. See docs/project/url-state.md.
 *
 * ## `carried`, and why the global read is no longer good enough everywhere
 *
 * This read `location.search` during render, with no subscription, and said
 * that was safe "because every parameter in the URL is `useQueryState` in App,
 * so any change to the query string re-renders this whole tree".
 *
 * **That premise was never quite true**, which is worth saying plainly rather
 * than describing it as something a memo broke. nuqs subscriptions are
 * key-isolated, so ten reading parameters owned by *child* components never
 * woke `Reader` at all (router.ts § `watchHistoryWrites` names them). What kept
 * it honest was `?at=`, which re-rendered the whole reading view eighty-odd
 * times a scroll and refreshed every href on the way past. Memoising
 * `TableView` took that away and turned a self-healing staleness into a
 * permanent one — change the diagram's hue, copy a paragraph's link, and send
 * somebody the view you had a minute ago.
 *
 * So the pairs to carry can be **passed in**: the query string with `at`
 * already dropped, no leading `?`. `TableView` takes it as a prop and hands it
 * down, which makes it an ordinary input that the memo compares like any other
 * — and since it is a string, a render caused only by `?at=` produces an equal
 * one and the memo still holds. Every caller outside that subtree omits it and
 * gets the global read, whose premise is untouched.
 *
 * Editing the query as **text** rather than through `URLSearchParams` is not
 * incidental either. The old version round-tripped it, which re-encodes
 * `?cols=0,1` into `?cols=0%2C1` — still correct, still parses, and no longer
 * readable by the person you send the link to. router.ts § `carriedSearch` and
 * params.ts both refuse that round trip for exactly this reason; this one was
 * quietly doing it.
 */
export function blockHref(id: BlockId, carried = searchWithout(location.search, "at")): string {
  return `${location.pathname}?${carried ? `${carried}&` : ""}at=${id}`;
}

/**
 * The same address with an origin on the front — what goes on the clipboard.
 *
 * `blockHref` returns a path, which is right for an `href` and useless in a
 * message to somebody else. Its own function rather than an argument to
 * `blockHref`, so the two callers cannot get the wrong one by omission: a
 * relative URL pasted into a chat window is not a broken link, it is a link to
 * whatever host the reader happens to be on, which is worse.
 */
export function blockPermalink(id: BlockId): string {
  return new URL(blockHref(id), location.origin).toString();
}

interface RefProps {
  id: BlockId;
  /** Jump without a page load. Falls back to a real navigation if absent. */
  onJump?(id: BlockId): void;
  className?: string;
  /**
   * The query pairs to carry, `at` already dropped, no leading `?`.
   *
   * Only the callers **inside `TableView`** pass this, and only because that
   * subtree is memoised — see `blockHref`. Everywhere else omits it and reads
   * the address bar, which is still correct there.
   */
  carried?: string;
}

export function BlockRef({ id, onJump, className, carried }: RefProps) {
  const href = blockHref(id, carried);
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    // Never let an ancestor's jump handler see this click, whatever we do with
    // it. `stopPropagation` does not touch the browser's own behaviour, so
    // ⌘-click still opens its tab.
    event.stopPropagation();
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (onJump) onJump(id);
    /* The same `href` the anchor is showing, rather than a second call. A link
       whose status bar and whose click disagree is a link, and a bug. */
    else navigate(href);
  }
  return (
    <a
      className={["block-ref", className].filter(Boolean).join(" ")}
      href={href}
      title={id}
      onClick={handle}
    >
      {shortBlockId(id)}
    </a>
  );
}

interface RangeProps {
  range: readonly [BlockId, BlockId];
  onJump?(id: BlockId): void;
  className?: string;
  /** Passed straight through to both ends — `RefProps.carried` says why. */
  carried?: string;
}

/**
 * The two ends of a node's block range, each its own link. The dash is not
 * inside either of them, so dragging across one id selects that id.
 */
export function BlockRange({ range, onJump, className, carried }: RangeProps) {
  const pass = { ...(onJump ? { onJump } : {}), ...(carried === undefined ? {} : { carried }) };
  return (
    <div className={["block-range", className].filter(Boolean).join(" ")}>
      <BlockRef id={range[0]} {...pass} />
      <span className="block-range-dash">–</span>
      <BlockRef id={range[1]} {...pass} />
    </div>
  );
}
