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
 * Three imports. Two are types: `FailureKind` belongs to src/messages.ts,
 * where the four kinds are defined and where `canRetry` decides what each one
 * means. Writing the union out a second time here would let the two drift, and
 * the drift would show up as a Retry button under a failure that cannot succeed.
 * `Assets` belongs to src/assets.ts for the same reason, and that module is a
 * leaf with no imports of its own precisely so both the pipeline and the
 * browser can reach it.
 *
 * The third is a **value** import, of the two id-shape predicates in
 * src/ids.ts — `decodeFeedbackCursor` below needs them, and src/ids.ts imports
 * nothing at all, so it costs the browser bundle nothing and keeps this file
 * from becoming the sixth copy of the uuid regex.
 */
import type { FailureKind } from "./messages.js";
import type { Assets } from "./assets.js";
import { isSpideryarnId, isUuid } from "./ids.js";

export type NodeId = string; // "n0042"
export type BlockId = string; // "spya-k3m9qt" — see docs/project/block-ids.md
export type BlockKind =
  /* **`callout` is legacy and is produced by nothing.** It was added on the
     morning of 2026-08-31 and replaced the same afternoon by `Block.context`,
     because a box drawn *around* blocks is a different axis from what a block
     *is*: a heading inside a callout has to keep `kind: "heading"`, and so lost
     the box entirely. It stays in the union and in the CHECK constraint because
     every revision extracted in between has it on disk and in Postgres, and the
     reading view reads both spellings.
     docs/plans/260831af-carrying-markup-facts-past-readability.md. */
  | "heading" | "text" | "quote" | "callout" | "code" | "media" | "caption" | "other";

/**
 * **An authored grouping a run of blocks belongs to** — the box a piece drops
 * into the middle of an argument. Recognised at stage 2, before Readability
 * deletes the markup that says so (src/callouts.ts), and carried here by stage
 * 3.
 *
 * Three rules, and the first two are what keep this from becoming a second
 * `kind` or a second address space:
 *
 * 1. **A context groups blocks; it is never copied into `kind`.** Every block in
 *    a callout keeps its own kind — heading, quote, media — and the reading view
 *    sets it differently because of the context it is in.
 * 2. **The id is not an address.** Comments, URLs, the tree and the spine
 *    address block ids, which are the permanent identity
 *    (docs/project/block-ids.md). This is revision-local, and it is stable
 *    across re-runs only so that a diff of blocks.json shows real changes.
 * 3. **Membership decides no policy on its own.** Whether a block is searched,
 *    embedded, gisted or on the clock stays with the named predicates in
 *    src/block-policy.ts.
 *
 * **One context per block, deliberately**, and today it cannot be otherwise:
 * stage 2 collapses a callout inside a callout into one. The day a second type
 * has to co-exist with the first — a verse inside a callout — this becomes a
 * membership table, with a real case to design against.
 * docs/plans/260831af-carrying-markup-facts-past-readability.md.
 */
export interface BlockContext {
  /** `c-` and ten hex digits — `CONTEXT_ID_PATTERN` in src/reserved.ts. */
  id: string;
  type: "callout";
}

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
   * **The splitter's intrinsic fact: this block has independently describable
   * prose.** False for images, rules, and pull-quotes that repeat body text
   * verbatim. These still get ids — the ToC may want to *point* at a diagram —
   * they just have nothing of their own to say.
   *
   * **It is no longer the answer to "does the ToC write a row about this".**
   * That was true until footnotes arrived, and it stopped being true the moment
   * a prose footnote became `gistable: true` and `isStructural: false`. Five
   * different consumers were each reading this field and meaning something
   * different by it, and the five disagreed — so the policy questions now have
   * names, in src/block-policy.ts, which is this field's **only**
   * policy-reading consumer. Read `block.gistable` to decide behaviour and you
   * have put one of the five back in a Boolean.
   *
   * Why it is kept at all rather than derived from `kind`: `describeBlock` in
   * src/blocks.ts can see that a pull-quote repeats the paragraph above it, and
   * nothing downstream can reconstruct that.
   * docs/plans/260828o-footnotes-stage345-upfront-sol.md, decision 3.
   */
  gistable: boolean;
  /** Why gistable is false, for debugging the splitter. */
  note?: string;
  /**
   * What this text is. Absent means ordinary article content.
   *
   * Two orthogonal closed axes rather than one closed set, because
   * acknowledgments and image credits are supplements while an **appendix may
   * be real prose worth gisting** — see docs/plans/260828o-footnotes.md#the-representation.
   *
   * **Only `"footnote"` is ever assigned in v1**, by stage 3 from stage 2's
   * `data-spya-notes` container. The other four are in the union, in the CHECK
   * constraint and in the tests, produced by nothing — deliberately. A stored
   * role means *this revision classifies this content as X*, so narrowing the
   * union now would make widening it a database migration
   * (docs/plans/260828o-footnotes-stage345-upfront-sol.md, decision 2).
   */
  role?: "footnote" | "reference" | "acknowledgment" | "credit" | "appendix";
  /** How the argument machinery must treat it. Absent means "body". */
  treatment?: "supplement";
  /**
   * The authored box this block sits inside, if any — see {@link BlockContext}.
   * Absent means ordinary flow, which is most blocks.
   */
  context?: BlockContext;
  /**
   * Which note this block belongs to. **A note is a RANGE of blocks, not one
   * block** — gwern has 34 notes across 41 supplement blocks, and conflating
   * the two counts is the bug this field exists to prevent
   * (docs/plans/260828o-footnotes.md#a-note-is-a-range-of-blocks-not-a-block). Minted
   * by stage 2 in src/notes.ts, carried here by an ancestor lookup.
   */
  noteId?: string;
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
  /**
   * **One Socratic question the node's prose answers**, on the root and depth-1
   * nodes only, and only where the tree was built after 2026-09-05.
   *
   * Shown in **Summary mode alone**, under the gist — see
   * docs/project/summaries.md § Socratic questions. It is a second field rather
   * than a change to `gist` because the gist is rendered in ten places and is
   * also fed back to the later structure waves as context; the argument is in
   * `questionFor` (src/hierarchy.ts) and the plan doc.
   *
   * **Absence is ordinary**, unlike a missing `gist`: every tree built before
   * this existed has none, and nothing renders a gap. Do not add it to
   * `checkTree` — the gist rule is stated in both directions precisely because
   * a missing gist must not pass as deliberate, and that argument does not
   * apply to a line the model is free not to write.
   */
  question?: string;
  /**
   * Leaves only. Navigation chrome for the ToC and spine; never reading content.
   *
   * **Absence here means "deliberately unlabelled" and nothing else** — a
   * pull-quote, a caption, a rule, anything `isStructural` is false for
   * (src/hierarchy.ts). *Not yet written* is a different fact and does not live
   * on the node: it is `NavLabelStatus` below, one value for the whole
   * revision. Reading a missing field as either one is the overloading
   * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md § 5 names.
   */
  navLabel?: string;
  summary?: string;
  sourceHeading?: string;
  /**
   * **Apparatus rather than argument** — the footnotes, the bibliography.
   * Absent means the body, which is every node of every tree written before
   * 2026-08-28.
   *
   * The one node the reader can see and jump to that covers the whole
   * supplement range, appended by src/supplement.ts after the tree is built
   * from the body alone. It carries an authored `title` and **no `gist`**,
   * because a gist stands in place of the prose it compresses and the promise
   * here is that the notes are shown as written.
   *
   * **`treatment`, not `role`**, deliberately: on a `Block`, `role` says what
   * kind of content it is, and reusing the word here would make it mean
   * structural exclusion as well (GPT Sol's decision 11). This mirrors
   * `Block.treatment`, which is the axis the whole policy is stated on
   * (src/block-policy.ts).
   *
   * Never infer it from a missing `gist`. `checkTree` states the rule in both
   * directions — a supplement must not carry one, an internal body node must —
   * so that a pipeline bug which drops a gist cannot pass as a deliberate
   * supplement (src/tree-invariants.ts).
   */
  treatment?: "supplement";
}

export interface Tree {
  version: string;
  generator: string;
  slug: string;
  rootId: NodeId;
  nodes: Record<NodeId, TreeNode>;
  /**
   * **A stand-in structure, and how it stands in.** Absent means the real
   * thing: a tree the structure model wrote, with a gist on every internal
   * node. `"headings"` means the tree was carved from the author's own heading
   * blocks, deterministically and for nothing (src/heading-tree.ts) — which
   * gets the reader real bands with real names, and no gists at all, because
   * there is nowhere free to get one.
   *
   * **Tree-level, not per-node, and explicit rather than inferred.** Both
   * halves of that are decisions with a history. Tree-level, because a
   * provisional tree is replaced whole and no node of it becomes final on its
   * own — a node-level state only earns its place if partially-streamed nodes
   * ever have to coexist with finished ones. Explicit, because the alternative
   * is reading "provisional" off the absent gists, and that is exactly the
   * mistake `treatment` exists to avoid: keyed on absence, a pipeline bug that
   * drops a gist becomes indistinguishable from a deliberate exception, and the
   * dangerous outcome is acceptance (src/tree-invariants.ts § the gist rule).
   *
   * Two things read it. `checkTree` exempts such a tree from the gist rule and
   * from **nothing else**. And it crosses the public boundary
   * (src/public/dto.ts), because a client that cannot tell a provisional tree
   * from a finished one draws empty cells where it should say the structure is
   * still arriving.
   */
  provisional?: "headings";
}

/**
 * **Where a revision's paragraph nav labels are in their life** — one value for
 * the whole revision, never per node.
 *
 * `TreeNode.navLabel` above already has a legal absence, and it means
 * *deliberately unlabelled*: a caption, a pull-quote, a rule. This is the other
 * question, the one absence cannot answer —
 * [hierarchy.ts](hierarchy.ts) put it in as many words long before there was a
 * field for it: deferring the labels *"needs a state that says 'still arriving'
 * rather than an absence that says nothing."*
 *
 * - `pending` — a run is expected and has not landed. **The whole paragraph
 *   label layer is withheld** rather than drawn empty (src/web/nav-labels.ts),
 *   because a column of blank cells reports accidental absence as article
 *   structure.
 * - `ready` — the labels are as good as they are going to get. Individual
 *   leaves may still carry none, and that is the deliberate kind of absence.
 * - `failed` — the run happened and did not produce them. Same withholding as
 *   `pending`; what differs is only what the reader is told, and **the enum is
 *   the whole of what crosses** — no provider message, on either DTO
 *   (docs/project/copy.md § Never repeat what the provider said).
 *
 * **Revision-scoped and stored as a column**, not on the `Tree`, because a
 * failure has to outlive the draft that failed: a labels job that dies must
 * mark the revision the reader is actually looking at, and a candidate tree is
 * discarded. GPT Sol's F6,
 * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md.
 *
 * Everything writes `ready` today. Stage 2 of that plan is what starts writing
 * the other two.
 */
export type NavLabelStatus = (typeof NAV_LABEL_STATUSES)[number];

/**
 * The three, as a runtime list — **and it is the source, not a copy of one.**
 * `NavLabelStatus` above is derived from it with `(typeof …)[number]`, which is
 * the whole point: the two used to be independent declarations, and
 * `readonly NavLabelStatus[]` proves only that every value listed *belongs to*
 * the union — never that the list *exhausts* it. A fourth member added to the
 * union and forgotten here would have compiled, and then the drift test built
 * on this list would have checked the migration against an incomplete set and
 * passed. One declaration cannot disagree with itself. GPT Sol's F1 on stage 1,
 * 2026-09-06.
 *
 * It exists at runtime for one job: the CHECK expression is a hand-kept literal
 * in **two** places that no compiler reads — the migration under `drizzle/` and
 * the copy in [`src/db/schema.ts`](db/schema.ts) — so something has to be able
 * to enumerate the union and compare against both.
 * `tests/nav-label-status.test.ts` is that something.
 *
 * **No `isNavLabelStatus` beside it**, and that is a decision rather than an
 * omission: a runtime parse would have no caller. The database's CHECK is what
 * keeps a fourth value out, and the one place a stray value could still do harm
 * — the client deciding whether to draw the paragraph layer — is written
 * `=== "ready"` precisely so that anything it does not recognise withholds
 * (src/web/nav-labels.ts). A guard nobody calls is a guard nobody maintains.
 */
export const NAV_LABEL_STATUSES = ["pending", "ready", "failed"] as const;

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
  /**
   * What this arc was written from — blocks, tree and the metadata the prompt
   * carries. See `inputFingerprint` in src/arc.ts.
   *
   * **Optional only so that the arcs already on disk still parse.** Every one of
   * them predates this field (2026-08-29), and `isStale` reads its absence as
   * stale rather than as current: "we cannot tell" must not be confused with "we
   * checked". New arcs always carry it.
   */
  sourceHash?: string;
  entries: ArcEntry[];
}

/**
 * One post of the thread — see docs/plans/260825g-tweet-thread-page.md.
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
   * see docs/plans/260826d-glossary-entries-worth-reading.md.
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
   * docs/plans/260826d-glossary-entries-worth-reading.md § Provenance is structural.
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
   * See docs/plans/260826d-glossary-entries-worth-reading.md § The web.
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
 * **What the glossary's *Look up a term* box hands back** — one answer about
 * one passage, and nothing that outlives the request.
 *
 * A reader asked for a box that would "look for that term and add it to the
 * glossary" (2026-09-04, `[SPIDERYARN-READING2-Y]`). This is the first half of
 * that and deliberately not the second: **nothing here is stored**, and no
 * `GlossaryEntry` is minted. The glossary is a wholesale JSON document
 * (src/db/schema.ts § `glossary`) which a *"find more terms"* run recomputes,
 * and which src/store/public-reader.ts publishes to everyone a shared article
 * is shared with — so an entry a reader added would be merged away by the first
 * and **published by the second**. Persistence needs its own owner-scoped table
 * and its own decision about the public projection; until then this answers the
 * question and keeps the reader's words to itself.
 * docs/project/glossary.md § Looking a term up.
 *
 * `lookup` is a {@link GlossaryLookup} so the panel draws this with the same
 * component it draws a checked entry with — same call, same shape, one piece of
 * rendering. It is **not** written to `glossary_lookups`: that table is keyed by
 * entry id and there is no entry.
 */
