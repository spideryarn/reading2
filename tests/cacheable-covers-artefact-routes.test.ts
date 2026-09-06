/**
 * **Every per-article artefact a reader can GET is kept for offline.**
 *
 * `CACHEABLE` in src/web/lib/api.ts is a hand-written list of URL prefixes, and
 * nothing paired it with the routes. Until 2026-09-02 it listed `/api/glossary/`,
 * `/api/ideas/` and `/api/quotes/` and not `/api/timeline/`, `/api/quiz/`,
 * `/api/sketch/` or `/api/arc/` — so the offline store Greg asked for kept a
 * quotes list and dropped a timeline, for no stated reason. Quotes was added the
 * same week timeline was.
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T0.1.
 *
 * ## Where the list under test comes from, and why that source
 *
 * Not hand-written here — a second hand-written list beside the first proves
 * only that somebody typed the same words twice. It is **derived from the two
 * things the author of a new artefact-backed mode cannot avoid editing**, and a
 * kind has to appear in both:
 *
 * 1. `SHAPE` in src/store/artifacts.ts is a *total* `Record<ArtifactKind, …>`,
 *    so a new artefact kind is a compiler error until it has a row. That makes
 *    `Object.keys(SHAPE)` an enumeration of every kind the pipeline produces
 *    which the type system itself keeps complete.
 * 2. src/routes.ts is where the kind becomes something a reader can ask for.
 *    There is no exported route table — the patterns are `const`s inside
 *    `serveAuthenticatedApi` — so this reads the file and looks for the route
 *    **and its GET dispatch**, which is the pair that makes the URL real.
 *    Matching only the pattern would pass a route that is declared and never
 *    served; matching only `req.method === "GET"` would pass a name that is not
 *    a URL at all.
 *
 * ## The pair is found through the *binding*, not through the kind's name
 *
 * Until 2026-09-02 the dispatch was looked for as `if (<kind> && …)`, which
 * quietly assumed the `const` is always named after the artefact kind. GPT Sol
 * ran the mutation that breaks it: rename `timeline` to `timelineRoute` in both
 * its declaration and its dispatch — a pure refactor that changes no
 * behaviour — and drop `"/api/timeline/"` from `CACHEABLE`. The suite stayed
 * green with one test fewer, because Timeline had fallen out of the derivation
 * that was supposed to catch exactly that deletion. **A test that chooses its
 * own inputs can lose one and still pass.**
 *
 * So the binding name is now captured from the declaration and used to find the
 * dispatch, and `every declared artefact route is answered` below is the
 * control: a rename that breaks the pairing names the kind and goes red instead
 * of shrinking the list. See docs/plans/260902o-adding-a-mode-wave1-a-code-review-sol.md § 1.
 *
 * The intersection drops the pipeline's private kinds (`raw`, `blocks`, `tree`,
 * `labels`, `assets`, …) because none of them has a route, and it drops
 * `/api/similar/` and `/api/projection/` because neither is an `ArtifactKind` —
 * they are POSTs that spend, and a cached answer to one question served for
 * another is exactly what the `CACHEABLE` docstring refuses.
 *
 * ## What is asserted, and against what
 *
 * `cacheable()` is private, so the observable is the one the reader has: a 200
 * JSON GET on a cacheable URL is written to the offline store, and one on a URL
 * that is not is not. That is `apiFetch`'s behaviour, mocked exactly as
 * tests/api-fetch-offline.test.ts mocks it — the Supabase client and the store
 * are stubs, and what is under test is the whitelist.
 *
 * The three deliberate omissions the docstring names are asserted the other
 * way, so "cache everything" is not a passing implementation.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SHAPE } from "../src/store/artifacts.js";

const getSession = vi.fn();
const refreshSession = vi.fn();
let announce: (event: string, session: { access_token: string } | null) => void = () => {};

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      onAuthStateChange: (fn: typeof announce) => {
        announce = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const readCache = vi.fn();
const writeCache = vi.fn();
const invalidateCache = vi.fn();
const slugsHeld = vi.fn();
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: readCache,
  writeCached: writeCache,
  /* The place in the cache's queue `apiFetch` reserves before it sends. Enough
     of one to be handed back to the write, which is all this file looks at. */
  reserveTicket: async (url: string, userId: string | null) =>
    userId ? { userId, url, epoch: 0, seq: 1 } : null,
  invalidate: invalidateCache,
  cachedSlugs: slugsHeld,
  rememberUser: vi.fn(),
  lastKnownUser: () => "user-1",
  forgetUser: vi.fn(),
}));

