/**
 * Shared types for the artefacts on disk, used by both the API loader and the
 * React client. See docs/project/architecture.md#storage.
 *
 * `Block` is declared **here and only here**, and src/blocks.ts (pipeline
 * stage 3) imports it. It used to be duplicated, on the reasoning that blocks.ts
 * pulls in jsdom and jsdom must not reach the browser bundle — true of a value
 * import, but an `import type` is erased, so the duplication bought nothing and
 * cost the one guarantee that matters: that the file writing blocks.json and
 * the thirty-five files reading it agree about its shape.
 *
 * `TreeNode` must stay in sync with docs/project/granularity-zoom.md#node-shape.
 *
 * The one import, and it is a type: `FailureKind` belongs to src/messages.ts,
 * where the four kinds are defined and where `canRetry` decides what each one
 * means. Writing the union out a second time here would let the two drift, and
 * the drift would show up as a Retry button under a failure that cannot succeed.
 */
import type { FailureKind } from "./messages.js";

export type NodeId = string; // "n0042"
export type BlockId = string; // "spya-k3m9qt" — see docs/project/block-ids.md
export type BlockKind =
  | "heading" | "text" | "quote" | "code" | "media" | "caption" | "other";

/**
 * One block of the article. **Array order in blocks.json IS document order** —
 * ids are random and tell you nothing about position (block-ids.md#why-random-and-not-sequential).
 */
export interface Block {
  id: BlockId;
  tag: string;
  kind: BlockKind;
  /** Heading depth 1–6, on headings only. Real headings only. */
  level?: number;
  text: string;
  words: number;
  html: string;
  /**
   * False for anything the ToC must not write a row about: images, rules, and
   * pull-quotes that repeat body text verbatim. These still get ids — the ToC
   * may want to *point* at a diagram — they just carry no gist.
   */
  gistable: boolean;
  /** Why gistable is false, for debugging the splitter. */
  note?: string;
}

/** A node of the granularity tree / deeply-nested ToC. Stage 4+5 output. */
export interface TreeNode {
  id: NodeId;
  depth: number; // 0 = whole article
  parent: NodeId | null;
  children: NodeId[]; // [] for leaves
  /** Inclusive, contiguous. Resolved via the blocks.json index, never by string comparison. */
  range: [BlockId, BlockId];
  title: string; // 2–6 words
  /**
   * ONE sentence, shown in the reading view IN PLACE OF the text it compresses.
   * Absent on leaves by design — a summary must never be shown where the real
   * paragraph could be. Never fall back to navLabel when this is missing.
   */
  gist?: string;
  /** Leaves only. Navigation chrome for the ToC and spine; never reading content. */
  navLabel?: string;
  summary?: string;
  sourceHeading?: string;
}

export interface Tree {
  version: string;
  generator: string;
  slug: string;
  rootId: NodeId;
  nodes: Record<NodeId, TreeNode>;
}

/**
 * One article-level sentence per part: where the argument stands there.
 *
 * Stage 5b, in its own `arc.json` rather than as a field on the tree — see
 * src/arc.ts for why, and docs/project/granularity-zoom.md#the-arc for what an
 * arc sentence is and how it differs from a gist.
 */
export interface ArcEntry {
  /** The part this belongs to, as its block range. Matched by range, never by node id. */
  range: [BlockId, BlockId];
  text: string;
}

export interface Arc {
  version: string;
  generator: string;
  slug: string;
  entries: ArcEntry[];
}

/**
 * One post of the thread — see docs/plans/tweet-thread-page.md.
 *
 * **No post number.** Position is the array's job and the array already does
 * it; a stored `number` is a second copy of the same fact that can only ever
 * disagree with the first, which is how a page ends up rendering "3/12" twice.
 * Render it as `index + 1`.
 *
 * `chars` is counted by us, and **nothing is truncated to make it fit**: a post
 * over the limit is stored exactly as written and shown as over.
 */
export interface Tweet {
  text: string;
  /** Code points, counted by us. See `countChars` in src/tweets.ts. */
  chars: number;
}

/**
 * The article as a numbered thread. Stage 5c, `data/<slug>/tweets.json`.
 *
 * Generated on demand rather than as part of every ingest — `tweets` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts).
 */
export interface TweetThread {
  version: string;
  generator: string;
  slug: string;
  /**
   * Fingerprint of the blocks this was written from, so the page can say the
   * thread describes an older version of the article. The thing their version
   * could not answer — src/tweets.ts `hashBlocks`.
   */
  sourceHash: string;
  /**
   * Fingerprint of the **reader's profile** this was written from, or `null`
   * for "written deliberately without one".
   *
   * Three states, and only one of them means stale:
   *
   * | value | means | stale? |
   * |---|---|---|
   * | absent | written before the profile existed | no |
   * | `null` | written deliberately without one | **no** |
   * | a hash | written from that profile | only if it differs from now |
   *
   * A hash rather than a `usedProfile: true`, because a boolean cannot tell
   * "written for the profile you have now" from "written for the profile you
   * had last week" — and from every surface in this app those two look
   * identical. `hashProfile` in src/profile.ts; `profileIsStale` is the
   * comparison, in one place, so the three states cannot be re-derived
   * differently by three panels.
   */
  profileHash?: string | null;
  /** The per-post character limit `chars` was counted against. One number, one place. */
  limit: number;
  tweets: Tweet[];
  generatedAt: string;
  /** Timed from outside the SDK, whose own timestamps came back empty. */
  elapsedMs: number;
}

/**
 * What `GET /api/tweets/:slug` returns.
 *
 * `stale` is the whole reason this is not just the artefact: the page has to be
 * able to say that the thread describes an older version of the article, which
 * is the thing the original version of this feature could never answer. It is
 * computed at read time from the blocks on disk (`isStale` in src/tweets.ts),
 * not stored — a stored flag would go out of date exactly when it mattered.
 */
export interface ThreadResponse {
  thread: TweetThread;
  stale: boolean;
  /**
   * The reader's profile has changed since this was written — a third fact,
   * with a third sentence, for the same reason `outdated` needed one beside
   * `stale`. `stale` means *the article moved*; `outdated` means *we would
   * write this differently now*; this means *you are not who you were when we
   * wrote it*.
   *
   * False when the artefact was written deliberately without a profile, and
   * false when the reader has since cleared theirs. `profileIsStale` in
   * src/profile.ts is the one place those two rules live.
   */
  profileChanged: boolean;
}

/* --------------------------------------------------------------- glossary --
   Stage 5d: the terms this piece uses in a non-obvious way, defined from the
   piece itself. `data/<slug>/glossary.json`, and a **mode** in the band between
   the spine and the prose rather than a page of its own.

   Two of these fields exist because of bugs in the version this was borrowed
   from — `aliases` and `blocks`. See docs/project/glossary.md, and
   docs/project/original-version/glossary.md for what went wrong over there. */

/**
 * What sort of thing an entry is.
 *
 * Shorter than theirs, which had eleven values including both `concept` and
 * `definition` — a distinction nobody could apply consistently, and the model
 * did not. `date` went too: a date is not a term a glossary explains, and
 * anything worth an entry is the *event* on that date.
 *
 * Anything the model returns that is not in this list becomes `other` rather
 * than failing the parse. A glossary of thirty good entries must not be thrown
 * away because one of them came back as `"technology"`.
 */
export type GlossaryKind =
  | "person"
  | "place"
  | "organization"
  | "event"
  | "work"
  | "concept"
  | "term"
  | "other";

/**
 * One term, and what this piece means by it.
 *
 * **`aliases` is the field that makes the feature work at all**, and it is the
 * one their prompt got exactly right: *"Try to make the aliases distinctive, so
 * that a regex using the aliases finds all and only references to the entity
 * (if possible)."* That is a concrete, testable target for something prompts
 * usually hand-wave, and `blocks` below is what tests it.
 *
 * **`blocks` is computed by us, never by the model.** It is every block whose
 * text uses the name or one of the aliases, in document order, found by
 * `findOccurrences` in src/glossary.ts. Asking the model for block ids would
 * invite it to invent them; matching the text cannot. Three things fall out of
 * that one choice: the panel can jump the article to a term, the prose can
 * underline it while it is selected, and an entry whose `blocks` is **empty** is
 * visible as what it is — a term the model named that this article does not
 * actually use in those words.
 */
