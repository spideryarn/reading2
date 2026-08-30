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
 * ## Only two of these are exported, deliberately
 *
 * `publicMeta`, `publicBlock`, `publicTree`, `publicArc` and the four artefact
 * projections slice 1b added are the pieces `publicArticle` is built from, and
 * nothing outside this file assembles a public response by hand — which is the
 * property worth keeping. Slice 1b was expected to want some of them exported
 * for four sibling endpoints; Greg's decision that there are no sibling
 * endpoints means there is still nothing to export them to.
 *
 * ## What is NOT here
 *
 * `profileChanged`, on any artefact. It cannot even be computed on this path:
 * `withProfileChanged()` calls `resolveProfile(slug)`, which needs a reader and
 * therefore an owner, and on an ownerless request `currentOwnerId()` throws.
 * That is the right answer anyway — it is a property of an artefact against a
 * *person*, and there is no person here.
 */

import type { Assets } from "../assets.js";
import type {
  Arc,
  ArcEntry,
  Block,
  BlockKind,
  Glossary,
  Idea,
  Ideas,
  NodeId,
  SummaryEntry,
  Summaries,
  Tree,
  TreeNode,
  Tweet,
  TweetThread,
} from "../types.js";
import type {
  PublicArticle,
  PublicArtefacts,
  PublicBlock,
  PublicGlossary,
  PublicGlossaryEntry,
  PublicIdeas,
  PublicMeta,
  PublicMetadata,
  PublicSummaries,
  PublicTweets,
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
 * **Carry one optional field across, with the compiler checking its name.**
 *
 * Every field in this file is named on purpose, and until 2026-08-29 the idiom
 * for an optional one spread a fresh object literal into the result, naming the
 * key twice. That idiom has a hole, confirmed by GPT Sol's sixth review and
 * then measured:
 * spelling the key `treatmnt` inside the spread compiles **clean**. TypeScript's
 * excess-property check does not look at keys contributed through a spread, and
 * an outer `satisfies` on the whole object does not repair it. So the one
 * mistake this file cannot afford — a field that silently fails to cross — was
 * the one mistake the compiler would not catch. `publicTree` dropping
 * `treatment` reverted the entire footnotes feature for anyone following a
 * shared link, and that was an omission rather than a typo; a typo would have
 * looked identical and been harder to see.
 *
 * `K extends keyof T` closes it: the field name is a checked literal, so a typo
 * is a compile error, and it still reads at the call site as this file naming
 * the field deliberately, which is the property the whole design rests on. The
 * cast is for the computed key alone — `{ [key]: … }` widens to `string` — and
 * it is contained here rather than repeated twenty-two times.
 *
 * The output is byte-identical to the idiom it replaces: absent stays absent,
 * so no cached public payload changes shape. tests/public-dto.test.ts pins the
 * exact recursive key set.
 */
function opt<T, K extends keyof T>(source: T, key: K): Partial<Pick<T, K>> {
  return source[key] === undefined ? {} : ({ [key]: source[key] } as Partial<Pick<T, K>>);
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
    ...opt(block, "level"),
    text: block.text,
    words: block.words,
    html: block.html,
    gistable: block.gistable,
    ...opt(block, "role"),
    ...opt(block, "treatment"),
    ...opt(block, "noteId"),
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
      ...opt(node, "gist"),
      ...opt(node, "navLabel"),
      ...opt(node, "summary"),
      ...opt(node, "sourceHeading"),
      /* **`treatment` crosses, and that is a decision.** The safe default here
         is to drop an optional field, and this one was dropped until 2026-08-29
         — with the test below saying in as many words that whoever landed the
         footnotes lane had to come here and choose.
         It has to cross. Every consumer that tells the apparatus from the
         argument reads it off the *node*: the fisheye collapses forty endnotes
         into one "Notes" row, the spine dims it, outline and summary mode
         refuse to descend into it or number it, and the diagram leaves it out
         of the argument's picture. A public reader without it gets all of that
         back as it was — footnotes numbered as a part of the piece, one blank
         row per endnote, and "No summary for this section" on each. Measured
         through the real DTO: 1 part and 1 section for the owner, 2 and 2 for
         a visitor.
         Nothing about it is private. It says a node is apparatus rather than
         argument, which is structure exactly as `depth` and `title` are, and it
         is derived from the article's own markup rather than from anything the
         owner did. GPT Sol, fifth review. */
      ...opt(node, "treatment"),
    };
  }
  return {
    version: tree.version,
    generator: tree.generator,
    slug: tree.slug,
    rootId: tree.rootId,
    nodes,
    /* **`provisional` crosses, for the same reason `treatment` does.** It says
       the structure is a stand-in carved from the author's headings and has no
       gists yet (src/heading-tree.ts). A public reader without it gets a
       reading view that draws empty cells at every coarse zoom level and no way
       to tell that from an article whose gists are simply bad — the client
       branches on this to say the structure is still arriving. Nothing about it
       is private: it is a fact about which of our generators wrote the tree,
       which is exactly what `version` and `generator` above already say. */
    ...(tree.provisional ? { provisional: tree.provisional } : {}),
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

/**
 * The glossary, rebuilt entry by entry — **and `lookup` is not among the
 * fields.**
 *
 * This is the projection GPT Sol's design input named as the hazardous one, and
 * it is worth saying why in the file that does it rather than only in the plan.
 * `loadGlossary` on the owner's side attaches `glossary_lookups` to each entry
 * at the read seam, on purpose and with a comment saying why
 * ([pg.ts](../store/pg.ts)): a lookup is what came back when *that reader*
 * pressed "check the web", and it carries their requested answer, its
 * citations, how many searches it ran, which model answered and the exact
 * minute. Correct for the owner; somebody's private research here.
 *
 * Two things stop it, and neither is this function on its own. The public
 * reader selects the `glossary` column off `article_revisions` and joins
 * nothing, and tests/public-imports.test.ts refuses any public module that can
 * name the `glossary_lookups` table by import, by raw SQL or through Drizzle's
 * relational API. This is the third: even handed an entry that carried one, the
 * field is not copied.
 */
function publicGlossary(glossary: Glossary): PublicGlossary {
  return {
    entries: glossary.entries.map(
      (entry): PublicGlossaryEntry => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        aliases: [...entry.aliases],
        /* Conditional spreads throughout, because `exactOptionalPropertyTypes`
           is on and absent is a meaningful answer for most of these — an entry
           with no `background` is one the model did not claim to know about,
           which is visibly different from an invented one. */
        ...opt(entry, "senseHere"),
        ...opt(entry, "background"),
        ...opt(entry, "gloss"),
        ...opt(entry, "detail"),
        ...opt(entry, "url"),
        ...opt(entry, "difficulty"),
        ...opt(entry, "centrality"),
        ...opt(entry, "fromOutside"),
        blocks: [...entry.blocks],
      }),
    ),
  };
}

