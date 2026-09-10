/**
 * **THE THREE CLOCKS** — `tools/fleet/zones.ts`, the formatter behind Greg's
 * *"include timezone because I'm bouncing between London/Athens"*.
 *
 * The two things worth a test are the two that are wrong if nobody checks:
 *
 *  - **the day marker**, because a reset at 23:40 UTC is 02:40 in Athens
 *    *tomorrow*, and printed without `(+1d)` it reads as three hours in the
 *    past — a reader concludes the limit has already cleared;
 *  - **DST**, because the offsets are not constants. The 2026-03-29 pair below
 *    straddles the 01:00 UTC transition, so a formatter that had hard-coded
 *    +1/+3 renders one of them an hour wrong and nothing else notices.
 *
 * Everything here pins an INSTANT and asserts civil time, which is the direction
 * that can fail. `TZ` is never read by the module, and one case asserts that:
 * these lines are printed on a box whose clock is UTC and read on a phone that
 * is not, so a formatter quietly using the host zone would be right in
 * development and wrong in the only place it matters.
 */
import { describe, expect, it } from "vitest";

import { DISPLAY_ZONES, LONDON_FIRST, londonFirstLine, zonedLine, zonedLineAgainstFirst, zonedReadings } from "../tools/fleet/zones.js";

describe("zonedReadings", () => {
  it("reads one summer instant in all three zones", () => {
    /* 2026-09-08 is BST in London (+1) and EEST in Athens (+3). */
    expect(zonedReadings("2026-09-08T18:42:00.000Z")).toEqual([
      { zone: "UTC", label: "UTC", date: "2026-09-08", time: "18:42", dayOffset: 0 },
      { zone: "Europe/London", label: "London", date: "2026-09-08", time: "19:42", dayOffset: 0 },
      { zone: "Europe/Athens", label: "Athens", date: "2026-09-08", time: "21:42", dayOffset: 0 },
    ]);
  });

  it("reads one winter instant, where London is UTC and Athens is +2", () => {
    expect(zonedReadings("2026-01-15T12:00:00.000Z")).toEqual([
      { zone: "UTC", label: "UTC", date: "2026-01-15", time: "12:00", dayOffset: 0 },
      { zone: "Europe/London", label: "London", date: "2026-01-15", time: "12:00", dayOffset: 0 },
      { zone: "Europe/Athens", label: "Athens", date: "2026-01-15", time: "14:00", dayOffset: 0 },
    ]);
  });

  it("carries the day forward when the civil date differs from UTC's", () => {
    const readings = zonedReadings("2026-09-08T23:40:00.000Z");
    expect(readings?.map((r) => [r.label, r.date, r.time, r.dayOffset])).toEqual([
      ["UTC", "2026-09-08", "23:40", 0],
      ["London", "2026-09-09", "00:40", 1],
      ["Athens", "2026-09-09", "02:40", 1],
    ]);
  });

  it("crosses the spring DST transition without a hard-coded offset", () => {
    /* Both zones switch at 01:00 UTC on 2026-03-29. Half an hour before, London
       is GMT and Athens is EET; half an hour after, both have jumped an hour. */
    const before = zonedReadings("2026-03-29T00:30:00.000Z");
    const after = zonedReadings("2026-03-29T01:30:00.000Z");
    expect(before?.map((r) => `${r.label} ${r.time}`)).toEqual(["UTC 00:30", "London 00:30", "Athens 02:30"]);
    expect(after?.map((r) => `${r.label} ${r.time}`)).toEqual(["UTC 01:30", "London 02:30", "Athens 04:30"]);
  });

  it("counts a zone BEHIND UTC as a day back", () => {
    /* Unreachable with DISPLAY_ZONES — both are ahead of UTC all year — which is
       exactly why `zones` is a parameter. Honolulu is UTC−10 with no DST. */
    const readings = zonedReadings("2026-09-08T02:00:00.000Z", [{ zone: "Pacific/Honolulu", label: "Honolulu" }]);
    expect(readings).toEqual([
      { zone: "Pacific/Honolulu", label: "Honolulu", date: "2026-09-07", time: "16:00", dayOffset: -1 },
    ]);
  });

  it("refuses an instant it cannot read rather than inventing one", () => {
    expect(zonedReadings("not a timestamp")).toBeNull();
    expect(zonedReadings("")).toBeNull();
    expect(zonedLine("2026-13-45T99:99:99Z")).toBeNull();
  });

  it("ignores the host's own time zone", () => {
    /* The suite runs on a UTC box and the page is read in Athens. If the module
       ever reached for the host zone this would still pass on the box, so the
       assertion is that UTC's own reading is the literal input — the one thing
       a host-zone bug could not preserve for a non-UTC host. */
    const readings = zonedReadings("2026-06-01T05:05:00.000Z");
    expect(readings?.[0]).toEqual({ zone: "UTC", label: "UTC", date: "2026-06-01", time: "05:05", dayOffset: 0 });
  });
});

describe("zonedLine", () => {
  it("prints the date once and labels every clock", () => {
    expect(zonedLine("2026-09-08T18:42:00.000Z")).toBe("2026-09-08 18:42 UTC · 19:42 London · 21:42 Athens");
  });

  it("marks the zones that have already rolled over", () => {
    expect(zonedLine("2026-09-08T23:40:00.000Z")).toBe(
      "2026-09-08 23:40 UTC · 00:40 London (+1d) · 02:40 Athens (+1d)",
    );
  });

  it("marks a zone a day behind with a minus", () => {
    expect(zonedLine("2026-09-08T02:00:00.000Z", [{ zone: "Pacific/Honolulu", label: "Honolulu" }])).toBe(
      "2026-09-07 16:00 Honolulu (−1d)",
    );
  });
});

describe("zonedLineAgainstFirst, and London first", () => {
  it("marks each zone's day against the FIRST zone — the date actually printed — not against UTC", () => {
    /* 23:30 UTC on the 10th is 00:30 London on the 11th. Marked against UTC, as
       zonedLine marks, this would read "2026-09-11 00:30 London (+1d)" — a day
       after the 11th. Plan 260910e, Stage 2's finding. */
    expect(londonFirstLine("2026-09-10T23:30:00.000Z")).toBe("2026-09-11 00:30 London · 23:30 UTC (−1d) · 02:30 Athens");
  });

  it("prints the ordinary day with no marks at all", () => {
    expect(londonFirstLine("2026-09-10T12:00:00.000Z")).toBe("2026-09-10 13:00 London · 12:00 UTC · 15:00 Athens");
  });

  it("marks a later zone forward when it has rolled over and the first has not", () => {
    expect(zonedLineAgainstFirst("2026-09-10T22:30:00.000Z", LONDON_FIRST)).toBe("2026-09-10 23:30 London · 22:30 UTC · 01:30 Athens (+1d)");
  });

  it("refuses an instant it cannot read", () => {
    expect(londonFirstLine("not a timestamp")).toBeNull();
  });

  it("is London, UTC, Athens, in that order", () => {
    expect(LONDON_FIRST.map((z) => z.zone)).toEqual(["Europe/London", "UTC", "Europe/Athens"]);
  });
});

describe("DISPLAY_ZONES", () => {
  it("is the three Greg asked for, in reading order", () => {
    expect(DISPLAY_ZONES.map((z) => z.zone)).toEqual(["UTC", "Europe/London", "Europe/Athens"]);
  });
});
