/**
 * **What a stranger is served** — the wire shapes of `/api/public/…`, and
 * nothing else.
 *
 * Pure types. This module imports [types.ts](types.ts) and nothing at all, for
 * the reason every shape in this app lives in a file like this: the browser
 * reads these too, and a client importing a module that pulls in pino and reads
 * `process.env` is a bundle waiting to break
 * ([client-imports.test.ts](../tests/client-imports.test.ts)).
 *
 * ## Why these are new types rather than the existing ones with fields removed
 *
 * The first draft of docs/plans/public-read-only-access.md proposed serving
 * today's responses through a recursive key *denylist*. GPT Sol refused it,
 * 2026-08-27:
 *
 * > A recursive key denylist is insufficient: it misses innocently named fields
 * > such as `title`, `guidance`, `comments`, `generatedAt`, `lookup`, and future
 * > aliases such as `owner`, `createdBy`, or snake-case keys.
 *
 * So the rule is the other way round, and it is the whole of the design here:
 * **a field nobody adds to a type below cannot leak, and a field added to an
 * internal type next month is absent by default rather than present by
 * default.** The projections in [public/dto.ts](public/dto.ts) name every key
 * they copy, and tests/public-dto.test.ts asserts the key sets recursively.
 *
 * ## What is deliberately absent, and why each one
 *
 * - **The owner's private rename.** `Article.meta.title` is run through
 *   `titleFor()` by both stores, which substitutes `articles.title_override`.
 *   The public reader never calls it and never selects the column.
 * - **`meta.url` — no longer withheld, since 2026-08-30.** It was, and the
 *   reason was that `final_url` is the URL *after redirects* and can carry
 *   credentials or signed query parameters. Greg decided a public article
 *   should show where it came from, so the reason is now enforced on the
 *   *value* instead of on the key: `publicSourceUrl` (src/urls.ts) refuses a
 *   credential, a query of any kind, a non-public host and a non-web scheme,
 *   and what it returns is what `PublicMeta.url` carries. See the field.
 * - **`meta.fetchedAt`, `meta.note`, and the whole PDF provenance block**
 *   (`source`, `method`, `pages`, `rawSha256`, `unverified`, `recall`,
 *   `pagesChecked`). Facts about our pipeline and about somebody's uploaded
 *   file, not about the piece.
 * - **`Block.note`**, which says why the splitter marked a block ungistable.
 *   Not merely projected away: the public blocks query never selects it, which
 *   is the stronger version of the same rule.
 * - **The comment count**, `purpose`, `profile`, `archivedAt`, `dir` and the
 *   whole of `stages`. `PublicMetadata` says which artefacts exist and nothing
 *   whatever about how they were made.
 *
 * See docs/plans/public-read-only-access.md § The payload for the table these
 * came from, and § What a public visitor gets for the product decisions behind
 * it.
 */

import type { Assets } from "./assets.js";
import type {
  Arc,
  BlockId,
  BlockKind,
  GlossaryKind,
  Idea,
  SummaryEntry,
  Tree,
  Tweet,
} from "./types.js";

/**
 * The masthead, for somebody who is not the owner.
 *
 * Six fields out of `Meta`'s twenty. Every one of them is a fact about the
 * article as the world can see it: the title the page itself carried, who wrote
 * it, where it was published, what language it is in, and the publication's own
 * one-line excerpt.
 */
export interface PublicMeta {
  slug: string;
  /**
   * **The extracted title, never the reader's rename.**
   *
   * Falls back to the article's own first `<h1>` and then to the slug, exactly
   * as `metaFrom` does — that fallback is about the article and is safe. What
   * is not safe is `titleFor()`, which is the next thing the owner path does.
   */
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  /** Readability's own one-or-two sentences, from the page. */
  excerpt?: string;
  /**
   * **Where the article came from, for whoever can read it.** Greg, 2026-08-30:
   * *"I think Public-readable articles should show their provenance-url to all
   * reader[s]."*
   *
   * **Not `articles.final_url`.** It is that column run through
   * `publicSourceUrl` (src/urls.ts), which is the named field the
   * `PUBLIC_PROJECTIONS` comment in src/store/public-reader.ts asked for when it
   * held the column back — the policy, and what it refuses, are in that
   * function's header.
   *
   * **Absent does not mean "uploaded".** It also means the address would not
   * survive the policy, and a visitor cannot tell those apart; only a reader who
   * owns the article may turn an absence into that sentence. `OriginMark` in
   * src/web/Masthead.tsx is the one place that does, and says so.
   */
  url?: string;
}

