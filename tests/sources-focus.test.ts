/**
 * **A focus belongs to one visit to its list** — and since 2026-10-09 two of
 * the lists are sub-modes of one mode. Bibliography's work focus and Claims'
 * claim focus used to be cleared when the reader left Citations or Debate;
 * moving between Sources' sub-modes does not change `mode`, so an
 * unconsumed focus would survive a trip to Reception and jump the list on a
 * later, ordinary visit (GPT Sol's F7 on plan 261009l).
 *
 * `focusesLeft` is the pure rule Reader.tsx's effect applies on every move.
 * docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md § Stage 1, 10.
 */
import { describe, expect, it } from "vitest";
import { focusesLeft } from "../src/web/item-focus.js";

describe("focusesLeft", () => {
  it("forgets Bibliography's focus on leaving Bibliography for another sub-mode", () => {
    expect(focusesLeft({ mode: "sources", sources: "bibliography" }, { mode: "sources", sources: "reception" })).toEqual(["cite"]);
    expect(focusesLeft({ mode: "sources", sources: "bibliography" }, { mode: "sources", sources: "claims" })).toEqual(["cite"]);
  });

  it("forgets Claims' focus on leaving Claims for another sub-mode", () => {
    expect(focusesLeft({ mode: "sources", sources: "claims" }, { mode: "sources", sources: "bibliography" })).toEqual(["claim"]);
    expect(focusesLeft({ mode: "sources", sources: "claims" }, { mode: "sources", sources: "reception" })).toEqual(["claim"]);
  });

  it("forgets each on leaving the mode, as Citations' and Debate's did", () => {
    expect(focusesLeft({ mode: "sources", sources: "bibliography" }, { mode: "plain", sources: "bibliography" })).toEqual(["cite"]);
    expect(focusesLeft({ mode: "sources", sources: "claims" }, { mode: "chat", sources: "claims" })).toEqual(["claim"]);
    expect(focusesLeft({ mode: "glossary", sources: "bibliography" }, { mode: "plain", sources: "bibliography" })).toEqual(["term"]);
    expect(focusesLeft({ mode: "ideas", sources: "bibliography" }, { mode: "plain", sources: "bibliography" })).toEqual(["idea"]);
  });

  /* A margin literature line's *Open in Sources* (plan 261024o), and a
     finding's chat's way back: in Where it sits since plan 261025h. */
  it("forgets a Situate finding's focus on leaving Where it sits", () => {
    expect(focusesLeft({ mode: "sources", sources: "where" }, { mode: "sources", sources: "claims" })).toEqual(["finding"]);
    expect(focusesLeft({ mode: "sources", sources: "where" }, { mode: "plain", sources: "where" })).toEqual(["finding"]);
    expect(focusesLeft({ mode: "plain", sources: "bibliography" }, { mode: "sources", sources: "where" })).toEqual([]);
    /* Investigate holds no dossier any more. */
    expect(focusesLeft({ mode: "sources", sources: "investigate" }, { mode: "plain", sources: "investigate" })).toEqual([]);
  });

  it("keeps a focus while the reader stays on its list, and arriving forgets nothing", () => {
    expect(focusesLeft({ mode: "sources", sources: "claims" }, { mode: "sources", sources: "claims" })).toEqual([]);
    /* The way back from a chat: Chat to Bibliography, the focus set in the same tick. */
    expect(focusesLeft({ mode: "chat", sources: "claims" }, { mode: "sources", sources: "bibliography" })).toEqual([]);
    /* Reception has no focus of its own. */
    expect(focusesLeft({ mode: "sources", sources: "reception" }, { mode: "plain", sources: "reception" })).toEqual([]);
  });
});
