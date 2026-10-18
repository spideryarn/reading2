/**
 * **Folding a heading's section away** — which rows a folded heading hides, and
 * the one store that says which headings are folded.
 *
 * Greg, spya-skqwg8, 2026-10-02: *"a little icon that would hide that heading's
 * section"*, and ⌘⌥T / ⌥-click for all of them at once.
 * docs/plans/261002e-collapsible-headings-and-fold-all.md has the reasoning.
 *
 * ## Why the cells are hidden and not the row
 *
 * Nearly everything in the reading view measures rows — the spine's bands, the
 * reading position, the arrow keys, "is it on screen". A `tr` with
 * `display: none` reports a zero rectangle at the top of the viewport, which
 * breaks the "row tops are in order" assumption `activeSectionIndex` and the
 * spine are built on. A `tr` whose *cells* are `display: none` stays in the
 * table at zero height, at the top of the next visible row (measured in
 * Chrome, plan § Is it substantial), so every one of them keeps working and a
 * folded section is simply a section of zero height.
 *
 * ## Why a style element, written synchronously
 *
 * Two reasons, both about not going through React. Folding a section must not
 * re-render the prose table (several hundred memoised rows), so the rule is a
 * stylesheet like `ReadingTimeStyle`'s. And `revealBlock`, which
 * `scrollToBlock` calls before it measures, has to have changed the layout by
 * the time it returns — a reveal that waited for the next React commit would
 * aim the glide's first frame at a zero-height row. React only hears about the
 * change for the chevrons and the stubs, through `useFold`.
 *
 * ## The masthead's echo: hidden here, and not a fold
 *
 * The leading blocks that only repeat the masthead (masthead-echo.ts; Greg,
 * spya-t6cdve) are hidden by this store too, always, because a zero-height row
 * only keeps working for the consumers that ask the store about it.
 * `isRowHidden` is true for them; they are never foldable and never revealed.
 * The one way they differ from a fold is `isFoldedAway`, below.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 * § How a row is hidden, and what has to know.
 *
 * ## Front and back matter: stretches, each shut on arrival behind a stub
 *
 * The third kind of hiding (matter-view.ts; Greg, spya-ftsqsn: *"Mark it up as
 * being less interesting … And default-collapse it"*). A list of stretches —
 * the abstract, the authors, the contents, the references — each shut for
 * every article on every load. **A shut stretch keeps its first row on screen
 * as a stub**: one quiet line (FoldToggle.tsx § `MatterStub`) in place of that
 * block's own content, and the rest of its rows hidden. Each opens on its own:
 * by its stub (`toggleStretch`), and by `revealBlock` of any block in it, all
 * of that stretch at once, so a search hit or a link into it shows it.
 *
 * So "is the row there" and "are the block's words there" are two facts for a
 * stub row (GPT Sol, plan review of 261018a, F5), and two questions:
 * `isRowHidden` for whatever measures or draws on a row, `isContentHidden` for
 * whatever reads, counts or attaches to the block's words. Like the echo, no
 * row of a stretch is `isFoldedAway`, and no heading in one is foldable.
 * `visibleFrom` is the question the stretches add, for the callers that would
 * otherwise jump into one without meaning to open it.
 * docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md
 * § Stage 3; it generalises the one byline run of
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md.
 *
 * ## What it is not
 *
 * Not persisted and not in the URL: reload opens every real fold and shuts
 * every stretch again. One article at a time, because there is one prose table.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { sectionRanges } from "../section-ranges.js";
import type { Block, BlockId } from "../types.js";
import { isModAltChord, isTyping } from "./key-chord.js";
import { SAFE_ID } from "./reading-time.js";

/**
 * **Where each heading's section ends** — the index one past its last block.
 *
 * A heading at level L owns every following block up to, not including, the
 * next heading whose level is L or coarser. So an H3 under an H2 is part of
 * the H2's section, and folding the H2 hides it along with everything else.
 * The rule itself is `sectionRanges` (src/section-ranges.ts), shared with the
 * front- and back-matter pass so the two cannot disagree.
 */
function sectionEnds(blocks: readonly Block[]): Map<BlockId, number> {
  return new Map(sectionRanges(blocks).map((r) => [r.id, r.end]));
}

/**
 * The headings that have something to hide — at least one block before their
 * section ends. A heading straight followed by its sibling gets no button,
 * because a control that does nothing reads as broken.
 */
