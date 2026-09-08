// @vitest-environment jsdom
/**
 * **Tab, in a browser that has one.**
 *
 * A5's modal/modeless checkbox asks that *"Tab, Shift-Tab, Escape, click-away
 * and return focus follow the declared contract"*. Escape is stage 3, click-away
 * and return focus are stage 5a — and **Tab cannot be tested in jsdom at all**.
 * Measured on this box, 2026-09-07, before any of this was designed:
 *
 * | | jsdom |
 * | --- | --- |
 * | `Tab` moves focus | **no** — dispatching the keydown leaves `activeElement` where it was |
 * | `dialog.showModal` | **absent**, along with `.show()` and `.close()` |
 * | `inert` | **absent** |
 *
 * All three of the mechanisms a focus trap is built from are missing, so a jsdom
 * test claiming to prove one asserts the behaviour of a fake.
 * `tests/the-dock-drawer-is-not-a-modal.test.tsx` says as much in its own
 * comment — *"Neither is Tab traversal itself, which jsdom does not have"* — and
 * tests the two mechanisms a trap would need instead. **This file is the
 * sentence that one could not finish.**
 *
 * ## Why the markup is rendered rather than written out
 *
 * `tests/mark-sign-in-chrome.test.ts` — the pattern this borrows, one Chrome,
 * one page, a real stylesheet inlined — writes its markup as a literal, and says
 * why: its subject is the *stylesheet*, so generating the HTML would make a
 * failure ambiguous between the two.
 *
 * Here the subject **is** the markup, so the opposite holds. These pages are
 * `renderToStaticMarkup` of the real components, so what Chrome walks is the DOM
 * those components actually produce. A hand-written copy would be a replica, and
 * a Tab order asserted over a replica is a fact about the test file. Effects do
 * not run under `renderToStaticMarkup` — which costs nothing here, because
 * sequential focus navigation is a property of the DOM and the top layer, not of
 * anything React does afterwards.
 *
 * ## What the two cases are
 *
 * They are the two halves of the contract, and the finding of the focus
 * inventory is that **almost everything in this app is the second one**: twelve
 * of seventeen surfaces have no focus trap, and for ten of those that is correct
 * and argued in their own docstrings.
 *
 * - **A native `<dialog>` shown with `showModal()` traps.** The platform does
 *   it; nothing in `src/` implements a trap. What is worth pinning is that the
 *   dialogs really are opened that way, because the day one becomes a `<div>`
 *   the trap goes silently.
 * - **A modeless `<aside role="dialog">` does not trap, on purpose.** The prose
 *   behind stays live — `CommentDialog` even dodges out of the way of a drag —
 *   and `aria-modal` appears nowhere in the app as an attribute. A test that
 *   demanded a trap here would be demanding a product change.
 *
 * **Skipped, loudly, where there is no Chrome**, the same way and for the same
 * reason as `mark-sign-in-chrome`: the remote box provisions one and Greg's Mac
 * has one, so on the two machines this repo runs on, it runs.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chromePath } from "../scripts/browser-sign-in.js";
import { AnnotateDialog } from "../src/web/AnnotateDialog.js";
import { Lightbox } from "../src/web/Lightbox.js";
import type { BlockId } from "../src/types.js";

/** Whether this machine can answer the question at all. */
const chrome = (() => {
  try {
    return chromePath();
  } catch {
    return null;
  }
})();

/**
 * The modeless annotation box, as it really renders: an `<aside role="dialog">`
 * holding a textarea and its buttons.
 */
const ANNOTATE = renderToStaticMarkup(
  createElement(AnnotateDialog, {
    anchor: { blockId: "spya-k3m9qt" as BlockId, quote: "a science of bumps", start: 0 },
    placing: false,
    onSave: () => {},
    onCancel: () => {},
  }),
);

/** The enlarged-figure overlay, which really is a `<dialog>`. */
const LIGHTBOX = renderToStaticMarkup(
  createElement(Lightbox, {
    figure: { html: "<p>a table, enlarged</p>", kind: "table" },
    onClose: () => {},
    onJump: () => {},
  }),
);

/**
 * An article with something focusable on either side of the surface, so
 * "walked out of it" has somewhere to be observed.
 */
const page = (surface: string) => `
  <a id="before" href="#">a link before</a>
  ${surface}
  <a id="after" href="#">a link after</a>
`;

describe.skipIf(chrome === null)("Tab, in a browser that has one", () => {
  /**
   * Walk `n` times from `startId` and report every id (or tag) focus lands on.
   * Ids rather than elements, because the assertion worth making is about *what
   * was reachable*, not about an exact sequence — see the note on `BODY` below.
   */
  async function walk(html: string, startId: string, n: number, showModal?: string) {
    if (chrome === null) throw new Error("no Chrome, and this should have been skipped");
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true, executablePath: chrome });
    try {
      const p = await browser.newPage();
      await p.setContent(page(html));
      if (showModal) await p.evaluate((s) => document.querySelector<HTMLDialogElement>(s)?.showModal(), showModal);
      await p.evaluate((id) => document.getElementById(id)?.focus(), startId);
      const seen: string[] = [];
      for (let i = 0; i < n; i++) {
        await p.keyboard.press("Tab");
        seen.push(
          await p.evaluate(() => {
            const at = document.activeElement as HTMLElement | null;
            return at?.id || at?.className || at?.tagName || "?";
          }),
        );
      }
      return seen;
    } finally {
      await browser.close();
    }
  }

  it(
    "walks out of a modeless dialog, because the prose behind it is deliberately still live",
    { timeout: 60_000 },
    async () => {
      /* Start inside the annotation box and keep going. A trap would cycle
         within it forever; the contract here is that it does not have one, so
         the link after the box must be reachable. */
      const seen = await walk(ANNOTATE, "before", 8);
      expect(seen).toContain("after");
      /* And it really did pass through the box on the way, rather than skipping
         a surface that was not rendered at all. */
      expect(seen.some((s) => s.includes("annotate") || s === "TEXTAREA")).toBe(true);
    },
  );

  it(
    "cannot walk out of a native dialog opened with showModal()",
    { timeout: 60_000 },
    async () => {
      /* **The assertion is "nothing outside was reached", not an exact
         sequence.** A modal's tab ring includes `BODY`, so pinning the order
         would make this brittle for a reason that has nothing to do with the
         behaviour — established by spiking it before writing this. */
      const seen = await walk(LIGHTBOX, "before", 6, "dialog");
      expect(seen).not.toContain("before");
      expect(seen).not.toContain("after");
    },
  );
});
