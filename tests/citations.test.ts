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
  keysOf,
  linkFor,
  locateInArticle,
  MAX_CITATIONS,
  noScoreDrops,
  noteMarkers,
  PROMPT_VERSION,
  scholarUrl,
  systemPrompt,
  toDrafts,
  verifyEntry,
} from "../src/citations.js";
import { plainWords } from "../src/plain-words.js";
import { validateAnthropicJsonSchema, validateOpenAiJsonSchema } from "../src/messages-structured-output.js";
import { type NumberedReferenceList, referenceListFrom } from "../src/citation-reference-list.js";
import type { Block, Tree } from "../src/types.js";
import { REF_ATTR } from "../src/notes.js";
import { replayGuard } from "../evals/citations-say-less.js";

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

/* ------------------------------------ authors and a year, from the article --
   Greg, spya-zmdb7y (plan 261003j): a row says nothing about a work beyond
   what the article gives. The prompt asks for authors and year "as the article
   gives them"; one stored row in 194 carried an author from the model's memory
   (*The Bitter Lesson · Sutton*, in an essay that never names Sutton). */

describe("an author or year the article never gives is dropped", () => {
  const body = block("spya-b00001", "The bitter lesson is the harder and bigger, the better, as Müller's (1963) book said.");
  const lesson = { title: "The Bitter Lesson", why: "x", ...scored, mentions: [{ block: body.id, quote: "The bitter lesson" }] };

  it("drops an author who is nowhere in the article, and counts it", () => {
    const { rows, drops } = build([{ ...lesson, authors: "Sutton" }], [body]);
    expect(rows[0]?.title).toBe("The Bitter Lesson");
    expect(rows[0]?.authors).toBeUndefined();
    expect(drops.authorsUnfound).toBe(1);
  });

  it("drops a year that is nowhere in the article, and counts it", () => {
    const { rows, drops } = build([{ ...lesson, year: "2019" }], [body]);
    expect(rows[0]?.year).toBeUndefined();
    expect(drops.yearUnfound).toBe(1);
  });

  it("keeps an author and year the article gives, through a possessive, an accent and 'et al.'", () => {
    const { rows, drops } = build([{ ...lesson, authors: "Müller et al.", year: "1963" }], [body]);
    expect(rows[0]?.authors).toBe("Müller et al.");
    expect(rows[0]?.year).toBe("1963");
    expect(drops.authorsUnfound).toBe(0);
    expect(drops.yearUnfound).toBe(0);
  });

  it("keeps a year the article glues to other characters", () => {
    const glued = block("spya-b00002", "Anscombe 196363ya, An Introduction to the bitter lesson.");
    const { rows } = build(
      [{ ...lesson, mentions: [{ block: glued.id, quote: "Anscombe 1963" }], authors: "Anscombe", year: "1963" }],
      [glued],
    );
    expect(rows[0]?.year).toBe("1963");
    expect(rows[0]?.authors).toBe("Anscombe");
  });

  it.each([
    ["Porter, D.", "Porter, D. (2017)"],
    ["van der Meer, García", "van der Meer and García (2017)"],
    ["Smith & Jones", "Smith and Jones (2017)"],
    ["Chen et al.", "Chen (2017)"],
    ["Vahdat & Kautz", "Vahdat and Kautz (2017)"],
    ["O'Brien", "O’Brien’s work (2017)"],
    ["Jean-Paul", "Jean-Paul’s work (2017)"],
    ["王小明", "王小明 (2017)"],
  ])("keeps the supported by-line %s", (authors, source) => {
    const byId = new Map([[body.id, block(body.id, source)]]);
    expect(locateInArticle({ title: "Work", authors }, byId, null, emptyDrops()).authors).toBe(authors);
  });

  it.each([
    ["2017b", "Chen (2017a)"],
    ["c. 300 BC", "Chen dates it to 300 AD; BC is discussed elsewhere."],
    ["in press", "In this work Chen studies a printing press."],
  ])("drops the unsupported year %s even if its pieces occur elsewhere", (year, source) => {
    const byId = new Map([[body.id, block(body.id, source)]]);
    const drops = emptyDrops();
    expect(locateInArticle({ title: "Work", year }, byId, null, drops).year).toBeUndefined();
    expect(drops.yearUnfound).toBe(1);
  });

  it.each(["2017a", "n.d.", "in press", "c. 300 BC"])("keeps the supported date %s", (year) => {
    const byId = new Map([[body.id, block(body.id, `Chen (${year})`)]]);
    expect(locateInArticle({ title: "Work", year }, byId, null, emptyDrops()).year).toBe(year);
  });

  it("reads each supplied reference list even with the same block map", () => {
    const byId = new Map([[body.id, body]]);
    const fields = { title: "Work", authors: "Sutton", year: "2019" };
    expect(locateInArticle(fields, byId, null, emptyDrops()).authors).toBeUndefined();
    const list = { entries: new Map([[1, "1. Sutton (2019). Work."]]) };
    expect(locateInArticle(fields, byId, list, emptyDrops())).toEqual(fields);
    expect(locateInArticle(fields, byId, null, emptyDrops()).authors).toBeUndefined();
  });

  it("the eval replays the guard even on a stored HTML entry", () => {
    const ref = block("spya-bib001", "The Bitter Lesson.", { role: "reference" });
    const { rows } = build([{ ...lesson, reference: { block: ref.id, quote: ref.text } }], [body, ref]);
    const stored = { ...rows[0]!, authors: "Sutton", year: "2019" };
    expect(stored.entry).toBe(ref.text);
    const replay = replayGuard([stored], [body, ref], null);
    expect(replay.drops.authorsUnfound).toBe(1);
    expect(replay.drops.yearUnfound).toBe(1);
  });

  it("the eval includes the PDF list for a work without a verified entry", () => {
    const { rows } = build([lesson], [body]);
    const stored = { ...rows[0]!, authors: "Sutton", year: "2019" };
    const list = { entries: new Map([[1, "1. Sutton (2019). The Bitter Lesson."]]) };
    const replay = replayGuard([stored], [body], list);
    expect(replay.drops.authorsUnfound).toBe(0);
    expect(replay.drops.yearUnfound).toBe(0);
    expect(replay.kept[0]?.authors).toBe("Sutton");
  });
});

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

  it("rule 1: the doi.org link names the DOI the reference printed, whatever characters it holds (qi-thwhkxxh)", () => {
    /* A backslash in the DOI: pasted in unencoded, a browser reads it as a slash. */
    const ref = block("spya-ref001", 'Sapede, D. (2005). "Nanofibrillar structure". doi:10.1021/ma\\0507995.', {
      html:
        '<li>Sapede, D. (2005). "Nanofibrillar structure". doi:' +
        '<a href="https://doi.org/10.1021%2Fma%5C0507995">10.1021/ma\\0507995</a>.</li>',
    });
    const link = linkFor(
      draft({ reference: { blockId: ref.id, quote: "Sapede", start: 0 } }),
      byId([ref]),
      new Map([[ref.id, 1]]),
    );
    expect(link).toEqual({ url: "https://doi.org/10.1021/ma%5C0507995", linkFrom: "doi" });
    expect(new URL(link.url).pathname).toBe("/10.1021/ma%5C0507995");
  });

  it("does not manufacture a different DOI from malformed Unicode in a reference", () => {
    for (const doi of ["10.1234/a\uD800b", "10.1234/a\uDC00b"]) {
      const ref = block("spya-ref001", `Sapede (2005). Nanofibrillar structure. doi:${doi}`);
      const link = linkFor(
        draft({ reference: { blockId: ref.id, quote: "Sapede", start: 0 } }),
        byId([ref]),
        new Map([[ref.id, 1]]),
      );
      expect(link.linkFrom).toBe("search");
    }
  });

  it("a work's key is its DOI, not the DOI's encoded spelling in the link (qi-thwhkxxh)", () => {
    const key = (url: string) => keysOf({ title: "T", authors: "A", year: "2005", url, linkFrom: "doi" }).idKey;
    expect(key("https://doi.org/10.1234/a%252Fb")).toBe("doi:10.1234/a%2fb");
    expect(key("https://doi.org/10.1234/a%5Cb")).toBe("doi:10.1234/a\\b");
    /* A row stored before DOIs were encoded keeps its key, so a re-run inherits its id. */
    expect(key("https://doi.org/10.1023/A:1010933404324")).toBe("doi:10.1023/a:1010933404324");
  });

  it("a work linked to a page about an arXiv paper has the arXiv work's key (plan 261005m)", () => {
    const key = (url: string, linkFrom: "arxiv" | "article" | "search" | "doi") =>
      keysOf({ title: "T", authors: "A", year: "2020", url, linkFrom }).idKey;
    const arxiv = key("https://arxiv.org/abs/2001.08361", "arxiv");
    expect(arxiv).toBe("arxiv:2001.08361");
    for (const url of [
      "https://huggingface.co/papers/2001.08361",
      "https://huggingface.co/papers/2001.08361v2",
      "https://alphaxiv.org/abs/2001.08361",
      "https://www.alphaxiv.org/overview/2001.08361",
    ]) {
      expect(key(url, "article"), url).toBe(arxiv);
    }
    /* Old-style, and upper case: the registry's lower-cased work id. */
    expect(key("https://arxiv.org/abs/math.gt/0309136", "arxiv")).toBe("arxiv:math.gt/0309136");
    expect(key("https://huggingface.co/papers/math.GT/0309136", "article")).toBe("arxiv:math.gt/0309136");
    /* What does not change: any other article-given address, a Scholar search, and a DOI link. */
    expect(key("https://huggingface.co/blog/openai", "article")).toBe("url:huggingface.co/blog/openai");
    expect(key("https://huggingface.co/papers/2001.08361", "search")).toBeNull();
    expect(key("https://doi.org/10.48550/arXiv.2001.08361", "doi")).toBe("doi:10.48550/arxiv.2001.08361");
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
  it("does not merge two distinct works merely because unsupported by-lines were dropped", () => {
    const body = block("spya-b00001", "Two works called Shared title are cited here.");
    const raw = { title: "Shared title", why: "x", ...scored, mentions: [{ block: body.id, quote: "Shared title" }] };
    const { rows } = build([{ ...raw, authors: "Sutton" }, { ...raw, authors: "Jones" }], [body]);
    expect(rows).toHaveLength(2);
    expect(rows.map((w) => w.authors)).toEqual([undefined, undefined]);
    expect(new Set(rows.map((w) => w.id)).size).toBe(2);
  });

  it("still folds a shorthand into its entry when only the latter loses an unsupported co-author", () => {
    const body = block("spya-b00001", "Chen (2017) used Shared title.");
    const ref = block("spya-bib001", "Chen (2017). Shared title.", { role: "reference" });
    const raw = { title: "Shared title", year: "2017", why: "x", ...scored };
    const { rows } = build([
      { ...raw, authors: "Chen", mentions: [{ block: body.id, quote: "Chen (2017)" }] },
      { ...raw, authors: "Chen, Smith", reference: { block: ref.id, quote: ref.text } },
    ], [body, ref]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entry).toBe(ref.text);
    expect(rows[0]?.authors).toBe("Chen");
    expect(rows[0]).not.toHaveProperty("foldKey");
  });

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

  it("a mirror citation stored under its old URL key keeps its id when its metadata changes", () => {
    const body = block("spya-b00006", "The revised name is the work used here.", {
      html: '<p><a href="https://huggingface.co/papers/1706.03762">The revised name</a> is the work used here.</p>',
    });
    const raw = {
      title: "The revised name",
      why: "The work used here.",
      ...scored,
      mentions: [{ block: body.id, quote: "The revised name" }],
    };
    const first = build([raw], [body]).citations;
    const row = first.citations[0]!;
    expect(row.key).toBe("arxiv:1706.03762");

    /* This is the artefact the build before plan 261005m wrote: the mirror was
       an ordinary article URL. The model changing the title on the same re-run
       must not orphan Find/Investigate rows attached to this id. */
    const previous = {
      ...first,
      citations: [
        {
          ...row,
          title: "The earlier name",
          key: "url:huggingface.co/papers/1706.03762",
        },
      ],
    };
    const inherit = idsByKey(previous, { blocks: [body], referenceList: null });
    const second = buildCitations(
      { works: [raw] },
      {
        power: "standard",
        slug: "t",
        blocks: [body],
        sourceHash: "moved",
        elapsedMs: 1,
        inherit,
        drops: emptyDrops(),
        scores: noScoreDrops(),
      },
    );
    expect(second.citations[0]?.id).toBe(row.id);
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
    expect(scores).toEqual({
      relevanceAbsent: 1,
      relevanceRejected: 2,
      influenceAbsent: 0,
      influenceRejected: 1,
      influenceUnknown: 0,
    });
    expect(rows.find((r) => r.title === "Jones")?.relevance).toBeUndefined();
  });
});

