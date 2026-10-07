// @vitest-environment jsdom
/**
 * **Pressing a term's occurrence chip moves the ‹ › stepper to it**, so Next
 * goes on from where the reader clicked.
 *
 * The chips called `onJump` directly and only the stepper's own arrows recorded
 * the block, so a reader who pressed the second of three chips and then Next was
 * taken to the second again: the counter still said 1. `BlockNav.onGo` records
 * the block; the chip's jump now does the same.
 * docs/plans/261007a-ui-sweep-umbrella.md § K4 (G2-07).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, GlossaryEntry } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/* Every use is "on screen" in jsdom (no layout), and the stepper only moves
   the page for one that is not; said outright so the arrows always jump. */
vi.mock("../src/web/scroll.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/scroll.js")>("../src/web/scroll.js");
  return { ...real, isBlockOnScreen: () => false };
});

const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");

const USES = ["spya-aaaaaa", "spya-bbbbbb", "spya-cccccc"] as BlockId[];
const ENTRY = {
  id: "spya-kennedy",
  name: "John F. Kennedy",
  kind: "person",
  aliases: [],
  background: "",
  senseHere: "The president the piece is about.",
  difficulty: 0.3,
  centrality: 0.5,
  blocks: USES,
} as unknown as GlossaryEntry;

let host: HTMLDivElement;
let root: Root;
let jumps: string[] = [];

beforeEach(async () => {
  jumps = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(GlossaryPanel, {
        access: { kind: "visitor", glossary: { entries: [ENTRY] } },
        termId: ENTRY.id,
        onTerm: () => {},
        sort: "prioritised",
        onSort: () => {},
        gate: null,
        onGate: () => {},
        onJump: (id: BlockId) => void jumps.push(id),
        onAskChat: () => {},
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const chips = () => [...host.querySelectorAll<HTMLAnchorElement>(".gloss-where a")];
const count = () => host.querySelector(".gloss-where .cmt-count")?.textContent?.replace(/\s+/g, " ").trim();
const arrow = (name: string) =>
  host.querySelector<HTMLButtonElement>(`.gloss-where button[aria-label="${name} use"]`)!;
const press = (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });

describe("a glossary term's occurrence chips and its stepper", () => {
  it("draws a chip for each use and starts on the first", () => {
    expect(chips()).toHaveLength(3);
    expect(count()).toBe("1 / 3");
  });

  it("Next goes on from the chip the reader pressed", async () => {
    await press(chips()[1]!);
    expect(jumps).toEqual(["spya-bbbbbb"]);
    expect(count(), "the stepper did not hear about the chip").toBe("2 / 3");
    await press(arrow("Next"));
    expect(jumps.at(-1)).toBe("spya-cccccc");
    expect(count()).toBe("3 / 3");
  });

  it("Previous goes back from the chip the reader pressed", async () => {
    await press(chips()[2]!);
    expect(count()).toBe("3 / 3");
    await press(arrow("Previous"));
    expect(jumps.at(-1)).toBe("spya-bbbbbb");
  });
});
