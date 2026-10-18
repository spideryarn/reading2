/**
 * **The front and back matter folds, as a visitor receives them** — Greg's 2B
 * to q-f7zp3t, 2026-10-18, plan
 * docs/plans/261018l-visitors-on-a-shared-link-get-the-front-and-back-matter-folds.md.
 *
 * Three things: a current document's stretches cross, as `{from, to, kinds}`
 * and nothing else; a document the owner's rule would withhold crosses as no
 * key at all, so the visitor falls back to the byline rule as the owner does;
 * and the folds a visitor gets are the folds the owner gets, for the same
 * stored value over the same blocks.
 */
import { describe, expect, it } from "vitest";

import { MATTER_PROMPT_VERSION, matterForReader, matterInputHash } from "../src/matter-current.js";
import { publicArticle } from "../src/public/dto.js";
import type { Block, BlockId, NodeId, Tree } from "../src/types.js";

const block = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id: id as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/u).length,
  html: `<p>${text}</p>`,
  gistable: true,
  ...extra,
});

/* `level` and `role` set on purpose: they are the fields of the hash a mapper
   can drop without a type error (plan review F3). */
const TITLE = block("spya-ttaaaa", "A title", { tag: "h1", kind: "heading", level: 1 });
const AUTHORS = block("spya-auaaaa", "Ada Lovelace, Charles Babbage");
const BODY = block("spya-bdaaaa", "The argument itself, at some length, which is not folded.");
const NOTE = block("spya-ntaaaa", "1. A footnote.", { role: "footnote" });
const REF = block("spya-rfaaaa", "Lovelace, A. (1843). Notes. Taylor's Scientific Memoirs, 3, 666–731.");
const BLOCKS = [TITLE, AUTHORS, BODY, NOTE, REF];

const TREE: Tree = {
  version: "tree/1",
  generator: "g",
  slug: "piece",
  rootId: "n0" as NodeId,
  nodes: {
    ["n0" as NodeId]: { id: "n0" as NodeId, depth: 0, parent: null, children: [], range: [TITLE.id, REF.id], title: "The piece" },
  },
};

const STRETCHES = [
  { from: TITLE.id, to: AUTHORS.id, kinds: ["title", "authors"] },
  { from: REF.id, to: REF.id, kinds: ["references"] },
];

/** Every field a stored document can carry, so a test can ask which of them crossed. */
const CURRENT = {
  status: "ok",
  version: MATTER_PROMPT_VERSION,
  generator: "labels+provider/model-sentinel",
  sourceHash: matterInputHash(BLOCKS),
  modelUnavailable: "timed-out",
  stretches: STRETCHES,
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
  readingLanguage: null,
  readingIdeas: null,
  readingDifficultyReason: null,
  headingTitle: null,
  finalUrl: null,
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
  bibliography: null,
  citationBlurbs: null,
  matter: null,
  reception: null,
  sourcesClaims: null,
  crossrefs: null,
  crossrefsFresh: false,
  comments: [],
  searches: [],
  sketch: null,
  navLabelStatus: "ready" as const,
  sharedBy: "public" as const,
  sourceGuess: null,
};

describe("the front and back matter on a shared link", () => {
  it("sends a current document's stretches, and only their ids and kinds", () => {
    const built = publicArticle({ ...NONE, matter: CURRENT });
    expect(built.matter).toEqual(STRETCHES);
    for (const stretch of built.matter ?? []) expect(Object.keys(stretch).sort()).toEqual(["from", "kinds", "to"]);
    const wire = JSON.stringify(built);
    for (const leak of ["provider/model-sentinel", CURRENT.sourceHash, MATTER_PROMPT_VERSION, "timed-out"]) {
      expect(wire, leak).not.toContain(leak);
    }
  });

  it("drops a field planted inside a stretch", () => {
    const planted = { ...CURRENT, stretches: [{ ...STRETCHES[0], note: "planted-sentinel" }] };
    const built = publicArticle({ ...NONE, matter: planted });
    expect(built.matter).toEqual([STRETCHES[0]]);
    expect(JSON.stringify(built)).not.toContain("planted-sentinel");
  });

  /* Absent, never `[]`: `[]` means *the step looked and found nothing*, and
     the reading view would then drop the byline rule's fold too. */
  it.each([
    ["no column", null],
    ["an unavailable document", { status: "unavailable", version: MATTER_PROMPT_VERSION, sourceHash: CURRENT.sourceHash, reason: "step-failed" }],
    ["an older version", { ...CURRENT, version: "matter/1" }],
    ["a hash of other blocks", { ...CURRENT, sourceHash: matterInputHash(BLOCKS.slice(1)) }],
    ["an id that is not a block here", { ...CURRENT, stretches: [{ from: "spya-zzzzzz", to: REF.id, kinds: ["references"] }] }],
    ["a malformed document", { status: "ok", stretches: "all of it" }],
  ])("sends no key for %s", (_label, stored) => {
    const built = publicArticle({ ...NONE, matter: stored });
    expect("matter" in built).toBe(false);
  });

  it("sends an empty list as an empty list: the step looked and found nothing", () => {
    expect(publicArticle({ ...NONE, matter: { ...CURRENT, stretches: [] } }).matter).toEqual([]);
  });

  it("folds what the owner's read folds, for the same stored value over the same blocks", () => {
    expect(publicArticle({ ...NONE, matter: CURRENT }).matter).toEqual(matterForReader(CURRENT, BLOCKS));
  });
});
