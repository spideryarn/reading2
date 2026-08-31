/**
 * `fetchAsset` — the same guarded path as `fetchDocument`, minus the document.
 *
 * The reason this file exists is that `fetchAsset` is not a second fetcher. It
 * shares `fetchBytes` with `fetchDocument`, so nearly every assertion below is
 * about a guard that already had a test on the document path — and that is the
 * point: a shared guard that only one caller is tested for is a guard the other
 * caller can lose without anything going red. Each one here has been watched
 * fail with the guard broken; the list is in
 * docs/plans/260829b-hosting-the-articles-images.md.
 *
 * Offline throughout, through the same injected fetch/DNS/clock/jitter seams
 * tests/fetch.test.ts uses. Nothing here sniffs an image: that is `sniffImage`
 * in src/assets.ts and belongs to the caller.
 */
import { describe, expect, it } from "vitest";
import {
  fetchAsset,
  fetchDocument,
  FetchFailure,
  type AssetFetch,
  type AssetFetchOptions,
  type FetchLike,
} from "../src/fetch.js";

/* ------------------------------------------------------------------ *
 * Scaffolding
 * ------------------------------------------------------------------ */

type Reply = Response | Error | (() => Response | Promise<Response>);

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a script, and remembers what it was asked. */
function scripted(replies: Reply[]): { impl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = replies[calls.length - 1];
    if (next === undefined) throw new Error(`unscripted fetch #${calls.length}: ${url}`);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? await next() : next;
  };
  return { impl, calls };
}

const NOW = new Date("2026-08-29T12:00:00.000Z");

/** The PNG signature, which is what a real asset starts with. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function png(body: Uint8Array<ArrayBuffer> = PNG, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "image/png", ...headers } });
}

/**
 * Options that keep every test offline, instant and deterministic.
 *
 * Typed as `AssetFetchOptions` rather than left inferred, so that the object
 * handed to the seam below is the same one the ordinary calls use.
 */
function opts(over: Partial<AssetFetchOptions> = {}): AssetFetchOptions {
  return {
    maxBytes: 16 * 1024 * 1024,
    timeoutMs: 15_000,
    resolve: async () => ["93.184.216.34"],
    sleep: async () => {},
    now: () => NOW,
    random: () => 0.5,
    attempts: 1,
    ...over,
  };
}

async function failureFrom(promise: Promise<unknown>): Promise<FetchFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof FetchFailure) return err;
    throw err;
  }
  throw new Error("expected a FetchFailure, and it resolved");
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

/**
 * The map the pinned dispatcher on a call actually closes over.
 *
 * Read off the agent rather than rebuilt, so this cannot agree with a copy that
 * has drifted from what the socket will use — the same reason `pinnedAgent`
 * hangs `pinned` on the agent it returns.
 */
function pinnedOn(call: Call | undefined): Map<string, readonly string[]> | undefined {
  const init = call?.init as { dispatcher?: { pinned?: Map<string, readonly string[]> } } | undefined;
  return init?.dispatcher?.pinned;
}

/**
 * A body that arrives a chunk at a time, and reports whether anything
 * cancelled it before the end.
 *
 * Two things about this fixture are load-bearing, and each was got wrong first.
 *
 * **It has to still be open when the reader gives up.** A stream that enqueues
 * everything and closes in `start` is already finished by the time `readCapped`
 * bails, and cancelling a closed stream never reaches the source's `cancel` —
 * so the flag stayed false and the assertion was about the fixture rather than
 * the code. Chunks are therefore produced lazily, in `pull`.
 *
 * **And it has to end.** The version after that never closed at all, which
 * meant that with the cap removed the test did not go red — it exhausted the
 * heap and killed the vitest worker, taking the *other* cap test's result down
 * with it. A crashed runner is not a red test. So it is bounded: with the cap
 * in force the reader stops early and `cancel` fires; with the cap gone the
 * whole thing arrives and the `too-large` expectation fails cleanly.
 */
function chunkedBody(
  chunkSize: number,
  chunks: number,
): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, cancelled: () => cancelled };
}

/* ------------------------------------------------------------------ *
 * What it returns
 * ------------------------------------------------------------------ */

