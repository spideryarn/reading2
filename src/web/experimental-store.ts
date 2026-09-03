/**
 * **The experimental-features switch**, in one place for the whole client.
 *
 * One boolean: with it off, the reader sees the features we think are worth
 * their attention; with it on, they also see the ones still being built.
 * docs/project/experimental-features.md is the operating manual — what belongs
 * behind it, and the rule that a hidden feature stays reachable by its URL.
 *
 * ## Why a module-level store, and not a hook or a context
 *
 * Until 2026-09-03 every component that asked fetched its own copy. That was
 * fine while the only consumer was one settings row, and wrong the moment a
 * feature actually went behind the switch, because `App.tsx` is the router and
 * the reading view, metadata and tweets each mount **their own `Dock`**. GPT
 * Sol's review of the plan has the reproduction: turn the switch on in the bar,
 * press Metadata before the `PATCH` lands, and the new Dock's `GET` overtakes
 * it and reads *off* — against a database that says on, until a reload. The
 * `apiFetch` offline cache does not soften that; it is network-first and
 * consults IndexedDB only from the `catch` of a failed transport (lib/api.ts).
 *
 * **Not a React context**, which would need a provider: `Dock` is mounted from
 * four production sites and four test files that render it bare, and a wrapper
 * a mount site can forget is a wrapper a mount site will forget. A store that
 * components subscribe to through `useSyncExternalStore` has no such seam, and
 * it is the smaller change — one new file, no new component.
 *
 * ## The session owns the answer, and the store listens for it itself
 *
 * Until 2026-09-03 an effect in `App.tsx` called an exported `announceSession`.
 * That was a frame too late, and GPT Sol's review of this code named the
 * failure: a passive effect runs **after** its children have rendered and
 * committed, so on an account switch every `Dock` on the page draws once from
 * the previous account's snapshot before the store is told. With modes behind
 * the switch (stage 2) that is account A's experimental modes drawn for account
 * B — one frame, and no test one layer up can see it.
 *
 * So the store subscribes to `supabase.auth.onAuthStateChange` itself. Its
 * callback runs in the **same synchronous notification loop** as `useSession`'s
 * (the SDK invokes every subscriber's callback in one pass), and it updates
 * module state synchronously — so by the time React flushes the re-render that
 * `useSession`'s `setState` scheduled, the snapshot is already B's. There is no
 * stale frame because there is no effect in between.
 *
 * **Lazily, on the first `subscribe()`, and never torn down.** Not at module
 * load: an import with a side effect is one a test cannot make, and several
 * files import this module for its state alone. (The `supabase` import itself
 * is eager and throws without the `VITE_` variables, so a test that imports
 * this store mocks `lib/supabase.js` — which is also how it poses a session.)
 * Never torn down because the last component unmounting is not the reader
 * leaving: the next mount must not have to re-ask.
 *
 * **Nothing subscribes merely to wake it.** Through stage 1 the only subscriber
 * is the settings row on `/profile`, so a reading view reads the switch not at
 * all — the same as before this file existed. A keep-awake subscriber sat in
 * `App.tsx` briefly to buy the answer a round trip's head start, and was removed
 * because it existed mainly to keep a trace assertion true; `App.tsx` subscribes
 * for real in stage 2, when it calls `useExperimental()` to hand the answer to
 * `Dock`.
 *
 * `known` becomes true on the first event Supabase delivers. It emits
 * `INITIAL_SESSION` exactly once per subscriber, with a null session when
 * nobody is signed in, so "we have not heard yet" ends by itself.
 *
 * A signed-out reader is **off because we decided**, not because the request
 * failed. `GET /api/reader` sits behind the auth gate (src/routes.ts), so an
 * anonymous request is a 401 which the old hook caught as a load error and left
 * `on` at its initial `false`. Right answer, wrong reasoning —
 * docs/reusable/silent-success.md — and the day the gate moved, every gated
 * feature would have turned on for strangers with no test saying otherwise. So
 * anonymous issues no request at all.
 *
 * `loaded: true` for a signed-out reader is honest: anonymous is forcibly off
 * and there is nothing to read. It is only honest because of `epoch` below,
 * which is what stops it ever meaning "the previous account's answer".
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
import { apiFetch, readJson } from "./lib/api.js";
import { supabase } from "./lib/supabase.js";

/**
 * The one field of `/api/reader` this file is about, **checked rather than
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
  /**
   * **Whether anybody is signed in at all**, which is not answerable from
   * `loaded`: signed-out is deliberately `loaded: true`.
   *
   * The bar's own switch is drawn for signed-in readers only, and `Dock`'s
   * `signedIn` prop cannot answer the question — it is documented as
   * visitor-copy input and Metadata.tsx and Tweets.tsx do not pass it, so a
   * control keyed on it would vanish when an owner pressed Metadata. (GPT Sol,
   * 2026-09-03.) The store knows the user id, so there is one answer everywhere.
   */
  signedIn: boolean;
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

