/**
 * The deterministic half of the citations stage — src/citations.ts.
 *
 * What is pinned here is everything either side of the model call, and above
 * all the one safety property: **every link a row presents as the work's own
 * address was in the article**, chosen by code, in the plan's order, with every
 * ambiguity falling through to a labelled search. The Wikipedia-shaped case —
 * an author's page linked before the paper's — is here because the first draft
 * of the plan took the first external href and would have linked the author.
 *
 * docs/plans/260911g-citations-mode.md § The one safety property.
 */
import { describe, expect, it, vi } from "vitest";

let answer = "";
let stop: "end_turn" | "max_tokens" = "end_turn";
/** What the last call sent — the reference list test reads its system blocks. */
let sent: {
  system?: { text: string }[];
  output_config?: { effort?: string; format?: unknown };
} | null = null;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_job: string, params: NonNullable<typeof sent>) => {
      sent = params;
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text: answer, citations: null }],
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

import {
  buildCitations,
  CITATIONS_OUTPUT_SCHEMA,
  type Draft,
  emptyDrops,
  ENTRY_CAP,
  markerNumbers,
  generateCitations,
  idsByKey,
  linkFor,
  MAX_CITATIONS,
  noScoreDrops,
  noteMarkers,
  PROMPT_VERSION,
  scholarUrl,
  systemPrompt,
} from "../src/citations.js";
import { plainWords } from "../src/plain-words.js";
import { type NumberedReferenceList, referenceListFrom } from "../src/citation-reference-list.js";
import type { Block, Tree } from "../src/types.js";

function block(id: string, text: string, over: Partial<Block> = {}): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
    ...over,
  };
}

/** A note block, Wikipedia-shaped: apparatus, with a noteId. */
function note(id: string, noteId: string, text: string, html: string): Block {
  return block(id, text, { tag: "li", html, noteId, role: "footnote", treatment: "supplement" });
}

function build(
  works: unknown[],
  blocks: Block[],
  extra: Record<string, unknown> = {},
  /** Expect every work to be dropped — returns the counters instead of throwing. */
  allDropped = false,
) {
  const drops = emptyDrops();
  const scores = noScoreDrops();
  const run = () =>
    buildCitations(
      { capped: false, works, ...extra },
      { power: "standard", slug: "t", blocks, sourceHash: "h.h", elapsedMs: 1, inherit: null, drops, scores },
    );
  if (allDropped) {
    expect(run).toThrow();
    return { citations: null as never, drops, scores, rows: [] };
  }
  const citations = run();
  return { citations, drops, scores, rows: citations.citations };
}

const scored = { relevance: 0.8, influence: 0.5 };

/* ------------------------------------------------------------------ links */

