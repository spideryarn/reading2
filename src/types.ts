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
 * `TreeNode` below is the authority for a node's fields.
 * docs/project/granularity-zoom.md § Node shape explains them — what a `gist`
 * is and why a leaf has a `navLabel` instead — and is not a second copy to keep
 * in step: one kept there drifted by a field within a month.
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
 *
 * A fourth, of types again: the difficulty rating's shapes belong to
 * src/reading-time.ts, which turns them into minutes and imports nothing.
 */
import { CHAT_BEING_UPDATED, type FailureKind, type PaperUnreadableReason } from "./messages.js";
import type { Assets } from "./assets.js";
import { isSpideryarnId, isUuid } from "./ids.js";
import type { DifficultyLevel, RatedDifficulty } from "./reading-time.js";

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
   * Shown in **Marginalia**, beside the first paragraph of each part. It is a
   * second field rather than a change to `gist` because the gist is rendered in
   * several places and is also fed back to the later structure waves as
   * context; the argument is in `questionFor` (src/structure.ts) and the plan
   * doc.
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
   * (src/structure.ts). *Not yet written* is a different fact and does not live
   * on the node: it is `NavLabelStatus` below, one value for the whole
   * revision. Reading a missing field as either one is the overloading
   * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md § 5 names.
   */
  navLabel?: string;
  summary?: string;
  sourceHeading?: string;
  /**
   * Set when no model wrote `title` and no heading did either: it quotes the
   * opening words of its first qualifying non-heading block (src/heading-tree.ts
   * § `buildBoundedHeadingTree`). The author's words, so the client draws them
   * in the author's face; `sourceHeading` cannot say so, because it must name
   * a heading.
   */
  titleFrom?: "opening-words";
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
   *
   * **Two values, because "headings" is not always temporary.** `"headings"` is
   * what `structure` falls back to when the model's answer cannot be used, and
   * it is final: nothing is coming to replace it. `"awaiting-structure"` is the
   * same kind of tree published on purpose by a first import from the browser,
   * so the article opens before the model call, with a `["structure"]` job
   * queued by that publication to replace it (`awaitingStructure` below).
   * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md.
   */
  provisional?: "headings" | "awaiting-structure";
}

/**
 * Is this the stand-in a first import publishes, with the real tree still to
 * come? The one question every reader of that state asks: the publication's
 * successors, `structure`'s freshness, the gate on the steps that read the
 * tree, and the open page.
 */
export function awaitingStructure(tree: Pick<Tree, "provisional"> | null | undefined): boolean {
  return tree?.provisional === "awaiting-structure";
}

/**
 * **Where a revision's paragraph nav labels are in their life** — one value for
 * the whole revision, never per node.
 *
 * `TreeNode.navLabel` above already has a legal absence, and it means
 * *deliberately unlabelled*: a caption, a pull-quote, a rule. This is the other
 * question, the one absence cannot answer —
 * [structure.ts](structure.ts) put it in as many words long before there was a
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
  /**
   * The passages this post was drawn from, as block ids, so the band can link
   * each post back to where it came from (Greg, 2026-09-29).
   *
   * **Absent** means written before `tweets/5`, when the prompt was not shown
   * ids at all — every thread stored before then. **Present** means the ids
   * that survived validation against the article, and may be empty: a post that
   * loses its ids keeps its text. src/tweets.ts § `buildThread`.
   */
  blocks?: BlockId[];
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
   * for "written without one". Absent predates profile provenance.
   * `profileIsStale` in src/profile.ts owns the three-state comparison:
   * a first profile counts as a change; clearing it does not.
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
   * True as well when the artefact was written while the reader had no
   * profile and they have one now (since 2026-10-05); false when the reader
   * has since cleared theirs. `profileIsStale` in src/profile.ts is the one
   * place those rules live.
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
   * When the pass that added this entry finished, ISO — **its own time, not
   * the list's.** `Glossary.generatedAt` is re-stamped by every *Find more
   * terms*, so without this an entry from the first pass could not be told
   * from one the third pass added. Greg, 2026-10-03: *"Store when it
   * happened."* The twin of `Quote.addedAt`.
   *
   * **Absent on every entry stored before 2026-10-03, and never backfilled.**
   * For those the list's `generatedAt` is an upper bound, not their time, and
   * writing the bound into the field would turn it into a claim. Kept — and
   * its absence kept — across an append, across a merge whichever name or
   * prose wins, and across a rewrite that inherits the id (src/glossary.ts
   * § `merge`, § `InheritedEntry`).
   *
   * Stored and shown nowhere yet. It enters no hash, no freshness comparison,
   * no dedupe and no prompt; the public projection (src/public/dto.ts) does
   * not copy it. A term the reader added themselves is not in the document
   * and has no `addedAt`: its time is its `glossary_lookups` row's.
   */
  addedAt?: string;
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
  /**
   * **The owner has hidden this entry, on this article, for themselves** —
   * docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md § 2.
   *
   * Attached at the owner's read seam (`loadGlossary`, from
   * `glossary_hidden_entries`) exactly as `lookup` is, never stored on the
   * entry, and never on the public projection (src/public/dto.ts copies field
   * by field). Absent means shown. The client filters on it in one place —
   * `shownEntries` in src/web/glossary-shown.ts.
   */
  hidden?: true;
  /**
   * **The reader added this term**, from the *Look up a term* box —
   * docs/plans/261002f-glossary-add-a-looked-up-term.md. Such an entry is not in
   * the glossary document at all: it is built at the owner's read seam
   * (`loadGlossary`) from a `glossary_lookups` row with `added_name` set, so it
   * has a `lookup` and no `senseHere`, `background` or scores. Like `hidden`,
   * never stored on the document and never on the public projection.
   */
  added?: true;
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
 * **Where the *Look up a term* box found the term** — every word of it the
 * server's, sent before the first word of the answer so the panel can say where
 * it is looking while it waits.
 */
export interface AskedTermFound {
  /** What the reader typed, normalised — never their raw string. */
  term: string;
  /** The block the question was anchored to, so the panel can offer a jump. */
  blockId: BlockId;
  /**
   * **The article's own words, not the reader's.** Where the two differ — case,
   * a plural, a possessive — the piece wins, because that is the passage the
   * model was told the reader had selected and it is the text that is there.
   */
  quote: string;
}

/**
 * **What happened to the term once its answer finished** —
 * docs/plans/261002f-glossary-add-a-looked-up-term.md.
 *
 * - `added`: it is in the owner's glossary now, as `entryId`, with this answer
 *   as its explanation. Only the owner sees it.
 * - `existing`: an entry already names these words (the model's, or one the
 *   reader added before), so nothing was written. `hidden` when the reader has
 *   hidden that entry, so the panel can offer *Unhide* rather than a jump to a
 *   row that is not drawn.
 * - `no-glossary`: the article has no glossary yet, so there is no list to add
 *   to and nothing was written.
 */
export type AddedTerm =
  | { kind: "added"; entryId: string }
  | { kind: "existing"; entryId: string; hidden: boolean }
  | { kind: "no-glossary" };

/**
 * **What the glossary's *Look up a term* box hands back** — one answer about
 * one passage, and what became of the term.
 *
 * A reader asked for a box that would "look for that term and add it to the
 * glossary" (2026-09-04, `[SPIDERYARN-READING2-Y]`). The first half shipped
 * that day and stored nothing; since 2026-10-02 a finished answer also adds the
 * term to the owner's own glossary (`added`). It is stored as a
 * `glossary_lookups` row with `added_name` set, outside the glossary document,
 * so *Find more* cannot merge it away and a shared link does not publish it —
 * the two reasons the first half stopped short. src/glossary-added.ts.
 *
 * `lookup` is a {@link GlossaryLookup} so the panel draws this with the same
 * component it draws a checked entry with — same call, same shape, one piece of
 * rendering.
 */
export interface AskedTermAnswer extends AskedTermFound {
  lookup: GlossaryLookup;
  added: AddedTerm;
}

/**
 * The article's glossary. Stage 5d, `data/<slug>/glossary.json`.
 *
 * Generated on demand rather than as part of every ingest — `glossary` is in
 * `STEP_ORDER` but not in `DEFAULT_INGEST_STEPS` (src/pipeline.ts).
 */
export interface Glossary {
  /** The prompt that wrote the **latest pass** — `PROMPT_VERSION` in src/glossary.ts. */
  version: string;
  /**
   * **The oldest prompt any entry here came from**, when that is not `version`.
   *
   * A *Find more* on an appendable list an older prompt wrote adds to it
   * (src/glossary.ts § `appendableVersion`, plan 261004f), and the list is then
   * stamped with the current version. This is what keeps that stamp from
   * vouching for the older entries. Absent on a list one prompt wrote, which is
   * every list from before 2026-10-04; a rewrite drops it. Nothing shows it: it
   * is provenance, in the export.
   */
  oldestVersion?: string;
  generator: string;
  slug: string;
  /** Fingerprint of the blocks it was written from — `hashBlocks`, src/source-hash.ts. */
  sourceHash: string;
  /**
   * Fingerprint of the **reader's profile** this was written from, or `null`
   * for "written without one". Absent predates profile provenance.
   * `profileIsStale` in src/profile.ts owns the three-state comparison:
   * a first profile counts as a change; clearing it does not.
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
  /**
   * How many entries the most recent pass added. As `Quotes.lastAdded`: the one
   * number that tells a *Find more* that found nothing from a button that did
   * nothing (docs/reusable/silent-success.md). Absent on a list written before
   * 2026-10-04.
   */
  lastAdded?: number;
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
   * True as well when the artefact was written while the reader had no
   * profile and they have one now (since 2026-10-05); false when the reader
   * has since cleared theirs. `profileIsStale` in src/profile.ts is the one
   * place those rules live.
   */
  profileChanged: boolean;
  /**
   * **What the panel's own run button will do with this list** — `panelRunKind`
   * in src/glossary.ts, for the label: *Find more* when it appends, *Write a
   * new list* when it rewrites. The route adds it, beside `profileChanged`,
   * because the profile half needs the reader's current profile. Plan 261003c.
   *
   * Optional for responses cached before the field existed, and so a hand-built
   * response in a test need not carry it; the current route always sends it.
   * The panel reads absent conservatively as `rewrite` when the list is stale
   * or outdated and `append` otherwise (GlossaryPanel.tsx).
   */
  panelRun?: "append" | "rewrite";
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
export type GlossaryFound = Omit<GlossaryResponse, "profileChanged" | "panelRun">;
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
   * The article's own words, sliced out of the block where `place` found them
   * — **never the model's string**.
   *
   * `findQuote` folds curly quotes and dashes to match, so what the model typed
   * can differ from `block.text` by a character or two; storing its typing put
   * words in the author's mouth on every fold, which is why the slice is stored
   * instead (docs/project/quotes.md § What is stored is the article's
   * characters). `start` plus this string's length is **not** a span — the client
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
  /**
   * When the run that chose this quote finished, ISO — **its own time, not the
   * list's.** `Quotes.generatedAt` is overwritten by every *Find more*, so
   * without this a line appended on Tuesday to Monday's list could not say
   * Monday. Greg, 2026-10-03: *"Store when it happened."*
   *
   * **Absent on every quote stored before 2026-10-03, and never backfilled.**
   * For those the list's `generatedAt` is an upper bound, not their time, and
   * the tooltip says *on or before*; writing the bound into the field would
   * turn it into a claim. Kept across an append and across a replace that
   * inherits the id (src/quotes.ts § `InheritedQuote`).
   *
   * Display only. It enters no hash, no freshness comparison and no dedupe.
   */
  addedAt?: string;
}

/**
 * How heavily a quote is drawn in the prose — **two levels, and the number of
 * levels is the finding, not an accident.** (Drawn as a fill since 2026-10-03,
 * plan 261003l; the widths and the blind test below are from when it was an
 * outline, and the test has not been re-run on fills.)
 *
 * `1` is the light fill, `2` the heavy one. The stylesheet owns their strengths
 * (`--quote-fill-light` and `--quote-fill-heavy`, per theme, styles/tokens.css); this is an ordinal so
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
 * **How strongly a quote is drawn: its tier and its brightness, as one
 * value.** Since 2026-10-03 a quote is a fill, like a highlighter pen, and both
 * numbers set how strong the fill is (plan 261003l, Greg, `spya-xrgste`);
 * until then it was an outline, they were its weight and its alpha, and that
 * is where the name `QuoteStroke` comes from. The numbers and what they mean
 * did not change. `tier` is the coarse priority step above; `alpha` (0.70–1.00) is
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
  /** Outside `MIN_QUOTE_CHARS`–`MAX_QUOTE_CHARS`. A phrase, or more than a reader will read as one quote. */
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
 * stale or (since 2026-09-24) an outdated list is replaced. Until then it
 * replaced, like `Ideas`. src/quotes.ts § existingFor.
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

/* ------------------------------------------------------------- skim --
   A route through the article's Quotes, walked at three depths — the
   `skim` column on `article_revisions`. docs/project/skim.md is the
   vision; docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
   is the build.

   Here rather than in src/skim.ts for the reason `Quiz` and `Faq` are:
   the panel needs the shape and `src/web/` may import only the pure leaves.

   **No block ids anywhere in it.** A stop names a quote, and the quote holds
   the block id (docs/project/block-ids.md). So the route has no ids of its own
   to keep, and a re-run simply replaces it. */

/**
 * The pass a stop belongs to. **The model plans the passes as nesting** (depth
 * *d* covering every stop with `depth ≤ d`, which is what `Skim.visible`
 * counts). **The reader walks a pass as the stops first placed there plus any
 * earlier stops whose `again` names it** — plan 261003l, `walkedIn` in
 * src/web/skim-route.ts. Before `skim/9`, there were no carried stops, so each
 * pass was only its own (plan 260929e).
 */
export type SkimDepth = 1 | 2 | 3;

export interface SkimStop {
  /** An id in the Quotes artefact. The stop's passage is that quote's block. */
  quoteId: string;
  depth: SkimDepth;
  /**
   * **Routes written before `trajectory/5` only**: what the passage *does*, at
   * most 80 characters. The prompt no longer asks for it and every new stop's
   * is `null`; kept so an old route still draws — the band falls back to it
   * when there is no `cue`.
   */
  role: string | null;
  /**
   * What to **look for** in this passage — since `skim/10`, the scene the quote
   * assumes first, then an instruction or a question — never
   * what it found — at most `MAX_CUE_CHARS` (src/skim.ts). Context-free
   * on purpose: a reader can reach a stop from anywhere, so it never says how
   * this stop follows another (Sol F18). `null` when the model's was missing,
   * empty or over-long, and the stop is kept (F8, F25). **Absent** on routes
   * written before `trajectory/5`.
   */
  cue?: string | null;
  /**
   * **The deeper passes this stop is walked in again** — each deeper than
   * `depth`, ascending, unique, and only a depth some stop is first placed at.
   * `depth` stays the shallowest pass the stop belongs to; a stop is walked in
   * pass *d* when `depth === d` or this includes *d* (`walkedIn`,
   * src/web/skim-route.ts). Greg, 2026-10-03 (spya-ms9d69): *"it's not a
   * guarantee, but nor is it excluded that something in a coarser level shows
   * up in a more detailed level."* **Absent** on routes written before
   * `skim/9`, which walk each pass as only its own stops (plan 260929e).
   * docs/plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md.
   */
  again?: SkimDepth[];
}

/**
 * What preprocessing or validation threw away or repaired. Counts only — never
 * a quote or a role. A dropped stop looks exactly like one the model never
 * offered, which is why they ride on the artefact and in the log.
 */
export interface SkimDrops {
  /**
   * Usable Quotes omitted before the call because a higher-priority quote
   * shares their block.
   */
  collapsed: number;
  /** A stop naming a quote id that is not in the Quotes artefact. */
  unknownQuote: number;
  /** A quote named twice; the shallowest occurrence was kept. */
  duplicate: number;
  /** A second stop on a block that already had one; the shallowest, then the earlier, was kept. */
  sameBlock: number;
  /** Unreadable: not an object, no quote id, or a depth outside 1–3. */
  malformed: number;
  /**
   * A role that was missing, empty, not a string or over the cap — set to
   * `null`, the stop kept. **Only routes before `trajectory/5` count these**;
   * the prompt no longer asks for a role, so a new route's is always 0.
   */
  badRole: number;
  /**
   * A cue that was missing, empty, not a string or over the cap — set to
   * `null`, the stop kept. **Absent on routes before `trajectory/5`**, which
   * had no cue; read it as 0.
   */
  badCue?: number;
  /**
   * `again` entries dropped: not 2 or 3, not deeper than the stop's own depth,
   * repeated, or naming a depth no stop is first placed at. The stop is kept.
   * Optional, as `badCue` is: routes before `skim/9` have none.
   */
  badAgain?: number;
  /**
   * `again` entries dropped because the pass already carried as many earlier
   * stops as it may — `maxCarried` in src/skim.ts. The stop is kept.
   */
  overCarried?: number;
  /** Stops past a cumulative cap, dropped in route order — never demoted. */
  overCap: number;
}

/** The artefact. The `skim` column on `article_revisions`. */
export interface Skim {
  version: string;
  generator: string;
  slug: string;
  /**
   * **The input hash** — `skimInputHash` in src/skim.ts, over
   * exactly what the prompt rendered, plus the quote id each Q-label resolves
   * to: the offered quotes' section paths, priorities, words and Idea
   * associations, the Ideas (or `null` for none), and the top-level outline.
   * Spelled `sourceHash` because that is the name `stampOf` reads
   * (src/store/artifacts.ts); it is not a hash of the article. Routes before
   * `trajectory/7` hold the old quotes-only hash, which never matches;
   * `loadSkim` reports them outdated, not stale.
   */
  sourceHash: string;
  /**
   * The rendered profile's hash, or `null` for none. **In the stamp**, and
   * compared more strictly than every other artefact's: none → some is stale
   * here. src/skim.ts § `routeProfileIsStale`.
   */
  profileHash: string | null;
  /** **The array order is the route.** Each pass walks its own and carried stops in this order (see `SkimDepth`). */
  stops: SkimStop[];
  /**
   * How many stops there are at depth ≤ 1, ≤ 2 and ≤ 3 — **cumulative**, as the route was planned
   * and validated. Growing, by construction. Not what the band counts: it counts the own and
   * carried stops the selected pass actually walks.
   */
  visible: [number, number, number];
  /**
   * How many quotes the model was offered — one per represented block, after
   * unusable ones were removed.
   */
  offered: number;
  dropped: SkimDrops;
  generatedAt: string;
  elapsedMs: number;
}

