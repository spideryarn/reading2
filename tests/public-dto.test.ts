/**
 * **Exactly these keys, and no others** — the allowlist, checked recursively.
 *
 * The first draft of docs/plans/260827ai-public-read-only-access.md proposed serving
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
 * the report on docs/plans/260827ai-public-read-only-access.md.
 *
 * The half this cannot do is the query: a projection can be perfectly right
 * while the SQL still says `.select()`. That is
 * tests/public-reads.test.ts's job, and it is the same division
 * `tests/store-revision-columns.test.ts` already draws for the owner's reads.
 */

import { describe, expect, it } from "vitest";

import type { Assets } from "../src/assets.js";
import { publicArticle } from "../src/public/dto.js";
import type {
  Arc,
  Block,
  BlockId,
  Glossary,
  Ideas,
  Quotes,
  NodeId,
  Timeline,
  Tree,
  TreeNode,
  TweetThread,
} from "../src/types.js";

/**
 * An article whose four slice-1b columns are all empty, for the cases that are
 * about the meta, the blocks and the tree.
 *
 * Spelled out rather than defaulted in the DTO: `publicArticle` takes them as
 * required arguments, so a fifth artefact added next year cannot be forgotten
 * at a call site — it stops compiling instead.
 */
const NO_ARTEFACTS = {
  glossary: null,
  ideas: null,
  quotes: null,
  tweets: null,
  timeline: null,
} as const;

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
 *
 * Left as a plain `Block` on purpose: `EVERY_BLOCK_FIELD` below is the
 * `Required<Block>` guard, and two of them would be one fixture to update and
 * one to forget.
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

/**
 * **Every field a `TreeNode` has** — the other half of the guard
 * `EVERY_BLOCK_FIELD` below sets out at length, and the reasoning there is the
 * whole of the reasoning here: `publicTree` drops what it does not name, which
 * is safe and is not the same as correct, so a new field has to stop compiling
 * until somebody decides about it.
 *
 * ## Why it is assigned through a variable rather than written as a literal
 *
 * TypeScript's excess-property check fires on a **fresh object literal** and
 * not on a variable, and that difference is load-bearing here rather than
 * stylistic. `TreeNode` is a contended type: on 2026-08-28 the footnotes lane
 * added a `treatment?` to it in a working tree that is not committed yet, and a
 * literal listing `treatment` would fail to compile the moment that hunk lands
 * or is dropped — this file would be red in one half of the repo's two states
 * whichever way it was written.
 *
 * Through a variable, the half that matters still holds in both: a field added
 * to `TreeNode` and not set here is a **missing** property, and
 * `Required<TreeNode>` refuses it. A field listed here that `TreeNode` no
 * longer has is merely extra, and passes quietly — which is the right way round,
 * because a stale name in a fixture is a tidy-up and an unconsidered field in a
 * public payload is a leak.
 */
const NODE_FIELDS = {
  id: "n1" as NodeId,
  depth: 1,
  parent: "n0" as NodeId | null,
  children: [] as NodeId[],
  range: ["spya-k3m9qt", "spya-k3m9qt"] as [BlockId, BlockId],
  title: "The example",
  navLabel: "Example",
  summary: "A longer restatement.",
  sourceHeading: "The example",
  gist: "The one worked example, and what it costs the argument.",
  /**
   * **Apparatus rather than argument**, and the one field here that is not
   * merely provenance.
   *
   * **`publicTree` copies it, and the note that used to stand here is why.**
   * This comment said the field was deliberately dropped because it existed
   * only in the footnotes lane's uncommitted `src/types.ts`, and that whoever
   * landed that lane would meet this fixture and decide. That is what happened,
   * on 2026-08-29, and the answer was that it crosses: `treatment` says a node
   * is apparatus, which is structure exactly as `depth` and `title` are, and it
   * comes from the article's own markup rather than from anything the owner
   * did. Every consumer that tells apparatus from argument reads it off the
   * node, so a client without it numbers the footnotes as a part of the piece —
   * measured through the real DTO before the fix: 1 part and 1 section for the
   * owner, 2 and 2 for a visitor of the same article.
   *
   * The note left for a future author is the good version of this failure mode,
   * and it is the only reason this was ever found. Leave one behind if you add
   * a field here and choose not to carry it.
   */
  treatment: "supplement" as const,
};

/* **No `as` on this line, and that is the guard.** A cast would suppress
   exactly the error this exists to produce. */
const FULL_NODE: Required<TreeNode> = NODE_FIELDS;

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
    n1: FULL_NODE,
  },
};