/**
 * One block of prose. `Block` minus `note`.
 *
 * Structurally assignable to `Block`, and that is on purpose: the reading view
 * is one reading view, and a public block has to render through the same
 * components. What differs is what was fetched, not how it is drawn.
 */
export interface PublicBlock {
  id: BlockId;
  tag: string;
  kind: BlockKind;
  level?: number;
  text: string;
  words: number;
  html: string;
  gistable: boolean;
  /**
   * The three note fields cross in full — `Block.role`, `Block.treatment` and
   * `Block.noteId` in types.ts.
   *
   * They are facts about the article rather than about us: which of its words
   * are apparatus, and which note a paragraph of it belongs to. `noteId` is the
   * one that would be easy to leave out and expensive to add later — the hover
   * preview shows a note's whole *range*, and a range needs an identity.
   */
  role?: "footnote" | "reference" | "acknowledgment" | "credit" | "appendix";
  treatment?: "supplement";
  noteId?: string;
}

/**
 * What `GET /api/public/article/:slug` returns.
 *
 * `tree` and `arc` are the same types the owner gets, and rebuilt field by
 * field on the way out anyway — see `publicTree` in
 * [public/dto.ts](public/dto.ts). Neither carries anything about a person: a
 * tree is the article's skeleton and an arc is a sentence per part. Forking
 * them into public twins would fork the whole granularity-zoom client for no
 * field's sake.
 */
export interface PublicArticle extends PublicArtefactSet {
  meta: PublicMeta;
  blocks: PublicBlock[];
  tree: Tree;
  arc?: Arc;
  /**
   * The article's own images and which of them we hold — the same `Assets` the
   * owner gets, and for the same reason `tree` and `arc` are not forked: it
   * says nothing about a person. Every URL in it is already in the `blocks`
   * beside it, and the rest is a hash, a format and a byte count.
   *
   * **A required key holding `Assets | undefined`, exactly like `Article`'s**,
   * and the two facts that shape depends on are worth stating together:
   *
   * 1. The public path is not optional. `App` falls back to public article
   *    loading for signed-out and non-owning readers, and those readers can
   *    never reach an authenticated route — so an owner-only design would leave
   *    every public article hot-linking while looking finished from the owner's
   *    chair (docs/plans/hosting-the-articles-images.md#delivery).
   * 2. The reading view takes an `Article`, and a public payload reaches it by
   *    being structurally one. An optional key here would not satisfy that
   *    required one, so this is also what keeps the two projections honest with
   *    each other rather than only with themselves.
   *
   * So it is **not** the "absent means never built" rule its four siblings
   * follow. `undefined` carries that same meaning in the value instead, which
   * is what makes an omission in `publicArticle` a type error rather than an
   * article that quietly goes on hot-linking.
   */
  assets: Assets | undefined;
}

/**
 * **The four artefacts a shared link carries, and the one rule about them:
 * a key that is present exists, and a key that is absent was never built.**
 *
 * Slice 1b, and the shape is Greg's decision of 2026-08-28 over GPT Sol's
 * design. Sol specified four new endpoints, a tagged `{status: "ready" |
 * "not-generated"}` wire result and a four-state client read union. All four of
 * these are JSONB columns on the same `article_revisions` row
 * `GET /api/public/article/:slug` already fetches, so folding them into that one
 * payload removes the second request, the twelve wire states it could be in, and
 * every way the two answers could disagree. docs/plans/public-read-only-access.md
 * § Slice 1b.
 *
 * **Absent is the only "no".** Not `null`, not an empty object, not a tagged
 * `not-generated` — because the client's question is *does this piece have a
 * glossary*, and a stored `{entries: []}` is a **ready but empty** artefact
 * rather than a missing one. Somebody ran the step and it found nothing, which
 * is a different sentence from nobody having run it. A truthiness or a length
 * test here would collapse the two.
 *
 * ## What is not here, and it is the most important paragraph in this file
 *
 * **No `stale`, no `outdated`.** Both are computed by `isStale` in
 * `src/glossary.ts`, `src/summarise.ts`, `src/tweets.ts` and `src/ideas.ts` —
 * the writer modules, which tests/public-imports.test.ts forbids the public
 * graph from reaching because they pull in the model machinery. Carrying them
 * would mean extracting four freshness functions into import-free leaves across
 * four writer modules. And a visitor could not act on either: both mean *the
 * owner might want to regenerate this*, and the owner is the only person who
 * can.
 *
 * **No `profileHash`, no `profileChanged`, no `personalised`.** The first is
 * provenance about a person; the second cannot be computed without a reader at
 * all; the third was put to Greg on 2026-08-28 and deferred — one field and one
 * sentence, addable any time.
 *
 * **No `entry.lookup` on a glossary entry.** A lookup is the owner's requested
 * answer, its citations, its search count, its model and its exact time — and
 * the Postgres read seam attaches them to the glossary deliberately, which is
 * correct for the owner and is the leak this projection exists to stop.
 * `glossary_lookups` stays unreachable from the public graph, and the
 * four-table guard in tests/public-imports.test.ts is what makes that a fact
 * rather than an intention.
 *
 * **No generator, version, slug, sourceHash, passes, generatedAt or elapsedMs**
 * on any of the four. Facts about our pipeline and its timings.
 */