const { apiFetch } = await import("../src/web/lib/api.js");

const routesSource = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");

/**
 * The route pattern for one artefact kind, as it is written in src/routes.ts:
 *
 *     const timeline = /^\/api\/timeline\/([\w.%-]+)$/.exec(path);
 *
 * Built as a string rather than matched with a regex-over-regexes so that the
 * thing being looked for is legible.
 */
const routePattern = (kind: string) => `/^\\/api\\/${kind}\\/([\\w.%-]+)$/`;

/** And the line that actually answers it. Nothing is a GET route without one. */
const getDispatch = (binding: string) => `if (${binding} && req.method === "GET")`;

/** So a route pattern can be looked for as itself, inside a bigger regex. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * The name the route is bound to, or `null` when the kind has no route at all.
 *
 * Reading it out of the declaration rather than assuming it — the whole of the
 * § above.
 */
const bindingOf = (kind: string): string | null =>
  new RegExp(`const (\\w+) = ${literally(routePattern(kind))}\\.exec\\(path\\)`).exec(
    routesSource,
  )?.[1] ?? null;

/** Every artefact kind with a URL, paired with the name that URL is bound to. */
const declaredRoutes = Object.keys(SHAPE)
  .map((kind) => ({ kind, binding: bindingOf(kind) }))
  .filter((pair): pair is { kind: string; binding: string } => pair.binding !== null)
  .sort((a, b) => a.kind.localeCompare(b.kind));

/** Every artefact kind a reader can fetch on its own, one article at a time. */
const servedArtefacts = declaredRoutes
  .filter(({ binding }) => routesSource.includes(getDispatch(binding)))
  .map(({ kind }) => kind);

/**
 * The reads the docstring on `CACHEABLE` says are left out **on purpose** —
 * work in flight, a per-query model call, and configuration. Quoted from it, so
 * that deleting a reason there and leaving the prefix here is visible.
 */
const DELIBERATELY_NOT_CACHED = ["/api/jobs", "/api/library/search", "/api/models"];

beforeEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  refreshSession.mockReset();
  readCache.mockReset();
  writeCache.mockReset();
  invalidateCache.mockReset();
  slugsHeld.mockReset();
  readCache.mockResolvedValue(undefined);
  writeCache.mockResolvedValue(undefined);
  invalidateCache.mockResolvedValue(undefined);
  slugsHeld.mockResolvedValue(new Set<string>());
  getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-1" } } });
  vi.stubGlobal("navigator", { onLine: true });
});

const jsonOk = () =>
  new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } });

/**
 * Let the fire-and-forget save land.
 *
 * Every "does not save" assertion needs this. Without it a whitelist forced to
 * `true` still passes them all, because the write has not happened *yet* rather
 * than because it never will — tests/api-fetch-offline.test.ts § `settle`.
 */
const settle = () => new Promise<void>((go) => setTimeout(go, 0));

