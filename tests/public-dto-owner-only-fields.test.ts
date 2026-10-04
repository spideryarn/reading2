/**
 * **The four fields Greg let across the public boundary on 2026-10-01** — plan
 * docs/plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md.
 *
 * Each has two kinds of case: that a visitor receives it, and that what
 * crosses with it is only what the plan names — nothing of the owner's, and
 * nothing the boundary refused elsewhere. The sentinels are the words that must
 * never appear in the JSON; `NOT_ON_THE_WIRE` collects them so the last case
 * can ask for all of them at once over a payload carrying all four fields.
 *
 * src/public/dto.ts is the allowlist; tests/public-dto.test.ts pins the rest.
 */
import { describe, expect, it } from "vitest";

import { entryOfText } from "../src/citation-entry.js";
import { publicArticle } from "../src/public/dto.js";
import type {
  Block,
  BlockId,
  CitedWork,
  Citations,
  ClaimDebateRow,
  Crossrefs,
  Debate,
  DebateSynthesis,
  NodeId,
  Tree,
} from "../src/types.js";

const NOT_ON_THE_WIRE: string[] = [];
/** A string that must never reach a visitor, registered for the sweep at the end. */
function sentinel(s: string): string {
  NOT_ON_THE_WIRE.push(s);
  return s;
}

const OWNER_NOTE = sentinel("owner note sentinel on a block");

const P1: Block = {
  id: "spya-paaaaa" as BlockId,
  tag: "p",
  kind: "text",
  text: "The measure cannot be computed, as the second section shows.",
  words: 10,
  html: "<p>The measure cannot be computed, as the second section shows.</p>",
  gistable: true,
  note: OWNER_NOTE,
};
const P2: Block = {
  id: "spya-pbbbbb" as BlockId,
  tag: "p",
  kind: "text",
  text: "Here is the second section's demonstration in full.",
  words: 8,
  html: "<p>Here is the second section's demonstration in full.</p>",
  gistable: true,
};
/** A bibliography entry, as a block — the case whose entry may cross. */
const REF: Block = {
  id: "spya-rfaaaa" as BlockId,
  tag: "p",
  kind: "text",
  text: "Chen, J. et al. (2017)   Shared memories reveal shared structure. Nat. Neurosci. 20, 115–125",
  words: 14,
  html: "<p>Chen, J. et al. (2017) Shared memories reveal shared structure. Nat. Neurosci. 20, 115–125</p>",
  gistable: false,
};
const BLOCKS = [P1, P2, REF];

const TREE: Tree = {
  version: "tree/1",
  generator: "g",
  slug: "piece",
  rootId: "n0" as NodeId,
  nodes: {
    ["n0" as NodeId]: {
      id: "n0" as NodeId,
      depth: 0,
      parent: null,
      children: [],
      range: [P1.id, REF.id],
      title: "The piece",
    },
  },
};

const NONE = {
  slug: "piece",
  title: "The piece",
  byline: null,
  siteName: null,
  lang: null,
  excerpt: null,
  journal: null,
  publishedAt: null,
  publishedYear: null,
  headingTitle: null,
  finalUrl: "https://papers.example.org/piece",
  blocks: BLOCKS,
  tree: TREE,
  arc: null,
  assets: null,
  glossary: null,
  ideas: null,
  quotes: null,
  tweets: null,
  timeline: null,
  skim: null,
  faq: null,
  simpleSummary: null,
  citations: null,
  debate: null,
  crossrefs: null,
  crossrefsFresh: false,
  comments: [],
  searches: [],
  sketch: null,
  navLabelStatus: "ready" as const,
  sourceGuess: null,
};

/* ------------------------------------------------------------- debate -- */

const COUNTS = {
  returnedSources: 3,
  reportedRows: 3,
  keptRows: 3,
  omittedOverCap: 0,
  lost: {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
  },
  webSearches: 2,
};

function claimRow(over: Partial<ClaimDebateRow>): ClaimDebateRow {
  return {
    id: "spya-caaaaa",
    url: "https://one.example.org/a",
    title: "A first work on the measure",
    sourceQuote: "The measure is computable after all.",
    relation: "disputes",
    lean: "leans-against",
    applies: "It disputes the claim.",
    claimQuote: "The measure cannot be computed",
    blockId: P1.id,
    ...over,
  };
}

