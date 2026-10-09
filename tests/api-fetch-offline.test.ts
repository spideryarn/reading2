/**
 * `apiFetch` when the network is gone.
 *
 * Two failures live here, and they are different from each other.
 *
 * **The hang.** `apiFetch` asks the Supabase SDK for a token before every
 * request. If the access token has expired — which it has, an hour into any
 * session — the SDK tries to refresh it, and offline that is a retry loop with
 * exponential backoff bounded by its own 30-second tick. So the reader waited
 * about twenty-five seconds and was then told their credentials were bad. These
 * tests hold `getSession()` open forever, which is what that looks like from
 * here, and assert that the request goes out anyway.
 *
 * **The fallback.** A request that fails at the transport layer — no network,
 * DNS gone, the fetch itself throwing — should be answered from the copy we
 * saved last time, if we have one. A request that fails with a *status* should
 * not be: a 401 and a 404 are answers, and hiding an answer behind old data is
 * worse than showing it.
 *
 * The Supabase client and the cache are both mocked. What is under test is the
 * order of operations in `apiFetch`, not IndexedDB and not the SDK.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NONE_YET_AS_NULL_HEADER, type LibraryResponse } from "../src/types.js";
import { parseSource, walkAst } from "./helpers/ts-ast.js";

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
/**
 * The ticket `apiFetch` reserves before it sends, and then hands to the write.
 *
 * Mocked as the identity of the request rather than as a real queue place: this
 * file is about the *order of operations* in `apiFetch`, and what it needs from
 * a ticket is to be able to say "the one taken for this URL, for this owner"
 * when the write goes past.
 */
const ticketFor = vi.fn(async (url: string, userId: string | null) =>
  userId ? { userId, url, epoch: 0, seq: 1 } : null,
);
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: readCache,
  writeCached: writeCache,
  reserveTicket: ticketFor,
  invalidate: invalidateCache,
  cachedSlugs: slugsHeld,
  rememberUser: vi.fn(),
  /* Mutable, because one test below switches accounts *while a request is in
     flight* — the whole point being which of the two answers the cache is
     partitioned under. Reset to "user-1" in `beforeEach`. */
  lastKnownUser: () => signedInAs,
  forgetUser: vi.fn(),
}));

let signedInAs: string | null = "user-1";

const { apiFetch, NONE_YET_AS_NULL } = await import("../src/web/lib/api.js");

/**
 * The seventeen reads that may answer `200 null` — `NONE_YET_AS_NULL` in
 * lib/api.ts. Every artefact read since plan 261007n; the list is
 * src/store/artefact-not-made-yet.ts.
 */
const NONE_YET_READS = [
  "quiz",
  "crossrefs",
  "citations",
  "simple",
  "ideas",
  "faq",
  "timeline",
  "debate",
  "debate-claims",
  "glossary",
  "quotes",
  "tweets",
  "relations",
  "skim",
  "sketch",
  "illustrated",
  "arc",
] as const;

