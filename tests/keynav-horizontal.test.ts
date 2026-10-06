// @vitest-environment jsdom
/**
 * **← / → handed to a mode, and only while it asks** — `useArrowNav`'s optional
 * horizontal handler (docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § Keys, Sol F5).
 *
 * While Skim is the mode, ← / → step its stops; while Learn's Quiz
 * half is showing, they step its questions; everywhere else they are the
 * browser's (they moved the stride across Hierarchy's gist columns until
 * 2026-09-29). The existing guards hold for both: no modifiers, not while
 * typing, not when a widget nearer the keypress has already handled it, and no
 * auto-repeat. ↑ / ↓ are untouched either way.
 *
 * A DOM test for keynav-handled.test.ts's reason: the listener is on `window`,
 * so what decides is a real event travelling up a real DOM.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";

const jumps: string[] = [];
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return { ...real, scrollToBlock: (id: string) => void jumps.push(id) };
});

const { useArrowNav } = await import("../src/web/keynav.js");
type NavPlan = import("../src/web/keynav.js").NavPlan;

function block(i: number): Block {
  return {
    id: `spya-h${i}` as BlockId,
    tag: "p",
    kind: "text",
    text: `paragraph ${i}`,
    words: 20,
    html: "<p></p>",
    gistable: true,
  };
}

const blocks = Array.from({ length: 6 }, (_, i) => block(i));
/** Two levels: the fallback aim (0) steps by three rows. */
const plan: NavPlan = { starts: [[0, 3], [0, 1, 2, 3, 4, 5]] };

let container: HTMLDivElement;
let root: Root;
/** Every direction the horizontal handler was asked to step. */
let asked: number[];
/** What it answers — whether it took the key. */
let takes: boolean;

function Harness({ withHandler }: { withHandler: boolean }) {
  useArrowNav(
    plan,
    blocks,
    0,
    true,
    withHandler
      ? (dir) => {
          asked.push(dir);
          return takes;
        }
      : null,
  );
  return null;
}

async function mount(withHandler: boolean) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness, { withHandler }));
  });
}

beforeEach(() => {
  jumps.length = 0;
  asked = [];
  takes = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: HTMLElement = document.body,
  handled = false,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  const el = document.createElement("div");
  target.append(el);
  if (handled) el.addEventListener("keydown", (e) => e.preventDefault());
  act(() => {
    el.dispatchEvent(event);
  });
  el.remove();
  return event;
}

describe("with a horizontal handler (Skim or Quiz)", () => {
  beforeEach(async () => {
    await mount(true);
  });

  it("hands ← and → to the handler", () => {
    const right = press("ArrowRight");
    const left = press("ArrowLeft");
    expect(asked).toEqual([1, -1]);
    expect(right.defaultPrevented && left.defaultPrevented).toBe(true);
    expect(jumps, "a sideways key must not scroll the article").toEqual([]);
  });

  it("hands the key back to the browser when the handler has nowhere to go", () => {
    takes = false;
    const e = press("ArrowRight");
    expect(asked).toEqual([1]);
    expect(e.defaultPrevented).toBe(false);
  });

  it("keeps every guard", () => {
    press("ArrowRight", { shiftKey: true });
    press("ArrowRight", { metaKey: true });
    press("ArrowRight", { repeat: true });
    press("ArrowRight", {}, document.body, true);
    const input = document.createElement("input");
    document.body.append(input);
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    input.remove();
    expect(asked).toEqual([]);
  });

  /* A comment's dialog focuses its Close button and has ‹ › of its own; an
     arrow pressed there must not step the band behind it. GPT Sol's review of
     plan 260930h, finding 1. Both shapes the app uses: a hand-rolled
     `role="dialog"` and a native `<dialog>`. */
  it("does not step the band from inside a dialog", () => {
    for (const tag of ["aside", "dialog"] as const) {
      const dialog = document.createElement(tag);
      if (tag === "aside") dialog.setAttribute("role", "dialog");
      const button = document.createElement("button");
      dialog.append(button);
      document.body.append(dialog);
      const e = press("ArrowRight", {}, button);
      expect(e.defaultPrevented).toBe(false);
      dialog.remove();
    }
    expect(asked, "a key pressed in a dialog reached the band").toEqual([]);
    press("ArrowRight");
    expect(asked, "the control: the same key outside a dialog").toEqual([1]);
  });

  it("leaves ↑ and ↓ to the article", () => {
    press("ArrowDown");
    expect(asked).toEqual([]);
    expect(jumps).toEqual(["spya-h3"]);
  });
});

describe("without one (every other mode)", () => {
  beforeEach(async () => {
    await mount(false);
  });

  it("leaves ← and → to the browser", () => {
    const e = press("ArrowRight");
    expect(e.defaultPrevented).toBe(false);
    expect(jumps).toEqual([]);
  });

  it("still steps ↑ and ↓ — the control that the hook is listening at all", () => {
    const e = press("ArrowDown");
    expect(e.defaultPrevented).toBe(true);
    expect(jumps).toEqual(["spya-h3"]);
  });
});

/* **← / → as a stride of their own — Structure's sections**, since 2026-10-01
   (Greg, spya-b2wzjf: "left and right would jump to the previous or next
   low-level-heading/section"). Reader.tsx passes the section depth while
   Structure is the mode; here depth 1, the fine one, so its steps cannot be
   mistaken for ↓'s at the fallback depth 0.
   docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md. */
describe("with an across depth (Structure)", () => {
  function AcrossHarness({ withHandler }: { withHandler: boolean }) {
    useArrowNav(
      plan,
      blocks,
      0,
      true,
      withHandler
        ? (dir) => {
            asked.push(dir);
            return takes;
          }
        : null,
      1,
    );
    return null;
  }
  async function mountAcross(withHandler: boolean) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(AcrossHarness, { withHandler }));
    });
  }

  it("steps → at that depth, chaining, and ← back", async () => {
    await mountAcross(false);
    const e = press("ArrowRight");
    expect(e.defaultPrevented).toBe(true);
    press("ArrowRight");
    press("ArrowLeft");
    expect(jumps).toEqual(["spya-h1", "spya-h2", "spya-h1"]);
  });

  it("keeps the guards: not with a modifier, not from inside a dialog", async () => {
    await mountAcross(false);
    press("ArrowRight", { metaKey: true });
    const dialog = document.createElement("dialog");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    press("ArrowRight", {}, button);
    dialog.remove();
    expect(jumps).toEqual([]);

    /* Non-vacuity: the same key outside both guards really is owned. Without
       this control, deleting `acrossDepth` altogether leaves the assertion
       above green. */
    press("ArrowRight");
    expect(jumps).toEqual(["spya-h1"]);
  });

  it("leaves ↑ / ↓ at their own stride", async () => {
    await mountAcross(false);
    press("ArrowDown");
    expect(jumps).toEqual(["spya-h3"]);
  });

  it("gives way to a horizontal handler when a mode hands one in", async () => {
    await mountAcross(true);
    press("ArrowRight");
    expect(asked).toEqual([1]);
    expect(jumps).toEqual([]);
  });
});
