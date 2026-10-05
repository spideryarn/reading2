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

import { useEffect, useMemo, useRef } from "react";
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
import {
  type BandTyping,
  searchDraftFor,
  type SearchDraft,
  useHandoff,
} from "../../search-draft.js";
import {
  IDLE,
  PAUSE_MS,
  type QuickEvent,
  type QuickSession,
  stepQuickSession,
} from "../../quick-session.js";
import { type AutoThoroughWiring, useAutoThorough } from "./auto-thorough.js";
import { storedPairs } from "./stored-pairs.js";

/** Until `SearchBand` has filled it in, on its first render: nothing owns, nothing runs. */
const UNWIRED: AutoThoroughWiring = {
  running: () => false,
  launch: () => "",
  drop: () => {},
  owns: () => false,
  boxWords: () => "",
  ticked: () => false,
  swap: () => {},
};

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
  /* `useSearchMode` owns `?runs=` and is called after the hook, so a rename
     reaches it through this ref. A rename swaps the id in place, and does
     nothing if the reader has already unticked or deleted the search. */
  const renameActive = useRef<(from: string, to: string) => void>(() => {});
  const renameSession = useRef<(from: string, to: string) => void>(() => {});
  const renameUpgrade = useRef<(from: string, to: string) => void>(() => {});
  /* Only a request this tab started is known to be in flight — `running` and
     `isRunning` are the hook's, because only the hook knows the id the server
     answered under. useSearch.ts § inFlight. */
  const { runs, loaded, loadError, loadFromCopy, ask, retry, revise, running, isRunning, remove, recolour, error } =
    useSearch(slug, {
      onRenamed: (from, to) => {
        renameActive.current(from, to);
        renameSession.current(from, to);
        renameUpgrade.current(from, to);
      },
    });
  /* **A settled quick answer starts its thorough search, unseen** (plan
     261004l, src/web/modes/search/auto-thorough.ts). The thorough row is
     hidden until it is complete, so everything below that draws, counts,
     colours or ticks is given `upgrade.visible`; `runs` is kept for the
     hook's own lookups. The wiring is filled in further down, once the
     typing session and `?runs=` exist. */
  const wiring = useRef<AutoThoroughWiring>(UNWIRED);
  /* `loaded` is true for a failed read too, and a failed read's empty list
     would read as "both rows have gone": only a list that arrived is tidied. */
  const upgrade = useAutoThorough({ slug, runs, loaded: loaded && loadError === null && !loadFromCopy, wiring });
  renameUpgrade.current = upgrade.renamed;
  const { panel, setActive } = useSearchMode({
    runs: upgrade.visible,
    blocks,
    words: true,
    onJump,
    onFound,
    openHit,
    onOpenHit,
  });
  renameActive.current = (from, to) =>
    setActive((ids) => (ids.includes(from) ? ids.map((id) => (id === from ? to : id)) : ids));

  /* **Quick search as you type** (plan 261002h): one typing session, one saved
     row. The first pause asks — and ticks the new row, as any ask does — and
     every later pause revises that row, which neither re-ticks it (the reader
     may have unticked it) nor adds anything to `?runs=`. */
  const typing = useTypingSession({
    slug,
    loaded,
    start: (words) => {
      if (isRunning(words, "quick")) return null;
      const id = ask(words, "quick");
      setActive((ids) => [...ids, id]);
      onOpenHit(null);
      // Only rows this tab's typing made are upgraded by themselves.
      upgrade.watch(id);
      return id;
    },
    revise: (id, words) => {
      // Revoke before React can batch a revision with leaving the mode.
      storedPairs.invalidate(id);
      revise(id, words);
    },
    submitted: upgrade.submitted,
  });
  renameSession.current = typing.renamed;
  const draft = searchDraftFor(slug);
  wiring.current = {
    running: (words) => isRunning(words, "meaning"),
    /* Quiet, and not added to `?runs=`: the reader did not press for it, and
       it is not theirs to see until it is complete (review F7). */
    launch: (words) => ask(words, "meaning", undefined, { quiet: true }),
    drop: (meaningId) => remove(meaningId, { quiet: true }),
    owns: typing.owns,
    boxWords: () => draft.text().trim(),
    ticked: (id) => panel.active.includes(id),
    swap: ({ meaningId, quickId }) => {
      /* The colour the quick row is drawn in **now**, not at launch: the
         reader may have recoloured it while the thorough search ran (review
         F4). The resolved slot, as *thorough* below, because an automatic
         colour is stored nowhere. */
      const slot = panel.slots.get(quickId);
      if (slot !== undefined) recolour(meaningId, slot);
      // In place: an unticked quick row gives an unticked thorough row.
      setActive((ids) => ids.map((id) => (id === quickId ? meaningId : id)));
      typing.rowGone(quickId);
      remove(quickId);
      /* The open hit is not cleared here. If it was one of the quick row's,
         it is no longer in the results, and `usePassageLifecycle` drops it. */
    },
  };
  /* A matcher switch ends the session; the words stay in the box, inert. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `panel.matcher` is the trigger, not an input — a switch is what ends the session.
  useEffect(() => {
    typing.end();
  }, [panel.matcher, typing]);
  useBarHandoff(draft, panel.matcher, typing, () => onOpenHit(null));

  return (
    <SearchPanel
      {...panel}
      /* **A tick or a press on a thorough row is the reader choosing**, so a
         pair a reload left behind is no longer tidied over it, even if they
         untick it again (stored-pairs.ts; `forget` does nothing for any other
         row). A gesture on the quick row is not: its tick is what the thorough
         row inherits. */
      onToggle={(id, on) => {
        storedPairs.forget(id);
        panel.onToggle(id, on);
      }}
      onSolo={(id) => {
        storedPairs.forget(id);
        panel.onSolo(id);
      }}
      // Select all ticks every thorough row, a left-behind one included.
      onToggleAll={(on) => {
        if (on) for (const pair of storedPairs.of(slug)) storedPairs.forget(pair.meaningId);
        panel.onToggleAll(on);
      }}
      access={{
        kind: "owner",
        loaded,
        loadError,
        error,
        typing,
        draft,
        upgrading: upgrade.upgrading,
        hidden: upgrade.hidden,
        onAsk: (criterion, kind, sourceId) => {
          const question = criterion.trim();
          // Thorough ends only the session belonging to that quick row.
          if (sourceId !== undefined) typing.rowGone(sourceId);
          if (isRunning(question, kind)) return;
          /* **Thorough replaces its quick row** (plan 261003i B2, Greg's
             `spya-z4bae4`): the meaning search is asked and the quick row
             deleted in the same press, with the two calls this band already
             had. The new row wears the colour the quick one was *drawn* in —
             the resolved slot, because an automatic colour is stored nowhere —
             so the reader's marks do not change hue for asking for more care.
             The quick answer is gone even if the thorough one fails; it is a
             second to ask again, and the plan says what keeping it would
             cost. */
          if (sourceId !== undefined) {
            storedPairs.invalidate(sourceId);
            const id = ask(question, kind, panel.slots.get(sourceId));
            remove(sourceId);
            setActive((ids) => [...ids.filter((x) => x !== sourceId), id]);
            onOpenHit(null);
            return;
          }
          /* `ask` mints the id, so `?runs=` can name the search before the
             model has said anything — the same trick `?note=` and `?thread=`
             use.

             And it switches itself on, which is the one exception to
             default-false: a search the reader just paid for and cannot see is
             not a result. */
          const id = ask(question, kind);
          setActive((ids) => [...ids, id]);
          onOpenHit(null);
        },
        running,
        onRetry: (id) => {
          const run = runs.find((candidate) => candidate.id === id);
          if (!run || isRunning(run.criterion, run.kind)) return;
          storedPairs.invalidate(id);
          retry(id);
        },
        /* Straight through. Unlike every other write on this panel it does not
           touch `?runs=` or the open row: a colour changes what a mark looks
           like, never which marks are drawn or which one the reader is on. */
        onRecolour: recolour,
        onDelete: (id) => {
          storedPairs.invalidate(id);
          typing.rowGone(id);
          remove(id);
          setActive((ids) => ids.filter((x) => x !== id));
          onOpenHit(null);
        },
      }}
    />
  );
}

