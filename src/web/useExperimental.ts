/**
 * **The experimental-features switch**, fetched and saved.
 *
 * One boolean for the whole client: with it off, the reader sees the features
 * we think are worth their attention; with it on, they also see the ones still
 * being built. docs/project/experimental-features.md is the operating manual —
 * what belongs behind it, and the rule that a hidden feature stays reachable by
 * its URL.
 *
 * ## It rides on `/api/reader`, but it does not share a request
 *
 * The switch lives on the reader's row (`reader_profiles.experimental_since`),
 * so it comes back with the profile rather than from an endpoint of its own.
 * **That is not request sharing**, and an earlier version of this comment
 * claimed it was: `apiFetch` has an *offline* cache, not an in-flight memo, so a
 * second component calling this hook makes a second GET and keeps its own state
 * (GPT Sol, 2026-08-31). Harmless with one consumer. Before the first feature
 * actually goes behind the switch, the answer belongs in one shared place —
 * docs/project/experimental-features.md § Putting a feature behind it.
 *
 * ## A date in, a boolean out
 *
 * The wire carries `experimentalSince` — `null` for off, an ISO timestamp for
 * "on since then" — and this is the only place that turns it into the `on` that
 * gating code reads. The server never sends both, deliberately: a boolean
 * beside the date would be two spellings of one fact, and the one that drifted
 * would be the one a feature gate believed.
 *
 * **A response with no `experimentalSince` in it is an error, not an "off".**
 * `?? null` used to turn a `{}` — or the answer to somebody else's PATCH — into
 * a confident "off", which is the variable-shape defect the route is built to
 * avoid, wearing the client's clothes. Sol's review, 2026-08-31.
 *
 * ## Three states, not two: on, off, and we-do-not-know
 *
 * Everything here is arranged so the reader never presses a switch we have not
 * read:
 *
 *  - **Before the first answer**, `on` is `false` — nothing flashes into
 *    existence and out again — and the control is `disabled`. A default the
 *    reader can act on is a default they can silently *save*.
 *  - **A load that failed** stays disabled, and says so as a load failure, with
 *    a way to try again. It used to say "Not saved", which is a sentence about
 *    a save nobody attempted.
 *  - **An offline copy** shows what we last knew and stays disabled. `apiFetch`
 *    serves a saved body with `x-spideryarn-offline: copy` when the network is
 *    gone (lib/api.ts); treating that as current would let a reader turn "off"
 *    over an "on" another device set an hour ago.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, readJson } from "./lib/api.js";

/**
 * The one field of `/api/reader` this hook is about, **checked rather than
 * assumed**.
 *
 * `unknown` and a guard, not a cast: this is a boundary, and a cast here is a
 * promise about somebody else's JSON.
 */
function sinceIn(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("experimentalSince" in body)) {
    throw new Error("the server did not say whether experimental features are on");
  }
  const since = (body as { experimentalSince: unknown }).experimentalSince;
  if (since === null) return null;
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) {
    throw new Error("the server sent an experimental-features date we cannot read");
  }
  return since;
}

export interface ExperimentalSetting {
  /**
   * **Are experimental features on?** This is the value a feature gate reads:
   *
   * ```tsx
   * const { on } = useExperimental();
   * if (!on) return null;
   * ```
   */
  on: boolean;
  /** Since when, ISO 8601 — `null` when off, and when we have not asked yet. */
  since: string | null;
  /** Whether we have a current answer. Nothing may be toggled before we do. */
  loaded: boolean;
  /** True when what is shown came from the offline cache rather than the server. */
  stale: boolean;
  /** Turn it on or off. Optimistic, and reverted if the save fails. */
  set(next: boolean): void;
  saving: boolean;
  /**
   * Whether the last **save** failed, and with what — `null` when it was the
   * load that failed instead. The two say different things to a reader, and one
   * field for both said the wrong one. docs/reusable/silent-success.md.
   */
  error: string | null;
  /** Whether the **load** failed, and with what. */
  loadError: string | null;
  /** Ask again, after a failed or offline load. */
  reload(): void;
}