const ARC: Arc = {
  version: "1",
  generator: "test",
  slug: "noema",
  entries: [{ range: ["spya-h1aaaa", "spya-k3m9qt"], text: "Where the argument stands here." }],
};

/**
 * One image we hold and one we do not, so the key list pins **both arms** of
 * `AssetEntry` rather than whichever one the fixture happened to have.
 *
 * The stored URL carries a query string on purpose: `blocks.json` holds
 * `&amp;s=…` and `getAttribute("src")` returns `&s=…`, and the manifest is
 * keyed on the second spelling — five of the corpus's thirteen images are like
 * this, and getting it wrong is invisible (src/assets.ts).
 */
const ASSETS: Assets = {
  version: "assets/1",
  sourceHash: "abc123",
  fetchedAt: "2026-08-29T00:00:00.000Z",
  entries: [
    {
      url: "https://noemamag.imgix.net/a.jpg?fm=pjpg&s=7a8b90d8",
      status: "stored",
      sha256: "f".repeat(64),
      ext: "jpeg",
      contentType: "image/jpeg",
      bytes: 49_152,
    },
    {
      url: "https://noemamag.imgix.net/b.svg",
      status: "failed",
      reason: "unsupported-format",
      at: "2026-08-29T00:00:00.000Z",
    },
  ],
};

/**
 * The whole owner-side row, with every field the payload table in
 * docs/plans/260827ai-public-read-only-access.md § The payload names as forbidden.
 *
 * The DTO takes named arguments rather than a `Meta`, so the private fields
 * cannot even be *passed* — which is the design. They are listed here in the
 * assertions instead, as the set that must not appear in the output.
 */