const ROW_A = claimRow({ id: "spya-caaaaa", url: "https://one.example.org/a", title: "Work one on computability", bears: "directly" });
const ROW_B = claimRow({ id: "spya-cbbbbb", url: "https://two.example.net/b", title: "Work two, a replication", bears: "partly" });
const ROW_C = claimRow({ id: "spya-cccccc", url: "https://three.example.com/c", title: "Work three, a survey", bears: "loosely" });

function debate(rows: ClaimDebateRow[], synthesis?: unknown): Debate {
  return {
    version: "debate/3",
    generator: "g",
    slug: "piece",
    sourceHash: "h",
    searchedAt: "2026-09-30T10:00:00.000Z",
    direct: { rows: [], counts: COUNTS },
    claims: { rows, counts: COUNTS },
    elapsedMs: 1,
    ...(synthesis === undefined ? {} : { synthesis: synthesis as DebateSynthesis }),
  };
}

function made(themes: unknown[], key: unknown[] = []): unknown {
  return { kind: "made", themes, key };
}

const THEME_AB = {
  id: "spya-taaaaa",
  label: "Computability",
  gist: "Both say the measure can be computed.",
  rowIds: [ROW_A.id, ROW_B.id],
  /* A key the stored document should not have; it must not ride along. */
  ownerId: sentinel("owner id sentinel on a theme"),
};

function publish(d: Debate, finalUrl: string | null = NONE.finalUrl) {
  return publicArticle({ ...NONE, finalUrl, debate: d });
}

describe("Debate's relevance judgement (5P)", () => {
  it("crosses on every row that has one, and only as one of the three words", () => {
    const odd = claimRow({ id: "spya-cdddd2", url: "https://four.example.org/d", bears: "very" as never });
    const built = publish(debate([ROW_A, ROW_B, ROW_C, odd]));
    expect(built.debate?.claims.rows.map((r) => r.bears)).toEqual(["directly", "partly", "loosely", undefined]);
    expect(built.debate?.claims.rows[3]).not.toHaveProperty("bears");
  });
});

describe("Debate's threads and key sources (6M)", () => {
  it("cross, rebuilt, when no row was withheld", () => {
    const why = "It is the replication.";
    const built = publish(
      debate(
        [ROW_A, ROW_B, ROW_C],
        made([THEME_AB], [{ rowId: ROW_B.id, role: "advances", why, ownerId: "x" }]),
      ),
    );
    expect(built.debate?.synthesis).toEqual({
      kind: "made",
      themes: [{ id: THEME_AB.id, label: THEME_AB.label, gist: THEME_AB.gist, rowIds: [ROW_A.id, ROW_B.id] }],
      key: [{ rowId: ROW_B.id, role: "advances", why }],
    });
  });

  it("do not cross at all when a row was withheld, whatever the theme names", () => {
    /* The withheld row's words, summarised in a gist without its address —
       what an address scan cannot catch (Sol, plan review P1). */
    const privateWords = sentinel("what the withheld page privately said");
    const withheld = claimRow({
      id: "spya-cwwwww",
      url: "https://owner:hunter2@private.example.org/w",
      title: "Withheld",
    });
    const built = publish(
      debate(
        [ROW_A, ROW_B, withheld],
        made([{ ...THEME_AB, gist: `Both agree, as does ${privateWords}.` }]),
      ),
    );
    expect(built.debate?.claims.sourceNotPublishable).toBe(1);
    expect(built.debate).not.toHaveProperty("synthesis");
    expect(JSON.stringify(built)).not.toContain(privateWords);
  });

  it("drop a theme or key source whose words carry an address the boundary refused", () => {
    /* No row withheld: the article's own address is the refused one, and a
       gist quotes it. */
    const own = "https://owner:hunter2@papers.example.org/piece";
    const built = publish(
      debate(
        [ROW_A, ROW_B, ROW_C],
        made(
          [
            { ...THEME_AB, gist: `They answer owner:hunter2@papers.example.org/piece directly.` },
            { id: "spya-tbbbbb", label: "Replication", gist: "Two of them replicate it.", rowIds: [ROW_B.id, ROW_C.id] },
          ],
          [{ rowId: ROW_A.id, role: "responds", why: "It replies to owner:hunter2@papers.example.org/piece." }],
        ),
      ),
      own,
    );
    expect(built.debate?.synthesis).toEqual({
      kind: "made",
      themes: [{ id: "spya-tbbbbb", label: "Replication", gist: "Two of them replicate it.", rowIds: [ROW_B.id, ROW_C.id] }],
      key: [],
    });
    expect(JSON.stringify(built)).not.toContain("hunter2");
  });

  it("stay `made` with empty lists when the boundary took every item, never `failed`", () => {
    const own = "https://owner:hunter2@papers.example.org/piece";
    const built = publish(
      debate([ROW_A, ROW_B, ROW_C], made([{ ...THEME_AB, label: "owner:hunter2@papers.example.org/piece" }])),
      own,
    );
    expect(built.debate?.synthesis).toEqual({ kind: "made", themes: [], key: [] });
  });

  it("cross `failed` and `too-few` as they are, and nothing for a debate that never had one", () => {
    expect(publish(debate([ROW_A], { kind: "failed" })).debate?.synthesis).toEqual({ kind: "failed" });
    expect(publish(debate([ROW_A], { kind: "too-few", rows: 1 })).debate?.synthesis).toEqual({
      kind: "too-few",
      rows: 1,
    });
    expect(publish(debate([ROW_A])).debate).not.toHaveProperty("synthesis");
    expect(publish(debate([ROW_A], { kind: "made", themes: "not a list" })).debate?.synthesis).toEqual({
      kind: "failed",
    });
  });
});

