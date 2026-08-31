/**
 * Reading an API response — src/web/lib/api.ts.
 *
 * This file exists because of one line that a reader actually saw, on the
 * homepage, in production:
 *
 *     Unexpected token 'A', "A server e"... is not valid JSON
 *
 * Twelve call sites had all written `const body = await r.json()` and *then*
 * checked `r.ok`, so when the failing reply was not JSON the parser threw first
 * and the careful `body.error ?? r.statusText` line never ran. The error
 * handling was not missing; it was unreachable. See
 * docs/postmortems/260826g-first-vercel-deploy-silent-failures.md.
 *
 * So the bodies below are the real ones: Vercel's plain-text 500, Vercel's HTML
 * 404, and the single-page-app shell that a misrouted `/api/…` gets back. The
 * assertions are mostly about what the message must **not** contain, because
 * that is what went wrong.
 *
 * Deterministic — no network. docs/project/testing.md.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { failure, readJson } from "../src/web/lib/api.js";

/** Vercel's body when a serverless function throws. Verbatim, 2026-08-26. */
const VERCEL_500 = "A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n";

/** Vercel's body for a route that matched no function. Verbatim. */
const VERCEL_404 = "The page could not be found\n\nNOT_FOUND\n";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readJson", () => {
  it("returns the parsed body when the request worked", async () => {
    await expect(readJson<{ articles: string[] }>(json({ articles: ["a"] }))).resolves.toEqual({
      articles: ["a"],
    });
  });

  it("uses the server's own error message when there is one", async () => {
    /* Unchanged behaviour, and the reason all this care was taken originally.
       src/routes.ts answers `{ error }` and that string is written for a reader. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readJson(json({ error: "No article called 'writes'" }, 404))).rejects.toThrow(
      "No article called 'writes'",
    );
  });

  it("never shows the reader a JSON parser message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = new Response(VERCEL_500, { status: 500, statusText: "Internal Server Error" });

    /* The whole point. Before this file, the message was
       `Unexpected token 'A', "A server e"... is not valid JSON`. */
    await expect(readJson(res)).rejects.toThrow(/Internal Server Error \(500\)/);
    await expect(readJson(new Response(VERCEL_500, { status: 500 }))).rejects.not.toThrow(
      /Unexpected token/,
    );
  });

  it("never puts the response body into the message", async () => {
    /* An unparsed body is somebody else's HTML — a proxy's, a captive portal's,
       a stack trace. Rendering it as an error message is how a login page ends
       up inside a red box. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = new Response(VERCEL_404, { status: 404, statusText: "Not Found" });
    const err = await readJson(res).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("NOT_FOUND");
    expect((err as Error).message).toContain("Not Found (404)");
  });

  it("says something specific when a 200 is not JSON", async () => {
    /* The single-page-app fallback answering a request the API should have had:
       `/api/…` fell through to index.html. Calling that "not found" would send
       you looking in entirely the wrong place. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    const shell = new Response("<!doctype html><html><body>…</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await expect(readJson(shell)).rejects.toThrow(/replied 200 but not with JSON/);
  });

  it("treats an empty successful body as an empty object, not a failure", async () => {
    /* `204 No Content` — several routes in src/routes.ts answer a DELETE with
       one. The call sites that used to write `.catch(() => ({}))` relied on
       this, so removing it would have turned every successful delete into an
       error message. */
    await expect(readJson(new Response(null, { status: 204 }))).resolves.toEqual({});
  });

  it("writes one line to the console for every failure", async () => {
    /* The other half of the report: a server failure showed the reader a
       JavaScript message and left NO trace in devtools. */
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await readJson(new Response(VERCEL_500, { status: 500 })).catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("500");
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ status: 500 });
  });

  it("does not log when the request worked", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await readJson(json({ ok: true }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("never produces an empty message, even without status text", async () => {
    /* HTTP/2 removed the reason phrase from the protocol, so `res.statusText` is
       empty in production and populated against the local dev server. The old
       `body.error ?? r.statusText` therefore threw `new Error("")` on a deployed
       500 — an error with nothing in it, surfacing as an empty red box, and
       working perfectly on the machine of anyone who went looking. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await failure(new Response(VERCEL_500, { status: 500 }));
    expect(err.message).not.toBe("");
    expect(err.message).toContain("500");
  });

  it("still prefers the server's own words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await failure(json({ error: "Nothing to change" }, 400));
    expect(err.message).toBe("Nothing to change");
  });
});
