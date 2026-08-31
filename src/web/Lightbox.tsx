/**
 * One figure, as big as the window will allow.
 *
 * Press the ⤢ on a picture, a table or a code block in the article and it opens
 * here — see `zoomable.ts` for how the button gets there, and
 * docs/plans/260828az-figures-in-the-prose.md for why this exists at all (the short
 * version: a data table rendered as a 423px-wide image is not readable, and the
 * file behind it is usually twice that).
 *
 * ## It is a native `<dialog>`, and that is the whole design
 *
 * The three panels this app already has — CommentDialog, ChatDialog,
 * AnnotateDialog — are hand-rolled `<aside role="dialog">`, deliberately: you
 * are meant to keep reading behind them. This one is the opposite. It covers the
 * article, and being a real modal is the point, so it is worth being the one
 * place that uses the platform's own.
 *
 * `showModal()` gives four things for free that the others each hand-roll:
 *
 * - **Escape closes it.** No `window` listener, so nothing to race with the
 *   drawer's or CommentDialog's (Dock.tsx § Escape closes the drawer has the
 *   story of two of those fighting).
 * - **The background goes `inert`** — not reachable by Tab, not clickable, not
 *   read by a screen reader.
 * - **Focus is trapped, and restored to the button that opened it** when the
 *   dialog closes. Both by spec, neither by us.
 * - **It is in the top layer**, so it paints above the spine (45), the dock
 *   (96), the colour picker (99) and the tooltip (100) *without joining the
 *   z-index budget at all* (design-css-overview.md § What is not written down
 *   yet calls that budget the most likely thing to break next; this adds
 *   nothing to it).
 *
 * Two things `<dialog>` does **not** do, and both are handled below:
 *
 * - **A click on the backdrop does not close it.** The `closedby="any"`
 *   attribute that would is still not everywhere in 2026, so the manual
 *   `e.target === dialog` test is the real mechanism and the attribute is left
 *   out rather than half-relied on.
 * - **The page behind can still scroll.** `overscroll-behavior: contain` on the
 *   scroller stops the chaining, which is the case that actually happens (a
 *   trackpad flick inside a tall figure). Locking `body` was rejected: this view
 *   writes the reading position from the scroll (`?at=`), and an overflow change
 *   that clamps `scrollTop` would move the reader's place in the article as a
 *   side effect of looking at a picture.
 *
 * The survey behind that choice — yet-another-react-lightbox, PhotoSwipe,
 * react-medium-image-zoom, react-zoom-pan-pinch — is in the plan. Every
 * image-first library assumes a gallery of pictures; the content here is
 * arbitrary sanitised HTML, which is exactly what a bare dialog takes.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { internalTarget } from "./internal-links.js";
import type { ZoomedFigure } from "./zoomable.js";

interface Props {
  /** The figure to show, or null when nothing is open. */
  figure: ZoomedFigure | null;
  onClose(): void;
  /**
   * The reader followed one of the article's own `#spya-…` links from inside
   * the enlarged copy. Close, then go there.
   *
   * **This is not a nicety.** A wide table is exactly the kind of thing that
   * links back into the article, and the delegated handler that gives every
   * other internal link its behaviour lives on the reading table's `<tbody>` —
   * which this dialog is not inside. Left alone the browser does its own hash
   * jump: the target lands underneath two sticky bars, `?at=` goes on claiming
   * the reader never moved, and all of it happens *behind* an overlay that is
   * still open. internal-links.ts § A native hash jump is the same story from
   * the other end. GPT Sol, 2026-08-28.
   */
  onJump(blockId: string): void;
}

export function Lightbox({ figure, onClose, onJump }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  /**
   * Whether *we* are the ones closing it.
   *
   * `close()` fires the same `close` event Escape does, so without this the
   * parent's own "shut the lightbox" would come straight back as a second
   * `onClose` — harmless today, and exactly the kind of loop that stops being
   * harmless the moment `onClose` does anything but clear a state.
   */
  const closingOurselves = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (figure && !dialog.open) {
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!figure && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [figure]);

  return (
    /* biome-ignore lint/a11y/useKeyWithClickEvents: the click handled here is
       the backdrop, whose keyboard equivalent is Escape — which the element
       implements itself. A keydown listener would be a second, worse copy. */
    <dialog
      ref={ref}
      className={`lightbox lightbox-${figure?.kind ?? "none"}`}
      aria-label="Figure, enlarged"
      onClose={() => {
        if (closingOurselves.current) return;
        onClose();
      }}
      /* Light dismiss. The <dialog> box fills the viewport and the panel sits
         inside it, so "the target is the dialog itself" means "the press landed
         outside the panel" — including on the dimmed area, which is the
         ::backdrop painted underneath. */
      onClick={(e) => {
        if (e.target === ref.current) return onClose();
        /* An internal link inside the enlarged copy — see `onJump`. Everything
           else is left alone: an outbound link is a link, and a modified click
           is the reader asking for a new tab, which works because the href is a
           real fragment (main.tsx turns an arriving `#spya-…` into `?at=`).
           `internalTarget` returns null for a fragment this document cannot
           answer, and null means "leave it to the browser". */
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const blockId = internalTarget(e.target as Element, document);
        if (!blockId) return;
        e.preventDefault();
        onClose();
        onJump(blockId);
      }}
    >
      <div className="lightbox-panel">
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.75} />
        </button>
        {/* `.prose` so a table keeps the article's own table styling rather
            than needing a second description of it here. The html is the
            article's, sanitised at ingress (src/web/sanitize.ts) and stripped
            of its `id`s by the caller so nothing in the document is duplicated
            while this is open. */}
        {figure && (
          <div
            className="lightbox-content prose"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: the article's own html, sanitised at ingress
            dangerouslySetInnerHTML={{ __html: figure.html }}
          />
        )}
      </div>
    </dialog>
  );
}
