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
 * with nowhere to write it there is no reload at all. **The note is every
 * build this session has reloaded for, not the last one**: holding only the
 * last, a shell stuck on one build under a `build.json` that alternated
 * between two others reloaded every time (`claimReload`).
 *
 * ## Two askers, one note
 *
 * - **`reloadIfStale`** — code fetched on demand did not arrive. It asks
 *   because something has already failed. LazyPage.tsx.
 * - **The watcher, `watchForDeploy`** — nothing has failed. It asks when the
 *   page wakes and every fifteen minutes while it is being looked at, and only
 *   records the answer. It reloads nothing itself: an unasked reload under an
 *   article somebody is reading is not something anyone asked for. The one
 *   page that acts on it is `/changelog`, through `reloadForNewBuild`, and only
 *   when nothing unsent would be lost (safe-to-reload.ts).
 *   docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md.
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
import { noteNoConnection, noteReachedServer } from "./offline.js";
import { safeToReload } from "./safe-to-reload.js";

/**
 * The `sessionStorage` key holding every build this session has reloaded for,
 * as a JSON array of identities. Until 2026-10-05 it held one bare identity;
 * `reloadedFor` still reads that.
 */
export const RELOADED_FOR_KEY = "spy.reloaded-for-build";

/** How long `/build.json` gets. It is a static file of a few hundred bytes. */
const CHECK_TIMEOUT_MS = 4000;

/** Keep failed content out of reach while the requested reload starts. */
export const RELOAD_GRACE_MS = 5000;

/**
 * How often the watcher asks while the page is visible. Greg, 2026-10-04
 * (spya-ym9dum): *"poll every 15 minutes or so"*. Approximate by nature: iOS
 * suspends a sleeping app's timers, which is why waking asks as well.
 */
export const CHECK_EVERY_MS = 15 * 60_000;

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
  /** Whether a reload now would lose nothing the reader has not sent — safe-to-reload.ts. */
  safe: () => boolean;
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

