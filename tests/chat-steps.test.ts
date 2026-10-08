/**
 * Chat's ↑ / ↓ between turns (spya-qd2agx): the arithmetic, over pixels.
 * docs/plans/261008b-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md § 3.
 */
import { describe, expect, it } from "vitest";
import { chatStep } from "../src/web/chat-steps.js";

/* Four turns: a question at 8, a long answer from 60 to 900, a question at
   900, its answer at 950; the scroller can reach 1200. */
const STARTS = [8, 60, 900, 950];
const MAX = 1200;
const ENDS = { end: MAX, max: MAX };

describe("chatStep", () => {
  it("↓ goes to the next turn's start", () => {
    expect(chatStep(STARTS, 8, ENDS, 1)).toBe(60);
    expect(chatStep(STARTS, 60, ENDS, 1)).toBe(900);
  });

  it("↓ from part-way into a long answer goes to the turn after it", () => {
    expect(chatStep(STARTS, 400, ENDS, 1)).toBe(900);
  });

  it("↑ part-way into a turn goes to that turn's own start, the music-player rule", () => {
    expect(chatStep(STARTS, 400, ENDS, -1)).toBe(60);
  });

  it("↑ from a turn's start goes to the turn before", () => {
    expect(chatStep(STARTS, 60, ENDS, -1)).toBe(8);
    expect(chatStep(STARTS, 900, ENDS, -1)).toBe(60);
  });

  it("counts a view within a couple of pixels of a start as on it, so ↑ is not stuck", () => {
    // A high-DPI scroller reads back half a pixel off where it was put.
    expect(chatStep(STARTS, 60.5, ENDS, -1)).toBe(8);
    expect(chatStep(STARTS, 59.4, ENDS, -1)).toBe(8);
    expect(chatStep(STARTS, 59.4, ENDS, 1)).toBe(900);
  });

  it("↑ from the first turn is nowhere", () => {
    expect(chatStep(STARTS, 8, ENDS, -1)).toBeNull();
  });

  it("↓ from above the first turn goes to the first turn, not the second", () => {
    expect(chatStep(STARTS, 0, ENDS, 1)).toBe(8);
  });

  it("a target the scroller cannot reach is the bottom", () => {
    expect(chatStep([0, 100, 500], 100, { end: 300, max: 300 }, 1)).toBe(300);
  });

  it("↓ past the last turn is the bottom, and ↓ at the bottom is nowhere", () => {
    expect(chatStep(STARTS, 960, ENDS, 1)).toBe(MAX);
    expect(chatStep(STARTS, MAX, ENDS, 1)).toBeNull();
    expect(chatStep(STARTS, MAX - 1, ENDS, 1)).toBeNull();
  });

  it("↑ from the bottom goes to the start of the turn the view is in", () => {
    expect(chatStep(STARTS, MAX, ENDS, -1)).toBe(950);
  });

  it("↑ from the padding above the first turn is nowhere, so the button is off rather than dead", () => {
    expect(chatStep(STARTS, 0, ENDS, -1)).toBeNull();
    expect(chatStep(STARTS, 6.5, ENDS, -1)).toBeNull();
  });

  /* A held answer: the question at 900 sits at the top on room the hold added,
     so the scroller reaches 900 though the words end at 590 (Sol's F1). */
  const HELD = { end: 590, max: 900 };
  it("↓ steps back to a held question, which only the room makes reachable", () => {
    expect(chatStep(STARTS, 60, HELD, 1)).toBe(900);
  });
  it("↓ out of turns goes to the words' end, never into the empty room", () => {
    expect(chatStep([0, 100], 120, HELD, 1)).toBe(590);
    expect(chatStep([0, 100], 590, HELD, 1)).toBeNull();
    expect(chatStep([0, 100], 700, HELD, 1), "already below the words' end, in the room").toBeNull();
  });
  it("↓ that the scroller cannot honour falls back to the end, or is nowhere", () => {
    expect(chatStep(STARTS, 900, HELD, 1), "the next turn is past max and the view is already at max").toBeNull();
  });

  it("no turns, nowhere", () => {
    expect(chatStep([], 0, ENDS, 1)).toBeNull();
    expect(chatStep([], 0, ENDS, -1)).toBeNull();
  });
});
