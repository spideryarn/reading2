// @vitest-environment jsdom
/**
 * **A row shows its question INSTEAD of its gist, or its gist, or it says so.**
 *
 * SPIDERYARN-READING2-24, Greg 2026-09-05, after reading the first version on a
 * real article:
 *
 * > I quite like some of these new Socratic questions in the summary mode, but
 * > the intent wasn't that we would show both the gist and the Socratic
 * > question, the intent was that we would show only the Socratic question when
 * > we have one.
 *
 * The morning's version drew both, and the reasoning for that is preserved in
 * `SummaryPanel.tsx` because it was right about the questions it was written
 * for. This file holds the rule that replaced it.
 *
 * **Why a test rather than a look.** The interesting half is not that the
 * question appears — it is that the gist *disappears*, and that nothing
 * disappears on the rows that have no question. A panel that dropped both would
 * pass any assertion that only asked "is the question drawn", and an article
 * whose hierarchy predates 2026-09-05 has a question on no row at all. So every
 * case here asserts a presence AND an absence, and the mixed-depth case is the
 * one that would have caught shipping this against the real corpus, where a
 * cascade-built depth-1 node has no question because `EXPAND_SYSTEM` has no such
 * field (docs/plans/260905f § P1-5).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/* Every update goes through `act`, so say so — otherwise React logs on each
   render and the file passes while shouting. Same reason as summary-expand. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TreeNode } from "../src/types.js";
import { SummaryPanel } from "../src/web/SummaryPanel.js";
import type { SummaryNode } from "../src/web/tree.js";

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
    parent,
    children,
    range: [`spya-${id}a`, `spya-${id}z`],
    gist: `The gist of ${title}.`,
  };
}

/**
 * One part. `question: undefined` is the pre-2026-09-05 article and is spelled
 * as an absent key rather than an empty string — `questionFor` drops a blank,
 * so a row can only ever have a real question or none, and a fixture carrying
 * `""` would be testing a state the pipeline cannot produce.
 */
function part(id: string, title: string, row: number, question?: string): SummaryNode {
  const n = node(id, 1, title, "root");
  return {
    node: n,
    number: id,
    startRow: row,
    endRow: row,
    blocks: 3,
    gist: `The gist of ${title}.`,
    ...(question !== undefined ? { question } : {}),
    children: [],
  };
}

function tree(parts: SummaryNode[], rootQuestion?: string): SummaryNode {
  return {
    node: node(
      "root",
      0,
      "The whole thing",
      null,
      parts.map((p) => p.node.id),
    ),
    number: "",
    startRow: 0,
    endRow: parts.length - 1,
    blocks: parts.length,
    gist: "The gist of the whole thing.",
    ...(rootQuestion !== undefined ? { question: rootQuestion } : {}),
    children: parts,
  };
}

let host: HTMLDivElement;
let root: Root;

const render = (t: SummaryNode) => {
  act(() => {
    root.render(
      createElement(SummaryPanel, {
        root: t,
        deep: 1,
        onDeep: () => {},
        atRow: null,
        onJump: () => {},
      }),
    );
  });
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const texts = (sel: string) => [...host.querySelectorAll(sel)].map((e) => e.textContent ?? "");
const questions = () => texts(".summ-question");
const gists = () => texts(".summ-text");

describe("a row with a question", () => {
  it("shows the question and NOT the gist", () => {
    render(
      tree([
        part("1", "First part", 0, "Functionalism (4 arguments): why isn't computation enough?"),
      ]),
    );
    expect(questions()).toContain(
      "Functionalism (4 arguments): why isn't computation enough?",
    );
    /* The half that matters. Drawing the question is easy; the report was that
       both were drawn. */
    expect(gists()).not.toContain("The gist of First part.");
  });

  it("does the same on the root, which is the row Greg was looking at", () => {
    render(tree([part("1", "First part", 0)], "Conscious AI: why believe it is close?"));
    expect(questions()).toContain("Conscious AI: why believe it is close?");
    expect(gists()).not.toContain("The gist of the whole thing.");
  });
});

describe("a row with no question", () => {
  it("still shows its gist, because an article from before this has none", () => {
    render(tree([part("1", "First part", 0)]));
    expect(gists()).toContain("The gist of First part.");
    expect(questions()).toHaveLength(0);
  });

  it("says so only when it has neither", () => {
    const p = part("1", "First part", 0);
    delete (p as { gist?: string }).gist;
    delete (p.node as { gist?: string }).gist;
    render(tree([p]));
    expect(gists()).toContain("No summary for this section.");
  });
});

/**
 * The case that would have caught this against real data. `EXPAND_SYSTEM` has
 * no question field, so a depth-1 node the deepening cascade built carries none
 * while its siblings do — and the panel then draws two different kinds of line
 * at one depth. That is not a fault and must not be reported as one; it is why
 * the fallback is `question ?? gist` and not `question ?? "No summary"`.
 */
describe("a part built by the cascade, beside parts that were not", () => {
  it("falls back to its gist rather than reporting a fault", () => {
    render(
      tree([
        part("1", "First part", 0, "First part (two cases): how does it hold up?"),
        part("2", "Second part", 1),
      ]),
    );
    expect(questions()).toEqual(["First part (two cases): how does it hold up?"]);
    expect(gists()).toContain("The gist of Second part.");
    expect(gists().join(" ")).not.toContain("No summary");
  });
});