/* ---------------------------------------------------------- citations -- */

function work(over: Omit<Partial<CitedWork>, "entry"> & { entry?: unknown }): CitedWork {
  return {
    id: "w-1",
    key: "work:shared memories|chen|2017",
    title: "Shared memories reveal shared structure",
    authors: "Chen",
    year: "2017",
    why: "Cited for the method.",
    reference: { blockId: REF.id, quote: "Shared memories", start: 0 },
    mentions: [],
    citedAt: [P1.id],
    firstCited: P1.id,
    citedInBody: true,
    url: "https://doi.org/10.1038/nn.4450",
    linkFrom: "doi",
    ...over,
  } as CitedWork;
}

function cited(works: CitedWork[], blocks: Block[] = BLOCKS) {
  const citations: Citations = {
    version: "citations/4",
    generator: "g",
    slug: "piece",
    sourceHash: "h",
    citations: works,
    capped: false,
    generatedAt: "2026-09-30T10:00:00.000Z",
    elapsedMs: 1,
  };
  return publicArticle({ ...NONE, blocks, citations }).citations?.citations ?? [];
}

describe("a cited work's reference entry (6K)", () => {
  const blockEntry = entryOfText(REF.text)!;

  it("crosses when it is exactly its own bibliography block's text", () => {
    expect(blockEntry).not.toBe(REF.text); // the whitespace really was collapsed
    expect(cited([work({ entry: blockEntry })])[0]?.entry).toBe(blockEntry);
  });

  it("does not cross when it is anything else — a PDF list's entry above all", () => {
    /* A PDF's reference list is read from its text layer and is in no block; a
       one-page download stamp can sit inside an entry (Sol, plan review P1). */
    const stamp = sentinel("Downloaded by Alice Example on 30 September");
    const [pdf] = cited([work({ entry: `${blockEntry} ${stamp}` })]);
    expect(pdf).not.toHaveProperty("entry");
    expect(cited([work({ entry: "Chen, J. (2017) Shared memories." })])[0]).not.toHaveProperty("entry");
  });

  it("does not cross when its block is not in the payload, or when it has no reference", () => {
    expect(cited([work({ entry: blockEntry })], [P1, P2])[0]).not.toHaveProperty("entry");
    const { reference: _, ...noRef } = work({ entry: blockEntry });
    expect(cited([noRef as CitedWork])[0]).not.toHaveProperty("entry");
  });

  it("does not cross when the stored value is not a string — JSONB is unchecked", () => {
    const nested = sentinel("owner id inside a malformed entry");
    const [odd] = cited([work({ entry: { ownerId: nested } })]);
    expect(odd).not.toHaveProperty("entry");
    expect(JSON.stringify(odd)).not.toContain(nested);
  });
});

/* --------------------------------------------------------- crossrefs -- */

function crossrefs(links: unknown[], over: Partial<Crossrefs> = {}): Crossrefs {
  return {
    version: "crossrefs/2",
    generator: "g",
    slug: "piece",
    sourceHash: sentinel("crossrefs source hash sentinel"),
    links: links as Crossrefs["links"],
    dropped: {
      unknownIds: 0,
      nearby: 0,
      length: 0,
      unquoted: 0,
      ambiguous: 0,
      overlap: 0,
      truncated: 0,
      malformed: 0,
    },
    generatedAt: "2026-09-30T10:00:00.000Z",
    elapsedMs: 1,
    ...over,
  };
}

