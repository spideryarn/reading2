// @vitest-environment jsdom
/**
 * **The `+N sections` badge is a control even when the Depth cut-off is what
 * hid those sections**, and the twist above the part closes them again.
 *
 * Greg, 2026-08-27:
 *
 * > when it has collapsed more granular levels, the only way to see the more
 * > granular levels is to switch articles -> parts -> sections. Could we make
 * > it easier to see them for this part of the doc (e.g. click `+N sections`
 * > to expand those, and click the parent again to collapse)?
 *
 * The thing worth a test rather than a look is that **it must not move the
 * Depth buttons**: opening one part past the cut-off has to leave every other
 * part shut and `onDeep` untouched, which is the difference between a per-node
 * override and a control that silently overrules the one above it. A panel
 * that expanded everything would look right in a screenshot of the part you
 * clicked.
 *
 * The other half is `currentEntryId`, which walks the same rule for the follow
 * and used to write it out a second time. If the two disagree the panel
 * scrolls to an element that is not on screen, which moves nothing and reports
 * nothing — docs/reusable/silent-success.md. Both now call `showsChildren`,
 * and the last case here is what keeps them calling it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/* Every update here goes through `act`, so say so — otherwise React logs
   "the current testing environment is not configured to support act(...)" on
   each render and the file passes while shouting. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TreeNode } from "../src/types.js";
import { SummaryPanel } from "../src/web/SummaryPanel.js";
import { currentEntryId, showsChildren, type SummaryNode } from "../src/web/tree.js";

/* A two-part article, three sections each, built by hand — the join from
   tree.json is buildSummaryTree's business and is not what is under test. */
function node(
  id: string,
  depth: number,
  title: string,
  parent: string | null,
  children: string[] = [],
): TreeNode {
  return {
    id,
    depth,
    title,
    /* `parent` and `children` are what a TreeNode is threaded on, so the
       fixture states them rather than casting past them: the panel reads only
       id, depth, title and range, but a node that claimed no parent would be
       a different shape from anything stage 5 writes. */
    parent,
    children,
    range: [`spya-${id}a`, `spya-${id}z`],
    gist: `The gist of ${title}.`,
  };
}

function section(id: string, title: string, row: number, parent: string): SummaryNode {
  return {
    node: node(id, 2, title, parent),
    number: id,
    startRow: row,
    endRow: row,
    blocks: 1,
    gist: `The gist of ${title}.`,
    children: [],
  };
}

function tree(): SummaryNode {
  const one = [
    section("1.1", "Alpha", 0, "1"),
    section("1.2", "Beta", 1, "1"),
    section("1.3", "Gamma", 2, "1"),
  ];
  const two = [
    section("2.1", "Delta", 3, "2"),
    section("2.2", "Epsilon", 4, "2"),
    section("2.3", "Zeta", 5, "2"),
  ];
  const ids = (kids: SummaryNode[]) => kids.map((k) => k.node.id);
  return {
    node: node("root", 0, "The whole thing", null, ["1", "2"]),
    number: "",
    startRow: 0,
    endRow: 5,
    blocks: 6,
    gist: "The gist of the whole thing.",
    children: [
      { node: node("1", 1, "First part", "root", ids(one)), number: "1", startRow: 0, endRow: 2,
        blocks: 3, gist: "The gist of the first part.", children: one },
      { node: node("2", 1, "Second part", "root", ids(two)), number: "2", startRow: 3, endRow: 5,
        blocks: 3, gist: "The gist of the second part.", children: two },
    ],
  };
}

let host: HTMLDivElement;
let root: Root;
const deeps: number[] = [];

/* `deep` is the caller's state in the app, so the harness passes it in and
   records what the panel asks for rather than moving it. */
const panel = (deep: number) =>
  createElement(SummaryPanel, {
        status: "none",
        summaries: null,
        stale: false,
        profiled: false,
        profileChanged: false,
        hasProfile: false,
        error: null,
        job: null,
        failed: null,
        write: async () => {},
        cancel: () => {},
        root: tree(),
        blocks: new Map(),
        rung: "gist",
    onRung: () => {},
    deep,
    onDeep: (d: number) => deeps.push(d),
    atRow: null,
    onJump: () => {},
  });