export interface GlossaryEntry {
  /** Minted by `mintId`, so it is a block id by construction and `?term=` validates for free. */
  id: string;
  /**
   * The canonical form, in their prompt's words *"the canonical and unambiguous
   * way to refer to it (usually the longest or official form, e.g. \"United
   * States of America\" rather than \"America\")"*.
   *
   * Which is also what the dedup rule preserves: where two entries collide, the
   * **richer** name survives and the poorer one becomes an alias of it. Theirs
   * kept whichever appeared first in the document, which systematically deleted
   * the more specific phrase — see src/glossary.ts § `dedupe`.
   */
  name: string;
  kind: GlossaryKind;
  /** Other forms the piece uses. Never includes `name`; lower-cased and de-duplicated. */
  aliases: string[];
  /**
   * What **this author** means by the term, where the sentences around it do
   * not give it to you: the narrowed sense, the coinage, the ordinary word
   * bent. From the article and only the article.
   *
   * **Absent is a real answer**, and the most important one this field has. A
   * person simply quoted, a work simply named — the article's use of those is
   * plain once you know what the thing is, and an entry that restates it is a
   * description of a page the reader is looking at. That was the Lamport bug:
   * see docs/plans/glossary-entries-worth-reading.md.
   *
   * Plain text, never Markdown.
   */
  senseHere?: string;
  /**
   * What the reader has to bring **to** the piece — who this person is, what
   * this work or event is, what the term ordinarily means outside this
   * article. The model's own knowledge, and labelled as such in the panel.
   *
   * Two or three facts that make *this* article's use of it land, not a
   * biography. Absent when the model does not know: an entry with only a
   * `senseHere` is visibly missing its background, where a plausible invented
   * one is not.
   */
  background?: string;
  /**
   * **Superseded on 2026-08-26, and still read.** The single blended prose
   * field `senseHere` and `background` replaced, kept because artefacts
   * written before that date have it and the panel renders them unchanged
   * until somebody regenerates. Never written by a `glossary/2` pass.
   */
  gloss?: string;
  /** Superseded with `gloss`, and read for the same reason. */
  detail?: string;
  /** Validated as a real URL at build time, and dropped rather than trusted if it isn't one. */
  url?: string;
  /**
   * 0–1, the model's own judgment, and **never the order the list is in**.
   *
   * Greg's call, 2026-08-25: keep both numbers, list in document order, and let
   * the reader choose to sort. The middle option of three — our own review of
   * the original recommended dropping them outright, on the grounds that
   * ranking terms by importance is the model doing the reader's prioritising
   * (vision.md § Principles). Keeping them but never sorting by them silently
   * is the answer to that: the ranking is available and it is asked for.
   */
  difficulty?: number;
  centrality?: number;
  /**
   * **Superseded on 2026-08-26, and still read** — same as `gloss` above.
   *
   * It was a boolean over a blob: true when *any part* of the entry drew on
   * knowledge outside the article. The failure that retired it is that a flag
   * over prose has no dose and no location — it fired on the Lamport entry,
   * whose two sentences contained nothing from outside at all, and when it
   * fires correctly it still cannot say *which two words*.
   *
   * What replaced it is not a better flag. It is the field split: `senseHere`
   * is from the article, `background` is not, and the labels on those two
   * sections answer "which bits" exactly. Provenance the model **writes into**
   * rather than **reports about** — see
   * docs/plans/glossary-entries-worth-reading.md § Provenance is structural.
   */
  fromOutside?: boolean;
  /**
   * What came back when the reader asked us to check this term on the web.
   *
   * **Absent until somebody presses the button**, and that is the design rather
   * than a limitation. The batch call that writes an entry does not search: it
   * is one call over a whole article, already capped and paginated because
   * output tokens caused 504s in the previous version, and a dozen serialised
   * searches inside it would spend money on entries nobody opens. So the web is
   * per entry, reader-initiated, and its result lands here beside the
   * remembered `background` rather than replacing it — *checked* has to stay
   * visibly different from *remembered*.
   *
   * See docs/plans/glossary-entries-worth-reading.md § The web.
   */
  lookup?: GlossaryLookup;
  /** Every block that uses this term, in document order. Found by us. Empty is meaningful. */
  blocks: BlockId[];
}

/**
 * One answer from the web, and where it came from.
 *
 * The same four fields a `Comment` stores, because it is the same call — see
 * `explain` in src/explain.ts. That is not a coincidence being exploited: our
 * review of the version this was borrowed from argued a glossary should be *the
 * same mechanism as comments with a different prompt* rather than a second
 * system, and docs/project/glossary.md § What is still open has been carrying
 * that as an open question since the feature landed. This is the first half of
 * it paid off.
 */
export interface GlossaryLookup {
  answer: string;
  /** What the model actually cited. Every URL passed `safeUrl` before it was stored. */
  citations: Citation[];
  /**
   * How many web searches the model chose to run — **`0` is a real answer**,
   * not a missing one. The model decides per call, so an answer with no
   * searches means it judged it already knew, and the panel says so rather than
   * leaving the reader to guess which kind of answer they are looking at.
   */
  searches: number;
  model: string;
  /** ISO 8601. An answer is about the web on the day it was asked. */
  at: string;
}

/**
 * The article's glossary. Stage 5d, `data/<slug>/glossary.json`.
 *
 * Generated on demand rather than as part of every ingest — `glossary` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts).
 */
export interface Glossary {
  version: string;
  generator: string;
  slug: string;
  /** Fingerprint of the blocks it was written from — `hashBlocks`, src/source-hash.ts. */
  sourceHash: string;
  /**
   * Fingerprint of the **reader's profile** this was written from, or `null`
   * for "written deliberately without one".
   *
   * Three states, and only one of them means stale:
   *
   * | value | means | stale? |
   * |---|---|---|
   * | absent | written before the profile existed | no |
   * | `null` | written deliberately without one | **no** |
   * | a hash | written from that profile | only if it differs from now |
   *
   * A hash rather than a `usedProfile: true`, because a boolean cannot tell
   * "written for the profile you have now" from "written for the profile you
   * had last week" — and from every surface in this app those two look
   * identical. `hashProfile` in src/profile.ts; `profileIsStale` is the
   * comparison, in one place, so the three states cannot be re-derived
   * differently by three panels.
   */
  profileHash?: string | null;
  /**
   * In document order: first use in the article first.
   *
   * The reader's own order through the piece, which is a real order rather than
   * a judgment. Sorting by difficulty or centrality is a thing the panel offers
   * and the reader chooses; it is not what is stored.
   */
  entries: GlossaryEntry[];
  /**
   * How many model calls have contributed to this list.
   *
   * **The whole reason this feature paginates.** Extraction in the original
   * version hit 504s in production, and the cause was not the article going in
   * — it was the number of **output** tokens coming back, because every entry
   * carries two explanations. Their fix was a cap per call plus a "Load More"
   * that feeds the existing entries back so the model does not repeat itself.
   * Ours is the same shape: "Find more terms" runs another pass and appends.
   * See docs/project/original-version/glossary.md § Bug one.
   */
  passes: number;
  generatedAt: string;
  /** Total across every pass. Timed from outside the SDK, whose own timings came back empty. */
  elapsedMs: number;
}

/**
 * What `GET /api/glossary/:slug` returns.
 *
 * `stale` for the same reason `ThreadResponse` carries one, and computed the
 * same way at read time: a flag stored at generation time is right until the
 * moment it matters.
 */
export interface GlossaryResponse {
  glossary: Glossary;
  stale: boolean;
  /**
   * The list was written by an older version of the prompt — a different fact
   * from `stale`, and it needed its own field because it needs its own
   * sentence. `stale` means *the article moved underneath these terms*;
   * `outdated` means *the article is the same and we would write these
   * differently now*.
   *
   * **It is here because it was briefly nowhere.** `isStale` compares source
   * hashes and nothing else, so bumping `PROMPT_VERSION` for `glossary/2` did
   * not make one single glossary read as stale — the panel went on showing an
   * old list with no banner and no offer to rewrite it, while the plan that
   * bumped the version claimed the opposite. Found in review; see
   * docs/plans/glossary-entries-worth-reading.md § What review caught.
   */
  outdated: boolean;
  /**
   * The reader's profile has changed since this was written — a third fact,
   * with a third sentence, for the same reason `outdated` needed one beside
   * `stale`. `stale` means *the article moved*; `outdated` means *we would
   * write this differently now*; this means *you are not who you were when we
   * wrote it*.
   *
   * False when the artefact was written deliberately without a profile, and
   * false when the reader has since cleared theirs. `profileIsStale` in
   * src/profile.ts is the one place those two rules live.
   */
  profileChanged: boolean;
}

