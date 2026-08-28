/**
 * **Exactly these keys, and no others** — the allowlist, checked recursively.
 *
 * The first draft of docs/plans/public-read-only-access.md proposed serving
 * today's responses through a key *denylist*, and GPT Sol refused it:
 *
 * > A recursive key denylist is insufficient: it misses innocently named fields
 * > such as `title`, `guidance`, `comments`, `generatedAt`, `lookup`, and future
 * > aliases such as `owner`, `createdBy`, or snake-case keys.
 *
 * So the DTOs construct rather than filter, and this file asserts the shape of
 * what comes out. Every input below is deliberately **over-full**: it carries
 * the private field as well as the public one, so a projection that copied its
 * argument wholesale would fail here rather than pass for want of anything to
 * leak. A fixture with nothing forbidden in it proves nothing at all.
 *
 * Sol's own instruction for making this go red: *"add `guidance` to one
 * projection"*. The equivalent for the two endpoints that landed is to put
 * `note` back on a block or `url` back on the meta, and both were watched — see
 * the report on docs/plans/public-read-only-access.md.
 *
 * The half this cannot do is the query: a projection can be perfectly right
 * while the SQL still says `.select()`. That is
 * tests/public-reads.test.ts's job, and it is the same division
 * `tests/store-revision-columns.test.ts` already draws for the owner's reads.
 */

import { describe, expect, it } from "vitest";

import { publicArticle, publicMetadata } from "../src/public/dto.js";
import type { Arc, Block, Tree } from "../src/types.js";

/** Every key path in a value, dotted, with array elements collapsed to `[]`. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => keyPaths(item, `${prefix}[]`)))];
  }
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const here = prefix === "" ? key : `${prefix}.${key}`;
    out.push(here);
    out.push(...keyPaths(inner, here));
  }
  return [...new Set(out)].sort();
}

/**
 * A block carrying `note` — the field the owner's `blocksQuery` selects and a
 * visitor must never see. It says why the splitter marked a block ungistable,
 * which is our diagnostics rather than the article.
 *
 * And carrying all three note fields, which a visitor **must** see: the hover
 * preview renders a note's whole range, so `noteId` is load-bearing on the
 * public side rather than an extra. `HEADING` below carries none of them, so
 * the assertion covers both arms.
 */
const BLOCK: Block = {
  id: "spya-k3m9qt",
  tag: "p",
  kind: "text",
  text: "The argument does not survive its own first example.",
  words: 9,
  html: "<p>The argument does not survive its own first example.</p>",
  gistable: false,
  note: "repeats the pull quote above",
  role: "footnote",
  treatment: "supplement",
  noteId: "spya-note-0123456789",
};

const HEADING: Block = {
  id: "spya-h1aaaa",
  tag: "h1",
  kind: "heading",
  level: 1,
  text: "The mythology of conscious AI",
  words: 5,
  html: "<h1>The mythology of conscious AI</h1>",
  gistable: true,
};

const TREE: Tree = {
  version: "1",
  generator: "test",
  slug: "noema",
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1"],
      range: ["spya-h1aaaa", "spya-k3m9qt"],
      title: "The whole piece",
      gist: "It argues one thing and demonstrates another.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-k3m9qt", "spya-k3m9qt"],
      title: "The example",
      navLabel: "Example",
      summary: "A longer restatement.",
      sourceHeading: "The example",
    },
  },
};

const ARC: Arc = {
  version: "1",
  generator: "test",
  slug: "noema",
  entries: [{ range: ["spya-h1aaaa", "spya-k3m9qt"], text: "Where the argument stands here." }],
};

/**
 * The whole owner-side row, with every field the payload table in
 * docs/plans/public-read-only-access.md § The payload names as forbidden.
 *
 * The DTO takes named arguments rather than a `Meta`, so the private fields
 * cannot even be *passed* — which is the design. They are listed here in the
 * assertions instead, as the set that must not appear in the output.
 */
const FORBIDDEN_ON_META = [
  "url", // the FINAL fetched URL — credentials, signed query parameters
  "fetchedAt",
  "note", // the extraction note
  "source", // and the whole PDF/upload provenance block below
  "method",
  "pages",
  "rawSha256",
  "unverified",
  "recall",
  "pagesChecked",
  "comments", // the count of the owner's own questions
  "purpose", // "why you're reading this one"
  "profile",
  "archivedAt",
  "ownerId",
  "owner",
  "createdBy",
  "titleOverride",
];