/**
 * **The band's half of the bar's quick-search box** (plan 261002h stage 3,
 * src/web/DockQuickSearch.tsx). Two jobs, both through the shared draft:
 *
 * - **While on *quick*, the band's typing session is registered**, so the
 *   bar's keystrokes, Enter, focus and blur reach the very session the
 *   panel's box drives. One session, one row, whichever box is typed in.
 * - **A handoff is taken** — the bar's pause, Enter or ⚡ that arrived while
 *   this band was closed or on another matcher, or the command bar's *Quick
 *   search “X”* row (plan 261005i). Not on *quick* yet: switch, and take it on
 *   the next pass. On *quick*: ask with the draft as it is now, which is the
 *   latest the reader typed.
 *
 *   **The switch replaces the history entry only when the band has just
 *   mounted**, which is when the press that left the handoff also pushed
 *   Search open: one Back then still leaves Search mode. A band already open
 *   on words or meaning had nothing pushed for it (both openers skip a
 *   same-mode write), so there the switch pushes, and Back returns to the view
 *   the reader was on rather than skipping it (GPT Sol's F3 on that plan).
 *
 * Declared after the matcher-switch effect in `SearchBand`, so a switch's
 * `end` runs before the handoff starts the new session, not after it.
 */
function useBarHandoff(
  draft: SearchDraft,
  matcher: Matcher,
  typing: BandTyping,
  clearOpenHit: () => void,
): void {
  const [, setMatch] = useQueryState("match", matchParam);
  const handoff = useHandoff(draft);
  /* Is this the band's first look at the handoffs, the one a mount gets? A
     handoff found then came with the press that opened Search; one found
     later reached a band that was already open, and nothing was pushed. */
  const opening = useRef(true);
  const lifetime = useRef<{ draft: SearchDraft } | null>(null);
  useEffect(() => {
    const token = { draft };
    lifetime.current = token;
    return () => {
      // Real departure drops pending actions; StrictMode's immediate setup
      // creates a new token for the same draft and keeps them for consumption.
      queueMicrotask(() => {
        if (lifetime.current === token || lifetime.current?.draft !== draft) {
          draft.clearHandoffs();
        }
      });
    };
  }, [draft]);
  useEffect(
    () => (matcher === "quick" ? draft.registerBand(typing) : undefined),
    [draft, matcher, typing],
  );
  // Defer consumption past StrictMode's setup/cleanup replay: its session
  // cleanup must not erase an intent that was already removed from the store.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `clearOpenHit` only clears a selection.
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const opened = opening.current;
      opening.current = false;
      if (draft.handoff() === null) return;
      if (matcher !== "quick") {
        void setMatch("quick", { history: opened ? "replace" : "push" });
        clearOpenHit();
        return;
      }
      let taken = draft.take();
      while (taken !== null) {
        if (taken.type === "pause") {
          typing.edit(draft.text());
          typing.pause();
        } else if (taken.type === "enter" && taken.text.trim() !== "") {
          typing.flush(taken.text);
        }
        const next = draft.take();
        // Words edited after the last sealed Enter belong to a fresh session.
        if (next === null && taken.type === "enter" && draft.text() !== taken.text) {
          typing.edit(draft.text());
        }
        taken = next;
      }
    });
    return () => { live = false; };
  }, [handoff, matcher, draft, typing, setMatch]);
}