/* -------------------------------------------------------------- summaries --
   The article, and each of its parts and sections, at more than one length —
   `data/<slug>/summary.json`, and a **mode** in the band between the spine and
   the prose. Stage 5e. See docs/project/summaries.md.

   The shape is the original version's, taken deliberately: a **named length
   ladder** rather than a token count, generated for every rung in one call
   rather than one call per rung. What is not theirs is where the ladder is
   wired. They generated nine granularities of the whole document and showed one
   hardcoded rung in one tooltip; here every level of the tree carries the
   ladder, which is the gap their own docs record
   (docs/project/original-version/summaries.md). */

/* ------------------------------------------------------ the rungs, and why --
   The ladder above the gist is `short` and `long`, and they are two fields on
   `SummaryEntry` below rather than one field holding a rung name — which is why
   there is no `SummaryRung` type here. There was one until 2026-08-26; it was
   declared, never referenced, and survived because an unused *exported* type
   looks exactly like one some other module uses. Its reasoning is worth more
   than the declaration was, so it stays here:

   `gist` is deliberately not a rung: it is one sentence, it lives on the tree
   node (stage 4), and nothing about it is this stage's to write. The panel
   offers it as the shortest rung by reading the tree, so the ladder the reader
   sees has three steps while only two are generated.

   **Named, not numbered, and the steps are not even.** One sentence, then a few
   sentences, then a paragraph or more. That unevenness is a finding rather than
   a shrug — theirs ran 10, 15, 25, 30, 50, 100, 200, 400, 800 tokens, fine at
   the bottom and geometric at the top, because the difference between a phrase
   and a sentence changes what a line can *do* while the difference between two
   long summaries is just more of the same. */

/**
 * One node's summaries, anchored the way the arc is: **by block range, never by
 * node id.**
 *
 * Node ids are positional, so a re-run of `npm run toc` renumbers them and
 * every summary would silently move one node sideways — a plausible paragraph
 * against the wrong section, which is a lie the reader has no way to detect.
 * A range that no longer matches a node is dropped instead. Same rule, and the
 * same reasoning, as `ArcEntry` above.
 */
export interface SummaryEntry {
  /** Inclusive, contiguous — resolved through the blocks index, never by string compare. */
  range: [BlockId, BlockId];
  /** The depth of the node this was written for. Kept for the panel's indentation. */
  depth: number;
  /** A few sentences. Absent when the batch that should have carried it came back malformed. */
  short?: string;
  /** A paragraph for a section, more for a part, about a page for the whole piece. */
  long?: string;
}

/**
 * The article's summaries. Stage 5e, `data/<slug>/summary.json`.
 *
 * Generated on demand rather than as part of every ingest — `summary` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts), for the
 * same reason `tweets` and `glossary` are not.
 */
export interface Summaries {
  version: string;
  generator: string;
  slug: string;
  /** Fingerprint of the blocks it was written from — `hashBlocks`, src/source-hash.ts. */
  sourceHash: string;
  /**
   * Fingerprint of the **reader's profile** this was written from, or `null`
   * for "written deliberately without one".
   *
   * Three states, and only one of them means stale:
   *
   * | value | means | stale? |
   * |---|---|---|
   * | absent | written before the profile existed | no |
   * | `null` | written deliberately without one | **no** |
   * | a hash | written from that profile | only if it differs from now |
   *
   * A hash rather than a `usedProfile: true`, because a boolean cannot tell
   * "written for the profile you have now" from "written for the profile you
   * had last week" — and from every surface in this app those two look
   * identical. `hashProfile` in src/profile.ts; `profileIsStale` is the
   * comparison, in one place, so the three states cannot be re-derived
   * differently by three panels.
   */
  profileHash?: string | null;
  /** Document order, coarse before fine — the order the panel renders them in. */
  entries: SummaryEntry[];
  /**
   * What the reader asked these summaries to lean towards, if they asked
   * anything.
   *
   * Kept on the artefact rather than only in the request, so that a summary
   * written to a steer **says so**. A steered summary that looks like an
   * ordinary one is a summary the reader cannot weigh, and the whole risk of
   * the feature is that a request quietly bends what the article is reported
   * to say (src/summarise.ts § IF THE READER ASKS FOR SOMETHING IN PARTICULAR).
   * It is also what the panel puts back in the box next time.
   */
  guidance?: string;
  /**
   * Nodes whose batch came back unusable and were written without text.
   *
   * **Counted rather than hidden, because their version discarded eight good
   * summaries when the ninth was malformed.** Salvaging partials is the fix;
   * the number is what stops a half-empty artefact reading as a complete one.
   */
  missing: number;
  generatedAt: string;
  /** Timed from outside the SDK, whose own timing fields came back empty over there. */
  elapsedMs: number;
}

/**
 * What `GET /api/summary/:slug` returns.
 *
 * `stale` for the same reason `GlossaryResponse` carries one, and computed the
 * same way at read time: a flag stored at generation time is right until the
 * moment it matters.
 */
export interface SummariesResponse {
  summaries: Summaries;
  stale: boolean;
  /**
   * The reader's profile has changed since these were written — see the same
   * field on `GlossaryResponse` for what it does and does not mean.
   */
  profileChanged: boolean;
}


/**
 * What a **store** can say about an artefact: everything in the response except
 * the one question that is not about the article.
 *
 * `profileChanged` needs the reader's current profile, and a store adapter
 * reaching for that would be an import cycle (src/store/index.ts imports the
 * filesystem reader). So the adapters answer everything else and the route adds
 * the last field — `withProfileChanged` in src/routes.ts. Written as a type
 * rather than left implicit so that a new adapter cannot accidentally return a
 * `profileChanged: false` it did not compute.
 */
export type ThreadFound = Omit<ThreadResponse, "profileChanged">;
/** As `ThreadFound`, for the glossary. */
export type GlossaryFound = Omit<GlossaryResponse, "profileChanged">;
/** As `ThreadFound`, for the summaries. */
export type SummariesFound = Omit<SummariesResponse, "profileChanged">;
/** As `ThreadFound`, for the ideas. */
export type IdeasFound = Omit<IdeasResponse, "profileChanged">;


/* ------------------------------------------------------------------ ideas --
   The propositions a reader has to hold to get the piece — `data/<slug>/
   ideas.json`, and a **mode** in the band beside the glossary. Stage 5f.
   See docs/plans/ideas-mode.md.

   The glossary answers *what does this word mean*, on both sides of the
   introduced/assumed line. This answers the other unit: a claim you hold, which
   has no name to match and therefore cannot be found the way a term is. */

/**
 * Where the idea comes from, and it is the **model's classification** rather
 * than a fact about the idea.
 *
 * A piece can assume a broad framework and introduce its own refinement of it,
 * and that idea belongs in both groups. The panel draws this the way it draws
 * everything else the model asserts — as a claim, not as a property. See
 * docs/plans/ideas-mode.md § What it looks like.
 */
export type IdeaProvenance = "assumed" | "introduced";

/**
 * One place in the article that bears on an idea.
 *
 * **This is `SearchHit` minus `confidence`**, and the missing field is the
 * design rather than an omission: a search hit's confidence answers *is this
 * what you asked for*, and here nobody asked a question. `resolveIdea` in
 * src/web/search-hits.ts therefore builds a `Found` with `confidence: null`,
 * which is the value a literal word-match already carries — a passage with a
 * place and no opinion attached.
 *
 * **What it points at depends on the provenance**, and the difference is the
 * one design decision this whole feature turns on:
 *
 * | provenance | the occurrence is |
 * |---|---|
 * | `introduced` | where the piece states or develops the idea |
 * | `assumed` | where the piece would stop making sense without it |
 *
 * An assumed idea is by definition not in the article, so there is nothing to
 * quote — and a model asked for a quote anyway will either return nothing or
 * invent one. Asking instead for the passage that *presupposes* it gives a real
 * location the reader can go and test.
 */