/* Plan 261003m stage 1. Greg, 2026-10-03: "Maybe if the model is confident
   (e.g. because it's well-known), but if in doubt default to Unknown." */
describe("influence: a number when the model is confident, null when it is not", () => {
  const body = block("spya-body07", "Smith (2019) and Jones (2020) and Lee (2021) and Park (2022).");
  const at = (quote: string) => ({ mentions: [{ block: body.id, quote }] });

  it("null is unknown: absent on the row, and counted apart from left-out and out-of-range", () => {
    const { rows, scores } = build(
      [
        { title: "Smith", why: "a", relevance: 0.6, influence: null, ...at("Smith (2019)") },
        { title: "Jones", why: "b", relevance: 0.6, influence: 0.9, ...at("Jones (2020)") },
        { title: "Lee", why: "c", relevance: 0.6, influence: 1.5, ...at("Lee (2021)") },
        { title: "Park", why: "d", relevance: 0.6, ...at("Park (2022)") },
      ],
      [body],
    );
    expect(rows).toHaveLength(4);
    const smith = rows.find((r) => r.title === "Smith")!;
    expect("influence" in smith, "unknown is an absent field, not a stored null or zero").toBe(false);
    expect(smith.relevance).toBe(0.6);
    expect(rows.find((r) => r.title === "Jones")?.influence).toBe(0.9);
    expect("influence" in rows.find((r) => r.title === "Lee")!).toBe(false);
    expect(scores).toEqual({
      relevanceAbsent: 0,
      relevanceRejected: 0,
      influenceAbsent: 1,
      influenceRejected: 1,
      influenceUnknown: 1,
    });
  });

  it("a null relevance is still a rejected score: only influence may be unknown", () => {
    const { scores } = build(
      [{ title: "Smith", why: "a", relevance: null, influence: null, ...at("Smith (2019)") }],
      [body],
    );
    expect(scores.relevanceRejected).toBe(1);
    expect(scores.influenceUnknown).toBe(1);
    expect(scores.influenceRejected).toBe(0);
  });

  it("zero is a number the model gave, not unknown", () => {
    const { rows, scores } = build(
      [{ title: "Smith", why: "a", relevance: 0.6, influence: 0, ...at("Smith (2019)") }],
      [body],
    );
    expect(rows[0]?.influence).toBe(0);
    expect(scores.influenceUnknown).toBe(0);
  });

  it("two drafts of one work fold to the known influence, whichever comes first", () => {
    for (const order of [
      [null, 0.7],
      [0.7, null],
    ] as const) {
      const { rows, scores } = build(
        order.map((influence, i) => ({
          title: "Smith on memory",
          authors: "Smith",
          year: "2019",
          why: "a",
          relevance: 0.6,
          influence,
          ...at(i === 0 ? "Smith (2019)" : "Smith"),
        })),
        [body],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.influence).toBe(0.7);
      expect(scores.influenceUnknown).toBe(1);
    }
  });
});

