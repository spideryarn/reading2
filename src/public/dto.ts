/**
 * **The allowlist, as code.** Every key a stranger receives is written out in
 * this file, once.
 *
 * The alternative — take today's response and delete the fields that look
 * private — was the first draft of docs/plans/public-read-only-access.md, and
 * GPT Sol refused it on 2026-08-27:
 *
 * > A recursive key denylist is insufficient: it misses innocently named fields
 * > such as `title`, `guidance`, `comments`, `generatedAt`, `lookup`, and future
 * > aliases such as `owner`, `createdBy`, or snake-case keys.
 *
 * A denylist has to be right about a set that grows; an allowlist has to be
 * right about a set that only changes when somebody edits this file. So the
 * functions below **construct** their results rather than filtering them, and
 * `tests/public-dto.test.ts` asserts their key sets recursively, including
 * inside `blocks` and inside every tree node.
 *
 * ## Why the reader also narrows its `select`
 *
 * Belt and braces, and the braces are the stronger half:
 * [public-reader.ts](../store/public-reader.ts) never fetches `note`,
 * `final_url`, `fetched_at` or the PDF provenance at all. A projection here is
 * one careless `...spread` away from being widened; a column that was never
 * selected has to be put back on purpose, in SQL, where a reviewer sees it.
 *
 * ## Four of these are not exported, deliberately
 *
 * `publicMeta`, `publicBlock`, `publicTree` and `publicArc` are the pieces
 * `publicArticle` is built from, and nothing outside this file assembles a
 * public response by hand — which is the property worth keeping. Slice 1b adds
 * four more endpoints and will want some of them; exporting one then, for a
 * caller that exists, is better than exporting four now for callers that do not.
 *
 * ## What is NOT here
 *
 * `profileChanged`, on any artefact. It cannot even be computed on this path:
 * `withProfileChanged()` calls `resolveProfile(slug)`, which needs a reader and
 * therefore an owner, and on an ownerless request `currentOwnerId()` throws.
 * That is the right answer anyway — it is a property of an artefact against a
 * *person*, and there is no person here.
 */

import type {
  Arc,
  ArcEntry,
  Block,
  BlockKind,
  NodeId,
  Tree,
  TreeNode,
} from "../types.js";
import type {
  PublicArticle,
  PublicArtefacts,
  PublicBlock,
  PublicMeta,
  PublicMetadata,
} from "../public-types.js";

/**
 * The masthead.
 *
 * **`titleFor()` is not called here and must never be.** Both stores run the
 * owner's meta through it so that the reading view's masthead calls a renamed
 * article what the shelf calls it — correct for the owner, and the owner's
 * private rename for everybody else. The reader does not even select
 * `articles.title_override`, so there is nothing here to run it on.
 *
 * The fallback that *is* kept is `metaFrom`'s: a stored title, then the
 * article's own first `<h1>`, then the slug. That one is about the article.
 */
function publicMeta(row: {
  slug: string;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  excerpt: string | null;
  headingTitle: string | null;
}): PublicMeta {
  return {
    slug: row.slug,
    title: row.title ?? row.headingTitle ?? row.slug,
    /* Conditional spreads throughout, because `exactOptionalPropertyTypes` is
       on: Postgres hands back `null` where the shape simply has no key, and
       `byline: undefined` is a different type from an absent `byline`. */
    ...(row.byline === null ? {} : { byline: row.byline }),
    ...(row.siteName === null ? {} : { siteName: row.siteName }),
    ...(row.lang === null ? {} : { lang: row.lang }),
    ...(row.excerpt === null ? {} : { excerpt: row.excerpt }),
  };
}

/**
 * One block, rebuilt.
 *
 * `note` is the field that must not cross, and it is gone twice over: the query
 * does not select it, and this function does not name it.
 */
function publicBlock(block: Block | PublicBlock): PublicBlock {
  return {
    id: block.id,
    tag: block.tag,
    kind: block.kind as BlockKind,
    ...(block.level === undefined ? {} : { level: block.level }),
    text: block.text,
    words: block.words,
    html: block.html,
    gistable: block.gistable,
    ...(block.role === undefined ? {} : { role: block.role }),
    ...(block.treatment === undefined ? {} : { treatment: block.treatment }),
    ...(block.noteId === undefined ? {} : { noteId: block.noteId }),
  };
}

/**
 * The tree, rebuilt node by node.
 *
 * **Still typed `Tree`, and that is the decision.** A public twin of the
 * granularity-zoom tree would fork the whole client — the ToC, the spine and
 * the zoom are one structure by design
 * (docs/project/granularity-zoom.md#the-tree) and the plan is explicit that
 * they must not become two. Nothing in a `TreeNode` is about a person: it is
 * the article's skeleton, its titles, and the one-sentence gists.
 *
 * So why rebuild it at all? Because *default-absent* is the property worth
 * having. A field added to `TreeNode` next month is not in a public response
 * until somebody adds a line here. If it is a **required** field, this function
 * stops compiling, which is the loud version; if it is optional, it is silently
 * dropped, which is the safe one.
 *
 * `version` and `generator` are named rather than dropped, deliberately: they
 * say which of our generators wrote the tree, which is provenance about us and
 * not about the owner, and the client reads `rootId` and `nodes` beside them.
 */
function publicTree(tree: Tree): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id as NodeId] = {
      id: node.id,
      depth: node.depth,
      parent: node.parent,
      children: [...node.children],
      range: [node.range[0], node.range[1]],
      title: node.title,
      ...(node.gist === undefined ? {} : { gist: node.gist }),
      ...(node.navLabel === undefined ? {} : { navLabel: node.navLabel }),
      ...(node.summary === undefined ? {} : { summary: node.summary }),
      ...(node.sourceHeading === undefined ? {} : { sourceHeading: node.sourceHeading }),
    };
  }
  return {
    version: tree.version,
    generator: tree.generator,
    slug: tree.slug,
    rootId: tree.rootId,
    nodes,
  };
}

/** The arc, rebuilt, for the same reason and by the same rule as the tree. */
function publicArc(arc: Arc): Arc {
  return {
    version: arc.version,
    generator: arc.generator,
    slug: arc.slug,
    entries: arc.entries.map(
      (entry): ArcEntry => ({ range: [entry.range[0], entry.range[1]], text: entry.text }),
    ),
  };
}

/** `GET /api/public/article/:slug`, assembled. */
export function publicArticle(row: {
  slug: string;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  excerpt: string | null;
  headingTitle: string | null;
  blocks: (Block | PublicBlock)[];
  tree: Tree;
  arc: Arc | null;
}): PublicArticle {
  return {
    meta: publicMeta(row),
    blocks: row.blocks.map(publicBlock),
    tree: publicTree(row.tree),
    ...(row.arc ? { arc: publicArc(row.arc) } : {}),
  };
}

/**
 * `GET /api/public/metadata/:slug`, assembled.
 *
 * Five booleans and a title. The owner's metadata page answers *which stage
 * ran, when, into which column, over how many bytes, and would we write it
 * again today*; none of that is a visitor's business, and `stages` in
 * particular is internal paths and column names. Sol asked for this shape by
 * name and the plan's payload table says the same.
 */
export function publicMetadata(row: {
  slug: string;
  title: string | null;
  headingTitle: string | null;
  available: PublicArtefacts;
}): PublicMetadata {
  return {
    slug: row.slug,
    title: row.title ?? row.headingTitle ?? row.slug,
    available: {
      arc: row.available.arc,
      tweets: row.available.tweets,
      glossary: row.available.glossary,
      summary: row.available.summary,
      ideas: row.available.ideas,
    },
  };
}