export interface AskedTermAnswer {
  /** What the reader typed, normalised — never their raw string, and never stored. */
  term: string;
  /** The block the question was anchored to, so the panel can offer a jump. */
  blockId: BlockId;
  /**
   * **The article's own words, not the reader's.** Where the two differ — case,
   * a plural, a possessive — the piece wins, because that is the passage the
   * model was told the reader had selected and it is the text that is there.
   */
  quote: string;
  lookup: GlossaryLookup;
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
   * docs/plans/260826d-glossary-entries-worth-reading.md § What review caught.
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
/** As `ThreadFound`, for the ideas. */
export type IdeasFound = Omit<IdeasResponse, "profileChanged">;
export type SketchFound = Omit<SketchResponse, "profileChanged">;
/** As `ThreadFound`, for the illustration. */
export type IllustratedFound = Omit<IllustratedResponse, "profileChanged">;
/** As `ThreadFound`, for the quotes. */
export type QuotesFound = Omit<QuotesResponse, "profileChanged">;


/* ------------------------------------------------------------------ ideas --
   The propositions a reader has to hold to get the piece — `data/<slug>/
   ideas.json`, and a **mode** in the band beside the glossary. Stage 5f.
   See docs/plans/260826ac-ideas-mode.md.

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
 * docs/plans/260826ac-ideas-mode.md § What it looks like.
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
   * `StepStamp` in src/store/artifacts.ts predicted this: *"`arc`, `tweets` and
   * `glossary` all read the tree as well as the blocks, and
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
/**
 * The arc as a surface reads it: the artefact, and whether it still describes
 * this article.
 *
 * **Three states, not two**, which is the whole reason this is a type rather
 * than `Arc | null`. Absent means nobody has asked for one yet and the reader
 * should be offered the wait; *stale* means one exists and is about a shape the
 * article no longer has. Collapsing them loses the case that matters, because a
 * stale arc is the one that renders as a plausible, silently incomplete column —
 * `buildArcColumn` joins by exact block range and simply does not draw an entry
 * that matches no node. GPT Sol, 2026-08-29.
 *
 * `stale` and `outdated` split the same way they do for the ideas: the article
 * moved under it, versus we would write it differently now.
 */
export interface ArcFound {
  arc: Arc;
  /** The article moved underneath this arc. Do not draw it. */
  stale: boolean;
  /** The article is the same and we would write it differently now. */
  outdated: boolean;
}

export interface IdeasResponse {
  ideas: Ideas;
  /** The article moved underneath these ideas. */
  stale: boolean;
  /** The article is the same and we would write these differently now. */
  outdated: boolean;
  /** You are not who you were when we wrote it. */
  profileChanged: boolean;
}

/* ----------------------------------------------------------------- quotes --
   The lines worth keeping — `data/<slug>/quotes.json`, and a **mode** in the
   band beside the glossary and the ideas. Stage 5h.
   See docs/plans/260831j-quotes-mode.md.

   The third question the band answers, and the only one whose answer is
   entirely in the article's own words — *the article's*, because verification can
   prove the words are in the piece and cannot prove who wrote them
   (src/quotes.ts § authorVoice). The glossary answers *what does this word
   mean*; the ideas answer *what do I have to hold*; this answers *which lines
   is it worth carrying out of here* — and every one of them is a sentence the
   author wrote, found in the article rather than composed. */

/**
 * One quote, and where it sits.
 *
 * **`blockId` is ours, not the model's.** The model returns the words and
 * nothing else; `locate` in src/quotes.ts searches every block for them. That
 * is the glossary's rule (`findOccurrences`) rather than the ideas' rule, and
 * it is what makes the whole `unknownIds` class of failure — a model naming a
 * block that does not exist — impossible here rather than merely counted.
 *
 * The invariant this type is arranged around: **`text` is in the article.**
 * A quote `findQuote` cannot locate is dropped before an object of this shape
 * exists, because a plausible paraphrase in quotation marks beside the real
 * prose is the one failure this feature must not have.
 */
export interface Quote {
  /** `mintUniqueId`, so it is block-id shaped and `?quote=` validates for free. */
  id: string;
  /** The block the words were found in. Ours, from `findQuote` — see above. */
  blockId: BlockId;
  /**
   * The exact words, as the model returned them.
   *
   * Stored as the model typed them rather than as the article spells them, and
   * the difference is real: `findQuote` folds curly quotes and dashes to match,
   * so a quote located by pass one may differ from `block.text` by a character
   * or two. `start` plus this string's length is **not** a span — the client
   * re-finds the words in the rendered text, which is a third offset space
   * again. src/web/search-hits.ts § the header.
   */
  text: string;
  /** Where the words sat in `block.text` — a disambiguator between repeats, never the anchor. */
  start?: number;
  /**
   * One line on why this one, shown as a **tooltip** and never as body text.
   *
   * Greg, 2026-08-31: *"with reason as a tooltip"*. The list a reader scans is
   * the author's prose and nothing else; the model's contribution is one hover
   * or one Tab away rather than competing with the sentence above it.
   *
   * Absent is a real answer. The prompt bans the register the glossary's
   * `senseHere` fell into — describing the page the reader is already looking
   * at — and for this field that register is not merely tempting, it is the
   * obvious reading of the question. docs/plans/260831j-quotes-mode.md.
   */
  reason?: string;
  /** 0–1: how much of the article's argument rests on this line. The model's judgment. */
  importance?: number;
  /** 0–1: how memorable, quotable, well-put it is. The model's judgment. */
  striking?: number;
}

/**
 * How heavily a quote is outlined in the prose — **two levels, and the number of
 * levels is the finding, not an accident.**
 *
 * `1` is the light stroke, `2` the heavy one. The stylesheet owns the widths
 * (1px and 3px, styles/annotations.css § quote strokes); this is an ordinal so
 * that the design values stay in the design layer, exactly as `data-hues` keeps
 * a count here and the colours next door.
 *
 * **Why not three.** A blind pairwise test on the box, 2026-09-07, scored three
 * tiers at 1/2/3px at **13/20 — chance** — and the tester's answers correlated
 * with slot position rather than with thickness, which is the standard tell for
 * guessing. Two tiers at 1px and 3px scored **12/12 at both device scale
 * factors**, with no hesitation on any pair. Everything involving a middle tier
 * is what fails: 1-vs-2 and 2-vs-3 are each marginal, while 1-vs-3 is obvious.
 * So a third level would be a ranking the reader cannot see, which is worse than
 * no ranking at all.
 * docs/plans/260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md
 */
export type QuoteTier = 1 | 2;

/**
 * **How a quote's outline is drawn: its weight and its brightness, as one
 * value.** `tier` is the coarse priority step above; `alpha` (0.70–1.00) is
 * the fine one on top of it, since 2026-09-11 — Greg, SPIDERYARN-READING2-2W:
 * *"perhaps slightly fade the border based on the priority-score (but even
 * low-priority quotes should still be clearly visible)"*.
 *
 * **One object rather than two fields, all the way to the markup**, so that a
 * quote with a weight and no brightness is not a state anything can be in —
 * GPT Sol's point on the plan: two parallel fields would let `baseMarks`
 * unpack it back into exactly that. `quoteStroke` in src/web/QuotesPanel.tsx
 * makes one; docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md
 * § 1 says why the two channels cannot cancel.
 */
export interface QuoteStroke {
  tier: QuoteTier;
  alpha: number;
}

/**
 * What was thrown away, and why. **Every one of these is invisible from
 * outside** — a dropped quote looks exactly like a line the model chose not to
 * offer — which is the whole reason they are counted and logged.
 *
 * **It rides on the artefact**, not only in a log line. A count in a log is
 * invisible to the person the drop happened to — the reader, who is looking at
 * a list quietly shorter than the model offered — so `Quotes.discarded` carries
 * these and the panel says so in a sentence. GPT Sol, 2026-08-31.
 *
 * Counts only. Never the quote, never the reason, never the raw parse error:
 * this file does not log, but a step that throws is logged by src/jobs.ts with
 * `errorFields`, and an error is a value that travels. Article prose must not
 * ride in one — docs/project/logging.md.
 */
export interface QuoteDrops {
  /**
   * `findQuote` could not locate the words in any block. **The one to watch.**
   *
   * It counts the model paraphrasing rather than copying, which is the single
   * failure this feature is not allowed to have. A run that starts returning
   * several is the prompt having drifted, and nothing else would report it.
   */
  unfound: number;
  /**
   * Found in the article, and **not in the author's voice** — see `authorVoice`.
   *
   * Its own counter rather than folded into `unfound`, because it is the
   * opposite fact: `unfound` is the model inventing words, and this is the model
   * copying words correctly out of somebody else's mouth. A run with a high
   * `otherVoice` is an article with a lot of quotation in it, which is not a
   * fault at all; a run with a high `unfound` is a prompt that has drifted.
   */
  otherVoice: number;
  /** Outside `MIN_QUOTE_CHARS`–`MAX_QUOTE_CHARS`. A phrase, or a whole paragraph. */
  wrongLength: number;
  /** Located, but overlapping a span already kept — see `dedupeOverlaps`. */
  overlapping: number;
  /** Quotes past `MAX_QUOTES`, discarded whole. */
  overCap: number;
  /** Not an object, or with no `text` at all. */
  malformed: number;
  /* **Every counter here is a quote that is not in the list**, which is what
     lets `Quotes.discarded` cross to a visitor and be said out loud.

     The scores the model failed to give us are counted too, and deliberately
     NOT here: nothing about them costs the reader a quote, and they are a fact
     about our prompt rather than about the list on the screen. They live on
     `QuoteScoreDrops` in src/quotes.ts, which does not ride the artefact — read
     its docstring before adding a counter to either. */
}

/**
 * The most quotes one article's list may hold, across every Find more.
 *
 * Three long default passes (`MAX_QUOTES` in src/quotes.ts is one pass). It
 * exists for two costs that grow with the list rather than with the pass: every
 * append re-sends the whole taken list in the prompt, and the prose marks every
 * visible quote in every mode. At the ceiling the panel stops offering Find
 * more and says why, rather than letting a pass run that could add nothing.
 *
 * **Here rather than in src/quotes.ts** because the panel needs it too, and
 * that module is server-only.
 */
export const MAX_QUOTES_TOTAL = 120;

/**
 * The artefact, stage 5h.
 *
 * **Appended to since 2026-09-11** — a Find more on a list from the same
 * article keeps every quote and adds more (`passes`, `lastAdded`), and only a
 * stale list is replaced. Until then it replaced, like `Ideas`. src/quotes.ts
 * § existingFor.
 */
export interface Quotes {
  version: string;
  generator: string;
  slug: string;
  /** `articleFingerprint` — the blocks, the tree and the metadata head. */
  sourceHash: string;
  /**
   * As `Glossary.profileHash`, and **not** in the freshness stamp.
   *
   * The profile changes *which* lines a reader is shown, the way it changes
   * which terms get an entry — so the read path raises a banner and the reader
   * decides. It is the glossary's position rather than the ideas', and the
   * difference is that a profile cannot change what the author wrote.
   */
  profileHash?: string | null;
  /**
   * **Document order**, fixed at write time.
   *
   * Stored in the article's own order rather than in any ranked one, for the
   * reason glossary.md § Six ways to break this quietly gives as its second:
   * sorting on write makes `?rank=document` mean whatever the last writer felt
   * like, and the panel's fallback order silently becomes a ranking.
   */
  quotes: Quote[];
  /**
   * What the model offered and this stage would not store.
   *
   * On the artefact rather than only in the log, so the panel can tell the
   * reader. A list that is quietly shorter than the model produced is exactly
   * the shape of failure docs/reusable/silent-success.md keeps catching, and
   * `unfound` in particular is a fact about *this* list the reader is entitled
   * to: it means the model offered words that are not in the piece.
   */
  discarded: QuoteDrops;
  /**
   * How many passes built this list — 1 for a fresh one, one more for every
   * Find more. As `Glossary.passes`. Absent on a list written before
   * 2026-09-11, which was one pass.
   */
  passes?: number;
  /**
   * How many quotes the most recent pass added. **The one number that tells a
   * Find more that found nothing from a button that did nothing** — the panel
   * says so when it is 0 after the first pass (docs/reusable/silent-success.md).
   * Absent on a list written before 2026-09-11.
   */
  lastAdded?: number;
  generatedAt: string;
  elapsedMs: number;
}

/**
 * `GET /api/quotes/:slug`. The same three staleness facts the glossary and the
 * ideas carry, for the same three reasons, computed at read time.
 */
export interface QuotesResponse {
  quotes: Quotes;
  /** The article moved underneath these quotes. The words may no longer be in it. */
  stale: boolean;
  /** The article is the same and we would choose differently now. */
  outdated: boolean;
  /** You are not who you were when we chose them. */
  profileChanged: boolean;
}

/**
 * The Sketch diagram as the panel receives it — docs/project/diagram.md § Sketch.
 *
 * **The scene is `unknown` here, and that is deliberate rather than lazy.** The
 * real type is `Sketch` in src/sketch-scene.ts, which imports *this* file, so
 * naming it here would be an import cycle — and `npm run check` gates on those.
 * More usefully, the client has to run the scene through `readSketch` on
 * arrival anyway: what crosses the wire is a stored artefact that may have been
 * written by an older version of the schema or against an article that has since
 * moved, and a type assertion is exactly the reassurance that would stop anyone
 * checking. See src/web/useSketch.ts, which does the parse.
 */
export interface SketchResponse {
  /** A `Sketch`, unvalidated. Run it through `readSketch` before drawing it. */
  sketch: unknown;
  /** The article moved underneath this picture. */
  stale: boolean;
  /** The article is the same and we would draw it differently now. */
  outdated: boolean;
  /** You are not who you were when we drew it. */
  profileChanged: boolean;
}

/**
 * The Illustrated plates as the panel receives them —
 * docs/project/diagram.md § Illustrated.
 *
 * `unknown` for the same reason `SketchResponse.sketch` is: the real type lives
 * in src/illustrated-plate.ts, which imports *this* file, and the client has to
 * run it through `readIllustrated` on arrival anyway.
 *
 * **`stale` means something different here than anywhere else, and the panel's
 * sentence has to say so.** Everywhere else it means *the article moved*. Here
 * it means *the Sketch moved* — a forced Sketch redraw changes the scene with
 * every article byte identical, so this is the one artefact whose freshness is
 * about another artefact. src/illustrated.ts § `inputFingerprint`. A stale
 * illustration is a picture of an argument nobody is looking at any more, which
 * is a stronger claim than a stale Sketch's, not a softer one.
 */
export interface IllustratedResponse {
  /** An `Illustrated`, unvalidated. Run it through `readIllustrated`. */
  illustrated: unknown;
  /** The Sketch moved underneath these plates. */
  stale: boolean;
  /** The Sketch is the same and we would paint it differently now. */
  outdated: boolean;
  /** You are not who you were when it was painted. */
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
 * 600 rather than the global box's 1,500 because it is about one article: a
 * paragraph on who you are is a life, a paragraph on why you opened *this* is
 * usually a sentence. It was originally set to match `MAX_GUIDANCE_CHARS` on
 * the summary steer, the two boxes being adjacent in the reader's head — that
 * steer is gone (docs/plans/260830o-steer-becomes-the-profile.md), so the number now
 * stands on the reasoning above rather than on the pairing.
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
  /**
   * **When the publisher says the piece was published**, ISO, in the
   * publisher's own frame — not when we downloaded it.
   *
   * That distinction is the whole point of the field and it is not a nicety:
   * `fetchedAt` above can be fifteen years later, and a stage that reached for
   * it as a reference frame would date every undated "on July 7" to the day the
   * article happened to be ingested. Timeline needs the year nobody writes down
   * (docs/plans/260831i-timeline-mode.md § The reference frame), and the publication
   * date is the only thing that supplies it.
   *
   * **Absent on every article ingested before 2026-08-31**, and it stays absent
   * until that article is re-extracted — so the no-frame path is the common one
   * and is the one that has to work. Absent also whenever the page carried no
   * date, or carried one this stage would have had to guess at.
   *
   * It is the publisher's claim, verbatim, not a verified fact: a page can say
   * anything, and re-dating an old post is a thing publishers do.
   */
  publishedAt?: string;
  /** Readability's own one-or-two-sentence excerpt. A last-resort card blurb. */
  excerpt?: string;
  note?: string;

  /**
   * **The reader's own name for a file they uploaded** — `raw_filename`, which
   * stage 1 writes from `RawManifest.filename` and which is null for everything
   * that was fetched.
   *
   * So its presence is the honest answer to *did this come off your disk?*, and
   * that question stopped being answerable by `source === "pdf"` on 2026-09-07,
   * when a web page became a legal upload
   * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md). `source` is the
   * **media kind**; conflating the two axes is the thing src/source.ts's own
   * header warns against, and the masthead and the metadata page were both
   * doing it because until that day it happened to be true.
   *
   * **Owner-facing only.** It is not in `PublicMeta` and must not be — the
   * public SQL projection does not select it and `publicMeta` is a hand-built
   * allowlist, so it is withheld twice.
   *
   * **But do not read that as "nobody else can see what they called it."** The
   * *stem* of the filename is already public for a published article, and has
   * been since uploads existed: `slugFromFilename` (src/ingest.ts) mints the
   * article's slug from it, and the slug is in `PublicMeta`. So
   * `confidential-client-acme.html` becomes `/read/confidential-client-acme-spya-…`.
   * What this field withholds is the exact string — the extension, the case, the
   * punctuation, anything the kebabing dropped — and that is worth withholding,
   * but it is a smaller claim than it first looks. ⟨Sol, 2026-09-07, who caught
   * an earlier version of this comment claiming the larger one.⟩ The slug
   * exposure predates this work and is Greg's call, not an agent's:
   * docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md § A privacy question
   * this work did not create and did not fix.
   */
  filename?: string;

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
   * docs/plans/260826c-pdf-ingestion.md § A scan with no text layer.
   */
  unverified?: boolean;
  /**
   * Recall against the PDF's own text layer, pooled over the checked pages.
   * Absent for a scan.
   *
   * **Not a mean of per-page recalls**, which is what this said until
   * 2026-09-03 and what the metadata page's tooltip repeated to readers. It is
   * `matchedTokens / baselineTokens` (src/pdf-read.ts), summed across every
   * scored page before dividing — so it is weighted by how much text each page
   * carried, and a dense page counts for more than a title page. The
   * difference is not academic on a document with one 12-word page and sixteen
   * full ones.
   *
   * Read it with `pagesChecked`, always. A figure over one page of seventeen is
   * arithmetically fine and means nothing, and the number on its own cannot
   * tell you which it is.
   */
  recall?: number;
  /**
   * How many pages the recall above was computed over — **not** the pages that
   * passed, and **not** simply the pages that had a text layer. `0` on a scan,
   * where nothing could be checked.
   *
   * `scored` in src/pdf-score.ts owns the definition, and it drops two kinds of
   * page: those with no baseline text to compare against, and end-of-document
   * reference lists, which do have a text layer and are excluded because the
   * model transcribes them only partly. So `pages - pagesChecked` is the number
   * left out of the comparison, and the reason is not recoverable from here —
   * anything the reader is told about *why* has to be hedged accordingly
   * (src/web/Metadata.tsx § CameFrom). This docstring claimed the simple
   * text-layer rule until GPT Sol read the scorer, 2026-09-03.
   */
  pagesChecked?: number;
  /**
   * Specific things the transcription checker complained about, in its own
   * words. Absent when it found nothing, which is the common case.
   *
   * These used to stop the article being published at all. They no longer do
   * (Greg, 2026-08-30 — see the long note at the end of `runPdfExtract`), so
   * this field is the whole of what is left of that defence: if nobody reads
   * it, nobody is checking. `recall` is the number; this is the complaint.
   */
  quality?: string[];
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
 * the Drift and Trail pictures — docs/plans/260827g-embedding-scatter-diagrams.md.
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

/**
 * **Whose fault it is when a passage cannot be turned into a vector.**
 *
 * Carried on `EmbeddingFailure` in [embeddings.ts](embeddings.ts), which is
 * where the reasoning lives. It is declared *here* rather than there because
 * [messages.ts](messages.ts) needs it to hold a total map of sentences, and
 * `messages.ts` is one of the modules the client shares — so it may only import
 * other shared modules, type-only or not (`tests/client-imports.test.ts`, and
 * the rule is deliberately blind to `import type`: a shared module reaching
 * into the server can drag `node:fs` into the browser bundle, and the erasure
 * that makes one import safe is not a property a grep can check).
 *
 * - `config` — this app's account may not use the model, or has no key.
 *   Permanent until a person changes a setting.
 * - `provider` — refused, unreachable, or answered with something that is not
 *   vectors. Another go may work.
 * - `busy` — our own admission control, not the provider's. Another go in a
 *   moment will work.
 */
export type EmbeddingReason = "config" | "provider" | "busy";

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
  /**
   * One sentence per part on where the argument stands there (src/arc.ts,
   * stage 5b). Absent until that step has run, and then Structure's list face
   * simply omits its rung 4 — it drew Hierarchy's L0 column too until 2026-09-05.
   */
  arc?: Arc;
  /**
   * The article's own images, and which of them we hold — `Assets`
   * (src/assets.ts), written by the `assets` step.
   *
   * **A required key holding `Assets | undefined`, not an optional one**, and
   * the difference is the whole reason it is written this way. There were two
   * places that built an `Article` — the filesystem loader (src/api.ts) and the
   * Postgres projection (src/store/pg.ts) — and with `assets?:` an omission in
   * either would typecheck perfectly while the reader went on hot-linking every
   * image to the publisher: the feature reporting success by doing nothing,
   * which is docs/reusable/silent-success.md in one field.
   * `exactOptionalPropertyTypes` is on, so this form makes the compiler ask.
   *
   * `undefined` is a real answer and the third state: an article ingested
   * before this step existed has no manifest at all, and the reader must
   * hot-link exactly as before rather than read it as "every image failed".
   */
  assets: Assets | undefined;

  /**
   * **Where the paragraph nav labels are** — `NavLabelStatus` above, off
   * `article_revisions.nav_label_status`.
   *
   * **A required key, like `assets` and unlike `visibility`**, and for the same
   * reason `assets` is: there is exactly one thing the client does with this,
   * and it is decide whether to draw the paragraph label layer at all. Optional,
   * a projection that forgot it would typecheck perfectly and the reader would
   * go on getting a run of blank leaf cells — the feature reporting success by
   * doing nothing (docs/reusable/silent-success.md, and src/web/tree.ts § "a run
   * of forty blank leaf cells").
   *
   * There is no *we cannot say* answer to make it `| undefined`: the column is
   * `not null` with a default, and there is one store.
   */
  navLabelStatus: NavLabelStatus;

