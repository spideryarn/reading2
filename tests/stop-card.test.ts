// @vitest-environment jsdom
/**
 * **The stop card's gathering** — src/web/stop-card.ts: from the artefacts the
 * reading view already has, plus the stop's block and the route, to the
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
import type { Block, BlockId, Faq, Glossary, GlossaryEntry, Ideas, Timeline } from "../src/types.js";
import { cardIsEmpty, type CardSources, gatherStopCard } from "../src/web/stop-card.js";

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
  faq: { value: null, stale: false },
  timeline: { value: null, stale: false },
};

function termsIn(html: string, entries: GlossaryEntry[], stale = false): string[] {
  const card = gatherStopCard({
    blockId: B[0]!,
    blocks: [block(B[0]!, html)],
    route: [B[0]!],
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

describe("also at stop k (F20)", () => {
  const blocks = [
    block(B[0]!, "<p>Synergy is defined here.</p>"),
    block(B[1]!, "<p>Nothing relevant.</p>"),
    block(B[2]!, "<p>Synergy and redundancy together.</p>"),
    block(B[3]!, "<p>Redundancy, later.</p>"),
  ];
  const sources: CardSources = {
    ...NONE,
    glossary: { value: glossaryOf([entry("t-syn", "synergy"), entry("t-red", "redundancy")]), stale: false },
  };

  it("names the first earlier stop on this pass that also uses the term, and nothing for a later one", () => {
    /* Route order is not document order: B2 is the second stop, B0 the third. */
    const card = gatherStopCard({ blockId: B[0]!, blocks, route: [B[3]!, B[2]!, B[0]!, B[1]!], sources });
    expect(card.terms.map((t) => [t.entry.id, t.alsoAt])).toEqual([["t-syn", 2]]);

    const at2 = gatherStopCard({ blockId: B[2]!, blocks, route: [B[3]!, B[2]!, B[0]!, B[1]!], sources });
    /* Synergy is at stop 3, which is later: no marker. Redundancy is at stop 1. */
    expect(at2.terms.map((t) => [t.entry.id, t.alsoAt])).toEqual([
      ["t-syn", null],
      ["t-red", 1],
    ]);
  });

  it("skips a stop whose quote has gone", () => {
    const card = gatherStopCard({ blockId: B[2]!, blocks, route: [null, B[2]!], sources });
    expect(card.terms.map((t) => t.alsoAt)).toEqual([null, null]);
  });
});

describe("ideas, the FAQ and the timeline, by block id", () => {
  const ideas = {
    ideas: [
      {
        id: "spya-id2abc",
        name: "Synergy is not redundancy",
        occurrences: [
          { blockId: B[1]!, quote: "a", reasoning: "r" },
          { blockId: B[1]!, quote: "b", reasoning: "r" },
        ],
      },
      { id: "spya-id3def", name: "Elsewhere", occurrences: [{ blockId: B[3]!, quote: "c", reasoning: "r" }] },
    ],
  } as unknown as Ideas;
  const faq = {
    questions: [
      { id: "q1", question: "How was synergy measured?", passages: [{ blockId: B[1]!, quote: "q", start: 0 }] },
      { id: "q2", question: "Elsewhere?", passages: [{ blockId: B[2]!, quote: "q", start: 0 }] },
    ],
  } as unknown as Faq;
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
    faq: { value: faq, stale: false },
    timeline: { value: timeline, stale: false },
  };

  it("gathers each once, and only what touches this block", () => {
    const card = gatherStopCard({ blockId: B[1]!, blocks, route: [B[1]!], sources: fresh });
    expect(card.ideas).toEqual([{ id: "spya-id2abc", name: "Synergy is not redundancy" }]);
    expect(card.questions).toEqual([{ id: "q1", question: "How was synergy measured?", blockId: B[1] }]);
    expect(card.events).toEqual([{ id: "spya-ev2abc", label: "Recordings made" }]);
    expect(cardIsEmpty(card)).toBe(false);
  });

  it("leaves out every cluster whose artefact is stale (F19)", () => {
    const stale: CardSources = {
      glossary: { value: null, stale: false },
      ideas: { value: ideas, stale: true },
      faq: { value: faq, stale: true },
      timeline: { value: timeline, stale: true },
    };
    const card = gatherStopCard({ blockId: B[1]!, blocks, route: [B[1]!], sources: stale });
    expect([card.ideas, card.questions, card.events]).toEqual([[], [], []]);
    expect(cardIsEmpty(card)).toBe(true);
  });

  it("is empty when nothing exists, and for a block no artefact touches", () => {
    expect(cardIsEmpty(gatherStopCard({ blockId: B[1]!, blocks, route: [B[1]!], sources: NONE }))).toBe(true);
    expect(cardIsEmpty(gatherStopCard({ blockId: B[2]!, blocks, route: [B[2]!], sources: { ...fresh, faq: NONE.faq } }))).toBe(
      true,
    );
  });
});