describe("fetchAsset", () => {
  it("hands back the bytes, the claimed type and where it ended up", async () => {
    const { impl } = scripted([png()]);
    const got = await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    expect([...got.bytes]).toEqual([...PNG]);
    expect(got.contentType).toBe("image/png");
    expect(got.finalUrl).toBe("https://cdn.example/cat.png");
  });

  it("returns exactly the three fields the seam promises, and no more", async () => {
    /* The seam is a contract another module is written against. An extra field
       is not a bug today and is a thing to keep working forever. */
    const { impl } = scripted([png()]);
    const got = await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    expect(Object.keys(got).sort()).toEqual(["bytes", "contentType", "finalUrl"]);
    expect(got.bytes).toBeInstanceOf(Uint8Array);
  });

  it("satisfies AssetFetch when called through it, not only when assigned to it", async () => {
    /* Assigning `fetchAsset` to `AssetFetch` is a compile-time check, and the
       failure this guards against is a runtime shape. So the call goes through
       a variable of the seam's own type, with the seam's own option object.
       docs/memory: test the value that crosses the seam. */
    const seam: AssetFetch = fetchAsset;
    const { impl } = scripted([png()]);
    const options: AssetFetchOptions = opts({ fetchImpl: impl });
    const got = await seam("https://cdn.example/cat.png", options);
    expect(got.bytes.byteLength).toBe(PNG.byteLength);
    expect(got.contentType).toBe("image/png");
    expect(got.finalUrl).toBe("https://cdn.example/cat.png");
  });

  it("does not sniff the format — that belongs to the caller", async () => {
    /* The whole reason `fetchAsset` exists. `fetchDocument` refuses these bytes
       by name, and the assertion pairs the two so a `sniffKind` creeping onto
       the asset path is caught by the half that stopped working. */
    const body = new TextEncoder().encode("<html><body>a bot wall</body></html>");
    const reply = () => new Response(body, { status: 200, headers: { "content-type": "image/png" } });

    const got = await fetchAsset(
      "https://cdn.example/cat.png",
      opts({ fetchImpl: scripted([reply()]).impl }),
    );
    expect(got.bytes.byteLength).toBe(body.byteLength);
    expect(got.contentType).toBe("image/png");

    const refused = await failureFrom(
      fetchDocument("https://cdn.example/cat.png", opts({ fetchImpl: scripted([png()]).impl })),
    );
    expect(refused.code).toBe("unsupported-type");
  });
});

/* ------------------------------------------------------------------ *
 * Headers
 * ------------------------------------------------------------------ */

describe("what it sends", () => {
  it("sends no Referer", async () => {
    /* The article's final URL can carry a signed query parameter — five of the
       thirteen images in the corpus sit behind an imgix `s=`. Handing that to a
       third party as a header is worse than the hotlink it fixes. The assertion
       is the *absence* of the short token, case-insensitively, because
       `not.toContain("Referer")` would pass on a header spelled `referer`. */
    const { impl, calls } = scripted([png()]);
    await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    const names = Object.keys(headersOf(calls[0])).map((key) => key.toLowerCase());
    expect(names).not.toContain("referer");
    expect(names).not.toContain("referrer");
  });

  it("sends a User-Agent and leaves Accept-Encoding alone", async () => {
    const { impl, calls } = scripted([png()]);
    await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, userAgent: "Spideryarn/test" }));
    const headers = headersOf(calls[0]);
    expect(headers["User-Agent"]).toBe("Spideryarn/test");
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("accept-encoding");
  });

  it("asks for an image, not for a web page", async () => {
    /* A content-negotiating server handed the document `Accept` will happily
       send HTML for an image URL. The document header is on the document path. */
    const { impl, calls } = scripted([png()]);
    await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    const accept = headersOf(calls[0]).Accept ?? "";
    expect(accept).toContain("image/");
    expect(accept).not.toContain("text/html");
  });

  it("follows redirects itself rather than letting fetch do it", async () => {
    const { impl, calls } = scripted([png()]);
    await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    expect(calls[0]?.init.redirect).toBe("manual");
  });
});

/* ------------------------------------------------------------------ *
 * The address guard, on every hop
 * ------------------------------------------------------------------ */

