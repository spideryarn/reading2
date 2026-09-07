/**
 * **How much of this article is in that page, and how much of that page is this
 * article** — the two ratios that decide whether a search result is a *response*
 * to the piece or a *copy* of it.
 *
 * Every fixture here is a fixed string. The live corpus is where the numbers in
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md § "The
 * ceiling counts density, not coverage" came from, and it cannot be a test: the
 * extracts are whatever the search engine chose that minute, and they were
 * measurably different between the plan's run and the next one.
 *
 * **What the fixtures reproduce is the shape of that table, which is the whole
 * finding**: a copy of the article and an honest reply to it sit in the *same
 * band on coverage* — the copy can even score lower, because the engine handed
 * us 252 characters of it — and are two ends of the scale on density. A test
 * built only from the long mirrors would pass under a coverage ceiling, which is
 * the design that was measured and rejected.
 */
import { describe, expect, it } from "vitest";

import {
  COPY_DENSITY,
  COPY_MIN_WINDOWS,
  articleShingles,
  isArticleText,
  isCopy,
  shingleOverlap,
  shingleWindows,
} from "../src/shingles.js";
import type { ArticleBlockText } from "../src/shingles.js";
import type { BlockKind } from "../src/types.js";

/* ------------------------------------------------------------- the article -- */

/**
 * A short essay, as blocks with ids, standing in for anything on the shelf.
 *
 * Long enough that a 250-character slice of it is a small share of its windows —
 * which is the condition the coverage ceiling failed under and the reason the
 * ceiling counts density instead.
 */
type Fixture = [id: string, text: string, kind?: BlockKind];

/**
 * The article's blocks with their kinds, as `blockTextById` hands them over —
 * `text` unless the fixture says otherwise, because **headings are not
 * quotation evidence** and the shingler has to be told which is which.
 */
const blocksOf = (rows: readonly Fixture[]): Map<string, ArticleBlockText> =>
  new Map(rows.map(([id, text, kind]) => [id, { text, kind: kind ?? "text" }]));

const ARTICLE: Fixture[] = [
  ["spya-aaaaa1", "What the tide clock cannot tell you", "heading"],
  [
    "spya-aaaaa2",
    "Every harbour office I have visited keeps a tide clock on the wall behind the counter, and " +
      "every one of them has a handwritten card taped beneath it explaining that the clock is " +
      "wrong. The card is never an apology. It is closer to a warning, and the warning is always " +
      "the same: the clock knows the moon, and the moon is only half of what the water is doing.",
  ],
  [
    "spya-aaaaa3",
    "A tide clock is a beautifully simple instrument. It runs at the rate of the lunar day rather " +
      "than the solar one, which is to say twelve hours and twenty-five minutes from one high " +
      "water to the next, and it assumes that the sea beneath your window is a patient thing that " +
      "answers only to the moon overhead. In the middle of an ocean that assumption is nearly true.",
  ],
  [
    "spya-aaaaa4",
    "In a river mouth it is not true at all. The water in an estuary is shaped by the land it has " +
      "to squeeze past, by the shelving of the bed, by the wind that has been blowing across the " +
      "bay for the last three days, and by however much rain fell inland last week. None of that " +
      "is on the dial. The dial has one hand, the moon has one phase, and the harbour has a " +
      "hundred moods.",
  ],
  [
    "spya-aaaaa5",
    "So the card under the clock is doing something the clock cannot do. It names the residual, " +
      "the part of the answer the instrument was never built to hold, and it does it in the one " +
      "place where somebody about to take a boat out will read it. That is not a failure of the " +
      "clock. It is what an honest instrument looks like when somebody has thought about who is " +
      "standing in front of it.",
  ],
  [
    "spya-aaaaa6",
    "I think about that card whenever I am asked to put a number on a screen. The number will be " +
      "right in the way the tide clock is right, which is to say right about the one thing it was " +
      "built for and silent about everything else. A reader who is about to make a decision " +
      "deserves the card as well as the dial.",
  ],
  [
    "spya-aaaaa7",
    "The temptation is always to improve the clock. Add a correction for the wind, a coefficient " +
      "for the rainfall, a small adjustment for the season, and the dial creeps toward the truth " +
      "while nobody can any longer say what it is claiming. The card stays legible precisely " +
      "because it is not arithmetic. It is a sentence about the limits of a sentence.",
  ],
  [
    "spya-aaaaa8",
    "The harbours that get this right have all made the same choice, and none of them made it by " +
      "accident. They keep the instrument simple enough to be checked, and they put the caveat " +
      "where the eye lands. What they refuse to do is average the two together into one confident " +
      "number that is wrong in a way nobody can see.",
  ],
];