export function foldableHeadings(blocks: readonly Block[]): Set<BlockId> {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const out = new Set<BlockId>();
  for (const [id, end] of sectionEnds(blocks)) if (end > index.get(id)! + 1) out.add(id);
  return out;
}

/**
 * **Every block a set of folded headings hides.** The headings themselves stay
 * visible; a folded heading inside another folded section is hidden like any
 * other block of it. Ids in `folded` that are not headings of this article are
 * ignored.
 */
export function hiddenBlocks(blocks: readonly Block[], folded: ReadonlySet<BlockId>): Set<BlockId> {
  const ends = sectionEnds(blocks);
  const out = new Set<BlockId>();
  let hideUntil = -1;
  blocks.forEach((block, i) => {
    if (i < hideUntil) out.add(block.id);
    if (folded.has(block.id)) hideUntil = Math.max(hideUntil, ends.get(block.id) ?? -1);
  });
  return out;
}

/**
 * The folded headings that hide `id` — the ones `revealBlock` unfolds. Only
 * those: a jump into one subsection leaves its folded siblings folded.
 */
export function foldsHiding(
  blocks: readonly Block[],
  folded: ReadonlySet<BlockId>,
  id: BlockId,
): BlockId[] {
  const at = blocks.findIndex((b) => b.id === id);
  if (at < 0) return [];
  const ends = sectionEnds(blocks);
  const out: BlockId[] = [];
  for (let i = 0; i < at; i++) {
    const h = blocks[i]!.id;
    if (folded.has(h) && (ends.get(h) ?? -1) > at) out.push(h);
  }
  return out;
}


/* ------------------------------------------------------------- the store -- */

/** What `useFold` hands a component. Replaced whole on every change. */
export interface FoldState {
  /** The headings currently folded. */
  folded: ReadonlySet<BlockId>;
  /** The headings that have something to fold — the ones that get a button. */
  foldable: ReadonlySet<BlockId>;
  /**
   * The stub of every stretch that is shut right now — its first block's id.
   * What a stub draws: the line while shut, the fold-away chevron while open.
   */
  shut: ReadonlySet<BlockId>;
}

const NO_IDS: ReadonlySet<BlockId> = new Set();
const EMPTY: FoldState = { folded: NO_IDS, foldable: NO_IDS, shut: NO_IDS };
const NO_ECHO: ReadonlySet<BlockId> = NO_IDS;
/** A stretch to fold: its blocks, in document order, contiguous, never an echo row. */
export type FoldStretch = readonly BlockId[];
const NO_STRETCHES: readonly FoldStretch[] = [];

let article: {
  key: string;
  blocks: readonly Block[];
  echo: ReadonlySet<BlockId>;
  stretches: readonly FoldStretch[];
  /** Each block's index, for walking past a stretch by position. */
  index: ReadonlyMap<BlockId, number>;
  /** Which stretch each of their blocks is in, as an index into `stretches`. */
  stretchOf: ReadonlyMap<BlockId, number>;
} | null = null;
let state: FoldState = EMPTY;
/**
 * The stretches the reader has opened, by `stretchKey`. Emptied for every new
 * article; a stretch that changes is a different key, so it arrives shut.
 */
let opened: ReadonlySet<string> = new Set();
/** Every row whose cells the stylesheet hides: the echo, the shut stretches past their stubs, and `foldedAway`. */
let hidden: ReadonlySet<BlockId> = new Set();
/** The stubs of shut stretches whose rows are on screen: the row stays, its content does not. */
let stubbed: ReadonlySet<BlockId> = new Set();
/** The stubs drawn tight against a neighbouring stub — `tightStubs`. */
let tight: TightStubs = { above: [], below: [] };
/** The rows a folded heading hides, the echo not among them unless a fold covers it too. */
let foldedAway: ReadonlySet<BlockId> = new Set();
const listeners = new Set<() => void>();
/* The mounted TableView that most recently installed this singleton. A route
   change replaces keyed Readers: the new table's layout effect runs before the
   old table's passive cleanup, so an unconditional cleanup would erase the new
   article. The token makes that stale cleanup a no-op. */
