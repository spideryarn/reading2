/**
 * **Whether a copy of the app that has outlived a deploy reloads itself.**
 *
 * The subject is one decision — reload, or leave the reader with the message —
 * and what it is a function of: the build this copy is, the build the server
 * says is live, the build this session has already reloaded for, and whether
 * the reader is still on the page that failed.
 * docs/plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md.
 *
 * Every case that must *not* reload is here beside the one that must, because
 * the failure that matters is a reload that fires when it should not: at best a
 * page that blinks, at worst one that never stops, or one that takes away a
 * page nobody had a problem with.
 */
import { describe, expect, it, vi } from "vitest";

import {
  CHECK_EVERY_MS,
  RELOADED_FOR_KEY,
  buildIdentity,
  createDeployWatch,
  reloadForNewBuild,
  reloadIfStale,
  reloadedFor,
  serverBuild,
  type DeployWatchDeps,
  type ReloadForNewBuildDeps,
  type StaleShellDeps,
} from "../src/web/stale-shell.js";

const MINE_SHA = "5b76945908127d48826be1d0283596e753a15f80";
const THEIR_SHA = "d3f34a0f89c7d865166da7d4e1e034f43de4c3d3";
const MINE_STAMP = { commit: MINE_SHA, builtAt: "2026-10-03T07:40:33.000Z" };
const THEIR_STAMP = { commit: THEIR_SHA, builtAt: "2026-10-03T17:33:40.390Z" };
const MINE = `${MINE_STAMP.commit} ${MINE_STAMP.builtAt}`;
const THEIRS = `${THEIR_STAMP.commit} ${THEIR_STAMP.builtAt}`;

/** `/build.json` as a deploy publishes it. */
const answering = (body: unknown, status = 200) =>
  vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;

/** A `sessionStorage` that is only a map. */
function memory(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  return {
    held,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => void held.set(k, v),
  };
}

type Deps = StaleShellDeps & { reload: ReturnType<typeof vi.fn> };

function deps(over: Partial<StaleShellDeps> = {}): Deps {
  return {
    mine: MINE,
    fetch: answering(THEIR_STAMP),
    storage: memory(),
    reload: vi.fn(),
    address: () => "https://www.spideryarn.com/changelog",
    timeoutMs: 1000,
    ...over,
  } as Deps;
}

describe("buildIdentity", () => {
  it("is the commit and the build time together", () => {
    expect(buildIdentity(MINE_STAMP.commit, MINE_STAMP.builtAt)).toBe(MINE);
  });

  it.each([
    ["a commit that is not a sha", "unknown", MINE_STAMP.builtAt],
    ["no commit", null, MINE_STAMP.builtAt],
    ["no build time", MINE_SHA, null],
    ["a build time that is not a time", MINE_SHA, "soon"],
  ])("is null for %s", (_what, commit, builtAt) => {
    expect(buildIdentity(commit, builtAt)).toBeNull();
  });
});

describe("serverBuild", () => {
  it("reads the build out of /build.json, and asks for it uncached", async () => {
    const fetchFn = answering({ ...THEIR_STAMP, deploymentId: "dpl_x", artefact: "client" });
    expect(await serverBuild(fetchFn)).toBe(THEIRS);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/build.json");
    expect(init.cache).toBe("no-store");
  });

  it.each([
    ["the shell's HTML, which is what a missing file answers with", "<!doctype html><html></html>", 200],
    ["a commit that is not a sha", { ...THEIR_STAMP, commit: "unknown" }, 200],
    ["no commit at all", { builtAt: THEIR_STAMP.builtAt }, 200],
    ["no build time", { commit: THEIR_SHA }, 200],
    ["a failing status", THEIR_STAMP, 500],
    ["something that is not an object", "null", 200],
  ])("is null for %s", async (_what, body, status) => {
    expect(await serverBuild(answering(body, status))).toBeNull();
  });

  it("is null, not a throw, when the request itself fails", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Load failed");
    }) as unknown as typeof fetch;
    expect(await serverBuild(offline)).toBeNull();
  });

  it("is null after its deadline when the request never settles, even one that ignores the abort", async () => {
    /* The loader is waiting on this. A fetch that hangs must cost the reader a
       few seconds of spinner and then the message, never the spinner for ever.
       GPT Sol's plan review, finding 4. */
    let signal: AbortSignal | undefined;
    const hanging = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    const started = Date.now();
    expect(await serverBuild(hanging, 30)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal?.aborted, "the request is told to stop as well").toBe(true);
  });
});