describe("the link comes from the article, by code", () => {
  const byId = (blocks: Block[]) => new Map(blocks.map((b) => [b.id as string, b]));
  const draft = (over: Partial<Draft>): Draft => ({
    title: "Nanofibrillar structure and molecular mobility in spider dragline silk",
    why: "x",
    mentions: [],
    ...over,
  });

  it("rule 1: one DOI in the reference, URL-encoded in the href, becomes doi.org", () => {
    const ref = block(
      "spya-ref001",
      'Sapede, D. (2005). "Nanofibrillar structure and molecular mobility in spider dragline silk". Macromolecules. doi:10.1021/ma0507995.',
      {
        html:
          '<li>Sapede, D. (2005). "Nanofibrillar structure…". <a href="https://en.wikipedia.org/wiki/Doi_(identifier)">doi</a>:' +
          '<a href="https://doi.org/10.1021%2Fma0507995">10.1021/ma0507995</a>.</li>',
      },
    );
    const link = linkFor(
      draft({ reference: { blockId: ref.id, quote: "Sapede", start: 0 } }),
      byId([ref]),
      new Map([[ref.id, 1]]),
    );
    expect(link).toEqual({ url: "https://doi.org/10.1021/ma0507995", linkFrom: "doi" });
  });

  it("rule 2: no DOI and one arXiv id — found in gwern's data-url-original — becomes arxiv.org/abs", () => {
    const ref = block("spya-ref002", "Kaplan et al 2020, Scaling Laws for Neural Language Models", {
      html:
        '<p><a href="https://gwern.net/doc/www/arxiv.org/20d1.pdf" data-url-original="https://arxiv.org/pdf/2001.08361v2.pdf#page=25">Kaplan et al 2020</a></p>',
    });
    const link = linkFor(
      draft({ title: "Scaling Laws for Neural Language Models", reference: { blockId: ref.id, quote: "Kaplan", start: 0 } }),
      byId([ref]),
      new Map([[ref.id, 1]]),
    );
    expect(link).toEqual({ url: "https://arxiv.org/abs/2001.08361", linkFrom: "arxiv" });
  });

  it("two DOIs in one entry are ambiguous, and fall through", () => {
    const ref = block("spya-ref003", "A. doi:10.1000/aaa. B. doi:10.1000/bbb.");
    const link = linkFor(
      draft({ title: "Some work", reference: { blockId: ref.id, quote: "A.", start: 0 } }),
      byId([ref]),
      new Map([[ref.id, 1]]),
    );
    expect(link.linkFrom).toBe("search");
  });

  it("a DOI in an entry another work shares is not handed to either", () => {
    const ref = block("spya-ref004", "Smith 2019 on silk; see also Jones 2020, doi:10.1000/jones.");
    const link = linkFor(
      draft({ title: "Smith on silk", authors: "Smith", reference: { blockId: ref.id, quote: "Smith 2019", start: 0 } }),
      byId([ref]),
      new Map([[ref.id, 2]]),
    );
    expect(link.linkFrom).toBe("search");
  });

  it("rule 3, the Wikipedia shape: the author's page comes first and is NOT the link — the title's anchor is", () => {
    const ref = block(
      "spya-ref005",
      "Ito, Takatoshi (1997). Economic Growth and Real Exchange Rate. NBER.",
      {
        html:
          '<li><a href="https://en.wikipedia.org/wiki/Takatoshi_Ito">Ito, Takatoshi</a> (1997). ' +
          '<a href="https://www.nber.org/papers/w5979.pdf">"Economic Growth and Real Exchange Rate"</a>. NBER.</li>',
      },
    );
    const link = linkFor(
      draft({
        title: "Economic Growth and Real Exchange Rate",
        authors: "Ito, Takatoshi",
        reference: { blockId: ref.id, quote: "Ito, Takatoshi", start: 0 },
      }),
      byId([ref]),
      new Map([[ref.id, 1]]),
    );
    expect(link).toEqual({ url: "https://www.nber.org/papers/w5979.pdf", linkFrom: "article" });
  });

  it("rule 3 uses gwern's title attribute, and the anchor's own arXiv id upgrades it", () => {
    const ref = note(
      "spya-ref006",
      "spya-note-aaaaaaaaaa",
      "Now that T5 finetuning and other work have begun",
      '<li><p>Now that <a href="https://gwern.net/doc/www/arxiv.org/f1e0.pdf" data-url-original="https://arxiv.org/abs/2003.08380" title="\'TTTTTackling WinoGrande Schemas\', Lin et al 2020">T5 finetuning</a> and <a href="https://gwern.net/doc/www/arxiv.org/d550.pdf" data-url-original="https://arxiv.org/abs/2003.00000" title="\'Another Paper\', Kocijan et al 2020">other work</a> have begun</p></li>',
    );
    const link = linkFor(
      draft({ title: "TTTTTackling WinoGrande Schemas", authors: "Lin et al", reference: { blockId: ref.id, quote: "T5 finetuning", start: 9 } }),
      byId([ref]),
      /* Two works share this note, so rules 1–2 are refused and rule 3 decides. */
      new Map([[ref.id, 2]]),
    );
    expect(link).toEqual({ url: "https://arxiv.org/abs/2003.08380", linkFrom: "arxiv" });
  });

  it("two title-matching anchors to two addresses are ambiguous, and fall through", () => {
    const ref = block("spya-ref007", "Economic Growth and Real Exchange Rate (PDF) (HTML)", {
      html:
        '<li><a href="https://a.example/x.pdf">Economic Growth and Real Exchange Rate</a> ' +
        '<a href="https://b.example/x.html">Economic Growth and Real Exchange Rate</a></li>',
    });
    const link = linkFor(
      draft({ title: "Economic Growth and Real Exchange Rate", reference: { blockId: ref.id, quote: "Economic", start: 0 } }),
      byId([ref]),
      new Map([[ref.id, 1]]),
    );
    expect(link.linkFrom).toBe("search");
  });

  it("rule 4: an anchor in the text whose words are the mention's quote", () => {
    const body = block("spya-body01", "As Hugging Face announced in their blog post, the models moved.", {
      html:
        '<p>As <a href="https://huggingface.co/blog/openai">Hugging Face announced</a> in their <a href="https://example.com/x">blog post</a>, the models moved.</p>',
    });
    const link = linkFor(
      draft({ title: "OpenAI on the Hub", mentions: [{ blockId: body.id, quote: "Hugging Face announced", start: 3 }] }),
      byId([body]),
      new Map(),
    );
    expect(link).toEqual({ url: "https://huggingface.co/blog/openai", linkFrom: "article" });
  });

  it("rule 4 refuses a generic label — 'here' is not the name of a work", () => {
    const body = block("spya-body02", "The paper is here.", {
      html: '<p>The paper is <a href="https://example.com/p">here</a>.</p>',
    });
    const link = linkFor(
      draft({ title: "A paper", mentions: [{ blockId: body.id, quote: "The paper is here", start: 0 }] }),
      byId([body]),
      new Map(),
    );
    expect(link.linkFrom).toBe("search");
  });

  it("rule 4 refuses a concept link that is only part of a long quote — spider silk's 'Toughness' page", () => {
    /* Found on the stage-1 run over spider-silk-spya-ge30uz: a work was linked
       to en.wikipedia.org/wiki/Toughness because two linked words sat inside a
       longer quoted sentence. "Whose text is the mention's quote" means the
       anchor IS most of the quote, not that it appears somewhere in it. */
    const body = block("spya-body08", "C. darwini silk has a toughness of 350 MJ/m3, measured as unit of toughness in 2010.", {
      html:
        '<p>C. darwini silk has a toughness of 350 MJ/m3, measured as <a href="https://en.wikipedia.org/wiki/Toughness#Unit_of_toughness">unit of toughness</a> in 2010.</p>',
    });
    const link = linkFor(
      draft({
        title: "C. darwini silk toughness study",
        mentions: [{ blockId: body.id, quote: "C. darwini silk has a toughness of 350 MJ/m3, measured as unit of toughness", start: 0 }],
      }),
      byId([body]),
      new Map(),
    );
    expect(link.linkFrom).toBe("search");
  });

  it("rule 4 refuses a Wikipedia concept page unless its words name the work — antikythera's 'Heron of Alexandria'", () => {
    /* Stage-1 runs linked works to Heron_of_Alexandria, Pappus_of_Alexandria
       and Atomic_force_microscopy: an encyclopedia's prose links concepts and
       people, and an exact-words match on one is still not the work. */
    const body = block("spya-body11", "Heron of Alexandria described an odometer.", {
      html: '<p><a href="https://en.wikipedia.org/wiki/Heron_of_Alexandria">Heron of Alexandria</a> described an odometer.</p>',
    });
    const link = linkFor(
      draft({ title: "Vitruvius' odometer", mentions: [{ blockId: body.id, quote: "Heron of Alexandria", start: 0 }] }),
      byId([body]),
      new Map(),
    );
    expect(link.linkFrom).toBe("search");
  });

  it("rule 5: a Scholar search for the title and the first author's surname", () => {
    expect(scholarUrl("Elements of Episodic Memory", "Tulving, E.; Other, A.")).toBe(
      `https://scholar.google.com/scholar?q=${encodeURIComponent('"Elements of Episodic Memory" Tulving')}`,
    );
  });
});

/* ----------------------------------------------------- the model's url -- */