export interface IdeaOccurrence {
  blockId: BlockId;
  /**
   * The exact words, copied from that block.
   *
   * Verified at generation time against `blocks.json` and dropped if it is not
   * there, exactly as `validateHits` does in src/search.ts. The anchor is the
   * block id; this only finds the words inside it.
   */
  quote: string;
  /**
   * One line on what this passage does with the idea.
   *
   * **A harder question than search's "why does this match"**, and for an
   * `assumed` occurrence it is the whole guard against the model returning
   * universal truths: it has to name the local inferential move — what the
   * passage says, what connection fails without the idea, and why *this* idea
   * rather than general background knowledge supplies it.
   */
  reasoning: string;
  /** Where `quote` sat in `block.text` — a disambiguator, never the anchor. */
  start?: number;
}

/**
 * One idea, and where the article needs it.
 *
 * The unit test that separates this from a `GlossaryEntry`: **can you say it as
 * a proposition?** A term is a noun phrase and the answer to it is a
 * definition; an idea has a claim shape and the answer is a sentence you could
 * carry to a different article and use.
 */
export interface Idea {
  /** `mintId`, so it is a block id by construction and `?idea=` validates for free. */
  id: string;
  /** The idea as a handle — a short proposition, not a topic. Three to ten words. */
  name: string;
  provenance: IdeaProvenance;
  /**
   * The idea itself, stated so a reader could carry it out of this article.
   *
   * The field where the describes-the-page register is most tempting, because
   * it is the line the panel shows first — the same position `senseHere` holds
   * in a glossary entry, and it failed there first. Plain text, never Markdown.
   */
  statement: string;
  /**
   * What stops making sense without it.
   *
   * Load-bearing for an `assumed` idea and optional for an `introduced` one.
   * **The second place the banned register relocates to** — a ban in
   * `statement` alone pushes it here, which is the glossary's hardest-won
   * lesson (docs/project/glossary.md § A prompt ban relocates a register).
   */
  whyYouNeedIt?: string;
  /**
   * A concrete everyday thing this idea works like — **the model's own frame,
   * not the author's**, and labelled as such in the panel the way `background`
   * is in a glossary entry.
   *
   * Absent is a real answer and the prompt says so out loud: a strained analogy
   * is worse than none, and a field invites filling.
   */
  analogy?: string;
  /**
   * Where the article needs it. **Never empty** — an idea whose every
   * occurrence failed validation is dropped rather than stored.
   *
   * That is the opposite of the glossary's rule, and deliberately: an unmatched
   * glossary entry is still a definition you can read, where an idea with no
   * occurrence is a claim with no evidence and no way back to the page, which
   * vision.md § Principles 4 refuses.
   */
  occurrences: IdeaOccurrence[];
}

/**
 * The artefact. `data/<slug>/ideas.json`, stage 5f.
 *
 * **No `passes` and no append**, unlike `Glossary`. A glossary paginates
 * because an article can hold an encyclopaedia of terms and their output length
 * caused a production outage; a piece has three to ten ideas. Running the step
 * again replaces rather than appends, which removes the FORBIDDEN checklist,
 * `existingFor` and the "a stale glossary is not appended to" rule all at once.
 */
export interface Ideas {
  version: string;
  generator: string;
  slug: string;
  /**
   * Fingerprint of what this was written from — **blocks *and* tree**, unlike
   * every artefact before it.
   *
   * `StepStamp` in src/store/artifacts.ts predicted this: *"`arc`, `tweets`,
   * `glossary` and `summary` all read the tree as well as the blocks, and
   * src/labels.ts already keeps a separate `structureHash` precisely because
   * section boundaries can move without a single block changing."* Ideas reads
   * the skeleton to judge what is load-bearing, so a re-sectioned article is a
   * different question even when every block is byte-identical.
   */
  sourceHash: string;
  /** As `Glossary.profileHash`, and **in the freshness stamp** — see src/pipeline.ts. */
  profileHash?: string | null;
  /**
   * Assumed first, then introduced; within each group, first occurrence.
   *
   * Stored in that order rather than sorted at read time, and the order is
   * fixed at write time because `assignSlots` colours by walking it — a list
   * that reordered itself would recolour every idea on the rail.
   */
  ideas: Idea[];
  generatedAt: string;
  elapsedMs: number;
}

/**
 * `GET /api/ideas/:slug`. The same three staleness facts the glossary carries,
 * for the same three reasons, computed at read time.
 */
export interface IdeasResponse {
  ideas: Ideas;
  /** The article moved underneath these ideas. */
  stale: boolean;
  /** The article is the same and we would write these differently now. */
  outdated: boolean;
  /** You are not who you were when we wrote it. */
  profileChanged: boolean;
}


/* ------------------------------------------------------- reader profile --
   docs/project/reader-profile.md. */

/**
 * The longest "about you" we will store.
 *
 * **Two values in a file of types, and here is the exception's reason.** Both
 * pages that own a profile box show a live character counter, and the counter
 * must say the same number the server refuses at — a second copy in the client
 * would disagree the first time one of them changed, and the symptom would be a
 * reader typing confidently up to a limit that is not the limit.
 *
 * src/profile.ts imports these rather than declaring them, so there is still
 * one source. They are here and not there because src/profile.ts reaches for
 * `node:crypto` and `node:fs`, and nothing under src/web/ may import a module
 * that does — tests/client-imports.test.ts is that rule, and adding a
 * filesystem module to its allowlist to get two integers would be exactly the
 * fix that test tells you not to make.
 *
 * Larger than the per-article cap because this one is written once and read
 * forever: it rides in every profiled prompt for the life of the shelf.
 */
export const MAX_PROFILE_CHARS = 1_500;

/**
 * The longest "why you're reading this one".
 *
 * Matches `MAX_GUIDANCE_CHARS` on the summary steer deliberately: the two boxes
 * sit next to each other in the reader's head, and one refusing at 600 while
 * the other refused at 900 would be a rule about nothing.
 */
export const MAX_PURPOSE_CHARS = 600;

export interface Meta {
  slug: string;
  title: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  url?: string;
  /** When stage 2 fetched the page, ISO. The library sorts on it. */
  fetchedAt?: string;
  /** Readability's own one-or-two-sentence excerpt. A last-resort card blurb. */
  excerpt?: string;
  note?: string;

  /* ---- PDFs only. Absent on everything Readability extracted. ---- */

  /** What this article was made from. Absent means a web page. */
  source?: "pdf";
  /** The reader and the prompt version that transcribed it, e.g. `openai/gpt-5.6-luna/pdf-v1`. */
  method?: string;
  /** Pages in the source PDF. */
  pages?: number;
  /** SHA-256 of the PDF as fetched, so "is this the same document?" has an answer. */
  rawSha256?: string;
  /**
   * **A scan, with no text layer to check the transcription against.**
   *
   * The reader is told so on the page, in a sentence rather than a badge, and
   * this is the field that decides it. It is deliberately not called `verified`
   * with a false value: two machines agreeing would still not be verification,
   * and "verified" is exactly the word a reader would rely on.
   * docs/plans/pdf-ingestion.md § A scan with no text layer.
   */
  unverified?: boolean;
  /**
   * Mean per-page recall against the PDF's own text layer. Absent for a scan.
   *
   * Read it with `pagesChecked`, always. A mean over one page of seventeen is
   * arithmetically fine and means nothing, and the number on its own cannot
   * tell you which it is.
   */
  recall?: number;
  /** How many pages the recall above is a mean of. `0` on a scan, where nothing could be checked. */
  pagesChecked?: number;
}

/** What GET /api/article/:slug returns — everything needed for every zoom level. */
/**
 * One pair of passages an embedding model thinks are about the same thing.
 *
 * The wire shape of `POST /api/similar/:slug`. Here rather than in
 * src/similar.ts because the browser reads it too, and a client importing a
 * module that pulls in pino and reads `process.env` is a bundle waiting to
 * break — every other response shape in this app lives here for the same reason.
 */
export interface SimilarPair {
  a: BlockId;
  b: BlockId;
  /** Cosine, 0–1. */
  score: number;
}