/** Who the store believes is reading, and whether the session has resolved. */
let userId: string | null = null;
let sessionKnown = false;

/**
 * **Three counters, and each invalidates a different thing.**
 *
 * `epoch` is the session. It moves on every sign-in, sign-out and account
 * switch, and a response from an older epoch is discarded rather than applied —
 * which is the whole of "never render A's setting for B", and of "a `GET` or
 * `PATCH` landing after sign-out is dropped".
 *
 * `loadToken` moves with `epoch` and with every `reload`.
 *
 * **`saveToken` is belt to those braces and nothing more, which is not what
 * this comment used to say.** It claimed to be what kept "a `reload` mid-save
 * from taking an old answer", and it never was: a load carries no save token
 * and could not be compared against one. GPT Sol, 2026-09-03. That hazard is
 * real and is now handled where it belongs — `reload()` refuses to start while
 * a save is in flight.
 *
 * What is left is genuinely redundant today, and kept deliberately as the
 * assertion that says so: within one epoch `busy` already makes a second save
 * impossible, and across epochs `epoch` rejects the older continuation, so
 * `mine === saveToken` can only ever be true. It is the line to keep — and the
 * one that stops silently — if `busy` is ever loosened.
 */
let epoch = 0;
let loadToken = 0;
let saveToken = 0;

/**
 * **The requests in flight, so a session change can stop them.**
 *
 * `epoch` decides whether a *response* is applied, and that is not enough: it
 * does not stop the request. `apiFetch` fetches its token asynchronously and,
 * on a 401, refreshes and retries with the **then-current** session — so
 * account A's `PATCH { experimental: true }` can be written to account B's row
 * after the switch, and the store would discard A's response and say nothing.
 * GPT Sol, 2026-09-03.
 *
 * An abort is the only thing that stops that, because it stops the retry as
 * well as the request. An aborted request is **not a failure** and must never
 * be reported as one: `attempt` in lib/api.ts already re-throws rather than
 * serving an offline copy for it, and both handlers below ignore it.
 */
let loadingNow: AbortController | null = null;
let savingNow: AbortController | null = null;

/** Everything in flight, cancelled. Called wherever `epoch` moves. */
function abortInFlight(): void {
  loadingNow?.abort();
  savingNow?.abort();
  loadingNow = null;
  savingNow = null;
}

/**
 * Was this the abort above, rather than a real failure?
 *
 * By `name` rather than `instanceof DOMException`: the exception crosses a
 * realm boundary in jsdom, and `undici`'s is not always the same constructor as
 * the global one.
 *
 * **Redundant today, and said so rather than tested**: everything that aborts
 * also moves `epoch`, so the guards below would refuse the rejection anyway.
 * This says *why* it is refused, at the one place where "the reader changed" is
 * distinguishable from "the network failed" — which is the difference between
 * a clean switch and "could not read your settings" on the new account's
 * screen. docs/reusable/silent-success.md.
 */
