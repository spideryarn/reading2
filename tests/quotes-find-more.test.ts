/**
 * **Find more appends; it does not choose again.** Feedback report
 * SPIDERYARN-READING2-2W, Greg, 2026-09-10:
 *
 * > Remove the "Choose them again" button, and add a "Find more" button
 *
 * and, in the same report, *"Try and find more quotes by default"*.
 *
 * The shape is the glossary's (src/glossary.ts § existingFor): one forced verb,
 * and the state of the previous list decides whether that run appends or
 * replaces. The one place it deliberately parts company with the glossary is
 * the prompt version — see `existingFor` in src/quotes.ts and
 * docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md § 2.
 */
import { describe, expect, it } from "vitest";
import {
  buildQuotes,
  existingFor,
  MAX_QUOTES,
  noneDropped,
  PROMPT_VERSION,
  renderPrompt,
  suggestedQuotes,
  type Dropped,
} from "../src/quotes.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { MAX_QUOTES_TOTAL, type Block, type Quote, type Quotes, type Tree, type TreeNode } from "../src/types.js";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: `<p>${text}</p>`, gistable: true };
}

const FIRST = "Writing is thinking, and there is no other kind of thinking.";
const SECOND = "The mathematical marriage of convenience starts to fall apart here.";
const THIRD = "Most people never had to write anything at all, and now they must.";
/** Overlaps FIRST, and is longer — so plain `dedupeOverlaps` would keep it over FIRST. */
const FIRST_LONGER = `${FIRST} Everything after it is commentary.`;

const BLOCKS: Block[] = [
  block("spya-aaaaaa", FIRST_LONGER),
  block("spya-bbbbbb", SECOND),
  block("spya-cccccc", THIRD),
];

const TREE = {
  slug: "writes",
  generatedAt: "2026-08-31T00:00:00.000Z",
  rootId: "n0",
  nodes: {
    n0: { id: "n0", depth: 0, parent: null, children: ["n1"], range: ["spya-aaaaaa", "spya-cccccc"], title: "A piece" },
    n1: { id: "n1", depth: 1, parent: "n0", children: [], range: ["spya-aaaaaa", "spya-cccccc"], title: "Part one", gist: "Writing is thinking." },
  } as Record<string, TreeNode>,
} as unknown as Tree;

function drops(over: Partial<Dropped> = {}): Dropped {
  return { ...noneDropped(), ...over };
}

/** A list the reader already has: FIRST, in block a, id spya-keep01. */
function previous(over: Partial<Quotes> = {}): Quotes {
  const kept: Quote = { id: "spya-keep01", blockId: "spya-aaaaaa", text: FIRST, start: 0, importance: 0.9 };
  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: "writes",
    sourceHash: "hash-1",
    profileHash: null,
    quotes: [kept],
    discarded: drops({ unfound: 2 }),
    generatedAt: "2026-09-10T00:00:00.000Z",
    elapsedMs: 100,
    passes: 1,
    lastAdded: 1,
    ...over,
  };
}

const opts = { slug: "writes", blocks: BLOCKS, sourceHash: "hash-1", elapsedMs: 10 };

describe("existingFor — which previous list a forced run appends to", () => {
  it("appends to a list written from this same article", () => {
    const p = previous();
    expect(existingFor(p, "hash-1")).toBe(p);
  });

  it("does NOT append to a list the article has moved out from under — that is a replace", () => {
    expect(existingFor(previous(), "hash-2")).toBeNull();
  });

  it("appends across a prompt version, unlike the glossary", () => {
    /* A quote's words are the author's, verified verbatim; an older prompt
       contributed only which lines. Refusing here would make the first Find
       more on every list that predates quotes/4 silently replace it. */
    const p = previous({ version: "quotes/3" });
    expect(existingFor(p, "hash-1")).toBe(p);
  });

  it("appends across a profile — Find more continues the list, it does not re-choose it", () => {
    const p = previous({ profileHash: "someone" });
    expect(existingFor(p, "hash-1")).toBe(p);
  });

  it("has nothing to append to when there is no list", () => {
    expect(existingFor(null, "hash-1")).toBeNull();
  });
});

