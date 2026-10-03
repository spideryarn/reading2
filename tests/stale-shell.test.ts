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
  RELOADED_FOR_KEY,
  buildIdentity,
  reloadIfStale,
  serverBuild,
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
    expect(d.storage?.getItem(RELOADED_FOR_KEY)).toBe(THEIRS);
  });

  it("reloads when the same commit has been built again — its files are different files", async () => {
    /* A redeploy: the changelog's line 6 is one. The build time is compiled in,
       so the hashes move though the commit does not. Sol, finding 2. */
    const d = deps({ fetch: answering({ commit: MINE_SHA, builtAt: "2026-10-03T09:00:00.000Z" }) });
    expect(await reloadIfStale(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload twice for the same build — the message, not a loop", async () => {
    const d = deps({ storage: memory({ [RELOADED_FOR_KEY]: THEIRS }) });
    expect(await reloadIfStale(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("does reload again for a build other than the one it last reloaded for", async () => {
    const d = deps({ storage: memory({ [RELOADED_FOR_KEY]: `${"a".repeat(40)} 2026-10-02T00:00:00.000Z` }) });
    expect(await reloadIfStale(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
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
    expect(d.storage?.getItem(RELOADED_FOR_KEY), "the one reload is not spent on nothing").toBeNull();
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