describe("reloadIfStale", () => {
  it("reloads when a different build is live, and remembers which", async () => {
    const d = deps();
    expect(await reloadIfStale(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(reloadedFor(d.storage)).toEqual([THEIRS]);
  });

  it("reloads when the same commit has been built again — its files are different files", async () => {
    /* A redeploy: the changelog's line 6 is one. The build time is compiled in,
       so the hashes move though the commit does not. Sol, finding 2. */
    const d = deps({ fetch: answering({ commit: MINE_SHA, builtAt: "2026-10-03T09:00:00.000Z" }) });
    expect(await reloadIfStale(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload twice for the same build — the message, not a loop", async () => {
    const d = deps({ storage: memory({ [RELOADED_FOR_KEY]: JSON.stringify([THEIRS]) }) });
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does reload for a build it has not reloaded for, and keeps the ones it has", async () => {
    const earlier = `${"a".repeat(40)} 2026-10-02T00:00:00.000Z`;
    const d = deps({ storage: memory({ [RELOADED_FOR_KEY]: JSON.stringify([earlier]) }) });
    expect(await reloadIfStale(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(reloadedFor(d.storage)).toEqual([earlier, THEIRS]);
  });

  it("reads the note a copy from before 2026-10-05 left — one build, not a list — as a list of one", async () => {
    /* A session can straddle the deploy that changed the note's shape: the old
       copy writes the bare identity, reloads, and the new copy is the one that
       reads it. Ignoring it would give that session one reload more than it
       was promised. */
    const d = deps({ storage: memory({ [RELOADED_FOR_KEY]: THEIRS }) });
    expect(reloadedFor(d.storage)).toEqual([THEIRS]);
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("reloads at most once for each build, however the server's answers alternate", async () => {
    /* GPT Sol's probe on plan 261005d, F6. The shell is stuck on this build —
       every reload lands on it again — and `/build.json` answers B, B, C, B, C,
       B. Each call below is a *new document* (new deps, nothing in memory) over
       the one `sessionStorage` a reload keeps. When the note held only the
       last build, the fourth, fifth and sixth all reloaded. */
    const storage = memory();
    const other = { commit: "c".repeat(40), builtAt: "2026-10-04T08:00:00.000Z" };
    const allowed: boolean[] = [];
    for (const answer of [THEIR_STAMP, THEIR_STAMP, other, THEIR_STAMP, other, THEIR_STAMP]) {
      allowed.push(await reloadIfStale(deps({ storage, fetch: answering(answer) })));
    }
    expect(allowed).toEqual([true, false, true, false, false, false]);
  });

  it("does not reload when the server is on this very build", async () => {
    const d = deps({ fetch: answering(MINE_STAMP) });
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does not reload when the check could not be made", async () => {
    const d = deps({ fetch: answering("<!doctype html>") });
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does not reload, or ask, when this copy has no build stamp", async () => {
    const d = deps({ mine: null });
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does not reload, or leave a note, when the reader left while it was asking", async () => {
    /* Back, or the corner logo, pressed during the spinner. The answer arrives
       with the reader somewhere else, and that page did nothing wrong. Sol,
       finding 3. */
    let at = "https://www.spideryarn.com/changelog";
    let answer: (r: Response) => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;
    const d = deps({ fetch: slow, address: () => at });

    const deciding = reloadIfStale(d);
    at = "https://www.spideryarn.com/read/an-article";
    answer(new Response(JSON.stringify(THEIR_STAMP)));

    expect(await deciding).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(reloadedFor(d.storage), "the one reload is not spent on nothing").toEqual([]);
  });

  it("does not reload when there is nowhere to remember that it did", async () => {
    expect(await reloadIfStale(deps({ storage: null }))).toBe(false);

    /* Present but refusing, which is what a blocked or full store does. The
       write is what has to land *before* the reload, so a store that reads and
       cannot write is the same as no store. */
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
    };
    const d = deps({ storage: refusing });
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();

    /* And one that takes the write and keeps nothing. */
    const forgetful = { getItem: () => null, setItem: () => {} };
    const f = deps({ storage: forgetful });
    expect(await reloadIfStale(f)).toBe(false);
    expect(f.reload).not.toHaveBeenCalled();
  });
});

/**
 * **The watcher: is a different build live?** Asked when the page wakes and
 * every fifteen minutes while it is being looked at, and never otherwise.
 * docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md.
 *
 * The document, the clock and the network are all stand-ins: `wake()` is what
 * `visibilitychange` and `pageshow` both do, `tick()` is the timer coming due.
 */
function world(over: Partial<DeployWatchDeps> = {}) {
  let visible = true;
  const wakers = new Set<() => void>();
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  /** What `/build.json` says next; `null` is a request that fails. */
  let answer: unknown = MINE_STAMP;
  const fetchFn = vi.fn(async () => {
    if (answer === null) throw new TypeError("Load failed");
    return new Response(JSON.stringify(answer));
  });
  const d: DeployWatchDeps = {
    production: true,
    mine: MINE,
    fetch: fetchFn as unknown as typeof fetch,
    timeoutMs: 1000,
    everyMs: CHECK_EVERY_MS,
    visible: () => visible,
    onWake(wake) {
      wakers.add(wake);
      return () => void wakers.delete(wake);
    },
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
    ...over,
  };
  /** Let a check that has started run to its end. */
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    deps: d,
    fetchFn,
    timers,
    wakers,
    settle,
    serve(next: unknown) {
      answer = next;
    },
    async show() {
      visible = true;
      for (const w of [...wakers]) w();
      await settle();
    },
    async hide() {
      visible = false;
      for (const w of [...wakers]) w();
      await settle();
    },
    /** `pageshow`, which says nothing about being visible. */
    async pageshow() {
      for (const w of [...wakers]) w();
      await settle();
    },
    async tick() {
      const due = [...timers.entries()];
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
      await settle();
    },
  };
}

const OTHER_STAMP = { commit: "c".repeat(40), builtAt: "2026-10-04T08:00:00.000Z" };
const OTHER = `${OTHER_STAMP.commit} ${OTHER_STAMP.builtAt}`;

describe("the deploy watcher", () => {
  it("is fifteen minutes between checks", () => {
    expect(CHECK_EVERY_MS).toBe(15 * 60_000);
  });

  it("asks once when it is installed, if the page is visible", async () => {
    const w = world();
    createDeployWatch().start(w.deps);
    await w.settle();
    expect(w.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all off a production build — the dev server has a stamp too", async () => {
    /* Sol's F7: Vite's dev client installs the `define`d stamp, so "no stamp"
       was never the gate it was taken for. */
    const w = world({ production: false });
    createDeployWatch().start(w.deps);
    await w.show();
    expect(w.fetchFn).not.toHaveBeenCalled();
    expect(w.wakers.size, "it does not even listen").toBe(0);
    expect(w.timers.size).toBe(0);
  });

  it("does nothing when this copy has no stamp to compare", async () => {
    const w = world({ mine: null });
    createDeployWatch().start(w.deps);
    await w.show();
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it("asks when the page becomes visible", async () => {
    const w = world();
    createDeployWatch().start(w.deps);
    await w.hide();
    w.fetchFn.mockClear();
    await w.show();
    expect(w.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("never starts a check while hidden — not at install, not on pageshow, not from a timer", async () => {
    const w = world();
    await w.hide();
    createDeployWatch().start(w.deps);
    await w.settle();
    /* `pageshow` fires on first load and for a page restored in the
       background; it does not mean anybody can see it. Sol's F9. */
    await w.pageshow();
    await w.tick();
    expect(w.fetchFn).not.toHaveBeenCalled();
  });

  it("asks again every fifteen minutes while visible", async () => {
    const w = world();
    createDeployWatch().start(w.deps);
    await w.settle();
    expect([...w.timers.values()].map((t) => t.ms)).toEqual([CHECK_EVERY_MS]);
    await w.tick();
    await w.tick();
    expect(w.fetchFn).toHaveBeenCalledTimes(3);
    expect(w.timers.size, "and one timer waiting, not one per check").toBe(1);
  });

  it("cancels its timer while hidden, and starts again on the way back", async () => {
    const w = world();
    createDeployWatch().start(w.deps);
    await w.settle();
    await w.hide();
    expect(w.timers.size).toBe(0);
    await w.show();
    expect(w.timers.size).toBe(1);
  });

  it("arms the next check after one that failed", async () => {
    const w = world();
    w.serve(null);
    createDeployWatch().start(w.deps);
    await w.settle();
    expect(w.timers.size).toBe(1);
    await w.tick();
    expect(w.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("has at most one request in flight, however many times the page wakes", async () => {
    let answerNow: (r: Response) => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answerNow = resolve;
        }),
    );
    const w = world({ fetch: slow as unknown as typeof fetch });
    createDeployWatch().start(w.deps);
    await w.show();
    await w.pageshow();
    expect(slow).toHaveBeenCalledTimes(1);
    answerNow(new Response(JSON.stringify(MINE_STAMP)));
    await w.settle();
    await w.show();
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("remembers a different build, and goes on checking afterwards", async () => {
    /* Sol's F5. "Once it knows, it stops" was the first plan, and it is wrong:
       a reload can land on the old shell again, and then a later deploy would
       never be noticed. */
    const w = world();
    const watch = createDeployWatch();
    watch.start(w.deps);
    await w.settle();
    expect(watch.seen()).toBeNull();

    w.serve(THEIR_STAMP);
    await w.tick();
    expect(watch.seen()).toBe(THEIRS);
    expect(w.timers.size, "still armed").toBe(1);

    w.serve(OTHER_STAMP);
    await w.tick();
    expect(watch.seen()).toBe(OTHER);

    /* A rollback to this very build: there is nothing to reload for any more. */
    w.serve(MINE_STAMP);
    await w.tick();
    expect(watch.seen()).toBeNull();
  });

  it("keeps what it knew when a check fails — a failure is not an answer", async () => {
    const w = world();
    const watch = createDeployWatch();
    w.serve(THEIR_STAMP);
    watch.start(w.deps);
    await w.settle();
    w.serve(null);
    await w.tick();
    expect(watch.seen()).toBe(THEIRS);
  });

  it("tells a subscriber the answer it already has, at the moment of subscribing", async () => {
    /* The notice can arrive while `/changelog`'s own code is still loading, so
       a subscriber told only of *changes* would never hear of it. Sol's F9. */
    const w = world();
    const watch = createDeployWatch();
    w.serve(THEIR_STAMP);
    watch.start(w.deps);
    await w.settle();

    const heard: (string | null)[] = [];
    watch.subscribe((b) => heard.push(b));
    expect(heard).toEqual([THEIRS]);
  });

  it("tells subscribers after every check that got an answer, so a refused reload is tried again", async () => {
    const w = world();
    const watch = createDeployWatch();
    const heard: (string | null)[] = [];
    const stop = watch.subscribe((b) => heard.push(b));
    expect(heard, "nothing known yet").toEqual([null]);

    w.serve(THEIR_STAMP);
    watch.start(w.deps);
    await w.settle();
    await w.tick();
    expect(heard).toEqual([null, THEIRS, THEIRS]);

    /* Not after one that failed: there is no news in it. */
    w.serve(null);
    await w.tick();
    expect(heard).toEqual([null, THEIRS, THEIRS]);

    stop();
    w.serve(THEIR_STAMP);
    await w.tick();
    expect(heard, "and not after it has unsubscribed").toHaveLength(3);
  });

  it("is installed once: a second start adds no second listener or timer", async () => {
    const w = world();
    const watch = createDeployWatch();
    watch.start(w.deps);
    watch.start(w.deps);
    await w.settle();
    expect(w.wakers.size).toBe(1);
    expect(w.fetchFn).toHaveBeenCalledTimes(1);
  });
});

/**
 * **The one page that reloads itself for a new build**, `/changelog`, and the
 * decision it makes each time the watcher speaks. Every refusal is here: the
 * failure that matters is a reload that takes something from the reader.
 */
describe("reloadForNewBuild", () => {
  type Deps = ReloadForNewBuildDeps & { reload: ReturnType<typeof vi.fn> };
  const page = (over: Partial<ReloadForNewBuildDeps> = {}): Deps =>
    ({
      visible: () => true,
      onPage: () => true,
      safe: () => true,
      storage: memory(),
      reload: vi.fn(),
      ...over,
    }) as Deps;

  it("reloads for a different build, and notes it first", () => {
    const d = page();
    expect(reloadForNewBuild(THEIRS, d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(reloadedFor(d.storage)).toEqual([THEIRS]);
  });

  it("does nothing when no different build has been seen", () => {
    const d = page();
    expect(reloadForNewBuild(null, d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does not reload a second time for the same build", () => {
    const d = page();
    reloadForNewBuild(THEIRS, d);
    expect(reloadForNewBuild(THEIRS, d)).toBe(false);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload while the page is hidden, and spends nothing; it does once it is seen again", () => {
    /* The check began with the page visible and its answer arrived after the
       reader had switched away. */
    let visible = false;
    const d = page({ visible: () => visible });
    expect(reloadForNewBuild(THEIRS, d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(reloadedFor(d.storage)).toEqual([]);

    visible = true;
    expect(reloadForNewBuild(THEIRS, d)).toBe(true);
  });

  it("does not reload once the reader has gone to another page", () => {
    const d = page({ onPage: () => false });
    expect(reloadForNewBuild(THEIRS, d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(reloadedFor(d.storage)).toEqual([]);
  });

  it("does not reload while something would be lost, and does at the next notice once it would not", () => {
    let safe = false;
    const d = page({ safe: () => safe });
    expect(reloadForNewBuild(THEIRS, d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(reloadedFor(d.storage), "a refusal does not spend the reload").toEqual([]);

    safe = true;
    expect(reloadForNewBuild(THEIRS, d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload with nowhere to remember that it did", () => {
    const d = page({ storage: null });
    expect(reloadForNewBuild(THEIRS, d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does not reload for a build the lazy-route recovery already reloaded for, and the other way round", async () => {
    /* One note, two callers (Sol's F6). Each line is a new document over the
       same `sessionStorage`, with the shell stuck on this build. */
    const storage = memory();
    expect(await reloadIfStale(deps({ storage }))).toBe(true);
    expect(reloadForNewBuild(THEIRS, page({ storage }))).toBe(false);

    expect(reloadForNewBuild(OTHER, page({ storage }))).toBe(true);
    expect(await reloadIfStale(deps({ storage, fetch: answering(OTHER_STAMP) }))).toBe(false);
  });

  it("reloads at most once each when the answers alternate B, C, B across reloads", () => {
    const storage = memory();
    const reloads = [THEIRS, OTHER, THEIRS, OTHER, THEIRS].map((build) =>
      reloadForNewBuild(build, page({ storage })),
    );
    expect(reloads).toEqual([true, true, false, false, false]);
  });
});
