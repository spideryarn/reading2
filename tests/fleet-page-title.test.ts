/**
 * The fleet dashboard's tab title — tools/fleet/web/src/page-title.ts.
 *
 * The rendered half (that App actually assigns `document.title` from the live
 * snapshot, the hash and the selection) is in tests/fleet-web.test.tsx § "the
 * tab title"; this file is the composition rules on their own.
 */
import { describe, expect, it } from "vitest";

import { MODES } from "../tools/fleet/web/src/mode";
import { NAME_CLAMP, attentionMark, fleetTitle } from "../tools/fleet/web/src/page-title";
import type { Tally } from "../tools/fleet/web/src/view";

const calm: Tally = { needsYou: 0, working: 3, other: 2, unknown: 0 };
const two: Tally = { needsYou: 2, working: 1, other: 0, unknown: 0 };

describe("fleetTitle", () => {
  it("is just the app's name on the resting tab", () => {
    expect(fleetTitle({ mode: "sessions", counts: calm, stale: false, selected: null })).toBe("Fleet");
  });

  it("leads with how many sessions need you", () => {
    expect(fleetTitle({ mode: "sessions", counts: two, stale: false, selected: null })).toBe("(2) Fleet");
    expect(fleetTitle({ mode: "health", counts: two, stale: false, selected: null })).toBe("(2) Box health · Fleet");
  });

  it("puts STALE before the count it is disbelieving", () => {
    expect(fleetTitle({ mode: "usage", counts: two, stale: true, selected: null })).toBe(
      "STALE (2) Usage limits · Fleet",
    );
  });

  it("names the selected session on Sessions, and only there", () => {
    expect(fleetTitle({ mode: "sessions", counts: two, stale: false, selected: "fix the thing" })).toBe(
      "(2) fix the thing · Fleet",
    );
    expect(fleetTitle({ mode: "deploys", counts: calm, stale: false, selected: "fix the thing" })).toBe(
      "Deploys · Fleet",
    );
  });

  it("clamps a sentence-long session title", () => {
    const long = "a".repeat(NAME_CLAMP + 20);
    const title = fleetTitle({ mode: "sessions", counts: null, stale: false, selected: long });
    expect(title).toBe(`${"a".repeat(NAME_CLAMP - 1)}… · Fleet`);
  });

  it("gives every mode but the default a segment of its own", () => {
    const titles = MODES.map((mode) => fleetTitle({ mode, counts: calm, stale: false, selected: null }));
    expect(titles.filter((t) => t === "Fleet")).toEqual(["Fleet"]);
    expect(new Set(titles).size).toBe(MODES.length);
  });
});

describe("attentionMark", () => {
  it("says nothing before the first payload, rather than a count of zero", () => {
    expect(attentionMark(null)).toBeNull();
  });

  it("says (?) when nobody needs you but some rows could not be read", () => {
    expect(attentionMark({ ...calm, unknown: 4, other: 6 })).toBe("(?)");
  });

  it("prefers the real count to the question mark", () => {
    expect(attentionMark({ ...two, unknown: 4 })).toBe("(2)");
  });
});
