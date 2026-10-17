/**
 * **The "Save for Spideryarn" link: installed by dragging, never run here.**
 *
 * The bookmarklet itself is src/web/save-page-bookmarklet.ts. This is where a
 * reader picks it up: under the Upload control on an add page whose site turned
 * us away (UploadInstead.tsx), because that is the moment they learn they need
 * it. docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md § Stage 2.
 *
 * - **The `href` is set through a ref after mount.** React 19 refuses a
 *   `javascript:` href in JSX (it swaps in one that throws, "React has blocked a
 *   javascript: URL"). It is built from our own constant, never from data.
 * - **A click or Enter does nothing but say so.** Followed here, it would save
 *   Spideryarn's own page. Dragging keeps the `href`, which is the install.
 * - **Only where the primary pointer is fine** (`(pointer: fine)`): a mouse or
 *   a trackpad, which can drag to a bookmarks bar. A phone or a bare iPad has a
 *   coarse one and no bar to drag to; a touchscreen laptop's primary pointer is
 *   still fine, so it gets the link. "Cannot tell" (no `matchMedia`) draws
 *   nothing. GPT Sol, plan review round 2 (R2-6).
 */
import { Bookmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bookmarkletHref } from "./save-page-bookmarklet.js";
import { media } from "./media.js";

export function SavePageBookmarklet() {
  const [canDrag] = useState(() => media("(pointer: fine)"));
  const [clicked, setClicked] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);

  /* Runs once; without a fine pointer there is no link, and `canDrag` never changes. */
  useEffect(() => {
    link.current?.setAttribute("href", bookmarkletHref());
  }, []);

  if (!canDrag) return null;

  const anchor = (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the href is a javascript: URL React 19 will not render, so the ref sets it after mount, and then this is an ordinary link; a click (or Enter, which is a click on a link) is meant to do nothing but say so.
    <a
      ref={link}
      draggable
      // biome-ignore lint/a11y/useValidAnchor: the href is set after mount (above); this click is the one that must not run the bookmarklet here.
      onClick={(e) => {
        e.preventDefault();
        setClicked(true);
      }}
      title="Drag this to your bookmarks bar"
      className="tw:inline-flex tw:cursor-grab tw:items-center tw:gap-1 tw:rounded-md tw:border tw:border-border tw:px-2 tw:py-0.5 tw:text-foreground tw:no-underline"
    >
      <Bookmark size={14} aria-hidden="true" />
      Save for Spideryarn
    </a>
  );

  return (
    <div className="tw:mt-3 tw:text-sm tw:text-muted-foreground">
      <p className="tw:mb-1">
        Next time, drag Save for Spideryarn to your bookmarks bar. On a page that turns us away, click it,
        then upload the file it saves.
      </p>
      {anchor}
      {clicked && (
        <span role="status" className="tw:ml-2">
          Drag it to your bookmarks bar; it works on the article's page, not here.
        </span>
      )}
    </div>
  );
}
