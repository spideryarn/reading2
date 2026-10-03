/**
 * **One typing session, one saved row** — the rules of quick search-as-you-type,
 * as a pure reducer (plan 261002h § "Plan review … what changed", Sol F5).
 *
 * > Q-quick-ui let's try the search-as-you-type, just for fun. Will it
 * > automatically delete the obsolete versions as I keep typing?
 * >
 * > — Greg, 2026-10-02
 *
 * The answer this file implements: nothing is deleted, because nothing extra is
 * made. The first pause asks a new quick search; every later pause in the same
 * session **revises that row** (`revises: true` on the POST, src/searches.ts §
 * withRun) — same id, same colour, same place in the list.
 *
 * Pure: no timers, no fetches, no React. The caller (`useTypingSession` in
 * src/web/modes/search/SearchMode.tsx) owns the 600 ms timer and the blur timer,
 * feeds the events in, and carries out the one effect that comes back. That
 * split is what lets every rule below be tested without a clock or a DOM.
 *
 * ## The rules
 *
 * - A session **starts** at the first edit of the box with *quick* chosen, and
 *   acquires its row on its first ask (`asked`).
 * - A **pause** (600 ms, the caller's timer) asks — the first time — or revises
 *   the row. It needs at least `MIN_CHARS` characters, and words unchanged since
 *   the last ask ask nothing.
 * - A pause before the saved list has loaded is **carried**, not dropped, and
 *   fires on `loaded` (Sol F1: the GET's answer replaces the list, so a row
 *   asked before it would be wiped from the screen when it landed).
 * - Enter or *find* **flushes** changed words into the row and **ends** the
 *   session. With no session open they ask a fresh search, as they always did.
 *   Before `loaded`, explicit flushes are held too, with their words sealed.
 * - The session also **ends** on: the box emptied; a matcher switch; ↺ or ✕
 *   or *thorough* (`rowGone` / `end`); leaving the mode or the article (the
 *   caller's state simply goes); and the box blurred for longer than a pause.
 * - Words left in the box after a session ends are **inert**: only an edit
 *   starts a new session, so remounting with text in the box never asks.
 */

/** The pause after which a quick search asks — the caller's timer. */
export const PAUSE_MS = 600;

/** The fewest characters a pause will ask about. Enter asks anything non-empty. */
export const MIN_CHARS = 3;

export interface QuickSession {
  /** Is a session open? Closed means leftover text is inert. */
  open: boolean;
  /** The row this session owns, once its first ask has minted one. */
  rowId: string | null;
  /** The trimmed words last sent for that row. */
  asked: string | null;
  /** What is in the box now. */
  text: string;
  /** A pause arrived before the saved list did; ask when it does (Sol F1). */
  due: boolean;
  /** Explicit searches sealed before loading; later edits belong to a new session. */
  flushes: QuickEffect[];
}

export const IDLE: QuickSession = {
  open: false, rowId: null, asked: null, text: "", due: false, flushes: [],
};

export type QuickEvent =
  /** The reader changed the box (quick chosen). `""` is the box emptied. */
  | { type: "edit"; text: string }
  /** The caller's pause timer fired. */
  | { type: "pause"; loaded: boolean }
  /** The saved list has come back, answered or failed. */
  | { type: "loaded" }
  /**
   * Enter, or the *find* button, with what the box says now — which may have
   * arrived without an edit (a matcher switch, ↺).
   */
  | { type: "flush"; loaded: boolean; text: string }
  /** The ask this reducer asked for minted this id — or was refused (`null`). */
  | { type: "asked"; id: string | null }
  /** `begin` answered under another id; follow it. */
  | { type: "renamed"; from: string; to: string }
  /** Deleted, or replaced by *thorough*: if it is this session's row, the session ends. */
  | { type: "rowGone"; id: string }
  /** A matcher switch, ↺, a long blur, leaving the mode. */
  | { type: "end" };

export type QuickEffect =
  | { type: "ask"; words: string }
  | { type: "revise"; id: string; words: string };

export function stepQuickSession(
  state: QuickSession,
  event: QuickEvent,
): { state: QuickSession; effect: QuickEffect | null; sealed?: boolean } {
  switch (event.type) {
    case "edit": {
      if (event.text.trim() === "") {
        return { state: { ...IDLE, text: event.text, flushes: state.flushes }, effect: null };
      }
      if (!state.open) {
        return { state: { ...IDLE, open: true, text: event.text, flushes: state.flushes }, effect: null };
      }
      return { state: { ...state, text: event.text }, effect: null };
    }
    case "pause": {
      if (!state.open) return { state, effect: null };
      if (!event.loaded) return { state: { ...state, due: true }, effect: null };
      return ask({ ...state, due: false }, MIN_CHARS);
    }
    case "loaded": {
      const [effect, ...flushes] = state.flushes;
      if (effect) return { state: { ...state, flushes }, effect, sealed: true };
      if (!state.open || !state.due) return { state, effect: null };
      return ask({ ...state, due: false }, MIN_CHARS);
    }
    case "flush": {
      const words = event.text.trim();
      const effect = state.open
        ? ask({ ...state, text: event.text }, 1).effect
        : (words === "" ? null : { type: "ask" as const, words });
      // Seal now, including before loading: the next edit starts a new row.
      const closed = { ...IDLE, text: event.text, flushes: state.flushes };
      if (!event.loaded && effect) {
        return { state: { ...closed, flushes: [...state.flushes, effect] }, effect: null };
      }
      return { state: closed, effect };
    }
    case "asked": {
      if (!state.open) return { state, effect: null };
      // Refused (the same words already out): try again on the next pause.
      if (event.id === null) return { state: { ...state, asked: null }, effect: null };
      return { state: { ...state, rowId: event.id }, effect: null };
    }
    case "renamed": {
      if (!state.open || state.rowId !== event.from) return { state, effect: null };
      return { state: { ...state, rowId: event.to }, effect: null };
    }
    case "rowGone": {
      if (!state.open || state.rowId !== event.id) return { state, effect: null };
      return { state: { ...IDLE, text: state.text }, effect: null };
    }
    case "end":
      return { state: { ...IDLE, text: state.text }, effect: null };
    default: {
      const never: never = event;
      return never;
    }
  }
}

/** Ask or revise with the current words, if they are long enough and new. */
function ask(
  state: QuickSession,
  min: number,
): { state: QuickSession; effect: QuickEffect | null } {
  const words = state.text.trim();
  if (words.length < min || words === state.asked) return { state, effect: null };
  const next = { ...state, asked: words };
  if (state.rowId === null) return { state: next, effect: { type: "ask", words } };
  return { state: next, effect: { type: "revise", id: state.rowId, words } };
}
