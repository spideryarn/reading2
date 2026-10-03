/**
 * Whether the copy of the app this browser is running has outlived a deploy —
 * and the reload that answers it.
 *
 * **A copy can be days old.** A laptop tab is reloaded all the time. The app
 * opened from an iPad's home-screen icon is not: iOS puts it to sleep and wakes
 * the same copy, we deploy several times a day, and each deploy removes the
 * hashed files the copy before it would ask for. So the first thing a
 * days-old copy fetches on demand — a lazy route's code — is not there, and
 * production answers a missing file with the shell's HTML and a 200
 * (`vercel.json`'s last rewrite), which a browser refuses as a module. Greg's
 * report, 2026-10-03 (spya-u6uba0), reproduced in WebKit and Chromium:
 * docs/plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md.
 *
 * The message that used to be the whole answer said *"reloading the page
 * usually fixes it"*, in the one place with no reload button and no address
 * bar. So when the server says a different build is live, this reloads rather
 * than asking the reader to.
 *
 * **The question is `/build.json`**, which every deploy publishes beside the
 * shell (`vite.config.ts` § `generateBundle`) from the very stamp that is
 * compiled into this bundle. No API call, nothing signed in, nothing a
 * function has to wake for.
 *
 * **A build is its commit *and* the moment it was built**, not the commit
 * alone. One commit can be deployed twice — the changelog's line 6 is one —
 * and the build time is compiled into the bundle, so the second build's hashed
 * files are different files: the same failure, from a server the commit calls
 * the same. And the test is *different*, not *newer*: a rollback strands a
 * copy exactly as a deploy does. GPT Sol's plan review, 2026-10-03.
 *
 * **At most one reload per live build**, remembered in `sessionStorage`. The
 * reload is only worth doing if it lands on the build the server named; if it
 * does not — the shell and `build.json` out of step, a stamp that lies — the
 * second failure finds its own note and the reader gets the message, not a
 * page that never stops blinking. The note is written *before* the reload, and
 * with nowhere to write it there is no reload at all.
 *
 * **Only for the page that failed.** The check takes a moment, and a reader
 * can leave the spinner in that moment; reloading whatever they went to
 * instead would be this app throwing away a page nobody had a problem with.
 * So the address is noted before asking and compared after. And the asking has
 * a deadline, because the loader is waiting on it: a request that never
 * settles would trade a message the reader can act on for a spinner they
 * cannot.
 *
 * Everything is passed in, so tests/stale-shell.test.ts drives the decision
 * with no browser.
 *
 * Shared: the next thing that fetches code on demand asks this rather than
 * growing its own — docs/project/web-client.md § Shared code (client).
 */
import { buildCommit, buildTime } from "./build-stamp.js";

/** The `sessionStorage` key holding the live build this session last reloaded for. */
export const RELOADED_FOR_KEY = "spy.reloaded-for-build";

/** How long `/build.json` gets. It is a static file of a few hundred bytes. */
const CHECK_TIMEOUT_MS = 4000;

const SHA = /^[0-9a-f]{40}$/;

/**
 * One build, said as a string two copies can compare: `<commit> <builtAt>`.
 * `null` for a stamp that is not one — no commit, a commit that is not a sha,
 * a time that is not a time.
 */
export function buildIdentity(commit: unknown, builtAt: unknown): string | null {
  if (typeof commit !== "string" || !SHA.test(commit)) return null;
  if (typeof builtAt !== "string" || Number.isNaN(Date.parse(builtAt))) return null;
  return `${commit} ${builtAt}`;
}

export interface StaleShellDeps {
  /** The build this copy is; `null` off a build (dev, tests). */
  mine: string | null;
  fetch: typeof fetch;
  /** `null` where the browser refuses even the accessor. */
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
  /** The address the reader is at, read before the check and again after. */
  address: () => string;
  timeoutMs: number;
}

/**
 * The build the server is serving now, or `null` for anything short of a clear
 * answer in time — including the shell's own HTML, which is what a deploy
 * without the file would send back.
 *
 * Never throws and never hangs: a check that could itself fail loudly, or
 * wait for ever, would replace the reader's one error with a worse one.
 */
export async function serverBuild(
  fetchFn: typeof fetch,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<string | null> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /* Raced as well as aborted: the abort is a courtesy to the network, the race
     is the deadline. A `fetch` that ignores its signal still loses. */
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve(null);
    }, timeoutMs);
  });
  const asked = (async () => {
    try {
      /* `no-store`: the answer is only worth having if it is the server's, and
         the file is tiny. A cached copy is this very bug one level down. */
      const res = await fetchFn("/build.json", {
        cache: "no-store",
        credentials: "omit",
        signal: abort.signal,
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (typeof body !== "object" || body === null) return null;
      const stamp = body as { commit?: unknown; builtAt?: unknown };
      return buildIdentity(stamp.commit, stamp.builtAt);
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([asked, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function browserDeps(): StaleShellDeps {
  let storage: StaleShellDeps["storage"] = null;
  try {
    /* The accessor itself throws where storage is blocked. */
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return {
    mine: buildIdentity(buildCommit(), buildTime()),
    fetch: (input, init) => fetch(input, init),
    storage,
    reload: reloadPage,
    address: () => window.location.href,
    timeoutMs: CHECK_TIMEOUT_MS,
  };
}

/**
 * Request a reload if a different build is live, this session has not already
 * reloaded for it, and the reader is still where the failure happened. `true`
 * means the reload call returned without throwing; the caller still needs a
 * fallback because browsers do not acknowledge that navigation began.
 */
export async function reloadIfStale(deps: StaleShellDeps = browserDeps()): Promise<boolean> {
  const { mine, storage } = deps;
  if (mine === null || storage === null) return false;

  const failedAt = deps.address();
  const theirs = await serverBuild(deps.fetch, deps.timeoutMs);
  if (theirs === null || theirs === mine) return false;
  /* Before the note is written, not only before the reload: a note left for a
     page the reader walked away from would spend the one reload on nothing. */
  if (deps.address() !== failedAt) return false;

  try {
    if (storage.getItem(RELOADED_FOR_KEY) === theirs) return false;
    storage.setItem(RELOADED_FOR_KEY, theirs);
    /* Read back: a store that accepts a write and keeps nothing is no guard. */
    if (storage.getItem(RELOADED_FOR_KEY) !== theirs) return false;
  } catch {
    return false;
  }

  deps.reload();
  return true;
}

/** The reload itself, named so the escape's button and the check share one. */
export function reloadPage(): void {
  window.location.reload();
}
