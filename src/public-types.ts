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
 * The first draft of docs/plans/260827ai-public-read-only-access.md proposed serving
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
 *   whole of `stages`. The visitor's metadata page says which artefacts exist
 *   and nothing whatever about how they were made, and it says it from the
 *   article payload — `PublicArtefacts` below, derived by
 *   src/web/public-artefacts.ts.
 *
 * See docs/plans/260827ai-public-read-only-access.md § The payload for the table these
 * came from, and § What a public visitor gets for the product decisions behind
 * it.
 */

import type { Assets } from "./assets.js";
import type { SketchScene } from "./sketch-scene.js";
import type {
  Arc,
  Citation,
  BlockContext,
  BlockId,
  BlockKind,
  GlossaryKind,
  Idea,
  NavLabelStatus,
  Quote,
  QuoteDrops,
  SearchHit,
  TimelineEvent,
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
   * owns the article may turn an absence into that sentence. `OriginLine` in
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
  /**
   * The authored box this block is inside — `Block.context` in types.ts. It
   * crosses for the same reason the note fields do: it is a fact about the
   * article, and the reading view sets a callout differently because of it.
   */
  context?: BlockContext;
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
   * **The owner's comments — a required array, unlike every artefact above.**
   *
   * The optional keys in `PublicArtefactSet` answer *did anybody build one of
   * these*, where absent means nobody ran the step. Comments are not built and
   * there is no step: an article with none is an article nobody wrote on, which
   * is an ordinary and very common state rather than a missing artefact. So the
   * empty case is `[]` and it means what it says.
   *
   * GPT Sol's correction, and it took a union member out of `VisitorGap` with
   * it: *"No saved items yet is content inside an accessible panel, not
   * something preventing access."* An empty comments drawer is an empty drawer.
   * docs/plans/260904c-more-modes-on-a-shared-link.md.
   */
  comments: PublicComment[];
  /**
   * **The owner's saved meaning-searches, read-only** — a required array, for
   * the reason `comments` above is.
   *
   * Greg, 2026-09-04, asked what a visitor should be able to do with search:
   *
   * > Only owner can create new searches. Everyone else can see the ones they
   * > have already created.
   *
   * So this is the whole of the visitor's search mode. The *words* matcher —
   * `?find=`, free, and computed in the browser over blocks the visitor already
   * holds — is deliberately not offered in v1 either; see
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4 for why the
   * simpler thing was to leave it out rather than to split the composer in two.
   */
  searches: PublicSearchRun[];
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
   *    chair (docs/plans/260829b-hosting-the-articles-images.md#delivery).
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
  /**
   * **Where the paragraph nav labels are** — the same `NavLabelStatus` the
   * owner gets, and the same argument `assets` above makes for being a required
   * key rather than an optional one: the reading view takes an `Article`, a
   * public payload reaches it by being structurally one, and `Article` requires
   * it.
   *
   * It crosses for the reason `Tree.provisional` crosses. Both say *this part
   * of the structure has not arrived*, and a client that cannot tell that from
   * *this article has no paragraph labels* draws a run of blank cells and
   * reports our own unfinished work as the shape of somebody's article.
   *
   * **The enum, and nothing else.** `failed` never brings a reason with it —
   * a provider's error body is the one place an upstream can echo the article
   * back at us (docs/project/copy.md § rule 4), and a visitor could act on it
   * even less than the owner can. Three words about our pipeline's state is the
   * whole of it, and none of them is about a person.
   */
  navLabelStatus: NavLabelStatus;
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
 * every way the two answers could disagree. docs/plans/260827ai-public-read-only-access.md
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
 * `src/glossary.ts`, `src/tweets.ts` and `src/ideas.ts` —
 * the writer modules, which tests/public-imports.test.ts forbids the public
 * graph from reaching because they pull in the model machinery. Carrying them
 * would mean extracting three freshness functions into import-free leaves across
 * three writer modules. And a visitor could not act on either: both mean *the
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
  ideas?: PublicIdeas;
  quotes?: PublicQuotes;
  tweets?: PublicTweets;
  timeline?: PublicTimeline;
  sketch?: PublicSketch;
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

/** The propositions the piece assumes or introduces. `Idea` carries nothing about a person. */
export interface PublicIdeas {
  ideas: Idea[];
}

/**
 * The lines worth keeping. `Quote` carries nothing about a person.
 *
 * **The one artefact whose payload is the author's own prose**, which is why
 * there is nothing to strip: a quote is `blockId`, `text`, `start`, a caption
 * and two numbers, and every one of those is already on the page a visitor is
 * reading. The projection exists so that the pipeline facts around it —
 * `sourceHash`, `generator`, `version`, `profileHash` — do not travel.
 */
export interface PublicQuotes {
  quotes: Quote[];
  /**
   * **What the stage refused to store — and it crosses, where every other
   * pipeline fact in this file does not.**
   *
   * The rule this projection keeps is that facts about *our pipeline* stay
   * behind: no `generator`, no `version`, no `sourceHash`, no timings. These
   * counts look like one of those and are not. They are a fact about **the list
   * on the screen** — that it is shorter than what was produced, and why — and
   * the panel says so in a sentence. A visitor reading that list has exactly
   * the same interest in knowing as its owner does, so stripping this would
   * make the claim "the reader is told" true for half the readers and quietly
   * false for the other half. GPT Sol asked the question, 2026-08-31; this is
   * the answer.
   *
   * Optional because an artefact written before the field existed has none.
   */
  discarded?: QuoteDrops;
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
 * **When the piece says these things happened.**
 *
 * `TimelineEvent` carries nothing about a person — a label, what the article's
 * own words said about when, the model's reading of the sequence, and the
 * offsets of the passages it came from. So the events cross whole, exactly as
 * `Idea` and `Quote` do, and the projection's whole job is the envelope around
 * them.
 *
 * **`orderConflicts` does not cross**, and it is the one field here worth
 * arguing about. It is the count of pairs the article's own dates order one way
 * and the model ordered the other, and `src/types.ts` says of it: *"Changes
 * nothing on screen and is not shown to a reader; it is the only signal we get
 * that the model misread the chronology."* That makes it a fact about our
 * pipeline's quality rather than about the piece, which is the line this file
 * draws everywhere else. Note the contrast with `PublicQuotes.discarded`, which
 * *does* cross because the panel puts it in a sentence a visitor reads: the
 * test is whether the reader is shown it, not whether it is a number.
 */
export interface PublicTimeline {
  /** In the order they are to be shown. **Never re-sorted by a reader.** */
  events: TimelineEvent[];
}

/**
 * **The model's drawing of the argument, as a visitor gets it.**
 *
 * Since 2026-09-04 a shared link carries the Sketch the owner already paid to
 * have drawn — and only that. Greg's decision, and the second half of it
 * matters more than the first: *an already-drawn Sketch*. Nothing in a
 * visitor's client can start one.
 *
 * **The scenes cross whole**, like `Idea[]` and `TimelineEvent[]` and unlike
 * the glossary. A `SketchScene` is geometry and the model's own labels — boxes,
 * regions, edges, coordinates, tones — plus `SketchNode.block`, which is a
 * block id of the article the visitor is already reading and is what makes
 * pressing a box jump the prose. There is nothing in the shape that is about a
 * person, so a hand-copy would be a hundred lines of transcription with a typo
 * in it and no extra safety. If a field about a reader is ever added to a
 * scene, this comment is wrong and `tests/public-dto.test.ts` is what says so.
 *
 * **What does not cross**, and one of these is not like the others:
 *
 * - `version`, `generator`, `slug`, `sourceHash` — pipeline facts, as
 *   everywhere else in this file.
 * - **`profileHash`**, which is the interesting one. It is *who the picture was
 *   drawn for*: a hash of the owner's reader profile. It says nothing legible
 *   on its own, and that is not the point — it is a fact about a person rather
 *   than about the article, and the same rule already keeps `Summaries` and
 *   `Sketch` provenance off the wire. A visitor is looking at a drawing made
 *   for somebody else, and does not get to know anything about them.
 */
export interface PublicSketch {
  /** A name for the shape, not for the article. */
  title: string;
  caption: string;
  /** `scenes[0]` is the overview; the rest are what a node's `opens` reaches. */
  scenes: SketchScene[];
}

/**
 * **One of the owner's comments, as a visitor gets it.**
 *
 * Since 2026-09-04 a shared link carries the reader's marks on the passages,
 * what they wrote about them, and what the model answered when they asked.
 * Greg's decision, and the one thing in this file that is a **privacy** choice
 * rather than a pipeline one: everything else here is the article or a model's
 * work on it, and this is a person's own words.
 * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
 *
 * ## What is not here, and which kind of reason each one is
 *
 * **Operational** — `error`, `attemptId`, `leaseExpiresAt`, `model`,
 * `searches`, `status`. How our machine got on, not what the reader said. The
 * public read filters to finished rows in SQL, so `status` would be a constant
 * on the wire as well as an internal fact.
 *
 * **Somebody else's feature** — `criterionId` and `valence`. A comment with a
 * criterion is a **referee's** placement of a passage on a scale, not a reading
 * note (src/types.ts § `Comment.criterionId` draws exactly that line). Dropping
 * the two fields would publish the *body* of a peer review with its context
 * removed, which is worse than publishing it whole. **So the row is filtered
 * out entirely**, in the query, and these two keys are absent as a second
 * statement of the same decision. GPT Sol found this; the plan has it as a
 * blocking finding.
 *
 * **Pointing at something a visitor has not got** — `threadId`. It names a chat
 * conversation, and chat is not shared (chat-tools.md § a transcript cannot be
 * published by column allowlist). A key whose only use is to open something
 * that is not there is worse than no key.
 *
 * **Ordinary provenance** — `articleId`, `ownerId`, `updatedAt`. The first two
 * are ours; the third would say *"edited"* on a screen with nothing to compare
 * it against.
 */
export interface PublicComment {
  /** Stable identity, so `?comment=` and the gutter mark agree. */
  id: string;
  blockId: BlockId;
  /** The article's own characters, at the offsets the mark was made against. */
  quote: string;
  start: number;
  createdAt: string;
  /** The reader's own words. Absent on a bare bookmark, never `""`. */
  body?: string;
  /** What the model said back, when the reader ticked the box. */
  answer?: string;
  /**
   * Where the answer says it came from, **rebuilt and re-judged**.
   *
   * Every URL goes through `publicCitationUrl` (src/urls.ts) rather than
   * crossing as stored: a citation carrying credentials, or naming a host only
   * this machine can reach, is the one thing in a comment that a stranger must
   * not be handed. One that fails is dropped, not blanked — a citation with no
   * address is a footnote to nowhere.
   */
  citations?: Citation[];
}

/**
 * **One of the owner's saved searches, as a visitor gets it.**
 *
 * A search run is two things at once, and only one of them is the article:
 * `hits` are passages of the piece the visitor is already reading, and
 * `criterion` is **the reader's own writing** — what they typed, in their own
 * words. That second half is disclosure rather than prose, the same kind of
 * thing `PublicComment.body` is, and it is named here so nobody has to
 * rediscover it while deciding what a future field is.
 *
 * ## What is not here, and which kind of reason each one is
 *
 * **Operational** — `model`, `error`, `attemptId`, `attemptStartedAt`,
 * `status`. How our machine got on. The public read takes finished runs only,
 * in SQL, so `status` would be a constant on the wire as well as an internal
 * fact.
 *
 * **Ours** — `articleId` and `ownerId`.
 *
 * **Answered rather than handed over** — `sourceHash`. A fingerprint of the
 * blocks the run was answered against (src/source-hash.ts), and it crosses as
 * the derived `stale` below instead: a visitor's question is *is this still
 * about the article I am reading*, and the hash is our way of working that out,
 * not theirs. Every other artefact already publishes freshness this way.
 */
export interface PublicSearchRun {
  /** Stable identity, so `?runs=` and the marks in the prose agree. */
  id: string;
  /** What the reader typed, in their own words. */
  criterion: string;
  createdAt: string;
  /** The passages, rebuilt hit by hit — src/public/dto.ts § publicSearchHits. */
  hits: SearchHit[];
  /**
   * The palette slot the owner pinned this search to, if they pinned one.
   *
   * A number the server has no opinion about — the slot-to-hue step happens in
   * the browser (src/web/hit-colours.ts § the seam) — so it says nothing about
   * a person beyond *this one is the blue one*, and a visitor ticking two
   * searches needs it for the same reason the owner does.
   */
  colour?: number;
  /**
   * **The article has moved since this search was answered — or we cannot
   * tell.** Derived by `isStale` (src/search-stale.ts) against the fingerprint
   * of the blocks in this same payload, so the answer is about the article the
   * visitor is actually being served.
   *
   * Required rather than optional, and computed on the server rather than in
   * the browser, because the client half of this comparison is
   * `SavedSearch.stale` on the owner's side and there must not be two
   * definitions of *current* — that is the whole reason src/source-hash.ts
   * exists as a module.
   */
  stale: boolean;
}

/**
 * **Re-exported, not declared here, and it moved on 2026-09-02.**
 *
 * The five booleans are still exactly what a visitor's page is keyed on and
 * every importer still reaches them through this file. What changed is that a
 * *second* reader appeared on the owner's side of the line:
 * `ArticleSharing.available` in src/types.ts carries the same five, so that the
 * confirmation dialog can list what a shared link will actually carry
 * (docs/plans/260902n-the-sharing-dialog-lists-what-goes-out-and-what-stays.md).
 *
 * The declaration goes to the deeper module rather than `types.ts` importing
 * back from here, and this line keeps the address every existing importer
 * already uses. Not because the tooling refuses the back-import — it does not,
 * and the first version of this note said it did — but because of the property
 * in this file's own header: it imports `types.ts` and nothing else, so the two
 * type modules run one way, and they should keep doing so.
 */
export type { PublicArtefacts } from "./types.js";

