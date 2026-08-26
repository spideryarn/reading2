/**
 * The search panel — the fourth **mode** in the band between the spine and the
 * prose. See docs/project/search.md, and docs/plans/chat-mode.md for where the
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
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  LoaderCircle,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import type { BlockId, SearchRun } from "../types.js";
import type { Found } from "./search-hits.js";
import { MIN_FIND_CHARS } from "./search-hits.js";
import type { HitOrder, Matcher } from "./params.js";
import { MATCHERS } from "./params.js";
import { nextModeIndex } from "./Dock.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";

interface Props {
  matcher: Matcher;
  onMatcher(next: Matcher): void;
  /** The literal query, in words mode. Live-bound to `?find=`. */
  find: string | null;
  onFind(next: string | null): void;
  /** Every saved meaning-search for this article. */
  runs: SearchRun[];
  /** The one that is open, or null for the list of them. */
  runId: string | null;
  onRun(id: string | null): void;
  onAsk(criterion: string): void;
  onRetry(id: string): void;
  onDelete(id: string): void;
  /** The results of whichever matcher is running, already ordered. */
  found: Found[];
  order: HitOrder;
  onOrder(next: HitOrder): void;
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
  runId,
  onRun,
  onAsk,
  onRetry,
  onDelete,
  found,
  order,
  onOrder,
  openKey,
  onOpen,
  error,
}: Props) {
  const open = runs.find((r) => r.id === runId) ?? null;
  const searching = open?.status === "pending";

  return (
    <aside className="mode-band srch" aria-label="Search this article">
      <div className="srch-head">
        <SearchIcon size={14} className="srch-head-icon" aria-hidden />
        <h2>Search</h2>
      </div>

      <Box
        matcher={matcher}
        onMatcher={onMatcher}
        find={find}
        onFind={onFind}
        runId={runId}
        criterion={open?.criterion ?? ""}
        busy={searching}
        onAsk={onAsk}
        onClear={() => onRun(null)}
      />

      {error && <p className="srch-error">{error}</p>}

      {matcher === "meaning" && open === null ? (
        <Saved runs={runs} onOpen={onRun} onDelete={onDelete} />
      ) : (
        <Results
          found={found}
          order={order}
          onOrder={onOrder}
          openKey={openKey}
          onOpen={onOpen}
          matcher={matcher}
          run={open}
          typed={(find ?? "").trim().length}
          onRetry={onRetry}
        />
      )}
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
 * ## And the thing that can still take the text away: the fetch
 *
 * A saved run's criterion arrives from the server, not from the first render.
 * Land on `?mode=search&run=<id>` and for the length of one request `runs` is
 * `[]`, so `criterion` is `""` — and the box is focused, so the reader can
 * already be typing when the answer lands. An unconditional "put the criterion
 * in the box" effect then deletes what they wrote.
 *
 * `dirty` is the guard: once the reader has touched the box, the criterion stops
 * being allowed to overwrite it. Opening a *different* run clears the flag,
 * because that is a deliberate act that plainly means "show me this one". Found
 * by a GPT Sol review of this change, 2026-08-26 — it is the autofocus that made
 * a latent race into a reachable one.
 */
function Box({
  matcher,
  onMatcher,
  find,
  onFind,
  runId,
  criterion,
  busy,
  onAsk,
  onClear,
}: {
  matcher: Matcher;
  onMatcher(next: Matcher): void;
  find: string | null;
  onFind(next: string | null): void;
  /** Which saved run the criterion belongs to — the reset signal for `dirty`. */
  runId: string | null;
  criterion: string;
  busy: boolean;
  onAsk(criterion: string): void;
  onClear(): void;
}) {
  const [draft, setDraft] = useState(criterion);
  const box = useRef<HTMLInputElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  /** Has the reader typed since the box was last filled for them? */
  const dirty = useRef(false);

  /* Opening a different saved search is a deliberate "show me this one", so it
     hands the box back to the criterion. Declared before the effect below and
     therefore run before it, which is the order that matters: clear the flag,
     then fill the box. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and opening a different run is exactly when the reader stops owning the box
  useEffect(() => {
    dirty.current = false;
  }, [runId]);

  /* Re-opening a saved search puts its criterion back in the box, so the reader
     can see what they asked and edit it into the next question rather than
     retyping it. Keyed on the criterion rather than on the run id because that
     is what is actually being shown — and skipped once the reader has typed,
     because the criterion can arrive a whole request after they started. */
  useEffect(() => {
    if (dirty.current) return;
    setDraft(criterion);
  }, [criterion]);

  /* The box takes focus when the mode opens. A search panel you have to click
     into before typing is a search panel that costs two actions instead of one,
     and this one is only ever on screen because the reader asked for it.

     On mount only. Focus after a matcher switch is handled in `switchTo`, and
     it is handled there rather than here because it must depend on *how* the
     matcher was switched: a pointer click means "I want to type now", and a
     keyboard press inside the radio group means "I am still using this group".
     Same distinction, and the same `e.detail` test, as Dock.tsx § DockModes. */
  useEffect(() => box.current?.focus(), []);

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
        /* The reader's own words, carried across — so the criterion must not be
           allowed to overwrite them when a pending fetch lands. */
        if (value.trim() !== "") dirty.current = true;
        onFind(null);
      } else {
        onFind(draft.trim() === "" ? null : draft);
      }
      onMatcher(next);
    }
    if (toBox) box.current?.focus();
  }

  /**
   * Arrow keys across the two matchers — the promise `role="radiogroup"` makes.
   *
   * Shared arithmetic with the bottom bar's mode switcher rather than a second
   * copy: `nextModeIndex` is exported from Dock.tsx precisely because index
   * wrapping is where an off-by-one hides and it is the one part of this that
   * can be tested without a browser.
   *
   * `stopPropagation` as well as `preventDefault`, for the reason Dock.tsx gives:
   * without it keynav.ts *also* steps the article, so one arrow press does two
   * things.
   */
  function onModeKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const index = matcher === "words" ? 0 : 1;
    const next = nextModeIndex(e.key, index, MATCHERS.length);
    if (next === null) return;
    const target = MATCHERS[next];
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    switchTo(target, false);
    /* Focus follows the selection, or the reader is left on a button that is
       about to become `tabIndex={-1}` and their next arrow goes nowhere. */
    radios.current[next]?.focus();
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
            dirty.current = true;
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
              /* An emptied box is the reader's too: a criterion landing after it
                 would refill a box they had just deliberately cleared. */
              dirty.current = true;
              if (matcher === "words") onFind(null);
              else {
                setDraft("");
                onClear();
              }
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
          onKeyDown={onModeKey}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern, and the same call Dock.tsx makes for the mode switcher — a real <input type="radio"> cannot carry an icon beside its label, and styling one to match means hiding the input and faking every state it already had */}
          <button
            type="button"
            role="radio"
            ref={(el) => {
              radios.current[0] = el;
            }}
            aria-checked={matcher === "words"}
            /* The roving tabindex: one tab stop for the pair, arrows inside it. */
            tabIndex={matcher === "words" ? 0 : -1}
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
            ref={(el) => {
              radios.current[1] = el;
            }}
            aria-checked={matcher === "meaning"}
            tabIndex={matcher === "meaning" ? 0 : -1}
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
}

