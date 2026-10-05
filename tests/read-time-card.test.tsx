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
import {
  readingMinutes,
  readingRange,
  WPM,
  WPM_QUICK,
  WPM_SLOW,
  type RatedDifficulty,
} from "../src/reading-time.js";
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

/** Plain words, hard ideas: 0.92 × 1.20 = 1.104 (plan 261005j § The numbers). */
const PLAIN_BUT_HARD: RatedDifficulty = {
  language: 2,
  ideas: 5,
  reason: "Short sentences, but each paragraph asks you to hold a new idea.",
};

function article(bodyWords: number, noteWords = 0, rating?: RatedDifficulty): Article {
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
    meta: { slug: SLUG, title: "A paper", ...(rating ? { readingDifficulty: rating } : {}) },
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
  const markup = (words: number, supplementWords = 0, difficulty: RatedDifficulty | null = null) =>
    renderToStaticMarkup(createElement(ReadTimeCard, { words, supplementWords, difficulty }));
  const text = (words: number, supplementWords = 0, difficulty: RatedDifficulty | null = null) =>
    markup(words, supplementWords, difficulty)
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

  /* Until plan 261005j this pinned "does not know how hard this piece is, or
     who is reading it". A piece can now be rated, so the unrated card says the
     narrower thing that is still true of it. */
  it("says an unrated piece has not been rated, and that this is the flat rate", () => {
    const said = text(11_900);
    expect(said).toContain("This piece has not been rated for difficulty, so this is the flat rate.");
    expect(said).toContain("Dense ideas, maths, figures or an unfamiliar subject can all take longer.");
    expect(said).not.toContain("does not know how hard");
    expect(said).not.toContain("a model judged");
    expect(said).toContain(`between ${WPM_SLOW} and ${WPM_QUICK} words a minute`);
    // The unrated arithmetic is what it was: no "is about" restating the head.
    expect(said).toContain("reading English non-fiction silently. Most adults");
  });

  describe("for a rated piece", () => {
    /* Every number below is worked out by hand from the plan's table, not from
       the functions the card calls. 11,900 words is 50 minutes flat; language 2
       and ideas 5 multiply to 1.104, so 55.2, shown as 55. The range is
       39.67 × 1.104 = 43.8 and 68 × 1.104 = 75.1. */
    it("gives the flat figure as where it started, then the adjustment and both ratings", () => {
      const said = text(11_900, 0, PLAIN_BUT_HARD);
      expect(said).toContain("About 55 minutes to read");
      expect(said).toContain(
        "11,900 words at 238 words a minute, the average for an adult reading English non-fiction silently, is about 50 minutes.",
      );
      expect(said).toContain(
        "Adjusted to 55: a model judged the language 2 of 5 and the ideas 5 of 5 from sampled passages, which adds about 10% to the time.",
      );
      expect(said).toContain(
        "Most adults read such text at between 175 and 300 words a minute. With the same adjustment that would be about 44–75 minutes.",
      );
    });

    it("no longer says it does not know how hard the piece is, and still says it does not know the reader", () => {
      const said = text(11_900, 0, PLAIN_BUT_HARD);
      expect(said).not.toContain("does not know how hard");
      expect(said).not.toContain("has not been rated");
      expect(said).toContain(
        "The estimate does not know who is reading. A subject you know well will go faster; maths, figures or an unfamiliar one can take longer.",
      );
    });

    it("shows the model's sentence, in the model's face and nowhere else", () => {
      const html = markup(11_900, 0, PLAIN_BUT_HARD);
      expect(html).toContain(`<span class="voice-ai">${PLAIN_BUT_HARD.reason}</span>`);
      // Our own sentences about the rating are ours, not the model's.
      expect(html.match(/voice-ai/g)).toHaveLength(1);
    });

    it("says quicker when the piece is easier than average: (1,1) is 0.836", () => {
      const said = text(11_900, 0, { language: 1, ideas: 1, reason: "Everyday words and nothing new." });
      // 50 × 0.836 = 41.8; the range is 33.16 and 56.85.
      expect(said).toContain("About 42 minutes to read");
      expect(said).toContain(
        "Adjusted to 42: a model judged the language 1 of 5 and the ideas 1 of 5 from sampled passages, which takes about 16% off the time.",
      );
      expect(said).toContain("With the same adjustment that would be about 33–57 minutes.");
    });

    it("says the estimate is not adjusted for the neutral rating, language 3 and ideas 2", () => {
      const said = text(11_900, 0, { language: 3, ideas: 2, reason: "Ordinary non-fiction." });
      expect(said).toContain("About 50 minutes to read");
      expect(said).toContain(
        "A model judged the language 3 of 5 and the ideas 2 of 5 from sampled passages, which is about average, so the estimate is not adjusted.",
      );
      expect(said).not.toContain("Adjusted to");
      expect(said).not.toContain("With the same adjustment");
      expect(said).toContain("which would be about 40–68 minutes");
    });

    it("does not claim to have adjusted a number the rounding left alone", () => {
      // 250 words: 1.05 flat, shown as 1; (3,3) is 1.05, so 1.10, still 1.
      const said = text(250, 0, { language: 3, ideas: 3, reason: "A few ideas to hold." });
      expect(said).toContain("About 1 minute to read");
      expect(said).toContain("is about 1 minute.");
      expect(said).not.toContain("Adjusted to");
      expect(said).toContain("which adds about 5% to the time, too little to change the number here.");
    });

    it("keeps the notes line, and the floor's explanation where it shows", () => {
      expect(text(11_900, 2_400, PLAIN_BUT_HARD)).toContain(
        "2,400 words of notes set apart from the main text are not counted",
      );
      expect(text(1, 0, PLAIN_BUT_HARD)).toContain("Never shown as less than a minute");
    });

    it("names no model, provider or cost", () => {
      const said = text(11_900, 0, PLAIN_BUT_HARD);
      expect(said).not.toMatch(/deepseek|openrouter|\$|cents?\b/i);
    });
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
    /* Rated, and the literal is not the flat one: 11,900 words is 50 minutes
       flat and 50 × 1.104 = 55.2, shown as 55. Three places that all ignored
       the rating would agree on 50 and fail here (GPT Sol, plan review F7). */
    { words: 11_900, notes: 2_400, minutes: 55, owner: true, rating: PLAIN_BUT_HARD },
  ] as { words: number; notes: number; minutes: number; owner: boolean; rating?: RatedDifficulty }[])("agrees across the shelf, masthead and Metadata ($words words, masthead owner=$owner, rating=$rating)", async ({ words, notes, minutes, owner, rating }) => {
    const a = article(words, notes, rating);
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
