// @vitest-environment jsdom
/**
 * **The half of `useArrowNav` that decides whether a keypress was ours** — and
 * it is a DOM test because the bug it pins is not visible in a pure function.
 *
 * `useArrowNav` listens on `window`, in the bubble phase, so it sees every
 * arrow press in the app — including the ones a focused widget has already
 * dealt with. Before 2026-08-27 the Diagram picture's own ↑ / ↓ handler stepped
 * the roving tabstop one node **and** this handler stepped the article one
 * section, off the same press. Two distances, one key, and neither of them
 * wrong on its own: what the reader sees is a highlight and an article that
 * disagree about how far they just moved.
 *
 * Nothing throws, nothing looks broken in a screenshot, and every pure test in
 * tests/keynav.test.ts passes — `stepTarget` was never the thing that was
 * wrong. The only place the two handlers meet is a real event travelling up a
 * real DOM, so that is what this mounts.
 *
 * No testing-library — `act` and `createRoot` are all a hook test needs, the
 * same shape as tests/page-title-hook.test.ts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";

/** Where a step would have taken the reader, captured instead of animated. */
const jumps: string[] = [];
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return { ...real, scrollToBlock: (id: string) => void jumps.push(id) };
});

const { useArrowNav } = await import("../src/web/keynav.js");
type NavPlan = import("../src/web/keynav.js").NavPlan;

function block(i: number): Block {
  return {
    id: `spya-b${i}` as BlockId,
    tag: "p",
    kind: "text",
    text: `paragraph ${i}`,
    words: 20,
    html: "<p></p>",
    gistable: true,
  };
}

const blocks = Array.from({ length: 6 }, (_, i) => block(i));
/** One rung, stepping a row at a time — the simplest ladder that can move. */
const plan: NavPlan = { ladder: [0], starts: [[0, 1, 2, 3, 4, 5]] };

let container: HTMLDivElement;
let root: Root;

function Harness() {
  useArrowNav(plan, blocks, 0);
  return null;
}

beforeEach(async () => {
  jumps.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** A real keydown, from a real element, bubbling the whole way to `window`. */
function press(handled: boolean): void {
  const target = document.createElement("div");
  document.body.append(target);
  if (handled) {
    /* What the Diagram picture's own handler does. It has to run **during**
       dispatch — `preventDefault()` outside a dispatch is ignored — which is
       why this is a listener rather than a call on the event object. */
    target.addEventListener("keydown", (e) => e.preventDefault());
  }
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
  target.remove();
}

describe("useArrowNav and a widget that got there first", () => {
  it("steps the article when nobody else has claimed the key", () => {
    /* The control. A test for "it does nothing" that has never been watched
       doing something proves only that the wiring is dead — which is exactly
       what this file would look like if `useArrowNav` had failed to mount. */
    press(false);
    expect(jumps).toEqual(["spya-b1"]);
  });

  it("leaves the key alone when a focused widget has already handled it", () => {
    press(true);
    expect(jumps, "one press must not move the reader twice").toEqual([]);
  });

  it("goes back to stepping on the next unclaimed press", () => {
    /* The guard is per-event, not a mode. A picture that swallowed one arrow
       must not leave the article's own arrows dead afterwards. */
    press(true);
    press(false);
    expect(jumps).toEqual(["spya-b1"]);
  });
});
