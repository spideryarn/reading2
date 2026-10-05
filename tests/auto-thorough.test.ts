/**
 * **The two decisions behind "quick starts thorough"** — plan 261004l, as pure
 * functions (src/web/modes/search/auto-thorough.ts).
 *
 * `launchThorough` says whether a finished quick row gets its thorough search
 * now; `settleThorough` says what becomes of a thorough search already out.
 * No clock, no React: the band test (tests/search-auto-thorough.test.tsx) is
 * where these meet a timer and a stream.
 */
import { describe, expect, it } from "vitest";
import {
  launchThorough,
  SETTLE_MS,
  settleThorough,
  type ThoroughPair,
} from "../src/web/modes/search/auto-thorough.js";

const WORDS = "arguments against";
const pair = (over: Partial<ThoroughPair> = {}): ThoroughPair => ({
  meaningId: "spya-mean01",
  quickId: "spya-quik01",
  words: WORDS,
  discard: false,
  ...over,
});
const done = { status: "done" as const, words: WORDS };

describe("settleThorough", () => {
  it("waits while the thorough row is pending", () => {
    expect(
      settleThorough(pair(), { meaning: { status: "pending" }, quick: done, unasked: false }),
    ).toEqual({ type: "wait" });
  });

  it("swaps when thorough is done and the quick row is still there, done, with the same words", () => {
    expect(
      settleThorough(pair(), { meaning: { status: "done" }, quick: done, unasked: false }),
    ).toEqual({ type: "swap" });
  });

  it("drops a thorough search that failed, and leaves the quick row alone", () => {
    expect(
      settleThorough(pair(), { meaning: { status: "error" }, quick: done, unasked: false }),
    ).toEqual({ type: "drop" });
  });

  it("drops a thorough row that has gone from the list", () => {
    expect(settleThorough(pair(), { meaning: undefined, quick: done, unasked: false })).toEqual({
      type: "drop",
    });
  });

  it.each([
    ["gone", undefined],
    ["pending", { status: "pending" as const, words: WORDS }],
    ["failed", { status: "error" as const, words: WORDS }],
    ["on other words", { status: "done" as const, words: "arguments against dualism" }],
  ])("drops a finished thorough search whose quick row is %s", (_name, quick) => {
    expect(settleThorough(pair(), { meaning: { status: "done" }, quick, unasked: false })).toEqual({
      type: "drop",
    });
  });

  it("a discarded pair still waits while its request is out (review F5)", () => {
    expect(
      settleThorough(pair({ discard: true }), {
        meaning: { status: "pending" },
        quick: undefined,
        unasked: false,
      }),
    ).toEqual({ type: "wait" });
  });

  it("a discarded pair is dropped when it finishes, even if the quick row matches again", () => {
    expect(
      settleThorough(pair({ discard: true }), {
        meaning: { status: "done" },
        quick: done,
        unasked: false,
      }),
    ).toEqual({ type: "drop" });
  });

  it("does not swap over an edit the box has not asked yet (review F2)", () => {
    expect(
      settleThorough(pair(), { meaning: { status: "done" }, quick: done, unasked: true }),
    ).toEqual({ type: "drop" });
    // …and the unasked edit does not release a request that is still out.
    expect(
      settleThorough(pair(), { meaning: { status: "pending" }, quick: done, unasked: true }),
    ).toEqual({ type: "wait" });
  });
});

describe("launchThorough", () => {
  const settled = {
    status: "done" as const,
    submitted: false,
    settledMs: SETTLE_MS,
    unasked: false,
    running: false,
    tried: false,
  };

  it("launches once the row has stayed done with the same words for SETTLE_MS", () => {
    expect(launchThorough(settled)).toEqual({ type: "launch" });
  });

  it("waits out the rest of the settle", () => {
    expect(launchThorough({ ...settled, settledMs: 500 })).toEqual({
      type: "wait",
      ms: SETTLE_MS - 500,
    });
  });

  it("launches at once when Enter or find submitted those words (review F1)", () => {
    expect(launchThorough({ ...settled, settledMs: 0, submitted: true })).toEqual({
      type: "launch",
    });
  });

  it.each([["pending" as const], ["error" as const], [undefined]])(
    "does nothing for a quick row that is %s",
    (status) => {
      expect(launchThorough({ ...settled, status, submitted: true })).toEqual({ type: "idle" });
    },
  );

  it("looks again in another SETTLE_MS while the box holds an unasked edit (review F2)", () => {
    expect(launchThorough({ ...settled, unasked: true })).toEqual({ type: "wait", ms: SETTLE_MS });
  });

  it("never launches while a thorough search for the same words is out", () => {
    expect(launchThorough({ ...settled, running: true })).toEqual({ type: "never" });
  });

  it("does not try the same row and words twice", () => {
    expect(launchThorough({ ...settled, tried: true, submitted: true })).toEqual({ type: "idle" });
  });
});
