/**
 * **Search mode's controller.** The band an owner gets, the band a visitor
 * gets, and the hook underneath both: the six URL parameters, the two matchers
 * meeting, and the passages the panel and the prose have to agree on.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useMemo } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId } from "../../../types.js";
import {
  findLiteral,
  keepAbove,
  orderFound,
  PRIORITY_CONF,
  resolveHits,
  type Found,
} from "../../search-hits.js";
import {
  confParam,
  findParam,
  type HitOrder,
  type Matcher,
  matchParam,
  orderParam,
  resolveMatcher,
  resolveRuns,
  runParam,
  runsParam,
} from "../../params.js";
import { assignSlots } from "../../hit-colours.js";
import { usePassageLifecycle } from "../../passage-lifecycle.js";
import { useRenderCount } from "../../perf.js";
import { useSearch, type SavedSearch } from "../../useSearch.js";
import { SearchPanel } from "../../SearchPanel.js";

/**
 * Search, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ConversationBand` and `GlossaryBand` above
 * are: **`useSearch` fetches on mount**, so calling it up in `Reader` would
 * charge every reader of every article a request for a list of saved searches
 * almost none of them will open. Hooks cannot be called conditionally, so the
 * condition has to be a component boundary.
 *
 * All four of its URL parameters live here too, for the same reason `?term=`
 * and `?sort=` live in `GlossaryBand`: every one of them is meaningless outside
 * search mode, and reading them in `Reader` would put four parameter
 * subscriptions on every render of the reading view for values only this
 * component uses.
 *
 * ## The two matchers meet here and nowhere else
 *
 * `results` below is the whole of that design: whichever matcher is selected
 * produces a `Found[]`, and from that line onwards the panel, the marks, the
 * bar down each paragraph and the sort control are identical. Adding a third
 * way of matching would be a third arm of this one ternary.
 *
 * The literal matcher runs **in this memo**, on every keystroke, over every
 * block — which sounds alarming and is not: it is one `indexOf` loop over a few
 * hundred short strings, and it is what makes typing feel instant rather than
 * like a search you have to submit. The expensive matcher is the one that
 * already has a button.
 */