describe("the derivation itself", () => {
  /* If the route file's style changes, the scan above silently returns fewer
     kinds and every assertion below passes by not existing. These three are the
     ones `CACHEABLE` already lists, so they cannot be the bug — they are the
     canary that says the scan still reads src/routes.ts. */
  it("finds the artefact routes that are already cached", () => {
    expect(servedArtefacts).toEqual(expect.arrayContaining(["glossary", "ideas", "quotes"]));
  });

  /**
   * **The control on the scan above**, and the reason the binding is captured.
   *
   * A declared route with no dispatch found through its own binding is either a
   * route nobody answers or — far likelier — a scan that has stopped reading
   * the file, and in the second case every `keeps /api/<kind>/:slug` below
   * disappears rather than fails. Naming the kind here turns a silently
   * shrinking list into a red test that says which one went.
   */
  it("finds a GET dispatch for every artefact route it found a declaration for", () => {
    const unanswered = declaredRoutes
      .filter(({ binding }) => !routesSource.includes(getDispatch(binding)))
      .map(({ kind, binding }) => `${kind} (bound as ${binding})`);
    expect(unanswered).toEqual([]);
  });

  it("does not mistake a pipeline-private kind for a route", () => {
    /* `blocks`, `tree` and `stampedHtml` are `ArtifactKind`s with no URL. If one
       of these appears, the scan is matching something other than a route and
       the list below is noise. */
    expect(servedArtefacts).not.toContain("blocks");
    expect(servedArtefacts).not.toContain("tree");
    expect(servedArtefacts).not.toContain("stampedHtml");
  });
});

describe("every per-article artefact GET survives losing the connection", () => {
  it.each(servedArtefacts)("keeps /api/%s/:slug", async (kind) => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));

    const res = await apiFetch(`/api/${kind}/gibbon`);
    /* The caller still gets an unread body — the save reads a `clone()`. */
    expect(await res.json()).toEqual({ a: 1 });

    await settle();
    /* The slug is the fourth argument, and it is what makes eviction work in
       whole articles rather than in loose responses. Asserting it, rather than
       merely that something was written, is what stops "the URL was on some
       list" passing for "this article's copy is on disk". */
    expect(writeCache).toHaveBeenCalledWith(
      `/api/${kind}/gibbon`,
      { a: 1 },
      expect.objectContaining({ userId: "user-1", url: `/api/${kind}/gibbon` }),
      "gibbon",
    );
  });
});

describe("and the deliberate omissions stay out", () => {
  it.each(DELIBERATELY_NOT_CACHED)("does not keep %s", async (url) => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));

    await apiFetch(url);

    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  /**
   * **The referee's two stored GETs are a decision, not an oversight.**
   *
   * They are not `ArtifactKind`s, so the derivation above cannot see them, and
   * an absence nothing asserts is indistinguishable from a gap. They are left
   * out because `/api/referee/criteria/<slug>` is nested one segment deeper
   * than every other artefact URL: `slugOf` reads path segment 3 and would file
   * every article's criteria under the slug `"criteria"`, and `resourceOf`
   * would map the matching POST to `/api/referee/criteria` and throw away
   * every article's copy on one write. Caching them wants a route-aware case in
   * both, which is a follow-up. `CACHEABLE`'s docstring in
   * src/web/lib/api.ts says the same thing; if that reason is fixed there,
   * this assertion is the thing that has to be deleted deliberately.
   */
  it.each(["/api/referee/criteria/gibbon", "/api/referee/claims/gibbon"])(
    "does not keep %s — nested path, decided rather than forgotten",
    async (url) => {
      vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));

      await apiFetch(url);

      await settle();
      expect(writeCache).not.toHaveBeenCalled();
    },
  );

  /**
   * **And the asset route, which is the one place the header above went stale.**
   *
   * That paragraph says the intersection drops `assets` "because none of them
   * has a route". Since 2026-09-06 it has one —
   * `GET /api/asset/:slug/:hash.:ext`, src/routes.ts § `sendArticleAsset` — and
   * the derivation still misses it, because the binding is `asset` and the kind
   * is `assets`. That near-miss is exactly the shape this file was rewritten to
   * stop being trusted, so the absence is asserted rather than left to a
   * spelling.
   *
   * It is right that it is out. The offline store keeps 200 **JSON** responses;
   * this route answers a PNG, and `rehost.ts` turns it into a `blob:` URL that
   * would be meaningless on a later page load anyway. `/api/illustrated/`'s own
   * line in `CACHEABLE` records the same division for plates.
   */
  it("does not keep an article asset — the offline store is JSON", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));

    await apiFetch(`/api/asset/gibbon/${"a".repeat(64)}.png`);

    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });
});
