/**
 * **An old `?learn=tutorial` lands on Recall** — on boot (`settleAddress`), on
 * a client navigation and on Back (`liftedLegacyHref`), and from a remembered
 * last view (`restoredHref`, which stores `learn` verbatim). Learn's Tutorial
 * was folded into Recall on 2026-10-20, and Recall is Learn's default, so the
 * `learn` pair goes: docs/plans/261020m-recall-and-tutorial-become-one-recall.md,
 * GPT Sol's F6.
 *
 * One transform behind all three (src/web/router.ts § `liftLegacyLearnTutorial`),
 * as tests/referee-promises-old-addresses.test.ts holds for Referee's old word.
 */
import { describe, expect, it } from "vitest";
import { restoredHref } from "../src/web/last-view.js";
import { LEARN_VIEWS, learnParam } from "../src/web/params.js";
import { liftedLegacyHref, settleAddress } from "../src/web/router.js";

const PATH = "/read/a-piece";

describe("an old ?learn=tutorial", () => {
  it("lifts to Recall on boot, keeping every other pair and the hash", () => {
    expect(settleAddress(PATH, "?mode=learn&learn=tutorial&at=spya-k3m9qt", "#x")).toBe(
      `${PATH}?mode=learn&at=spya-k3m9qt#x`,
    );
  });

  it("keeps a thread beside it, for Recall to settle", () => {
    expect(settleAddress(PATH, "?mode=learn&learn=tutorial&thread=spya-tuaa03", "")).toBe(
      `${PATH}?mode=learn&thread=spya-tuaa03`,
    );
  });

  it("lifts after boot, on a navigation or Back", () => {
    expect(liftedLegacyHref(`${PATH}?mode=learn&learn=tutorial`)).toBe(`${PATH}?mode=learn`);
  });

  it("lifts a remembered last view", () => {
    /* `?mode=learn` itself is not restored (NEEDS_AN_EXPLICIT_PRESS), so the
       sub-mode word is what a remembered view carries. The control first: a
       live Learn view is restored as written. */
    expect(restoredHref(PATH, "", "?learn=explore&at=spya-k3m9qt")).toBe(
      `${PATH}?learn=explore&at=spya-k3m9qt`,
    );
    expect(restoredHref(PATH, "", "?learn=tutorial&at=spya-k3m9qt")).toBe(`${PATH}?at=spya-k3m9qt`);
  });

  it("reads the key and value as the parser does, percent-encoded or not", () => {
    expect(settleAddress(PATH, "?mode=learn&%6Cearn=tut%6Frial", "")).toBe(`${PATH}?mode=learn`);
  });

  it("leaves every live Learn view alone", () => {
    for (const view of LEARN_VIEWS) {
      expect(settleAddress(PATH, `?mode=learn&learn=${view}`, "")).toBeNull();
      expect(liftedLegacyHref(`${PATH}?mode=learn&learn=${view}`)).toBeNull();
    }
  });

  it("is no longer a Learn view, so an unlifted one would read as Recall too", () => {
    expect(LEARN_VIEWS).toEqual(["recall", "explore", "quiz"]);
    expect(learnParam.parse("tutorial")).toBeNull();
  });
});
