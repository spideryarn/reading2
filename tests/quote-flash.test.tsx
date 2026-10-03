// @vitest-environment jsdom
/**
 * **A citation whose sentence quotes the article lands on the quoted words.**
 *
 * A reader's report, spya-hzpf9b: an answer in Chat, Recall or Tutorial reads
 * *He calls it "an intelligent data pattern" [spya-ajt4fw]*, the chip scrolls
 * to a 250-word paragraph and washes all of it, and the sentence being quoted
 * is nowhere to be seen. Plan
 * docs/plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md.
 *
 * Three halves, each of which fails silently, so each is pinned here:
 *
 *  - **which words** — `quotesBefore` (src/web/citations.ts): every quotation
 *    since the previous chip with no sentence break between it and this one.
 *    About one in ten of the quotations in 120 real tutor turns were not straight
 *    before their chip, which is why the rule is the sentence and not adjacency;
 *  - **carrying them** — the chip's click hands the quotes to `onJump` beside
 *    the id, and `beginJump` hands them to the flash without sending the scroll
 *    a passage key that will never resolve;
 *  - **painting them** — `flashBlock` (src/web/flash.ts) registers a `Range`
 *    for each quote it finds in the block, with the CSS Custom Highlight API,
 *    instead of washing the cell. A quote that is not in the block paints
 *    nothing, which is what makes the generous rule above safe; none found, or
 *    no such API, is exactly the old wash.
 *
 * jsdom has no `CSS.highlights`, so a Map and a `Highlight` class stand in; the
 * assertion is on the registered Ranges' own text.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quotesBefore } from "../src/web/citations.js";
import { CitedMarkdown } from "../src/web/Cited.js";
import { NOTE_REF_ATTR } from "../src/web/notes-view.js";

const { CITE_FLASH_MS, QUOTE_HIGHLIGHT, dropPendingFlash, flashBlock, flushPendingFlash, resetFlash } =
  await import("../src/web/flash.js");

describe("quotesBefore", () => {
  it("takes a straight-quoted run that ends the text", () => {
    expect(quotesBefore('He calls it "an intelligent data pattern" ')).toEqual(["an intelligent data pattern"]);
  });

  it("takes a curly-quoted run, with or without a space before the chip", () => {
    expect(quotesBefore("He calls it “an intelligent data pattern” ")).toEqual(["an intelligent data pattern"]);
    expect(quotesBefore("He calls it “an intelligent data pattern”")).toEqual(["an intelligent data pattern"]);
  });

  it("takes both of two quotations in one sentence, in the order written", () => {
    expect(
      quotesBefore(
        'he says the engram "looks increasingly random" once correlations are removed, so "the interpretation … must be creative" ',
      ),
    ).toEqual(["looks increasingly random", "the interpretation"]);
  });

  it("takes a quotation with more of the sentence between it and the chip", () => {
    expect(quotesBefore("the “salience of the data”, reinterpreted fresh each time ")).toEqual([
      "salience of the data",
    ]);
    expect(quotesBefore('He calls it "an intelligent data pattern" (his phrase) ')).toEqual([
      "an intelligent data pattern",
    ]);
  });

  it("gives a chip nothing when a sentence break lies between the quotation and it", () => {
    expect(quotesBefore('He calls it "an intelligent data pattern". Later he softens the claim ')).toEqual([]);
    expect(quotesBefore('Is it "an intelligent data pattern"? He goes on to doubt it ')).toEqual([]);
    expect(quotesBefore('He calls it "an intelligent data pattern". ')).toEqual([]);
  });

  it("keeps the quotations after a sentence break and drops the ones before it", () => {
    expect(
      quotesBefore('It opens with "the earlier phrase here" and stops. Then "the later phrase here" follows '),
    ).toEqual(["the later phrase here"]);
  });

  it("does not count a full stop inside a quotation as a sentence break", () => {
    expect(quotesBefore('"It ends here. And then goes on" is how he puts it ')).toEqual([
      "It ends here. And then goes on",
    ]);
  });

  it("takes the longest piece of a quotation with an ellipsis in it", () => {
    expect(quotesBefore('"short bit … the much longer piece of it" ')).toEqual(["the much longer piece of it"]);
    expect(quotesBefore('"the much longer piece of it... short bit" ')).toEqual(["the much longer piece of it"]);
    expect(quotesBefore('"the much longer piece of it [...] short bit" ')).toEqual([
      "the much longer piece of it",
    ]);
  });

  it("drops the sentence punctuation an American-style quotation closes on", () => {
    expect(quotesBefore('"an intelligent data pattern." ')).toEqual(["an intelligent data pattern"]);
    expect(quotesBefore('"an intelligent data pattern," ')).toEqual(["an intelligent data pattern"]);
  });

  it("ignores a quotation too short to be worth finding, and keeps its neighbour", () => {
    expect(quotesBefore('He calls it "a self" ')).toEqual([]);
    expect(quotesBefore('"tiny … bits" ')).toEqual([]);
    expect(quotesBefore('the "self" is "an intelligent data pattern" ')).toEqual(["an intelligent data pattern"]);
  });

  it("says a repeated quotation once", () => {
    expect(quotesBefore('"the same phrase here" and again "the same phrase here" ')).toEqual([
      "the same phrase here",
    ]);
  });

  it("takes nothing from a closing mark with no opening mark in the same text", () => {
    /* What a quotation with emphasis inside it looks like from its last text
       node: the opening mark is in an earlier node. */
    expect(quotesBefore(' data pattern" ')).toEqual([]);
    expect(quotesBefore(" data pattern” ")).toEqual([]);
    /* And one whose nearest earlier mark is somebody else's closing mark. */
    expect(quotesBefore("the first” and then some more words” ")).toEqual([]);
  });

  it("is empty for text with no quotation at all", () => {
    expect(quotesBefore("He says so plainly ")).toEqual([]);
    expect(quotesBefore("")).toEqual([]);
  });
});

