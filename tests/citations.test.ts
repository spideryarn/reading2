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

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
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
  type Draft,
  emptyDrops,
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
      { slug: "t", blocks, sourceHash: "h.h", elapsedMs: 1, inherit: null, drops, scores },
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
      { slug: "t", blocks: BLOCKS, sourceHash: "moved", elapsedMs: 1, inherit, drops, scores: noScoreDrops() },
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
    const run = await generateCitations({ article: { blocks: BLOCKS, tree: tree(), meta: null } as never, previous: null });
    expect(run.citations.version).toBe(PROMPT_VERSION);
    expect(run.citations.citations).toHaveLength(1);
    expect(run.coverage).toEqual({ notes: 1, notesReached: 1, references: 1, referencesReached: 0, works: 1 });
  });

  it("a truncated answer is a truncation failure, not a short list", async () => {
    stop = "max_tokens";
    answer = '{"works": [{"title": "Si';
    await expect(
      generateCitations({ article: { blocks: BLOCKS, tree: tree(), meta: null } as never, previous: null }),
    ).rejects.toThrow(/ran past its/);
    stop = "end_turn";
  });
});

describe("the prompt", () => {
  it("ends the `why` rule on the house phrase, and forbids addresses", () => {
    expect(systemPrompt()).toContain("plainer than the article, never further from it");
    expect(systemPrompt()).toMatch(/Never write a URL, a DOI/);
    /* The ellipsis is how five of twelve places failed on scaling-hypothesis. */
    expect(systemPrompt().replace(/\s+/g, " ")).toMatch(/never join two pieces with "\.\.\."/i);
  });
});