export function useExperimental(): ExperimentalSetting {
  const [since, setSince] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* Bumped by `reload`, and the effect's only dependency. */
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is not read in here — it IS the trigger. `reload` bumps it to run this effect again, which is the whole retry, and biome cannot see a dependency whose only job is to change.
  useEffect(() => {
    let live = true;
    setLoadError(null);
    apiFetch("/api/reader")
      .then(async (r) => {
        /* **Is this the network's answer, or a copy of one?** The header is how
           the cache says so without every call site having to know it exists
           (lib/api.ts). A copy is worth *showing* and must not be worth
           *writing over*. */
        const copy = r.headers.get("x-spideryarn-offline") === "copy";
        return { since: sinceIn(await readJson<unknown>(r)), copy };
      })
      .then(({ since: value, copy }) => {
        if (!live) return;
        setSince(value);
        setStale(copy);
        /* Not `loaded` for a copy: `loaded` is what enables the control, and
           this is the one state where what we are showing may already be
           wrong. */
        setLoaded(!copy);
      })
      /* Not `setLoaded(true)`: a fetch that failed has told us nothing, and
         enabling the switch on the strength of it would let the reader turn
         "off" back on top of an "on" we never read. */
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /* Which save is the newest, so an earlier one landing late cannot write its
     stale answer over it. With one write in flight at a time (below) this is
     the belt to that pair of braces — it is what keeps a `reload` or a remount
     mid-save from taking an old answer. */
  const generation = useRef(0);

  /* What is on screen right now, readable from inside `set`.
     **A ref rather than the closed-over state**, and not for tidiness: two
     clicks in one tick share a closure, so the second would restore the value
     from before the *first* if its save failed — putting the switch back two
     steps. `useProfile` keeps `latest` for the same reason. */
  const shown = useRef<string | null>(null);
  shown.current = since;

  /**
   * **One write at a time**, which is the fix for the sharpest finding in GPT
   * Sol's review of this file, 2026-08-31:
   *
   * > Click on: request A sends `true`. Click off: request B sends `false`. B
   * > reaches Postgres first and returns off. A reaches Postgres afterwards and
   * > stores on. A's response is ignored as the older generation. The UI remains
   * > off while the database is on.
   *
   * Ordering the *responses* cannot fix that: the damage is done on the server,
   * in whichever order the two requests arrive. So a second write is not started
   * while one is in flight. The checkbox is `disabled` while `saving` for the
   * same reason — and this ref is what makes it a guarantee rather than a UI
   * convention, since a keyboard, a label click and a test can all get past a
   * disabled attribute in ways nobody planned.
   */
  const busy = useRef(false);

  const set = useCallback((next: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const mine = ++generation.current;
    /* **Optimistic**, and the switch moves under the finger. The alternative —
       wait for the round trip — makes a one-bit control feel broken on a slow
       connection, and there is a real value to put back if it fails.

       The optimistic value for "on" is a *guess* at the date, replaced below by
       the server's, which is the one that says when the switch was actually
       first flipped. Nothing reads the date except the line under the switch,
       so a wrong one for one round trip costs nothing. */
    const optimistic = next ? new Date().toISOString() : null;
    const before = shown.current;
    setSince(optimistic);
    setSaving(true);
    setError(null);

    apiFetch("/api/reader", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimental: next }),
    })
      .then((r) => readJson<unknown>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        // The stored value, not the guess — and checked, not assumed.
        setSince(sinceIn(body));
        /* A successful write is a current answer, whatever the load was: this
           is the path that rescues a reader whose page loaded offline and then
           reconnected. */
        setLoaded(true);
        setStale(false);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        /* **Put it back.** A switch left showing what the reader asked for,
           when the server never got it, is the whole hazard: every gated
           feature then disagrees with the switch that claims to control them. */
        setSince(before);
        setError(e.message);
      })
      .finally(() => {
        busy.current = false;
        if (mine === generation.current) setSaving(false);
      });
    /* No dependencies, so the callback is stable for the life of the component:
       everything it reads that can change is read through a ref. */
  }, []);

  return { on: since !== null, since, loaded, stale, set, saving, error, loadError, reload };
}