  /**
   * **May a stranger read this** — the owner's copy of `articles.visibility`,
   * so the masthead can say so without a request of its own.
   *
   * The one field here that is not an artefact. It is on this payload rather
   * than behind a route because it is a property of *the work* (src/routes.ts
   * § the sharing switch), because the Postgres store selects the `articles`
   * row anyway so it costs nothing, and because the alternative — a `GET`
   * beside the existing `PUT` — is a second round trip on every article open to
   * carry one enum that is already on the wire.
   * docs/plans/260904b-sharing-mark-on-the-article-masthead.md.
   *
   * **Absent means *this store cannot say*, and never `private`.** The
   * filesystem store has no visibility column — `visibilityStore.set` refuses
   * with a 501 there (src/store/index.ts) — so absence is the only honest
   * answer it has, and a `private` default would have the mark tell an owner
   * that only they can read an article nobody ever asked about. That is the one
   * sentence this control must not get wrong, and it is the same rule
   * `ArticleMetadata.sharing` follows for the same reason.
   * docs/reusable/silent-success.md.
   *
   * Optional rather than `Visibility | undefined`, unlike `assets` above:
   * `assets` is required-but-undefinable precisely so a store that forgets it
   * is a type error, and here the *forgetting* is a legitimate answer one of
   * the two stores gives on every article. There is nothing for a compiler to
   * insist on.
   */
  visibility?: Visibility;
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
  /**
   * **The body's words, not every block's** — `LibraryScalars.wordCount`, which
   * is `articleWordCounts(blocks).body` (src/block-policy.ts). Footnotes and
   * bibliographies are on the page and are not what the card is promising.
   * Anything that adds these up must not call the total "words in all".
   */
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
  /**
   * **`"public"` when anyone with the link can read this, and absent otherwise.**
   *
   * The owner's side of `Visibility` below: the shelf is the one place they see
   * every article at once, so it is the only place that can answer *which of
   * mine are out in the world* at a glance. src/web/ShelfEntry.tsx draws it;
   * the visitor's side of the same fact is `ViewOnlyChip`
   * (src/web/PublicChrome.tsx) and says something different.
   *
   * **Absent rather than `"private"`, and that is not a spelling choice.** The
   * filesystem store has no visibility column at all — `visibilityStore.set`
   * refuses with a 501 there (src/store/index.ts) — so absence is the only
   * answer both stores can give about a document nobody has shared, and
   * tests/store-parity.test.ts compares whole entries. A `"private"` from one
   * store and an absence from the other would be two spellings of one fact and
   * a parity failure about nothing.
   *
   * A badge, not a filter: there is deliberately no way to sort or narrow the
   * shelf by this until there is enough shared material for it to be worth
   * anything.
   * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster E.
   *
   * **`"public"` and not `Visibility`, so the paragraph above is a compile
   * error rather than a convention.** `describeArticle` still *takes* the full
   * union — it is normalising a database value — and narrows here, which is
   * where the invariant belongs: an accidental pass-through of the row's
   * `"private"` now fails to typecheck instead of putting a wrong key on every
   * card and waiting for a parity test to notice. GPT Sol's review of this
   * stage, on the house rule in AGENTS.md § *let the types catch it*.
   */
  visibility?: "public";

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
  has: { arc: boolean; tweets: boolean; glossary: boolean };
}

/**
 * The whole body of `GET /api/library` — **the envelope, named once.**
 *
 * `LibraryEntry` above has always crossed the server/client seam from this
 * file; the envelope around it did not, and was instead hand-copied inline at
 * five call sites. One of those copies said something different — the offline
 * shelf filter was written against a bare array — and because nothing typed
 * either side, it returned the shelf unfiltered for a fortnight without a
 * single complaint from the compiler or the suite.
 * docs/postmortems/260903e-offline-shelf-filter-never-ran.md.
 *
 * So: the route annotates what it sends with this, and a test fixture standing
 * in for that body declares itself with this. Not every consumer reads through
 * it yet — a body coming back off IndexedDB is `unknown` and no type can fix
 * that — but the shape now has one place to be wrong in.
 */
export interface LibraryResponse {
  articles: LibraryEntry[];
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
 * live out here, and docs/plans/260826k-library-shelf-actions-and-search.md for the
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
   * words. The per-article half of docs/plans/260826t-reader-profile.md; the global
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
 * See docs/plans/260825e-metadata-page.md. § What the plan got wrong is why this carries
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
   * `articleMetadata` in src/store/pg.ts.
   *
   * Deliberately computed over the outputs that **exist**, whatever `done`
   * says, so a stage that wrote half of what it owes still says when it did it.
   */
  ranAt: string | null;
  /**
   * When that same run **began**, ISO — `started_at` on the one
   * `revision_step_runs` row. `null` when nothing recorded one.
   *
   * Here so the page can say *how long it took*, which is a subtraction and not
   * a field: Greg asked for it on 2026-09-07
   * (docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md).
   *
   * **This is not the `started_at` fallback `ranAt` refuses**, and the
   * distinction is the whole reason both can exist. That refusal is about which
   * stamp answers *when did this stage last run* — a run that began and wrote
   * nothing must not put a timestamp on that question. This field answers a
   * different one, only ever alongside a `ranAt`, and it goes to `null` on its
   * own rather than standing in for anything.
   *
   * **The pair always describes one run.** `beginStepRun` writes `started_at`
   * and blanks `finished_at` in the same `values`; `finishStepRun` only updates
   * a row still `running` under its own attempt token; `beginDraftIn` carries
   * both columns forward together. So there is no path that leaves a start from
   * one run beside a finish from another — which there would have to be for the
   * subtraction to lie. See src/store/pg-revisions.ts.
   *
   * A **carried-forward** row therefore reports the run that happened in the
   * revision this one was drafted from. That is exactly what `ranAt` already
   * does, and the row's sentence is *"when this stage last finished"* rather
   * than *"during this revision"* for that reason.
   */
  startedAt: string | null;
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

/**
 * May a stranger read this article? `private` or `public`, and **never
 * `published`**.
 *
 * `article_revisions.status` already has a value spelled `published` and it
 * means *the pipeline finished*, not *anybody may read this*. Two meanings of
 * one word, two tables apart, is how a mistake gets made at three in the
 * morning. docs/plans/260827ai-public-read-only-access.md.
 *
 * **Declared here rather than in `src/store/contracts.ts`, which re-exports it**,
 * because since 2026-08-28 it is part of a response the browser reads —
 * `ArticleMetadata` below — and every wire shape in this app lives in this file.
 * That is not a filing preference: `contracts.ts` reaches the whole store layer,
 * and a client importing it would drag pino and `process.env` into the bundle
 * (tests/client-imports.test.ts).
 */
export type Visibility = "private" | "public";

/**
 * The whole state of one article's sharing — **the same shape the `PUT` answers
 * with**, and deliberately reused rather than restated.
 *
 * `PUT /api/article/:slug/visibility` returns this, and `ArticleMetadata` below
 * carries it, so the owner's sharing card reads the toggle's reply and the page
 * load with the same line. Two shapes here would be two places for the card to
 * drift between the state it was told and the state it fetched.
 */
export interface VisibilityState {
  visibility: Visibility;
  /**
   * ISO when sharing was last switched on, or `null` while it is private.
   *
   * Cleared on unshare, so it answers "how long has this been up" and not "was
   * this ever public" — the second is the append-only
   * `article_visibility_changes` log's question, and it is deliberately not on
   * any response.
   */
  publicAt: string | null;
}

/**
 * Everything the owner's Access & Sharing card needs, in one block.
 *
 * **Extends `VisibilityState` rather than restating it**, so the card reads the
 * `PUT`'s reply and the page load with the same two fields and they cannot
 * drift — while `VisibilityState` itself stays what the switch returns and
 * gains nothing about artefacts, which are not the switch's business.
 */
/**
 * **Which of the five shareable artefacts this article actually has.**
 *
 * Declared here rather than in [public-types.ts](public-types.ts), which is
 * where it is *used* and where its history is, and which re-exports it so that
 * every existing importer is unchanged. It moved on 2026-09-02 because
 * `ArticleSharing.available` below needs the same five booleans.
 *
 * **The reason is design, not the cycle gate, and the first version of this
 * comment got that wrong.** It claimed `npm run check` would refuse a
 * back-import because it counts type-only cycles. It does not: `types.ts` and
 * `messages.ts` already import each other's types and `npm run cycles` is green
 * over them (GPT Sol checked, 2026-09-02). What is true is the property
 * `public-types.ts` states in its own header — it imports this file *and
 * nothing else* — so the two type modules run one way. A back-import would make
 * them mutually dependent to save moving one interface down, and a linter
 * tolerating that is not a reason to do it.
 *
 * **Presence, never currency.** A `true` here means the column is not null, and
 * that is exactly the question `src/store/public-reader.ts` asks: the public
 * projection reads the artefact and never asks whether it is stale. Do not
 * compute this from `StageState.done`, which is
 * `status === "done" && isCurrent(step)` — a glossary that exists and is out of
 * date is `done: false` and is *still what a visitor reads*.
 */
export interface PublicArtefacts {
  arc: boolean;
  tweets: boolean;
  glossary: boolean;
  ideas: boolean;
  quotes: boolean;
  /**
   * **The sixth, since 2026-09-04.** Timeline was owners-only by decision
   * rather than by cost — `GET /api/timeline/:slug` is a plain read of one
   * `jsonb` column and the only paid step is generating it — and Greg asked for
   * it on a shared link.
   * docs/plans/260904c-more-modes-on-a-shared-link.md.
   */
  timeline: boolean;
  /**
   * **The seventh, and the only one that is a picture somebody paid for.**
   *
   * Greg, 2026-09-04: *"We're now going to share the Diagrams, though only
   * Sketch will be visible to those without Experimental Features"* — and,
   * asked whether that meant a visitor could *draw* one: **an already-drawn
   * Sketch only.**
   *
   * That distinction is the whole of why this flag exists. Every other artefact
   * here is cheap to be wrong about; a Sketch costs about $0.20 and two to
   * three minutes, so *is there one* has to be a fact in the payload rather
   * than something a visitor's client discovers by asking. With the flag, a
   * visitor either sees the drawing or is told nobody has made one — and there
   * is no state in which their browser can start the job.
   * docs/project/security-map.md § the hazard this section is really about.
   */
  sketch: boolean;
}

export interface ArticleSharing extends VisibilityState {
  /**
   * **Which artefacts were written for this reader's profile**, by step name.
   *
   * The confirmation dialog names them. GPT Sol's improvement on the plan's
   * first draft, 2026-08-27: *"the confirmation dialog should name which of this
   * document's artefacts were generated with a profile"*, rather than warning in
   * general — which turns a sentence nobody reads into a specific fact about the
   * thing being shared.
   *
   * Non-null `profileHash` is what decides it, and only four artefacts can carry
   * one: `tweets`, `glossary`, `ideas` and `sketch`. The tree and the arc
   * deliberately do not vary by profile — a reader-specific tree is one that
   * shifts under a reader who edits their box (reader-profile.md) — and
   * `fetch`, `extract` and `blocks` have no model call to personalise.
   *
   * **Only artefacts that EXIST may be listed, and that is a requirement rather
   * than an accident of how it is computed.** An artefact never generated cannot
   * have been personalised, and listing one would have the dialog name a
   * glossary that is not there. It falls out of reading `profileHash` off the
   * stored document — no document, no hash — but it is written down here because
   * that is the kind of property a refactor drops silently.
   *
   * **Names, not sentences.** `["glossary", "ideas"]`, and the client turns
   * them into prose: docs/project/copy.md puts every reader-facing sentence in
   * `src/messages.ts`, and one built on the server would be the first in this
   * app written outside it.
   *
   * `[]` means none were, and it is unambiguous **because it only exists inside
   * this block** — see `ArticleMetadata.sharing`.
   */
  personalised: StepName[];

  /**
   * **Which artefacts a shared link would actually carry** — the same five
   * booleans a visitor's own page is keyed on.
   *
   * Here so that the confirmation dialog can list what goes out instead of
   * gesturing at "the whole extracted text", and so that it lists it from the
   * one function that already decides — `visitorGap` in src/web/visitor.ts,
   * swept by `sharedInventory` in src/web/shared-inventory.ts. An inventory
   * written out beside that function would be a second answer to a question
   * already decided, which is how the dock tooltip and the band sentence drifted
   * apart in August.
   *
   * **Not derived from `stages` on the client, and that is the point of the
   * field.** `StageState.done` means *ran, and would not be re-run today*; this
   * means *the column is not null*. They disagree exactly when an artefact is
   * stale — which is a state in which the owner is sharing a glossary that
   * `done` calls absent. See `PublicArtefacts` above.
   *
   * Inside this block rather than on `ArticleMetadata` for the reason
   * `personalised` is: absent means *this store cannot say*, and the filesystem
   * store says nothing at all.
   *
   * **Optional, and it was required for an hour on 2026-09-02.** Requiring it
   * made `asArticleSharing` reject a whole body over one field, which takes the
   * switch away and draws *"we could not check who can read this"* about a
   * `visibility` that arrived perfectly well. That is the wrong blast radius: a
   * missing inventory is a reason to draw no inventory, not a reason to stop an
   * owner unsharing their article. Caught by `tests/metadata-sharing-card.test.tsx`,
   * which is exactly the older shape a bug would produce.
   *
   * So absence is the same honest state it is one level up, and the rule the
   * client keeps is the narrow one: **the list is drawn only from five real
   * booleans, never from a default.** A `false` invented for a missing key
   * would tell an owner their glossary stays private, which is the sentence
   * this whole field exists to stop being guessed at.
   */
  available?: PublicArtefacts;
}

/** What GET /api/metadata/:slug returns: which stages have run, and nothing the article payload already carries. */
export interface ArticleMetadata {
  slug: string;
  /** Where the artefacts actually are, repo-relative — `example` for the fixture. */
  dir: string;
  /** In pipeline order — `STEP_ORDER` in src/step-order.ts. */
  stages: StageState[];
  /**
   * How many questions have been asked about this article.
   *
   * A count and not the comments themselves, and that distinction is the whole
   * point: the metadata page must NOT fetch the comments (docs/plans/260825e-metadata-page.md
   * § The shell — `useComments` fetches on mount, so sharing it would buy a
   * drawer nobody opened). But this endpoint is already walking this article's
   * directory, so one more read answers "7 questions asked" for free, and the
   * page gets the line its plan sketched without paying for the drawer.
   */
  comments: number;
  /**
   * The reader's "about you" and "why this one" boxes — docs/plans/260826t-reader-profile.md.
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

  /* ---- sharing. docs/plans/260827ai-public-read-only-access.md § Stage 1 ---- */

  /**
   * **Who may read this and what was written for you — or absent, on a store
   * that cannot say.**
   *
   * Added 2026-08-28, and it closes a real hole in stage 1a rather than a
   * nicety: the owner's Access & Sharing card had nothing owner-facing to read,
   * so it was asking the public metadata endpoint anonymously — the only
   * non-mutating question available to it — and **that endpoint could not tell
   * *private* from *no such article***. (That endpoint was itself deleted on
   * 2026-09-02; this field is what replaced its misuse.) Both are 404, deliberately, so a
   * stranger learns nothing about what exists. The card was drawing "we could
   * not check" because it could not honestly draw anything else.
   *
   * On this response rather than a second endpoint because the card lives in
   * Metadata, this route is owner-only by construction, and the Postgres read
   * already has everything in hand: `currentRevisionQuery` selects `articles`
   * whole (where `purpose` and `archivedAt` come from), and the `metadata`
   * projection already carries all four artefacts that can hold a
   * `profileHash`. No new query and no widening of `REVISION_READ_POLICY`.
   *
   * ## One block, not three optional fields
   *
   * This is the shape trap, and it is why `personalised` is in here rather than
   * arriving later as a second optional. On its own, `personalised?: StepName[]`
   * has `[]` meaning *none were personalised* and `undefined` meaning *we could
   * not tell* — and one `?? []` anywhere flattens the second into the first, so
   * the dialog would tell an owner *"nothing here was written for your reader
   * profile"* about an article it knows nothing about.
   *
   * Inside a block it cannot happen: **the block being present is the store
   * saying it can answer**, so `personalised: []` is unambiguous. And "cannot
   * say" has exactly one cause — the filesystem store has no column and no
   * artefacts to read a hash off — so it is one fact about the store rather than
   * three independent unknowns. Two optionals would also admit a state where
   * visibility is known and personalisation is not, which cannot occur and which
   * the client would still have to branch for.
   *
   * ## Why absent rather than a default
   *
   * The filesystem store has no `visibility` column and nowhere to put one, so
   * it cannot answer. The first version of this was required and that store
   * reported `private`, on the reasoning that nothing *can* be shared there so
   * `private` is the truth.
   *
   * That was wrong, and the argument against it is the one `requirePostgres`
   * already makes on the public route: a store with no honest answer must
   * **refuse to answer** rather than supply a plausible one. A required
   * `private` is a claim the store is in no position to make, and the card
   * would have drawn *"Only you can read this"* — confidently, and with no way
   * to be right — over every article in development.
   *
   * Absent means *this store cannot say*. The card keeps its existing "we could
   * not check" state, which is true, and nothing throws — a read must not refuse
   * the way `visibilityStore.set` does, or the whole Metadata page goes down in
   * dev to be principled about a field nobody can set there.
   * docs/reusable/silent-success.md.
   */
  sharing?: ArticleSharing;
}

/** A source the model consulted, from OpenRouter's `annotations`. See src/explain.ts. */
export interface Citation {
  url: string;
  title?: string;
}

/**
 * **The same source, plus the words the search engine actually returned with
 * it** — for the one caller that has to check a claim against them.
 *
 * ## Why this is not just a wider `Citation`
 *
 * It was, in the first draft of docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md,
 * and that draft claimed existing callers would be unaffected. They would not:
 * `collectCitations` (src/openrouter-stream.ts) is shared by **chat**, whose
 * citations are written wholesale into `chat_messages` (src/store/pg-chat.ts),
 * by **explain**, whose citations persist on a comment, and by **Referee
 * Criteria**. Adding an `excerpt` to `Citation` adds no line to any of those
 * three and changes what all three store: a few kilobytes of somebody else's
 * web page, per citation, per answer, for ever, for three features that never
 * asked for it and show nothing from it. A field nobody reads is not free when
 * the thing it grows is a stored row. Found by a GPT Sol plan review (F5),
 * 2026-09-05.
 *
 * So the extract is **opt-in at the collector**, not at the type: a caller that
 * wants it asks `collectSearchEvidence` for it, and a caller that does not
 * cannot acquire it by accident. `Citation` stays two fields.
 *
 * ## What the excerpt is for, and what it is not
 *
 * It is *evidence about the relationship*, which a URL alone cannot give. The
 * Stage 0 probe asked for responses to an invented blog post and got nine real,
 * correctly-cited pages, none of them a response to anything
 * (docs/plans/260905f-debate-mode-stage-0-spike-results.md § 4) — so a URL from a live
 * search proves the link and says nothing about whether the page answers the
 * article. Checking a quote against these characters is what closes that.
 *
 * It is **not** a summary and must never be shown as one: it is a slice of a
 * third party's page, chosen by a search engine, and it goes on screen as text
 * and never as markup.
 *
 * `excerpt` is optional because the wire's `content` is: it is absent under
 * some engines and on some rows, and a caller that requires it must say so
 * itself rather than reading `""` as "the page said nothing".
 */
export interface SearchEvidence {
  url: string;
  title?: string;
  /** The search result's own extract of the page, capped — see `MAX_EVIDENCE_EXCERPT`. */
  excerpt?: string;
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
/**
 * **How far the reader's microphone is from their mouth**, and the one fact
 * OpenAI's realtime noise reduction wants.
 *
 * Here, in the types both halves share, rather than in either half — because
 * both halves need it and they are on opposite sides of a wire. `src/live.ts`
 * maps it onto `near_field` / `far_field`; `src/web/live/mic-placement.ts`
 * guesses it from the device's own label and offers the reader the choice; and
 * the route between them validates the string against `MIC_PLACEMENTS` rather
 * than casting it.
 *
 * It was declared twice, once at each end, for about a day. Two copies of a
 * two-member union do not drift *visibly*: a third member added at one end
 * type-checks at that end, crosses the wire, and is read by the other end as a
 * value its own `Record` has no key for — `undefined`, spread into the request
 * as a missing field, which OpenAI accepts by ignoring. The whole feature would
 * then be silently off. `src/live.ts` cannot be imported by the browser (it
 * holds the OpenAI key path and pulls in `converse.ts`), so this file is the
 * only place the two can meet.
 */
export type MicPlacement = "headset" | "laptop";

/**
 * The same two, as a value, so a route can check a string off the wire against
 * the type rather than trusting it. `satisfies` ties the list to the union: add
 * a member to one and the compiler asks for the other.
 */
export const MIC_PLACEMENTS = ["headset", "laptop"] as const satisfies readonly MicPlacement[];

/** Is this string one of ours? The gate every wire-read placement goes through. */
export function isMicPlacement(x: unknown): x is MicPlacement {
  return typeof x === "string" && (MIC_PLACEMENTS as readonly string[]).includes(x);
}

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