function wasAborted(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

/**
 * **One write at a time**, which is the fix for the sharpest finding in GPT
 * Sol's review of this code, 2026-08-31:
 *
 * > Click on: request A sends `true`. Click off: request B sends `false`. B
 * > reaches Postgres first and returns off. A reaches Postgres afterwards and
 * > stores on. A's response is ignored as the older generation. The UI remains
 * > off while the database is on.
 *
 * Ordering the *responses* cannot fix that: the damage is done on the server,
 * in whichever order the two requests arrive. So a second write is not started
 * while one is in flight. The checkbox is `disabled` while `saving` for the
 * same reason — and this flag is what makes it a guarantee rather than a UI
 * convention, since a keyboard, a label click and a test can all get past a
 * disabled attribute in ways nobody planned.
 */
let busy = false;

const listeners = new Set<() => void>();

/** The signed-out answer, and the shape every other state is built from. */
function base(): Omit<ExperimentalSetting, "set" | "reload"> {
  return {
    on: false,
    since: null,
    loaded: false,
    signedIn: false,
    stale: false,
    saving: false,
    error: null,
    loadError: null,
  };
}

function make(fields: Omit<ExperimentalSetting, "set" | "reload">): ExperimentalSetting {
  /* `set` and `reload` are module-level and never change, so they cost the
     snapshot nothing: two stable references carried along with the data, which
     is what lets `useExperimental` hand this object straight back. */
  return { ...fields, set, reload };
}

let state: ExperimentalSetting = make(base());

/**
 * Whether two snapshots say the same thing.
 *
 * **The snapshot must be referentially stable**: `useSyncExternalStore`
 * compares by identity, and a fresh object every time it looks is an infinite
 * render loop. So a new object is built only when a field actually moved.
 */
function same(a: ExperimentalSetting, b: ExperimentalSetting): boolean {
  return (
    a.on === b.on &&
    a.since === b.since &&
    a.loaded === b.loaded &&
    a.signedIn === b.signedIn &&
    a.stale === b.stale &&
    a.saving === b.saving &&
    a.error === b.error &&
    a.loadError === b.loadError
  );
}

function put(next: Omit<ExperimentalSetting, "set" | "reload">): void {
  const candidate = make(next);
  if (same(state, candidate)) return;
  state = candidate;
  for (const fn of [...listeners]) fn();
}

/** Everything but `set`/`reload`, so a caller can patch one field of it. */
function fields(): Omit<ExperimentalSetting, "set" | "reload"> {
  return {
    on: state.on,
    since: state.since,
    loaded: state.loaded,
    signedIn: state.signedIn,
    stale: state.stale,
    saving: state.saving,
    error: state.error,
    loadError: state.loadError,
  };
}

/**
 * **Start listening to Supabase**, once, the first time anybody subscribes.
 *
 * Not at module load — see the header. Not torn down either, and that is what
 * makes it safe to key on `listeners` being non-empty: a store that stopped
 * listening when its last subscriber unmounted would forget who was reading and
 * fetch again on the next mount.
 */
let watching = false;
function watchSession(): void {
  if (watching) return;
  watching = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    sessionIs(session?.user?.id ?? null);
  });
}

