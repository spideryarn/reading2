/**
 * **Whom this tab is viewing as, and until when — as the server says.**
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, Client 4, and round 1 F1 / F5.
 *
 * One small store, read by the bar (ViewAsBar.tsx) for its minutes and by the
 * two places the app names the signed-in reader (the shelf's *Signed in as*,
 * the metadata page's sharing section), which name the subject instead. The
 * minutes come from the server's `expiresAt` and nothing else: the session is
 * thirty minutes, absolute, never extended, and the client's clock only counts
 * down to the server's moment.
 *
 * In an ordinary tab nothing here runs: `startViewAsSession` returns at once
 * and `useViewAsSubject` answers `null`.
 */
import { useSyncExternalStore } from "react";

import { apiFetch, readJson } from "./lib/api.js";
import { endViewAsTab, viewAsNonce } from "./lib/view-as.js";

/** The reader being viewed. */
export interface ViewAsSubject {
  readonly subjectId: string;
  readonly subjectEmail: string | null;
  /** Epoch milliseconds, from the server's ISO `expiresAt`. */
  readonly expiresAt: number;
}

export type ViewAsState =
  /** Not a view-as tab. */
  | { readonly kind: "off" }
  /** The first `/current` is out. */
  | { readonly kind: "loading" }
  | { readonly kind: "live"; readonly subject: ViewAsSubject }
  /** `/current` failed before ever answering. Subject pages stay gated behind the bar. */
  | { readonly kind: "failed"; readonly message: string };

/** How often the bar asks again. The plan's "every minute". */
const VIEW_AS_REREAD_MS = 60_000;

let state: ViewAsState = viewAsNonce() === null ? { kind: "off" } : { kind: "loading" };
const listeners = new Set<() => void>();

function set(next: ViewAsState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function viewAsState(): ViewAsState {
  return state;
}

/** The store, for the bar. */
export function useViewAsState(): ViewAsState {
  return useSyncExternalStore(subscribe, viewAsState, viewAsState);
}

/** The subject, once the server has said; `null` in an ordinary tab or before. */
export function useViewAsSubject(): ViewAsSubject | null {
  const now = useViewAsState();
  return now.kind === "live" ? now.subject : null;
}

/** The body `/current` and start answer with, checked rather than trusted. */
function subjectFrom(body: unknown): ViewAsSubject | null {
  if (typeof body !== "object" || body === null) return null;
  const { subjectId, subjectEmail, expiresAt } = body as Record<string, unknown>;
  if (typeof subjectId !== "string" || subjectId === "") return null;
  if (subjectEmail !== null && typeof subjectEmail !== "string") return null;
  if (typeof expiresAt !== "string") return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  return { subjectId, subjectEmail, expiresAt: at };
}

/**
 * **Ask the server once.** A 410 `[view-as-ended]` never comes back here as an
 * answer: `apiFetch` has already ended the tab on hearing it (lib/api.ts §
 * `watchForViewAsEnd`). Any other failure leaves an already-authorised subject
 * on screen until the next minute asks again. Before the first answer, App
 * keeps subject pages unmounted and the bar says what went wrong.
 */
async function readViewAsCurrent(): Promise<void> {
  if (viewAsNonce() === null) return;
  try {
    const body = await readJson<unknown>(await apiFetch("/api/admin/view-as/current"));
    const subject = subjectFrom(body);
    if (subject === null) throw new Error("The server's answer about this view was not one this page understands.");
    if (subject.expiresAt <= Date.now()) {
      endViewAsTab();
      return;
    }
    set({ kind: "live", subject });
  } catch (e) {
    if (state.kind === "live") return;
    set({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * **Read now, again every minute, and leave at `expiresAt`.** Called by the bar
 * on mount; the returned function stops all of it. A timer per answer for the
 * expiry, so a minute's re-read cannot leave the subject on screen up to a
 * minute past the end.
 */
export function startViewAsSession(): () => void {
  if (viewAsNonce() === null) return () => {};
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const armExpiry = () => {
    clearTimeout(expiry);
    if (state.kind !== "live") return;
    const left = state.subject.expiresAt - Date.now();
    expiry = setTimeout(endViewAsTab, Math.max(0, left));
  };
  const unsubscribe = subscribe(armExpiry);
  void readViewAsCurrent();
  const again = setInterval(() => void readViewAsCurrent(), VIEW_AS_REREAD_MS);
  return () => {
    unsubscribe();
    clearInterval(again);
    clearTimeout(expiry);
  };
}

/** For tests only: put the store back as a fresh page would have it. */
export function resetViewAsSessionForTests(): void {
  state = viewAsNonce() === null ? { kind: "off" } : { kind: "loading" };
  listeners.clear();
}
