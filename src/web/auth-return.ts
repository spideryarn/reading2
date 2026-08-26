/**
 * Where the reader was going before they were asked to sign in.
 *
 * Not in the URL, which is where a first draft of this put it. `redirectTo` is
 * always the bare `/auth/callback` and never the current page, because every
 * spelling that carries the destination in the address is a spelling that can
 * carry our one-time `?code=` somewhere it should not go — see main.tsx.
 *
 * So the destination rides in `sessionStorage`, which is tab-scoped and dies
 * with the tab. Three rules, and all three are here rather than at the call
 * sites because the interesting failures are in the reading, not the writing.
 */

/** `sessionStorage` throws outright in some privacy modes. Never take the page down for this. */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const KEY = "spideryarn:auth-return";

/** A sign-in that started five minutes ago is not the one you are finishing. */
const TTL_MS = 10 * 60 * 1000;

/**
 * Is this somewhere on our own site that we are willing to send someone?
 *
 * **`new URL(value, origin).origin`, and never `value.startsWith("/")`.** The
 * `startsWith` version reads correctly and is an open redirect:
 * `//evil.example` starts with a slash and is a *protocol-relative URL*, so the
 * browser treats it as `https://evil.example`. GPT Sol, 2026-08-26.
 *
 * `/auth/callback` is refused as a destination too — landing back on the
 * callback is a loop, and a loop with a spent code in it.
 */
export function isSafeReturn(value: string, callbackPath: string): boolean {
  if (!value.startsWith("/")) return false;
  let url: URL;
  try {
    url = new URL(value, location.origin);
  } catch {
    return false;
  }
  if (url.origin !== location.origin) return false;
  return !new RegExp(`^${callbackPath}/?$`).test(url.pathname);
}

/** Remember where we were, on the way out to Google. */
export function rememberReturn(path: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ path, createdAt: Date.now() }));
  } catch {
    /* Quota, or a mode that allows reads and refuses writes. Losing the reader's
       place is a small cost; a thrown exception here would lose the sign-in. */
  }
}

/**
 * Where we were, and **forget it in the same breath**.
 *
 * Read-and-delete rather than read-then-maybe-delete: a value that survives a
 * failed sign-in is a value that redirects the *next* one somewhere stale, and
 * that is the whole of the hole this was reviewed for.
 */
export function takeReturn(callbackPath: string): string | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(KEY);
    store.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { path, createdAt } = JSON.parse(raw) as { path?: unknown; createdAt?: unknown };
    if (typeof path !== "string" || typeof createdAt !== "number") return null;
    if (Date.now() - createdAt > TTL_MS) return null;
    return isSafeReturn(path, callbackPath) ? path : null;
  } catch {
    return null;
  }
}
