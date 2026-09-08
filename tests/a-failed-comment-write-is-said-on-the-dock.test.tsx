// @vitest-environment jsdom
/**
 * **A comment that did not save says so on the Dock, in three places.**
 *
 * It used to say so in the controls bar, as a `.cmt-transport-error` chip. That
 * bar is drawn only when it has something in it since 2026-09-08 (layout.ts
 * § `barHasContent`), so leaving the chip there would have made a refused
 * delete summon 44px of chrome and push the article down mid-read — which was
 * named in
 * docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md as
 * the last argument against not drawing the bar at all. It moved to the control
 * the failure is about.
 *
 * ## Why three carriers, and why a test rather than a look
 *
 * **A hover card is unreachable by touch and by keyboard**, so it may never be
 * the only place a fact lives (docs/project/tooltips.md, and `NOT_A_MODE` in
 * Dock.tsx makes the same argument about a visitor's marked modes). So the
 * failure is carried by a visible mark, by an `sr-only` node the button points
 * `aria-describedby` at, and by a sentence at the top of the drawer the button
 * opens — and losing any one of them is invisible in a screenshot, which is
 * what makes this a file rather than a browser pass.
 *
 * The fourth assertion is the one with no user-facing shape at all:
 * `fitSignature` has to see `12` become `!`, or the bar keeps the rung it was
 * measured for while the chip changes width (Dock.tsx § the bar's fit ladder).
 *
 * **What is deliberately NOT asserted here** is that the accessible *name*
 * changes, because it must not. The name stays "Comments" whatever has happened
 * to it — § the switch itself states the rule and GPT Sol caught a breach of it
 * there — and the second case below fails if a later edit puts the state back
 * into the name.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Comment } from "../src/types.js";
import { Dock, fitSignature } from "../src/web/Dock.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

/** One marked passage, so the count has something to be replaced. */
const MARKED: Comment = {
  id: "cmt-1",
  blockId: "spya-k3m9qt",
  quote: "the sentence he marked",
  start: 0,
  createdAt: "2026-09-08T10:00:00.000Z",
  status: "none",
};

/** What `useComments` hands over: a sentence already written for the reader. */
const REFUSED = "That didn't save. Trying again usually works.";

let host: HTMLDivElement;
let root: Root;

/**
 * The bar, as the owner of the article.
 *
 * **`panel` is a parameter and defaults to shut**, which is the state a reader
 * is in when the failure happens: the mark and the description are on the bar
 * itself, and a suite that only ever rendered the drawer open would pass
 * against an implementation that drew them only there. GPT Sol, reviewing the
 * built code.
 */
function paint(
  error: string | null,
  { panel = null, loadFailed = false }: { panel?: "questions" | null; loadFailed?: boolean } = {},
): void {
  act(() => {
    root.render(
      createElement(Dock, {
        slug: "a-piece",
        view: "article" as const,
        experimental: EXPERIMENTAL_OFF,
        drawer: {
          comments: [MARKED],
          loaded: true,
          loadFailed,
          error,
          panel,
          onPanel: () => {},
          onOpenComment: () => {},
        },
      }),
    );
  });
}