function assertNoneYetInventory(source: string, offlinePattern = NONE_YET_AS_NULL): void {
  /* Use actual call locations: comments must not stand in for a wrapper, and
     every call must be accounted for in the route where it appears. */
  const ast = parseSource(source);
  expect(ast.errors).toHaveLength(0);
  const helperCalls: number[] = [];
  walkAst(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as { type?: string; name?: string };
    if (callee.type === "Identifier" && callee.name === "orNullWhenNotMadeYet") {
      helperCalls.push(node.start as number);
    }
  });
  const BY_SLUG = String.raw`\/\^\\\/api\\\/([a-z-]+)\\\/\(\[\\w\.%-\]\+\)\$\/`;
  /* `GLOSSARY_PATTERN` and its like: a route may name its pattern. */
  const named = new Map<string, string>();
  for (const [, constant, name] of source.matchAll(new RegExp(String.raw`const (\w+) = ${BY_SLUG};`, "g"))) {
    named.set(constant!, name!);
  }
  const wrapped: string[] = [];
  const plain: string[] = [];
  const entries = [...source.matchAll(/kind: "pattern",/g)];
  for (const [index, match] of entries.entries()) {
    const start = match.index + match[0].length;
    const end = entries[index + 1]?.index ?? source.length;
    const entry = source.slice(start, end);
    const calls = helperCalls.filter((at) => at >= start && at < end);
    if (!/^\s*method: "GET",/.test(entry)) {
      expect(calls, "a helper-using entry must resolve to a GET route").toHaveLength(0);
      continue;
    }
    const literal = new RegExp(String.raw`^\s*method: "GET",\s*pattern: ${BY_SLUG},`).exec(entry)?.[1];
    const constant = /^\s*method: "GET",\s*pattern: (\w+),/.exec(entry)?.[1];
    const name = literal ?? (constant ? named.get(constant) : undefined);
    if (!name) {
      expect(calls, "a helper-using GET must have a recognised pattern").toHaveLength(0);
      continue;
    }
    expect(calls.length).toBeLessThanOrEqual(1);
    (calls.length ? wrapped : plain).push(name);
  }
  expect(wrapped, "every helper call must belong to a recognised GET route").toHaveLength(helperCalls.length);
  expect(wrapped.sort()).toEqual([...NONE_YET_READS].sort());

  /* Membership probes alone never see an extra alternative. Check the whole
     expression too, while permitting the names in any order. */
  const names = /\(\?:([a-z|-]+)\)/.exec(offlinePattern.source)?.[1]?.split("|") ?? [];
  expect([...names].sort()).toEqual(wrapped);
  expect(offlinePattern.source).toBe(
    new RegExp(String.raw`^\/api\/(?:${names.join("|")})\/[^/?]+$`).source,
  );
  expect(offlinePattern.flags).toBe("");
  /* The scan saw by-slug GETs that are not artefact reads and so are not
     wrapped — the article itself, its metadata, the works citing it — so the
     equality above was taken over the whole file, not a universe narrowed to
     the wrapped ones (docs/postmortems/261006m-an-exact-inventory-check-silently-narrows-its-universe.md).
     And none of the sixteen is among them. */
  expect(plain).toEqual(expect.arrayContaining(["article", "metadata", "citers"]));
  for (const name of NONE_YET_READS) expect(plain, name).not.toContain(name);
  for (const name of wrapped) expect(offlinePattern.test(`/api/${name}/x`), name).toBe(true);
  for (const name of plain) expect(offlinePattern.test(`/api/${name}/x`), name).toBe(false);
}

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
  signedInAs = "user-1";
  invalidateCache.mockResolvedValue(undefined);
  slugsHeld.mockResolvedValue(new Set<string>());
  getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN-1" } } });
  vi.stubGlobal("navigator", { onLine: true });
});

/** A promise that never settles — the offline refresh, from `apiFetch`'s side. */
const never = () => new Promise<never>(() => {});

/**
 * Let the fire-and-forget save land.
 *
 * **Every "does not save" assertion below needs this**, and finding that out
 * was the point of running them against a deliberately broken whitelist: with
 * `cacheable()` forced to `true` they all still passed, because the write had
 * not happened *yet* rather than because it never would. A negative assertion
 * about an unawaited promise is a test that cannot fail.
 */
const settle = () => new Promise<void>((go) => setTimeout(go, 0));

describe("the token wait cannot hold a request hostage", () => {
  it("sends the request even when getSession never answers", async () => {
    getSession.mockImplementation(never);
    /* The SDK told us about this token before the network died. */
    announce("SIGNED_IN", { access_token: "TOKEN-CACHED" });

    const seen: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      seen.push([url, init]);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const res = await apiFetch("/api/article/x");

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    const headers = new Headers(seen[0]?.[1].headers);
    expect(headers.get("Authorization")).toBe("Bearer TOKEN-CACHED");
  });

  it("still sends when there is no token at all", async () => {
    getSession.mockImplementation(never);
    announce("SIGNED_OUT", null);

    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      seen.push(url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    await apiFetch("/api/library");
    expect(seen).toEqual(["/api/library"]);
  });

  it("does not wait on the SDK at all when the browser says it is offline", async () => {
    /* Not a deadline this time — offline, we should not start the wait. */
    getSession.mockImplementation(never);
    announce("SIGNED_IN", { access_token: "TOKEN-CACHED" });
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { ok: true }, savedAt: 1000 });

    const res = await apiFetch("/api/article/x");
    expect(await res.json()).toEqual({ ok: true });
    /* If we had waited for the deadline this would have taken seconds. */
    expect(getSession).toHaveBeenCalledTimes(0);
  });
});