describe("the public article payload", () => {
  const built = publicArticle({
    slug: "noema",
    title: "The mythology of conscious AI",
    byline: "A Writer",
    siteName: "Noema",
    lang: "en",
    excerpt: "Two sentences of Readability's own.",
    headingTitle: "The mythology of conscious AI",
    blocks: [HEADING, BLOCK],
    tree: TREE,
    arc: ARC,
  });

  it("has exactly the keys it is allowed, all the way down", () => {
    expect(keyPaths(built)).toEqual(
      [
        "arc",
        "arc.entries",
        "arc.entries[].range",
        "arc.entries[].text",
        "arc.generator",
        "arc.slug",
        "arc.version",
        "blocks",
        "blocks[].gistable",
        "blocks[].html",
        "blocks[].id",
        "blocks[].kind",
        "blocks[].level",
        "blocks[].noteId",
        "blocks[].role",
        "blocks[].tag",
        "blocks[].text",
        "blocks[].treatment",
        "blocks[].words",
        "meta",
        "meta.byline",
        "meta.excerpt",
        "meta.lang",
        "meta.siteName",
        "meta.slug",
        "meta.title",
        "tree",
        "tree.generator",
        "tree.nodes",
        "tree.nodes.n0",
        "tree.nodes.n0.children",
        "tree.nodes.n0.depth",
        "tree.nodes.n0.gist",
        "tree.nodes.n0.id",
        "tree.nodes.n0.parent",
        "tree.nodes.n0.range",
        "tree.nodes.n0.title",
        "tree.nodes.n1",
        "tree.nodes.n1.children",
        "tree.nodes.n1.depth",
        "tree.nodes.n1.id",
        "tree.nodes.n1.navLabel",
        "tree.nodes.n1.parent",
        "tree.nodes.n1.range",
        "tree.nodes.n1.summary",
        "tree.nodes.n1.sourceHeading",
        "tree.nodes.n1.title",
        "tree.rootId",
        "tree.slug",
        "tree.version",
      ].sort(),
    );
  });

  /**
   * **And the prose is really there.** Every assertion above passes for a DTO
   * that returns nothing at all, which is the failure this repo keeps writing
   * up — a check that agrees with the code because both are empty. The whole
   * point of the feature is that a visitor gets the article.
   */
  it("still contains the article, which is the point of the exercise", () => {
    expect(built.blocks).toHaveLength(2);
    expect(built.blocks[1]?.html).toContain("does not survive");
    expect(built.meta.title).toBe("The mythology of conscious AI");
    expect(Object.keys(built.tree.nodes)).toEqual(["n0", "n1"]);
    expect(built.arc?.entries[0]?.text).toContain("Where the argument stands");
  });

  /**
   * `note` said out loud, because it is the one field on the shared `Block`
   * shape that has to be dropped and the one a future edit would put back
   * without noticing.
   */
  it("drops a block's note even when the input carries one", () => {
    expect(BLOCK.note).toBe("repeats the pull quote above");
    expect(keyPaths(built)).not.toContain("blocks[].note");
    expect(JSON.stringify(built)).not.toContain("repeats the pull quote");
  });

  it("has none of the meta fields the payload table forbids", () => {
    const keys = Object.keys(built.meta);
    expect(keys.filter((k) => FORBIDDEN_ON_META.includes(k))).toEqual([]);
  });

  /**
   * **A field added to `TreeNode` next month is absent by default.**
   *
   * This is the whole reason `publicTree` rebuilds rather than passes through.
   * The tree stays a `Tree` — one structure for the ToC, the spine and the zoom,
   * and the plan is explicit that it must not fork — but the *copy* is
   * enumerated, so a new optional field has to be added here on purpose.
   */
  it("drops a tree-node field nobody added to the projection", () => {
    const withExtra: Tree = {
      ...TREE,
      nodes: {
        ...TREE.nodes,
        n0: { ...TREE.nodes.n0, whoAsked: "the owner" } as (typeof TREE.nodes)["n0"],
      },
    };
    const out = publicArticle({
      slug: "noema",
      title: "t",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      blocks: [BLOCK],
      tree: withExtra,
      arc: null,
    });
    expect(JSON.stringify(out)).not.toContain("whoAsked");
  });

  /** `null` from Postgres becomes an absent key, not `undefined`. */
  it("leaves an absent field absent rather than null", () => {
    const bare = publicArticle({
      slug: "noema",
      title: null,
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: "From the article's own h1",
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
    });
    expect(Object.keys(bare.meta)).toEqual(["slug", "title"]);
    expect(bare.meta.title).toBe("From the article's own h1");
    expect("arc" in bare).toBe(false);
  });

  /** And the last resort, when there is no h1 either. */
  it("falls back to the slug when nothing named the article", () => {
    const bare = publicArticle({
      slug: "noema",
      title: null,
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
    });
    expect(bare.meta.title).toBe("noema");
  });
});

describe("the public metadata payload", () => {
  const built = publicMetadata({
    slug: "noema",
    title: "The mythology of conscious AI",
    headingTitle: null,
    available: { arc: true, tweets: false, glossary: true, summary: false, ideas: false },
  });

  /**
   * **Five booleans and a title.** The owner's `ArticleMetadata` carries `dir`,
   * the whole of `stages` — internal paths, column names, run times, byte
   * counts — plus `comments`, `profile`, `purpose` and `archivedAt`. None of it
   * is a visitor's business and most of it is about us rather than about the
   * article.
   */
  it("has exactly the keys it is allowed", () => {
    expect(keyPaths(built)).toEqual(
      [
        "available",
        "available.arc",
        "available.glossary",
        "available.ideas",
        "available.summary",
        "available.tweets",
        "slug",
        "title",
      ].sort(),
    );
  });

  it("and says which artefacts exist, which is what it is for", () => {
    expect(built.available).toEqual({
      arc: true,
      tweets: false,
      glossary: true,
      summary: false,
      ideas: false,
    });
  });

  for (const forbidden of ["dir", "stages", "comments", "profile", "purpose", "archivedAt"]) {
    it(`has no ${forbidden}`, () => {
      expect(keyPaths(built)).not.toContain(forbidden);
    });
  }
});
