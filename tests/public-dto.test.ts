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
  Citations,
  CitationRegistry,
  ClaimDebateRow,
  Debate,
  DirectDebateRow,
  Faq,
  SimpleSummary,
  Glossary,
  Ideas,
  Quotes,
  NodeId,
  Timeline,
  Skim,
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
  skim: null,
  faq: null,
  simpleSummary: null,
  citations: null,
  debate: null,
  /* Cross-references (plan 261001b): none built, and so nothing to be fresh. */
  crossrefs: null,
  crossrefsFresh: false,
  /* **An empty array, not `null`** — comments are not an artefact, so there is
     no "nobody built one" state for them to be in. src/public-types.ts
     § PublicArticle.comments. */
  comments: [],
  searches: [],
  sketch: null,
  /* **Not an artefact, and not a slice-1b column** — it is where this
     revision's paragraph nav labels are (src/types.ts § `NavLabelStatus`), and
     it sits here for the same reason the two arrays above do: `publicArticle`
     requires it, so a call site cannot forget it. `"ready"` is what every
     revision says today. */
  navLabelStatus: "ready",
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
  /* **It crosses**, and the note above about leaving a note is why this line
     says so. The question is drawn in Summary mode, and Summary mode is a
     public surface as much as a signed-in one — a visitor reading a shared
     article would otherwise get the panel without the half that sends them
     into the prose. SPIDERYARN-READING2-1V, src/types.ts § `TreeNode.question`. */
  question: "Why does the worked example cost the argument anything at all?",
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
 * Both stored URLs carry a query string on purpose: `url` is the manifest key
 * from the `<img src>`, while `from` is the preferred `<img srcset>` candidate
 * whose bytes it holds. Both originate in `blocks[].html`, which this DTO sends
 * unchanged in the same public payload. `blocks.json` spells an ampersand as
 * `&amp;` and `getAttribute` returns `&`; getting either spelling wrong is
 * invisible (src/assets.ts).
 */
