/**
 * The search panel — the fourth **mode** in the band between the spine and the
 * prose. See docs/project/search.md, and docs/plans/260826a-chat-mode.md for where the
 * band came from.
 *
 * ## One box, two matchers
 *
 * The whole panel is arranged around a decision Greg made on 2026-08-26: the
 * literal matcher and the meaning matcher share one box and one results list,
 * and a toggle says which is running. The version this is borrowed from reached
 * the same arrangement and wrote down why —
 *
 * > Text search and meaning-based search answer different questions and their
 * > version ran both, side by side.
 *
 * — and its own summary of the relationship is the one this file implements:
 * *one place to look for things, two ways of matching.*
 *
 * The practical difference the reader has to feel, and which the panel is at
 * pains to make obvious, is **what pressing the key does**. In `words` the
 * results are already there as you type: free, instant, no round trip. In
 * `meaning` nothing happens until you submit, because submitting spends a model
 * call and half a minute. A box that quietly billed you per keystroke would be
 * the worst possible version of this feature.
 *
 * ## Why the results list is not a summary
 *
 * Every row is an **index into the article**: press it and the page goes there.
 * That is the same contract chat's citation chips hold, and it is what keeps
 * this on the augment side of the line in docs/project/vision.md — the panel
 * points at the prose, it does not stand in for it. Hence the two snippet
 * lengths rather than one: enough in the row to recognise a passage, enough on
 * hover to judge it, and never enough to save you the trip.
 *
 * ## Several searches at once, each with a colour — 2026-08-26
 *
 * Greg: *"assign a categorical colour to each of the Search highlights. And
 * then add a checkbox by each of them (default-false), and allow multiple to be
 * active, showing their results overlaid somehow. And a box at the top of the
 * Search column for select/deselect-all."*
 *
 * Three things follow, and each of them removed something rather than adding to
 * it.
 *
 * **There is no "open" search any more.** A saved search used to be a thing you
 * opened, which replaced the list with its results; `?run=` named the one that
 * was open. Now every saved search is on screen all the time with a box beside
 * it, and the results of every ticked one are in a single list underneath. So
 * the state is a *set* — `?runs=` (params.ts) — and the list-or-results ternary
 * this component used to be built around is gone. The rule the merged list has
 * to keep is the one the colour is for: every row says which question found it.
 *
 * **The box is now only ever a draft.** With no open search there is no
 * criterion arriving from the server to put into it, so the effect that did
 * that, and the `dirty` ref that guarded the effect against a fetch landing
 * while the reader typed, are both gone. The feature they existed for is not:
 * the ↺ button on a saved row puts its question back in the box, and it does it
 * from a click rather than from an effect, so there is nothing left to race.
 *
 * **Default-false is the same rule the glossary and the summaries follow.** A
 * reader who opens search mode sees an unmarked article until they say
 * otherwise. Asking a *new* question is the one thing that ticks a box for you,
 * because a search you just paid for and cannot see is not a result.
 *
 * ## The row and the box are not the same control — 2026-08-27
 *
 * Greg: *"if I click on a row, select that and deselect all the others (since
 * usually we care about just one at a time). If I want multiple-selection,
 * I'll use a checkbox."*
 *
 * The set stayed; what changed is which gesture builds it. Several-at-once is
 * the thing this panel *can* do, not the thing a reader usually wants, and the
 * `<label>` wrapping the whole row made the rare case the only case — every
 * press added or removed, so getting to "just this one" from four ticked was
 * four presses. Now the row is a button that sets the set to itself, and the
 * box beside it is the one that adds. See `Saved` for the two of them.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import {
  AlertTriangle,
  LoaderCircle,
  Palette,
  RotateCcw,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { worthRetrying } from "../messages.js";
import type { BlockId, SearchRun } from "../types.js";
import type { SavedSearch } from "./useSearch.js";
import type { Found } from "./search-hits.js";
import {
  confNote,
  CONF_STEP,
  countAbove,
  MIN_FIND_CHARS,
  PRIORITY_CONF,
} from "./search-hits.js";
import type { HitOrder, Matcher } from "./params.js";
import { PALETTE_BY_HUE } from "./hit-colours.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";
import { useSlow } from "./useSlow.js";

interface Props {
  matcher: Matcher;
  onMatcher(next: Matcher): void;
  /** The literal query, in words mode. Live-bound to `?find=`. */
  find: string | null;
  onFind(next: string | null): void;
  /**
   * Every saved meaning-search for this article, each carrying whether the
   * article has moved since it was answered — `SavedSearch` in useSearch.ts.
   */
  runs: SavedSearch[];
  /** False until the fetch has answered — see `SearchApi.loaded`. */
  loaded: boolean;
  /** …and whether it answered by failing. `SearchApi.loadFailed`. */
  loadFailed: boolean;
  /** Which of them are switched on — `?runs=`. Possibly none, which is the default. */
  active: string[];
  /** Its palette slot, for every saved run. `assignSlots` in hit-colours.ts. */
  slots: Map<string, number>;
  onToggle(id: string, on: boolean): void;
  /**
   * Show this one and nothing else — pressing the row rather than its box.
   * Greg, 2026-08-27: *"if I click on a row, select that and deselect all the
   * others (since usually we care about just one at a time). If I want
   * multiple-selection, I'll use a checkbox."*
   */
  onSolo(id: string): void;
  /** Every box at once — the control at the top of the list. */
  onToggleAll(on: boolean): void;
  onAsk(criterion: string): void;
  onRetry(id: string): void;
  /**
   * Pin one saved search to a palette slot — `null` hands it back to the hash.
   *
   * Greg, 2026-08-27: *"In Search mode, I'd like to be able to change the
   * colour for a given row."* The panel deals in slot numbers only; see
   * `ColourPicker` at the foot of this file for why there is no library behind
   * it and why a colour value never reaches TypeScript.
   */
  onRecolour(id: string, colour: number | null): void;
  onDelete(id: string): void;
  /** The results of whichever matcher is running, already ordered and merged. */
  found: Found[];
  order: HitOrder;
  onOrder(next: HitOrder): void;
  /**
   * The same results *before* the prioritised bar, so the slider has a
   * denominator and a track that ends where the data does. `found` is what
   * survives; this is what there was.
   */
  all: Found[];
  /** Where the bar is, resolved — `?conf=` or `PRIORITY_CONF`. */
  gate: number;
  /** Whether the reader has actually moved it, so the reset can stay hidden. */
  gateMoved: boolean;
  onGate(gate: number | null): void;
  /** The row the reader last pressed, so the list and the prose agree. */
  openKey: string | null;
  onOpen(key: string, blockId: BlockId): void;
  /** A transport failure. Model failures live on the run that failed. */
  error: string | null;
}