/** `GET /api/skim/:slug`. */
export interface SkimResponse {
  skim: Skim;
  /**
   * What the route was planned from has changed underneath it — the Quotes
   * (*Find more* added some, or they were chosen again), the Ideas (found
   * again, or found for the first time after the route), or the outline — or
   * there are no Quotes any more.
   */
  stale: boolean;
  /** Its input is the same and we would write the route differently now. */
  outdated: boolean;
  /**
   * The profile is not the one the route was written for — **including none →
   * some** (the shared `profileIsStale` counts that too since 2026-10-05) and
   * some → none, which it does not.
   */
  profileChanged: boolean;
  /**
   * How many of the current Quotes are not a stop on this route, at any depth —
   * not counting those in the abstract, which are left out on purpose.
   */
  notOnRoute: number;
}

/** As `QuotesFound`: everything but the one question about the reader. */
export type SkimFound = Omit<SkimResponse, "profileChanged">;

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

/**
 * **One author of the piece, as the piece declares them** — the page's
 * `citation_author` and `citation_author_institution` tags, or the names and
 * affiliations the PDF front-matter pass copied off the front page with their
 * footnote markers left off (src/pdf-frontmatter.ts § the provenance check).
 * `affiliations` is empty, never absent, when none was declared.
 * docs/plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md.
 */
export interface Author {
  name: string;
  affiliations: string[];
}

/**
 * **The `readingDifficulty` artefact, as it is stored**: the rating a screen
 * shows (`RatedDifficulty`, src/reading-time.ts) plus which model made it and
 * when, or the plain statement that the piece is not rated.
 *
 * Two members rather than a bag of optionals, because a rating with a level
 * and no sentence is not a thing: the table refuses one too
 * (`article_revisions_reading_difficulty_all_or_none`, src/db/schema.ts).
 * `{ rated: false }` is a real value the `blocks` step writes, and it clears
 * all five columns, so a piece whose text changed never keeps a rating of the
 * old text.
 * docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md.
 */
export type StoredReadingDifficulty =
  | {
      rated: true;
      language: DifficultyLevel;
      ideas: DifficultyLevel;
      /** The model's one sentence. Never blank. */
      reason: string;
      /** The model's id as the gateway named it. Never sent to a screen. */
      model: string;
      /** When the rating was made, ISO 8601. */
      ratedAt: string;
    }
  | { rated: false };

export interface Meta {
  slug: string;
  title: string;
  /**
   * **How hard the piece is to read, when a model has rated it**: language and
   * ideas, 1 to 5 each, and one sentence saying why. The reading-time estimate
   * is multiplied by it (src/reading-time.ts) and the card under the minutes
   * shows it. Absent on every piece not rated, which then reads at the flat
   * rate.
   *
   * **Put here by the reads a screen is drawn from** (`metaFrom`,
   * src/store/pg.ts), from columns the `blocks` step writes as an artefact of
   * its own. It is not part of the `meta` artefact: the pipeline's own `Meta`
   * never carries it and a `meta` write ignores it, so re-running `metadata`
   * or `extract` cannot clear a rating of text that has not changed.
   */
  readingDifficulty?: RatedDifficulty;
  /**
   * **The title as it arrived, when import tidied it** — all capitals made
   * title case, a trailing footnote marker taken off (`tidyTitle`,
   * src/title-tidy.ts). Absent when tidying changed nothing. For the owner
   * only: the Metadata page shows it and offers it back. No prompt reads it and
   * a visitor is not sent it.
   * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md.
   */
  titleOriginal?: string;
  /**
   * Free text, and what every prompt's `BY:` line and Referee mode read. When
   * `authors` is present the byline is derived from it (names joined `"; "`),
   * so the two cannot disagree — except where Readability's own byline already
   * named everybody, which 260928b keeps byte-identical.
   */
  byline?: string;
  /** Absent when we do not know the list — see `Author`. Never an empty array. */
  authors?: Author[];
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
   *
   * **Since 2026-10-04 it may be a registry's day instead** (`YYYY-MM-DD`, no
   * time): when the page states none and Crossref's record for the article's
   * own DOI states a whole day — src/article-registry.ts. That is how a PDF
   * gets one.
   */
  publishedAt?: string;
  /** Readability's own one-or-two-sentence excerpt. A last-resort card blurb. */
  excerpt?: string;
  note?: string;
  /**
   * **A minimal paper's abstract and DOI**, as the `metadata` step read them off
   * its first pages (src/paper-metadata.ts) — the paper's own claims through a
   * cheap model, checked for shape and nothing else. Absent on everything
   * `extract` made; *Read this* keeps them. Owner-facing only, like `filename`:
   * not in `PublicMeta`. docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md.
   */
  abstract?: string;
  doi?: string;
  /**
   * **The journal or venue the registry names for this piece** — Crossref's or
   * DataCite's, for the article's own DOI, kept only when the registry's title
   * is the article's (src/article-registry.ts). The same lookup may fill `doi`
   * and, when the page stated no date, `publishedAt` or `publishedYear`. A
   * visitor is sent it too (`PublicMeta.journal`), which `doi` is not. Absent
   * on everything imported before 2026-10-04.
   * docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md.
   */
  journal?: string;
  /**
   * **The year of publication, when that is all the registry states** — an
   * older print paper, or a DataCite record. Set only while `publishedAt` is
   * absent: an article has a day or a year, never both, and the database
   * refuses a row with both. Read the two together with `publishedOf`
   * (src/web/relative-time.ts). Timeline does not read it: a year is too
   * coarse a frame for "last March".
   * docs/plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md.
   */
  publishedYear?: number;

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

/**
 * `value` when it is a year `Meta.publishedYear` may hold, else undefined: a
 * whole number from 1000 to 2999, the bounds of the column's own check
 * (`article_revisions_published_year`). One function for every place a year
 * comes in from outside the type system: a registry record, a database row on
 * its way to a visitor, a shelf saved in the browser.
 */
export function publishedYearOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 2999 ? value : undefined;
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

/**
 * Why a fetch failed, as something to switch on.
 *
 * These exist because **every network and TLS failure in Node arrives as the
 * identical `TypeError: fetch failed`** — DNS, refused connection, expired
 * certificate, self-signed certificate and a missing intermediate are one
 * string at the top level, and the difference lives only in `err.cause.code`.
 * Code that matches on the message learns nothing, which is exactly the trap
 * the previous version fell into (docs/project/original-version/extraction.md).
 *
 * **Declared here, not in [fetch.ts](fetch.ts) where every one of them is
 * raised**, for `EmbeddingReason`'s reason above: [messages.ts](messages.ts)
 * holds a total map from these to the sentence a reader gets (`fetchFailed`),
 * and it may not import `fetch.ts`, type-only or not. `fetch.ts` re-exports the
 * name, so every other importer is unchanged. Moved 2026-10-04.
 */
export type FetchFailureCode =
  | "invalid-url"
  | "unsupported-scheme"
  | "blocked-address"
  | "dns"
  | "connection"
  | "certificate"
  | "timeout"
  | "too-many-redirects"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "http-error"
  | "too-large"
  | "unsupported-type"
  | "empty";

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
   * **Whether `meta.title` is the reader's rename** rather than the article's
   * own title — so the masthead can put it in the reader's face or the
   * author's (src/web/voice.ts § `articleTitleVoice`; docs/project/fonts.md).
   *
   * Required, for the reason `assets` is: a loader that forgot it would
   * typecheck and quietly draw every rename in the author's face. An article
   * saved in the browser before 2026-10-02 has no such key, and the client
   * reads that `undefined` as "not known" and draws the title as ours.
   *
   * The owner's article only. `PublicArticle` is its own type and never
   * carries it: the public payload never shows an owner's rename at all
   * (src/public/dto.ts).
   */
  titleOverridden: boolean;

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
   * A field about access, rather than an artefact. It is on this payload rather
   * than behind a route because it is a property of *the work* (src/routes.ts
   * § the sharing switch), because the Postgres store selects the `articles`
   * row anyway so it costs nothing, and because the alternative — a `GET`
   * beside the existing `PUT` — is a second round trip on every article open to
   * carry one enum that is already on the wire.
   * docs/plans/260904b-sharing-mark-on-the-article-masthead.md.
   *
   * **Absent means no owner-side visibility field, and never `private`.** The
   * owner's read always sets it (src/store/pg.ts); a visitor's payload omits it
   * and carries `sharedBy` instead, a `PublicArticle` drawn as an `Article`
   * (src/web/article/access.ts, src/public-types.ts). Until 2026-09-05 absence
   * also meant the filesystem store had no visibility column. A `private`
   * default would have the mark tell an owner that only they can read an
   * article nobody ever asked about. That is the one
   * sentence this control must not get wrong, and it is the same rule
   * `ArticleMetadata.sharing` follows for the same reason.
   * docs/reusable/silent-success.md.
   *
   * Optional rather than `Visibility | undefined`, unlike `assets` above:
   * `assets` is required-but-undefinable precisely so a store that forgets it
   * is a type error, and here leaving it out is a legitimate answer — the one
   * a visitor's payload gives on every article. There is nothing for a
   * compiler to insist on.
   */
  visibility?: Visibility;
  /** Owner-only sharing state. Absent means unknown; never contains the key. */
  privateLinkOn?: boolean;

  /**
   * **When the owner archived this article — `null` while it is on the shelf.**
   * For the masthead's Archive button (Masthead.tsx § `ArchiveMark`), which
   * must know which way round the article is on arrival, or it could only ever
   * offer *Archive*. Free, off the `articles` row the read already selects, as
   * `visibility` is. docs/plans/261002a-….
   *
   * **Optional for `visibility`'s reason: absent means *nobody could say*.**
   * A visitor's payload is built from `PublicArticle`, an allowlist that does
   * not carry it — whether the owner archived a piece is not a stranger's
   * business — and the masthead draws no button over an absent answer
   * (`useArchive`'s third state).
   */
  archivedAt?: string | null;

  /**
   * **Our guess at where an uploaded paper lives on the web** — `SourceGuess`
   * below, off `upload_source_guesses`.
   * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md.
   *
   * **A required key holding `SourceGuess | undefined`**, for `assets`' reason:
   * a projection that forgot it would typecheck and the reader would simply
   * never see a guess. `undefined` is the real answer *nobody has looked yet*
   * (and every article that is not an upload).
   *
   * **Owner-only until 2026-10-02**, when a visitor's banner began naming a
   * shared upload's source. The public projection still does not carry this
   * field: it carries its own, `PublicArticle.sourceGuess` (src/public-types.ts),
   * a `found` guess only, through `publicSourceUrl`, which access.ts dresses as
   * this type for the reading view. Plan 261002g § Decisions 3.
   */
  sourceGuess: SourceGuess | undefined;

  /**
   * **When High-powered AI was switched on for this article**, off
   * `articles.high_power_since` — or `null`, which is off.
   * docs/plans/260930f-high-powered-ai-per-article.md.
   *
   * The column, not the decision: whether the article's calls actually go to
   * Opus is `articlePower` in src/models.ts, which also asks whether the owner
   * is an administrator (decision 4). Every request-path route asks that of
   * this field; a required key, for `assets`' reason, so a projection that
   * forgot it is a type error rather than an article quietly answered by the
   * cheaper model.
   */
  highPowerSince: string | null;
}

/**
 * **What we found when we searched the web for an uploaded paper**, as the
 * owner's reading view needs it. `searching` means a claim is live, or went
 * stale and will be reclaimed on the next open; the client fires
 * `POST /api/source-guess/:slug` whenever this is neither `found` nor `none`.
 *
 * `found.kind` is `canonical` when a DOI or arXiv id was verified and `url` is
 * the link built from it (*probably the original*), and `matching` when the
 * text agreed and `url` is the search result's own address (*a page that
 * matches this paper*). src/source-guess.ts decides; the reasons for a `none`
 * are logged, not shown.
 */
export type SourceGuess =
  | {
      status: "found";
      url: string;
      host: string;
      kind: "canonical" | "matching";
      matchedBy: "doi" | "arxiv" | "content";
    }
  | { status: "none" }
  | { status: "searching" };

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
  /**
   * The current published revision, used by the shelf's derived views to know
   * that the article changed even when its visible metadata and word count did
   * not. Optional only for shelf rows cached before this field existed.
   */
  revisionId?: string;
  title: string;
  byline?: string;
  siteName?: string;
  url?: string;
  /** ISO. `meta.fetchedAt` where stage 2 recorded one, else the mtime of blocks.json. */
  addedAt: string;
  /**
   * **When the publisher says it was published** — `Meta.publishedAt`,
   * verbatim: `YYYY-MM-DD`, or that day with a time and an offset. The shelf
   * sorts on it and prints it (plan 261003m). Only the calendar day means
   * anything, so read it with `calendarDay` (src/web/relative-time.ts), never
   * `Date.parse`.
   *
   * Absent for most of a shelf: a PDF never has one, and nor does a web page
   * that states none or was last extracted before 2026-08-31.
   */
  publishedAt?: string;
  /**
   * `Meta.publishedYear`: the year alone, for a paper whose registry record
   * states no whole day. Never beside `publishedAt`. The shelf reads the pair
   * with `publishedOf` (src/web/relative-time.ts), which sorts a year at the
   * start of that year and prints it as `2011`.
   */
  publishedYear?: number;
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
  /**
   * The whole piece in one sentence: the tree root's gist — or, where there is
   * none, its summary, or the article's own excerpt (src/library-scalars.ts §
   * the blurb's fallback). So it may be the model's words or the author's.
   */
  gist?: string;
  /**
   * **Whose words `gist` is**, so the shelf can put it in the right face
   * (docs/project/fonts.md): `author` when it is the excerpt, `ai` when a model
   * wrote it. Present whenever `gist` is; absent only on a shelf body saved in
   * the browser before 2026-10-02, which the client reads as unknown and draws
   * in the app's face (src/web/voice.ts § `gistVoice`).
   */
  gistVoice?: "ai" | "author";
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
   * **Absent rather than `"private"`, and that is not a spelling choice.**
   * `describeArticle` keeps the key only when the row says `public`
   * (src/library-scalars.ts), so an unshared document has one spelling and not
   * two. The rule dates from the filesystem store (gone 2026-09-05), which had
   * no visibility column at all: absence was the only answer both stores could
   * give about a document nobody had shared, and a `"private"` from one and an
   * absence from the other would have been a parity failure about nothing.
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
  /** Owner-only fact that a private link is on, independently of public visibility. */
  privateLinkOn?: boolean;
  /**
   * Whether the pipeline can safely reuse the stored source document. A
   * rebuild with no web address leaves `fetch` unforced, so this is exactly
   * that step's skip condition on the current published revision: a
   * `raw_source_kind` and a completed `fetch` run must both be present. Either
   * missing means the job would attempt stage 1 and fail for want of an address
   * (feedback 6B,
   * docs/plans/260930d-shelf-rebuild-for-articles-with-no-fetchable-address.md).
   *
   * Required so a cached row written before this fact existed is rejected,
   * rather than silently treated as safe (`src/web/lib/cached-shelf.ts`).
   */
  sourceReusable: boolean;

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
  /**
   * **`'minimal'` for a paper on the shelf with only its title, authors and
   * abstract read** — no blocks and no tree, so its `words`, `blocks`, `parts`
   * and `sections` are 0 and opening it shows the not-yet-read page with *Read
   * this* (plan 261001m). `'full'` for everything else.
   *
   * The server always sends it. **Optional only for shelf rows cached in the
   * browser before this field existed**, as `revisionId` is — and every one of
   * those is a full article, because no minimal paper existed then, so a
   * missing value reads as `'full'`.
   */
  processing?: "minimal" | "full";
  /**
   * **The reader's own tags on this article**, lowercase and sorted
   * (src/tags.ts). Private: the owner's shelf listing carries them, the public
   * shelf never does (src/public/dto.ts builds its own rows). Optional only for
   * a shelf row cached before tags existed; read absent as none. Plan 261003d.
   */
  tags?: string[];
  /** A minimal paper's abstract and DOI, as the `metadata` step read them. Absent otherwise. */
  abstract?: string;
  doi?: string;
}

/**
 * **What a reader is told about a paper that has not been read through yet** —
 * the body of the `409 not-processed` that `loadArticle` answers for a minimal
 * article (`NotProcessed`, src/not-processed.ts), and enough to draw the page:
 * `{ error, code: "not-processed", paper: UnreadPaper }`.
 *
 * Owner-facing only: it is only ever thrown from the owner's own reads.
 */