let mountedBy: symbol | null = null;
/* **The open stretches, held across one table's own effect remount.** In
   development React's StrictMode runs every effect's cleanup and setup again
   straight after the mount. The cleanup below forgets the article, and with
   it that a link had just opened a stretch: the `?at=` restore that opened it
   runs once per address (useReadingPosition.ts § `synced`), so the remount
   left a pasted link pointing at a shut stretch. Production has no StrictMode
   and never takes this path. Only the same mounted table (its token) gets
   them back: its cleanup runs only on unmount, so the one way it sees its own
   token again is that remount, with the same article. A reader who leaves and
   comes back is a new mount and arrives with every stretch shut. Per
   stretch: the ones that were open come back open, and only those. */
let reopenFor: { token: symbol; keys: ReadonlySet<string> } | null = null;

/** The attribute the store's own `<style>` carries, so it can find it again. */
export const FOLD_STYLE_ATTR = "data-fold";

/** The class of the stub's own element, the one thing a shut stub row still shows. */
export const STUB_CLASS = "matter-stub";

/**
 * The rule that hides a row's cells. Unescaped for the reason `gutterCss`
 * gives (reading-time.ts): a block id is a closed format, and one that fails
 * it is not ours, so it is skipped rather than escaped.
 */
export function foldCss(ids: Iterable<BlockId>): string {
  let css = "";
  for (const id of ids) if (SAFE_ID.test(id)) css += `tr[data-block="${id}"]>td{display:none}\n`;
  return css;
}

/**
 * The rule that hides a shut stub row's content and leaves the row: every
 * child of its cell but the stub. The gutter, the prose, the margin's notes and
 * the quiz all go with it, so nothing of the block's own is drawn or counted.
 */
export function stubCss(ids: Iterable<BlockId>): string {
  let css = "";
  for (const id of ids) {
    if (SAFE_ID.test(id)) css += `tr[data-block="${id}"]>td>:not(.${STUB_CLASS}){display:none}\n`;
  }
  return css;
}

function writeStyle(): void {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLStyleElement>(`style[${FOLD_STYLE_ATTR}]`);
  if (hidden.size === 0 && stubbed.size === 0) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.setAttribute(FOLD_STYLE_ATTR, "");
    document.head.appendChild(el);
  }
  el.textContent = foldCss(hidden) + stubCss(stubbed) + tightCss(tight);
}

/** The stub rows drawn tight against the shut stub above them, and below them. */
interface TightStubs {
  above: readonly BlockId[];
  below: readonly BlockId[];
}

/**
 * **Which stubs sit next to another stub**, with nothing on screen between:
 * the rows between two stubs are a shut stretch's own, or the echo, or a fold,
 * all of them hidden. Stubs back to back read as one compact list rather than
 * a paragraph each (browser pass of 261018a: four stubs pushed the article to
 * mid-screen). An open stretch's first row is prose again, so a stub beside it
 * keeps its normal space.
 */
function tightStubs(
  blocks: readonly Block[],
  rows: ReadonlySet<BlockId>,
  stubs: ReadonlySet<BlockId>,
): TightStubs {
  const above: BlockId[] = [];
  const below: BlockId[] = [];
  let previous: BlockId | null = null; // the last row on screen, if it was a stub
  for (const b of blocks) {
    if (rows.has(b.id)) continue;
    const isStub = stubs.has(b.id);
    if (isStub && previous !== null) {
      above.push(b.id);
      below.push(previous);
    }
    previous = isStub ? b.id : null;
  }
  return { above, below };
}

/**
 * The tight sides as custom properties on the cell, which prose.css reads
 * (§ a stretch of front or back matter): this says which side, the stylesheet
 * says how much.
 */
function tightCss({ above, below }: TightStubs): string {
  let css = "";
  for (const id of below) {
    if (SAFE_ID.test(id)) css += `tr[data-block="${id}"]>td{--stub-below:var(--stub-tight)}\n`;
  }
  for (const id of above) {
    if (SAFE_ID.test(id)) css += `tr[data-block="${id}"]>td{--stub-above:var(--stub-tight)}\n`;
  }
  return css;
}

/** What "the same stretch" means: the same blocks in the same order. */
function stretchKey(ids: FoldStretch): string {
  return ids.join(" ");
}