const article = articleShingles(blocksOf(ARTICLE));

/* -------------------------------------------------------------- the pages -- */

/**
 * **An archive of the whole essay**, with the archive's own chrome around it —
 * `archive.ph` in the plan's table, at 100% coverage and 95.3% density.
 */
const ARCHIVE_MIRROR =
  "archived 12 Oct 2024 06:11:44 UTC · original · webpage capture\n\n" +
  ARTICLE.map(([, text]) => text).join("\n\n") +
  "\n\nSaved from the original on 12 October 2024.";

/**
 * **The publisher's own page**, which is the same essay again with a nav bar, a
 * footer, and a CMS that smart-quotes — `www.paulgraham.com` in the table, at
 * 100% coverage and 79.5% density.
 *
 * The punctuation swap is deliberate: `findQuote`'s fold is what makes a mirror
 * still read as a mirror when the two pages disagree about apostrophes, and a
 * fixture that copied the bytes would prove nothing about that.
 */
const PUBLISHER_MIRROR = (
  "Home · Essays · RSS · About\n\n" +
  ARTICLE.map(([, text]) => text).join("\n\n") +
  "\n\nWant to start a startup? Get funded by our summer programme."
).replace(/'/g, "’");

/**
 * **252 characters of the article, mid-sentence at both ends** — Caltech's copy
 * of Cargo Cult Science, and `www.anthropic.com` serving a slice of the
 * constitution. Both were kept and shown as pages that quote the piece.
 *
 * This is the row the ceiling exists for: coverage cannot see it, because the
 * engine handed us a couple of hundred characters of a long document.
 */
const SHORT_COPY =
  "to squeeze past, by the shelving of the bed, by the wind that has been blowing across the bay " +
  "for the last three days, and by however much rain fell inland last week. None of that is on";

/**
 * **A genuine reply that quotes the piece at length** — `www.hamtyped.com` and
 * `sites.stat.columbia.edu` in the table, mostly its own words with two
 * sentences of the article in them.
 */
const LONG_REPLY =
  "There is a piece going round about harbour instruments that I have been arguing with all " +
  "week, and I want to say where I think it goes wrong. Its central image is the card taped " +
  "under the tide clock, and the claim is that the card is doing work the dial cannot. " +
  "“It names the residual, the part of the answer the instrument was never built to hold, " +
  "and it does it in the one place where somebody about to take a boat out will read it.” " +
  "That is a lovely sentence and I do not think it survives contact with a busy harbour. " +
  "Nobody reads the card. I have watched skippers for eleven seasons and the card is furniture. " +
  "The author also writes that “the temptation is always to improve the clock,” as " +
  "though correction were a vice rather than the ordinary business of making an instrument fit " +
  "the water it stands beside. The essay's own closing praise for the harbours that “keep the " +
  "instrument simple enough to be checked, and they put the caveat where the eye lands” is a " +
  "description of about four harbours in England and none at all in a working port. " +
  "Every working tide table in this country is corrected, and the " +
  "corrections are published, and nobody calls that dishonest arithmetic. What the essay is " +
  "really defending is a preference for legibility over accuracy, which is a defensible " +
  "position and a different one from the one it says it holds. The right answer is probably " +
  "both: correct the dial and keep the card, and say plainly which of the two you trusted when " +
  "the boat went out.";

/**
 * **A short reply that quotes one sentence** — `robinsonraju.blog`, whose whole
 * extract was 765 characters and which the floor must still keep.
 */
const SHORT_REPLY =
  "Notes from this week's reading. A short essay on tide clocks makes a point I keep coming " +
  "back to about dashboards at work: “the dial has one hand, the moon has one phase, and " +
  "the harbour has a hundred moods.” Our sprint burndown is a tide clock. It answers to " +
  "one thing and the quarter answers to nine, and every time somebody asks why the line is " +
  "flat the honest reply is a paragraph rather than a number. I have started writing the " +
  "paragraph underneath the chart. Nobody has thanked me for it yet.";

/** **A page about something else entirely**, returned by a search as they always are. */
const UNRELATED =
  "Our sourdough starter guide, updated for autumn. A young starter wants feeding twice a day " +
  "in a warm kitchen and once in a cool one, and the difference in activity is obvious within " +
  "hours. Keep it loosely covered, keep it out of a draught, and do not be alarmed by the smell.";

/* -------------------------------------------------------------- the windows -- */

describe("what counts as a window", () => {
  it("takes every run of eight words that reaches forty characters", () => {
    /* Nine words, so two runs of eight, and both are long enough. */
    expect(shingleWindows("alpha bravo charlie delta echo foxtrot golf hotel india")).toEqual([
      "alpha bravo charlie delta echo foxtrot golf hotel",
      "bravo charlie delta echo foxtrot golf hotel india",
    ]);
  });

  it("refuses a run of eight short words", () => {
    /* Eight words and fifteen characters. Common words in a common order are not
       evidence that one page has read another. */
    expect(shingleWindows("a b c d e f g h i")).toEqual([]);
  });

  it("has no window in fewer than eight words", () => {
    expect(shingleWindows("seven words is one fewer than eight")).toEqual([]);
  });

  it("reads a line break as a word break, so a window never spans one silently", () => {
    /* `block.text` collapses whitespace, but an extract is whatever the engine
       sent, newlines and all. */
    expect(shingleWindows("alpha bravo charlie\ndelta echo foxtrot golf hotel")).toEqual([
      "alpha bravo charlie delta echo foxtrot golf hotel",
    ]);
  });
});

/* ------------------------------------------------------ headings are not prose -- */

/**
 * **A long title is not a quotation of the piece it titles** — GPT Sol's F1,
 * 2026-09-06.
 *
 * Eight words reaching forty characters is a window, and plenty of titles are
 * both, so an article whose H1 is long enough was quoting *itself*: a page that
 * merely repeated the title earned `quoted`, cleared the default bar, and was
 * shown as reception. That is the failure the whole file exists to prevent,
 * arriving through the signal built to prevent it. The seven-word title above is
 * exactly why no fixture could see it.
 */
describe("headings are not quotation evidence", () => {
  const LONG_TITLE = "A careful guide to building reliable artificial intelligence systems at scale";
  const PROSE =
    "The second week is when the interesting regressions arrive, and by then nobody is looking " +
    "at the evaluation suite that was written in the first.";

  const titled = articleShingles(
    blocksOf([
      ["spya-fffff1", LONG_TITLE, "heading"],
      ["spya-fffff2", PROSE],
    ]),
  );

  it("takes no window from a heading, however long the heading is", () => {
    /* Long enough on its own — the rule has to be about what the block *is*. */
    expect(shingleWindows(LONG_TITLE).length).toBeGreaterThan(0);
    expect(titled.windows.every((w) => w.blockId === "spya-fffff2")).toBe(true);
  });

  it("gives a page that only repeats the title no hit at all", () => {
    const successor =
      `${LONG_TITLE} — the new 2026 edition overturns the earlier advice on evaluation and ` +
      "deployment, and replaces the checklist at the back of it entirely.";
    expect(shingleOverlap(titled, successor).hit).toBeNull();
  });

  it("does not count a heading on the copy side either, so one rule holds both", () => {
    /* The first draft kept headings in `blocks`, and a title long enough to
       carry five windows then made an extract that is *only* the title read as
       100% article words — dropped as `sourceIsCopy`, with the reader told the
       page was a copy of the piece. Two false sentences about the same page,
       from the two halves of one file. GPT Sol, on the first draft of this fix. */
    const LONGER =
      "A careful guide to building reliable artificial intelligence systems safely at " +
      "planetary scale today";
    const longer = articleShingles(
      blocksOf([
        ["spya-ggggg1", LONGER, "heading"],
        ["spya-ggggg2", PROSE],
      ]),
    );
    expect(longer.blocks.map((b) => b.blockId)).not.toContain("spya-ggggg1");
    expect(isArticleText(longer, LONGER)).toBe(false);
    const titleOnly = shingleOverlap(longer, LONGER);
    /* Enough windows that the floor is not what is saving it. */
    expect(titleOnly.extractWindows).toBeGreaterThanOrEqual(COPY_MIN_WINDOWS);
    expect(titleOnly.density).toBe(0);
    expect(isCopy(titleOnly)).toBe(false);
  });

  it("still sees a mirror that reproduces the prose under the heading", () => {
    const mirror = `${LONG_TITLE}\n\n${PROSE}`;
    expect(isCopy(shingleOverlap(titled, mirror))).toBe(true);
  });
});

/* --------------------------------------------- the row's own words, or the article's -- */

/**
 * **Whose words is this passage?** — the second signal the copy refusal wants,
 * asked of one quotation rather than of a ratio (GPT Sol's F2).
 */
describe("is this passage the article's own words", () => {
  it("says yes to a sentence lifted out of a block", () => {
    expect(isArticleText(article, "It names the residual, the part of the answer")).toBe(true);
  });

  it("says no to a reply's own sentence, however much of the article surrounds it", () => {
    expect(isArticleText(article, "That conclusion is completely unsupported.")).toBe(false);
  });

  it("accepts a run of words that crosses a block boundary, which density may not", () => {
    /* The extract of a copy is the article's blocks with the breaks between
       them, and the spaced matcher reads across one — so a model that picked a
       `sourceQuote` spanning two paragraphs took a mirror past the refusal while
       this said false. Across a break the words are still the article's. Density
       is asked per block for the opposite reason: a join there would invent
       windows and inflate the ratio with text nobody wrote. */
    const spanning = "a hundred moods. So the card under the clock";
    expect(isArticleText(article, spanning)).toBe(true);
    expect(ARTICLE.some(([, text]) => text.includes(spanning))).toBe(false);
  });

  it("is still no for a reply's own words, whichever blocks they sit between", () => {
    expect(isArticleText(article, "the card is furniture and nobody stops to read it")).toBe(false);
  });

  it("says no to an empty quotation rather than yes to everything", () => {
    expect(isArticleText(article, "   ")).toBe(false);
  });
});

/* ------------------------------------------------------------- the two ratios -- */

describe("the two ratios", () => {
  it("counts coverage over the article's windows and density over the extract's", () => {
    /* Two blocks, one window each, and an extract holding the second of them
       plus one window of its own — so half the article is in the page and half
       the page is the article. Hand-countable on purpose. */
    const tiny = articleShingles(
      blocksOf([
        ["spya-bbbbb1", "alpha bravo charlie delta echo foxtrot golf hotel"],
        ["spya-bbbbb2", "india juliett kilo lima mike november oscar papa"],
      ]),
    );
    const overlap = shingleOverlap(tiny, "india juliett kilo lima mike november oscar papa quebec");
    expect(overlap.articleWindows).toBe(2);
    expect(overlap.extractWindows).toBe(2);
    expect(overlap.coverage).toBeCloseTo(0.5, 10);
    expect(overlap.density).toBeCloseTo(0.5, 10);
  });

  it("is zero rather than not-a-number when there is nothing to divide", () => {
    const empty = articleShingles(blocksOf([["spya-ccccc1", "too short to hold a window"]]));
    const overlap = shingleOverlap(empty, "also far too short");
    expect(overlap.articleWindows).toBe(0);
    expect(overlap.extractWindows).toBe(0);
    expect(overlap.coverage).toBe(0);
    expect(overlap.density).toBe(0);
  });

  it("reports both ratios on a page that earns no signal at all", () => {
    /* The caller shows these in the tooltip whatever the verdict was, so they
       are returned rather than folded into a boolean. */
    const overlap = shingleOverlap(article, UNRELATED);
    expect(overlap.hit).toBeNull();
    expect(overlap.coverage).toBe(0);
    expect(overlap.density).toBe(0);
    expect(overlap.extractWindows).toBeGreaterThan(COPY_MIN_WINDOWS);
  });
});

/* ---------------------------------------------------------------- the floor -- */

describe("the floor — any hit at all", () => {
  it("hands back the extract's own characters, not the article's", () => {
    /* The same discipline as `locate` in src/debate.ts: what is shown to a
       reader is the page's spelling of the passage, because that is what they
       would see if they followed the link. The two differ by one character here
       — the article's apostrophe is straight and the page's is curly — which is
       both what the fold exists to see through and what a fixture that copied
       the bytes could never prove. */
    const line = "the harbour office's card is a sentence about the limits of a sentence";
    const essay = articleShingles(blocksOf([["spya-eeeee1", line]]));
    const page =
      "The essay ends by saying that “the harbour office’s card is a sentence about the limits " +
      "of a sentence”, and after eleven seasons on this quay I think that is exactly backwards.";
    const overlap = shingleOverlap(essay, page);
    expect(overlap.hit?.quote).toBe("the harbour office’s card is a sentence about");
    expect(page).toContain(overlap.hit?.quote);
    expect(line).not.toContain(overlap.hit?.quote);
  });

  it("keeps a page whose only overlap is one quoted line", () => {
    const overlap = shingleOverlap(article, SHORT_REPLY);
    expect(overlap.hit).not.toBeNull();
    expect(SHORT_REPLY).toContain(overlap.hit?.quote);
  });

  it("names the block the window came from", () => {
    const overlap = shingleOverlap(article, SHORT_REPLY);
    expect(overlap.hit?.blockId).toBe("spya-aaaaa4");
  });

  it("keeps a short reply that quotes one sentence", () => {
    const overlap = shingleOverlap(article, SHORT_REPLY);
    expect(overlap.hit).not.toBeNull();
    expect(isCopy(overlap)).toBe(false);
  });

  it("keeps a long reply that quotes two", () => {
    const overlap = shingleOverlap(article, LONG_REPLY);
    expect(overlap.hit).not.toBeNull();
    expect(isCopy(overlap)).toBe(false);
    /* Mostly its own words, which is what a reply is. */
    expect(overlap.density).toBeLessThan(0.35);
  });
});

/* -------------------------------------------------------------- the ceiling -- */

describe("the ceiling — a copy is not a response", () => {
  it("refuses an archive of the whole essay", () => {
    const overlap = shingleOverlap(article, ARCHIVE_MIRROR);
    expect(overlap.coverage).toBe(1);
    expect(overlap.density).toBeGreaterThanOrEqual(COPY_DENSITY);
    expect(isCopy(overlap)).toBe(true);
  });

  it("refuses the publisher's own page, smart quotes and all", () => {
    const overlap = shingleOverlap(article, PUBLISHER_MIRROR);
    expect(overlap.coverage).toBe(1);
    expect(isCopy(overlap)).toBe(true);
  });

  it("refuses 252 characters of the article, which coverage cannot see", () => {
    const overlap = shingleOverlap(article, SHORT_COPY);
    expect(overlap.density).toBe(1);
    expect(isCopy(overlap)).toBe(true);
  });

  /**
   * **The finding the whole ceiling rests on**, and the assertion that fails
   * under the design this replaced: on coverage the slice of the article scores
   * *below* an honest reply, so a coverage ceiling would drop the reply and keep
   * the copy. Caltech's copy scored 0.5% and Columbia's reply 4.0%.
   */
  it("scores the copy below the reply on coverage and far above it on density", () => {
    const copy = shingleOverlap(article, SHORT_COPY);
    const reply = shingleOverlap(article, LONG_REPLY);
    expect(copy.coverage).toBeLessThan(reply.coverage);
    expect(copy.density).toBeGreaterThan(reply.density * 3);
    expect(isCopy(copy)).toBe(true);
    expect(isCopy(reply)).toBe(false);
  });

  it("will not fire on a handful of windows", () => {
    /* A 120-character extract is a couple of dozen windows at most and can be
       three; a ratio over three of them is noise, so the ceiling holds its
       tongue and the row survives on the floor. */
    const scrap = "of the answer the instrument was never built to hold";
    const overlap = shingleOverlap(article, scrap);
    expect(overlap.extractWindows).toBeGreaterThan(0);
    expect(overlap.extractWindows).toBeLessThan(COPY_MIN_WINDOWS);
    expect(overlap.density).toBe(1);
    expect(isCopy(overlap)).toBe(false);
  });

  it("fires at the threshold itself, not only above it", () => {
    /* Five windows, of which three are the article's — 60%, over the bar. The
       arithmetic is `>=`, and a fixture sitting on the boundary is what keeps it
       from drifting to `>`. */
    const tiny = articleShingles(
      blocksOf([["spya-ddddd1", "alpha bravo charlie delta echo foxtrot golf hotel india juliett"]]),
    );
    const extract = "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima";
    const overlap = shingleOverlap(tiny, extract);
    expect(overlap.extractWindows).toBe(5);
    expect(overlap.density).toBeCloseTo(0.6, 10);
    expect(isCopy(overlap)).toBe(true);
  });
});