const FORBIDDEN_ON_META = [
  /* **`url` was on this list until 2026-08-30** — "the FINAL fetched URL —
     credentials, signed query parameters" — and Greg took it off: *"I think
     Public-readable articles should show their provenance-url to all
     reader[s]."* The credentials half of that reason is still real and is now
     enforced where it belongs, on the value rather than on the key:
     `publicSourceUrl` in src/urls.ts refuses a `user:pw@` address, and § the
     source URL at the end of this file is what says so. Leaving the key
     forbidden here *and* publishing it would have been the two halves of this
     suite disagreeing, with the whole-key-set assertion above the one that wins.

     `requestedUrl` is not published and is not on this list either, because the
     DTO cannot be handed one — there is no such argument. That is the design
     this file's header describes, and it is why the list below is short. */
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
    /* **A real address, not `null`**, for the same reason `assets` below is a
       real manifest: with `null` in, the whole-key-set assertion never sees
       `meta.url` at all, and would stay green over a projection that published
       the raw column beside three more of them. The published value itself is
       § the source URL at the end of this file. */
    finalUrl: "https://www.noemamag.com/the-mythology-of-conscious-ai/",
    blocks: [HEADING, BLOCK],
    tree: TREE,
    arc: ARC,
    /* **A real manifest, not `null`**, and the difference is what this test is
       for. With `null` in, every image assertion below would hold for a payload
       that carries nothing about images at all — a check agreeing with the code
       because both are empty. One `stored` entry and one `failed` one, so the
       key list pins both arms of `AssetEntry`. src/assets.ts. */
    assets: ASSETS,
    ...NO_ARTEFACTS,
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
        /* **Every field of the manifest crosses, both arms.** Nothing in it is
           about a person: the URLs are the publisher's own and are already in
           `blocks[].html` in this same payload, and the rest is a hash, a
           format, a byte count and the reason an image was not stored. What is
           *not* here is the point of the list — if a future `AssetEntry` grows
           a field that is about us, its fate gets decided here.

           `assets` itself is present-with-a-value rather than present-or-absent
           like the four artefacts below, because `PublicArticle.assets` is a
           required key holding `Assets | undefined`. `JSON.stringify` drops an
           undefined value, so an article with no manifest still sends no
           `assets` key over the wire — the shape is a compile-time discipline,
           not a wire change. src/public-types.ts. */
        "assets",
        "assets.entries",
        "assets.entries[].at",
        "assets.entries[].bytes",
        "assets.entries[].contentType",
        "assets.entries[].ext",
        "assets.entries[].reason",
        "assets.entries[].sha256",
        "assets.entries[].status",
        "assets.entries[].url",
        "assets.fetchedAt",
        "assets.sourceHash",
        "assets.version",
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
        /* Published since 2026-08-30, and this line is the allowlist entry for
           it — Greg: *"Public-readable articles should show their
           provenance-url to all reader[s]."* It is `publicSourceUrl`'s answer,
           never `articles.final_url` itself. */
        "meta.url",
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
        /* `n1` is the `Required<TreeNode>` fixture, so it carries every field
           the type has — and this list is where each one's fate is recorded.
           `treatment` is present below, and its presence is the thing to read:
           it is the one field here that a client *branches on* rather than
           merely displays, so dropping it reverted the whole footnotes feature
           for anyone following a shared link. Anything new that lands in
           `TreeNode` gets its fate decided here, in this list, on purpose. */
        "tree.nodes.n1.gist",
        "tree.nodes.n1.id",
        "tree.nodes.n1.navLabel",
        "tree.nodes.n1.parent",
        "tree.nodes.n1.range",
        "tree.nodes.n1.summary",
        "tree.nodes.n1.sourceHeading",
        "tree.nodes.n1.title",
        /* Apparatus or argument, and it crosses on purpose since 2026-08-29 —
           see the test below for the decision and what a visitor saw without
           it. */
        "tree.nodes.n1.treatment",
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

  /**
   * **The field the `Required<TreeNode>` fixture exists for**, asserted rather
   * than left to the key list above.
   *
   * `treatment` was dropped by `publicTree` — the safe default doing its job —
   * and this test said in as many words that whoever landed the footnotes
   * lane's `TreeNode.treatment` would meet it and decide.
   *
   * **The decision is that it crosses**, made 2026-08-29. *Safe* and *correct*
   * were different here and this was the case that showed it: every consumer
   * that tells the apparatus from the argument reads it off the node, so a
   * visitor without it saw the footnotes numbered as a part of the piece, one
   * blank row per endnote in summary mode with "No summary for this section" on
   * each, the spine and the outline descending into individual notes, and the
   * diagram drawing them as argument. Measured through this DTO before the
   * change: 1 part and 1 section for the owner, 2 and 2 for a visitor.
   *
   * It is structure, not privacy: it says a node is apparatus, which is the
   * same kind of fact as `depth` and `title`, and it is derived from the
   * article's own markup rather than from anything the owner did. GPT Sol's
   * fifth review of the footnotes lane.
   */
  /**
   * **The other field a client branches on rather than displays.**
   *
   * `provisional` says the tree was carved from the author's own headings and
   * has no gists (src/heading-tree.ts). Dropped at this boundary, a visitor
   * gets a reading view that draws an empty cell at every coarse zoom level
   * with no way to tell that from an article whose gists are merely bad — the
   * same class of silent reversion `treatment` suffered, which is why it is
   * asserted here rather than trusted to the comment in `publicTree`.
   *
   * A separate `publicArticle` call, because the fixture tree above is a
   * finished one: a marker that is absent from the input proves nothing about
   * whether the boundary would have carried it.
   */
  it("carries a tree's provisional marker, so a visitor is not shown empty gists", () => {
    const out = publicArticle({
      slug: "noema",
      title: "The mythology of conscious AI",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl: null,
      blocks: [HEADING, BLOCK],
      tree: { ...TREE, provisional: "headings" as const },
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
    });
    expect(out.tree?.provisional).toBe("headings");
    expect(keyPaths(out)).toContain("tree.provisional");
  });

  it("leaves it off a tree that is not provisional, rather than sending a null", () => {
    expect(keyPaths(built)).not.toContain("tree.provisional");
  });

  it("carries a tree node's treatment, so a visitor can tell apparatus from argument", () => {
    expect(NODE_FIELDS.treatment).toBe("supplement");
    expect(keyPaths(built)).toContain("tree.nodes.n1.treatment");
    expect(built.tree.nodes.n1?.treatment).toBe("supplement");
  });

  it("has none of the meta fields the payload table forbids", () => {
    const keys = Object.keys(built.meta);
    expect(keys.filter((k) => FORBIDDEN_ON_META.includes(k))).toEqual([]);
  });

  /**
   * **A field added to `Block` next month does not compile until somebody has
   * decided about it.**
   *
   * The test above proves the projection *drops* what it was not told about,
   * which is the safe default and the reason `publicBlock` rebuilds rather than
   * passes through. But safe and correct are different things, and slice 1b
   * found the gap between them the hard way: `role`, `treatment` and `noteId`
   * arrived on `Block` from the footnotes work, and they are fields the client
   * *needs* — without `treatment` a visitor's copy of an article numbers the
   * apparatus as part of the argument. Silently dropping those is wrong in a way
   * that no amount of "it fails closed" reasoning fixes.
   *
   * So this fixture is typed `Required<Block>`, and that is the whole mechanism:
   * it stops compiling the moment `Block` gains **any** field, optional or not,
   * until somebody sets it here — and the assertion below then tells them at
   * once whether it crosses into the public payload. *Absent by default* stays
   * true; *absent without anybody noticing* stops being possible.
   *
   * The same move as `FIXED_BY_AN_ACCOUNT` in src/web/visitor.ts, which is a
   * total `Record<VisitorGap["kind"], boolean>` for the same reason it gives:
   * a fifth kind is then "a red compile rather than a silent `false`".
   *
   * **`TreeNode` has the identical guard now** — `FULL_NODE` at the top of this
   * file — and the reason this paragraph used to say it could not is worth
   * keeping, because the way round it is not obvious.
   *
   * The objection was real: on 2026-08-28 that type was mid-flight in the
   * footnotes lane, `TreeNode.treatment` was in the working tree and not in
   * HEAD, and a `Required<TreeNode>` **literal** is red in both directions at
   * once — missing the field against one state of the repo and carrying an
   * excess one against the other. What resolves it is that TypeScript's
   * excess-property check fires on a fresh object literal and not on a
   * variable. Assign the fields to a variable first, and the half that matters
   * still holds in both states: a field added to `TreeNode` and not set is a
   * *missing* property, which `Required<TreeNode>` refuses. A field set that
   * `TreeNode` no longer has is merely extra, and passes — which is the right
   * way round, since a stale name in a fixture is a tidy-up and an
   * unconsidered field in a public payload is a leak.
   */
  const EVERY_BLOCK_FIELD: Required<Block> = {
    id: "spya-zzzzzz",
    tag: "p",
    kind: "text",
    level: 2,
    text: "Every field set, so that the projection has something to drop.",
    words: 11,
    html: "<p>Every field set, so that the projection has something to drop.</p>",
    gistable: true,
    /* The one that must not survive, carrying a canary rather than plausible
       prose so that a leak is greppable in the serialised output. */
    note: "PRIVATE-EDITORIAL-NOTE-CANARY",
    role: "footnote",
    treatment: "supplement",
    noteId: "spya-note-0123456789",
    context: { id: "c-0123456789", type: "callout" },
  };

  it("carries every Block field that crosses, and drops the one that does not", () => {
    const out = publicArticle({
      slug: "noema",
      title: "t",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl: null,
      blocks: [EVERY_BLOCK_FIELD],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
    });

    /* Exact rather than `toContain`, in both directions at once: a field that
       stopped crossing fails here just as loudly as one that started. */
    expect(keyPaths(out).filter((k) => k.startsWith("blocks[]")).sort()).toEqual([
      "blocks[].context",
      "blocks[].context.id",
      "blocks[].context.type",
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
    ]);
    expect(JSON.stringify(out)).not.toContain("PRIVATE-EDITORIAL-NOTE-CANARY");
  });

  /**
   * **A nested object is where "rebuilt field by field" is easiest to lose.**
   *
   * `Required<Block>` above catches a new field on the *block*. It cannot catch
   * a new field on `Block.context`, because the fixture satisfies the type
   * whatever else the object carries at runtime — and a spread of the whole
   * context would pass that through. So the canary is inside the nested value.
   * GPT Sol's review, 2026-08-31.
   */
  it("rebuilds the context rather than passing the object through", () => {
    const out = publicArticle({
      slug: "noema",
      title: "t",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl: null,
      blocks: [
        {
          ...EVERY_BLOCK_FIELD,
          context: {
            id: "c-0123456789",
            type: "callout",
            ownerOnly: "PRIVATE-CONTEXT-CANARY",
          } as NonNullable<Block["context"]>,
        },
      ],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
    });
    expect(JSON.stringify(out)).not.toContain("PRIVATE-CONTEXT-CANARY");
    expect(keyPaths(out).filter((k) => k.startsWith("blocks[].context")).sort()).toEqual([
      "blocks[].context",
      "blocks[].context.id",
      "blocks[].context.type",
    ]);
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
      finalUrl: null,
      blocks: [BLOCK],
      tree: withExtra,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
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
      finalUrl: null,
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
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
      finalUrl: null,
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
    });
    expect(bare.meta.title).toBe("noema");
  });
});