/**
 * **The timers and effects around `stepQuickSession`** — the pure rules live
 * in src/web/quick-session.ts, and this is the only place they meet a clock.
 *
 * State in a ref, not in React state: nothing renders from it, and an edit
 * must see the session the previous edit left synchronously, inside one
 * batch. Unmounting (leaving Search mode) drops it, and a new article ends it,
 * so words left in the box are inert until the next edit.
 */
function useTypingSession({
  slug,
  loaded,
  start,
  revise,
  submitted,
}: {
  slug: string;
  loaded: boolean;
  /** Ask a new quick search, returning its id — or `null` if it was refused. */
  start(words: string): string | null;
  revise(id: string, words: string): void;
  /**
   * Enter or *find* was pressed on these words for this row — **whether or not the
   * session then asks anything**. A pause followed by Enter on unchanged
   * words emits neither `start` nor `revise`, and it is still the reader
   * saying "these words" (plan 261004l, review F1).
   */
  submitted(quickId: string, words: string): void;
}): BandTyping & {
  renamed(from: string, to: string): void;
  rowGone(id: string): void;
  /** Is this the row the open session is revising? (plan 261004l, review F2) */
  owns(id: string): boolean;
} {
  const latest = useRef({ loaded, start, revise, submitted });
  latest.current = { loaded, start, revise, submitted };

  const controls = useMemo(() => {
    let state: QuickSession = IDLE;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(pauseTimer);
      clearTimeout(blurTimer);
      pauseTimer = undefined;
      blurTimer = undefined;
    };
    const dispatch = (event: QuickEvent): void => {
      const before = state;
      const out = stepQuickSession(state, event);
      state = out.state;
      if (!state.open) stop();
      const effect = out.effect;
      let submittedId = before.rowId;
      if (effect?.type === "ask") {
        const id = latest.current.start(effect.words);
        submittedId = id;
        if (!out.sealed) dispatch({ type: "asked", id });
      } else if (effect?.type === "revise") {
        latest.current.revise(effect.id, effect.words);
        submittedId = effect.id;
      }
      if ((event.type === "flush" || out.sealed) && submittedId !== null) {
        const words = effect?.words ?? (event.type === "flush" ? event.text.trim() : "");
        latest.current.submitted(submittedId, words);
      }
      // Drain sealed flushes before any pause carried by the new session.
      if (out.sealed) dispatch({ type: "loaded" });
    };
    return {
      edit(text: string) {
        dispatch({ type: "edit", text });
        clearTimeout(pauseTimer);
        pauseTimer = state.open
          ? setTimeout(() => dispatch({ type: "pause", loaded: latest.current.loaded }), PAUSE_MS)
          : undefined;
      },
      /* Dispatch associates explicit submission with its own row, including
         a sealed flush held until loading and Enter after an unchanged pause.
         The panel, bar and handoffs all reach it through here. */
      flush(text: string) {
        clearTimeout(pauseTimer);
        dispatch({ type: "flush", loaded: latest.current.loaded, text });
      },
      /* The pause already happened, in the bar's box (plan 261002h stage 3):
         ask now rather than wait another 600 ms. */
      pause() {
        clearTimeout(pauseTimer);
        pauseTimer = undefined;
        dispatch({ type: "pause", loaded: latest.current.loaded });
      },
      end: () => dispatch({ type: "end" }),
      /* Blurred for longer than a pause ends it (Opus): somebody who searched,
         read for five minutes and types again starts a new row, rather than
         overwriting a search they may want. */
      blur() {
        clearTimeout(blurTimer);
        blurTimer = state.open ? setTimeout(() => dispatch({ type: "end" }), PAUSE_MS) : undefined;
      },
      focus() {
        clearTimeout(blurTimer);
        blurTimer = undefined;
      },
      loaded: () => dispatch({ type: "loaded" }),
      renamed: (from: string, to: string) => dispatch({ type: "renamed", from, to }),
      rowGone: (id: string) => dispatch({ type: "rowGone", id }),
      owns: (id: string) => state.open && state.rowId === id,
      stop,
    };
  }, []);

  // A pause that came before the saved list is asked when it lands (Sol F1).
  useEffect(() => {
    if (loaded) controls.loaded();
  }, [loaded, controls]);
  // Another article, or leaving the mode, ends the session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slug` is the trigger — a new article ends the session.
  useEffect(
    () => () => {
      controls.end();
      controls.stop();
    },
    [slug, controls],
  );
  return controls;
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
 *
 * **It takes an updater, not a list**, since several searches can be started
 * at once (docs/plans/260930f-parallel-searches.md). nuqs itself does not
 * compose two functional updates in one React batch: it refreshes the ref its
 * updater reads from inside a React state updater, which the batch defers. So
 * `activeRef` below advances synchronously before handing nuqs the concrete
 * list. Ordinary clicks are separate discrete events, but correctness does not
 * need to lean on React flushing between them. GPT Sol raised this in the plan
 * review; the first version documented the hole instead of closing it.
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
  const activeRef = useRef(active);
  activeRef.current = active;
  const setActive = (next: (ids: string[]) => string[]) => {
    const ids = next(activeRef.current);
    activeRef.current = ids;
    void setRunIds(ids);
  };
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
        .map((r) => ({ id: r.id, kind: r.kind, slot: slots.get(r.id) ?? 0, hits: r.hits })),
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
        setActive((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
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
        setActive(() => [id]);
        onOpenHit(null);
      },
      onToggleAll: (on: boolean) => {
        setActive(() => (on ? runs.map((r) => r.id) : []));
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
    setActive,
  };
}
