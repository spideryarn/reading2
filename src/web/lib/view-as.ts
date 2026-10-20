/**
 * **Is this tab viewing the app as another reader**, and the way out of it.
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, built: view as — and its two "What … changed" sections, which win.
 *
 * An administrator presses *View as* on /admin/users or /admin/articles; the
 * server mints a nonce, and a new tab opens at `/#view-as=<nonce>`. The inline
 * script `view-as-boot` in index.html runs before anything else on that page:
 * it takes the nonce out of the address, swaps both browser stores for empty
 * in-memory ones (Supabase's session key alone passes through), and records the
 * nonce on `window.__spideryarnViewAs`, frozen and not reconfigurable. **This
 * file is the only reader of that mark.**
 *
 * Why the window and not the in-memory `sessionStorage`: a module that clears
 * its storage (sign-out tidying, a test helper copied into the app) would
 * otherwise drop the nonce mid-view, and every request after that would go out
 * as the administrator *themselves*, writes included, from a tab drawing the
 * subject's articles. A frozen, non-configurable property cannot be cleared by
 * anything short of a reload, and a reload ends the view by design (Sol round
 * 1, F1). The nonce never touches the real storage either way.
 *
 * **Imports nothing**, so the earliest module, the request layer and the
 * fleet-shared dictation hook can all ask without pulling the app in.
 */

/** The mark the inline script in index.html leaves. Nothing else may write it. */
const VIEW_AS_GLOBAL = "__spideryarnViewAs";

/** The request header the server reads (src/routes.ts § the view-as gate). */
export const VIEW_AS_HEADER = "X-Spideryarn-View-As";

/**
 * **The server's own sentence for a refused request**, said by the client too
 * when it refuses a write before sending it — so a panel reads the same words
 * whichever side said no. Kept identical to the server's; the bracketed code is
 * what a test pins (docs/project/copy.md).
 */
export const VIEW_AS_READ_ONLY =
  "Hidden while viewing as another reader: this would change something or cost something. [view-as-read-only]";

/** The code a 410 carries when the view has ended (expired, stopped, or not this admin's). */
export const VIEW_AS_ENDED_CODE = "[view-as-ended]";

/** A nonce as the server mints them: 32 random bytes, base64url, no padding. */
const NONCE = /^[A-Za-z0-9_-]{43}$/;

/** Whether a string is shaped like a view-as nonce. The inline script carries the same test. */
export function isViewAsNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE.test(value);
}

/**
 * **The nonce, or `null` in an ordinary tab.** Constant for the life of the
 * page: the mark is written before any module runs and cannot be changed, so a
 * component may branch on it at render without the branch ever flipping.
 */
export function viewAsNonce(): string | null {
  if (typeof window === "undefined") return null;
  const mark = (window as unknown as Record<string, unknown>)[VIEW_AS_GLOBAL];
  if (typeof mark !== "object" || mark === null) return null;
  const nonce = (mark as { nonce?: unknown }).nonce;
  return isViewAsNonce(nonce) ? nonce : null;
}

/* ------------------------------------------------------------------------- *
 *  Leaving
 * ------------------------------------------------------------------------- */

/**
 * **How the tab goes away**, as an object so a test can stand in for the two
 * browser calls jsdom will not let it spy on.
 */
export const tabExit = {
  close: (): void => window.close(),
  replace: (href: string): void => window.location.replace(href),
};

let ended = false;
const listeners = new Set<() => void>();

/** Has this tab's view ended? The bar reads it to stop drawing the subject's minutes. */
export function viewAsEnded(): boolean {
  return ended;
}

/** Hear the end, once. Returns the unsubscribe. */
export function onViewAsEnd(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * **End the view in this tab: close it, or failing that leave for the
 * administrator's own shelf.** Plan § round 1, F5: after Stop succeeds (2xx or
 * 410), at `expiresAt`, and on any 410 `[view-as-ended]` from the server.
 *
 * `window.close()` is refused for a tab the browser does not consider
 * script-opened; `location.replace("/")` is the fallback, and it is enough on
 * its own — the nonce lives only in this page's memory, so the next page is an
 * ordinary tab of the administrator's, with nothing of the subject's in it.
 * `replace`, so Back does not return to the subject's page. Idempotent.
 */
export function endViewAsTab(): void {
  if (ended) return;
  ended = true;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* A listener's failure must not keep the subject's page on screen. */
    }
  }
  try {
    tabExit.close();
  } catch {
    /* Refused or unavailable: the replace below is the way out. */
  }
  /* A closed tab never runs this; one the browser kept open does. Not
     synchronous, because some browsers close a tab only after the script that
     asked returns. */
  fallback = setTimeout(() => tabExit.replace("/"), 50);
}

let fallback: ReturnType<typeof setTimeout> | undefined;

/* `replace("/")` removes only the newest history entry. If Back restores an
   older entry for this same Document from bfcache, its frozen nonce and React
   tree return too. Hide the document as it leaves so a cached snapshot cannot
   flash subject data, then leave on every persisted restore — including one
   restored after expiry while its timers were suspended. */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (viewAsNonce() !== null) document.documentElement.style.visibility = "hidden";
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && viewAsNonce() !== null) tabExit.replace("/");
  });
}

/** For tests only: forget that the view ended, its pending fallback, and every listener. */
export function resetViewAsEndForTests(): void {
  clearTimeout(fallback);
  fallback = undefined;
  ended = false;
  listeners.clear();
  if (typeof document !== "undefined") document.documentElement.style.removeProperty("visibility");
}
