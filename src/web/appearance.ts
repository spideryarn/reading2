/**
 * **Light, Dark or System** — the reader's appearance choice, and the one place
 * that turns it into `<html data-theme="light|dark">`.
 *
 * The choice lives in `localStorage`, per device, and not on the reader's
 * profile row, because it has to be known **before first paint**: a value that
 * arrives with `GET /api/reader` arrives after the page has already been drawn
 * in the other colour. So an inline script in `index.html`'s `<head>` reads the
 * same key and sets the same attribute before the stylesheet loads, and this
 * module keeps it right afterwards — the choice changing on /profile, the OS
 * changing under System, another tab changing it.
 *
 * **The inline script is a second copy of `resolveTheme`**, deliberately: it
 * must run before any module does. `tests/appearance.test.ts` runs it out of
 * `index.html` and checks it agrees with this file on every case, so the two
 * cannot drift without a red test.
 *
 * The CSS keys on `:root[data-theme="light"]` alone; `:root` is the dark
 * palette, so a page whose script never ran is today's page.
 * docs/project/web-client.md § Appearance, and
 * docs/plans/261003e-light-dark-and-system-appearance-on-profile.md.
 */
import { useSyncExternalStore } from "react";

export type Appearance = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];

/** `index.html`'s inline script reads this key too — change both or neither. */
export const APPEARANCE_KEY = "spya.appearance";

/**
 * **What a reader who has never chosen gets: Dark**, which is what everybody
 * had before the choice existed. System would have turned the app white, on
 * the first day of a light palette, for every reader whose OS is in light mode.
 * The inline script in `index.html` hard-codes the same default.
 */
export const DEFAULT_APPEARANCE: Appearance = "dark";

/** The page colour of each theme, for `<meta name="theme-color">`. */
export const THEME_COLOR: Record<Theme, string> = { dark: "#0a0a0a", light: "#fafafa" };

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

export function parseAppearance(raw: string | null | undefined): Appearance {
  return raw === "system" || raw === "light" || raw === "dark" ? raw : DEFAULT_APPEARANCE;
}

export function resolveTheme(choice: Appearance, systemPrefersDark: boolean): Theme {
  if (choice === "system") return systemPrefersDark ? "dark" : "light";
  return choice;
}

/** Guarded: a private window or blocked storage throws on access. */
export function readAppearance(): Appearance {
  try {
    return parseAppearance(window.localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(SYSTEM_DARK).matches;
}

/** Write the resolved theme onto the document, and tell the browser's own furniture. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme;
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

const listeners = new Set<() => void>();
let current: Appearance | null = null;

function refresh(): void {
  current = readAppearance();
  applyTheme(resolveTheme(current, systemPrefersDark()));
  for (const l of listeners) l();
}

/**
 * Save the choice on this device and apply it at once. Returns whether it was
 * saved: a private window or blocked storage throws, and the choice then holds
 * for this visit only — `current` keeps it — which the control has to say
 * rather than claim "Saved on this device" (GPT Sol, plan review).
 */
export function setAppearance(choice: Appearance): boolean {
  let saved = true;
  try {
    window.localStorage.setItem(APPEARANCE_KEY, choice);
  } catch {
    saved = false;
  }
  current = choice;
  applyTheme(resolveTheme(choice, systemPrefersDark()));
  for (const l of listeners) l();
  return saved;
}

let started = false;

/**
 * Once, from main.tsx: follow the OS while the choice is System, and follow
 * another tab that changes the choice. Re-applies at once too, which repairs a
 * page restored from the back-forward cache under a choice made since.
 */
export function startAppearance(): void {
  if (started) return;
  started = true;
  if (typeof window.matchMedia === "function") {
    window.matchMedia(SYSTEM_DARK).addEventListener("change", () => {
      if ((current ?? readAppearance()) === "system") refresh();
    });
  }
  window.addEventListener("storage", (e) => {
    if (e.key === APPEARANCE_KEY || e.key === null) refresh();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) refresh();
  });
  refresh();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function snapshot(): Appearance {
  return current ?? readAppearance();
}

/** The current choice, for the /profile control. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_APPEARANCE);
}

/** The theme on the page now, read off the attribute rather than recomputed. */
export function currentTheme(doc: Document = document): Theme {
  return doc.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * **The resolved theme, for anything that measures colours** — /design's
 * computed values and contrast ratios. Not `useAppearance()`: under System the
 * choice stays `"system"` while the OS flips the page underneath it.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => currentTheme(), () => "dark");
}
