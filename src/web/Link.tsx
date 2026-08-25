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
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "./router.js";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export function Link({ href, onClick, ...rest }: Props) {
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
    navigate(href);
  }
  return <a href={href} onClick={handle} {...rest} />;
}