describe("a saved copy answers a dead network, and nothing else", () => {
  it("serves the cache when fetch throws", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1_723_600_000_000 });

    const res = await apiFetch("/api/article/x");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-spideryarn-offline")).toBe("copy");
    expect(res.headers.get("x-spideryarn-saved-at")).toBe("1723600000000");
    expect(await res.json()).toEqual({ title: "saved" });
  });

  it("re-throws when fetch throws and there is no saved copy", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue(undefined);

    await expect(apiFetch("/api/article/x")).rejects.toThrow(/Failed to fetch/);
  });

  it("does not serve the cache for a 404", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 404 })));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });

    const res = await apiFetch("/api/glossary/x");
    expect(res.status).toBe(404);
    expect(readCache).not.toHaveBeenCalled();
  });

  it("does not serve the cache for a 401", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 401 })));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });

    const res = await apiFetch("/api/article/x");
    expect(res.status).toBe(401);
    expect(readCache).not.toHaveBeenCalled();
  });

  it("does not serve the cache when the caller aborted", async () => {
    const stop = new AbortController();
    const abort = new DOMException("The user aborted a request.", "AbortError");
    vi.stubGlobal("fetch", () => Promise.reject(abort));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });
    stop.abort();

    await expect(apiFetch("/api/article/x", { signal: stop.signal })).rejects.toThrow(
      /aborted/i,
    );
    expect(readCache).not.toHaveBeenCalled();
  });

  it("does not serve the cache for a POST", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { title: "saved" }, savedAt: 1000 });

    await expect(apiFetch("/api/comments/x", { method: "POST" })).rejects.toThrow(
      /Failed to fetch/,
    );
    expect(readCache).not.toHaveBeenCalled();
  });
});