/**
 * The summaries — **and `guidance` is not among the fields.**
 *
 * That is the owner's free-text steer: what *they* asked these summaries to
 * lean towards. Sol's payload table put it in bold and the plan repeats it,
 * because it is the one field here that is a sentence somebody wrote about
 * themselves rather than about the article.
 *
 * The honest limit, stated where somebody might otherwise think this closed it:
 * the summary *text* is derived from the steer, so dropping the field stops
 * direct disclosure and cannot make the prose neutral. That is Greg's settled
 * stage-1 position — publish the artefact the owner has — and it is
 * docs/plans/public-read-only-access.md § The leak that no projection fixes.
 *
 * `missing` crosses: it is the reader's only sign that an apparently complete
 * ladder is partial.
 */
function publicSummaries(summaries: Summaries): PublicSummaries {
  return {
    entries: summaries.entries.map(
      (entry): SummaryEntry => ({
        range: [entry.range[0], entry.range[1]],
        depth: entry.depth,
        ...opt(entry, "short"),
        ...opt(entry, "long"),
      }),
    ),
    missing: summaries.missing,
  };
}

/** The ideas, rebuilt idea by idea and occurrence by occurrence. */
function publicIdeas(ideas: Ideas): PublicIdeas {
  return {
    ideas: ideas.ideas.map(
      (idea): Idea => ({
        id: idea.id,
        name: idea.name,
        provenance: idea.provenance,
        statement: idea.statement,
        ...opt(idea, "whyYouNeedIt"),
        ...opt(idea, "analogy"),
        occurrences: idea.occurrences.map((at) => ({
          blockId: at.blockId,
          quote: at.quote,
          reasoning: at.reasoning,
          ...opt(at, "start"),
        })),
      }),
    ),
  };
}

/** The thread, rebuilt post by post. `limit` crosses; the provenance does not. */
function publicTweets(thread: TweetThread): PublicTweets {
  return {
    limit: thread.limit,
    tweets: thread.tweets.map((tweet): Tweet => ({ text: tweet.text, chars: tweet.chars })),
  };
}

/**
 * `GET /api/public/article/:slug`, assembled.
 *
 * **The four artefacts are keys of this one response, and that is Greg's
 * decision rather than the design Sol gave.** Four sibling endpoints would each
 * have needed a route, a projection, a reader method, a client hook and a
 * tagged wire result saying whether the artefact exists; folding them in here
 * makes existence a property of the payload — a key that is present exists —
 * with no second request to be in flight, to fail, or to disagree with the
 * first. docs/plans/public-read-only-access.md § Slice 1b.
 *
 * `null` in, absent out. The reader hands `null` for a column Postgres had
 * nothing in, and an absent key is what the client reads as *nobody built one*.
 * An artefact that exists and is **empty** — a glossary whose step ran and
 * found no terms — is a present key holding an empty list, and the two must
 * stay different.
 */
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
  assets: Assets | null;
  glossary: Glossary | null;
  summary: Summaries | null;
  ideas: Ideas | null;
  tweets: TweetThread | null;
}): PublicArticle {
  return {
    meta: publicMeta(row),
    blocks: row.blocks.map(publicBlock),
    tree: publicTree(row.tree),
    ...(row.arc ? { arc: publicArc(row.arc) } : {}),
    /* **Named, not spread**, and passed through whole rather than rebuilt field
       by field like the tree and the arc beside it. Nothing in an `Assets` is
       about a person: the URLs are the publisher's own and are already in the
       `blocks` in this same payload, and the rest of each entry is a hash, a
       format, a byte count, or the reason an image was not stored.

       `?? undefined` rather than a conditional spread, because
       `PublicArticle.assets` is a required key holding `Assets | undefined` —
       which is what makes leaving this line out a type error instead of a
       public article that silently hot-links every image. See the field's note
       in src/public-types.ts. */
    assets: row.assets ?? undefined,
    /* `!== null` rather than truthiness, on all four. An artefact is an object
       and so always truthy, so the two agree today — but the day one of these
       becomes a value that can be falsy while present, truthiness silently
       reports it as never built. The distinction this payload rests on is
       present-versus-absent, and the test is written to say so. */
    ...(row.glossary !== null ? { glossary: publicGlossary(row.glossary) } : {}),
    ...(row.summary !== null ? { summary: publicSummaries(row.summary) } : {}),
    ...(row.ideas !== null ? { ideas: publicIdeas(row.ideas) } : {}),
    ...(row.tweets !== null ? { tweets: publicTweets(row.tweets) } : {}),
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
