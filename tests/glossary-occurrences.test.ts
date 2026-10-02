/**
 * The re-match both glossary reads run (src/glossary-occurrences.ts, plan
 * 261002c). spya-n04d5p: an entry stored with one block of six, because the
 * list was written before hyphens matched spaces.
 */
import { describe, expect, it } from "vitest";

import { relocateEntries } from "../src/glossary-occurrences.js";

const blocks = [
  { id: "spya-aaaaaa", text: "An overview with no task in it." },
  { id: "spya-bbbbbb", text: "an 8-arm maze delayed-win-shift task^{41,42}" },
  { id: "spya-cccccc", text: "study phase of a delayed win-shift task for memory" },
  { id: "spya-dddddd", text: "(a) A delayed-win-shift task was used." },
];

describe("relocateEntries", () => {
  it("replaces a stored occurrence list with what the article says now", () => {
    const stored = [
      { id: "spya-eeeeee", name: "Overview", blocks: ["spya-aaaaaa"] },
      { id: "spya-ffffff", name: "Delayed win-shift task", aliases: [], blocks: ["spya-cccccc"] },
    ];
    const [, win] = relocateEntries(stored, blocks);
    expect(win?.blocks).toEqual(["spya-bbbbbb", "spya-cccccc", "spya-dddddd"]);
    // A copy: the stored entry is not touched.
    expect(stored[1]?.blocks).toEqual(["spya-cccccc"]);
  });

  it("puts the list back in first-use order, unmatched last", () => {
    const stored = [
      { id: "spya-gggggg", name: "nowhere", blocks: [] },
      { id: "spya-ffffff", name: "Delayed win-shift task", blocks: ["spya-cccccc"] },
      { id: "spya-eeeeee", name: "Overview", blocks: ["spya-aaaaaa"] },
    ];
    expect(relocateEntries(stored, blocks).map((e) => e.name)).toEqual([
      "Overview",
      "Delayed win-shift task",
      "nowhere",
    ]);
  });
});