function commit(folded: ReadonlySet<BlockId>): void {
  const blocks = article?.blocks ?? [];
  const foldable = state.foldable;
  foldedAway = hiddenBlocks(blocks, folded);
  const echo = article?.echo ?? NO_ECHO;
  const shut = new Set<BlockId>();
  const behind = new Set<BlockId>();
  for (const ids of article?.stretches ?? NO_STRETCHES) {
    if (opened.has(stretchKey(ids))) continue;
    shut.add(ids[0]!);
    for (let i = 1; i < ids.length; i++) behind.add(ids[i]!);
  }
  state = { folded, foldable, shut };
  /* In document order, so the rules read top to bottom. A stub a fold or the
     echo hides is hidden whole and needs no rule of its own. */
  const rows = new Set<BlockId>();
  const stubs = new Set<BlockId>();
  for (const b of blocks) {
    if (echo.has(b.id) || behind.has(b.id) || foldedAway.has(b.id)) rows.add(b.id);
    else if (shut.has(b.id)) stubs.add(b.id);
  }
  hidden = rows;
  stubbed = stubs;
  tight = tightStubs(blocks, rows, stubs);
  writeStyle();
  for (const l of listeners) l();
}

/**
 * **Tell the store which article is on screen.** Called by the reader whenever
 * its blocks change. A different `key` (the slug) starts with nothing folded;
 * the same key with new blocks — a re-extraction — keeps the folds whose
 * headings are still foldable.
 *
 * `echo` is the masthead's echo (masthead-echo.ts): rows hidden for as long as
 * this article is on screen. **It is part of what "the same article" means
 * here**, compared by what is in it: renaming an article changes its echo and
 * leaves the `blocks` array the very same object, and without this the rename
 * would not show until a reload (GPT Sol, plan review of 261007b, F8). An echo
 * heading is not foldable: it has no row to put a chevron on, and Fold all
 * would otherwise shut the whole article behind a control nobody can see.
 *
 * `stretches` are the front and back matter (matter-view.ts §
 * `matterStretches`), in document order, each contiguous and free of echo
 * rows. **When one is shut again:** for a different article, and for the same
 * article when that stretch is a different stretch (a re-extraction, a new
 * `matter`, or `meta` changing what the byline rule counts as a name). A
 * stretch that is the same blocks in the same order stays as the reader left
 * it whatever else changes, a rename included (GPT Sol, plan review of
 * 261007d, F10). A heading in a stretch is never foldable, open or shut, so no
 * fold can be made inside one and Fold all does not count it (261007d F5).
 */
export function setFoldArticle(
  key: string,
  blocks: readonly Block[],
  echo: ReadonlySet<BlockId> = NO_ECHO,
  stretches: readonly FoldStretch[] = NO_STRETCHES,
): void {
  /* `article !== null` spelled out: `article?.key === key` is true for no
     article and an undefined key, which a test rendering without a slug does. */
  const same = article !== null && article.key === key;
  const sameStretches = same && sameList(article?.stretches ?? NO_STRETCHES, stretches);
  if (sameStretches && article?.blocks === blocks && sameIds(article.echo, echo)) return;
  const keys = new Set(stretches.map(stretchKey));
  opened = same ? new Set([...opened].filter((k) => keys.has(k))) : new Set();
  const stretchOf = new Map<BlockId, number>();
  stretches.forEach((ids, n) => {
    for (const id of ids) stretchOf.set(id, n);
  });
  article = { key, blocks, echo, stretches, index: new Map(blocks.map((b, i) => [b.id, i])), stretchOf };
  const foldable = foldableHeadings(blocks);
  for (const id of echo) foldable.delete(id);
  for (const id of stretchOf.keys()) foldable.delete(id);
  state = { ...state, foldable };
  commit(same ? new Set([...state.folded].filter((id) => foldable.has(id))) : new Set());
}

/** The same stretches, each the same blocks in the same order. */
function sameList(a: readonly FoldStretch[], b: readonly FoldStretch[]): boolean {
  return a.length === b.length && a.every((s, i) => stretchKey(s) === stretchKey(b[i]!));
}