describe("what gets written", () => {
  const jsonOk = () =>
    new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } });

  it("saves a 200 JSON GET on the whitelist", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    const res = await apiFetch("/api/article/x");
    /* The caller must still get an unread body — this is the `clone()`. If the
       save had read the real one, this would be an empty stream, which looks
       exactly like the server returning nothing. */
    expect(await res.json()).toEqual({ a: 1 });
    /* Waited for rather than asserted immediately: the save is deliberately not
       on the caller's critical path, so it lands a turn or two later. */
    await vi.waitFor(() =>
      /* The slug is the fourth argument, and it is what makes eviction work in
         whole articles rather than in loose responses. The third is the ticket
         reserved before the request went out; what matters about it here is
         whose drawer it was taken for. */
      expect(writeCache).toHaveBeenCalledWith(
        "/api/article/x",
        { a: 1 },
        expect.objectContaining({ userId: "user-1", url: "/api/article/x" }),
        "x",
      ),
    );
  });

  /**
   * **A private link's state is never kept, and never served from a copy.**
   *
   * `GET /api/article/<slug>/share-link` answers with the link's key, and its
   * path begins `/api/article/`, which is on the whitelist. Kept, the key
   * would sit in this browser's IndexedDB, and with no connection the card
   * would draw a link that may have been turned off since. The owner's card
   * must say it could not check instead. Plan 261005e.
   */
  it("does not save a private link's state, though its path looks like an article's", async () => {
    const state = () =>
      new Response('{"on":true,"key":"AbCdEfGhIjKlMnOpQrStUv","since":"2026-10-05T10:00:00.000Z"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal("fetch", () => Promise.resolve(state()));
    const res = await apiFetch("/api/article/x/share-link");
    expect((await res.json()).on).toBe(true);
    /* The control, through the same harness: an ordinary article read is saved,
       so the silence above is about this path. */
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/article/x");
    await vi.waitFor(() => expect(writeCache).toHaveBeenCalled());
    await settle();
    expect(writeCache.mock.calls.map((call) => call[0])).toEqual(["/api/article/x"]);
    expect(JSON.stringify(writeCache.mock.calls)).not.toContain("AbCdEfGhIjKlMnOpQrStUv");
  });

  it("and offline it fails, where an article would be read from its copy", async () => {
    readCache.mockResolvedValue({ body: { on: true, key: "AbCdEfGhIjKlMnOpQrStUv" } });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/article/x/share-link")).rejects.toThrow();
    /* The control: the article itself does come back from its copy. */
    const copy = await apiFetch("/api/article/x");
    expect(copy.headers.get("x-spideryarn-offline")).toBe("copy");
  });

  /**
   * **Whose cache a response goes into is decided when the request goes out.**
   *
   * A direct A→B sign-in calls `rememberUser(B)` and never `forgetUser(A)` —
   * that only runs on a null session — so a reply that started as A's and lands
   * after the switch used to be filed under **B**, because both the save and the
   * offline read asked `lastKnownUser()` at the moment they ran. From there it
   * is B opening the app and being shown A's shelf, which since the shelf began
   * painting from this cache on every repeat visit is an ordinary Tuesday rather
   * than a rare offline oddity. GPT Sol, 2026-09-03.
   */
  it("files a reply under the reader who asked for it, not whoever is signed in when it lands", async () => {
    signedInAs = "user-a";
    vi.stubGlobal("fetch", async () => {
      /* The account switch, in the window between the request going out and its
         answer arriving. */
      signedInAs = "user-b";
      return jsonOk();
    });

    await apiFetch("/api/article/x");
    await vi.waitFor(() => expect(writeCache).toHaveBeenCalled());
    expect(writeCache).toHaveBeenCalledWith(
      "/api/article/x",
      { a: 1 },
      expect.objectContaining({ userId: "user-a" }),
      "x",
    );
  });

  /**
   * **And the drawer is the token's, not the clock's.**
   *
   * Capturing `lastKnownUser()` at the top of `apiFetch` closed the window that
   * spanned the round trip and left a smaller one open in front of it: the
   * session can change *while the token is being fetched*, so the request goes
   * out with B's token and the reply is filed under A. The id therefore comes
   * out of the same session object as the token. GPT Sol's second review,
   * 2026-09-03 — his phrase for the rule was "the same session snapshot".
   */
  it("files a reply under the token's reader when the account changes during sign-in", async () => {
    signedInAs = "user-a";
    /* The switch lands inside `getSession()`: by the time a token exists it is
       B's, and B is who the server will check. */
    getSession.mockImplementation(async () => {
      signedInAs = "user-b";
      return { data: { session: { access_token: "TOKEN-B", user: { id: "user-b" } } } };
    });
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));

    await apiFetch("/api/article/x");
    await vi.waitFor(() => expect(writeCache).toHaveBeenCalled());
    expect(writeCache).toHaveBeenCalledWith(
      "/api/article/x",
      { a: 1 },
      expect.objectContaining({ userId: "user-b" }),
      "x",
    );
  });

  it("reads a saved copy from the partition of the reader who asked, when the transport fails", async () => {
    signedInAs = "user-a";
    vi.stubGlobal("fetch", () => {
      signedInAs = "user-b";
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    readCache.mockResolvedValue({ body: { a: 1 }, savedAt: 5 });

    await apiFetch("/api/article/x");
    expect(readCache).toHaveBeenCalledWith("/api/article/x", "user-a");
  });

  it("does not save an endpoint that is not on the whitelist", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/jobs");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("does not save a 404", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 404 })));
    await apiFetch("/api/glossary/x");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  /**
   * **A `200 null` is "not made yet", and is not kept either** — the answer
   * the three always-mounted reads ask for in place of that 404 (plan 261006g).
   *
   * The copy is filed under reader and URL and replayed as a 200 whatever the
   * request's headers, so a `null` kept by this tab would be handed, offline,
   * to a tab opened before the deploy — which reads `loaded.quiz` off it and
   * shows an error. Not keeping it is also exactly what the 404 did: a copy
   * of a real artefact saved earlier is left alone, not replaced and not
   * thrown away.
   */
  for (const url of NONE_YET_READS.map((name) => `/api/${name}/x`)) {
    it(`does not save a null from ${url}, nor disturb the copy it has`, async () => {
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
        ),
      );
      const res = await apiFetch(url);
      expect(await res.json()).toBeNull();
      await settle();
      expect(writeCache).not.toHaveBeenCalled();
      expect(invalidateCache).not.toHaveBeenCalled();
    });

    it(`replays the earlier real copy of ${url} to an old tab after an opted-in null`, async () => {
      const body = { artefact: "earlier real copy" };
      readCache.mockResolvedValue({ body, savedAt: 123 });
      vi.stubGlobal("fetch", () => Promise.resolve(new Response("null", {
        status: 200, headers: { "content-type": "application/json" },
      })));
      const none = await apiFetch(url, { headers: { [NONE_YET_AS_NULL_HEADER]: "1" } });
      expect(await none.json()).toBeNull();
      await settle();
      expect(writeCache).not.toHaveBeenCalled();
      expect(invalidateCache).not.toHaveBeenCalled();

      vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
      const copy = await apiFetch(url);
      expect(copy.headers.get("x-spideryarn-offline")).toBe("copy");
      expect(await copy.json()).toEqual(body);
    });

    it(`${url} still fails offline when no copy was saved`, async () => {
      vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
      await expect(apiFetch(url, { headers: { [NONE_YET_AS_NULL_HEADER]: "1" } })).rejects.toThrow("offline");
    });
  }

  /**
   * **The routes that may answer `200 null` and the URLs whose `null` is not
   * kept are one list, written in two files.** A route moved over without its
   * name here would have its `null` saved and replayed offline to an old tab;
   * a name here without its route would only be dead. Read off the source of
   * src/routes.ts, since which handlers call the helper is not something a
   * request can ask.
   */
  it("matches exactly the GET routes that go through orNullWhenNotMadeYet", () => {
    const source = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
    assertNoneYetInventory(source);
  });

  it("refuses a wrapped GET whose pattern the inventory cannot recognise", () => {
    const source = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
    const fixture = source.replace('const AUTH_ROUTES: readonly AuthRoute[] = [', String.raw`const AUTH_ROUTES: readonly AuthRoute[] = [
      { kind: "pattern", method: "GET", pattern: /^\/api\/extra\/([\w-]+)$/,
        handler: async () => { await orNullWhenNotMadeYet({ req, res }, load); } },`);
    expect(fixture).not.toBe(source);
    expect(() => assertNoneYetInventory(fixture)).toThrow();
  });

  it("does not let a commented wrapper compensate for an unrecognised real call", () => {
    const source = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
    const fixture = source
      .replace("const found = await orNullWhenNotMadeYet(", "/* await orNullWhenNotMadeYet( */ const found = await unwrappedRead(")
      .replace('const AUTH_ROUTES: readonly AuthRoute[] = [', String.raw`const AUTH_ROUTES: readonly AuthRoute[] = [
        { kind: "pattern", method: "GET", pattern: /^\/api\/extra\/([\w-]+)$/,
          handler: async () => { await orNullWhenNotMadeYet({ req, res }, load); } },`);
    expect(fixture).not.toBe(source);
    expect(() => assertNoneYetInventory(fixture)).toThrow();
  });

  it("refuses an offline-pattern name with no wrapped route", () => {
    const source = readFileSync(new URL("../src/routes.ts", import.meta.url), "utf8");
    const extra = new RegExp(NONE_YET_AS_NULL.source.replace("(?:", "(?:extra|"));
    expect(extra.test("/api/extra/x")).toBe(true);
    expect(() => assertNoneYetInventory(source, extra)).toThrow();
  });

  it("does not save a response that is not JSON", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    await apiFetch("/api/article/x");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("a failed cache write does not fail the request", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    writeCache.mockRejectedValue(new Error("QuotaExceededError"));

    const res = await apiFetch("/api/article/x");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe("a write makes our copy wrong, so it throws the copy away", () => {
  it("invalidates the article's chat after a successful POST", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
    await apiFetch("/api/chat/gibbon", { method: "POST" });
    await vi.waitFor(() => expect(invalidateCache).toHaveBeenCalledWith("/api/chat/gibbon", "user-1"));
  });

  it("invalidates the whole thread list when one thread is deleted", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 204 })));
    await apiFetch("/api/chat/gibbon/thread-9", { method: "DELETE" });
    /* Not `/api/chat/gibbon/thread-9` — the list is what went stale. */
    await vi.waitFor(() => expect(invalidateCache).toHaveBeenCalledWith("/api/chat/gibbon", "user-1"));
  });

  it("invalidates both shelf and Metadata copies after a successful tag edit", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
    await apiFetch("/api/library/gibbon/tags", { method: "PATCH", body: "{}" });

    await vi.waitFor(() => {
      expect(invalidateCache).toHaveBeenCalledWith("/api/library", "user-1");
      expect(invalidateCache).toHaveBeenCalledWith("/api/metadata/gibbon", "user-1");
    });
  });

  it("keeps shelf and Metadata copies when a tag edit failed", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 400 })));
    await apiFetch("/api/library/gibbon/tags", { method: "PATCH", body: "{}" });
    await settle();

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("does not invalidate when the write failed", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 500 })));
    await apiFetch("/api/comments/gibbon", { method: "POST" });
    await settle();
    expect(invalidateCache).not.toHaveBeenCalled();
  });
});

