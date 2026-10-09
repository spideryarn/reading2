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
 *   `pagesChecked`, `quality`). Facts about our pipeline and about somebody's uploaded
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
  CitationLinkFrom,
  CitationPlace,
  CitationRegistry,
  RegistryWork,
  BlockContext,
  BlockId,
  BlockKind,
  CommentAnchor,
  HighlightColour,
  Crossref,
  DebateBears,
  DebateLean,
  DebateRelation,
  DebateClaimsNotRun,
  DebateSynthesis,
  FaqQuestion,
  ListedClaim,
  SimpleLevel,
  SimpleParagraph,
  GlossaryKind,
  Idea,
  IdentificationSignal,
  NavLabelStatus,
  Quote,
  QuoteDrops,
  SearchHit,
  SearchKind,
  TimelineEvent,
  SkimStop,
  Tree,
  Tweet,
  SourceGuess,
} from "./types.js";
import type { RatedDifficulty } from "./reading-time.js";

/**
 * The masthead, for somebody who is not the owner.
 *
 * Eleven fields. Every one of them is a fact about the article as the world can
 * see it: the title the page itself carried, who wrote it, where and when it
 * was published, what language it is in, the publication's own one-line
 * excerpt, its published address, and how hard a model judged it to read
 * (the eleventh, 2026-10-05).
 *
 * (This said "six" while there were seven: `url` arrived on 2026-08-30 and the
 * count was not moved. `journal`, `published` and `publishedYear` are the
 * three added on 2026-10-04.)
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
   * **The journal the piece appeared in, and when it was published.** Greg,
   * 2026-10-04: "Q-visitor-page yes" — these two facts, and no others. Both
   * are public facts about a published work, and for a paper they come from
   * its public registry record (src/article-registry.ts). `Meta.doi` and
   * `Meta.abstract` were not asked for and stay out.
   * docs/plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md.
   */
  journal?: string;
  /**
   * **The calendar day of publication, `YYYY-MM-DD`, and never
   * `Meta.publishedAt` itself.** The owner's field is the publisher's own
   * string and may carry a time of day and an offset; `publicMeta` sends its
   * first ten characters when they are a real day and nothing otherwise. A
   * different name from the owner's, so neither is mistaken for the other.
   */
  published?: string;
  /**
   * The year alone, for a paper whose registry record states no whole day:
   * the publication date at the precision we hold it. Never beside
   * `published`.
   */
  publishedYear?: number;
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
  /**
   * **How hard the piece is to read**: the two levels and the model's one
   * sentence, so a visitor's minutes and card are the owner's
   * (`Meta.readingDifficulty`, and the same type, which is what keeps
   * `PublicArticle` assignable to `Article`). A judgement about the published
   * text and nothing about its owner. Which model made it, and when, are not
   * sent. Plan 261005j.
   */
  readingDifficulty?: RatedDifficulty;
}

/**
 * **A found guess at an upload's source, as a stranger receives it** — the
 * owner's `found` member of `SourceGuess` minus nothing, because every field of
 * it is drawn: `url` and `host` are the link, `kind` and `matchedBy` choose the
 * words on its card (src/web/Masthead.tsx § `guessTip`). What makes it public is
 * how the DTO fills it, not its shape: `PublicArticle.sourceGuess`.
 */
export type PublicSourceGuess = Omit<Extract<SourceGuess, { status: "found" }>, "status">;

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