function sameIds(a: ReadonlySet<BlockId>, b: ReadonlySet<BlockId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The reader is gone: nothing folded, and the style element removed. */
export function clearFoldArticle(): void {
  mountedBy = null;
  article = null;
  opened = new Set();
  state = EMPTY;
  commit(new Set());
}

/** Fold or unfold one heading. A heading with nothing to fold is ignored. */
export function toggleFold(id: BlockId): void {
  if (!state.foldable.has(id)) return;
  const next = new Set(state.folded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  commit(next);
}

/**
 * **Fold everything, or open everything** — open if anything is folded, and
 * fold every foldable heading otherwise. One press, so it can be undone by the
 * same press. The stretches are left as they are: they are not folds.
 */
export function toggleFoldAll(): void {
  commit(state.folded.size > 0 ? new Set() : new Set(state.foldable));
}

/**
 * **Unfold whatever hides `id`**, synchronously, so the caller can measure its
 * row on the next line. `scrollToBlock` calls this before every jump: a jump
 * to a block is a request to see it.
 *
 * **A block in a stretch opens that whole stretch**, and the real folds that
 * cover it, and nothing else: a jump into the abstract leaves the references
 * shut.
 *
 * **An echo row is not revealed, and asking opens nothing.** It stays hidden,
 * and `scrollToBlock` sends a jump to it to the top of the page, where the
 * masthead is the visible copy of its words.
 */
export function revealBlock(id: string): void {
  if (!article || article.echo.has(id as BlockId)) return;
  const n = article.stretchOf.get(id as BlockId);
  if (n !== undefined) {
    openStretch(n);
    return;
  }
  if (!foldedAway.has(id as BlockId)) return;
  const opening = new Set(foldsHiding(article.blocks, state.folded, id as BlockId));
  commit(new Set([...state.folded].filter((h) => !opening.has(h))));
}

/**
 * Open stretch `n`: mark it wanted, and unfold every real fold that covers it.
 *
 * **Only the folds over its stub need asking about.** A heading inside a
 * stretch is never foldable, so a fold that covers any row of it starts above
 * the stretch, and a section is contiguous: it covers the stub too. After a
 * rename block 0's heading is an ordinary foldable heading and can be folded
 * over the whole article; a stretch that then stayed out of sight would read as
 * broken (GPT Sol, plan review of 261007d, F5). A stretch already open and
 * uncovered commits nothing, so a subscriber hears only real changes.
 */
function openStretch(n: number): void {
  openStretches([n]);
}

/** Open stretches `ns` in one commit, as `openStretch` opens one. */
function openStretches(ns: readonly number[]): void {
  if (!article) return;
  const covering = new Set<BlockId>();
  const keys: string[] = [];
  for (const n of ns) {
    const ids = article.stretches[n];
    if (ids === undefined) continue;
    const over = foldsHiding(article.blocks, state.folded, ids[0]!);
    for (const h of over) covering.add(h);
    if (!opened.has(stretchKey(ids)) || over.length > 0) keys.push(stretchKey(ids));
  }
  if (keys.length === 0) return;
  opened = new Set([...opened, ...keys]);
  commit(new Set([...state.folded].filter((h) => !covering.has(h))));
}

/**
 * **Open every stretch that lies wholly within blocks `start` to `end`**
 * (indices, inclusive) — what a Structure row does before its jump, so the
 * reader sees everything the row names. *Title and Abstract* is two stretches,
 * and the jump's own reveal opens only the one its first block is in (browser
 * pass of 261018a). A stretch only partly inside is left to the reveal. By
 * index, never by comparing ids. One commit, and none when all are open.
 */
export function openStretchesWithin(start: number, end: number): void {
  if (!article) return;
  const ns: number[] = [];
  article.stretches.forEach((ids, n) => {
    const first = article!.index.get(ids[0]!);
    const last = article!.index.get(ids[ids.length - 1]!);
    if (first !== undefined && last !== undefined && first >= start && last <= end) ns.push(n);
  });
  openStretches(ns);
}

/**
 * **A Structure row's press**, in either face (StructurePanel.tsx,
 * OutlinePanel.tsx): open every stretch within the row, then jump to its first
 * block. One function so the two faces cannot drift apart.
 */
export function jumpToRow(
  row: { blockId: BlockId; startRow: number; endRow: number },
  onJump: (id: BlockId) => void,
): void {
  openStretchesWithin(row.startRow, row.endRow);
  onJump(row.blockId);
}

/**
 * **Open the stretch whose stub is `stub`, or put it away again**: the stub's
 * line and the fold-away chevron (FoldToggle.tsx § `MatterStub`). Does nothing
 * for an id that is not a stub.
 */
export function toggleStretch(stub: BlockId): void {
  if (!article) return;
  const n = article.stretchOf.get(stub);
  const ids = n === undefined ? undefined : article.stretches[n];
  if (ids === undefined || ids[0] !== stub) return;
  if (state.shut.has(stub)) {
    openStretch(n!);
    return;
  }
  const key = stretchKey(ids);
  opened = new Set([...opened].filter((k) => k !== key));
  commit(state.folded);
}

/** The shut stretch `id` is in, or `undefined`. */
function shutStretchOf(id: BlockId): FoldStretch | undefined {
  const n = article?.stretchOf.get(id);
  const ids = n === undefined ? undefined : article?.stretches[n];
  return ids !== undefined && state.shut.has(ids[0]!) ? ids : undefined;
}

/**
 * **Where a jump to `id` should go if it is not meant to open anything**:
 * the first block after the stretch while `id` is in a shut one (its stub
 * included), the folded heading over it while a fold hides it, and `id`
 * itself otherwise.
 *
 * **Not the stub**, though the stub's row is on screen (GPT Sol, plan review
 * of 261018a, F6): `scrollToBlock` reveals whatever it is sent to, so an id
 * that names the stub opens the stretch. Two callers name a section by its
 * first block and must not open anything by it:
 *
 * - `step` in keynav.ts, so ↑ and ↓ step over a shut stretch rather than into
 *   it; the stub is reached by Tab, as a button;
 * - the reading position (useReadingPosition.ts), so `?at=` never names a
 *   block of a shut stretch. Written as one, a reload or a turned phone would
 *   restore it through `scrollToBlock` and open the stretch under a reader who
 *   had only scrolled past its stub. An explicit link, search hit, Structure
 *   row or comment still opens it: those go to `scrollToBlock` direct.
 *
 * A section can start inside a stretch and carry on past it: the Structure
 * prompt invites one node for the byline and the abstract together
 * (src/paperwork.ts), and that section is reached at its first block after
 * the stretch. Stretches back to back are walked past together. A shut
 * stretch that ends the article has nothing after it, and answers `null`
 * (`visibleNear` is the reading position's answer for that).
 *
 * **A block a fold hides answers the heading that folded it**, the outermost
 * one, which is the row still on screen. The reading position is the caller
 * this is for: `?at=` can hold a paragraph a jump put there, and folding a
 * heading over it would otherwise leave that hidden id standing for the next
 * restore to unfold (GPT Sol, code review of 261007d, C8). `step` never gets
 * this far with one: it drops a folded-away start first.
 */
export function visibleFrom(id: string): string | null {
  if (!article) return id;
  if (foldedAway.has(id as BlockId)) {
    return foldsHiding(article.blocks, state.folded, id as BlockId)[0] ?? id;
  }
  let ids = shutStretchOf(id as BlockId);
  if (ids === undefined) return id;
  for (;;) {
    const after = article.blocks[(article.index.get(ids[ids.length - 1]!) ?? -2) + 1]?.id;
    if (after === undefined) return null;
    ids = shutStretchOf(after);
    if (ids === undefined) return after;
  }
}

/**
 * **`visibleFrom`, and the block before the stretch when nothing comes after
 * it** — for the reading position alone. A reader at the stub of a trailing
 * *References* has scrolled to the end of the piece; writing no position
 * would send a reload back to the top, and writing the stub would open the
 * stretch. The last visible position before it is on screen beside them:
 * walking back over another shut stretch and the masthead echo, and naming a
 * real fold's heading rather than a block it hides. `null` only when there is
 * nothing on either side.
 */
export function visibleNear(id: string): string | null {
  const ahead = visibleFrom(id);
  if (ahead !== null || !article) return ahead;
  const first = shutStretchOf(id as BlockId)?.[0];
  let at = first === undefined ? -1 : (article.index.get(first) ?? 0) - 1;
  while (at >= 0) {
    const before = article.blocks[at]!.id;
    const previous = shutStretchOf(before);
    if (previous !== undefined) {
      at = (article.index.get(previous[0]!) ?? 0) - 1;
      continue;
    }
    /* An echo has no row. A real fold does: `visibleFrom` maps a block it
       hides to the fold heading, which is the position actually on screen. */
    if (article.echo.has(before)) {
      at--;
      continue;
    }
    return visibleFrom(before);
  }
  return null;
}

/**
 * **Whether `id`'s row is hidden right now**: inside a folded section, one of
 * the masthead's echo rows, or in a shut stretch past its stub. The question
 * for anything that measures a row or stands on it: a shut stretch's stub is a
 * row on screen, with a height, though its block's words are not.
 */
export function isRowHidden(id: string): boolean {
  return hidden.has(id as BlockId);
}

/**
 * **Whether `id`'s own content is hidden right now**: every row
 * `isRowHidden` names, and the stub row of a shut stretch too, whose cell
 * shows the stub in place of the block (F5). The question for anything that
 * reads, counts or attaches something to the block's words — reading time,
 * marginalia, a chat card, "is it on screen already" before a jump.
 */
export function isContentHidden(id: string): boolean {
  return hidden.has(id as BlockId) || stubbed.has(id as BlockId);
}

/** Whether `id` is one of the leading rows represented by the masthead. */
export function isMastheadEcho(id: string): boolean {
  return article?.echo.has(id as BlockId) ?? false;
}

/**
 * **Whether the section that starts at `id` is folded away**: true only when a
 * fold hides the row. An echo alone is false, and so is a row of a shut
 * stretch; either inside a real fold is true, because navigation must still
 * skip a row the fold covers.
 *
 * Two questions, because the two kinds of hiding differ in what else is gone.
 * A fold hides a whole section, so a section whose start row is folded has
 * nothing on screen and must not be named, focused or stepped to. An echo on
 * its own hides one row whose section is still on screen, and that row is block 0:
 * the start of the first section of every article. Asked `isRowHidden`, the
 * reading position wrote `?at=` as the second section while the reader was in
 * the first, Structure marked the second as current, and ↑ could not reach the
 * start of the article. So the three callers that ask about a section's start
 * ask this: `useReadingPosition`, `useColumnContext`, and `step` in keynav.ts.
 * An echo row that is hidden only because it is an echo needs no skipping
 * there: it has no height and sits at the top of the first visible row, which
 * is in its own section. A real fold can still cover that row, in which case
 * this function returns true.
 *
 * A shut stretch is the same case: a section may start on its stub or inside
 * it and carry on past it, so its start is still on screen or sits at the top
 * of that section's first visible row. A section wholly behind a stub ties
 * with the next section's start and loses to it, as a folded one does. What
 * the stretches add is `visibleFrom`, above.
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md
 */
export function isFoldedAway(id: string): boolean {
  return foldedAway.has(id as BlockId);
}

/**
 * Be told whenever a fold changes — for a measurer that has no other way to
 * hear it: folding moves rows without scrolling the page, so a scroll-driven
 * spy would otherwise keep naming a section that has just folded away.
 */
export function subscribeFold(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const subscribe = subscribeFold;

/** The fold state, for a component that draws a chevron, a stub or a fold-all button. */
export function useFold(): FoldState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/**
 * **The prose table's half: which article is on screen, and ⌘⌥T.**
 *
 * A layout effect, so a different article's folds are gone before it paints.
 * Unmounting the table — leaving the article — opens everything and removes
 * the style element, because the store outlives the component.
 *
 * The chord keeps every rule ⌘-K keeps (keyboard.md § The one chord that is
 * not an arrow): not while typing, not over an open dialog, not once a handler
 * nearer the press has claimed it, and `preventDefault()` only when there is
 * something to fold.
 */
export function useFoldArticle(
  key: string,
  blocks: readonly Block[],
  echo: ReadonlySet<BlockId> = NO_ECHO,
  stretches: readonly FoldStretch[] = NO_STRETCHES,
): void {
  const mounted = useRef(Symbol("fold article"));
  useLayoutEffect(() => {
    mountedBy = mounted.current;
    setFoldArticle(key, blocks, echo, stretches);
    const reopen = reopenFor?.token === mounted.current ? reopenFor.keys : null;
    reopenFor = null;
    if (reopen && article) {
      article.stretches.forEach((ids, n) => {
        if (reopen.has(stretchKey(ids))) openStretch(n);
      });
    }
  }, [key, blocks, echo, stretches]);
  useEffect(
    () => () => {
      if (mountedBy !== mounted.current) return;
      reopenFor = article !== null && opened.size > 0 ? { token: mounted.current, keys: opened } : null;
      clearFoldArticle();
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isModAltChord(e, "KeyT") || e.defaultPrevented) return;
      if (isTyping(document.activeElement)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      if (state.foldable.size === 0) return;
      e.preventDefault();
      toggleFoldAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