/* ------------------------------------------------------------ the click -- */

const BLOCKS = new Map([
  ["spya-k3m9qt", "The paragraph the model cited."],
  ["spya-p7w2dn", "Another paragraph."],
]);

describe("a chip in a sentence that quotes the article", () => {
  let host: HTMLDivElement;
  let root: Root;
  let jumps: unknown[][];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.replaceChildren(host);
    root = createRoot(host);
    jumps = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function paint(text: string): void {
    act(() => {
      root.render(
        createElement(CitedMarkdown, {
          text,
          blocks: BLOCKS,
          onJump: (...args: unknown[]) => void jumps.push(args),
          links: true,
        }),
      );
    });
  }
  function press(id: string): void {
    const chip = host.querySelector<HTMLAnchorElement>(`a[data-block-link="${id}"]`);
    if (!chip) throw new Error(`no chip for ${id}`);
    act(() => {
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
  }

  it("passes the quote with the id", () => {
    paint('He calls it "an intelligent data pattern" [spya-k3m9qt].');
    press("spya-k3m9qt");
    expect(jumps).toEqual([["spya-k3m9qt", { quotes: ["an intelligent data pattern"] }]]);
  });

  it("passes both quotations of one sentence to the chip at its end", () => {
    paint(
      'He says the engram "looks increasingly random" once correlations are removed, so "the interpretation … must be creative" [spya-k3m9qt].',
    );
    press("spya-k3m9qt");
    expect(jumps).toEqual([["spya-k3m9qt", { quotes: ["looks increasingly random", "the interpretation"] }]]);
  });

  it("passes a quotation that has more of the sentence between it and the chip", () => {
    paint("The “salience of the data”, reinterpreted fresh each time [spya-k3m9qt].");
    press("spya-k3m9qt");
    expect(jumps).toEqual([["spya-k3m9qt", { quotes: ["salience of the data"] }]]);
  });

  it("gives every chip of one bracket the same quote", () => {
    paint("He calls it “an intelligent data pattern” [spya-k3m9qt, spya-p7w2dn].");
    press("spya-k3m9qt");
    press("spya-p7w2dn");
    expect(jumps).toEqual([
      ["spya-k3m9qt", { quotes: ["an intelligent data pattern"] }],
      ["spya-p7w2dn", { quotes: ["an intelligent data pattern"] }],
    ]);
  });

  it("passes the id alone when the quotation is a sentence back and the chip is on a paraphrase", () => {
    paint('He calls it "an intelligent data pattern". Later he softens the claim [spya-k3m9qt].');
    press("spya-k3m9qt");
    expect(jumps).toEqual([["spya-k3m9qt"]]);
  });

  it("never gives a quotation to the chip after the one it belongs to", () => {
    paint('"an intelligent data pattern" [spya-k3m9qt] and more besides [spya-p7w2dn].');
    press("spya-p7w2dn");
    expect(jumps).toEqual([["spya-p7w2dn"]]);
  });

  it("falls back to the id alone when emphasis splits the quotation (an accepted limit)", () => {
    /* The quotation is three inline nodes, and no one text node holds both of
       its marks. The whole-block wash is the right answer; a highlight on
       ` data pattern` alone would be a wrong one. */
    paint('He calls it "an *intelligent* data pattern" [spya-k3m9qt].');
    press("spya-k3m9qt");
    expect(jumps).toEqual([["spya-k3m9qt"]]);
  });
});

/* ------------------------------------------------------------ the paint -- */

/** What stands in for `CSS.highlights`: the registry, and what was put in it. */
class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
let registry: Map<string, FakeHighlight>;

function withHighlights(on: boolean): void {
  registry = new Map();
  const css: Record<string, unknown> = { escape: (s: string) => s };
  if (on) css.highlights = registry;
  globalThis.CSS = css as unknown as typeof globalThis.CSS;
  if (on) vi.stubGlobal("Highlight", FakeHighlight);
  else vi.stubGlobal("Highlight", undefined);
}

const realMatchMedia = window.matchMedia;
function reduceMotion(on: boolean): void {
  window.matchMedia = ((q: string) =>
    ({ matches: on && q.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
}

const A = "spya-aaaaaa";
const B = "spya-bbbbbb";
const LONG =
  "Consciousness is not a thing. He calls the mind <em>an intelligent</em> data pattern, and CO2 is a gas. " +
  `Self<sup><a ${NOTE_REF_ATTR}="note-1" href="#note-1">2</a></sup> as a process is the claim.`;

function layOut({ covers = false } = {}): void {
  document.body.innerHTML = `
    <div class="reader${covers ? " band-covers" : ""}">
      ${covers ? '<aside class="mode-band"></aside>' : ""}
      <table><tbody>
        <tr data-block="${A}"><td class="text"><p>${LONG}</p></td></tr>
        <tr data-block="${B}"><td class="text"><p>Another paragraph, with other words in it.</p></td></tr>
      </tbody></table>
    </div>`;
}
const cell = (id: string) => document.querySelector<HTMLElement>(`tr[data-block="${id}"] td.text`);
const washed = (id: string) =>
  cell(id)?.classList.contains("block-flash") || cell(id)?.classList.contains("block-flash-still");
const painted = () => registry.get(QUOTE_HIGHLIGHT)?.ranges.map((r) => r.toString()) ?? null;

describe("flashBlock with a quote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    withHighlights(true);
    reduceMotion(false);
    layOut();
  });
  afterEach(() => {
    resetFlash();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    dropPendingFlash();
    vi.unstubAllGlobals();
    window.matchMedia = realMatchMedia;
  });

  it("paints the quoted words and not the cell, then takes the paint off", () => {
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    expect(painted(), "across the <em>, which a text search of one node would miss").toEqual([
      "an intelligent data pattern",
    ]);
    expect(washed(A), "the cell is not washed as well").toBe(false);
    vi.advanceTimersByTime(CITE_FLASH_MS - 1);
    expect(painted()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(painted()).toBeNull();
  });

  it("forgives the model's capitals, as every other quote on the page is forgiven", () => {
    flashBlock(A, { quotes: ["consciousness is NOT a thing"] });
    expect(painted()).toEqual(["Consciousness is not a thing"]);
  });

  it("washes the whole cell, as before, when the words are not in the block", () => {
    flashBlock(A, { quotes: ["words the article never says"] });
    expect(painted()).toBeNull();
    expect(washed(A)).toBe(true);
  });

  it("washes the whole cell, as before, in a browser with no highlight API", () => {
    withHighlights(false);
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    expect(washed(A)).toBe(true);
  });

  it("reads past a footnote marker printed inside the phrase", () => {
    flashBlock(A, { quotes: ["Self as a process"] });
    const range = registry.get(QUOTE_HIGHLIGHT)?.ranges[0];
    /* The Range runs across the marker, so its own text has the digit in it;
       what matters is that it starts at `Self` and ends at `process`. */
    expect(range?.toString()).toBe("Self2 as a process");
    expect(washed(A)).toBe(false);
  });

  it("identifies a marker by its node, so the 2 of CO2 stays", () => {
    flashBlock(A, { quotes: ["CO2 is a gas"] });
    expect(painted()).toEqual(["CO2 is a gas"]);
    flashBlock(A, { quotes: ["CO is a gas"] });
    expect(painted(), "a digit in the prose is prose").toBeNull();
    expect(washed(A)).toBe(true);
  });

  it("paints every quote of the sentence that is in the block, under the one highlight", () => {
    flashBlock(A, { quotes: ["Consciousness is not a thing", "CO2 is a gas"] });
    expect(painted()).toEqual(["Consciousness is not a thing", "CO2 is a gas"]);
    expect(washed(A)).toBe(false);
    vi.advanceTimersByTime(CITE_FLASH_MS);
    expect(painted()).toBeNull();
  });

  it("flashes drawn passage marks in preference to matching quotes", () => {
    const prose = cell(A);
    if (!prose) throw new Error("missing prose cell");
    prose.innerHTML = '<p><mark class="hit" data-hit="chosen">the drawn passage</mark> and other quoted words</p>';
    flashBlock(A, { passage: "chosen", quotes: ["other quoted words"] });
    expect(prose.querySelector("mark")?.classList.contains("passage-flash")).toBe(true);
    expect(painted()).toBeNull();
    expect(washed(A)).toBe(false);
  });

  it("uses matching quotes when the requested passage has no drawn marks", () => {
    flashBlock(A, { passage: "missing", quotes: ["an intelligent data pattern"] });
    expect(painted()).toEqual(["an intelligent data pattern"]);
    expect(washed(A)).toBe(false);
  });

  it("maps forgiving matches back across whitespace, inline nodes and Unicode", () => {
    const prose = cell(A);
    if (!prose) throw new Error("missing prose cell");
    prose.innerHTML = '<p>Before  \n <em>İstanbul</em>  falls <strong>apart</strong> 🕷. After.</p>';
    flashBlock(A, { quotes: ["i\u0307stanbul fall s a part 🕷"] });
    const range = registry.get(QUOTE_HIGHLIGHT)?.ranges[0];
    expect(range?.toString()).toBe("İstanbul  falls apart 🕷");
    expect(range?.startContainer).toBe(prose.querySelector("em")?.firstChild);
    expect(range?.startOffset).toBe(0);
    expect(washed(A)).toBe(false);
  });

  it("ignores a quote the block does not have, and paints the one it does", () => {
    /* What makes a quotation wrongly attached to a chip harmless: it can only
       ever paint words that really are in that chip's block. */
    flashBlock(A, { quotes: ["words the article never says", "CO2 is a gas"] });
    expect(painted()).toEqual(["CO2 is a gas"]);
    expect(washed(A)).toBe(false);
  });

  it("washes the whole cell when none of several quotes is in the block", () => {
    flashBlock(A, { quotes: ["words the article never says", "nor these other ones"] });
    expect(painted()).toBeNull();
    expect(washed(A)).toBe(true);
  });

  it("clears the first highlight when a second flash lands elsewhere", () => {
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    flashBlock(B);
    expect(painted()).toBeNull();
    expect(washed(B)).toBe(true);
  });

  it("clears a cell wash when a quote flash follows it", () => {
    flashBlock(B);
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    expect(washed(B)).toBe(false);
    expect(painted()).toEqual(["an intelligent data pattern"]);
  });

  it("restarts on a second click rather than ending on the first one's clock", () => {
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    vi.advanceTimersByTime(CITE_FLASH_MS - 100);
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    vi.advanceTimersByTime(200);
    expect(painted(), "still on the second clock").toEqual(["an intelligent data pattern"]);
    vi.advanceTimersByTime(CITE_FLASH_MS);
    expect(painted()).toBeNull();
  });

  it("still paints under reduced motion", () => {
    reduceMotion(true);
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    expect(painted()).toEqual(["an intelligent data pattern"]);
    expect(washed(A)).toBe(false);
  });

  it("holds the quote with the flash while a band covers the prose", () => {
    layOut({ covers: true });
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    expect(painted()).toBeNull();
    expect(washed(A)).toBe(false);
    document.querySelector(".reader")?.classList.add("band-away");
    flushPendingFlash();
    expect(painted()).toEqual(["an intelligent data pattern"]);
  });

  it("takes the paint off when the reading view leaves", () => {
    flashBlock(A, { quotes: ["an intelligent data pattern"] });
    resetFlash();
    expect(painted()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