/** How a visitor reached an article. `PublicArticle.sharedBy` says what each means. */
export type PublicSharedBy = "public" | "link";

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
  /**
   * **Which way this visitor was let in**: the article is public, or the
   * request carried the key of its private link
   * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md).
   *
   * It is here so the notice under the masthead can say the right thing. Greg,
   * 2026-10-05: *"When they open a page with a private link, it should say
   * that it's a private link, i.e. not visible to anyone without the link"*.
   *
   * **`"public"` whenever the article is public, whatever key came with the
   * request.** Public wins, so a public article opened through an old private
   * link shows the public notice. `"link"` means the article is private and
   * the key was right.
   *
   * Required, so a projection that forgot it does not compile. It says nothing
   * about a person, and the key itself is never in this payload.
   */
  sharedBy: PublicSharedBy;
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
  /**
   * **Where we think an uploaded paper came from**, for a stranger — the
   * public projection 260929g § Decisions 4 deferred, built by
   * docs/plans/261002g-a-banner-on-every-public-readable-article.md so the
   * visitor's banner can name a source for an upload too.
   *
   * Only a `found` guess crosses, and only what the link draws: no `why`, no
   * model, no counts, no claim token. `url` has been through `publicSourceUrl`
   * (src/urls.ts), the policy the article's own address gets, and `host` is
   * derived from that published `url` rather than copied from the stored
   * column, which nothing ties to it (src/db/schema.ts § `upload_source_guesses`).
   * Absent when nobody has looked, when the search found nothing, or when the
   * policy refused the address — a visitor is told nothing in all three.
   */
  sourceGuess?: PublicSourceGuess;
  /**
   * **The cross-references the prose draws** — since 2026-10-01 (plan 261001b,
   * SPIDERYARN-READING2-5Z; Greg's approval of the defence edit).
   *
   * Absent when none were built, and also **when they are stale**: the public
   * reader asks `isStale` (src/crossrefs-fingerprint.ts) exactly as the owner's
   * read does, because a link can still name two surviving blocks and a phrase
   * that still matches while no longer being true, and the prose has nowhere to
   * say "out of date" (Sol F8 on 260930f). So a present key is always drawable.
   *
   * Only the links, and only `{from, phrase, to}` each: a phrase is the
   * article's own characters and both ends are blocks of this payload. `dropped`
   * and the pipeline stamp stay behind. No profile goes into the call.
   */
  crossrefs?: PublicCrossrefs;
}

/** The cross-references, as a visitor gets them. `PublicArticle.crossrefs`. */
export interface PublicCrossrefs {
  links: Crossref[];
}

/**
 * **The public artefacts a shared link carries, and the one rule about them:
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
 * **No `entry.lookup` or `entry.hidden` on a glossary entry.** A lookup is the
 * owner's requested answer, its citations, its search count, its model and its
 * exact time; `hidden` is their choice about what appears while they read. The
 * Postgres read seam attaches both deliberately for the owner, and neither is a
 * stranger's to see.
 * Both private tables stay unreachable from the public graph, and the
 * schema-derived table guard in tests/public-imports.test.ts is what makes that
 * a fact rather than an intention.
 *
 * **No generator, version, slug, sourceHash, passes, generatedAt or elapsedMs**
 * on any of them. Facts about our pipeline and its timings.
 */
export interface PublicArtefactSet {
  glossary?: PublicGlossary;
  ideas?: PublicIdeas;
  quotes?: PublicQuotes;
  tweets?: PublicTweets;
  timeline?: PublicTimeline;
  skim?: PublicSkim;
  faq?: PublicFaq;
  simpleSummary?: PublicSimpleSummary;
  citations?: PublicCitations;
  debate?: PublicDebate;
  debateClaims?: PublicDebateClaimList;
  sketch?: PublicSketch;
}