export interface UnreadPaper {
  slug: string;
  title: string;
  /** `title` is the reader's rename — `Article.titleOverridden`, for the same reason. */
  titleOverridden: boolean;
  /** In the paper's order; empty when nobody was named. */
  authors: string[];
  abstract?: string;
  doi?: string;
  /** The reader's own name for the file, when it came off their disk. */
  filename?: string;
  /** What the file is, for the download link's wording. Null when nothing recorded it. */
  kind: "pdf" | "html" | null;
  /** When it was added, ISO — the shelf's `addedAt`. */
  addedAt: string;
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
 * The whole body of `GET /api/library/terms` — the shelf's filter topics.
 * docs/plans/260928a-shelf-facet-terms.md § The route.
 *
 * Counts are **physical articles**, never grouped works, so six copies are six
 * cards and a count of six. The coverage statistics are deliberately not here:
 * they live in `npm run shelf-terms:report`.
 */
/** `GET /api/library/tags` — every tag the reader uses, sorted, with counts. Plan 261003d. */
export interface LibraryTagsResponse {
  tags: { tag: string; count: number }[];
}

/** `PATCH /api/library/:slug/tags` — the article's tags after the edit, sorted. */
export interface ArticleTagsResponse {
  tags: string[];
}

export interface LibraryTermsResponse {
  /** Best first. Empty below 8 distinct works, or while everything is pending. */
  terms: {
    /** Lowercased, plural-folded — what `?topics=` names. */
    key: string;
    label: string;
    /**
     * Every member article. A phrase topic's are ordered by how often each uses
     * the phrase, then slug, and carry that `count`. **A model-named topic's
     * are newest first and carry no `count`**: there is no phrase to count
     * (plan 261003f), and a made-up 1 would print "used 1 time".
     */
    articles: { slug: string; count?: number }[];
    /**
     * How coarse or fine the topic is, 0 (a broad subject) towards 1. Only on
     * a model-named topic; the list arrives broad first. Greg, 2026-10-03.
     */
    granularity?: number;
    /** The `key` of the broader topic this one is inside, when it has one. */
    within?: string;
  }[];
  scope: {
    /** The whole visible shelf, including skipped and pending articles. */
    articles: number;
    /** Distinct eligible works (exact counted-text copies are one) among those read. */
    works: number;
    /** Read articles the extractor skipped — not English, or no prose. */
    skipped: number;
  };
  /**
   * Articles not yet read; ask again until this is 0. Normally the visible
   * scope. While preparing one model tree over active + archived together it
   * can temporarily include archived articles outside the current view.
   */
  pending: number;
  /**
   * Whose ranking `terms` is: `"model"` when a stored model score for this
   * scope was applied (possibly from an older shelf — the candidates it did not
   * score are left out), `"program"` for the deterministic chooser alone.
   * docs/project/shelf-terms.md.
   */
  chosenBy: "model" | "program";
  /**
   * A model refresh for this shelf is under way. Ask again a little later — a
   * bounded number of times — and the model's pick will be in the answer.
   */
  refreshing: boolean;
  /**
   * How many articles in this view are not in the model's topics yet because
   * they arrived after it was last worked out. They are sorted in by
   * themselves; until then they are missing under a chosen topic, so the row
   * says so. Absent when there are none, and on the phrase row.
   */
  sorting?: number;
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
  /**
   * `title` is the reader's rename rather than the article's own — so the hit
   * can draw it in the right face (src/web/voice.ts § `articleTitleVoice`).
   * Decided by the same `coalesce` that chose `title`.
   */
  titleOverridden: boolean;
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
  /**
   * The article is archived. Only ever true when the search was asked to
   * include the archive (`?archived=1`, the shelf's Include archived chip), and
   * the client marks such a passage the way it marks the card.
   */
  archived: boolean;
}

/** What GET /api/library/search returns. */
export interface LibrarySearchResponse {
  /** Echoed back, so a late response can be dropped by a client that has moved on. */
  query: string;
  /** Echoed too: whether archived articles were searched (`?archived=1`). */
  archived: boolean;
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
  /**
   * With `archived` false only: how many archived articles have a matching
   * passage — counted on the server, before any cap, so it is exact. The shelf
   * puts it beside the Include archived button under the search's answer
   * (Greg, spya-s9fhmw; plan 261002b § Part D). Absent when `archived` is true,
   * because then they are in `hits` already.
   */
  archivedArticles?: number;
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
 * **An article's private link, as its owner is told about it** — what
 * `GET`, `POST` and `DELETE /api/article/:slug/share-link` all answer.
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 *
 * A union, so "on with no key" and "off with a key" cannot be written. The
 * link itself is `/read/<slug>?key=<key>`; the client builds it, from
 * `SHARE_KEY_PARAM` in src/share-key.ts.
 *
 * **`key` is a credential, and this is the only response that carries it.**
 * It is not on the article, the shelf, the export or anything a visitor is
 * sent. Do not log this value or put it in an error.
 */
export type ShareLinkState =
  | { on: false }
  | {
      on: true;
      /** The 22-character key. Anybody who has it and the slug can read the article. */
      key: string;
      /** ISO time this key was made. Making a link again makes a new key and moves this. */
      since: string;
    };

/**
 * Everything the owner's Access & Sharing card needs, in one block.
 *
 * **Extends `VisibilityState` rather than restating it**, so the card reads the
 * `PUT`'s reply and the page load with the same two fields and they cannot
 * drift — while `VisibilityState` itself stays what the switch returns and
 * gains nothing about artefacts, which are not the switch's business.
 */
/**
 * **Which shareable artefacts this article actually has.**
 *
 * Declared here rather than in [public-types.ts](public-types.ts), which is
 * where it is *used* and where its history is, and which re-exports it so that
 * every existing importer is unchanged. It moved on 2026-09-02 because
 * `ArticleSharing.available` below needs the same booleans.
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
  /**
   * **The eighth, since 2026-09-29** — a stored Skim route. It was
   * `owners-only` for the cost of *planning* one, which a visitor was never
   * going to pay; reading one is a column on the row the public read already
   * fetches. SPIDERYARN-READING2-56,
   * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md.
   */
  skim: boolean;
  /**
   * **The ninth, since 2026-09-29** — a stored FAQ. `owners-only` until then
   * for the cost of *asking* for one; showing one is a column on the row the
   * public read already fetches. SPIDERYARN-READING2-56, plan 260929c stage 2.
   */
  faq: boolean;
  /**
   * **Since 2026-09-30** — a stored Simple, Summary's plain-words sub-mode.
   * Readable by a visitor from the day it was built; only *making* one is the
   * owner's. docs/plans/260930i-simple-summaries-eli15-sub-mode.md.
   */
  simpleSummary: boolean;
  /**
   * **The tenth, since 2026-09-29** — a stored Citations list, each work's
   * address re-judged at the boundary and the owner's *Find it* results left
   * behind. SPIDERYARN-READING2-56, plan 260929c stage 3.
   */
  citations: boolean;
  /**
   * **The eleventh, since 2026-09-29** — a stored Debate. `owners-only` until
   * then, as a staging decision (the boundary its rows' addresses must pass was
   * not built) and for the cost of *running* a search, which a visitor never
   * pays. SPIDERYARN-READING2-56, plan 260929c stage 4.
   */
  debate: boolean;
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
   * Non-null `profileHash` is what decides it. The exhaustive set is derived
   * from `ArtifactMap` by `ProfileCarrying` in src/store/pg.ts, so adding a
   * carrier cannot silently leave this list behind. The tree and the arc
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
   * **Which artefacts a shared link would actually carry** — the same
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

  /**
   * **The reader's own tags on this article**, lowercase and sorted
   * (src/tags.ts) — the editor near the top of the page. Plan 261003d.
   */
  tags: string[];

  /**
   * **When High-powered AI was switched on for this article, or `null`** —
   * `articles.high_power_since`, off the row already in hand.
   * docs/plans/260930f-high-powered-ai-per-article.md. The column, not the
   * effect: the switch on `/metadata` is shown only to an administrator, and
   * only their articles ever run it (`articlePower`, src/models.ts).
   */
  highPowerSince: string | null;