const commentsButton = () =>
  host.querySelector<HTMLElement>('button[aria-label="Comments"]');

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a comment write that failed", () => {
  it("marks the button, in the count's own slot rather than beside it", () => {
    paint(REFUSED);
    const mark = host.querySelector(".dock-count.failed");
    expect(mark?.textContent?.trim()).toBe("!");
    /* The count is *replaced*. A mark beside a number would widen the row on a
       width nobody measured — § the bar's fit ladder. */
    expect(host.querySelectorAll(".dock-count")).toHaveLength(1);
    expect(host.textContent).not.toContain("1");
  });

  it("says it in words for a screen reader, as a description and not as the name", () => {
    paint(REFUSED);
    const btn = commentsButton();
    /* The name is unchanged, which is the assertion as much as the description
       is: a name that moved would change the control's identity, and break
       driving the bar by voice. */
    expect(btn?.getAttribute("aria-label")).toBe("Comments");

    const id = btn?.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    /* `getElementById` rather than a `#id` selector: React's `useId` produces
       `«r0»`, which is a perfectly legal id and not a legal selector, and jsdom
       has no `CSS.escape` to fix it up with. */
    expect(document.getElementById(id as string)?.textContent).toContain("didn't save");
    /* The mark itself is hidden from the same reader, or the glyph is announced
       on top of the sentence. */
    expect(host.querySelector(".dock-count.failed")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the sentence in the drawer, which is the carrier a finger can reach", () => {
    paint(REFUSED, { panel: "questions" });
    expect(host.querySelector(".dock-drawer-error")?.textContent).toBe(REFUSED);
  });

  it("draws none of it when nothing has failed", () => {
    // The half that stops "always mark it" passing the three above.
    paint(null, { panel: "questions" });
    expect(host.querySelector(".dock-count.failed")).toBeNull();
    expect(host.querySelector(".dock-drawer-error")).toBeNull();
    expect(commentsButton()?.getAttribute("aria-describedby")).toBeNull();
    // …and the count is back.
    expect(host.querySelector(".dock-count")?.textContent).toBe("1");
  });

  /**
   * **A load that failed is not a write that failed**, and `useComments` makes
   * them arrive together: the opening GET's failure path sets `error` *and*
   * `loadFailed` (useComments.ts § the load), so this state is reachable and is
   * not a fixture invented to be awkward.
   *
   * Announcing it here would tell a reader who has changed nothing that a
   * change of theirs did not save, and then say it twice in the drawer — once
   * in this voice and once in `Questions`', which draws its own from
   * `loadFailed`. GPT Sol's P1 on the built code; the first version did exactly
   * that.
   */
  it("says nothing about saving when it was the load that failed", () => {
    paint("Couldn't reach the server.", { panel: "questions", loadFailed: true });
    expect(host.querySelector(".dock-count.failed")).toBeNull();
    expect(host.querySelector(".dock-drawer-error")).toBeNull();
    expect(commentsButton()?.getAttribute("aria-describedby")).toBeNull();
  });

  /**
   * **The card still describes the button, note or no note.**
   *
   * `mergeProps` in `@floating-ui/react` applies the child's props *last*, so
   * `DockTab`'s own `aria-describedby` overwrote the card's id — and React puts
   * that key in `props` even when the JSX wrote `undefined`, so it did so in
   * every state, not only the failing one. Every Comments tooltip in the app
   * stopped being the button's description and nothing said so.
   * `Tooltip` joins the two ids now (Tooltip.tsx § a trigger that already
   * describes itself); this is what says it still does.
   *
   * Driven through a real `mouseenter` rather than by calling the hook, because
   * what is being asserted is the composition floating-ui does on the way out.
   */
  it("keeps the hover card as its description, with a note and without one", async () => {
    for (const error of [null, REFUSED]) {
      /* A fresh mount per case. `paint` re-renders the same tree, and the card's
         open/closed state lives in it — so a second hover in the same tree would
         start from a card that was already open, and `before` would already
         carry its id. That is what this loop did on its first run. */
      act(() => root.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);

      paint(error);
      const btn = commentsButton();
      const before = btn?.getAttribute("aria-describedby") ?? "";
      await act(async () => {
        btn?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        btn?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 450)); // past the 300ms open delay
      });
      const after = commentsButton()?.getAttribute("aria-describedby") ?? "";
      /* The card's id is an *addition*, so the open state names at least as many
         things as the closed one, and never fewer. */
      expect(after.split(" ").filter(Boolean).length).toBeGreaterThan(
        before.split(" ").filter(Boolean).length,
      );
      /* And whatever the button described before, it still describes. */
      for (const id of before.split(" ").filter(Boolean)) expect(after).toContain(id);
      /* Every id it names is an element that exists — a dangling reference is
         announced as nothing by some readers and as the id itself by others. */
      for (const id of after.split(" ").filter(Boolean)) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });

  it("changes the fit signature, so the row is re-measured rather than left on its rung", () => {
    const rest = [[], undefined, undefined] as const;
    const saved = fitSignature(rest[0], rest[1], rest[2], undefined, { comments: [MARKED], error: null }, null, false);
    const failed = fitSignature(rest[0], rest[1], rest[2], undefined, { comments: [MARKED], error: REFUSED }, null, false);
    expect(saved).not.toBe(failed);
    /* And the count alone is not enough to tell them apart, which is why the
       signature reads the chip rather than `comments.length`. */
    expect(saved).toContain("|1|");
    expect(failed).toContain("|!|");
  });
});
