// @vitest-environment jsdom
/**
 * **The card that explains the reading-time estimate** — plan 261005c
 * (spya-jew7ds).
 *
 * What a reader would notice if it broke: the card states a rate or a range the
 * headline number was not made from, the masthead and the metadata page explain
 * the same number differently, or the masthead's figure cannot be reached by a
 * keyboard.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readingMinutes, readingRange, WPM, WPM_QUICK, WPM_SLOW } from "../src/reading-time.js";
import { deriveLibraryScalars, describeArticle } from "../src/library-scalars.js";
import type { Article } from "../src/types.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

/* Metadata's query-state adapter and fixed dock are immaterial to the tile —
   the same two stubs as tests/masthead-authors.test.tsx. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

const { Masthead } = await import("../src/web/Masthead.js");
const { Metadata } = await import("../src/web/Metadata.js");
const { ReadTimeCard } = await import("../src/web/ReadTimeCard.js");
const { articleStats } = await import("../src/web/stats.js");

const SLUG = "a-long-paper";

function article(bodyWords: number, noteWords = 0): Article {
  const blocks: Article["blocks"] = [
    { id: "spya-aaaaaa", tag: "p", kind: "text", text: "Body.", words: bodyWords, html: "<p>Body.</p>", gistable: true },
  ];
  if (noteWords > 0) {
    blocks.push({
      id: "spya-bbbbbb",
      tag: "p",
      kind: "text",
      text: "Note.",
      words: noteWords,
      html: "<p>Note.</p>",
      gistable: true,
      role: "footnote",
      treatment: "supplement",
    });
  }
  return {
    highPowerSince: null,
    titleOverridden: false,
    meta: { slug: SLUG, title: "A paper" },
    blocks,
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A paper" },
      },
    },
  };
}

describe("readingRange", () => {
  it("is the same words at the quick and slow ends of what most adults read at", () => {
    const range = readingRange(11_900);
    expect(range.quick).toBe(Math.round(11_900 / WPM_QUICK));
    expect(range.slow).toBe(Math.round(11_900 / WPM_SLOW));
    expect(range.quick).toBeLessThan(readingMinutes(11_900));
    expect(range.slow).toBeGreaterThan(readingMinutes(11_900));
  });

  it("never says zero, and never puts the headline outside its own range", () => {
    for (const words of [0, 1, 40, 230, 238, 500, 5_000, 123_456]) {
      const { quick, slow } = readingRange(words);
      expect(quick).toBeGreaterThanOrEqual(1);
      expect(quick).toBeLessThanOrEqual(readingMinutes(words));
      expect(slow).toBeGreaterThanOrEqual(readingMinutes(words));
    }
  });

  it("is measured at Brysbaert's figure for non-fiction", () => {
    expect(WPM).toBe(238);
    expect(WPM_QUICK).toBe(300);
    expect(WPM_SLOW).toBe(175);
    expect(readingMinutes(2380)).toBe(10);
  });
});

describe("the reading-time card", () => {
  const text = (words: number, supplementWords = 0) =>
    renderToStaticMarkup(createElement(ReadTimeCard, { words, supplementWords }))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

  it("says the minutes, the words, the rate and the range the number was made from", () => {
    const said = text(11_900);
    expect(said).toContain(`About ${readingMinutes(11_900)} minutes to read`);
    expect(said).toContain("11,900 words");
    expect(said).toContain(`${WPM} words a minute`);
    const { quick, slow } = readingRange(11_900);
    expect(said).toContain(`about ${quick}–${slow} minutes`);
  });

  it("says plainly that it does not know how hard the piece is, or who is reading", () => {
    expect(text(11_900)).toContain("does not know how hard this piece is, or who is reading it");
    expect(text(11_900)).toContain(`between ${WPM_SLOW} and ${WPM_QUICK} words a minute`);
  });

  it("qualifies the population range and makes its conversion conditional", () => {
    const said = text(11_900);
    expect(said).toContain("reading English non-fiction silently. Most adults read such text at between");
    expect(said).toContain("which would be about");
    /* The floor is explained only where it shows. */
    expect(said).not.toContain("less than a minute");
  });

  it("explains why a one-word piece still says one minute", () => {
    const said = text(1);
    expect(said).toContain("1 word at 238 words a minute");
    expect(said).toContain("Never shown as less than a minute");
  });

  it("drops the range when it would be one number, and says a minute in the singular", () => {
    const said = text(120);
    expect(said).toContain("About 1 minute to read");
    expect(said).not.toContain("between");
  });

  it("mentions the notes only when the article has some", () => {
    expect(text(11_900)).not.toContain("not counted");
    expect(text(11_900, 2_400)).toContain("2,400 words of notes set apart from the main text are not counted");
  });
});