  /**
   * **What a glossary run pressed on this page would do with the list it
   * finds** — `glossaryRunKind` in src/glossary.ts, which is `existingFor` read
   * for a person: `append` (a *Find more terms*), `rewrite` (a new list in
   * place of this one), `first` (there is none), or `null` when the server
   * cannot tell. Judged against the reader's current profile, because that is
   * what Metadata's press sends.
   * docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md § 3.
   *
   * Optional for the same reason `sharing` is: a fabricated body in a test, or
   * an older server, simply has no verdict, and the row keeps its hedge.
   */
  glossaryRun?: "first" | "append" | "rewrite" | null;

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
   * projection already carries every artefact that can hold a
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
   * say" is one fact — the block is missing — rather than
   * three independent unknowns. Two optionals would also admit a state where
   * visibility is known and personalisation is not, which cannot occur and which
   * the client would still have to branch for.
   *
   * ## Why absent rather than a default
   *
   * **The Postgres store always sends the block** (src/store/pg.ts §
   * `sharing`), so today the field is optional for historical reasons. The
   * filesystem store, which went on 2026-09-05, had no `visibility` column and
   * nowhere to put one, so it could not answer. The first version of this was
   * required and that store reported `private`, on the reasoning that nothing
   * *could* be shared there so `private` was the truth.
   *
   * That was wrong: a store with no honest answer must
   * **refuse to answer** rather than supply a plausible one. A required
   * `private` was a claim the store was in no position to make, and the card
   * would have drawn *"Only you can read this"* — confidently, and with no way
   * to be right — over every article in development.
   *
   * Absent still means *nobody could say*. The card keeps its "we could not
   * check" state for it (src/web/AccessSharing.tsx), which is true, and
   * nothing throws.
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

/**
 * **Which of the two live-conversation engines a call is on.** `realtime` is
 * OpenAI Realtime, one model that listens, thinks and speaks; `gpt-live` is
 * GPT-Live, a voice model with a text model behind it. Built side by side to be
 * compared, and one of them will be deleted —
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md.
 *
 * Here for the reason `MicPlacement` is: the browser names the engine when it
 * saves a spoken exchange and the server checks the string, so both ends need
 * the one union.
 */
export type LiveEngine = "realtime" | "gpt-live";

/** The same two as a value, tied to the union by `satisfies`. */
export const LIVE_ENGINES = ["realtime", "gpt-live"] as const satisfies readonly LiveEngine[];

/** Is this string one of ours? The gate a wire-read engine goes through. */
export function isLiveEngine(x: unknown): x is LiveEngine {
  return typeof x === "string" && (LIVE_ENGINES as readonly string[]).includes(x);
}

/**
 * **What `POST /api/chat/:slug/:threadId/live-session` answers** — everything
 * the browser needs to open one GPT-Live call, and nothing it could use to
 * change what the models were told.
 *
 * No seed and no expiry. The history went to OpenAI inside the create request
 * (`session.input`), so there is nothing for the browser to replay; and the
 * create response carries no expiry — `session.started` on the data channel
 * does (`session.expires_at`).
 */
export interface GptLiveTicket {
  /** The SDP answer, to set as the peer connection's remote description. */
  sdp: string;
  /**
   * **Our** journal row's id — what `/api/live/:sessionId/connected`, `/usage`
   * and `/close` are addressed to. Not OpenAI's.
   */
  sessionId: string;
  /** OpenAI's id for the session (`live_…`). The same one `session.started` carries. */
  liveSessionId: string;
  /** The row the first spoken append must claim, or `null` for an empty thread. */
  tailId: string | null;
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
 *
 * **Or no quote at all, since 2026-09-12: a bookmark on the whole paragraph.**
 * `CommentAnchor` below.
 */
export type Comment = CommentFields & CommentAnchor;

/**
 * **A highlight's colour, by name.** Stored as the name, never a hex value, so
 * the palette can be retuned for dark mode or contrast without a migration;
 * the washes are `--hl-*` in src/web/styles/tokens.css. The database's
 * `comments_colour` CHECK lists the same four by hand.
 */
export type HighlightColour = "yellow" | "green" | "blue" | "pink";

/** The four, as a value, in the order the swatch rows show them. */
export const HIGHLIGHT_COLOURS = [
  "yellow",
  "green",
  "blue",
  "pink",
] as const satisfies readonly HighlightColour[];

/** Is this value off the wire one of ours? */
export function isHighlightColour(x: unknown): x is HighlightColour {
  return typeof x === "string" && (HIGHLIGHT_COLOURS as readonly string[]).includes(x);
}

/**
 * Where a comment is anchored: some words in the block, or the whole block.
 *
 * **The whole-block arm is a bookmark made from the gutter** — Greg,
 * 2026-09-12: *"so you could just say … bookmark that block as being really
 * interesting."* It carries no quote, so it draws nothing in the prose — the
 * gutter mark is the whole of it, exactly as a whole-block conversation shows
 * only its gutter chip. That is `ChatAnchor`'s `{ blockId }` arm, for the same
 * reason: underlining every word of a paragraph would make every tap in it open
 * the note, which on an iPad is how a reader selects the block.
 *
 * **A union rather than two optionals**, so "a quote with no offset" is not a
 * value the type can hold — the argument `ChatAnchor` makes. Narrow on
 * `quote !== undefined` and `start` comes with it.
 *
 * **Only ever a bookmark**: the database refuses a quote-less row whose
 * `status` is not `none` (`comments_whole_block_is_free`), so nothing that
 * answers, retries or links a conversation can reach one.
 * docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md.
 */
export type CommentAnchor =
  | {
      quote: string;
      /** Where `quote` sat in the block's rendered text when the comment was made. */
      start: number;
    }
  | { quote?: never; start?: never };

/** A whole-block comment — the reader bookmarked the paragraph, not some words in it. */
export function isWholeBlock(c: CommentAnchor): c is { quote?: never; start?: never } {
  return c.quote === undefined;
}

/**
 * Just the anchor, ready to spread into a comment or a request body: both
 * fields, or neither. Never `quote: undefined` — `exactOptionalPropertyTypes`
 * is on, and the stores compare comments structurally.
 */
export function anchorFields(c: CommentAnchor): CommentAnchor {
  return c.quote === undefined ? {} : { quote: c.quote, start: c.start };
}

interface CommentFields {
  id: string;
  blockId: BlockId;
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
   * **The highlight's colour** — absent on every comment made without one,
   * which draws the plain underline. A highlight is a comment with a colour
   * (docs/plans/261003e-span-highlights-with-a-colour.md): with no `body` it is
   * a wordless highlight, with one it is a highlighted note.
   *
   * **Only on a selection-anchored comment.** A whole-block row has no words to
   * paint, so the route refuses a colour on one and
   * `comments_colour_needs_quote` refuses it again in the database.
   */
  colour?: HighlightColour;

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
  | "fetch"
  /* A minimal paper's whole AI work: title, authors, abstract and DOI off the
     first pages, one cheap call (src/paper-metadata.ts). Only ever in the
     two-step job a minimal upload queues, `["fetch", "metadata"]` — `enqueue`
     refuses it anywhere else. docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md. */
  | "metadata"
  | "extract" | "blocks" | "structure"
  /* The per-paragraph navigation labels, which left the `structure` step on
     2026-09-06 because they were 79.5–92% of its wall clock and one measured
     call took 602s of a 682s pass — past what the job lease allows.
     `structure` now writes a `PendingLabelsFile` (src/labels.ts) and this step
     writes the real one, later, in a free successor job. **It is deliberately
     NOT in `DEFAULT_INGEST_STEPS`**, which is the whole of the change.
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md. */
  | "labels"
  | "assets" | "arc" | "tweets" | "glossary"
  /* The lines worth keeping, in the article's own words — docs/project/quotes.md.

     **Which steps share a cached article is not written in this union.** These
     comments used to say, step by step, and every one of them went stale when
     the output schema joined the cache key. `sharesArticleCache` in
     src/pipeline.ts is the policy and tests/article-cache-group.test.ts pins
     it; today no two steps share. */
  | "quotes"
  /* A route through the Quotes, at three depths —
     docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md.
     Its input is another step's artefact, like `illustrated`: it reads the
     stored Quotes and never the article's prose, so it is not an
     `ArticleStage`. */
  | "skim"
  | "ideas"
  /* When the things the piece narrates happened, and how sure it is —
     docs/project/timeline.md. */
  | "timeline"
  /* The questions the piece can ask you back, the second sub-mode of Learn —
     docs/plans/260831al-review-quiz-sub-mode.md. */
  | "quiz"
  /* The questions a careful reader would put to this piece while reading it,
     and the passages where the piece responds — docs/plans/260916d-faq-mode.md. */
  | "faq"
  /* How each paragraph bears on the one before it, one word of ten —
     docs/plans/261003f-marginalia-relation-words-and-timeline-events.md.
     Read only by Marginalia, and by the owner only. */
  | "relations"
  /* The picture a model draws of the argument — docs/project/diagram.md § Sketch.
     Nothing reads what it writes except the one below. `low` effort since
     2026-10-01 (src/models.ts § STAGE_EFFORT). */
  | "sketch"
  /* The same argument painted, docs/project/diagram.md § Illustrated. **It reads
     the Sketch as well as the article**,
     so it follows `sketch` in `STEP_ORDER` and it *refuses* rather than pulls: a request
     for it alone arrives as `steps: ["illustrated"]` and nothing puts `sketch`
     in front of it. src/pipeline.ts § illustrated. */
  | "illustrated"
  /* **What the rest of the web says about this piece** — docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
     The only step whose content is not in the article at all: it runs two
     metered web searches and returns pages that answer the piece, or the claims
     it makes.

     **It is deliberately NOT an `ArticleStage`** (src/models.ts). That type is
     the subset of these names that send the article bare on the Messages wire,
     and so could share a cached copy of it; this step is on chat/completions,
     and therefore takes no row in `STAGE_EFFORT` or `ARTICLE_RENDERER` and none
     in `cacheArticleForStep`. Stated here because mode.md lists both tables
     among the ones the compiler asks for, and a reader will otherwise go
     looking for the missing rows. */
  | "debate"
  /* **Every work the piece cites, linked** — docs/plans/260911g-citations-mode.md.
     One Messages-wire call over the whole article, bibliography and notes
     included, and a link derived by code from the article's own hrefs.

     **Deliberately NOT an `ArticleStage`** either, for a different reason from
     `debate`'s: it is on the Messages wire, but it sends `articleWithIds` over
     *every* block — the notes and the bibliography are the whole point — where
     `ideas`, `timeline`, `quiz`, `faq` and `sketch` send the body only. Different
     bytes from every `ArticleStage`, so no row in `STAGE_EFFORT` or
     `ARTICLE_RENDERER`; its effort is a constant in src/citations.ts. */
  | "citations"
  /* **Links between the article's own blocks** — a phrase in one block that
     refers to what another shows in detail. Ideas' article block, byte for byte
     up to the breakpoint, at `medium` effort: so it IS an `ArticleStage`. Not a mode: the links sit in the prose in every mode.
     docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
  | "crossrefs"
  /* **Simple** — a few short paragraphs in everyday words saying what the piece
     is about, why it matters and its key ideas, each resting on the passages it
     came from: a sub-mode of Summary, made on a press.
     docs/plans/260930i-simple-summaries-eli15-sub-mode.md. Ideas' article block
     at `high` effort (measured against `medium` in stage 1), so an
     `ArticleStage`. */
  | "simple";

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
  /**
   * On a `structure` step only: write the headings tree and return, so the
   * import publishes before the model call. Set by `enqueue` for a first import
   * the browser asked to open early, and honoured only while the article has
   * never been published (src/pipeline.ts § `STEPS.structure`). In the job's
   * own `steps` JSON, so it needs no column.
   */
  headingsFirst?: true;
  /**
   * **Part of what the step is making, shown before the step is over.** On the
   * job row only while the step is `running`: the runner deletes it when the
   * step starts, succeeds or fails (src/jobs.ts § `runStep`), so nothing of an
   * artefact is kept on a job. The owner's alone, as every job is, and never
   * logged. docs/plans/261004f-stop-writing-the-simple-summary-level.md § Stage 2.
   */
  preview?: StepPreview;
}

/**
 * What a running step may show early. A union on `kind`, so a later step adds
 * its own arm and a reader of the row has to say which one it wants.
 *
 * `simple-brief`: Summary's Brief paragraphs, final and checked, while Fuller
 * is still being written. They are stored, with Fuller, only when the step ends.
 */
export type StepPreview = { kind: "simple-brief"; paragraphs: SimpleParagraph[] };

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
   * Postgres reads it off `jobs.requeues`. The filesystem adapter, which went
   * on 2026-09-05, kept the *budget's* count in memory and wrote this field
   * alongside so the two stores handed the client the same shape.
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
  /**
   * **The reader's note on how the Illustrated picture should come out** —
   * present only on a job naming `illustrated` whose reader typed or dictated
   * one in the box under the picture. Checked once at the route
   * (`checkIllustrationNote`, src/illustrated-plate.ts), frozen here for the
   * reasons `profile` gives above (a restart, a Retry), and compared by
   * `sameWork`. Stripped from the wire by `publicJob`, like the profile: it is
   * the reader's own words, and the panel reads it off the picture instead.
   * docs/plans/261002j-illustrated-steering-note.md.
   */
  illustrationNote?: string;
  /**
   * **Present exactly when this job is a reset** — "as if just imported", with
   * the extras dropped. `jobs.reset` in src/db/schema.ts; src/reset.ts says
   * what an extra is. Absent on every other job.
   */
  reset?: JobReset;
}

/**
 * **What a reset job carries**, written once at the press and never changed.
 *
 * `regenerate` is the extras to queue again once the reset publishes, in
 * `STEP_ORDER` order — the extras the article *had* when the reader asked for
 * them to be made again, else empty. `profile` is the reader's profile resolved
 * at that same moment, exactly as `POST /api/jobs` resolves one, so each
 * regenerated artefact is written for the reader as they were when they pressed
 * (Sol F2). Neither is interpreted by the reset's own steps: the draft reads
 * `reset` to drop the extras, and the publication reads it to queue them.
 * docs/plans/260928a-reset-and-regenerate-article.md.
 */
export interface JobReset {
  regenerate: StepName[];
  profile?: string;
}

/**
 * What `POST /api/article/:slug/reset` answers with (202): the reset job to
 * follow, and the extras it will queue again once it publishes — empty when
 * the reader did not ask for them, or the article had none.
 */
export interface ResetResponse {
  jobId: string;
  regenerate: StepName[];
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
   * Which stance produced this answer — **legacy, read-only**. Assistant turns
   * of Learn threads written before 2026-10-02 carry one; nothing writes it
   * since Recall became one voice, and nothing on screen shows it. It is kept
   * because the stored rows have values (the column and its CHECK stay, and an
   * export carries them) — dropping it would be destructive and buy nothing.
   * docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md;
   * the original rule is docs/plans/260827ah-review-mode.md.
   */
  stance?: LearnStance;
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
   * follow above, and what tests/store-roundtrip.test.ts compares.
   */
  help?: true;
  /**
   * **When the reader first pressed Hint under this answer.** Assistant turns
   * of Recall (`learn`) threads only.
   *
   * The hint is the answer's own last paragraph (`splitHint` in
   * src/recall-hint.ts); this is the record that the reader opened it. Set once
   * by the first press, cleared when a retry replaces the answer. It keeps an
   * opened hint open after a reload, and `answerAsSeen` reads it so that Live
   * and `reader_notes` are not told about a hint nobody looked at.
   *
   * Absent, never null — the rule every optional field here follows.
   * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md.
   */
  hintOpenedAt?: string;
}

/**
 * How much the model should say in a Learn answer — the reader's choice, per
 * turn, **until 2026-10-02**. Greg named all four on 2026-08-27
 * (docs/plans/260827ah-review-mode.md § The stance) and asked for one adaptive
 * voice instead on 2026-10-01 (`spya-c8x66d`). Legacy now: the type of stored
 * rows, and of the one request field the route still validates and drops.
 */
export type LearnStance = "balanced" | "respond" | "socratic" | "signposts";

/**
 * The four, as a value — what the route accepts (and drops) from a tab still
 * running a client from before the picker went. `streamChat` in src/routes.ts.
 */
export const LEARN_STANCES: readonly LearnStance[] = [
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
 * and one of them will eventually be missed — which is a Learn thread answered
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
 * move fails every Learn insert with `23514`, so the discriminant, the schema
 * and the data moved in one step: drizzle/0048_rename_review_thread_kind.sql
 * drops the constraint, updates the rows, then re-adds it with `'remember'`.
 * Anything else that speaks this wire value — `src/routes.ts`'s validation, the
 * export/import shapes, the committed fixture corpus — moved with it.
 * docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md § Stages.
 *
 * **And `remember` until 2026-10-06**, when the identifiers followed the
 * reader's word, Learn. The same one step:
 * drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql,
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md.
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
export type ThreadKind = "chat" | "learn" | "candidates" | "tutorial" | "explore";

/**
 * The thread kinds, as a value, and the predicate both ends validate with.
 *
 * **One list**, for the reason `LEARN_STANCES` below gives about itself and
 * for one more that is specific to this field: every reader of a stored kind
 * has to agree on the list. A kind added to the union and missed by one of
 * them used to be a thread that silently became a chat on its next read —
 * answered with chat's prompt, with nothing on screen disagreeing, which is the
 * failure the `kind` field was introduced to prevent. Since they all go
 * through `isThreadKind`, adding a member is one edit rather than four.
 *
 * Since 2026-10-06 the two Postgres readers (src/store/pg-chat.ts and
 * src/store/export.ts) no longer coerce at all: `storedThreadKind` below
 * refuses a kind that is not on this list. Since 2026-10-07 neither does the
 * fixture-file reader, `kindFromFile` in src/chat.ts: it supplies `"chat"` only
 * for an absent kind, and reads `RETIRED_THREAD_KINDS` below.
 */
export const THREAD_KINDS: readonly ThreadKind[] = ["chat", "learn", "candidates", "tutorial", "explore"];

/**
 * **Words a thread kind used to be, and what each became.** The database
 * renamed them by migration — `review` → `remember` in
 * drizzle/0048_rename_review_thread_kind.sql, `remember` → `learn` in
 * drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql — but
 * database migrations do not update `chat.json` on disk, so a file reader
 * needs the same map.
 * A rename of a kind adds its old word here, pointing at the final one.
 * docs/postmortems/261007a-a-renamed-enum-word-read-by-a-lenient-reader-becomes-its-default.md.
 */
export const RETIRED_THREAD_KINDS = {
  review: "learn",
  remember: "learn",
} as const satisfies Record<string, ThreadKind>;

/**
 * **The kinds an article has at most one of** — Learn's Recall, Tutorial and
 * Explore, each its own single conversation with no list (docs/plans/261001m-remember-is-its-own-single-thread.md,
 * Tutorial since docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md,
 * and Explore since docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md).
 * A partial unique index per kind holds it in the database
 * (`chat_threads_one_learn`, `chat_threads_one_tutorial`,
 * `chat_threads_one_explore`); this is the list `targetOf` in src/chat.ts and
 * `ConversationBand` read, so the two ends agree.
 *
 * Single-thread is ONE property. It does not say what a kind is called, what
 * its empty box says, or whether it offers Live — those are decided per kind.
 */
export const SINGLE_THREAD_KINDS = ["learn", "tutorial", "explore"] as const satisfies readonly ThreadKind[];
export type SingleThreadKind = (typeof SINGLE_THREAD_KINDS)[number];

export function isSingleThreadKind(kind: ThreadKind | undefined): kind is SingleThreadKind {
  return kind !== undefined && (SINGLE_THREAD_KINDS as readonly string[]).includes(kind);
}

/**
 * The most block ids one chat question may say were on screen. A screenful is a
 * few dozen even of one-line blocks on a tall monitor; this bounds a request,
 * and the client trims to it rather than having Send refused.
 * docs/plans/261001q-chat-knows-the-blocks-on-screen.md.
 */
export const MAX_VISIBLE_BLOCKS = 100;

/** Is this a current thread kind? Used by the file and database readers and the route. */
export function isThreadKind(value: unknown): value is ThreadKind {
  return typeof value === "string" && (THREAD_KINDS as readonly string[]).includes(value);
}

/**
 * The database holds a thread kind this code has no name for.
 *
 * **A 409, carried on the class**, which is the door src/store/db-errors.ts
 * asks a refusal to use: the store's guard passes anything with a numeric
 * `status`, and `serveApi` answers with it. 409 and not 500 because the browser
 * has usually already drawn the Retry or Edit this refuses, and a 409 is the one
 * answer it puts the screen back for (src/web/chat/effects.ts § `runTurn`); a
 * 500 it commits, blanking an answer Postgres still holds.
 *
 * **So the message is the reader's**, since below 500 the message is what the
 * response says. What was stored is on `stored`: a column a CHECK constrains to
 * a handful of words chosen in a migration, never anybody's prose.
 */
export class UnknownStoredThreadKind extends Error {
  override readonly name = "UnknownStoredThreadKind";
  readonly status = 409;
  constructor(readonly stored: unknown) {
    super(CHAT_BEING_UPDATED.message);
  }
}

/**
 * **A kind read from `chat_threads`, or a refusal. Never a default.**
 *
 * The column is `not null` with a CHECK listing the kinds, so a value outside
 * `THREAD_KINDS` can only mean the database is newer or older than this code.
 * Until 2026-10-06 both Postgres readers answered that with `"chat"`: a Retry
 * or Edit of a Recall answer was then answered under Chat's prompt and stored
 * over the original, and an export labelled the conversation a chat, with
 * nothing failing. Refusing costs a failed request for the minutes a deploy
 * takes; coercing cost a wrong answer that stayed.
 * docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md,
 * stage 0, and docs/reusable/silent-success.md.
 */
export function storedThreadKind(value: unknown): ThreadKind {
  if (isThreadKind(value)) return value;
  throw new UnknownStoredThreadKind(value);
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

/**
 * **Where a conversation was started from, when it was started from an item
 * in another mode** — Debate's *Check this claim in chat* is the first caller.
 * Plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D1.
 *
 * Not a `ThreadKind` and not the anchor. Kind chooses the prompt and tools,
 * and a claim check is an ordinary chat. An anchor says "this is the chat
 * about this passage" to the prose marks and the gutter chip, which a claim
 * check is not. One meaning per field.
 *
 * **A union on `mode`**, so a claim cannot exist without its block and its
 * words. A claim has no id: its identity is `(blockId, quote)`, the article's
 * own words as they were when the chat started. `summary` is reserved and
 * not built: `chat_threads_origin_mode` in src/db/schema.ts lists it, and the
 * route accepts only the modes that are built (`ORIGIN_MODES`).
 *
 * **A glossary entry and a cited work since 2026-10-06**
 * (plan docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md, D1):
 * each has a durable id, so the id is its identity and the name beside it is
 * a snapshot. See `GlossaryOrigin`.
 *
 * **Debate has two shapes since 2026-10-05, and `mode` does not tell them
 * apart** (plan docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md, A):
 * a claim, and a *lens*, an angle the reader typed to look at the debate from.
 * Both say `mode: "debate"`, so narrowing on `mode` reaches neither's fields.
 * Ask `isLensOrigin` or `isClaimOrigin`; a claim never equals a lens
 * (`sameOrigin`).
 *
 * Set on the turn that creates the thread and never again, like `anchor`.
 * Written by conditional spread, never `origin: undefined`.
 */
export type ThreadOrigin = ClaimOrigin | LensOrigin | GlossaryOrigin | CitationsOrigin;

/** One of Debate's claims: the block it sits in and its words when the chat started. */
export type ClaimOrigin = { mode: "debate"; blockId: BlockId; quote: string };

/**
 * An angle the reader asked to see the debate from: their own words, trimmed
 * and non-empty, at most `MAX_LENS_CHARS`. No block and no quote. Two chats
 * may share one lens; they are then two lines in Debate's *Your angles*.
 */
export type LensOrigin = { mode: "debate"; lens: string };

/**
 * **One entry of the Glossary**: its id, and its name when the chat started.
 *
 * The id is durable (inherited across regenerations, src/glossary.ts), so
 * **the origin is matched by `mode` and `itemId` alone** (`sameOrigin`) and
 * the entry's mark survives a regeneration that rewords it. `quote` is a
 * snapshot of the name, kept so the chat's title and the tooltip in Chat's
 * list need no look-up and still read once the entry has gone. At most
 * `MAX_ORIGIN_NAME_CHARS`; the sender cuts it with `originName`.
 */
export type GlossaryOrigin = { mode: "glossary"; itemId: string; quote: string };

/** One work the article cites: its id, and its title when the chat started. `GlossaryOrigin`'s rules. */
export type CitationsOrigin = { mode: "citations"; itemId: string; quote: string };

/**
 * The most the name snapshot of a glossary or citations origin may be. The
 * route refuses a longer one, so **every sender cuts with `originName`**: a
 * glossary name has no length limit of its own (plan 261006d's review, F1).
 */
export const MAX_ORIGIN_NAME_CHARS = 300;

/**
 * An entry's name as its origin stores it: trimmed, and cut to
 * `MAX_ORIGIN_NAME_CHARS` without leaving half a surrogate pair. A cut is
 * fine here, unlike a lens: the name is a label and the id is the identity.
 */
export function originName(name: string): string {
  const clean = name.trim();
  if (clean.length <= MAX_ORIGIN_NAME_CHARS) return clean;
  return clean
    .slice(0, MAX_ORIGIN_NAME_CHARS)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd();
}

/**
 * The most a lens may be. The cap of *why you're reading this*, because the
 * command bar will build a lens from that text (the plan's part B). A longer
 * one is refused, not cut: a cut lens is a different question.
 */
export const MAX_LENS_CHARS = MAX_PURPOSE_CHARS;

/** Is this origin a lens, and not a claim? The one place the two shapes are told apart. */
export function isLensOrigin(origin: ThreadOrigin): origin is LensOrigin {
  return "lens" in origin;
}

/** Is this origin one of Debate's claims: the one shape that names a block? */
export function isClaimOrigin(origin: ThreadOrigin): origin is ClaimOrigin {
  return origin.mode === "debate" && !isLensOrigin(origin);
}

/** The origin modes that are built. The route refuses any other. */
export const ORIGIN_MODES = ["debate", "glossary", "citations"] as const satisfies readonly ThreadOrigin["mode"][];

/**
 * Are these the same anchor? What the route's 409 and `withTurn`'s refusal
 * inside the store's transaction both ask, so there is one answer. It lived in
 * src/routes.ts, private, until 2026-10-07.
 *
 * A thread with no anchor is **not** the same as one with any anchor: a send
 * offering a passage for an unanchored conversation is still trying to change
 * what that conversation is about, and it is refused. `undefined` on both sides
 * cannot reach here: a caller only asks when it has one to offer.
 */
export function sameAnchor(stored: ChatAnchor | undefined, wanted: ChatAnchor): boolean {
  if (!stored) return false;
  if (stored.blockId !== wanted.blockId) return false;
  const a = "quote" in stored ? stored : null;
  const b = "quote" in wanted ? wanted : null;
  if (!a || !b) return a === b; // both block-only, or one of each
  return a.quote === b.quote && a.start === b.start;
}

/**
 * Are these the same origin? What the route's 409 and the caller's way back
 * both ask, so there is one answer. Exact: a claim reworded by a new search is
 * a different claim. **A claim and a lens are never the same**, whatever their
 * words, so the shapes are compared before any field is.
 *
 * **A glossary entry or a cited work is its id**: the name is a snapshot and
 * is not compared, so a reworded entry is still the same origin (plan
 * 261006d, D1).
 */
export function sameOrigin(a: ThreadOrigin, b: ThreadOrigin): boolean {
  switch (a.mode) {
    case "glossary":
    case "citations":
      return b.mode === a.mode && a.itemId === b.itemId;
    case "debate":
      if (b.mode !== "debate") return false;
      if (isLensOrigin(a)) return isLensOrigin(b) && a.lens === b.lens;
      return !isLensOrigin(b) && a.blockId === b.blockId && a.quote === b.quote;
    default:
      return a satisfies never;
  }
}

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
   * branch that builds a new thread, and refuses a different one offered for a
   * thread that exists (`sameAnchor`); the route refuses it first, for
   * the sentence. A thread with **no** anchor is refused one too.
   */
  anchor?: ChatAnchor;
  /**
   * The item in another mode this conversation was started from, if it was.
   * Set on the turn that creates the thread and never again. See `ThreadOrigin`.
   */
  origin?: ThreadOrigin;
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
   * Where the conversation was started from. A caller mode finds its own
   * conversation by matching this (`threadForOrigin` in
   * src/web/useChatAnchors.ts); nothing is stored on the item's side.
   */
  origin?: ThreadOrigin;
  /**
   * Chat or Learn — which the reading view needs even though it draws no
   * Learn marks.
   *
   * `?thread=` opens the floating `ChatDialog` in every mode but the two
   * conversation modes, and that dialog is chat's UI and asks with chat's
   * prompt. A pasted `?mode=toc&thread=<a Learn thread>` would therefore
   * continue a Learn conversation as a chat. The overlay is gated on this
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
/**
 * **Which matcher answered a saved search** — `"meaning"` (the model reads the
 * article and quotes what matches, src/search.ts) or `"quick"` (Jev scores every
 * block, src/quick-search.ts). Plan 261002e.
 */
export type SearchKind = "quick" | "meaning";

/** The two, as a value, for a route to narrow a request body against. */
export const SEARCH_KINDS = ["quick", "meaning"] as const satisfies readonly SearchKind[];

export function isSearchKind(x: unknown): x is SearchKind {
  return (SEARCH_KINDS as readonly unknown[]).includes(x);
}

export interface SearchRun {
  id: string;
  /** What the reader typed, in their own words. Never logged — it is prose. */
  criterion: string;
  /**
   * **Which matcher this run is** — stated on the row, never inferred from
   * `model`, because a pending or failed run has no model yet and the panel
   * still has to label it. Part of a run's identity: a retry keeps it, and a
   * retry that names the other kind is a new run (`withRun`, src/searches.ts).
   * Every row written before 2026-10-02 is `"meaning"`, which is what the
   * column's default says.
   */
  kind: SearchKind;
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
  /** True when the parser supplied the year rather than the article writing it here. */
  yearFilled: boolean;
  /**
   * **Where a supplied year came from, when it was not the publication date**:
   * `"piece"` is the one year the piece itself states (`pieceYear`,
   * src/timeline-time.ts), used when we have no publication date. It is an
   * assumption and the panel says so. Absent on a year taken from the
   * publication date, and on everything written before 2026-10-05.
   *
   * On the row rather than the artefact so that it travels wherever the event
   * does, a shared link's payload included, and cannot disagree with the row.
   */
  yearFrom?: "piece";
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
  /**
   * 0–1: how influential the work is in its field. **The model's memory**, weaker.
   * **Absent means no usable score**: `citations/6` asks for a number only when
   * confident, else null, stored as no field (plan 261003m). Missing/rejected
   * values share that shape. New low numbers mean "known, and minor"; older
   * lists retain low numbers that may have meant "I do not know this work".
   */
  influence?: number;
  /** The bibliography / reference-list / note entry, if the article has one. */
  reference?: CitationPlace;
  /**
   * **The work's entry as the article gives it**, ≤ 400 characters, whitespace
   * collapsed — where journal, conference, volume and pages are. Always the
   * article's own characters, sliced by code: the text of the `reference`
   * block, or, for a PDF, the entry found in the reference list read from its
   * text layer (src/citation-reference-list.ts), which is not a block because
   * stage 2 does not render it. Plan 260930i. A visitor gets it only when it
   * is its `reference` block's own text — never a PDF list's, which can hold a
   * download stamp (`publicEntry` in src/public/dto.ts, plan 261001b).
   */
  entry?: string;
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
  /**
   * **Stage 3's find, when `linkFrom` is `web`** — attached at read time from
   * `citation_finds`, never stored in the artefact. `title` is the search
   * result's own, not the model's. Absent on every other row.
   */
  found?: CitationFound;
  /**
   * **What *Look it up* read from a search extract for this work** — attached
   * at read time from `citation_finds` on any row, whatever its link, and only
   * while its context fingerprint matches this list (src/citation-lookup.ts).
   * Owner-only: never crosses the public boundary.
   */
  lookup?: CitationLookup;
  /**
   * **What *Investigate* wrote about this work** — attached at read time from
   * `citation_investigations`, only while its context fingerprint matches what
   * would be sent now (src/citation-investigate-context.ts). Owner-only: never
   * crosses the public boundary.
   */
  investigation?: CitationInvestigation;
  /**
   * **This work is already an article here, and one the reader may open** —
   * their own, or a public one. Attached at read time by the owner's
   * `GET /api/citations` only (src/store/cited-in-spideryarn.ts), never stored,
   * never on a visitor's list. docs/plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md.
   */
  inSpideryarn?: CitedInSpideryarn;
  /**
   * **What Crossref or DataCite holds under the row's DOI or arXiv id** —
   * written by the `citations` step after the model's list is built
   * (src/citation-registry.ts, plan 261001a stage 5), so it is stored, unlike
   * the read-time fields above. `found` only when the registry's title agrees
   * with the article's; `conflict` when it does not — the article's identifier
   * points at a different work. Absent: not looked up, nothing found, or a
   * revision from before the stage.
   */
  registry?: CitationRegistry;
}

/** The two registries a record can come from (src/bibliographic.ts § `Registry`). */
export type RegistrySource = "crossref" | "datacite";

/**
 * **A registry's record, as a row keeps it** — Citations' and Debate's
 * (plan 261001a stages 5 and 6). Public metadata about a public identifier.
 * Never read straight off a stored row on the client: nothing revalidates
 * stored JSON, so read it through a guard.
 */
export interface RegistryWork {
  source: RegistrySource;
  title: string;
  /** In the registry's order, at most `REGISTRY_AUTHORS_KEPT` (src/citation-registry.ts). An organisation is a `family` alone. */
  authors: { family: string; given?: string }[];
  /** How many more authors the registry lists past those kept; absent when none. */
  moreAuthors?: number;
  year?: number;
  venue?: string;
}

/**
 * **Crossref's count of the works that cite this one, and when it was read**
 * (plan 261005i): `is-referenced-by-count`, a dated snapshot and never a live
 * number. Only ever beside a Crossref record. `readAt` is ISO, by the
 * database's clock.
 */
export interface RegistryCitedBy {
  count: number;
  readAt: string;
}

/**
 * Citations' registry field: a record whose title agrees, or the fact that it
 * does not. `citedBy` is on the `found` arm alone, and not on `RegistryWork`:
 * a conflict's record is another work, whose count is not this row's, and
 * Debate's rows do not ask.
 */
export type CitationRegistry =
  | ({ kind: "found"; citedBy?: RegistryCitedBy } & RegistryWork)
  | { kind: "conflict"; source: RegistrySource };

/**
 * How a cited work was matched to an article here, strongest first. `title` is
 * the weakest — the same words, not the same identity — and the row says so.
 */
/**
 * `guessed-id` — the DOI or arXiv id **we found** for the reader's own upload
 * (`upload_source_guesses`, a `canonical` row), not one the article itself
 * carries; said as ours, plan 261001i.
 */
export type CitedMatchedBy = "doi" | "arxiv" | "guessed-id" | "address" | "title";

export interface CitedInSpideryarn {
  slug: string;
  /** `yours` — the reader owns it; `public` — somebody shared it. */
  whose: "yours" | "public";
  matchedBy: CitedMatchedBy;
  /** The matched article's title as the reader would see it on that shelf. */
  title: string;
  /**
   * The reader's own article, archived: off their shelf, still theirs to open
   * by link (plan 261001i). Absent otherwise — never on a public match.
   */
  archived?: true;
}

/**
 * **One *Investigate* answer, as kept** — docs/plans/260930a-citations-investigate-one-work-on-demand.md.
 *
 * `answer` is the AI's prose, written from web search extracts and instructed
 * not to quote them; any quotation-marked span in it was checked by code to be
 * the article's own words, the work's title or reference, or *Look it up*'s
 * verified quotes (src/investigate-quote-guard.ts). Everything else here is
 * code's account of what was read, never the model's.
 */
export interface CitationInvestigation {
  answer: string;
  /** The results the search returned **with a non-empty extract**, and only those. */
  sources: Citation[];
  /** How many results came back with a non-empty extract — N in *extracts for N results*. */
  extractsRead: number;
  /** Words in the longest of those extracts. */
  longestExtractWords: number;
  /**
   * The host of the page *Look it up* matched to this work, **only when that
   * page was among the extracts shown to this answer**; `null` means no result
   * was confirmed to be the work itself, and the view says so.
   */
  matchedHost: string | null;
  /** Billed searches the call reported; `null` when the provider did not say. */
  searches: number | null;
  /** Which usage field `searches` came from — `SearchUsagePath`. */
  searchesFrom: string;
  model: string;
  /** ISO 8601. */
  at: string;
  /** Over everything the call was sent. Attached only while it matches. */
  contextHash: string;
  promptVersion: string;
  /**
   * **What we did about the paper itself** (plan 261001a stage 3) — code's
   * account, never the model's. **Absent on an answer written before that
   * stage**, which the row draws exactly as it did then.
   */
  paper?: InvestigatedPaper;
  /**
   * **How influential the work is, read from one page of this press's own web
   * search** (plan 261003m stage 2, src/citation-influence.ts) — an AI
   * estimate, kept only where code found the quoted words on a search result
   * whose title names the work. **Absent** when the press found nothing code
   * could keep, and on an answer from before that stage. Read it through
   * `effectiveInfluence` (src/citation-effective-influence.ts), never directly:
   * that is where a stale `version` is dropped.
   */
  influence?: CitationWebInfluence;
}

/**
 * **A cited work's influence, as one web page states it** — plan 261003m stage
 * 2. The number is the model's; the quote is the page's own characters as code
 * found them; the address and title are copied from the search result by code.
 * When it happened is the investigation's own `at`.
 */
export interface CitationWebInfluence {
  /** 0–1, on the list's rubric. */
  value: number;
  /** The page's own words the number rests on. */
  quote: string;
  /** The search result's address, through `safeUrl`. */
  sourceUrl: string;
  /** The search result's own title. A kept source always had one; optional for a stored row that lost it. */
  sourceTitle?: string;
  /** `INFLUENCE_VERSION` when it was written: the prompt and the checking rules. */
  version: string;
}

/** How code confirmed a fetched PDF is the cited work — src/paper-evidence.ts § confirmIdentity. */
export type PaperMatchedBy = "doi" | "arxiv" | "title-author";

/** The AI's reading of how one of the paper's passages bears on what the article cites it for. */
export type PaperPassageBears = "supports" | "partly" | "context";

/**
 * **One passage of the paper, found by code** — the chunk's own characters
 * (`verifyPassage`, src/paper-evidence.ts), never the model's spelling. `bears`
 * is the AI's reading.
 */
export interface PaperPassage {
  /** The chunk it was found in, `c1`… */
  chunk: string;
  /** The page that chunk starts on, 1-based. */
  page: number;
  text: string;
  bears: PaperPassageBears;
}

/**
 * **The paper, as one *Investigate* press found it** — src/paper-evidence.ts's
 * six outcomes, kept as a dated snapshot (`readAt`): nothing re-fetches on
 * read, so the row never implies the remote paper is unchanged (Sol P-10).
 * URLs and hosts are the owner's, like the rest of an investigation.
 */
export type InvestigatedPaper =
  | {
      state: "read";
      requestedUrl: string;
      finalUrl: string;
      host: string;
      /** Words in the paper's text as we read it, up to its references. */
      words: number;
      /** Words of it the AI was shown. */
      sentWords: number;
      /** The chunk ids the AI was shown, in document order. */
      chunks: string[];
      matchedBy: PaperMatchedBy;
      /** sha256 of exactly what the AI was shown — the record of what was read. */
      evidenceSha: string;
      selectionVersion: string;
      readAt: string;
      /**
       * At most three, each checked by code in the chunk it names. `[]`: the
       * AI was shown the paper and no passage it offered was found there.
       * `null`: the call for passages failed, so none was asked for
       * successfully — never drawn as *found none*.
       */
      passages: PaperPassage[] | null;
    }
  | { state: "no-address"; readAt: string }
  | { state: "unreadable"; requestedUrl: string; host: string; unreadableWhy: PaperUnreadableReason; readAt: string }
  | { state: "not-the-full-text"; requestedUrl: string; finalUrl: string; host: string; readAt: string }
  | { state: "not-confirmed"; requestedUrl: string; finalUrl: string; host: string; readAt: string }
  | { state: "identity-conflict"; requestedUrl: string; host: string; readAt: string };

export type InvestigatedPaperState = InvestigatedPaper["state"];

/**
 * `POST /api/citations/:slug/:id/investigate` — SSE. Since plan 260930d,
 * first `stage` (`{ stage: "finding" }`) and one `lookup` (a
 * `FindCitationResponse`, **already stored**) when the press looks the work up,
 * then `stage` (`{ stage: "reading" }`); then any number of `delta`
 * (`{ text }`), then exactly one of `done` (this, **written only after the
 * investigation is stored**) or `error` (`{ error }`, the reader-facing
 * sentence). On `error` no new investigation was kept — but a `lookup` that
 * arrived before it was, and its new match can detach the previous
 * investigation (its fingerprint covers the match).
 */
export interface InvestigateCitationDone {
  investigation: CitationInvestigation;
}

/**
 * Which step of the one *Dig deeper* press (was *Investigate*) is running:
 * `searching` — the forced web search, first, on every press (plan 261001p
 * stage 2); then (plan 260930d) `finding`
 * — the lookup that looks for the work's own page, only when the row has no
 * current `assessed` one — then `reading-paper` (plan 261001a stage 3: the
 * paper itself fetched and checked, and when read, its passages asked for;
 * and beside it, since plan 261003m stage 2, the influence call),
 * then `reading`, the streamed answer. Sent as a `stage` frame (`{ stage }`);
 * a `lookup` frame after `finding` carries the lookup's answer, a
 * `FindCitationResponse`.
 */
export type InvestigateStage = "searching" | "finding" | "reading-paper" | "reading";

/** What *Find it on the web* kept for one work. src/citation-find.ts. */
export interface CitationFound {
  /** The search result's own title, if it gave one. */
  title?: string;
  host: string;
  /** Billed searches the call reported; `null` when the provider did not say. */
  searches: number | null;
  model: string;
  /** ISO 8601 — a found page is a fact about the web on that day. */
  at: string;
}

/** One stored find: the page's address, plus what the row shows about it. */
export interface CitationFind extends CitationFound {
  /**
   * The search result's own URL — one of the call's annotations, never the
   * model's. **On a row the article linked, this is only the page whose
   * extract was read**, and is never drawn as the row's link (`attachFinds`).
   */
  url: string;
  /** What the lookup read from that result's extract. Absent on finds made before it existed. */
  lookup?: CitationLookup;
}

/**
 * **The AI's reading of one search extract against what the article uses the
 * work for.** Three verdicts and no "does not support": an extract that does
 * not show a thing says nothing about the full paper (plan 260929g, Sol P-1).
 */
export type CitationSupport = "supports" | "partly" | "not-in-extract";

/**
 * Which of the things a lookup can have found (plan 260929g R-2):
 *
 * - `assessed` — a result that is this work, with an extract, read.
 * - `no-extract` — a result that is this work, but the search gave no extract
 *   of it. **Never shown as `not-in-extract`**: nothing was read.
 * - `not-identified` — the result passed *Find it*'s looser title rule, so a
 *   searched row may still link to it, but not the stricter rule for reading
 *   it as this work (R-1). Nothing from it is shown.
 * - `unreadable` — the result was this work but the model's reading of it was
 *   malformed, and was dropped whole (R-5).
 *
 * *No matching result at all* is not a state: it stores nothing, and is a
 * notice after the press.
 */
export type CitationLookupState = "assessed" | "no-extract" | "not-identified" | "unreadable";

interface CitationLookupBase {
  /** The result's host, without `www.` — *from arxiv.org*. */
  host: string;
  /** Billed searches the call reported; `null` when the provider did not say. */
  searches: number | null;
  model: string;
  /** ISO 8601. */
  at: string;
  /**
   * R-4: over every capped string sent, the identity rule, the prompt version
   * and the model. A stored lookup is attached only while it equals the
   * current list's (src/citation-lookup.ts § `lookupContextHash`).
   */
  contextHash: string;
  /** R-4: over the result's URL, title and extract. Provenance only. */
  evidenceHash: string;
}

/**
 * **What *Look it up* read about one cited work** — private to the owner,
 * attached to every kind of row, and independent of the row's link.
 * src/citation-lookup.ts has every rule; each quote is the search extract's
 * own characters, checked to be in it, and the verdict and `paperDoes.says`
 * are the AI's reading of that extract, never the paper's words.
 */
export type CitationLookup =
  | (CitationLookupBase & { state: Exclude<CitationLookupState, "assessed"> })
  | (CitationLookupBase & {
      state: "assessed";
      /** Words in the extract that was read — *about 310 words*. */
      excerptWords: number;
      /** `supports` and `partly` always carry a quote from the extract that shows it. */
      verdict:
        | { support: Exclude<CitationSupport, "not-in-extract">; quote: string }
        | { support: "not-in-extract" };
      /** One sentence on what the work does, only with a quote from the extract that shows it. */
      paperDoes?: { says: string; quote: string };
    });

/**
 * What *Look it up* answers — `runCitationLookup` (src/citation-find.ts), sent
 * to the browser as the `lookup` frame of
 * `POST /api/citations/:slug/:id/investigate`. It was the body of
 * `POST /api/citations/:slug/:id/find` until that route was deleted on
 * 2026-10-04. **Two outcomes, and neither is an error**: a page that matched
 * and was kept, or nothing that matched — stored nowhere, and the row stays as
 * it was. A failed call fails the press, not a third outcome.
 *
 * On `found`, **the link and the lookup are separate** (plan 260929g R-3):
 * `work` is the row's link half — upgraded to `linkFrom: "web"` only when it
 * was a searched row (`search`, or `web` found before), and otherwise exactly
 * the row as it was, its `url` and `linkFrom` untouched. `lookup` is what was
 * read, for any row. `work` carries no `lookup` of its own.
 */
export type FindCitationResponse =
  | { outcome: "found"; work: CitedWork; lookup: CitationLookup }
  | { outcome: "no-match"; message: string };

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
  /**
   * An `entry` the model gave that is not, exactly once, in the PDF's reference
   * list — dropped, and the row keeps its places (plan 260930i).
   */
  entryUnfound: number;
  /**
   * An `entry` found in the list whose number is not among its mentions'
   * bracketed numbers — `[8]` paired with entry 9. Dropped (plan 260930i).
   */
  entryMismatch: number;
  /** An entry whose text does not contain the model's title — the entry is dropped (plan 260930i, Sol F3). */
  entryDisagrees: number;
  /**
   * Authors not all found as words of the work's entry — dropped, the entry
   * kept. With no entry, authors the article names nowhere (plan 261003j).
   */
  authorsUnfound: number;
  /** A year the work's entry does not carry, or with no entry, the article — dropped. */
  yearUnfound: number;
}

/**
 * The 0–1 scores the prompt required and did not get — the twin of
 * `GlossaryScoreDrops` (src/glossary.ts), same absent/rejected split.
 *
 * `influenceUnknown` is not a drop: it is the model's own `null`, the answer
 * the prompt asks for when it is not confident it knows the work (plan
 * 261003m). Kept apart from `influenceAbsent` (the field left out, which the
 * schema forbids) and `influenceRejected` (not a number in 0–1), so the log
 * line can tell an honest "unknown" from a broken answer.
 */
export interface CitationScoreDrops {
  relevanceAbsent: number;
  relevanceRejected: number;
  influenceAbsent: number;
  influenceRejected: number;
  influenceUnknown: number;
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
   second sub-mode of Learn. See docs/plans/260831al-review-quiz-sub-mode.md.

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
 * **Whether the reader got a question right — judged in private, shown to
 * nobody.**
 *
 * The walk adapts on this, without ever reordering the path: right, and the
 * next step is asked without its premise; wrong or absent, and the premise is
 * shown (src/web/quiz-ladder.ts § `showPremise`). Until 2026-09-30 it stepped
 * a band ladder instead — docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md.
 * [`src/quiz-verdict.ts`](quiz-verdict.ts) produces it by reading the finished
 * mark, and it rides the terminal `done` frame.
 *
 * **Two values and an absence, not three.** Greg's rule is binary, and a
 * `partly` in the middle would absorb most short-answer responses and leave the
 * walk stationary while looking adaptive. Absence — `undefined` — is a
 * designed outcome rather than an error: the classifier failed, timed out,
 * declined an ill-posed question, or the mark never finished. It means *show
 * the premise*, so every failure in this feature is quiet and errs towards
 * help.
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
  /**
   * One question mark, one thing asked, answerable in a sentence or two. Reads
   * as a whole question **without** its premise, because the premise is
   * sometimes hidden.
   */
  question: string;
  /**
   * **The answer to the question immediately before, restated in one
   * sentence**, which this question builds on. Optional — the opening steps
   * have none.
   *
   * Shown above the question unless the reader came here by Next from the step
   * before and was judged right on it, in a batch with no gaps
   * (src/web/quiz-ladder.ts § `showPremise`); **never sent to the marker**,
   * which sees the question alone;
   * **never shown in the all-questions list**, because it is an earlier
   * question's answer and scanning the list must not answer rows the reader
   * has not reached. Since `quiz/5`, 2026-09-30.
   */
  premise?: string;
  /**
   * One or two sentences of model prose, written **before** any reader's
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
  /** Questions missing a field. Dropped. */
  malformed: number;
  /** Questions asking the same thing as one already kept. Dropped. */
  duplicate: number;
  /** Questions that lost **every** piece of evidence and were dropped whole. */
  unanchored: number;
  /**
   * **Dropped questions that had a kept question after them** — a gap in the
   * middle of the path rather than a shorter path. Counted over every drop
   * above except `overCap`. Optional because artefacts before `quiz/5` have
   * none; a quiz that is a pool has no middle to have a gap in.
   * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md § F4.
   */
  gaps?: number;
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
  /**
   * **The path, in the order it is walked** — the model's own order, since
   * `quiz/5`. Never re-sorted. (A `quiz/4` artefact still in the store holds a
   * band-sorted pool here, easy first, and is walked the same way.)
   */
  questions: QuizQuestion[];
  /** What validation threw away. See `QuizDropped`. */
  dropped: QuizDropped;
  generatedAt: string;
  elapsedMs: number;
  /**
   * `hashProfile` of the rendered profile these were written for, `null` for
   * none, and **absent on a quiz written before 2026-10-02**, which therefore
   * shows no badge. Recorded for the owner's *written for your profile* badge
   * and its Regenerate; **not in the freshness stamp**, so a changed profile
   * never makes a quiz stale on its own. Not in the *make public* dialog either:
   * a shared link carries no quiz (`NeverShared`, src/store/pg.ts). Plan 261002f.
   */
  profileHash?: string | null;
}

/**
 * `GET /api/quiz/:slug`. Two staleness facts and, since 2026-10-02, the
 * reader's: `profileChanged` comes from `withProfileChanged` like Ideas' and
 * Simple's, and is a label's fact rather than staleness — nothing re-runs on
 * it. docs/plans/261002f-quiz-regenerate-for-my-profile.md.
 */
export interface QuizResponse {
  quiz: Quiz;
  /** The article moved underneath these questions — blocks, sections or head. */
  stale: boolean;
  /** The article is the same and we would write the questions differently now. */
  outdated: boolean;
  /** Written for a profile the reader has since changed. `ThreadResponse`. */
  profileChanged: boolean;
  /**
   * **The reader's kept answers to this batch**, the latest per question —
   * since 2026-10-05 (plan 261005b, report spya-e8ujxn).
   *
   * **`null` is "could not be read", and it is not `[]`**, which says the
   * reader has answered nothing. The route answers `null` when the attempts
   * read threw, so that the questions still arrive; the client then keeps what
   * it already had for this batch (GPT Sol's plan review, F5).
   */
  attempts: QuizKeptAnswer[] | null;
}

/**
 * One finished mark, as the owner's read returns it: the answer, the mark it
 * was given, and when. A row of `quiz_attempts` (src/db/schema.ts) less the
 * batch — the read is scoped to one — and the question's words, which the
 * client already has. **No verdict**: whether the reader got it right is not
 * stored.
 */
export interface QuizKeptAnswer {
  questionId: QuizQuestionId;
  /** The reader's words, as they went to the marker. */
  answer: string;
  /** The mark, as the reader saw it. */
  reply: string;
  /** ISO time the mark finished — the row's `created_at`. */
  answeredAt: string;
}

/**
 * What the store returns; the route adds `profileChanged` (as `IdeasFound`)
 * and `attempts`, which is a second read from a different table.
 */
export type QuizFound = Omit<QuizResponse, "profileChanged" | "attempts">;

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

/* -------------------------------------------------------------------- faq --
   The questions a careful first-time reader would put to this piece while
   reading it, and the passages where the piece itself responds — the `faq`
   column on `article_revisions`. docs/plans/260916d-faq-mode.md.

   Here rather than in src/faq.ts for the reason `Quiz` is, above: the panel
   needs the shape and `src/web/` may import only the pure leaves.

   **No written answer and no status**, deliberately: the passages are the
   answer, and the only verified claim is that their words are the article's.
   Which passage answers which question is the model's reading. */

/**
 * One place the piece responds to a question — **the article's own
 * characters**, sliced out of the block at the offsets `findQuote` located in
 * its `"spaced"` pass, never the model's typing.
 */
export interface FaqPassage {
  blockId: BlockId;
  /** The article's characters. At most `MAX_QUOTE_CHARS` (src/faq.ts). */
  quote: string;
  /** A disambiguator between repeats, never the anchor. As `IdeaOccurrence`. */
  start: number;
}

export interface FaqQuestion {
  /** `mintUniqueId`, fresh per run. Nothing addresses a question yet. */
  id: string;
  /** One sentence, in the article's own terms. */
  question: string;
  /** 1–3, deduplicated on `{blockId, start, end}`, in document order. */
  passages: FaqPassage[];
  /**
   * 0–1, the model's judgment: how much of the piece, and how much technical
   * detail, a reader needs before this question makes sense. Low is a question
   * anyone would ask on meeting the main claim; high is one that only arises
   * inside a detail. **Optional, and absent on every list before `faq/4`** —
   * such a list is drawn in reading order with no threshold
   * (docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md).
   */
  difficulty?: number;
  /** 0–1, the model's judgment: how much of the piece's argument turns on the answer. Optional as above. */
  centrality?: number;
}

/**
 * What validation threw away. Counts only — never a question or a quote.
 * Invisible from outside (a dropped question looks exactly like one the model
 * never asked), which is why they are stored and logged.
 */
export interface FaqDropped {
  /** A passage naming a block id that is not in the body evidence. */
  unknownIds: number;
  /** A passage whose quote `findQuote` (`"spaced"`) could not find in its block. */
  unquoted: number;
  /** A passage whose located quote is over the cap — dropped, never truncated. */
  tooLong: number;
  /** A repeated passage on one question, or a repeated question. */
  duplicate: number;
  /** Questions that lost every passage and were dropped whole. */
  unanchored: number;
  /** Questions past `MAX_QUESTIONS`, or passages past the per-question cap. */
  overCap: number;
  /** Items we could not read: no question text, an overlong one, a non-object. */
  malformed: number;
}

/** The artefact. The `faq` column on `article_revisions`. */
export interface Faq {
  version: string;
  generator: string;
  slug: string;
  /** `articleWithIdsFingerprint` over the blocks, the tree and the cited head. */
  sourceHash: string;
  /**
   * **In reading order** — each question ranked by its earliest surviving
   * passage, the model's index as tie-break. Fixed at write time. **An empty
   * list is a real answer**: the model found no question worth asking.
   */
  questions: FaqQuestion[];
  /** What validation threw away. See `FaqDropped`. */
  dropped: FaqDropped;
  generatedAt: string;
  elapsedMs: number;
}

/** `GET /api/faq/:slug`. Two staleness facts: no profile is in this stamp. */
export interface FaqResponse {
  faq: Faq;
  /** The article moved underneath this — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and we would write this differently now. */
  outdated: boolean;
}

/** As `QuizFound`: the same type, because there is no `profileChanged` to omit. */
export type FaqFound = FaqResponse;

/* -------------------------------------------------------------- relations --
   How each paragraph bears on the one before it — the `relations` column on
   `article_revisions`, read by Marginalia (docs/project/marginalia.md) and
   written by the `relations` step (src/relations.ts).
   docs/plans/261003f-marginalia-relation-words-and-timeline-events.md. */

/**
 * **The closed list the model picks one of**, per paragraph. All ten are
 * stored; which are drawn is the margin's decision (`DRAWN_RELATIONS`), so
 * drawing more of them later costs no model call.
 */
export const RELATIONS = [
  "therefore",
  "but",
  "because",
  "for-example",
  "contrast",
  "zoom-in",
  "zoom-out",
  "new-thread",
  "restates",
  "and-also",
] as const;
export type Relation = (typeof RELATIONS)[number];

/** What validation threw away or found absent. Counts only. */
export interface RelationsDropped {
  /** An id that is not one of the paragraphs the model was asked about. */
  unknown: number;
  /** A second answer for a paragraph already answered; the first wins. */
  repeated: number;
  /** A word outside `RELATIONS`. */
  offList: number;
  /** A listed paragraph the model did not answer. */
  missing: number;
}

export interface Relations {
  version: string;
  generator: string;
  slug: string;
  /** Fingerprint of the rendered article prefix and ordered eligible paragraph pairs. */
  sourceHash: string;
  /**
   * One entry per paragraph the model answered: how it bears on the paragraph
   * before it. The first body paragraph has none, because nothing precedes it.
   */
  relations: Record<BlockId, Relation>;
  dropped: RelationsDropped;
  generatedAt: string;
  elapsedMs: number;
}

/** `GET /api/relations/:slug`. Two staleness facts: no profile is in this stamp. */
export interface RelationsResponse {
  relations: Relations;
  /** The rendered body/head or eligible paragraph list moved underneath this. */
  stale: boolean;
  /** The article is the same and we would write this differently now. */
  outdated: boolean;
}

/* ----------------------------------------------------------------- simple --
   A plain-words orientation to the piece — the `simple_summary` column on
   `article_revisions`, written by the `simple` step.
   docs/plans/260930i-simple-summaries-eli15-sub-mode.md.

   Here rather than in src/simple-summary.ts for the reason `Faq` is: the panel
   needs the shape, and `src/web/` may import only the pure leaves. */

/**
 * One plain-words paragraph and the passages it rests on. **Every paragraph is
 * a door**: `ids` holds one to three body-evidence block ids, deduplicated, in
 * the model's order — a paragraph with none is dropped at write time
 * (src/simple-summary.ts § `toParagraphs`).
 */
export interface SimpleParagraph {
  text: string;
  ids: BlockId[];
  /**
   * **The same words, cut into sentences, each naming at most one of this
   * paragraph's own `ids`** (docs/plans/261002e-summary-sentences-point-at-their-passage.md).
   * Absent on every paragraph written before `simple-prompt/4`.
   *
   * Typed `unknown` on purpose: `text` is what the fidelity guard checked, so
   * the only sentences a reader may see are ones that *are* that text. Read it
   * through `usableSentences` and nowhere else — the compiler refuses anything
   * that skips it.
   */
  sentences?: unknown;
  /**
   * **`true` when the paragraph is a list**: its first sentence a lead-in, each
   * later one a bullet (docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md).
   * Stored only when true; absent on every paragraph written before
   * `simple-prompt/7`. Typed `unknown` for `sentences`' reason: whether a list
   * is drawn is `paragraphShape`'s answer, never this field read directly.
   */
  list?: unknown;
}

/** One sentence of a paragraph, and the one passage it rests on, or `null` for none in particular. */
export interface SimpleSentence {
  text: string;
  id: BlockId | null;
  /**
   * A few of this sentence's own words, drawn bold: the finding, number or
   * term a skimming reader should catch (plan 261004b). Present only when
   * `simpleKey` accepts it, so absent on most sentences.
   */
  key?: string;
}

/** The most words a sentence's `key` may have — a phrase to catch, never a clause to read. */
export const SIMPLE_KEY_MAX_WORDS = 8;

/**
 * **Is this a key phrase for this sentence? One answer, for the writer's
 * validation and for every read** (plan 261004b): the trimmed key when it is a
 * string with something in it, found in the sentence's text exactly, at most
 * `SIMPLE_KEY_MAX_WORDS` words, and shorter than the sentence; otherwise
 * `null`. Formatting is never a reason to refuse a sentence, so a caller that
 * gets `null` draws the sentence without bold.
 *
 * @param text the sentence's text, already trimmed.
 */
export function simpleKey(key: unknown, text: string): string | null {
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  if (trimmed === "" || trimmed.length >= text.length || !text.includes(trimmed)) return null;
  return trimmed.split(/\s+/).length <= SIMPLE_KEY_MAX_WORDS ? trimmed : null;
}

/**
 * **A paragraph's sentences, if they can be shown — one answer for the owner's
 * panel and the visitor's payload alike** (Sol F2 on plan 261002e).
 *
 * Usable means: a non-empty array; every entry an object with a non-empty
 * string `text` and an `id` that is `null` or one of this paragraph's own
 * `ids`; and the trimmed texts, joined with one space, equal to `text`
 * exactly. The join is the point: the guard read `text`, so a sentence list
 * that says anything else is not shown. Anything short of that is `null` for
 * this paragraph alone — its text and chips draw as they always have, and the
 * rest of the summary is untouched. Never a reason to refuse the artefact.
 *
 * Returns fresh objects with trimmed text, so a caller can hand them on
 * without carrying anything else the stored entries had. A `key` rides along
 * only when `simpleKey` accepts it; one that fails is left off and the sentence
 * is still usable.
 */
export function usableSentences(paragraph: SimpleParagraph): SimpleSentence[] | null {
  const raw = paragraph.sentences;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = new Set<string>(paragraph.ids);
  const out: SimpleSentence[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const { text, id, key: rawKey } = entry as { text?: unknown; id?: unknown; key?: unknown };
    if (typeof text !== "string") return null;
    const trimmed = text.trim();
    if (trimmed === "") return null;
    if (id !== null && (typeof id !== "string" || !ids.has(id))) return null;
    const key = simpleKey(rawKey, trimmed);
    out.push({ text: trimmed, id: id as BlockId | null, ...(key === null ? {} : { key }) });
  }
  return out.map((s) => s.text).join(" ") === paragraph.text ? out : null;
}

/**
 * What to draw for one paragraph. `list` carries its lead-in and at least two
 * bullets by construction, so no caller can draw a list of one.
 */
export type SimpleParagraphShape =
  /** No usable sentences: draw `text`, as before `simple-prompt/4`. */
  | { kind: "text" }
  | { kind: "prose"; sentences: SimpleSentence[] }
  | { kind: "list"; lead: SimpleSentence; items: SimpleSentence[] };

/**
 * **How a paragraph is drawn — one answer for the owner's panel and the
 * visitor's payload** (plan 261004b). A list needs `list: true` and three or
 * more usable sentences, a lead-in and two bullets; anything less is prose,
 * which is always a correct way to draw the same sentences.
 */
export function paragraphShape(paragraph: SimpleParagraph): SimpleParagraphShape {
  const sentences = usableSentences(paragraph);
  if (!sentences) return { kind: "text" };
  const [lead, ...items] = sentences;
  if (paragraph.list === true && lead && items.length >= 2) return { kind: "list", lead, items };
  return { kind: "prose", sentences };
}

/**
 * **The two plain-words levels** the `simple` step writes, shortest first:
 * `brief`, short and very simple; `fuller`, moderately complex and the longer.
 *
 * **There were three until 2026-10-04.** A middle level, itself called
 * `simple`, sat between them (Greg, 2026-09-30, SPIDERYARN-READING2-7J). It
 * stopped being shown on 2026-10-03 and stopped being written the day after.
 * Greg, 2026-10-04: *"we've removed that middle level of Summary, and we're
 * not going to add it back"*.
 * docs/plans/261004f-stop-writing-the-simple-summary-level.md.
 *
 * **A row stored before then still has `levels.simple`, and `check.levels.simple`.**
 * The reader ignores both: every guard below asks about the levels in this
 * list and no others, so such a row is usable exactly when its Brief and
 * Fuller are. The historical check report still reads the middle check and
 * validates it separately. The stored JSON is not rewritten.
 *
 * The step and the artefact are still named `simple`; only the level went.
 */
export const SIMPLE_LEVELS = ["brief", "fuller"] as const;
export type SimpleLevel = (typeof SIMPLE_LEVELS)[number];

/** The stored shape's version, beside the guard that decides whether it is usable. */
export const SIMPLE_ARTIFACT_VERSION = "simple/2";

/** One level's limits — the stored Simple contract, shared by generation and every read boundary. */
export interface SimpleLevelLimits {
  minParagraphs: number;
  maxParagraphs: number;
  /** The hard ceiling on the level's words; the prompt asks for well under it. */
  maxWords: number;
}

/*
 * The word ceilings sit above the longest the measurement saw at each level
 * (210 for Brief and 431 for Fuller, plan 261001b § Ledger) — a ceiling is the
 * line between an orientation and a digest, not a length target, and with a
 * call per level a tight one loses every level for one level's ten words. The
 * prompt's asks are what set the length.
 *
 * Fuller's were 5 paragraphs and 480 words until 2026-10-04. The limits rose
 * for the first, twice-as-long arm and deliberately stayed there when the
 * smaller fallback shipped, so a longer Fuller later remains a prompt-only
 * change (Greg, spya-azft06; plan 261004b). Its minimum stays 3 so every Fuller
 * stored before then still reads.
 *
 * Fuller's were raised again on 2026-10-05 (Greg, spya-gttwhn; plan 261005b),
 * from 8 paragraphs and 850 words: the length Fuller is asked for now follows
 * the length of the piece, and a book's is asked for about 900 words in eight
 * to eleven paragraphs. Brief is asked for one length whatever the piece, so
 * its limits did not move. **One cap for every length of
 * piece**, because a reader of a stored row has no article to measure; the
 * prompt's own "never more than" is what holds a shorter piece's summary short.
 * The minimums did not move, so every stored summary still reads.
 */
export const SIMPLE_LIMITS: Record<SimpleLevel, SimpleLevelLimits> = {
  brief: { minParagraphs: 2, maxParagraphs: 3, maxWords: 240 },
  fuller: { minParagraphs: 3, maxParagraphs: 13, maxWords: 1400 },
};

/** Passages per paragraph, at every level. */
export const SIMPLE_MAX_IDS = 3;

/**
 * Is this a usable stored paragraph list for this level?
 *
 * The generator performs the evidence-dependent check that every id belongs
 * to the exact body it sent. This is the part a reader can check without the
 * article: the same quantity, text, id and word limits the generator enforces.
 */
export function isSimpleParagraphs(value: unknown, level: SimpleLevel): value is SimpleParagraph[] {
  const limits = SIMPLE_LIMITS[level];
  if (
    !Array.isArray(value) ||
    value.length < limits.minParagraphs ||
    value.length > limits.maxParagraphs
  ) {
    return false;
  }

  let words = 0;
  for (const valueParagraph of value) {
    if (
      typeof valueParagraph !== "object" ||
      valueParagraph === null ||
      Array.isArray(valueParagraph)
    ) {
      return false;
    }
    const paragraph = valueParagraph as { text?: unknown; ids?: unknown };
    if (typeof paragraph.text !== "string" || paragraph.text.trim() === "") return false;
    words += paragraph.text.trim().split(/\s+/).length;

    if (
      !Array.isArray(paragraph.ids) ||
      paragraph.ids.length < 1 ||
      paragraph.ids.length > SIMPLE_MAX_IDS ||
      paragraph.ids.some((id) => typeof id !== "string" || id.trim() === "") ||
      new Set(paragraph.ids).size !== paragraph.ids.length
    ) {
      return false;
    }
  }
  return words <= limits.maxWords;
}

/**
 * **Are both stored levels present and within their limits?** The content
 * half of `isUsableSimpleSummary` below, which is the whole-artefact guard every
 * read boundary uses (Sol's plan review, P1-2). A key that is not in
 * `SIMPLE_LEVELS` is not looked at: that is how a row from before 2026-10-04,
 * which also has the removed middle level, still reads.
 */
export function isSimpleLevels(value: unknown): value is Record<SimpleLevel, SimpleParagraph[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const levels = value as Partial<Record<SimpleLevel, unknown>>;
  return SIMPLE_LEVELS.every((level) => isSimpleParagraphs(levels[level], level));
}

/** The artefact. The `simple_summary` column on `article_revisions`. */
export interface SimpleSummary {
  version: typeof SIMPLE_ARTIFACT_VERSION;
  generator: string;
  slug: string;
  /**
   * A hash of the body-only article rendering, the length band since `/9`, and
   * the **profile-free** user message (src/simple-summary.ts § `inputFingerprint`). The profile is not in
   * it, so a changed profile never makes the paragraphs stale.
   */
  sourceHash: string;
  generatedAt: string;
  elapsedMs: number;
  /**
   * `hashProfile` of the rendered profile these were written for, or `null`
   * for none. Having the field is what puts Simple in the owner's *make public*
   * dialog as personalised (`ProfileCarrying`, src/store/pg.ts); it never
   * reaches a visitor (src/public/dto.ts).
   */
  profileHash: string | null;
  /**
   * The prompt's own version, `SIMPLE_PROMPT_VERSION` in src/simple-summary.ts,
   * separate from `version`, which is the stored shape and must match exactly.
   * **Absent on a row written before 2026-10-01**, which is the first prompt
   * (`simplePromptVersion` reads it as `simple-prompt/1`): usable, but
   * outdated. Plan 261001p.
   */
  promptVersion?: string;
  /** Every level, always — validation stores all of them or none. */
  levels: Record<SimpleLevel, SimpleParagraph[]>;
  /**
   * What the fidelity guard said about each stored level (src/simple-check.ts,
   * plan 261001i). **Absent on a row written before the guard, or with it
   * switched off** — that is how the two are told apart, so its absence does
   * not make the artefact unusable. When present it is validated as a whole.
   * Never sent to a visitor
   * (`publicSimpleSummary`, src/public/dto.ts).
   */
  check?: SimpleCheck;
}

/** The guard's record for one artefact: which checker, and each level's outcome. */
export interface SimpleCheck {
  /** The checker prompt's version, `SIMPLE_CHECK_VERSION`. */
  checker: string;
  /**
   * The model the checks were asked of. Which one answered each call is in
   * `ai_calls.answered_model`, rows of purpose `simple-check`.
   */
  requestedModel: string;
  levels: Record<SimpleLevel, SimpleLevelCheck>;
}

/** Is this a well-formed `check` record, about a stored level of this length? */
export function isSimpleCheck(value: unknown, levels: Record<SimpleLevel, SimpleParagraph[]>): value is SimpleCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Partial<Record<keyof SimpleCheck, unknown>>;
  if (typeof c.checker !== "string" || !c.checker || typeof c.requestedModel !== "string" || !c.requestedModel) return false;
  const byLevel = c.levels;
  if (typeof byLevel !== "object" || byLevel === null) return false;
  return SIMPLE_LEVELS.every((level) =>
    isLevelCheck((byLevel as Record<string, unknown>)[level], levels[level].length),
  );
}

/** Shared with the historical report, which also reads the removed middle level. */
export function isLevelCheck(value: unknown, paragraphs: number): value is SimpleLevelCheck {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const storedLatest =
    (v.attempts === 1 && v.retriedAfterFlag === false && v.stored === 1) ||
    (v.attempts === 2 && typeof v.retriedAfterFlag === "boolean" && v.stored === 2);
  const storedFlaggedFirst = v.attempts === 2 && v.retriedAfterFlag === true && v.stored === 1;
  const retryFailed = v.retryFailure === "call" || v.retryFailure === "validation";
  if (v.result === "passed") return storedLatest && v.retryFailure === undefined;
  if (v.result === "unchecked")
    return storedLatest && v.retryFailure === undefined && (v.failure === "call" || v.failure === "unreadable");
  /* A first-attempt flag must spend the available retry. The only way the
     first attempt is stored is when that retry itself could not be stored. */
  const flaggedAttempts =
    (storedFlaggedFirst && retryFailed) ||
    (storedLatest && v.attempts === 2 && v.retryFailure === undefined);
  if (v.result !== "flagged" || !flaggedAttempts || !Array.isArray(v.flags) || v.flags.length === 0) return false;
  return v.flags.every((f: unknown) => {
    const flag = f as Partial<SimpleCheckFlag> | null;
    return (
      typeof flag === "object" &&
      flag !== null &&
      Number.isInteger(flag.paragraph) &&
      (flag.paragraph as number) >= 0 &&
      (flag.paragraph as number) < paragraphs &&
      typeof flag.why === "string"
    );
  });
}

/** A paragraph of the stored level the checker said its passages contradict. */
export interface SimpleCheckFlag {
  /** Index into the stored level's paragraphs, from 0. */
  paragraph: number;
  /** The checker's one sentence — for a person auditing it. Never logged. */
  why: string;
}

/** Why a level was stored unchecked: the call failed, or its answer could not be read. */
export type SimpleCheckFailure = "call" | "unreadable";
/** Why a flag-triggered writer retry could not replace the valid first attempt. */
export type SimpleRetryFailure = "call" | "validation";

/**
 * One level's outcome, **about the text that was stored**.
 *
 * - `attempts` is writer calls for the level (validation retries included).
 * - `retriedAfterFlag`: the first valid attempt was flagged, and that bought
 *   another writer call.
 * - `stored` is which attempt's text was kept. Usually the last; `1` after a
 *   retry is the retry having failed, and the flagged first attempt kept,
 *   because the guard never costs a press.
 * - `retryFailure` distinguishes a failed writer call from a valid call whose
 *   answer failed validation; it exists only when `stored` is `1` after a flag.
 * - `flagged` with `attempts: 2` and no `retriedAfterFlag` is the spent-budget
 *   case — validation used the first attempt, so a flag could not buy another.
 */
export type SimpleLatestCheckAttempts =
  | { attempts: 1; retriedAfterFlag: false; stored: 1; retryFailure?: never }
  | { attempts: 2; retriedAfterFlag: boolean; stored: 2; retryFailure?: never };
export type SimpleFlaggedCheckAttempts =
  | { attempts: 2; retriedAfterFlag: false; stored: 2; retryFailure?: never }
  | { attempts: 2; retriedAfterFlag: true; stored: 2; retryFailure?: never }
  | { attempts: 2; retriedAfterFlag: true; stored: 1; retryFailure: SimpleRetryFailure };
export type SimpleLevelCheck =
  | ({ result: "passed" } & SimpleLatestCheckAttempts)
  | ({ result: "flagged"; flags: SimpleCheckFlag[] } & SimpleFlaggedCheckAttempts)
  | ({ result: "unchecked"; failure: SimpleCheckFailure } & SimpleLatestCheckAttempts);

/**
 * **Is this a complete, current-shape Simple artefact?** One answer for every
 * read boundary. Checking `levels` alone is not enough: an imported or edited
 * `simple/1` row can happen to carry a field with that name and must still read
 * as absent, while `profileHash` is required provenance in `simple/2`.
 */
export function isUsableSimpleSummary(value: unknown): value is SimpleSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const simple = value as Partial<Record<keyof SimpleSummary, unknown>>;
  return (
    simple.version === SIMPLE_ARTIFACT_VERSION &&
    typeof simple.generator === "string" &&
    simple.generator.length > 0 &&
    typeof simple.slug === "string" &&
    simple.slug.length > 0 &&
    typeof simple.sourceHash === "string" &&
    simple.sourceHash.length > 0 &&
    typeof simple.generatedAt === "string" &&
    simple.generatedAt.length > 0 &&
    typeof simple.elapsedMs === "number" &&
    Number.isFinite(simple.elapsedMs) &&
    simple.elapsedMs >= 0 &&
    (simple.profileHash === null || (typeof simple.profileHash === "string" && simple.profileHash.length > 0)) &&
    (simple.promptVersion === undefined || (typeof simple.promptVersion === "string" && simple.promptVersion.length > 0)) &&
    isSimpleLevels(simple.levels) &&
    /* Absent is a row from before the guard, or with it off; present must be whole. */
    (simple.check === undefined || isSimpleCheck(simple.check, simple.levels))
  );
}

/**
 * `GET /api/simple/:slug`. Two staleness facts, as `FaqResponse`: `stale` (the
 * article moved: the panel says so) and `outdated` (an older prompt: silent).
 */
export interface SimpleSummaryResponse {
  simpleSummary: SimpleSummary;
  /** The article moved underneath this — its body blocks or the cited head. */
  stale: boolean;
  /** The article is the same and we would write this differently now. */
  outdated: boolean;
  /**
   * The reader has changed their profile since these were written —
   * `profileIsStale` in src/profile.ts, added by the route
   * (`withProfileChanged`). Never makes them stale.
   */
  profileChanged: boolean;
}

/** What the store hands the route, before the route adds the profile answer. */
export type SimpleSummaryFound = Omit<SimpleSummaryResponse, "profileChanged">;

/* -------------------------------------------------------------- crossrefs --
   Links inside one article: a short phrase in one block that refers to what
   another block shows in detail — the `crossrefs` column on
   `article_revisions`. docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.

   Here rather than in src/crossrefs.ts for the reason `Faq` is: the prose will
   need the shape, and `src/web/` may import only the pure leaves.

   **No `why` line** (Sol F10): the target's own words, in the preview card,
   are the account of what is there. */

/**
 * *These words in block `from` refer to what block `to` shows in detail.*
 *
 * `phrase` is **the article's own characters**, sliced out of the rendered text
 * of `from` — `renderedText(block.html)`, the text space src/web/annotate.ts
 * marks in — where it occurs **exactly once** under
 * `quoteFinderWithMultiplicity(…, "spaced")` (src/quote-match.ts). The client
 * places it by the same rule, so a phrase the server kept is one the prose can
 * mark. There is no offset: one occurrence needs no disambiguator.
 */
export interface Crossref {
  from: BlockId;
  phrase: string;
  to: BlockId;
}

/**
 * What validation threw away. Counts only — never a phrase. A dropped link
 * looks exactly like one the model never offered, which is why they are stored
 * and logged.
 */
export interface CrossrefsDropped {
  /** `from` or `to` is not a block of this article's body. */
  unknownIds: number;
  /** A link to its own block or to the block either side of it. */
  nearby: number;
  /** A phrase under 2 or over 12 words. */
  length: number;
  /** A phrase that does not occur in the rendered text of `from`. */
  unquoted: number;
  /** A phrase that occurs more than once there — the prose could not tell which. */
  ambiguous: number;
  /** A phrase overlapping an earlier link's in the same block. */
  overlap: number;
  /** Links past the cap (`linkCap`, src/crossrefs.ts). */
  truncated: number;
  /** A row we could not read: not an object, or a missing or non-string field. */
  malformed: number;
}

/** The artefact. The `crossrefs` column on `article_revisions`. */
export interface Crossrefs {
  version: string;
  generator: string;
  slug: string;
  /** A hash of the body-only article rendering and top-level skeleton actually sent. */
  sourceHash: string;
  /**
   * In document order of `from`, then of the phrase within it. **An empty list
   * is a real answer**: the model found nothing worth linking.
   */
  links: Crossref[];
  dropped: CrossrefsDropped;
  generatedAt: string;
  elapsedMs: number;
}

/**
 * `GET /api/crossrefs/:slug`. **A stale artefact is not drawn** (Sol F8): a
 * link can still name two surviving ids and a matching phrase and no longer be
 * true, and the prose has no panel to say "out of date" in.
 */
export interface CrossrefsResponse {
  crossrefs: Crossrefs;
  /** The article moved underneath this — blocks, sections or the cited head. */
  stale: boolean;
  /** The article is the same and we would write this differently now. */
  outdated: boolean;
}

export type CrossrefsFound = CrossrefsResponse;

/**
 * **"If it has not been made yet, say so with `200 null`, not a 404."** A
 * request header, sent with any value, on ten artefact reads: `GET
 * /api/<name>/:slug` for quiz, crossrefs and citations — the three every
 * owner's article view makes whichever mode is open — and, since plan 261006h,
 * simple, ideas, faq, timeline, debate, glossary and quotes.
 *
 * "Not made yet" is the ordinary answer to all ten, and a browser prints
 * every 4xx in red, so an ordinary page load showed failures that were not
 * failures. A header rather than `200 null` for everybody because a tab left
 * open across the deploy reads `loaded.quiz` or `loaded.ideas.…` off the body
 * and would show an error where its button was; rather than a query parameter
 * because the offline cache and several tests match these URLs by a pattern
 * that ends at the slug. "No such article" is a 404 either way.
 *
 * **Not every artefact read.** Six still answer a 404 whatever is sent; they
 * are named, with what is left to do for each, in
 * src/store/artefact-not-made-yet.ts, which is the one list.
 *
 * The server's half is `orNullWhenNotMadeYet` in src/routes.ts. It goes, and
 * `200 null` becomes unconditional, the day there is a client-version
 * boundary. docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md,
 * docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md.
 */
export const NONE_YET_AS_NULL_HEADER = "x-spideryarn-none-yet-as-null";

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
  /*
   * **What the work is — title, authors, year. Nothing writes these today.**
   *
   * They were the landing place for a bibliographic lookup
   * (docs/plans/260929h-debate-mode-clearer-sources-and-orders.md § Deferred);
   * that lookup landed as `registry` below (plan 261001a stage 6), its own
   * field so where the words came from stays readable.
   * Stage 2 first asked the search model to copy them off the page and kept
   * each only if the page's extract held it; measured, that verified on 1 row
   * of 11, because the extract is a passage from the middle of the page and the
   * page's head is almost never in it (the plan's § The measurement, as it
   * runs). So the ask was dropped before shipping.
   *
   * **No stored row carries them yet**, and the client reads them defensively:
   * its byline and its *date* order stay dormant until something writes them.
   * Whatever does must say where each came from, and keep `title` (the search
   * engine's) apart from `workTitle`.
   */
  /** The work's own title. Beside the engine's `title`, never replacing it. */
  workTitle?: string;
  /** The work's authors, as the source spells them. Never an empty list. */
  authors?: string[];
  /**
   * The work's year of publication — a year and not a date (Sol's F1: a date we
   * invented would sort as if it were known).
   */
  publishedYear?: number;
  /**
   * How much the quoted passage bears on this row's target — a model judgment
   * in three named stops, never a score, and nothing verifies it.
   *
   * **Absent means unjudged, not `loosely`.** An answer outside the vocabulary
   * is dropped rather than defaulted, unlike `relation` and `lean`: those have
   * an honest "cannot tell" member to fall to, and this has none — so a
   * default here would put a row in a relevance band the model never chose.
   * Read it through `readStoredBears`.
   */
  bears?: DebateBears;
  /**
   * **What Crossref or DataCite holds for the identifier this row's address
   * carries** — written by the `debate` step after its searches
   * (src/debate-registry.ts, plan 261001a stage 6), and only when the
   * registry's title agrees with the engine's `title` for the page. The
   * by-line and the *date* order prefer it to `authors` / `publishedYear`, and
   * say where it came from. Read it through `readRegistryWork`.
   */
  registry?: RegistryWork;
}

