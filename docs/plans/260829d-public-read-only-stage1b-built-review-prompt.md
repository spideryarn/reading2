# Review the built slice 1b — a public visitor gets the other four artefacts

You reviewed the *plan* for this slice on 2026-08-28 and returned a design. This is the
**code review of what was built**, which is the review that matters more: a plan-stage review cannot
find a `PATCH` that writes one field and then rejects the request.

## What the feature is

Spideryarn is a reading app. An owner can mark an article `public`, and then anyone with the link —
signed out, or signed in as somebody else — reads it. Slice 1a shipped the article itself: prose,
blocks, tree, arc. **Slice 1b, the code below, adds the other four artefacts** a visitor was still
being denied: glossary, summaries, ideas, tweets.

The article is fetched from a closed `/api/public/` namespace that is dispatched inside `handleApi`'s
`try` **before** `requireUser`, so no public path can see a session. Every public query goes through
`publicSlug(slug)` = `and(eq(articles.slug, slug), eq(articles.visibility, "public"))`, which lives in
its own leaf file so that the public import graph never reaches `currentOwnerId`.

## Four decisions are settled. Do not re-litigate them.

You proposed a good design and Greg overruled most of it. That was a product call, made with the
tradeoffs in front of him. **Reviewing the design you were overruled on is wasted effort**; review
the code that exists.

| Your design | What was built | Who decided |
|---|---|---|
| Four sibling endpoints (`/api/public/glossary/:slug` etc.) | **Zero new endpoints.** The four artefacts ride on the existing article payload. | Greg |
| `PublicArtefactRead<T>` — a four-state wire result tagged `loading` / `ready` / `not-generated` / `unavailable` | **A key that is present exists; a key that is absent was never built.** With no request there is no loading and no unavailable. | falls out of Greg's call |
| A `personalised: boolean` on the payload | Left out. | Greg |
| Show who the owner is | Deferred to a later stage. | Greg |
| Carry `stale` / `outdated` through to the visitor | **Dropped.** `isStale` is imported by `src/store/pg.ts` from writer modules that the closed-import guard forbids the public graph from reaching, so carrying it would have punched a hole in the guard to render a caveat nobody asked for. | me, verified against the guard |

The one consequence worth stating, because it is the cost of Greg's call: the summaries artefact is
**~37KB** on a typical article and now rides on every visitor's first paint whether or not they open
the summaries band. Glossary is 2.5–12KB. That was measured, and Greg accepted it against the saved
round trip. **Do not report the payload size as a finding**; do report it if you find the code makes
it *worse* than that — an artefact serialised twice, a field carried that nothing reads.

## What I want from you

Ranked findings, most serious first, each with the file and line and a concrete failure — inputs or
state, and the wrong output that results. I will check every one myself, so a precise wrong finding
costs me less than a vague right one.

Look hardest at these, in this order.

1. **Does any byte a visitor should not see reach a visitor?** The DTOs in `src/public/dto.ts` are
   meant to **construct** rather than filter — an allowlist by projection, so a new field added to an
   internal type is absent by default rather than leaked by default. Check every one. `Block.note` is
   an editorial note the owner writes and a visitor must never receive; there is a canary test for it.
   Are there fields on the four new artefact types that carry the owner's prompts, model names,
   costs, timings, steers, or anything about the generation run rather than its result?
2. **Is the closed import graph still closed?** `tests/public-imports.test.ts` guards four tables
   (`articles`, `articleRevisions`, `revisionBlocks`, `blockIdentities`) against three access routes:
   import binding, raw SQL naming `spideryarn.<snake_case>`, and the Drizzle relational API
   (`.query.<table>`). Did this slice add a fifth route, a new table, or an import that the guard's
   three patterns do not match?
3. **The client seam.** `ReaderCapability` is a discriminated union because hooks cannot be called
   conditionally — the whole point is that the `visitor` arm has **no `comments` field to be empty**,
   so there is nothing for a later edit to read. Did the panel `Props` split in the fourth commit
   preserve that property, or did it reintroduce a shape where a visitor is passed owner machinery
   set to null? Can any authenticated endpoint still be reached from a visitor's page — on mount, on
   a band opening, on a retry, or from an effect that fires before the capability is known?
4. **Presence, not truthiness, not length.** A stored `{entries: []}` is a *ready but empty*
   artefact: somebody ran the step and it found no terms. That is a different sentence from *nobody
   built one*, and the reader gets `builtButEmpty(noun)` rather than `notBuiltYet(noun)`. Find every
   place that collapses the two — a `?.length`, a truthiness test, a `??` that substitutes a default
   for an absent key.
5. **The tests.** Would each of them go red? I am specifically worried about tests that pass for a
   reason other than the one claimed: a `Required<T>` fixture assigned through a named const (which
   skips excess-property checking), a mutation control whose two fixtures are identical so the guard
   it targets can be deleted without the test noticing, a negative assertion whose needle is longer
   than the string that would actually appear. Name any test that would survive deletion of the code
   it is supposed to be testing.
6. **The band hooks.** `useIdeasMode`, `useGlossaryMode` and `useSummaryMode` were extracted so the
   owner's loader-fed path and the visitor's payload-fed path run the same code rather than two
   copies that agree today. Do they actually agree — same memo dependencies, same ordering, same
   null handling — or did the extraction change behaviour for the owner?

Also flag anything you would not ship, unprompted, outside those six.

## The plan document

`docs/plans/260827ai-public-read-only-access.md` is in the repo and is the record of intent for the whole
feature. The sections that bear on this slice are "Slice 1b — the rest of what the owner already
has", and under Progress: "Slice 1b, the server half", "The client half of 1b", and the two on why
`npm run typecheck` could not tell that a commit was incomplete.

## The diff

Four commits, in order. The plan document's own diff is excluded — it is prose, and it is long.

- `31bca53` the server half: the DTOs, the types, the reader query, three test files
- `2f8439d` `src/web/public-artefacts.ts`, landed alone as a leaf
- `113ce17` the client half: the second request deleted, the capability union, the messages
- `1ace072` the five panel files and `tree.ts` that `113ce17` should have brought with it