describe("where the card is shown", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    history.replaceState(null, "", `/read/${SLUG}`);
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ slug: SLUG, dir: "t/", stages: [], comments: 0, profile: null, purpose: null, archivedAt: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("opens from the masthead's minutes by keyboard, with the article's own numbers", async () => {
    const a = article(11_900, 2_400);
    await act(async () => {
      root.render(createElement(Masthead, { article: a, slug: SLUG }));
    });
    const trigger = host.querySelector(".facts .read-time-trigger") as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toBe(`~${articleStats(a).minutes} min`);
    expect(trigger.tabIndex).toBe(0);
    await act(async () => trigger.focus());
    const card = document.querySelector(".tooltip.tip-soon") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("11,900 words");
    expect(card.textContent).toContain("2,400 words of notes");
  });

  it.each([
    { words: 1, notes: 0, minutes: 1, owner: false },
    { words: 11_900, notes: 2_400, minutes: 50, owner: true },
    { words: 123_456, notes: 20_000, minutes: 519, owner: false },
  ])("agrees across the shelf, masthead and Metadata ($words words, masthead owner=$owner)", async ({ words, notes, minutes, owner }) => {
    const a = article(words, notes);
    const shelf = describeArticle({
      slug: SLUG,
      revisionId: "r1",
      meta: a.meta,
      scalars: deriveLibraryScalars({ blocks: a.blocks, tree: a.tree }),
      comments: 0,
      addedAt: "2026-10-05T00:00:00Z",
      sourceReusable: true,
      tags: [],
    });
    expect(shelf.minutes).toBe(minutes);
    await act(async () => {
      root.render(createElement(Masthead, { article: a, slug: SLUG, ...(owner ? { onRenamed: () => {} } : {}) }));
    });
    const trigger = host.querySelector(".read-time-trigger") as HTMLElement;
    expect(trigger.textContent).toBe(`~${minutes} min`);
    // The separator belongs to the outer fact, outside the underline.
    expect(trigger.parentElement?.parentElement?.className).toBe("facts");
    await act(async () => trigger.focus());
    const mastheadTip = document.getElementById(trigger.getAttribute("aria-describedby") ?? "");
    expect(mastheadTip?.getAttribute("role")).toBe("tooltip");
    const fromMasthead = mastheadTip?.querySelector(".tip-soon")?.textContent;
    expect(fromMasthead).toContain(`About ${minutes} ${minutes === 1 ? "minute" : "minutes"} to read`);
    await act(async () => root.unmount());
    root = createRoot(host);

    await act(async () => {
      // Metadata is an owner page; the public reader gets the same Masthead.
      root.render(createElement(Metadata, { article: a, slug: SLUG, onRenamed: () => {}, onVisibility: () => {} }));
    });
    const tile = [...host.querySelectorAll<HTMLElement>("[tabindex='0']")].find((el) =>
      el.textContent?.includes("Read time"),
    ) as HTMLElement;
    expect(tile).toBeDefined();
    expect(tile.lastElementChild?.textContent).toBe(`${minutes} min`);
    await act(async () => tile.focus());
    const metadataTip = document.getElementById(tile.getAttribute("aria-describedby") ?? "");
    expect(metadataTip?.getAttribute("role")).toBe("tooltip");
    const card = metadataTip?.querySelector(".tip-soon");
    expect(card).not.toBeNull();
    expect(card?.textContent).toBe(fromMasthead);

    if (owner) {
      const tiles = [...(tile.parentElement?.children ?? [])] as HTMLElement[];
      expect(tiles).toHaveLength(6);
      for (const stat of tiles) {
        expect(stat.tabIndex).toBe(0);
        await act(async () => stat.focus());
        const tip = document.getElementById(stat.getAttribute("aria-describedby") ?? "");
        expect(tip?.getAttribute("role")).toBe("tooltip");
        expect(tip?.textContent?.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