export interface SimilarResponse {
  model: string;
  /** How many blocks were embedded — not how many the article has. */
  blocks: number;
  /** How many were long enough to be worth embedding, before any ceiling. */
  eligible: number;
  /**
   * How many eligible blocks the ceiling left out. Zero for every article in
   * this corpus, and reported anyway: a bounded sweep that says nothing about
   * its bound reads as complete coverage.
   */
  omitted: number;
  pairs: SimilarPair[];
}

/**
 * Where one passage sits on the plane the embeddings describe.
 *
 * The wire shape of `POST /api/projection/:slug` (src/projection.ts), drawn by
 * the Drift and Trail pictures — docs/plans/embedding-scatter-diagrams.md.
 *
 * **There is no row number here on purpose.** The block id is the identity of a
 * passage everywhere else in this app (docs/project/block-ids.md), and a row
 * index sent beside it would be a second answer to the same question that can
 * disagree with the first after a re-ingest. The client looks the row up in the
 * blocks it already holds, and a point whose id it does not recognise is
 * dropped rather than drawn somewhere plausible.
 */
export interface ProjectionPoint {
  id: BlockId;
  /** The first principal component. Cosine-scale, both signs, not normalised. */
  x: number;
  /** The second. Orthogonal to the first, and always the smaller of the two. */
  y: number;
  /**
   * Which topic k-means put it in, 0-based, ordered by where the topic starts.
   *
   * **There was a `typicality` beside this and it has gone.** It was how close
   * the passage sat to its own topic's centre, and the Drift picture used it to
   * lean a dot out of its lane — described, in a first draft, as leaning
   * *towards the topic it was nearer to*. That is false: lanes are ordered by
   * where the article gets to them, so the lane next door is the
   * chronologically adjacent one and not the semantically nearest. GPT Sol's
   * finding, 2026-08-27. A dot's place inside its lane is its first component
   * now, which is one quantity meaning one thing — and a field nothing can
   * honestly draw is a field that should not cross the wire.
   */
  c: number;
}

/**
 * Why a block did not get a vector, counted by reason.
 *
 * **Split rather than totalled**, because the three mean completely different
 * things to whoever reads the picture: "too short to embed" is a property of
 * the article, and "we stopped after 1,500" is a property of our wallet. One
 * number rendered as "too short" would say the second in the words of the
 * first. GPT Sol's finding, 2026-08-27.
 */
export interface SkipCounts {
  /** Images, rules, repeated pull-quotes — things the ToC writes no gist about. */
  nonProse: number;
  /** Under the minimum length. On a real article this is most of them. */
  tooShort: number;
  /** Past the per-article ceiling — the spending cap, not a fact about the text. */
  capped: number;
}

export interface ProjectionResponse {
  model: string;
  /** How many blocks were embedded. Short ones and non-prose are skipped. */
  blocks: number;
  /** How many were not, and why — the reason the dots do not tile the article. */
  skipped: SkipCounts;
  /**
   * The fraction of the article's variation each of the two axes holds, 0–1.
   *
   * **Shown to the reader, not kept for us.** Two components out of 1024 throw
   * away most of what the model saw, and a scatter plot that does not say so is
   * the [silent-success](../docs/reusable/silent-success.md) shape with a
   * picture on it.
   */
  variance: [number, number];
  /** How many topics were asked for. Capped by the width of the band, not the data. */
  k: number;
  points: ProjectionPoint[];
}

export interface Article {
  meta: Meta;
  blocks: Block[];
  tree: Tree;
  /** Absent until `npm run arc` has been run — the L0 column falls back to the root gist. */
  arc?: Arc;
}

/**
 * One article as the library lists it — see docs/project/library.md.
 *
 * Everything here is either metadata or *derived* from the artefacts, and the
 * derived half is the reason this type exists separately from `Meta`: the
 * homepage must not have to download 150KB of blocks.json per article to say
 * how long one is. `GET /api/library` returns these; `GET /api/article/:slug`
 * returns the real thing.
 *
 * Read the shape as a row of a future `articles` table. Every field is a scalar
 * a column could hold, which is the whole discipline — when this moves to
 * Postgres, the counts become columns written once at ingest instead of a
 * directory walk per request, and nothing above this line has to change.
 */
export interface LibraryEntry {
  slug: string;
  title: string;
  byline?: string;
  siteName?: string;
  url?: string;
  /** ISO. `meta.fetchedAt` where stage 2 recorded one, else the mtime of blocks.json. */
  addedAt: string;
  words: number;
  minutes: number;
  blocks: number;
  parts: number;
  sections: number;
  /** How many questions have been asked about it — reader state, not article state. */
  comments: number;
  /** The whole piece in one sentence: the tree root's gist. */
  gist?: string;
  /** The committed `example/` fixture rather than real pipeline output. */
  fixture?: boolean;

  /* ---- shelf state: what the reader has done to the card (src/shelf.ts) ---- */

  /** How many times the reading view has been opened. */
  opens: number;
  /** ISO, absent until it has been opened once. */
  lastOpenedAt?: string;
  /**
   * `title` above is the reader's own, not the extractor's.
   *
   * The flag rather than both strings, because the only thing anything needs to
   * know is whether "reset to the original" is worth offering — and shipping
   * the superseded title to every card would put a string on the wire that
   * nothing renders.
   */
  titleOverridden?: boolean;
  /** ISO. Only ever set on entries from the archived listing. */
  archivedAt?: string;
  /**
   * Which of the optional stages have produced something.
   *
   * Booleans rather than counts, and that is the honest limit of what both
   * stores can answer cheaply: the filesystem knows a file exists without
   * parsing it, and Postgres knows a column is not null without fetching it.
   * A count would mean reading the artefact for every card on every load.
   */
  has: { arc: boolean; tweets: boolean; glossary: boolean; summary: boolean };
}

/**
 * Which half of the shelf to list — `listArticles`.
 *
 * A parameter rather than a second function, so both halves are built by the
 * same walk and cannot disagree about what counts as an article. Absent means
 * the shelf proper.
 */
export interface ListOptions {
  /** True lists what has been archived, and only that. */
  archived?: boolean;
}

/**
 * What the reader has done to an article's place on the shelf.
 *
 * Reader state, in the same category as comments and chat rather than in the
 * same category as the article's text — so nothing the pipeline does may
 * overwrite it. See src/shelf.ts for why the renamed title in particular has to
 * live out here, and docs/plans/library-shelf-actions-and-search.md for the
 * decisions behind it.
 */
export interface ShelfState {
  /** ISO. Absent means it is on the shelf. */
  archivedAt?: string;
  /** The reader's own title, overriding whatever stage 2 extracted. */
  title?: string;
  opens: number;
  /** ISO. */
  lastOpenedAt?: string;
  /**
   * "Why you're reading this one" — this article only, in the reader's own
   * words. The per-article half of docs/plans/reader-profile.md; the global
   * half is `data/reader.json` / `reader_profiles`, addressed through a
   * `ReaderStore` rather than through here, because it is true of every
   * article rather than of this one.
   *
   * Lives on `ShelfState` for the same reason the renamed title does: it must
   * survive re-extraction, and the pipeline must not be able to undo it.
   */
  purpose?: string;
}

/**
 * One passage found by searching the whole library — `GET /api/library/search`.
 *
 * Deliberately *not* `SearchHit`, which is the in-article shape and carries a
 * model's confidence and reasoning. This one has neither: it comes from a text
 * index, so there is nothing to be uncertain about and nobody to explain
 * anything. What it has instead is a `slug`, because the whole point is that
 * the answer might be in an article you are not reading.
 *
 * `rank` is comparable **only within one response**. It is `ts_rank_cd` under
 * Postgres and a cruder count on the filesystem, and neither is a probability.
 * Nothing may render it as a percentage. See docs/project/search.md.
 */
export interface LibraryHit {
  slug: string;
  /** As the shelf shows it, so a renamed article is named the same in both places. */
  title: string;
  blockId: BlockId;
  /**
   * The matching block's prose, whole and plain.
   *
   * **Not a snippet, and that is the point.** Trimming a window around the match
   * has to happen somewhere, and if the server did it the two adapters would do
   * it differently — Postgres knows which *stems* matched, not which characters,
   * so it would either return the whole thing anyway or call `ts_headline` and
   * hand back a second flavour of highlighting for the client to reconcile with
   * its own. So the server returns the paragraph and the client cuts it, using
   * the same folding it already uses for in-article hits. One highlighter.
   *
   * A paragraph, so a few hundred characters. Nothing here is worth streaming.
   */
  text: string;
  rank: number;
}

