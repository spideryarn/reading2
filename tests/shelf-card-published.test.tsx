// @vitest-environment jsdom
/**
 * **A Shelf card says when its piece was published**, whatever the sort.
 *
 * Greg, 2026-10-04 (report `spya-cqjhbn`): *"Show the publication date in the
 * logged-in homepage Shelf"*. Until then a card said it only while the shelf
 * was sorted by Published, in the note at its bottom left, so on the default
 * shelf no card said it at all.
 *
 * It is on the facts line under the title, printed by `publishedOf` — the one
 * reader of `publishedAt` and `publishedYear` — so a paper dated only to a year
 * says the year and nothing invents a day for it.
 * docs/plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md.
 *
 * The harness is tests/shelf-archive-label.test.tsx's.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";

vi.mock("../src/web/lib/api.js", () => ({
  fetchOk: () => Promise.resolve(new Response(null, { status: 200 })),
  apiFetch: () => Promise.resolve(new Response(null, { status: 200 })),
  readJson: () => Promise.resolve({}),
}));

const { ShelfCard } = await import("../src/web/ShelfEntry.js");
const { ADDED_NOTE } = await import("../src/web/library-columns.js");
const { publishedOf } = await import("../src/web/relative-time.js");

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

const BARE: LibraryEntry = {
  slug: "a-piece",
  title: "Something worth reading",
  byline: "Rich Sutton",
  siteName: "incompleteideas.net",
  addedAt: "2026-08-20T10:00:00.000Z",
  words: 2400,
  minutes: 11,
  blocks: 60,
  parts: 3,
  sections: 9,
  comments: 0,
  opens: 2,
  sourceReusable: true,
  has: { arc: false, tweets: false, glossary: false },
};

const shelf = {
  renaming: null,
  report: () => {},
  archive: () => Promise.resolve(),
  beginRename: () => {},
  cancelRename: () => {},
  rename: () => Promise.resolve(),
} as never;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The facts line of the card for `entry`: its facts, in order, without the separators. */
function factsOf(entry: LibraryEntry): string[] {
  act(() => {
    /* Sorted by Added, so the note at the bottom cannot be what supplies a date. */
    root.render(createElement(ShelfCard, { entry, shelf, note: ADDED_NOTE(entry, NOW) }) as ReactElement);
  });
  const line = host.querySelector("[data-shelf-facts]");
  if (!line) throw new Error("the card has no facts line");
  return [...line.querySelectorAll("[data-shelf-fact]")].map((el) =>
    (el.textContent ?? "").replace(/^·/, "").trim(),
  );
}

describe("the publication date on a shelf card", () => {
  it("prints the publisher's day, after the author and the site", () => {
    const entry = { ...BARE, publishedAt: "2019-03-13" };
    const day = publishedOf(entry)?.label;
    expect(day, "the fixture has a day").toMatch(/2019/);
    expect(factsOf(entry)).toEqual(["Rich Sutton", "incompleteideas.net", day, "~11 min", "60 blocks"]);
  });

  it("prints the year alone for a paper dated only to a year", () => {
    expect(factsOf({ ...BARE, publishedYear: 2017 })).toEqual([
      "Rich Sutton",
      "incompleteideas.net",
      "2017",
      "~11 min",
      "60 blocks",
    ]);
  });

  it("prints nothing, and no stranded separator, for a piece with no date", () => {
    expect(factsOf(BARE)).toEqual(["Rich Sutton", "incompleteideas.net", "~11 min", "60 blocks"]);
    expect(host.querySelector("[data-shelf-facts]")?.textContent).not.toMatch(/·\s*·/);
  });

  it("is there for a paper not read through yet", () => {
    const paper = { ...BARE, processing: "minimal", publishedYear: 2011 } as LibraryEntry;
    expect(factsOf(paper)).toEqual(["Rich Sutton", "incompleteideas.net", "2011"]);
  });

  it("keeps equal author, site and year facts without duplicate keys", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const entry = { ...BARE, byline: "2011", siteName: "2011", publishedYear: 2011 };
      expect(factsOf(entry)).toEqual(["2011", "2011", "2011", "~11 min", "60 blocks"]);
      expect(factsOf({ ...entry, publishedYear: 2012 })).toEqual([
        "2011", "2011", "2012", "~11 min", "60 blocks",
      ]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("has no leading separator when only a publication date is known", () => {
    const paper: LibraryEntry = { ...BARE, processing: "minimal", publishedYear: 2011 };
    delete paper.byline;
    delete paper.siteName;
    expect(factsOf(paper)).toEqual(["2011"]);
    expect(host.querySelector("[data-shelf-fact]")?.textContent).toBe("2011");
  });
});
