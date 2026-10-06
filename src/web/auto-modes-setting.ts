/**
 * **Whether an import generates the main modes** — the reader's setting, as
 * the add page's tick box reads and writes it.
 *
 * `GET /api/reader` answers `autoModes`, `PATCH /api/reader { autoModes }`
 * writes it, and the server reads the same row when an import publishes
 * (src/store/pg-revisions.ts § `publishRevisionIn`). The page queues nothing:
 * publication reads the last committed choice, which can lag a pending press.
 * docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md.
 *
 * ## The choice used to live in this browser
 *
 * Until that plan the box was a `localStorage` key and the page did the
 * queueing. A browser whose stored choice is `"off"` hands it to the server
 * once, when the signed-in app starts (`handOverAutoModesChoice`, called from
 * `useJobSession`) — not only on the add page, because adding from a link's
 * hover card never visits it. **The key is forgotten only after the server has
 * answered**, so a request that failed is tried again on the next start (GPT
 * Sol, F3 of the plan review). A failed hand-over reports the failure and
 * reads the server setting; the key remains for another attempt.
 *
 * What this cannot cover: a tab still running the old client sends nothing, and
 * a hand-over that keeps failing leaves the server at its default, on. The
 * server cannot see a browser's storage.
 */
import { useEffect, useSyncExternalStore } from "react";

import { apiFetch, readJson } from "./lib/api.js";

/** The key the choice lived under: `"off"` when the box was unticked. */
export const LEGACY_AUTO_MODES_KEY = "spideryarn.add.generate-main-modes";

/* Wrapped for the reasons shelf-hidden-columns.ts gives: a private window
   throws, and under jsdom `localStorage` can read `undefined`. */
function legacyChoiceIsOff(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_AUTO_MODES_KEY) === "off";
  } catch {
    return false;
  }
}

function forgetLegacyChoice(): void {
  try {
    window.localStorage.removeItem(LEGACY_AUTO_MODES_KEY);
  } catch {
    /* Nothing to forget in a browser that would not let us read it. */
  }
}

/** The one field of `/api/reader` this file is about, checked rather than assumed. */
function autoModesIn(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("autoModes" in body)) {
    throw new Error("the server did not say whether the main modes are generated");
  }
  const on = (body as { autoModes: unknown }).autoModes;
  if (typeof on !== "boolean") throw new Error("the server sent an autoModes we cannot read");
  return on;
}

function save(on: boolean, session: Session): Promise<boolean> {
  return apiFetch(
    "/api/reader",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoModes: on }),
      signal: session.signal,
    },
    session.reader,
  )
    .then((r) => readJson<unknown>(r))
    .then(autoModesIn);
}

/**
 * **Whose setting this is, with the signal that ends their session.** The
 * signal stops a request once the reader has gone, but it is aborted from an
 * effect, and a write queued behind another can be sent after the session has
 * already become somebody else's. So each request also names its reader, and
 * is not sent as anybody else (`NotThisReader` in lib/api.ts;
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md
 * § 2). `reader` is `null` before `useJobSession` has bound one, and in a
 * test.
 */
interface Session {
  signal: AbortSignal;
  reader: string | null;
}

/**
 * One queue and snapshot per signed-in session, shared across page mounts and
 * the legacy hand-over. Navigation leaves the queue alive; sign-out aborts it.
 * `useJobSession` supplies the signal even when there is no legacy choice.
 */
let sessionSignal = new AbortController().signal;
let sessionReader: string | null = null;
let epoch = 0;
let writes: Promise<void> = Promise.resolve();
let latest = 0;
let readVersion = 0;
let pending = 0;
let confirmed: boolean | undefined;
const listeners = new Set<() => void>();

export interface AutoModesSetting {
  on: boolean;
  set(next: boolean): void;
  error: boolean;
  /** The current saved choice could not be read. */
  loadError: boolean;
  /** A press is still being saved; publication reads the committed choice. */
  saving: boolean;
}