/**
 * **How much a passage bears on its row's target** — the relevance stop the
 * *prioritised* order sorts on (260929h).
 *
 * - `directly` — it tests or responds to exactly this;
 * - `partly` — it bears on part of it, or on something close;
 * - `loosely` — same topic, little direct bearing.
 *
 * Three words rather than a number: a reader shown *0.73* reads a measurement, and
 * this is one model's judgment of a stranger's page.
 */
export type DebateBears = "directly" | "partly" | "loosely";

/** Total by construction, as `LEAN_MEMBERS` is: omit a member and this stops compiling. */
const BEARS_MEMBERS: { [K in DebateBears]: true } = {
  directly: true,
  partly: true,
  loosely: true,
};

/** The three stops, strongest first — the order *prioritised* sorts in. */
export const DEBATE_BEARS: readonly DebateBears[] = ["directly", "partly", "loosely"];

/** Is this one of the three stops this build knows? */
export function isDebateBears(value: unknown): value is DebateBears {
  return typeof value === "string" && Object.hasOwn(BEARS_MEMBERS, value);
}

/**
 * **A stored row's `bears`, or `null` when it has none this build can read** —
 * every row from before `debate/3`, and anything a hand-edit left behind.
 *
 * `null` rather than a default stop, because "unjudged" is what those rows are:
 * the prioritised order puts them last under a line that says so, and a
 * default would quietly file them in a band.
 */
