/**
 * **Which of the two dispatchers answers, and what neither of them will do.**
 *
 * `docs/plans/260827ai-public-read-only-access.md § How we prove it` asks for a check
 * that the authenticated dispatcher cannot be reached without a user, and says
 * why the obvious version does not exist:
 *
 * > *Not* an enumeration of the route table — there is no route table, only an
 * > `if` chain. Split `servePublicApi()` from `serveAuthenticatedApi()` so the
 * > second is **callable only after `requireUser`**, and test that structural
 * > boundary.
 *
 * So this file tests the boundary rather than the branches. Three things, and
 * GPT Sol named all three on 2026-08-28:
 *
 * 1. An ordinary `AuthedUser` is not assignable to `VerifiedUser`
 *    (`@ts-expect-error`, which the tests project typechecks).
 * 2. `serveAuthenticatedApi(undefined as never, request)` throws **before any
 *    handler or store runs**.
 * 3. A `VerifiedUser` obtained through `requireUser` reaches a real route.
 *
 * Plus the closed namespace: an unknown public path and every non-GET method
 * end inside `/api/public/` rather than falling through into the authenticated
 * table, and every one of those answers carries `Cache-Control: no-store`.
 *
 * **No database.** These tests are about dispatch, so they run under the default
 * filesystem store, where the public reads refuse with a 501 — which is itself
 * the evidence that the route matched and the handler ran. The reads themselves
 * are tested against real Postgres in tests/public-visibility-pg.test.ts.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { type AuthedUser, requireUser, type VerifiedUser } from "../src/auth.js";
import { runInRequest } from "../src/owner.js";
import { pathOf } from "../src/public/route-names.js";
import { PUBLIC_ROUTES } from "../src/public/routes.js";
import { handleApi, serveAuthenticatedApi } from "../src/routes.js";
import { originalUrl } from "../src/vercel.js";
import { acceptAny, AUTHED_HEADERS, TEST_EMAIL } from "./helpers/authed.js";

/** Drive `handleApi` with a fake request/response pair, remembering the headers. */
async function call(
  method: string,
  url: string,
  /** Omitted means the authenticated header. `{}` is an anonymous request. */
  headers: Record<string, string> = {},
): Promise<{ handled: boolean; status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  const req = Object.assign(
    (async function* () {})(),
    { method, url, headers },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const sent: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      sent[name] = value;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  const handled = await handleApi(req, res, acceptAny);
  return { handled, status, headers: sent, body: text ? JSON.parse(text) : {} };
}

/**
 * The envelope `serveAuthenticatedApi` takes, built by hand for the direct calls.
 *
 * `path` and `query` are derived here rather than passed in, because that is what
 * `serveApi` does and a helper that let them disagree with `rawUrl` would hide
 * the very bug tests/the-query-string-does-not-decide-the-route.test.ts is
 * about — this function used to build `{ url, path: url }`, so in every suite
 * that used it the two were the same string.
 */
function envelope(url: string) {
  return {
    req: Object.assign((async function* () {})(), {
      method: "GET",
      url,
      headers: AUTHED_HEADERS,
    }) as unknown as IncomingMessage,
    res: {
      statusCode: 0,
      setHeader() {},
      end() {},
    } as unknown as ServerResponse,
    rawUrl: url,
    path: url.split("?")[0] ?? url,
    query: new URLSearchParams(url.split("?")[1] ?? ""),
  };
}

describe("the authenticated dispatcher's one parameter", () => {
  /**
   * **The type, and it is the whole point of the brand.**
   *
   * A required `AuthedUser` parameter would prevent omission and nothing else,
   * because any `{ id, email }` satisfies it. `VerifiedUser` carries a symbol
   * `src/auth.ts` does not export, so nothing outside that file can make one.
   *
   * `@ts-expect-error` fails the typecheck if the line ever *compiles*, which
   * is this assertion's own positive control: remove the brand from
   * `VerifiedUser` and `npm run typecheck` goes red on this line saying the
   * error was unused.
   */
  it("will not accept a hand-built user, and the typecheck says so", () => {
    /* `…face` is this file's alone, and nothing here ever reaches Postgres — it
       is a user built in memory to be refused. It was `…ed` until 2026-09-05,
       when `public-visibility-pg.test.ts` took the same id for an article it
       really does insert and `fixture-ids.test.ts` caught the pair. Not a
       `NOT_A_ROW` exemption: that key is the uuid, so exempting it would have
       blinded the guard to the neighbour row as well. */
    const impostor: AuthedUser = {
      id: "00000000-0000-4000-8000-00000000face" as AuthedUser["id"],
      email: "someone@example.test",
    };
    // @ts-expect-error an AuthedUser is not a VerifiedUser — that is the brand
    const asVerified: VerifiedUser = impostor;
    expect(asVerified.email).toBe("someone@example.test");
  });

  /**
   * **And at runtime**, because the type is a compile-time promise and `as
   * never`, plain JavaScript and a stale build all get past it.
   *
   * The spy is the load-bearing part rather than decoration: what has to be
   * true is that the refusal happens *before* anything is served, so the test
   * fails if the assertion is moved even one statement down the function.
   */
  it("throws before a single handler runs, given something that never was one", async () => {
    const setHeader = vi.fn();
    const end = vi.fn();
    const request = { ...envelope("/api/library"), res: { statusCode: 0, setHeader, end } as unknown as ServerResponse };

    await expect(
      runInRequest(() => serveAuthenticatedApi(undefined as never, request)),
    ).rejects.toThrow(/did not come from requireUser/);
    expect(end).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("refuses an object that merely looks like a user", async () => {
    const impostor = { id: "00000000-0000-4000-8000-00000000face", email: "x@example.test" };
    await expect(
      runInRequest(() => serveAuthenticatedApi(impostor as never, envelope("/api/library"))),
    ).rejects.toThrow(/did not come from requireUser/);
  });

  /**
   * **The three ways the first version of the brand could be forged**, each of
   * which was demonstrated against the code before it was changed. GPT Sol's
   * finding 1, 2026-08-28.
   *
   * The brand used to be a symbol-keyed property and the check used to read it
   * back — which asks *"does this answer yes"* rather than *"is this the object
   * we made"*. It is now a module-private `WeakSet`, so membership is identity
   * and none of these is the object that was added.
   *
   * The stake is not abstract: whatever id reaches `serveAuthenticatedApi` is
   * the one handed to `setRequestOwner`, and that is the value every store read
   * filters on.
   */
  describe("and the ways it used to be forgeable", () => {
    async function dispatch(user: unknown) {
      return runInRequest(() => serveAuthenticatedApi(user as never, envelope("/api/library")));
    }

    /** A proxy that says `true` to any symbol read. Passed the property check. */
    it("refuses a proxy that answers yes to every symbol", async () => {
      const proxy = new Proxy(
        { id: "00000000-0000-4000-8000-00000000dead", email: "forged@example.test" },
        { get: (target, key) => (typeof key === "symbol" ? true : Reflect.get(target, key)) },
      );
      await expect(dispatch(proxy)).rejects.toThrow(/did not come from requireUser/);
    });

    /**
     * An object *inheriting* from a genuinely branded user, with its own `id`.
     * The property check walked the prototype chain and found the real brand.
     */
    it("refuses an heir of a real user wearing a different id", async () => {
      const req = Object.assign((async function* () {})(), {
        method: "GET",
        url: "/api/library",
        headers: AUTHED_HEADERS,
      }) as unknown as IncomingMessage;
      const real = await requireUser(req, acceptAny);

      /* `defineProperty` rather than assignment, and the reason is itself a
         result: `real` is frozen now, so its `id` is read-only and a plain
         `heir.id = …` *throws* — the freeze blocks the naive version of this
         attack on its own. An own property shadows the inherited one, which
         gets past the freeze and leaves only the identity question, which is
         what this case is here to ask. */
      const heir = Object.create(real) as { id: string };
      Object.defineProperty(heir, "id", {
        value: "00000000-0000-4000-8000-00000000beef",
        enumerable: true,
      });
      /* The inheritance is real — this is not a test of a broken fixture. */
      expect(Object.getPrototypeOf(heir)).toBe(real);
      expect(heir.id).not.toBe(real.id);
      /* And it really does inherit the email, so it is user-shaped throughout. */
      expect(heir).toHaveProperty("email", real.email);

      await expect(dispatch(heir)).rejects.toThrow(/did not come from requireUser/);
    });

    /**
     * And the one no membership test could catch: changing a **real** branded
     * user's id after the gate has vouched for it. `defineProperty` locked the
     * symbol and left `id` writable, so this used to succeed silently and the
     * request would run as somebody else.
     */
    it("will not let a verified user's id be changed after the fact", async () => {
      const req = Object.assign((async function* () {})(), {
        method: "GET",
        url: "/api/library",
        headers: AUTHED_HEADERS,
      }) as unknown as IncomingMessage;
      const real = await requireUser(req, acceptAny);
      const before = real.id;

      /* Non-strict assignment on a frozen object is silently ignored rather than
         throwing, and vitest runs as a module, so the assertion is the *value*
         rather than a rejection — checking for a throw would pass on a freeze
         that had been removed in a non-strict context. */
      expect(() => {
        (real as { id: string }).id = "00000000-0000-4000-8000-00000000cafe";
      }).toThrow();
      expect(real.id).toBe(before);
      expect(Object.isFrozen(real)).toBe(true);
    });
  });

  /**
   * **The positive control, and the three above are worthless without it.**
   *
   * A boundary that refuses everything passes every refusal test ever written.
   * `requireUser` is the only thing that can make a `VerifiedUser`, and this is
   * the proof that what it makes is accepted.
   */
  it("accepts what requireUser produces, and routes it", async () => {
    /**
     * **`/api/models`, and the route matters.**
     *
     * This asserted `/api/library` inside a `try` that swallowed every store
     * error, so it proved only that the *brand* check passed — inserting
     * `return` immediately after `assertVerifiedUser` left it green, which
     * makes it a control that had stopped controlling anything. GPT Sol's
     * finding 5, 2026-08-28.
     *
     * `/api/models` is a read of two constants: no database, no store, no
     * network, so it either answers or it does not and there is nothing to
     * swallow. Asserting the *body* is what makes this prove a handler ran
     * rather than that nothing threw.
     */
    const req = Object.assign((async function* () {})(), {
      method: "GET",
      url: "/api/models",
      headers: AUTHED_HEADERS,
    }) as unknown as IncomingMessage;
    const user = await requireUser(req, acceptAny);
    /* `TEST_EMAIL`, not the address longhand: this is asserting who
       `AUTHED_HEADERS` authenticates as, and a copied string stops tracking
       that the moment the fixture identity changes — which it did on
       2026-09-02. */
    expect(user.email).toBe(TEST_EMAIL);

    let status = 0;
    let text = "";
    const res = {
      set statusCode(v: number) {
        status = v;
      },
      get statusCode() {
        return status;
      },
      setHeader() {},
      end(chunk: string) {
        text = chunk ?? "";
      },
    } as unknown as ServerResponse;

    /* Typechecks without a cast, which is half the assertion. The other half is
       below: a real response, from a real handler, behind the brand. */
    await runInRequest(() =>
      serveAuthenticatedApi(user, { ...envelope("/api/models"), res }),
    );
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual(expect.any(Object));
    expect(text.length).toBeGreaterThan(2);
  });
});

describe("the closed public namespace", () => {
  /**
   * A route that exists, reached with no `Authorization` header at all — which
   * is the only case that matters, and the one that would otherwise be
   * exercised for the first time by a stranger.
   *
   * 501 rather than 200 because these tests run under the default filesystem
   * store, which has no `visibility` column. What it proves is the dispatch: a
   * 401 would mean the request went to the gate, a 404 would mean it fell
   * through to the authenticated table's catch-all, and it is neither.
   */
  it("answers an anonymous request without consulting the gate", async () => {
    const r = await call("GET", "/api/public/article/example");
    expect(r.handled).toBe(true);
    expect(r.status).toBe(501);
    expect(r.body.error).toMatch(/needs Postgres/);
  });

  it("and answers a signed-in one exactly the same way", async () => {
    const anonymous = await call("GET", "/api/public/article/example");
    const signedIn = await call("GET", "/api/public/article/example", AUTHED_HEADERS);
    expect(signedIn.status).toBe(anonymous.status);
    expect(signedIn.body).toEqual(anonymous.body);
  });

  /**
   * **The fallthrough, which is the single most likely way this feature grows a
   * hole.** An unknown path inside the namespace must not reach the
   * authenticated table — where it would be answered 401 by the gate, telling a
   * stranger that signing in might help, which is a different and wrong claim.
   */
  it("404s an unknown public path rather than handing it to the gate", async () => {
    for (const path of [
      "/api/public",
      "/api/public/",
      /* **`/api/public/library` used to be in this list** and is a real route
         since 2026-09-04. Its near misses take its place, and they are the ones
         worth having: a collection pattern anchored only at the front would
         serve `/api/public/library/anything` as the list with a segment nobody
         read, and a plural is the spelling somebody will type. */
      "/api/public/library/anything",
      "/api/public/libraries",
      "/api/public/article",
      "/api/public/glossary/example",
      "/api/public/../library",
      /* **A route that used to exist**, deleted 2026-09-02 with its reader, its
         DTO and its type (docs/plans/260902j-public-read-only-access-audit-and-improvements.md
         § Cluster B). Named here rather than left to the sweeps because a
         deletion is the one edit that can open the hole this block is about: a
         path the dispatcher no longer matches has to end *inside* the closed
         room, and the way it would fail is by falling through to the gate and
         answering 401 — which reads as *sign in and you may see it* about an
         endpoint nobody may see. */
      "/api/public/metadata/example",
    ]) {
      const r = await call("GET", path);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
      expect(r.body.error, path).toMatch(/No public API route/);
    }
  });

  /**
   * **And the deleted route is 404 for every method, not 405.**
   *
   * The sweep below drives off `PUBLIC_ROUTES`, so it stopped visiting this
   * path the moment the route left the inventory — which is correct and is
   * also exactly why the deleted spelling needs saying once by hand. A 405 with
   * `Allow: GET, HEAD` would mean the pattern still matched something; the
   * whole claim of a deletion is that it matches nothing.
   */
  it("404s the deleted metadata route whatever method it is asked with", async () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
      const r = await call(method, "/api/public/metadata/example");
      expect({ method, status: r.status }).toEqual({ method, status: 404 });
      expect(r.headers.Allow, method).toBeUndefined();
      expect(r.headers["Cache-Control"], method).toBe("no-store");
    }
  });

  /**
   * A sweep, not a spot check — every route, every method that is not a read.
   *
   * `HEAD` is deliberately **not** in this list; it is a read, and it has its own
   * block below. It was in this list until 2026-08-28, when a black-box spike
   * pointed out that a link-preview unfurler HEADs a URL before it GETs one, and
   * stage 2 of the plan is entirely about link previews.
   */
  it("405s every method that is not a read, on every public route", async () => {
    /* **From `PUBLIC_ROUTES`, not from two paths typed here.** The dispatcher
       walks the same list, so this is a claim about every route there is rather
       than about the two somebody remembered. Slice 1b adds four. */
    expect(PUBLIC_ROUTES.length).toBeGreaterThan(0);
    /* **Both kinds**, since 2026-09-04. `pathOf` is the one line that knows a
       collection route's `path()` takes nothing — it lives in the inventory leaf
       rather than here, so all three sweeps ask it the same way. And the set is
       asserted rather than assumed: a sweep that walked an inventory which had
       quietly lost its collection route would go on passing over one kind. */
    expect(new Set(PUBLIC_ROUTES.map((r) => r.kind))).toEqual(new Set(["slug", "collection"]));
    for (const route of PUBLIC_ROUTES) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
        const path = pathOf(route, "example");
        const r = await call(method, path);
        expect({ path, method, status: r.status }).toEqual({ path, method, status: 405 });
        expect(r.headers.Allow).toBe("GET, HEAD");
      }
    }
  });

  /**
   * **HEAD mirrors GET**: same status, same headers, no body.
   *
   * Through the hand-built response, which is what makes the *explicit* branch
   * in `send` worth having — this `res` has none of Node's own body
   * suppression, so if the implementation leaned on that, this test would show
   * a body and there would be nowhere to check the truth except a real socket.
   * The socket case is the next one; this is the one that pins our own code.
   */
  it("answers HEAD exactly as it answers GET, without a body", async () => {
    for (const path of PUBLIC_ROUTES.map((route) => pathOf(route, "example"))) {
      const get = await call("GET", path);
      const head = await call("HEAD", path);
      expect({ path, status: head.status }).toEqual({ path, status: get.status });
      expect(head.headers["Cache-Control"]).toBe(get.headers["Cache-Control"]);
      expect(head.headers["Cache-Control"]).toBe("no-store");
    }
  });

  /** A malformed slug is a 400 wherever it is sent, and never a traversal. */
  it("400s a slug that is not one, before it reaches any store", async () => {
    const r = await call("GET", "/api/public/article/..%2F..%2Fetc");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Not a slug/);
  });

  /**
   * **And percent-encoding that will not decode is a 400 too, not a 500.**
   *
   * `decodeURIComponent("%")` raises `URIError`, which names no status, so the
   * shared catch mapped it to 500 — `/api/public/article/%` reported *we are
   * broken* to a visitor who had merely mistyped. GPT Sol's finding 7.
   *
   * The second half is why it is worth more than tidiness: `captureFailure`
   * fires at status >= 500, so a crawler walking malformed URLs would have
   * filled the error tracker with reports of itself. An error tracker full of
   * mistyped URLs is an error tracker nobody reads — which is the reasoning
   * src/routes.ts already gives for not reporting 404s.
   *
   * Every route in the inventory **that takes a slug**, because the decode is
   * shared and a slug route added later gets it for free — the point of
   * `PUBLIC_ROUTES`.
   *
   * **The filter is the deliberate half.** A collection route captures nothing,
   * so there is no slug to mis-encode and `pathOf` would hand back the same
   * constant path six times — six requests that answer 501 and prove nothing,
   * while looking exactly like coverage. `kind === "slug"` narrows the type too,
   * so `route.path(bad)` is the arity the compiler already agrees with.
   */
  it("400s percent-encoding that cannot be decoded, rather than 500ing", async () => {
    const slugRoutes = PUBLIC_ROUTES.filter((route) => route.kind === "slug");
    /* Not vacuous: if the last slug route ever left the inventory this would
       silently pass over nothing at all. */
    expect(slugRoutes.length).toBeGreaterThan(0);
    for (const route of slugRoutes) {
      for (const bad of ["%", "%2", "%zz", "%E0%A4%A", "a%", "%C3%28"]) {
        const r = await call("GET", route.path(bad));
        expect({ route: route.name, bad, status: r.status }).toEqual({
          route: route.name,
          bad,
          status: 400,
        });
        /* Never the raw `URIError` text, and never a stack. */
        expect(String(r.body.error)).not.toMatch(/URI|malformed/i);
        expect(r.headers["Cache-Control"]).toBe("no-store");
      }
    }
  });

  /**
   * **`no-store` on every answer, not only the successful ones.**
   *
   * Sol's answer 9: a cached public 404 outlives the switch being turned *on*,
   * and a cached body outlives it being turned off. The header is set before
   * the dispatch for exactly that reason, so it survives a throw.
   */
  it("says no-store on the 200-shaped answer, the 404, the 405 and the 400", async () => {
    for (const [method, path] of [
      ["GET", "/api/public/article/example"],
      ["GET", "/api/public/nothing-here"],
      ["POST", "/api/public/article/example"],
      ["GET", "/api/public/article/..%2Fetc"],
    ] as const) {
      const r = await call(method, path);
      expect({ method, path, cache: r.headers["Cache-Control"] }).toEqual({
        method,
        path,
        cache: "no-store",
      });
    }
  });

  /**
   * And the namespace really is a path segment. `/api/publications` is an
   * ordinary authenticated path, so it goes to the gate and gets a 401 — which
   * is also the positive control for the whole block above: it shows what an
   * anonymous request looks like when it is *not* in the closed room.
   */
  it("does not swallow a path that merely starts with the same letters", async () => {
    for (const path of ["/api/publications", "/api/publicx/article/example"]) {
      const r = await call("GET", path);
      expect({ path, status: r.status }).toEqual({ path, status: 401 });
    }
  });

  /**
   * **The spellings that are ours to decide, decided.**
   *
   * `docs/plans/260827ai-public-read-only-access.md` claimed case variants and doubled
   * slashes "either miss `/api/` entirely or land on the authenticated gate".
   * A black-box spike found that neither happens in dev, and the paragraph has
   * since been corrected — the honest split is that **the `/api/` prefix is the
   * platform's decision and everything after it is ours**, and only the second
   * half is testable here.
   *
   * These are the second half. `isPublicNamespace` is a case-sensitive
   * `startsWith` on a path that reached `handleApi`, so a case variant *inside*
   * the namespace is simply not in it: it falls through to the authenticated
   * table and the gate answers 401. Fail-closed, and the direction that matters
   * — a variant that read as public when it was not would be the hole.
   *
   * `/api//public/…` matters for a reason of its own: on Vercel `originalUrl`
   * rebuilds the path from a capture, so a doubled slash surviving the platform
   * would arrive here intact. It is refused too.
   */
  it("treats a case variant of the namespace as outside it, and refuses it", async () => {
    for (const path of [
      "/api/PUBLIC/article/example",
      "/api/Public/article/example",
      "/api//public/article/example",
    ]) {
      const r = await call("GET", path);
      /* 401 from the gate, not 200: the namespace check did not match, so the
         authenticated half owns the request. */
      expect({ path, status: r.status }).toEqual({ path, status: 401 });
    }
  });

  /**
   * **And a case variant of the *route*, one level in, lands somewhere else
   * again** — which is worth pinning because it is not what I first assumed.
   *
   * `/api/public/ARTICLE/example` **is** inside the namespace: the prefix is
   * spelled correctly. What it misses is `ARTICLE`, so it is an unknown path in
   * the closed room and gets the room's own 404, never the gate's 401. Both are
   * refusals and neither serves anything, but they are different mechanisms and
   * a test that expected the wrong one would be describing a design nobody
   * built. The first draft of this test asserted 401 here and was red.
   */
  it("and a case variant of the route is the closed room's own 404", async () => {
    const r = await call("GET", "/api/public/ARTICLE/example");
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No public API route/);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  /**
   * And the one inside the room that *is* the right spelling still works — so
   * the case above is not passing because every path 401s.
   */
  it("while the exact spelling still reaches the public handler", async () => {
    const r = await call("GET", "/api/public/article/example");
    expect(r.status).toBe(501);
  });

  /**
   * **The collection route reaches the handler too**, and by the same evidence.
   *
   * 501 is the filesystem store refusing, which is what a route that matched and
   * ran looks like in this file — a 404 would mean the pattern missed. Said
   * separately from the sweeps above because those prove what the route
   * *refuses*; this is the one line that proves it is reachable at all, and
   * without it every refusal above could be passing over a route that matches
   * nothing.
   */
  it("and the slugless collection route reaches the public handler as well", async () => {
    const r = await call("GET", "/api/public/library");
    expect(r.handled).toBe(true);
    expect(r.status).toBe(501);
    expect(r.body.error).toMatch(/needs Postgres/);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  /**
   * **And it is anchored at the end**, so nothing after the name is quietly
   * ignored.
   *
   * `/api/public/library/x` is the shape a slug route has, and a collection
   * pattern written `^/api/public/library` would serve the whole list for it —
   * a request carrying a segment nobody read, answered as if it had not. The
   * closed room's own 404 is the right answer, and it is the answer.
   */
  it("and refuses a segment after the collection's name rather than ignoring it", async () => {
    for (const path of ["/api/public/library/x", "/api/public/library/", "/api/public/librarys"]) {
      const r = await call("GET", path);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
      expect(r.body.error, path).toMatch(/No public API route/);
    }
  });

  /** And an authenticated route with no header is still 401, unchanged. */
  it("leaves the gate exactly where it was", async () => {
    const r = await call("GET", "/api/library");
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("articles");
  });

  /**
   * **Through production's own URL restoration, rather than a hand-built path.**
   *
   * On Vercel nothing arrives as `/api/public/article/x`. `vercel.json` rewrites
   * every API request to `/api/index?__spy_path=$1`, and `originalUrl` in
   * src/vercel.ts puts the path back before `handleApi` ever sees it. The plan
   * asks for this explicitly:
   *
   * > Drive the tests through production's `originalUrl()` restoration in
   * > `src/vercel.ts`, not through a hand-built path, so what is tested is what
   * > ships.
   *
   * Every other case in this file builds the path directly, which is the right
   * default — they are about dispatch, not deployment. This one closes the gap
   * between the two, and it is the only place the whole chain is exercised.
   */
  it("survives the rewrite the deployed site actually uses", async () => {
    const restored = originalUrl("/api/index?__spy_path=public%2Farticle%2Fexample");
    expect(restored).toBe("/api/public/article/example");
    const r = await call("GET", restored ?? "");
    expect(r.status).toBe(501);
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  /**
   * **A query string must not hide a route from its own dispatcher.**
   *
   * `servePublicApi` is handed `path` — `url` up to the first `?` — and its two
   * patterns are anchored with `$`. Hand it `url` instead and
   * `/api/public/article/example?at=spya-k3m9qt` stops matching `ARTICLE` and
   * falls to the namespace's 404: a link with reading state on it, 404ing, while
   * the same link without it works. Several older authenticated routes still
   * match on `url` and so can see the query string, which is exactly why this is
   * asserted rather than assumed.
   *
   * Note the prefix test itself is NOT what this catches: `isPublicNamespace` is
   * a `startsWith`, so reading `url` there makes no observable difference — the
   * query string is at the end. Sabotaging that line leaves this file green, and
   * saying so is more useful than implying a check that is not there.
   */
  it("still routes a public GET that carries a query string", async () => {
    const withState = await call("GET", "/api/public/article/example?at=spya-k3m9qt&zoom=2");
    /* 501 rather than 404: it matched `ARTICLE`, ran the handler, and refused on
       the store. The bare form answers identically. */
    expect(withState.status).toBe(501);
    const bare = await call("GET", "/api/public/article/example");
    expect(withState.status).toBe(bare.status);
  });

  /** And an unknown path inside the room stays inside it, query string or not. */
  it("is not escaped by a query string", async () => {
    const restored = originalUrl("/api/index?__spy_path=public%2Fnothing-here&archived=1");
    expect(restored).toBe("/api/public/nothing-here?archived=1");
    const r = await call("GET", restored ?? "");
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No public API route/);
  });
});