export function SearchPanel({
  matcher,
  onMatcher,
  find,
  onFind,
  runs,
  loaded,
  loadFailed,
  active,
  slots,
  onToggle,
  onSolo,
  onToggleAll,
  onAsk,
  onRetry,
  onRecolour,
  onDelete,
  found,
  all,
  order,
  onOrder,
  gate,
  gateMoved,
  onGate,
  openKey,
  onOpen,
  error,
}: Props) {
  useRenderCount("SearchPanel");
  /**
   * The draft question, lifted out of `Box`.
   *
   * It lives here rather than in the input because two things now write it: the
   * reader typing, and the ↺ on a saved row. Keeping it in `Box` and pushing the
   * second one in through a prop would need an effect to notice the prop
   * changed — which is the shape of the bug this component used to carry, where
   * a criterion arriving from a fetch overwrote what the reader was typing. A
   * click is not a race; an effect watching a value is.
   */
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLInputElement>(null);

  /** Put a saved question back in the box, ready to be edited into the next one. */
  function reuse(criterion: string) {
    setDraft(criterion);
    /* Focus, because the only reason to press ↺ is to change the words. Without
       it the text appears somewhere the reader is not, and they have to click
       into it before they can do the thing they asked for. */
    box.current?.focus();
  }

  /* Whether *any* switched-on search is still out. In words mode there is
     nothing to wait for, so the spinner never shows: a literal match is
     already done by the time you have finished the keystroke. */
  const searching = runs.some((r) => active.includes(r.id) && r.status === "pending");

  return (
    <aside className="mode-band srch" aria-label="Search this article">
      <div className="band-head">
        <SearchIcon size={14} className="band-head-icon" aria-hidden />
        <h2>Search</h2>
      </div>

      <Box
        ref={box}
        matcher={matcher}
        onMatcher={onMatcher}
        find={find}
        onFind={onFind}
        draft={draft}
        onDraft={setDraft}
        busy={matcher === "meaning" && searching}
        onAsk={onAsk}
      />

      {error && <p className="srch-error">{error}</p>}

      {/* The saved list and the results are on screen together now, rather than
          one replacing the other. That is the whole of the multi-search change
          seen from here: the ticks are the control and the list below is what
          they add up to, so a reader can watch one appear as they tick it.
          Words mode has no saved searches to tick, so it gets the results
          alone. */}
      {matcher === "meaning" && (
        <Saved
          runs={runs}
          loaded={loaded}
          loadFailed={loadFailed}
          active={active}
          slots={slots}
          onToggle={onToggle}
          onSolo={onSolo}
          onToggleAll={onToggleAll}
          onReuse={reuse}
          onRetry={onRetry}
          onRecolour={onRecolour}
          onDelete={onDelete}
        />
      )}
      {/* Above the results and below the ticks, because it is about the marks
          in the article as much as about the list: a stale run's passages are
          drawn wherever their quotes still match, and where the words have
          moved they land on the wrong ones or on nothing at all. Only for
          searches that are actually switched on — a warning about a run whose
          box is unticked is a warning about nothing on screen. */}
      <StaleNote runs={matcher === "meaning" ? runs : []} active={active} />

      <Results
        found={found}
        all={all}
        order={order}
        onOrder={onOrder}
        gate={gate}
        gateMoved={gateMoved}
        onGate={onGate}
        openKey={openKey}
        onOpen={onOpen}
        matcher={matcher}
        slots={slots}
        runs={runs}
        loaded={loaded}
        active={active}
        typed={(find ?? "").trim().length}
      />
    </aside>
  );
}

/**
 * The box, the two-way toggle, and the one submit.
 *
 * One `<input>` over **two sources of truth**. In words mode the text *is*
 * `?find=`, because a literal search changes what the article looks like and
 * therefore lives in the URL; in meaning mode it is a local draft that becomes a
 * saved run on submit, because writing the URL on every keystroke would either
 * cost history entries or spend model calls. The element is controlled in both —
 * `value` is always supplied — and which state it is controlled *by* is the
 * ternary below.
 *
 * (It used to be keyed on the matcher, with a comment claiming one mode was
 * uncontrolled. Neither was true: `value` was never undefined, so the remount
 * bought nothing except throwing the cursor position away. Caught by a GPT Sol
 * review, 2026-08-26.)
 *
 * ## What the toggle must not do, and used to
 *
 * Greg, 2026-08-26: *"if I have text in the input box when I switch from words
 * to meaning or vice versa, preserve it."*
 *
 * Two lifecycles is an implementation detail, and before this the reader could
 * see it: the words they had typed lived in `?find=` and the meaning draft lived
 * in `useState`, so pressing the other matcher emptied the box. That is the
 * worst moment to lose it — switching matcher is precisely the act of saying
 * *"try this same thing the other way"*, and the reader who does it has to
 * retype what they were looking at.
 *
 * So `switchTo` hands the text across the seam, in whichever direction it is
 * crossing, and does it **before** telling the parent, so the parent's own
 * clean-up (which drops `?run=` on the way into words mode) cannot land first
 * and wipe the value we are about to copy.
 *
 * `?find=` is cleared on the way *into* meaning mode rather than left behind.
 * A literal query sitting in the URL while a meaning-search is on screen would
 * be a parameter nothing is reading — and, worse, it is exactly the shape
 * `resolveMatcher` reads as "this URL is a words search" (params.ts).
 *
 * ## The effect that used to be here, and is not any more
 *
 * A saved run's criterion arrived from the server, not from the first render,
 * so this component carried an effect that put it in the box when it landed —
 * and a `dirty` ref to stop that effect deleting what the reader had typed in
 * the meantime, because landing on `?mode=search&run=<id>` focuses the box a
 * whole request before the criterion exists. That was a real race and the guard
 * was a real fix (found by a GPT Sol review, 2026-08-26).
 *
 * Both are gone as of the multi-search change, because the thing they were
 * guarding stopped existing: no search is "open", so nothing arrives from the
 * server that wants to be in the box. Putting a saved question back is now the
 * ↺ button on its row, which is a click, and a click cannot arrive while the
 * reader is halfway through a word. Worth writing down rather than deleting
 * silently — the guard looked like defensive coding and was not, and the reason
 * it is safe to remove is that its cause went, not that it was unnecessary.
 */
const Box = forwardRef<
  HTMLInputElement,
  {
    matcher: Matcher;
    onMatcher(next: Matcher): void;
    find: string | null;
    onFind(next: string | null): void;
    /** The meaning-mode draft, owned by `SearchPanel` — see the note there. */
    draft: string;
    onDraft(next: string): void;
    busy: boolean;
    onAsk(criterion: string): void;
  }