describe("a URL the model writes is never stored", () => {
  it("is ignored, counted, and the link is derived from the article", () => {
    const body = block("spya-body03", "Tulving (1983) set out the distinction.");
    const { rows, drops } = build(
      [
        {
          title: "Elements of Episodic Memory",
          authors: "Tulving",
          year: "1983",
          why: "The distinction the piece tests.",
          ...scored,
          url: "https://doi.org/10.9999/remembered",
          mentions: [{ block: body.id, quote: "Tulving (1983)" }],
        },
      ],
      [body],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.url).not.toContain("10.9999");
    expect(rows[0]!.linkFrom).toBe("search");
    expect(drops.modelUrls).toBe(1);
  });
});

/* ------------------------------------------------------- verification -- */

describe("every place is verified against the article", () => {
  const body = block("spya-body04", "Kaplan et al (2020) found smooth power laws.");

  it("drops an unknown block id and a quote not in its block, and a work left with neither", () => {
    const { rows, drops } = build(
      [
        {
          title: "Scaling Laws",
          why: "Its power laws.",
          ...scored,
          mentions: [
            { block: "spya-nowhere", quote: "Kaplan" },
            { block: body.id, quote: "a sentence the article never wrote" },
          ],
        },
        { title: "Kept", why: "It is here.", ...scored, mentions: [{ block: body.id, quote: "Kaplan et al (2020)" }] },
      ],
      [body],
    );
    expect(drops.unknownIds).toBe(1);
    expect(drops.unquoted).toBe(1);
    expect(drops.unanchored).toBe(1);
    expect(rows.map((r) => r.title)).toEqual(["Kept"]);
  });

  it("moves a quote the model pinned to the wrong block when the words are in exactly one other", () => {
    /* scaling-hypothesis, stage 1: five of twelve failed places were verbatim
       in a neighbouring block. Relocated and counted, never guessed. */
    const a = block("spya-body12", "Anti-scaling: penny-wise, pound-foolish.");
    const b = block("spya-body13", "Of course there will be, see Hernandez & Brown 2020 on efficiency.");
    const { rows, drops } = build(
      [{ title: "Measuring efficiency", why: "x", ...scored, mentions: [{ block: a.id, quote: "see Hernandez & Brown 2020" }] }],
      [a, b],
    );
    expect(rows[0]!.mentions[0]!.blockId).toBe(b.id);
    expect(drops.relocated).toBe(1);
    expect(drops.unquoted).toBe(0);
  });

  it("does not move a quote whose words are in two other blocks", () => {
    const a = block("spya-body14", "Nothing here.");
    const b = block("spya-body15", "Smith (2019) said one thing.");
    const c = block("spya-body16", "Smith (2019) said another.");
    const { drops } = build(
      [{ title: "Smith", why: "x", ...scored, mentions: [{ block: a.id, quote: "Smith (2019)" }] }],
      [a, b, c],
      {},
      true,
    );
    expect(drops.unquoted).toBe(1);
    expect(drops.relocated).toBe(0);
  });

  it("stores the article's characters, not the model's typing", () => {
    const curly = block("spya-body05", "He called it “the bitter lesson” in 2019.");
    const { rows } = build(
      [{ title: "The Bitter Lesson", why: "Its thesis.", ...scored, mentions: [{ block: curly.id, quote: '"the bitter lesson"' }] }],
      [curly],
    );
    expect(rows[0]!.mentions[0]!.quote).toBe("“the bitter lesson”");
  });

  it("throws, with the counts, when the model named works and none survived", () => {
    expect(() =>
      build([{ title: "X", why: "Y", ...scored, mentions: [{ block: "spya-nope00", quote: "x" }] }], [body]),
    ).toThrow(/1 places naming a block id/);
  });

  it("an article that cites nothing is an empty list, and `{}` is a failure", () => {
    expect(build([], [body]).rows).toEqual([]);
    expect(() =>
      buildCitations({}, {
        power: "standard",
        slug: "t", blocks: [body], sourceHash: "h", elapsedMs: 1, inherit: null,
        drops: emptyDrops(), scores: noScoreDrops(),
      }),
    ).toThrow(/no `works` array/);
  });
});

/* ------------------------------------------------ footnotes and order -- */

const NOTE = "spya-note-0123456789";
const BLOCKS: Block[] = [
  block("spya-b00001", "Intro paragraph with no citation."),
  block("spya-b00002", "Spider silk is strong.[1] Porter (2005) modelled it.", {
    html: `<p>Spider silk is strong.<sup><a href="#spya-n00001" data-spya-note-ref="${NOTE}">[1]</a></sup> Porter (2005) modelled it.</p>`,
  }),
  block("spya-b00003", "Tulving (1983) is cited later."),
  block("spya-b00004", "And again the silk.[1]", {
    html: `<p>And again the silk.<sup><a href="#spya-n00001" data-spya-note-ref="${NOTE}">[1]</a></sup></p>`,
  }),
  note(
    "spya-n00001",
    NOTE,
    'Porter, D. (2005). "Predicting the mechanical properties of spider silk". doi:10.1140/epje/i2004-10074-4.',
    '<li>Porter, D. (2005). "Predicting the mechanical properties of spider silk". doi:<a href="https://doi.org/10.1140%2Fepje%2Fi2004-10074-4">10.1140/epje/i2004-10074-4</a>.</li>',
  ),
  block("spya-bib001", "Bibliography: Unread, A. (1999). A work the text never cites.", { role: "reference", treatment: "supplement" }),
];