describe("the address guard", () => {
  it("refuses a scheme that isn't http(s)", async () => {
    const { impl, calls } = scripted([]);
    const err = await failureFrom(fetchAsset("file:///etc/passwd", opts({ fetchImpl: impl })));
    expect(err.code).toBe("unsupported-scheme");
    expect(calls).toHaveLength(0);
  });

  it("refuses a host that resolves to a private address", async () => {
    const { impl, calls } = scripted([]);
    const err = await failureFrom(
      fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, resolve: async () => ["127.0.0.1"] })),
    );
    expect(err.code).toBe("blocked-address");
    expect(calls).toHaveLength(0);
  });

  it("re-guards the host a redirect points at", async () => {
    /* Guarding only the first hop is the classic version of this bug: a public
       CDN that 302s to 169.254.169.254 walks straight through. */
    const { impl, calls } = scripted([
      new Response(null, { status: 302, headers: { location: "https://inside.example/secret.png" } }),
      png(),
    ]);
    const err = await failureFrom(
      fetchAsset(
        "https://cdn.example/cat.png",
        opts({
          fetchImpl: impl,
          resolve: async (host) => (host === "inside.example" ? ["169.254.169.254"] : ["93.184.216.34"]),
        }),
      ),
    );
    expect(err.code).toBe("blocked-address");
    /* The second request was never made — the guard runs before the dial. */
    expect(calls).toHaveLength(1);
  });

  it("pins the connection to the address it approved", async () => {
    /* The other half of the guard. Without a dispatcher, node resolves the name
       a second time to open the socket and a rebinding answer is through. */
    const { impl, calls } = scripted([png()]);
    await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    expect(pinnedOn(calls[0])?.get("cdn.example")).toEqual(["93.184.216.34"]);
  });

  it("re-pins across a redirect rather than reusing the first host's answer", async () => {
    const { impl, calls } = scripted([
      new Response(null, { status: 302, headers: { location: "https://other.example/cat.png" } }),
      png(),
    ]);
    await fetchAsset(
      "https://cdn.example/cat.png",
      opts({
        fetchImpl: impl,
        resolve: async (host) => (host === "other.example" ? ["93.184.216.35"] : ["93.184.216.34"]),
      }),
    );
    expect(pinnedOn(calls[1])?.get("other.example")).toEqual(["93.184.216.35"]);
    /* And the first host's answer is still there, rather than overwritten. */
    expect(pinnedOn(calls[1])?.get("cdn.example")).toEqual(["93.184.216.34"]);
  });
});

/* ------------------------------------------------------------------ *
 * Redirects
 * ------------------------------------------------------------------ */

describe("redirects", () => {
  it("follows one and reports where it ended up", async () => {
    const { impl } = scripted([
      new Response(null, { status: 301, headers: { location: "/moved/cat.png" } }),
      png(),
    ]);
    const got = await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl }));
    expect(got.finalUrl).toBe("https://cdn.example/moved/cat.png");
  });

  it("refuses a redirect to another scheme", async () => {
    const { impl } = scripted([
      new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
    ]);
    const err = await failureFrom(fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl })));
    expect(err.code).toBe("unsupported-scheme");
  });

  it("names a loop rather than spending the whole hop budget on it", async () => {
    const { impl } = scripted([
      new Response(null, { status: 302, headers: { location: "https://cdn.example/b.png" } }),
      new Response(null, { status: 302, headers: { location: "https://cdn.example/cat.png" } }),
    ]);
    const err = await failureFrom(fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl })));
    expect(err.code).toBe("too-many-redirects");
    expect(err.message).toContain("loop");
  });

  it("caps the hops", async () => {
    const replies: Reply[] = [];
    for (let i = 0; i < 10; i++) {
      replies.push(new Response(null, { status: 302, headers: { location: `https://cdn.example/${i}.png` } }));
    }
    const { impl, calls } = scripted(replies);
    const err = await failureFrom(
      fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, maxRedirects: 2 })),
    );
    expect(err.code).toBe("too-many-redirects");
    expect(calls).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ *
 * What comes back, and what we refuse
 * ------------------------------------------------------------------ */

describe("refusals", () => {
  it("charges the cap against the bytes that arrive, not the header", async () => {
    /* `Content-Length` describes the compressed wire size, and there isn't one
       at all under chunked encoding. The number that matters is this one. */
    const { body, cancelled } = chunkedBody(200, 20);
    const { impl } = scripted([
      new Response(body, { status: 200, headers: { "content-type": "image/png", "content-length": "12" } }),
    ]);
    const err = await failureFrom(
      fetchAsset("https://cdn.example/big.png", opts({ fetchImpl: impl, maxBytes: 256 })),
    );
    expect(err.code).toBe("too-large");
    /* And the socket does not stay open with the server still streaming. */
    expect(cancelled()).toBe(true);
  });

  it("takes the caller's byte cap rather than a document's", async () => {
    const { impl } = scripted([png(new Uint8Array(2_000))]);
    const err = await failureFrom(
      fetchAsset("https://cdn.example/big.png", opts({ fetchImpl: impl, maxBytes: 1_000 })),
    );
    expect(err.code).toBe("too-large");
  });

  it("calls an empty 200 empty", async () => {
    const { impl } = scripted([new Response("", { status: 200, headers: { "content-type": "image/png" } })]);
    const err = await failureFrom(fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl })));
    expect(err.code).toBe("empty");
  });

  it("refuses a partial response rather than storing half an image", async () => {
    const { impl } = scripted([
      new Response(PNG, {
        status: 206,
        headers: { "content-type": "image/png", "content-range": "bytes 0-11/9000" },
      }),
    ]);
    const err = await failureFrom(fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl })));
    expect(err.code).toBe("http-error");
    expect(err.message).toContain("only part");
  });

  it("classifies a bad status against the hop that failed, not the URL asked for", async () => {
    const { impl } = scripted([
      new Response(null, { status: 302, headers: { location: "https://other.example/cat.png" } }),
      new Response("nope", { status: 404, headers: { "content-type": "text/html" } }),
    ]);
    const err = await failureFrom(fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl })));
    expect(err.code).toBe("not-found");
    expect(err.url).toBe("https://other.example/cat.png");
  });

  it("says which of Node's identical network errors it was", async () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" });
    const { impl } = scripted([err]);
    const failure = await failureFrom(fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl })));
    expect(failure.code).toBe("certificate");
  });
});

