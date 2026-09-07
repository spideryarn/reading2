/**
 * **How sure are we that this page is about *this* piece?** — the evidence
 * group one keeps per row, and the copy it refuses.
 *
 * Until 2026-09-06 the only proof a direct row carried was `namesArticle`: the
 * page contains the article's title, or links it. On a 2023 article with a
 * same-named 2026 successor that put **six pages about the wrong document** on
 * screen as reception, each with a real quotation from a real page. So every
 * direct row now carries the *names of the evidence found* —
 * `IdentificationSignal[]` — and the level is the strongest of them, a lookup
 * over a fixed order and never a weighted score.
 *
 * The other half is the refusal: a page that is a **copy** of the article is not
 * a response to it, however completely it identifies the piece, and it is
 * dropped as `sourceIsCopy` rather than filtered away in silence.
 *
 * The matcher itself is tests/shingles.test.ts. This file is the wiring: which
 * signals a row earns, which branch of `namesArticle` fired, and what an
 * artefact written before the field reads as.
 *
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md § "2 — a
 * level that *is* one of the facts, not a score over them"
 */
import { describe, expect, it } from "vitest";

import {
  blockTextById,
  emptyLosses,
  namesArticle,
  namesArticleBy,
  readDirectGroup,
} from "../src/debate.js";
import { anyLost, identificationLevel, identifiesOf, isDebateDocument } from "../src/types.js";
import type { Block, DirectDebateRow, SearchEvidence } from "../src/types.js";

/* ------------------------------------------------------------- the fixture -- */

const ARTICLE_URL = "https://example.org/what-the-tide-clock-cannot-tell-you";

const ARTICLE = {
  url: ARTICLE_URL,
  title: "What the tide clock cannot tell you",
  byline: "Greg Detre",
};

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  level: 0,
  text,
  words: text.split(" ").length,
  html: `<p id="${id}">${text}</p>`,
  gistable: true,
});

const BLOCKS: Block[] = [
  block(
    "spya-tide01",
    "The water in an estuary is shaped by the land it has to squeeze past, by the shelving of " +
      "the bed, and by the wind that has been blowing across the bay for the last three days.",
  ),
  block(
    "spya-tide02",
    "So the card under the clock is doing something the clock cannot do. It names the residual, " +
      "the part of the answer the instrument was never built to hold.",
  ),
];

const blockText = blockTextById(BLOCKS);

/** A reply: mostly its own words, with one sentence of the article quoted in it. */
const REPLY: SearchEvidence = {
  url: "https://harbourlog.example/against-the-card",
  title: "Against the card",
  excerpt:
    "Greg Detre's What the tide clock cannot tell you has been going round the harbour all week " +
    "and I want to say where I think it is wrong. Its central image is the handwritten card " +
    "taped under the tide clock in every harbour office, and the claim is that the card does " +
    "work the dial cannot. “The water in an estuary is shaped by the land it has to squeeze " +
    "past, by the shelving of the bed, and by the wind that has been blowing across the bay.” " +
    "All true, and none of it read by anybody. I have watched skippers come and go for eleven " +
    "seasons and in that time I have seen exactly two people stop at the counter to read the " +
    "card, both of them on their first day out. The dial is what people look at because the " +
    "dial is what answers the question they came in with, and a caveat nobody reads is not an " +
    "honest instrument, it is an alibi. Correct the clock, publish the correction, and let the " +
    "card say who did the correcting.",
};

/** The same reply, naming the article by its address instead of its title. */
const LINKING: SearchEvidence = {
  ...REPLY,
  url: "https://harbourlog.example/against-the-card-linked",
  excerpt: REPLY.excerpt!.replace(
    "Greg Detre's What the tide clock cannot tell you",
    `A piece at ${ARTICLE_URL}`,
  ),
};

/** An archive of the article, plus enough chrome to look like a page. */
const MIRROR: SearchEvidence = {
  url: "https://archive.example/o/tide-clock",
  title: "What the tide clock cannot tell you",
  excerpt:
    "archived 12 Oct 2024 · original · webpage capture\n\n" +
    "What the tide clock cannot tell you\n\n" +
    BLOCKS.map((b) => b.text).join("\n\n") +
    `\n\nSaved from ${ARTICLE_URL} on 12 October 2024.`,
};

