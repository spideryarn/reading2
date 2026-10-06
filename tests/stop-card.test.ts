// @vitest-environment jsdom
/**
 * **The stop card's gathering** — src/web/stop-card.ts: from the artefacts the
 * reading view already has, plus the stop's block, to the
 * clusters drawn under the current row.
 *
 * jsdom because the terms are found in `renderedText(block.html)`, the
 * browser's own text for the prose (Sol F23), and a node-side tokenizer would
 * test the wrong thing — annotate.test.ts says the same.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § Stage 3 in detail, and its revision after Sol's review (F19, F20, F23).
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId, Glossary, GlossaryEntry, Ideas, Timeline } from "../src/types.js";
import { cardIsEmpty, type CardSources, gatherStopCard, modeForCardTarget } from "../src/web/stop-card.js";

/* Real-shaped ids: the alphabet has no `1`, `i`, `l` or `o`. */
const B = ["spya-sc2abc", "spya-sc3def", "spya-sc4ghj", "spya-sc5kmn"] as BlockId[];

/**
 * `text` is deliberately **not** the rendered text: the card must scan the
 * prose the reader sees, so a test that passed on `block.text` would be
 * testing the wrong string.
 */
const block = (id: BlockId, html: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text: "(not what the reader sees)",
  words: 10,
  html,
  gistable: true,
});

const entry = (id: string, name: string, aliases: string[] = [], extra: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  id,
  name,
  kind: "concept",
  aliases,
  /* Empty on purpose: the card scans every entry, never the stored block
     list, which the spike showed misses word forms (F23). */
  blocks: [],
  ...extra,
});

const glossaryOf = (entries: GlossaryEntry[]): Glossary =>
  ({ version: "g", generator: "g", slug: "s", sourceHash: "h", entries }) as unknown as Glossary;

const NONE: CardSources = {
  glossary: { value: null, stale: false },
  ideas: { value: null, stale: false },
  timeline: { value: null, stale: false },
};

function termsIn(html: string, entries: GlossaryEntry[], stale = false): string[] {
  const card = gatherStopCard({
    blockId: B[0]!,
    blocks: [block(B[0]!, html)],
    sources: { ...NONE, glossary: { value: glossaryOf(entries), stale } },
  });
  return card.terms.map((t) => t.entry.id);
}

describe("terms: the direct scan over every entry, in the rendered prose", () => {
  it("finds an inflected form (a third-person -s on a verb term)", () => {
    expect(termsIn("<p>The model predicts the spike.</p>", [entry("t-pred", "predict")])).toEqual(["t-pred"]);
  });

  it("finds a term by its alias", () => {
    expect(
      termsIn("<p>We ran PID on every triad.</p>", [entry("t-pid", "partial information decomposition", ["PID"])]),
    ).toEqual(["t-pid"]);
  });

  it("leaves out a term the owner hid (plan 261002c § 2)", () => {
    expect(
      termsIn("<p>The win-shift task in the radial arm maze.</p>", [
        entry("t-win", "win-shift task"),
        entry("t-maze", "radial arm maze", [], { hidden: true }),
      ]),
    ).toEqual(["t-win"]);
  });

  it("finds a plural", () => {
    expect(termsIn("<p>Two attention heads agree.</p>", [entry("t-head", "attention head")])).toEqual(["t-head"]);
  });

  it("finds a possessive, curly or straight", () => {
    expect(termsIn("<p>Shannon’s measure, and Shannon's bound.</p>", [entry("t-sh", "Shannon")])).toEqual(["t-sh"]);
  });

  it("respects a Unicode word boundary: no match inside naïve, a match on Gödel's", () => {
    expect(termsIn("<p>A naïve reader.</p>", [entry("t-ve", "ve")])).toEqual([]);
    expect(termsIn("<p>After Gödel's theorem.</p>", [entry("t-g", "Gödel")])).toEqual(["t-g"]);
  });

  it("scans the rendered prose, across inline markup", () => {
    expect(
      termsIn("<p>The <em>transfer</em> entropy from sources.</p>", [entry("t-te", "transfer entropy")]),
    ).toEqual(["t-te"]);
  });

  it("orders terms by where they first appear in the passage", () => {
    expect(
      termsIn("<p>Synergy rises with transfer entropy, and synergy again.</p>", [
        entry("t-te", "transfer entropy"),
        entry("t-syn", "synergy"),
        entry("t-absent", "rich club"),
      ]),
    ).toEqual(["t-syn", "t-te"]);
  });

  it("shows nothing from a stale glossary (F19)", () => {
    expect(termsIn("<p>Synergy.</p>", [entry("t-syn", "synergy")], true)).toEqual([]);
  });
});

