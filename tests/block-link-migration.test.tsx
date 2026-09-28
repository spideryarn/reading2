// @vitest-environment jsdom
/**
 * **The hand-rolled "go to this passage" buttons that became block links** —
 * stage 2 of docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md
 * (Sol's F3 is the list).
 *
 * Each one was a `<button onClick={() => onJump(id)}>` around a quote or a
 * phrase, and so had none of what a link gives: no address in the status bar, no
 * "copy link address", no ⌘-click into a new tab, and no card. Each is now a
 * `BlockRef` with children, so the three things asserted here are the three a
 * button could not do and an anchor must:
 *
 *  1. it is an `a[data-block-link=<id>]` whose `href` carries `at=` — the one
 *     card listens for the attribute, and the href is where the block is;
 *  2. a plain left-click still jumps in place, exactly once;
 *  3. a ⌘-click does **not** jump — it is the browser's, to open a tab.
 *
 * The Criteria placement (the fourth migrated site) is in tests/referee-gap.test.tsx,
 * next to the harness that already renders that band; the stay-button callers
 * are asserted there too where it was cheap.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Claim, ClaimsRun } from "../src/referee-claims.js";
import type { Block, BlockId } from "../src/types.js";
import { ClaimsView } from "../src/web/ClaimsPanel.js";
import type { ClaimsApi } from "../src/web/useClaims.js";
import { SketchView } from "../src/web/SketchView.js";
import type { PublicSketch } from "../src/public-types.js";

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const CLAIM_AT = "spya-anc234" as BlockId;
const PASSAGE_AT = "spya-cmr456" as BlockId;
const OTHER_AT = "spya-dfw567" as BlockId;

const CLAIM: Claim = {
  id: `${CLAIM_AT}:8`,
  blockId: CLAIM_AT,
  quote: "the method halves annotation time",
  start: 8,
  claim: "The method halves annotation time",
  passages: [{ blockId: PASSAGE_AT, quote: "fell by about half", start: 0, reasoning: "the timing" }],
  discarded: 0,
};

const RUN: ClaimsRun = { status: "done", createdAt: "2026-09-01T00:00:00.000Z", claims: [CLAIM] };

const API: ClaimsApi = {
  run: RUN,
  stale: false,
  loaded: true,
  loadFailed: false,
  pull: () => {},
  error: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function press(el: Element, init: MouseEventInit = {}): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
  });
}

/**
 * The three things, for one link. `jumped` is the caller's `onJump` log, which
 * this empties before each press so the counts are this link's alone.
 */
function expectBlockLink(link: Element | null, id: BlockId, jumped: BlockId[]): void {
  expect(link, `no a[data-block-link="${id}"] — still a button?`).not.toBeNull();
  const a = link as HTMLAnchorElement;
  expect(a.tagName).toBe("A");
  expect(a.getAttribute("href") ?? "").toContain(`at=${id}`);
  // Named by its children, not by the raw id.
  expect(a.hasAttribute("aria-label")).toBe(false);
  expect(a.querySelector("button, a"), "interactive content inside a link").toBeNull();

  jumped.length = 0;
  press(a, { metaKey: true });
  expect(jumped, "a ⌘-click jumped in place instead of leaving it to the browser").toEqual([]);

  press(a);
  expect(jumped, "a plain click should jump exactly once").toEqual([id]);
}

describe("Claims: the quoted passages are block links", () => {
  function render(jumped: BlockId[]) {
    act(() => {
      root.render(
        createElement(ClaimsView, {
          api: API,
          claims: [CLAIM],
          otherText: [{ blockId: OTHER_AT, text: "uses less peak memory than the allocator,", start: 74 }],
          slots: new Map([[CLAIM.id, 0]]),
          showing: [],
          onToggle: () => {},
          onJump: (id: BlockId) => jumped.push(id),
        }),
      );
    });
  }

  it("the claim's own quote", () => {
    const jumped: BlockId[] = [];
    render(jumped);
    const link = host.querySelector(`a.clm-jump[data-block-link="${CLAIM_AT}"]`);
    expectBlockLink(link, CLAIM_AT, jumped);
    // The words are beside the link already, so the card says only where.
    expect(link?.getAttribute("data-block-preview")).toBe("off");
  });

  it("each passage the model found", () => {
    const jumped: BlockId[] = [];
    render(jumped);
    expectBlockLink(host.querySelector(`a.clm-jump[data-block-link="${PASSAGE_AT}"]`), PASSAGE_AT, jumped);
  });

  it("the other text inside the quoted passages", () => {
    const jumped: BlockId[] = [];
    render(jumped);
    expectBlockLink(host.querySelector(`a.clm-jump[data-block-link="${OTHER_AT}"]`), OTHER_AT, jumped);
  });

  it("leaves no clm-jump a button", () => {
    render([]);
    expect(host.querySelectorAll("button.clm-jump")).toHaveLength(0);
    expect(host.querySelectorAll("a.clm-jump")).toHaveLength(3);
  });
});

describe("Sketch: the card's 'Go to this passage'", () => {
  const BLOCKS: Block[] = [
    { id: "spya-b2" as BlockId, tag: "p", kind: "text", text: "one two three", words: 3, html: "<p>one two three</p>", gistable: true },
    { id: "spya-b3" as BlockId, tag: "p", kind: "text", text: "four five six", words: 3, html: "<p>four five six</p>", gistable: true },
  ];
  const SKETCH = {
    title: "The shape of it",
    caption: "Down the page is time",
    scenes: [
      {
        id: "overview",
        title: "The shape of it",
        height: 600,
        items: [
          { kind: "node", id: "claim", shape: "box", x: 200, y: 100, w: 200, h: 60, text: "a claim", size: "sm", block: "spya-b3" },
        ],
      },
    ],
  } as unknown as PublicSketch;

  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  it("is a block link with the passage in its card", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    for (const [prop, value] of [["clientWidth", 340], ["clientHeight", 700]] as const) {
      Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
    }
    const jumped: BlockId[] = [];
    act(() => {
      root.render(
        createElement(SketchView, {
          access: { kind: "visitor", sketch: SKETCH },
          blocks: BLOCKS,
          atRow: 0,
          onJump: (id: BlockId) => jumped.push(id),
        }),
      );
    });
    /* With nothing hovered the card describes the focused node — the first,
       and here the only — so the link is on screen without a pointer. */
    const link = host.querySelector('a.sk-card-jump[data-block-link="spya-b3"]');
    expectBlockLink(link, "spya-b3" as BlockId, jumped);
    expect(link?.textContent).toBe("Go to this passage");
    /* The Sketch card shows the node's own words, not the paragraph's, so the
       block card keeps its preview. */
    expect(link?.hasAttribute("data-block-preview")).toBe(false);
  });
});