  /**
   * The reader's own words about this passage.
   *
   * Absent on a bare bookmark — the reader marked the words and wrote nothing —
   * and absent on every explanation made before 2026-08-28, when a comment was
   * a question you paid for rather than a mark you made.
   *
   * **Absent, never `""`.** The route trims once and drops an empty string, so
   * "they wrote nothing" has one representation rather than two that compare
   * unequal across the two stores. Reader prose: never logged, never in a URL,
   * rendered as text. docs/plans/260828a-comments-and-bookmarks.md.
   */
  body?: string;
  /** ISO. Present only once the body has been edited since it was made. */
  updatedAt?: string;
  /**
   * The conversation this comment started, if the reader ticked the box.
   *
   * **Advisory, and deliberately not a foreign key** — see the plan for why the
   * reflex to add one is wrong here. A thread the reader has since deleted
   * leaves this pointing at nothing, which is benign: the comment is still
   * their mark on the passage, and whoever offers "Open chat" checks the thread
   * is really there first, exactly as `?thread=` already has to.
   */
  threadId?: string;

  /**
   * **Which referee criterion this note is answering** — absent on an ordinary
   * reading note, which is every comment written before 2026-08-31.
   *
   * The referee's own mark **is a comment**: their words, anchored to a
   * passage, in the store that already has the anchoring discipline, the
   * gutter, the API and the export. It also answers, better than a boolean
   * would, how to tell a review comment from a reading note — a comment with a
   * criterion is a review comment, one without is a reading note.
   *
   * The route refuses an id that is not one of this reader's criteria on this
   * article, and `comments_criterion_fk` refuses it again
   * (docs/project/database.md § `restrict` and `no action`).
   */
  criterionId?: string;

  /**
   * **The referee's own placement of this passage on that criterion's scale**,
   * −100…+100, integer, and signed. Absent when they wrote prose and did not
   * score it, which is the ordinary case.
   *
   * **This is not the model's valence and must never be reconciled with it.**
   * The model's lives on a `DivergingResult` in a criterion's `results`; this
   * one is the person's. The whole value is in the gap — a passage the referee
   * put at +70 and the model at −40 is a disagreement about the paper, and it
   * is the row worth opening. `valenceGap` in src/referee-criteria.ts.
   *
   * **And it is not a confidence.** `SearchHit.confidence` is a 0–100 match
   * strength whose validator clamps negatives to zero, so a placement routed
   * through anything shaped like one arrives as `0` — "no strong feeling" —
   * and every negative judgement the referee made is gone with nothing to see.
   * That failure is the reason this is its own field with its own clamp
   * (`clampValence`), and the reason the route validates it with `markProblem`
   * rather than with anything that touches a confidence.
   *
   * Never without `criterionId`: a placement with nothing to place it on is a
   * number against nothing, and `comments_valence_needs_criterion` says so in
   * the database as well.
   */
  valence?: number;

