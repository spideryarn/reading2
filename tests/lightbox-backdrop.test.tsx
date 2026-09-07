// @vitest-environment jsdom
/**
 * **The Lightbox's light dismiss — the one route out of it that nothing tested.**
 *
 * `Lightbox.tsx` is a native `<dialog>` on purpose, and its own header explains
 * why: Escape, the inert background, the focus trap and the top layer are the
 * platform's and are not ours to test. What *is* ours is the one thing
 * `<dialog>` does not do — **a press on the backdrop does not close it** — and
 * the three lines that add it:
 *
 * ```
 * onClick={(e) => { if (e.target === ref.current) return onClose(); … }}
 * ```
 *
 * **Why the target comparison is the whole mechanism.** A modal `<dialog>`'s
 * `::backdrop` is not a separate element. A press on the dimmed area is
 * delivered with the dialog itself as the target; a press on anything the
 * dialog contains arrives with that child as the target and bubbles up through
 * the same handler. So one equality test tells "outside" from "inside" — and
 * dropping it turns every press on the enlarged figure into a dismissal, which
 * for a wide data table means the reader loses the picture by touching it.
 *
 * jsdom has no `showModal` and no `::backdrop`, and needs neither: the handler
 * compares targets and nothing else. What jsdom cannot show is that a real
 * backdrop press *does* target the dialog — that is the platform's contract,
 * and it is why the assertion is written against the target rather than against
 * a pixel. tests/feedback-dialog.test.tsx § *the backdrop* pins the identical
 * three lines in the other dialog and carries the measurement of how much of
 * this was unprotected before 2026-09-07.
 *
 * `showModal`/`close` are stubbed below, the same stand-in
 * tests/feedback-dialog.test.tsx and tests/command-bar.test.tsx use: jsdom
 * implements neither and `open` is a real attribute, so the honest replacement
 * is the pair of methods setting it.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Lightbox } from "../src/web/Lightbox.js";
import type { ZoomedFigure } from "../src/web/zoomable.js";

/* A table rather than an image, because a table is the case the lightbox exists
   for — see its header — and because a real element inside the panel is what
   test two needs a target from. */
const FIGURE: ZoomedFigure = {
  html: "<table><tbody><tr><td>a cell somebody wants to read</td></tr></tbody></table>",
  kind: "table",
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * Mount it the way the reading view does — with the figure in a parent's state,
 * so `onClose` genuinely closes.
 *
 * Handing it a constant `figure` and an `onClose` that does nothing would leave
 * the dialog nailed open, which is exactly the arrangement in which a deleted
 * `onClose()` still passes.
 */
function mountOpen(): HTMLDialogElement {
  function Harness() {
    const [figure, setFigure] = useState<ZoomedFigure | null>(FIGURE);
    return createElement(Lightbox, {
      figure,
      onClose: () => setFigure(null),
      onJump: () => {},
    });
  }
  act(() => root.render(createElement(Harness)));
  const dialog = host.querySelector("dialog");
  if (!dialog) throw new Error("no dialog");
  return dialog;
}

describe("the backdrop", () => {
  it("closes on a press whose target is the dialog itself", () => {
    const dialog = mountOpen();
    expect(dialog.open, "it never opened, so nothing below means anything").toBe(true);
    act(() => {
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog.open).toBe(false);
  });

  it("stays open when the press lands on something inside it", () => {
    const dialog = mountOpen();
    const panel = dialog.querySelector(".lightbox-panel");
    expect(panel, "no panel inside the dialog to press").not.toBeNull();
    act(() => {
      panel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* Without the comparison this press would dismiss the figure the reader is
       in the middle of reading — and a wide table is the thing people press on,
       to scroll it. */
    expect(dialog.open).toBe(true);
  });
});
