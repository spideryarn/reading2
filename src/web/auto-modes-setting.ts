/**
 * **Whether an import generates the main modes** — the reader's setting, as
 * the add page's tick box reads and writes it.
 *
 * `GET /api/reader` answers `autoModes`, `PATCH /api/reader { autoModes }`
 * writes it, and the server reads the same row when an import publishes
 * (src/store/pg-revisions.ts § `publishRevisionIn`). The page queues nothing:
 * the box is only a setting, so it can be changed until the import finishes.
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
 * Sol, F3 of the plan review). Until then the box shows the stored "off".
 *
 * What this cannot cover: a tab still running the old client sends nothing, and
 * a hand-over that keeps failing leaves the server at its default, on. The
 * server cannot see a browser's storage.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

function save(on: boolean, signal?: AbortSignal): Promise<boolean> {
  return apiFetch("/api/reader", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoModes: on }),
    ...(signal ? { signal } : {}),
  })
    .then((r) => readJson<unknown>(r))
    .then(autoModesIn);
}

/**
 * The hand-over in flight, if there is one — so the box's first read waits for
 * it rather than racing it and showing "on" a moment before the server is told
 * "off".
 */
let handingOver: Promise<void> = Promise.resolve();

/**
 * **Carry an old "off" from this browser to the reader's row**, once.
 *
 * `signal` binds the request to the session that started it: `apiFetch`
 * retries a 401 with whichever session is current by then, and an abort is the
 * only thing that stops that (experimental-store.ts § `abortInFlight`).
 * Never rejects; a failure leaves the key for the next start.
 */
export function handOverAutoModesChoice(signal: AbortSignal): Promise<void> {
  if (!legacyChoiceIsOff()) return Promise.resolve();
  const sent = save(false, signal).then(
    () => forgetLegacyChoice(),
    () => {
      /* Not answered, or refused: the key stays, and so does the choice. */
    },
  );
  handingOver = sent;
  return sent;
}

export interface AutoModesSetting {
  /** What the box shows. On until the server, or this browser's old key, says otherwise. */
  on: boolean;
  /** Change it. Optimistic; put back, with `error` set, if the save fails. */
  set(next: boolean): void;
  /** Whether the last save failed. Cleared by the next change. */
  error: boolean;
}

/**
 * The setting, for the add page's box.
 *
 * Writes go out one after another in the order they were made: two requests
 * in flight together can reach the database in either order, and the later
 * press must be the one that stays. A write is not cancelled when the page
 * unmounts — the page leaves the moment an import finishes, and a choice made
 * a second earlier still counts.
 */
export function useAutoModesSetting(): AutoModesSetting {
  const [on, setOn] = useState(() => !legacyChoiceIsOff());
  const [error, setError] = useState(false);
  /* Once the reader has pressed, the opening read no longer gets a say. */
  const touched = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const stop = new AbortController();
    void handingOver
      .then(() => apiFetch("/api/reader", { signal: stop.signal }))
      .then((r) => readJson<unknown>(r))
      .then((body) => {
        if (stop.signal.aborted || touched.current) return;
        /* An "off" this browser has not managed to hand over still shows. */
        setOn(autoModesIn(body) && !legacyChoiceIsOff());
      })
      .catch(() => {
        /* The box keeps its default. The server's row is what an import
           reads, and the next press writes it. */
      });
    return () => {
      mounted.current = false;
      stop.abort();
    };
  }, []);

  const set = useCallback((next: boolean): void => {
    touched.current = true;
    const mine = ++latest.current;
    setOn(next);
    setError(false);
    writes.current = writes.current.then(() =>
      save(next).then(
        () => {
          /* The server now holds a choice made here, so the old key has
             nothing left to say. */
          forgetLegacyChoice();
        },
        () => {
          if (!mounted.current || mine !== latest.current) return;
          setOn(!next);
          setError(true);
        },
      ),
    );
  }, []);

  return { on, set, error };
}

/** For a test: forget a hand-over left in flight by the last case. */
export function resetAutoModesSettingForTests(): void {
  handingOver = Promise.resolve();
}