describe("the list's answer schema", () => {
  const work = CITATIONS_OUTPUT_SCHEMA.properties.works.items;

  it("requires influence on every row, as a number or null", () => {
    expect(work.required).toContain("influence");
    expect(work.required).toContain("relevance");
    expect(work.properties.influence).toEqual({ type: ["number", "null"] });
    expect(work.properties.relevance, "relevance is never unknown").toEqual({ type: "number" });
  });

  it("passes Anthropic's validator whole, and the required-nullable field passes OpenAI's stricter one", () => {
    expect(() => validateAnthropicJsonSchema(CITATIONS_OUTPUT_SCHEMA)).not.toThrow();
    /* The list schema has optional fields (authors, year, …) and goes on the
       Messages wire, so only the new field's shape is put to the chat subset. */
    expect(() =>
      validateOpenAiJsonSchema({
        type: "object",
        properties: { influence: work.properties.influence },
        required: ["influence"],
        additionalProperties: false,
      }),
    ).not.toThrow();
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
  it("inherits a unique legacy search row's id after dropping its unsupported author and year", async () => {
    const body = block("spya-b00001", "The Bitter Lesson is cited here.");
    const raw = { title: "The Bitter Lesson", authors: "Sutton", year: "2019", why: "x", ...scored, mentions: [{ block: body.id, quote: "The Bitter Lesson" }] };
    const previous = build([raw], [block(body.id, `${body.text} Sutton (2019).`)]).citations;
    answer = JSON.stringify({ works: [raw] });
    stop = "end_turn";
    const run = await generateCitations({ power: "standard", article: { blocks: [body], tree: tree(), meta: null } as never, previous, referenceList: null });
    expect(run.citations.citations[0]?.id).toBe(previous.citations[0]?.id);
    expect(run.citations.citations[0]?.authors).toBeUndefined();
    expect(run.citations.citations[0]?.year).toBeUndefined();
  });

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

  describe("SPIDERYARN_PIPELINE_EFFORT at this call site", () => {
    /* One of the three places that read the variable, each with its own
       fallback (here `medium`). All three go through `pipelineEffortOverride`
       in src/models.ts since 2026-10-04; before that this one cast the raw
       string, so an empty value or a typo went to the provider as the effort.
       tests/pipeline-effort-override.test.ts has the parser's own table. */
    const NAME = "SPIDERYARN_PIPELINE_EFFORT";
    const run = () => {
      stop = "end_turn";
      sent = null;
      answer = JSON.stringify({
        capped: false,
        works: [{ title: "Silk", why: "Its model.", ...scored, reference: { block: "spya-n00001", quote: "Porter, D. (2005)" } }],
      });
      return generateCitations({ power: "standard", article: { blocks: BLOCKS, tree: tree(), meta: null } as never, previous: null, referenceList: null });
    };
    const withEnv = async (value: string | undefined, body: () => Promise<void>) => {
      const before = process.env[NAME];
      if (value === undefined) delete process.env[NAME];
      else process.env[NAME] = value;
      try {
        await body();
      } finally {
        if (before === undefined) delete process.env[NAME];
        else process.env[NAME] = before;
      }
    };

    it("keeps its own medium when the variable is unset or empty", async () => {
      for (const value of [undefined, ""]) {
        await withEnv(value, async () => {
          await run();
          expect(sent?.output_config?.effort, String(value)).toBe("medium");
        });
      }
    });

    it("takes a valid override", async () => {
      await withEnv("high", async () => {
        await run();
        expect(sent?.output_config?.effort).toBe("high");
      });
    });

    it("refuses a typo before anything is sent", async () => {
      await withEnv("hgih", async () => {
        await expect(run()).rejects.toThrow(NAME);
        expect(sent).toBeNull();
      });
    });
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
  it("is citations/6, and asks for influence only when the model is confident it knows the work", () => {
    expect(PROMPT_VERSION).toBe("citations/6");
    const said = systemPrompt().replace(/\s+/g, " ");
    expect(said).toMatch(/"influence"[^.]*\bnull\b/);
    expect(said).toMatch(/in doubt[^.]*null/i);
    /* citations/5's instruction, which made "I do not know it" and "it is
       obscure" the same number. */
    expect(said).not.toMatch(/say so with a low number/i);
    expect(said).not.toMatch(/or you do not know it/i);
    expect(said).not.toMatch(/Both scores are required/i);
    /* The example must not teach a number for it: 0.0 was the old placeholder. */
    expect(said).toMatch(/"influence": null/);
  });

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

  it("keeps a search for malformed Unicode in a PDF entry instead of repairing its DOI", () => {
    expect(linkOf(`${CHEN}. doi:10.1234/a\uD800b`).linkFrom).toBe("search");
  });

  it("inherits a legacy percent DOI by its stored key even though reading its old URL is ambiguous", () => {
    const entry = `${CHEN}. doi:10.1234/a%2Fb`;
    const previous = run(entry);
    const old = previous.citations[0]!;
    /* The old writer pasted the literal DOI; its persisted key recorded that
       DOI, even though decoding its URL now reads a/b. */
    old.url = "https://doi.org/10.1234/a%2Fb";
    expect(old.key).toBe("doi:10.1234/a%2fb");
    expect(keysOf(old).idKey).toBe("doi:10.1234/a/b");
    const current = run(entry, idsByKey(previous)).citations[0]!;
    expect(current.url).toBe("https://doi.org/10.1234/a%252Fb");
    expect(current.id).toBe(old.id);
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

/* Plan 261004j: a biomedical / Nature-style paper cites with a superscript
   number, which the PDF transcription stores glued to the word — as superscript
   characters or as plain digits. Read only when the article has no notes. */
describe("glued and superscript cites", () => {
  const glued = (...quotes: string[]) => [...markerNumbers(quotes, true)].sort((a, b) => a - b);

  it("are not read unless asked — the bracket rule alone, as before", () => {
    expect([...markerNumbers(["reduced mortality.¹", "in a number of previous studies15"])]).toEqual([]);
  });

  it("reads a superscript run glued to a word or to sentence punctuation", () => {
    expect(glued("reduced mortality.¹")).toEqual([1]);
    expect(glued("effective in prevention.²")).toEqual([2]);
    expect(glued("role in metastatic disease.³⁻⁵")).toEqual([3, 4, 5]);
    expect(glued("ischemia.²⁸,²⁹")).toEqual([28, 29]);
  });

  it("reads plain digits glued to a lower-case word, with the list and range after them", () => {
    expect(glued("lesions disrupt this pattern5,51")).toEqual([5, 51]);
    expect(glued("in a number of previous studies15")).toEqual([15]);
    expect(glued("a model of the environment15,24")).toEqual([15, 24]);
    expect(glued("Wells et al.18")).toEqual([18]);
    expect(glued("(from23)")).toEqual([23]);
    expect(glued("as shown before17, 19–21")).toEqual([17, 19, 20, 21]);
    expect(glued("as Smith (2020) found)4 and “so it goes”7")).toEqual([4, 7]);
  });

  it("does not read a name, a formula, a quantity or a year as a cite", () => {
    expect(glued("activation of p38 and of p53")).toEqual([]);
    expect(glued("CO2 and BRCA1 and H2O2 and IL6")).toEqual([]);
    expect(glued("published in 2020.")).toEqual([]);
    expect(glued("a ratio of 3.5", "rose by 12.5%", "version.3.5")).toEqual([]);
    expect(glued("about 1,000 cells", "in 12 patients")).toEqual([]);
    expect(glued("the 1990s", "since 2019", "the sample2019")).toEqual([]);
    expect(glued("an area of 5 cm² and 3 m2", "at mol⁻¹", "R² = 0.4")).toEqual([]);
    expect(glued("the dose5mg", "rose12%", "types3a and 3b", "a ratio of 3:1")).toEqual([]);
    expect(glued("see Fig.3 and Eq.2")).toEqual([]);
  });

  it("does not read the numbers inside delimited maths as cites", () => {
    expect(glued(String.raw`Use \(\log2(x)\) before the transformation.`)).toEqual([]);
    expect(glued(String.raw`The exponent is \(f(x)2\), not an entry.`)).toEqual([]);
    expect(glued(String.raw`The claim \(f(x)2\) follows earlier studies15.`)).toEqual([15]);
  });

  it("keeps the cite and leaves a quantity that follows a prose comma", () => {
    expect(glued("in earlier studies15, 20 patients were")).toEqual([15]);
    expect(glued("in earlier studies15, 20 mg daily")).toEqual([15]);
  });

  it("reads a quote that has a bracketed cite by the bracket rule only", () => {
    expect(glued("earlier studies15 and TV episodes [8]")).toEqual([8]);
  });

  describe("pairing an entry", () => {
    const ENTRY_8 =
      "8. Chen, J. et al. (2017) Shared memories reveal shared structure in neural activity across individuals. Nat. Neurosci. 20, 115–125";
    const ENTRY_9 =
      "9. Baldassano, C. and Chen, J. (2017a) Discovering event structure in continuous narrative perception and memory. Neuron 95, 709–721";
    const LIST: NumberedReferenceList = { entries: new Map([[8, ENTRY_8], [9, ENTRY_9]]) };
    const BODY = block("spya-b00001", "People recall TV episodes in a number of previous studies8 in detail.");
    const NOTED = block("spya-n00001", "8 A remark the author put at the foot of the page.", { role: "footnote" });

    function paired(entry: number, blocks: Block[]) {
      const drops = emptyDrops();
      const citations = buildCitations(
        {
          capped: false,
          works: [
            {
              title: "Shared memories reveal shared structure in neural activity across individuals",
              authors: "Chen et al.",
              year: "2017",
              why: "Evidence that recall of a TV episode is shared across people.",
              ...scored,
              mentions: [{ block: "spya-b00001", quote: "previous studies8" }],
              entry,
            },
          ],
        },
        {
          power: "standard",
          slug: "t",
          blocks,
          sourceHash: "h.h",
          elapsedMs: 1,
          inherit: null,
          drops,
          scores: noScoreDrops(),
          referenceList: LIST,
        },
      );
      return { row: citations.citations[0], drops };
    }

    it("attaches the entry a glued number cites, in an article with no notes", () => {
      const { row, drops } = paired(8, [BODY]);
      expect(row?.entry).toBe(ENTRY_8);
      expect(row?.authors).toBe("Chen et al.");
      expect(drops.entryMismatch).toBe(0);
    });

    it("still refuses the neighbour's entry — 9 for a work cited studies8", () => {
      const { row, drops } = paired(9, [BODY]);
      expect(row?.entry).toBeUndefined();
      expect(drops.entryMismatch).toBe(1);
    });

    it("ignores glued numbers when the article has notes: they may be note markers", () => {
      const { row, drops } = paired(8, [BODY, NOTED]);
      expect(row?.entry).toBeUndefined();
      expect(drops.entryMismatch).toBe(1);
    });

    it("ignores glued numbers when only a note id survives on a block", () => {
      const identified = block("spya-n00002", "A note without its role.", { noteId: "spya-note-0123456789" });
      const { row, drops } = paired(8, [BODY, identified]);
      expect(row?.entry).toBeUndefined();
      expect(drops.entryMismatch).toBe(1);
    });

    /* GPT Sol's C5 (review of 261004j): a note the extraction left out or did
       not recognise leaves no block behind, so "no notes" cannot be read off
       the blocks alone. A paper that really cites by glued numbers cites most
       of its list that way; one stray glued number against a ten-entry list is
       a footnote's marker far more often than a reference. */
    it("ignores glued numbers that cover little of the reference list", () => {
      const entries = new Map<number, string>();
      for (let n = 1; n <= 10; n++) entries.set(n, `${n}. Author${n}, A. (2001) A different work number ${n}. J. Mem. ${n}, 1–9`);
      entries.set(8, ENTRY_8);
      const drops = emptyDrops();
      const drafts = toDrafts(
        [
          {
            title: "Shared memories reveal shared structure in neural activity across individuals",
            authors: "Chen et al.",
            year: "2017",
            why: "Evidence.",
            ...scored,
            mentions: [{ block: "spya-b00001", quote: "previous studies8" }],
            entry: 8,
          },
        ],
        [BODY],
        drops,
        noScoreDrops(),
        { entries },
      );
      expect(drafts[0]?.entry).toBeUndefined();
      expect(drops.entryMismatch).toBe(1);
    });

    it("…and reads them when the body cites at least half the list that way", () => {
      const entries = new Map<number, string>();
      for (let n = 1; n <= 10; n++) entries.set(n, `${n}. Author${n}, A. (2001) A different work number ${n}. J. Mem. ${n}, 1–9`);
      entries.set(8, ENTRY_8);
      const more = block("spya-b00003", "Earlier work1–4 and a later review6,7 agree.");
      const drops = emptyDrops();
      const drafts = toDrafts(
        [
          {
            title: "Shared memories reveal shared structure in neural activity across individuals",
            authors: "Chen et al.",
            year: "2017",
            why: "Evidence.",
            ...scored,
            mentions: [{ block: "spya-b00001", quote: "previous studies8" }],
            entry: 8,
          },
        ],
        [BODY, more],
        drops,
        noScoreDrops(),
        { entries },
      );
      expect(drafts[0]?.entry).toBe(ENTRY_8);
    });

    it("…and when a body block carries a note marker", () => {
      const marked = block("spya-b00002", "A remark.", { html: `<p>A remark.<sup ${REF_ATTR}="spya-n00009">1</sup></p>` });
      const { row, drops } = paired(8, [BODY, marked]);
      expect(row?.entry).toBeUndefined();
      expect(drops.entryMismatch).toBe(1);
    });
  });

  /* The model's quote usually stops just before the superscript: on the real
     paper, 1 mention in about 30 ended with its marker, and nothing was kept.
     So the marker is also read from the block, straight after the quote. */
  describe("the marker straight after the quoted words", () => {
    const TEXT =
      "Adjuvant tamoxifen lowered recurrence and reduced mortality.¹ It is effective in prevention.² " +
      "It has a role in metastatic disease.³⁻⁵ Resistance involves p38 signalling in most tumours11,15 and more. " +
      "It was given to 12 patients. Again it was given to more, and it was given to others7 too, and to others again.";
    const B = block("spya-b00001", TEXT);
    const LIST: NumberedReferenceList = {
      entries: new Map(Array.from({ length: 40 }, (_, i) => [i + 1, `${i + 1}. An entry`])),
    };
    const at = (quote: string, start = TEXT.indexOf(quote)) => ({ blockId: B.id, quote, start });
    /** The entry numbers, 1–40, that these mentions verify. */
    function verified(mentions: ReturnType<typeof at>[], blocks: Block[] = [B]): number[] {
      const byId = new Map(blocks.map((b) => [b.id as string, b]));
      const glued = !blocks.some((b) => b.role === "footnote");
      return [...LIST.entries.keys()].filter(
        (n) => verifyEntry(n, LIST, mentions, emptyDrops(), glued, byId) !== null,
      );
    }

    it("is read when the quote stops before it", () => {
      expect(verified([at("reduced mortality")])).toEqual([1]);
      expect(verified([at("effective in prevention")])).toEqual([2]);
      expect(verified([at("role in metastatic disease")])).toEqual([3, 4, 5]);
      expect(verified([at("p38 signalling in most tumours")])).toEqual([11, 15]);
    });

    it("…and still when the quote includes it", () => {
      expect(verified([at("reduced mortality.¹")])).toEqual([1]);
    });

    it("reads nothing that is not glued to the end of the quoted words", () => {
      expect(verified([at("Resistance involves p")])).toEqual([]);
      expect(verified([at("It was given to")])).toEqual([]);
      expect(verified([at("recurrence and reduced")])).toEqual([]);
      expect(verified([at("p38 signalling in most")])).toEqual([]);
    });

    it.each([
      ["The earlier studies15 were conclusive.", "earlier studies1", [15]],
      ["The prescribed dose5mg was used.", "prescribed dose5", []],
      ["The effect rose12% overall.", "effect rose12", []],
      ["The lesion covers area5 cm².", "lesion covers area5", []],
    ])("reads a partial quoted number in its block context: %s", (text, quote, expected) => {
      const body = block(B.id, text);
      expect(verified([{ blockId: B.id, quote, start: text.indexOf(quote) }], [body])).toEqual(expected);
    });

    it("reads nothing when the offset is wrong and the quote repeats, and finds a lone quote anyway", () => {
      expect(verified([at("it was given to others")])).toEqual([7]);
      expect(verified([at("it was given to others", 3)])).toEqual([7]);
      expect(verified([at("to others", 3)])).toEqual([]);
      expect(verified([at("to others", TEXT.indexOf("to others"))])).toEqual([7]);
      expect(verified([at("to others", TEXT.lastIndexOf("to others"))])).toEqual([]);
    });

    it("is not read in an article with notes", () => {
      const noted = block("spya-n00001", "1 A remark at the foot of the page.", { role: "footnote" });
      expect(verified([at("reduced mortality")], [B, noted])).toEqual([]);
    });
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