export function readStoredBears(row: { bears?: unknown }): DebateBears | null {
  return isDebateBears(row.bears) ? row.bears : null;
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
export function identifiesOf<S extends { kind: IdentificationLevel } = IdentificationSignal>(
  row: IdentifiedRow<S>,
): readonly [S | NamedSignal, ...(S | NamedSignal)[]] {
  const found = row.identifies;
  if (Array.isArray(found) && found.length > 0 && found[0]) return [found[0], ...found.slice(1)];
  return [{ kind: "named", by: "title", witness: row.articleReferenceQuote }];
}

/** The weakest arm, and the one `identifiesOf` falls back to for a pre-2026-09-06 row. */
export type NamedSignal = Extract<IdentificationSignal, { kind: "named" }>;

/**
 * **The least a row needs for its identification to be read** — the owner's
 * `DirectDebateRow` and a visitor's `PublicDirectDebateRow` alike. Generic in
 * the signal because the public boundary may take a `linked` signal's address
 * off (src/public/dto.ts § `publicDebate`), so a visitor's signal is not an
 * `IdentificationSignal`; everything read here is the `kind`. Since
 * 2026-09-29, plan 260929c stage 4.
 */
export interface IdentifiedRow<S extends { kind: IdentificationLevel } = IdentificationSignal> {
  identifies: readonly S[];
  articleReferenceQuote: string;
}

/**
 * **The strongest evidence this row carries**, by a lookup over a fixed order.
 *
 * No arithmetic: the level *is* one of the facts on the row, and the tooltip
 * lists every one of them beside it. A composite would be our weights dressed as
 * the model's judgment, which is the refusal
 * [quotes.md](../docs/project/quotes.md) already makes about a prioritised row.
 */
export function identificationLevel<S extends { kind: IdentificationLevel }>(
  row: IdentifiedRow<S>,
): IdentificationLevel {
  const signals = identifiesOf(row);
  let best = signals[0];
  for (const signal of signals) if (strengthOf(signal) < strengthOf(best)) best = signal;
  return best.kind;
}

/** Lower is stronger. A new arm of the union is a compile error here. */
function strengthOf(signal: { kind: IdentificationLevel }): number {
  const kind = signal.kind;
  switch (kind) {
    case "linked":
      return 0;
    case "quoted":
      return 1;
    case "named":
      return 2;
    default: {
      /* Not a `return 3`: a fourth kind of evidence must be *placed* in the
         order by whoever adds it, rather than silently ranked weakest. */
      const unreachable: never = kind;
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
  /**
   * **What the sources keep coming back to, and which of them matter most** —
   * a third, search-free call over the rows both passes *kept*
   * (src/debate-themes.ts; SPIDERYARN-READING2-6M, plan 260930j).
   *
   * **Absent means the debate was searched before 2026-09-30**, not that the
   * call failed: a failure is stored as `{kind: "failed"}`, so the two cannot
   * be confused. Read it through `readStoredSynthesis` (src/debate-synthesis.ts), never directly — JSONB
   * comes back unchecked.
   *
   * **A visitor gets it since 2026-10-01** (plan 261001b), re-settled against
   * the rows they are sent, and not at all when the boundary withheld a row —
   * src/public/dto.ts § `publicSynthesis`.
   */
  synthesis?: DebateSynthesis;
}

/**
 * **Why a source is one of the key ones** — Greg's three reasons, in his words:
 * *"the critical papers that really responded or moved things forward or take
 * a different view"* (2026-09-30, SPIDERYARN-READING2-6M).
 *
 * - `responds` — it takes this piece, or the claim it answers, on directly;
 * - `advances` — it moves the question on: new evidence, a new method, a next step;
 * - `dissents` — it takes a different view from the one the piece takes;
 * - `origin` — it is the original work the claim comes from. Not one of Greg's
 *   three, and added after the first measured pass (plan 260930j): offered only
 *   three, the model filed *"the original study behind the article's 67%
 *   figure"* under `responds`, which is false — a source is not a reply.
 *
 * A closed set, like `DebateBears`, so the panel draws a word it chose rather
 * than whatever the model typed.
 */
export type DebateKeyRole = "responds" | "advances" | "dissents" | "origin";

const KEY_ROLE_MEMBERS: { [K in DebateKeyRole]: true } = {
  responds: true,
  advances: true,
  dissents: true,
  origin: true,
};

export function isDebateKeyRole(value: unknown): value is DebateKeyRole {
  return typeof value === "string" && Object.hasOwn(KEY_ROLE_MEMBERS, value);
}

/**
 * **One thread several sources pick up.** `rowIds` are ids of rows in this same
 * artefact, and at least two of them are from **different works** — two copies
 * of one paper do not turn that paper's point into something several sources
 * keep saying.
 */
export interface DebateTheme {
  /**
   * `mintId`, fresh on every run like the rows' own ids — what `?debatethread=`
   * names, so the address points at a theme rather than at a position in the
   * list.
   */
  id: string;
  /** A short name for it, in the sources' own key term. The model's words. */
  label: string;
  /** One plain sentence on what they say about it. The model's words. */
  gist: string;
  rowIds: string[];
}

/** **One row picked out as a key source**, and the one-line reason. */
export interface DebateKeySource {
  rowId: string;
  role: DebateKeyRole;
  /** Why, in a sentence. The model's words, labelled as such on screen. */
  why: string;
}

/**
 * The outcome of the synthesis call, **every state named** so the panel never
 * has to guess what an empty list meant.
 *
 * - `made` — the call ran and answered. Either list may be empty: a debate
 *   whose sources share no thread has no themes, and that is an answer.
 * - `too-few` — fewer kept rows than a theme needs, so nothing was asked.
 * - `failed` — the call ran and its answer was refused or unreadable. The rows
 *   are kept anyway: they cost two web searches, and nothing about them
 *   depends on this call.
 */
export type DebateSynthesis =
  | { kind: "made"; themes: DebateTheme[]; key: DebateKeySource[] }
  | { kind: "too-few"; rows: number }
  | { kind: "failed" };

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
 * **One paper that cites the article**, as OpenAlex lists it — Reception's
 * *Cited by* (src/citation-index.ts). Every string is plain text and bounded,
 * and none is a link: the panel builds its link from `doi` or `openalexId`
 * (src/citer-link.ts). We have not read what the paper says about the piece.
 */
export interface Citer {
  /** OpenAlex's id for the work, `W…`, shape-checked. */
  openalexId: string;
  /** Lower-cased and shape-checked. Absent when OpenAlex has none. */
  doi?: string;
  /** The citing paper's own title: its authors' words, not ours. */
  title: string;
  /** The first authors' display names, at most 20. */
  authors: string[];
  /** How many authors the work has, which can be more than `authors` holds. */
  authorCount: number;
  year?: number;
  /** Where it appeared: OpenAlex's `primary_location.source.display_name`. */
  venue?: string;
  /** OpenAlex's `type`: `article`, `preprint`, `review`, … */
  kind?: string;
  /** How often the citing paper is itself cited. The list's order. */
  citedByCount: number;
}

/**
 * `GET /api/citers/:slug` — **who cites this article, or why there is no
 * list.** No model made any of it, and it is not part of the stored Debate.
 * docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md.
 *
 * - `no-doi` — the article has no DOI on record, so nothing was asked.
 * - `not-indexed` — OpenAlex has no record of the DOI.
 * - `unconfirmed` — OpenAlex's record for the DOI could not be shown to be this
 *   article: its title and one author must both agree. Not a claim that the
 *   DOI is another work's; with no byline there is simply nothing to agree.
 * - `unavailable` — it could not be asked just now. Worth trying again.
 * - `too-large` — its target record exceeds our byte limit, or its list does
 *   even after asking for a shorter page. Not worth the same retry today.
 * - `found` — the list. `count` is OpenAlex's own count of citers, `returned`
 *   how many records its answer carried, `dropped` how many of those could not
 *   be shown (no title, a malformed id, a duplicate), and `capped` whether the
 *   page limit left some out. `citers.length` is `returned - dropped`, so the
 *   panel can say which of the two reasons a short list has.
 */
export type CitersResult =
  | { kind: "no-doi" }
  | { kind: "not-indexed" }
  | { kind: "unconfirmed" }
  | { kind: "unavailable" }
  | { kind: "too-large" }
  | {
      kind: "found";
      count: number;
      returned: number;
      dropped: number;
      capped: boolean;
      citers: Citer[];
      /** When OpenAlex answered, ISO. A cached list keeps the day it was fetched. */
      fetchedAt: string;
    };

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
 * **One of the reader's own earlier reports, as the Feedback dialog's Earlier
 * tab shows it** — `GET /api/feedback`.
 * docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * **Seven fields, written out.** Not a `Pick` of
 * `FeedbackReport` or of the admin row: a field added to either of those must
 * not widen what this response carries by itself. The email, the address, the
 * diagnostics and the screenshot stay behind — a list whose job is "what did I
 * say" has no use for them, and the address can carry the reader's own search
 * terms or a credential in an `/add/` URL (docs/project/feedback.md § The one
 * rule). Six come from the store; the route derives `shipped` from this build's
 * note map. Here rather than in src/store/contracts.ts because the dialog reads
 * it, and nothing under src/web/ may import the store.
 */
export interface EarlierFeedback {
  id: string;
  /** ISO. */
  createdAt: string;
  kind: FeedbackKind | null;
  body: string;
  /**
   * **Which page the report was filed from — a label, not the address.** The
   * path alone, with an import collapsed to `/add`: src/feedback-page.ts has
   * the rule, and it is what lets this field exist beside the sentence above.
   * `null` for a report with no stored address (one, from before 2026-09-02).
   * docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.
   */
  page: string | null;
  /**
   * **The paragraph it was filed at**, as a block id, so the page's link opens
   * there. The one value taken from the stored address's query, and only when
   * it has a block id's fixed shape; `null` otherwise, and always when `page`
   * is not an article's reading page. src/feedback-page.ts § `feedbackPageAt`.
   * docs/plans/261006b-earlier-link-carries-the-paragraph.md.
   */
  at: string | null;
  /**
   * **A change for this report has shipped, and is in the build answering.**
   * Derived from the report's note in docs/user-feedback/, compiled into the
   * server (src/feedback-ending.ts) — so on production it turns true only once
   * the note, and the work before it, has been deployed. Not *declined* or
   * *waiting*: this list's question is "did anything come of it".
   * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
   */
  shipped: boolean;
}

/**
 * The whole answer: the newest reports, whether there were more than the cap,
 * and how many there are under each filter.
 */
export interface EarlierFeedbackPage {
  reports: EarlierFeedback[];
  /**
   * `true` when the reader has filed more than this list holds — more than
   * `EARLIER_FEEDBACK_LIMIT`, or more than fit `FEEDBACK_LIST_BYTES` — so the
   * list says so.
   */
  more: boolean;
  /**
   * **How many under each filter**, uncapped, on every answer whatever `?show=`
   * asked for, so the first read labels all three pills.
   * docs/plans/261003b-earlier-tab-counts-on-the-pills.md.
   */
  counts: Record<EarlierFeedbackShow, number>;
}

/**
 * **Which of them the Earlier tab asks for** — `GET /api/feedback?show=`, absent
 * meaning `all`. Filtered on the server, not over the 50 the client holds: the
 * reader most likely to filter has sent far more than 50, and the older ones
 * are the likeliest not to have shipped.
 */
export const EARLIER_FEEDBACK_SHOWS = ["all", "shipped", "unshipped"] as const;
export type EarlierFeedbackShow = (typeof EARLIER_FEEDBACK_SHOWS)[number];

/**
 * **How many earlier reports the dialog lists.** No paging: a reader with fifty
 * reports is almost certainly the administrator, who has `/admin/feedback`.
 * The server's number, never a query parameter.
 */
export const EARLIER_FEEDBACK_LIMIT = 50;

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
 * **20,000 since 2026-10-07; it was 4,000, then 12,000 the same morning**, and
 * the reason is dictation. A dictation may now run fifteen minutes (`MAX_MS`,
 * src/web/mic-recording.ts), and Greg was cut off dictating a long report into
 * this box (spya-n8cuqq). 12,000 was what the database already admitted, about
 * thirteen minutes of non-stop speech; fifteen minutes non-stop came to 15,108
 * in plan 261007b's soak. 20,000 covers fifteen minutes at 200 words a minute,
 * and Greg said yes to widening the column's CHECK to match (plan
 * docs/plans/261007j-feedback-takes-twenty-thousand-characters-and-admin-feedback-pages-by-size.md).
 * Past it the failure is a sentence asking the reader to trim, with every word
 * still in the box.
 *
 * **Equal to `MAX_FEEDBACK_BODY_CHARS` below, on purpose**: what the reader may
 * send is what the database will keep. Still a cap, and the cap still matters:
 * it is what stops a pasted article becoming an attachment on its way to
 * Sentry. 20,000 characters is a short article, and that is the trade Greg took.
 */
export const MAX_FEEDBACK_ANSWER_CHARS = 20_000;

/**
 * The cap on **each of the three answers a stale client sends** — the dialog's
 * shape before 2026-09-02, still folded into one `body` by src/routes.ts §
 * `feedbackBody`. It was `MAX_FEEDBACK_ANSWER_CHARS` until that one went up;
 * these stay at the 4,000 they were written under: three of them under their
 * headings come to 12,072, inside the column's CHECK.
 */
export const MAX_LEGACY_FEEDBACK_ANSWER_CHARS = 4_000;

/**
 * The longest a `feedback.body` may be **in the database** — the number written
 * into `feedback_body_shape` (src/db/schema.ts), which tests/feedback-store.test.ts
 * holds to this one by writing exactly it and one character more.
 *
 * It was 12,072 until 2026-10-07, which is three old answers: reports filed
 * before 2026-09-02 are three answers, each capped at
 * `MAX_LEGACY_FEEDBACK_ANSWER_CHARS`, glued under the headings src/feedback.ts
 * used to write, and the migration that wrote them into `body` needed a CHECK
 * that admitted three full ones rather than one that cut them. **Whatever this
 * becomes, it may not go below 12,072**, or a row that was legal when it was
 * filed becomes illegal.
 *
 * Since plan 261007j it is 20,000, equal to `MAX_FEEDBACK_ANSWER_CHARS`: the
 * reader's limit and the database's are one number.
 */
export const MAX_FEEDBACK_BODY_CHARS = 20_000;

/**
 * The largest screenshot the database will take, in **decoded** bytes.
 *
 * The dialog shrinks a picture until it is under 90% of this
 * (src/web/feedback-screenshot.ts); this is the ceiling that holds whatever the
 * dialog does, because client-side downscaling is not validation. A CHECK on
 * `octet_length` rather than a rule in TypeScript, so it holds for every writer
 * including a script — docs/project/sql.md.
 *
 * **Two megabytes since 2026-10-03; it was 400,000.** At the old number a
 * screenshot with a photograph in it had to go at about 640 pixels to fit, which
 * cannot be read. It is not higher because the picture travels as base64 inside
 * a JSON body and Vercel refuses a request over 4.5 MB before our code runs:
 * two megabytes is 2.67 MB on the wire, and five would be 6.7 MB.
 *
 * **Three places hold this number and must move together**: this constant, the
 * `feedback_screenshot_size` CHECK in src/db/schema.ts, and a migration that
 * drops and re-adds that CHECK. tests/feedback-store.test.ts files one at
 * exactly this size and one a byte over, against the real table.
 */
export const MAX_FEEDBACK_SCREENSHOT_BYTES = 2_000_000;

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
 * The inbox is keyset-paged. This is therefore a ceiling on one response, not
 * on how many reports the administrator can reach; `AdminFeedbackPage.hasMore`
 * says whether the store saw another row and `nextCursor` reaches it.
 */
export const ADMIN_FEEDBACK_MAX = 500;

/**
 * **The most one list of feedback reports may weigh**, as the UTF-8 bytes of
 * its reports' JSON — a second ceiling beside the count, because a count stands
 * in for a size only while every report is small. Both lists that return whole
 * reports read it: `/admin/feedback` (`ADMIN_FEEDBACK_DEFAULT_LIMIT`, up to
 * `ADMIN_FEEDBACK_MAX`) and the reader's own Earlier tab
 * (`EARLIER_FEEDBACK_LIMIT`).
 *
 * A report may be `MAX_FEEDBACK_BODY_CHARS` (20,000) characters — 120 KB of
 * JSON when every character escapes to six bytes — so 200 of them is 4 MB or
 * more, fifty can be 6 MB, and a Vercel function's response may be 4.5 MB. The
 * list stops before the report that would take it past this, always holding at
 * least one, and says there are more (src/json-budget.ts): the admin page's
 * cursor is the last report returned, so *Load older* reaches the rest; the
 * Earlier tab says how many of how many it shows. No report is ever shortened.
 * 3 MiB leaves room for one worst-case report and the envelope;
 * tests/admin-feedback-store.test.ts holds the arithmetic. Plan
 * docs/plans/261007j-feedback-takes-twenty-thousand-characters-and-admin-feedback-pages-by-size.md.
 */
export const FEEDBACK_LIST_BYTES = 3 * 1024 * 1024;

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
   * could be longer than the dialog's limit (three times it until 2026-10-07;
   * since plan 261007j the dialog's limit is the column's, but a later cut to
   * the dialog must not truncate the old ones). A renderer that truncates to the dialog's limit
   * would silently cut the oldest reports — the ones most likely to be the
   * reason somebody opened this page. GPT Sol, 2026-09-02.
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
  /**
   * ISO, or `null`. **When an administrator marked this report as one to leave
   * alone** — a test, a duplicate, nonsense. Not something the reader sent and
   * not shown to them; the agents' sweep skips a marked report
   * (scripts/feedback-unswept.ts). src/db/schema.ts § `ignoredAt`.
   */
  ignoredAt: string | null;
  /** ISO. */
  createdAt: string;
}