const GOOD = { from: P1.id, phrase: "as the second section shows", to: P2.id };

describe("cross-references (5Z)", () => {
  it("cross when fresh, as {from, phrase, to} and nothing else", () => {
    const why = sentinel("a why line the stored link should not have");
    const built = publicArticle({
      ...NONE,
      crossrefs: crossrefs([{ ...GOOD, why }]),
      crossrefsFresh: true,
    });
    expect(built.crossrefs).toEqual({ links: [GOOD] });
    expect(Object.keys(built.crossrefs!)).toEqual(["links"]);
  });

  it("do not cross when stale, for another article, or with no links array", () => {
    expect(publicArticle({ ...NONE, crossrefs: crossrefs([GOOD]), crossrefsFresh: false })).not.toHaveProperty(
      "crossrefs",
    );
    expect(
      publicArticle({ ...NONE, crossrefs: crossrefs([GOOD], { slug: "another" }), crossrefsFresh: true }),
    ).not.toHaveProperty("crossrefs");
    expect(
      publicArticle({ ...NONE, crossrefs: crossrefs("nope" as never), crossrefsFresh: true }),
    ).not.toHaveProperty("crossrefs");
  });

  it("drop a link that is malformed, self-referring, or to a block this payload lacks", () => {
    const nested = sentinel("owner id nested in a malformed link");
    const privatePhrase = sentinel("owner identity in a malformed cross-reference phrase");
    const built = publicArticle({
      ...NONE,
      crossrefs: crossrefs([
        GOOD,
        { from: { ownerId: nested }, phrase: "x y", to: P2.id },
        /* Three well-typed fields and two real block ids are not enough: the
           phrase itself must be proved to be characters already present in the
           public source block. JSONB is unchecked, and freshness authenticates
           the article inputs rather than this stored output. */
        { from: P1.id, phrase: privatePhrase, to: P2.id },
        { from: P1.id, phrase: "  ", to: P2.id },
        { from: P1.id, phrase: "the measure", to: P1.id },
        { from: P1.id, phrase: "the measure", to: "spya-zzzzzz" },
        "a string",
      ]),
      crossrefsFresh: true,
    });
    expect(built.crossrefs).toEqual({ links: [GOOD] });
    expect(JSON.stringify(built)).not.toContain(privatePhrase);
  });

  it("an empty list crosses as empty: the model found nothing worth linking", () => {
    expect(publicArticle({ ...NONE, crossrefs: crossrefs([]), crossrefsFresh: true }).crossrefs).toEqual({
      links: [],
    });
  });
});

/* -------------------------------------------- nothing private rides along -- */

describe("all four at once", () => {
  it("carry none of the owner's data, and none of the sentinels above", () => {
    const blockEntry = entryOfText(REF.text)!;
    const built = publicArticle({
      ...NONE,
      debate: debate(
        [ROW_A, ROW_B, ROW_C],
        made([THEME_AB], [{ rowId: ROW_A.id, role: "responds", why: "It replies." }]),
      ),
      citations: {
        version: "citations/4",
        generator: "g",
        slug: "piece",
        sourceHash: "h",
        citations: [
          work({
            entry: blockEntry,
            found: { url: "https://found.example.org", title: sentinel("the owner's own find") } as never,
          }),
        ],
        capped: false,
        generatedAt: "2026-09-30T10:00:00.000Z",
        elapsedMs: 1,
      },
      crossrefs: crossrefs([GOOD]),
      crossrefsFresh: true,
    });
    /* Each of the four is really present, so the sweep is not vacuous. */
    expect(built.debate?.claims.rows[0]?.bears).toBe("directly");
    expect(built.debate?.synthesis?.kind).toBe("made");
    expect(built.citations?.citations[0]?.entry).toBe(blockEntry);
    expect(built.crossrefs?.links).toHaveLength(1);

    const json = JSON.stringify(built);
    expect(NOT_ON_THE_WIRE.length).toBeGreaterThan(5);
    for (const s of NOT_ON_THE_WIRE) expect(json, s).not.toContain(s);
    for (const key of ['"ownerId"', '"owner"', '"profileHash"', '"note"', '"found"', '"guidance"', '"purpose"']) {
      expect(json, key).not.toContain(key);
    }
  });
});