describe("footnotes are expanded in code", () => {
  it("finds every body block that carries a marker for a note, in order", () => {
    expect(noteMarkers(BLOCKS).get(NOTE)).toEqual(["spya-b00002", "spya-b00004"]);
  });

  it("a work found only in the note is cited at both markers, and first at the earlier", () => {
    const { rows } = build(
      [
        {
          title: "Predicting the mechanical properties of spider silk",
          authors: "Porter, D.",
          year: "2005",
          why: "The model of silk's strength.",
          ...scored,
          reference: { block: "spya-n00001", quote: "Porter, D. (2005)" },
        },
      ],
      BLOCKS,
    );
    expect(rows[0]!.citedAt).toEqual(["spya-b00002", "spya-b00004"]);
    expect(rows[0]!.firstCited).toBe("spya-b00002");
    expect(rows[0]!.citedInBody).toBe(true);
    expect(rows[0]!.linkFrom).toBe("doi");
    expect(rows[0]!.url).toBe("https://doi.org/10.1140/epje/i2004-10074-4");
  });

  it("orders by first cited, and puts a bibliography-only work last, jumping to its entry", () => {
    const { rows } = build(
      [
        { title: "Unread", why: "Further reading.", ...scored, reference: { block: "spya-bib001", quote: "Unread, A. (1999)" } },
        { title: "Elements of Episodic Memory", why: "Later.", ...scored, mentions: [{ block: "spya-b00003", quote: "Tulving (1983)" }] },
        { title: "Silk", why: "Earlier.", ...scored, reference: { block: "spya-n00001", quote: "Porter, D. (2005)" } },
      ],
      BLOCKS,
    );
    expect(rows.map((r) => r.title)).toEqual(["Silk", "Elements of Episodic Memory", "Unread"]);
    expect(rows[2]!.citedInBody).toBe(false);
    expect(rows[2]!.firstCited).toBe("spya-bib001");
  });
});

/* ---------------------------------------------------- dedupe and ids -- */

describe("one row per work, and ids that survive a re-run", () => {
  const shorthand = {
    title: "Predicting the mechanical properties of spider silk",
    authors: "Porter",
    year: "2005",
    why: "Its model.",
    relevance: 0.4,
    mentions: [{ block: "spya-b00002", quote: "Porter (2005)" }],
  };
  const full = {
    ...shorthand,
    authors: "Porter, D.",
    relevance: 0.9,
    influence: 0.3,
    mentions: [],
    reference: { block: "spya-n00001", quote: "Porter, D. (2005)" },
  };

  it("merges the shorthand cite and its full entry into one row, keeping both places", () => {
    const { rows, drops } = build([shorthand, full], BLOCKS);
    expect(rows).toHaveLength(1);
    expect(drops.merged).toBe(1);
    expect(rows[0]!.reference?.blockId).toBe("spya-n00001");
    expect(rows[0]!.mentions.map((m) => m.blockId)).toEqual(["spya-b00002"]);
    expect(rows[0]!.relevance).toBe(0.9);
    expect(rows[0]!.key).toBe("doi:10.1140/epje/i2004-10074-4");
  });

  it("a re-run inherits the id by key, and a new work gets a new one", () => {
    const first = build([full], BLOCKS).citations;
    const inherit = idsByKey(first);
    const drops = emptyDrops();
    const second = buildCitations(
      {
        works: [
          full,
          { title: "Elements of Episodic Memory", why: "New.", ...scored, mentions: [{ block: "spya-b00003", quote: "Tulving (1983)" }] },
        ],
      },
      { power: "standard", slug: "t", blocks: BLOCKS, sourceHash: "moved", elapsedMs: 1, inherit, drops, scores: noScoreDrops() },
    );
    const byKey = new Map(second.citations.map((c) => [c.key, c.id]));
    expect(byKey.get("doi:10.1140/epje/i2004-10074-4")).toBe(first.citations[0]!.id);
    const fresh = second.citations.find((c) => c.title === "Elements of Episodic Memory")!;
    expect(fresh.id).not.toBe(first.citations[0]!.id);
  });
});

/* ------------------------------------------------------------- scores -- */

describe("scores the prompt required and did not get", () => {
  it("counts absent and rejected apart, and keeps the row", () => {
    const body = block("spya-body06", "Smith (2019) and Jones (2020) and Lee (2021).");
    const { rows, scores } = build(
      [
        { title: "Smith", why: "a", influence: 0.2, mentions: [{ block: body.id, quote: "Smith (2019)" }] },
        { title: "Jones", why: "b", relevance: 1.5, influence: "high", mentions: [{ block: body.id, quote: "Jones (2020)" }] },
        { title: "Lee", why: "c", relevance: null, influence: 0.1, mentions: [{ block: body.id, quote: "Lee (2021)" }] },
      ],
      [body],
    );
    expect(rows).toHaveLength(3);
    expect(scores).toEqual({ relevanceAbsent: 1, relevanceRejected: 2, influenceAbsent: 0, influenceRejected: 1 });
    expect(rows.find((r) => r.title === "Jones")?.relevance).toBeUndefined();
  });
});

/* ------------------------------------------------------------ the cap -- */

describe("the cap", () => {
  it("`capped` is the model's word, or evidence it returned more than the cap", () => {
    const body = block("spya-body07", "Smith (2019).");
    const one = { title: "Smith", why: "a", ...scored, mentions: [{ block: body.id, quote: "Smith (2019)" }] };
    expect(build([one], [body], { capped: true }).citations.capped).toBe(true);
    expect(build([one], [body]).citations.capped).toBe(false);
    const many = Array.from({ length: MAX_CITATIONS + 2 }, (_, i) => ({ ...one, title: `Work ${i}` }));
    const over = build(many, [body]);
    expect(over.rows).toHaveLength(MAX_CITATIONS);
    expect(over.drops.overCap).toBe(2);
    expect(over.citations.capped).toBe(true);
  });

  it("past the cap, the works the piece leans on most are kept — not the first 80 the model wrote", () => {
    /* spider-silk returned 100 rows against a stated cap of 80. The prompt's
       instruction is "keep the ones it leans on most", so the cut honours it. */
    const body = block("spya-body09", "Smith (2019).");
    const many = Array.from({ length: MAX_CITATIONS + 1 }, (_, i) => ({
      title: `Work ${i}`,
      why: "a",
      relevance: i === 0 ? 0.1 : 0.5,
      influence: 0.5,
      mentions: [{ block: body.id, quote: "Smith (2019)" }],
    }));
    const over = build(many, [body]);
    expect(over.rows).toHaveLength(MAX_CITATIONS);
    expect(over.rows.map((r) => r.title)).not.toContain("Work 0");
    expect(over.rows.map((r) => r.title)).toContain(`Work ${MAX_CITATIONS}`);
  });

  it("folds duplicates BEFORE the cut, so copies of one work cannot crowd out another", () => {
    /* GPT Sol F13, 2026-09-12: the cut ran on the model's raw rows, before
       either fold, so eighty copies of one work took the whole allowance and
       the list said "capped" over two works. */
    const body = block("spya-body3x", "Repeated (2019) and Distinct (2020).");
    const copy = {
      title: "Repeated Work",
      authors: "Smith",
      year: "2019",
      why: "a",
      relevance: 0.9,
      influence: 0.5,
      mentions: [{ block: body.id, quote: "Repeated (2019)" }],
    };
    const distinct = {
      title: "Distinct Work",
      authors: "Jones",
      year: "2020",
      why: "b",
      relevance: 0.2,
      influence: 0.5,
      mentions: [{ block: body.id, quote: "Distinct (2020)" }],
    };
    const out = build([...Array.from({ length: MAX_CITATIONS }, () => copy), distinct], [body]);
    expect(out.rows.map((r) => r.title).sort()).toEqual(["Distinct Work", "Repeated Work"]);
    expect(out.drops.overCap).toBe(0);
    expect(out.citations.capped).toBe(false);
  });
});