const evidenceMap = (rows: SearchEvidence[]) => new Map(rows.map((r) => [r.url, r]));

const admissible = evidenceMap([REPLY, LINKING, MIRROR]);

const groupInput = { admissible, article: ARTICLE, blockText };

/** A well-formed reported row against one of the pages above. */
const reported = (evidence: SearchEvidence, over: Record<string, unknown> = {}) => ({
  url: evidence.url,
  sourceQuote: "a caveat nobody reads is not an honest instrument",
  articleReferenceQuote: "What the tide clock cannot tell you",
  relation: "disputes",
  valence: "negative",
  applies: "It says the caveat is not read, which is the essay's whole mechanism.",
  ...over,
});

/* --------------------------------------------------------------- the level -- */

describe("the level is the name of the strongest evidence", () => {
  const row = (identifies: DirectDebateRow["identifies"]): DirectDebateRow => ({
    id: "r1",
    url: REPLY.url,
    sourceQuote: "a caveat nobody reads is not an honest instrument",
    relation: "disputes",
    valence: "negative",
    applies: "…",
    articleReferenceQuote: "What the tide clock cannot tell you",
    identifies,
  });

  it("prefers a link to a quotation, and a quotation to a name", () => {
    /* Deliberately in the weakest-first order, because the answer must come from
       the fixed strength order and not from where the reader happened to push a
       signal. */
    expect(
      identificationLevel(
        row([
          { kind: "named", by: "title", witness: "What the tide clock cannot tell you" },
          { kind: "quoted", quote: "…", blockId: "spya-tide01", coverage: 0.04, density: 0.13 },
          { kind: "linked", url: ARTICLE_URL },
        ]),
      ),
    ).toBe("linked");
    expect(
      identificationLevel(
        row([
          { kind: "named", by: "title", witness: "What the tide clock cannot tell you" },
          { kind: "quoted", quote: "…", blockId: "spya-tide01", coverage: 0.04, density: 0.13 },
        ]),
      ),
    ).toBe("quoted");
    expect(
      identificationLevel(
        row([{ kind: "named", by: "title-and-byline", witness: "On rye, by Marta Ek" }]),
      ),
    ).toBe("named");
  });

  /**
   * **The back-compatibility rule, and there is no migration.** Every debate
   * artefact written before 2026-09-06 has rows with no `identifies` at all, and
   * they were all kept by the title-or-link rule — so they read as `named` on
   * the witness they already carry, which is exactly what the field would have
   * said.
   */
  it("reads a row written before the field as named, on the witness it has", () => {
    const old = { ...row([]) } as DirectDebateRow;
    /* An artefact that never had the key, rather than one with an empty list —
       the two are different facts and both have to read as `named`. */
    delete (old as { identifies?: unknown }).identifies;
    expect(identifiesOf(old)).toEqual([
      { kind: "named", by: "title", witness: "What the tide clock cannot tell you" },
    ]);
    expect(identificationLevel(old)).toBe("named");
  });

  it("reads an empty list the same way, rather than having no level at all", () => {
    expect(identificationLevel(row([]))).toBe("named");
  });

  it("does not make the field a condition of reading the artefact", () => {
    /* `isDebateDocument` is what stands between the panel and a half-written
       document. If it started asking for `identifies`, every stored debate would
       become a 404 and the reader would be told nobody had asked the web. */
    expect(isDebateDocument({ direct: { rows: [row([])] }, claims: { rows: [] } })).toBe(true);
  });
});

/* ------------------------------------------------------ which branch fired -- */

