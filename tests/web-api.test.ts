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
import { detailsOf, failure, readJson, statusOf } from "../src/web/lib/api.js";

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

/**
 * **The status a rejection carries**, which is what `src/web/jobEngine.ts`
 * reads to tell one refusal from another: it stops dead on a final 401 and
 * keeps polling through a 500, and as `Error.message` those two are the same
 * kind of sentence. Added with the engine on 2026-09-01; the assertions above
 * check only the message, so GPT Sol was right that the new half had no test.
 *
 * Every rejection out of this module carries one, including the ones whose
 * message came from the server rather than from here — otherwise the check
 * would be right about the cases nobody sends and wrong about the polite 401
 * that `src/routes.ts` actually writes.
 */
describe("the status on a thrown error", () => {
  it("is on the rejection, whoever wrote the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const polite = await readJson(json({ error: "Sign in again." }, 401)).catch((e: unknown) => e);
    expect({ message: (polite as Error).message, status: statusOf(polite) }).toEqual({
      message: "Sign in again.",
      status: 401,
    });

    // And the reply that was not JSON at all, where the message is ours.
    const rude = await readJson(new Response(VERCEL_500, { status: 500 })).catch(
      (e: unknown) => e,
    );
    expect(statusOf(rude)).toBe(500);

    // `failure`, the other door into the same builder.
    expect(statusOf(await failure(new Response(VERCEL_404, { status: 404 })))).toBe(404);
  });

  it("is absent rather than wrong when nothing gave one", async () => {
    /* The distinction the engine depends on. A 200 that is not JSON is a
       genuine failure with no *refusal* behind it, and a dropped connection
       throws a `TypeError` from `fetch` itself — neither may be read as a
       status, or the engine would pause a session over a flaky network. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    const shell = new Response("<!doctype html>", { status: 200 });
    expect(statusOf(await readJson(shell).catch((e: unknown) => e))).toBeNull();
    expect(statusOf(new TypeError("Failed to fetch"))).toBeNull();
    expect(statusOf(null)).toBeNull();
    expect(statusOf(undefined)).toBeNull();
    // Duck-typed on purpose, so a test's own stand-in counts — see `statusOf`.
    expect(statusOf({ status: 401 })).toBe(401);
    expect(statusOf({ status: "401" })).toBeNull();
  });
});

/**
 * **The structured half of a refusal.**
 *
 * `readJson` used to keep the server's sentence and throw the rest of the body
 * away, which made a structured refusal impossible to act on. The case it was
 * built for is gone — `POST /api/jobs` answered 409 with the job that was in the
 * way, and since 2026-09-02 a second job on one article queues instead
 * (docs/project/ingest-queue.md) — but the parsing rule is general and stays, so
 * the payloads below are a **synthetic** structured refusal rather than one any
 * route sends today.
 *
 * `detailsOf` rather than reading `.details`, for the same reason `statusOf` is
 * duck-typed: a test that mocks `lib/api.js` supplies its own `readJson`, and a
 * second copy of the class in the graph would make `instanceof` false for an
 * object that is one in every way that matters.
 *
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 6.
 */
describe("the structured fields beside the message", () => {
  it("keeps them, and keeps the sentence too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = await readJson(
      json({ error: "That is being worked on.", holder: { id: "spya-k3m9qt" } }, 409),
    ).catch((e: unknown) => e);

    expect((refused as Error).message).toBe("That is being worked on.");
    expect(statusOf(refused)).toBe(409);
    /* `error` is the message and is not repeated here: `details` means *what
       the server sent beside the sentence*, so a caller reading it never has to
       know which key the prose lives under. */
    expect(detailsOf(refused)).toEqual({ holder: { id: "spya-k3m9qt" } });
  });

  it("is an empty object rather than a guess when the body carried none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    /* Three shapes that all have to answer the same way, because a caller that
       has to test for null before looking is a caller that will forget once. */
    expect(detailsOf(await readJson(json({ error: "No." }, 404)).catch((e: unknown) => e))).toEqual({});
    expect(detailsOf(await readJson(new Response(VERCEL_500, { status: 500 })).catch((e: unknown) => e))).toEqual({});
    expect(detailsOf(new TypeError("Failed to fetch"))).toEqual({});
    expect(detailsOf(null)).toEqual({});
    // A JSON body that is not an object at all — an array, a bare string.
    expect(detailsOf(await readJson(json(["nope"], 500)).catch((e: unknown) => e))).toEqual({});
  });
});