/**
 * **The fixtures here are the shape `GET /api/library` really sends.**
 *
 * `src/routes.ts` answers `{ articles: [...] }` — an envelope, not a bare
 * array — and for the first fortnight of its life the filter below tested
 * `Array.isArray(body)` and so never ran once. The test that was meant to cover
 * it invented a bare array, a shape the server has never produced, and passed
 * against code that did nothing. docs/postmortems/260903e-offline-shelf-filter-never-ran.md.
 *
 * So the two cases are deliberately kept apart: the shape that **is** produced
 * gets filtered, and the shapes that are merely **tolerated** pass through. If
 * they are ever the same fixture again, the second one is silently standing in
 * for the first.
 */
describe("the offline shelf offers only what it can open", () => {
  /* Exactly what the route sends, and **declared as such**: `LibraryResponse`
     is the type `src/routes.ts` annotates its own `send(...)` with, so a
     fixture that drifted back to a bare array would now fail `npm run
     typecheck` rather than quietly testing a shape nobody produces. This
     is deliberately **not** a cast — `as LibraryResponse` would accept a bare
     array again and be exactly the reassurance that failed here. Keyed off
     `keyof` instead, so the envelope's key is checked while the entries stay
     minimal; a real one has a dozen fields none of which this file cares
     about. */
  const shelf: Record<keyof LibraryResponse, { slug: string }[]> = {
    articles: [{ slug: "kept" }, { slug: "evicted" }],
  };

  it("drops entries whose prose we no longer hold, keeping the envelope", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: shelf, savedAt: 1000 });
    slugsHeld.mockResolvedValue(new Set(["kept"]));

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual({ articles: [{ slug: "kept" }] });
  });

  it("keeps the rest of the envelope untouched", async () => {
    /* `archived` is **not** a field the route sends today — it is a stand-in
       for the next one somebody adds. The property under test is that the
       filter rebuilds the envelope rather than replacing it, so a body saved by
       a newer deployment keeps whatever else it was carrying. */
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({
      body: { articles: [{ slug: "kept" }, { slug: "evicted" }], archived: false },
      savedAt: 1000,
    });
    slugsHeld.mockResolvedValue(new Set(["kept"]));

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual({ articles: [{ slug: "kept" }], archived: false });
  });

  it("passes an unexpected legacy shape through unchanged", async () => {
    /* A bare array is what an older deployment might have saved, and what the
       filter used to be written against. It is tolerated, not expected — so it
       is returned whole rather than filtered or emptied. */
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: [{ slug: "kept" }, { slug: "evicted" }], savedAt: 1000 });
    slugsHeld.mockResolvedValue(new Set(["kept"]));

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual([{ slug: "kept" }, { slug: "evicted" }]);
  });

  it("leaves an unexpected shape alone rather than emptying the shelf", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { entries: "surprise" }, savedAt: 1000 });

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual({ entries: "surprise" });
  });

  it("leaves an envelope whose articles are not a list alone", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { articles: "surprise" }, savedAt: 1000 });

    const res = await apiFetch("/api/library");
    expect(await res.json()).toEqual({ articles: "surprise" });
  });

  it("does not filter an article payload", async () => {
    /* The shelf's own shape, asked for down a different path: what stops the
       filter here is the path, and nothing else — so the fixture has to be one
       the filter would otherwise bite. */
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    readCache.mockResolvedValue({ body: { articles: [{ slug: "evicted" }] }, savedAt: 1000 });
    slugsHeld.mockResolvedValue(new Set(["kept"]));

    const res = await apiFetch("/api/article/x");
    expect(await res.json()).toEqual({ articles: [{ slug: "evicted" }] });
  });
});