describe("placeholders the model writes instead of leaving a field out", () => {
  it("drops 'unknown' as an author", () => {
    const body = block("spya-body10", "Smith (2019).");
    const { rows } = build(
      [{ title: "Smith", authors: "unknown", why: "a", ...scored, mentions: [{ block: body.id, quote: "Smith (2019)" }] }],
      [body],
    );
    expect(rows[0]!.authors).toBeUndefined();
  });
});

/* ------------------------------------------------------------ the call -- */

function tree(): Tree {
  return {
    version: "toc/1",
    generator: "test",
    slug: "t",
    rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-b00001", "spya-bib001"], title: "All" },
    },
  } as unknown as Tree;
}

describe("generateCitations", () => {
  it("writes the artefact, stamped, from a stubbed answer", async () => {
    stop = "end_turn";
    answer = JSON.stringify({
      capped: false,
      works: [{ title: "Silk", why: "Its model.", ...scored, reference: { block: "spya-n00001", quote: "Porter, D. (2005)" } }],
    });
    const run = await generateCitations({ power: "standard", article: { blocks: BLOCKS, tree: tree(), meta: null } as never, previous: null, referenceList: null });
    expect(run.citations.version).toBe(PROMPT_VERSION);
    expect(run.citations.citations).toHaveLength(1);
    expect(run.coverage).toEqual({ notes: 1, notesReached: 1, references: 1, referencesReached: 0, works: 1 });
    expect(sent?.output_config?.effort).toBe("medium");
    expect(sent?.output_config?.format).toEqual({ type: "json_schema", schema: CITATIONS_OUTPUT_SCHEMA });
  });

  it("a truncated answer is a truncation failure, not a short list", async () => {
    stop = "max_tokens";
    answer = '{"works": [{"title": "Si';
    await expect(
      generateCitations({ power: "standard", article: { blocks: BLOCKS, tree: tree(), meta: null } as never, previous: null, referenceList: null }),
    ).rejects.toThrow(/ran past its/);
    stop = "end_turn";
  });
});

describe("the prompt", () => {
  it("carries the shared plain-words rule, and forbids addresses", () => {
    expect(systemPrompt()).toContain(plainWords("explain"));
    expect(systemPrompt()).toMatch(/Never write a URL, a DOI/);
    /* The ellipsis is how five of twelve places failed on scaling-hypothesis. */
    expect(systemPrompt().replace(/\s+/g, " ")).toMatch(/never join two pieces with "\.\.\."/i);
  });
});

/* ----------------------------------------------- a PDF's reference list --
   Plan 260930i (SPIDERYARN-READING2-6K), as GPT Sol's plan review reshaped it.
   A PDF article's bibliography is not a block, so code splits the list read
   from the PDF's text layer at its own numbers, the model names an entry by
   number, and code keeps it only if the work's verified mentions cite that
   number; then title, authors and year are located in the entry. */
