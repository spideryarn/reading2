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
import { navigate } from "./router.js";

/** `spya-k3m9qt` → `k3m9qt`. Anything not ours is shown untouched. */
export function shortBlockId(id: BlockId): string {
  return id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : id;
}

/**
 * This address, with `?at=` pointed at one block — every other bit of view
 * state (columns, mode, open dialog) carried along, so the link shows the block
 * *as the reader is currently looking at it*. See docs/project/url-state.md.
 *
 * Read from `location` during render rather than from a hook. That is safe here
 * because every parameter in the URL is `useQueryState` in App, so any change to
 * the query string re-renders this whole tree — there is no state the address
 * bar has that this component's last render didn't see.
 */
export function blockHref(id: BlockId): string {
  const params = new URLSearchParams(location.search);
  params.set("at", id);
  return `${location.pathname}?${params}`;
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
}

export function BlockRef({ id, onJump, className }: RefProps) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    // Never let an ancestor's jump handler see this click, whatever we do with
    // it. `stopPropagation` does not touch the browser's own behaviour, so
    // ⌘-click still opens its tab.
    event.stopPropagation();
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (onJump) onJump(id);
    else navigate(blockHref(id));
  }
  return (
    <a
      className={["block-ref", className].filter(Boolean).join(" ")}
      href={blockHref(id)}
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
}

/**
 * The two ends of a node's block range, each its own link. The dash is not
 * inside either of them, so dragging across one id selects that id.
 */
export function BlockRange({ range, onJump, className }: RangeProps) {
  return (
    <div className={["block-range", className].filter(Boolean).join(" ")}>
      <BlockRef id={range[0]} {...(onJump ? { onJump } : {})} />
      <span className="block-range-dash">–</span>
      <BlockRef id={range[1]} {...(onJump ? { onJump } : {})} />
    </div>
  );
}
