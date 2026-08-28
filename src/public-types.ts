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
 * - **`meta.url`.** That is `final_url`, the URL *after redirects*, and it can
 *   carry credentials or signed query parameters. Stage 2 needs a canonical
 *   link and will have to validate one through `isWebUrl` rather than reach
 *   for this.
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

import type { Arc, BlockId, BlockKind, Tree } from "./types.js";

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
export interface PublicArticle {
  meta: PublicMeta;
  blocks: PublicBlock[];
  tree: Tree;
  arc?: Arc;
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