/**
 * One glossary entry, minus the reader's lookup and hide preference.
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
   * **When the list was last written — and it crosses, like `discarded`,
   * because the reader is shown it.** A quote's card says who chose it and
   * when; a quote stored before `Quote.addedAt` existed (2026-10-03) has no time
   * of its own, and the honest thing left to say is *on or before* this. It is
   * an upper bound, never a quote's own time. docs/project/quotes.md § Your
   * highlights are rows too.
   */
  generatedAt: string;
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
 * **The Skim route, as a visitor gets it** — since 2026-09-29, when a
 * signed-out reader of a public article with a stored route was shown the
 * owners-only boundary instead (SPIDERYARN-READING2-56). Reading a route costs
 * nothing; only planning one spends, and nothing in a visitor's client can.
 * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md.
 *
 * **The stops cross field by field** — `{ quoteId, depth, role, cue, again }`,
 * all of them about the article: a quote id the payload's `quotes` resolves, a
 * pass, the model's optional line to read the passage with (`null` where it
 * gave none, which since `skim/11` is most stops), and the deeper passes
 * the stop is walked in again (`skim/9`, plan 261003l — without it a visitor
 * would walk a different pass from the owner).
 *
 * **`offered` crosses** for `PublicQuotes.discarded`'s reason: the panel prints
 * it at the deepest pass (*"stops at 12 of the 15 quotes offered to this
 * route"*), so a visitor is shown it and stripping it would make that sentence
 * true for owners only.
 *
 * **What does not cross**: `profileHash`, above all — it is *who the route was
 * planned for*, a fact about a person, and the same rule keeps it off
 * `PublicSketch`. A visitor must not learn from the payload whether the owner
 * has a profile. Then the pipeline facts as everywhere in this file: `version`,
 * `generator`, `slug`, `sourceHash`, `visible`, `dropped`, `generatedAt`,
 * `elapsedMs`.
 *
 * The cues *may* have been shaped by the owner's profile and their *why I'm
 * reading this*, exactly as the glossary, ideas, quotes, tweets and sketch may;
 * `PROFILE_RULES` (src/profile.ts) forbids a sentence about the reader, and
 * /features/public-readable-sharing tells the author so.
 */
export interface PublicSkim {
  stops: SkimStop[];
  offered: number;
}

/**
 * **The FAQ, as a visitor gets it** — since 2026-09-29, the second mode plan
 * 260929c moved off `owners-only` (SPIDERYARN-READING2-56). Showing the stored
 * questions costs nothing; only asking the model for them spends.
 * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md.
 *
 * **The questions cross field by field** — `{ id, question, passages }`, and
 * each passage `{ blockId, quote, start }`: the model's question and the
 * article's own characters, all of it about the piece. No profile is in this
 * stage at all ("No profile in v1", src/faq.ts), so there is nothing about a
 * person to drop.
 *
 * **What does not cross** is the pipeline, as everywhere in this file:
 * `version`, `generator`, `slug`, `sourceHash`, `generatedAt`, `elapsedMs` —
 * and `dropped`, the counts validation threw away, which the owner's (i) card
 * includes and a visitor's does not: a fact about our checking, not about the
 * piece.
 */
export interface PublicFaq {
  questions: FaqQuestion[];
}

/**
 * **Debate's claims list, as a visitor gets it** — from the day it was built
 * (2026-10-08, docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2).
 * Generated output about the article, so readable by a visitor by default
 * (docs/project/mode.md § The artefact); only making it spends.
 *
 * **Each claim crosses field by field** — `{ id, blockId, quote, statement }`:
 * the article's own words, where they are, and the model's one-line wording of
 * the claim. No profile is in this stage, so there is nothing about a person
 * to drop. **Read-only**: the visitor's panel has no button to make, redo or
 * check one.
 *
 * **What does not cross** is the pipeline, as everywhere in this file —
 * `version`, `generator`, `slug`, `sourceHash`, `generatedAt`, `elapsedMs` —
 * and `dropped`, our checking's tally. Nor does any check the owner ran on a
 * listed claim: those are a separate table (plan § 4).
 */
export interface PublicDebateClaimList {
  claims: ListedClaim[];
}

/**
 * **Simple, as a visitor gets it** — Summary's plain-words sub-mode, from the
 * day it was built (docs/plans/260930i-simple-summaries-eli15-sub-mode.md).
 * Generated output, so readable by a visitor by default
 * (docs/project/mode.md § The artefact): showing the stored paragraphs
 * costs nothing, and only making them spends.
 *
 * **The paragraphs cross field by field** — `{ text, ids }`: the model's plain
 * words about the piece and the block ids of passages the payload already
 * carries whole, at every level. And `sentences` when `usableSentences` says
 * they are that paragraph's text exactly (plan 261002e): the same words, cut
 * at sentence ends, each with one of the paragraph's own ids or none, so
 * nothing new is disclosed. Since plan 261004b a sentence may carry `key`, a
 * phrase of its own text to draw bold, and a paragraph `list: true`; neither
 * adds a word.
 *
 * **What does not cross** is the pipeline, as everywhere in this file:
 * `version`, `generator`, `slug`, `sourceHash`, `generatedAt`, `elapsedMs` —
 * and `profileHash`, the owner's. Since 2026-10-01 the paragraphs are pitched
 * at the owner's profile and goal, as a profiled glossary's are, and the owner's
 * *make public* dialog says so (plan 261001b).
 */
export interface PublicSimpleSummary {
  levels: Record<SimpleLevel, SimpleParagraph[]>;
}

/**
 * **One cited work, as a visitor gets it** — `CitedWork` minus three things.
 *
 * - **`key` does not cross.** It is our dedupe key, and it can embed an address
 *   (`url:…`) that never went through the check `url` goes through below.
 * - **`found` does not cross.** It is the owner's own *Find it* — a paid search
 *   they ran, from the per-owner `citation_finds` table — and a record of their
 *   activity, like a glossary lookup (plan 260929c § What stays owner-only). It
 *   is never in the stored column anyway; the owner's read attaches it.
 * - **`url` is optional here, and required on `CitedWork`.** Every address is
 *   re-judged by `publicCitationUrl` (src/urls.ts) at the boundary, and a
 *   refused one takes the *link* off the row, not the row: a citation is still
 *   a citation without an address, unlike a Debate row, which is its source.
 *
 * `reference` and `mentions` carry the article's own characters, sliced out of
 * blocks the payload already carries whole, so they add nothing a visitor
 * could not read in the prose.
 */
export interface PublicCitedWork {
  id: string;
  title: string;
  authors?: string;
  year?: string;
  why: string;
  relevance?: number;
  influence?: number;
  reference?: CitationPlace;
  /**
   * **The work's entry, only when it is the text of its own `reference`
   * block** — since 2026-10-01 (plan 261001b, SPIDERYARN-READING2-6K). Then
   * every character of it is already in this payload's `blocks`.
   *
   * **An entry read from a PDF's text layer does not cross.** Furniture is
   * removed only when a line repeats on three or more pages (src/pdf.ts), so a
   * publisher's "Downloaded by …" stamp printed on one page can sit inside an
   * entry, and that would name the person who downloaded the PDF — the owner,
   * usually. GPT Sol, plan review P1. `publicCitedWork` checks.
   */
  entry?: string;
  mentions: CitationPlace[];
  citedAt: BlockId[];
  firstCited: BlockId;
  citedInBody: boolean;
  url?: string;
  /** The article's source rule. `web` is the owner's private Find-it result
   * and is normalised back to `search` at the public boundary. */
  linkFrom: Exclude<CitationLinkFrom, "web">;
  /**
   * **A found registry record only** (plan 261001a stage 5): public metadata
   * about the public identifier the row already links, rebuilt field by field
   * by `readRegistryWork`. A `conflict` does not cross — the visitor's row is
   * drawn as the article gives it, without our verdict on its identifier.
   */
  registry?: PublicCitationRegistry;
}

/** The `found` arm of `CitationRegistry`, and only it. */
export type PublicCitationRegistry = Extract<CitationRegistry, { kind: "found" }>;

/**
 * **The Citations list, as a visitor gets it** — since 2026-09-29, the third
 * mode plan 260929c moved off `owners-only` (SPIDERYARN-READING2-56).
 *
 * `capped` crosses for `PublicQuotes.discarded`'s reason: the panel prints it
 * (*"This piece cites more than 80 works…"*), so a visitor is shown it. The
 * pipeline facts do not: `version`, `generator`, `slug`, `sourceHash`,
 * `generatedAt`, `elapsedMs`. No profile is in this stage.
 */
export interface PublicCitations {
  citations: PublicCitedWork[];
  capped: boolean;
}

/**
 * **One way a page showed it was about this article, as a visitor gets it** —
 * `IdentificationSignal` with one difference: a `linked` signal's `url` may be
 * absent.
 *
 * That address is **the article's own**, as the stranger's page spelled it
 * (`linkTo` in src/debate.ts matches it against the article's `meta.url`, which
 * is `final_url`), and `describeSignal` prints it. So it is judged by the policy
 * `publicMeta` applies to the article's own address — `publicSourceUrl`, which
 * also refuses a query string — and a refusal takes the address off the signal
 * and leaves the fact that the page links the piece. GPT Sol, plan review 1
 * (P0), plan 260929c. The other two arms are rebuilt field by field.
 */
export type PublicIdentificationSignal =
  | { kind: "linked"; url?: string }
  | Extract<IdentificationSignal, { kind: "quoted" }>
  | Extract<IdentificationSignal, { kind: "named" }>;

/**
 * What both of a visitor's Debate rows carry — the owner's row, minus nothing
 * but provenance it never had, and with `lean` always present: a row stored
 * before 2026-09-08 carries `valence` instead, and the boundary reads it
 * through `readStoredLean` so a visitor never meets the old vocabulary.
 *
 * **`url` is required**, and that is the contract 260905f § Security set: a
 * Debate row *is* its source, so a row whose address `publicCitationUrl`
 * refuses does not cross at all — it is counted instead.
 */
interface PublicDebateRowBase {
  id: string;
  url: string;
  title?: string;
  sourceQuote: string;
  relation: DebateRelation;
  lean: DebateLean;
  applies: string;
  limits?: string;
  /**
   * **How much the passage bears on the row's target** — since 2026-10-01
   * (plan 261001b, SPIDERYARN-READING2-5P). One of three closed words, the
   * model's judgement of a stranger's page against the article, read through
   * `readStoredBears` so a value outside the vocabulary is absent, never
   * defaulted. Nothing about the reader goes into it.
   */
  bears?: DebateBears;
  /** The registry's record for the identifier the row's address carries (plan 261001a stage 6), rebuilt by `readRegistryWork`. */
  registry?: RegistryWork;
}

/** A page about this piece, as a visitor gets it. `identifies` is never empty — the boundary reads it through `identifiesOf`. */
export interface PublicDirectDebateRow extends PublicDebateRowBase {
  articleReferenceQuote: string;
  identifies: PublicIdentificationSignal[];
}

/** A page that answers a claim the piece makes, as a visitor gets it. */
export interface PublicClaimDebateRow extends PublicDebateRowBase {
  claimQuote: string;
  blockId: BlockId;
}

/**
 * One Debate group, as a visitor gets it: its rows, and **how many
 * rows the public boundary withheld** — computed there, never read off the
 * artefact (260905f § What is counted, Sol's F17). The stored `counts` do not
 * cross: `returnedSources`, `reportedRows`, `keptRows`, `omittedOverCap`, the
 * loss reasons and `webSearches` are facts about our search and our checking,
 * which the owner's foot lines print and a visitor's do not — the FAQ's
 * `dropped`, one mode along.
 */
export interface PublicDebateGroup<Row> {
  rows: Row[];
  /**
   * Rows the boundary did not publish: the source address `publicCitationUrl`
   * refused (a credential, a private host), or a row whose text carries an
   * address the boundary refused — the article's own, above all. The
   * visitor's foot line says so in plain words, so a shorter list is never a
   * silent one.
   */
  sourceNotPublishable: number;
}

/** The claims group as a visitor gets it: searched (a legacy debate), or not run. src/types.ts § `DebateClaims`. */
export type PublicDebateClaims =
  | (PublicDebateGroup<PublicClaimDebateRow> & { pass?: undefined })
  | DebateClaimsNotRun;

/**
 * **The Debate, as a visitor gets it** — since 2026-09-29, the fourth mode plan
 * 260929c moved off `owners-only` (SPIDERYARN-READING2-56), by the contract its
 * own plan set (260905f § Security, § Stage 4). Showing a stored search costs
 * nothing; only running Reception spends its metered web-search call.
 *
 * `searchedAt` crosses **deliberately** — a shared link outlives a search, and
 * a visitor must be able to see how old it is (260905f § `searchedAt`). The
 * rest of the pipeline does not: `version`, `generator`, `slug`, `sourceHash`,
 * `elapsedMs`, and every stored count. No profile is in this stage.
 */
export interface PublicDebate {
  searchedAt: string;
  direct: PublicDebateGroup<PublicDirectDebateRow>;
  /**
   * The claims search's rows — or `{pass: "not-run"}` for a debate searched at
   * `debate/7` or later, when the press stopped searching for claims
   * (src/types.ts § `DebateClaims`). Carried across as it is stored, so a
   * visitor is never told a search found nothing when none ran.
   */
  claims: PublicDebateClaims;
  /**
   * **The threads and the key sources** — since 2026-10-01 (plan 261001b,
   * SPIDERYARN-READING2-6M). The model's words over the rows the search kept;
   * no profile goes into the call.
   *
   * **A `made` synthesis crosses only when no row was withheld** in either
   * group. The call saw every row, so a theme kept over two published rows can
   * still summarise a withheld one in its gist without quoting its address,
   * and nothing at this boundary could tell (GPT Sol, plan review P1). Even
   * then it is re-settled against the published rows (`settleSynthesis`), so
   * every row id it names is one this payload carries. `failed` and `too-few`
   * carry no prose and cross as they are. Absent when the debate was searched
   * before 2026-09-30, or when withholding took it off.
   */
  synthesis?: DebateSynthesis;
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
 * public read admits bare notes (`none`) and answered notes (`done`) in SQL;
 * the visitor needs neither operational status.
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
export type PublicComment = PublicCommentFields & CommentAnchor;

/**
 * Everything but the anchor. The anchor is `CommentAnchor`: the article's own
 * characters at the offsets the mark was made against — or, on a whole-block
 * bookmark, neither, and the visitor sees the gutter mark alone.
 */
interface PublicCommentFields {
  /** Stable identity, so `?comment=` and the gutter mark agree. */
  id: string;
  blockId: BlockId;
  createdAt: string;
  /** The reader's own words. Absent on a bare bookmark, never `""`. */
  body?: string;
  /** What the model said back, when the reader ticked the box. */
  answer?: string;
  /**
   * A highlight's colour, by name. Presentation, not private: it is how the
   * owner marked the words, and a shared highlight that arrived as a plain
   * underline would have stopped being a highlight. Absent for none.
   */
  colour?: HighlightColour;
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
  /**
   * **Which matcher answered** — `SearchRun.kind`. It crosses because it says
   * what the passages and their numbers *are*: a quick run's confidence is
   * Jev's probability and its quote is the whole paragraph, and a visitor
   * reading those as a meaning search's would be misreading them. Nothing
   * about a person in it. Plan 261002e, F6.
   */
  kind: SearchKind;
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
 * These booleans are still exactly what a visitor's page is keyed on and
 * every importer still reaches them through this file. What changed is that a
 * *second* reader appeared on the owner's side of the line:
 * `ArticleSharing.available` in src/types.ts carries the same set, so that the
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
