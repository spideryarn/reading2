/**
 * An `<a>` that navigates in-page — and, just as importantly, an `<a>` that
 * still behaves like one.
 *
 * It renders a real `href`, so the status bar shows where it goes, ⌘-click
 * opens a tab, right-click offers "copy link address", and a crawler or a
 * screen reader sees a link rather than a div with a handler. The click handler
 * only takes over the plain left-click case, which is the one where a full page
 * reload would be a waste.
 *
 * See router.ts for why the routing here is thirty lines of our own.
 */
import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { navigate } from "./router.js";

/**
 * `ref` is spelled out because `AnchorHTMLAttributes` does not include it, and
 * something depends on it: a `<Tooltip>` gives its trigger a ref, and the
 * homepage masthead's links — Profile, and Admin for the administrator — are
 * triggers (Library.tsx). React 19 hands a
 * function component its `ref` as an ordinary prop, so the spread below already
 * carried it — but only by accident, with nothing to stop a later reader
 * replacing the spread with a list of named props and silently leaving Floating
 * UI without a reference element. tests/tooltip-on-link.test.tsx.
 */
type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
  /**
   * **This link is taking over, here, now.** Called after every check below has
   * passed and immediately before `navigate`, so it fires exactly when the
   * reader stays in this tab and this page is about to be replaced.
   *
   * `onClick` cannot answer that question and must not be used for it. It runs
   * *before* the checks — it has to, so that a handler above can
   * `preventDefault` — so a ⌘-click, a middle-click and a `target="_blank"` all
   * reach it, and every one of those leaves this tab exactly where it was.
   *
   * It exists for one caller: the bar's Tweets link mints an activation token
   * (src/web/activation.ts), and a token minted for a navigation that never
   * happened would sit pending in a tab that is not going to the thread, until
   * something else arrived to spend or retire it. Use `onClick` for anything
   * that is true of the *click*, and this for anything that is true of the
   * *navigation*.
   */
  onNavigate?: (() => void) | undefined;
};

export function Link({ href, onClick, onNavigate, ...rest }: Props) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // Every one of these means the reader asked for something other than
    // "follow this link here": a new tab, a new window, a download, a
    // handler above us that has already dealt with it.
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    event.preventDefault();
    /* Before `navigate`, not after: the page this mints a token for mounts
       synchronously inside it, and a token that arrived afterwards would meet a
       panel that had already asked whether one was pending. */
    onNavigate?.();
    navigate(href);
  }
  return <a href={href} onClick={handle} {...rest} />;
}