beforeEach(() => {
  deeps.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // "parts": the state in Greg's screenshot, where every section is below the
  // cut-off and the badges are the only way to reach one.
  act(() => {
    root.render(panel(1));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const titles = () => [...host.querySelectorAll(".summ-title")].map((b) => b.textContent ?? "");
const badges = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".summ-more")].map((b) => b.textContent ?? "");
/* The entry whose OWN title says this — `:scope >` throughout, because an open
   `<li>` contains its whole subtree and a plain descendant query would hand
   back the root row for every name in the outline. */
const entryFor = (part: string): HTMLLIElement => {
  const entry = [...host.querySelectorAll<HTMLLIElement>("li.summ-entry")].find((li) =>
    li.querySelector(":scope > .summ-body .summ-title")?.textContent?.includes(part),
  );
  if (!entry) throw new Error(`no entry titled "${part}"`);
  return entry;
};
const badgeFor = (part: string): HTMLButtonElement => {
  const badge = entryFor(part).querySelector<HTMLButtonElement>(":scope > .summ-more");
  if (!badge) throw new Error(`no +N badge on "${part}"`);
  return badge;
};
const twistFor = (part: string): HTMLButtonElement => {
  const twist = entryFor(part).querySelector<HTMLButtonElement>(":scope > .summ-body .summ-twist");
  if (!twist) throw new Error(`no twist on "${part}"`);
  return twist;
};
const click = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("opening one part past the depth cut-off", () => {
  it("starts with the parts and no sections, and a live badge on each part", () => {
    expect(titles()).toEqual(["1First part", "2Second part"]);
    // The word is the Depth control's own. At `parts` the article row is
    // already showing everything it has, so only the two parts hold a badge —
    // drop to `article` and the root grows a "+2 parts".
    expect(badges()).toEqual(["+3 sections", "+3 sections"]);
    // Live: this is the whole change. It was `disabled` until 2026-08-27.
    expect(badgeFor("First part").disabled).toBe(false);
  });

  it("opens just that part's sections, and leaves Depth and the other part alone", () => {
    click(badgeFor("First part"));
    expect(titles()).toEqual([
      "1First part",
      "1.1Alpha",
      "1.2Beta",
      "1.3Gamma",
      "2Second part",
    ]);
    // The other part is untouched and still says how much it is holding back.
    expect(badgeFor("Second part").textContent).toBe("+3 sections");
    // And the Depth buttons above were not moved on the reader's behalf.
    expect(deeps).toEqual([]);
    expect(twistFor("First part").getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses again from the parent's twist", () => {
    click(badgeFor("First part"));
    expect(titles()).toContain("1.1Alpha");
    click(twistFor("First part"));
    expect(titles()).toEqual(["1First part", "2Second part"]);
    expect(badgeFor("First part").textContent).toBe("+3 sections");
    expect(twistFor("First part").getAttribute("aria-expanded")).toBe("false");
  });

  it("re-opens after a collapse, which is where a one-set version breaks", () => {
    click(badgeFor("First part"));
    click(twistFor("First part"));
    click(badgeFor("First part"));
    expect(titles()).toContain("1.2Beta");
  });

  it("names the badge for the one node it opens", () => {
    // "+3 sections" is what the eye needs beside a title it can see. A screen
    // reader's button list has no such context, and four of these in a row
    // were four identical controls.
    expect(badgeFor("First part").getAttribute("aria-label")).toBe(
      "Open the 3 sections of First part",
    );
    expect(badgeFor("Second part").getAttribute("aria-label")).toBe(
      "Open the 3 sections of Second part",
    );
  });

  it("hands the keyboard to the twist, because the badge is about to unmount", () => {
    // A focused button that disappears drops focus on `document.body`, which
    // loses a screen reader's place in the outline. GPT Sol's review, 2026-08-27.
    const badge = badgeFor("First part");
    badge.focus();
    expect(document.activeElement).toBe(badge);
    click(badge);
    expect(document.activeElement).toBe(twistFor("First part"));
  });

  it("moves only the focus that was already on the badge", () => {
    /* The guarantee is not "keyboard only" — Chrome focuses a button on
       mousedown, so a real mouse press takes this same path, and that is fine:
       the reader landed on the badge, the badge is gone, the twist is where
       they now are. `:focus-visible` is false for a mouse-originated focus, so
       no ring paints, which is the browser drawing the line better than we
       could. What must never happen is focus being dragged off something the
       reader was actually using. jsdom's dispatched click does not focus the
       button, which is exactly the shape of that case. */
    const elsewhere = host.querySelector<HTMLButtonElement>(".summ-pill");
    if (!elsewhere) throw new Error("no pill to park the keyboard on");
    elsewhere.focus();
    click(badgeFor("First part"));
    expect(titles()).toContain("1.1Alpha");
    expect(document.activeElement).toBe(elsewhere);
  });
});

/**
 * The root has no title row, so it has no twist — and an override written there
 * could never be taken off again. The `article` button would stop meaning "the
 * whole article, and nothing under it" for the rest of the session, with nothing
 * on screen to put it back. GPT Sol's review, 2026-08-27.
 *
 * Which is also why that is the right answer and not a gap: what the badge is
 * *for* is picking one node out of several without moving the cut-off for the
 * rest, and at the root there are no others.
 */
describe("the root badge stays a fact", () => {
  it("cannot be pressed into a state nothing can undo", () => {
    // Re-render at `article`, since `deep` belongs to the panel's caller.
    act(() => {
      root.render(panel(0));
    });
    const badge = host.querySelector<HTMLButtonElement>("li.summ-entry > .summ-more");
    expect(badge?.textContent).toBe("+2 parts");
    expect(badge?.disabled).toBe(true);
    click(badge!);
    // Still nothing but the article, and the Depth control was not moved.
    expect(titles()).toEqual([]);
    expect(deeps).toEqual([]);
  });
});

describe("the follow agrees with what is drawn", () => {
  it("marks the section once it is open past the cut-off, and the part before", () => {
    const t = tree();
    const shut: ReadonlySet<string> = new Set();
    // Cut-off at `parts`, nothing overridden: the part is as deep as it goes.
    expect(currentEntryId(t, 1, 1, shut, new Set())).toBe("1");
    // The reader opened part 1. Now the section under the reading line is the
    // deepest row actually on screen, so it is the one the panel scrolls to.
    expect(currentEntryId(t, 1, 1, shut, new Set(["1"]))).toBe("1.2");
    // Part 2 is untouched by that, exactly as the panel draws it.
    expect(currentEntryId(t, 4, 1, shut, new Set(["1"]))).toBe("2");
  });

  it("lets a close beat an override, so a collapsed part stays collapsed", () => {
    const t = tree();
    expect(showsChildren(t.children[0]!, 1, new Set(), new Set(["1"]))).toBe(true);
    expect(showsChildren(t.children[0]!, 1, new Set(["1"]), new Set(["1"]))).toBe(false);
  });
});
