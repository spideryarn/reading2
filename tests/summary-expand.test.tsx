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

/**
 * The apparatus as `buildSummaryTree` now hands it over: one row, `supplement`,
 * no number, no children, and **no gist** — a supplement node never has one,
 * which is the whole promise (src/supplement.ts).
 */
function apparatus(): SummaryNode {
  const n = node("notes", 1, "Notes", "root");
  delete (n as { gist?: string }).gist;
  return {
    node: n,
    number: "",
    startRow: 6,
    endRow: 11,
    blocks: 6,
    supplement: true,
    children: [],
  };
}

function tree(withApparatus = false): SummaryNode {
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
      ...(withApparatus ? [apparatus()] : []),
    ],
  };
}

let host: HTMLDivElement;
let root: Root;
const deeps: number[] = [];

/* `deep` is the caller's state in the app, so the harness passes it in and
   records what the panel asks for rather than moving it. */
const panel = (deep: number, withApparatus = false) =>
  createElement(SummaryPanel, {
    root: tree(withApparatus),
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
 * **The root's badge is a control too**, since 2026-08-31.
 *
 * Greg: *"in Article sub-mode, I can't click on `+N parts` to expand"*. He is
 * right, and the old answer — the badge is a fact on the root, pointing at the
 * Depth buttons — was answering a different objection. That objection was real:
 * the root draws no title row, so it has no twist, and an override written
 * there could never be taken off again (GPT Sol, 2026-08-27).
 *
 * The fix is to give the root the thing it was missing rather than to take the
 * press away. Opening the root's parts puts a `−N parts` badge in the same
 * place, and that is the twist the root never had.
 *
 * **What must not happen is the root landing in `closed`.** A collapse
 * anywhere else writes the node into that set, and on the root that would
 * survive the Depth buttons: press `parts` afterwards and the outline would be
 * empty, with the control that says `parts` apparently doing nothing. So the
 * root's collapse clears the override and touches nothing else, which is the
 * last case below.
 */
describe("the root badge opens the parts, and closes them again", () => {
  /* Re-render at `article`, since `deep` belongs to the panel's caller. This
     is the state Greg was in: the parts are all below the cut-off and the
     badge is the only thing on screen that names them. */
  const atArticle = () =>
    act(() => {
      root.render(panel(0));
    });
  const rootBadge = () => {
    const badge = host.querySelector<HTMLButtonElement>("li.summ-entry > .summ-more");
    if (!badge) throw new Error("no badge on the root");
    return badge;
  };

  it("opens the parts without moving Depth", () => {
    atArticle();
    expect(titles()).toEqual([]);
    expect(rootBadge().textContent).toBe("+2 parts");
    expect(rootBadge().disabled).toBe(false);
    click(rootBadge());
    expect(titles()).toEqual(["1First part", "2Second part"]);
    // The Depth control still says `article`, and was not moved on the
    // reader's behalf — the same promise the per-part badge makes.
    expect(deeps).toEqual([]);
  });

  it("turns into the twist the root never had", () => {
    atArticle();
    click(rootBadge());
    expect(rootBadge().textContent).toBe("\u22122 parts");
    expect(rootBadge().getAttribute("aria-label")).toBe("Close the 2 parts of The whole thing");
    click(rootBadge());
    expect(titles()).toEqual([]);
    expect(rootBadge().textContent).toBe("+2 parts");
    expect(deeps).toEqual([]);
  });

  it("leaves `parts` still meaning parts after a collapse", () => {
    /* The one state a shared `closed` set would break. Open the parts at
       `article`, shut them again, then raise Depth: the parts must come back,
       because the reader never said anything about this node that outlives the
       cut-off. */
    atArticle();
    click(rootBadge());
    click(rootBadge());
    act(() => {
      root.render(panel(1));
    });
    expect(titles()).toEqual(["1First part", "2Second part"]);
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

/* --------------------------------------------------- and the apparatus -- */

/**
 * **The notes are a row, not a section of the argument.**
 *
 * `buildSummaryTree` stops descending into a supplement and hands it over
 * unnumbered; this is the other half, which is what a reader actually sees.
 * Before it, "Notes" was numbered part 3, carried one blank child per endnote,
 * and every one of them said "No summary for this section" — reporting the
 * promise of this whole stage as a fault. GPT Sol, second review, 2026-08-29.
 */
describe("the apparatus in summary mode", () => {
  const render = () => {
    act(() => root.render(panel(1, true)));
  };
  const rowFor = (title: string) =>
    [...host.querySelectorAll("li.summ-entry")].find(
      (li) => li.querySelector(".summ-title")?.textContent?.includes(title),
    );

  /* Three separate tests, not three assertions in one. A failing assertion ends
     its test, so with the number check first a probe that reverted *both* halves
     of the fix reddened only the number and never ran the missing-summary
     check at all. Each half of a fix needs its own probe — the identical trap
     the two hash pins fell into earlier the same day. */
  it("shows Notes as a row of the apparatus, not a part of the argument", () => {
    render();
    const notes = rowFor("Notes");
    expect(notes).toBeTruthy();
    expect(notes!.className).toContain("supplement");
  });

  it("gives Notes no number", () => {
    render();
    // No "3." in front of it — it is not part 3 of a two-part argument.
    expect(rowFor("Notes")!.querySelector(".summ-number")).toBe(null);
  });

  it("does not report the apparatus as missing a summary", () => {
    render();
    expect(rowFor("Notes")!.textContent).not.toContain("No summary for this section");
  });

  it("hangs no phantom row per endnote under it", () => {
    render();
    expect(rowFor("Notes")!.querySelectorAll("li.summ-entry").length).toBe(0);
  });

  /* The follow path, which reads the same tree. A reader whose `?at=` row is
     inside the notes must land on the Notes row itself — not on a phantom
     child, which is where it went before, and not on nothing. `showsChildren`
     already returns false for a childless entry, so this is asking whether the
     two rules still agree once the apparatus has no children; if they ever
     disagree the panel scrolls to an element that is not on screen, which moves
     nothing and reports nothing. */
  it("makes the Notes row itself the current entry for a reader inside it", () => {
    const withNotes = tree(true);
    // Row 8 is inside the apparatus (rows 6–11), well past the argument.
    expect(currentEntryId(withNotes, 8, 1, new Set())).toBe("notes");
    // And a reader in the argument is unaffected.
    expect(currentEntryId(withNotes, 4, 1, new Set())).toBe("2");
  });

  /* The control: the parts of the argument keep their numbers and keep saying
     when they have no summary, so the two assertions above are about the
     apparatus and not about the panel having quietly stopped numbering or
     stopped reporting anything at all. */
  it("still numbers the argument's own parts", () => {
    render();
    const first = rowFor("First part");
    expect(first!.querySelector(".summ-number")?.textContent).toBe("1");
    expect(rowFor("Second part")!.querySelector(".summ-number")?.textContent).toBe("2");
    expect(rowFor("First part")!.className).not.toContain("supplement");
  });
});

/**
 * **A panel with nothing in it must say so**, and until 2026-08-31 it did not.
 *
 * GPT Sol's review of the built code found the state. `tree-invariants.ts`
 * permits a root that is a **leaf** — one block, and no gist, because a summary
 * must never stand where the real prose could (granularity-zoom.md § node
 * shape). A one-passage article is exactly that. `buildSummaryTree` returns it,
 * so `root` is non-null and the "no usable tree" line does not fire; the root
 * draws no title row, no range and no missing-summary text; and with no
 * children there is no `+N` badge either. The reader got the word SUMMARY, the
 * Depth pills, and a blank panel with no explanation.
 *
 * It matters more since the mode stopped being gated: a visitor used to be told
 * *"nobody has built a summary for this piece yet"* and now opens the band
 * unconditionally (src/web/visitor.ts), so this is the state they land in.
 *
 * The same line covers a tree whose gists were never written — a provisional
 * heading tree — for the same reason, which is that there is nothing to draw.
 */
describe("an article with nothing to outline", () => {
  /** The root as a leaf: one block, no gist, no children. The validator's own case. */
  const lonely = (): SummaryNode => {
    const n = node("root", 0, "The whole thing", null);
    delete (n as { gist?: string }).gist;
    return { node: n, number: "", startRow: 0, endRow: 0, blocks: 1, children: [] };
  };

  const render = (r: SummaryNode) =>
    act(() => {
      root.render(
        createElement(SummaryPanel, {
          root: r,
          deep: 1,
          onDeep: (d: number) => deeps.push(d),
          atRow: null,
          onJump: () => {},
        }),
      );
    });

  it("says there is nothing to outline rather than drawing an empty list", () => {
    render(lonely());
    expect(titles()).toEqual([]);
    expect(badges()).toEqual([]);
    expect(host.querySelector(".summ-quiet")?.textContent).toContain("no parts");
    /* Not the other sentence. "No usable tree" is about a tree we could not
       read, and this tree is perfectly good — it just has one passage in it.
       Saying the wrong one of those reports a fault where there is none. */
    expect(host.textContent).not.toContain("no usable tree");
  });

  it("still draws a root that has a gist but no parts", () => {
    /* The control, and the reason the condition is `no gist AND no children`
       rather than either alone: a short article whose root carries a gist has
       exactly one useful row, and hiding it behind an empty-state message would
       be the same bug pointing the other way. */
    const withGist = { ...lonely(), gist: "The gist of the whole thing." };
    render(withGist);
    expect(host.querySelector(".summ-text")?.textContent).toBe("The gist of the whole thing.");
    expect(host.querySelector(".summ-quiet")).toBeNull();
  });
});

/**
 * **The Socratic question sits under the claim, and only on the rows that have
 * one.** SPIDERYARN-READING2-1V — Greg, 2026-09-05:
 *
 * > Tweak the prompt that generates the Summary mode to be a bit more in the
 * > form of Socratic questions that encourage the reader to read the actual
 * > text to get the full answers
 *
 * *"A bit more"* is what these assertions are really about. The gist stays —
 * a reader deciding whether to descend needs to know what the section says,
 * which is vision.md's *scan before you commit* — and the question is an extra
 * line beside it, not a replacement for it. A version that swapped one for the
 * other would satisfy the word "Socratic" and lose the panel's whole job.
 *
 * The absence case is the other half, and it is the common one: every article
 * whose hierarchy was built before 2026-09-05 has no questions at all, and the
 * panel has to look exactly as it always did rather than drawing a gap or a
 * "no question" line. A missing gist says so on screen; a missing question
 * must not (src/types.ts § `TreeNode.question`).
 */
describe("the Socratic question in the panel", () => {
  const asked = (): SummaryNode => {
    const t = tree();
    t.question = "Why should any of this change how you read?";
    const parts = t.children;
    if (parts[0]) parts[0].question = "How does the first part earn its claim?";
    if (parts[1]) parts[1].question = "What follows if the second part is right?";
    return t;
  };

  const questions = () => [...host.querySelectorAll(".summ-question")].map((p) => p.textContent);

  it("draws one under the article and one under each part, keeping every gist", () => {
    act(() => {
      root.render(
        createElement(SummaryPanel, {
          root: asked(),
          deep: 1,
          onDeep: () => {},
          atRow: null,
          onJump: () => {},
        }),
      );
    });

    expect(questions()).toEqual([
      "Why should any of this change how you read?",
      "How does the first part earn its claim?",
      "What follows if the second part is right?",
    ]);
    expect(
      [...host.querySelectorAll(".summ-text")].map((p) => p.textContent),
      "a question replaced a gist instead of joining it — the panel stopped saying what the article says",
    ).toEqual([
      "The gist of the whole thing.",
      "The gist of the first part.",
      "The gist of the second part.",
    ]);
  });

  it("draws nothing at all for an article built before the field existed", () => {
    /* `beforeEach` already rendered exactly that tree. */
    expect(questions()).toEqual([]);
    expect(
      host.textContent,
      "an article with no questions grew a placeholder where a question would go",
    ).not.toContain("?");
  });
});