export function SearchBand({
  slug,
  blocks,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  slug: string;
  blocks: Article["blocks"];
  onJump(id: BlockId): void;
  /* Out only. The results are computed here and pushed up to `Reader`, which
     owns the prose — the seam described on `found` there. Passing them back
     down would be a second copy of a value this component is the source of. */
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  useRenderCount("SearchBand");
  const { runs, loaded, loadFailed, ask, retry, remove, recolour, error } = useSearch(slug);
  const { panel, setActive } = useSearchMode({
    runs,
    blocks,
    words: true,
    onJump,
    onFound,
    openHit,
    onOpenHit,
  });

  return (
    <SearchPanel
      {...panel}
      access={{
        kind: "owner",
        loaded,
        loadFailed,
        error,
        onAsk: (criterion) => {
          /* `ask` mints the id, so `?runs=` can name the search before the
             model has said anything — the same trick `?note=` and `?thread=`
             use.

             And it switches itself on, which is the one exception to
             default-false: a search the reader just paid for and cannot see is
             not a result. */
          setActive([...panel.active, ask(criterion)]);
          onOpenHit(null);
        },
        onRetry: retry,
        /* Straight through. Unlike every other write on this panel it does not
           touch `?runs=` or the open row: a colour changes what a mark looks
           like, never which marks are drawn or which one the reader is on. */
        onRecolour: recolour,
        onDelete: (id) => {
          remove(id);
          setActive(panel.active.filter((x) => x !== id));
          onOpenHit(null);
        },
      }}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useSearch`, and therefore no fetch, no `ask`, no retry and no delete: the
 * saved runs came in the page's own payload. Greg, 2026-09-04 — *"Only owner
 * can create new searches. Everyone else can see the ones they have already
 * created."*
 *
 * A second band rather than a second panel, for the reason
 * `VisitorTimelineBand` and `VisitorGlossaryBand` give: a hook cannot be called
 * conditionally, so the owner/visitor seam has to be a component boundary
 * (src/web/reader-capability.ts). And `words: false`, which pins the matcher —
 * a pasted `?match=words` would otherwise put this reader in front of a box
 * that is not rendered.
 */
export function VisitorSearchBand({
  searches,
  blocks,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  searches: SavedSearch[];
  blocks: Article["blocks"];
  onJump(id: BlockId): void;
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  useRenderCount("VisitorSearchBand");
  const { panel } = useSearchMode({
    runs: searches,
    blocks,
    words: false,
    onJump,
    onFound,
    openHit,
    onOpenHit,
  });
  return <SearchPanel {...panel} access={{ kind: "visitor" }} />;
}

/**
 * **Everything the search band does that is not a fetch** — the six URL
 * parameters, the colour slots, the two matchers meeting, and the three effects
 * that keep the panel and the prose showing one set of passages.
 *
 * Extracted on 2026-09-04 so that the owner's band and the visitor's are one
 * behaviour rather than two, which is the same split `useTimelineMode` and
 * `useQuotesMode` already have.
 *
 * **It returns two things rather than one**, unlike its siblings, and the
 * second is the reason: `onAsk` and `onDelete` are the owner's alone, and both
 * of them have to write `?runs=` — a search the reader just paid for switches
 * itself on, and a deleted one switches itself off. `setActive` is that write,
 * handed back so those two verbs can stay on the arm they belong to instead of
 * being passed *in* here as optionals.
 */
function useSearchMode({
  runs,
  blocks,
  words,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  runs: SavedSearch[];
  blocks: Article["blocks"];
  /**
   * **Is the literal matcher on offer to this reader?**
   *
   * True for an owner, false for a visitor, and it decides the value of
   * `matcher` rather than only hiding a control — `?match=words` is ordinary
   * query state, and a pasted link walks straight past a chip that was merely
   * not drawn. The same pin `DiagramPanel` puts on `?diagram=`, for the same
   * reason. See `PublicArticle.searches` for why v1 leaves it out.
   */
  words: boolean;
  onJump(id: BlockId): void;
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  const [match, setMatcher] = useQueryState("match", matchParam);
  const [find, setFind] = useQueryState("find", findParam);
  /* `?match=` has no default of its own, so that a URL carrying `?find=` and
     nothing else still opens on the words matcher it was written for. The rule
     lives in params.ts § resolveMatcher; here it is one line.

     **And `words` overrides it**, in this component, whatever the URL says —
     see the prop. */
  const matcher: Matcher = words ? resolveMatcher(match, find) : "meaning";
  /* `?run=` is read and never written — the one-search URLs that existed before
     2026-08-26 seed the set, and from then on it is `?runs=`. params.ts §
     resolveRuns has the why. */
  const [run1] = useQueryState("run", runParam);
  const [runIds, setRunIds] = useQueryState("runs", runsParam);
  const active = useMemo(() => resolveRuns(runIds, run1), [runIds, run1]);
  const [order, setOrder] = useQueryState("order", orderParam);
  /* Null until the reader drags it — see confParam, and `gateParam` beside it,
     for why "nobody has touched this" has to stay distinguishable from "the
     reader chose the default". */
  const [chosenConf, setConf] = useQueryState("conf", confParam);
  const gate = chosenConf ?? PRIORITY_CONF;

  /**
   * Which colour each saved search wears.
   *
   * Over **every** saved run, not just the switched-on ones, and that is the
   * point rather than an oversight: a search's colour must not change when the
   * reader unticks the search above it. Assigning over the active set would do
   * exactly that, and it would be the kind of wrong that looks like a rendering
   * glitch — the same three passages, a different colour, every time you touch
   * a box. hit-colours.ts § What the assignment has to be.
   */
  const slots = useMemo(() => assignSlots(runs), [runs]);

  /* One list, two producers, and on the meaning side several searches merged.

     **A `pending` run contributes its hits now**, which is the whole of what
     streaming search buys the reader: since 2026-08-26 the hook appends each
     passage to `run.hits` as it arrives and leaves the status `pending` until
     the authoritative result lands, so filtering on `done` here meant the marks
     appeared in the prose all at once at the end anyway. Everything upstream
     streamed and this line quietly undid it.

     The comment this replaces said a pending run "has no hits", which was true
     when it was written and is the reason to reread a filter rather than trust
     the sentence above it.

     A failed run still contributes nothing, and that half of the original
     reasoning stands: it has no hits worth trusting, and showing an older run's
     marks under a newer run's colour would be the panel and the prose saying
     different things. Stale hits cannot leak in on a retry either — the hook
     writes a fresh `hits: []` before it reopens the stream. */
  const answered = useMemo(
    () =>
      runs
        .filter((r) => active.includes(r.id) && r.status !== "error")
        .map((r) => ({ id: r.id, slot: slots.get(r.id) ?? 0, hits: r.hits })),
    [runs, active, slots],
  );

  /* The ordered results, before the prioritised bar. Kept as its own value
     because the slider needs a denominator: the reader has to be told `3 of 11`
     rather than `3`, or a filter that hides eight things looks like a search
     that found three. */
  const ordered = useMemo(
    () =>
      orderFound(
        matcher === "words" ? findLiteral(blocks, find) : resolveHits(blocks, answered),
        order,
      ),
    [matcher, blocks, find, answered, order],
  );

  /* And after it. **This is the one place the threshold may be applied**, for
     the same reason `ordered` is computed here rather than in the panel: what
     goes to the panel goes to the prose, so the marks in the article are the
     rows in the list and can never be a different set. A filter applied in the
     panel would hide a row and leave its wash on the paragraph. See the
     `hitMarks` prop in TableView.tsx and `found` in Reader above.

     Note it is the whole list back again for every order but this one, so
     `?conf=` sitting in a URL cannot filter a list the reader is not looking
     at a threshold for. */
  const results = useMemo(
    () => (order === "prioritised" ? keepAbove(ordered, gate) : ordered),
    [ordered, order, gate],
  );

  /* **The three rules every passage producer follows** — publish the results
     before paint, drop an open hit the list no longer has, and clear both on the
     way out — in src/web/passage-lifecycle.ts rather than here, because six
     components held six copies of them.

     The publication has to happen before paint and not after, and the difference
     is a frame the reader can see: this component renders the new results list
     immediately, the prose is `Reader`'s and only changes once this setter has
     run and a second commit has happened. That is the one invariant this feature
     is built around (search-hits.ts § the panel and the prose agree), so a frame
     of disagreement is worth a synchronous commit. Raised by a GPT Sol review,
     2026-08-26, which is also right that the real fix is one owner for the
     derived state rather than two — this hook is half of that.

     Dropping an open hit is what stops the bar hiding a row and leaving the key
     behind: nothing on screen would say it was open, and dragging the bar back
     later would silently reopen a selection the reader watched disappear. Keyed
     on absence from `results`, so ordinary streaming — where the open row is
     still in the list — leaves it alone. The *other* triggers that clear it —
     the matcher, `find`, solo and toggle-all — are this band's own gestures and
     stay below. */
  usePassageLifecycle({
    kind: "keyed",
    found: results,
    openKey: openHit,
    onFound,
    onOpenKey: onOpenHit,
  });

  return {
    /* Spread straight into `SearchPanel` by both bands, so the two cannot drift
       into passing different things — the shape `useTimelineMode` already has. */
    panel: {
      runs,
      matcher,
      onMatcher: (next: Matcher) => {
        void setMatcher(next);
        /* The selection goes with the matcher, because the row it names belongs
           to the list that is about to be replaced. The ticks do **not**: they
           are the reader's own answer to "what should be marked", and switching
           to words to look something up and back again should return them to
           the article they left rather than to a blank one. That is a change
           from the single-`?run=` version, which cleared it — because there
           "which search is open" was a view state that words mode plainly did
           not have, and a set of ticks is a preference that survives a look
           elsewhere. */
        onOpenHit(null);
      },
      find,
      onFind: (next: string | null) => {
        void setFind(next);
        onOpenHit(null);
      },
      active,
      slots,
      onToggle: (id: string, on: boolean) => {
        void setRunIds(on ? [...active, id] : active.filter((x) => x !== id));
        /* Whatever row was open may have belonged to the search just switched
           off, and a highlighted row pointing at a mark that is no longer drawn
           is the panel and the prose disagreeing. Cheap to clear, and the
           reader loses only a highlight. */
        onOpenHit(null);
      },
      /* Pressing the row rather than its box: the set becomes this one search.
         Greg, 2026-08-27 — *"if I click on a row, select that and deselect all
         the others (since usually we care about just one at a time). If I want
         multiple-selection, I'll use a checkbox."* Not a toggle, so pressing
         the row that is already alone leaves it alone; the box is what unticks.
         The open row goes for the same reason it goes on a toggle — it may have
         belonged to a search that is no longer drawing anything. */
      onSolo: (id: string) => {
        void setRunIds([id]);
        onOpenHit(null);
      },
      onToggleAll: (on: boolean) => {
        void setRunIds(on ? runs.map((r) => r.id) : []);
        onOpenHit(null);
      },
      found: results,
      all: ordered,
      order,
      onOrder: (next: HitOrder) => void setOrder(next),
      gate,
      gateMoved: chosenConf !== null,
      onGate: (next: number | null) => void setConf(next),
      openKey: openHit,
      onOpen: (key: string, blockId: BlockId) => {
        onOpenHit(key);
        // Always jump, even when the block is already on screen — unlike
        // stepping between comments, which deliberately does not. A search
        // result is a place you have not been yet, and "I pressed it and
        // nothing moved" is the complaint that makes a results list feel
        // broken; two comments in one paragraph are the opposite case.
        onJump(blockId);
      },
    },
    /* `?runs=`, for the owner's two verbs that write it. See the docblock. */
    setActive: (ids: string[]) => void setRunIds(ids),
  };
}
