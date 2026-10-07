/**
 * **A quick-search box in the bottom bar** — plan 261002h, stage 3.
 *
 * > I'm excited about the quick search. Can we add a searchbar somehow in the
 * > bottom bar that makes it easy to trigger a quick search from anywhere?
 * >
 * > — Greg, 2026-10-02
 *
 * **Not a second search.** This box and the Search panel's box are two views
 * of one draft (src/web/search-draft.ts), and the asking happens in one place,
 * the band's typing session (SearchMode.tsx § useTypingSession). What this
 * component adds is only what the band cannot do from where it is:
 *
 * - **With Search mode closed** (or open on another matcher) the band is not
 *   listening, so this box waits for the first qualifying pause itself — by
 *   the band's own rule, `stepQuickSession` from quick-session.ts, not a copy
 *   of it — then opens Search mode and hands the draft over. Focus stays here
 *   (the panel does not take it, Sol F2) and the article does not move.
 * - **With the band on *quick***, every keystroke, Enter, focus and blur goes
 *   straight to the band's session, exactly as the panel's box does, so one
 *   session keeps one row whichever box the reader types in.
 *
 * ## The box and the ⚡ (Sol F9, Opus)
 *
 * Both are always in the DOM; the stylesheet (styles/dock-quick-search.css)
 * picks one, so the fit ladder (dock-fit.ts) can measure each rung by class
 * without React swapping elements in the middle of a measurement:
 *
 * - a mouse, at every rung but the last: the box — compact at rung 3, so it
 *   outlives every label in the bar (rung 4 went in below for this,
 *   2026-10-02: an owner's laptop sits on rung 3);
 * - the last rung (4), a window under 732px, or **any touch screen**
 *   (`pointer: coarse` — a text box in a fixed bar at the foot of an iPad is
 *   where the on-screen keyboard misbehaves): **nothing**. Until 2026-10-05
 *   these drew the ⚡ alone; Greg, `spya-n8pgy2`: "if there isn't much room,
 *   don't bother showing the quick search icon alone without the input text
 *   bar" — the Search button is in the same bar (plan 261005h). `/` still
 *   works there, and does what the ⚡ did;
 * - **Search mode open and this box not focused**, at a width that has the
 *   box: the ⚡ (a class this component sets), so there is only ever one box
 *   to type in. It opens Search mode on *quick* with the panel's box focused.
 *
 * The ⚡ focuses the panel's box inside the tap when the panel is already
 * mounted. When it is not, the box mounts a render later and focuses itself
 * then — after the tap, so **iOS may not raise the keyboard until a second
 * tap**. That is the accepted cost, written down rather than claimed away; the
 * browser check cannot show it (plan § Sol F9).
 *
 * ## The cross
 *
 * > Can you add a little X to it so that after I've searched with it, I can
 * > easily wipe it? Or maybe even automatically wipe it after I've searched
 * > with it.
 * >
 * > — Greg, 2026-10-04
 *
 * Shown while the box has words in it. It is Escape's clear (`clear` below,
 * one path for both) with the focus kept. The box does not wipe itself after
 * a search: the words stay so the next keystroke refines them.
 *
 * ## `/`
 *
 * The web's usual key for "jump to search" (GitHub, YouTube, Gmail). It
 * focuses this box, or does the ⚡'s job where the box is not shown — which
 * includes everywhere the ⚡ is not drawn either. The
 * guards are G's (TermJump.tsx § isOurKey) less one: **Shift is not refused**,
 * because some layouts need it to type `/` at all (Sol F10). It overrides
 * Firefox's Quick Find, a niche duplicate of ⌘F/Ctrl-F, as GitHub does.
 *
 * Mounted only on an owner's reading view — where `SearchBand`, not the
 * visitor's read-only band, would answer (Sol F8; Dock.tsx §
 * `hasQuickSearch`). So the `/` listener exists only there too.
 */
import { X, Zap } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { isImeComposing, isTyping } from "./key-chord.js";
import { IDLE, PAUSE_MS, type QuickSession, stepQuickSession } from "./quick-session.js";
import { type HandoffKind, searchDraftFor, useBandTyping, useDraftText } from "./search-draft.js";

/** The key that jumps to quick search. */
export const QUICK_SEARCH_KEY = "/";

/**
 * A plain `/`, pressed where a `/` is not a character and no modal owns the
 * keys. Shift is allowed (see the module docblock); Ctrl, ⌘ and Alt are not.
 */
export function isQuickSearchKey(e: KeyboardEvent): boolean {
  if (e.key !== QUICK_SEARCH_KEY) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.defaultPrevented || isTyping(e.target)) return false;
  return document.querySelector("dialog[open]") === null;
}