/** `sessionStorage`, or `null` where the browser refuses even the accessor. */
export function sessionNote(): StaleShellDeps["storage"] {
  try {
    /* The accessor itself throws where storage is blocked. */
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserDeps(): StaleShellDeps {
  return {
    mine: buildIdentity(buildCommit(), buildTime()),
    fetch: (input, init) => fetch(input, init),
    storage: sessionNote(),
    reload: reloadPage,
    address: () => window.location.href,
    safe: safeToReload,
    timeoutMs: CHECK_TIMEOUT_MS,
  };
}

/**
 * The builds this session has already reloaded for, oldest first. Empty for
 * no store, no note, or a note that cannot be read.
 *
 * **A note that is not a list is read as a list of one.** That is what a copy
 * from before 2026-10-05 wrote, and a session can straddle the change: the old
 * copy writes its bare identity and reloads, and this one reads it. Ignoring
 * it would allow that session a second reload for the same build.
 */
export function reloadedFor(storage: StaleShellDeps["storage"]): string[] {
  if (storage === null) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(RELOADED_FOR_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((b): b is string => typeof b === "string");
  } catch {
    /* Not JSON: the old, bare form. */
  }
  return [raw];
}

/**
 * Take this session's one reload for `build`: `true` only if it had not been
 * taken and the note now says it has.
 *
 * The whole loop guard, and shared by both things that reload, so a build
 * either of them reloaded for is never reloaded for again by the other. The
 * list is not trimmed: an identity is 65 characters, a session sees a handful,
 * and forgetting the oldest is how the alternating case came back.
 */
export function claimReload(storage: StaleShellDeps["storage"], build: string): boolean {
  if (storage === null) return false;
  try {
    const already = reloadedFor(storage);
    if (already.includes(build)) return false;
    storage.setItem(RELOADED_FOR_KEY, JSON.stringify([...already, build]));
    /* Read back: a store that accepts a write and keeps nothing is no guard. */
    return reloadedFor(storage).includes(build);
  } catch {
    return false;
  }
}

/**
 * Request a reload if a different build is live, this session has not already
 * reloaded for it, and the reader is still where the failure happened. `true`
 * means the reload call returned without throwing; the caller still needs a
 * fallback because browsers do not acknowledge that navigation began.
 */
export async function reloadIfStale(
  deps: StaleShellDeps = browserDeps(),
  /** A caller's load can be replaced without the address changing. */
  signal?: AbortSignal,
): Promise<boolean> {
  const { mine, storage } = deps;
  if (signal?.aborted || mine === null || storage === null) return false;

  const failedAt = deps.address();
  const theirs = await serverBuild(deps.fetch, deps.timeoutMs);
  if (theirs === null || theirs === mine) return false;
  /* Before the note is written, not only before the reload: a note left for a
     page the reader walked away from would spend the one reload on nothing. */
  if (signal?.aborted || deps.address() !== failedAt) return false;
  /* The page that failed has nothing to lose, but the app around it may: Chat
     words on an article, a Feedback draft, an upload. Then the reader gets the
     message and its Reload button instead, and the one reload is not spent. */
  if (!deps.safe()) return false;

  if (!claimReload(storage, theirs)) return false;

  deps.reload();
  return true;
}

/** The reload itself, named so the escape's button and the check share one. */
export function reloadPage(): void {
  window.location.reload();
}

/* ------------------------------------------------------------------------ *
 * The watcher
 * ------------------------------------------------------------------------ */

export interface DeployWatchDeps {
  /**
   * A production build, which is not the same as "has a stamp": the dev server
   * defines the stamp too, and has no `/build.json` to compare it with.
   */
  production: boolean;
  /** The build this copy is. */
  mine: string | null;
  fetch: typeof fetch;
  timeoutMs: number;
  /** The gap between checks while visible. */
  everyMs: number;
  visible: () => boolean;
  /**
   * Call `wake` whenever the page may have come back: `visibilitychange`, and
   * `pageshow` for one restored from the back-forward cache. Neither means
   * "visible" — `wake` asks. Returns the way to stop listening.
   */
  onWake: (wake: () => void) => () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
}

export interface DeployWatch {
  /** The different build last seen live, or `null` — none seen, or the server is back on this one. */
  seen(): string | null;
  /**
   * Hear the answer: **once now, with whatever is already known**, and again
   * after every check that got one — the same answer included, which is what
   * lets a listener that had to refuse try again. Returns the way to stop.
   */
  subscribe(listener: (build: string | null) => void): () => void;
  /** Begin watching. Once: a second call changes nothing. Returns the way to stop. */
  start(deps: DeployWatchDeps): () => void;
}

/**
 * A watcher that is not yet watching. `subscribe` and `seen` work from the
 * start, so a page can listen whether or not anything was ever installed —
 * which, off a production build, nothing is.
 */
export function createDeployWatch(): DeployWatch {
  let seen: string | null = null;
  const listeners = new Set<(build: string | null) => void>();
  let stop: (() => void) | null = null;

  const tell = (listener: (build: string | null) => void): void => {
    try {
      listener(seen);
    } catch {
      /* One listener's fault must not end the watching for the others. */
    }
  };

  return {
    seen: () => seen,

    subscribe(listener) {
      listeners.add(listener);
      tell(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start(deps) {
      if (stop !== null) return stop;
      const { mine } = deps;
      if (!deps.production || mine === null) {
        stop = () => {};
        return stop;
      }

      let asking = false;
      let timer: unknown;
      let stopped = false;

      const disarm = (): void => {
        if (timer === undefined) return;
        deps.clearTimer(timer);
        timer = undefined;
      };

      const check = async (): Promise<void> => {
        /* Every way in passes this line: install, wake, and the timer. */
        if (stopped || asking || !deps.visible()) return;
        asking = true;
        disarm();
        const theirs = await serverBuild(deps.fetch, deps.timeoutMs);
        asking = false;
        if (stopped) return;
        /* `null` is "could not ask", and changes nothing that was known. */
        if (theirs !== null) {
          /* *Different*, and it can stop being: a rollback to this build. */
          seen = theirs === mine ? null : theirs;
          for (const listener of [...listeners]) tell(listener);
        }
        /* Armed after the answer rather than on an interval, so a slow check
           cannot stack a second behind it — and after a failed one too. Not
           while hidden: waking asks, and that arms the next. And it goes on
           after a mismatch: a reload can land on this same shell again, and a
           later deploy still has to be noticed. */
        if (deps.visible()) timer = deps.setTimer(() => void check(), deps.everyMs);
      };

      const unlisten = deps.onWake(() => {
        if (deps.visible()) void check();
        else disarm();
      });
      void check();

      stop = () => {
        stopped = true;
        disarm();
        unlisten();
      };
      return stop;
    },
  };
}

function browserWatchDeps(): DeployWatchDeps {
  return {
    production: import.meta.env.PROD,
    mine: buildIdentity(buildCommit(), buildTime()),
    fetch: async (input, init) => {
      try {
        const response = await fetch(input, init);
        noteReachedServer();
        return response;
      } catch (error) {
        /* A deadline abort is not evidence that the network is gone. A
           transport failure is, and an old noticed build may still be read
           by a page that subscribes after this failed check. */
        if (!init?.signal?.aborted) noteNoConnection();
        throw error;
      }
    },
    timeoutMs: CHECK_TIMEOUT_MS,
    everyMs: CHECK_EVERY_MS,
    visible: () => document.visibilityState === "visible",
    onWake(wake) {
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("pageshow", wake);
      return () => {
        document.removeEventListener("visibilitychange", wake);
        window.removeEventListener("pageshow", wake);
      };
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

/** The page's one watcher. */
const deployWatch = createDeployWatch();

/** Start watching for a deploy. Called once, from main.tsx. */
export function watchForDeploy(deps: DeployWatchDeps = browserWatchDeps()): () => void {
  return deployWatch.start(deps);
}

/** The different build the watcher last saw live, or `null`. */
export function differentBuildLive(): string | null {
  return deployWatch.seen();
}

/** `DeployWatch.subscribe`, on the page's one watcher. */
export function onDeployNoticed(listener: (build: string | null) => void): () => void {
  return deployWatch.subscribe(listener);
}

/* ------------------------------------------------------------------------ *
 * A page that reloads itself for a new build
 * ------------------------------------------------------------------------ */

export interface ReloadForNewBuildDeps {
  visible: () => boolean;
  /** The reader is still on the page that asked for this. */
  onPage: () => boolean;
  /** Nothing unsent would be lost — safe-to-reload.ts § `safeToReload`. */
  safe: () => boolean;
  storage: StaleShellDeps["storage"];
  reload: () => void;
}

/**
 * Reload for `build` if the page is being looked at, the reader is still on
 * it, nothing would be lost, and this session has not reloaded for that build
 * before. `true` means the reload was asked for.
 *
 * Called each time the watcher speaks, so a refusal is not final: it is asked
 * again at the next check, which is fifteen minutes or the next wake away, not
 * in a loop. **The note is taken last**, after every refusal, so a reload that
 * was refused has not spent the one this build gets.
 */
export function reloadForNewBuild(build: string | null, deps: ReloadForNewBuildDeps): boolean {
  if (build === null) return false;
  if (!deps.visible() || !deps.onPage() || !deps.safe()) return false;
  if (!claimReload(deps.storage, build)) return false;
  deps.reload();
  return true;
}