describe("what named the article", () => {
  it("reports the address when the page links it, and stays true for the boolean", () => {
    const witness = `A piece at ${ARTICLE_URL} argues the opposite.`;
    expect(namesArticleBy(witness, ARTICLE)?.url).toBe(ARTICLE_URL);
    expect(namesArticle(witness, ARTICLE)).toBe(true);
  });

  it("reports the title when the title is long enough on its own", () => {
    const witness = "What the tide clock cannot tell you is the piece I mean.";
    expect(namesArticleBy(witness, ARTICLE)).toEqual({ url: null, by: "title" });
  });

  it("reports title-and-byline when the title is short", () => {
    const short = { url: null, title: "On rye", byline: "Marta Ek" };
    expect(namesArticleBy("Marta Ek's On rye makes the same case", short)).toEqual({
      url: null,
      by: "title-and-byline",
    });
    expect(namesArticleBy("On rye makes the same case", short)).toBeNull();
    expect(namesArticle("On rye makes the same case", short)).toBe(false);
  });
});

/* ------------------------------------------------------------ the wiring -- */

describe("what a kept direct row carries", () => {
  it("earns a quotation signal with the block it came from and both ratios", () => {
    const group = readDirectGroup([reported(REPLY)], groupInput, 2);
    expect(group.counts.keptRows).toBe(1);
    const signals = identifiesOf(group.rows[0]!);
    const quoted = signals.find((s) => s.kind === "quoted");
    expect(quoted).toBeDefined();
    if (quoted?.kind !== "quoted") throw new Error("unreachable");
    expect(quoted.blockId).toBe("spya-tide01");
    /* The page's own characters, as `locate` stores everything else. */
    expect(REPLY.excerpt).toContain(quoted.quote);
    expect(quoted.coverage).toBeGreaterThan(0);
    expect(quoted.density).toBeGreaterThan(0);
    expect(quoted.density).toBeLessThan(0.5);
    expect(identificationLevel(group.rows[0]!)).toBe("quoted");
  });

  it("earns a link signal when the page names the article by its address", () => {
    const group = readDirectGroup(
      [reported(LINKING, { articleReferenceQuote: `A piece at ${ARTICLE_URL}` })],
      groupInput,
      2,
    );
    expect(group.counts.keptRows).toBe(1);
    expect(identifiesOf(group.rows[0]!)).toContainEqual({ kind: "linked", url: ARTICLE_URL });
    expect(identificationLevel(group.rows[0]!)).toBe("linked");
  });

  it("earns a name signal saying which branch proved it", () => {
    const group = readDirectGroup([reported(REPLY)], groupInput, 2);
    expect(identifiesOf(group.rows[0]!)).toContainEqual({
      kind: "named",
      by: "title",
      witness: "What the tide clock cannot tell you",
    });
  });

  it("never keeps a row with nothing in the list", () => {
    const group = readDirectGroup([reported(REPLY)], groupInput, 2);
    for (const row of group.rows) expect(row.identifies.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- the ceiling -- */

describe("a copy of the article is not a response to it", () => {
  it("drops an archive of the piece, and says why", () => {
    const group = readDirectGroup(
      [reported(MIRROR, { sourceQuote: "the part of the answer the instrument was never built" })],
      groupInput,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.sourceIsCopy).toBe(1);
    /* Not filed under any other reason: the row passed every one of them, which
       is what makes a mirror so convincing on screen. */
    expect(group.counts.lost.directnessUnverified).toBe(0);
    expect(group.counts.lost.unverifiedSource).toBe(0);
    expect(anyLost(group.counts.lost)).toBe(true);
  });

  it("drops it even when it links the article too", () => {
    /* Maximal identification, minimal reason to show it. The ceiling is asked
       before the row is kept, not as a tie-break afterwards. */
    const group = readDirectGroup(
      [
        reported(MIRROR, {
          sourceQuote: "the part of the answer the instrument was never built",
          articleReferenceQuote: `Saved from ${ARTICLE_URL} on 12 October 2024.`,
        }),
      ],
      groupInput,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.sourceIsCopy).toBe(1);
  });

  /**
   * **A mirror's own words are still the article's when they cross a paragraph
   * break** — Sol's P0 on the first draft of this fix, 2026-09-06.
   *
   * The extract of a copy is the article's blocks with the breaks between them,
   * and the spaced matcher reads straight across one. Asking `isArticleText` per
   * block — the discipline density follows, and for density it is right — let a
   * model that chose a `sourceQuote` spanning two paragraphs take a mirror past
   * the refusal. The copy question is *whose words are these*, and across a
   * break they are still the article's.
   */
  it("drops the mirror when its quotation spans two of the article's blocks", () => {
    const group = readDirectGroup(
      [
        reported(MIRROR, {
          sourceQuote: "for the last three days. So the card under the clock",
        }),
      ],
      groupInput,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.sourceIsCopy).toBe(1);
  });

  it("keeps the reply that quotes the same article", () => {
    const group = readDirectGroup([reported(REPLY)], groupInput, 2);
    expect(group.counts.keptRows).toBe(1);
    expect(group.counts.lost.sourceIsCopy).toBe(0);
  });

  it("starts the counter at zero like every other reason", () => {
    expect(emptyLosses().sourceIsCopy).toBe(0);
    expect(anyLost({ ...emptyLosses(), sourceIsCopy: 1 })).toBe(true);
  });
});

/* --------------------------------------- the three defects GPT Sol reproduced -- */

/**
 * **The article's own title is not a quotation of the article.**
 *
 * `articleShingles` shingles the blocks it is handed, and the blocks a direct
 * pass is judged against include the **headings** — so an article whose title
 * reaches eight words and forty characters produces windows that *are the
 * title*, and a page that merely repeats the title earns `quoted`. That clears
 * the default bar, which is precisely the false positive this whole stage was
 * built to stop: a 2026 successor at a different address sharing a 2023
 * article's title.
 *
 * The fixture below is Sol's own reproduction input. The seven-word title in the
 * rest of this file is exactly why the defect was invisible.
 *
 * docs/plans/260906b-stage-p-code-review-sol.md § F1
 */
describe("a long title is not a quotation of itself", () => {
  const LONG_TITLE = "A careful guide to building reliable artificial intelligence systems at scale";

  const heading = (id: string, text: string): Block => ({
    ...block(id, text),
    tag: "h1",
    kind: "heading",
    level: 1,
  });

  const TITLED_BLOCKS: Block[] = [
    heading("spya-guide1", LONG_TITLE),
    block(
      "spya-guide2",
      "An evaluation suite that nobody looks at after the first week is a cost with no reader, " +
        "and the second week is when the interesting regressions arrive.",
    ),
  ];

  const TITLED = {
    url: "https://example.org/careful-guide",
    title: LONG_TITLE,
    byline: "Greg Detre",
  };

  /** A page about the *2026 successor*, which shares the title and nothing else. */
  const SUCCESSOR: SearchEvidence = {
    url: "https://elsewhere.example/2026-edition",
    title: LONG_TITLE,
    excerpt:
      `${LONG_TITLE} — the new 2026 edition overturns the earlier advice on evaluation and ` +
      "deployment, and replaces the checklist at the back of it entirely.",
  };

  const input = {
    admissible: evidenceMap([SUCCESSOR]),
    article: TITLED,
    blockText: blockTextById(TITLED_BLOCKS),
  };

  it("gives a page that only repeats the title no quotation signal", () => {
    const group = readDirectGroup(
      [
        reported(SUCCESSOR, {
          sourceQuote: "the new 2026 edition overturns the earlier advice",
          articleReferenceQuote: LONG_TITLE,
        }),
      ],
      input,
      2,
    );
    expect(group.counts.keptRows).toBe(1);
    const signals = identifiesOf(group.rows[0]!);
    expect(signals.find((s) => s.kind === "quoted")).toBeUndefined();
    /* Repeating a heading is evidence of *naming*, which `named` already covers. */
    expect(identificationLevel(group.rows[0]!)).toBe("named");
  });

  /**
   * **And it is not a copy of the article either** — Sol's P1 on the first draft
   * of this fix, 2026-09-06.
   *
   * The first draft kept headings on the *density* side, so a title long enough
   * to carry five windows made an extract that is only the title read as 100%
   * article words: the row was dropped as `sourceIsCopy` and the reader told the
   * page *"turned out to be a copy of this article"* — a second false sentence
   * about the same page the quotation rule had just been taught to let through.
   * One rule now, both sides: a heading is naming evidence and nothing else.
   */
  it("does not call a page that only repeats the title a copy of the article", () => {
    const LONGER = "A careful guide to building reliable artificial intelligence systems safely at planetary scale today";
    const blocks: Block[] = [heading("spya-guide3", LONGER), TITLED_BLOCKS[1]!];
    const page: SearchEvidence = {
      url: "https://elsewhere.example/title-only",
      title: LONGER,
      excerpt: LONGER,
    };
    const group = readDirectGroup(
      [reported(page, { sourceQuote: LONGER, articleReferenceQuote: LONGER })],
      {
        admissible: evidenceMap([page]),
        article: { ...TITLED, title: LONGER },
        blockText: blockTextById(blocks),
      },
      2,
    );
    expect(group.counts.lost.sourceIsCopy).toBe(0);
    expect(group.counts.keptRows).toBe(1);
    expect(identificationLevel(group.rows[0]!)).toBe("named");
  });
});

/**
 * **A fisking is not a mirror**, and the panel must not tell the reader it was.
 *
 * `isCopy` judges the *search extract*, not the page: an engine can hand back a
 * long blockquote and one short rebuttal, which is what a fisking looks like.
 * Sol built exactly that — 22 extract windows at 50% density — and the row was
 * dropped with the reader told the page *"turned out to be a copy of this
 * article rather than a reply to it"*, which is false.
 *
 * The second signal is the row's own verified `sourceQuote`: a mirror has no
 * words of its own, so the words it engages with must be the article's.
 *
 * docs/plans/260906b-stage-p-code-review-sol.md § F2
 */
describe("the copy refusal wants row-level evidence too", () => {
  const FISK_URL = "https://example.com/article";
  const QUOTED_LINE =
    "Every harbour office keeps a tide clock where handwritten warnings gather beneath storms " +
    "and changing skies each winter.";

  const FISKED_BLOCKS: Block[] = [
    block("spya-fisk01", QUOTED_LINE),
    block(
      "spya-fisk02",
      "The card under the clock names the residual, the part of the answer the instrument was " +
        "never built to hold, and it does it where somebody about to take a boat out will read it.",
    ),
  ];

  const FISKED = {
    url: FISK_URL,
    title: "What the tide clock cannot tell you",
    byline: "Greg Detre",
  };

  /** Sol's extract, exactly: a link, a long blockquote, and one line of rebuttal. */
  const FISKING: SearchEvidence = {
    url: "https://harbourlog.example/fisking",
    title: "Line by line",
    excerpt:
      `Read the original article at ${FISK_URL}.\n` +
      `${QUOTED_LINE}\n` +
      "That conclusion is completely unsupported.",
  };

  const input = {
    admissible: evidenceMap([FISKING]),
    article: FISKED,
    blockText: blockTextById(FISKED_BLOCKS),
  };

  const row = reported(FISKING, {
    sourceQuote: "That conclusion is completely unsupported.",
    articleReferenceQuote: `Read the original article at ${FISK_URL}.`,
  });

  it("keeps a reply whose own words are its own, however much the engine sent", () => {
    const group = readDirectGroup([row], input, 2);
    expect(group.counts.lost.sourceIsCopy).toBe(0);
    expect(group.counts.keptRows).toBe(1);
  });

  it("still refuses the mirror, whose engaged words are the article's", () => {
    /* The same page with an article sentence as the row's own quotation: now
       both signals point the same way, which is what a copy looks like. */
    const group = readDirectGroup(
      [{ ...row, sourceQuote: "handwritten warnings gather beneath storms and changing skies" }],
      input,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.sourceIsCopy).toBe(1);
  });
});

/**
 * **The evidence list records what is there, not what the model chose to show
 * us.**
 *
 * `namesArticleBy` is handed the witness alone, while quotation matching gets
 * the whole extract — and the model is asked for *one* valid witness, not every
 * witness. So a page whose extract plainly carries the article's address, but
 * whose chosen witness is the title, is recorded as `named` only and the default
 * bar hides a genuine linked response.
 *
 * The directness check stays on the witness — that rule is load-bearing, and it
 * was the fix for this file's worst bug — but the `linked` signal comes from the
 * extract.
 *
 * docs/plans/260906b-stage-p-code-review-sol.md § F3
 */
describe("a link in the extract is a link, whichever witness the model picked", () => {
  const LINKED_ELSEWHERE: SearchEvidence = {
    url: "https://harbourlog.example/elsewhere",
    title: "The caveat nobody reads",
    excerpt:
      `Read the original at ${ARTICLE_URL}.\n` +
      "What the tide clock cannot tell you is wrong because the caveat nobody reads cannot " +
      "make an instrument honest.",
  };

  const input = { admissible: evidenceMap([LINKED_ELSEWHERE]), article: ARTICLE, blockText };

  const row = reported(LINKED_ELSEWHERE, {
    sourceQuote: "the caveat nobody reads cannot make an instrument honest",
    articleReferenceQuote: "What the tide clock cannot tell you",
  });

  it("records the link the extract contains", () => {
    const group = readDirectGroup([row], input, 2);
    expect(group.counts.keptRows).toBe(1);
    expect(identifiesOf(group.rows[0]!)).toContainEqual({ kind: "linked", url: ARTICLE_URL });
    expect(identificationLevel(group.rows[0]!)).toBe("linked");
  });

  /**
   * **A witness link that does not survive being read in context is not a
   * link** — Sol's P0 on the first draft of this fix, 2026-09-06.
   *
   * The witness is an arbitrary slice the model chose, so an address that *ends*
   * the slice parses as this article there and as a longer, different address in
   * the whole extract: `…-2026` is exactly that shape, and it is the successor
   * false positive this stage exists to contain. The first draft kept the
   * witness's reading as a fallback, so the row was shown at `linked` with a
   * tooltip claiming a link the page does not have.
   */
  it("refuses a witness whose address is only a prefix of the one in the extract", () => {
    const successor: SearchEvidence = {
      url: "https://harbourlog.example/successor",
      title: "The 2026 edition",
      excerpt:
        `A piece at ${ARTICLE_URL}-2026 says the opposite, and the caveat nobody reads cannot ` +
        "make an instrument honest.",
    };
    const group = readDirectGroup(
      [
        reported(successor, {
          sourceQuote: "the caveat nobody reads cannot make an instrument honest",
          articleReferenceQuote: `A piece at ${ARTICLE_URL}`,
        }),
      ],
      { admissible: evidenceMap([successor]), article: ARTICLE, blockText },
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.directnessUnverified).toBe(1);
  });

  /**
   * **The tooltip promises every signal found, so `named` is read off the
   * extract too** — Sol's P2 on the first draft.
   *
   * `named` is the weakest arm, so this can never move a level or what the bar
   * shows; it is the difference between a tooltip that lists what is there and
   * one that lists what the model happened to hand us.
   */
  it("records the title the extract contains, even when the witness is the link", () => {
    const both: SearchEvidence = {
      url: "https://harbourlog.example/both",
      title: "Both signals",
      excerpt:
        "What the tide clock cannot tell you.\n" +
        `Read the original at ${ARTICLE_URL}.\n` +
        "This conclusion is completely unsupported.",
    };
    const group = readDirectGroup(
      [
        reported(both, {
          sourceQuote: "This conclusion is completely unsupported.",
          articleReferenceQuote: `Read the original at ${ARTICLE_URL}.`,
        }),
      ],
      { admissible: evidenceMap([both]), article: ARTICLE, blockText },
      2,
    );
    expect(group.counts.keptRows).toBe(1);
    const kinds = identifiesOf(group.rows[0]!).map((s) => s.kind);
    expect(kinds).toContain("linked");
    expect(kinds).toContain("named");
    /* The level is still the strongest signal, which the weakest cannot move. */
    expect(identificationLevel(group.rows[0]!)).toBe("linked");
  });

  it("still refuses a page whose witness names nothing, extract link or not", () => {
    /* The witness rule is unchanged: the *evidence list* is what widened. */
    const group = readDirectGroup(
      [
        {
          ...row,
          articleReferenceQuote: "the caveat nobody reads cannot make an instrument honest",
        },
      ],
      input,
      2,
    );
    expect(group.rows).toEqual([]);
    expect(group.counts.lost.directnessUnverified).toBe(1);
  });
});