/** What GET /api/library/search returns. */
export interface LibrarySearchResponse {
  /** Echoed back, so a late response can be dropped by a client that has moved on. */
  query: string;
  hits: LibraryHit[];
  /** How many articles those hits are spread across — the line above the list. */
  articles: number;
  /**
   * True when the index had more to say and we stopped asking.
   *
   * Said out loud rather than silently truncated: a capped list that does not
   * admit it is a list that reads as "that is everything", which is the
   * silent-success shape this repo keeps meeting.
   */
  capped: boolean;
}

/**
 * One pipeline stage, as the metadata page reports it.
 *
 * **Not shaped as a row of a future table, and deliberately unlike
 * `LibraryEntry` above.** That one is a row because its fields become columns
 * written once at ingest. Nothing here would ever be stored: "are these files
 * on disk right now" is a question you can only answer by looking, so it is
 * read at request time by definition, and a stored copy would be the second
 * truth this repo keeps warning about.
 *
 * See docs/plans/metadata-page.md. § What the plan got wrong is why this carries
 * **no staleness verdict**; § A third pass is why it now carries sizes and
 * timestamps after all, which is a smaller reversal than it sounds — a number
 * is not a verdict, and nothing anywhere compares two of these.
 */
export interface StageState {
  step: StepName;
  /** Present tense, from `STEPS` in src/pipeline.ts — "Fetching the page". */
  label: string;
  /** Every file this step writes, repo-relative. */
  outputs: string[];
  /**
   * True only when **all** of `outputs` are present — `stepIsDone`'s rule, and
   * borrowed from it rather than restated. Any-of would call `extract` finished
   * having written the HTML and not `meta.json`.
   */
  done: boolean;
  /**
   * When this stage last wrote something, ISO — the newest mtime among its
   * outputs on the filesystem, `finished_at` in Postgres. `null` when nothing it
   * writes is there, or when the store cannot say.
   *
   * **Both stores answer the same question**, and it took a review to keep them
   * that way: the Postgres side had a fallback to `started_at`, which would have
   * put a timestamp on a run that began and wrote nothing, while the filesystem
   * has no way to report such a thing at all. One field, one meaning, or the one
   * sentence the UI writes about it is false in one of the two stores.
   *
   * **A fact, not a verdict, and the difference is the whole reason this page
   * refused these numbers for two days and then took them.** A timestamp records when a file was written, never
   * what it was written *from*: a copy, a `touch` or a fresh checkout resets it,
   * and every file in the committed fixture carries the moment somebody cloned
   * the repo. So it is shown as "ran 3 days ago" with the exact stamp on hover,
   * and nothing anywhere compares two of these to decide anything. The
   * staleness question is still answered by `sourceHash` or not at all —
   * `articleMetadata` in src/api.ts § What this deliberately does not answer.
   *
   * Deliberately computed over the outputs that **exist**, whatever `done`
   * says, so a stage that wrote half of what it owes still says when it did it.
   */
  ranAt: string | null;
  /**
   * What those outputs weigh, in bytes, added up. `null` where there are no
   * files to weigh — every Postgres row, and a stage that has written nothing.
   *
   * Operational, and that is fine on this one page: it is the page you open
   * when an article looks wrong, and "raw.html is 4 bytes" is the shape of
   * answer it exists to give.
   */
  bytes: number | null;
}

/** What GET /api/metadata/:slug returns: which stages have run, and nothing the article payload already carries. */
export interface ArticleMetadata {
  slug: string;
  /** Where the artefacts actually are, repo-relative — `example` for the fixture. */
  dir: string;
  /** In pipeline order — `STEP_ORDER` in src/pipeline.ts. */
  stages: StageState[];
  /**
   * How many questions have been asked about this article.
   *
   * A count and not the comments themselves, and that distinction is the whole
   * point: the metadata page must NOT fetch the comments (docs/plans/metadata-page.md
   * § The shell — `useComments` fetches on mount, so sharing it would buy a
   * drawer nobody opened). But this endpoint is already walking this article's
   * directory, so one more read answers "7 questions asked" for free, and the
   * page gets the line its plan sketched without paying for the drawer.
   */
  comments: number;
  /**
   * The reader's "about you" and "why this one" boxes — docs/plans/reader-profile.md.
   *
   * `null` means the box is empty, not that the question was not asked; the
   * Metadata page needs both to fill its own textareas and to show the global
   * half as a read-only preview. This endpoint is already walking the
   * article's directory (or the article's row) for `comments` above, so both
   * are one more read rather than a new endpoint.
   */
  profile: string | null;
  purpose: string | null;
  /**
   * ISO, or `null` for an article that is on the shelf.
   *
   * Here because this page has a Delete button, and a Delete button that cannot
   * tell whether the article is *already* deleted is a button offering to do a
   * thing that has been done. Both stores read this article's shelf state
   * already, for `purpose` above — so this is a field off a record in hand
   * rather than a second read.
   *
   * `string | null` rather than `LibraryEntry`'s optional `archivedAt?`, and the
   * difference is deliberate: on a shelf entry the field's *absence* is how "on
   * the shelf" is said, and it is only ever set on entries from the archived
   * listing. Here there is one article and the question is always asked, so
   * `null` is an answer rather than a gap. Same shape as `purpose`.
   */
  archivedAt: string | null;
}

/** A source the model consulted, from OpenRouter's `annotations`. See src/explain.ts. */
export interface Citation {
  url: string;
  title?: string;
}

/**
 * One tool call, as the reader sees it and as it is stored on the message.
 *
 * **This is a stored type**, which is why it is this small. It goes into
 * `chat.json` on every answer that used a tool and it is read back on every
 * reload, so it holds what a reader needs six months later — *what was asked
 * for, and what came back* — and not the payload, which would put a fetched web
 * page in the reader's chat file for ever.
 *
 * `label` and `detail` are prose written *here* rather than in the client, and
 * that is deliberate: the client would otherwise need a switch on `name` that
 * has to be kept in step with this file, and the first tool added without
 * touching it would render as a blank row. See docs/project/chat-tools.md.
 */
export interface ToolRun {
  /** The function name the model asked for. */
  name: string;
  /**
   * What it did, in the reader's words: `read aeon.co`, `searched your library
   * for “predictive processing”`.
   *
   * **It may contain the reader's own query**, because that is the only thing
   * that makes the row worth reading. Which means it is prose, and prose is
   * never logged — see the header.
   */
  label: string;
  /** How it went: `4 passages in 2 articles`, `nothing found`. */
  detail?: string;
  /**
   * `running` is what the panel shows live. It is **never stored** — the route
   * writes the finished array — so a `running` row read back from disk would be
   * a bug, not a stale spinner.
   */
  status: "running" | "done" | "error";
  /** Milliseconds. Absent while running. */
  ms?: number;
}


/**
 * A reader's question about a stretch of prose, and the model's answer.
 *
 * Stored in `data/<slug>/comments.json` — reader state, so it lives beside the
 * article rather than in it. See docs/project/comments.md.
 *
 * The anchor is `blockId` plus the exact `quote`; `start` only picks between
 * repeats of the same words within the block. That ordering matters: an offset
 * alone would silently drift the moment the paragraph changed, which is the
 * failure random block ids exist to prevent (docs/project/block-ids.md).
 */
export interface Comment {
  id: string;
  blockId: BlockId;
  quote: string;
  /** Where `quote` sat in the block's rendered text when the comment was made. */
  start: number;
  createdAt: string;
  /** `pending` is written to disk *before* the model call, so a crash is visible rather than silent. */
  status: "pending" | "done" | "error";
  answer?: string;
  citations?: Citation[];
  /** How many web searches the model chose to run. 0 means it was sure. */
  searches?: number;
  model?: string;
  error?: string;
}

