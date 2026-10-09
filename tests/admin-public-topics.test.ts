/**
 * **What /admin says about the public shelf's topics** — `statusSentence` in
 * src/web/AdminPublicTopics.tsx. Plan 261008j: the panel has to say when a
 * rebuild is due, and when the page is showing nothing.
 */
import { describe, expect, it } from "vitest";

import type { PublicShelfTopicsStatus } from "../src/types.js";
import { statusSentence } from "../src/web/AdminPublicTopics.js";

const base: PublicShelfTopicsStatus = {
  cards: 12,
  rethoughtAt: "2026-10-09T10:00:00.000Z",
  filed: 12,
  withheld: false,
  rebuildDue: false,
  working: false,
  autoMax: 20,
};

describe("statusSentence", () => {
  it("says the pills are shown, and how many articles are sorted", () => {
    expect(statusSentence(base, "2 hours ago")).toBe("Shown, last rebuilt 2 hours ago, with 12 of 12 articles sorted.");
  });

  it("says when a rebuild is due, and when the pills are hidden", () => {
    expect(statusSentence({ ...base, cards: 25, rebuildDue: true }, "a day ago")).toMatch(/^Shown, and a rebuild is due/);
    expect(statusSentence({ ...base, cards: 25, withheld: true, rebuildDue: true }, "a day ago")).toMatch(/^Hidden: .*A rebuild is due\./);
    expect(statusSentence({ ...base, withheld: true }, "a day ago")).toMatch(/They rebuild by themselves/);
  });

  it("says why there are none below eight, and while working", () => {
    expect(statusSentence({ ...base, cards: 6, rethoughtAt: null }, null)).toBe("Not shown: the public shelf has 6 articles, and topics need 8.");
    expect(statusSentence({ ...base, working: true }, null)).toBe("Being worked out now.");
  });
});