>(function Box({ matcher, onMatcher, find, onFind, draft, onDraft, busy, onAsk }, ref) {
  /* The parent needs this to focus the box from ↺, and the input needs it for
     the focus-on-mount below and for `switchTo`. `useImperativeHandle` would
     hand back a narrowed object; there is nothing to narrow, so the ref is
     simply shared. */
  const box = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => box.current as HTMLInputElement, []);

  /* The box takes focus when the mode opens. A search panel you have to click
     into before typing is a search panel that costs two actions instead of one,
     and this one is only ever on screen because the reader asked for it.

     On mount only. Focus after a matcher switch is handled in `switchTo`, and
     it is handled there rather than here because it must depend on *how* the
     matcher was switched: a pointer click means "I want to type now", and a
     keyboard press inside the radio group means "I am still using this group".
     Same distinction, and the same `e.detail` test, as Dock.tsx § DockModes. */
  useEffect(() => box.current?.focus(), []);

  const setDraft = onDraft;
  const value = matcher === "words" ? (find ?? "") : draft;
  const ready = matcher === "meaning" && draft.trim().length > 0 && !busy;

  /**
   * Change matcher, taking whatever is in the box along with it.
   *
   * `toBox` is whether to move focus into the input afterwards — true for a
   * pointer click, false for a key press, so arrow-stepping the group does not
   * throw the reader out of it on the first press.
   */
  function switchTo(next: Matcher, toBox: boolean) {
    if (next !== matcher) {
      if (next === "meaning") {
        setDraft(value);
        onFind(null);
      } else {
        onFind(draft.trim() === "" ? null : draft);
      }
      onMatcher(next);
    }
    if (toBox) box.current?.focus();
  }

  return (
    <div className="srch-box">
      <div className="srch-field">
        <input
          ref={box}
          className="srch-input"
          type="search"
          value={value}
          placeholder={matcher === "words" ? "find these words…" : "describe what to look for…"}
          aria-label={matcher === "words" ? "Find these words" : "Describe what to look for"}
          onChange={(e) => {
            if (matcher === "words") onFind(e.target.value || null);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) {
              e.preventDefault();
              onAsk(draft);
            }
            /* Escape clears the search rather than closing the mode. The mode
               has a button of its own in the bar, and a key that sometimes
               empties a box and sometimes throws you out of the panel is a key
               nobody trusts. */
            if (e.key === "Escape") {
              e.preventDefault();
              /* It empties the box and nothing else. It used to also close the
                 open search, back when there was one; now the ticks own what is
                 showing, and a key that silently unticked them would undo work
                 the reader can see they did. */
              if (matcher === "words") onFind(null);
              else setDraft("");
            }
          }}
        />
        {busy && <LoaderCircle size={14} className="srch-spin" aria-label="Searching" />}
      </div>

      <div className="srch-modes">
        {/* A radio group and not two toggles: these are one of two, not two
            independent switches, and the difference is what a screen reader
            announces. Dock.tsx makes the opposite call for its mode buttons and
            says why — there, two is not enough to be worth the arrow-key
            behaviour a radiogroup promises; here the two sit inside one control
            with one label, which is exactly the case the role is for.

            **The group is its own element, and `find` is outside it.** A
            radiogroup's children are its radios; a submit button sitting among
            them is both an ARIA lie and a live bug, because the arrow handler is
            on the container and a reader who tabbed to `find` and pressed → would
            have switched matcher from a button that has nothing to do with the
            choice. */}
        <div
          className="srch-matchers"
          role="radiogroup"
          aria-label="How to match"
        >
          {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern, and the same call Dock.tsx makes for the mode switcher — a real <input type="radio"> cannot carry an icon beside its label, and styling one to match means hiding the input and faking every state it already had */}
          <button
            type="button"
            role="radio"
            aria-checked={matcher === "words"}
            /* **A tab stop each, and no arrow keys.** The roving tabindex and
               the `onModeKey` handler that made it navigable went on
               2026-08-31: the arrows belong to the article (↑ / ↓ step it,
               ← / → choose the stride — keyboard.md), and this handler
               deliberately called `stopPropagation`, so all four died while a
               matcher had focus. Dock.tsx § DockModes has the reasoning, the
               cost, and why the ARIA authoring practice is being departed from;
               tests/arrows-belong-to-the-article.test.tsx holds it. */
            tabIndex={0}
            className={`srch-mode${matcher === "words" ? " on" : ""}`}
            onClick={(e) => switchTo("words", e.detail > 0)}
            title="Match the letters you type. Instant, and free."
          >
            <Type size={12} /> words
          </button>
          {/* biome-ignore lint/a11y/useSemanticElements: as above — one of two, in one group, with one label */}
          <button
            type="button"
            role="radio"
            aria-checked={matcher === "meaning"}
            tabIndex={0}
            className={`srch-mode${matcher === "meaning" ? " on" : ""}`}
            onClick={(e) => switchTo("meaning", e.detail > 0)}
            title="Describe what you are looking for and the model finds it. Costs a model call."
          >
            <Sparkles size={12} /> meaning
          </button>
        </div>
        {/* Only in meaning mode, because only meaning mode has a moment of
            submission. In words mode there is nothing to press: the results are
            already there. Saying so with the absence of a button is clearer
            than a disabled one, which invites a reader to wonder what they did
            wrong. */}
        {matcher === "meaning" && (
          <button
            type="button"
            className="srch-go"
            disabled={!ready}
            onClick={() => onAsk(draft)}
            title="Find the passages that match — one model call"
          >
            find
          </button>
        )}
      </div>
    </div>
  );
});

/**
 * The saved meaning-searches, most recent first, each with a box and a colour.
 *
 * This list is the answer to the criticism the version this is borrowed from
 * earned: *theirs vanished on reload, which quietly makes the feature a toy —
 * nothing you produce with it can be returned to*
 * (docs/project/original-version/highlighting.md). Ticking a row here repaints
 * the whole article with no model call and no wait, because the answer is on
 * disk.
 *
 * ## Four targets on a row, and the two that look alike do different things
 *
 * The box and the words used to be one `<label>`, so pressing either toggled.
 * Since 2026-08-27 they are two controls, because Greg asked for the ordinary
 * reading of a list —
 *
 * > if I click on a row, select that and deselect all the others (since usually
 * > we care about just one at a time). If I want multiple-selection, I'll use a
 * > checkbox.
 *
 * — so **the box adds** (this search as well as whatever is already marked) and
 * **the row replaces** (this search and nothing else). Then ↺, which puts the
 * question back in the box so it can be edited into the next one, and 🗑, which
 * deletes.
 *
 * That is one more hit area than there was, and it is the arrangement
 * library.md § What you can do to a card describes giving up on — a nested
 * button inside a clickable row is a target that does two things depending on a
 * few pixels. What makes it survivable here and not there is that neither of
 * these two is destructive and both are one press from undoing: a mis-hit marks
 * the wrong searches for as long as it takes to press the right thing. The
 * pixels still matter, so the box keeps its own padding rather than sharing the
 * row's (styles.css § .srch-saved-tick).
 *
 * ## The dot is not the only thing saying which colour this is
 *
 * It is a dot **and** the row's own left edge, in the same hue. One is easy to
 * miss at 11px, and colour discrimination in a small field is exactly where
 * this fails first — the same reason the granularity columns' tints run down
 * lightness as well as chroma (styles.css § --depth-0). Neither is load-bearing
 * on its own: the criterion is printed in full beside them, so a reader who
 * cannot tell two hues apart has still lost nothing but a shortcut.
 */
/**
 * The wait before the saved searches, and nothing at all if the wait is short.
 *
 * Behind `useSlow` since 2026-08-27. It used to draw the moment the panel
 * opened, so on a warm cache it was a spinner that appeared and vanished inside
 * 100ms — which reads as breakage, and is the failure the whole
 * empty-versus-loading rule is trying to avoid rather than a second copy of it.
 * useSlow.ts, and docs/project/web-client.md § Empty is not the same as not
 * asked yet.
 *
 * Its own component because `useSlow` is a hook and `Saved` returns early.
 */
function SavedLoading() {
  const slow = useSlow(true);
  return (
    <div className="srch-empty">
      {/* `role="status"` rather than a bare paragraph: the words arrive 600ms
          after the panel does, and a line that appears with no live region
          around it is silent to a screen reader. It also reads politely — the
          reader is not interrupted, they are told when they next pause.
          `srch-waiting` holds the line's height across those 600ms, so the
          panel does not grow when the sentence lands. GPT Sol, 2026-08-27. */}
      <p className="srch-working srch-waiting" role="status">
        {slow && (
          <>
            <LoaderCircle size={13} className="srch-spin" /> Fetching your saved searches…
          </>
        )}
      </p>
    </div>
  );
}