/* ----------------------------------------------------------- ingest jobs --
   The queue's wire types live here, not in src/jobs.ts, for the same reason
   `Block` does: src/jobs.ts imports p-queue and node:fs, and the React client
   needs these shapes. One `import type` away from a node module is one careless
   edit away from a broken browser bundle, so the shapes live where both sides
   can reach them and neither side drags anything along.

   See docs/project/ingest-queue.md. */

/**
 * One stage of the pipeline. Ordered by `STEP_ORDER` in src/pipeline.ts.
 *
 * `tweets`, `glossary` and `summary` are in that order but **not** in
 * `DEFAULT_INGEST_STEPS` — they are steps you can ask for by name, not ones a
 * plain "add this URL" runs. Each costs model calls over the whole article and
 * each belongs to a page or a mode you have to go to. See
 * docs/plans/tweet-thread-page.md#the-one-real-snag-stated-precisely,
 * docs/project/glossary.md and docs/project/summaries.md.
 */
export type StepName =
  | "fetch" | "extract" | "blocks" | "toc" | "arc" | "tweets" | "glossary" | "summary" | "ideas";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface JobStep {
  name: StepName;
  /** Present tense, naming the actual thing — "Fetching the page", never "Loading". */
  label: string;
  status: StepStatus;
  /** A short line about how it went, or how it is going. Not persisted while running. */
  detail?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Run even if the artefact is already there — this is what a refresh is. */
  force?: boolean;
}

/**
 * One run of some steps against one article.
 *
 * Read the shape as a row of a future `jobs` table, the same discipline
 * `LibraryEntry` follows above — every field a scalar or a small blob a column
 * could hold. See docs/project/ingest-queue.md#when-this-becomes-postgres.
 */
/**
 * A file the reader handed us, rather than an address we went and fetched.
 *
 * **The other half of `url`, and never both.** A job acquires its raw document
 * one way or the other, and which way it was is the one thing the acquisition
 * step branches on — see `fetch` in src/pipeline.ts, which is the step that
 * does both. Everything after that stage cannot tell the difference, because
 * both write the same `raw.json`.
 *
 * It carries an id and a name and nothing else on purpose. The *bytes* are in
 * the blob store under a key derived from the id (`stagingKey`, src/source.ts),
 * so the job never names a path; the filename is the reader's own string and is
 * display-only. Everything we come to believe about the document — its real
 * size, our hash of it — lives on the upload record (src/upload-records.ts) and
 * is written there by the step that verified it.
 */
export interface JobUpload {
  /** Our id for the attempt. A UUID we minted; never the client's. */
  id: string;
  /** What the reader called the file, cleaned. Shown, never used to build a key. */
  filename: string;
}

/**
 * A `auth.users(id)`, distinguishable by the type system from the other uuids
 * flying around.
 *
 * **Defined here rather than in src/owner.ts**, where it lived until
 * 2026-08-27, and the move is not tidying. `Job` gained an `ownerId`, this file
 * is shared with the browser, and `src/owner.ts` imports `node:async_hooks` —
 * so a shared module importing it drags a Node built-in towards the bundle.
 * `tests/client-imports.test.ts` refuses that, deliberately and by path rather
 * than by whether the import is erasable, because a shared module reaching into
 * `src/` can drag anything with it. `owner.ts` re-exports this name, so nothing
 * that imports it from there had to change.
 *
 * `ArticleId`, `RevisionId` and `OwnerId` are all `uuid` in the database and
 * all `string` in TypeScript, so nothing but a brand stops one being passed
 * where another is wanted — and the compiler is the only thing that would ever
 * notice, because a wrong-but-well-formed uuid produces "no rows" rather than
 * an error. That reads as "not found" and sends you looking in the wrong place.
 */
export type OwnerId = string & { readonly __brand: "OwnerId" };

export interface Job {
  id: string;
  /**
   * **Who queued it.** An `auth.users(id)`, the same value every owned row
   * carries — src/owner.ts.
   *
   * Added 2026-08-27, and late: jobs had no owner at all, so `GET /api/jobs`
   * handed any signed-in stranger every reader's slugs, source URLs, uploaded
   * filenames, guidance text and errors — and every one of cancel, retry,
   * advance and delete took an id and did not ask whose it was. Disclosure,
   * denial of service, and somebody else's model spend, from one list. GPT Sol,
   * 2026-08-27.
   *
   * Required rather than optional, so that a job in memory always has one. The
   * records written before this field existed are stamped as they are read off
   * disk (src/jobs.ts § `loadFromDisk`) — and that is not a guess: at the time
   * they were written there was exactly one owner, and it is the one the
   * environment still names.
   */
  ownerId: OwnerId;
  slug: string;
  url?: string;
  /**
   * Present exactly when this job's document came off the reader's disk.
   *
   * `url` and `upload` are the two origins and a job has one of them. A job with
   * neither is a late stage re-run on an article already on the shelf, which is
   * why both are optional rather than a discriminated union — the pipeline's
   * steps 3 onwards genuinely do not need either.
   */
  upload?: JobUpload;
  /** The article's title once extraction has found one. Until then the slug is all we have. */
  title?: string;
  steps: JobStep[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** The failure that stopped the job, repeated from the step that raised it. */
  error?: string;
  /**
   * What kind of failure that was — set only when the failure said.
   *
   * **This is what decides whether the card offers Retry.** Without it, every
   * failure got the button, including the ones that are arithmetic: the article
   * that needs more output tokens than one response holds got a Retry that made
   * the identical call and failed identically (docs/postmortems/toc-max-tokens.md).
   *
   * A field on the job rather than a code parsed back out of the sentence,
   * which is what the stored messages in src/messages.ts have to do because
   * `err.message` is all they keep. A job is a struct with room for a field, so
   * it does not inherit that workaround. `jobWorthRetrying` in
   * src/job-failure.ts is the one place that reads it.
   *
   * **Absent means nobody said, and that offers the retry.** Every job written
   * before this field existed is in that state, and so is one the restart sweep
   * marked, which really is worth another go.
   *
   * On the job and not on `JobStep`: Retry is a job-level action, and the
   * runner can fail with no step having failed at all. Put it on the step too
   * the day something renders it there.
   */
  failureKind?: FailureKind;
  /** Stop has been pressed and the abort has not landed yet. */
  cancelling?: boolean;
  /**
   * A free-text steer for the steps that take one. Only `summary` does today.
   *
   * On the job rather than in a step's own options because the queue is what
   * survives a restart, and a job resumed from disk with its guidance dropped
   * would run the plain prompt and report success — the reader's steer silently
   * not applied, with a green tick over it.
   *
   * It is part of what makes two jobs different work: see `sameWork` in
   * src/jobs.ts, where leaving it out would let a second, differently-steered
   * request be answered with the first one's job.
   */
  guidance?: string;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * On the job, beside `guidance`, and for the same two reasons: the queue is
   * what survives a restart, and a job resumed from disk with its profile
   * dropped would run the plain prompt, report success, and stamp the artefact
   * with a `profileHash` describing a profile it did not use.
   *
   * And a third that is its own: **it is frozen here.** A summary run is
   * several batches at once; reading the profile inside each step would let a
   * reader who edits their box mid-run get one artefact written from two
   * profiles. src/jobs.ts § sameWork keeps two differently-profiled requests
   * two different jobs.
   */
  profile?: string;
}

/* ------------------------------------------------------------------ chat --
   A conversation about one article. Reader state, so it lives beside the
   article in `data/<slug>/chat.json` exactly as comments.json does.

   See docs/plans/chat-mode.md, and note the one rule that separates this from
   the chatbot vision.md names as an anti-goal: **an assistant message must
   carry block ids**, so every claim has a way back to the passage it came
   from. That contract is enforced in the prompt (src/converse.ts) and rendered
   as clickable chips (src/web/ChatPanel.tsx). */

/**
 * One turn of a conversation.
 *
 * `status` exists on assistant messages for the same reason it exists on a
 * Comment: the row is written to disk *before* the model is called, so a crash
 * mid-answer leaves a visible unfinished turn rather than a question that
 * silently evaporated. A user message is `done` the moment it is stored.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status: "pending" | "done" | "error";
  /** Web pages the model cited, when it chose to search. Assistant turns only. */
  citations?: Citation[];
  /** How many web searches it ran. 0 means it answered from the article. */
  searches?: number;
  /**
   * The tools this answer ran, in order. Assistant turns only.
   *
   * **Absent, not `[]`, on an answer that used none** — which is most of them,
   * because the article is already in the prompt. So the panel's test is
   * "is there anything here", never "how many", and nothing renders an empty
   * strip above an ordinary answer.
   */
  tools?: ToolRun[];
  model?: string;
  error?: string;
  /**
   * The reader pressed stop, so this answer is short on purpose.
   *
   * A flag rather than a fourth `status`, and the distinction is the whole
   * point: a stopped answer is `done`. It is not a failure — nothing went
   * wrong, the reader had read enough — so it must not render as one, and it
   * must not be swept, retried, or apologised for. What it does need is to say
   * so, because an answer that ends mid-sentence with nothing to explain it
   * reads exactly like a bug.
   *
   * Assistant turns only. Kept in the history sent back to the model: it said
   * those words, and pretending otherwise would have it contradict itself.
   */
  stopped?: boolean;
  /**
   * The model ran out of room mid-sentence. Assistant turns only.
   *
   * `finish_reason: "length"` with text already written — which used to be
   * stored as an ordinary `done` answer, so a paragraph that stopped halfway
   * through a word looked like a model that had simply finished oddly. The
   * reader had no way to tell it apart from a complete answer, and "retry"
   * was not obviously the thing to do.
   *
   * A flag rather than a status, for the same reason `stopped` is one: the
   * answer above it is real and worth keeping. Unlike `stopped`, this one **is**
   * a failure of ours — the reader did not ask for it — so the panel says so in
   * a way that offers the retry. See docs/project/chat-tools.md.
   */
  truncated?: boolean;
  /**
   * When the reader last rewrote this message. User turns only.
   *
   * Editing a question discards every turn after it and asks again, so this is
   * the only trace that the conversation above once went somewhere else. The
   * old text is **not** kept — see docs/plans/chat-mode.md § Editing a question.
   */
  editedAt?: string;
}

