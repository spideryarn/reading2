// @vitest-environment jsdom
/**
 * **The experimental switch, and the session it belongs to.**
 *
 * The answer used to be fetched by whichever component asked, which made two
 * things wrong at once: two Docks disagreed with each other for the length of a
 * toggle (GPT Sol's review of the plan, 2026-09-03), and a signed-out reader got
 * "off" only because `GET /api/reader` is behind the auth gate and a 401 is
 * caught as a load error. The second is
 * [silent-success.md](../docs/reusable/silent-success.md) exactly: the answer is
 * right and the reasoning is not, so the day the gate moves every gated feature
 * turns on for strangers and no test says otherwise.
 *
 * So the answer has one home, `src/web/experimental-store.ts`, and this file is
 * the lifecycle table from
 * `docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md`
 * § What the store must get right — **one test per row**. A single
 * anonymous-mount test would pass with several of these broken.
 *
 * The reader-facing half of the switch is tests/profile-settings.test.tsx.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every request the store made: the whole point of the anonymous row.
 *
 * `signal` is recorded because a session change has to **cancel** what is on
 * the wire, not merely ignore its answer — `apiFetch` refreshes and retries a
 * 401 with the then-current session, so an uncancelled `PATCH` of A's can be
 * written to B's row (GPT Sol, 2026-09-03). A recorded signal is how a test can
 * see the cancelling happen.
 */
let calls: { url: string; method: string; signal: AbortSignal | null }[] = [];
/** What `readJson` answers with next, unless a release below says otherwise. */
let answer: () => Promise<unknown>;
/** Headers the next response carries — the offline-copy marker. */
let headers: Record<string, string> = {};
/**
 * Parked requests, when a test needs one in flight across a session change.
 *
 * `null` means "resolve immediately", which is what most rows want. When it is
 * a list, every request parks a resolver here and the test says when each comes
 * back — the only way to write "a GET lands after sign-out", which is a race a
 * straight-line mock cannot produce.
 *
 * A release may carry **its own body**, and some rows need that: `answer` is
 * read when the continuation runs rather than when the release is called, so a
 * test that answers A's request and then switches account cannot say what A's
 * answer was with the shared variable alone.
 */
let held: ((body?: unknown) => void)[] | null = null;
/** The body a particular response was released with, if it was given one. */
const bodyOf = new WeakMap<Response, unknown>();

/** What `fetch` rejects with when its signal is aborted. */
function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string, init?: RequestInit) => {
    const signal = init?.signal ?? null;
    calls.push({ url, method: init?.method ?? "GET", signal });
    const res = new Response(null, { status: 200, headers });
    if (!held) return Promise.resolve(res);
    return new Promise<Response>((resolve, reject) => {
      /* A real `fetch` rejects when its signal is aborted — and does *not*
         un-resolve one that has already answered, which is why a release that
         happened first still wins below. */
      signal?.addEventListener("abort", () => reject(abortError()));
      held?.push((body?: unknown) => {
        if (body !== undefined) bodyOf.set(res, body);
        resolve(res);
      });
    });
  },
  readJson: (r: Response) => (bodyOf.has(r) ? Promise.resolve(bodyOf.get(r)) : answer()),
}));

/**
 * **The store's own auth listener, and `useSession`'s**, so a test can be the
 * SDK.
 *
 * Since 2026-09-03 the store subscribes to `onAuthStateChange` itself rather
 * than being told by an effect in `App.tsx` — the effect ran a frame after its
 * children had rendered, which on an account switch is one frame of A's setting
 * drawn for B (GPT Sol's review of this code). So driving the session here
 * means emitting an auth event, exactly as production does.
 *
 * Not reset between tests: the store subscribes once, lazily, and never tears
 * it down.
 */
const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));

const { resetForTests, snapshot, subscribe } = await import("../src/web/experimental-store.js");
const { useExperimental } = await import("../src/web/useExperimental.js");
const { useSession } = await import("../src/web/useSession.js");
type Setting = ReturnType<typeof useExperimental>;