describe("an entry in a PDF's reference list", () => {
  const ENTRY_7 = "7. Lee, H. et al. (2020) What can narratives tell us about the neural bases of human memory? Curr. Opin. Behav. Sci. 32, 111–119";
  const ENTRY_8 =
    "8. Chen, J. et al. (2017) Shared memories reveal shared structure in neural activity across individuals. Nat. Neurosci. 20, 115–125";
  const ENTRY_9 =
    "9. Baldassano, C. and Chen, J. (2017a) Discovering event structure in continuous narrative perception and memory. Neuron 95, 709–721";
  const LIST: NumberedReferenceList = { entries: new Map([[7, ENTRY_7], [8, ENTRY_8], [9, ENTRY_9]]) };
  const BODY = [block("spya-b00001", "People recall TV episodes [8] and narratives [7,9] in detail.")];

  function withList(works: unknown[]) {
    const drops = emptyDrops();
    const citations = buildCitations(
      { capped: false, works },
      {
        power: "standard",
        slug: "t",
        blocks: BODY,
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit: null,
        drops,
        scores: noScoreDrops(),
        referenceList: LIST,
      },
    );
    return { rows: citations.citations, drops };
  }
  const chen = (over: Record<string, unknown> = {}) => ({
    title: "Shared memories reveal shared structure in neural activity across individuals",
    authors: "Chen et al.",
    year: "2017",
    why: "Evidence that recall of a TV episode is shared across people.",
    ...scored,
    mentions: [{ block: "spya-b00001", quote: "TV episodes [8]" }],
    entry: 8,
    ...over,
  });

  it("attaches the list's entry when its number is the one the text cites", () => {
    const { rows, drops } = withList([chen()]);
    expect(rows[0]?.entry).toBe(ENTRY_8);
    expect(rows[0]?.authors).toBe("Chen et al.");
    expect(rows[0]?.year).toBe("2017");
    expect(drops.entryUnfound + drops.entryMismatch + drops.entryDisagrees).toBe(0);
  });

  it("refuses an entry number the text does not cite — the neighbour's line", () => {
    const { rows, drops } = withList([chen({ entry: 9 })]);
    expect(rows[0]?.entry).toBeUndefined();
    expect(drops.entryMismatch).toBe(1);
  });

  it("refuses a number the list does not have, and keeps the row", () => {
    const { rows, drops } = withList([chen({ entry: 88 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry).toBeUndefined();
    expect(drops.entryUnfound).toBe(1);
  });

  it("accepts a number inside a cited list, and keeps the entry's own year token", () => {
    const { rows } = withList([
      {
        title: "Discovering event structure in continuous narrative perception and memory",
        authors: "Baldassano, Chen",
        year: "2017",
        why: "Event structure in narrative memory.",
        ...scored,
        mentions: [{ block: "spya-b00001", quote: "narratives [7,9]" }],
        entry: "9",
      },
    ]);
    expect(rows[0]?.entry).toBe(ENTRY_9);
    expect(rows[0]?.year).toBe("2017a");
    expect(rows[0]?.authors).toBe("Baldassano, Chen");
  });

  it("drops the entry when the title is not in it, and authors or a year it does not carry", () => {
    const wrongTitle = withList([chen({ title: "Study on recall of TV episodes" })]);
    expect(wrongTitle.rows[0]?.entry).toBeUndefined();
    expect(wrongTitle.rows[0]?.title).toBe("Study on recall of TV episodes");
    expect(wrongTitle.drops.entryDisagrees).toBe(1);

    const invented = withList([chen({ authors: "Chen, Smith", year: "2019" })]);
    expect(invented.rows[0]?.entry).toBe(ENTRY_8);
    expect(invented.rows[0]?.authors).toBeUndefined();
    expect(invented.rows[0]?.year).toBeUndefined();
    expect(invented.drops.authorsUnfound).toBe(1);
    expect(invented.drops.yearUnfound).toBe(1);
  });

  it("does not validate an invented author from words that occur only in the title", () => {
    const { rows, drops } = withList([chen({ authors: "Neural Activity" })]);
    expect(rows[0]?.entry).toBe(ENTRY_8);
    expect(rows[0]?.authors).toBeUndefined();
    expect(drops.authorsUnfound).toBe(1);
  });

  it("does not merge two different numbered entries just because their work fields key alike", () => {
    const sameFields = {
      title: "Memory",
      authors: "Lee",
      year: "2020",
      why: "Two separately numbered works happen to share short metadata.",
      ...scored,
    };
    const list: NumberedReferenceList = {
      entries: new Map([
        [1, "1. Lee, H. (2020) Memory. Journal A 1, 1–2"],
        [2, "2. Lee, H. (2020) Memory. Journal B 2, 3–4"],
      ]),
    };
    const body = block("spya-b00002", "The two editions differ [1,2].");
    const drops = emptyDrops();
    const out = buildCitations(
      {
        works: [
          { ...sameFields, mentions: [{ block: body.id, quote: "differ [1,2]" }], entry: 1 },
          { ...sameFields, mentions: [{ block: body.id, quote: "differ [1,2]" }], entry: 2 },
        ],
      },
      {
        power: "standard",
        slug: "t",
        blocks: [body],
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit: null,
        drops,
        scores: noScoreDrops(),
        referenceList: list,
      },
    );
    expect(out.citations).toHaveLength(2);
    expect(out.citations.map((row) => row.entry)).toEqual([...list.entries.values()]);
  });

  it("folds two model rows that claim the same numbered entry into one work", () => {
    const first = chen();
    const second = chen({
      title: "Shared structure in neural activity",
      why: "The same numbered work returned a second time.",
    });
    const { rows, drops } = withList([first, second]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry).toBe(ENTRY_8);
    expect(drops.merged).toBe(1);
  });

  it("still folds an unnumbered shorthand row into its one compatible numbered entry", () => {
    const shorthand = chen({ entry: undefined });
    const full = chen({ mentions: [{ block: "spya-b00001", quote: "TV episodes [8]" }] });
    const { rows, drops } = withList([shorthand, full]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry).toBe(ENTRY_8);
    expect(drops.merged).toBe(1);
  });

  it("locates punctuation, a colon subtitle, diacritics and a surname particle", () => {
    const list: NumberedReferenceList = {
      entries: new Map([
        [
          1,
          "1. van der Meer, García (2018) Memory: a view from within. Journal of Examples 4, 1–9",
        ],
      ]),
    };
    const body = block("spya-b00003", "This follows the earlier account [1].");
    const drops = emptyDrops();
    const out = buildCitations(
      {
        works: [
          {
            title: "Memory: a view from within.",
            authors: "van der Meer, García",
            year: "2018",
            why: "The account followed here.",
            ...scored,
            mentions: [{ block: body.id, quote: "account [1]" }],
            entry: 1,
          },
        ],
      },
      {
        power: "standard",
        slug: "t",
        blocks: [body],
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit: null,
        drops,
        scores: noScoreDrops(),
        referenceList: list,
      },
    );
    expect(out.citations[0]?.title).toBe("Memory: a view from within");
    expect(out.citations[0]?.authors).toBe("van der Meer, García");
  });

  it("ignores an entry when there is no list", () => {
    const { rows } = build([chen()], BODY);
    expect(rows[0]?.entry).toBeUndefined();
  });

  it("uses a bibliography block's text as the entry only when one work claims it", () => {
    const ref = block("spya-r00001", "Tulving, E. (1983) Elements of Episodic Memory. Oxford University Press.", {
      role: "reference",
    });
    const tulving = {
      title: "Elements of Episodic Memory",
      authors: "Tulving",
      year: "1983",
      why: "The distinction it builds on.",
      ...scored,
      reference: { block: "spya-r00001", quote: "Tulving, E. (1983)" },
    };
    const one = build([tulving], [...BODY, ref]);
    expect(one.rows[0]?.entry).toBe("Tulving, E. (1983) Elements of Episodic Memory. Oxford University Press.");
    const shared = build(
      [tulving, { ...tulving, title: "Oxford University Press", authors: "Oxford", reference: { block: "spya-r00001", quote: "Oxford University Press" } }],
      [...BODY, ref],
    );
    expect(shared.rows.every((r) => r.entry === undefined)).toBe(true);
  });
});

/* ------------------------------------ a PDF entry's DOI or arXiv id --
   Plan 261001a stage 4: the entry code split from the PDF's text layer is the
   article's own text, so a unique DOI or arXiv id in it is the row's link, by
   the same rule as a bibliography block's. */
describe("a DOI or arXiv id in a PDF's reference-list entry", () => {
  const CHEN =
    "8. Chen, J. et al. (2017) Shared memories reveal shared structure in neural activity across individuals. Nat. Neurosci. 20, 115–125";
  const BODY = [block("spya-b00001", "People recall TV episodes [8] and narratives [7,9] in detail.")];
  const chen = {
    title: "Shared memories reveal shared structure in neural activity across individuals",
    authors: "Chen et al.",
    year: "2017",
    why: "Evidence that recall of a TV episode is shared across people.",
    ...scored,
    mentions: [{ block: "spya-b00001", quote: "TV episodes [8]" }],
    entry: 8,
  };
  function run(
    entry8: string,
    inherit: Map<string, string> | null = null,
    referenceList: NumberedReferenceList = { entries: new Map([[8, entry8]]) },
  ) {
    return buildCitations(
      { capped: false, works: [chen] },
      {
        power: "standard",
        slug: "t",
        blocks: BODY,
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit,
        drops: emptyDrops(),
        scores: noScoreDrops(),
        referenceList,
      },
    );
  }
  const linkOf = (entry8: string) => {
    const row = run(entry8).citations[0]!;
    return { url: row.url, linkFrom: row.linkFrom };
  };
  /* Through the real splitter, so the line join and the dehyphenation are its own. */
  const listFromLines = (...tail: string[]) =>
    referenceListFrom([
      "References",
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `${n}. Filler, A. (2000) Filler work number ${n}. J. Filler 1, 1–2`),
      "8. Chen, J. et al. (2017) Shared memories reveal shared structure in neural activity across individuals.",
      ...tail,
    ])!;
  const entryFromLines = (...tail: string[]) => listFromLines(...tail).entries.get(8)!;

  it("one DOI in the entry becomes doi.org, its trailing period left off", () => {
    expect(linkOf(`${CHEN}. doi:10.1038/nn.4450.`)).toEqual({
      url: "https://doi.org/10.1038/nn.4450",
      linkFrom: "doi",
    });
    expect(linkOf(`${CHEN}. https://doi.org/10.1038/nn.4450`).url).toBe("https://doi.org/10.1038/nn.4450");
  });

  it("one arXiv id, either shape, becomes arxiv.org/abs", () => {
    expect(linkOf(`${CHEN}. arXiv:1706.03762v5.`)).toEqual({
      url: "https://arxiv.org/abs/1706.03762",
      linkFrom: "arxiv",
    });
    expect(linkOf(`${CHEN}. arXiv:hep-th/9711200`).url).toBe("https://arxiv.org/abs/hep-th/9711200");
  });

  it("an entry with no identifier keeps its Scholar search", () => {
    expect(linkOf(CHEN)).toEqual({ url: expect.stringContaining("scholar.google.com"), linkFrom: "search" });
  });

  it("two different DOIs in one entry are ambiguous, and keep the search", () => {
    expect(linkOf(`${CHEN}. doi:10.1038/nn.4450; erratum doi:10.1038/nn.9999.`).linkFrom).toBe("search");
  });

  it("keeps search when a DOI's own hyphen may have fallen at a dehyphenated line end", () => {
    /* A digit after the hyphen: `dehyphenate` leaves the ambiguous space, so
       this layer cannot know whether the hyphen ended the DOI. */
    const digit = entryFromLines("Psychol. Sci. 18, 1–9. doi:10.1111/j.1467-", "9280.2007.01934.x.");
    expect(digit).toContain("j.1467- 9280");
    expect(linkOf(digit).linkFrom).toBe("search");
    const indentedList = listFromLines(
      "Psychol. Sci. 18, 1–9. doi:10.1111/j.1467-",
      "   9280.2007.01934.x.",
    );
    expect(run(indentedList.entries.get(8)!, null, indentedList).citations[0]!.linkFrom).toBe(
      "search",
    );
    /* A lowercase letter after it: the reader's entry is still dehyphenated,
       but identifier parsing must see the original line end and decline it. */
    const letterList = listFromLines("Neuron 95, 1–9. doi:10.1016/j.neu-", "ron.2017.06.041.");
    const letter = letterList.entries.get(8)!;
    expect(letter).toContain("doi:10.1016/j.neuron.2017.06.041");
    expect(run(letter, null, letterList).citations[0]!.linkFrom).toBe("search");
    const arxivList = listFromLines(
      "Preprint arXiv:hep-",
      "th/9711200; alternate doi:10.1038/nn.4450.",
    );
    expect(run(arxivList.entries.get(8)!, null, arxivList).citations[0]!.linkFrom).toBe("search");
    expect(linkOf(`${CHEN}. doi:10.1038/ s41586-020-2649-2.`).linkFrom).toBe("search");
    expect(linkOf(`${CHEN}. doi:10.1234/article- PMID`).linkFrom).toBe("search");
    expect(linkOf(`${CHEN}. doi:10.1234/article_ SUPPLEMENT`).linkFrom).toBe("search");
  });

  it("a DOI or arXiv id whose end the line break hides keeps the search, rather than a cut-short link", () => {
    expect(linkOf(`${CHEN}. doi:10.1016/j.cell. 2020.01.001`).linkFrom).toBe("search");
    expect(linkOf(`${CHEN}. doi:10.1234/ABC DEF`).linkFrom).toBe("search");
    expect(linkOf(`${CHEN}. arXiv:2001.0836 1`).linkFrom).toBe("search");
    /* …but a full stop followed by a capital is treated as the next sentence. */
    expect(linkOf(`${CHEN}. doi:10.1038/nn.4450. Accessed 2020`).linkFrom).toBe("doi");
  });

  it("reads a DOI past the stored entry's cap, and still stores the entry capped", () => {
    const long = `${CHEN}. ${"Extra matter. ".repeat(30)}doi:10.1038/nn.4450`;
    expect(long.length).toBeGreaterThan(ENTRY_CAP);
    const row = run(long).citations[0]!;
    expect(row.url).toBe("https://doi.org/10.1038/nn.4450");
    expect(row.entry).toHaveLength(ENTRY_CAP);
  });

  it("a row whose search becomes a DOI on a re-run keeps its id", () => {
    const before = run(CHEN);
    expect(before.citations[0]!.linkFrom).toBe("search");
    const after = run(`${CHEN}. doi:10.1038/nn.4450`, idsByKey(before)).citations[0]!;
    expect(after.key).toBe("doi:10.1038/nn.4450");
    expect(after.id).toBe(before.citations[0]!.id);
  });

  it("…but not when two rows this run share that work's title, author and year", () => {
    const before = run(CHEN);
    const inherit = idsByKey(before);
    const out = buildCitations(
      {
        capped: false,
        works: [
          chen,
          { ...chen, entry: 9, mentions: [{ block: "spya-b00001", quote: "narratives [7,9]" }] },
        ],
      },
      {
        power: "standard",
        slug: "t",
        blocks: BODY,
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit,
        drops: emptyDrops(),
        scores: noScoreDrops(),
        referenceList: {
          entries: new Map([
            [8, `${CHEN}. doi:10.1038/nn.4450`],
            [9, `${CHEN.replace("8.", "9.")}. doi:10.1038/nn.9999`],
          ]),
        },
      },
    );
    /* Two DOI rows, one old search id: neither can say it is the one. */
    expect(out.citations.map((c) => c.linkFrom)).toEqual(["doi", "doi"]);
    const ids = out.citations.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(before.citations[0]!.id);
  });

  it("…and neither a search nor DOI row inherits when both share the old work key", () => {
    const before = run(CHEN);
    const out = buildCitations(
      {
        capped: false,
        works: [
          chen,
          { ...chen, entry: 9, mentions: [{ block: "spya-b00001", quote: "narratives [7,9]" }] },
        ],
      },
      {
        power: "standard",
        slug: "t",
        blocks: BODY,
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit: idsByKey(before),
        drops: emptyDrops(),
        scores: noScoreDrops(),
        referenceList: {
          entries: new Map([
            [8, `${CHEN}. doi:10.1038/nn.4450`],
            [9, CHEN.replace("8.", "9.")],
          ]),
        },
      },
    );
    expect(out.citations.map((c) => c.linkFrom)).toEqual(["doi", "search"]);
    expect(out.citations.map((c) => c.id)).not.toContain(before.citations[0]!.id);
  });

  it("…and not when an identifier-keyed old row made the old work key ambiguous", () => {
    const oldSearch = run(CHEN);
    const oldDoi = run(`${CHEN}. doi:10.1038/nn.9999`);
    const previous = {
      ...oldSearch,
      citations: [...oldSearch.citations, ...oldDoi.citations],
    };
    const after = run(`${CHEN}. doi:10.1038/nn.4450`, idsByKey(previous)).citations[0]!;
    expect(after.id).not.toBe(oldSearch.citations[0]!.id);
    expect(after.id).not.toBe(oldDoi.citations[0]!.id);
  });

  it("…and two works whose DOI keys swap do not swap their stored ids", () => {
    const doiA = "10.1038/nn.4450";
    const doiB = "10.1038/nn.9999";
    const oldA = run(`${CHEN}. doi:${doiA}`);
    const oldBSource = run(`${CHEN}. doi:${doiB}`);
    const oldB = {
      ...oldBSource.citations[0]!,
      title: "Another work",
      authors: "Jones",
      year: "2020",
    };
    const previous = {
      ...oldA,
      citations: [...oldA.citations, oldB],
    };
    const out = buildCitations(
      {
        capped: false,
        works: [
          chen,
          {
            title: "Another work",
            authors: "Jones",
            year: "2020",
            why: "A second, distinct work.",
            ...scored,
            mentions: [{ block: "spya-b00001", quote: "narratives [7,9]" }],
            entry: 9,
          },
        ],
      },
      {
        power: "standard",
        slug: "t",
        blocks: BODY,
        sourceHash: "h.h",
        elapsedMs: 1,
        inherit: idsByKey(previous),
        drops: emptyDrops(),
        scores: noScoreDrops(),
        referenceList: {
          entries: new Map([
            [8, `${CHEN}. doi:${doiB}`],
            [9, `9. Jones (2020) Another work. doi:${doiA}`],
          ]),
        },
      },
    );
    expect(new Set(out.citations.map((c) => c.id)).size).toBe(2);
    expect(out.citations.map((c) => c.id)).not.toContain(oldA.citations[0]!.id);
    expect(out.citations.map((c) => c.id)).not.toContain(oldB.id);
  });
});

describe("numbered cites", () => {
  it("reads the numbers a bracketed cite names", () => {
    expect([...markerNumbers(["TV episodes [8]"])]).toEqual([8]);
    expect([...markerNumbers(["(e.g., [16,17])", "[3–5]", "[20-21]"])].sort((a, b) => a - b)).toEqual([
      3, 4, 5, 16, 17, 20, 21,
    ]);
    expect([...markerNumbers(["Tulving (1983)"])]).toEqual([]);
  });

  it("keeps a citation before a page locator and ignores years and figure labels", () => {
    expect([...markerNumbers(["the result [8, p. 12]"])]).toEqual([8]);
    expect([...markerNumbers(["the 2019 sample [2019]", "the apparatus [Fig. 3]"])]).toEqual([]);
  });
});

describe("generateCitations with a reference list", () => {
  it("sends the list after the article, and not when there is none", async () => {
    answer = JSON.stringify({ capped: false, works: [] });
    const blocks = [block("spya-b00001", "Nothing cited here at all.")];
    const article = { blocks, tree: tree(), meta: null } as never;
    const list: NumberedReferenceList = {
      entries: new Map([[1, "1. Chen, J. et al. (2017) Shared memories."]]),
    };
    await generateCitations({ power: "standard", article, previous: null, referenceList: list });
    const texts = (sent?.system ?? []).map((b) => b.text);
    expect(texts).toHaveLength(3);
    expect(texts[1]).toContain("<reference-list>\n[1] Chen, J. et al. (2017) Shared memories.\n</reference-list>");
    await generateCitations({ power: "standard", article, previous: null, referenceList: null });
    expect((sent?.system ?? []).map((b) => b.text).some((t) => t.includes("<reference-list>"))).toBe(false);
  });
});