/**
 * **The artefacts a shared link carries**, each fed an input that is
 * deliberately over-full.
 *
 * Every fixture below carries the private field as well as the public one —
 * a `lookup` on a glossary entry, `profileHash` on
 * each, the generator and the timings — so a projection that copied its
 * argument, spread it, or filtered a denylist would fail here rather than pass
 * for want of anything to leak. A fixture with nothing forbidden in it proves
 * nothing at all, which is the mistake the top of this file exists to name.
 */
describe("the artefacts a shared link carries", () => {
  /**
   * A glossary with **a lookup on one of its entries**, which is the single
   * most private thing in any of these four.
   *
   * `glossary_lookups` is the owner's own research — their requested answer,
   * its citations, how many web searches it ran, which model answered and the
   * exact minute — and `loadGlossary` attaches it to the entry at the read
   * seam, deliberately, for the owner. GPT Sol's design input named it by name
   * as the thing a public glossary read must never carry.
   */
  const GLOSSARY: Glossary = {
    version: "glossary/2",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    profileHash: "profile-of-a-person",
    passes: 3,
    generatedAt: "2026-08-28T10:00:00.000Z",
    elapsedMs: 41_000,
    entries: [
      {
        id: "spya-term01",
        name: "Integrated information theory",
        kind: "concept",
        aliases: ["IIT"],
        senseHere: "The author uses it as a stand-in for any measure-first account.",
        background: "A theory of consciousness proposed by Giulio Tononi.",
        gloss: "A superseded blended field, still rendered for older artefacts.",
        detail: "Its superseded partner.",
        url: "https://example.com/iit",
        difficulty: 0.8,
        centrality: 0.9,
        fromOutside: true,
        blocks: ["spya-k3m9qt"],
        lookup: {
          answer: "What the owner asked the web, and what it said back.",
          citations: [{ url: "https://example.com/source", title: "A source" }],
          searches: 4,
          model: "some-search-model",
          at: "2026-08-28T11:00:00.000Z",
        },
      },
      /* A second entry with every optional absent, so the assertions below
         cover both arms rather than only the full one. */
      {
        id: "spya-term02",
        name: "Lamport",
        kind: "person",
        aliases: [],
        blocks: [],
      },
    ],
  };

  const IDEAS: Ideas = {
    version: "ideas/1",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    profileHash: "profile-of-a-person",
    generatedAt: "2026-08-28T10:00:00.000Z",
    elapsedMs: 30_000,
    ideas: [
      {
        id: "spya-idea01",
        name: "Measurement precedes theory",
        provenance: "assumed",
        statement: "You cannot theorise about what you have no way to measure.",
        whyYouNeedIt: "The middle section's objection collapses without it.",
        analogy: "Like arguing about temperature before the thermometer.",
        occurrences: [
          {
            blockId: "spya-k3m9qt",
            quote: "does not survive its own first example",
            reasoning: "The example is offered as a measurement.",
            start: 17,
          },
        ],
      },
    ],
  };

  const THREAD: TweetThread = {
    version: "tweets/1",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    profileHash: "profile-of-a-person",
    limit: 280,
    tweets: [{ text: "The first post.", chars: 15 }],
    generatedAt: "2026-08-28T10:00:00.000Z",
    elapsedMs: 12_000,
  };

  /**
   * **A real one, not `null`** — and it is here because a cross-family review
   * pointed out that every Quotes assertion in this repo was passing
   * vacuously: the store round-trip proves an absent artefact stays absent, the
   * copy inventory deliberately omits it, the manifest exempts it, the deploy
   * fixtures have none, and this file passed `quotes: null`. Nothing has run
   * the stage against a real article, so every check was agreeing about
   * nothing. GPT Sol, 2026-08-31.
   */
  const QUOTES: Quotes = {
    version: "quotes/1",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    profileHash: "profile-of-a-person",
    generatedAt: "2026-08-28T10:00:00.000Z",
    elapsedMs: 20_000,
    discarded: {
      unfound: 2,
      otherVoice: 1,
      wrongLength: 3,
      overlapping: 0,
      overCap: 0,
      malformed: 0,
    },
    quotes: [
      {
        id: "spya-quote1",
        blockId: "spya-k3m9qt",
        text: "It does not survive its own first example, which is the whole trouble.",
        start: 17,
        reason: "The claim the rest of the piece is spent defending.",
        importance: 0.91,
        striking: 0.88,
      },
    ],
  };

  /**
   * **A real one, not `null`**, for the reason `QUOTES` above is real: an
   * assertion about an absent artefact agrees with a projection that returns
   * nothing, which is the vacuous pass this file was caught in once already.
   *
   * **Two events, and the `dating` union is why.** A `TimelineEvent`'s date is a
   * four-member union, and a single `dated` event would leave the projection's
   * treatment of the other three unexercised — the same shape as the
   * `TreeNode.treatment` regression in src/public/dto.ts's own header, where a
   * field that never crossed was invisible because every fixture had it.
   */
  const TIMELINE: Timeline = {
    version: "timeline/1",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    orderConflicts: 2,
    generatedAt: "2026-08-31T10:14:21.120Z",
    elapsedMs: 31_000,
    events: [
      {
        id: "spya-event1",
        label: "The first example is offered",
        dating: {
          kind: "dated",
          when: {
            earliest: "2026-07-04",
            latest: "2026-07-04",
            extent: "instant",
            phrase: "on 4 July",
            at: { blockId: "spya-k3m9qt", start: 3, end: 12 },
            yearFilled: true,
          },
        },
        order: 1,
        modality: "happened",
        occurrences: [
          { blockId: "spya-k3m9qt", quote: "does not survive its own first example", start: 17 },
        ],
      },
      {
        id: "spya-event2",
        label: "The trouble is named",
        dating: { kind: "words", phrase: "another month later" },
        order: 2,
        modality: "predicted",
        occurrences: [{ blockId: "spya-k3m9qt", quote: "which is the whole trouble", start: 56 }],
      },
    ],
  };

  const built = publicArticle({
    slug: "noema",
    title: "The mythology of conscious AI",
    byline: null,
    siteName: null,
    lang: null,
    excerpt: null,
    headingTitle: null,
    finalUrl: null,
    blocks: [BLOCK],
    tree: TREE,
    arc: null,
    assets: null,
    glossary: GLOSSARY,
    ideas: IDEAS,
    quotes: QUOTES,
    tweets: THREAD,
    timeline: TIMELINE,
  });

  /** Everything under one key, deeply, against the allowlist for that artefact. */
  function pathsUnder(key: string): string[] {
    return keyPaths((built as unknown as Record<string, unknown>)[key]);
  }

  /**
   * **The one pipeline-shaped field this projection lets through, and the
   * several it does not.**
   *
   * `discarded` crosses because it is a fact about the list on the screen —
   * that it is shorter than what the model produced — rather than about our
   * pipeline, and the panel says so in a sentence a visitor is entitled to read
   * as much as an owner. `sourceHash`, `version`, `generator`, `profileHash`
   * and the timings do not, on the rule the whole file keeps.
   */
  it("carries a quote's fields, its disclosure, and no provenance about us", () => {
    expect(pathsUnder("quotes")).toEqual(
      [
        "discarded",
        "discarded.malformed",
        "discarded.otherVoice",
        "discarded.overCap",
        "discarded.overlapping",
        "discarded.unfound",
        "discarded.wrongLength",
        "quotes",
        "quotes[].blockId",
        "quotes[].id",
        "quotes[].importance",
        "quotes[].reason",
        "quotes[].start",
        "quotes[].striking",
        "quotes[].text",
      ].sort(),
    );
  });

  it("hands the quote's words across unchanged — they are the article's own", () => {
    /* The one artefact whose payload IS the prose the visitor is reading, so a
       projection that altered it would be changing the article. */
    expect(built.quotes?.quotes[0]?.text).toBe(QUOTES.quotes[0]?.text);
  });

  it("carries a glossary entry's fields and never its lookup", () => {
    expect(pathsUnder("glossary")).toEqual(
      [
        "entries",
        "entries[].aliases",
        "entries[].background",
        "entries[].blocks",
        "entries[].centrality",
        "entries[].detail",
        "entries[].difficulty",
        "entries[].fromOutside",
        "entries[].gloss",
        "entries[].id",
        "entries[].kind",
        "entries[].name",
        "entries[].senseHere",
        "entries[].url",
      ].sort(),
    );
    /* Said twice on purpose: the key set above would also pass if `lookup` were
       renamed, and the owner's answer is the thing that must not travel. */
    expect(JSON.stringify(built.glossary)).not.toContain("What the owner asked the web");
    expect(JSON.stringify(built.glossary)).not.toContain("some-search-model");
    /* And the provenance the plan's table forbids. */
    for (const forbidden of ["profileHash", "passes", "generatedAt", "elapsedMs", "sourceHash"]) {
      expect(pathsUnder("glossary"), forbidden).not.toContain(forbidden);
    }
  });

  it("carries the ideas and none of their provenance", () => {
    expect(pathsUnder("ideas")).toEqual(
      [
        "ideas",
        "ideas[].analogy",
        "ideas[].id",
        "ideas[].name",
        "ideas[].occurrences",
        "ideas[].occurrences[].blockId",
        "ideas[].occurrences[].quote",
        "ideas[].occurrences[].reasoning",
        "ideas[].occurrences[].start",
        "ideas[].provenance",
        "ideas[].statement",
        "ideas[].whyYouNeedIt",
      ].sort(),
    );
  });

  it("carries the thread and the limit it was counted against", () => {
    expect(pathsUnder("tweets")).toEqual(["limit", "tweets", "tweets[].chars", "tweets[].text"].sort());
  });

  /**
   * **The events, and not the count of the model's own mistakes.**
   *
   * `orderConflicts` is the field to look for in this list and not find. It is
   * the number of pairs the article's own dates order one way and the model
   * ordered the other — a fact about our pipeline's quality, shown to nobody,
   * and src/public-types.ts § PublicTimeline argues it against
   * `PublicQuotes.discarded`, which *does* cross because a reader is shown it.
   */
  it("carries the events and none of the pipeline around them", () => {
    expect(pathsUnder("timeline")).toEqual(
      [
        "events",
        "events[].dating",
        "events[].dating.kind",
        "events[].dating.phrase",
        "events[].dating.when",
        "events[].dating.when.at",
        "events[].dating.when.at.blockId",
        "events[].dating.when.at.end",
        "events[].dating.when.at.start",
        "events[].dating.when.earliest",
        "events[].dating.when.extent",
        "events[].dating.when.latest",
        "events[].dating.when.phrase",
        "events[].dating.when.yearFilled",
        "events[].id",
        "events[].label",
        "events[].modality",
        "events[].occurrences",
        "events[].occurrences[].blockId",
        "events[].occurrences[].quote",
        "events[].occurrences[].start",
        "events[].order",
      ].sort(),
    );
  });

  /**
   * **And the artefacts are really there**, which every assertion above passes
   * without. A DTO returning `{}` for all four satisfies every key set and
   * every "does not contain", and it is the failure this repo keeps writing up:
   * a check agreeing with the code because both are empty.
   */
  it("still contains the artefacts, which is the point of the slice", () => {
    expect(built.glossary?.entries).toHaveLength(2);
    expect(built.glossary?.entries[0]?.name).toBe("Integrated information theory");
    expect(built.glossary?.entries[0]?.blocks).toEqual(["spya-k3m9qt"]);
    expect(built.ideas?.ideas[0]?.statement).toContain("no way to measure");
    expect(built.ideas?.ideas[0]?.occurrences[0]?.quote).toContain("first example");
    expect(built.tweets?.tweets[0]?.text).toBe("The first post.");
    expect(built.tweets?.limit).toBe(280);
    expect(built.timeline?.events).toHaveLength(2);
    expect(built.timeline?.events[0]?.label).toBe("The first example is offered");
    /* The second event's `words` dating, which is the arm a one-event fixture
       would not reach: the article dated it as far as it ever will, and losing
       the phrase would lose the only thing it said. */
    expect(built.timeline?.events[1]?.dating).toEqual({
      kind: "words",
      phrase: "another month later",
    });
  });

  /**
   * **An artefact nobody built is an absent key. An artefact that is empty is a
   * present one.**
   *
   * This is the distinction the whole client half rests on now that there is no
   * second request: *does this piece have a glossary* is answered by the
   * payload, and a stored `{entries: []}` means somebody ran the step and it
   * found nothing — a **ready but empty** artefact, which is a different
   * sentence from *nobody has built one yet*. A truthiness test on the document
   * agrees with `!== null` today and stops agreeing the moment an artefact can
   * be falsy while present; a length test on the entries collapses the two
   * outright.
   */
  it("tells an empty artefact from an absent one", () => {
    const empty = publicArticle({
      slug: "noema",
      title: "t",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl: null,
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
      assets: null,
      glossary: { ...GLOSSARY, entries: [] },
      ideas: { ...IDEAS, ideas: [] },
      quotes: null,
      tweets: null,
      timeline: null,
    });
    expect("glossary" in empty).toBe(true);
    expect(empty.glossary?.entries).toEqual([]);
    expect("ideas" in empty).toBe(true);
    expect(empty.ideas?.ideas).toEqual([]);
    expect("tweets" in empty).toBe(false);
  });

  it("leaves every artefact out when the row carried none", () => {
    const bare = publicArticle({
      slug: "noema",
      title: "t",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl: null,
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
    });
    for (const key of ["glossary", "ideas", "tweets"]) {
      expect(key in bare, key).toBe(false);
    }
  });
});