```diff
COMMIT 31bca53 A visitor gets the other four artefacts, and the gate cannot see an incomplete commit

diff --git a/src/public-types.ts b/src/public-types.ts
index 33b239a..3b9dffa 100644
--- a/src/public-types.ts
+++ b/src/public-types.ts
@@ -49,7 +49,16 @@
  * it.
  */
 
-import type { Arc, BlockId, BlockKind, Tree } from "./types.js";
+import type {
+  Arc,
+  BlockId,
+  BlockKind,
+  GlossaryKind,
+  Idea,
+  SummaryEntry,
+  Tree,
+  Tweet,
+} from "./types.js";
 
 /**
  * The masthead, for somebody who is not the owner.
@@ -116,13 +125,143 @@ export interface PublicBlock {
  * them into public twins would fork the whole granularity-zoom client for no
  * field's sake.
  */
-export interface PublicArticle {
+export interface PublicArticle extends PublicArtefactSet {
   meta: PublicMeta;
   blocks: PublicBlock[];
   tree: Tree;
   arc?: Arc;
 }
 
+/**
+ * **The four artefacts a shared link carries, and the one rule about them:
+ * a key that is present exists, and a key that is absent was never built.**
+ *
+ * Slice 1b, and the shape is Greg's decision of 2026-08-28 over GPT Sol's
+ * design. Sol specified four new endpoints, a tagged `{status: "ready" |
+ * "not-generated"}` wire result and a four-state client read union. All four of
+ * these are JSONB columns on the same `article_revisions` row
+ * `GET /api/public/article/:slug` already fetches, so folding them into that one
+ * payload removes the second request, the twelve wire states it could be in, and
+ * every way the two answers could disagree. docs/plans/260827ai-public-read-only-access.md
+ * § Slice 1b.
+ *
+ * **Absent is the only "no".** Not `null`, not an empty object, not a tagged
+ * `not-generated` — because the client's question is *does this piece have a
+ * glossary*, and a stored `{entries: []}` is a **ready but empty** artefact
+ * rather than a missing one. Somebody ran the step and it found nothing, which
+ * is a different sentence from nobody having run it. A truthiness or a length
+ * test here would collapse the two.
+ *
+ * ## What is not here, and it is the most important paragraph in this file
+ *
+ * **No `stale`, no `outdated`.** Both are computed by `isStale` in
+ * `src/glossary.ts`, `src/summarise.ts`, `src/tweets.ts` and `src/ideas.ts` —
+ * the writer modules, which tests/public-imports.test.ts forbids the public
+ * graph from reaching because they pull in the model machinery. Carrying them
+ * would mean extracting four freshness functions into import-free leaves across
+ * four writer modules. And a visitor could not act on either: both mean *the
+ * owner might want to regenerate this*, and the owner is the only person who
+ * can.
+ *
+ * **No `profileHash`, no `profileChanged`, no `personalised`.** The first is
+ * provenance about a person; the second cannot be computed without a reader at
+ * all; the third was put to Greg on 2026-08-28 and deferred — one field and one
+ * sentence, addable any time.
+ *
+ * **No `guidance` on the summaries**, which is the owner's free-text steer and
+ * the single most private thing in any of these four artefacts.
+ *
+ * **No `entry.lookup` on a glossary entry.** A lookup is the owner's requested
+ * answer, its citations, its search count, its model and its exact time — and
+ * the Postgres read seam attaches them to the glossary deliberately, which is
+ * correct for the owner and is the leak this projection exists to stop.
+ * `glossary_lookups` stays unreachable from the public graph, and the
+ * four-table guard in tests/public-imports.test.ts is what makes that a fact
+ * rather than an intention.
+ *
+ * **No generator, version, slug, sourceHash, passes, generatedAt or elapsedMs**
+ * on any of the four. Facts about our pipeline and its timings.
+ */
+export interface PublicArtefactSet {
+  glossary?: PublicGlossary;
+  summary?: PublicSummaries;
+  ideas?: PublicIdeas;
+  tweets?: PublicTweets;
+}
+
+/**
+ * One glossary entry, minus the reader's lookup.
+ *
+ * Structurally assignable to `GlossaryEntry`, exactly as `PublicBlock` is to
+ * `Block` and for the same reason: the glossary panel is one panel, and a
+ * visitor's entry has to render through the same component. What differs is
+ * what was fetched, not how it is drawn.
+ *
+ * **The id crosses**, and it has to: `?term=` links, the prose underlines and
+ * entry-to-block navigation all need a stable identity, and a client left to
+ * invent one would invent an unstable one. Carrying an id does not carry a
+ * lookup — nothing public can reach the table lookups live in.
+ *
+ * **`gloss`, `detail` and `fromOutside` cross although all three were
+ * superseded on 2026-08-26**, because artefacts written before that date still
+ * carry them and the panel still renders them. Dropping them here would make
+ * older shared articles render as entries with nothing in them.
+ */
+export interface PublicGlossaryEntry {
+  id: string;
+  name: string;
+  kind: GlossaryKind;
+  aliases: string[];
+  senseHere?: string;
+  background?: string;
+  gloss?: string;
+  detail?: string;
+  url?: string;
+  difficulty?: number;
+  centrality?: number;
+  fromOutside?: boolean;
+  blocks: BlockId[];
+}
+
+/** The list, and nothing about when or how it was written. */
+export interface PublicGlossary {
+  entries: PublicGlossaryEntry[];
+}
+
+/**
+ * The summary ladder.
+ *
+ * `SummaryEntry` is carried whole — `range`, `depth`, `short?`, `long?` is all
+ * there is of it — and rebuilt field by field on the way out anyway, so a field
+ * added to it next month is absent from a public response until somebody adds a
+ * line to the projection.
+ *
+ * **`missing` crosses.** It is the reader's only sign that an apparently
+ * complete summary is partial: some nodes' batches came back unusable and were
+ * written without text. Withholding it would make a gap look like a whole.
+ */
+export interface PublicSummaries {
+  entries: SummaryEntry[];
+  missing: number;
+}
+
+/** The propositions the piece assumes or introduces. `Idea` carries nothing about a person. */
+export interface PublicIdeas {
+  ideas: Idea[];
+}
+
+/**
+ * The article as a numbered thread.
+ *
+ * `limit` crosses because the count on every post is against it: a thread
+ * written under an older limit reports itself honestly, and a page that
+ * re-judged it under today's number would flag posts nobody wrote wrong.
+ */
+export interface PublicTweets {
+  limit: number;
+  tweets: Tweet[];
+}
+
 /**
  * Which artefacts exist for this article — and **nothing about how they were
  * made**.
diff --git a/src/public/dto.ts b/src/public/dto.ts
index 0e88a01..e41e71e 100644
--- a/src/public/dto.ts
+++ b/src/public/dto.ts
@@ -24,13 +24,14 @@
  * one careless `...spread` away from being widened; a column that was never
  * selected has to be put back on purpose, in SQL, where a reviewer sees it.
  *
- * ## Four of these are not exported, deliberately
+ * ## Only two of these are exported, deliberately
  *
- * `publicMeta`, `publicBlock`, `publicTree` and `publicArc` are the pieces
- * `publicArticle` is built from, and nothing outside this file assembles a
- * public response by hand — which is the property worth keeping. Slice 1b adds
- * four more endpoints and will want some of them; exporting one then, for a
- * caller that exists, is better than exporting four now for callers that do not.
+ * `publicMeta`, `publicBlock`, `publicTree`, `publicArc` and the four artefact
+ * projections slice 1b added are the pieces `publicArticle` is built from, and
+ * nothing outside this file assembles a public response by hand — which is the
+ * property worth keeping. Slice 1b was expected to want some of them exported
+ * for four sibling endpoints; Greg's decision that there are no sibling
+ * endpoints means there is still nothing to export them to.
  *
  * ## What is NOT here
  *
@@ -46,16 +47,28 @@ import type {
   ArcEntry,
   Block,
   BlockKind,
+  Glossary,
+  Idea,
+  Ideas,
   NodeId,
+  SummaryEntry,
+  Summaries,
   Tree,
   TreeNode,
+  Tweet,
+  TweetThread,
 } from "../types.js";
 import type {
   PublicArticle,
   PublicArtefacts,
   PublicBlock,
+  PublicGlossary,
+  PublicGlossaryEntry,
+  PublicIdeas,
   PublicMeta,
   PublicMetadata,
+  PublicSummaries,
+  PublicTweets,
 } from "../public-types.js";
 
 /**
@@ -171,7 +184,130 @@ function publicArc(arc: Arc): Arc {
   };
 }
 
-/** `GET /api/public/article/:slug`, assembled. */
+/**
+ * The glossary, rebuilt entry by entry — **and `lookup` is not among the
+ * fields.**
+ *
+ * This is the projection GPT Sol's design input named as the hazardous one, and
+ * it is worth saying why in the file that does it rather than only in the plan.
+ * `loadGlossary` on the owner's side attaches `glossary_lookups` to each entry
+ * at the read seam, on purpose and with a comment saying why
+ * ([pg.ts](../store/pg.ts)): a lookup is what came back when *that reader*
+ * pressed "check the web", and it carries their requested answer, its
+ * citations, how many searches it ran, which model answered and the exact
+ * minute. Correct for the owner; somebody's private research here.
+ *
+ * Two things stop it, and neither is this function on its own. The public
+ * reader selects the `glossary` column off `article_revisions` and joins
+ * nothing, and tests/public-imports.test.ts refuses any public module that can
+ * name the `glossary_lookups` table by import, by raw SQL or through Drizzle's
+ * relational API. This is the third: even handed an entry that carried one, the
+ * field is not copied.
+ */
+function publicGlossary(glossary: Glossary): PublicGlossary {
+  return {
+    entries: glossary.entries.map(
+      (entry): PublicGlossaryEntry => ({
+        id: entry.id,
+        name: entry.name,
+        kind: entry.kind,
+        aliases: [...entry.aliases],
+        /* Conditional spreads throughout, because `exactOptionalPropertyTypes`
+           is on and absent is a meaningful answer for most of these — an entry
+           with no `background` is one the model did not claim to know about,
+           which is visibly different from an invented one. */
+        ...(entry.senseHere === undefined ? {} : { senseHere: entry.senseHere }),
+        ...(entry.background === undefined ? {} : { background: entry.background }),
+        ...(entry.gloss === undefined ? {} : { gloss: entry.gloss }),
+        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
+        ...(entry.url === undefined ? {} : { url: entry.url }),
+        ...(entry.difficulty === undefined ? {} : { difficulty: entry.difficulty }),
+        ...(entry.centrality === undefined ? {} : { centrality: entry.centrality }),
+        ...(entry.fromOutside === undefined ? {} : { fromOutside: entry.fromOutside }),
+        blocks: [...entry.blocks],
+      }),
+    ),
+  };
+}
+
+/**
+ * The summaries — **and `guidance` is not among the fields.**
+ *
+ * That is the owner's free-text steer: what *they* asked these summaries to
+ * lean towards. Sol's payload table put it in bold and the plan repeats it,
+ * because it is the one field here that is a sentence somebody wrote about
+ * themselves rather than about the article.
+ *
+ * The honest limit, stated where somebody might otherwise think this closed it:
+ * the summary *text* is derived from the steer, so dropping the field stops
+ * direct disclosure and cannot make the prose neutral. That is Greg's settled
+ * stage-1 position — publish the artefact the owner has — and it is
+ * docs/plans/260827ai-public-read-only-access.md § The leak that no projection fixes.
+ *
+ * `missing` crosses: it is the reader's only sign that an apparently complete
+ * ladder is partial.
+ */
+function publicSummaries(summaries: Summaries): PublicSummaries {
+  return {
+    entries: summaries.entries.map(
+      (entry): SummaryEntry => ({
+        range: [entry.range[0], entry.range[1]],
+        depth: entry.depth,
+        ...(entry.short === undefined ? {} : { short: entry.short }),
+        ...(entry.long === undefined ? {} : { long: entry.long }),
+      }),
+    ),
+    missing: summaries.missing,
+  };
+}
+
+/** The ideas, rebuilt idea by idea and occurrence by occurrence. */
+function publicIdeas(ideas: Ideas): PublicIdeas {
+  return {
+    ideas: ideas.ideas.map(
+      (idea): Idea => ({
+        id: idea.id,
+        name: idea.name,
+        provenance: idea.provenance,
+        statement: idea.statement,
+        ...(idea.whyYouNeedIt === undefined ? {} : { whyYouNeedIt: idea.whyYouNeedIt }),
+        ...(idea.analogy === undefined ? {} : { analogy: idea.analogy }),
+        occurrences: idea.occurrences.map((at) => ({
+          blockId: at.blockId,
+          quote: at.quote,
+          reasoning: at.reasoning,
+          ...(at.start === undefined ? {} : { start: at.start }),
+        })),
+      }),
+    ),
+  };
+}
+
+/** The thread, rebuilt post by post. `limit` crosses; the provenance does not. */
+function publicTweets(thread: TweetThread): PublicTweets {
+  return {
+    limit: thread.limit,
+    tweets: thread.tweets.map((tweet): Tweet => ({ text: tweet.text, chars: tweet.chars })),
+  };
+}
+
+/**
+ * `GET /api/public/article/:slug`, assembled.
+ *
+ * **The four artefacts are keys of this one response, and that is Greg's
+ * decision rather than the design Sol gave.** Four sibling endpoints would each
+ * have needed a route, a projection, a reader method, a client hook and a
+ * tagged wire result saying whether the artefact exists; folding them in here
+ * makes existence a property of the payload — a key that is present exists —
+ * with no second request to be in flight, to fail, or to disagree with the
+ * first. docs/plans/260827ai-public-read-only-access.md § Slice 1b.
+ *
+ * `null` in, absent out. The reader hands `null` for a column Postgres had
+ * nothing in, and an absent key is what the client reads as *nobody built one*.
+ * An artefact that exists and is **empty** — a glossary whose step ran and
+ * found no terms — is a present key holding an empty list, and the two must
+ * stay different.
+ */
 export function publicArticle(row: {
   slug: string;
   title: string | null;
@@ -183,12 +319,25 @@ export function publicArticle(row: {
   blocks: (Block | PublicBlock)[];
   tree: Tree;
   arc: Arc | null;
+  glossary: Glossary | null;
+  summary: Summaries | null;
+  ideas: Ideas | null;
+  tweets: TweetThread | null;
 }): PublicArticle {
   return {
     meta: publicMeta(row),
     blocks: row.blocks.map(publicBlock),
     tree: publicTree(row.tree),
     ...(row.arc ? { arc: publicArc(row.arc) } : {}),
+    /* `!== null` rather than truthiness, on all four. An artefact is an object
+       and so always truthy, so the two agree today — but the day one of these
+       becomes a value that can be falsy while present, truthiness silently
+       reports it as never built. The distinction this payload rests on is
+       present-versus-absent, and the test is written to say so. */
+    ...(row.glossary !== null ? { glossary: publicGlossary(row.glossary) } : {}),
+    ...(row.summary !== null ? { summary: publicSummaries(row.summary) } : {}),
+    ...(row.ideas !== null ? { ideas: publicIdeas(row.ideas) } : {}),
+    ...(row.tweets !== null ? { tweets: publicTweets(row.tweets) } : {}),
   };
 }
 
diff --git a/src/store/public-reader.ts b/src/store/public-reader.ts
index c6b3fc2..17ec4a1 100644
--- a/src/store/public-reader.ts
+++ b/src/store/public-reader.ts
@@ -174,6 +174,33 @@ const PUBLIC_PROJECTIONS = {
     excerpt: articleRevisions.excerpt,
     tree: articleRevisions.tree,
     arc: articleRevisions.arc,
+    /**
+     * **The four artefacts slice 1b carries, off the same row.**
+     *
+     * They are JSONB columns on `article_revisions` — the row this query is
+     * already fetching — so a visitor gets the glossary, the summaries, the
+     * ideas and the tweet thread for no extra query and no extra round trip.
+     * That is the whole of what Greg's "no new endpoints" decision buys, and it
+     * is why there is no `PublicArtefactReader` beside this one.
+     *
+     * Read what is **not** here, because it is a longer list than usual and the
+     * absences are the projection. No `glossary_lookups` join, which is what
+     * the owner's `loadGlossary` does at the read seam and is the leak this
+     * feature was most exposed on. No freshness: `stale` and `outdated` are
+     * computed by `isStale` in the writer modules, which the public graph
+     * cannot reach at all (tests/public-imports.test.ts) — and a visitor could
+     * not act on either, since both mean *the owner might want to regenerate
+     * this*. The provenance inside each document — `profileHash`, `guidance`,
+     * `generatedAt`, `elapsedMs`, `generator`, `version`, `sourceHash`,
+     * `passes` — comes across the wire from Postgres inside the JSONB and is
+     * dropped by [dto.ts](../public/dto.ts), which is the one place in this
+     * feature where a projection is doing the work rather than the `select`.
+     * There is no column-level alternative: a JSONB document is one column.
+     */
+    glossary: articleRevisions.glossary,
+    summary: articleRevisions.summary,
+    ideas: articleRevisions.ideas,
+    tweets: articleRevisions.tweets,
   },
   /**
    * **Five booleans and a title, and not one document.**
@@ -353,6 +380,10 @@ export const pgPublicReader: PublicArticleReader = {
         blocks,
         tree,
         arc: found.revision.arc,
+        glossary: found.revision.glossary,
+        summary: found.revision.summary,
+        ideas: found.revision.ideas,
+        tweets: found.revision.tweets,
       });
     });
   },
diff --git a/tests/public-dto.test.ts b/tests/public-dto.test.ts
index 6042e29..f537617 100644
--- a/tests/public-dto.test.ts
+++ b/tests/public-dto.test.ts
@@ -28,7 +28,33 @@
 import { describe, expect, it } from "vitest";
 
 import { publicArticle, publicMetadata } from "../src/public/dto.js";
-import type { Arc, Block, Tree } from "../src/types.js";
+import type {
+  Arc,
+  Block,
+  BlockId,
+  Glossary,
+  Ideas,
+  NodeId,
+  Summaries,
+  Tree,
+  TreeNode,
+  TweetThread,
+} from "../src/types.js";
+
+/**
+ * An article whose four slice-1b columns are all empty, for the cases that are
+ * about the meta, the blocks and the tree.
+ *
+ * Spelled out rather than defaulted in the DTO: `publicArticle` takes them as
+ * required arguments, so a fifth artefact added next year cannot be forgotten
+ * at a call site — it stops compiling instead.
+ */
+const NO_ARTEFACTS = {
+  glossary: null,
+  summary: null,
+  ideas: null,
+  tweets: null,
+} as const;
 
 /** Every key path in a value, dotted, with array elements collapsed to `[]`. */
 function keyPaths(value: unknown, prefix = ""): string[] {
@@ -54,6 +80,10 @@ function keyPaths(value: unknown, prefix = ""): string[] {
  * preview renders a note's whole range, so `noteId` is load-bearing on the
  * public side rather than an extra. `HEADING` below carries none of them, so
  * the assertion covers both arms.
+ *
+ * Left as a plain `Block` on purpose: `EVERY_BLOCK_FIELD` below is the
+ * `Required<Block>` guard, and two of them would be one fixture to update and
+ * one to forget.
  */
 const BLOCK: Block = {
   id: "spya-k3m9qt",
@@ -80,6 +110,62 @@ const HEADING: Block = {
   gistable: true,
 };
 
+/**
+ * **Every field a `TreeNode` has** — the other half of the guard
+ * `EVERY_BLOCK_FIELD` below sets out at length, and the reasoning there is the
+ * whole of the reasoning here: `publicTree` drops what it does not name, which
+ * is safe and is not the same as correct, so a new field has to stop compiling
+ * until somebody decides about it.
+ *
+ * ## Why it is assigned through a variable rather than written as a literal
+ *
+ * TypeScript's excess-property check fires on a **fresh object literal** and
+ * not on a variable, and that difference is load-bearing here rather than
+ * stylistic. `TreeNode` is a contended type: on 2026-08-28 the footnotes lane
+ * added a `treatment?` to it in a working tree that is not committed yet, and a
+ * literal listing `treatment` would fail to compile the moment that hunk lands
+ * or is dropped — this file would be red in one half of the repo's two states
+ * whichever way it was written.
+ *
+ * Through a variable, the half that matters still holds in both: a field added
+ * to `TreeNode` and not set here is a **missing** property, and
+ * `Required<TreeNode>` refuses it. A field listed here that `TreeNode` no
+ * longer has is merely extra, and passes quietly — which is the right way round,
+ * because a stale name in a fixture is a tidy-up and an unconsidered field in a
+ * public payload is a leak.
+ */
+const NODE_FIELDS = {
+  id: "n1" as NodeId,
+  depth: 1,
+  parent: "n0" as NodeId | null,
+  children: [] as NodeId[],
+  range: ["spya-k3m9qt", "spya-k3m9qt"] as [BlockId, BlockId],
+  title: "The example",
+  navLabel: "Example",
+  summary: "A longer restatement.",
+  sourceHeading: "The example",
+  gist: "The one worked example, and what it costs the argument.",
+  /**
+   * **Apparatus rather than argument**, and the one field here that is not
+   * merely provenance.
+   *
+   * `publicTree` does **not** copy it, deliberately and for a reason that is
+   * about this tree rather than about privacy: the field exists only in the
+   * footnotes lane's uncommitted `src/types.ts`, so a public projection reading
+   * it would compile against one agent's working copy and not against the
+   * commit. When that lane lands, whoever lands it meets this fixture, sets
+   * this key, watches the key-set assertion below report the field as dropped,
+   * and decides — which is exactly the decision a visitor's spine depends on,
+   * since a client that cannot tell apparatus from argument numbers the
+   * footnotes as a part of the piece.
+   */
+  treatment: "supplement" as const,
+};
+
+/* **No `as` on this line, and that is the guard.** A cast would suppress
+   exactly the error this exists to produce. */
+const FULL_NODE: Required<TreeNode> = NODE_FIELDS;
+
 const TREE: Tree = {
   version: "1",
   generator: "test",
@@ -95,17 +181,7 @@ const TREE: Tree = {
       title: "The whole piece",
       gist: "It argues one thing and demonstrates another.",
     },
-    n1: {
-      id: "n1",
-      depth: 1,
-      parent: "n0",
-      children: [],
-      range: ["spya-k3m9qt", "spya-k3m9qt"],
-      title: "The example",
-      navLabel: "Example",
-      summary: "A longer restatement.",
-      sourceHeading: "The example",
-    },
+    n1: FULL_NODE,
   },
 };
 
@@ -157,6 +233,7 @@ describe("the public article payload", () => {
     blocks: [HEADING, BLOCK],
     tree: TREE,
     arc: ARC,
+    ...NO_ARTEFACTS,
   });
 
   it("has exactly the keys it is allowed, all the way down", () => {
@@ -202,6 +279,11 @@ describe("the public article payload", () => {
         "tree.nodes.n1",
         "tree.nodes.n1.children",
         "tree.nodes.n1.depth",
+        /* `n1` is the `Required<TreeNode>` fixture, so it carries every field
+           the type has — and this list is where each one's fate is recorded.
+           `treatment` is the absence to read: it is set on the fixture and it
+           is not here, which is `publicTree` dropping what it does not name. */
+        "tree.nodes.n1.gist",
         "tree.nodes.n1.id",
         "tree.nodes.n1.navLabel",
         "tree.nodes.n1.parent",
@@ -241,11 +323,117 @@ describe("the public article payload", () => {
     expect(JSON.stringify(built)).not.toContain("repeats the pull quote");
   });
 
+  /**
+   * **The field the `Required<TreeNode>` fixture exists for**, asserted rather
+   * than left to the key list above.
+   *
+   * `treatment` is set on the fixture and dropped by `publicTree`. That is the
+   * safe default doing its job — but *safe* and *correct* are different here,
+   * and this is the case that shows it: a client that cannot tell apparatus
+   * from argument numbers the footnotes as a part of the piece. Whoever lands
+   * the footnotes lane's `TreeNode.treatment` meets this test and decides.
+   */
+  it("drops a tree node's treatment, which is a decision rather than an oversight", () => {
+    expect(NODE_FIELDS.treatment).toBe("supplement");
+    expect(keyPaths(built)).not.toContain("tree.nodes.n1.treatment");
+    expect(JSON.stringify(built.tree)).not.toContain("supplement");
+  });
+
   it("has none of the meta fields the payload table forbids", () => {
     const keys = Object.keys(built.meta);
     expect(keys.filter((k) => FORBIDDEN_ON_META.includes(k))).toEqual([]);
   });
 
+  /**
+   * **A field added to `Block` next month does not compile until somebody has
+   * decided about it.**
+   *
+   * The test above proves the projection *drops* what it was not told about,
+   * which is the safe default and the reason `publicBlock` rebuilds rather than
+   * passes through. But safe and correct are different things, and slice 1b
+   * found the gap between them the hard way: `role`, `treatment` and `noteId`
+   * arrived on `Block` from the footnotes work, and they are fields the client
+   * *needs* — without `treatment` a visitor's copy of an article numbers the
+   * apparatus as part of the argument. Silently dropping those is wrong in a way
+   * that no amount of "it fails closed" reasoning fixes.
+   *
+   * So this fixture is typed `Required<Block>`, and that is the whole mechanism:
+   * it stops compiling the moment `Block` gains **any** field, optional or not,
+   * until somebody sets it here — and the assertion below then tells them at
+   * once whether it crosses into the public payload. *Absent by default* stays
+   * true; *absent without anybody noticing* stops being possible.
+   *
+   * The same move as `FIXED_BY_AN_ACCOUNT` in src/web/visitor.ts, which is a
+   * total `Record<VisitorGap["kind"], boolean>` for the same reason it gives:
+   * a fifth kind is then "a red compile rather than a silent `false`".
+   *
+   * **`TreeNode` has the identical guard now** — `FULL_NODE` at the top of this
+   * file — and the reason this paragraph used to say it could not is worth
+   * keeping, because the way round it is not obvious.
+   *
+   * The objection was real: on 2026-08-28 that type was mid-flight in the
+   * footnotes lane, `TreeNode.treatment` was in the working tree and not in
+   * HEAD, and a `Required<TreeNode>` **literal** is red in both directions at
+   * once — missing the field against one state of the repo and carrying an
+   * excess one against the other. What resolves it is that TypeScript's
+   * excess-property check fires on a fresh object literal and not on a
+   * variable. Assign the fields to a variable first, and the half that matters
+   * still holds in both states: a field added to `TreeNode` and not set is a
+   * *missing* property, which `Required<TreeNode>` refuses. A field set that
+   * `TreeNode` no longer has is merely extra, and passes — which is the right
+   * way round, since a stale name in a fixture is a tidy-up and an
+   * unconsidered field in a public payload is a leak.
+   */
+  const EVERY_BLOCK_FIELD: Required<Block> = {
+    id: "spya-zzzzzz",
+    tag: "p",
+    kind: "text",
+    level: 2,
+    text: "Every field set, so that the projection has something to drop.",
+    words: 11,
+    html: "<p>Every field set, so that the projection has something to drop.</p>",
+    gistable: true,
+    /* The one that must not survive, carrying a canary rather than plausible
+       prose so that a leak is greppable in the serialised output. */
+    note: "PRIVATE-EDITORIAL-NOTE-CANARY",
+    role: "footnote",
+    treatment: "supplement",
+    noteId: "spya-note-0123456789",
+  };
+
+  it("carries every Block field that crosses, and drops the one that does not", () => {
+    const out = publicArticle({
+      slug: "noema",
+      title: "t",
+      byline: null,
+      siteName: null,
+      lang: null,
+      excerpt: null,
+      headingTitle: null,
+      blocks: [EVERY_BLOCK_FIELD],
+      tree: TREE,
+      arc: null,
+      ...NO_ARTEFACTS,
+    });
+
+    /* Exact rather than `toContain`, in both directions at once: a field that
+       stopped crossing fails here just as loudly as one that started. */
+    expect(keyPaths(out).filter((k) => k.startsWith("blocks[]")).sort()).toEqual([
+      "blocks[].gistable",
+      "blocks[].html",
+      "blocks[].id",
+      "blocks[].kind",
+      "blocks[].level",
+      "blocks[].noteId",
+      "blocks[].role",
+      "blocks[].tag",
+      "blocks[].text",
+      "blocks[].treatment",
+      "blocks[].words",
+    ]);
+    expect(JSON.stringify(out)).not.toContain("PRIVATE-EDITORIAL-NOTE-CANARY");
+  });
+
   /**
    * **A field added to `TreeNode` next month is absent by default.**
    *
@@ -273,6 +461,7 @@ describe("the public article payload", () => {
       blocks: [BLOCK],
       tree: withExtra,
       arc: null,
+      ...NO_ARTEFACTS,
     });
     expect(JSON.stringify(out)).not.toContain("whoAsked");
   });
@@ -290,6 +479,7 @@ describe("the public article payload", () => {
       blocks: [BLOCK],
       tree: TREE,
       arc: null,
+      ...NO_ARTEFACTS,
     });
     expect(Object.keys(bare.meta)).toEqual(["slug", "title"]);
     expect(bare.meta.title).toBe("From the article's own h1");
@@ -309,11 +499,297 @@ describe("the public article payload", () => {
       blocks: [BLOCK],
       tree: TREE,
       arc: null,
+      ...NO_ARTEFACTS,
     });
     expect(bare.meta.title).toBe("noema");
   });
 });
 
+/**
+ * **The four artefacts slice 1b carries**, each fed an input that is
+ * deliberately over-full.
+ *
+ * Every fixture below carries the private field as well as the public one —
+ * `guidance` on the summaries, a `lookup` on a glossary entry, `profileHash` on
+ * all four, the generator and the timings — so a projection that copied its
+ * argument, spread it, or filtered a denylist would fail here rather than pass
+ * for want of anything to leak. A fixture with nothing forbidden in it proves
+ * nothing at all, which is the mistake the top of this file exists to name.
+ */
+describe("the four artefacts a shared link carries", () => {
+  /**
+   * A glossary with **a lookup on one of its entries**, which is the single
+   * most private thing in any of these four.
+   *
+   * `glossary_lookups` is the owner's own research — their requested answer,
+   * its citations, how many web searches it ran, which model answered and the
+   * exact minute — and `loadGlossary` attaches it to the entry at the read
+   * seam, deliberately, for the owner. GPT Sol's design input named it by name
+   * as the thing a public glossary read must never carry.
+   */
+  const GLOSSARY: Glossary = {
+    version: "glossary/2",
+    generator: "some-model",
+    slug: "noema",
+    sourceHash: "abc123",
+    profileHash: "profile-of-a-person",
+    passes: 3,
+    generatedAt: "2026-08-28T10:00:00.000Z",
+    elapsedMs: 41_000,
+    entries: [
+      {
+        id: "spya-term01",
+        name: "Integrated information theory",
+        kind: "concept",
+        aliases: ["IIT"],
+        senseHere: "The author uses it as a stand-in for any measure-first account.",
+        background: "A theory of consciousness proposed by Giulio Tononi.",
+        gloss: "A superseded blended field, still rendered for older artefacts.",
+        detail: "Its superseded partner.",
+        url: "https://example.com/iit",
+        difficulty: 0.8,
+        centrality: 0.9,
+        fromOutside: true,
+        blocks: ["spya-k3m9qt"],
+        lookup: {
+          answer: "What the owner asked the web, and what it said back.",
+          citations: [{ url: "https://example.com/source", title: "A source" }],
+          searches: 4,
+          model: "some-search-model",
+          at: "2026-08-28T11:00:00.000Z",
+        },
+      },
+      /* A second entry with every optional absent, so the assertions below
+         cover both arms rather than only the full one. */
+      {
+        id: "spya-term02",
+        name: "Lamport",
+        kind: "person",
+        aliases: [],
+        blocks: [],
+      },
+    ],
+  };
+
+  /** Summaries carrying **`guidance`** — the owner's free-text steer. */
+  const SUMMARIES: Summaries = {
+    version: "summary/1",
+    generator: "some-model",
+    slug: "noema",
+    sourceHash: "abc123",
+    profileHash: "profile-of-a-person",
+    guidance: "I am reading this for the argument about measurement, skip the history.",
+    missing: 2,
+    generatedAt: "2026-08-28T10:00:00.000Z",
+    elapsedMs: 62_000,
+    entries: [
+      {
+        range: ["spya-h1aaaa", "spya-k3m9qt"],
+        depth: 0,
+        short: "A few sentences.",
+        long: "A paragraph.",
+      },
+      { range: ["spya-k3m9qt", "spya-k3m9qt"], depth: 1 },
+    ],
+  };
+
+  const IDEAS: Ideas = {
+    version: "ideas/1",
+    generator: "some-model",
+    slug: "noema",
+    sourceHash: "abc123",
+    profileHash: "profile-of-a-person",
+    generatedAt: "2026-08-28T10:00:00.000Z",
+    elapsedMs: 30_000,
+    ideas: [
+      {
+        id: "spya-idea01",
+        name: "Measurement precedes theory",
+        provenance: "assumed",
+        statement: "You cannot theorise about what you have no way to measure.",
+        whyYouNeedIt: "The middle section's objection collapses without it.",
+        analogy: "Like arguing about temperature before the thermometer.",
+        occurrences: [
+          {
+            blockId: "spya-k3m9qt",
+            quote: "does not survive its own first example",
+            reasoning: "The example is offered as a measurement.",
+            start: 17,
+          },
+        ],
+      },
+    ],
+  };
+
+  const THREAD: TweetThread = {
+    version: "tweets/1",
+    generator: "some-model",
+    slug: "noema",
+    sourceHash: "abc123",
+    profileHash: "profile-of-a-person",
+    limit: 280,
+    tweets: [{ text: "The first post.", chars: 15 }],
+    generatedAt: "2026-08-28T10:00:00.000Z",
+    elapsedMs: 12_000,
+  };
+
+  const built = publicArticle({
+    slug: "noema",
+    title: "The mythology of conscious AI",
+    byline: null,
+    siteName: null,
+    lang: null,
+    excerpt: null,
+    headingTitle: null,
+    blocks: [BLOCK],
+    tree: TREE,
+    arc: null,
+    glossary: GLOSSARY,
+    summary: SUMMARIES,
+    ideas: IDEAS,
+    tweets: THREAD,
+  });
+
+  /** Everything under one key, deeply, against the allowlist for that artefact. */
+  function pathsUnder(key: string): string[] {
+    return keyPaths((built as unknown as Record<string, unknown>)[key]);
+  }
+
+  it("carries a glossary entry's fields and never its lookup", () => {
+    expect(pathsUnder("glossary")).toEqual(
+      [
+        "entries",
+        "entries[].aliases",
+        "entries[].background",
+        "entries[].blocks",
+        "entries[].centrality",
+        "entries[].detail",
+        "entries[].difficulty",
+        "entries[].fromOutside",
+        "entries[].gloss",
+        "entries[].id",
+        "entries[].kind",
+        "entries[].name",
+        "entries[].senseHere",
+        "entries[].url",
+      ].sort(),
+    );
+    /* Said twice on purpose: the key set above would also pass if `lookup` were
+       renamed, and the owner's answer is the thing that must not travel. */
+    expect(JSON.stringify(built.glossary)).not.toContain("What the owner asked the web");
+    expect(JSON.stringify(built.glossary)).not.toContain("some-search-model");
+    /* And the provenance the plan's table forbids. */
+    for (const forbidden of ["profileHash", "passes", "generatedAt", "elapsedMs", "sourceHash"]) {
+      expect(pathsUnder("glossary"), forbidden).not.toContain(forbidden);
+    }
+  });
+
+  it("carries the summary ladder and never the owner's steer", () => {
+    expect(pathsUnder("summary")).toEqual(
+      ["entries", "entries[].depth", "entries[].long", "entries[].range", "entries[].short", "missing"].sort(),
+    );
+    expect(JSON.stringify(built.summary)).not.toContain("skip the history");
+  });
+
+  it("carries the ideas and none of their provenance", () => {
+    expect(pathsUnder("ideas")).toEqual(
+      [
+        "ideas",
+        "ideas[].analogy",
+        "ideas[].id",
+        "ideas[].name",
+        "ideas[].occurrences",
+        "ideas[].occurrences[].blockId",
+        "ideas[].occurrences[].quote",
+        "ideas[].occurrences[].reasoning",
+        "ideas[].occurrences[].start",
+        "ideas[].provenance",
+        "ideas[].statement",
+        "ideas[].whyYouNeedIt",
+      ].sort(),
+    );
+  });
+
+  it("carries the thread and the limit it was counted against", () => {
+    expect(pathsUnder("tweets")).toEqual(["limit", "tweets", "tweets[].chars", "tweets[].text"].sort());
+  });
+
+  /**
+   * **And the artefacts are really there**, which every assertion above passes
+   * without. A DTO returning `{}` for all four satisfies every key set and
+   * every "does not contain", and it is the failure this repo keeps writing up:
+   * a check agreeing with the code because both are empty.
+   */
+  it("still contains the artefacts, which is the point of the slice", () => {
+    expect(built.glossary?.entries).toHaveLength(2);
+    expect(built.glossary?.entries[0]?.name).toBe("Integrated information theory");
+    expect(built.glossary?.entries[0]?.blocks).toEqual(["spya-k3m9qt"]);
+    expect(built.summary?.entries[0]?.long).toBe("A paragraph.");
+    expect(built.summary?.missing).toBe(2);
+    expect(built.ideas?.ideas[0]?.statement).toContain("no way to measure");
+    expect(built.ideas?.ideas[0]?.occurrences[0]?.quote).toContain("first example");
+    expect(built.tweets?.tweets[0]?.text).toBe("The first post.");
+    expect(built.tweets?.limit).toBe(280);
+  });
+
+  /**
+   * **An artefact nobody built is an absent key. An artefact that is empty is a
+   * present one.**
+   *
+   * This is the distinction the whole client half rests on now that there is no
+   * second request: *does this piece have a glossary* is answered by the
+   * payload, and a stored `{entries: []}` means somebody ran the step and it
+   * found nothing — a **ready but empty** artefact, which is a different
+   * sentence from *nobody has built one yet*. A truthiness test on the document
+   * agrees with `!== null` today and stops agreeing the moment an artefact can
+   * be falsy while present; a length test on the entries collapses the two
+   * outright.
+   */
+  it("tells an empty artefact from an absent one", () => {
+    const empty = publicArticle({
+      slug: "noema",
+      title: "t",
+      byline: null,
+      siteName: null,
+      lang: null,
+      excerpt: null,
+      headingTitle: null,
+      blocks: [BLOCK],
+      tree: TREE,
+      arc: null,
+      glossary: { ...GLOSSARY, entries: [] },
+      summary: null,
+      ideas: { ...IDEAS, ideas: [] },
+      tweets: null,
+    });
+    expect("glossary" in empty).toBe(true);
+    expect(empty.glossary?.entries).toEqual([]);
+    expect("ideas" in empty).toBe(true);
+    expect(empty.ideas?.ideas).toEqual([]);
+    expect("summary" in empty).toBe(false);
+    expect("tweets" in empty).toBe(false);
+  });
+
+  it("leaves every artefact out when the row carried none", () => {
+    const bare = publicArticle({
+      slug: "noema",
+      title: "t",
+      byline: null,
+      siteName: null,
+      lang: null,
+      excerpt: null,
+      headingTitle: null,
+      blocks: [BLOCK],
+      tree: TREE,
+      arc: null,
+      ...NO_ARTEFACTS,
+    });
+    for (const key of ["glossary", "summary", "ideas", "tweets"]) {
+      expect(key in bare, key).toBe(false);
+    }
+  });
+});
+
 describe("the public metadata payload", () => {
   const built = publicMetadata({
     slug: "noema",
diff --git a/tests/public-reads.test.ts b/tests/public-reads.test.ts
index d576004..112bd37 100644
--- a/tests/public-reads.test.ts
+++ b/tests/public-reads.test.ts
@@ -103,6 +103,29 @@ describe("the public revision read", () => {
     expect(article).toContain('"arc"');
   });
 
+  /**
+   * **The four artefacts slice 1b carries, in the same statement.**
+   *
+   * The point of Greg's "no new endpoints" decision is that they ride on the
+   * row the article read already fetches — so what has to be true is not that
+   * four columns are selected somewhere, but that they are selected **by this
+   * query**, which is the one carrying `where visibility = 'public'`. A second
+   * read that fetched them without the predicate would serve a private
+   * article's glossary at a public URL, and every DTO test would stay green
+   * because a projection only ever sees what it was handed. That is GPT Sol's
+   * finding 3 on slice 1a, one slice later, and it is why this assertion is on
+   * the same `articleQuery` object the predicate case above reads.
+   */
+  it("asks for the four artefacts on the row it already filtered", () => {
+    for (const column of ["glossary", "summary", "ideas", "tweets"]) {
+      expect(article, column).toContain(`"${column}"`);
+    }
+    /* The predicate, restated against this same statement rather than trusted
+       from the case above — the two facts are only worth anything together. */
+    expect(articleQuery.sql).toMatch(/"visibility" = \$2/);
+    expect(articleQuery.params).toEqual(["a-slug", "public", 1]);
+  });
+
   /**
    * The metadata read asks whether an artefact exists, in SQL — not by dragging
    * the JSONB document across the wire to compare it with null. That mistake
diff --git a/tests/public-visibility-pg.test.ts b/tests/public-visibility-pg.test.ts
index 325c867..b9df3de 100644
--- a/tests/public-visibility-pg.test.ts
+++ b/tests/public-visibility-pg.test.ts
@@ -47,6 +47,7 @@ import {
 } from "../src/db/schema.js";
 import { loadEnvLocal } from "../src/env.js";
 import { currentOwnerId, type OwnerId, runInRequest } from "../src/owner.js";
+import type { Glossary, Ideas, Summaries, TweetThread } from "../src/types.js";
 
 loadEnvLocal();
 
@@ -77,6 +78,117 @@ const PRIVATE_PURPOSE = "reading it to argue with a colleague on Thursday";
 const SIGNED_URL = "https://example.test/piece?sig=SECRETSIGNATURE";
 const EXTRACTED_TITLE = "A piece somebody shared";
 
+/**
+ * **Slice 1b's canaries**, and they are the same idea one artefact deeper.
+ *
+ * The four canaries above are fields of the article row. These four are fields
+ * *inside* the JSONB documents the four new columns hold — so they are the ones
+ * that would cross if the reader selected the column (which it now must) and
+ * the projection copied it wholesale (which it must not).
+ *
+ * `PRIVATE_LOOKUP` is the sharpest: `glossary_lookups` is a table the public
+ * graph cannot reach at all, but a *stored* lookup inside the glossary document
+ * comes across the wire from Postgres whatever the table guard says, and only
+ * the projection in src/public/dto.ts drops it.
+ */
+const PRIVATE_GUIDANCE = "I am reading this to argue with a colleague, skip the history";
+const PRIVATE_LOOKUP = "what the owner asked the web and what it said back";
+const PRIVATE_PROFILE_HASH = "profilehash-nobodyelsesbusiness";
+/** And what a visitor *must* see, so the absences above are not absence of everything. */
+const PUBLIC_TERM = "Integrated information theory";
+const PUBLIC_SUMMARY = "The whole piece, in a paragraph.";
+const PUBLIC_IDEA = "You cannot theorise about what you have no way to measure.";
+const PUBLIC_TWEET = "The first post of the thread.";
+
+/**
+ * **The four artefacts slice 1b carries**, each stuffed with the provenance it
+ * must not carry.
+ *
+ * A module constant rather than an object literal in `beforeAll`, because one
+ * case below deliberately replaces all four to test `personalised` and has to
+ * put them back afterwards. Restoring them to `null` — which is what it did
+ * when there were three of them and nothing read them — leaves every later case
+ * in this file reading an article with no artefacts on it, and the failure
+ * lands wherever vitest happens to order things rather than here.
+ */
+const ARTEFACTS: {
+  glossary: Glossary;
+  summary: Summaries;
+  ideas: Ideas;
+  tweets: TweetThread;
+} = {
+  glossary: {
+    version: "glossary/2",
+    generator: "test",
+    slug: SLUG,
+    sourceHash: "abc",
+    profileHash: PRIVATE_PROFILE_HASH,
+    passes: 2,
+    generatedAt: "2026-02-02T00:00:00.000Z",
+    elapsedMs: 1,
+    entries: [
+      {
+        id: "spya-wpvvqc",
+        name: PUBLIC_TERM,
+        kind: "concept",
+        aliases: ["IIT"],
+        senseHere: "The author's narrowed use of it.",
+        blocks: [BLOCK_ID],
+        lookup: {
+          answer: PRIVATE_LOOKUP,
+          citations: [],
+          searches: 3,
+          model: "a-search-model",
+          at: "2026-02-02T00:00:00.000Z",
+        },
+      },
+    ],
+  },
+  summary: {
+    version: "summary/1",
+    generator: "test",
+    slug: SLUG,
+    sourceHash: "abc",
+    profileHash: PRIVATE_PROFILE_HASH,
+    guidance: PRIVATE_GUIDANCE,
+    missing: 0,
+    generatedAt: "2026-02-02T00:00:00.000Z",
+    elapsedMs: 1,
+    entries: [{ range: [HEADING_ID, BLOCK_ID], depth: 0, long: PUBLIC_SUMMARY }],
+  },
+  ideas: {
+    version: "ideas/1",
+    generator: "test",
+    slug: SLUG,
+    sourceHash: "abc",
+    profileHash: PRIVATE_PROFILE_HASH,
+    generatedAt: "2026-02-02T00:00:00.000Z",
+    elapsedMs: 1,
+    ideas: [
+      {
+        id: "spya-wpvvqd",
+        name: "Measurement first",
+        provenance: "assumed",
+        statement: PUBLIC_IDEA,
+        occurrences: [
+          { blockId: BLOCK_ID, quote: "The prose a visitor", reasoning: "It is offered as one." },
+        ],
+      },
+    ],
+  },
+  tweets: {
+    version: "tweets/1",
+    generator: "test",
+    slug: SLUG,
+    sourceHash: "abc",
+    profileHash: PRIVATE_PROFILE_HASH,
+    limit: 280,
+    tweets: [{ text: PUBLIC_TWEET, chars: 29 }],
+    generatedAt: "2026-02-02T00:00:00.000Z",
+    elapsedMs: 1,
+  },
+};
+
 /**
  * The seeded development owner writes; a second uuid never writes anything.
  *
@@ -289,6 +401,7 @@ when("sharing one article", { timeout: 60_000 }, () => {
           },
         },
       },
+      ...ARTEFACTS,
     });
     await db
       .update(articles)
@@ -347,6 +460,15 @@ when("sharing one article", { timeout: 60_000 }, () => {
        message is the same one an unknown slug gets. */
     expect(r.body.error).toMatch(/No article artefacts/);
     expect(r.headers["Cache-Control"]).toBe("no-store");
+    /* **And the four artefacts are not readable either**, which is the whole of
+       slice 1b's exposure. They are on this row *now* — the fixture wrote them
+       before this case ran — so a public read that fetched the columns without
+       the visibility predicate would put a private article's glossary,
+       summaries, ideas and thread at a public URL, and the assertions further
+       down would not notice, because they all run after publication. */
+    for (const canary of [PUBLIC_TERM, PUBLIC_SUMMARY, PUBLIC_IDEA, PUBLIC_TWEET]) {
+      expect(r.text, canary).not.toContain(canary);
+    }
   });
 
   /**
@@ -480,7 +602,7 @@ when("sharing one article", { timeout: 60_000 }, () => {
     expect(Object.keys(article.tree.nodes)).toEqual(["n0"]);
   });
 
-  it("carries none of the four canaries", async () => {
+  it("carries none of the eight canaries", async () => {
     const r = await call("GET", `/api/public/article/${SLUG}`);
     /* Each one is asserted to be *in the fixture* first, so the absence below
        is an absence of something that was really there. */
@@ -495,18 +617,48 @@ when("sharing one article", { timeout: 60_000 }, () => {
     expect(r.text).not.toContain(PRIVATE_PURPOSE);
     expect(r.text).not.toContain(PRIVATE_NOTE);
     expect(r.text).not.toContain("SECRETSIGNATURE");
+    /* And the four inside the artefacts, which slice 1b put on the wire. */
+    expect(r.text).not.toContain(PRIVATE_LOOKUP);
+    expect(r.text).not.toContain(PRIVATE_GUIDANCE);
+    expect(r.text).not.toContain(PRIVATE_PROFILE_HASH);
+    expect(r.text).not.toContain("a-search-model");
     /* And the extracted title *is* there — otherwise the four lines above would
        pass on an empty response. */
     expect(r.text).toContain(EXTRACTED_TITLE);
   });
 
+  /**
+   * **The four artefacts really are served**, which is what slice 1b is for and
+   * what makes the absences above absences of something rather than of
+   * everything.
+   *
+   * Every canary line in the case above passes just as happily against a
+   * response that dropped all four columns — the exact failure this repo keeps
+   * writing up. So the same response is read for the four things a visitor came
+   * here to get.
+   */
+  it("serves the glossary, the summaries, the ideas and the thread", async () => {
+    const r = await call("GET", `/api/public/article/${SLUG}`);
+    const body = r.body as {
+      glossary?: { entries: { name: string }[] };
+      summary?: { entries: { long?: string }[]; missing: number };
+      ideas?: { ideas: { statement: string }[] };
+      tweets?: { limit: number; tweets: { text: string }[] };
+    };
+    expect(body.glossary?.entries[0]?.name).toBe(PUBLIC_TERM);
+    expect(body.summary?.entries[0]?.long).toBe(PUBLIC_SUMMARY);
+    expect(body.ideas?.ideas[0]?.statement).toBe(PUBLIC_IDEA);
+    expect(body.tweets?.tweets[0]?.text).toBe(PUBLIC_TWEET);
+    expect(body.tweets?.limit).toBe(280);
+  });
+
   it("shows the metadata page which artefacts exist, and nothing about the pipeline", async () => {
     const r = await call("GET", `/api/public/metadata/${SLUG}`);
     expect(r.status).toBe(200);
     expect(r.body).toEqual({
       slug: SLUG,
       title: EXTRACTED_TITLE,
-      available: { arc: false, tweets: false, glossary: false, summary: false, ideas: false },
+      available: { arc: false, tweets: true, glossary: true, summary: true, ideas: true },
     });
   });
 
@@ -576,11 +728,13 @@ when("sharing one article", { timeout: 60_000 }, () => {
     expect(r.body.sharing).toEqual({
       visibility: "public",
       publicAt: (await articleRow())?.publicAt?.toISOString(),
-      /* Nothing on this fixture carries a `profileHash`, and empty is a real
-         answer here rather than a gap — the block being present is the store
-         saying it can tell. The case below plants one so that this is not the
-         only reading. */
-      personalised: [],
+      /* All four, because slice 1b's fixture plants a `profileHash` on every
+         artefact — it is the canary for the field that must not reach a
+         visitor, so it has to be on all four to prove none of them carries it.
+         The order is `STEP_ORDER`'s, which is what the store walks.
+         The case below plants a mixed set, and asserts the empty reading too,
+         so this is not the only shape this field is ever seen in. */
+      personalised: ["tweets", "glossary", "summary", "ideas"],
     });
   });
 
@@ -640,6 +794,18 @@ when("sharing one article", { timeout: 60_000 }, () => {
    */
   it("names the personalised artefacts, and only ones that were really built", async () => {
     const db = getDb();
+    /* **Empty first, and it is a real answer rather than a gap** — the field
+       being present and empty is the store saying it looked and found none.
+       This reading used to come free from a fixture with no `profileHash` on
+       it anywhere; slice 1b's fixture plants one on all four artefacts as a
+       canary, so it is asserted deliberately here instead of being lost. */
+    await db
+      .update(articleRevisions)
+      .set({ glossary: null, summary: null, ideas: null, tweets: null })
+      .where(eq(articleRevisions.id, REVISION_ID));
+    const none = await call("GET", `/api/metadata/${SLUG}`, { as: OWNER });
+    expect((none.body.sharing as { personalised: string[] }).personalised).toEqual([]);
+
     await db
       .update(articleRevisions)
       .set({
@@ -672,6 +838,10 @@ when("sharing one article", { timeout: 60_000 }, () => {
           profileHash: null,
         },
         ideas: null,
+        /* Nulled with the other three: this case's whole claim is about which
+           artefacts are listed, and a thread left over from the fixture — which
+           carries a `profileHash` — would put a fourth name in the list. */
+        tweets: null,
       })
       .where(eq(articleRevisions.id, REVISION_ID));
     try {
@@ -687,9 +857,10 @@ when("sharing one article", { timeout: 60_000 }, () => {
         expect(sharing.personalised, step).not.toContain(step);
       }
     } finally {
+      /* **The fixture back, not four nulls.** See `ARTEFACTS`. */
       await db
         .update(articleRevisions)
-        .set({ glossary: null, summary: null, ideas: null })
+        .set(ARTEFACTS)
         .where(eq(articleRevisions.id, REVISION_ID));
     }
   });
COMMIT 2f8439d The payload answers the question the second request used to ask

diff --git a/src/web/public-artefacts.ts b/src/web/public-artefacts.ts
new file mode 100644
index 0000000..2daf165
--- /dev/null
+++ b/src/web/public-artefacts.ts
@@ -0,0 +1,75 @@
+/**
+ * **Which artefacts a shared payload turned out to have** — the one place the
+ * client turns *keys that are present* into the five booleans everything else
+ * reads.
+ *
+ * ## Why this exists at all, which is the interesting half
+ *
+ * Until slice 1b the answer came from a **second request**:
+ * `GET /api/public/metadata/:slug`, fetched immediately after the article,
+ * purely so a marked mode could pick between two true sentences. Its failure
+ * was swallowed to `null`, and `null` needed a fifth `VisitorGap` member and a
+ * sentence of its own so that a lost request would not be rendered as a claim
+ * about somebody's article.
+ *
+ * The four artefacts ride on the article payload now, so the payload answers
+ * the question it used to ask: **a key that is present exists, and a key that
+ * is absent was never built.** The request goes, its swallowed `catch` goes,
+ * and the state that hedged it goes with them.
+ * docs/plans/260827ai-public-read-only-access.md § The second request disappears.
+ *
+ * **`GET /api/public/metadata/:slug` itself stays.** It is tested, it is in the
+ * route inventory, and it is the honest small answer to *what does this article
+ * have* for a later consumer — stage 2's link-preview function among them. What
+ * was won here was never the route; it was the request.
+ *
+ * ## `in`, not truthiness, and not length
+ *
+ * A stored `{entries: []}` is a **ready but empty** artefact: somebody ran the
+ * step and it found no terms. That is a different sentence from *nobody has
+ * built a glossary for this piece yet*, and the reader is entitled to the
+ * difference. So the test is presence of the key. A truthiness test on the
+ * document agrees today, because an artefact is an object; a length test on
+ * what is inside it collapses the two outright, which is the mutation
+ * tests/visitor-gaps.test.ts runs as its control.
+ */
+import type { PublicArtefactSet, PublicArtefacts, PublicArticle } from "../public-types.js";
+
+/**
+ * The four artefacts, lifted off the payload into an object that holds nothing
+ * else.
+ *
+ * `PublicArticle` already *extends* `PublicArtefactSet`, so passing the whole
+ * payload down would typecheck and would be one line shorter. It is written out
+ * instead for the same reason the DTOs on the server construct rather than
+ * spread: the type would be the only fence, and the prose, the blocks and the
+ * tree would still be sitting there at runtime for the first `as` to reach.
+ * The reading view has an `Article` for those, sanitised, by a different route.
+ */
+export function artefactsOf(article: PublicArticle): PublicArtefactSet {
+  return {
+    /* Conditional spreads, because absent is the answer that means *never
+       built* — see the note above on `in` rather than truthiness. */
+    ...(article.glossary === undefined ? {} : { glossary: article.glossary }),
+    ...(article.summary === undefined ? {} : { summary: article.summary }),
+    ...(article.ideas === undefined ? {} : { ideas: article.ideas }),
+    ...(article.tweets === undefined ? {} : { tweets: article.tweets }),
+  };
+}
+
+/**
+ * The five booleans, from the payload the page is already rendering.
+ *
+ * `arc` is read off the article rather than out of the artefact set, because it
+ * has ridden along inside the article payload since slice 1a — it is the L0
+ * column of the granularity zoom, not a mode of its own.
+ */
+export function artefactsIn(article: PublicArticle): PublicArtefacts {
+  return {
+    arc: article.arc !== undefined,
+    tweets: article.tweets !== undefined,
+    glossary: article.glossary !== undefined,
+    summary: article.summary !== undefined,
+    ideas: article.ideas !== undefined,
+  };
+}
COMMIT 113ce17 Delete the request, and the state that existed to hedge it

diff --git a/src/messages.ts b/src/messages.ts
index 7cf1c82..d8f1e91 100644
--- a/src/messages.ts
+++ b/src/messages.ts
@@ -1159,6 +1159,15 @@ export const MAKE_AN_ACCOUNT = "Make a free account";
  * first — a gap where a glossary would be teaches a visitor that the feature is
  * broken.
  *
+ * **It is the only artefact sentence now.** Two others stood beside it until
+ * slice 1b: *"There is a glossary for this piece, but a shared link does not
+ * carry it yet"*, and *"A shared link does not carry a glossary yet"* for when
+ * a second request had failed and we did not know which of the two was true.
+ * A shared link carries all four artefacts now, and there is no second request
+ * to fail, so both were deleted with the `VisitorGap` members that produced
+ * them — src/web/visitor.ts. A sentence with no cause is one that gets shown by
+ * mistake.
+ *
  * `noun` is a noun phrase with its article: `"a glossary"`, `"a summary"`.
  */
 export function notBuiltYet(noun: string): string {
@@ -1166,40 +1175,22 @@ export function notBuiltYet(noun: string): string {
 }
 
 /**
- * **It exists, and a shared link does not carry it yet.** A fourth state, and
- * it is temporary: slice 1b adds the public endpoints for glossary, summaries,
- * ideas and tweets, and this sentence goes with the slice that makes it false.
- *
- * It is worth having rather than folding into `notBuiltYet`, which would be a
- * lie about somebody's article, or into `signedInOnly`, which would promise
- * that an account is the fix when the fix is us shipping the endpoint.
- * `PublicMetadata.available` is the field that tells the two apart —
- * src/public-types.ts.
- */
-export function notOnSharedLinksYet(noun: string): string {
-  return `There is ${noun} for this piece, but a shared link does not carry it yet.`;
-}
-
-/**
- * **We could not find out whether it exists**, and the sentence above must not
- * be used for it.
- *
- * `available` is `null` when `GET /api/public/metadata/:slug` did not land, and
- * until 2026-08-28 that fell through to `notOnSharedLinksYet` — whose first two
- * words are *"There is"*. A network failure was being rendered as a claim about
- * somebody's article. GPT Sol found it reviewing the client half.
- *
- * So this says only the half we know. *A shared link does not carry a glossary
- * yet* is unconditionally true in this slice whatever the flags would have
- * said, and it asserts nothing about whether one was ever written.
- *
- * **Deliberately close to `notOnSharedLinksYet` and deliberately not the same.**
- * The two differ by exactly the claim that separates them — one says the piece
- * has the thing, the other declines to. A reader who saw both would notice; a
- * reader who saw one cannot be misled by it.
+ * **Somebody built it and it came back with nothing in it.**
+ *
+ * The state absence cannot express, and slice 1b is what made it reachable: a
+ * shared link now carries the artefacts themselves, and *there is no glossary
+ * key on this payload* is a different fact from *there is one and its list is
+ * empty*. The first means nobody has run the step; the second means somebody
+ * ran it and it found no terms, which is a real answer about the piece.
+ *
+ * Collapsing the two would libel the article in one direction or the pipeline
+ * in the other, and a truthiness or a length test in the client is exactly how
+ * that happens — src/web/public-artefacts.ts.
+ *
+ * `noun` is capitalised and carries its article: `"A glossary"`, `"A summary"`.
  */
-export function availabilityUnknown(noun: string): string {
-  return `A shared link does not carry ${noun} yet.`;
+export function builtButEmpty(noun: string): string {
+  return `${noun} was built for this piece, and it came back with nothing in it.`;
 }
 
 /**
diff --git a/src/web/App.tsx b/src/web/App.tsx
index d83e904..78f3545 100644
--- a/src/web/App.tsx
+++ b/src/web/App.tsx
@@ -8,7 +8,16 @@ import {
   useState,
 } from "react";
 import { throttle, useQueryState } from "nuqs";
-import type { Article, Block, BlockId, ReviewStance, ThreadKind } from "../types.js";
+import type {
+  Article,
+  Block,
+  BlockId,
+  GlossaryEntry,
+  Idea,
+  ReviewStance,
+  SummaryEntry,
+  ThreadKind,
+} from "../types.js";
 import { Library } from "./Library.js";
 import { AuthCallback } from "./AuthCallback.js";
 import { HomeLogo } from "./HomeLogo.js";
@@ -100,6 +109,8 @@ import {
   textParam,
   threadParam,
   type Mode,
+  type Rung,
+  type TermSort,
 } from "./params.js";
 import {
   arrivalTarget,
@@ -124,12 +135,20 @@ import { anchored, countByBlock, useChatAnchors } from "./useChatAnchors.js";
 import { PILL } from "./pill.js";
 import { pageTitle, useDocumentTitle } from "./page-title.js";
 import { apiFetch, readJson } from "./lib/api.js";
-import { loadPublicArticle, loadPublicMetadata } from "./public-api.js";
-import type { PublicArtefacts } from "../public-types.js";
+import { loadPublicArticle } from "./public-api.js";
+import type {
+  PublicArtefactSet,
+  PublicArtefacts,
+  PublicArticle,
+  PublicGlossary,
+  PublicIdeas,
+  PublicSummaries,
+} from "../public-types.js";
+import { artefactsIn, artefactsOf } from "./public-artefacts.js";
 import { NO_COMMENTS, NO_TERMS, NO_THREADS, type ReaderCapability } from "./reader-capability.js";
-import { markedModes, tweetsGap, visitorGap } from "./visitor.js";
+import { markedModes, visitorGap } from "./visitor.js";
 import { NotSharedPage, SharedNotice, ViewOnlyChip, VisitorBand } from "./PublicChrome.js";
-import { PublicMetadataPage, VisitorPage } from "./PublicPages.js";
+import { PublicMetadataPage, VisitorTweetsPage } from "./PublicPages.js";
 import { useRenderCount } from "./perf.js";
 
 /**
@@ -153,6 +172,24 @@ const EVERY_MODE_AVAILABLE: ReadonlyMap<Mode, string> = new Map();
  */
 const EMPTY_DEPTHS: number[] = [];
 
+/**
+ * The artefact flags an owner is handed, and nothing reads them.
+ *
+ * `visitorGap` and `markedModes` take a non-optional `PublicArtefacts` since
+ * slice 1b — there is no second request to have failed, so there is no `null`
+ * to mean *we could not check*. The owner's path never asks either function
+ * anything: every gate in `Reader` tests `owner` first. This is what the
+ * compiler is given so that the absence of a question does not need an absent
+ * answer. src/web/visitor.ts.
+ */
+const OWNER_HAS_EVERYTHING: PublicArtefacts = {
+  arc: true,
+  tweets: true,
+  glossary: true,
+  summary: true,
+  ideas: true,
+};
+
 
 
 /**
@@ -308,17 +345,31 @@ type ArticleAccess =
       kind: "public";
       article: Article;
       /**
-       * Which artefacts this piece has — `null` when that second request did
-       * not land.
+       * **The glossary, the summaries, the ideas and the tweet thread**, as
+       * they arrived — inside the same payload as the prose.
+       *
+       * A separate field rather than left on the article because the reading
+       * view takes an `Article`, which is the shape the owner's path also
+       * produces; these four have no owner-side equivalent to be confused with.
+       * Lifted out in `resolveAccess`, which is also the doorway `sanitizeArticle`
+       * runs at — the artefacts do not go through it because nothing renders
+       * them as HTML, and `block.html` is the only field on this page that
+       * reaches `innerHTML`. src/web/sanitize.ts.
+       */
+      artefacts: PublicArtefactSet;
+      /**
+       * Which artefacts this piece has, as five booleans, derived from the
+       * payload above rather than fetched.
        *
-       * A separate field rather than folded into the article, because the two
-       * come from two endpoints and one may arrive without the other. What must
-       * not happen is a failed metadata fetch turning into *"nobody has built a
-       * glossary for this piece"*, which is a claim about somebody's article
-       * made out of a network failure. `visitorGap` in visitor.ts is where that
-       * distinction is enforced.
+       * It used to be `PublicArtefacts | null`, filled by a **second** request
+       * to `GET /api/public/metadata/:slug` whose failure was swallowed to
+       * `null` — and `null` needed a `VisitorGap` member and a sentence of its
+       * own so that a lost request would not be rendered as a claim about
+       * somebody's article. There is no second request now, so there is no
+       * `null`: either this payload arrived or the reader is looking at
+       * *this document isn't shared*. public-artefacts.ts.
        */
-      available: PublicArtefacts | null;
+      available: PublicArtefacts;
     };
 
 const LOADING: ArticleAccess = { kind: "loading" };
@@ -441,7 +492,12 @@ async function resolveAccess(slug: string, signedIn: boolean): Promise<ArticleAc
   const article = sanitizeArticle(found.article);
   return found.kind === "owned"
     ? { kind: "owned", article }
-    : { kind: "public", article, available: found.available };
+    : {
+        kind: "public",
+        article,
+        artefacts: artefactsOf(found.article),
+        available: artefactsIn(found.article),
+      };
 }
 
 /** The two-step itself: the owned route, then the public one. Raw payloads. */
@@ -451,7 +507,7 @@ async function findArticle(
 ): Promise<
   | { kind: "not-shared" }
   | { kind: "owned"; article: Article }
-  | { kind: "public"; article: Article; available: PublicArtefacts | null }
+  | { kind: "public"; article: PublicArticle }
 > {
   if (signedIn) {
     const res = await apiFetch(`/api/article/${encodeURIComponent(slug)}`);
@@ -464,16 +520,16 @@ async function findArticle(
     }
   }
 
+  /* **One request, and it used to be two.** A second `GET /api/public/metadata/:slug`
+     stood here purely to learn which artefacts existed, with its failure
+     swallowed to `null`. The artefacts are in this payload now, so the payload
+     answers that — and the endpoint itself stays, tested and in the route
+     inventory, for stage 2's link preview. The win was the request, never the
+     route. docs/plans/260827ai-public-read-only-access.md § The second request
+     disappears. */
   const read = await loadPublicArticle(slug);
   if (read.kind === "not-shared") return { kind: "not-shared" };
-
-  const available = await loadPublicMetadata(slug)
-    .then((m) => (m.kind === "ok" ? m.body.available : null))
-    /* Swallowed on purpose: the flags decide which of two true sentences a
-       visitor reads, and losing them is not worth losing the article for. */
-    .catch(() => null);
-
-  return { kind: "public", article: read.body, available };
+  return { kind: "public", article: read.body };
 }
 
 /**
@@ -583,6 +639,7 @@ function ArticlePage({
           key={slug}
           slug={slug}
           article={access.article}
+          artefacts={access.artefacts}
           available={access.available}
           signedIn={signedIn}
           view={view}
@@ -760,13 +817,16 @@ function OwnedReader({
 function VisitorArticle({
   slug,
   article,
+  artefacts,
   available,
   signedIn,
   view,
 }: {
   slug: string;
   article: Article;
-  available: PublicArtefacts | null;
+  /** The four artefacts the payload carried. reader-capability.ts § artefacts. */
+  artefacts: PublicArtefactSet;
+  available: PublicArtefacts;
   /** For the call to action, and nothing else — reader-capability.ts § signedIn. */
   signedIn: boolean;
   view: ArticleView;
@@ -782,14 +842,11 @@ function VisitorArticle({
     );
   if (view === "tweets")
     return (
-      <VisitorPage
+      <VisitorTweetsPage
         slug={slug}
         article={article}
-        view="tweets"
-        /* Derived from the wire's own flag, not a constant. It asserted "there
-           is a tweet thread for this piece" on articles whose response said
-           there was not. visitor.ts § tweetsGap. */
-        gap={tweetsGap(available)}
+        thread={artefacts.tweets}
+        available={available}
         signedIn={signedIn}
       />
     );
@@ -797,7 +854,7 @@ function VisitorArticle({
     <Reader
       slug={slug}
       article={article}
-      capability={{ kind: "visitor", available, signedIn }}
+      capability={{ kind: "visitor", artefacts, available, signedIn }}
     />
   );
 }
@@ -951,17 +1008,20 @@ function useReadingPosition(sections: Section[], layoutKey: string) {
  *
  * ## A known follow-up, measured rather than guessed
  *
- * `noExcessiveCognitiveComplexity` scores this function **49** against a
- * threshold of 25. It was **38** before the capability seam and over the
- * threshold then too, so this is not a line that was crossed here — but eleven
- * of those points are the `owner ? … : …` gates, and they are worth a number.
+ * `noExcessiveCognitiveComplexity` scores this function **54** against a
+ * threshold of 25. It was **38** before the capability seam and **49** after
+ * it, and over the threshold at every one of those, so this is not a line that
+ * was crossed here — but the gates are worth a number and the number keeps
+ * going up. Slice 1b added the last five: three `!owner && mode === "…" &&
+ * artefacts?.x` branches, and the two narrowings above them.
  *
- * The extraction that would pay it back is the **mode band dispatch**: the six
- * `owner && mode === "…"` branches near the bottom become one `<OwnerBands>`,
- * which takes about fourteen props. Greg's team lead weighed it on 2026-08-28
- * and said leave it — a fourteen-prop extraction made late and under time
- * pressure is how a lint number becomes a bug. Recorded here rather than in a
- * plan file because this is where somebody will be standing when they wonder.
+ * The extraction that would pay it back is the **mode band dispatch**: the nine
+ * `mode === "…"` branches near the bottom become one `<ModeBands>`, which takes
+ * about sixteen props. Greg's team lead weighed it on 2026-08-28 and said leave
+ * it — a sixteen-prop extraction made late and under time pressure is how a
+ * lint number becomes a bug. Worth revisiting deliberately rather than at the
+ * end of a slice. Recorded here rather than in a plan file because this is
+ * where somebody will be standing when they wonder.
  */
 function Reader({
   slug,
@@ -992,7 +1052,21 @@ function Reader({
    * drift apart. The visitor's `available` is read the same way.
    */
   const owner = capability.kind === "owner" ? capability : null;
-  const available = capability.kind === "visitor" ? capability.available : null;
+  /**
+   * The visitor's half, read the same way and for the same reason.
+   *
+   * `artefacts` is what slice 1b added: the glossary, the summaries, the ideas
+   * and the tweet thread, as **data** rather than as a loader, because they
+   * arrived inside the payload this page is already drawing.
+   * reader-capability.ts.
+   *
+   * `available` is the same fact as five booleans and it is no longer nullable:
+   * there is no second request to have failed, so there is nothing to be unsure
+   * about. For the owner it is `EVERYTHING`, which nothing reads — every gate
+   * below is on `owner` first.
+   */
+  const artefacts = capability.kind === "visitor" ? capability.artefacts : null;
+  const available = capability.kind === "visitor" ? capability.available : OWNER_HAS_EVERYTHING;
   /* Only the call to action reads this — see reader-capability.ts § signedIn.
      `true` for the owner is never consulted, since none of the chrome it gates
      is drawn for them. */
@@ -1112,6 +1186,7 @@ function Reader({
     () => buildArcColumn(geometry, article.arc),
     [geometry, article.arc],
   );
+
   /**
    * Outline mode's tree — the whole thing, down to the leaves.
    *
@@ -1291,7 +1366,15 @@ function Reader({
    * the band should not pay for a poller.
    */
   const glossaryRead = owner?.glossary ?? null;
-  const terms = glossaryRead?.glossary?.entries ?? NO_TERMS;
+  /* **A visitor's terms are underlined too**, and that is the whole of what
+     slice 1b bought here: the list is in the payload, so the dotted underlines
+     and the hover cards are a standing property of a shared article exactly as
+     they are of the owner's. `PublicGlossaryEntry` is a `GlossaryEntry` with
+     the owner's lookup absent (src/public-types.ts), so the same scan reads
+     both. `NO_TERMS` is a module constant rather than a fresh `[]`, because
+     half a dozen memos below key on it by identity — reader-capability.ts. */
+  const terms: GlossaryEntry[] =
+    glossaryRead?.glossary?.entries ?? artefacts?.glossary?.entries ?? NO_TERMS;
 
   /**
    * The glossary term the reader has *pressed* in the panel, of the many now
@@ -2094,6 +2177,10 @@ function Reader({
           Placed above the real bands rather than woven into each of their
           conditions, so that a mode added later cannot arrive without one:
           `visitorGap` answers for every member of `Mode` and fails closed. */}
+      {/* **Only when there is a gap**, and since slice 1b there usually is not:
+          a visitor whose article has a glossary opens the glossary, and
+          `visitorGap` answers `null`. What is left here is a mode the pipeline
+          never ran for this piece, and the four that cost a model call. */}
       {!owner && gap && <VisitorBand gap={gap} signedIn={signedIn} />}
       {owner && (mode === "chat" || mode === "review") && (
         <ConversationBand
@@ -2117,6 +2204,26 @@ function Reader({
           onSelected={setTerm}
         />
       )}
+      {/* **The visitor's three bands, and they are the slice.** Each is the same
+          panel as the owner's with its data injected and no hooks behind it —
+          the list arrived in this page's own payload, so there is nothing to
+          fetch and nothing to poll. A separate component per mode because a
+          hook cannot be called conditionally, which is the same reason
+          `OwnedReader` exists one level up; a separate *panel* would be two
+          designs for one list. reader-capability.ts, and
+          GlossaryPanel.tsx § GlossaryOwner.
+
+          Gated on the artefact itself rather than on `available`, so the branch
+          that renders the band and the flag that decides the sentence cannot
+          disagree: an absent key means `visitorGap` said `not-built` and the
+          `VisitorBand` above is showing instead. */}
+      {!owner && mode === "glossary" && artefacts?.glossary && (
+        <VisitorGlossaryBand
+          glossary={artefacts.glossary}
+          onJump={jumpTo}
+          onSelected={setTerm}
+        />
+      )}
       {/* No `owner &&` twin, and that is the point rather than an omission: the
           outline is drawn from the tree in the payload every reader already
           holds, reaches no artefact, and costs nothing — so a visitor gets the
@@ -2139,6 +2246,9 @@ function Reader({
       {owner && mode === "summary" && (
         <SummaryBand slug={slug} article={article} onJump={jumpTo} />
       )}
+      {!owner && mode === "summary" && artefacts?.summary && (
+        <VisitorSummaryBand article={article} summaries={artefacts.summary} onJump={jumpTo} />
+      )}
       {owner && mode === "diagram" && (
         <DiagramBand slug={slug} article={article} onJump={jumpTo} />
       )}
@@ -2152,6 +2262,16 @@ function Reader({
           onOpenKey={setOpenOccurrence}
         />
       )}
+      {!owner && mode === "ideas" && artefacts?.ideas && (
+        <VisitorIdeasBand
+          ideas={artefacts.ideas}
+          blocks={article.blocks}
+          onJump={jumpTo}
+          onFound={setIdeaFound}
+          openKey={openOccurrence}
+          onOpenKey={setOpenOccurrence}
+        />
+      )}
       {owner && mode === "search" && (
         <SearchBand
           slug={slug}
@@ -2277,6 +2397,106 @@ function IdeasBand({
 }) {
   useRenderCount("IdeasBand");
   const ideas = useIdeas(slug);
+  const band = useIdeasMode({
+    ideas: ideas.ideas,
+    /* The artefact's own clock, which src/ideas.ts fixes at write time so the
+       palette cannot reshuffle. See `useIdeasMode`. */
+    generatedAt: ideas.ideas?.generatedAt ?? "",
+    blocks,
+    onFound,
+    openKey,
+    onOpenKey,
+    onJump,
+  });
+  return (
+    <IdeasPanel
+      ideas={ideas.ideas}
+      owner={ideas}
+      {...band}
+      openKey={openKey}
+      onOpenKey={onOpenKey}
+      onJump={onJump}
+    />
+  );
+}
+
+/**
+ * **The same panel, for somebody who does not own the article.**
+ *
+ * No `useIdeas` and therefore no `useJobs`: the list came in the page's own
+ * payload. See `VisitorGlossaryBand` for why this is a second band and not a
+ * second panel.
+ */
+function VisitorIdeasBand({
+  ideas,
+  blocks,
+  onJump,
+  onFound,
+  openKey,
+  onOpenKey,
+}: {
+  ideas: PublicIdeas;
+  blocks: Block[];
+  onJump(id: BlockId): void;
+  onFound(found: Found[]): void;
+  openKey: string | null;
+  onOpenKey(key: string | null): void;
+}) {
+  useRenderCount("VisitorIdeasBand");
+  const band = useIdeasMode({
+    ideas,
+    /* **No clock, and it does not need one.** `generatedAt` seeds the tie-break
+       `assignSlots` uses to colour the ideas in a stable order, and the index
+       already breaks the tie — the artefact's timestamp is provenance the
+       public projection drops on purpose (src/public/dto.ts). What matters is
+       that every idea gets the same seed, which the empty string gives. */
+    generatedAt: "",
+    blocks,
+    onFound,
+    openKey,
+    onOpenKey,
+    onJump,
+  });
+  return (
+    <IdeasPanel
+      ideas={ideas}
+      owner={null}
+      {...band}
+      openKey={openKey}
+      onOpenKey={onOpenKey}
+      onJump={onJump}
+    />
+  );
+}
+
+/**
+ * Everything the ideas band does that is not a fetch: `?idea=`, the colour
+ * slots, and the resolved passages it pushes up.
+ *
+ * What it pushes up is the **resolved** passages, not the stored occurrences.
+ * The panel and the prose have to be showing the same set, and the only way to
+ * guarantee that is for one of them to compute it and hand it to the other —
+ * the same rule `SearchBand` follows. Resolution can drop occurrences (a block
+ * the article no longer has), so a panel counting the stored list would say
+ * "2 of 5" and step through three.
+ */
+function useIdeasMode({
+  ideas,
+  generatedAt,
+  blocks,
+  onFound,
+  openKey,
+  onOpenKey,
+  onJump,
+}: {
+  ideas: { ideas: Idea[] } | null;
+  generatedAt: string;
+  blocks: Block[];
+  onFound(found: Found[]): void;
+  openKey: string | null;
+  onOpenKey(key: string | null): void;
+  onJump(id: BlockId): void;
+}) {
   const [ideaId, setIdeaId] = useQueryState("idea", ideaParam);
 
   /* The palette slot, assigned over **every** idea rather than only the
@@ -2284,19 +2504,18 @@ function IdeasBand({
      the same guarantee `assignSlots` gives saved searches, and the same reason
      App.tsx calls it over all runs rather than the active ones.
 
-     `generatedAt` for every idea, so `inCreationOrder` walks them in the order
-     the artefact stores — which src/ideas.ts fixes at write time precisely so
-     this cannot reshuffle. Ideas have no clock of their own; the artefact's is
-     the honest stand-in, and the index breaks the tie. */
+     A clock for every idea, so `inCreationOrder` walks them in the order the
+     artefact stores — which src/ideas.ts fixes at write time precisely so this
+     cannot reshuffle. Ideas have no clock of their own; the artefact's is the
+     honest stand-in, and the index breaks the tie. */
   const slots = useMemo(() => {
-    const list = ideas.ideas?.ideas ?? [];
-    const at = ideas.ideas?.generatedAt ?? "";
-    return assignSlots(list.map((idea, i) => ({ id: idea.id, createdAt: `${at}#${i}` })));
-  }, [ideas.ideas]);
+    const list = ideas?.ideas ?? [];
+    return assignSlots(list.map((idea, i) => ({ id: idea.id, createdAt: `${generatedAt}#${i}` })));
+  }, [ideas, generatedAt]);
 
   const selected = useMemo(
-    () => ideas.ideas?.ideas.find((i) => i.id === ideaId) ?? null,
-    [ideas.ideas, ideaId],
+    () => ideas?.ideas.find((i) => i.id === ideaId) ?? null,
+    [ideas, ideaId],
   );
 
   /* Document order, so the stepper's "2 of 4" counts the way the reader moves
@@ -2384,26 +2603,20 @@ function IdeasBand({
     [onFound, onOpenKey],
   );
 
-  return (
-    <IdeasPanel
-      {...ideas}
-      ideaId={ideaId}
-      onIdea={(next) => {
-        void setIdeaId(next);
-        /* A new idea means the old occurrence is meaningless — its key names an
-           idea nobody is looking at, so the stepper would read "0 / 3". */
-        onOpenKey(null);
-        /* Only on selecting, never on clearing: pressing the open idea again
-           takes the marks away, and throwing the reader down the article as it
-           does would be the opposite of what that gesture means. */
-        wantsJump.current = next !== null;
-      }}
-      found={found}
-      openKey={openKey}
-      onOpenKey={onOpenKey}
-      onJump={onJump}
-    />
-  );
+  return {
+    ideaId,
+    onIdea: (next: string | null) => {
+      void setIdeaId(next);
+      /* A new idea means the old occurrence is meaningless — its key names an
+         idea nobody is looking at, so the stepper would read "0 / 3". */
+      onOpenKey(null);
+      /* Only on selecting, never on clearing: pressing the open idea again
+         takes the marks away, and throwing the reader down the article as it
+         does would be the opposite of what that gesture means. */
+      wantsJump.current = next !== null;
+    },
+    found,
+  };
 }
 
 /**
@@ -2737,6 +2950,62 @@ function GlossaryBand({
 }) {
   useRenderCount("GlossaryBand");
   const glossary = useGlossary(slug, read);
+  const band = useGlossaryMode(glossary.glossary?.entries ?? NO_TERMS, onSelected);
+
+  return (
+    <GlossaryPanel
+      glossary={glossary.glossary}
+      owner={glossary}
+      {...band}
+      onJump={onJump}
+    />
+  );
+}
+
+/**
+ * **The same panel, for somebody who does not own the article.**
+ *
+ * No `useGlossary`, no `useJobs`, no fetch of any kind: the list came in the
+ * page's own payload (src/public-types.ts § PublicArtefactSet), so this
+ * component is the query parameters and nothing else.
+ *
+ * A second *band* rather than a second *panel*, and the difference is the whole
+ * design. `GlossaryBand` above exists because hooks cannot be called
+ * conditionally, so "a visitor does not poll the job list" has to be a component
+ * boundary — but everything a reader looks at is drawn by one `GlossaryPanel`
+ * with its data injected. Two panels for one list is how the owner's glossary
+ * and the visitor's glossary drift into two designs for one thing, which a
+ * browser pass caught once already in a drawer heading.
+ */
+function VisitorGlossaryBand({
+  glossary,
+  onJump,
+  onSelected,
+}: {
+  glossary: PublicGlossary;
+  onJump(id: BlockId): void;
+  onSelected(selection: TermSelection | null): void;
+}) {
+  useRenderCount("VisitorGlossaryBand");
+  const band = useGlossaryMode(glossary.entries, onSelected);
+  return <GlossaryPanel glossary={glossary} owner={null} {...band} onJump={onJump} />;
+}
+
+/**
+ * Everything the glossary band does that is not a fetch — the three parameters
+ * and the selection it pushes back up.
+ *
+ * A hook rather than a base component, because two bands need all of it and
+ * only one of them may call `useGlossary`. `?term=`, `?sort=` and `?gate=` live
+ * here for the reason they used to live in the band: all three are meaningless
+ * outside glossary mode, and reading them in `Reader` would put three parameter
+ * subscriptions on every render of the reading view for values only this mode
+ * uses.
+ */
+function useGlossaryMode(
+  entries: readonly GlossaryEntry[],
+  onSelected: (selection: TermSelection | null) => void,
+) {
   const [termId, setTermId] = useQueryState("term", termParam);
   const [sort, setSort] = useQueryState("sort", sortParam);
   /* Null is "nobody has touched the threshold", which the panel resolves to
@@ -2744,10 +3013,10 @@ function GlossaryBand({
      stays one number in one file — see `gateParam` in params.ts. */
   const [gate, setGate] = useQueryState("gate", gateParam);
 
-  /* `find` returns the entry object out of `glossary.entries`, so its identity
-     is stable across renders until the list itself is refetched — which is what
-     keeps the effect below from firing on every render. */
-  const selected = glossary.glossary?.entries.find((e) => e.id === termId) ?? null;
+  /* `find` returns the entry object out of the list, so its identity is stable
+     across renders until the list itself is replaced — which is what keeps the
+     effect below from firing on every render. */
+  const selected = entries.find((e) => e.id === termId) ?? null;
 
   useEffect(() => {
     onSelected(
@@ -2766,18 +3035,14 @@ function GlossaryBand({
      a visible flicker. */
   useEffect(() => () => onSelected(null), [onSelected]);
 
-  return (
-    <GlossaryPanel
-      {...glossary}
-      termId={termId}
-      onTerm={(id) => void setTermId(id)}
-      sort={sort}
-      onSort={(next) => void setSort(next)}
-      gate={gate}
-      onGate={(next) => void setGate(next)}
-      onJump={onJump}
-    />
-  );
+  return {
+    termId,
+    onTerm: (id: string | null) => void setTermId(id),
+    sort,
+    onSort: (next: TermSort) => void setSort(next),
+    gate,
+    onGate: (next: number | null) => void setGate(next),
+  };
 }
 
 /**
@@ -3077,16 +3342,50 @@ function SummaryBand({
 }) {
   useRenderCount("SummaryBand");
   const summaries = useSummaries(slug);
+  const band = useSummaryMode(article, summaries.summaries);
+  return <SummaryPanel summaries={summaries.summaries} owner={summaries} {...band} onJump={onJump} />;
+}
+
+/**
+ * **The same panel, for somebody who does not own the article.**
+ *
+ * No `useSummaries` and therefore no `useJobs`: the ladder came in the page's
+ * own payload. See `VisitorGlossaryBand` for why this is a second band and not
+ * a second panel.
+ */
+function VisitorSummaryBand({
+  article,
+  summaries,
+  onJump,
+}: {
+  article: Article;
+  summaries: PublicSummaries;
+  onJump(id: BlockId): void;
+}) {
+  useRenderCount("VisitorSummaryBand");
+  const band = useSummaryMode(article, summaries);
+  return <SummaryPanel summaries={summaries} owner={null} {...band} onJump={onJump} />;
+}
+
+/**
+ * Everything the summary band does that is not a fetch.
+ *
+ * `?len=` and `?deep=` live here for the reason they used to live in the band:
+ * both are meaningless outside summary mode, and reading them in `Reader` would
+ * put two parameter subscriptions on every render of the reading view for
+ * values only this mode uses.
+ */
+function useSummaryMode(article: Article, summaries: { entries: SummaryEntry[] } | null) {
   const [rung, setRung] = useQueryState("len", rungParam);
   const [deep, setDeep] = useQueryState("deep", deepParam);
 
-  /* The join: the tree, plus whatever `summary.json` has for it, matched by
-     block range and never by node id — see tree.js § the summaries. Memoised on
-     the artefact rather than on the hook, whose object identity changes on
-     every poll of the job queue. */
+  /* The join: the tree, plus whatever summaries exist, matched by block range
+     and never by node id — see tree.js § the summaries. Memoised on the
+     artefact rather than on the hook, whose object identity changes on every
+     poll of the job queue. */
   const root = useMemo(
-    () => buildSummaryTree(article.tree, article.blocks, summaries.summaries),
-    [article.tree, article.blocks, summaries.summaries],
+    () => buildSummaryTree(article.tree, article.blocks, summaries),
+    [article.tree, article.blocks, summaries],
   );
 
   /* Read, never written, and not a subscription: `?at=` is already tracked by
@@ -3108,26 +3407,22 @@ function SummaryBand({
   /* Id to plain text, for the block ids the summaries cite: the panel needs it
      to tell a real id from an invented one, and to put the paragraph in a
      chip's hover card. The same map `Reader` builds for chat — built again
-     here rather than threaded down, because this band is rendered only in its
-     own mode and a prop would make every reader of every article pay for it. */
-  const blockText = useMemo(
+     here rather than threaded down, because this mode is rendered only in its
+     own band and a prop would make every reader of every article pay for it. */
+  const blocks = useMemo(
     () => new Map(article.blocks.map((b) => [b.id, b.text])),
     [article.blocks],
   );
 
-  return (
-    <SummaryPanel
-      {...summaries}
-      root={root}
-      blocks={blockText}
-      rung={rung}
-      onRung={(next) => void setRung(next)}
-      deep={deep}
-      onDeep={(next) => void setDeep(next)}
-      atRow={atRow}
-      onJump={onJump}
-    />
-  );
+  return {
+    root,
+    blocks,
+    rung,
+    onRung: (next: Rung) => void setRung(next),
+    deep,
+    onDeep: (next: number) => void setDeep(next),
+    atRow,
+  };
 }
 
 /**
diff --git a/src/web/reader-capability.ts b/src/web/reader-capability.ts
index 9c5e1d6..d1d6a3d 100644
--- a/src/web/reader-capability.ts
+++ b/src/web/reader-capability.ts
@@ -32,7 +32,7 @@
  * chrome one thing rather than two.
  */
 import type { Glossary, ThreadSummary } from "../types.js";
-import type { PublicArtefacts } from "../public-types.js";
+import type { PublicArtefactSet, PublicArtefacts } from "../public-types.js";
 import type { GlossaryRead } from "./useGlossary.js";
 import type { ChatAnchorsApi } from "./useChatAnchors.js";
 import type { ClientComment, CommentsApi } from "./useComments.js";
@@ -50,13 +50,43 @@ export type ReaderCapability =
   | {
       kind: "visitor";
       /**
-       * Which artefacts this piece has, from `GET /api/public/metadata/:slug` —
-       * or `null` when that request did not land.
+       * **The artefacts this piece has, as data rather than as a loader.**
        *
-       * It decides one thing: which of two true sentences a marked mode shows.
-       * visitor.ts.
+       * This is what slice 1b added, and the shape is the point. The owner's
+       * arm above carries three *hooks' results* — a `CommentsApi`, a
+       * `ChatAnchorsApi`, a `GlossaryRead`, each of which has a status, an
+       * error and a set of verbs, because each of them is a request in flight.
+       * A visitor's glossary is none of those things: it arrived inside the
+       * page's own payload, so there is nothing to be loading, nothing to have
+       * failed, and nothing to ask for.
+       *
+       * GPT Sol's design for this slice specified a four-state
+       * `PublicArtefactRead<T>` — loading, ready, not-generated, unavailable —
+       * because it also specified four sibling endpoints. Greg's decision that
+       * there are none takes all four states with it: **an artefact that exists
+       * is a key that is present.** src/public-types.ts § PublicArtefactSet.
+       *
+       * Which is also why this is not `GlossaryRead` with its fields left null.
+       * The rule this file exists to keep is one member up: the visitor arm has
+       * no `comments` field to be empty, so there is nothing for a later edit
+       * to read. A nulled-out owner shape would have put that back.
+       */
+      artefacts: PublicArtefactSet;
+      /**
+       * The same fact as five booleans, derived once at the seam.
+       *
+       * The marked modes and the visitor's metadata page both ask *does this
+       * piece have one* rather than *give me the list*, and they ask it about
+       * `arc` too, which is not in the set above because it has ridden inside
+       * the article payload since slice 1a. Derived rather than fetched:
+       * `GET /api/public/metadata/:slug` used to answer this and the second
+       * request is gone. public-artefacts.ts.
+       *
+       * **Not nullable any more.** It was `PublicArtefacts | null`, where
+       * `null` meant that second request had failed — which is the state slice
+       * 1b deleted along with the request. visitor.ts § VisitorGap.
        */
-      available: PublicArtefacts | null;
+      available: PublicArtefacts;
       /**
        * **Whether there is a session — the one question the chrome asks that is
        * not "is this mine".**
diff --git a/src/web/visitor.ts b/src/web/visitor.ts
index 9160208..6194f2c 100644
--- a/src/web/visitor.ts
+++ b/src/web/visitor.ts
@@ -1,6 +1,6 @@
 /**
  * **What a visitor is told when they press a mode they cannot have** — and
- * which of the four sentences it is.
+ * which of the three sentences it is.
  *
  * "Visitor" means anyone who does not own the document: signed out, or signed
  * in and reading somebody else's. Keyed on *is this mine*, never on *am I
@@ -15,76 +15,111 @@
  * products that get it right name the cause.
  * docs/research/260828a-public-access-how-others-do-it.md.
  *
- * Three of these live in the reading view and one is a whole page, so there is
- * no single component that renders all four and could be tested for telling
- * them apart. A function can be — tests/visitor-gaps.test.ts sweeps every mode
- * against both answers `PublicMetadata.available` can give and asserts the four
- * are distinguishable.
+ * These live in the reading view, in the comments drawer and on a whole page of
+ * its own, so there is no single component that renders them all and could be
+ * tested for telling them apart. A function can be — tests/visitor-gaps.test.ts
+ * sweeps every mode against every artefact and asserts the sentences are
+ * distinguishable.
+ *
+ * **Since slice 1b the commonest answer is `null`.** A visitor gets the
+ * glossary, the summaries, the ideas and the tweet thread, so the question this
+ * file answers is no longer *which excuse* but *is there anything in the way at
+ * all* — and for three of the eight modes, on an article that has them, there
+ * is not.
  *
  * The sentences themselves are in src/messages.ts, like every other sentence a
  * reader sees. This file decides *which*.
  */
 import type { PublicArtefacts } from "../public-types.js";
-import {
-  availabilityUnknown,
-  notBuiltYet,
-  notOnSharedLinksYet,
-  ownersOnly,
-  readersOwnWork,
-} from "../messages.js";
+import { notBuiltYet, ownersOnly, readersOwnWork } from "../messages.js";
 import { MODES, type Mode } from "./params.js";
 
 /**
  * Why this mode is not available here.
  *
- * Four members, and the discriminant is the *cause* rather than the remedy —
- * two of them are fixed by making an account, one by us shipping slice 1b, and
- * one by nothing at all, because it is a boundary rather than a gap.
+ * **Three members since slice 1b, and it used to be five.** The discriminant is
+ * the *cause* rather than the remedy, and what is left are three causes rather
+ * than two causes and two uncertainties:
+ *
+ *  - `not-yet-public` said *it exists, and a shared link does not carry it yet*.
+ *    Slice 1b is what carries all four artefacts, so nothing can produce it any
+ *    more, and a union member with no cause is a sentence waiting to be shown
+ *    by mistake.
+ *  - `availability-unknown` said *we could not find out whether it exists*. It
+ *    existed because the flags came from a **second** request that could fail
+ *    on its own. The artefacts are in the article payload now, so either that
+ *    payload arrived — and we know exactly what it holds — or it did not, and
+ *    the reader never reaches a mode at all, because the page renders *this
+ *    document isn't shared* or an error instead.
+ *
+ * Deleting a defensive state deserves more suspicion than adding one, so the
+ * claim is written narrowly and it is checkable: **there is no path on which a
+ * visitor is rendering a mode and does not know whether its artefact exists.**
+ * `visitorGap` takes a non-optional `PublicArtefactSet` now, so the compiler
+ * asks the same question of every future caller.
  */
 export type VisitorGap =
   /** The pipeline never ran for this piece. Nobody's fault. */
   | { kind: "not-built"; noun: string }
-  /** It exists, and slice 1b has not shipped the public endpoint that would carry it. */
-  | { kind: "not-yet-public"; noun: string }
-  /**
-   * **We could not find out whether it exists.** The metadata request did not
-   * land, so the flags are absent.
-   *
-   * The fifth member, added 2026-08-28, and it exists because a `null` used to
-   * fall through to `not-yet-public` — whose sentence begins *"There is"*. A
-   * network failure was rendered as a claim about somebody's article.
-   *
-   * It must not swallow `not-yet-public` either: one says the piece has the
-   * thing and this one declines to, which is the whole difference between them.
-   */
-  | { kind: "availability-unknown"; noun: string }
   /** It works, it costs a model call, and it is the owner's. */
   | { kind: "owners-only"; feature: string }
   /** It is the owner's own annotation, and sharing an article does not share it. */
   | { kind: "readers-own"; plural: string };
 
 /**
- * The three answers about an artefact, chosen by what the flags say.
+ * **The one answer about an artefact, and `null` is now one of the two.**
  *
- * One function because three call sites need it — the two artefact modes, and
- * the tweets *page*, which had a hardcoded `not-yet-public` constant and so
- * claimed a thread existed even when the wire said `tweets: false`. GPT Sol,
- * 2026-08-28.
+ * Before slice 1b this had three answers and none of them was "you can have
+ * it": every artefact was withheld, and the only question was which true
+ * sentence to say about the withholding. Now the flag decides whether there is
+ * a gap at all — a piece that has a glossary shows its glossary, and `null`
+ * means nothing stands in the way.
+ *
+ * One function because three call sites need it: the two artefact modes and the
+ * tweets *page*, which had a hardcoded gap constant and so claimed a thread
+ * existed even when the wire said `tweets: false`. GPT Sol, 2026-08-28.
  */
-function artefactGap(
-  noun: string,
-  has: keyof PublicArtefacts,
-  available: PublicArtefacts | null,
-): VisitorGap {
-  if (available === null) return { kind: "availability-unknown", noun };
-  return available[has] ? { kind: "not-yet-public", noun } : { kind: "not-built", noun };
+function artefactGap(has: keyof PublicArtefacts, available: PublicArtefacts): VisitorGap | null {
+  return available[has] ? null : notBuiltGap(has);
 }
 
-/** The noun phrase each artefact mode is called in a sentence, article included. */
-const ARTEFACT: Partial<Record<Mode, { noun: string; has: keyof PublicArtefacts }>> = {
-  summary: { noun: "a summary", has: "summary" },
-  glossary: { noun: "a glossary", has: "glossary" },
-  ideas: { noun: "a list of ideas", has: "ideas" },
+/**
+ * **The noun phrase each artefact is called in a sentence, article included.**
+ *
+ * One table, so that the tweet thread on its own page and the three modes in
+ * the reading view cannot end up calling the same thing two names.
+ */
+const NOUN: Record<keyof PublicArtefacts, string> = {
+  arc: "an arc through the argument",
+  summary: "a summary",
+  glossary: "a glossary",
+  ideas: "a list of ideas",
+  tweets: "a tweet thread",
+};
+
+/**
+ * *Nobody has built one of these yet*, for a caller that has already
+ * established the artefact is absent.
+ *
+ * **`VisitorTweetsPage` is the one caller, and this replaced a `tweetsGap`
+ * that took the five booleans.** The tweets page has to branch on the artefact
+ * key anyway — it renders the thread when there is one, and TypeScript will not
+ * narrow `artefacts.tweets` from the return value of a policy function — so a
+ * `tweetsGap` beside that branch would have been a second answer to a question
+ * already decided, which is exactly the shape GPT Sol caught on 2026-08-28
+ * when a constant claimed a thread the wire said was absent. Branching on the
+ * key and taking the sentence from the table below is one fact and one wording.
+ * src/web/PublicPages.tsx.
+ */
+export function notBuiltGap(what: keyof PublicArtefacts): VisitorGap {
+  return { kind: "not-built", noun: NOUN[what] };
+}
+
+/** Which of the flags each artefact mode asks about. */
+const ARTEFACT: Partial<Record<Mode, keyof PublicArtefacts>> = {
+  summary: "summary",
+  glossary: "glossary",
+  ideas: "ideas",
 };
 
 /** The modes that spend, and what the button that opens them is called. */
@@ -113,18 +148,20 @@ const COSTS: Partial<Record<Mode, string>> = {
 /**
  * What stands between this visitor and this mode, or `null` if nothing does.
  *
- * `available` is `PublicMetadata.available`, or `null` when that fetch did not
- * land. **A missing answer must not become a claim about somebody's article**:
- * without the flags this says *not on shared links yet*, which is
- * unconditionally true in slice 1a whatever the flag would have said, rather
- * than *nobody has built one*, which would be a statement about the world made
- * from a failed request. docs/reusable/silent-success.md.
+ * `available` is **not optional**, and that is the whole of slice 1b's claim
+ * about the deleted `availability-unknown`. It used to be
+ * `PublicArtefacts | null`, where `null` meant *the second request did not
+ * land*; there is no second request, so the five flags are derived from the
+ * article payload the page is already rendering and there is nothing to be
+ * unsure about. A caller who does not have a payload does not have a page
+ * either. src/web/public-artefacts.ts.
  */
-export function visitorGap(mode: Mode, available: PublicArtefacts | null): VisitorGap | null {
+export function visitorGap(mode: Mode, available: PublicArtefacts): VisitorGap | null {
   /* The table of contents, the granularity zoom and the spine are the whole
      point of the feature and cost nothing: they are drawn from the tree in the
      payload the visitor already has. */
   if (mode === "toc") return null;
+
   /* Outline is the same bargain and had to be named to get it. The fall-through
      below is deliberately fail-closed, so a mode added later is owners-only
      until somebody says otherwise — which meant the plan's claim that this mode
@@ -138,7 +175,7 @@ export function visitorGap(mode: Mode, available: PublicArtefacts | null): Visit
   if (costs) return { kind: "owners-only", feature: costs };
 
   const artefact = ARTEFACT[mode];
-  if (artefact) return artefactGap(artefact.noun, artefact.has, available);
+  if (artefact) return artefactGap(artefact, available);
 
   /* Not reachable today — `Mode` is closed and every member is in one of the
      tables above. It is here rather than as a non-null assertion because a mode
@@ -150,18 +187,6 @@ export function visitorGap(mode: Mode, available: PublicArtefacts | null): Visit
 /** The same question for the two things that are not modes. */
 export const COMMENTS_GAP: VisitorGap = { kind: "readers-own", plural: "Comments" };
 
-/**
- * The tweets page, **derived rather than assumed.**
- *
- * It was a constant asserting `not-yet-public`, so `/read/:slug/tweets` told a
- * visitor *"There is a tweet thread for this piece"* on an article whose wire
- * response said `tweets: false`. A sentence about somebody's article, made up
- * by a client that had been told otherwise. GPT Sol, 2026-08-28.
- */
-export function tweetsGap(available: PublicArtefacts | null): VisitorGap {
-  return artefactGap("a tweet thread", "tweets", available);
-}
-
 /**
  * Which mode buttons in the bottom bar are drawn dimmed, **and the sentence
  * each one will show when pressed.**
@@ -176,14 +201,17 @@ export function tweetsGap(available: PublicArtefacts | null): VisitorGap {
  *
  * **Derived from `MODES` rather than listed**, which is the whole reason it is
  * a function and not a constant: a mode added next month is marked for a
- * visitor whether or not whoever adds it remembers this file. That is the same
+ * visitor whether or not whoever adds it remembers this file. And it is derived
+ * from the flags too, so an artefact this piece **has** is not marked at all —
+ * since slice 1b a visitor can open the glossary, the summaries and the ideas,
+ * and a dimmed button over a band that works would be the worst of both. That is the same
  * rule the admin check in src/routes.ts states about itself — *"so a route
  * added later is behind this check whether or not whoever adds it remembers,
  * which is the only version of this that stays true"* — and it fails closed,
  * because `visitorGap` answers with a boundary for anything it does not
  * recognise.
  */
-export function markedModes(available: PublicArtefacts | null): ReadonlyMap<Mode, string> {
+export function markedModes(available: PublicArtefacts): ReadonlyMap<Mode, string> {
   const marked = new Map<Mode, string>();
   for (const mode of MODES) {
     const gap = visitorGap(mode, available);
@@ -197,10 +225,6 @@ export function visitorSentence(gap: VisitorGap): string {
   switch (gap.kind) {
     case "not-built":
       return notBuiltYet(gap.noun);
-    case "not-yet-public":
-      return notOnSharedLinksYet(gap.noun);
-    case "availability-unknown":
-      return availabilityUnknown(gap.noun);
     case "owners-only":
       return ownersOnly(gap.feature);
     case "readers-own":
@@ -213,21 +237,20 @@ export function visitorSentence(gap: VisitorGap): string {
  *
  * The sign-up line goes beside the specific thing the visitor has just found
  * they could not do — that is the whole placement rule — so it must not appear
- * beside the one gap an account does not close. A `not-yet-public` artefact
- * waits on us shipping slice 1b, and offering an account for it would be a
- * promise we would break the moment they took it.
+ * beside a gap an account does not close. Comments are the one left: they
+ * belong to whoever added the article, and until
+ * docs/plans/260827ai-public-read-only-access.md § Stage 3 an account does not change
+ * that.
+ *
+ * The two entries that used to be `false` for the other reason — *we are the
+ * ones who have not shipped it* — went with their union members in slice 1b.
  *
  * A total map rather than a comparison, for the reason `RETRYABLE` in
- * src/messages.ts gives: a fifth kind is then a red compile rather than a
+ * src/messages.ts gives: a fourth kind is then a red compile rather than a
  * silent `false`.
  */
 const FIXED_BY_AN_ACCOUNT: Record<VisitorGap["kind"], boolean> = {
   "not-built": true,
-  "not-yet-public": false,
-  /* Same as `not-yet-public`, and for a stronger reason: we do not even know
-     whether there is anything to carry, so an offer would be a guess wrapped in
-     a promise. */
-  "availability-unknown": false,
   "owners-only": true,
   "readers-own": false,
 };
diff --git a/tests/public-network-trace.test.tsx b/tests/public-network-trace.test.tsx
index e3752ef..e7ba5f1 100644
--- a/tests/public-network-trace.test.tsx
+++ b/tests/public-network-trace.test.tsx
@@ -72,7 +72,7 @@ import { createRoot, type Root } from "react-dom/client";
 import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 import type { Article } from "../src/types.js";
-import type { PublicArticle, PublicMetadata } from "../src/public-types.js";
+import type { PublicArticle, PublicMetadata, PublicTweets } from "../src/public-types.js";
 
 /** Who `useSession` says is here. Re-posed by each test before it renders. */
 const session: { user: { id: string; email: string } | null } = { user: null };
@@ -128,6 +128,21 @@ const trace: { url: string; method: string; auth: string | null }[] = [];
 
 const SLUG = "a-piece";
 
+/**
+ * **What the payload carries and nothing else could put on screen.**
+ *
+ * The trace proves no private request went out; it cannot prove the page knows
+ * which reader it is drawing for — handing `OwnedReader` a visitor capability
+ * left every trace assertion passing, because the hooks are called there either
+ * way. So each of these is a string that can only have come from
+ * `GET /api/public/article/:slug`, and each is asserted **on screen** beside
+ * the trace. That is the second assertion slice 1a's review asked every future
+ * capability seam to have.
+ */
+const PUBLIC_TERM = "Integrated information theory";
+const PUBLIC_IDEA = "Measurement precedes theory";
+const PUBLIC_TWEET = "The first post.";
+
 /**
  * A **PDF** article, because the private source control only mounts for one.
  *
@@ -205,8 +220,61 @@ const ARTICLE: PublicArticle = {
       },
     },
   },
+  /**
+   * **Asymmetric on purpose, and it is the fixture that makes slice 1b
+   * checkable at all.**
+   *
+   * A glossary and a list of ideas are here; a summary and a tweet thread are
+   * not. So one article in one run produces both of the two answers a visitor
+   * can get about an artefact — *here it is* and *nobody has built one* — and
+   * "these two blurred into one" is visible. A fixture with all four, or with
+   * none, cannot tell them apart. A browser pass made exactly this point on
+   * 2026-08-28 about the four sentences of slice 1a.
+   */
+  glossary: {
+    entries: [
+      {
+        id: "spya-term01",
+        name: PUBLIC_TERM,
+        kind: "concept",
+        aliases: [],
+        senseHere: "What the author means by it here.",
+        blocks: ["spya-bbbbbb"],
+      },
+    ],
+  },
+  ideas: {
+    ideas: [
+      {
+        id: "spya-idea01",
+        /* The **name** rather than the statement, because a closed row shows
+           only the name — a canary the page cannot draw without opening
+           something would be a canary this test never sees. */
+        name: PUBLIC_IDEA,
+        provenance: "assumed",
+        statement: "You cannot theorise about what you have no way to measure.",
+        occurrences: [
+          {
+            blockId: "spya-bbbbbb",
+            quote: "The first paragraph",
+            reasoning: "It rests on it.",
+          },
+        ],
+      },
+    ],
+  },
 };
 
+/**
+ * The thread, for the one case that needs the tweets page to have one.
+ *
+ * Kept off `ARTICLE` so that the default fixture can still prove the *absent*
+ * half — the page said *"There is a tweet thread for this piece"* about an
+ * article whose own response said there was not, and that assertion is worth
+ * keeping red-able.
+ */
+const THREAD: PublicTweets = { limit: 280, tweets: [{ text: PUBLIC_TWEET, chars: 24 }] };
+
 const METADATA: PublicMetadata = {
   slug: SLUG,
   title: "A piece",
@@ -226,7 +294,12 @@ const METADATA: PublicMetadata = {
  * below turns on being able to see it disappear.
  */
 const OWNED: Article = {
-  ...ARTICLE,
+  /* The owner's payload is an `Article`, which has no artefact keys at all —
+     theirs come from `GET /api/glossary/:slug` and its siblings. Spreading
+     `ARTICLE` would carry the public ones across and make the owner control
+     below prove less than it says. */
+  blocks: ARTICLE.blocks,
+  tree: ARTICLE.tree,
   meta: {
     ...ARTICLE.meta,
     ...PDF_META,
@@ -242,6 +315,12 @@ const OWNED: Article = {
  */
 let owned: () => Response;
 
+/**
+ * What the public article endpoint serves — `ARTICLE` unless a case says
+ * otherwise, and reset in `beforeEach` so one test cannot leak into the next.
+ */
+let served: PublicArticle;
+
 function json(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), {
     status,
@@ -257,7 +336,7 @@ function json(body: unknown, status = 200): Response {
  * full of error states — a trace of failures would be a different test.
  */
 function reply(url: string, method: string): Response {
-  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
+  if (url === `/api/public/article/${SLUG}`) return json(served);
   if (url === `/api/public/metadata/${SLUG}`) return json(METADATA);
   if (url === `/api/article/${SLUG}`) return owned();
   if (method === "POST") return new Response(null, { status: 204 });
@@ -287,6 +366,7 @@ beforeEach(() => {
   (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
   trace.length = 0;
   session.user = null;
+  served = ARTICLE;
   owned = () => json(OWNED);
   vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
     const url = String(input);
@@ -342,7 +422,7 @@ async function open(search = "", path = ""): Promise<void> {
 const outsidePublic = () => trace.filter((r) => !r.url.startsWith("/api/public/"));
 
 describe("a signed-out browser on a shared document", () => {
-  it("asks the two public endpoints and nothing else", async () => {
+  it("asks one public endpoint and nothing else", async () => {
     await open();
 
     expect(host.textContent).toContain("The first paragraph of the piece.");
@@ -353,10 +433,17 @@ describe("a signed-out browser on a shared document", () => {
        what the capability actually decides, so it is checked here and its
        absence is checked in the owner control below. */
     expect(host.textContent).toContain("View only");
-    expect(trace.map((r) => r.url)).toEqual([
-      `/api/public/article/${SLUG}`,
-      `/api/public/metadata/${SLUG}`,
-    ]);
+    /**
+     * **One request, and it used to be two.** `GET /api/public/metadata/:slug`
+     * was fetched immediately after the article, purely so a marked mode could
+     * pick between two true sentences, with its failure swallowed to `null`.
+     * The artefacts ride on the article payload since slice 1b, so the payload
+     * answers that question and the request is gone. The endpoint itself stays
+     * — it is still in the route inventory and still tested — which is why this
+     * asserts the exact list rather than a prefix.
+     * docs/plans/260827ai-public-read-only-access.md § The second request disappears.
+     */
+    expect(trace.map((r) => r.url)).toEqual([`/api/public/article/${SLUG}`]);
   });
 
   it("issues no POST, and sends no Authorization header", async () => {
@@ -394,19 +481,59 @@ describe("a signed-out browser on a shared document", () => {
    * so the two artefact sentences are produced by one article in one run, which
    * is the arrangement in which "they blurred into one" is visible.
    */
-  it("tells a missing artefact from one we do not carry yet, on screen", async () => {
+  it("tells an artefact it has from one nobody built, on screen", async () => {
     await open("?mode=summary");
-    /* `summary: false` — nobody built one. This is the state the browser pass
-       could not reach. */
+    /* No `summary` key on the payload — nobody built one. This is the state the
+       browser pass could not reach, because the article it drove had every
+       artefact. */
     expect(host.textContent).toContain("Nobody has built a summary for this piece yet");
+    expect(host.textContent).not.toContain(PUBLIC_TERM);
 
     await remount();
 
     await open("?mode=glossary");
-    /* `glossary: true` — it exists, and slice 1b has not shipped the endpoint
-       that would carry it. A different sentence, and it has to be. */
-    expect(host.textContent).toContain("does not carry it yet");
+    /**
+     * **And the glossary is really on screen**, which is the slice.
+     *
+     * `PUBLIC_TERM` can only have come from the article payload — there is no
+     * glossary endpoint in this trace and `outsidePublic()` is empty — so this
+     * is the rendered-state half that a network trace cannot give. The trace
+     * proves nothing private was asked for; this proves the page knows it is a
+     * visitor's page and drew the visitor's data.
+     */
+    expect(host.textContent).toContain(PUBLIC_TERM);
     expect(host.textContent).not.toContain("Nobody has built");
+    expect(outsidePublic()).toEqual([]);
+
+    await remount();
+
+    await open("?mode=ideas");
+    expect(host.textContent).toContain(PUBLIC_IDEA);
+    expect(outsidePublic()).toEqual([]);
+  });
+
+  /**
+   * **The owner-only controls are not on a visitor's band**, and this is the
+   * assertion the trace genuinely cannot make.
+   *
+   * Every one of these is a button or a label that only `GlossaryPanel`'s
+   * `owner` arm draws, and none of them fires a request until it is *pressed* —
+   * so a panel handed a nulled-out owner shape instead of `owner: null` would
+   * render all of them and leave the trace spotless. src/web/GlossaryPanel.tsx
+   * § GlossaryOwner.
+   */
+  it("draws none of the owner's controls on the band it does open", async () => {
+    await open("?mode=glossary");
+    expect(host.textContent).toContain(PUBLIC_TERM);
+    for (const control of [
+      "Check the web",
+      "Find more",
+      "Start again",
+      "Find the terms",
+      "Use my profile",
+    ]) {
+      expect(host.textContent, control).not.toContain(control);
+    }
   });
 
   /**
@@ -532,6 +659,27 @@ describe("a signed-out browser on a shared document", () => {
     expect(host.textContent).not.toContain("There is a tweet thread");
   });
 
+  /**
+   * **And it draws the real thread when the payload carries one** — the other
+   * half of the same branch, which is what makes the case above evidence
+   * rather than a page that always says the same thing.
+   *
+   * Still no request outside `/api/public/`: `Tweets` fetches
+   * `GET /api/tweets/:slug` and mounts `useJobs`, and neither may appear here.
+   */
+  it("renders the tweet thread the payload carries, and asks nobody for it", async () => {
+    served = { ...ARTICLE, tweets: THREAD };
+    await open("", "/tweets");
+
+    expect(host.textContent).toContain(PUBLIC_TWEET);
+    expect(host.textContent).not.toContain("Nobody has built a tweet thread");
+    /* The owner's foot: the provenance line and the button that spends. */
+    expect(host.textContent).not.toContain("Write it again");
+    expect(host.textContent).not.toContain("Written by");
+    expect(outsidePublic()).toEqual([]);
+    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
+  });
+
   /**
    * **Modes changed by pressing the buttons, not by writing the URL.**
    *
diff --git a/tests/visitor-gaps.test.ts b/tests/visitor-gaps.test.ts
index d10890c..e27dc39 100644
--- a/tests/visitor-gaps.test.ts
+++ b/tests/visitor-gaps.test.ts
@@ -1,5 +1,5 @@
 /**
- * **Four sentences, and they must not become one.**
+ * **Three sentences, and they must not become one.**
  *
  * The worked example of the failure is Notion: unpublishing a page makes every
  * old link land on a plain *"page could not be found"*, so *never existed*,
@@ -9,25 +9,39 @@
  * at this time"*; Google Docs pairs *"View only"* with *"Request edit access"*.
  * docs/research/260828a-public-access-how-others-do-it.md.
  *
- * Three of ours live in the reading view and one is a whole page, so no single
- * component renders all four and could be tested for telling them apart. That
- * is why `visitorGap` is a pure function, and this is the test it exists for.
+ * They live in the reading view, in the comments drawer and on a page of their
+ * own, so no single component renders them all and could be tested for telling
+ * them apart. That is why `visitorGap` is a pure function, and this is the test
+ * it exists for.
+ *
+ * ## What slice 1b changed here, and why this file asserts policy rather than
+ * membership
+ *
+ * There were five members and there are three. `not-yet-public` said *it exists
+ * and a shared link does not carry it yet*, and a shared link carries all four
+ * artefacts now; `availability-unknown` said *we could not find out*, and the
+ * second request that could fail is gone. So the interesting answer for an
+ * artefact is `null` — nothing stands in the way — and the sweeps below are
+ * about **what the policy is**, never about how many members the union has. A
+ * union can grow a member that says nothing new, and a count would go green on
+ * exactly that.
  *
  * **The assertions are about the `kind`, not the prose**, following the rule
  * docs/project/copy.md sets for the failure messages: copy should stay
  * rewritable without turning a test red, and a test that pins a sentence
- * quietly makes the sentence permanent. The one place a string is checked is
- * the distinctness sweep at the bottom, which asserts that the four differ from
- * each other rather than that any of them says a particular thing.
+ * quietly makes the sentence permanent. The one place strings are checked is
+ * the distinctness sweep at the bottom, which asserts that the three differ
+ * from each other rather than that any of them says a particular thing.
  */
 import { describe, expect, it } from "vitest";
-import type { PublicArtefacts } from "../src/public-types.js";
+import type { PublicArticle, PublicArtefacts } from "../src/public-types.js";
+import { artefactsIn, artefactsOf } from "../src/web/public-artefacts.js";
 import { MODES, type Mode } from "../src/web/params.js";
 import {
   anAccountWouldHelp,
   COMMENTS_GAP,
   markedModes,
-  tweetsGap,
+  notBuiltGap,
   visitorGap,
   visitorSentence,
   type VisitorGap,
@@ -65,7 +79,7 @@ const EVERYTHING_BUILT: PublicArtefacts = {
  *
  * One fixture per artefact is the shape that works: with only `ideas` built,
  * any mode reading anything other than `ideas` answers *not built* where the
- * truth is *not carried yet*.
+ * truth is *here it is*.
  */
 function only(built: keyof PublicArtefacts): PublicArtefacts {
   return {
@@ -83,56 +97,24 @@ describe("what a visitor is told, mode by mode", () => {
     // already holds, and none of it costs anything to serve.
     expect(visitorGap("toc", EVERYTHING_BUILT)).toBeNull();
     expect(visitorGap("toc", NOTHING_BUILT)).toBeNull();
-    expect(visitorGap("toc", null)).toBeNull();
   });
 
-  it("tells an artefact that was never built apart from one we do not carry yet", () => {
+  /**
+   * **The slice, in one assertion.** An artefact this piece has is not a gap at
+   * all: the visitor opens the band and reads it. An artefact nobody built is
+   * the one artefact sentence left.
+   */
+  it("gives away an artefact the piece has, and names the one it does not", () => {
+    expect(visitorGap("glossary", EVERYTHING_BUILT)).toBeNull();
     expect(visitorGap("glossary", NOTHING_BUILT)).toEqual({
       kind: "not-built",
       noun: expect.any(String),
     });
-    expect(visitorGap("glossary", EVERYTHING_BUILT)).toEqual({
-      kind: "not-yet-public",
-      noun: expect.any(String),
-    });
-  });
-
-  /**
-   * **A missing answer is not a claim about somebody's article.**
-   *
-   * `available` is `null` when the metadata request did not land. Reading that
-   * as "nobody has built a glossary" would put a statement about the world in
-   * front of a visitor on the strength of a network failure — the exact shape
-   * docs/reusable/silent-success.md keeps writing up.
-   */
-  it("does not turn a failed metadata fetch into 'nobody built one'", () => {
-    for (const mode of ["glossary", "summary", "ideas"] as const) {
-      expect(visitorGap(mode, null)?.kind).toBe("availability-unknown");
-    }
-  });
-
-  /**
-   * **And the fifth state must not swallow the fourth.**
-   *
-   * `availability-unknown` was `not-yet-public` until 2026-08-28, whose
-   * sentence begins *"There is"* — so a network failure was rendered as a claim
-   * about somebody's article. Folding them back together would be the same bug
-   * under a new name, so this compares the two **sentences** rather than
-   * counting kinds: a union can grow a member that says nothing new.
-   */
-  it("says a different thing when it does not know than when it does", () => {
-    const known = visitorSentence(visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap);
-    const unsure = visitorSentence(visitorGap("glossary", null) as VisitorGap);
-
-    expect(known).not.toBe(unsure);
-    // The one that knows may claim the piece has it; the one that does not, may not.
-    expect(known).toContain("There is");
-    expect(unsure).not.toContain("There is");
   });
 
   it("names the modes that spend as the owner's, whatever the flags say", () => {
     for (const mode of ["chat", "search", "review", "diagram"] as const) {
-      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT, null]) {
+      for (const flags of [NOTHING_BUILT, EVERYTHING_BUILT]) {
         expect(visitorGap(mode, flags)).toEqual({
           kind: "owners-only",
           feature: expect.any(String),
@@ -141,75 +123,106 @@ describe("what a visitor is told, mode by mode", () => {
     }
   });
 
-  /**
-   * **The tweets page derives its gap rather than asserting one.**
-   *
-   * It was a constant saying `not-yet-public`, so `/read/:slug/tweets` told a
-   * visitor *"There is a tweet thread for this piece"* about an article whose
-   * own wire response said `tweets: false`. GPT Sol, 2026-08-28.
-   */
+  /** The owner's own annotations, which sharing an article does not share. */
+  it("keeps the comments with whoever added the article", () => {
+    expect(COMMENTS_GAP.kind).toBe("readers-own");
+    expect(anAccountWouldHelp(COMMENTS_GAP)).toBe(false);
+  });
+
   /**
    * **Each mode reads its own flag and nobody else's.**
    *
    * Swept per artefact rather than asserted once: with only `X` built, the mode
-   * for `X` must say *not carried yet* and every other artefact mode must say
-   * *nobody built one*. A crossed wire fails on at least one row whichever pair
-   * was crossed.
+   * for `X` must be free and every other artefact mode must say *nobody built
+   * one*. A crossed wire fails on at least one row whichever pair was crossed.
    */
   it.each(["glossary", "summary", "ideas"] as const)(
     "reads its own flag when only %s is built",
     (built) => {
       const flags = only(built);
       for (const mode of ["glossary", "summary", "ideas"] as const) {
-        expect(visitorGap(mode, flags)?.kind, `${mode} when only ${built} is built`).toBe(
-          mode === built ? "not-yet-public" : "not-built",
+        expect(visitorGap(mode, flags)?.kind ?? null, `${mode} when only ${built} is built`).toBe(
+          mode === built ? null : "not-built",
         );
       }
-      // And the tweets page, which is not a mode but reads the same table.
-      expect(tweetsGap(flags).kind).toBe("not-built");
     },
   );
 
-  it("reads the tweets flag when only tweets is built", () => {
-    expect(tweetsGap(only("tweets")).kind).toBe("not-yet-public");
+  it("does not let the tweets flag stand in for a mode's", () => {
     for (const mode of ["glossary", "summary", "ideas"] as const) {
       expect(visitorGap(mode, only("tweets"))?.kind).toBe("not-built");
     }
   });
 
-  it("asks the flags about the tweet thread too", () => {
-    expect(tweetsGap(NOTHING_BUILT).kind).toBe("not-built");
-    expect(tweetsGap(EVERYTHING_BUILT).kind).toBe("not-yet-public");
-    expect(tweetsGap(null).kind).toBe("availability-unknown");
+  /**
+   * **The tweet thread's own answer is not a mode's**, and it is not decided
+   * here.
+   *
+   * `VisitorTweetsPage` branches on the artefact key itself — it has to, since
+   * it renders the thread when there is one — and takes its sentence from
+   * `notBuiltGap`. There is no `tweetsGap` beside that branch any more, because
+   * a policy function returning a value TypeScript cannot narrow on would have
+   * been a second answer to a question already decided, which is the shape GPT
+   * Sol caught on 2026-08-28. What this asserts is the half that lives here:
+   * the sentence exists and it is about a tweet thread.
+   * tests/public-network-trace.test.tsx drives both branches on the page.
+   */
+  it("has a sentence for a thread nobody wrote", () => {
+    expect(notBuiltGap("tweets")).toEqual({ kind: "not-built", noun: expect.any(String) });
+    expect(visitorSentence(notBuiltGap("tweets"))).toContain("tweet thread");
   });
 
   /**
-   * The property that keeps this true when somebody adds a ninth mode.
+   * **`markedModes` excludes what a visitor can now have**, which is the
+   * property slice 1b turned round.
    *
-   * `markedModes` derives from `MODES`, so a mode nobody thought about here is
-   * marked rather than quietly live — the fail-closed direction. Written as a
-   * sweep of every member rather than a list, so the list cannot go stale.
+   * Before it, every mode but `toc` was marked and the only question was which
+   * excuse to show. Now a marked button means the reader really cannot open the
+   * band — and the sweep is written as a derivation from `MODES` rather than a
+   * list, so a ninth mode is covered whether or not whoever adds it remembers.
    */
-  it("answers for every mode there is, and `toc` and `outline` are free", () => {
-    for (const mode of MODES) {
-      const gap = visitorGap(mode, EVERYTHING_BUILT);
-      /* `outline` is the second free mode, added 2026-08-28: like the table of
-         contents it draws from the tree in the payload the visitor already holds
-         and reaches no artefact, so it is named here deliberately rather than
-         falling through the fail-closed default. docs/plans/260828aw-outline-mode.md. */
-      if (mode === "toc" || mode === "outline") expect(gap).toBeNull();
-      else expect(gap).not.toBeNull();
-    }
-    expect([...markedModes(EVERYTHING_BUILT).keys()].sort()).toEqual(
+  it("marks only what a visitor cannot have, and derives that from MODES", () => {
+    /* Nothing built: everything but the table of contents is marked, which is
+       the old behaviour and still right for an article with no artefacts. */
+    /* `outline` joins `toc` as a mode a visitor always gets: like the table of
+       contents it is drawn from the tree in the payload they already hold and
+       reaches no artefact at all. docs/plans/260828aw-outline-mode.md. */
+    expect([...markedModes(NOTHING_BUILT).keys()].sort()).toEqual(
       MODES.filter((m: Mode) => m !== "toc" && m !== "outline")
         .slice()
         .sort(),
     );
-    /* And each entry carries the sentence the band will show, so the bar's
-       tooltip cannot drift away from it — the drift a browser pass found on
-       2026-08-28, when the two said the same fact a few words apart. */
-    for (const [mode, sentence] of markedModes(EVERYTHING_BUILT)) {
-      expect(sentence).toBe(visitorSentence(visitorGap(mode, EVERYTHING_BUILT) as VisitorGap));
+    /* Everything built: the three artefact modes drop out, and what is left is
+       the four that spend a model call. */
+    expect([...markedModes(EVERYTHING_BUILT).keys()].sort()).toEqual(
+      ["chat", "diagram", "review", "search"].sort(),
+    );
+    /* And one at a time, so a mode reading the wrong flag shows up. */
+    for (const built of ["glossary", "summary", "ideas"] as const) {
+      expect([...markedModes(only(built)).keys()], built).not.toContain(built);
+    }
+  });
+
+  it("answers for every mode there is, and gives away only what it should", () => {
+    for (const mode of MODES) {
+      const gap = visitorGap(mode, EVERYTHING_BUILT);
+      if (
+        mode === "toc" ||
+        mode === "outline" ||
+        mode === "glossary" ||
+        mode === "summary" ||
+        mode === "ideas"
+      ) {
+        expect(gap, mode).toBeNull();
+      } else {
+        expect(gap, mode).not.toBeNull();
+      }
+    }
+    /* And each marked entry carries the sentence the band will show, so the
+       bar's tooltip cannot drift away from it — the drift a browser pass found
+       on 2026-08-28, when the two said the same fact a few words apart. */
+    for (const [mode, sentence] of markedModes(NOTHING_BUILT)) {
+      expect(sentence).toBe(visitorSentence(visitorGap(mode, NOTHING_BUILT) as VisitorGap));
     }
   });
 });
@@ -218,28 +231,20 @@ describe("the sentences themselves", () => {
   /** One of each kind, so the sweeps below cover the whole union. */
   const ALL: VisitorGap[] = [
     visitorGap("glossary", NOTHING_BUILT) as VisitorGap,
-    visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap,
-    visitorGap("glossary", null) as VisitorGap,
-    visitorGap("chat", null) as VisitorGap,
+    visitorGap("chat", NOTHING_BUILT) as VisitorGap,
     COMMENTS_GAP,
   ];
 
   it("covers every kind the union has", () => {
     expect(new Set(ALL.map((g) => g.kind))).toEqual(
-      new Set([
-        "not-built",
-        "not-yet-public",
-        "availability-unknown",
-        "owners-only",
-        "readers-own",
-      ]),
+      new Set(["not-built", "owners-only", "readers-own"]),
     );
   });
 
   it("says something different for each kind", () => {
-    /* By kind rather than by member, because a not-yet-public tweet thread and
-       a not-yet-public glossary are deliberately the same sentence about
-       different nouns. */
+    /* By kind rather than by member, because a missing tweet thread and a
+       missing glossary are deliberately the same sentence about different
+       nouns. */
     const byKind = new Map(ALL.map((g) => [g.kind, visitorSentence(g)]));
     expect(new Set(byKind.values()).size).toBe(byKind.size);
     for (const sentence of byKind.values()) {
@@ -251,21 +256,94 @@ describe("the sentences themselves", () => {
     }
   });
 
+  /**
+   * **Every artefact gets its own noun**, so the four sentences are about four
+   * different things rather than one thing said four times.
+   */
+  it("names each artefact distinctly", () => {
+    const nouns = (["tweets", "glossary", "summary", "ideas"] as const).map(
+      (what) => (notBuiltGap(what) as { noun: string }).noun,
+    );
+    expect(new Set(nouns).size).toBe(nouns.length);
+  });
+
   /**
    * **The offer is withheld where it would not be kept.**
    *
-   * An artefact that exists but is not yet carried on a shared link waits on us
-   * shipping slice 1b, not on the visitor doing anything — so putting "make a
-   * free account" beside it would be a promise broken the moment they took it.
-   * Comments are the same: they belong to whoever added the article, and an
-   * account does not change that.
+   * Comments belong to whoever added the article, and an account does not
+   * change that until docs/plans/260827ai-public-read-only-access.md § Stage 3. The two
+   * entries that used to be withheld for the other reason — *we are the ones
+   * who have not shipped it* — went with their union members in slice 1b, which
+   * is why there is one `false` here and there were three.
    */
   it("offers an account only where an account is the fix", () => {
     expect(anAccountWouldHelp(visitorGap("glossary", NOTHING_BUILT) as VisitorGap)).toBe(true);
-    expect(anAccountWouldHelp(visitorGap("chat", null) as VisitorGap)).toBe(true);
-    expect(anAccountWouldHelp(visitorGap("glossary", EVERYTHING_BUILT) as VisitorGap)).toBe(false);
-    /* And least of all where we do not know there is anything to offer. */
-    expect(anAccountWouldHelp(visitorGap("glossary", null) as VisitorGap)).toBe(false);
+    expect(anAccountWouldHelp(visitorGap("chat", NOTHING_BUILT) as VisitorGap)).toBe(true);
     expect(anAccountWouldHelp(COMMENTS_GAP)).toBe(false);
   });
 });
+
+/**
+ * **Which artefacts the payload turned out to have** — the derivation that
+ * replaced `GET /api/public/metadata/:slug` in the client.
+ *
+ * It is two lines of code and it is the hinge of the whole slice: everything
+ * above takes `PublicArtefacts`, and this is where those five booleans now come
+ * from. The one way to get it wrong is the one the empty case below pins.
+ */
+describe("what the payload says it has", () => {
+  const BARE: PublicArticle = {
+    meta: { slug: "a-piece", title: "A piece" },
+    blocks: [],
+    tree: { version: "t", generator: "t", slug: "a-piece", rootId: "n0", nodes: {} },
+  };
+
+  it("reads a present key as yes and an absent one as no", () => {
+    expect(artefactsIn(BARE)).toEqual({
+      arc: false,
+      tweets: false,
+      glossary: false,
+      summary: false,
+      ideas: false,
+    });
+    expect(
+      artefactsIn({
+        ...BARE,
+        glossary: { entries: [{ id: "t", name: "T", kind: "concept", aliases: [], blocks: [] }] },
+      }),
+    ).toMatchObject({ glossary: true, summary: false });
+  });
+
+  /**
+   * **An artefact that is empty is one that exists**, and this is the case a
+   * truthiness or a length test collapses.
+   *
+   * A stored `{entries: []}` means somebody ran the step and it found no terms
+   * — a ready but empty artefact, which the panel says out loud. *Nobody has
+   * built a glossary for this piece yet* is a different sentence about a
+   * different situation, and it would be a claim about the pipeline that is
+   * simply false. src/web/public-artefacts.ts.
+   */
+  it("counts an empty artefact as built", () => {
+    const empty: PublicArticle = { ...BARE, glossary: { entries: [] }, ideas: { ideas: [] } };
+    expect(artefactsIn(empty)).toMatchObject({ glossary: true, ideas: true });
+    /* And the gap that follows from it: nothing stands in the way, so the band
+       opens and says the list is empty rather than that nobody built one. */
+    expect(visitorGap("glossary", artefactsIn(empty))).toBeNull();
+    expect(visitorGap("summary", artefactsIn(empty))?.kind).toBe("not-built");
+  });
+
+  /**
+   * **The lift carries the four artefacts and nothing else.**
+   *
+   * `PublicArticle` extends `PublicArtefactSet`, so handing the whole payload
+   * down would typecheck — and would leave the prose, the blocks and the tree
+   * sitting there at runtime for the first `as` to reach. This is the same
+   * construct-rather-than-spread rule the server DTOs follow.
+   */
+  it("lifts the artefacts out without the article coming with them", () => {
+    const full: PublicArticle = { ...BARE, glossary: { entries: [] } };
+    expect(Object.keys(artefactsOf(full))).toEqual(["glossary"]);
+    expect(artefactsOf(BARE)).toEqual({});
+  });
+});
COMMIT 1ace072 The panels the last commit reshaped, and forgot to bring

diff --git a/src/web/GlossaryPanel.tsx b/src/web/GlossaryPanel.tsx
index a0760cb..91724ad 100644
--- a/src/web/GlossaryPanel.tsx
+++ b/src/web/GlossaryPanel.tsx
@@ -87,11 +87,51 @@ import { Tooltip } from "./Tooltip.js";
    Unreachable here — `safeUrl` parsed it server-side before it was stored. */
 import { hostOf, isWebUrl } from "../urls.js";
 import type { UseGlossary } from "./useGlossary.js";
+import { builtButEmpty } from "../messages.js";
 import { JobProgress } from "./JobProgress.js";
 import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
 import { useRenderCount } from "./perf.js";
 
-interface Props extends UseGlossary {
+/**
+ * **The owner's half of this panel** — the read's status, the job writing it,
+ * the three verbs and the per-entry web lookup.
+ *
+ * `null` for a visitor, and that is the seam. Since slice 1b a visitor gets the
+ * real glossary: it arrives inside `GET /api/public/article/:slug`, so the list
+ * below is the same list drawn by the same components. What a visitor has no
+ * equivalent of is everything in this type — there is no request to be loading
+ * or to have failed, no job to poll, no button that spends, and no lookup,
+ * because a lookup is the owner's own research and lives in a table the public
+ * graph cannot reach at all.
+ *
+ * **One panel with its data injected, rather than an owner's panel and a
+ * visitor's panel.** Two components for one list is how the two drift into two
+ * designs for one thing, which a browser pass caught once already in a drawer
+ * heading. Only the *hooks* need two components, and they are one level up in
+ * App.tsx. reader-capability.ts says why a boolean could not have done it.
+ *
+ * **`owner.glossary` is the artefact, and the `glossary` prop is the list to
+ * draw.** They are the same object on the owner's path and they must be — the
+ * one thing that reads the artefact is `Foot`, which puts the generator, the
+ * version and the pass count under the list, and every one of those is
+ * provenance a visitor's projection drops. Read `owner.glossary` for nothing
+ * else: the list has one source and it is the prop.
+ */
+export type GlossaryOwner = UseGlossary;
+
+interface Props {
+  /**
+   * The list to draw, or `null` when this piece has none.
+   *
+   * Typed as its entries rather than as `Glossary`, because that is all this
+   * panel and its `Foot` ever read — and because a visitor's
+   * `PublicGlossaryEntry` is a `GlossaryEntry` with the lookup absent
+   * (src/public-types.ts), so both fit without a cast and neither needs a
+   * second component.
+   */
+  glossary: { entries: GlossaryEntry[] } | null;
+  /** Whose article this is, and what comes with it. `null` for a visitor. */
+  owner: GlossaryOwner | null;
   /** The selected term, from `?term=`. Null is a list nobody has picked from. */
   termId: string | null;
   onTerm(id: string | null): void;
@@ -104,31 +144,13 @@ interface Props extends UseGlossary {
    */
   gate: number | null;
   onGate(gate: number | null): void;
-  /* Straight through from `useGlossary`. The panel owns none of this state —
-     the hook does — because a lookup outlives the row that started it: the
-     reader can select another term while one runs. */
-  look(id: string): Promise<void>;
-  looking: string | null;
-  lookFailed: string | null;
   /** Jump the article to a block, exactly as a gist cell does. */
   onJump(id: BlockId): void;
 }
 
 export function GlossaryPanel({
-  status,
   glossary,
-  stale,
-  outdated,
-  profiled,
-  profileChanged,
-  hasProfile,
-  error,
-  job,
-  failed,
-  find,
-  more,
-  reset,
-  cancel,
+  owner,
   termId,
   onTerm,
   sort,
@@ -136,9 +158,6 @@ export function GlossaryPanel({
   gate: chosenGate,
   onGate,
   onJump,
-  look,
-  looking,
-  lookFailed,
 }: Props) {
   useRenderCount("GlossaryPanel");
   /* `effectiveSort` and not `sort`: `prioritised` is the default, so it arrives
@@ -163,7 +182,7 @@ export function GlossaryPanel({
    * With no glossary yet, `profiled` is false and the default is `true` — the
    * profiled run is the one this app now offers.
    */
-  const [withProfile, setWithProfile] = useState(() => (glossary ? profiled : true));
+  const [withProfile, setWithProfile] = useState(() => (glossary ? (owner?.profiled ?? false) : true));
 
   return (
     <aside className="mode-band gloss" aria-label="Glossary">
@@ -179,7 +198,11 @@ export function GlossaryPanel({
             banner: it is provenance, not a warning. The glossary already made
             this exact choice once — "a label instead of a warning triangle" —
             and the reason holds. src/web/WrittenForYou.tsx. */}
-        {glossary && <WrittenForYou written={profiled} changed={profileChanged} />}
+        {/* Provenance about the owner's own run, so a visitor sees none of it:
+            `profileHash` never leaves the server (src/public-types.ts). */}
+        {glossary && owner && (
+          <WrittenForYou written={owner.profiled} changed={owner.profileChanged} />
+        )}
       </div>
 
       {/* Sorting is only a question once there is a list, and each option is
@@ -198,11 +221,21 @@ export function GlossaryPanel({
         <GateSlider entries={all} gate={gate} moved={chosenGate !== null} onGate={onGate} />
       )}
 
-      {error && <p className="gloss-error">{error}</p>}
+      {owner?.error && <p className="gloss-error">{owner.error}</p>}
 
-      {status === "loading" && <p className="gloss-quiet">Looking for a glossary…</p>}
+      {owner?.status === "loading" && <p className="gloss-quiet">Looking for a glossary…</p>}
 
-      {status === "none" && (
+      {/* **A visitor's list is already here or it is not**, so there is no
+          loading state and no offer to build one — a piece with no glossary
+          never mounts this panel at all, because `visitorGap` answers
+          *not-built* and the band says so instead (src/web/visitor.ts). What is
+          left is the one state absence cannot express: a glossary somebody ran
+          that came back with nothing in it. src/messages.ts. */}
+      {!owner && glossary?.entries.length === 0 && (
+        <p className="gloss-quiet">{builtButEmpty("A glossary")}</p>
+      )}
+
+      {owner?.status === "none" && (
         <div className="gloss-empty">
           <p>Nobody has found the terms for this one yet.</p>
           <p className="gloss-hint">
@@ -217,21 +250,21 @@ export function GlossaryPanel({
             <UseProfile
               checked={withProfile}
               onChange={setWithProfile}
-              hasProfile={hasProfile}
-              disabled={job !== null}
+              hasProfile={owner.hasProfile}
+              disabled={owner.job !== null}
             />
             <Progress
-              job={job}
-              failed={failed}
-              onRun={() => find(withProfile)}
-              onCancel={cancel}
+              job={owner.job}
+              failed={owner.failed}
+              onRun={() => owner.find(withProfile)}
+              onCancel={owner.cancel}
               label="Find the terms"
             />
           </div>
         </div>
       )}
 
-      {status === "ready" && glossary && (
+      {glossary && (owner === null || owner.status === "ready") && (
         <>
           {/* The article has moved and the list has not. Said plainly, at the
               top, because every entry below it is now a claim about a version
@@ -253,7 +286,7 @@ export function GlossaryPanel({
 
               Stale wins when both are true — it is the one that makes the
               occurrence links wrong, and two banners stacked is a wall. */}
-          {stale ? (
+          {owner?.stale ? (
             <div className="gloss-stale">
               <p>
                 <TriangleAlert size={13} />
@@ -263,19 +296,19 @@ export function GlossaryPanel({
                 <UseProfile
                   checked={withProfile}
                   onChange={setWithProfile}
-                  hasProfile={hasProfile}
-                  disabled={job !== null}
+                  hasProfile={owner.hasProfile}
+                  disabled={owner.job !== null}
                 />
                 <Progress
-                  job={job}
-                  failed={failed}
-                  onRun={() => find(withProfile)}
-                  onCancel={cancel}
+                  job={owner.job}
+                  failed={owner.failed}
+                  onRun={() => owner.find(withProfile)}
+                  onCancel={owner.cancel}
                   label="Find them again"
                 />
               </div>
             </div>
-          ) : outdated ? (
+          ) : owner?.outdated ? (
             <div className="gloss-stale">
               <p>
                 <TriangleAlert size={13} />
@@ -286,14 +319,14 @@ export function GlossaryPanel({
                 <UseProfile
                   checked={withProfile}
                   onChange={setWithProfile}
-                  hasProfile={hasProfile}
-                  disabled={job !== null}
+                  hasProfile={owner.hasProfile}
+                  disabled={owner.job !== null}
                 />
                 <Progress
-                  job={job}
-                  failed={failed}
-                  onRun={() => find(withProfile)}
-                  onCancel={cancel}
+                  job={owner.job}
+                  failed={owner.failed}
+                  onRun={() => owner.find(withProfile)}
+                  onCancel={owner.cancel}
                   label="Find them again"
                 />
               </div>
@@ -329,10 +362,17 @@ export function GlossaryPanel({
                          actually about — and a default order they did not
                          choose needs it more, not less. */
                       showScore={order}
-                      look={look}
-                      looking={looking === entry.id}
-                      lookBusy={looking !== null}
-                      lookFailed={looking === null && entry.id === termId ? lookFailed : null}
+                      /* `null` for a visitor, and the button is not drawn: a
+                         lookup is a model call somebody pays for, and the
+                         answer it keeps is the owner's own research. */
+                      look={owner?.look ?? null}
+                      looking={owner?.looking === entry.id}
+                      lookBusy={(owner?.looking ?? null) !== null}
+                      lookFailed={
+                        owner && owner.looking === null && entry.id === termId
+                          ? owner.lookFailed
+                          : null
+                      }
                       onSelect={() => {
                         // Pressing the selected term again clears it, which is
                         // what takes the underlines back out of the prose.
@@ -351,17 +391,19 @@ export function GlossaryPanel({
             ))}
           </div>
 
-          <Foot
-            glossary={glossary}
-            job={job}
-            failed={failed}
-            onMore={more}
-            onReset={reset}
-            onCancel={cancel}
-            withProfile={withProfile}
-            onWithProfile={setWithProfile}
-            hasProfile={hasProfile}
-          />
+          {owner?.glossary && (
+            <Foot
+              glossary={owner.glossary}
+              job={owner.job}
+              failed={owner.failed}
+              onMore={owner.more}
+              onReset={owner.reset}
+              onCancel={owner.cancel}
+              withProfile={withProfile}
+              onWithProfile={setWithProfile}
+              hasProfile={owner.hasProfile}
+            />
+          )}
         </>
       )}
     </aside>
@@ -929,7 +971,8 @@ function Term({
   entry: GlossaryEntry;
   selected: boolean;
   showScore: TermSort | null;
-  look(id: string): Promise<void>;
+  /** `null` for a visitor: there is no button, because there is nothing to spend. */
+  look: ((id: string) => Promise<void>) | null;
   /** A lookup is running for *this* term. */
   looking: boolean;
   /** A lookup is running for some term — one at a time, so every button waits. */
@@ -1190,7 +1233,7 @@ function Looked({
   failed,
 }: {
   entry: GlossaryEntry;
-  look(id: string): Promise<void>;
+  look: ((id: string) => Promise<void>) | null;
   looking: boolean;
   busy: boolean;
   failed: string | null;
@@ -1198,6 +1241,12 @@ function Looked({
   const lookup = entry.lookup;
 
   if (!lookup) {
+    /* **Nothing at all for a visitor**, rather than a disabled button. The
+       marked-not-hidden rule is about controls a reader would otherwise go
+       looking for; this one they have never seen, and a dead globe on every row
+       of a list they can read perfectly well is furniture. The band's own
+       sentence already tells them what a shared link does not carry. */
+    if (!look) return null;
     return (
       <div className="gloss-look">
         <button
@@ -1342,6 +1391,7 @@ function Foot({
   onReset,
   onCancel,
 }: {
+  /** The whole artefact, because the foot is where its provenance is shown. */
   glossary: Glossary;
   job: Job | null;
   failed: string | null;
diff --git a/src/web/IdeasPanel.tsx b/src/web/IdeasPanel.tsx
index 833be68..ffdb7e9 100644
--- a/src/web/IdeasPanel.tsx
+++ b/src/web/IdeasPanel.tsx
@@ -44,12 +44,29 @@ import type { UseIdeas } from "./useIdeas.js";
 import type { Found } from "./search-hits.js";
 import { BlockNav, nudgeTo } from "./BlockNav.js";
 import { BlockRef } from "./BlockRef.js";
+import { builtButEmpty } from "../messages.js";
 import { JobProgress } from "./JobProgress.js";
 import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
 import type { BlockId } from "../types.js";
 import { useRenderCount } from "./perf.js";
 
-interface Props extends UseIdeas {
+/**
+ * **The owner's half of this panel** — the read's status, the job finding the
+ * ideas, and the one verb.
+ *
+ * `null` for a visitor. The list itself arrives inside
+ * `GET /api/public/article/:slug` since slice 1b, so it is the same list drawn
+ * by the same rows; what a visitor has no equivalent of is everything here.
+ * GlossaryPanel.tsx § GlossaryOwner has the argument for one panel with its
+ * data injected rather than two panels for one list.
+ */
+export type IdeasOwner = UseIdeas;
+
+interface Props {
+  /** The list to draw, or `null` when this piece has none. */
+  ideas: { ideas: Idea[] } | null;
+  /** Whose article this is, and what comes with it. `null` for a visitor. */
+  owner: IdeasOwner | null;
   /** Which idea is open, from `?idea=`. */
   ideaId: string | null;
   onIdea(id: string | null): void;
@@ -88,18 +105,8 @@ const GROUPS = [
 ];
 
 export function IdeasPanel({
-  status,
   ideas,
-  stale,
-  outdated,
-  profiled,
-  profileChanged,
-  hasProfile,
-  error,
-  job,
-  failed,
-  find,
-  cancel,
+  owner,
   ideaId,
   onIdea,
   found,
@@ -112,29 +119,33 @@ export function IdeasPanel({
      in the state the reader last chose and nothing has to remember it between
      visits: the artefact does. `useState`'s initialiser rather than an effect,
      because re-seeding on every poll would fight a reader who just unticked it. */
-  const [withProfile, setWithProfile] = useState(() => (ideas ? profiled : true));
+  const [withProfile, setWithProfile] = useState(() => (ideas ? (owner?.profiled ?? false) : true));
 
   const all = ideas?.ideas ?? [];
-  const run = (label: string) => (
-    <div className="gloss-run">
-      <UseProfile
-        checked={withProfile}
-        onChange={setWithProfile}
-        hasProfile={hasProfile}
-        disabled={job !== null}
-      />
-      <JobProgress
-        job={job}
-        failed={failed}
-        onRun={() => find(withProfile)}
-        onCancel={cancel}
-        label={label}
-        step="ideas"
-        icon={<Lightbulb size={13} />}
-        runningLabel="Finding…"
-      />
-    </div>
-  );
+  /* **Returns nothing for a visitor**, which is what makes every call site
+     below one line rather than a conditional: this whole block is a profile
+     tick and a button that spends a model call, and a visitor has neither. */
+  const run = (label: string) =>
+    owner && (
+      <div className="gloss-run">
+        <UseProfile
+          checked={withProfile}
+          onChange={setWithProfile}
+          hasProfile={owner.hasProfile}
+          disabled={owner.job !== null}
+        />
+        <JobProgress
+          job={owner.job}
+          failed={owner.failed}
+          onRun={() => owner.find(withProfile)}
+          onCancel={owner.cancel}
+          label={label}
+          step="ideas"
+          icon={<Lightbulb size={13} />}
+          runningLabel="Finding…"
+        />
+      </div>
+    );
 
   return (
     <aside className="mode-band gloss ideas" aria-label="Ideas">
@@ -150,14 +161,24 @@ export function IdeasPanel({
             banner: it is provenance, not a warning. It matters more here than
             anywhere else it appears — a changed profile does not merely re-pitch
             these, it changes what "assumed" means. */}
-        {ideas && <WrittenForYou written={profiled} changed={profileChanged} />}
+        {/* Provenance about the owner's own run: `profileHash` never leaves the
+            server, so a visitor sees none of it. src/public-types.ts. */}
+        {ideas && owner && (
+          <WrittenForYou written={owner.profiled} changed={owner.profileChanged} />
+        )}
       </div>
 
-      {error && <p className="gloss-error">{error}</p>}
+      {owner?.error && <p className="gloss-error">{owner.error}</p>}
 
-      {status === "loading" && <p className="gloss-quiet">Looking for the ideas…</p>}
+      {owner?.status === "loading" && <p className="gloss-quiet">Looking for the ideas…</p>}
 
-      {status === "none" && (
+      {/* A piece with no ideas never mounts this panel for a visitor —
+          `visitorGap` answers *not-built* and the band says so instead. What is
+          left is the state absence cannot express: a list somebody ran that came
+          back with nothing in it. src/messages.ts § builtButEmpty. */}
+      {!owner && all.length === 0 && <p className="gloss-quiet">{builtButEmpty("A list of ideas")}</p>}
+
+      {owner?.status === "none" && (
         <div className="gloss-empty">
           <p>Nobody has found the ideas for this one yet.</p>
           <p className="gloss-hint">
@@ -168,7 +189,7 @@ export function IdeasPanel({
         </div>
       )}
 
-      {status === "ready" && ideas && (
+      {ideas && (owner === null || owner.status === "ready") && (
         <>
           {/* Stale wins when both are true: it is the one that makes the
               occurrence links wrong, and two banners stacked is a wall. Same
@@ -180,7 +201,7 @@ export function IdeasPanel({
               even when every paragraph is byte-identical — which is right,
               because the model judged what the argument rests on from the
               skeleton. */}
-          {stale ? (
+          {owner?.stale ? (
             <div className="gloss-stale">
               <p>
                 <TriangleAlert size={13} />
@@ -188,7 +209,7 @@ export function IdeasPanel({
               </p>
               {run("Find them again")}
             </div>
-          ) : outdated ? (
+          ) : owner?.outdated ? (
             <div className="gloss-stale">
               <p>
                 <TriangleAlert size={13} />
@@ -268,7 +289,9 @@ export function IdeasPanel({
 
           {/* Below the list, not above it: this is the thing you reach for
               after reading them and disagreeing, not before. */}
-          {!stale && !outdated && <div className="ideas-again">{run("Find them again")}</div>}
+          {owner && !owner.stale && !owner.outdated && (
+            <div className="ideas-again">{run("Find them again")}</div>
+          )}
         </>
       )}
     </aside>
diff --git a/src/web/PublicPages.tsx b/src/web/PublicPages.tsx
index 6a0a55d..1eb0c2b 100644
--- a/src/web/PublicPages.tsx
+++ b/src/web/PublicPages.tsx
@@ -17,7 +17,7 @@
 import { ArrowLeft } from "lucide-react";
 
 import type { Article } from "../types.js";
-import type { PublicArtefacts } from "../public-types.js";
+import type { PublicArtefacts, PublicTweets } from "../public-types.js";
 import { SHARING_WHAT_VISITORS_SEE } from "../messages.js";
 import { Dock } from "./Dock.js";
 import { Link } from "./Link.js";
@@ -25,7 +25,8 @@ import { carriedSearch, readHref, type ArticleView } from "./router.js";
 import { articleStats } from "./stats.js";
 import { pageTitle, useDocumentTitle } from "./page-title.js";
 import { SharedNotice, VisitorNotice } from "./PublicChrome.js";
-import { markedModes, type VisitorGap } from "./visitor.js";
+import { markedModes, notBuiltGap, type VisitorGap } from "./visitor.js";
+import { ThreadCounts, ThreadPosts } from "./Tweets.js";
 
 /** Room for the bottom bar, so the last line of a page is not under it. */
 const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-space)_+_2rem)]";
@@ -49,7 +50,7 @@ export function PublicMetadataPage({
 }: {
   slug: string;
   article: Article;
-  available: PublicArtefacts | null;
+  available: PublicArtefacts;
   /** For the call to action only — reader-capability.ts § signedIn. */
   signedIn: boolean;
 }) {
@@ -89,22 +90,19 @@ export function PublicMetadataPage({
               whole difference between this page and the owner's, and the reason
               `PublicMetadata` is five booleans rather than a projection of
               `ArticleMetadata`. */}
-          {available === null ? (
-            /* The metadata request did not land. Say so rather than drawing five
-               "no"s, which would be a claim about somebody's article made out of
-               a network failure. docs/reusable/silent-success.md. */
-            <p className="tw:m-0 tw:text-sm tw:text-ink-faint">
-              We could not check which of these this piece has.
-            </p>
-          ) : (
-            <ul className="tw:m-0 tw:list-none tw:p-0 tw:text-sm tw:text-ink-faint">
-              <Artefact name="An arc through the argument" has={available.arc} />
-              <Artefact name="A summary" has={available.summary} />
-              <Artefact name="A glossary" has={available.glossary} />
-              <Artefact name="A list of ideas" has={available.ideas} />
-              <Artefact name="A tweet thread" has={available.tweets} />
-            </ul>
-          )}
+          {/* **No "we could not check" arm any more**, and its absence is the
+              slice. These five used to come from a second request whose failure
+              was swallowed to `null`; they are derived from the article payload
+              this page is already drawing, so either it arrived or the reader is
+              looking at *this document isn't shared*.
+              src/web/public-artefacts.ts. */}
+          <ul className="tw:m-0 tw:list-none tw:p-0 tw:text-sm tw:text-ink-faint">
+            <Artefact name="An arc through the argument" has={available.arc} />
+            <Artefact name="A summary" has={available.summary} />
+            <Artefact name="A glossary" has={available.glossary} />
+            <Artefact name="A list of ideas" has={available.ideas} />
+            <Artefact name="A tweet thread" has={available.tweets} />
+          </ul>
         </section>
 
         <section className="tw:mt-8">
@@ -142,12 +140,22 @@ export function VisitorPage({
   article,
   view,
   gap,
+  available,
   signedIn,
 }: {
   slug: string;
   article: Article;
   view: ArticleView;
   gap: VisitorGap;
+  /**
+   * Which artefacts this piece has, for the bar's marked modes.
+   *
+   * It was hardcoded `null` here until slice 1b — the "we could not check"
+   * answer, on a page that had the article in hand — so every dimmed button on
+   * this page said *we could not check* about an article we knew everything
+   * about. There is no `null` to pass now.
+   */
+  available: PublicArtefacts;
   /** For the call to action only — reader-capability.ts § signedIn. */
   signedIn: boolean;
 }) {
@@ -161,7 +169,78 @@ export function VisitorPage({
         </h1>
         <VisitorNotice gap={gap} signedIn={signedIn} />
       </main>
-      <VisitorDock slug={slug} view={view} available={null} signedIn={signedIn} />
+      <VisitorDock slug={slug} view={view} available={available} signedIn={signedIn} />
+    </>
+  );
+}
+
+/**
+ * **The tweet thread, for somebody who does not own the article** — and since
+ * slice 1b it is the real thread rather than a notice about one.
+ *
+ * `Tweets` is not reachable from here and that is the seam rather than an
+ * omission: it fetches `GET /api/tweets/:slug` and mounts `useJobs`, which
+ * polls the private job list for ever. What a visitor gets instead is the two
+ * presentational halves of that page — `ThreadCounts` and `ThreadPosts`, the
+ * same components the owner's page draws — with the thread that arrived inside
+ * `GET /api/public/article/:slug`. src/web/Tweets.tsx.
+ *
+ * **The branch is on the artefact itself, not on a flag beside it.** `thread`
+ * being absent *is* what `available.tweets` was computed from
+ * (src/web/public-artefacts.ts), so branching on the key is what keeps *there
+ * is no thread* and *we say there is no thread* the same fact. The constant this
+ * replaces claimed a thread existed whatever the wire said — GPT Sol,
+ * 2026-08-28 — and the sentence still comes from the one table every other gap
+ * uses.
+ */
+export function VisitorTweetsPage({
+  slug,
+  article,
+  thread,
+  available,
+  signedIn,
+}: {
+  slug: string;
+  article: Article;
+  /** Absent when nobody has written one for this piece. */
+  thread: PublicTweets | undefined;
+  available: PublicArtefacts;
+  signedIn: boolean;
+}) {
+  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "tweets" }));
+
+  if (thread === undefined) {
+    return (
+      <VisitorPage
+        slug={slug}
+        article={article}
+        view="tweets"
+        gap={notBuiltGap("tweets")}
+        available={available}
+        signedIn={signedIn}
+      />
+    );
+  }
+
+  return (
+    <>
+      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}>
+        <BackToArticle slug={slug} />
+        <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
+          {article.meta.title}
+        </h1>
+        {/* No `children`: the owner's provenance label reads `profileHash`,
+            which never leaves the server. src/public-types.ts. */}
+        <ThreadCounts thread={thread} article={article} />
+        <ThreadPosts thread={thread} />
+        {/* No provenance footer and no rewrite button: both are the owner's, and
+            one of them spends a model call. What a visitor gets instead is the
+            notice card, which says what a shared link is and what it carries. */}
+        <div className="tw:mt-8 tw:border-t tw:border-border tw:pt-4">
+          <SharedNotice signedIn={signedIn} />
+        </div>
+      </main>
+      <VisitorDock slug={slug} view="tweets" available={available} signedIn={signedIn} />
     </>
   );
 }
@@ -194,7 +273,7 @@ function VisitorDock({
 }: {
   slug: string;
   view: ArticleView;
-  available: PublicArtefacts | null;
+  available: PublicArtefacts;
   signedIn: boolean;
 }) {
   return (
diff --git a/src/web/SummaryPanel.tsx b/src/web/SummaryPanel.tsx
index a8faee1..2549c30 100644
--- a/src/web/SummaryPanel.tsx
+++ b/src/web/SummaryPanel.tsx
@@ -77,7 +77,7 @@
  */
 import { type MouseEvent, useRef, useState } from "react";
 import { ChevronRight, Compass, Layers, RotateCcw, TriangleAlert } from "lucide-react";
-import type { BlockId, Job } from "../types.js";
+import type { BlockId, Job, SummaryEntry } from "../types.js";
 import { BlockRange } from "./BlockRef.js";
 import { CitedText } from "./Cited.js";
 import { TooltipGroup } from "./Tooltip.js";
@@ -90,7 +90,36 @@ import { JobProgress } from "./JobProgress.js";
 import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
 import { useRenderCount } from "./perf.js";
 
-interface Props extends UseSummaries {
+/**
+ * **The owner's half of this panel** — the read's status, the job writing the
+ * two longer rungs, the steer box and the button that spends.
+ *
+ * `null` for a visitor. Since slice 1b the summaries arrive inside
+ * `GET /api/public/article/:slug`, so the ladder below is the same ladder drawn
+ * by the same components; what a visitor has no equivalent of is everything
+ * here. One panel with its data injected rather than an owner's panel and a
+ * visitor's panel — see GlossaryPanel.tsx § GlossaryOwner for why that matters
+ * more than the duplication it saves.
+ *
+ * **`owner.summaries` is the artefact and `summaries` is the ladder to draw.**
+ * The only thing that reads the artefact is `guidance`, the owner's own steer,
+ * which the public projection drops on purpose (src/public/dto.ts).
+ */
+export type SummariesOwner = UseSummaries;
+
+interface Props {
+  /**
+   * The ladder to draw, or `null` when this piece has none — which is an
+   * ordinary state rather than a fault, because every internal tree node
+   * already carries a one-sentence gist and the panel works without any of
+   * this.
+   *
+   * Typed as what it is read for rather than as `Summaries`: a visitor's
+   * `PublicSummaries` is exactly these two fields (src/public-types.ts).
+   */
+  summaries: { entries: SummaryEntry[]; missing: number } | null;
+  /** Whose article this is, and what comes with it. `null` for a visitor. */
+  owner: SummariesOwner | null;
   /** The tree, joined to whatever summaries exist. Null if the tree is unusable. */
   root: SummaryNode | null;
   /**
@@ -124,17 +153,8 @@ const RUNG_LABELS: Record<Rung, { label: string; blurb: string }> = {
 const DEPTH_LABELS = ["article", "parts", "sections"];
 
 export function SummaryPanel({
-  status,
   summaries,
-  stale,
-  profiled,
-  profileChanged,
-  hasProfile,
-  error,
-  job,
-  failed,
-  write,
-  cancel,
+  owner,
   root,
   blocks,
   rung,
@@ -219,9 +239,13 @@ export function SummaryPanel({
    */
   /* Seeded from what the artefact on screen was written with, so nothing has to
      remember the reader's last choice between visits — the file does. */
-  const [withProfile, setWithProfile] = useState(() => (summaries ? profiled : true));
+  const [withProfile, setWithProfile] = useState(() =>
+    summaries ? (owner?.profiled ?? false) : true,
+  );
   const [steer, setSteer] = useState<string | null>(null);
-  const guidance = steer ?? summaries?.guidance ?? "";
+  /* The owner's own artefact, because the steer is the owner's own sentence and
+     never crosses to a visitor. src/public/dto.ts § publicSummaries. */
+  const guidance = steer ?? owner?.summaries?.guidance ?? "";
 
   /* Whether the two longer rungs exist at all. Not `status === "ready"`: an
      artefact can be present and still have holes in it, and what decides
@@ -236,7 +260,11 @@ export function SummaryPanel({
         <h2>Summary</h2>
         {/* Provenance, on the head line. A label rather than a control for the
             reason src/web/WrittenForYou.tsx gives. */}
-        {summaries && <WrittenForYou written={profiled} changed={profileChanged} />}
+        {/* Provenance about the owner's own run: `profileHash` never leaves the
+            server, so a visitor sees none of it. src/public-types.ts. */}
+        {summaries && owner && (
+          <WrittenForYou written={owner.profiled} changed={owner.profileChanged} />
+        )}
       </div>
 
       <div className="summ-controls">
@@ -298,9 +326,9 @@ export function SummaryPanel({
         </fieldset>
       </div>
 
-      {error && <p className="summ-error">{error}</p>}
+      {owner?.error && <p className="summ-error">{owner.error}</p>}
 
-      {stale && (
+      {owner?.stale && (
         <div className="summ-stale">
           <p>
             <TriangleAlert size={13} />
@@ -309,7 +337,7 @@ export function SummaryPanel({
           {/* The box is here too, and not only in the foot below: the foot is
               hidden while the summaries are stale, so without this the one
               article most likely to be rewritten is the one you cannot steer. */}
-          <Steer value={guidance} onChange={setSteer} disabled={job !== null} />
+          <Steer value={guidance} onChange={setSteer} disabled={owner.job !== null} />
           {/* Beside the steer and the button, because all three describe the
               same forthcoming run. Two boxes about intent and one checkbox
               about whose intent — the profile is durable and about the reader,
@@ -319,16 +347,16 @@ export function SummaryPanel({
           <UseProfile
             checked={withProfile}
             onChange={setWithProfile}
-            hasProfile={hasProfile}
-            disabled={job !== null}
+            hasProfile={owner.hasProfile}
+            disabled={owner.job !== null}
           />
           {/* No `force` needed: the step's own freshness check already knows
               this artefact is out of date, so an ordinary run rewrites it. */}
           <Progress
-            job={job}
-            failed={failed}
-            onRun={() => write(false, guidance, withProfile)}
-            onCancel={cancel}
+            job={owner.job}
+            failed={owner.failed}
+            onRun={() => owner.write(false, guidance, withProfile)}
+            onCancel={owner.cancel}
             label="Rewrite them"
           />
         </div>
@@ -363,84 +391,93 @@ export function SummaryPanel({
       </div>
 
       {/* The offer, at the bottom rather than in place of the outline: there is
-          always something to read here, so this is never an empty state. */}
-      {status !== "loading" && !stale && (
+          always something to read here, so this is never an empty state.
+
+          **The `missing` count is above the offer and outside it**, because it
+          is a fact about the ladder rather than an invitation to rewrite one —
+          and a visitor gets it too. It is the reader's only sign that an
+          apparently complete summary is partial, which is why `missing` is one
+          of the two fields that cross in `PublicSummaries`. */}
+      {/* A visitor's foot is the `missing` line or nothing at all — no empty
+          bordered strip under the ladder when there is nothing to put in it. */}
+      {(owner
+        ? owner.status !== "loading" && !owner.stale
+        : hasLadder && summaries.missing > 0) && (
         <div className="summ-foot">
-          {status === "none" ? (
-            <>
-              <p className="summ-hint">
-                Only the one-sentence gists so far. Writing the longer two rungs is a few model
-                calls over the whole article and takes a minute or two — done once and kept.
-              </p>
-              <Steer value={guidance} onChange={setSteer} disabled={job !== null} />
-          {/* Beside the steer and the button, because all three describe the
-              same forthcoming run. Two boxes about intent and one checkbox
-              about whose intent — the profile is durable and about the reader,
-              the steer is about this rewrite, and SYSTEM states that the steer
-              wins where they pull different ways.
-              docs/project/reader-profile.md. */}
-          <UseProfile
-            checked={withProfile}
-            onChange={setWithProfile}
-            hasProfile={hasProfile}
-            disabled={job !== null}
-          />
-              <Progress
-                job={job}
-                failed={failed}
-                onRun={() => write(false, guidance, withProfile)}
-                onCancel={cancel}
-                label="Write the summaries"
-              />
-            </>
-          ) : (
-            hasLadder && (
+          {/* Written down rather than smoothed over. A section that got nothing
+              back falls all the way to its gist, which looks exactly like a
+              section the model had less to say about — the number is what tells
+              the two apart.
+
+              Note what `missing` counts, precisely: sections with **no entry at
+              all**, not sections that got a `short` and no `long`. Those are
+              marked individually on the row instead, which is the more useful
+              place for a fact about one row. */}
+          {hasLadder && summaries.missing > 0 && (
+            <p className="summ-hint">
+              {summaries.missing} {summaries.missing === 1 ? "section" : "sections"} got nothing
+              back and fall back to their one-sentence gist.
+            </p>
+          )}
+          {/* And this half is the owner's: a steer box, a profile tick and a
+              button that spends. A visitor has none of the three, and the band
+              they can open instead is the same band with this part absent
+              rather than a second design for one panel. */}
+          {owner &&
+            (owner.status === "none" ? (
               <>
-                {/* Written down rather than smoothed over. A section that got
-                    nothing back falls all the way to its gist, which looks
-                    exactly like a section the model had less to say about — the
-                    number is what tells the two apart.
-
-                    Note what `missing` counts, precisely: sections with **no
-                    entry at all**, not sections that got a `short` and no
-                    `long`. Those are marked individually on the row instead,
-                    which is the more useful place for a fact about one row. */}
-                {summaries.missing > 0 && (
-                  <p className="summ-hint">
-                    {summaries.missing} {summaries.missing === 1 ? "section" : "sections"} got
-                    nothing back and fall back to their one-sentence gist.
-                  </p>
-                )}
-                <Steer value={guidance} onChange={setSteer} disabled={job !== null} />
-          {/* Beside the steer and the button, because all three describe the
-              same forthcoming run. Two boxes about intent and one checkbox
-              about whose intent — the profile is durable and about the reader,
-              the steer is about this rewrite, and SYSTEM states that the steer
-              wins where they pull different ways.
-              docs/project/reader-profile.md. */}
-          <UseProfile
-            checked={withProfile}
-            onChange={setWithProfile}
-            hasProfile={hasProfile}
-            disabled={job !== null}
-          />
+                <p className="summ-hint">
+                  Only the one-sentence gists so far. Writing the longer two rungs is a few model
+                  calls over the whole article and takes a minute or two — done once and kept.
+                </p>
+                <Steer value={guidance} onChange={setSteer} disabled={owner.job !== null} />
+                {/* Beside the steer and the button, because all three describe
+                    the same forthcoming run. Two boxes about intent and one
+                    checkbox about whose intent — the profile is durable and
+                    about the reader, the steer is about this rewrite, and
+                    SYSTEM states that the steer wins where they pull different
+                    ways. docs/project/reader-profile.md. */}
+                <UseProfile
+                  checked={withProfile}
+                  onChange={setWithProfile}
+                  hasProfile={owner.hasProfile}
+                  disabled={owner.job !== null}
+                />
                 <Progress
-                  job={job}
-                  failed={failed}
-                  // Forced: the step believes this artefact is current, and it
-                  // is right — the reader is asking for it anyway. Which is
-                  // also why the steer does not go anywhere near
-                  // `summariesAreCurrent`: a note about what you are reading
-                  // for is not a reason for the *next* ordinary run to decide
-                  // the artefact has gone stale.
-                  onRun={() => write(true, guidance)}
-                  onCancel={cancel}
-                  label="Write them again"
-                  icon="redo"
+                  job={owner.job}
+                  failed={owner.failed}
+                  onRun={() => owner.write(false, guidance, withProfile)}
+                  onCancel={owner.cancel}
+                  label="Write the summaries"
                 />
               </>
-            )
-          )}
+            ) : (
+              hasLadder && (
+                <>
+                  <Steer value={guidance} onChange={setSteer} disabled={owner.job !== null} />
+                  <UseProfile
+                    checked={withProfile}
+                    onChange={setWithProfile}
+                    hasProfile={owner.hasProfile}
+                    disabled={owner.job !== null}
+                  />
+                  <Progress
+                    job={owner.job}
+                    failed={owner.failed}
+                    // Forced: the step believes this artefact is current, and it
+                    // is right — the reader is asking for it anyway. Which is
+                    // also why the steer does not go anywhere near
+                    // `summariesAreCurrent`: a note about what you are reading
+                    // for is not a reason for the *next* ordinary run to decide
+                    // the artefact has gone stale.
+                    onRun={() => owner.write(true, guidance)}
+                    onCancel={owner.cancel}
+                    label="Write them again"
+                    icon="redo"
+                  />
+                </>
+              )
+            ))}
         </div>
       )}
     </aside>
diff --git a/src/web/Tweets.tsx b/src/web/Tweets.tsx
index 1c72c7e..9a46ed4 100644
--- a/src/web/Tweets.tsx
+++ b/src/web/Tweets.tsx
@@ -67,11 +67,12 @@
  * (docs/project/web-client.md#tailwind-and-shadcn-components). Every class needs
  * the `tw:` prefix — unprefixed names silently do nothing.
  */
-import { useCallback, useEffect, useMemo, useState } from "react";
+import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
 import { ArrowLeft, Check, Copy, PenLine, TriangleAlert } from "lucide-react";
 import { Button } from "@/components/ui/button";
 import { THREAD_RECHECK_FAILED } from "../messages.js";
 import type { Article, Job, ThreadResponse, TweetThread } from "../types.js";
+import type { PublicTweets } from "../public-types.js";
 import { Dock } from "./Dock.js";
 import { Link } from "./Link.js";
 import { pageTitle, useDocumentTitle } from "./page-title.js";
@@ -438,34 +439,14 @@ function Thread({
   // Seeded from what the thread on screen was written with; the artefact is
   // the memory, so nothing here has to be.
   const [withProfile, setWithProfile] = useState(thread.profileHash != null);
-  const total = thread.tweets.length;
-  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;
-  /* Summed here rather than stored. It is the array's own arithmetic, and a
-     `chars` total in the artefact would be a second copy of a fact the posts
-     already carry — the same reason nothing stores a post number. */
-  const chars = thread.tweets.reduce((n, t) => n + t.chars, 0);
-  const words = useMemo(() => articleStats(article).words, [article]);
-
   return (
     <>
-      <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
-        {/* Three numbers, borrowed from their pill row and said as a sentence.
-            The document's word count is the one that earns its place: on its
-            own "1,842 characters" is a fact about nothing, and beside 8,275
-            words it is the compression the reader is being asked to trust. */}
-        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
-          A thread, {total} {total === 1 ? "post" : "posts"} · {chars.toLocaleString()} characters
-          from {words.toLocaleString()} words
-        </p>
+      <ThreadCounts thread={thread} article={article}>
         {/* Provenance, beside the counts rather than in a banner: it describes
-            what is on screen. src/web/WrittenForYou.tsx. */}
+            what is on screen. src/web/WrittenForYou.tsx. Owner-only, because
+            `profileHash` never leaves the server. src/public-types.ts. */}
         <WrittenForYou written={thread.profileHash != null} changed={profileChanged} />
-        <CopyButton
-          text={() => threadMarkdown(thread, article)}
-          label="Copy the thread"
-          className="tw:ml-auto"
-        />
-      </div>
+      </ThreadCounts>
 
       {/* The article has moved and the thread has not. Said plainly, at the
           top, because everything below it is now a claim about a version of
@@ -500,6 +481,108 @@ function Thread({
         </div>
       )}
 
+      <ThreadPosts thread={thread} />
+
+      {/* A hairline and then the provenance: the end of the thread, said with a
+          rule rather than with their "🏁 End of thread" pill. In a list of
+          fifteen cards the reader does want to know they have reached the
+          bottom; it just does not need an emoji to say so. */}
+      <div className="tw:mt-8 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:border-t tw:border-border tw:pt-4">
+        <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
+          Written by {thread.generator} · {thread.version} · {whenWritten(thread.generatedAt)} ·{" "}
+          {howLong(thread.elapsedMs)}
+        </p>
+        {/* Only when the thread is fine. A stale one already has a button, at
+            the top, inside the paragraph explaining why it needs pressing —
+            two of them would be one too many, and the wrong one is the one
+            further from the reason. */}
+        {!stale && (
+          <>
+            {/* Beside the deliberate rewrite, which is where the spend already
+                has a confirmation of its own. src/web/WrittenForYou.tsx. */}
+            <UseProfile
+              checked={withProfile}
+              onChange={setWithProfile}
+              hasProfile={hasProfile}
+              disabled={job !== null}
+            />
+            <Rewrite
+              job={job}
+              failed={failed}
+              onWrite={(force) => onWrite(force, withProfile)}
+              onCancel={onCancel}
+            />
+          </>
+        )}
+      </div>
+    </>
+  );
+}
+
+/**
+ * **The thread's three numbers**, said as a sentence.
+ *
+ * Borrowed back from the original version's pill row, 2026-08-25: the three
+ * facts were the good part and the pills were not. The document's word count is
+ * the one that earns its place — on its own "1,842 characters" is a fact about
+ * nothing, and beside 8,275 words it is the compression the reader is being
+ * asked to trust.
+ *
+ * **Shared with the visitor's page**, which is why it takes a `PublicTweets`
+ * rather than the whole artefact: the counts are arithmetic over the posts, and
+ * a visitor is looking at the same posts. `children` is where the owner puts
+ * their own provenance label, which a visitor has none of.
+ */
+export function ThreadCounts({
+  thread,
+  article,
+  children,
+}: {
+  thread: PublicTweets;
+  article: Article;
+  children?: ReactNode;
+}) {
+  const total = thread.tweets.length;
+  /* Summed here rather than stored. It is the array's own arithmetic, and a
+     `chars` total in the artefact would be a second copy of a fact the posts
+     already carry — the same reason nothing stores a post number. */
+  const chars = thread.tweets.reduce((n, t) => n + t.chars, 0);
+  const words = useMemo(() => articleStats(article).words, [article]);
+
+  return (
+    <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
+      <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
+        A thread, {total} {total === 1 ? "post" : "posts"} · {chars.toLocaleString()} characters
+        from {words.toLocaleString()} words
+      </p>
+      {children}
+      <CopyButton
+        text={() => threadMarkdown(thread, article)}
+        label="Copy the thread"
+        className="tw:ml-auto"
+      />
+    </div>
+  );
+}
+
+/**
+ * **The posts themselves** — one numbered card each, and the over-limit line
+ * above them.
+ *
+ * One component for the owner and for a visitor, which is the rule the whole of
+ * slice 1b follows: the hooks need two components, the thing on screen does not.
+ * Two lists for one thread is how the two drift into two designs for one thing.
+ * src/web/reader-capability.ts.
+ *
+ * It takes a `PublicTweets` — `limit` and the posts — because that is every
+ * field it reads. The provenance footer is the owner's and lives in `Thread`.
+ */
+export function ThreadPosts({ thread }: { thread: PublicTweets }) {
+  const total = thread.tweets.length;
+  const over = thread.tweets.filter((t) => t.chars > thread.limit).length;
+
+  return (
+    <>
       {/* Only a real violation. `thread.limit` and not 280: the artefact says
           what it was counted against, and a thread written under a different
           limit should not be re-judged under this one. */}
@@ -545,39 +628,6 @@ function Thread({
           </li>
         ))}
       </ol>
-
-      {/* A hairline and then the provenance: the end of the thread, said with a
-          rule rather than with their "🏁 End of thread" pill. In a list of
-          fifteen cards the reader does want to know they have reached the
-          bottom; it just does not need an emoji to say so. */}
-      <div className="tw:mt-8 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:border-t tw:border-border tw:pt-4">
-        <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
-          Written by {thread.generator} · {thread.version} · {whenWritten(thread.generatedAt)} ·{" "}
-          {howLong(thread.elapsedMs)}
-        </p>
-        {/* Only when the thread is fine. A stale one already has a button, at
-            the top, inside the paragraph explaining why it needs pressing —
-            two of them would be one too many, and the wrong one is the one
-            further from the reason. */}
-        {!stale && (
-          <>
-            {/* Beside the deliberate rewrite, which is where the spend already
-                has a confirmation of its own. src/web/WrittenForYou.tsx. */}
-            <UseProfile
-              checked={withProfile}
-              onChange={setWithProfile}
-              hasProfile={hasProfile}
-              disabled={job !== null}
-            />
-            <Rewrite
-              job={job}
-              failed={failed}
-              onWrite={(force) => onWrite(force, withProfile)}
-              onCancel={onCancel}
-            />
-          </>
-        )}
-      </div>
     </>
   );
 }
@@ -768,7 +818,7 @@ function CopyButton({
  * Exported for tests: this is the only pure thing on the page, and it is the
  * part that has a right answer.
  */
-export function threadMarkdown(thread: TweetThread, article: Article): string {
+export function threadMarkdown(thread: PublicTweets, article: Article): string {
   const head = [article.meta.title, article.meta.url].filter(Boolean).join("\n");
   const posts = thread.tweets.map((t, i) => `${i + 1}/${thread.tweets.length} ${t.text}`);
   return [head, ...posts].join("\n\n");
diff --git a/src/web/tree.ts b/src/web/tree.ts
index 2437c4c..ff3d077 100644
--- a/src/web/tree.ts
+++ b/src/web/tree.ts
@@ -13,7 +13,7 @@
  * automatically the same at every level of granularity, which is the invariant
  * the whole feature rests on.
  */
-import type { Arc, Block, BlockId, NodeId, Summaries, Tree, TreeNode } from "../types.js";
+import type { Arc, Block, BlockId, NodeId, SummaryEntry, Tree, TreeNode } from "../types.js";
 import { supplementIndex } from "../supplement.js";
 import type { Rung } from "./params.js";
 
@@ -477,7 +477,10 @@ export interface SummaryNode {
 export function buildSummaryTree(
   tree: Tree,
   blocks: Block[],
-  summaries: Summaries | null,
+  /* The entries and nothing else, because that is all this reads — and because
+     a visitor's `PublicSummaries` is not a `Summaries` (no generator, no
+     timings, no steer). src/public-types.ts. */
+  summaries: { entries: SummaryEntry[] } | null,
   depthLimit = 2,
 ): SummaryNode | null {
   const order = new Map<BlockId, number>(blocks.map((b, i) => [b.id, i]));
diff --git a/tests/summarise.test.ts b/tests/summarise.test.ts
index 69fff19..d0b3835 100644
--- a/tests/summarise.test.ts
+++ b/tests/summarise.test.ts
@@ -666,7 +666,15 @@ describe("SummaryPanel", () => {
      infers `status: "ready"` as a literal type, so a spread that overrides it
      with "none" fails to typecheck for a reason that has nothing to do with the
      test. */
-  const base: ComponentProps<typeof SummaryPanel> = {
+  /**
+   * The owner's half — the read's status, the job and the verb.
+   *
+   * A group of its own since slice 1b, because a visitor gets this panel with
+   * `owner: null` and the same ladder: the summaries arrive in the shared
+   * article payload, so there is no status to be in and no button that spends.
+   * src/web/SummaryPanel.tsx § SummariesOwner.
+   */
+  const OWNER: NonNullable<ComponentProps<typeof SummaryPanel>["owner"]> = {
     status: "ready",
     summaries: SUMMARIES,
     stale: false,
@@ -683,6 +691,11 @@ describe("SummaryPanel", () => {
     failed: null,
     write: async () => {},
     cancel: () => {},
+  };
+
+  const base: ComponentProps<typeof SummaryPanel> = {
+    summaries: SUMMARIES,
+    owner: OWNER,
     root: buildSummaryTree(TREE, BLOCKS, SUMMARIES),
     blocks: new Map(BLOCKS.map((b) => [b.id, b.text])),
     rung: "long",
@@ -735,7 +748,7 @@ describe("SummaryPanel", () => {
 
   it("disables the generated rungs when nothing has been written", () => {
     const out = html({
-      status: "none",
+      owner: { ...OWNER, status: "none", summaries: null },
       summaries: null,
       root: buildSummaryTree(TREE, BLOCKS, null),
     });
@@ -749,7 +762,7 @@ describe("SummaryPanel", () => {
   });
 
   it("says so when the article has moved underneath them", () => {
-    expect(html({ stale: true })).toContain("older version of the article");
+    expect(html({ owner: { ...OWNER, stale: true } })).toContain("older version of the article");
   });
 
   it("marks where the reader is, and does not mark the root", () => {
@@ -877,7 +890,7 @@ describe("SummaryPanel", () => {
        summary that looks like an ordinary one is one the reader cannot weigh.
        It is also what explains why a section reads the way it does. */
     const steered: Summaries = { ...SUMMARIES, guidance: "I care about the evidence" };
-    const out = html({ summaries: steered });
+    const out = html({ owner: { ...OWNER, summaries: steered }, summaries: steered });
     expect(out).toContain("summ-steer-box");
     expect(out).toContain("I care about the evidence");
   });
@@ -885,6 +898,6 @@ describe("SummaryPanel", () => {
   it("offers the steer on a stale article too", () => {
     // The foot is hidden while the summaries are stale, so without this the one
     // article most likely to be rewritten is the one you cannot steer.
-    expect(html({ stale: true })).toContain("Steer these summaries");
+    expect(html({ owner: { ...OWNER, stale: true } })).toContain("Steer these summaries");
   });
 });
diff --git a/tests/summary-expand.test.tsx b/tests/summary-expand.test.tsx
index c0177b5..3b80c13 100644
--- a/tests/summary-expand.test.tsx
+++ b/tests/summary-expand.test.tsx
@@ -107,20 +107,23 @@ const deeps: number[] = [];
    records what the panel asks for rather than moving it. */
 const panel = (deep: number) =>
   createElement(SummaryPanel, {
-        status: "none",
-        summaries: null,
-        stale: false,
-        profiled: false,
-        profileChanged: false,
-        hasProfile: false,
-        error: null,
-        job: null,
-        failed: null,
-        write: async () => {},
-        cancel: () => {},
-        root: tree(),
-        blocks: new Map(),
-        rung: "gist",
+    summaries: null,
+    owner: {
+      status: "none",
+      summaries: null,
+      stale: false,
+      profiled: false,
+      profileChanged: false,
+      hasProfile: false,
+      error: null,
+      job: null,
+      failed: null,
+      write: async () => {},
+      cancel: () => {},
+    },
+    root: tree(),
+    blocks: new Map(),
+    rung: "gist",
     onRung: () => {},
     deep,
     onDeep: (d: number) => deeps.push(d),
```
