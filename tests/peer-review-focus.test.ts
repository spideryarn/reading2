/**
 * **A focus belongs to one visit to its list** — and since 2026-10-09 two of
 * the lists are sub-modes of one mode. Bibliography's work focus and Claims'
 * claim focus used to be cleared when the reader left Citations or Debate;
 * moving between Peer review's sub-modes does not change `mode`, so an
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
    expect(focusesLeft({ mode: "peer-review", peerReview: "bibliography" }, { mode: "peer-review", peerReview: "reception" })).toEqual(["cite"]);
    expect(focusesLeft({ mode: "peer-review", peerReview: "bibliography" }, { mode: "peer-review", peerReview: "claims" })).toEqual(["cite"]);
  });

  it("forgets Claims' focus on leaving Claims for another sub-mode", () => {
    expect(focusesLeft({ mode: "peer-review", peerReview: "claims" }, { mode: "peer-review", peerReview: "bibliography" })).toEqual(["claim"]);
    expect(focusesLeft({ mode: "peer-review", peerReview: "claims" }, { mode: "peer-review", peerReview: "reception" })).toEqual(["claim"]);
  });

  it("forgets each on leaving the mode, as Citations' and Debate's did", () => {
    expect(focusesLeft({ mode: "peer-review", peerReview: "bibliography" }, { mode: "plain", peerReview: "bibliography" })).toEqual(["cite"]);
    expect(focusesLeft({ mode: "peer-review", peerReview: "claims" }, { mode: "chat", peerReview: "claims" })).toEqual(["claim"]);
    expect(focusesLeft({ mode: "glossary", peerReview: "bibliography" }, { mode: "plain", peerReview: "bibliography" })).toEqual(["term"]);
    expect(focusesLeft({ mode: "ideas", peerReview: "bibliography" }, { mode: "plain", peerReview: "bibliography" })).toEqual(["idea"]);
  });

  it("keeps a focus while the reader stays on its list, and arriving forgets nothing", () => {
    expect(focusesLeft({ mode: "peer-review", peerReview: "claims" }, { mode: "peer-review", peerReview: "claims" })).toEqual([]);
    /* The way back from a chat: Chat to Bibliography, the focus set in the same tick. */
    expect(focusesLeft({ mode: "chat", peerReview: "claims" }, { mode: "peer-review", peerReview: "bibliography" })).toEqual([]);
    /* Reception has no focus of its own. */
    expect(focusesLeft({ mode: "peer-review", peerReview: "reception" }, { mode: "plain", peerReview: "reception" })).toEqual([]);
  });
});
