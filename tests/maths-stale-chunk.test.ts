// @vitest-environment jsdom
/**
 * **temml that will not load, in a copy of the app older than the deploy.**
 *
 * temml is a lazy chunk (src/web/maths.ts § `loadTemml`). A copy opened from a
 * home-screen icon outlives several deploys, and after one the chunk it asks
 * for is gone: the import rejects and the reader got raw TeX, with nothing
 * said and nothing tried. The two lazy routes already had a recovery for this
 * (src/web/LazyPage.tsx § `orReloadIfStale`); this file is about the maths
 * getting the same one, and about the three ways it could have gone wrong.
 * docs/plans/261005h, Stage A, and GPT Sol's P-1 and P-2 on that plan.
 *
 *  - **The article is held back until the check has answered** (P-1). Handed
 *    over at once, the reader could start a comment or a criterion, neither of
 *    which `safeToReload()` knows about, and the reload would land on it.
 *  - **A load the reader has already left asks nothing** (P-2). The import
 *    goes on after the abort, and a check begun then would read the address of
 *    the page they went to.
 *  - **Leaving while the check is pending** is `reloadIfStale`'s own address
 *    comparison, exercised here through the real function.
 *
 * temml itself is mocked to fail, so the default loader is what rejects. The
 * timing cases inject a loader and a recovery they can hold open.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderTex } from "../src/maths-tex.js";
import type { Article, Block } from "../src/types.js";
import type { StaleShellDeps } from "../src/web/stale-shell.js";

vi.mock("temml", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

const defaultRecovery = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../src/web/stale-shell.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/stale-shell.js")>()),
  reloadIfStale: defaultRecovery,
}));

const { renderArticleMaths } = await import("../src/web/maths.js");
const { reloadIfStale } = await vi.importActual<typeof import("../src/web/stale-shell.js")>(
  "../src/web/stale-shell.js",
);

const FAKE: RenderTex = () => "<math><mi>x</mi></math>";

function withMaths(): Article {
  const block = {
    id: "spya-aaaaaa",
    tag: "p",
    kind: "paragraph",
    text: "",
    words: 0,
    html: String.raw`<p>\(x^2\)</p>`,
    gistable: true,
  } as unknown as Block;
  return { slug: "maths", title: "Maths", blocks: [block] } as unknown as Article;
}

/** A promise and the two ways to end it. */
function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every promise that can settle, settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const MINE = "5b76945908127d48826be1d0283596e753a15f80 2026-10-03T07:40:33.000Z";
const THEIR_STAMP = {
  commit: "d3f34a0f89c7d865166da7d4e1e034f43de4c3d3",
  builtAt: "2026-10-03T17:33:40.390Z",
};

/** A `sessionStorage` that is only a map. */
function memory() {
  const kept = new Map<string, string>();
  return {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
  };
}

/** A world where a different build is live, and `/build.json` answers when told to. */
function staleWorld(over: Partial<StaleShellDeps> = {}) {
  const asked = held<Response>();
  const reload = vi.fn();
  const deps: StaleShellDeps = {
    mine: MINE,
    fetch: (() => asked.promise) as unknown as typeof fetch,
    storage: memory(),
    reload,
    address: () => "https://www.spideryarn.com/read/a-paper",
    safe: () => true,
    timeoutMs: 1000,
    ...over,
  };
  return {
    reload,
    recover: () => reloadIfStale(deps),
    answer: () => asked.resolve(new Response(JSON.stringify(THEIR_STAMP), { status: 200 })),
  };
}

afterEach(() => {
  defaultRecovery.mockClear();
});

describe("the default loader, when the chunk is gone", () => {
  it("asks whether a newer build is live, and hands back the article as it was", async () => {
    const a = withMaths();
    expect(await renderArticleMaths(a)).toBe(a);
    expect(defaultRecovery).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for an article with no maths in it", async () => {
    const a = { ...withMaths(), blocks: [] } as Article;
    expect(await renderArticleMaths(a)).toBe(a);
    expect(defaultRecovery).not.toHaveBeenCalled();
  });

  it("is quiet when the asking itself fails", async () => {
    defaultRecovery.mockRejectedValueOnce(new Error("storage refused"));
    const a = withMaths();
    expect(await renderArticleMaths(a)).toBe(a);
  });
});

describe("a loader somebody passed in", () => {
  it("does not reach for the reload on its own", async () => {
    const a = withMaths();
    const load = async (): Promise<RenderTex> => {
      throw new Error("offline");
    };
    expect(await renderArticleMaths(a, { load })).toBe(a);
    expect(defaultRecovery).not.toHaveBeenCalled();
  });

  it("asks nothing when it loads", async () => {
    const recover = vi.fn(async () => false);
    const out = await renderArticleMaths(withMaths(), { load: async () => FAKE, recover });
    expect(out.blocks[0]!.html).toContain("<math");
    expect(recover).not.toHaveBeenCalled();
  });
});

describe("when the check runs, and what it holds back", () => {
  it("does not ask for a load the reader left before it failed", async () => {
    const stop = new AbortController();
    const loading = held<RenderTex>();
    const recover = vi.fn(async () => true);
    const a = withMaths();
    const out = renderArticleMaths(a, { load: () => loading.promise, signal: stop.signal, recover });
    stop.abort();
    loading.reject(new Error("chunk gone"));
    expect(await out).toBe(a);
    expect(recover).not.toHaveBeenCalled();
  });

  it("does not hand back the article until the check has answered", async () => {
    const checking = held<boolean>();
    const a = withMaths();
    let returned: Article | null = null;
    const out = renderArticleMaths(a, {
      load: async () => {
        throw new Error("chunk gone");
      },
      recover: () => checking.promise,
    }).then((article) => {
      returned = article;
    });
    await settle();
    expect(returned, "the article was on its way to the screen with the check still out").toBeNull();
    checking.resolve(false);
    await out;
    expect(returned).toBe(a);
  });

  it("reloads once when a different build is live and the reader is still there (the control)", async () => {
    const world = staleWorld();
    const out = renderArticleMaths(withMaths(), {
      load: async () => {
        throw new Error("chunk gone");
      },
      recover: world.recover,
    });
    await settle();
    expect(world.reload).not.toHaveBeenCalled();
    world.answer();
    await out;
    expect(world.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload a reader who left while the check was pending", async () => {
    let at = "https://www.spideryarn.com/read/a-paper";
    const stop = new AbortController();
    const world = staleWorld({ address: () => at });
    const a = withMaths();
    const out = renderArticleMaths(a, {
      load: async () => {
        throw new Error("chunk gone");
      },
      signal: stop.signal,
      recover: world.recover,
    });
    await settle();
    at = "https://www.spideryarn.com/read";
    stop.abort();
    world.answer();
    expect(await out).toBe(a);
    expect(world.reload).not.toHaveBeenCalled();
  });

  it("does not reload over words the reader has not sent", async () => {
    const world = staleWorld({ safe: () => false });
    const out = renderArticleMaths(withMaths(), {
      load: async () => {
        throw new Error("chunk gone");
      },
      recover: world.recover,
    });
    world.answer();
    await out;
    expect(world.reload).not.toHaveBeenCalled();
  });
});
