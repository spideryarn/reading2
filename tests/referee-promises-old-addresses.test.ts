/**
 * **An old `?referee=claims` lands on Promises** — on boot (`settleAddress`),
 * on a client navigation and on Back (`liftedLegacyHref`), and from a
 * remembered last view (`restoredHref`, which stores `referee` verbatim).
 * Referee's Promises sub-mode was called Claims until 2026-10-11, when Sources
 * took that word: docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md.
 *
 * One transform behind all three (src/web/router.ts § `liftLegacyRefereeClaims`),
 * as tests/sources-old-addresses.test.ts holds for Sources' old words.
 */
import { describe, expect, it } from "vitest";
import { restoredHref } from "../src/web/last-view.js";
import { liftedLegacyHref, settleAddress } from "../src/web/router.js";

const PATH = "/read/a-piece";

describe("an old ?referee=claims", () => {
  it("lifts to ?referee=promises on boot, keeping every other pair and the hash", () => {
    expect(settleAddress(PATH, "?mode=referee&referee=claims&at=spya-k3m9qt", "#x")).toBe(
      `${PATH}?mode=referee&referee=promises&at=spya-k3m9qt#x`,
    );
  });

  it("lifts after boot, on a navigation or Back", () => {
    expect(liftedLegacyHref(`${PATH}?mode=referee&referee=claims`)).toBe(
      `${PATH}?mode=referee&referee=promises`,
    );
  });

  it("lifts a remembered last view", () => {
    expect(restoredHref(PATH, "", "?mode=referee&referee=claims")).toBe(
      `${PATH}?mode=referee&referee=promises`,
    );
  });

  it("reads the key and value as the parser does, percent-encoded or not", () => {
    expect(settleAddress(PATH, "?mode=referee&%72eferee=cl%61ims", "")).toBe(
      `${PATH}?mode=referee&referee=promises`,
    );
  });

  it("leaves Sources' own claims, and every other Referee view, alone", () => {
    expect(settleAddress(PATH, "?mode=sources&sources=claims", "")).toBeNull();
    expect(settleAddress(PATH, "?mode=referee&referee=promises", "")).toBeNull();
    expect(settleAddress(PATH, "?mode=referee&referee=mirror", "")).toBeNull();
    expect(liftedLegacyHref(`${PATH}?mode=referee&referee=criteria`)).toBeNull();
  });
});
