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
 *    The route table, `AUTH_ROUTES`, is not exported, so this reads the file
 *    and looks for a row whose method is `GET` and whose pattern is the kind's —
 *    the pair that makes the URL real. Matching only the pattern would pass a
 *    `POST` for the same path; matching only the method would pass a name that
 *    is not a URL at all.
 *
 * ## A test that chooses its own inputs can lose one and still pass
 *
 * Until 2026-09-02 the chain's dispatch was looked for as `if (<kind> && …)`,
 * which quietly assumed the `const` is always named after the artefact kind.
 * GPT Sol ran the mutation that breaks it: rename `timeline` to `timelineRoute`
 * — a pure refactor — and drop `"/api/timeline/"` from `CACHEABLE`. The suite
 * stayed green with one test fewer, because Timeline had fallen out of the
 * derivation that was supposed to catch exactly that deletion.
 * docs/plans/260902o-adding-a-mode-wave1-a-code-review-sol.md § 1.
 *
 * Since 2026-09-11 every route is a row of `AUTH_ROUTES` and there is no binding
 * to rename, but the lesson is the reason for § *resolves every artefact kind to
 * a route*: the kinds that do not resolve are asserted to be exactly the ones
 * with no URL, so a kind that stops matching is named instead of vanishing.
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
 * The route pattern for one artefact kind, as it is written in src/routes.ts —
 * in a row of `AUTH_ROUTES`, or in the module constant a row names:
 *
 *     pattern: /^\/api\/timeline\/([\w.%-]+)$/,
 *
 * Built as a string rather than matched with a regex-over-regexes so that the
 * thing being looked for is legible.
 */
const routePattern = (kind: string) => `/^\\/api\\/${kind}\\/([\\w.%-]+)$/`;

/** So a route pattern can be looked for as itself, inside a bigger regex. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * **The top-level `const` a row names instead of spelling the pattern**, or
 * `null`. A matcher two rows share is one constant both rows name, not a regex
 * spelled out twice (the contract test's § *names each matcher once*), so the
 * glossary's GET row says `pattern: GLOSSARY_PATTERN,`. Moving it
 * (docs/plans/260911d-close-the-route-transition.md) turned § *resolves every
 * artefact kind …* red naming exactly `glossary` — the loud failure this file
 * was built to give — until the constant was resolved here.
 */
const constantHolding = (kind: string): string | null =>
  new RegExp(`^const (\\w+) = ${literally(routePattern(kind))};$`, "m").exec(routesSource)?.[1] ??
  null;

/**
 * **Whether a reader can GET this kind**: a row of `AUTH_ROUTES`, the ordered
 * table every authenticated route lives in. A row writes its method and its
 * pattern on consecutive lines:
 *
 *     method: "GET",
 *     pattern: /^\/api\/sketch\/([\w.%-]+)$/,
 *
 * and **the row is its own dispatch**, so a `GET` row is a served route by
 * construction and there is no separate `if` to look for. The method is part
 * of the match on purpose: a `POST` row for the same pattern is not a read,
 * and must not count as one.
 *
 * **This used to read the `if` chain too** — a `const <binding> = /…/.exec(path)`
 * and then its `if (<binding> && req.method === "GET")` — and resolved a kind in
 * either form while the chain was being emptied into the table. The last slice
 * went on 2026-09-11 (260911d), so that reading was deleted rather than kept as
 * a second way to find a route; a route written back into the chain is refused
 * by tests/authenticated-api-route-contract.test.ts before this file matters.
 *
 * **This is a grep, and a grep is not the right instrument.** The checked AST
 * inventory of `AUTH_ROUTES` lives in that contract test and is not exported;
 * until one parser serves both, § *resolves every artefact kind to a route*
 * below is what stops this one failing quietly.
 */
const tableRowOf = (kind: string): boolean => {
  const constant = constantHolding(kind);
  const spelled = constant === null ? literally(routePattern(kind)) : `(?:${literally(routePattern(kind))}|${constant})`;
  return new RegExp(`method: "GET",\\s*\\n\\s*pattern: ${spelled},\\s*\\n`).test(routesSource);
};

/**
 * **The other side of that derivation, written down**: the kinds `SHAPE` holds
 * that are pipeline stages rather than things a reader may ask for, so
 * `tableRowOf` is *supposed* to be false for them.
 *
 * Without this list, a kind falling out of `servedArtefacts` is indistinguishable
 * from a kind that never belonged there — which is exactly how a Timeline route
 * went missing for a rename in the § above. `resolves every artefact kind to a
 * route` asserts the two lists partition `SHAPE` between them, so a route that
 * stops matching is named here instead of vanishing.
 *
 * `assets` is on this list even though `GET /api/asset/:slug/:hash.:ext` exists:
 * the URL is not `/api/assets/:slug`, so this
 * derivation cannot see it and is not meant to. See § the asset route below.
 */
const ROUTELESS_KINDS = [
  "assets",
  "blocks",
  "extractedHtml",
  "labels",
  "meta",
  "raw",
  "stampedHtml",
  "tree",
];

/** Every artefact kind a reader can fetch on its own, one article at a time. */
const servedArtefacts = Object.keys(SHAPE)
  .filter(tableRowOf)
  .sort((a, b) => a.localeCompare(b));

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
   * **Every miss is named, and this is the assertion the canary above cannot
   * make.** `arrayContaining` is satisfied by a list of exactly those three, so
   * a scan that had lost seven of the ten would still pass it and `it.each`
   * below would quietly run seven tests fewer.
   *
   * A count would only be a canary too: deleting one route while adding another
   * leaves the number alone. So the claim is made **both ways** — the kinds
   * `tableRowOf` could *not* resolve are asserted to be exactly the ones that
   * have no URL, so a kind that stops matching turns up here by name instead of
   * being `filter`ed out, and a kind that gains a route has to leave here
   * deliberately.
   *
   * Which of the two happened is not something this test can tell you, and the
   * two are not interchangeable:
   *
   * - a route genuinely added or removed — edit `ROUTELESS_KINDS`, and say
   *   which in the commit; or
   * - `tableRowOf` has stopped parsing src/routes.ts, because the rows were
   *   reshaped. That is the failure the § above records happening once
   *   already, and it is the likelier of the two.
   *
   * Do not reach for the first explanation without checking the second.
   */
  it("resolves every artefact kind to a route, or names the ones it could not", () => {
    const unbound = Object.keys(SHAPE)
      .filter((kind) => !tableRowOf(kind))
      .sort((a, b) => a.localeCompare(b));
    expect(
      unbound,
      "an artefact kind changed sides: either a route was genuinely added or removed, or `tableRowOf` has stopped matching src/routes.ts and the routes it lost are missing from every test below",
    ).toEqual(ROUTELESS_KINDS);
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