describe("buildQuotes, appending", () => {
  it("keeps every existing quote, with its id, and adds the new ones in document order", () => {
    const built = buildQuotes({ quotes: [{ text: THIRD }, { text: SECOND }] }, {
      ...opts,
      dropped: drops(),
      existing: previous(),
    });
    expect(built.quotes.map((q) => q.text)).toEqual([FIRST, SECOND, THIRD]);
    expect(built.quotes[0]?.id).toBe("spya-keep01");
    expect(built.quotes[0]?.importance).toBe(0.9);
    const ids = built.quotes.map((q) => q.id);
    expect(new Set(ids).size).toBe(3);
    expect(built.passes).toBe(2);
    expect(built.lastAdded).toBe(2);
  });

  it("lets an existing quote win an overlap with a LONGER new one — the reader's list does not change under them", () => {
    const dropped = drops();
    const built = buildQuotes({ quotes: [{ text: FIRST_LONGER }, { text: SECOND }] }, {
      ...opts,
      dropped,
      existing: previous(),
    });
    expect(built.quotes.map((q) => q.text)).toEqual([FIRST, SECOND]);
    expect(built.quotes[0]?.id).toBe("spya-keep01");
    expect(dropped.overlapping).toBe(1);
  });

  it("re-finds a legacy quote without start before rejecting a typographically folded overlap", () => {
    const articleText = "Writing — thinking is the practice that makes every later conclusion possible.";
    const legacyText = "Writing - thinking is the practice that makes every later conclusion possible.";
    const longer = `${articleText} Everything else follows.`;
    const blocks = [block("spya-legacy", longer)];
    const kept: Quote = {
      id: "spya-keep02",
      blockId: "spya-legacy",
      /* Early quote artefacts could preserve the model's typography and have no
         disambiguating start. Neither difference permits Find more to add the
         same passage again. */
      text: legacyText,
    };
    const dropped = drops();
    const built = buildQuotes(
      { quotes: [{ text: longer }] },
      {
        ...opts,
        blocks,
        dropped,
        existing: previous({ quotes: [kept] }),
      },
    );
    expect(built.quotes).toEqual([kept]);
    expect(dropped.overlapping).toBe(1);
  });

  it("keeps an existing quote in document order when its block is outside today's evidence", () => {
    const keptA = previous().quotes[0]!;
    const keptB: Quote = {
      id: "spya-keep02",
      blockId: "spya-bbbbbb",
      text: SECOND,
      start: 0,
      striking: 0.8,
    };
    const built = buildQuotes(
      { quotes: [{ text: THIRD }] },
      {
        ...opts,
        /* Simulates `isBodyEvidence` filtering B out after the earlier pass.
           It remains in the article and in the full document-order ruler. */
        blocks: [BLOCKS[0]!, BLOCKS[2]!],
        documentBlocks: BLOCKS,
        dropped: drops(),
        existing: previous({ quotes: [keptA, keptB] }),
      },
    );
    expect(built.quotes.map((q) => q.id)).toEqual([keptA.id, keptB.id, expect.any(String)]);
    expect(built.quotes[0]).toBe(keptA);
    expect(built.quotes[1]).toBe(keptB);
  });

  it("never reorders the existing list, even if a legacy artefact was not perfectly sorted", () => {
    const keptC: Quote = {
      id: "spya-keep03",
      blockId: "spya-cccccc",
      text: THIRD,
      start: 0,
    };
    const keptA = previous().quotes[0]!;
    const built = buildQuotes(
      { quotes: [{ text: SECOND }] },
      {
        ...opts,
        dropped: drops(),
        existing: previous({ quotes: [keptC, keptA] }),
      },
    );
    expect(built.quotes.filter((q) => q.id.startsWith("spya-keep"))).toEqual([keptC, keptA]);
  });

  it("treats the same line again as an overlap, not a second copy", () => {
    const built = buildQuotes({ quotes: [{ text: FIRST }] }, {
      ...opts,
      dropped: drops(),
      existing: previous(),
    });
    expect(built.quotes).toHaveLength(1);
  });

  it("writes the list with lastAdded 0 when there is nothing more — it does not throw", () => {
    /* A fresh list with nothing in it is a model call that produced nothing.
       An append that found nothing more is a real answer, and the panel says
       so; throwing would turn it into a failed job. */
    const built = buildQuotes({ quotes: [] }, { ...opts, dropped: drops(), existing: previous() });
    expect(built.quotes.map((q) => q.id)).toEqual(["spya-keep01"]);
    expect(built.lastAdded).toBe(0);
    expect(built.passes).toBe(2);
  });

  it("still throws on a FRESH list with nothing in it", () => {
    expect(() => buildQuotes({ quotes: [] }, { ...opts, dropped: drops() })).toThrow(/no quotes/i);
  });

  it("accumulates what was discarded and how long it took, across passes", () => {
    const built = buildQuotes(
      { quotes: [{ text: SECOND }, { text: "Words this piece has never contained at all." }] },
      { ...opts, dropped: drops(), existing: previous() },
    );
    expect(built.discarded.unfound).toBe(3);
    expect(built.elapsedMs).toBe(110);
  });

  it("keeps the list's own stamps — profile and prompt version — rather than certifying old lines as new", () => {
    /* GPT Sol on the plan: restamping a quotes/3 list quotes/4 after an append
       clears the outdated banner over lines the current prompt never chose,
       and does it even when the pass added nothing. The list keeps its older
       version, so it goes on saying it includes such lines. */
    const built = buildQuotes({ quotes: [{ text: SECOND }] }, {
      ...opts,
      dropped: drops(),
      profile: "a different reader",
      existing: previous({ profileHash: "the-first-pass", version: "quotes/3" }),
    });
    expect(built.profileHash).toBe("the-first-pass");
    expect(built.version).toBe("quotes/3");
  });

  it("an append that adds nothing does not restamp the version either", () => {
    const built = buildQuotes({ quotes: [] }, {
      ...opts,
      dropped: drops(),
      existing: previous({ version: "quotes/3" }),
    });
    expect(built.version).toBe("quotes/3");
  });

  it("a fresh list is stamped with the current version", () => {
    const built = buildQuotes({ quotes: [{ text: SECOND }] }, { ...opts, dropped: drops() });
    expect(built.version).toBe(PROMPT_VERSION);
  });

  it("cuts only NEW lines at the total ceiling, and counts them", () => {
    const many: Quote[] = Array.from({ length: MAX_QUOTES_TOTAL }, (_, i) => ({
      id: `spya-old${String(i).padStart(3, "0")}`,
      blockId: "spya-aaaaaa",
      text: FIRST,
      start: 0,
    }));
    const dropped = drops();
    const built = buildQuotes({ quotes: [{ text: SECOND }, { text: THIRD }] }, {
      ...opts,
      dropped,
      existing: previous({ quotes: many }),
    });
    expect(built.quotes).toHaveLength(MAX_QUOTES_TOTAL);
    expect(built.quotes.every((q) => q.id.startsWith("spya-old"))).toBe(true);
    expect(dropped.overCap).toBe(2);
    expect(built.lastAdded).toBe(0);
  });
});