export function DockQuickSearch({
  slug,
  searching,
  onOpen,
}: {
  slug: string;
  /** Is Search mode the band that is open? */
  searching: boolean;
  /** Open Search mode — the Dock's own door, `useActivateMode`. */
  onOpen(): void;
}) {
  const draft = searchDraftFor(slug);
  const text = useDraftText(draft);
  const band = useBandTyping(draft);
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /* The band's rule, run here only while the band cannot hear: has there been
     a qualifying pause yet? */
  const session = useRef<QuickSession>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopWaiting = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    session.current = IDLE;
  };

  // Once the band owns the session, no older bar pause may fire beside it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stopWaiting only reads refs.
  useEffect(() => {
    if (band) stopWaiting();
  }, [band]);

  /** Ask the band to take over, and make sure there is a band to ask. */
  const handOff = (h: HandoffKind) => {
    stopWaiting();
    draft.handOff(h);
    onOpen();
  };
  /** The ⚡: Search mode on quick, with the panel's box focused. */
  const bolt = () => {
    input.current?.blur();
    handOff("quick");
    // Inside the tap, when the panel is already here; otherwise it focuses itself on mount.
    draft.focusBox();
  };

  /* Latest closures for the window listener, which is bound once. */
  const latest = useRef({ bolt, handOff, collapsed: searching && !focused });
  latest.current = { bolt, handOff, collapsed: searching && !focused };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isQuickSearchKey(e)) return;
      e.preventDefault();
      const shown =
        !latest.current.collapsed &&
        field.current !== null &&
        getComputedStyle(field.current).display !== "none";
      if (shown) input.current?.focus({ preventScroll: true });
      else latest.current.bolt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Check the final CSS shape after layout, never a rung being probed by
     chooseDockFit. A resize/coarse-pointer change or a final class change may
     hide the focused input; continue in the panel instead of leaving focus
     on an invisible box. */
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      if (field.current?.contains(document.activeElement) &&
          getComputedStyle(field.current).display === "none") {
        latest.current.bolt();
      }
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const dock = field.current?.closest(".dock");
    const observer = new MutationObserver(soon);
    if (dock) observer.observe(dock, { attributes: true, attributeFilter: ["class"] });
    const coarse = typeof matchMedia === "undefined" ? null : matchMedia("(pointer: coarse)");
    coarse?.addEventListener("change", soon);
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      coarse?.removeEventListener("change", soon);
      window.removeEventListener("resize", soon);
    };
  }, []);

  /* Leaving (another article, or the bar going) lets go of everything this
     box was holding, so the panel's next mount is not told the bar has focus. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draft` is per slug, and so is this cleanup.
  useEffect(
    () => () => {
      stopWaiting();
      draft.clearHandoffs();
      draft.setBarFocused(false);
    },
    [slug],
  );

  const onChange = (value: string) => {
    if (document.activeElement !== input.current) return;
    draft.set(value);
    const band = draft.band();
    if (band) {
      stopWaiting();
      band.edit(value);
      return;
    }
    session.current = stepQuickSession(session.current, { type: "edit", text: value }).state;
    clearTimeout(timer.current);
    timer.current = session.current.open
      ? setTimeout(() => {
          const out = stepQuickSession(session.current, { type: "pause", loaded: true });
          session.current = out.state;
          if (out.effect?.type === "ask") latest.current.handOff("pause");
        }, PAUSE_MS)
      : undefined;
  };

  /** Empty the draft and end whatever session was listening — Escape's and the cross's one clear. */
  const clear = () => {
    stopWaiting();
    draft.set("");
    draft.band()?.edit("");
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isImeComposing(e)) {
      e.preventDefault();
      const value = e.currentTarget.value;
      if (value.trim() === "") return;
      const band = draft.band();
      if (band) {
        stopWaiting();
        band.flush(value);
      } else handOff("enter");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      /* Not the Escape that dismisses an input method's candidates: the words
         and the caret stay. It is still cancelled above, because a
         `type="search"` box is emptied by the browser itself on Escape
         (measured in Chrome, 2026-10-07). */
      if (isImeComposing(e)) return;
      clear();
      e.currentTarget.blur();
    }
  };

  return (
    <span className={`dock-qs${searching && !focused ? " dock-qs--bolt" : ""}`}>
      {/* biome-ignore lint/a11y/useSemanticElements: the dock's inline field groups its input and clear button without a fieldset's layout defaults. */}
      <span
        className={`dock-qs-field${text === "" ? "" : " dock-qs-field--filled"}`}
        ref={field}
        role="group"
        aria-label="Quick search controls"
        onFocus={() => {
          setFocused(true);
          draft.setBarFocused(true);
          draft.band()?.focus();
        }}
        onBlur={(e) => {
          // Moving to the clear button stays in this field, including with Tab.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setFocused(false);
          draft.setBarFocused(false);
          /* A pause still pending here is dropped: a reader who typed and
             clicked away did not ask for Search mode to open behind them.
             With the band listening, its own blur rule decides (Opus). */
          if (timer.current !== undefined) stopWaiting();
          draft.band()?.blur();
        }}
      >
        <Zap size={13} aria-hidden className="dock-qs-icon" />
        <input
          ref={input}
          className="dock-qs-input"
          type="search"
          enterKeyHint="search"
          placeholder="Quick search"
          aria-label="Quick search"
          aria-keyshortcuts="/"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {text === "" && !focused && (
          <kbd className="dock-qs-key" aria-hidden>
            /
          </kbd>
        )}
        {text !== "" && (
          /* **The cross that empties the box** (plan 261004g). Escape's clear,
             but the focus stays: the words are kept after a search so the
             reader can refine them, and this is the one press that wipes them
             for the next. Mousedown keeps the input focused; focus handling on
             the field also lets keyboard and other input paths reach the cross
             without collapsing it into the ⚡ (`dock-qs--bolt`). */
          <button
            type="button"
            className="dock-qs-clear"
            aria-label="Clear the search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              clear();
              input.current?.focus({ preventScroll: true });
            }}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </span>
      <button
        type="button"
        className="dock-btn dock-qs-bolt"
        aria-label="Quick search"
        aria-keyshortcuts="/"
        onClick={bolt}
      >
        <Zap size={15} aria-hidden />
      </button>
    </span>
  );
}
