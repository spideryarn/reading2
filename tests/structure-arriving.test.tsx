// @vitest-environment jsdom
/**
 * **The line at the top of the Structure band while the real structure is on
 * its way** — `StructureArriving`,
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
 * § Stage 2 and § Review record (GPT Sol's F6 and F10).
 *
 * Three states and one boundary. The boundary is the reason this file exists:
 * the Structure band is the same component for an owner and for a visitor
 * (StructureMode.tsx § Owner and visitor get the same component), and **Build
 * it** starts a paid job. So the press is a capability handed in from the owned
 * side, and its absence is what a visitor has — no button, whatever the state.
 *
 * The band-level half — that the line is drawn in all three presentations — is
 * in tests/structure-mode-faces.test.tsx, beside the faces themselves.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STRUCTURE_ARRIVING,
  STRUCTURE_BUILD,
  STRUCTURE_READY_RELOAD,
  STRUCTURE_STALLED,
} from "../src/messages.js";
import type { Tree } from "../src/types.js";
import {
  StructureArriving,
  type StructureArrival,
  visitorArrival,
} from "../src/web/modes/structure/StructureArriving.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(arrival: StructureArrival) {
  act(() => {
    root.render(<StructureArriving arrival={arrival} />);
  });
}

const button = () => host.querySelector("button");
const text = () => (host.textContent ?? "").replace(/\s+/g, " ").trim();

describe("while the structure is being built", () => {
  it("says the outline is temporary, and offers nothing to press", () => {
    draw({ state: "building" });
    expect(text()).toBe(STRUCTURE_ARRIVING);
    expect(button()).toBeNull();
  });

  it("does not claim the rows are the author's headings (Sol F6)", () => {
    /* The stand-in cuts windows where there are no usable headings, and names
       them from their opening words (src/heading-tree.ts). */
    expect(STRUCTURE_ARRIVING).not.toMatch(/heading/i);
  });
});

describe("when it could not be built", () => {
  it("gives an owner Build it, and the press goes to the capability", () => {
    let pressed = 0;
    draw({
      state: "stalled",
      build: { press: () => void pressed++, starting: false, failed: null },
    });
    expect(text()).toContain(STRUCTURE_STALLED);
    expect(button()?.textContent).toBe(STRUCTURE_BUILD);

    act(() => button()?.click());
    expect(pressed).toBe(1);
  });

  it("gives a visitor the sentence and no button", () => {
    draw({ state: "stalled", build: null });
    expect(text()).toBe(STRUCTURE_STALLED);
    expect(button()).toBeNull();
  });

  it("cannot be pressed twice while the request is on its way", () => {
    let pressed = 0;
    draw({
      state: "stalled",
      build: { press: () => void pressed++, starting: true, failed: null },
    });
    expect(button()?.disabled).toBe(true);
    act(() => button()?.click());
    expect(pressed).toBe(0);
  });

  it("shows why a press was refused", () => {
    draw({
      state: "stalled",
      build: { press: () => {}, starting: false, failed: "You have no imports left. [pay-free]" },
    });
    expect(text()).toContain("You have no imports left.");
    expect(button(), "and the button is still there to try again").not.toBeNull();
  });
});

describe("when the blocks on screen are not the ones the structure was built from", () => {
  it("says to reload, and offers nothing to press", () => {
    draw({ state: "mismatch" });
    expect(text()).toBe(STRUCTURE_READY_RELOAD);
    expect(button()).toBeNull();
  });
});

describe("what a visitor is told", () => {
  const tree = (provisional?: Tree["provisional"]) => ({ provisional }) as Tree;

  it("is the building line while the tree is the stand-in", () => {
    expect(visitorArrival(tree("awaiting-structure"))).toEqual({ state: "building" });
  });

  it("is nothing for a real tree, or for the final headings fallback", () => {
    expect(visitorArrival(tree())).toBeNull();
    expect(visitorArrival(tree("headings"))).toBeNull();
  });
});