const ASSETS: Assets = {
  version: "assets/2",
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
      from: "https://noemamag.imgix.net/a.jpg?fm=pjpg&w=1600&s=2d3e4f50",
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
        /* **An empty array is still a present key**, which is why it is in this
           list even though this fixture has no comments: `PublicArticle.comments`
           is required, and `[]` means *nobody wrote on it* rather than *this
           payload does not carry comments*. The nested paths are asserted
           separately, against a fixture that has some.
           docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */
        "comments",
        "assets",
        "assets.entries",
        "assets.entries[].at",
        "assets.entries[].bytes",
        "assets.entries[].contentType",
        "assets.entries[].ext",
        "assets.entries[].from",
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
        /* **Where this revision's paragraph nav labels are** — the enum and
           nothing else, no reason and no provider message. It crosses for the
           reason `tree.provisional` does: a client that cannot tell *still
           arriving* from *this article has none* draws a run of blank cells
           either way, and reports our unfinished work as the article's own
           shape. src/web/nav-labels.ts, and
           docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md § F8. */
        "navLabelStatus",
        /* The same "an empty array is still a present key" as `comments`
           above, and for the same reason: `PublicArticle.searches` is required.
           docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4. */
        "searches",
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
        /* **It crosses, decided here on purpose.** Summary mode is a public
           surface as much as a signed-in one, and a visitor following a shared
           link would otherwise get the panel without the half that sends them
           into the prose. SPIDERYARN-READING2-1V. */
        "tree.nodes.n1.question",
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
    version: "tweets/5",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    profileHash: "profile-of-a-person",
    limit: 280,
    /* **One post with `blocks` and one without**, since `tweets/5`
       (2026-09-29, plan 260929f) — so the allowlist below has to decide the
       field's fate, and the second post proves an absent list stays absent
       rather than crossing as `undefined` or `[]`. */
    tweets: [
      { text: "The first post.", chars: 15, blocks: ["spya-k3m9qt" as BlockId] },
      { text: "The second post.", chars: 16 },
    ],
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

  /**
   * **A stored route with every field set**, `profileHash` above all: it is who
   * the route was planned for, and an assertion about a route with a `null`
   * hash would pass a projection that spread the document. One stop carries a
   * `cue` and one does not (routes before `trajectory/5`), so `opt` is
   * exercised both ways. src/public-types.ts § `PublicSkim`.
   */
  const SKIM: Skim = {
    version: "trajectory/7",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    profileHash: "profile-of-a-person",
    stops: [
      { quoteId: "spya-quote1", depth: 1, role: null, cue: "Look for what the first example costs the claim." },
      { quoteId: "spya-quote2", depth: 2, role: "Names the trouble" },
    ],
    visible: [1, 2, 2],
    offered: 12,
    dropped: {
      collapsed: 1,
      unknownQuote: 2,
      duplicate: 0,
      sameBlock: 1,
      malformed: 0,
      badRole: 0,
      badCue: 1,
      overCap: 0,
    },
    generatedAt: "2026-09-29T10:00:00.000Z",
    elapsedMs: 12_000,
  };

  /**
   * **A stored FAQ with every field set**, `dropped` above all: the owner's
   * panel prints it and a visitor's must not be sent it. Plan 260929c stage 2.
   */
  const FAQ: Faq = {
    version: "faq/4",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    questions: [
      {
        id: "q-one",
        question: "What does the measurement have to carry?",
        passages: [{ blockId: "spya-bbbbbb" as BlockId, quote: "the measurement", start: 4 }],
        /* Scored, and one score zero: zero is a score, and a spread guarded
           by truthiness would drop it on the way out (plan 260929g, Sol F7). */
        difficulty: 0,
        centrality: 0.85,
      },
      {
        /* A question from before `faq/4`, with neither score: it must cross
           without growing an `undefined` key. */
        id: "q-two",
        question: "Why would a copy not do?",
        passages: [{ blockId: "spya-bbbbbb" as BlockId, quote: "a copy", start: 20 }],
      },
    ],
    dropped: { unknownIds: 1, unquoted: 2, tooLong: 0, duplicate: 0, unanchored: 3, overCap: 0, malformed: 0 },
    generatedAt: "2026-09-29T10:00:00.000Z",
    elapsedMs: 9_000,
  };

  /**
   * **A stored Simple with every field set** — the stamp above all: the
   * paragraphs cross, the pipeline's provenance does not. Plan 260930i.
   */
  const SIMPLE: SimpleSummary = {
    version: "simple/2",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    generatedAt: "2026-09-30T10:00:00.000Z",
    elapsedMs: 7_000,
    /* The owner's — it must not cross (plan 261001b). */
    profileHash: "0f1e2d3c4b5a6978",
    levels: {
      brief: [
        { text: "It asks what a measurement carries.", ids: ["spya-bbbbbb" as BlockId] },
        { text: "A copy would not do.", ids: ["spya-cccccc" as BlockId] },
      ],
      simple: [
        { text: "This essay asks what a measurement has to carry.", ids: ["spya-bbbbbb" as BlockId] },
        {
          text: "It matters because a copy would not do.",
          ids: ["spya-bbbbbb" as BlockId, "spya-cccccc" as BlockId],
        },
      ],
      fuller: [
        { text: "This essay asks what a measurement has to carry, and why.", ids: ["spya-bbbbbb" as BlockId] },
        { text: "It matters because a copy would not do.", ids: ["spya-cccccc" as BlockId] },
        { text: "Its key idea is that carrying is the whole of it.", ids: ["spya-bbbbbb" as BlockId] },
      ],
    },
    /* The fidelity guard's audit record (plan 261001i) — the owner's, not a visitor's. */
    check: {
      checker: "simple-check/1",
      requestedModel: "checker-model",
      levels: {
        brief: { result: "passed", attempts: 1, retriedAfterFlag: false, stored: 1 },
        simple: { result: "unchecked", attempts: 1, retriedAfterFlag: false, stored: 1, failure: "call" },
        fuller: {
          result: "flagged",
          attempts: 2,
          retriedAfterFlag: true,
          stored: 2,
          flags: [{ paragraph: 1, why: "checker-why-sentence" }],
        },
      },
    },
  };

  /**
   * **A stored Citations list with every field set, and three addresses** — a
   * clean DOI, one carrying a credential, and one on a private host. The two
   * bad links must be gone from the wire and their rows kept (plan 260929c
   * stage 3). `key` embeds the credentialled address too, and `found` is set on
   * a row the way the owner's read attaches it: neither may cross.
   */
  const CITATIONS: Citations = {
    version: "citations/4",
    generator: "some-model",
    slug: "noema",
    sourceHash: "abc123",
    citations: [
      {
        id: "w-clean",
        key: "doi:10.1/abc",
        title: "A clean work",
        authors: "Somebody",
        year: "2004",
        why: "The piece leans on it.",
        relevance: 0.9,
        influence: 0.7,
        reference: { blockId: "spya-bbbbbb" as BlockId, quote: "Somebody 2004", start: 0 },
        mentions: [{ blockId: "spya-bbbbbb" as BlockId, quote: "Somebody", start: 0 }],
        citedAt: ["spya-bbbbbb" as BlockId],
        firstCited: "spya-bbbbbb" as BlockId,
        citedInBody: true,
        url: "https://doi.org/10.1/abc",
        linkFrom: "doi",
        /* A found registry record, every field set (plan 261001a stage 5):
           public metadata about the public DOI, and it crosses field by field. */
        registry: {
          kind: "found",
          source: "crossref",
          title: "A clean work",
          authors: [{ family: "Somebody", given: "S." }],
          moreAuthors: 3,
          year: 2004,
          venue: "Journal of Works",
          ownerOnlySentinel: "citation registry extra must not cross",
        } as CitationRegistry & { ownerOnlySentinel: string },
        found: { host: "found.example", searches: 1, model: "m", at: "2026-09-29T10:00:00.000Z" },
        /* The owner's *Look it up* (plan 260929g R-6): every field set, each
           string a sentinel that must not reach the wire. */
        lookup: {
          state: "assessed",
          host: "lookup-host.example",
          searches: 1,
          model: "m",
          at: "2026-09-29T10:00:00.000Z",
          contextHash: "ctxhashsentinel0",
          evidenceHash: "evihashsentinel0",
          excerptWords: 310,
          verdict: { support: "supports", quote: "lookup support quote sentinel from the extract" },
          paperDoes: { says: "lookup paper does sentinel", quote: "lookup paper does quote sentinel from the extract" },
        },
        /* The owner's *Investigate* (plan 260930a): private, every string a
           sentinel that must not reach the wire. */
        investigation: {
          answer: "investigation answer sentinel",
          sources: [{ url: "https://investigated-source.example/x", title: "investigated source sentinel" }],
          extractsRead: 1,
          longestExtractWords: 42,
          matchedHost: "investigation-matched-host.example",
          searches: 1,
          searchesFrom: "server_tool_use_details",
          model: "m",
          at: "2026-09-30T10:00:00.000Z",
          contextHash: "invhashsentinel0",
          promptVersion: "citation-investigate/1",
          /* Plan 261001a stage 3: what was read of the paper is owner-only too. */
          paper: {
            state: "read",
            requestedUrl: "https://paper-requested-sentinel.example/p.pdf",
            finalUrl: "https://paper-final-sentinel.example/p.pdf",
            host: "paper-host-sentinel.example",
            words: 1234,
            sentWords: 567,
            chunks: ["c1"],
            matchedBy: "doi",
            evidenceSha: "9".repeat(64),
            selectionVersion: "paper-selection-sentinel",
            readAt: "2026-10-01T10:00:00.000Z",
            passages: [{ chunk: "c1", page: 1, text: "paper passage sentinel from the pdf", bears: "supports" }],
          },
        },
        /* The work's reference entry (plan 260930i) — owner-only until the
           public DTO names it, which is Greg's call on a defence. */
        entry: "entry sentinel from the reference list",
        /* Attached only by the owner's GET route. A non-vacuous sentinel for
           the public DTO's field-by-field omission (plan 260930b). */
        inSpideryarn: {
          slug: "private-match-spya-g8h9j2",
          whose: "yours",
          matchedBy: "doi",
          title: "private matched-title sentinel",
        },
      },
      {
        id: "w-cred",
        key: "url:https://user:pw@x.org/paper",
        title: "A credentialled work",
        why: "Cited once.",
        mentions: [],
        citedAt: [],
        firstCited: "spya-bbbbbb" as BlockId,
        citedInBody: false,
        url: "https://user:pw@x.org/paper",
        linkFrom: "article",
        /* A registry conflict is our verdict on the article's identifier and
           stays with the owner (plan 261001a stage 5). */
        registry: { kind: "conflict", source: "datacite" },
      },
      {
        id: "w-private",
        key: "url:http://192.168.0.1/paper",
        title: "A work on a private host",
        why: "Cited twice.",
        mentions: [],
        citedAt: [],
        firstCited: "spya-bbbbbb" as BlockId,
        citedInBody: false,
        url: "http://192.168.0.1/paper",
        linkFrom: "article",
      },
      {
        /* A `web` link is the owner's own *Find it*: dropped unjudged. */
        id: "w-web",
        key: "work:found|x|2001",
        title: "A work the owner found",
        why: "Background.",
        mentions: [],
        citedAt: [],
        firstCited: "spya-bbbbbb" as BlockId,
        citedInBody: false,
        url: "https://owners-find.example/paper",
        linkFrom: "web",
      },
    ],
    capped: true,
    generatedAt: "2026-09-29T10:00:00.000Z",
    elapsedMs: 30_000,
  };

  /**
   * Everything `publicArticle` needs that is not the thing under test, so the
   * comment cases below can name only their comments.
   */
  const ARTICLE_BASE = {
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
    navLabelStatus: "ready" as const,
    crossrefs: null,
    crossrefsFresh: false,
    /* **No `as const`.** It would freeze `blocks` into a readonly tuple, which
       `publicArticle` will not take — and vitest would never have said so,
       because it does not typecheck. `npm run typecheck` is the only thing that
       reads this. */
  };

  const built = publicArticle({
    ...ARTICLE_BASE,
    glossary: GLOSSARY,
    ideas: IDEAS,
    quotes: QUOTES,
    tweets: THREAD,
    timeline: TIMELINE,
    skim: SKIM,
    faq: FAQ,
    simpleSummary: SIMPLE,
    citations: CITATIONS,
    debate: null,
    comments: [],
    searches: [],
    sketch: null,
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
    /* `tweets[].blocks` since 2026-09-29: the ids of this public article's own
       blocks, which every other public artefact carries too, and what a
       visitor's Tweets band links each post back with (plan 260929f). */
    expect(pathsUnder("tweets")).toEqual(
      ["limit", "tweets", "tweets[].blocks", "tweets[].chars", "tweets[].text"].sort(),
    );
  });

  it("carries a post's blocks when it has them, and no key when it does not", () => {
    const [linked, unlinked] = built.tweets?.tweets ?? [];
    expect(linked?.blocks).toEqual(["spya-k3m9qt"]);
    /* A copy, not the stored array: a projection that handed the row's own
       list across would let a later mutation of one reach the other. */
    expect(linked?.blocks).not.toBe(THREAD.tweets[0]?.blocks);
    expect(unlinked && "blocks" in unlinked).toBe(false);
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
  /**
   * **The owner's comments, and the three fields of one that are not there.**
   *
   * `PublicComment` is where the argument lives for each absence. What this
   * pins is that the projection agrees with it — a `Comment` carries `status`,
   * `model`, `searches`, `error`, `threadId`, `updatedAt`, `criterionId` and
   * `valence`, and the fixture below sets **every one of them** so that a
   * projection which spread its argument would fail here rather than pass for
   * want of anything to leak.
   */
  it("carries a whole-paragraph bookmark with no anchor keys at all", () => {
    /* SPIDERYARN-READING2-37's gutter bookmark: no quote, no offset. It must
       cross with neither key rather than `undefined` ones — a key that is there
       and empty is a different shape to a visitor's client and to the
       structural comparisons. */
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      comments: [
        {
          id: "spya-cmt222",
          blockId: "spya-k3m9qt",
          createdAt: "2026-09-12T09:00:00.000Z",
          status: "none",
        },
      ],
    });
    expect(keyPaths(built.comments)).toEqual(["[].blockId", "[].createdAt", "[].id"].sort());
  });

  it("carries a comment's words and none of the machinery around them", () => {
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      comments: [
        {
          id: "spya-cmt111",
          blockId: "spya-k3m9qt",
          quote: "does not survive its own first example",
          start: 17,
          createdAt: "2026-09-01T09:00:00.000Z",
          body: "This is the bit I keep coming back to.",
          answer: "The example is offered as a measurement, which is the trouble.",
          citations: [{ url: "https://example.com/paper?id=7", title: "The paper" }],
          /* Everything below must not cross. Set, so that a spread would show. */
          status: "done",
          updatedAt: "2026-09-02T09:00:00.000Z",
          threadId: "spya-thr999",
          criterionId: "spya-crt2aa",
          valence: -50,
          searches: 3,
          model: "some-model",
          error: "a previous attempt failed",
        },
      ],
    });

    expect(keyPaths(built.comments)).toEqual(
      [
        "[].answer",
        "[].blockId",
        "[].citations",
        "[].citations[].title",
        "[].citations[].url",
        "[].createdAt",
        "[].id",
        "[].quote",
        "[].start",
        "[].body",
      ].sort(),
    );
    /* And not vacuously: the words really are there. */
    expect(built.comments[0]?.body).toContain("keep coming back to");
    expect(built.comments[0]?.answer).toContain("offered as a measurement");
    /* **The query string survives**, which is the deliberate half of
       `publicCitationUrl` — half the public web addresses its articles this
       way, and `safePublicCanonical` refusing them is a rule about canonicals
       rather than about citations. */
    expect(built.comments[0]?.citations?.[0]?.url).toBe("https://example.com/paper?id=7");
  });

  /**
   * **A citation that would hand out a secret, or name a host only this machine
   * can reach, is dropped** — and the ones beside it are kept.
   *
   * Both refusals are the ones GPT Sol named when it reviewed this stage.
   * Asserted one at a time rather than as "the list got shorter", so a failure
   * says which policy stopped working.
   */
  it("drops a citation carrying credentials, and one naming a private host", () => {
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      comments: [
        {
          id: "spya-cmt222",
          blockId: "spya-k3m9qt",
          quote: "does not survive",
          start: 17,
          createdAt: "2026-09-01T09:00:00.000Z",
          status: "done",
          answer: "Three sources.",
          citations: [
            { url: "https://good.example.com/a" },
            { url: "https://user:t0ken@example.com/secret" },
            { url: "http://localhost:5273/private" },
            { url: "http://10.0.0.5/internal" },
          ],
        },
      ],
    });

    expect(built.comments[0]?.citations?.map((c) => c.url)).toEqual([
      "https://good.example.com/a",
    ]);
  });

  /**
   * **Every citation refused means the key goes, not an empty array.**
   *
   * `citations: []` reads as *the model cited nothing*; an absent key reads as
   * *this comment has no citations*. After the policy has thrown all of them
   * away neither is quite true, and absent is the honest one — it is what a
   * comment that never had any looks like. src/public/dto.ts § publicCitations.
   */
  it("leaves the key off when nothing survives the policy", () => {
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      comments: [
        {
          id: "spya-cmt333",
          blockId: "spya-k3m9qt",
          quote: "does not survive",
          start: 17,
          createdAt: "2026-09-01T09:00:00.000Z",
          status: "done",
          citations: [{ url: "http://localhost/only" }],
        },
      ],
    });

    expect("citations" in (built.comments[0] ?? {})).toBe(false);
  });

  /**
   * **A saved search's question and its passages, and none of the run.**
   *
   * The twin of the comments case above, and the fixture does the same thing:
   * it sets **every** field a `SearchRun` can carry, so a projection that
   * spread its argument would leak here rather than pass for want of anything
   * to find.
   *
   * **`sourceHash` is the one to look for and not find.** It is selected by the
   * public read — the query needs it — and turns into `stale` before the DTO
   * sees it, which is the only place in this feature where a selected column is
   * deliberately not a promise about the wire. If it ever appears in this list,
   * the derivation has been replaced by a passthrough.
   */
  it("carries a saved search's question and passages, and not the run around them", () => {
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      searches: [
        {
          id: "spya-run23z",
          criterion: "anywhere the argument turns on a number",
          /* A quick run, so the one field that says what the numbers mean is
             seen crossing with a value its default would not give it. */
          kind: "quick",
          createdAt: "2026-09-02T09:00:00.000Z",
          stale: false,
          colour: 3,
          hits: [
            {
              blockId: "spya-k3m9qt",
              quote: "does not survive its own first example",
              confidence: 88,
              reasoning: "The example is the measurement being disputed.",
              start: 17,
            },
          ],
          /* Everything below must not cross. Set, so that a spread would show. */
          status: "done",
          model: "some-model",
          error: "a previous attempt failed",
          sourceHash: "0123456789abcdef",
        },
      ],
    });

    expect(keyPaths(built.searches)).toEqual(
      [
        "[].colour",
        "[].createdAt",
        "[].criterion",
        "[].hits",
        "[].hits[].blockId",
        "[].hits[].confidence",
        "[].hits[].quote",
        "[].hits[].reasoning",
        "[].hits[].start",
        "[].id",
        "[].kind",
        "[].stale",
      ].sort(),
    );
    /* Plan 261002e, F6: a quick run reaches a visitor labelled quick. */
    expect(built.searches[0]?.kind).toBe("quick");
    /* And not vacuously: the reader's own words really are there, and so is the
       passage they found. */
    expect(built.searches[0]?.criterion).toContain("turns on a number");
    expect(built.searches[0]?.hits[0]?.quote).toContain("first example");
    expect(built.searches[0]?.hits[0]?.confidence).toBe(88);
    /* The hash itself, named rather than left to the key set — this is the
       assertion somebody deleting the derivation would have to notice. */
    expect(JSON.stringify(built.searches)).not.toContain("0123456789abcdef");
  });

  /**
   * **`stale` crosses as the server worked it out**, either way.
   *
   * Both arms, because a derivation hardwired to `true` — which is what a
   * mistake in the fingerprint comparison produces, and it is the likely
   * mistake — passes any test that only ever asks about a stale run. The
   * server-side half of this is `tests/public-visibility-pg.test.ts`, against a
   * real article whose real blocks are hashed; this only pins that the DTO
   * carries the answer rather than inventing one.
   */
  it("passes staleness through in both directions", () => {
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      searches: [
        { id: "spya-run22z", criterion: "fresh", kind: "meaning", createdAt: "2026-09-02T09:00:00.000Z",
          status: "done", hits: [], stale: false },
        { id: "spya-run33z", criterion: "old", kind: "meaning", createdAt: "2026-09-02T09:00:00.000Z",
          status: "done", hits: [], stale: true },
      ],
    });

    expect(built.searches.map((r) => r.stale)).toEqual([false, true]);
  });

  /**
   * **An unpinned colour leaves the key off**, rather than crossing as `null`.
   *
   * `SearchRun.colour` absent means *whichever slot the hash gives it*
   * (src/web/hit-colours.ts), and `assignSlots` distinguishes that from a
   * chosen slot — so a `null` arriving in its place would be a third value at a
   * seam that has two. `opt()` is what keeps them apart; this is what says so.
   */
  it("leaves an unpinned colour off rather than sending a null", () => {
    const built = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      searches: [
        { id: "spya-run44z", criterion: "unpinned", kind: "meaning", createdAt: "2026-09-02T09:00:00.000Z",
          status: "done", hits: [], stale: false },
      ],
    });

    expect("colour" in (built.searches[0] ?? {})).toBe(false);
  });

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
   * **The route's stops and `offered`, and nothing else** — not who it was
   * planned for (`profileHash`), and not the pipeline's counts and timings.
   * Asserted twice: the key set would pass a renamed `profileHash`, and the
   * string search would not.
   */
  it("carries the route's stops and the offered count, and not who it was planned for", () => {
    expect(pathsUnder("skim")).toEqual(
      ["offered", "stops", "stops[].cue", "stops[].depth", "stops[].quoteId", "stops[].role"].sort(),
    );
    expect(built.skim).toEqual({
      stops: [
        { quoteId: "spya-quote1", depth: 1, role: null, cue: "Look for what the first example costs the claim." },
        { quoteId: "spya-quote2", depth: 2, role: "Names the trouble" },
      ],
      offered: 12,
    });
    /* The cue-less stop crosses with no `cue` key, not an `undefined` one. */
    expect("cue" in (built.skim?.stops[1] ?? {})).toBe(false);
    const json = JSON.stringify(built);
    expect(json).not.toContain("profileHash");
    expect(json).not.toContain("profile-of-a-person");
  });

  /** The questions and the article's passages, and not our checking's tally. */
  it("carries the faq's questions and passages, and not what checking dropped", () => {
    expect(pathsUnder("faq")).toEqual(
      [
        "questions",
        "questions[].centrality",
        "questions[].difficulty",
        "questions[].id",
        "questions[].passages",
        "questions[].passages[].blockId",
        "questions[].passages[].quote",
        "questions[].passages[].start",
        "questions[].question",
      ].sort(),
    );
    expect(built.faq).toEqual({ questions: FAQ.questions });
    expect(built.faq?.questions[0]).toMatchObject({ difficulty: 0, centrality: 0.85 });
    expect(Object.keys(built.faq?.questions[1] ?? {}).sort()).toEqual(["id", "passages", "question"]);
    expect(JSON.stringify(built.faq)).not.toContain("dropped");
  });

  /** Both levels' paragraphs and ids, and not the stamp or the owner's profile hash. Plans 260930i, 261001b. */
  it("carries Simple's paragraphs and their ids at every level, and not the stamp", () => {
    expect(pathsUnder("simpleSummary")).toEqual(
      [
        "levels",
        "levels.brief",
        "levels.brief[].ids",
        "levels.brief[].text",
        "levels.fuller",
        "levels.fuller[].ids",
        "levels.fuller[].text",
        "levels.simple",
        "levels.simple[].ids",
        "levels.simple[].text",
      ].sort(),
    );
    expect(built.simpleSummary).toEqual({ levels: SIMPLE.levels });
    const json = JSON.stringify(built.simpleSummary);
    for (const provenance of [
      "simple/2",
      "some-model",
      "abc123",
      "generatedAt",
      "elapsedMs",
      "profileHash",
      "0f1e2d3c4b5a6978",
      "simple-check/1",
      "checker-model",
      "checker-why-sentence",
    ]) {
      expect(json, provenance).not.toContain(provenance);
    }
  });

  it("does not publish a stored Simple artefact outside either level's contract", () => {
    const invalid = publicArticle({
      ...ARTICLE_BASE,
      ...NO_ARTEFACTS,
      simpleSummary: { ...SIMPLE, levels: { ...SIMPLE.levels, fuller: [] } },
    });
    expect("simpleSummary" in invalid).toBe(false);
  });

  it("does not publish a simple/1 row even when it has valid-looking levels", () => {
    const v1 = { ...SIMPLE, version: "simple/1", paragraphs: SIMPLE.levels.simple } as unknown as SimpleSummary;
    const invalid = publicArticle({ ...ARTICLE_BASE, ...NO_ARTEFACTS, simpleSummary: v1 });
    expect("simpleSummary" in invalid).toBe(false);
  });

  /**
   * **Each cited work minus `key` and `found`, and every address re-judged.**
   * Exact nested keys against a list with every field set, so a spread of the
   * work would show up as `key` and `found…` here.
   */
  it("carries each cited work without its key or the owner's finds", () => {
    expect(pathsUnder("citations")).toEqual(
      [
        "capped",
        "citations",
        "citations[].authors",
        "citations[].citedAt",
        "citations[].citedInBody",
        "citations[].firstCited",
        "citations[].id",
        "citations[].influence",
        "citations[].linkFrom",
        "citations[].mentions",
        "citations[].mentions[].blockId",
        "citations[].mentions[].quote",
        "citations[].mentions[].start",
        "citations[].reference",
        "citations[].reference.blockId",
        "citations[].reference.quote",
        "citations[].reference.start",
        "citations[].registry",
        "citations[].registry.authors",
        "citations[].registry.authors[].family",
        "citations[].registry.authors[].given",
        "citations[].registry.kind",
        "citations[].registry.moreAuthors",
        "citations[].registry.source",
        "citations[].registry.title",
        "citations[].registry.venue",
        "citations[].registry.year",
        "citations[].relevance",
        "citations[].title",
        "citations[].url",
        "citations[].why",
        "citations[].year",
      ].sort(),
    );
    const json = JSON.stringify(built.citations);
    expect(json).not.toContain("found.example");
    expect(json).not.toContain('"key"');
    expect(json).not.toContain("citation registry extra must not cross");
    /* A found registry record crosses; a conflict does not (plan 261001a stage 5). */
    expect(built.citations?.citations[0]?.registry?.kind).toBe("found");
    expect(built.citations?.citations.find((w) => w.id === "w-cred")?.registry).toBeUndefined();
    expect(json).not.toContain("conflict");
    expect(built.citations?.capped).toBe(true);
  });

  /**
   * **The owner's lookup never crosses** (plan 260929g R-6): the reading, its
   * quotes, its state, the page whose extract was read and the fingerprints
   * are all the owner's paid activity. Checked on the whole payload, not only
   * the citations key, so a lookup copied anywhere else would be caught too.
   */
  it("carries no part of a cited work's lookup, anywhere", () => {
    const json = JSON.stringify(built);
    for (const sentinel of [
      '"lookup"',
      "lookup-host.example",
      "ctxhashsentinel0",
      "evihashsentinel0",
      "lookup support quote sentinel",
      "lookup paper does sentinel",
      "lookup paper does quote sentinel",
      '"excerptWords"',
      '"verdict"',
    ]) {
      expect(json, sentinel).not.toContain(sentinel);
    }
    expect(built.citations?.citations.find((w) => w.id === "w-clean")).not.toHaveProperty("lookup");
  });

  /** **Nor does the owner's *Investigate*** (plan 260930a § The route, the store, the limits). */
  it("carries no part of a cited work's investigation, anywhere", () => {
    const json = JSON.stringify(built);
    for (const sentinel of [
      '"investigation"',
      "investigation answer sentinel",
      "investigated-source.example",
      "investigated source sentinel",
      "investigation-matched-host.example",
      "invhashsentinel0",
      '"extractsRead"',
      /* The paper itself (plan 261001a stage 3). */
      '"paper"',
      "paper-requested-sentinel.example",
      "paper-final-sentinel.example",
      "paper-host-sentinel.example",
      "paper-selection-sentinel",
      "paper passage sentinel from the pdf",
      '"sentWords"',
    ]) {
      expect(json, sentinel).not.toContain(sentinel);
    }
    expect(built.citations?.citations.find((w) => w.id === "w-clean")).not.toHaveProperty("investigation");
  });

  /**
   * **Nor a work's reference entry that is not its block's own text** — this
   * fixture's is the PDF case, read from a text layer the public page does not
   * show (plan 260930i, Sol F9). Since 2026-10-01 a block's own entry crosses
   * (plan 261001b); tests/public-dto-owner-only-fields.test.ts has both.
   */
  it("carries no cited work's reference entry, anywhere", () => {
    const json = JSON.stringify(built);
    expect(json).not.toContain("entry sentinel from the reference list");
    expect(built.citations?.citations.find((w) => w.id === "w-clean")).not.toHaveProperty("entry");
  });

  /** Nor the owner's read-time link to another article (plan 260930b). */
  it("carries no in-Spideryarn match, anywhere", () => {
    const json = JSON.stringify(built);
    expect(json).not.toContain('"inSpideryarn"');
    expect(json).not.toContain("private-match-spya-g8h9j2");
    expect(json).not.toContain("private matched-title sentinel");
    expect(built.citations?.citations.find((w) => w.id === "w-clean")).not.toHaveProperty("inSpideryarn");
  });

  /**
   * **A refused address takes the link off the row, not the row** — the
   * mutation-style case plan 260929c asks for. A credential and a private host
   * are both absent from the whole payload, and both rows survive with their
   * titles; so does the row whose `web` link was the owner's own find.
   */
  it("drops a credentialled or private-host link and keeps the row", () => {
    const json = JSON.stringify(built);
    expect(json).not.toContain("user:pw");
    expect(json).not.toContain("192.168.0.1");
    expect(json).not.toContain("owners-find.example");
    const byId = new Map((built.citations?.citations ?? []).map((w) => [w.id, w]));
    expect([...byId.keys()]).toEqual(["w-clean", "w-cred", "w-private", "w-web"]);
    expect(byId.get("w-clean")?.url).toBe("https://doi.org/10.1/abc");
    /* Even the source label must not reveal that the owner ran Find it. */
    expect(byId.get("w-web")?.linkFrom).toBe("search");
    for (const id of ["w-cred", "w-private", "w-web"]) {
      expect("url" in (byId.get(id) ?? {}), id).toBe(false);
      expect(byId.get(id)?.title, id).toBeTruthy();
    }
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
      navLabelStatus: "ready",
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
    for (const key of ["glossary", "ideas", "tweets", "skim", "faq", "simpleSummary", "citations", "debate"]) {
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

/**
 * **The Debate a shared link carries** — since 2026-09-29, plan 260929c stage
 * 4, by the contract 260905f § Security set. Its own block because two of its
 * cases need the article's own address set, and the artefact block above runs
 * with none.
 *
 * Three addresses, three places: the row's source (`publicCitationUrl`, a
 * refusal drops the row), a `linked` signal's address (the article's own, so
 * `publicSourceUrl`, a refusal takes the address off the signal), and the
 * row's words (a refused address in them drops the row). Every drop is counted
 * at the boundary.
 */
describe("the debate a shared link carries", () => {
  const TITLE = "The mythology of conscious AI";
  /** The article's own address with a credential in it — `publicMeta` leaves it off the masthead. */
  const CREDENTIALLED_SOURCE = "https://owner:hunter2@papers.example.org/piece";
  /** And on a private host, the other refusal. */
  const PRIVATE_SOURCE = "http://10.1.2.3/piece";

  const counts = {
    returnedSources: 9,
    reportedRows: 7,
    keptRows: 3,
    omittedOverCap: 1,
    lost: {
      uncited: 1,
      selfSource: 0,
      unverifiedSource: 1,
      directnessUnverified: 1,
      sourceIsCopy: 0,
      claimNotInBlock: 0,
      unknownBlockId: 0,
      malformed: 0,
    },
    webSearches: 12,
  };

  /** A registry record with every field set (plan 261001a stage 6) — public metadata, so it crosses. */
  const REGISTRY = {
    source: "datacite" as const,
    title: "A reply",
    authors: [{ family: "Reply", given: "A." }, { family: "Consortium" }],
    moreAuthors: 2,
    year: 2021,
    venue: "Zenodo",
    ownerOnlySentinel: "debate registry extra must not cross",
  };

  /** A direct row with every field set, and all three kinds of evidence. */
  function directRow(over: Partial<DirectDebateRow> = {}): DirectDebateRow {
    return {
      id: "spya-dr0001",
      url: "https://reply.example.org/a-reply",
      title: "A reply",
      sourceQuote: "The measure cannot be computed.",
      relation: "disputes",
      lean: "leans-against",
      applies: "It argues the measure is not computable.",
      limits: "It does not address the second half.",
      registry: REGISTRY,
      articleReferenceQuote: `in "${TITLE}"`,
      identifies: [
        { kind: "linked", url: "https://www.noemamag.com/the-mythology-of-conscious-ai/" },
        { kind: "quoted", quote: "the measurement", blockId: "spya-bbbbbb" as BlockId, coverage: 0.3, density: 0.2 },
        { kind: "named", by: "title", witness: TITLE },
      ],
      ...over,
    };
  }

  /** A claim row with every field set. */
  function claimRow(over: Partial<ClaimDebateRow> = {}): ClaimDebateRow {
    return {
      id: "spya-cr0001",
      url: "https://answers.example.org/on-claims",
      title: "An answer",
      sourceQuote: "Somebody answers what it claims.",
      relation: "qualifies",
      lean: "neither",
      applies: "It narrows the claim.",
      limits: "Only for mammals.",
      registry: REGISTRY,
      claimQuote: "the measurement",
      blockId: "spya-bbbbbb" as BlockId,
      ...over,
    };
  }

  function debateOf(direct: DirectDebateRow[], claims: ClaimDebateRow[]): Debate {
    return {
      version: "debate/9",
      generator: "some-model",
      slug: "noema",
      sourceHash: "abc123",
      searchedAt: "2026-09-20T10:00:00.000Z",
      direct: { rows: direct, counts },
      claims: { rows: claims, counts },
      elapsedMs: 31_000,
    };
  }

  function publish(debate: Debate, finalUrl: string | null = "https://www.noemamag.com/the-mythology-of-conscious-ai/") {
    return publicArticle({
      slug: "noema",
      title: TITLE,
      byline: null,
      siteName: null,
      lang: null,
      excerpt: null,
      headingTitle: null,
      finalUrl,
      blocks: [BLOCK],
      tree: TREE,
      arc: null,
      assets: null,
      ...NO_ARTEFACTS,
      debate,
    });
  }

  /**
   * **Exact nested keys against an over-full input.** Every stored field set,
   * plus provenance and the stored counts: a spread anywhere would show up
   * here as `version`, `counts…` or `webSearches`.
   */
  it("carries rows, signals and searchedAt, and none of the provenance or stored counts", () => {
    const built = publish(debateOf([directRow()], [claimRow()]));
    expect(keyPaths(built.debate)).toEqual(
      [
        "searchedAt",
        "direct",
        "direct.rows",
        "direct.rows[].id",
        "direct.rows[].url",
        "direct.rows[].title",
        "direct.rows[].sourceQuote",
        "direct.rows[].relation",
        "direct.rows[].lean",
        "direct.rows[].applies",
        "direct.rows[].limits",
        "direct.rows[].registry",
        "direct.rows[].registry.source",
        "direct.rows[].registry.title",
        "direct.rows[].registry.authors",
        "direct.rows[].registry.authors[].family",
        "direct.rows[].registry.authors[].given",
        "direct.rows[].registry.moreAuthors",
        "direct.rows[].registry.year",
        "direct.rows[].registry.venue",
        "direct.rows[].articleReferenceQuote",
        "direct.rows[].identifies",
        "direct.rows[].identifies[].kind",
        "direct.rows[].identifies[].url",
        "direct.rows[].identifies[].quote",
        "direct.rows[].identifies[].blockId",
        "direct.rows[].identifies[].coverage",
        "direct.rows[].identifies[].density",
        "direct.rows[].identifies[].by",
        "direct.rows[].identifies[].witness",
        "direct.sourceNotPublishable",
        "claims",
        "claims.rows",
        "claims.rows[].id",
        "claims.rows[].url",
        "claims.rows[].title",
        "claims.rows[].sourceQuote",
        "claims.rows[].relation",
        "claims.rows[].lean",
        "claims.rows[].applies",
        "claims.rows[].limits",
        "claims.rows[].registry",
        "claims.rows[].registry.source",
        "claims.rows[].registry.title",
        "claims.rows[].registry.authors",
        "claims.rows[].registry.authors[].family",
        "claims.rows[].registry.authors[].given",
        "claims.rows[].registry.moreAuthors",
        "claims.rows[].registry.year",
        "claims.rows[].registry.venue",
        "claims.rows[].claimQuote",
        "claims.rows[].blockId",
        "claims.sourceNotPublishable",
      ].sort(),
    );
    expect(built.debate?.searchedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(built.debate?.direct.sourceNotPublishable).toBe(0);
    expect(built.debate?.claims.sourceNotPublishable).toBe(0);
    expect(JSON.stringify(built.debate)).not.toContain("debate registry extra must not cross");
    /* A clean article address on a linked signal crosses as itself. */
    expect(built.debate?.direct.rows[0]?.identifies[0]).toEqual({
      kind: "linked",
      url: "https://www.noemamag.com/the-mythology-of-conscious-ai/",
    });
  });

  /**
   * **A refused source drops the whole row, and the loss is counted** — the
   * 260905f mutation: a credentialled and a private-host source in each group.
   * The rows vanish, each group's count says exactly how many, the addresses
   * appear nowhere in the payload, and the owner's stored counts are untouched.
   */
  it("drops a row whose source is credentialled or private, and counts it", () => {
    const debate = debateOf(
      [
        directRow(),
        directRow({ id: "spya-dr0002", url: "https://reader:swordfish@x.org/reply" }),
        directRow({ id: "spya-dr0003", url: "http://192.168.0.7/reply" }),
      ],
      [claimRow(), claimRow({ id: "spya-cr0002", url: "http://intranet/answer" })],
    );
    const before = structuredClone(debate);
    const built = publish(debate);
    expect(built.debate?.direct.rows.map((r) => r.id)).toEqual(["spya-dr0001"]);
    expect(built.debate?.direct.sourceNotPublishable).toBe(2);
    expect(built.debate?.claims.rows.map((r) => r.id)).toEqual(["spya-cr0001"]);
    expect(built.debate?.claims.sourceNotPublishable).toBe(1);
    const json = JSON.stringify(built);
    for (const leak of ["swordfish", "192.168.0.7", "intranet/answer"]) expect(json, leak).not.toContain(leak);
    expect(debate, "the owner's artefact and its counts are untouched").toEqual(before);
  });

  /**
   * **The nested places — GPT Sol's P0 on the plan.** A direct row's `linked`
   * signal is the article's *own* address, and its witness can quote it. With
   * the article's address refused (a credential; then a private host):
   *
   * - a row whose witness quotes it is dropped and counted;
   * - a row whose witness does not keeps its place, and its `linked` signal
   *   crosses without the address;
   * - a claim row whose quotation carries it is dropped too;
   *
   * and the address is nowhere in the payload — the masthead included.
   */
  it.each([
    ["a credential", CREDENTIALLED_SOURCE, "hunter2"],
    ["a private host", PRIVATE_SOURCE, "10.1.2.3"],
  ])("never publishes the article's own address with %s, however it is nested", (_, source, needle) => {
    const built = publish(
      debateOf(
        [
          directRow({
            id: "spya-dr0010",
            articleReferenceQuote: `see ${source} for the piece`,
            identifies: [{ kind: "linked", url: source }],
          }),
          directRow({
            id: "spya-dr0011",
            identifies: [
              { kind: "linked", url: source },
              { kind: "named", by: "title", witness: TITLE },
            ],
          }),
        ],
        [
          claimRow(),
          claimRow({ id: "spya-cr0010", sourceQuote: `As ${source.replace(/^https?:\/\//, "")} argues` }),
        ],
      ),
      source,
    );
    expect(built.debate?.direct.rows.map((r) => r.id)).toEqual(["spya-dr0011"]);
    expect(built.debate?.direct.sourceNotPublishable).toBe(1);
    expect(built.debate?.direct.rows[0]?.identifies).toEqual([
      { kind: "linked" },
      { kind: "named", by: "title", witness: TITLE },
    ]);
    expect(built.debate?.claims.rows.map((r) => r.id)).toEqual(["spya-cr0001"]);
    expect(built.debate?.claims.sourceNotPublishable).toBe(1);
    expect(JSON.stringify(built)).not.toContain(needle);
  });

  /**
   * **A linked address refused on its own**, with the masthead's address
   * clean: the page spelled the article's address with a query on it — which
   * `publicCitationUrl` would pass and `publicSourceUrl`, the article's own
   * policy, does not. The signal loses it; a witness quoting it loses the row.
   */
  it("judges a linked address by the article's own policy, not the citation one", () => {
    const signed = "https://www.noemamag.com/the-mythology-of-conscious-ai/?token=OWNERSECRET";
    const built = publish(
      debateOf(
        [
          directRow({ id: "spya-dr0020", identifies: [{ kind: "linked", url: signed }] }),
          directRow({ id: "spya-dr0021", articleReferenceQuote: signed, identifies: [{ kind: "linked", url: signed }] }),
        ],
        [],
      ),
    );
    expect(built.debate?.direct.rows.map((r) => r.id)).toEqual(["spya-dr0020"]);
    expect(built.debate?.direct.rows[0]?.identifies).toEqual([{ kind: "linked" }]);
    expect(built.debate?.direct.sourceNotPublishable).toBe(1);
    expect(JSON.stringify(built)).not.toContain("OWNERSECRET");
  });

  it("drops a row whose source is the article's refused own address", () => {
    const signed = "https://www.noemamag.com/the-mythology-of-conscious-ai/?token=OWNERSECRET";
    const built = publish(
      debateOf(
        [directRow({ id: "spya-dr0022", url: signed })],
        [claimRow({ id: "spya-cr0022", url: signed })],
      ),
      signed,
    );
    expect(built.debate?.direct.rows).toEqual([]);
    expect(built.debate?.direct.sourceNotPublishable).toBe(1);
    expect(built.debate?.claims.rows).toEqual([]);
    expect(built.debate?.claims.sourceNotPublishable).toBe(1);
    expect(JSON.stringify(built)).not.toContain("OWNERSECRET");
  });

  it("drops a row whose words contain a percent-encoded refused address", () => {
    const signed = "https://www.noemamag.com/the-mythology-of-conscious-ai/?token=OWNERSECRET";
    const built = publish(
      debateOf(
        [directRow({ id: "spya-dr0023", articleReferenceQuote: encodeURIComponent(signed) })],
        [claimRow({ id: "spya-cr0023", sourceQuote: encodeURIComponent(signed) })],
      ),
      signed,
    );
    expect(built.debate?.direct.rows).toEqual([]);
    expect(built.debate?.direct.sourceNotPublishable).toBe(1);
    expect(built.debate?.claims.rows).toEqual([]);
    expect(built.debate?.claims.sourceNotPublishable).toBe(1);
    expect(JSON.stringify(built)).not.toContain("OWNERSECRET");
  });

  /**
   * **A legacy row crosses in today's vocabulary.** Stored before 2026-09-08 it
   * has `valence` and no `lean`; before 2026-09-06, no `identifies`. The public
   * row carries `lean` only, and a named signal on the witness.
   */
  it("reads a legacy row's lean and evidence, and carries neither old field", () => {
    const legacy = {
      ...directRow({ id: "spya-dr0030" }),
      lean: undefined,
      valence: "positive",
      identifies: undefined,
    } as unknown as DirectDebateRow;
    const legacyClaim = { ...claimRow({ id: "spya-cr0030" }), lean: undefined, valence: "negative" } as unknown as ClaimDebateRow;
    const built = publish(debateOf([legacy], [legacyClaim]));
    const row = built.debate?.direct.rows[0];
    expect(row?.lean).toBe("leans-for");
    expect(row?.identifies).toEqual([{ kind: "named", by: "title", witness: `in "${TITLE}"` }]);
    expect(built.debate?.claims.rows[0]?.lean).toBe("leans-against");
    expect(JSON.stringify(built.debate)).not.toContain("valence");
  });

  it("carries no debate key when nobody searched", () => {
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
    expect("debate" in bare).toBe(false);
  });
});