describe("the media type is parsed, not searched", () => {
  it("saves application/json with a charset", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response('{"a":1}', {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    await apiFetch("/api/article/x");
    await vi.waitFor(() => expect(writeCache).toHaveBeenCalled());
  });

  it("does not save a type that merely contains the words", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("nope", {
          status: 200,
          headers: { "content-type": "text/html+application/json-ish" },
        }),
      ),
    );
    await apiFetch("/api/article/x");
    await settle();
    expect(writeCache).not.toHaveBeenCalled();
  });
});

/**
 * **A write that leaves our copy's questions correct must not throw it away.**
 *
 * `POST /api/quiz/<slug>/mark` marks one answer against one question and
 * streams the marking back; it changes nothing about the questions. (Until
 * 2026-10-05 it stored no quiz state at all. It now keeps each finished mark,
 * which `GET /api/quiz/<slug>` returns as `attempts` — so the copy is one
 * answer behind after a mark, and is brought up to date by the read
 * `useQuiz.mark` makes afterwards rather than by eviction: see
 * `leavesCachedResourceCurrent` in src/web/lib/api.ts, and the last case
 * below.) `resourceOf` maps the mark to
 * `/api/quiz/<slug>` all the same, because it maps a URL to *its own* resource
 * and cannot know what this one leaves alone. So the reader's quiz was evicted
 * by the act of answering a question of it, and adding `/api/quiz/` to
 * `CACHEABLE` on its own would have bought them exactly one question offline.
 * GPT Sol found it reviewing T0.1;
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md.
 *
 * ## The store is real here, and that is the point
 *
 * Every other test in this file asserts on the `invalidate` **call**, which is
 * the cause. The cause is what a wrong fix would go on looking right about: an
 * exemption that names the wrong path still passes *"invalidate was not called
 * with the string I expected"*. So this block gives the mocked store a Map and
 * the real prefix semantics of `invalidate`, and asserts the **effect** the
 * reader gets — the copy is still served when the network goes.
 * docs/reusable/silent-success.md.
 */