describe("a term says nothing about other stops (261006e)", () => {
  it("carries the entry and no stop number, and needs no route to be gathered", () => {
    const blocks = [block(B[0]!, "<p>Synergy is defined here.</p>"), block(B[2]!, "<p>Synergy again.</p>")];
    const syn = entry("t-syn", "synergy");
    const sources: CardSources = { ...NONE, glossary: { value: glossaryOf([syn]), stale: false } };
    /* The earlier-stop marker went on 2026-10-06 (Greg, spya-se0e4v). */
    expect(gatherStopCard({ blockId: B[2]!, blocks, sources }).terms).toEqual([{ entry: syn }]);
  });
});

describe("ideas and the timeline, by block id", () => {
  const ideas = {
    ideas: [
      {
        id: "spya-id2abc",
        name: "Synergy is not redundancy",
        statement: "The pair carries information neither does alone.",
        occurrences: [
          { blockId: B[1]!, quote: "a", reasoning: "r" },
          { blockId: B[1]!, quote: "b", reasoning: "r" },
        ],
      },
      { id: "spya-id3def", name: "Elsewhere", occurrences: [{ blockId: B[3]!, quote: "c", reasoning: "r" }] },
    ],
  } as unknown as Ideas;
  const timeline = {
    events: [
      { id: "spya-ev2abc", label: "Recordings made", occurrences: [{ blockId: B[1]!, quote: "e", start: 0 }] },
      { id: "spya-ev3def", label: "Not here", occurrences: [{ blockId: B[0]!, quote: "e", start: 0 }] },
    ],
  } as unknown as Timeline;
  const blocks = B.map((id) => block(id, "<p>Plain words.</p>"));
  const fresh: CardSources = {
    glossary: { value: null, stale: false },
    ideas: { value: ideas, stale: false },
    timeline: { value: timeline, stale: false },
  };

  it("gathers each once, and only what touches this block", () => {
    const card = gatherStopCard({ blockId: B[1]!, blocks, sources: fresh });
    expect(card.ideas.map(({ id, name }) => ({ id, name }))).toEqual([{ id: "spya-id2abc", name: "Synergy is not redundancy" }]);
    expect(card.ideas[0]!.statement).toBe("The pair carries information neither does alone.");
    expect(card.events).toEqual([{ id: "spya-ev2abc", label: "Recordings made" }]);
    expect(cardIsEmpty(card)).toBe(false);
  });

  it("leaves out every cluster whose artefact is stale (F19)", () => {
    const stale: CardSources = {
      glossary: { value: null, stale: false },
      ideas: { value: ideas, stale: true },
      timeline: { value: timeline, stale: true },
    };
    const card = gatherStopCard({ blockId: B[1]!, blocks, sources: stale });
    expect([card.ideas, card.events]).toEqual([[], []]);
    expect(cardIsEmpty(card)).toBe(true);
  });

  it("is empty when nothing exists, and for a block no artefact touches", () => {
    expect(cardIsEmpty(gatherStopCard({ blockId: B[1]!, blocks, sources: NONE }))).toBe(true);
    expect(cardIsEmpty(gatherStopCard({ blockId: B[2]!, blocks, sources: fresh }))).toBe(true);
  });
});

describe("where a card link goes (Sol, plan 260929f F8)", () => {
  it("sends each kind to its own mode", () => {
    expect(modeForCardTarget({ kind: "term", id: "t" })).toBe("glossary");
    expect(modeForCardTarget({ kind: "idea", id: "i" })).toBe("ideas");
    expect(modeForCardTarget({ kind: "event", id: "e" })).toBe("timeline");
  });
});
