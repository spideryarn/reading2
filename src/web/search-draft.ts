/**
 * **The words being typed into a search, shared by the two boxes that type
 * them** — the bar's quick-search box (DockQuickSearch.tsx) and the Search
 * panel's box (SearchPanel.tsx § Box). Plan 261002h § 1, "one draft, two boxes
 * onto it — not a second search".
 *
 * One store per article, held here rather than in either component because
 * neither outlives the other: the panel's box goes when Search mode closes,
 * and the bar's box is not drawn in Search mode unless it has focus. The
 * asking stays in exactly one place, `SearchBand`'s typing session
 * (src/web/modes/search/SearchMode.tsx § useTypingSession); this file only
 * carries the words, and the three messages the bar needs to send it.
 *
 * ## The one-way rules (Sol F6)
 *
 * - The bar's box writes the draft **only while it has focus** — that is,
 *   only from its own `onChange`.
 * - The panel's box reads and writes it with *quick* or *meaning* chosen.
 *   *Words* keeps `?find=`, as it always has, and never touches it.
 * - **Fetches never write it.** A criterion arriving from the server is not
 *   something the reader typed, and that was a bug this panel once had
 *   (SearchPanel.tsx § the draft question).
 *
 * ## The three messages
 *
 * - **A handoff** — the bar has had its first qualifying pause (or Enter, or
 *   the ⚡) while the band could not hear it: Search mode closed, or open on
 *   another matcher. The band, once it is mounted on *quick*, takes it and
 *   asks. `useSyncExternalStore` so a band already mounted on *meaning*
 *   notices it and switches.
 * - **The band's typing controls**, registered while the band is on *quick*,
 *   so the bar's later keystrokes reach the same session the panel's do.
 * - **The panel box's focus**, registered by the panel, so the ⚡ can focus it
 *   inside the tap when the panel is already mounted.
 */
import { useSyncExternalStore } from "react";
import type { TypingControls } from "./SearchPanel.js";

/**
 * What the bar asked of the band while the band could not hear it.
 *
 * - `pause`: a qualifying pause in the bar's box — start a session with the
 *   draft and ask now.
 * - `enter`: Enter in the bar's box — ask the draft now, and seal it.
 * - `quick`: the ⚡ — nothing to ask, only be on *quick*.
 */
export type Handoff = "pause" | "enter" | "quick";

/** The band's session, as the bar drives it: the panel's controls and a pause on demand. */
export interface BandTyping extends TypingControls {
  /** The pause has happened already (in the bar): ask now rather than in 600 ms. */
  pause(): void;
}

export interface SearchDraft {
  /** The words in the draft now. */
  text(): string;
  set(text: string): void;
  handoff(): Handoff | null;
  handOff(h: Handoff): void;
  /** Take the pending handoff, leaving none. */
  take(): Handoff | null;
  /** The band's session, while it is on *quick*; `null` otherwise. */
  band(): BandTyping | null;
  registerBand(band: BandTyping): () => void;
  /** Focus the panel's box, if one is mounted. False if none is. */
  focusBox(): boolean;
  registerBox(focus: () => void): () => void;
  /** Does the bar's box have focus? The panel then does not take it on mount (Sol F2). */
  barFocused(): boolean;
  setBarFocused(on: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createSearchDraft(): SearchDraft {
  let text = "";
  let handoff: Handoff | null = null;
  let band: BandTyping | null = null;
  let box: (() => void) | null = null;
  let barFocused = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    text: () => text,
    set(next) {
      if (next === text) return;
      text = next;
      emit();
    },
    handoff: () => handoff,
    handOff(h) {
      handoff = h;
      emit();
    },
    take() {
      const h = handoff;
      if (h !== null) {
        handoff = null;
        emit();
      }
      return h;
    },
    band: () => band,
    registerBand(next) {
      band = next;
      return () => {
        if (band === next) band = null;
      };
    },
    focusBox() {
      if (!box) return false;
      box();
      return true;
    },
    registerBox(focus) {
      box = focus;
      return () => {
        if (box === focus) box = null;
      };
    },
    barFocused: () => barFocused,
    setBarFocused(on) {
      barFocused = on;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Every article's draft, for as long as the page lives — so leaving Search
 * mode and coming back finds the words where they were. A handful of short
 * strings; nothing here is worth evicting.
 */
const drafts = new Map<string, SearchDraft>();

/** This article's draft, made on first use. */
export function searchDraftFor(slug: string): SearchDraft {
  let draft = drafts.get(slug);
  if (!draft) {
    draft = createSearchDraft();
    drafts.set(slug, draft);
  }
  return draft;
}

/** The draft's words, as React state. */
export function useDraftText(draft: SearchDraft): string {
  return useSyncExternalStore(draft.subscribe, draft.text, draft.text);
}

/** The pending handoff, as React state. */
export function useHandoff(draft: SearchDraft): Handoff | null {
  return useSyncExternalStore(draft.subscribe, draft.handoff, draft.handoff);
}