/* ------------------------------------------------------------------ *
 * Deadlines, retries and cancellation
 * ------------------------------------------------------------------ */

describe("the deadline and the retries", () => {
  it("covers the DNS lookup, not just the fetch", async () => {
    const { impl, calls } = scripted([]);
    const err = await failureFrom(
      fetchAsset(
        "https://cdn.example/cat.png",
        opts({ fetchImpl: impl, timeoutMs: 20, resolve: () => new Promise<string[]>(() => {}) }),
      ),
    );
    expect(err.code).toBe("timeout");
    expect(calls).toHaveLength(0);
  });

  it("hands every hop the same signal, and a retry a new one", async () => {
    /* **This is the assertion that pins "one deadline for the whole attempt".**
       The wall-clock test below does not: give each hop its own fresh deadline
       and it still goes red, because `guardAddress` shares the attempt's
       signal, so the chain still runs out of time somewhere. Watched: with a
       per-hop `AbortSignal.timeout` on the fetch, the timing test stayed green
       and only this one went red. Object identity is the thing that cannot be
       true of two deadlines. */
    const { impl, calls } = scripted([
      new Response("busy", { status: 503, headers: { "content-type": "text/html" } }),
      new Response(null, { status: 302, headers: { location: "https://cdn.example/b.png" } }),
      png(),
    ]);
    await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, attempts: 2 }));
    expect(calls).toHaveLength(3);
    /* Hops within one attempt: the same signal object. */
    expect(calls[2]?.init.signal).toBe(calls[1]?.init.signal);
    /* Across a retry: a different one, so the second attempt starts its clock
       again rather than inheriting a deadline that has nearly run out. */
    expect(calls[1]?.init.signal).not.toBe(calls[0]?.init.signal);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("runs out of time across the chain, not per hop", async () => {
    /* Five hops that are each just under the limit is still an image nobody is
       waiting for. Each hop gets the *same* signal, so the third one here is
       already aborted before it is dialled. */
    const { impl } = scripted([
      () =>
        new Promise<Response>((done) => {
          setTimeout(
            () => done(new Response(null, { status: 302, headers: { location: "https://cdn.example/b.png" } })),
            15,
          );
        }),
      () =>
        new Promise<Response>((done) => {
          setTimeout(
            () => done(new Response(null, { status: 302, headers: { location: "https://cdn.example/c.png" } })),
            15,
          );
        }),
      png(),
    ]);
    const err = await failureFrom(
      fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, timeoutMs: 20 })),
    );
    expect(err.code).toBe("timeout");
  });

  it("retries a retryable failure and gives the next attempt a fresh deadline", async () => {
    const { impl, calls } = scripted([
      new Response("busy", { status: 503, headers: { "content-type": "text/html" } }),
      png(),
    ]);
    const got = await fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, attempts: 2 }));
    expect(calls).toHaveLength(2);
    expect(got.bytes.byteLength).toBe(PNG.byteLength);
  });

  it("does not retry something retrying cannot fix", async () => {
    const { impl, calls } = scripted([new Response("gone", { status: 404, headers: { "content-type": "text/html" } })]);
    const err = await failureFrom(
      fetchAsset("https://cdn.example/cat.png", opts({ fetchImpl: impl, attempts: 3 })),
    );
    expect(err.code).toBe("not-found");
    expect(calls).toHaveLength(1);
  });

  it("stops during the backoff when the caller cancels", async () => {
    /* A cancelled queue should not sit out a four-second wait first. The sleep
       here never resolves, so the only way out is the signal. */
    const controller = new AbortController();
    const { impl } = scripted([
      new Response("busy", { status: 503, headers: { "content-type": "text/html" } }),
      png(),
    ]);
    const promise = fetchAsset(
      "https://cdn.example/cat.png",
      opts({
        fetchImpl: impl,
        attempts: 3,
        signal: controller.signal,
        sleep: () => new Promise<void>(() => {}),
      }),
    );
    setTimeout(() => controller.abort(), 5);
    const err = await failureFrom(promise);
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("Fetch cancelled.");
  });
});