/**
 * The saved meaning-searches, most recent first.
 *
 * This list is the answer to the criticism the version this is borrowed from
 * earned: *theirs vanished on reload, which quietly makes the feature a toy —
 * nothing you produce with it can be returned to*
 * (docs/project/original-version/highlighting.md). Pressing a row here repaints
 * the whole article with no model call and no wait, because the answer is on
 * disk.
 */
function Saved({
  runs,
  onOpen,
  onDelete,
}: {
  runs: SearchRun[];
  onOpen(id: string): void;
  onDelete(id: string): void;
}) {
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (sorted.length === 0) {
    return (
      <div className="srch-empty">
        <p>Nothing searched for yet.</p>
        <p className="srch-empty-hint">
          Describe what you are after — <em>arguments against the main claim</em>, <em>anywhere he
          gives numbers</em> — and the passages that match get marked in the article, strongest
          first. Searches are kept, so coming back to one costs nothing.
        </p>
      </div>
    );
  }

  return (
    <ul className="srch-saved">
      {sorted.map((run) => (
        <li key={run.id} className="srch-saved-row">
          <button type="button" className="srch-saved-open" onClick={() => onOpen(run.id)}>
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
                `${run.hits.length} passage${run.hits.length === 1 ? "" : "s"}`
              )}
            </span>
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
      ))}
    </ul>
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
function Results({
  found,
  order,
  onOrder,
  openKey,
  onOpen,
  matcher,
  run,
  typed,
  onRetry,
}: {
  found: Found[];
  order: HitOrder;
  onOrder(next: HitOrder): void;
  openKey: string | null;
  onOpen(key: string, blockId: BlockId): void;
  matcher: Matcher;
  run: SearchRun | null;
  typed: number;
  onRetry(id: string): void;
}) {
  if (run?.status === "pending") {
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

  if (run?.status === "error") {
    return (
      <div className="srch-empty">
        <p className="srch-failed">
          <AlertTriangle size={13} /> {run.error ?? "The search failed."}
        </p>
        <button type="button" className="srch-retry" onClick={() => onRetry(run.id)}>
          Try again
        </button>
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
      <div className="srch-sort">
        <span className="srch-count">
          {found.length} passage{found.length === 1 ? "" : "s"}
        </span>
        {/* Only offered where there is something to order by. In words mode
            every result has the same (absent) confidence, so a confidence sort
            would be a control that visibly does nothing — the honest version of
            which is not to draw it. */}
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
          </>
        )}
      </div>
      <Legend matcher={matcher} />
      <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={400}>
        <ul className="srch-hits">
          {found.map((f) => (
            <Hit key={f.key} found={f} open={f.key === openKey} onOpen={onOpen} />
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
function Legend({ matcher }: { matcher: Matcher }) {
  return (
    <p className="srch-legend">
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
function HitCard({ found }: { found: Found }) {
  const pct = Math.round(Math.min(1, Math.max(0, found.at)) * 100);
  return (
    <>
      <p>{found.long}</p>
      <p className="tip-hit-meta">
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
  open,
  onOpen,
}: {
  found: Found;
  open: boolean;
  onOpen(key: string, blockId: BlockId): void;
}) {
  return (
    <li className="srch-hit">
      <Tooltip placement="right" className="tip-hit" content={<HitCard found={found} />}>
        <button
          type="button"
          className={`srch-hit-btn${open ? " on" : ""}`}
          onClick={() => onOpen(found.key, found.blockId)}
          aria-current={open ? "true" : undefined}
        >
          <span className="srch-gutter">
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