function Saved({
  runs,
  loaded,
  loadFailed,
  active,
  slots,
  onToggle,
  onSolo,
  onToggleAll,
  onReuse,
  onRetry,
  onRecolour,
  onDelete,
}: {
  runs: SavedSearch[];
  loaded: boolean;
  loadFailed: boolean;
  active: string[];
  slots: Map<string, number>;
  onToggle(id: string, on: boolean): void;
  onSolo(id: string): void;
  onToggleAll(on: boolean): void;
  onReuse(criterion: string): void;
  onRetry(id: string): void;
  onRecolour(id: string, colour: number | null): void;
  onDelete(id: string): void;
}) {
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /* Not "nothing searched for yet" until we know that. An empty list means two
     different things for the length of one request, and the wrong one is a
     claim about the article rather than about our own fetch — see
     `SearchApi.loaded`. It is also the only thing a reader following a shared
     link sees, and for a legacy `?run=` link it directly contradicts the URL. */
  if (!loaded && sorted.length === 0) {
    return <SavedLoading />;
  }

  /* And the state one beat later, which the fix above did not cover. `loaded`
     is true either way by design (SearchApi.loaded), so a request that gave up
     dropped straight out of the spinner into the sentence below — the same
     claim about the article, arrived at from the other side. GPT Sol found it
     in the equivalent chat fix, 2026-08-27. The error itself is printed above
     by `srch-error`; this only refuses to make the claim. */
  if (loadFailed && sorted.length === 0) {
    return (
      <div className="srch-empty">
        <p>Couldn't load your saved searches. Reload to try again.</p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="srch-empty">
        <p>Nothing searched for yet.</p>
        <p className="srch-empty-hint">
          Describe what you are after — <em>arguments against the main claim</em>, <em>anywhere he
          gives numbers</em> — and the passages that match get marked in the article, strongest
          first. Searches are kept, so coming back to one costs nothing, and you can switch several
          on at once — each gets a colour of its own.
        </p>
      </div>
    );
  }

  const on = sorted.filter((r) => active.includes(r.id)).length;

  return (
    <div className="srch-saved-wrap">
      <AllBox count={sorted.length} on={on} onToggleAll={onToggleAll} />
      <ul className="srch-saved">
        {sorted.map((run) => {
          const checked = active.includes(run.id);
          const slot = slots.get(run.id);
          return (
            <li
              key={run.id}
              className={`srch-saved-row${checked ? " on" : ""}`}
              /* The hue, as a slot reference rather than a colour — the same
                 seam annotate.ts keeps, and for the same reason: a palette
                 change should be one edit in colourscales.css. `undefined`
                 rather than a fallback colour when a run somehow has no slot,
                 so the row falls back to the neutral rule in styles.css instead
                 of to a hue that means a different search. */
              style={
                slot === undefined
                  ? undefined
                  : ({ "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties)
              }
            >
              {/* The box on its own, no longer wrapping the words beside it.
                  The two targets now say two different things — the box adds
                  this search to whatever is already marked, pressing the row
                  marks this one and nothing else — and a `<label>` around both
                  would have made the second impossible to express. Its name is
                  therefore on an `aria-label` rather than in visible text: the
                  criterion is right there, but it belongs to the button now. */}
              <label className="srch-saved-tick">
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={`Also mark: ${run.criterion}`}
                  title="Mark this search as well as the ones already showing"
                  onChange={(e) => onToggle(run.id, e.target.checked)}
                />
              </label>
              {/* A button, so the keyboard reaches it and Enter does what the
                  click does. Deliberately not a toggle: pressing the row that
                  is already the only one on leaves it on, because "show me
                  just this" is a place to arrive at rather than a switch, and
                  a second press emptying the article would be the panel
                  punishing a reader for pressing twice. Unticking is what the
                  box is for. */}
              <button
                type="button"
                className="srch-saved-body"
                title={`${run.criterion}\n\nMark only this search`}
                onClick={() => onSolo(run.id)}
              >
                <span className="srch-saved-criterion">{run.criterion}</span>
                <span className="srch-saved-meta">
                  {run.status === "pending" ? (
                    <>
                      <LoaderCircle size={11} className="srch-spin" /> searching…
                    </>
                  ) : run.status === "error" ? (
                    <>
                      <AlertTriangle size={11} /> failed
                    </>
                  ) : (
                    <>
                      {run.hits.length} passage{run.hits.length === 1 ? "" : "s"}
                      {/* Said on the row, not only in a banner, because with
                          several searches on there is no longer one run for a
                          shared area to be about — the same reason the retry
                          moved down here. The words are the tweet thread
                          page's, deliberately: this is the same fact about
                          the same article and it should not need a second
                          vocabulary (docs/plans/260825g-tweet-thread-page.md). */}
                      {run.stale && (
                        <span
                          className="srch-saved-stale"
                          title={
                            "This search describes an older version of the article. The text was " +
                            "re-fetched or re-extracted afterwards, so its passages may have moved " +
                            "— or gone. ↺ puts the question back in the box so you can ask it again."
                          }
                        >
                          <AlertTriangle size={11} /> older version
                        </span>
                      )}
                    </>
                  )}
                </span>
              </button>
              {/* Retry lives on the row now rather than in the results area.
                  It had to move: the results area is shared by every switched-on
                  search, so it can no longer show one run's error with one run's
                  button under it. A failure belongs to the search that failed,
                  and this is where that search is. */}
              {/* Two shapes, and which one appears is decided by the stored
                  message: a button while running it again could work, and the
                  same warning sign as plain text when it could not. The mark
                  stays either way — the reader still needs to see that this
                  search failed and to be able to read why. What goes is the
                  invitation to spend another model call on the same refusal.
                  src/messages.ts § worthRetrying. */}
              {run.status === "error" &&
                (worthRetrying(run.error) ? (
                  <button
                    type="button"
                    className="srch-icon"
                    title={run.error ?? "This search failed. Try it again."}
                    onClick={() => onRetry(run.id)}
                  >
                    <AlertTriangle size={13} />
                  </button>
                ) : (
                  <span className="srch-icon srch-icon-dead" title={run.error ?? "This search failed."}>
                    <AlertTriangle size={13} />
                  </span>
                ))}
              {/* Fourth control on a row that already had three, in a band
                  288px wide — so it is an icon in the same group rather than a
                  coloured dot of its own. A dot would have been the more direct
                  affordance and was rejected on two counts: the row already
                  says its colour twice (the box and the left edge, § The dot is
                  not the only thing), so a third coloured thing is noise; and a
                  swatch pressed to *open* a menu sits a few pixels from a box
                  that means something else entirely, which is the arrangement
                  .srch-saved-tick's own comment warns about. */}
              <ColourPicker
                slot={slot}
                chosen={run.colour}
                criterion={run.criterion}
                onPick={(colour) => onRecolour(run.id, colour)}
              />
              <button
                type="button"
                className="srch-icon"
                title="Put this question back in the box"
                onClick={() => onReuse(run.criterion)}
              >
                <RotateCcw size={13} />
              </button>
              <button
                type="button"
                className="srch-icon danger"
                title="Delete this search"
                onClick={() => onDelete(run.id)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The article moved and these searches did not.
 *
 * The same fact the tweet thread page and the glossary panel already state, in
 * the same words — *"describes an older version of the article"* — because it
 * is the same fact about the same article and a second vocabulary for it would
 * make a reader learn twice (docs/plans/260825g-tweet-thread-page.md,
 * src/web/GlossaryPanel.tsx).
 *
 * **What it deliberately does not offer is a button.** Every other stale banner
 * in this app offers to rewrite the artefact, because there is exactly one of
 * them and rewriting it is what the reader wants. A saved search is not an
 * artefact of the article: it is the reader's own question, several of them can
 * be stale at once, and "run them all again" would spend a model call per row
 * on questions the reader may no longer be asking. So the offer is the ↺ that
 * is already on every row — it puts the question back in the box, and pressing
 * **find** is the second click. That is the same two-clicks-not-one rule
 * `Rewrite` on the thread page settled on, arrived at from the other direction.
 *
 * Counted rather than named. With eight ticked and three stale, listing three
 * criteria here would be a paragraph; the ⚠ on each row says which.
 */
function StaleNote({ runs, active }: { runs: SavedSearch[]; active: string[] }) {
  /* `done` only. A pending run has no passages to be wrong about yet, and a
     failed one has none at all — flagging either would put a warning on a row
     that is already saying something truer about itself. */
  const stale = runs.filter((r) => active.includes(r.id) && r.status === "done" && r.stale);
  if (stale.length === 0) return null;

  return (
    <div className="srch-stale">
      <p>
        <AlertTriangle size={13} />
        {stale.length === 1
          ? "This search describes an older version of the article."
          : `${stale.length} of these searches describe an older version of the article.`}
      </p>
      <p className="srch-stale-hint">
        The text was re-fetched or re-extracted after {stale.length === 1 ? "it was" : "they were"}{" "}
        answered, so the marks may sit on words that have moved — or be missing where the words have
        gone. ↺ on a row puts its question back in the box.
      </p>
    </div>
  );
}

/**
 * The box at the top of the list — Greg's *"select/deselect-all"*.
 *
 * One checkbox rather than two buttons, because it is the same question every
 * row below is asking and it should look like it. Three states, and the third
 * is the one that earns the element: `indeterminate` when *some* are on, which
 * is a thing a checkbox can say and a pair of buttons cannot.
 *
 * **`indeterminate` is a DOM property with no HTML attribute**, so React cannot
 * set it from JSX and there is no prop for it. A ref callback is the whole fix,
 * and it is a ref callback rather than an effect because it has to run on every
 * render that changes the count — an effect with the right dependency array
 * would do the same thing later and cost a second paint.
 *
 * What it does when pressed is decided by whether *everything* is on, not by
 * its own visual state: from indeterminate it switches the rest on, which is
 * the reading of a half-filled box that nobody is surprised by. Deselect-all is
 * then one more press.
 */
function AllBox({
  count,
  on,
  onToggleAll,
}: {
  count: number;
  on: number;
  onToggleAll(next: boolean): void;
}) {
  const all = on === count;
  return (
    <div className="srch-all">
      <label className="srch-all-tick">
        <input
          type="checkbox"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && !all;
          }}
          onChange={() => onToggleAll(!all)}
        />
        <span>
          {on === 0
            ? `${count} saved search${count === 1 ? "" : "es"}`
            : `${on} of ${count} showing`}
        </span>
      </label>
    </div>
  );
}

/**
 * The results, and everything that can be true instead of results.
 *
 * There are five of those and each gets its own sentence, because "no results"
 * is the one place a search feature can lie to you without appearing to: an
 * empty list looks the same whether nothing matched, nothing was typed, the
 * model failed, or the request never left the building. Telling them apart is
 * the whole of this function's length.
 */
/**
 * The count and the three order buttons.
 *
 * Extracted from `Results` when the prioritised bar arrived, and not only for
 * tidiness: the filtered-empty state below renders this too. Without that, a
 * reader who dragged the bar until nothing cleared it lost the order buttons
 * along with the rows and could not leave prioritised mode except by finding
 * the slider again — the controls were only in the branch that had results to
 * show. GPT Sol's review, 2026-08-26. Keeping one component means the two
 * branches cannot drift.
 */
function SortBar({
  found,
  all,
  waiting,
  matcher,
  order,
  onOrder,
}: {
  found: number;
  all: number;
  waiting: number;
  matcher: Matcher;
  order: HitOrder;
  onOrder(next: HitOrder): void;
}) {
  return (
    <div className="srch-sort">
      <span className="srch-count">
        {/* `3 of 11` while the bar is hiding some of them. A bare `3` beside a
            threshold slider is the ambiguity this whole feature has to avoid: a
            filter that hides eight things must never look like a search that
            found three. */}
        {found < all ? `${found} of ${all}` : found} passage{all === 1 ? "" : "s"}
        {/* One search of three has answered and two are still out: the count is
            real but it is not final, and a list that grows under the reader
            with no warning reads as a bug. Same honesty rule as the five empty
            states above — the emptiness, or the partialness, has to say which
            one it is. */}
        {waiting > 0 && (
          <>
            {" "}
            <LoaderCircle size={11} className="srch-spin" aria-hidden />{" "}
            <span className="srch-count-more">{waiting} still searching</span>
          </>
        )}
      </span>
      {/* Only offered where there is something to order by. In words mode every
          result has the same (absent) confidence, so a confidence sort would be
          a control that visibly does nothing — the honest version of which is
          not to draw it. */}
      {matcher === "meaning" && (
        <>
          <button
            type="button"
            className={`srch-sort-btn${order === "document" ? " on" : ""}`}
            onClick={() => onOrder("document")}
            title="In the order they appear in the article"
          >
            by place
          </button>
          <button
            type="button"
            className={`srch-sort-btn${order === "confidence" ? " on" : ""}`}
            onClick={() => onOrder("confidence")}
            title="Strongest matches first — the model's own judgment about its answers"
          >
            by confidence
          </button>
          <button
            type="button"
            className={`srch-sort-btn${order === "prioritised" ? " on" : ""}`}
            onClick={() => onOrder("prioritised")}
            title="In the order they appear in the article, with the weakest matches hidden — and hidden from the article too, not just from this list"
          >
            prioritised
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The bar the prioritised order hangs on, and the reader's hand on it.
 *
 * Greg, 2026-08-26: *"a 'Prioritised' ordering/filtering ... that orders by
 * place but thresholds by confidence, and a threshold slider to the UI"*. It is
 * deliberately the glossary's `GateSlider` in every respect that can be shared
 * — the same shape, the same reset, the same refusal to be a mystery dial — and
 * differs only where the two features differ:
 *
 * - **the number is on screen**, and here it is already meaningful, because
 *   0–100 confidence is the number printed on every row it is hiding. That is
 *   the whole reason `?conf=` is in the same unit rather than a 0–1 fraction;
 * - **the count is on screen**, `3 of 11`, which is the only feedback a drag
 *   that happens to move nobody still gives;
 * - **the track ends where the data does** (`confMax`), so no part of it is
 *   dead;
 * - **it says when it has hidden nothing, or everything** (`confNote`) — and
 *   this matters more here than it did for the glossary, because a glossary's
 *   gate only ever reorders, while this one takes rows away;
 * - **it can be put back** without the reader having to remember 50.
 *
 * A native `<input type="range">` for the reasons the glossary's is one:
 * draggable, arrow-key steppable, announced, touch-friendly, and `accent-color`
 * is the whole of the styling.
 */
function ConfSlider({
  all,
  gate,
  moved,
  onGate,
}: {
  all: Found[];
  gate: number;
  moved: boolean;
  onGate(gate: number | null): void;
}) {
  const kept = countAbove(all, gate);
  const note = confNote(all, gate);
  const count = `${kept} of ${all.length}`;

  return (
    <div className="srch-gate">
      <div className="srch-gate-row">
        <label className="srch-gate-label" htmlFor="srch-gate">
          confidence
        </label>
        <span className="srch-gate-value">
          {gate} · {count}
        </span>
        {/* Only once there is something to undo — the same call the glossary's
            reset makes. */}
        {moved && (
          <button
            type="button"
            className="srch-gate-reset"
            title={`Back to ${PRIORITY_CONF}`}
            aria-label={`Reset the threshold to ${PRIORITY_CONF}`}
            onClick={() => onGate(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      <input
        id="srch-gate"
        className="srch-gate-range"
        type="range"
        min={0}
        /* A fixed 0–100, deliberately unlike the glossary's `gateMax`. Ending
           the track at the data's own top makes sense for a product of two
           model scores that has no natural ceiling; confidence has one, it is
           printed on every row, and readers know it. And a moving `max` on a
           live range input is a real bug rather than a nicety: hits stream in,
           so the top score can rise under the reader's hand mid-drag and remap
           the pointer beneath it. GPT Sol, 2026-08-26. */
        max={100}
        step={CONF_STEP}
        value={gate}
        title="How sure the model has to be for a passage to stay on screen. Left keeps more, right keeps fewer. Hidden passages lose their marks in the article too."
        /* A thumb position is a number nobody can hear, and the count is what
           the reader is actually aiming at. */
        aria-valuetext={`${gate} out of 100, keeping ${count} passages`}
        onChange={(e) => onGate(Number.parseInt(e.target.value, 10))}
      />
      {note && <p className="srch-gate-note">{note}</p>}
    </div>
  );
}

function Results({
  found,
  all,
  order,
  onOrder,
  gate,
  gateMoved,
  onGate,
  openKey,
  onOpen,
  matcher,
  slots,
  runs,
  loaded,
  active,
  typed,
}: {
  found: Found[];
  order: HitOrder;
  onOrder(next: HitOrder): void;
  /**
   * The same results *before* the prioritised bar, so the slider has a
   * denominator and a track that ends where the data does. `found` is what
   * survives; this is what there was.
   */
  all: Found[];
  /** Where the bar is, resolved — `?conf=` or `PRIORITY_CONF`. */
  gate: number;
  /** Whether the reader has actually moved it, so the reset can stay hidden. */
  gateMoved: boolean;
  onGate(gate: number | null): void;
  openKey: string | null;
  onOpen(key: string, blockId: BlockId): void;
  matcher: Matcher;
  slots: Map<string, number>;
  runs: SearchRun[];
  loaded: boolean;
  active: string[];
  typed: number;
}) {
  /* Empty in words mode, whatever is ticked. The ticks deliberately survive a
     trip to the words matcher and back (App.tsx § onMatcher), so `active` is
     very often non-empty here while the results on screen came from `find` —
     and every state below that reasons about saved searches has to be scoped
     to the matcher that has them. Without this, typing two letters into the
     words box while a meaning search happened to be running showed "Reading the
     article for you…" over a literal search that had already finished. */
  const switchedOn = matcher === "meaning" ? runs.filter((r) => active.includes(r.id)) : [];
  const waiting = switchedOn.filter((r) => r.status === "pending");

  /* Sixth state, and it is new with the ticks: searches exist, none is on. The
     article is unmarked and that is *correct*, so this says why rather than
     saying "nothing matched" — which would be a lie about an article nobody has
     asked a question of yet. Only when there is a list to tick: with no saved
     searches at all, `Saved` above is already explaining that, and two empty
     states stacked is one too many. */
  /* Nothing to say about saved searches until we know whether there are any.
     `Saved` above is already showing a spinner; two of them stacked is noise,
     and "Nothing matched" underneath it would be a second wrong answer. */
  if (matcher === "meaning" && !loaded) return null;

  if (matcher === "meaning" && runs.length > 0 && switchedOn.length === 0) {
    return (
      <div className="srch-empty">
        <p className="srch-empty-hint">
          Tick a search above to mark its passages in the article. Several at once is fine — each
          one has a colour, and a passage that two of them found wears both.
        </p>
      </div>
    );
  }

  /* Something is still out, and nothing has come back yet. Once *one* of
     several has answered the results are worth showing, so this is only the
     all-pending case; the partial case falls through to the list, which carries
     the spinner in its count line instead. Waiting on an answer you already
     have half of is not waiting. */
  /* `all`, not `found`: this guard is about whether anything has come back,
     which is what its comment says and what the spinner claims. Written against
     `found` it also fired when results HAD arrived and the reader's own bar was
     hiding them — the panel then said "Reading the article for you…" over a
     finished search and took the slider off the screen. GPT Sol, 2026-08-26. */
  if (waiting.length > 0 && all.length === 0) {
    return (
      <div className="srch-empty">
        <p className="srch-working">
          <LoaderCircle size={13} className="srch-spin" /> Reading the article for you…
        </p>
        <p className="srch-empty-hint">
          The whole piece goes to the model, so this takes a few seconds. You can carry on reading —
          the answer is saved either way.
        </p>
      </div>
    );
  }

  /* A failure is reported on the row that failed, with its own retry button
     (see `Saved`), because with several searches on there is no longer one
     failure for this area to be about. What is left here is the case where
     every switched-on search failed — in which case there is nothing to list
     and the reader deserves to be told that the emptiness has a cause. */
  const broken = switchedOn.filter((r) => r.status === "error");
  if (broken.length > 0 && broken.length === switchedOn.length) {
    return (
      <div className="srch-empty">
        <p className="srch-failed">
          <AlertTriangle size={13} />{" "}
          {broken.length === 1
            ? (broken[0]?.error ?? "The search failed.")
            : `All ${broken.length} of these searches failed.`}
        </p>
        <p className="srch-empty-hint">
          The ⚠ on each row above tries it again.
        </p>
      </div>
    );
  }

  if (matcher === "words" && typed < MIN_FIND_CHARS) {
    return (
      <div className="srch-empty">
        <p className="srch-empty-hint">
          {typed === 0
            ? "Type to find words in the article. Every match is marked as you go."
            : `A few more letters — one is not enough to search for.`}
        </p>
      </div>
    );
  }

  /* An empty list has two completely different causes once there is a
     threshold, and they want opposite things done about them: the search found
     nothing, or the reader's own bar hid everything it found. Saying "Nothing
     matched" for the second is a lie, and worse, it hides the one control that
     would undo it — the early return below would have taken the slider off the
     screen along with the results. So this case keeps the slider and says what
     actually happened. */
  if (found.length === 0 && all.length > 0) {
    return (
      <>
        {/* The order buttons come too. Without them a reader who dragged the
            bar until nothing cleared it could not get back out of prioritised
            order — the way out was the very control the empty state had just
            removed. */}
        <SortBar
          found={0}
          all={all.length}
          waiting={waiting.length}
          matcher={matcher}
          order={order}
          onOrder={onOrder}
        />
        <ConfSlider all={all} gate={gate} moved={gateMoved} onGate={onGate} />
      </>
    );
  }

  if (found.length === 0) {
    return (
      <div className="srch-empty">
        <p>Nothing matched.</p>
        <p className="srch-empty-hint">
          {matcher === "words"
            ? "Those exact letters are not in the article. Try the meaning matcher — it finds passages that mean what you asked for without using your words."
            : "The model found nothing in this article that matches. That is an answer, not a failure — try describing it differently if you think it is in here."}
        </p>
      </div>
    );
  }

  return (
    <>
      <SortBar
        found={found.length}
        all={all.length}
        waiting={waiting.length}
        matcher={matcher}
        order={order}
        onOrder={onOrder}
      />
      {/* Only in the order it belongs to, the same call GlossaryPanel.tsx makes
          about its own gate: a number that means nothing in the other two
          orders would be furniture. */}
      {matcher === "meaning" && order === "prioritised" && (
        <ConfSlider all={all} gate={gate} moved={gateMoved} onGate={onGate} />
      )}
      <Legend matcher={matcher} coloured={switchedOn.length > 1} />
      <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={400}>
        <ul className="srch-hits">
          {found.map((f) => (
            <Hit
              key={f.key}
              found={f}
              slot={f.runId === null ? undefined : slots.get(f.runId)}
              /* The question that found it, for the hover card. Only worth
                 saying when more than one search is on: with one, the criterion
                 is in the box three inches above and repeating it on every row
                 is noise. */
              criterion={
                switchedOn.length > 1
                  ? (runs.find((r) => r.id === f.runId)?.criterion ?? null)
                  : null
              }
              open={f.key === openKey}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </TooltipGroup>
    </>
  );
}

/**
 * Where in the article a result falls, drawn as a bar that fills up to it.
 *
 * A fill and not a dot, because "how far through" is a *progress* question and
 * a filling bar is the answer everybody already knows how to read. The
 * left-hand gutter is around 44px wide, which is well below the size at which a
 * mark's exact position can be read off — so this is deliberately a **zone**
 * indicator: near the start, halfway, near the end. The number that says
 * exactly is in the tooltip and in the accessible name.
 *
 * Not in the search hue. The hue means *a match* everywhere else in this app —
 * the wash in the prose, the selected matcher, the confidence chip — and a
 * second thing wearing it would be a reader having to learn that this
 * particular blue means something else. Place is neutral grey; confidence is
 * the hue. Two channels, two colours, and neither is carrying meaning by colour
 * alone: the number is printed and the bar has a label.
 */
function Place({ at, decorative }: { at: number; decorative?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, at)) * 100);
  return (
    <span
      className="srch-place"
      /* The legend's specimen is a picture of the control, not a reading of
         anything: announcing "30% of the way through the article" there would
         be a screen reader stating a fact about an article that is not true. */
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": `${pct}% of the way through the article` })}
      style={{ "--at": `${pct}%` } as React.CSSProperties}
    >
      <span className="srch-place-fill" />
    </span>
  );
}

/**
 * One line under the sort bar saying what the two marks in the gutter are.
 *
 * A legend rather than leaving both to hover, because a hover-only explanation
 * is an explanation nobody on a touchscreen ever sees, and because the reader
 * who most needs to know what a confidence number is is exactly the reader who
 * has not thought to hover it. It is drawn from the same components as the rows
 * themselves, so it cannot drift from what it is describing.
 */
function Legend({ matcher, coloured }: { matcher: Matcher; coloured: boolean }) {
  return (
    <p className="srch-legend">
      {/* Only when there is more than one colour on screen. With a single
          search on, "which search found it" is a question with one answer, and
          a legend for it would be explaining a distinction that is not being
          drawn. */}
      {coloured && (
        <span className="srch-legend-item">
          <span className="srch-swatches" aria-hidden>
            <i style={{ "--cat-rgb": "var(--cat-0-rgb)" } as React.CSSProperties} />
            <i style={{ "--cat-rgb": "var(--cat-1-rgb)" } as React.CSSProperties} />
            <i style={{ "--cat-rgb": "var(--cat-2-rgb)" } as React.CSSProperties} />
          </span>
          which search found it
        </span>
      )}
      {matcher === "meaning" && (
        <span className="srch-legend-item">
          <span className="srch-conf" aria-hidden>
            62
          </span>
          {/* "its own guess" is doing the real work here, and it is in the
              legend rather than only in the hover card because a reader on a
              touchscreen never opens a hover card — tapping a row navigates. A
              caveat only a mouse can reach is a caveat half the readers do not
              have. Raised by a GPT Sol review, 2026-08-26. */}
          how sure the model is — its own guess, not a measurement
        </span>
      )}
      <span className="srch-legend-item">
        <Place at={0.3} decorative />
        where in the article
      </span>
    </p>
  );
}

/**
 * What the hover card says, under the passage itself.
 *
 * Greg, 2026-08-26: *"make it clearer what the confidence number means."* The
 * number had a `title` before, and all it said was that the number was a
 * confidence — which is the word already printed on it. What a reader actually
 * needs to know is **whose** judgement it is and how much weight to put on it,
 * and that is two sentences rather than a label.
 *
 * The honest framing matters more than the wording: this is the model scoring
 * its own answer, so it is not a probability and there is nothing behind it that
 * was measured. Saying so is the same rule the glossary follows about the
 * model's difficulty scores — offer them, label them, never present them as
 * fact.
 */
function HitCard({ found, criterion }: { found: Found; criterion: string | null }) {
  const pct = Math.round(Math.min(1, Math.max(0, found.at)) * 100);
  return (
    <>
      <p>{found.long}</p>
      <p className="tip-hit-meta">
        {/* Which question found it, in words. The dot on the row is the glance
            version and this is the one that actually answers it — a hue is a
            handle for something you already know, not a way of learning it. */}
        {criterion !== null && (
          <>
            Found by <b>{criterion}</b>.
            <br />
          </>
        )}
        {found.confidence !== null && (
          <>
            <b>{found.confidence} out of 100</b> — how strongly the model thinks this passage
            matches what you asked for. It is the model's own judgement about its own answer, not a
            measurement of anything: read it as <em>worth a look</em> against <em>probably</em>,
            not as a probability.
            <br />
          </>
        )}
        <b>{pct}% in</b> — how far through the article this passage sits, first word to last.
      </p>
    </>
  );
}

/**
 * One result.
 *
 * The confidence is **printed as well as drawn**. Their version encoded it only
 * as opacity, and the note we took from that was that *confidence should be
 * visible, not just used* — a reader cannot tell 40% from 55% by looking at two
 * washes, and the number is the part that lets them decide whether to bother.
 * It is also the visible half of the unit-drift alarm described on
 * `SearchHit.confidence`: a run whose numbers all read "1%" is a run whose
 * model has started answering in fractions.
 *
 * Beside it, and under it in the gutter, is **where in the article the passage
 * falls** — Greg's ask on 2026-08-26 that *each result shows both confidence and
 * place*. It is on a literal result too, where it is the only thing besides the
 * words that the row can tell you: a words-search has no confidence to report,
 * and "the fourth of nine matches" is a fact about the list, not about the
 * piece.
 *
 * There is **no `title` on the number**. The row already opens a hover card, and
 * a native tooltip underneath a floating one is two panels fighting over the
 * same pointer; the explanation lives in the card (`HitCard`) where there is
 * room to say something worth reading.
 */
function Hit({
  found,
  slot,
  criterion,
  open,
  onOpen,
}: {
  found: Found;
  /** The palette slot of the search that found it; absent for a literal match. */
  slot: number | undefined;
  /** The question that found it, when there is more than one to tell apart. */
  criterion: string | null;
  open: boolean;
  onOpen(key: string, blockId: BlockId): void;
}) {
  return (
    <li className="srch-hit">
      <Tooltip
        placement="right"
        className="tip-hit"
        content={<HitCard found={found} criterion={criterion} />}
      >
        <button
          type="button"
          className={`srch-hit-btn${open ? " on" : ""}`}
          onClick={() => onOpen(found.key, found.blockId)}
          aria-current={open ? "true" : undefined}
          /* The row wears its search's hue: a left edge, and the dot in the
             gutter below. Both from one custom property, so a slot that somehow
             does not resolve leaves the row plainly uncoloured rather than
             half-coloured.

             `data-hue` beside it is what the stylesheet *selects* on. The
             custom property alone would have meant a `[style*="--cat-rgb"]`
             attribute selector — matching a substring of an inline style
             attribute, which is a rule that depends on how React chooses to
             serialise it and would break silently if that ever changed. An
             attribute is a fact; a substring of another attribute is a guess. */
          {...(slot === undefined
            ? {}
            : {
                "data-hue": slot,
                style: { "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties,
              })}
        >
          <span className="srch-gutter">
            {/* Named, not left to colour alone. WCAG 1.4.1 is the rule and it is
                the right rule here for an ordinary reason too: eight hues is at
                the edge of what anybody can hold in their head, so the row has
                to be able to say which search it came from to a reader who has
                stopped trying to remember. The visible answer is the hover card;
                this is the same answer for a screen reader. */}
            {slot !== undefined && criterion !== null && (
              <span className="srch-hit-dot" role="img" aria-label={`Found by: ${criterion}`} />
            )}
            {slot !== undefined && criterion === null && (
              <span className="srch-hit-dot" aria-hidden />
            )}
            {found.confidence !== null && (
              <span
                className="srch-conf"
                /* The same number the wash is drawn from, so the bar beside the
                   row and the mark in the prose cannot disagree. */
                style={{ "--hit-a": found.confidence / 100 } as React.CSSProperties}
                /* `role="img"` so the number gets a name. Read out on its own it
                   is "62" against a passage of prose, which is a number with no
                   noun; the label supplies the noun. */
                role="img"
                aria-label={`The model's confidence in this match: ${found.confidence} out of 100`}
              >
                {found.confidence}
              </span>
            )}
            <Place at={found.at} />
          </span>
          <span className="srch-hit-body">
            <span className="srch-hit-quote">{found.short}</span>
            {found.reasoning && <span className="srch-hit-why">{found.reasoning}</span>}
            {/* Said out loud rather than left to look like a styling bug. A
                result whose quote could not be found on the page marks the
                whole paragraph, and a reader who cannot see why one result is a
                slab and the rest are phrases will assume the feature is
                broken. */}
            {found.whole && (
              <span className="srch-hit-whole">whole paragraph — the exact words have moved</span>
            )}
          </span>
        </button>
      </Tooltip>
    </li>
  );
}

/**
 * **Pick this search's colour** — the palette in a popover, and *automatic*.
 *
 * Greg, 2026-08-27: *"In Search mode, I'd like to be able to change the colour
 * for a given row."* And, once it existed: *"add more colours, arranged more
 * naturally."* So it is sixteen hues in hue order, in a 4×4 grid, and the
 * ninth choice under them.
 *
 * **The palette the picker offers is bigger than the one the hash uses** —
 * `PALETTE_SLOTS` against `CATEGORICAL_SLOTS`, hit-colours.ts, which is where
 * the reasoning for the split is. From in here the only consequence is that
 * `PALETTE_BY_HUE` is what to iterate, never `CATEGORICAL_SLOTS`.
 *
 * ## Why there is no colour-picker library here
 *
 * A survey on the day (react-colorful, react-color, @uiw/react-color, React
 * Aria's `ColorSwatchPicker`) came back recommending none of them, and the
 * reason is not weight or maintenance — react-colorful is 5.9M downloads a
 * week, zero dependencies and 4.8KB. It is that **every one of them is a
 * picker for an arbitrary colour**, and an arbitrary colour is the one thing
 * this control must not offer. The hues were chosen *together*: lifted off
 * Okabe–Ito for a near-black page, checked against each other for colour-blind
 * safety, and extended along the gaps in that set's hue circle rather than by
 * taste (docs/project/colour-scales.md). A spectrum wheel invites a reader to
 * pick a seventeenth colour nobody vetted, and the first thing they would
 * reach for on a black page is a dark one.
 *
 * Note that "more colours" did **not** become "a wheel" — it became sixteen
 * vetted ones. That is the same answer as before with a bigger number in it,
 * and it is worth saying because the obvious reading of Greg's second ask is
 * that the survey's conclusion had expired. It had not: the reason for a fixed
 * set is that every hue has to survive a near-black ground and stand apart from
 * its neighbours, and that is no less true of the sixteenth than of the eighth.
 *
 * React Aria's `ColorSwatchPicker` *is* shaped right — a listbox of fixed
 * swatches, real keyboard semantics, explicit React 19 support — and was
 * rejected for a different reason: it takes a parsed `Color`, so the eight RGB
 * triplets would have to be mirrored out of colourscales.css into TypeScript.
 * That is precisely the seam hit-colours.ts exists to keep, and a palette
 * change would then mean editing two files that cannot be checked against each
 * other. It would also be a third UI-toolkit family for eight `<button>`s.
 *
 * So: Floating UI, which is already here for `Tooltip`, with `useClick` where
 * the tooltip has `useHover`. Nothing in the panel ever handles a colour value
 * — a swatch is `var(--cat-${i}-rgb)` and a choice is the number `i`.
 *
 * ## What the popover has to get right
 *
 * - **A grid of buttons, keyboard-reachable, with focus returned afterwards.**
 *   `FloatingFocusManager` at `modal={false}`, so focus is *not* trapped, and
 *   — measured in a browser rather than assumed — **a real mouse click does
 *   not move focus into the panel at all**: the trigger keeps it, one Tab
 *   lands on the first swatch, and picking one puts focus back on the trigger.
 *   That is the right behaviour for a small non-modal menu beside a row (a
 *   mouse user is not yanked somewhere they did not ask to be) and it is not
 *   what this paragraph claimed twice: it said "focus trapped" until GPT Sol
 *   pointed out that `modal={false}` means the opposite, and then "focus moved
 *   into it" until a browser pass showed the trigger still holding it after a
 *   real click. Opened any other way — programmatically, or from the keyboard
 *   — focus *does* land on the first swatch, because Floating UI branches on
 *   whether the opening event carried pointer coordinates. Both paths reach
 *   the same place; only the first keystroke differs.
 * - **`useDismiss` rather than our own outside-click listener**, so it closes on
 *   Escape and on a press anywhere else without a second mechanism to keep in
 *   step with the panel's other dismissals.
 * - **Automatic is a choice, not a reset button in the corner.** It is the ninth
 *   cell in the same list and it can be *current*, because "whichever colour it
 *   would have had" is a state the row is genuinely in, not the absence of one.
 * - **Two facts, two marks.** A row on automatic is still *wearing* a hue, so
 *   the panel says both things: a faint ring on the swatch the row is showing
 *   today, and the strong `current` mark on what the reader actually chose —
 *   which in automatic mode is the ninth cell. `aria-pressed` follows the
 *   *choice* rather than the drawn hue, because a reader who cannot see the
 *   rings needs the answer to "have I pinned this?", and the derived hue
 *   announcing itself as pressed answers a question nobody asked. GPT Sol's
 *   review, 2026-08-27.
 * - **No arrow keys.** The app has a global ↑/↓ listener (keynav.ts) and the
 *   band's own steppers, so a roving-focus grid would be a third claimant on
 *   two keys. Tab reaches all nine cells; that is enough for nine targets.
 */
function ColourPicker({
  slot,
  chosen,
  criterion,
  onPick,
}: {
  /** The hue the row is wearing right now, chosen or derived. */
  slot: number | undefined;
  /** The reader's stored choice, if there is one — `undefined` means automatic. */
  chosen: number | undefined;
  /** For the labels, so a screen reader is told which search this is about. */
  criterion: string;
  onPick(colour: number | null): void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "left-start",
    whileElementsMounted: autoUpdate,
    /* `flip` before `shift`, and both with padding: the trigger sits in a
       288px band against the left edge of the reading column, so the panel
       has to be free to swing to the other side rather than be squeezed. */
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);


  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className="srch-icon"
        title="Change this search's colour"
        aria-label={`Change the colour of: ${criterion}`}
        {...getReferenceProps()}
      >
        <Palette size={13} />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="srch-picker"
              /* `useRole` puts the same role in `getFloatingProps()`, so this
                 is written out only because a static check cannot see through
                 a spread — and without it `aria-label` on a bare `<div>` is a
                 lint error, which is the rule being right about every case
                 except this one. */
              role="dialog"
              aria-label="Choose a colour for this search"
              {...getFloatingProps()}
            >
              <div className="srch-picker-grid">
                {/* **In hue order, not slot order** — Greg, 2026-08-27:
                    *"arranged more naturally"*. Slot numbers record when a hue
                    was added, not where it sits on the wheel, so laying the
                    grid out by index would scatter the spectrum: the eight
                    Okabe–Ito hues first in their own arbitrary order, then the
                    eight that fill their gaps. `PALETTE_BY_HUE` in
                    hit-colours.ts is the ordering, and a test pins it against
                    the stylesheet's actual hue angles so it cannot rot. */}
                {PALETTE_BY_HUE.map((i, position) => (
                  <button
                    key={i}
                    type="button"
                    className={
                      `srch-picker-swatch${chosen === i ? " current" : ""}` +
                      // The hue the row is showing right now — the same swatch
                      // as `current` whenever the reader has chosen one, and a
                      // different one when they have not.
                      (slot === i ? " showing" : "")
                    }
                    /* The hue as a palette reference, never a colour — the
                       same seam every other file here keeps. This is the only
                       component in the app that shows a reader the palette
                       itself, and it still does not know what is in it. */
                    style={{ "--cat-rgb": `var(--cat-${i}-rgb)` } as React.CSSProperties}
                    /* Numbered from one, and by **where it is in the grid**
                       rather than by its slot: the reader is counting swatches
                       left to right, and a slot number is an implementation
                       detail they have no way to see — "Colour 9" on the second
                       swatch would be describing the database. The number is
                       here at all because a position is the only name these
                       hues have; calling them "blue" and "vermilion" would be a
                       second vocabulary that goes wrong the day a hue moves. */
                    aria-label={`Colour ${position + 1}`}
                    aria-pressed={chosen === i}
                    onClick={() => {
                      onPick(i);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
              {/* The ninth cell, and deliberately a full-width one with words
                  on it. It is the only choice here that cannot be shown as a
                  colour, because it *is* the absence of a choice — and it is
                  the one a reader arrives at wanting after they have changed
                  their mind, which is when a control with no label is worst. */}
              <button
                type="button"
                className={`srch-picker-auto${chosen === undefined ? " current" : ""}`}
                aria-pressed={chosen === undefined}
                onClick={() => {
                  onPick(null);
                  setOpen(false);
                }}
              >
                Automatic
              </button>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
