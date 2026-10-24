/**
 * **A web page's day when its markup states none** (src/page-date.ts, plan
 * 261024a): the line under its title, else its address, the address only
 * after the registry. The negatives are most of the file, because a wrong day
 * here becomes Timeline's frame and the masthead's *Published*, and looks like
 * a fact.
 */
import { describe, expect, it } from "vitest";

import { addressDay, datelineDay, withAddressDay } from "../src/page-date.js";
import type { Meta } from "../src/types.js";

const FETCHED = "2026-10-24T09:00:00.000Z";
const records = (...texts: string[]) => texts.map((text, i) => ({ id: `r${i + 1}`, text }));
const under = (...lines: string[]) => datelineDay(records("A title", ...lines), true, FETCHED);

describe("datelineDay", () => {
  it("reads the bare line under the heading (report spya-gapqbt's page)", () => {
    expect(datelineDay(records("What if you don't need MCP at all?", "2025-11-02", "One chonky MCP server"), true, FETCHED)).toBe(
      "2025-11-02",
    );
  });

  it("reads the written-out forms, with or without a Published / Posted on", () => {
    const cases: [string, string][] = [
      ["2 November 2025", "2025-11-02"],
      ["2nd Nov 2025", "2025-11-02"],
      ["November 2, 2025", "2025-11-02"],
      ["Nov. 2, 2025", "2025-11-02"],
      ["Published 14 March 2024", "2024-03-14"],
      ["Posted on March 14th, 2024", "2024-03-14"],
      ["Published: 2024-03-14", "2024-03-14"],
    ];
    for (const [line, want] of cases) expect(under(line), line).toBe(want);
  });

  it("refuses a date with anything else on its line", () => {
    for (const line of [
      "Updated 14 March 2024",
      "Last modified 2024-03-14",
      "Conference | November 2, 2025",
      "Ada Lovelace · March 14, 2024 · 8 min read",
      "Meeting on 14 March 2024",
      "On 14 March 2024 the committee met for the first time in a decade.",
    ]) {
      expect(under(line), line).toBeUndefined();
    }
  });

  it("reads nothing when the opening did not start at a heading", () => {
    /* A page with no <h1> is read from the top of its body, where a bare date is the site's as often as the piece's. */
    expect(datelineDay(records("2024-03-14", "First paragraph."), false, FETCHED)).toBeUndefined();
    /* With a real heading before the same date, it is read: the control. */
    expect(datelineDay(records("A title", "2024-03-14", "First paragraph."), true, FETCHED)).toBe("2024-03-14");
  });

  it("does not mistake a date-shaped title for the line under it", () => {
    expect(datelineDay(records("May 2, 2025", "First paragraph."), true, FETCHED)).toBeUndefined();
  });

  it("looks only just under the heading", () => {
    expect(under("a", "b", "c", "2024-03-14")).toBeUndefined();
    expect(under("a", "b", "2024-03-14")).toBe("2024-03-14");
  });

  it("refuses a day that does not exist, one before the web, and one after the latest local day", () => {
    for (const line of ["2025-02-30", "31 April 2025", "4 July 1776", "2026-10-25"]) {
      expect(under(line), line).toBeUndefined();
    }
    /* After 10:00 UTC, tomorrow in UTC is already today in UTC+14. */
    expect(datelineDay(records("A title", "2026-10-25"), true, "2026-10-24T12:00:00.000Z")).toBe("2026-10-25");
    expect(datelineDay(records("A title", "2026-10-24"), true, "not an instant")).toBeUndefined();
  });

  it("states nothing for an opening with no dateline", () => {
    expect(under("The first paragraph of prose.")).toBeUndefined();
    expect(datelineDay([], true, FETCHED)).toBeUndefined();
  });
});

describe("addressDay", () => {
  it("reads a dated slug and a /yyyy/mm/dd/ path", () => {
    expect(addressDay("https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/", FETCHED)).toBe("2025-11-02");
    expect(addressDay("https://example.com/2024/03/14/a-post/", FETCHED)).toBe("2024-03-14");
    expect(addressDay("https://example.com/2024/03/14", FETCHED)).toBe("2024-03-14");
    expect(addressDay("https://lucumr.pocoo.org/2025/8/18/code-mcps/", FETCHED)).toBe("2025-08-18");
  });

  it("reads percent-encoded date characters in one path segment", () => {
    expect(addressDay("https://example.com/posts/2025%2D11%2D02-a-post/", FETCHED)).toBe("2025-11-02");
  });

  it("refuses a year or a month alone, the query string, the fragment and an arXiv id", () => {
    for (const url of [
      "https://example.com/2024/a-post/",
      "https://example.com/2024/03/a-post/",
      "https://example.com/archive?date=2024-03-14",
      "https://example.com/post#2024-03-14",
      "https://arxiv.org/abs/2308.08708",
    ]) {
      expect(addressDay(url, FETCHED), url).toBeUndefined();
    }
  });

  it("refuses an impossible day, a day before the web and a future one", () => {
    expect(addressDay("https://example.com/2024/02/30/x", FETCHED)).toBeUndefined();
    expect(addressDay("https://example.com/history/1969-07-20-moon-landing", FETCHED)).toBeUndefined();
    expect(addressDay("https://example.com/events/2031/01/01/conference", FETCHED)).toBeUndefined();
  });

  it("refuses a date-shaped prefix that is part of a word", () => {
    expect(addressDay("https://example.com/history/2024-03-14th-anniversary", FETCHED)).toBeUndefined();
  });

  it("states nothing without an address", () => {
    expect(addressDay(null, FETCHED)).toBeUndefined();
    expect(addressDay("not a url", FETCHED)).toBeUndefined();
  });
});

describe("withAddressDay, after the registry", () => {
  const BASE: Meta = { slug: "s", title: "T", fetchedAt: FETCHED };

  it("fills an article left with no date at all", () => {
    expect(withAddressDay(BASE, "2025-11-02").publishedAt).toBe("2025-11-02");
  });

  it("never replaces a day, and never sits beside a year", () => {
    expect(withAddressDay({ ...BASE, publishedAt: "2025-11-03" }, "2025-11-02").publishedAt).toBe("2025-11-03");
    const year = withAddressDay({ ...BASE, publishedYear: 2011 }, "2025-11-02");
    expect(year.publishedYear).toBe(2011);
    expect("publishedAt" in year).toBe(false);
  });

  it("adds no key when there is no address day", () => {
    expect("publishedAt" in withAddressDay(BASE, undefined)).toBe(false);
  });
});