export interface PublicArtefactSet {
  glossary?: PublicGlossary;
  summary?: PublicSummaries;
  ideas?: PublicIdeas;
  tweets?: PublicTweets;
}

/**
 * One glossary entry, minus the reader's lookup.
 *
 * Structurally assignable to `GlossaryEntry`, exactly as `PublicBlock` is to
 * `Block` and for the same reason: the glossary panel is one panel, and a
 * visitor's entry has to render through the same component. What differs is
 * what was fetched, not how it is drawn.
 *
 * **The id crosses**, and it has to: `?term=` links, the prose underlines and
 * entry-to-block navigation all need a stable identity, and a client left to
 * invent one would invent an unstable one. Carrying an id does not carry a
 * lookup — nothing public can reach the table lookups live in.
 *
 * **`gloss`, `detail` and `fromOutside` cross although all three were
 * superseded on 2026-08-26**, because artefacts written before that date still
 * carry them and the panel still renders them. Dropping them here would make
 * older shared articles render as entries with nothing in them.
 */
export interface PublicGlossaryEntry {
  id: string;
  name: string;
  kind: GlossaryKind;
  aliases: string[];
  senseHere?: string;
  background?: string;
  gloss?: string;
  detail?: string;
  url?: string;
  difficulty?: number;
  centrality?: number;
  fromOutside?: boolean;
  blocks: BlockId[];
}

/** The list, and nothing about when or how it was written. */
export interface PublicGlossary {
  entries: PublicGlossaryEntry[];
}

/**
 * The summary ladder.
 *
 * `SummaryEntry` is carried whole — `range`, `depth`, `short?`, `long?` is all
 * there is of it — and rebuilt field by field on the way out anyway, so a field
 * added to it next month is absent from a public response until somebody adds a
 * line to the projection.
 *
 * **`missing` crosses.** It is the reader's only sign that an apparently
 * complete summary is partial: some nodes' batches came back unusable and were
 * written without text. Withholding it would make a gap look like a whole.
 */
export interface PublicSummaries {
  entries: SummaryEntry[];
  missing: number;
}

/** The propositions the piece assumes or introduces. `Idea` carries nothing about a person. */
export interface PublicIdeas {
  ideas: Idea[];
}

/**
 * The article as a numbered thread.
 *
 * `limit` crosses because the count on every post is against it: a thread
 * written under an older limit reports itself honestly, and a page that
 * re-judged it under today's number would flag posts nobody wrote wrong.
 */
export interface PublicTweets {
  limit: number;
  tweets: Tweet[];
}

/**
 * Which artefacts exist for this article — and **nothing about how they were
 * made**.
 *
 * The owner's metadata page answers a different question: which pipeline stage
 * ran, when, into which column, over how many bytes, and whether we would write
 * it again today. None of that is a visitor's business and most of it is
 * internal paths and timings. This is the replacement Sol asked for: five
 * booleans.
 *
 * A visitor pressing **Glossary** on an article with none gets *"nobody has
 * built a glossary for this piece yet"* — a real screen rather than a gap, and
 * this is the field that decides it. docs/project/copy.md owns the sentence.
 */
export interface PublicArtefacts {
  arc: boolean;
  tweets: boolean;
  glossary: boolean;
  summary: boolean;
  ideas: boolean;
}

/** What `GET /api/public/metadata/:slug` returns. */
export interface PublicMetadata {
  slug: string;
  /** The same title `PublicArticle.meta` carries, by the same rule. */
  title: string;
  available: PublicArtefacts;
}