/**
 * **The body of `PATCH /api/admin/feedback/:ownerId/:id`**: exactly
 * `{ ignored: boolean }`. Anything else is refused rather than read
 * generously, so a field added to this route later cannot be sent by a client
 * that predates it and quietly dropped.
 */
export function parseFeedbackIgnorePatch(raw: unknown): { ignored: boolean } | "malformed" {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "malformed";
  const keys = Object.keys(raw);
  const ignored = (raw as { ignored?: unknown }).ignored;
  if (keys.length !== 1 || typeof ignored !== "boolean") return "malformed";
  return { ignored };
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
 * **Whose reports the inbox shows** — everyone's, or only the readers', which
 * is everyone who is not an administrator (src/admin.ts § `ADMIN_USER_IDS`, the
 * list `isAdmin` reads). Greg, 2026-10-01 (SPIDERYARN-READING2-87): *"provide a
 * filter to show only non-admin suggestions (i.e. suggestions from people other
 * than me)."* docs/plans/261001l-….
 *
 * Applied by the store, not the browser: the inbox is paged, and a page of
 * Greg's own reports filtered away in the browser would read *no reports,
 * there are older ones*.
 */
export const FEEDBACK_FROM = ["everyone", "readers"] as const;
export type FeedbackFrom = (typeof FEEDBACK_FROM)[number];

/**
 * `?from=` read back: absent is `"everyone"`, and anything else that is not one of
 * the two is `"malformed"`, which the route turns into a 400 — never a quiet
 * *everyone*, which would show Greg his own reports under a filter that says it
 * hides them. The same three-answer shape as `decodeFeedbackCursor`.
 */
export function parseFeedbackFrom(raw: string | null | undefined): FeedbackFrom | "malformed" {
  /* Only an *absent* parameter is everyone. `?from=` with nothing after it is
     a caller that meant something and lost it — malformed. GPT Sol. */
  if (raw === null || raw === undefined) return "everyone";
  return (FEEDBACK_FROM as readonly string[]).includes(raw) ? (raw as FeedbackFrom) : "malformed";
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