/**
 * **The source URL, published to whoever can read the article.**
 *
 * Greg, 2026-08-30: *"I think Public-readable articles should show their
 * provenance-url to all reader[s]."* `final_url` had been held out of the
 * public projection until then, so this is the whole of what changed on the
 * public path, and the policy that replaced the absence is `publicSourceUrl`
 * in src/urls.ts.
 *
 * Asserted **through the DTO** rather than against that function directly. The
 * function has its own unit tests; what nothing else can see is whether
 * `publicMeta` actually calls it — a projection that published `row.finalUrl`
 * raw would pass every test of the policy and leak every credential it refuses.
 * Same reason `tests/public-reads.test.ts` reads the generated SQL rather than
 * the projection object beside it.
 */
describe("the source URL a stranger receives", () => {
  /** One article, one `finalUrl`, and only the published `meta.url` back. */
  const published = (finalUrl: string | null): string | undefined =>
    publicArticle({
      slug: "noema",
      title: "The mythology of conscious AI",
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl,
      blocks: [HEADING, BLOCK],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
    }).meta.url;

  it("publishes an ordinary address", () => {
    expect(published("https://www.noemamag.com/the-mythology-of-conscious-ai/")).toBe(
      "https://www.noemamag.com/the-mythology-of-conscious-ai/",
    );
  });

  /**
   * **A query string is refused outright**, and this is the clause the first
   * draft of `publicSourceUrl` got wrong. Keeping it looked right — on a great
   * many sites `?id=123` *is* the article, and dropping it names a section index
   * — until the fixture in `tests/public-visibility-pg.test.ts` reminded us what
   * else a query holds: `?sig=…`, a capability the owner holds and very often
   * their own paywall bypass. From here an id, a `utm_` and a signature are the
   * same string, so refusing is the honest answer. Measured before it was
   * accepted: of the twenty articles in `data/` with a URL, none has a query.
   */
  it("refuses an address carrying a query, which may be a signature", () => {
    expect(published("https://example.com/read?id=123")).toBeUndefined();
    expect(published("https://example.com/piece?sig=SECRETSIGNATURE")).toBeUndefined();
  });

  it("drops the fragment, which is a scroll position and not a document", () => {
    expect(published("https://example.com/a#section-3")).toBe("https://example.com/a");
  });

  /**
   * The one thing publishing an essay does not imply. A share token in a query
   * grants access to the piece the visitor is already reading; a password in the
   * authority grants access to a *site*, and no decision to publish an article
   * covers that.
   */
  it("refuses an address carrying a credential", () => {
    expect(published("https://user:pw@example.com/a")).toBeUndefined();
    /* A password with an empty username is the same disclosure and a different
       URL field — `new URL` keeps them apart, so a check on `username` alone
       would pass this one straight through. */
    expect(published("https://:pw@example.com/a")).toBeUndefined();
  });

  it("refuses a scheme a browser would not follow", () => {
    expect(published("javascript:alert(1)")).toBeUndefined();
    expect(published("file:///Users/greg/Documents/thing.pdf")).toBeUndefined();
  });

  it("refuses a payload wearing an address as a disguise", () => {
    expect(published(`https://example.com/${"a".repeat(2100)}`)).toBeUndefined();
  });

  /**
   * **A host a stranger could not have reached anyway.**
   *
   * Stage 1 refuses to *fetch* a private destination and resolves the name to do
   * it (`guardAddress`, src/fetch.ts). The path that went around stage 1 and put
   * an unfetched `final_url` in the database was `src/store/import.ts`, and that
   * file was deleted on 2026-09-01 — so `http://10.0.0.5/token` reaching a row
   * is no longer a demonstrated path, only an unproven absence. This boundary is
   * what would hand one out if it did, and it is a pure shape test that costs
   * nothing. Raised by GPT Sol, 2026-08-30; the rule itself is `publishableHost`
   * in src/urls.ts.
   *
   * The rule is a shape rule, because a DTO has no DNS: any IP literal, any host
   * with no dot, and the three private suffixes. A public name pointing inward
   * is not caught and cannot be from here.
   */
  it("refuses a host nobody outside could reach", () => {
    expect(published("http://localhost/private")).toBeUndefined();
    expect(published("http://10.0.0.5/token")).toBeUndefined();
    expect(published("http://192.168.1.10/a")).toBeUndefined();
    expect(published("http://[::1]/a")).toBeUndefined();
    expect(published("http://build-box/a")).toBeUndefined();
    expect(published("http://printer.local/a")).toBeUndefined();
    /* A public IP literal goes too, and that is deliberate rather than an
       over-reach: enumerating the private ranges is a list that fails open when
       one is wrong, and nobody publishes an article addressed by bare IP. */
    expect(published("http://93.184.216.34/a")).toBeUndefined();
  });

  /**
   * **The absence, and the two different things behind it.** An uploaded article
   * has no address at all; a refused one has an address we will not publish. A
   * visitor is told the same nothing by both, and so may never conclude
   * "uploaded" from it — the gate on that sentence is in src/web/Masthead.tsx.
   */
  it("says nothing at all when there is nothing it may say", () => {
    expect(published(null)).toBeUndefined();
    expect(published("https://user:pw@example.com/a")).toBeUndefined();
  });
});
