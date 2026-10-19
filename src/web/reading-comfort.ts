/**
 * **Brightness and text size** — two reading-comfort settings on `/profile`,
 * each kept on this device and written onto `<html>` as one attribute that
 * `styles/reading-comfort.css` reads. Greg, 2026-10-18, on an iPad in a dark
 * bedroom (spya-q645m0, spya-ast8cu): a way to show less light than the iPad's
 * lowest brightness, and bigger text in a home-screen app that has no zoom.
 *
 * - **Brightness** draws one black layer over the whole page, so every pixel's
 *   encoded RGB value is scaled by the same share — ink, page and pictures
 *   alike. The share of emitted light is smaller because sRGB is nonlinear.
 * - **Text size** sets the root font-size, so every `rem` grows, which is
 *   nearly all of the app's type, and the JS layout follows by reading the root
 *   (reader/measure.ts § `useRootFontPx`). typography.md § The reader's text
 *   size scales the root says what that asks of new code.
 *
 * **On this device, and in `localStorage`**, for the reason appearance.ts
 * gives: both have to be right before first paint, and a brightness that
 * arrived with `GET /api/reader` would be a full-brightness flash in the dark
 * on every load. `index.html`'s `appearance-boot` script is the before-paint
 * copy of `parse` here; tests/reading-comfort.test.ts runs it and checks the
 * two agree. The default value sets no attribute at all, so a page whose script
 * never ran is today's page.
 * docs/plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md.
 */
import { useSyncExternalStore } from "react";

export interface ComfortSetting<V extends string> {
  /** The `localStorage` key; `index.html`'s inline script reads it too. */
  readonly key: string;
  /** The attribute on `<html>`, absent at the default. */
  readonly attribute: string;
  readonly values: readonly V[];
  readonly fallback: V;
  parse(raw: string | null | undefined): V;
}

function setting<V extends string>(
  key: string,
  attribute: string,
  values: readonly V[],
): ComfortSetting<V> {
  const fallback = values[0]!;
  return {
    key,
    attribute,
    values,
    fallback,
    parse: (raw) => (values as readonly string[]).includes(raw ?? "") ? (raw as V) : fallback,
  };
}

export type Brightness = "full" | "dim" | "dimmer" | "dimmest";
export type TextSize = "default" | "large" | "larger" | "largest";

/** The first value of each is its default. */
export const BRIGHTNESS = setting<Brightness>("spya.brightness", "data-brightness", [
  "full",
  "dim",
  "dimmer",
  "dimmest",
]);
export const TEXT_SIZE = setting<TextSize>("spya.text-size", "data-text-size", [
  "default",
  "large",
  "larger",
  "largest",
]);

const SETTINGS: readonly ComfortSetting<string>[] = [BRIGHTNESS, TEXT_SIZE];

/** Guarded: a private window or blocked storage throws on access. */
function readStored<V extends string>(s: ComfortSetting<V>): V {
  try {
    return s.parse(window.localStorage.getItem(s.key));
  } catch {
    return s.fallback;
  }
}

/* The value on this page, and whether its last write failed — in which case it
   holds for this visit only and the control has to say so, as Appearance does. */
const current = new Map<string, string>();
const volatile = new Set<string>();
const listeners = new Set<() => void>();

function apply<V extends string>(s: ComfortSetting<V>, value: V): void {
  const root = document.documentElement;
  if (value === s.fallback) root.removeAttribute(s.attribute);
  else root.setAttribute(s.attribute, value);
  /* The JS layout reads the root font-size on `resize` (reader/measure.ts §
     `useRootFontPx`), and a CSS change to it fires none. */
  if (s.key === TEXT_SIZE.key) window.dispatchEvent(new Event("resize"));
}

/** The value on this page now — for the control, and for a feedback report. */
export function readComfort<V extends string>(s: ComfortSetting<V>): V {
  return (current.get(s.key) as V | undefined) ?? readStored(s);
}

/** Save the choice on this device and apply it at once. Returns whether it was saved. */
export function setComfort<V extends string>(s: ComfortSetting<V>, value: V): boolean {
  let saved = true;
  try {
    window.localStorage.setItem(s.key, value);
  } catch {
    saved = false;
  }
  current.set(s.key, value);
  if (saved) volatile.delete(s.key);
  else volatile.add(s.key);
  apply(s, value);
  for (const l of listeners) l();
  return saved;
}

function refreshFromStorage(s: ComfortSetting<string>): void {
  const value = readStored(s);
  current.set(s.key, value);
  volatile.delete(s.key);
  apply(s, value);
  for (const l of listeners) l();
}

/** Repaint a page-only choice after bfcache without replacing it from storage. */
function reapplyCurrent(s: ComfortSetting<string>): void {
  const value = current.get(s.key) ?? s.fallback;
  apply(s, value);
  for (const l of listeners) l();
}

let started = false;

/**
 * Once, from main.tsx: follow another tab that changes either setting, and
 * repair a page restored from the back-forward cache under a choice made since
 * (a choice this page could not save is kept, as appearance.ts keeps its own).
 */
export function startReadingComfort(): void {
  if (started) return;
  started = true;
  window.addEventListener("storage", (e) => {
    for (const s of SETTINGS) if (e.key === s.key || e.key === null) refreshFromStorage(s);
  });
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    for (const s of SETTINGS) {
      if (volatile.has(s.key)) reapplyCurrent(s);
      else refreshFromStorage(s);
    }
  });
  /* Reconcile the head script with storage before React mounts. Besides closing
     the tiny head-to-module race, this repairs the page if that script was
     removed or aborted while the module still loaded. */
  for (const s of SETTINGS) refreshFromStorage(s);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The current choice, for the /profile control. */
export function useComfort<V extends string>(s: ComfortSetting<V>): V {
  return useSyncExternalStore(subscribe, () => readComfort(s), () => s.fallback);
}

/** Whether every current choice survived its last `localStorage` write. */
export function useComfortSaved(): boolean {
  return useSyncExternalStore(subscribe, () => volatile.size === 0, () => true);
}