/**
 * One conversation, and there may be several per article.
 *
 * `title` is derived from the first thing the reader typed rather than asked
 * for — a dialog demanding a name before the first question is a tax on
 * starting, and a list of "Untitled" is worse than a list of opening lines.
 * It can be renamed afterwards.
 */
/**
 * The passage a conversation is about, when it was started from one.
 *
 * Three legal shapes, and only three:
 *
 *   absent                    — an ordinary chat, started from the chat panel
 *   { blockId }               — started from a paragraph's chat button
 *   { blockId, quote, start } — started from a selection in the prose
 *
 * **A union rather than `{ blockId, quote?, start? }`**, so "a quote with no
 * offset" is not a value the type can hold. That fourth inhabitant is not an
 * error anybody sees — `resolveMark`'s fast path takes the offset at its word —
 * it is a mark drawn a few characters to the left of the words it belongs to,
 * which reads as a styling glitch rather than as bad data. Same reasoning, and
 * the same failure, as the note on `Comment.start`.
 *
 * `exactOptionalPropertyTypes` is on, and this shape is compared across two
 * stores byte for byte: write it with a conditional spread
 * (`...(anchor ? { anchor } : {})`) and never as `anchor: undefined`.
 *
 * The offset space is the block's *rendered text*, the one defined in
 * src/web/annotate.ts — the same space `Comment.start` lives in, deliberately,
 * because `resolveMark` draws both and a second spelling would mean a second
 * resolver for the two to drift apart in.
 *
 * See docs/plans/chat-as-gateway.md § A thread can have an anchor.
 */
export type ChatAnchor =
  | { blockId: BlockId }
  | { blockId: BlockId; quote: string; start: number };

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  /** Bumped on every stored message, so the list can show recent first. */
  updatedAt: string;
  /**
   * The passage this conversation was started from, if it was started from one.
   *
   * **Set on the turn that creates the thread and never again.** A conversation
   * is about what it started as — the rule `title` already follows a few lines
   * up, and for a sharper reason here: the anchor is what draws a mark in the
   * prose, so a thread that re-anchored itself would move its mark to a
   * paragraph the reader is not looking at. `withTurn` sets it only on the
   * branch that builds a new thread, and the route refuses an anchor sent for a
   * thread that already has one.
   */
  anchor?: ChatAnchor;
  messages: ChatMessage[];
}

/**
 * A thread without its transcript — what the *reading* view is given.
 *
 * The reading view needs to draw a mark for every anchored conversation and say
 * something useful when the reader hovers one. It does not need the messages,
 * and taking them costs more than bandwidth: chat's state changes on every
 * streamed token, so holding threads above `TableView` would re-render — and
 * re-`annotateHtml` — every paragraph of the article hundreds of times while an
 * answer arrives.
 *
 * So the reading view reads this, and only `ChatDialog` and chat mode hold the
 * real thing. See docs/plans/chat-as-gateway.md § The reading view gets thread
 * summaries.
 */
export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  anchor?: ChatAnchor;
  /** How many question-and-answer pairs. What the hover tooltip counts. */
  turns: number;
  /**
   * The first line of the most recent answer, for the hover.
   *
   * Absent when the newest turn has not been answered yet — which is a state
   * the tooltip has to render rather than a state that cannot happen.
   */
  lastLine?: string;
}

/* ---------------------------------------------------------------- search --
   Finding a passage by what it says. Reader state, so a saved search lives
   beside the article in `data/<slug>/searches.json`, exactly as comments.json
   and chat.json do.

   See docs/project/search.md. Note that only the *meaning* half of the feature
   has a stored shape at all: matching on the letters you typed happens in the
   browser, costs nothing, and is fully described by `?find=` in the URL. There
   is nothing to persist about a substring match, and a stored one would be a
   cache of an instant computation. */

/**
 * One passage the model says matches the reader's criterion.
 *
 * The anchor is `blockId` plus `quote` — id first, text second, offsets never —
 * which is the contract in docs/project/block-ids.md and the same one a
 * `Comment` follows. `start` is a *hint* for choosing between repeats of the
 * same words within one block, and it is measured in `block.text`'s offset
 * space because that is the string the server can see; the client re-finds the
 * quote in the rendered text rather than trusting it (src/quote-match.ts).
 */
export interface SearchHit {
  blockId: BlockId;
  /** The exact words the model pointed at, inside that block. */
  quote: string;
  /**
   * How sure the model is, **0–100, integer, and one unit everywhere**.
   *
   * The version this is borrowed from had a genuine bug here: its API documented
   * this field as 0–1 and its highlighting code read it as 0–100, so somewhere
   * between fetch and render there was an undocumented conversion
   * (docs/project/original-version/highlighting.md). A unit that changes
   * silently as it crosses a boundary is a bug waiting for someone to move a
   * line of code, so this one is stated on the type, enforced in src/search.ts,
   * and never rescaled anywhere else.
   */
  confidence: number;
  /** One line on why this passage matches. Shown in the list, under the quote. */
  reasoning: string;
  /** Where `quote` sat in `block.text` — a disambiguator, never the anchor. */
  start?: number;
}

/**
 * One meaning-search: what the reader asked for, and what came back.
 *
 * `status` exists for the reason it exists on a `Comment`: the row is written
 * to disk *before* the model is called, so a crash mid-search leaves a visible
 * unfinished run rather than a criterion that silently evaporated.
 */
export interface SearchRun {
  id: string;
  /** What the reader typed, in their own words. Never logged — it is prose. */
  criterion: string;
  createdAt: string;
  status: "pending" | "done" | "error";
  hits: SearchHit[];
  model?: string;
  error?: string;
  /**
   * Fingerprint of the blocks this run was answered against — `hashBlocks`,
   * src/source-hash.ts. The same field, the same function and the same word for
   * it as `TweetThread`, `Glossary` and `Summaries` carry.
   *
   * It is what lets the panel say the run is out of date. Without it a saved
   * search survives a re-extraction still presenting itself as an answer about
   * *this* article, while its hits point into a text that has moved — see
   * docs/project/search.md § A saved search says which article it answered.
   *
   * Optional because a run written before 2026-08-26 has none, and because the
   * blocks can be unreadable at the moment a run is started. Absent counts as
   * stale (`isStale`, src/searches.ts): not knowing is not the same as knowing
   * it is fine, and this is the safe way round to be wrong.
   */
  sourceHash?: string;
}
