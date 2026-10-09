/**
 * **What a stranger's page is told about the public shelf's topics** —
 * `publicTopicsFor` in src/public-library-topics.ts, pure. Plan
 * docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md
 * § The design, 6.
 *
 * 1. Broad first, each card given the keys of its topics, a topic with no
 *    listed card left out, `within` only when the parent is sent too.
 * 2. **Withheld whole** while any article the tree holds is no longer listed,
 *    because a label may have been worded from its title.
 * 3. Nothing below eight listed cards, or with no tree.
 */
import { describe, expect, it } from "vitest";

import { PUBLIC_TOPICS_MIN_CARDS, publicTopicsFor } from "../src/public-library-topics.js";
import { MIN_WORKS } from "../src/shelf-topic-sets.js";

const TOPICS = [
  { id: "t1", key: "neuroscience", label: "Neuroscience", parent: null, depth: 0 },
  { id: "t2", key: "buddhism", label: "Buddhism", parent: null, depth: 0 },
  { id: "t3", key: "vision", label: "Vision", parent: "t1", depth: 1 },
  { id: "t4", key: "empty", label: "Nobody here", parent: null, depth: 0 },
  { id: "t5", key: "zen", label: "Zen", parent: "t4", depth: 1 },
];
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ articleId: `a${i + 1}` }));

describe("publicTopicsFor", () => {
  it("is the same eight as a reader's shelf", () => {
    expect(PUBLIC_TOPICS_MIN_CARDS).toBe(MIN_WORKS);
  });

  it("sends the topics broad first, and each card the keys of its topics", () => {
    const members = { a1: ["t1", "t3"], a2: ["t1"], a3: ["t2"], a4: ["t5"], a5: [], a6: ["t1"] };
    const got = publicTopicsFor(cards(9), { topics: TOPICS, members });
    expect(got.topics).toEqual([
      { key: "neuroscience", label: "Neuroscience", granularity: 0 },
      { key: "buddhism", label: "Buddhism", granularity: 0 },
      { key: "vision", label: "Vision", granularity: 0.5, within: "neuroscience" },
      /* Its parent has no card of its own, so it is not sent, and nor is the `within`. */
      { key: "zen", label: "Zen", granularity: 0.5 },
    ]);
    expect(got.keysOf("a1")).toEqual(["neuroscience", "vision"]);
    expect(got.keysOf("a5")).toEqual([]);
    /* Listed, never filed: no topics, and not a reason to withhold. */
    expect(got.keysOf("a9")).toEqual([]);
  });

  it("withholds every topic while an article the tree holds is no longer listed", () => {
    const members = { a1: ["t1"], a2: ["t2"], gone: [] };
    const got = publicTopicsFor(cards(9), { topics: TOPICS, members });
    expect(got.topics).toEqual([]);
    expect(got.keysOf("a1")).toEqual([]);
  });

  it("sends nothing below eight listed cards, or with no tree", () => {
    const members = { a1: ["t1"] };
    expect(publicTopicsFor(cards(7), { topics: TOPICS, members }).topics).toEqual([]);
    expect(publicTopicsFor(cards(8), { topics: TOPICS, members }).topics).toHaveLength(1);
    expect(publicTopicsFor(cards(9), null).topics).toEqual([]);
  });

  it("ignores a membership naming a topic the tree does not have", () => {
    const got = publicTopicsFor(cards(8), { topics: TOPICS, members: { a1: ["t1", "t99"] } });
    expect(got.keysOf("a1")).toEqual(["neuroscience"]);
  });
});