describe("buildQuotes, replacing", () => {
  it("starts passes at 1 and counts every quote as added", () => {
    const built = buildQuotes({ quotes: [{ text: SECOND }, { text: THIRD }] }, { ...opts, dropped: drops() });
    expect(built.passes).toBe(1);
    expect(built.lastAdded).toBe(2);
  });
});

describe("renderPrompt on an append", () => {
  it("lists what is already taken and asks for MORE", () => {
    const prompt = renderPrompt({ tree: TREE, count: 12, profile: null, existing: previous().quotes });
    expect(prompt).toContain("ALREADY");
    expect(prompt).toContain(FIRST);
    expect(prompt).toMatch(/12 MORE/);
    // An empty answer is a real one, and the stage now treats it as one.
    expect(prompt).toContain('{"quotes": []}');
  });

  it("rules out a taken line's point in other words, not only its sentence", () => {
    /* SPIDERYARN-READING2-2X: "avoid ending up with loads of quotes that say
       basically the same thing". Spans cannot catch a restatement, so the
       prompt is the only place this is asked. */
    const prompt = renderPrompt({ tree: TREE, count: 12, profile: null, existing: previous().quotes });
    expect(prompt).toMatch(/not a point one of them already makes,\s+in other\s+words/);
  });

  it("says nothing about a taken list on a first pass", () => {
    const prompt = renderPrompt({ tree: TREE, count: 12, profile: null, existing: [] });
    expect(prompt).not.toContain("ALREADY");
  });
});

describe("the count, raised", () => {
  it("asks for one per ~200 words, clamped 10–40", () => {
    /* Greg, 2026-09-10: "Try and find more quotes by default". */
    expect(suggestedQuotes(0)).toBe(10);
    expect(suggestedQuotes(4000)).toBe(20);
    expect(suggestedQuotes(200_000)).toBe(MAX_QUOTES);
    expect(MAX_QUOTES).toBe(40);
  });
});