  /**
   * How the *model call* went, and only that.
   *
   * `none` is every comment made from 2026-08-28: no call was ever attempted,
   * which is what a bookmark is. The other three keep the meaning they had —
   * `pending` is written before the call, so a crash is visible rather than
   * silent. A separate "kind" field would be worse: a body, a legacy answer and
   * a linked chat are independent properties, not exclusive kinds.
   */
  status: "none" | "pending" | "done" | "error";
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
 * One stage of the pipeline. Ordered by `STEP_ORDER` in src/step-order.ts.
 *
 * `tweets` and `glossary` are in that order but **not** in
 * `DEFAULT_INGEST_STEPS` — they are steps you can ask for by name, not ones a
 * plain "add this URL" runs. Each costs model calls over the whole article and
 * each belongs to a page or a mode you have to go to. See
 * docs/plans/260825g-tweet-thread-page.md#the-one-real-snag-stated-precisely and
 * docs/project/glossary.md.
 */
export type StepName =
  | "fetch" | "extract" | "blocks" | "hierarchy"
  /* The per-paragraph navigation labels, which left the `hierarchy` step on
     2026-09-06 because they were 79.5–92% of its wall clock and one measured
     call took 602s of a 682s pass — past what the job lease allows.
     `hierarchy` now writes a `PendingLabelsFile` (src/labels.ts) and this step
     writes the real one, later, in a free successor job. **It is deliberately
     NOT in `DEFAULT_INGEST_STEPS`**, which is the whole of the change.
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md. */
  | "labels"
  | "assets" | "arc" | "tweets" | "glossary"
  /* The lines worth keeping, in the article's own words — docs/project/quotes.md.
     Beside `glossary` because the two send byte-identical article bytes at the
     same effort and share one cached prefix. */
  | "quotes"
  | "ideas"
  /* When the things the piece narrates happened, and how sure it is —
     docs/project/timeline.md. Beside `ideas` because the two send byte-identical
     article bytes at the same effort and share one cached prefix, the same
     reason `quotes` sits beside `glossary`. */
  | "timeline"
  /* The questions the piece can ask you back, the second sub-mode of Remember —
     docs/plans/260831al-review-quiz-sub-mode.md. Beside `ideas` and `timeline`
     for the third time and the same reason: `articleWithIds` at `high` effort,
     so all four share one cached article prefix and `STEP_ORDER` keeps them
     contiguous. */
  | "quiz"
  /* The picture a model draws of the argument — docs/project/diagram.md § Sketch.
     Nothing reads what it writes except the one below. */
  | "sketch"
  /* The same argument painted, docs/project/diagram.md § Illustrated. **The only
     step here whose input is another step's artefact rather than the article**,
     so it is last in `STEP_ORDER` and it *refuses* rather than pulls: a request
     for it alone arrives as `steps: ["illustrated"]` and nothing puts `sketch`
     in front of it. src/pipeline.ts § illustrated. */
  | "illustrated"
  /* **What the rest of the web says about this piece** — docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
     The only step whose content is not in the article at all: it runs two
     metered web searches and returns pages that answer the piece, or the claims
     it makes.

     **It is deliberately NOT an `ArticleStage`** (src/models.ts). That type is
     the subset of these names that share a byte-exact cached article prefix on
     the Messages wire; this step is on chat/completions, shares no such prefix,
     and therefore takes no row in `STAGE_EFFORT` or `ARTICLE_RENDERER` and none
     in `cacheArticleForStep`. Stated here because new-mode.md lists both tables
     among the ones the compiler asks for, and a reader will otherwise go
     looking for the missing rows. */
  | "debate"
  /* **Every work the piece cites, linked** — docs/plans/260911g-citations-mode.md.
     One Messages-wire call over the whole article, bibliography and notes
     included, and a link derived by code from the article's own hrefs.

     **Deliberately NOT an `ArticleStage`** either, for a different reason from
     `debate`'s: it is on the Messages wire, but it sends `articleWithIds` over
     *every* block — the notes and the bibliography are the whole point — where
     `ideas`, `timeline`, `quiz` and `sketch` send the body only. Different
     bytes, so no shared cached prefix, so no row in `STAGE_EFFORT` or
     `ARTICLE_RENDERER`; its effort is a constant in src/citations.ts. */
  | "citations";

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
   * the identical call and failed identically (docs/postmortems/260826a-toc-max-tokens.md).
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
   * **How many extra lease windows this job has been given** — so the card can
   * say which attempt it is on rather than looking stalled.
   *
   * Two mechanisms increment it and they share the one counter: a lapsed claim
   * that `settleExpired` put back in the queue, and a claimant that ran out of
   * its own deadline mid-step and handed the job back (`pauseForDeadline`,
   * src/store/jobs.ts). `REQUEUE_BUDGET` in src/jobs.ts caps the total, so this
   * never exceeds it — three windows in all, counting the first.
   *
   * **Absent means zero**, which is nearly every job. It crosses `publicJob`
   * deliberately: it is a fact about the machine's own retrying, not about the
   * reader, and a job that has quietly restarted twice is exactly the thing a
   * person watching a long PDF wants to be told.
   *
   * **Nothing renders it yet**, said out loud because the sentence above is
   * about what it is *for*. The field is on the wire; what a card should say
   * about it is a copy decision with two renderers behind it (src/job-state.ts,
   * and `JobCard` against `JobProgress`) and is Greg's to make.
   *
   * Postgres reads it off `jobs.requeues`. The filesystem adapter keeps the
   * *budget's* count in memory — a restart empties it, deliberately, because a
   * restart there is `sweepStopped`, which requeues everything with no budget at
   * all — and writes this field alongside so the two stores hand the client the
   * same shape. src/store/jobs-fs.ts says the rest.
   */
  requeues?: number;
  /**
   * Who is reading, already rendered — `renderProfile` in src/profile.ts.
   *
   * On the job rather than in a step's own options, for two reasons: the queue
   * is what survives a restart, and a job resumed from disk with its profile
   * dropped would run the plain prompt, report success, and stamp the artefact
   * with a `profileHash` describing a profile it did not use. (A free-text
   * `guidance` steer used to ride here for the same reasons; it is gone —
   * docs/plans/260830o-steer-becomes-the-profile.md.)
   *
   * And a third that is its own: **it is frozen here.** A step can be several
   * batched calls at once; reading the profile inside each one would let a
   * reader who edits their box mid-run get one artefact written from two
   * profiles. src/jobs.ts § sameWork keeps two differently-profiled requests
   * two different jobs.
   */
  profile?: string;
}

/* ------------------------------------------------------------------ chat --
   A conversation about one article. Reader state, so it lives beside the
   article in `data/<slug>/chat.json` exactly as comments.json does.

   See docs/plans/260826a-chat-mode.md, and note the one rule that separates this from
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
   * **At least one provider round hit its output limit after writing prose**, so
   * the answer may be incomplete. Assistant turns only.
   *
   * `finish_reason: "length"` with text already written — which used to be
   * stored as an ordinary `done` answer, so a paragraph that stopped halfway
   * through a word looked like a model that had simply finished oddly. The
   * reader had no way to tell it apart from a complete answer, and "retry"
   * was not obviously the thing to do.
   *
   * **"May be" rather than "did", and that first line was reworded on
   * 2026-09-05.** It used to say *"ran out of room mid-sentence"*, which claims
   * more than any wire signal can support. A turn is up to four provider
   * requests; since the fold in `src/converse.ts` this is true when an *earlier*
   * round hit its ceiling after writing prose, and that round's prose can
   * perfectly well have ended at a full stop with the truncation falling in the
   * tool call after it. What is certain is that a step was cut off and content
   * was lost; whether the stored text ends mid-sentence is not observable from
   * `finish_reason`. GPT Sol, finding F6, with the reproduction in that review.
   *
   * **The panel's own sentence still says "stopped mid-sentence"**
   * (`src/web/ChatPanel.tsx`), so it overclaims in that case. Changing what a
   * reader is shown is Greg's call, not an agent's — see
   * docs/project/copy.md — and it is written down here rather than quietly left.
   *
   * A flag rather than a status, for the same reason `stopped` is one: the
   * answer above it is real and worth keeping. Unlike `stopped`, this one **is**
   * a failure of ours — the reader did not ask for it — so the panel says so in
   * a way that offers the retry. See docs/project/chat-tools.md.
   */
  truncated?: boolean;
  /**
   * **Passages the model pointed at instead of citing in its words.** Assistant
   * turns only, and in practice live-conversation turns only.
   *
   * A typed answer puts block ids in its text — `[spya-k3m9qt]` — and
   * src/web/Cited.tsx makes them pressable. A **spoken** answer must not: read
   * aloud an id is six seconds of gibberish, so the live prompt forbids saying
   * one and gives the model a `show_passage` tool instead
   * (docs/plans/260831g-live-conversation.md).
   *
   * That leaves the pointing with nowhere to go, and storing only the
   * transcript would produce **uncited assistant claims** — the exact failure
   * chat's citation contract exists to prevent. So the pointers become a field.
   *
   * **Not folded into `citations`**, which is a *web* citation and is shared
   * with `Comment.citations`: widening it to "maybe a url, maybe block ids"
   * hands every consumer a branch. And **not spliced into `text`**, which is
   * both the transcript and the model's history — ids in there would stop the
   * transcript being what was said, and would then be fed back to a voice model
   * as examples of itself doing the one thing it is told never to do.
   * Recommended by Fable, 2026-08-31.
   *
   * **Absent, not `[]`, on an answer that pointed at nothing** — the same rule
   * `tools` gives above, and what `tests/store-roundtrip.test.ts` compares.
   */
  passages?: { blockIds: string[]; why: string }[];
  /**
   * **A spoken answer ended early**, through interruption, hangup or provider
   * failure. Assistant turns only. Its partial transcript remains readable,
   * with an explanation that it may contain words never heard; it must not
   * appear to be a complete answer or claim the reader caused the interruption.
   *
   * Unlike a typed `stopped` answer, the realtime transcript is not corrected
   * to match played audio. `recentHistory` in src/converse.ts therefore drops
   * the pair from model history rather than feeding unheard or unfinished
   * words into the next turn. There is no automatic retry or invented text.
   */
  interrupted?: boolean;
  /**
   * When the reader last rewrote this message. User turns only.
   *
   * Editing a question discards every turn after it and asks again, so this is
   * the only trace that the conversation above once went somewhere else. The
   * old text is **not** kept — see docs/plans/260826a-chat-mode.md § Editing a question.
   */
  editedAt?: string;
  /**
   * Which stance produced this answer. **Assistant turns only, Remember threads
   * only** — absent on every chat answer and on every user message.
   *
   * Written when the *pending* row is created, never when it finishes, and that
   * is the whole rule. An answer that crashed, errored, was stopped, or was
   * buried by the sweep still has to say which instruction produced the words
   * that did arrive — and a retry of that row has to have something to inherit.
   * Writing it in `finishTurn` would leave every one of those rows blank.
   *
   * See docs/plans/260827ah-review-mode.md § Where the stance picker's value lives.
   */
  stance?: RememberStance;
  /**
   * **The reader pressed the "?" beside a paragraph rather than typing this.**
   * User turns only.
   *
   * Report 1R asked for *"simple type-metadata … to indicate it was a
   * request-for-explanation"*, and this is it: the answer is written with an
   * extra pedagogical instruction (`helpSection` in src/converse.ts), and
   * "how many explanations were asked for" becomes a query over message rows.
   *
   * **On the message, not on the thread**, and that is the whole design.
   * `docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md`
   * refused a fourth `ThreadKind` — a help conversation is an anchored chat, and
   * keeping it one is what lets the reading view go on treating every mark it
   * draws as a chat. The first draft of 1R put a `from_help` on `chat_threads`
   * instead; GPT Sol's review moved it here, because a thread-level flag has to
   * be *refused* on retry and edit (neither creates a thread) and a refused flag
   * means pressing "Try again" on an explanation is silently answered with the
   * ordinary prompt. Here `withRetry` hands the stored question back and
   * `withEdit` spreads it, so all three paths agree without anyone arranging it.
   *
   * `true` or absent, never `false` — the same rule `stopped` and `interrupted`
   * follow above, and what tests/store-roundtrip.test.ts compares. It is the
   * mirror of `stance`, which lives on the assistant row: one says how the
   * answer was asked for, the other how it was written.
   */
  help?: true;
}

/**
 * How much the model should say in a Remember answer — the reader's choice, per
 * turn.
 *
 * Greg named all four, 2026-08-27. `balanced` is the default and is not an
 * average of the other three: it decides per point, on evidence, and defaults
 * to telling when it cannot tell. docs/plans/260827ah-review-mode.md § The stance.
 */
export type RememberStance = "balanced" | "respond" | "socratic" | "signposts";

/**
 * The four, as a value.
 *
 * **One list, used by the route's validation and by the client's picker**, so a
 * fifth stance cannot be accepted by the server and missing from the menu, or
 * offered in the menu and rejected by the server. The same trick `MODES` plays
 * in src/web/params.ts.
 */
export const REMEMBER_STANCES: readonly RememberStance[] = [
  "balanced",
  "respond",
  "socratic",
  "signposts",
];

/**
 * What a conversation is *for* — a question about the article, or the reader
 * saying what they took from it.
 *
 * **Required, not optional**, and normalised to `"chat"` when a stored thread
 * predates this field. An optional kind means a `?? "chat"` at every read site
 * and one of them will eventually be missed — which is a Remember thread answered
 * with chat's prompt, and nothing on screen disagreeing. GPT Sol's review of
 * docs/plans/260827ah-review-mode.md, 2026-08-27.
 *
 * A thread's kind is set on the turn that creates it and never again, exactly
 * like its `anchor`. See docs/plans/260827ah-review-mode.md § `kind` belongs to the
 * thread.
 *
 * **This value is persisted, so renaming it was a migration and not an edit.**
 * The mode was called Review until 2026-09-01, and `chat_threads.kind` carried a
 * CHECK constraint `kind in ('chat','review')`. Narrowing a CHECK before the rows
 * move fails every Remember insert with `23514`, so the discriminant, the schema
 * and the data moved in one step: drizzle/0048_rename_review_thread_kind.sql
 * drops the constraint, updates the rows, then re-adds it with `'remember'`.
 * Anything else that speaks this wire value — `src/routes.ts`'s validation, the
 * export/import shapes, the committed fixture corpus — moved with it.
 * docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md § Stages.
 *
 * **`candidates` is the third**, added 2026-09-01 — Referee mode's fourth
 * sub-mode, which Greg asked to be *"a special reuse of Chat mode, to get
 * access to tools and make it interactive"*. It is a third personality on this
 * one machinery rather than a panel of its own: a system prompt branch in
 * src/converse.ts and a shortlist parsed out of the transcript
 * (src/referee-candidates.ts). **Widening** the CHECK is the safe direction that
 * the rename above was the dangerous one — Postgres validates a re-added CHECK
 * against the rows already there, and every existing row satisfies a wider one —
 * so drizzle/0050_candidates_thread_kind.sql is a drop and a re-add with no data
 * movement between them. docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4.
 */
export type ThreadKind = "chat" | "remember" | "candidates";

/**
 * The three, as a value, and the predicate both ends validate with.
 *
 * **One list**, for the reason `REMEMBER_STANCES` below gives about itself and
 * for one more that is specific to this field: the default lives in *two*
 * normalisers, one per store (`normaliseKind` in src/chat.ts and its twin in
 * src/store/pg-chat.ts), and both coerce anything unrecognised to `"chat"`. A
 * fourth kind added to the union and missed in either of them is a thread that
 * silently becomes a chat on its next read — answered with chat's prompt, with
 * nothing on screen disagreeing, which is the failure the `kind` field was
 * introduced to prevent. Since both call `isThreadKind`, adding a member is one
 * edit rather than four.
 */
export const THREAD_KINDS: readonly ThreadKind[] = ["chat", "remember", "candidates"];

/** Is this one of the three? Used by both stores' normalisers and by the route. */
export function isThreadKind(value: unknown): value is ThreadKind {
  return typeof value === "string" && (THREAD_KINDS as readonly string[]).includes(value);
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
 * See docs/plans/260826ab-chat-as-gateway.md § A thread can have an anchor.
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
  /**
   * A question about the article, or the reader saying what they took from
   * it. See `ThreadKind`.
   *
   * **Set on the turn that creates the thread and never again**, the same rule
   * as `anchor` two fields up and for a sharper reason: it chooses the system
   * prompt, so a thread that changed kind halfway would have a transcript whose
   * first half was answered by one set of instructions and second half by
   * another, with nothing anywhere saying so.
   *
   * Required rather than optional. Both stores normalise a stored thread with
   * no kind to `"chat"` as they load it, so the default lives in exactly two
   * places instead of at every read.
   */
  kind: ThreadKind;
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
 * real thing. See docs/plans/260826ab-chat-as-gateway.md § The reading view gets thread
 * summaries.
 */
export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  anchor?: ChatAnchor;
  /**
   * Chat or Remember — which the reading view needs even though it draws no
   * Remember marks.
   *
   * `?thread=` opens the floating `ChatDialog` in every mode but the two
   * conversation modes, and that dialog is chat's UI and asks with chat's
   * prompt. A pasted `?mode=toc&thread=<a Remember thread>` would therefore
   * continue a Remember conversation as a chat. The overlay is gated on this
   * instead. See
   * src/web/reader/Reader.tsx § overlay, and GPT Sol's review of
   * docs/plans/260827ah-review-mode.md, finding 7.
   */
  kind: ThreadKind;
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
   * it as `TweetThread` and `Glossary` carry.
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

  /**
   * **The palette slot the reader picked for this search** — absent means
   * "whichever one the hash gives it".
   *
   * Greg, 2026-08-27: *"In Search mode, I'd like to be able to change the
   * colour for a given row."* Until then every colour was derived, and
   * src/web/hit-colours.ts said in as many words why it should stay that way:
   * storing one *"means a schema change, a migration, and a server that has an
   * opinion about the palette — for a value that is derived."* Two thirds of
   * that objection stand and have been paid; the third one does not apply any
   * more, because a colour the reader chose is not derived from anything. The
   * argument was never against the field, it was against storing a value
   * nobody had an opinion about.
   *
   * **A number, and the server has no idea what colour it is.** That is the
   * one part of the old objection this field is still careful about: the hues
   * live in styles/colourscales.css, the slot-to-hue step happens in the
   * browser, and this column could hold a 5 for a palette that has not been
   * designed yet. The server checks only that it is a small non-negative
   * integer (`isStorableColour`, src/searches.ts); a value past the end of the
   * palette is ignored by `assignSlots` and the row falls back to auto, which
   * is what a shrinking palette should do rather than paint nothing.
   */
  colour?: number;
}

/* --------------------------------------------------------------- timeline --
   When the piece says these things happened — `data/<slug>/timeline.json`, and
   a **mode** in the band after the ideas. See docs/plans/260831i-timeline-mode.md.

   ## Why these are here and not in src/timeline.ts, where they were written

   Because the client cannot reach that file. `tests/client-imports.test.ts`
   lets `src/web/` import exactly the pure leaves in its `SHARED` list, and
   `src/timeline.ts` is a stage with a CLI and a model call in it. So the panel
   physically cannot see `TimelineEvent` unless the shape both sides speak lives
   in a module that imports nothing — which is what this file is, and which is
   the outcome that test's own header records from the last time somebody hit
   this (`EmbeddingReason` moved here rather than the rule being relaxed).

   Stage 3 added them here while src/timeline.ts and src/timeline-time.ts still
   carried their own copies, because it needed them a stage early and could not
   edit a file another session was holding. **Stage 4 deleted those copies**, so
   this is the one declaration; both of those files now import from here and
   re-export, so a caller of the stage still only has to know about the stage.

   `WhenDirection` is deliberately NOT here. It is an input to the parser — which
   way a year-less date resolves off the publication day — rather than anything
   in the artefact or on the wire, so it stays in src/timeline-time.ts with the
   function that reads it.  */

/**
 * What kind of thing this is: something the piece narrates, something it
 * forecasts, or something it entertains and says did not happen.
 *
 * Predictions and hypotheticals sort after everything that happened. They share
 * that partition **without sharing a tense** — the test article's only
 * hypothetical is a counterfactual about the past, so `WhenDirection` in
 * src/timeline-time.ts resolves it backwards and the prediction forwards.
 */
export type TimelineModality = "happened" | "predicted" | "hypothetical";

/**
 * Why no date came back. Three of these are rejections the panel has a sentence
 * for; `noDateInPhrase` is deliberately not one — the article simply did not
 * date the event, which is a correct answer and the second commonest one.
 */
export type WhenRefusal =
  | "noDateInPhrase"
  | "unparseablePhrase"
  | "phraseNotInOccurrence"
  | "noYearFrame";

/**
 * The refusals that are a **rejection** — we could not read a date the piece
 * plainly gives. Named so `src/messages.ts` can key an exhaustive record on it:
 * each one is a different sentence, and `noYearFrame` in particular says
 * something about *us* rather than about the article.
 */
export type DateRejection = Exclude<WhenRefusal, "noDateInPhrase">;

/**
 * When something happened, as an interval the article's own words support.
 *
 * Both ends independently nullable, which is what carries a bound rather than a
 * point: "by 4 July" is `{ earliest: null, latest: "2026-07-04" }`. Five of the
 * test article's twenty-four expressions are that shape.
 *
 * **ISO strings end to end, never `Date` objects** — a timezone moves a
 * calendar day, and the calendar day is the whole content here.
 */
export interface When {
  /** Earliest this could have been. null = unbounded below ("by 4 July"). */
  earliest: string | null;
  /** Latest this could have been. null = unbounded above ("after that"). */
  latest: string | null;
  /** Does the event FILL this interval, or sit somewhere inside it? */
  extent: "instant" | "extended";
  /** The article's own words, sliced out of the block — not the model's copy. */
  phrase: string;
  /** Where in the block `phrase` sits, so the reader can go and check. */
  at: { blockId: BlockId; start: number; end: number };
  /** True when the parser supplied the year from the publication date. */
  yearFilled: boolean;
}

/**
 * **Which of the four things happened to this event's date.**
 *
 * A union rather than `when: When | null` plus flags, so the panel switches on
 * one field and the impossible combinations cannot be spelled. The middle two
 * are the pair most easily collapsed and must not be: a piece that said
 * "another month later" has dated the event as far as it ever will, and drawing
 * a blank there loses the only thing it told us.
 */
export type Dating =
  /** The parser read a date out of the article's own characters. */
  | { kind: "dated"; when: When }
  /** The article's temporal words, carrying no date we can read out of them. */
  | { kind: "words"; phrase: string }
  /** The article puts no time on this at all. A correct answer, and a common one. */
  | { kind: "untimed" }
  /**
   * The piece dates this and we could not read the date. `phrase` is a required
   * nullable rather than an optional, so a caller cannot forget the case where
   * we could not even locate the words.
   */
  | { kind: "rejected"; reason: DateRejection; phrase: string | null };

/** Where in the article this event is mentioned. The same shape `ideas` uses. */
export interface TimelineOccurrence {
  blockId: BlockId;
  /** The article's own characters, sliced at the offsets `findQuote` located. */
  quote: string;
  /** A disambiguator between repeats, never the anchor. */
  start: number;
}

/** An event id. A string like any other id here; named so a signature can say so. */
export type TimelineEventId = string;

export interface TimelineEvent {
  /** `mintId`, so it is a block id by construction and `?event=` validates for free. */
  id: TimelineEventId;
  /** A handle, not a retelling. Under about ten words. */
  label: string;
  /** What the article said about when, and what we could make of it. */
  dating: Dating;
  /**
   * The model's reading of the sequence, and **the sort key** — the dates move
   * nothing. `null` when the model did not number the event, which sorts last
   * within its partition rather than first.
   */
  order: number | null;
  modality: TimelineModality;
  occurrences: TimelineOccurrence[];
}

/** The artefact. `data/<slug>/timeline.json`. */
export interface Timeline {
  version: string;
  generator: string;
  slug: string;
  /** Blocks, tree **and the publication date** — `datedArticleFingerprint`. */
  sourceHash: string;
  /** In the order they are to be shown. **Never re-sorted by a reader.** */
  events: TimelineEvent[];
  /**
   * Pairs where the article's own dates prove an order and the model put them
   * the other way round. Changes nothing on screen and is not shown to a
   * reader; it is the only signal we get that the model misread the chronology.
   */
  orderConflicts: number;
  generatedAt: string;
  elapsedMs: number;
}

/**
 * `GET /api/timeline/:slug`. Two staleness facts and no third: the reader
 * profile is **not** in this stage's stamp, because who is reading does not
 * change when something happened. docs/plans/260831i-timeline-mode.md § Freshness.
 */
export interface TimelineResponse {
  timeline: Timeline;
  /** The article moved underneath this — blocks, sections **or** its date. */
  stale: boolean;
  /** The article is the same and we would write this differently now. */
  outdated: boolean;
}

/**
 * As `ThreadFound`, for the timeline — and here it is the *same* type, because
 * there is no `profileChanged` for a store adapter to leave out.
 *
 * Named rather than skipped so the two adapters agree with their neighbours by
 * shape, and so that the day somebody decides the profile belongs in this stage
 * after all, the `Omit` goes in one place instead of being searched for.
 */
export type TimelineFound = TimelineResponse;

/* -------------------------------------------------------------- citations --
   Every work the piece cites — the `citations` column on `article_revisions`,
   written by the `citations` step. docs/plans/260911g-citations-mode.md.

   Here rather than in src/citations.ts for the reason every artefact's shape
   is: the panel (stage 2) reads them, and a client module may not import a
   stage. src/citations.ts re-exports what it needs.  */

/**
 * Which rule gave a citation its link — drawn on the row, so a reader can
 * always tell an address the article gave from one we went looking for.
 *
 * - `doi`, `arxiv` — an identifier found in the article's own text or hrefs,
 *   turned into `https://doi.org/…` / `https://arxiv.org/abs/…` by code.
 * - `article` — an anchor in the article, chosen because its text matched the
 *   work's title (in the reference) or the mention's own words.
 * - `search` — **not the work's address**: a Google Scholar search for its
 *   title and first author. Every ambiguity lands here, because a link to the
 *   wrong work is worse than a search.
 * - `web` — stage 3, *Find it on the web*; not written by stage 1.
 *
 * **The model never supplies a URL that is stored.** src/citations.ts §
 * `linkFor`.
 */
export type CitationLinkFrom = "doi" | "arxiv" | "article" | "search" | "web";

/**
 * One place the article cites a work, **verified**: the block exists and
 * `quote` was found in its text. `quote` is the article's characters sliced out
 * of the block, never the model's typing — the model's string is a locator.
 */
export interface CitationPlace {
  blockId: BlockId;
  quote: string;
  /** Offset into `block.text`; a disambiguator between repeats, never the anchor. */
  start: number;
}

export interface CitedWork {
  /** `mintUniqueId`, inherited across re-runs by `key`. Stage 3's lookups are keyed on it. */
  id: string;
  /**
   * **The dedupe key, stored so a re-run can inherit the id by it** — `doi:…`,
   * `arxiv:…`, `url:…` (an article-given link), else `work:<title>|<first
   * author>|<year>`. src/citations.ts § `keysOf`.
   */
  key: string;
  /** As the article gives it, ≤ 120 characters. */
  title: string;
  /** As the article gives them. Absent when it gives none. */
  authors?: string;
  year?: string;
  /** One plain sentence: what the piece uses this work for. */
  why: string;
  /** 0–1: how much THIS piece's argument leans on the work. The model's reading. */
  relevance?: number;
  /** 0–1: how influential the work is in its field. **The model's memory**, weaker. */
  influence?: number;
  /** The bibliography / reference-list / note entry, if the article has one. */
  reference?: CitationPlace;
  /** Where the text cites it, ≤ 3. */
  mentions: CitationPlace[];
  /**
   * Every **body** block that cites the work, in document order: body mentions,
   * plus every body block carrying a `data-spya-note-ref` marker for a note the
   * work was found in. Footnote expansion is code's, because the model is shown
   * plain text and cannot see which paragraph a note hangs off.
   */
  citedAt: BlockId[];
  /**
   * Where the row's *first cited* jump goes: `citedAt[0]`, or — for a work the
   * article names only in its bibliography — the earliest block it was found
   * in, with `citedInBody: false`.
   */
  firstCited: BlockId;
  citedInBody: boolean;
  url: string;
  linkFrom: CitationLinkFrom;
}

/**
 * What was thrown away. Counts only — never a title, a quote or a URL. Logged by
 * the step; not on the artefact (a reader cannot act on our prompt's misses).
 */
export interface CitationDrops {
  /** A `{block, quote}` naming a block id that is not in the article. */
  unknownIds: number;
  /**
   * A `{block, quote}` whose quote was not in the named block nor, verbatim, in
   * exactly one other — dropped.
   */
  unquoted: number;
  /**
   * A `{block, quote}` whose quote was not in the named block but was, verbatim,
   * in exactly one other — **moved there and kept**. The model names a
   * neighbouring paragraph often enough (5 of 12 failures on scaling-hypothesis,
   * stage 1) that dropping these lost works for nothing.
   */
  relocated: number;
  /** Mentions past `MAX_MENTIONS` on one work. */
  extraMentions: number;
  /** Works with no verified reference and no verified mention, dropped whole. */
  unanchored: number;
  /** Works with no usable title or `why`, or not an object. */
  malformed: number;
  /** Works past `MAX_CITATIONS`, discarded whole. */
  overCap: number;
  /** Rows folded into another by the dedupe key — a shorthand cite and its full reference. */
  merged: number;
  /** Titles or `why`s longer than their cap, shortened. */
  clipped: number;
  /**
   * Works on which the model wrote a `url`/`link`/`doi` field anyway. **Ignored,
   * always** — counted so a prompt that has started inviting remembered
   * addresses shows up in a run.
   */
  modelUrls: number;
}

/**
 * The 0–1 scores the prompt required and did not get — the twin of
 * `GlossaryScoreDrops` (src/glossary.ts), same absent/rejected split.
 */
export interface CitationScoreDrops {
  relevanceAbsent: number;
  relevanceRejected: number;
  influenceAbsent: number;
  influenceRejected: number;
}

/**
 * The most works one list holds. The prompt asks the model to keep the ones the
 * piece leans on most and to say `capped: true` when it left works out.
 * Here rather than in src/citations.ts because the panel's foot sentence names
 * the number.
 */
export const MAX_CITATIONS = 80;

/** The artefact. The `citations` column on `article_revisions`. */
export interface Citations {
  version: string;
  generator: string;
  slug: string;
  /** `articleWithIdsFingerprint` over every block, the tree and the cited head. */
  sourceHash: string;
  /**
   * In first-cited order — body-cited works by their first body block, then
   * bibliography-only works by their entry. **Fixed at write time.**
   */
  citations: CitedWork[];
  /**
   * **The model said it left works out**, or returned more than
   * `MAX_CITATIONS`. Never inferred from the list's length — the panel's *"this
   * piece cites more than 80 works"* sentence is drawn only from this.
   */
  capped: boolean;
  generatedAt: string;
  elapsedMs: number;
}

/**
 * `GET /api/citations/:slug`. Two staleness facts, like the timeline's: no
 * profile is in this stage's stamp.
 */
export interface CitationsResponse {
  citations: Citations;
  /** The article moved underneath this — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and we would write this differently now. */
  outdated: boolean;
}

/** As `TimelineFound`: the same type, because there is no `profileChanged` to omit. */
export type CitationsFound = CitationsResponse;

/* ------------------------------------------------------------------- quiz --
   The questions the piece can ask you back — `data/<slug>/quiz.json`, and the
   second sub-mode of Remember. See docs/plans/260831al-review-quiz-sub-mode.md.

   ## Why these are here and not in src/quiz.ts, where the stage lives

   The same reason `Timeline` is, one section up: `tests/client-imports.test.ts`
   lets `src/web/` import only the pure leaves in its `SHARED` list, and
   `src/quiz.ts` is a stage with a CLI and a model call in it. A panel that
   cannot see `QuizQuestion` cannot be written, so the shape both sides speak
   lives in this file, which imports nothing, and src/quiz.ts re-exports it so a
   caller of the stage still only has to know about the stage.

   `QuizDropped` is here for the same reason and one more: it is a field ON the
   artefact rather than a return value beside it (unlike `ideas`' and
   `timeline`'s, which are handed back to the CLI and thrown away). A dropped
   question is invisible from outside — it looks exactly like a question the
   model chose not to set — and the metadata page is where somebody would go to
   find out, so the counts have to survive the write.  */

/**
 * **How the answer is reached** — a judgement about the question, not a guess
 * at how a stranger will do.
 *
 * That distinction is the whole reason this is a three-valued band rather than
 * the 1–5 `ease` score the first draft asked for. A spike on a real article
 * (docs/plans/260831al-review-quiz-sub-mode.md § Quotas) measured what a model
 * actually does with an open 1–5 scale: `ease` never left 2–4 across 24
 * questions. A scale whose ends are never used is not a scale, and the sort it
 * feeds is then arbitrary for most of the list.
 *
 * | band | the answer is… |
 * |---|---|
 * | `easy` | stated in one passage, and the reader is recalling it |
 * | `medium` | a distinction or a connection the article draws between two statements |
 * | `hard` | a move the argument makes across several passages, which the reader has to reconstruct |
 */
export type QuizBand = "easy" | "medium" | "hard";

/**
 * **Whether the reader got a question right — judged in private, shown to
 * nobody.**
 *
 * The adaptive ladder steps on this: right, and the next question is harder;
 * wrong, and it is easier (src/web/quiz-ladder.ts).
 * [`src/quiz-verdict.ts`](quiz-verdict.ts) produces it by reading the finished
 * mark, and it rides the terminal `done` frame.
 *
 * **Two values and an absence, not three.** Greg's rule is binary, and a
 * `partly` in the middle would absorb most short-answer responses and leave the
 * ladder stationary while looking adaptive. Absence — `undefined` — is a
 * designed outcome rather than an error: the classifier failed, timed out,
 * declined an ill-posed question, or the mark never finished. It means *hold
 * the band*, so every failure in this feature is quiet.
 *
 * It lives here rather than beside the ladder because both sides speak it: the
 * server puts it on `done`, the client reads it off. docs/project/quiz.md § It
 * adapts, and docs/plans/260907d-make-the-quiz-adaptive.md.
 */
export type QuizVerdict = "right" | "wrong";

/**
 * **Where the reference answer lives — checked, never trusted.**
 *
 * A block id on its own proves only that a paragraph exists; it says nothing
 * about whether the answer is in it. So the model names a quote as well, every
 * quote is relocated with `findQuote`, and what is stored is **the article's
 * own characters** sliced at the offsets it found — never the model's typing.
 * GPT Sol's finding 2 on the plan.
 */
export interface QuizEvidence {
  blockId: BlockId;
  /** The article's own characters, sliced at the offsets `findQuote` located. */
  quote: string;
  /** A disambiguator between repeats, never the anchor. As `IdeaOccurrence`. */
  start: number;
}

/** A question id. Minted per batch; nothing outside the batch names one. */
export type QuizQuestionId = string;

export interface QuizQuestion {
  /** `mintUniqueId`, so it is a block id by construction. Minted per batch. */
  id: QuizQuestionId;
  /** One question mark, one thing asked. */
  question: string;
  /**
   * Two or three sentences of model prose, written **before** any reader's
   * attempt was seen.
   *
   * **A fallible draft, not an answer key**, and the naming is deliberate all
   * the way to the button that reveals it (*"Show a reference answer"*, not
   * *"the"*). The marking prompt is told outright that the article outranks
   * this, and `evals/quiz.ts` poisons one on purpose to check that it does.
   */
  referenceAnswer: string;
  /** Non-empty, or the question is dropped. */
  evidence: QuizEvidence[];
  band: QuizBand;
  /** 1 (peripheral) – 5 (central). The sort key within a band. */
  value: number;
}

/**
 * What was thrown away, and why. **Every one of these is invisible from
 * outside** — a dropped question looks exactly like one the model chose not to
 * set — which is the whole reason they are counted, stored and logged.
 *
 * Counts only. Never the question, never the reference answer, never the quote.
 */
export interface QuizDropped {
  /** A `blockId` that is not in blocks.json. The model invented it. */
  unknownIds: number;
  /** A `quote` that `findQuote` could not locate in the block the model named. */
  unquoted: number;
  /** Evidence past `MAX_EVIDENCE` on one question. */
  truncated: number;
  /** Questions past `MAX_QUESTIONS`, discarded whole. */
  overCap: number;
  /** Questions missing a field, or with an unusable band or value. Dropped. */
  malformed: number;
  /** Questions asking the same thing as one already kept. Dropped. */
  duplicate: number;
  /** Questions that lost **every** piece of evidence and were dropped whole. */
  unanchored: number;
}

/** The artefact. `data/<slug>/quiz.json`. */
export interface Quiz {
  version: string;
  generator: string;
  slug: string;
  /**
   * **Minted per generation, and every mark binds to it.**
   *
   * Between a reader seeing a question and pressing Answer, a forced
   * regeneration can replace the reference answer and the evidence while the
   * question id stays whatever it stays. Without this the server would mark one
   * batch's answer against another's reference with nothing visibly wrong.
   * Stage 2 turns a mismatch into a 409; the field exists from the start so
   * there is nothing to migrate. GPT Sol's finding 5.
   */
  batchId: string;
  /** Blocks, tree and metadata — `articleWithIdsFingerprint`. */
  sourceHash: string;
  /** **Already sorted** — bands, then value, then document order. Never re-sorted. */
  questions: QuizQuestion[];
  /** What validation threw away. See `QuizDropped`. */
  dropped: QuizDropped;
  generatedAt: string;
  elapsedMs: number;
}

/**
 * `GET /api/quiz/:slug`. Two staleness facts and no third, exactly as
 * `TimelineResponse` above: the reader profile is **not** in this stage's
 * stamp, so there is no `profileChanged` to report and the route sends no
 * `withProfileChanged`.
 * docs/plans/260831al-review-quiz-sub-mode.md § No profile in v1.
 */
export interface QuizResponse {
  quiz: Quiz;
  /** The article moved underneath these questions — blocks, sections or head. */
  stale: boolean;
  /** The article is the same and we would write the questions differently now. */
  outdated: boolean;
}

/**
 * As `TimelineFound`, and here too it is the *same* type, for the same reason:
 * there is no `profileChanged` for a store adapter to leave out. Named rather
 * than skipped so both adapters agree with their neighbours by shape.
 */
export type QuizFound = QuizResponse;

/**
 * What one mark is, on the wire — `POST /api/quiz/:slug/mark`.
 *
 * **Three ids and the reader's own words, and nothing else.** The question, the
 * reference answer and the evidence are looked up server-side from the artefact
 * (`markOneAnswer` in src/routes.ts), so a tampered body cannot make the model
 * mark against a question the article never asked. The `batchId` is what binds
 * that lookup to the batch the reader was actually shown — a mismatch is a 409
 * rather than a silent fall-forward.
 */
export interface QuizMarkBody {
  batchId: string;
  questionId: QuizQuestionId;
  answer: string;
}

/**
 * The most characters a reader's answer may carry.
 *
 * "A couple of sentences, give or take" is the shape asked for, and this is
 * four or five times that — a cap against a paste of the whole article rather
 * than a style rule. It is here in src/types.ts rather than in src/quiz-mark.ts
 * because the panel disables its button against the same number, and two copies
 * of a limit is one copy that drifts.
 */
export const MAX_QUIZ_ANSWER_CHARS = 4000;

/* ----------------------------------------------------------------- debate --
   What the rest of the web says about this piece — the `debate` column on
   `article_revisions`, and the only artefact here whose content is **not in the
   article at all**. docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.

   ## Why these are here and not in src/debate.ts, where the stage lives

   The same reason `Timeline` and `Quiz` are, above: `tests/client-imports.test.ts`
   lets `src/web/` import only the pure leaves in its `SHARED` list, and
   `src/debate.ts` is a stage with a CLI and two model calls in it. A panel that
   cannot see a row cannot be written, so the shape both sides speak lives in
   this file, which imports nothing, and src/debate.ts re-exports it.

   ## The one thing to understand before reading any of it

   **The web search never comes back empty.** Stage 0 asked for pages responding
   to an invented blog post at a domain that does not exist; three searches ran
   and nine annotations came back, every one a real, correctly-cited page about
   sourdough starters and not one of them a response to anything
   (docs/plans/260905f-debate-mode-stage-0-spike-results.md § 4). So *"nothing
   found"* is not a state the wire produces — it is a state **we manufacture, by
   refusing rows**, and every required field below is one of those refusals made
   into a type.  */

/**
 * **What the QUOTED PASSAGE does to this row's target** — the field that
 * groups the list.
 *
 * It said *"what the outside page does to what it is answering"* until
 * 2026-09-08, and the two halves of that were both wrong by a step: the subject
 * is the passage we quoted rather than the whole page, and the target is this
 * row's, named. `DebateLean` had the narrower subject all along, so one row was
 * carrying two scopes — Sol's F54.
 *
 * **Strongly associated with `DebateLean` below, and not functionally dependent
 * on it** — which is a correction, made twice. This said "orthogonal, and the
 * two must stay that way" until 2026-09-08, and the measurement refuted the
 * word: over 61 real rows the lean varies freely only under `qualifies`, and
 * `disputes` and `corroborates` carry the lean their own word implies in 32 of
 * 35. That is association, and reading it as entailment is what produced two
 * separate attempts to make the opposite pairs unspellable — round one's
 * coercion, refused by Sol's F35, and a discriminated union, refused by F65.
 *
 * The two remain different questions and both must be asked. This one is the
 * **argumentative move**; the lean is the **overall stance toward a target that
 * may be composite**, and an outside page can dispute one proposition while
 * supporting the conclusion around it —
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md § "The
 * overlap between `relation` and `valence`, and what it is not" has one honest
 * example per group, and they are the reason no type here forbids a pair.
 *
 * Deriving the icon from this field was refused separately (F9). That finding's
 * own example has since been cut by F19, and an author correcting their earlier
 * claim really is *against* that claim rather than merely "not hostile" — being
 * their own author is **provenance**, which is ruled out of this field below.
 * The refusal stands anyway, on F35's ground rather than F9's.
 *
 * **`follow-up` is deliberately not a sixth value here**, and the next reader
 * will reach for it: it is *provenance*, not relation, and a single field would
 * force a choice between saying who wrote a page and saying what it does.
 *
 * `unclear` is not a failure state and must not be drawn as one. A model that
 * cannot tell what a page is doing should say so and be believed — the same
 * rule docs/project/timeline.md applies to an undated row.
 */
export type DebateRelation =
  | "disputes"
  | "qualifies"
  | "extends"
  | "corroborates"
  | "unclear";

/**
 * **Which way the cited passage leans, toward the row's own target** — the
 * field that draws the icon and the colour.
 *
 * A small closed set with an explicit unknown, and **never a score**. Greg,
 * 2026-09-05: *"we could just have valence be (+1, -1, neutral, unknown), and
 * include it?"* — and, on the thing we are not building: a *"62% negative"* line
 * hands the reader a verdict on a piece they are in the middle of reading, which
 * is the summary-shaped failure docs/project/vision.md exists to refuse. No
 * numeric lean is computed or stored anywhere.
 *
 * **The words are agreement words, and that is the repair.** This was
 * `DebateValence`, spelled `positive | negative | neutral | unknown`, until
 * 2026-09-08. Three stored rows had recorded the source's stance toward *its
 * own* subject rather than toward the row's target — a page negative about Uri
 * Geller marked `negative` on a row whose target was a claim it *supported* —
 * and the reader saw a red **Critical** chip over a source that agreed with the
 * article.
 *
 * The diagnosis is **sentiment collapse**, and it is why the rename is the fix
 * rather than decoration: `positive | negative` is sentiment-analysis
 * vocabulary, so the cheapest reading of a passage is its polarity toward
 * whatever it is itself discussing. That the page therefore *agrees with* the
 * article is a second hop, and the model skipped it. `leans-for` and
 * `leans-against` cannot be answered without naming what they lean toward.
 *
 * **All three errors were in group two**, which already carried an explicit
 * target-binding sentence — so this was never a missing instruction, and
 * `readStoredLean` below is what keeps the rows written before the rename
 * readable.
 *
 * **The target is stated because otherwise this means three things** (Sol's
 * F19): it is the model's estimate of the cited passage's stance toward *the
 * article itself* in group one, and toward *the `claimQuote`* in group two. Not
 * the passage's tone, not its stance toward some third subject, and — the
 * negation those three rows needed and the prompt did not have — not toward
 * whatever the outside piece is itself discussing.
 *
 * **`Comment.valence` is not a precedent.** That is the referee's own placement
 * of a passage on their own criterion — a person's judgment, stored as such.
 * This is a model's reading of a stranger's page: same shape, different
 * instrument, and the panel labels it as such.
 */
export type DebateLean = "leans-for" | "leans-against" | "neither" | "cannot-tell";

/**
 * What both groups' rows share.
 *
 * Never constructed directly: the two groups are separate types below, so a
 * group-one row **cannot be spelled** without the witness that it is about this
 * article, and a group-two row cannot be spelled without the claim it answers.
 * That is the compiler standing in for the two rules that a review found the
 * first draft had no code for.
 */
interface DebateRowBase {
  /**
   * `mintId`, so it is a block id by construction and a future `?debate=` would
   * validate for free.
   *
   * **Minted fresh on every run**, and there is deliberately no `BASELINE` row
   * for this kind in src/store/artifacts.ts. Ids are inherited where a reader
   * holds a link that must survive a regeneration (`?idea=`, `?event=`); marks
   * in the prose are Deliberately not in v1, so inheritance here would be
   * machinery serving nothing, and `readBaseline` throws for a kind with no row
   * precisely so nobody can half-add it.
   */
  id: string;
  /**
   * **A URL the search returned in this run**, from OpenRouter's own
   * `url_citation` annotations — never a URL the model typed that merely
   * parses. `isWebUrl` is necessary and nowhere near sufficient: a plausible
   * title beside a real-looking address is exactly what a model produces well.
   */
  url: string;
  /** **The search result's own title**, never the model's. Absent where the wire had none. */
  title?: string;
  /**
   * **The matched slice of that page's own extract** — located by
   * `findQuote(extract, quote, undefined, "spaced")`, and stored as the
   * *haystack's* characters rather than the model's spelling of them.
   *
   * Failure drops the whole row and counts `unverifiedSource`. It does not
   * merely drop the quote: the first draft let a row survive as "a paraphrase,
   * labelled as one", and Sol's F2 is right that this is precisely the hole — a
   * model can attach an invented critique to an unrelated but real annotation
   * URL, and a label saying "paraphrase" does not stop it being read as
   * evidence. **No row survives as an unchecked paraphrase.**
   */
  sourceQuote: string;
  relation: DebateRelation;
  /**
   * **Never read straight off a stored row** — call `readStoredLean` below.
   * Rows written before 2026-09-08 have no `lean` at all, they have a `valence`
   * in the old vocabulary, and nothing revalidates a row on the way out of the
   * database.
   */
  lean: DebateLean;
  /** How the outside piece bears on this row's target. The model's reading, labelled as such. */
  applies: string;
  /**
   * Where it does **not** bear on it.
   *
   * **Optional, and that is a correction.** The first draft required it on every
   * row; Sol was right to cut that, because a mandatory caveat field
   * manufactures caveats. The prompt is told to omit a row rather than invent a
   * limitation.
   */
  limits?: string;
}

/**
 * **Group one — a page that is about this piece.**
 *
 * `articleReferenceQuote` is the whole difference, and it is the finding that
 * mattered most in the plan's second review (F15): two separately metered
 * passes prove *a search ran*; they do not prove that anything it returned is a
 * **response to this piece**. Stage 0 is the exact counterexample.
 */
export interface DirectDebateRow extends DebateRowBase {
  /**
   * **Words from the source's own extract in which that page names *this*
   * article** — its exact title, its URL, or its title together with the
   * byline — located by the same spaced matcher and stored as the extract's own
   * characters.
   *
   * Required, so a row without one cannot exist in this group. Failure counts
   * `directnessUnverified`.
   *
   * It is a strict rule and it costs real rows — a review that says only
   * *"Seth's recent essay"* fails it. That is the right direction to fail in:
   * **group one's whole claim is that these pages are about this piece**, and an
   * unproved claim there is worse than a short list.
   */
  articleReferenceQuote: string;
  /**
   * **Every piece of evidence found that this page is about *this* article** —
   * the names of the facts, in no particular order, with the strongest of them
   * available from `identificationLevel`.
   *
   * **Non-empty by construction, and the type does not say so.** A row that
   * earns no signal at all cannot be in this group: it has already failed
   * `namesArticle` and been counted as `directnessUnverified`. The type is a
   * plain array because this is also read off stored JSONB, where an artefact
   * written before 2026-09-06 has no key here at all — `identifiesOf` is the one
   * place that fact is handled, and it is what every reader should call.
   *
   * **Not a score.** Nothing here is summed or weighted:
   * `link = 0.5, byline = 0.2, quote = 0.3` was proposed, measured and refused,
   * because the weights would be ours and a `0.7` is nothing a reader can check.
   * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md § "2 —
   * a level that *is* one of the facts, not a score over them".
   */
  identifies: IdentificationSignal[];
}

/**
 * **One way a page showed it was about this article**, named rather than scored.
 *
 * The order of the arms is the **strength order** and `identificationLevel`
 * reads it: a link to the address is the strongest thing a page can do, words
 * out of the article itself come next, and the title — which a successor
 * published three years later shares — is the weakest.
 *
 * `coverage` and `density` ride on the `quoted` arm so the panel's tooltip can
 * print them without a second pass over the article
 * ([`shingleOverlap`](./shingles.ts)).
 */
export type IdentificationSignal =
  | { kind: "linked"; url: string }
  | { kind: "quoted"; quote: string; blockId: BlockId; coverage: number; density: number }
  | { kind: "named"; by: "title" | "title-and-byline"; witness: string };

/** The strongest signal a row carries — the name of a fact, never a number. */
export type IdentificationLevel = IdentificationSignal["kind"];

/**
 * **What this row proved, whenever it was written.**
 *
 * The one place the pre-`identifies` artefact is handled, rather than a check at
 * each call site. Every row stored before 2026-09-06 was kept by the
 * title-or-link rule and carries the witness that did it, so it reads as `named`
 * on that witness — which is what the field would have said. **No migration, and
 * nothing to re-run.**
 *
 * A non-empty tuple, so the caller below can take the first element without the
 * compiler asking whether the list was empty.
 */
export function identifiesOf(
  row: DirectDebateRow,
): readonly [IdentificationSignal, ...IdentificationSignal[]] {
  const found = row.identifies;
  if (Array.isArray(found) && found.length > 0 && found[0]) return [found[0], ...found.slice(1)];
  return [{ kind: "named", by: "title", witness: row.articleReferenceQuote }];
}

/**
 * **The strongest evidence this row carries**, by a lookup over a fixed order.
 *
 * No arithmetic: the level *is* one of the facts on the row, and the tooltip
 * lists every one of them beside it. A composite would be our weights dressed as
 * the model's judgment, which is the refusal
 * [quotes.md](../docs/project/quotes.md) already makes about a prioritised row.
 */
export function identificationLevel(row: DirectDebateRow): IdentificationLevel {
  const signals = identifiesOf(row);
  let best = signals[0];
  for (const signal of signals) if (strengthOf(signal) < strengthOf(best)) best = signal;
  return best.kind;
}

/** Lower is stronger. A new arm of the union is a compile error here. */
function strengthOf(signal: IdentificationSignal): number {
  switch (signal.kind) {
    case "linked":
      return 0;
    case "quoted":
      return 1;
    case "named":
      return 2;
    default: {
      /* Not a `return 3`: a fourth kind of evidence must be *placed* in the
         order by whoever adds it, rather than silently ranked weakest. */
      const unreachable: never = signal;
      return unreachable;
    }
  }
}

/**
 * **Group two — a page that answers a claim the piece makes**, whether or not
 * it has ever heard of the piece.
 *
 * Greg asked for it by name, 2026-09-05: *"Perhaps also include searches for
 * people who have written about these or very similar ideas, even if they
 * haven't read this exact piece, and suggest how they might apply here."* Most
 * articles have no critical reception at all, and a mode that is empty four
 * times in five reads as broken rather than honest.
 *
 * The two required fields are the only thing standing between this mode and
 * nine sourdough blogs presented as critical reception.
 */
export interface ClaimDebateRow extends DebateRowBase {
  /**
   * **The article's own words for the claim being answered**, located in
   * `blockId` by the spaced matcher and stored as the *block's* characters.
   * Failure counts `claimNotInBlock`.
   */
  claimQuote: string;
  /** Where the article makes it. A block id this article actually has, or the row is dropped. */
  blockId: BlockId;
}

/**
 * **Every way a reported row can be refused, counted by reason and stored per
 * group.**
 *
 * Per group, never only summed, or a foot line cannot say which of the two
 * searches lost rows. A total may be derived for telemetry.
 *
 * **`sourceNotPublishable` is deliberately not here.** That loss is *created
 * later*, when the public DTO re-judges every URL at the boundary, so it is
 * computed there and never read off the artefact (Sol's F17). Putting it here
 * and firing the foot line on `reportedRows !== keptRows` would leave the
 * stored counts equal and the visitor looking at a shorter list with no sentence
 * at all.
 */
export interface DebateLosses {
  /** No URL, or a URL this run's own annotations never returned. */
  uncited: number;
  /** The article citing itself — same request target as `meta.url`. */
  selfSource: number;
  /** `sourceQuote` absent, or not in that page's own extract. */
  unverifiedSource: number;
  /** Group one only: no `articleReferenceQuote` we could locate in the extract. */
  directnessUnverified: number;
  /**
   * **Group one only: the page is a *copy* of the article, not a response to
   * it** — half or more of its own extract is the article's words, over at
   * least five windows ([`isCopy`](./shingles.ts)).
   *
   * `selfSource` wearing a new hat, and `sameTarget` cannot catch it because an
   * archive and a `www.` host are different addresses. It is counted rather than
   * filtered because a mirror is the *most* convincing row on the screen — it
   * links the piece, it quotes it exactly, and every other counter reads clean.
   * docs/reusable/silent-success.md.
   */
  sourceIsCopy: number;
  /** Group two only: `claimQuote` absent, or not in the named block. */
  claimNotInBlock: number;
  /** Group two only: a block id this article does not have. */
  unknownBlockId: number;
  /**
   * Not a readable row at all — not an object, or with no `applies` in it.
   *
   * **The seventh reason, and the plan names six.** Its § What is counted lists
   * the *validation* losses; a row-shape failure is a different kind of thing
   * and `DroppedCandidates.malformed` (src/referee-candidates.ts) already keeps
   * it separate for that reason. A *malformed answer* — the whole JSON document
   * — still fails the step and writes no artefact; this counts one bad row
   * inside an otherwise readable list, which the plan did not consider.
   */
  malformed: number;
}

/**
 * **What one pass returned, and what became of it.**
 *
 * `returnedSources` is the field to read first and the one the first draft did
 * not have (Sol's F13). Annotations arrive **independently of what the model
 * says** — Stage 0's probe answered with the single word `DONE` and Exa still
 * returned ten source annotations — so a model can be handed evidence from ten
 * pages, report three rows, have all three validate, and every other counter
 * here reads clean while seven pages never entered the answer at all.
 * `reportedRows` counts *the model's output* and must never be allowed to stand
 * in for *what the search found*.
 */
export interface DebateCounts {
  /**
   * **Unique admissible annotation URLs this pass returned** — after the
   * `isWebUrl` refusal and the `selfSource` one, and independent of what the
   * model reported.
   */
  returnedSources: number;
  /** Rows the model put in its answer, including the ones past the cap. */
  reportedRows: number;
  /** Rows that survived every rule. */
  keptRows: number;
  /**
   * Rows beyond this group's cap, **counted before iteration stopped**. A cap
   * that stopped silently would make position a ranking in a feature built to
   * have none.
   */
  omittedOverCap: number;
  lost: DebateLosses;
  /**
   * **The provider's own web-search count for this pass**, from
   * `whereSearchCountCameFrom`. Always positive: zero, or accounting we could
   * not read, fails the pass and therefore the whole step.
   *
   * Stored because it is the only alarm there is. No request parameter bounds
   * spend here — Stage 0b watched a cap of 4 results cost 36 searches — so a run
   * that went wrong shows up in this number and in the `ai_calls` ledger and
   * nowhere else.
   */
  webSearches: number;
}

/** One group: its rows, in the order they are to be shown, and what it lost. */
export interface DebateGroup<Row> {
  rows: Row[];
  counts: DebateCounts;
}

/**
 * **Did this group lose anything at all?**
 *
 * Here rather than in src/debate.ts, where it started, for the reason the types
 * above are here: the panel draws the foot line this answers, and
 * tests/client-imports.test.ts will not let `src/web/` import a module with a
 * CLI and two model calls in it. The stage re-exports it, so it still has one
 * name on the server side.
 *
 * **A sum of every field rather than `Object.values` over the argument**, so a
 * new loss reason added to `DebateLosses` is a compile error rather than a
 * number silently folded into a sentence nobody re-read. `lossesOf` below is
 * where that is enforced, and it is enforced rather than asserted: the sentence
 * above is older than the mechanism and was a claim without one until
 * 2026-09-06, when `sourceIsCopy` was added to `DebateLosses`, every field here
 * was still summed by hand, and nothing failed to compile. A docblock stating a
 * rule the code does not make is the shape of this file's worst bug (Sol's F24,
 * `readDirectGroup`).
 */
export function anyLost(lost: DebateLosses): boolean {
  return Object.values(lossesOf(lost)).some((n) => n > 0);
}

/**
 * **Every loss counter, off an artefact that may not carry them all.**
 *
 * Two jobs in one function because they are one fact.
 *
 * **It fills the gaps.** `sourceIsCopy` landed on 2026-09-06 and
 * `isDebateDocument` validates two arrays and nothing else, so every debate
 * stored before that day reads back with the key absent — as, that day, did
 * every one in the local database. The type says `number` because that is what
 * the stage writes; **JSONB read back is not bound by it**, and `undefined`
 * through arithmetic is `NaN`, which fails every comparison silently. The panel
 * met this for real: an old artefact printed *"offered 5 of these; 3 are shown —
 * ."* with both counts intact and the whole explanation gone — the failure that
 * counter was added to prevent, arriving through the counter itself.
 *
 * **And it is the exhaustiveness gate.** The returned object names every field,
 * so a new one added to `DebateLosses` stops this literal compiling, and both
 * `anyLost` and the panel pick it up rather than dropping it. One place to add a
 * counter and one place to forget it, instead of a hand-written sum in each
 * caller — which is how `sourceIsCopy` was nearly lost twice on the day it was
 * written.
 */
export function lossesOf(lost: DebateLosses): DebateLosses {
  return {
    uncited: count(lost.uncited),
    selfSource: count(lost.selfSource),
    unverifiedSource: count(lost.unverifiedSource),
    directnessUnverified: count(lost.directnessUnverified),
    sourceIsCopy: count(lost.sourceIsCopy),
    claimNotInBlock: count(lost.claimNotInBlock),
    unknownBlockId: count(lost.unknownBlockId),
    malformed: count(lost.malformed),
  };
}

/**
 * **A counter off stored JSONB, or zero.**
 *
 * Not `?? 0`: absent is the common case but it is not the only one this has to
 * survive. A hand-edited artefact, a half-written one, or a future writer can
 * put a string, a `null` or a negative here, and each of those reaches a
 * sentence as *"-2 could not be checked"* or as a silent `NaN`. The type says
 * `number`; the row came from a database.
 */
function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * **How many distinct pages actually contribute to the rows shown.**
 *
 * The other half of the sentence `returnedSources` exists for: *"The search
 * returned evidence from N pages; M contribute to the rows shown"*, which the
 * foot line prints whenever the two differ. Rows are deliberately **not**
 * deduplicated by URL — one review can answer two different claims, and two
 * rows about one page is a real answer — so the count of rows and the count of
 * pages are different numbers and the sentence needs this one.
 */
export function distinctSources(rows: readonly { url: string }[]): number {
  return new Set(rows.map((r) => r.url)).size;
}

/**
 * The artefact. The `debate` column on `article_revisions`.
 *
 * **Two groups, from two separately metered model calls** — not one call
 * producing two lists (Sol's F1). OpenRouter reports a search *count* and never
 * the *queries*, so from one blended call we could not tell *"nobody responded
 * to this piece"* from *"the model only ever searched for the topic"*, and group
 * one being empty is this mode's most common output. It must not be an
 * inference.
 *
 * **The two passes are one atomic step**: a failure of either — zero or
 * unreadable search accounting, malformed JSON, `finish_reason: "length"`,
 * timeout, provider refusal — fails the whole step and writes none of this.
 * Only a *successful* pass A that kept no direct rows may say the search found
 * nothing.
 */
export interface Debate {
  version: string;
  generator: string;
  slug: string;
  /** `articleWithIdsFingerprint` — the blocks, the tree and the cited head. */
  sourceHash: string;
  /**
   * **When the search ran, as displayed provenance rather than staleness.**
   *
   * Debate is time-sensitive research and a shared link outlives it, so this
   * crosses both the owner and the public DTO deliberately and the panel says
   * *"Searched on …"*. `stale` continues to mean *the article changed*: a
   * visitor opening a year-old shared article must be able to see how old the
   * search is without the artefact declaring itself invalid.
   *
   * **The only clock on this artefact.** Its neighbours carry `generatedAt` as
   * well; here that would be a second copy of one instant, and two spellings of
   * one fact is what this repo's artefacts keep getting wrong.
   */
  searchedAt: string;
  /** About this piece. Empty is the commonest correct answer. */
  direct: DebateGroup<DirectDebateRow>;
  /** About what it claims. */
  claims: DebateGroup<ClaimDebateRow>;
  elapsedMs: number;
}

/**
 * **Is this value a debate document at all?** — the one shallow shape check,
 * asked by all three readers.
 *
 * `SHAPE.debate` (src/store/artifacts.ts) asked only whether `direct` was an
 * object, so `{"direct":{}}` passed it; `readDebate` (src/debate.ts) required
 * both groups' rows; and the Postgres reader served any non-null JSONB
 * unchecked. Three answers to one question, which is the drift `SHAPE` exists
 * to prevent — GPT Sol's F29.
 *
 * **Both row arrays, and nothing about their contents.** Two empty groups is a
 * perfectly good artefact and the commonest one, so this cannot ask for rows;
 * what it has to tell apart is a *half-written or hand-edited document*, and a
 * missing `claims` is exactly that.
 *
 * Here rather than in src/debate.ts for the reason `anyLost` is: the store's
 * shape table is reachable from the client, and it may not import a module with
 * a CLI and two model calls in it (tests/client-imports.test.ts). The stage
 * re-exports it, so the server side still has one name for it.
 */
/** Is this one of the four leans this build knows? Total by construction below. */
const LEAN_MEMBERS: { [K in DebateLean]: true } = {
  "leans-for": true,
  "leans-against": true,
  neither: true,
  "cannot-tell": true,
};

/**
 * **The lean of a row that may have been written before the vocabulary changed.**
 *
 * `isDebateDocument` validates that the two groups hold arrays and nothing about
 * the rows inside them, and Postgres hands JSONB back unchecked — so a row
 * stored before 2026-09-08 arrives typed as `DebateRow` while carrying
 * `valence: "positive"` and no `lean` at all. Indexing an appearance table with
 * that gives `undefined`, and the next property access crashes the panel.
 *
 * That is not hypothetical here: `lossesOf` above exists because the same
 * assumption — that the type describes what comes out of the database — printed
 * *"offered 5 of these; 3 are shown — ."* to a reader, the explanation lost to an
 * `undefined` that arithmetic turned into `NaN`. Sol's F68 named this one before
 * it shipped rather than after.
 *
 * **One accessor for every consumer that reads a stored row**, rather than the
 * same map written out at each call site. The mapping is the honest one: the old
 * vocabulary's four values carried the same four meanings under
 * sentiment-flavoured names, and anything else — a missing field, a spelling
 * neither vocabulary knows — becomes `cannot-tell`, which is a real answer here
 * and is drawn as calmly as the rest.
 *
 * **It said "called by every consumer" for about an hour, and that was false.**
 * The eval's `vocabularyReport` and `replayJournal` read `lean` directly, so
 * every one of the 26 journalled rows read as absent and Layer 1 replayed their
 * stance as `cannot-tell` — Sol's F71, measured before it was fixed. There is a
 * second copy of this four-way map in `evals/debate/score.ts`
 * (`SUPERSEDED_LEANS`), deliberately, because production must not depend on the
 * eval and the eval must not be the only place the mapping is stated. **Edit one,
 * edit the other** — and a test there asserts the two agree for all four
 * spellings, so this comment goes red rather than merely going stale.
 *
 * **The live wire stays strict.** Carrying the old vocabulary forward is a job
 * for readers of *stored* rows. A row arriving from a model **today** with
 * `valence` and no `lean` is a prompt that has reverted, and `readShared` in
 * src/debate.ts must go on coercing it rather than quietly reading it forward.
 */
export function readStoredLean(row: { lean?: unknown; valence?: unknown }): DebateLean {
  if (typeof row.lean === "string" && Object.hasOwn(LEAN_MEMBERS, row.lean)) {
    return row.lean as DebateLean;
  }
  switch (row.valence) {
    case "positive":
      return "leans-for";
    case "negative":
      return "leans-against";
    case "neutral":
      return "neither";
    default:
      return "cannot-tell";
  }
}

export function isDebateDocument(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const doc = value as { direct?: { rows?: unknown }; claims?: { rows?: unknown } };
  return Array.isArray(doc.direct?.rows) && Array.isArray(doc.claims?.rows);
}

/**
 * `GET /api/debate/:slug`. Two staleness facts and no third, exactly as
 * `TimelineResponse` and `QuizResponse` above: the reader profile is not in this
 * stage's stamp, because who is reading does not change what the web said.
 *
 * **Neither of these is about the age of the search** — that is `searchedAt`,
 * which the panel shows separately and which no comparison here consults.
 */
export interface DebateResponse {
  debate: Debate;
  /** The article moved underneath this — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and we would ask the web differently now. */
  outdated: boolean;
}

/**
 * As `TimelineFound` and `QuizFound`, and here too it is the *same* type, for
 * the same reason: there is no `profileChanged` for a store adapter to leave
 * out. Named rather than skipped so both adapters agree with their neighbours
 * by shape.
 */
export type DebateFound = DebateResponse;

/* ------------------------------------------------------------- feedback -- */

/**
 * **The longest address a bug report may carry.**
 *
 * `feedback.url` was a closed vocabulary of ten route names until 2026-09-02 —
 * `FEEDBACK_ROUTE_KINDS`, mirrored by hand into a TypeScript union, a SQL
 * CHECK and an exhaustive `Record` in the client — because the reasoning at the
 * time was that the raw address may not leave the browser: this app's URLs
 * carry `?q=` and `?find=`, which are reader-typed search text, and
 * `/add/<a whole third-party URL>`, which may carry a token.
 *
 * Greg reversed it, 2026-09-02: *"I think it's fine (and even advantageous) to
 * store the url with the Feedback - if that means we can get rid of the
 * route_kind and simplify things"*. Two things made the old design worse than
 * the thing it guarded. **It cost a migration per page** — adding `/privacy`
 * meant widening a CHECK, and the page shipped filing its reports as `unknown`
 * instead. And **when the four copies drift, a valid report gets a 500**, which
 * is a worse failure than the one the constraint prevents. The escape hatch was
 * used at the first opportunity, so the label had become less accurate by being
 * more closed. GPT Sol and Fable both argued it independently; the reasoning is
 * in docs/project/privacy.md § What a bug report carries.
 *
 * What replaces the vocabulary is **`isWebUrl` at the seam** (src/urls.ts) and
 * this cap. The address is stored whole, and it reaches Sentry whole too —
 * Greg's call, and docs/project/privacy.md says so to the reader in as many
 * words, which is the part that makes it a choice rather than a leak.
 *
 * 2048 is the practical ceiling every browser and proxy agrees on. It is a
 * `CHECK` in src/db/schema.ts as well, because a cap the server forgets is not
 * a cap.
 */
export const MAX_FEEDBACK_URL_CHARS = 2048;

/**
 * **Which deployment the report came from** — the union of what `VERCEL_ENV`
 * and `NODE_ENV` can say (src/monitoring.ts builds Sentry's `environment` from
 * exactly that pair).
 *
 * Closed, so that a report from a preview build cannot be read as one from
 * production. The server maps its environment onto this rather than passing a
 * string through: the type refuses the wrong value before the CHECK does.
 */
export const FEEDBACK_ENVIRONMENTS = ["production", "preview", "development", "test"] as const;

export type FeedbackEnvironment = (typeof FEEDBACK_ENVIRONMENTS)[number];

/**
 * **What the reader says this is** — a problem, or a suggestion.
 *
 * Greg asked for the toggle on 2026-09-02 and then, a message later, for what it
 * starts as: *"don't default to Problem. Default to null/unknown."* So the third
 * state is **absence**, and it is a real answer rather than a missing one: every
 * report filed before this existed is null, and so is one from a reader who did
 * not feel like categorising their own complaint.
 *
 * That is why there is no `"unknown"` member. A value spelled `unknown` beside a
 * nullable column would be two spellings of one fact — the same call `consented`
 * and `comments_body_nonempty` already make.
 *
 * docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md.
 */
export const FEEDBACK_KINDS = ["problem", "suggestion"] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * The longest the reader's report may be.
 *
 * Here rather than beside the store for the reason `MAX_PROFILE_CHARS` is here:
 * the dialog's `maxlength` and the number the server refuses at must be one
 * value, and src/store/ reaches for `pg` and `node:fs`, which nothing under
 * src/web/ may import (tests/client-imports.test.ts).
 *
 * Generous, because a bug report is a story and cutting one off mid-sentence
 * costs us the detail that would have identified it — and small enough that a
 * pasted article cannot become an attachment, which is the case the cap is
 * really for.
 *
 * It used to be *per answer*, and there were three of them, so the reader's
 * ceiling has quietly dropped from 12,000 characters to 4,000. Left where it is
 * on purpose: 4,000 characters is a very long report, the number is written into
 * a CHECK constraint by hand, and the failure is a sentence asking the reader to
 * trim rather than a report that goes missing.
 */
export const MAX_FEEDBACK_ANSWER_CHARS = 4_000;

/**
 * The longest a `feedback.body` may be **in the database**, which is three times
 * the number above plus the headings — and that is not sloppiness, it is what
 * the backfill needs.
 *
 * Reports filed before 2026-09-02 are three answers, each capped at
 * `MAX_FEEDBACK_ANSWER_CHARS` separately, glued under the headings src/feedback.ts
 * used to write. Three full ones come to exactly 12,072 characters. The column's
 * CHECK has to admit that, or the migration that wrote them into `body` would
 * fail on a row that was legal when it was filed — and the alternative, cutting
 * the backfill to 4,000, silently throws away something a reader wrote.
 *
 * **The reader's limit is still `MAX_FEEDBACK_ANSWER_CHARS`**: the route refuses
 * more and the dialog says so. This one is the ceiling under which no historical
 * row is illegal, and it is also what a report from a *stale client* folds into
 * — src/routes.ts § `legacyBody`.
 */
export const MAX_FEEDBACK_BODY_CHARS = 12_072;

/**
 * The largest screenshot the database will take, in **decoded** bytes.
 *
 * The dialog downscales to around 300 KB; this is the ceiling that holds
 * whatever the dialog does, because client-side downscaling is not validation.
 * A CHECK on `octet_length` rather than a rule in TypeScript, so it holds for
 * every writer including a script — docs/project/sql.md.
 */
export const MAX_FEEDBACK_SCREENSHOT_BYTES = 400_000;

/**
 * The opt-in diagnostics blob — **opaque to everything that stores it**.
 *
 * Deliberately `unknown`. The stage that builds it owns its shape (the plan's
 * *client log buffer and the diagnostics*), it is an allowlist at both ends, and
 * no part of it is ever queried — which is the sentence docs/project/sql.md
 * demands before a value may be JSONB rather than a column.
 *
 * It is carried with a **version**, so an old report is still readable when the
 * shape changes. The version lives in its own column (`diagnostics_version`)
 * rather than inside the blob, so it can be filtered on without reading the blob
 * and so there is only one copy of it.
 */
export type FeedbackDiagnosticsPayload = unknown;

export interface FeedbackDiagnostics {
  /** Which shape `payload` has. Stored in `feedback.diagnostics_version`. */
  version: number;
  payload: FeedbackDiagnosticsPayload;
}

/**
 * The most reports one request will return, however large a `limit` it asks
 * for.
 *
 * `feedback` is the only table in this app an ordinary account holder can add
 * rows to — rate-capped per owner (`FEEDBACK_HOURLY_CAP`), which is a
 * ceiling on the rate and not on the total. An unbounded select on it is a
 * response whose size is decided by whoever wrote the most, so the ceiling is
 * here rather than in the caller's good intentions.
 *
 * There is no pagination and that is deliberate for a v1 that expects tens of
 * rows: the page says *"showing the newest N"* when it is full, so the moment
 * this number starts hiding reports is a thing Greg can see rather than a thing
 * he has to suspect. docs/plans/260902l-admin-feedback-page.md § The simpler
 * options passed over.
 */
export const ADMIN_FEEDBACK_MAX = 500;

/** What `/api/admin/feedback` asks for when the address says nothing. */
export const ADMIN_FEEDBACK_DEFAULT_LIMIT = 200;

/**
 * Both numbers are **here rather than beside the store**, and it is the same
 * reason `MAX_FEEDBACK_ANSWER_CHARS` above is: the page that says *"the newest
 * 500, which is the cap"* and the query that cuts at 500 must be one value, and
 * nothing under `src/web/` may import `src/store/`, which reaches `pg` and
 * `node:fs` (tests/client-imports.test.ts). Two copies is how a page comes to
 * claim a completeness it does not have.
 */

/**
 * **One report on `/admin/feedback`** — a row of the one admin page that shows a
 * reader's own sentences. docs/plans/260902l-admin-feedback-page.md.
 *
 * ## Why it is here and `AdminUser` is not
 *
 * `AdminUser` lives in src/admin.ts, and that file's whole property is that it
 * **imports nothing** — the browser and the server ask the same `isAdmin`
 * without either dragging the other's dependencies along. This shape cannot go
 * there without importing `FeedbackKind`, `FeedbackEnvironment` and
 * `FeedbackDiagnostics`, all of which already live *here*. So it goes where its
 * vocabulary is, which is also where every other wire shape in this app is.
 *
 * ## It is written out, and it is deliberately **not** `FeedbackReport`
 *
 * A first draft made this `FeedbackReport & { ownerId }`, with a type-level
 * assertion holding the two in step. GPT Sol refused it, 2026-09-02, and was
 * right: tying them together makes every future field added to a reader's own
 * report **cross owners automatically**, and turns the type checker into the
 * thing that *insists* on the widening rather than the thing that catches it.
 *
 * So the two shapes are independent on purpose. `pg-admin-feedback.ts` names
 * every column it selects, and tests/admin-feedback-store.test.ts pins the exact
 * set of keys that comes back, so a field reaches this page by somebody deciding
 * it should or not at all.
 *
 * ## The one rule about what may be added
 *
 * The admin pages may show the account metadata documented for `/admin/users`,
 * and **the support report the reader submitted**: what they wrote, an attachment
 * they deliberately added, diagnostics they ticked a box for, and Spideryarn's
 * own fixed correlation metadata. Identifiers may not be followed into articles,
 * comments or notes. docs/project/admin.md states the boundary; this is the
 * shape that obeys it.
 */
export interface AdminFeedbackReport {
  /**
   * **Half of the key.** A report is `(ownerId, id)`: the id is minted by a
   * browser, so it is unique within an owner and not globally, and two readers
   * may legitimately hold the same one. Anything that addresses a report — a
   * URL, a React key, a sort — needs both. See pg-admin-feedback.ts.
   */
  id: string;
  /** The other half, and the account to cross-reference against `/admin/users`. */
  ownerId: string;
  /** The address the reader held **when they wrote to us**, snapshotted, not joined. */
  reporterEmail: string;
  /**
   * **What the reader wrote, in one box.**
   *
   * `string`, never `string | null` — the column is `not null`, which is the
   * whole of the old `feedback_says_something`: a report with nothing in it is
   * not a report, and that is now the type rather than a constraint beside it.
   *
   * **Not length-capped on the way out.** Reports filed before 2026-09-02 carry
   * the three old answers glued together with their headings, so a legacy body
   * can legitimately be three times the dialog's current limit. A renderer that
   * truncates to `MAX_FEEDBACK_ANSWER_CHARS` would silently cut the oldest
   * reports — the ones most likely to be the reason somebody opened this page.
   * GPT Sol, 2026-09-02.
   */
  body: string;
  /**
   * *A problem* or *a suggestion*, or **`null` for "they did not say"**.
   *
   * Null is a real answer and not a missing one — Greg, 2026-09-02: *"don't
   * default to Problem. Default to null/unknown."* It is also every report
   * filed before the toggle existed, and the page must draw it as its own state
   * rather than picking one.
   */
  kind: FeedbackKind | null;
  /** Whether they ticked *Send extra diagnostics* — its own fact, never inferred. */
  consented: boolean;
  /**
   * The address they were at, whole, or `null` from a bundle loaded before
   * 2026-09-02. See `MAX_FEEDBACK_URL_CHARS` and src/db/schema.ts § `url`.
   */
  url: string | null;
  slug: string | null;
  buildCommit: string | null;
  environment: FeedbackEnvironment;
  requestVercelId: string | null;
  /**
   * Which shape the diagnostics blob has, or `null` for no blob. **Never the
   * blob**: the allowlist permits ~179 KB per report, and a page of two hundred
   * of those is tens of megabytes of something nobody has opened. The payload
   * comes from `AdminFeedbackDetail`, one report at a time.
   */
  diagnosticsVersion: number | null;
  /** How big the screenshot is, or `null` for none. **Never the bytes** — same reason. */
  screenshotBytes: number | null;
  /** ISO. Handed to Sentry. */
  mirrorAttemptedAt: string | null;
  /** ISO. Sentry acknowledged it. Attempted-but-not-acknowledged is the interesting state. */
  mirroredAt: string | null;
  sentryEventId: string | null;
  /** ISO. */
  createdAt: string;
}

/**
 * One report **with its diagnostics blob** — what `GET /api/admin/feedback/:owner/:id`
 * answers when somebody opens one.
 *
 * A second shape rather than an optional field on the first, so that "the list
 * does not carry diagnostics" is something the types say rather than something
 * a comment claims.
 */
export interface AdminFeedbackDetail extends AdminFeedbackReport {
  diagnostics: FeedbackDiagnostics | null;
}

/**
 * **Where the last page ended**, as the whole sort key.
 *
 * All three parts, because the order is `created_at, owner_id, id` and a keyset
 * cursor built on less than the total order silently skips rows — two reports
 * can share a millisecond, and two owners can share a report id.
 */
export interface FeedbackCursor {
  /** ISO, as the row reported it. */
  createdAt: string;
  ownerId: string;
  id: string;
}

/**
 * **The cursor as one query-string value**, and the parser that refuses a bad
 * one.
 *
 * One encoding, in a module both halves import, for the reason
 * `MAX_FEEDBACK_ANSWER_CHARS` is here: the page that puts a cursor into a URL
 * and the route that reads it back must be one decision. Two spellings of a
 * cursor is a *Load older* that silently returns page 1.
 *
 * `|` as the separator, because none of the three parts can contain one — an
 * ISO timestamp, a uuid and a Spideryarn id are all closed shapes, checked by
 * `decodeFeedbackCursor` rather than assumed.
 */
export function encodeFeedbackCursor(cursor: FeedbackCursor): string {
  return `${cursor.createdAt}|${cursor.ownerId}|${cursor.id}`;
}

/**
 * `null` for absent — start at the top — and `"malformed"` for anything that is
 * not a cursor.
 *
 * **Three answers, not two.** A malformed cursor read as "start at the top"
 * would hand the reader page 1 while they pressed *Load older*, which is a
 * request that looks like it worked and quietly skipped everything in between.
 * docs/reusable/silent-success.md. The route turns `"malformed"` into a 400.
 */
export function decodeFeedbackCursor(
  raw: string | null | undefined,
): FeedbackCursor | null | "malformed" {
  if (raw === null || raw === undefined || raw === "") return null;
  const parts = raw.split("|");
  if (parts.length !== 3) return "malformed";
  const [createdAt = "", ownerId = "", id = ""] = parts;
  /* Each part held to its own shape. A timestamp that `Date.parse` rejects
     would reach the driver as an `Invalid Date` and compare against everything
     as false — a page that is empty rather than one that errors, which is the
     worse of the two. */
  if (!Number.isFinite(Date.parse(createdAt))) return "malformed";
  if (!isUuid(ownerId)) return "malformed";
  if (!isSpideryarnId(id)) return "malformed";
  return { createdAt, ownerId, id };
}

/**
 * One page of the inbox.
 *
 * `hasMore` is **seen, not inferred**: the store asks for one row more than it
 * returns. Inferring it from `reports.length === limit` is wrong exactly when
 * the list ends on a boundary, and a page that says *that is all of them* when
 * it is not is the failure this whole feature exists to catch elsewhere.
 */
export interface AdminFeedbackPage {
  reports: AdminFeedbackReport[];
  hasMore: boolean;
  /** Pass back as `?before=` to get the next page. `null` when there is no next page. */
  nextCursor: FeedbackCursor | null;
}

/* --------------------------------------------------------- link preview -- */

/**
 * **What the page on the other end of a hyperlink says about itself.**
 *
 * Four fields, all of them the destination's own words rather than ours — a
 * summary is stage 3 and lives somewhere else. Every field is optional because
 * the measured corpus really does vary: three of eight successes on 2026-09-05
 * (plato.stanford, paulgraham, gwern) carry no `og:` tags at all, so the
 * fallback chain is load-bearing and what survives it differs page by page.
 *
 * docs/project/links.md, and src/link-previews.ts for how each one is found.
 */
export interface PagePreview {
  /** `og:title` → `twitter:title` → `<title>`. */
  title?: string;
  /** `og:site_name`. Never guessed from the host — the card already shows that. */
  siteName?: string;
  /** `og:description` → `twitter:description` → `<meta name=description>`. */
  description?: string;
  /**
   * Readability's opening paragraph, and only when it looked like one.
   *
   * noema's is the word "Credits" — a byline artefact — so this is absent
   * rather than wrong when the sanity check fails, and the card falls back to
   * `description`.
   */
  firstParagraph?: string;
  /** How long the destination is, in words. */
  words?: number;
}

/**
 * The answer to `GET /api/link-preview`.
 *
 * A discriminated union rather than a nullable page, because *nothing to show*
 * and *ask again in a moment* are different things to a client and only one of
 * them is worth a second request.
 *
 * **No timestamps, and that is a rule rather than an omission.** Returning when
 * the row was fetched would tell a caller whether — and when — some prior reader
 * caused a fetch of that URL. GPT Sol, 2026-09-05, finding P1-7;
 * src/db/schema.ts § `linkPreviews`.
 */
export type LinkPreviewResponse =
  /** We have something worth putting on the card. */
  | { state: "ready"; page: PagePreview }
  /**
   * Somebody else holds the single-flight claim for this exact URL. Ask once
   * more, shortly; do not treat it as an answer.
   */
  | { state: "pending" }
  /**
   * **We asked the destination and there is nothing to show.**
   *
   * Unreachable, refused by the far end, a PDF, a page with nothing in it. The
   * card is left exactly as it was: two of ten destinations in this corpus are
   * permanently behind a bot challenge, and that has to look like nothing
   * happening rather than like an error.
   *
   * This is a fact about **the URL**, so the client caches it and stops asking.
   */
  | { state: "unavailable" }
  /**
   * **We did not ask**, and the reason is about this request rather than about
   * the URL: the URL is not among this article's links, or it looks like it
   * carries a key, or this reader's allowance is spent.
   *
   * The card looks exactly the same as for `unavailable` — the reader is told
   * nothing either way. The distinction exists for the **client's cache**, and
   * without it a single hover of a chat link (which is in no article, so always
   * refused) or one rate-limited moment would silence that URL for the rest of
   * the session, including on the prose link where it would have worked. GPT
   * Sol, 2026-09-05, P2-1.
   *
   * It tells a caller nothing they did not have: they supplied the slug and the
   * URL and they own the article, so they could already read its links.
   */
  | { state: "refused" };

/**
 * **What `GET /api/link-summary` sends**, one frame at a time.
 *
 * The other half of the card, and the half we wrote: how the destination stands
 * to the piece the reader is holding. It streams — AGENTS.md's rule, and
 * `explain.ts` is the shape — so the reader watches it arrive rather than
 * watching a spinner. src/link-summary.ts.
 *
 * The four terminal members mirror `LinkPreviewResponse`'s deliberately, because
 * the client's caching rule is the same rule: **cache what is a property of the
 * question, and never what is a property of this request.** A `ready` and an
 * `unavailable` are about this reader, this article and this address, and are
 * remembered; a `refused` (a spent allowance) and a `pending` (somebody else is
 * generating it, or the fetch has not landed yet) are about this moment and are
 * not.
 *
 * `kind` rather than `state`, because these are frames rather than one answer:
 * a `delta` is not a state anything is in.
 */
export type LinkSummaryEvent =
  /** More of the answer. Any number of these, then exactly one terminal frame. */
  | { kind: "delta"; text: string }
  /** The whole summary — after the deltas, or on its own from the cache. */
  | { kind: "ready"; summary: string }
  /**
   * There is nothing here to summarise: the destination could not be read, or
   * what came back was a cookie notice rather than a piece. A property of the
   * pairing, so the client remembers it and stops asking.
   */
  | { kind: "unavailable" }
  /** We did not ask — the URL is not in this article, or the allowance is spent. */
  | { kind: "refused" }
  /**
   * Not yet: the destination's own fetch has not landed, or another request is
   * generating this very summary. Ask again shortly; it is not an answer.
   */
  | { kind: "pending" };
