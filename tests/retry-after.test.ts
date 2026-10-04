/**
 * The one `Retry-After` parser (src/retry-after.ts).
 *
 * There were two until 2026-10-04, both called `retryAfterMs`, one in the model
 * gateway and one in the page fetcher, and they disagreed about five headers:
 * `0`, `1.5`, `0x10`, `-5` and a date already past. The first table below is
 * those five rows, and it was red against each of the old parsers before the
 * shared one existed.
 *
 * The time-zone block is the other correction. An HTTP date is UTC, and the
 * asctime form does not say so, so `Date.parse` reads it in the machine's own
 * zone: in London, during summer time, a wait of thirty seconds parsed as an
 * hour ago. Assigning `process.env.TZ` changes what `Date.parse` does for every
 * later call in this process, which is what lets one test file stand in for two
 * machines. The first test in that block proves the assignment took, because a
 * TZ that silently did nothing would make every London row pass for free.
 */
import { afterEach, describe, expect, it } from "vitest";

import { parseRetryAfter } from "../src/retry-after.js";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");

describe("parseRetryAfter", () => {
  describe("the five headers the two old parsers disagreed about", () => {
    it.each([
      ["0", null],
      ["1.5", null],
      ["0x10", null],
      ["-5", null],
      ["Sun, 04 Oct 2026 11:59:00 GMT", null],
    ] as const)("%j is %j", (header, expected) => {
      expect(parseRetryAfter(header, NOW)).toBe(expected);
    });
  });

  describe("the ordinary ones", () => {
    it.each([
      ["120", 120_000],
      ["1", 1_000],
      ["  30  ", 30_000],
      ["\t7\t", 7_000],
      ["007", 7_000],
      ["Sun, 04 Oct 2026 12:00:30 GMT", 30_000],
      ["  Sun, 04 Oct 2026 12:00:30 GMT  ", 30_000],
    ] as const)("%j is %j ms", (header, expected) => {
      expect(parseRetryAfter(header, NOW)).toBe(expected);
    });

    it.each([
      [null],
      [""],
      ["   "],
      ["soon"],
      ["+5"],
      ["5 seconds"],
      ["1e3"],
      ["Infinity"],
      ["NaN"],
      /* `Date.parse` reads this one as a day in October; it does not start with a
         letter, so it is not an HTTP date and never reaches `Date.parse`. */
      ["2026-10-04T12:00:30Z"],
      ["04 Oct 2026 12:00:30 GMT"],
    ] as const)("%j is no instruction", (header) => {
      expect(parseRetryAfter(header, NOW)).toBeNull();
    });

    it("is null or a finite number above zero, never anything else", () => {
      /* More digits than a double can hold exactly, and more than any date can
         be. A caller does arithmetic on the answer, so `Infinity` must not be
         one. */
      for (const header of ["9".repeat(400), "Sun, 04 Oct 275761 12:00:30 GMT", "Sun, 04 Oct 2026 12:00:00 GMT"]) {
        const got = parseRetryAfter(header, NOW);
        expect(got === null || (Number.isFinite(got) && got > 0)).toBe(true);
      }
      /* A date that is exactly now is a wait of nothing, which is not positive. */
      expect(parseRetryAfter("Sun, 04 Oct 2026 12:00:00 GMT", NOW)).toBeNull();
    });
  });

  describe("an HTTP date is UTC, whatever zone the machine is in", () => {
    const before = process.env.TZ;
    afterEach(() => {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    });

    it("the TZ assignment really changes how this process reads a zone-less date", () => {
      process.env.TZ = "UTC";
      const utc = Date.parse("Sun Oct  4 12:00:30 2026");
      process.env.TZ = "Europe/London";
      const london = Date.parse("Sun Oct  4 12:00:30 2026");
      /* British Summer Time on that day: local noon is 11:00 UTC. */
      expect(utc - london).toBe(60 * 60 * 1000);
    });

    const FORMS = [
      ["IMF-fixdate", "Sun, 04 Oct 2026 12:00:30 GMT"],
      ["RFC 850", "Sunday, 04-Oct-26 12:00:30 GMT"],
      ["asctime", "Sun Oct  4 12:00:30 2026"],
    ] as const;
    for (const tz of ["UTC", "Europe/London", "America/New_York"]) {
      it.each(FORMS)(`%s is thirty seconds away under TZ=${tz}`, (_name, header) => {
        process.env.TZ = tz;
        expect(parseRetryAfter(header, NOW)).toBe(30_000);
      });
    }

    it("a date that names a numeric offset is read with it, and one that names nothing is UTC", () => {
      for (const tz of ["UTC", "Europe/London", "America/New_York"]) {
        process.env.TZ = tz;
        expect(parseRetryAfter("Sun, 04 Oct 2026 13:00:30 +0100", NOW)).toBe(30_000);
        /* Not a form HTTP allows, and a server that drops the `GMT` still means UTC. */
        expect(parseRetryAfter("Sun, 04 Oct 2026 12:00:30", NOW)).toBe(30_000);
      }
    });

    it("preserves an explicit named zone instead of appending a second one", () => {
      for (const tz of ["UTC", "Europe/London", "America/New_York"]) {
        process.env.TZ = tz;
        for (const header of [
          "Sun, 04 Oct 2026 04:00:30 PST",
          "Sun, 04 Oct 2026 PST 04:00:30",
          "Sun Oct 4 PST 04:00:30 2026",
          "Sun, 04 Oct 2026 05:00:30 PDT",
          "Sun, 04 Oct 2026 07:00:30 EST",
          "Sun, 04 Oct 2026 08:00:30 EDT",
          "Sun, 04 Oct 2026 12:00:30 UT",
          "Sun, 04 Oct 2026 12:00:30 UTC",
          "Sun, 04 Oct 2026 12:00:30Z",
        ]) {
          expect(parseRetryAfter(header, NOW), `${tz}: ${header}`).toBe(30_000);
        }
      }
    });

    it("a past asctime date is no instruction in any zone", () => {
      for (const tz of ["UTC", "Europe/London", "America/New_York"]) {
        process.env.TZ = tz;
        /* In New York, read as local time, this would be four hours ahead. */
        expect(parseRetryAfter("Sun Oct  4 11:59:00 2026", NOW)).toBeNull();
      }
    });
  });
});