/**
 * **Somebody is reading the store**, for the whole file.
 *
 * The store starts listening to Supabase on the first `subscribe()` and never
 * stops; in the app that is `App.tsx`'s keep-awake effect. Standing in for it
 * here once, at the top, is what lets a row emit an auth event before it
 * renders anything — several of them do, because "the answer arrives while
 * nothing is mounted" is a state the app really has.
 */
subscribe(() => {});

/* React's own flag, so `act` outside a mounted root does not warn. Some rows
   deliver an auth event before anything has rendered, which is a state the app
   really has. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATE_A = "2026-09-01T10:00:00.000Z";
const DATE_B = "2026-09-02T10:00:00.000Z";

/**
 * A component reading the store, and every value it was ever handed.
 *
 * The *history* matters as much as the current value: "never render A's setting
 * for B" is a statement about what was on screen in between, which a final
 * assertion cannot see.
 */
function drive(): { now: () => Setting; seen: Setting[]; stop: () => void } {
  const seen: Setting[] = [];
  function Probe(): ReactNode {
    seen.push(useExperimental());
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return {
    now: () => {
      const last = seen.at(-1);
      if (!last) throw new Error("the probe never rendered");
      return last;
    },
    seen,
    stop: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/**
 * A component that reads **the session and the setting together**, and every
 * pair it was ever handed.
 *
 * This is the seam GPT Sol's blocker 1 lives in and the store-only probe above
 * cannot see: `useSession` and the store are two subscribers to one auth event,
 * and the question is whether a render can ever land in between them. It used
 * to be able to — the store was told from a passive effect in `App.tsx`, which
 * runs *after* its children have rendered and committed — so an account switch
 * drew one frame of A's setting for B. After stage 2 that frame is A's
 * experimental modes on B's screen.
 */
function pair(): { seen: { who: string | null; on: boolean }[]; stop: () => void } {
  const seen: { who: string | null; on: boolean }[] = [];
  function Probe(): ReactNode {
    const { user } = useSession();
    const { on } = useExperimental();
    seen.push({ who: user?.id ?? null, on });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return {
    seen,
    stop: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Let a request and its `.then` chain settle, inside `act`. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Deliver an auth event, the way the Supabase client does: **synchronously, to
 * every subscriber in turn, in one pass.** That single pass is what removes the
 * stale frame — the store has finished updating before React flushes the
 * re-render that `useSession`'s `setState` scheduled.
 */
function emit(userId: string | null): void {
  const session = userId === null ? null : { user: { id: userId } };
  for (const fn of [...authListeners]) fn(userId === null ? "SIGNED_OUT" : "SIGNED_IN", session);
}

/** The same, wrapped in `act` for the rows that only want the end state. */
function announce(userId: string | null): void {
  act(() => emit(userId));
}

/** The requests, without their signals — for the rows that only count them. */
const made = (): { url: string; method: string }[] =>
  calls.map(({ url, method }) => ({ url, method }));

beforeEach(() => {
  calls = [];
  headers = {};
  held = null;
  answer = () => Promise.resolve({ experimentalSince: null });
  resetForTests();
});

afterEach(() => {
  resetForTests();
});

describe("the experimental-features store, across a session", () => {
  it("asks nothing at all while the session is still loading", async () => {
    /* **The row this whole file exists for.** Today's hook fetches on mount, is
       401'd by the auth gate, and calls that a load error — so "off" for a
       stranger is an accident of the gate rather than a decision. Here it is a
       decision: no session, no request.

       **The store is listening and has heard nothing yet**, which is the state
       this row is named after and the one the earlier version never entered: it
       announced the exact `(null, false)` that `resetForTests` installs, so the
       transition returned immediately and the assertions were about the initial
       snapshot. (GPT Sol, 2026-09-03.) Supabase has not emitted its
       `INITIAL_SESSION`; nothing else can end the wait. */
    const probe = drive();
    expect(authListeners.length, "the store must be listening to hear it").toBeGreaterThan(0);
    await settle();

    expect(calls).toEqual([]);
    expect(probe.now().loaded).toBe(false);
    expect(probe.now().on).toBe(false);
    expect(probe.now().signedIn).toBe(false);
    expect(probe.now().loadError).toBe(null);

    /* And the quiet was "not yet" rather than "never": the first event ends it.
       Without this the row would pass against a store that had stopped asking
       altogether. */
    announce("reader-a");
    await settle();
    expect(made()).toEqual([{ url: "/api/reader", method: "GET" }]);
    probe.stop();
  });

  it("is off, loaded and quiet for a signed-out reader", async () => {
    const probe = drive();
    announce(null);
    await settle();

    expect(calls).toEqual([]);
    /* `loaded: true` is honest: anonymous is forcibly off and there is nothing
       to read. It is only honest because of the four rows below, which are what
       stop it meaning "the previous account's answer is current". */
    expect(probe.now().loaded).toBe(true);
    expect(probe.now().on).toBe(false);
    expect(probe.now().since).toBe(null);
    expect(probe.now().signedIn).toBe(false);
    probe.stop();
  });

  it("fetches once when a session resolves, keyed on the user id", async () => {
    /* `useSession`'s own header warns that Supabase re-emits `SIGNED_IN`
       whenever a tab regains focus, so `App.tsx` will announce the same reader
       again and again. Keyed on the id, that is one GET; keyed on the `User` or
       `Session` object it would be one per alt-tab. */
    answer = () => Promise.resolve({ experimentalSince: DATE_A });
    const probe = drive();
    announce("reader-a");
    await settle();
    announce("reader-a");
    announce("reader-a");
    await settle();

    expect(made()).toEqual([{ url: "/api/reader", method: "GET" }]);
    expect(probe.now().on).toBe(true);
    expect(probe.now().since).toBe(DATE_A);
    expect(probe.now().signedIn).toBe(true);
    probe.stop();
  });

  it("goes off the moment the reader signs out, and drops what was in flight", async () => {
    answer = () => Promise.resolve({ experimentalSince: DATE_A });
    const probe = drive();
    announce("reader-a");
    await settle();
    expect(probe.now().on).toBe(true);

    /* A load and a save both in flight when the session ends. */
    held = [];
    act(() => probe.now().reload());
    /* `set(true)` over an already-on switch, deliberately: the optimistic value
       keeps `on` true, so the assertion below is about the sign-out rather than
       about the press. */
    act(() => probe.now().set(true));
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "PATCH"]);

    announce(null);
    /* **Synchronously** — not after a round trip. Anything else is a frame in
       which a stranger is shown the last reader's setting. */
    expect(snapshot().on).toBe(false);
    expect(snapshot().since).toBe(null);
    expect(snapshot().loaded).toBe(true);
    expect(snapshot().saving).toBe(false);
    expect(snapshot().signedIn).toBe(false);
    probe.stop();
  });

  it("discards a GET and a PATCH that land after the sign-out", async () => {
    answer = () => Promise.resolve({ experimentalSince: null });
    const probe = drive();
    announce("reader-a");
    await settle();

    held = [];
    act(() => probe.now().reload());
    act(() => probe.now().set(true));

    /* Both come back saying "on", and the reader signs out **in the same tick**,
       before either continuation has run. That ordering is the point: a response
       already on the wire cannot be un-sent by the cancellation, so it is
       `epoch` rather than the `AbortSignal` that has to refuse it. Neither may
       be believed — they answer a question asked on behalf of somebody who has
       left. */
    await act(async () => {
      for (const release of held ?? []) release({ experimentalSince: DATE_B });
      emit(null);
    });
    await settle();

    expect(snapshot().on).toBe(false);
    expect(snapshot().since).toBe(null);
    expect(snapshot().loaded).toBe(true);
    expect(snapshot().signedIn).toBe(false);
    expect(probe.seen.every((s) => !s.on || s.signedIn)).toBe(true);
    probe.stop();
  });

  it("never shows one account's setting to the next", async () => {
    /* **A's answer lands while B is the reader**, which is the state this row
       is named after and the earlier version never reached: it let A's `GET`
       finish first, so it proved only that a settled value is cleared, not that
       an A response arriving under B is refused. GPT Sol, 2026-09-03. */
    const probe = drive();
    held = [];
    announce("reader-a");
    expect(made()).toEqual([{ url: "/api/reader", method: "GET" }]);

    const before = probe.seen.length;
    act(() => {
      /* A's answer comes back — and the account changes in the same tick,
         before the continuation runs. */
      held?.[0]?.({ experimentalSince: DATE_A });
      emit("reader-b");

      /* Reset *first*, then fetch, and **synchronously** — inside the auth
         event itself, not a frame later. Between the two accounts there is no
         moment where B is looking at A's answer, and none where B is told the
         answer is loaded before it has been read. */
      expect(snapshot().on).toBe(false);
      expect(snapshot().loaded).toBe(false);
      expect(snapshot().signedIn).toBe(true);
    });

    /* A's continuation runs here, under B's epoch, and is refused. */
    await settle();
    expect(snapshot().on).toBe(false);
    expect(snapshot().since).toBe(null);

    /* B's own answer, which is off. */
    await act(async () => held?.[1]?.({ experimentalSince: null }));
    await settle();

    expect(made()).toEqual([
      { url: "/api/reader", method: "GET" },
      { url: "/api/reader", method: "GET" },
    ]);
    expect(probe.now().on).toBe(false);
    expect(probe.now().loaded).toBe(true);
    expect(probe.seen.slice(before).every((s) => !s.on)).toBe(true);
    probe.stop();
  });

  it("writes nothing when a signed-out reader presses it", async () => {
    const probe = drive();
    announce(null);
    await settle();
    const was = probe.now();

    act(() => probe.now().set(true));
    await settle();

    expect(calls).toEqual([]);
    /* Not merely "still off": the same object. A signed-out press is not a
       state change at all, so nothing subscribed to the store re-renders. */
    expect(probe.now()).toBe(was);
    probe.stop();
  });
});

describe("the store's snapshot", () => {
  it("is the same object until something actually changes", async () => {
    /* `useSyncExternalStore` compares snapshots by identity and re-renders
       forever if a fresh object comes back each time it looks. */
    answer = () => Promise.resolve({ experimentalSince: null });
    const first = snapshot();
    expect(snapshot()).toBe(first);

    announce("reader-a");
    const loading = snapshot();
    expect(loading).not.toBe(first);
    await settle();
    const loaded = snapshot();
    expect(loaded).not.toBe(loading);

    /* The same session again says nothing new, so nothing changes. */
    announce("reader-a");
    expect(snapshot()).toBe(loaded);
  });

  it("tells a component whether anybody is signed in", async () => {
    /* Stage 3 draws the switch in the bar for signed-in readers only, and
       `Dock`'s own `signedIn` prop cannot answer: it is visitor-copy input, and
       Metadata.tsx and Tweets.tsx do not pass it. */
    const probe = drive();
    announce("reader-a");
    await settle();
    expect(probe.now().signedIn).toBe(true);

    announce(null);
    expect(probe.now().signedIn).toBe(false);
    probe.stop();
  });
});

describe("a write that finishes while a read is still in flight", () => {
  /**
   * **The read started first, so it is the older truth.**
   *
   * A reader signs in and presses the switch before the opening `GET` has come
   * back. That window is real on a slow connection, and nothing on the DOM
   * closes it: `set` is guarded by `busy`, deliberately, because a keyboard, a
   * label click and a test all get past a `disabled` attribute.
   *
   * If the `GET` is allowed to land afterwards it writes the value the switch
   * had *before* the press, over a `PATCH` the server has already committed.
   * The UI then says off while the database says on — the same failure GPT Sol
   * described one level up between two Docks, and no less wrong inside the one
   * store that replaced them.
   */
  it("keeps what the write stored, not what the older read says", async () => {
    held = [];
    announce("reader-1");
    const probe = drive();
    expect(made()).toEqual([{ url: "/api/reader", method: "GET" }]);

    act(() => probe.now().set(true));
    expect(calls.at(-1)?.method).toBe("PATCH");

    /* The PATCH comes back first, and the server says it is on. */
    answer = () => Promise.resolve({ experimentalSince: DATE_A });
    await act(async () => held?.[1]?.());
    await settle();
    expect(probe.now().on).toBe(true);

    /* Now the stale GET lands, still carrying the pre-press answer. */
    answer = () => Promise.resolve({ experimentalSince: null });
    await act(async () => held?.[0]?.());
    await settle();

    expect(probe.now().on).toBe(true);
    expect(probe.now().since).toBe(DATE_A);
    probe.stop();
  });
});

describe("the frame between two accounts", () => {
  it("never pairs the new account with the old account's setting", async () => {
    /* One component, both subscriptions, and the whole history of what it was
       handed. The assertion is about what was on screen *in between*, which a
       final snapshot cannot see. */
    answer = () => Promise.resolve({ experimentalSince: DATE_A });
    const probe = pair();
    announce("reader-a");
    await settle();
    expect(probe.seen.at(-1)).toEqual({ who: "reader-a", on: true });

    answer = () => Promise.resolve({ experimentalSince: null });
    announce("reader-b");
    await settle();

    expect(
      probe.seen.filter((r) => r.who === "reader-b" && r.on),
      "B was never shown A's experimental features",
    ).toEqual([]);
    expect(probe.seen.at(-1)).toEqual({ who: "reader-b", on: false });
    probe.stop();
  });
});

describe("a reload that would undo a save", () => {
  /**
   * **A `GET` started mid-save reads the row as it was before the `PATCH`.**
   *
   * GPT Sol's blocker 2, 2026-09-03: it can land afterwards and write that
   * pre-save value over a write the server has already committed — the UI says
   * off while the database says on, which is the disagreement this whole file
   * exists to prevent. So `reload()` refuses while a save is in flight; the save
   * itself delivers the authoritative value on the way out.
   */
  it("asks nothing while a save is in flight, and the save's answer stands", async () => {
    const probe = drive();
    answer = () => Promise.resolve({ experimentalSince: null });
    announce("reader-a");
    await settle();
    expect(probe.now().loaded).toBe(true);

    held = [];
    act(() => probe.now().set(true));
    const sent = calls.length;

    act(() => probe.now().reload());
    expect(calls.length, "a reload during a save issues no request").toBe(sent);

    /* The save lands, and it is on. */
    await act(async () => held?.[0]?.({ experimentalSince: DATE_A }));
    await settle();
    expect(probe.now().on).toBe(true);
    expect(probe.now().since).toBe(DATE_A);

    /* And had a `GET` been started, this is where it would land — carrying the
       "off" the row held before the press. Nothing is parked, so nothing does. */
    answer = () => Promise.resolve({ experimentalSince: null });
    await act(async () => {
      for (const release of (held ?? []).slice(1)) release();
    });
    await settle();
    expect(probe.now().on).toBe(true);
    expect(probe.now().since).toBe(DATE_A);
    probe.stop();
  });
});

describe("what a session change does to the wire", () => {
  /**
   * **`epoch` decides whether an answer is applied; it does not stop a
   * request.** GPT Sol's blocker 3, 2026-09-03: `apiFetch` fetches its token
   * asynchronously and, on a 401, refreshes and retries with the *then-current*
   * session — so account A's `PATCH { experimental: true }` can be written to
   * account B's row, and the store would discard A's response and say nothing.
   * Only a cancellation stops that, because it stops the retry too.
   */
  it("cancels the load and the save when the account changes", async () => {
    const probe = drive();
    held = [];
    announce("reader-a");
    act(() => probe.now().set(true));

    const [get, patch] = calls;
    expect(get?.method).toBe("GET");
    expect(patch?.method).toBe("PATCH");
    expect(get?.signal, "every request the store issues carries a signal").not.toBe(null);
    expect(patch?.signal, "every request the store issues carries a signal").not.toBe(null);
    expect(get?.signal?.aborted).toBe(false);
    expect(patch?.signal?.aborted).toBe(false);

    announce("reader-b");
    expect(get?.signal?.aborted, "the account change cancels the load").toBe(true);
    expect(patch?.signal?.aborted, "the account change cancels the save").toBe(true);

    /* And the cancelling is not reported to B as a failure. */
    await settle();
    expect(snapshot().loadError).toBe(null);
    expect(snapshot().error).toBe(null);
    probe.stop();
  });
});

describe("a save that fails after it cancelled the opening read", () => {
  /**
   * **The half of the fix that had never been seen fail.** A press before the
   * opening `GET` has come back supersedes it, which is right when the write
   * lands and leaves nothing behind when it does not: the store would sit at
   * `loaded: false` for the rest of the session, control disabled, no answer
   * coming. So a failed save goes back for the answer.
   *
   * The recovery lives in the `finally`, **after** `busy` is cleared. In the
   * `catch` — where it started — it would run while the save is still in
   * flight, and `reload()` now refuses that: the recovery would do nothing at
   * all, silently, with every test still green.
   * docs/reusable/silent-success.md.
   */
  it("goes back for the answer, and gets the server's own value", async () => {
    const probe = drive();
    held = [];
    announce("reader-a");
    expect(probe.now().loaded).toBe(false);

    act(() => probe.now().set(true));
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);

    answer = () => Promise.reject(new Error("the server said no"));
    await act(async () => held?.[1]?.());
    await settle();

    expect(probe.now().error).toBe("the server said no");
    expect(probe.now().saving).toBe(false);
    expect(calls.map((c) => c.method), "a failed save asks again").toEqual([
      "GET",
      "PATCH",
      "GET",
    ]);

    await act(async () => held?.[2]?.({ experimentalSince: DATE_B }));
    await settle();
    expect(probe.now().loaded).toBe(true);
    expect(probe.now().on).toBe(true);
    expect(probe.now().since).toBe(DATE_B);
    expect(probe.now().loadError).toBe(null);
    probe.stop();
  });
});

describe("a save from the account that has left", () => {
  /**
   * **A's `PATCH` finishing must not release B's write lock, and must not touch
   * B's state.** Removing either epoch guard from the save's continuation left
   * every earlier test green, which is why this one exists — GPT Sol, item 4,
   * 2026-09-03.
   *
   * The ordering is the one a network really produces: A's answer comes back,
   * the account changes, B presses the switch, and only then does A's
   * continuation run. A response already on the wire cannot be un-sent by the
   * cancellation, so `epoch` is the only thing standing here.
   */
  it("neither releases the next account's lock nor writes to its state", async () => {
    const probe = drive();
    answer = () => Promise.resolve({ experimentalSince: null });
    announce("reader-a");
    await settle();
    expect(probe.now().loaded).toBe(true);

    held = [];
    act(() => probe.now().set(true));
    expect(calls.at(-1)?.method).toBe("PATCH");

    act(() => {
      held?.[0]?.({ experimentalSince: DATE_A });
      emit("reader-b");
      snapshot().set(false);
    });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH", "GET", "PATCH"]);
    expect(snapshot().saving, "B's own save is in flight").toBe(true);

    /* A's continuation runs here, under B's epoch. */
    await settle();

    expect(snapshot().since, "A's answer is not B's").toBe(null);
    expect(snapshot().on).toBe(false);
    expect(snapshot().loaded).toBe(false);
    expect(snapshot().saving, "A did not clear B's saving flag").toBe(true);

    /* And the write lock is still B's: a second press writes nothing. */
    act(() => snapshot().set(true));
    expect(
      calls.filter((c) => c.method === "PATCH"),
      "one write at a time, still",
    ).toHaveLength(2);
    probe.stop();
  });
});

describe("a save that succeeds after a load that failed", () => {
  /**
   * **The answer arrived, so stop saying it did not.**
   *
   * A failed load leaves `loadError` set, and the settings row draws it as
   * "Couldn't load this setting — …" with a *Try again* beside it. A save that
   * then succeeds is a current answer from the server — `loaded` already said
   * so — but `loadError` used to survive it, so the row went on apologising for
   * a read nothing was waiting on, next to the value it had just been given.
   *
   * A sentence about a failure that no longer describes anything on screen is
   * the same defect as a switch that lies about its state, one layer out.
   * Older than this store; carried over from the hook it replaced.
   */
  it("stops reporting the load failure", async () => {
    const probe = drive();
    answer = () => Promise.reject(new Error("the network went away"));
    announce("reader-1");
    await settle();
    expect(probe.now().loadError).toBe("the network went away");
    expect(probe.now().loaded).toBe(false);

    answer = () => Promise.resolve({ experimentalSince: DATE_A });
    act(() => probe.now().set(true));
    await settle();

    expect(probe.now().on).toBe(true);
    expect(probe.now().loaded).toBe(true);
    expect(probe.now().loadError, "the load failure is over").toBe(null);
    probe.stop();
  });
});