let state: AutoModesSetting = { on: true, set, error: false, loadError: false, saving: false };
function put(fields: Partial<Omit<AutoModesSetting, "set">>): void {
  state = { ...state, ...fields };
  for (const listener of listeners) listener();
}

function live(mine: number): boolean {
  return mine === epoch && !sessionSignal.aborted;
}

function read(session: Session): Promise<boolean> {
  return apiFetch("/api/reader", { signal: session.signal }, session.reader)
    .then(readJson<unknown>)
    .then(autoModesIn);
}

/** A read cannot replace a choice pressed while that read was in flight. */
function load(): void {
  if (sessionSignal.aborted) return;
  const mine = epoch;
  const version = latest;
  const ticket = ++readVersion;
  const session: Session = { signal: sessionSignal, reader: sessionReader };
  void writes.then(async () => {
    if (!live(mine)) return;
    try {
      const on = await read(session);
      if (!live(mine) || latest !== version || ticket !== readVersion || pending) return;
      confirmed = on;
      put({ on, loadError: false });
    } catch {
      if (live(mine) && latest === version && ticket === readVersion) put({ loadError: true });
    }
  });
}

/**
 * Serialized with every other write for this reader, including the hand-over.
 * Replies confirm server state even if a later press is already displayed.
 */
function write(next: boolean): Promise<void> {
  const mine = epoch;
  const version = ++latest;
  const session: Session = { signal: sessionSignal, reader: sessionReader };
  pending++;
  put({ on: next, error: false, saving: true });
  writes = writes.then(async () => {
    if (!live(mine)) return;
    try {
      const on = await save(next, session);
      if (!live(mine)) return;
      confirmed = on;
      forgetLegacyChoice();
      if (version === latest) put({ on, error: false, loadError: false });
    } catch {
      if (!live(mine)) return;
      if (version === latest) {
        await recoverChoice(mine, version, session);
      }
    } finally {
      if (live(mine)) {
        pending--;
        put({ saving: pending > 0 });
      }
    }
  });
  return writes;
}

/** A rejected response can follow a committed PATCH; reconcile with the row. */
async function recoverChoice(mine: number, version: number, session: Session): Promise<void> {
  try {
    const on = await read(session);
    if (live(mine)) confirmed = on;
  } catch {
    // Retain the last confirmed answer if the read failed too, never !next.
  }
  if (live(mine) && version === latest) put({ on: confirmed ?? state.on, error: true });
}

function set(next: boolean): void {
  if (!sessionSignal.aborted) void write(next);
}

/**
 * Bind all setting work to this reader, and carry an old browser "off" once.
 * A failed hand-over retains the key, reports the failure, and reads the actual
 * server choice. A successful explicit press also retires the old key.
 */
export function handOverAutoModesChoice(
  signal: AbortSignal,
  reader: string | null = null,
): Promise<void> {
  if (sessionSignal !== signal) {
    epoch++;
    sessionSignal = signal;
    sessionReader = reader;
    writes = Promise.resolve();
    latest = 0;
    pending = 0;
    confirmed = undefined;
    put({ on: !legacyChoiceIsOff(), error: false, loadError: false, saving: false });
  }
  const handed = !signal.aborted && legacyChoiceIsOff() ? write(false) : Promise.resolve();
  // Child effects can subscribe before App's session effect binds this signal.
  if (listeners.size) load();
  return handed;
}

/** Page mounts subscribe; they do not own the requests or their ordering. */
export function useAutoModesSetting(): AutoModesSetting {
  const setting = useSyncExternalStore(subscribe, () => state);
  useEffect(load, []);
  return setting;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For isolated component tests: begin a fresh session and snapshot. */
export function resetAutoModesSettingForTests(): void {
  epoch++;
  sessionSignal = new AbortController().signal;
  sessionReader = null;
  writes = Promise.resolve();
  latest = 0;
  pending = 0;
  confirmed = undefined;
  put({ on: !legacyChoiceIsOff(), error: false, loadError: false, saving: false });
}