export function subscribe(fn: () => void): () => void {
  watchSession();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function snapshot(): ExperimentalSetting {
  return state;
}

/**
 * **Who is reading**, from the auth event above. Every event says "this is the
 * current state", not "this just happened" — so an event is not news.
 *
 * `sessionKnown` is false only before the SDK has said anything at all. It is
 * not "no user", and treating it as one would fetch nothing for a signed-in
 * reader on every reload; the first `INITIAL_SESSION` is what ends it, whether
 * or not it carries a session.
 *
 * **Keyed on the user id, not on the `User` or `Session` object**, and that is
 * load-bearing: `useSession`'s own header warns that Supabase re-emits
 * `SIGNED_IN` whenever a tab regains focus, so the same reader arrives here
 * over and over. Keyed on the object, every alt-tab would be another
 * `GET /api/reader`.
 */
function sessionIs(nextUserId: string | null): void {
  if (sessionKnown && nextUserId === userId) return;
  userId = nextUserId;
  sessionKnown = true;

  /* **Reset first, then fetch.** Bumping the epoch invalidates whatever is in
     flight — a `GET` or a `PATCH` answering a question asked on behalf of
     somebody who has left — and clears `busy`, so the next account is not stuck
     behind the last one's write.

     And **cancel** it, which the epoch alone cannot: a `PATCH` still on the
     wire can be retried under the new account's token. See `abortInFlight`. */
  abortInFlight();
  epoch += 1;
  loadToken += 1;
  busy = false;

  if (nextUserId === null) {
    /* No request: see the header. Anonymous is off because we decided. */
    put({ ...base(), loaded: true });
    return;
  }
  put({ ...base(), signedIn: true });
  load();
}

/** Fetch the current answer for whoever is signed in now. */
function load(): void {
  const myEpoch = epoch;
  const myToken = loadToken;
  const fresh = (): boolean => myEpoch === epoch && myToken === loadToken;
  const stop = new AbortController();
  loadingNow = stop;

  apiFetch("/api/reader", { signal: stop.signal })
    .then(async (r) => {
      /* **Is this the network's answer, or a copy of one?** The header is how
         the cache says so without every call site having to know it exists
         (lib/api.ts). A copy is worth *showing* and must not be worth
         *writing over*. */
      const copy = r.headers.get("x-spideryarn-offline") === "copy";
      return { since: sinceIn(await readJson<unknown>(r)), copy };
    })
    .then(({ since, copy }) => {
      if (!fresh()) return;
      put({
        ...fields(),
        since,
        on: since !== null,
        stale: copy,
        /* Not `loaded` for a copy: `loaded` is what enables the control, and
           this is the one state where what we are showing may already be
           wrong. */
        loaded: !copy,
      });
    })
    /* Not `loaded: true`: a fetch that failed has told us nothing, and enabling
       the switch on the strength of it would let the reader turn "off" back on
       top of an "on" we never read. */
    .catch((e: Error) => {
      /* **An abort is not a failure.** We cancelled this ourselves because the
         reader changed, and reporting it as a load error would put "could not
         read your settings" on the new account's screen. */
      if (wasAborted(e) || !fresh()) return;
      put({ ...fields(), loadError: e.message });
    })
    .finally(() => {
      if (loadingNow === stop) loadingNow = null;
    });
}

/** Ask again, after a failed or offline load. */
function reload(): void {
  /* Nothing to retry when nobody is signed in: there was no request to fail.
     `sessionKnown` as well as the id, so that "we have not heard yet" is not
     mistaken for a reader — the two are different states everywhere else here
     and this is not the place to start conflating them. */
  if (userId === null || !sessionKnown) return;
  /* **Not while a save is in flight.** A `GET` started mid-save reads the value
     the row had *before* the `PATCH`, and can land after it — writing the
     pre-save answer over a write the server has already committed, which is the
     UI/database disagreement this whole file exists to prevent. GPT Sol,
     2026-09-03. Nothing legitimate is dropped: the save itself delivers the
     authoritative value on the way out, and the retry button is `disabled`
     while `saving`. */
  if (busy) return;
  loadToken += 1;
  put({ ...fields(), loadError: null });
  load();
}

/** Turn it on or off. */
function set(next: boolean): void {
  /* **A signed-out press writes nothing and changes nothing.** There is no row
     to patch, the route would 401, and the state it would move is the one we
     decided rather than one we read. And nothing is written before the session
     is known either: a `PATCH` on behalf of a reader we have not identified is
     a write to whoever the browser's token turns out to belong to. */
  if (userId === null || !sessionKnown) return;
  if (busy) return;
  busy = true;
  const myEpoch = epoch;
  const mine = ++saveToken;
  /* **A write supersedes any read already in flight.** The reader can press
     before the opening `GET` has come back — a real window on a slow
     connection, and nothing in the DOM closes it, because `set` is guarded by
     `busy` rather than by a `disabled` attribute that a keyboard, a label click
     and a test all get past.
     Without this bump that older `GET` lands afterwards and writes the value
     the switch had *before* the press, over a `PATCH` the server has already
     committed: the UI says off while the database says on. That is the failure
     GPT Sol described one level up, between two Docks, reproduced inside the
     one store that replaced them — tests/experimental-store.test.tsx § a write
     that finishes while a read is still in flight. */
  loadToken += 1;

  /* **Optimistic**, and the switch moves under the finger. The alternative —
     wait for the round trip — makes a one-bit control feel broken on a slow
     connection, and there is a real value to put back if it fails.

     The optimistic value for "on" is a *guess* at the date, replaced below by
     the server's, which is the one that says when the switch was actually first
     flipped. Nothing reads the date except the line under the switch, so a
     wrong one for one round trip costs nothing. */
  const optimistic = next ? new Date().toISOString() : null;
  const before = state.since;
  put({ ...fields(), since: optimistic, on: optimistic !== null, saving: true, error: null });

  const stop = new AbortController();
  savingNow = stop;
  apiFetch("/api/reader", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ experimental: next }),
    /* **The signal is the only thing that binds this write to this account.**
       Without it, `apiFetch` can meet a 401, refresh, and retry this body with
       whichever session is current by then — writing A's `true` into B's row.
       See `abortInFlight`. */
    signal: stop.signal,
  })
    .then((r) => readJson<unknown>(r))
    .then((body) => {
      if (myEpoch !== epoch || mine !== saveToken) return;
      // The stored value, not the guess — and checked, not assumed.
      const since = sinceIn(body);
      put({
        ...fields(),
        since,
        on: since !== null,
        /* A successful write is a current answer, whatever the load was: this
           is the path that rescues a reader whose page loaded offline and then
           reconnected.
           **And it clears the load failure, which is the whole point of
           "whatever the load was".** Without this the row goes on saying
           "Couldn't load this setting" beside an answer we have just been given
           by the server, with a "Try again" for a read nothing is waiting on —
           a sentence about a failure that no longer describes anything on
           screen. Older than this store and carried over from the hook; found
           while writing the `Try again` guard in SettingsSection.tsx. */
        loaded: true,
        loadError: null,
        stale: false,
      });
    })
    .catch((e: Error) => {
      /* Cancelled because the reader changed: not a failure, and the switch
         belongs to somebody else now. Nothing to put back. */
      if (wasAborted(e) || myEpoch !== epoch || mine !== saveToken) return;
      /* **Put it back.** A switch left showing what the reader asked for, when
         the server never got it, is the whole hazard: every gated feature then
         disagrees with the switch that claims to control them.

         `before` is read off the store rather than closed over: it is the value
         the store held at the moment of the press, which is what "put it back"
         means, and the store is the only thing that knows it. (It used to say
         this was about "two clicks in one tick sharing a render closure" —
         there is no render closure in a module store, and `busy` refuses the
         second click anyway.) */
      put({ ...fields(), since: before, on: before !== null, error: e.message });
    })
    .finally(() => {
      /* Only this epoch's save may clear the flags. A save from the previous
         account landing now would otherwise release `busy` while the current
         account's own write is in flight — two writes at once, which is exactly
         what `busy` exists to prevent. */
      if (savingNow === stop) savingNow = null;
      if (myEpoch !== epoch) return;
      busy = false;
      if (mine !== saveToken) return;
      put({ ...fields(), saving: false });
      /* **The save cancelled a read, and then failed — so go and read again.**
         The `loadToken` bump above is right when the write lands, and leaves
         nothing behind when it does not: `before` is the never-loaded default,
         so the store would sit at `loaded: false` for the rest of the session
         with the control disabled and no answer coming. This is the only path
         that can reach that state; a load that fails on its own says so through
         `loadError` and offers `reload`.

         **In the `finally`, after `busy = false`, and that is load-bearing.**
         It used to live in the `catch`, which runs first — so the moment
         `reload()` learned to refuse while `busy`, the recovery would have gone
         quietly nowhere and every test would have stayed green.
         docs/reusable/silent-success.md. */
      if (!state.loaded) reload();
    });
}

/**
 * **Forget everything**, for a test.
 *
 * A module singleton keeps its state between test files' `it` blocks the way it
 * keeps it between page views, which is the point of it — so a test that does
 * not reset first inherits whichever session the last one announced, and the
 * failure looks like a bug in the code rather than in the harness. Nothing in
 * the app calls this.
 *
 * **The listeners are left alone**, and so is the Supabase subscription.
 * Dropping either would silently detach a component that is still mounted and
 * still expects to hear about changes; unmounting is what removes a listener,
 * and `subscribe` already returns the function that does it. A test drives the
 * session by making its mocked `onAuthStateChange` emit.
 */
export function resetForTests(): void {
  userId = null;
  sessionKnown = false;
  abortInFlight();
  epoch += 1;
  loadToken += 1;
  saveToken += 1;
  busy = false;
  put(base());
}