describe("marking an answer keeps the quiz it did not change", () => {
  /** url → body, for the one user these tests have. */
  let held: Map<string, unknown>;

  /** A cacheable 200, the same one the block above uses. */
  const jsonOk = () =>
    new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    held = new Map();
    writeCache.mockImplementation(async (url: string, body: unknown) => {
      held.set(url, body);
    });
    readCache.mockImplementation(async (url: string) =>
      held.has(url) ? { body: held.get(url), savedAt: 1000 } : undefined,
    );
    /* The real thing deletes every row whose url starts with the prefix — see
       `invalidate` in src/web/lib/offline-store.ts. Modelled rather than
       stubbed, so a fix that exempts the quiz by invalidating some *other*
       prefix is not silently harmless here. */
    invalidateCache.mockImplementation(async (prefix: string) => {
      for (const url of [...held.keys()]) if (url.startsWith(prefix)) held.delete(url);
    });
  });

  it("still has the quiz offline after an answer was marked", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/quiz/gibbon");
    await settle();

    vi.stubGlobal("fetch", () => Promise.resolve(new Response("data: ok\n\n", { status: 200 })));
    await apiFetch("/api/quiz/gibbon/mark", { method: "POST", body: "{}" });
    await settle();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const res = await apiFetch("/api/quiz/gibbon");

    expect(res.headers.get("x-spideryarn-offline")).toBe("copy");
    expect(await res.json()).toEqual({ a: 1 });
  });

  /* Kept answers, plan 261005b F1: the mark leaves the copy alone, and the read
     that follows a stored mark is what puts the answer into it. The hook's half
     — that it makes that read, and only after a mark that was stored — is
     tests/quiz-kept-answers.test.tsx. */
  it("has the answer offline too, once the quiz has been read again after the mark", async () => {
    const quiz = (attempts: unknown[]) =>
      new Response(JSON.stringify({ quiz: { batchId: "b" }, attempts }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal("fetch", () => Promise.resolve(quiz([])));
    await apiFetch("/api/quiz/gibbon");
    await settle();

    vi.stubGlobal("fetch", () => Promise.resolve(new Response("data: ok\n\n", { status: 200 })));
    await apiFetch("/api/quiz/gibbon/mark", { method: "POST", body: "{}" });
    await settle();
    /* One answer behind, and still the questions. */
    expect(held.get("/api/quiz/gibbon")).toEqual({ quiz: { batchId: "b" }, attempts: [] });

    vi.stubGlobal("fetch", () => Promise.resolve(quiz([{ questionId: "q", answer: "mine" }])));
    await apiFetch("/api/quiz/gibbon");
    await settle();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const res = await apiFetch("/api/quiz/gibbon");
    expect(res.headers.get("x-spideryarn-offline")).toBe("copy");
    expect(await res.json()).toEqual({
      quiz: { batchId: "b" },
      attempts: [{ questionId: "q", answer: "mine" }],
    });
  });

  it("a partial quiz read cannot roll back a full read that commits while it checks the copy", async () => {
    const quiz = (attempts: unknown) => new Response(JSON.stringify({
      quiz: { batchId: "b" }, attempts,
    }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", () => Promise.resolve(quiz([{ questionId: "q", answer: "old" }])));
    await apiFetch("/api/quiz/gibbon");
    await settle();

    let checked!: () => void;
    const checking = new Promise<void>((resolve) => { checked = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    readCache.mockImplementationOnce(async (url: string) => {
      const earlier = { body: held.get(url), savedAt: 1000 };
      checked();
      await blocked;
      return earlier;
    });
    vi.stubGlobal("fetch", () => Promise.resolve(quiz(null)));
    await apiFetch("/api/quiz/gibbon");
    await checking;

    // Another tab finishes its full read while the partial read holds an old copy.
    vi.stubGlobal("fetch", () => Promise.resolve(quiz([{ questionId: "q", answer: "new" }])));
    await apiFetch("/api/quiz/gibbon");
    await settle();
    release();
    await settle();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const res = await apiFetch("/api/quiz/gibbon");
    expect((await res.json()).attempts).toEqual([{ questionId: "q", answer: "new" }]);
  });

  /* The other direction, so "never invalidate anything" is not a passing
     implementation of the exemption. `PATCH /api/comments/<slug>/<id>/mark` is
     the same last segment on a route that really does write — the referee's own
     placement on a criterion — and its copy has to go. */
  it("but a comment mark is a real write, and its copy goes", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonOk()));
    await apiFetch("/api/comments/gibbon");
    await settle();
    expect(held.has("/api/comments/gibbon")).toBe(true);

    await apiFetch("/api/comments/gibbon/c-1/mark", { method: "PATCH", body: "{}" });
    await settle();

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(apiFetch("/api/comments/gibbon")).rejects.toThrow();
  });
});
