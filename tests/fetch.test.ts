/**
 * Stage 1 — what the fetcher promises, without a network.
 *
 * Every case here came from a real observation rather than from imagination:
 * the byte sequences are ones a server actually sent, the error shapes are the
 * ones Node actually throws, and the sizes are ones real documents actually
 * are. docs/project/fetching.md records where each came from.
 *
 * The whole file runs offline because src/fetch.ts takes its fetch, clock,
 * sleep, DNS and jitter as arguments. That is the point of those seams — a
 * fetcher tested against the live web is tested against whatever the web is
 * doing this morning.
 */
import { describe, expect, it } from "vitest";
import {
  charsetFromContentType,
  classifyNetworkError,
  classifyStatus,
  decodeHtml,
  DEFAULTS,
  fetchDocument,
  FetchFailure,
  fetchHtml,
  isBlockedAddress,
  mimeType,
  parseTarget,
  readCapped,
  retryAfterMs,
  retryDelayMs,
  sniffKind,
  type FetchLike,
  type FetchOptions,
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

const NOW = new Date("2026-08-25T12:00:00.000Z");

/** Defaults that keep every test offline, instant and deterministic. */
function opts(over: FetchOptions = {}): FetchOptions {
  return {
    resolve: async () => ["93.184.216.34"],
    sleep: async () => {},
    now: () => NOW,
    random: () => 0.5,
    attempts: 1,
    ...over,
  };
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });
}

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Node's shape for every network and TLS failure: one message, the truth in `cause.code`. */
function nodeFetchError(code: string, message = ""): Error {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error(message), { code });
  return err;
}

async function failureFrom(promise: Promise<unknown>): Promise<FetchFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof FetchFailure) return err;
    throw err;
  }
  throw new Error("expected a FetchFailure, got a success");
}

/* ------------------------------------------------------------------ *
 * The URL, before we dial it
 * ------------------------------------------------------------------ */

describe("parseTarget", () => {
  it("accepts http and https, and trims", () => {
    expect(parseTarget("  https://example.com/a  ").href).toBe("https://example.com/a");
    expect(parseTarget("http://example.com/").protocol).toBe("http:");
  });

  it("names the scheme it won't follow", () => {
    for (const bad of ["file:///etc/passwd", "data:text/html,<b>hi", "ftp://example.com/x"]) {
      const err = (() => {
        try {
          parseTarget(bad);
        } catch (e) {
          return e as FetchFailure;
        }
        throw new Error(`expected ${bad} to be refused`);
      })();
      expect(err.code).toBe("unsupported-scheme");
    }
  });

  it("rejects something that isn't a URL at all", () => {
    expect(() => parseTarget("just some words")).toThrowError(/isn't a URL/);
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and reserved", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // the cloud metadata address
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks the documentation and test ranges too", () => {
    for (const address of ["198.51.100.1", "203.0.113.1", "2001:db8::1", "fec0::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("lets real public addresses through", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.0.1", "2606:2800:220:1::1"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("sees through an IPv4 address wearing an IPv6 coat", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("sees through the coat when it is written in hex", () => {
    /* `new URL("http://[::127.0.0.1]/")` normalises the hostname to
       `[::7f00:1]` — so a check that looks for a dotted quad never sees one. */
    expect(isBlockedAddress("::7f00:1")).toBe(true); // 127.0.0.1, compatible form
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true); // 127.0.0.1, mapped form
    expect(isBlockedAddress("::ffff:a00:1")).toBe(true); // 10.0.0.1
    expect(isBlockedAddress("::ffff:5db8:d822")).toBe(false); // 93.184.216.34
  });

  it("does not block real addresses that merely look reserved", () => {
    /* 192.0.0.0/24 is reserved and 192.0.2.0/24 is TEST-NET-1, but the /16
       around them is ordinary internet: 192.0.78.0/24 is Automattic, which is
       every WordPress.com blog. This was blocked, and the symptom would have
       been "not a public address" on a perfectly normal article. */
    expect(isBlockedAddress("192.0.78.20")).toBe(false);
    expect(isBlockedAddress("192.0.0.1")).toBe(true);
    expect(isBlockedAddress("192.0.2.1")).toBe(true);
  });

  it("catches a loopback address written as a decimal or octal URL", () => {
    /* We never see these spellings, because the URL parser normalises them
       before we look — which is worth pinning, since it is the reason the
       address guard doesn't need to understand them itself. */
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(new URL("http://0177.0.0.1/").hostname).toBe("127.0.0.1");
    expect(isBlockedAddress(new URL("http://2130706433/").hostname)).toBe(true);
  });
});

describe("the address guard", () => {
  it("refuses localhost without asking the network anything", async () => {
    const { impl, calls } = scripted([]);
    const err = await failureFrom(fetchDocument("http://localhost:5273/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("blocked-address");
    expect(calls).toHaveLength(0);
  });

  it("refuses a public name that resolves somewhere private", async () => {
    const { impl, calls } = scripted([]);
    const err = await failureFrom(
      fetchDocument("https://sneaky.example/", opts({ fetchImpl: impl, resolve: async () => ["10.0.0.5"] })),
    );
    expect(err.code).toBe("blocked-address");
    expect(err.message).toContain("10.0.0.5");
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Reading what came back
 * ------------------------------------------------------------------ */

describe("charsetFromContentType", () => {
  it("reads the plain form", () => {
    expect(charsetFromContentType("text/html; charset=utf-8")).toBe("utf-8");
    expect(charsetFromContentType("text/html;charset=ISO-8859-1")).toBe("ISO-8859-1");
  });

  it("strips the quotes Instagram puts round it", () => {
    // Observed verbatim: `content-type: text/html; charset="utf-8"`.
    expect(charsetFromContentType('text/html; charset="utf-8"')).toBe("utf-8");
    expect(charsetFromContentType("text/html; charset='utf-8'")).toBe("utf-8");
  });

  it("is null when there isn't one", () => {
    expect(charsetFromContentType("text/html")).toBeNull();
    expect(charsetFromContentType(null)).toBeNull();
  });
});

describe("mimeType", () => {
  it("drops the parameters and the case", () => {
    expect(mimeType("Text/HTML; charset=utf-8")).toBe("text/html");
    expect(mimeType("application/pdf")).toBe("application/pdf");
    expect(mimeType(null)).toBeNull();
  });
});

describe("sniffKind", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const page = new TextEncoder().encode("<!doctype html><html><body><p>hello</p></body></html>");

  it("believes the bytes over the header, in both directions", () => {
    // Publishers really do serve PDFs as octet-stream...
    expect(sniffKind("application/octet-stream", pdf)).toBe("pdf");
    expect(sniffKind("text/plain", pdf)).toBe("pdf");
    // ...and bot walls really do serve HTML challenge pages on a PDF URL.
    expect(sniffKind("application/pdf", page)).toBe("html");
  });

  it("takes the header's word for HTML", () => {
    expect(sniffKind("text/html; charset=utf-8", page)).toBe("html");
    expect(sniffKind("application/xhtml+xml", page)).toBe("html");
  });

  it("believes markup when there is no header at all", () => {
    // httpbin.org/status/401 sends no content-type whatsoever.
    expect(sniffKind(null, page)).toBe("html");
  });

  it("refuses what it can't read", () => {
    expect(sniffKind("image/png", bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffKind("application/json", new TextEncoder().encode('{"a":1}'))).toBeNull();
    expect(sniffKind("text/plain", new TextEncoder().encode("Chapter 1. It is a truth"))).toBeNull();
  });

  it("is not fooled by a page that talks about PDFs", () => {
    /* A bare `%PDF-` anywhere in the first kilobyte is much looser than the
       format, which puts the header on the first line. This page would have
       been filed as a PDF and never rendered. */
    const page = new TextEncoder().encode(
      '<!doctype html><html><head><script>const header = "%PDF-1.7";</script></head><body><p>About PDFs</p></body></html>',
    );
    expect(sniffKind("text/html", page)).toBe("html");
  });

  it("is not fooled by JSON that happens to contain markup", () => {
    const json = new TextEncoder().encode('{"template":"<p>hello</p>","id":7}');
    expect(sniffKind(null, json)).toBeNull();
    expect(sniffKind("application/octet-stream", json)).toBeNull();
  });

  it("finds a PDF header that straddles the end of the window", () => {
    const padded = new Uint8Array([
      ...new Uint8Array(1020).fill(0x20),
      ...new TextEncoder().encode("%PDF-1.4\n"),
    ]);
    expect(sniffKind("application/octet-stream", padded)).toBe("pdf");
  });

  it("finds a PDF header hiding behind a few junk bytes", () => {
    const junked = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a, ...pdf]);
    expect(sniffKind(null, junked)).toBe("pdf");
  });
});

describe("decodeHtml", () => {
  /* Real bytes from aozora.gr.jp: a Shift_JIS page whose only declaration is a
     <meta> tag, because the Content-Type header carries no charset. */
  const SJIS_TITLE = Buffer.from("89c496da9ff990ce208ce1947982cd944c82c582a082e9", "hex");

  it("decodes a page that declares its charset only in the markup", () => {
    const page = Buffer.concat([
      Buffer.from('<html><head><meta charset="Shift_JIS"><title>'),
      SJIS_TITLE,
      Buffer.from("</title></head><body>x</body></html>"),
    ]);
    const { text, encoding } = decodeHtml(new Uint8Array(page), "text/html");
    expect(encoding).toBe("Shift_JIS");
    expect(text).toContain("夏目漱石 吾輩は猫である");
  });

  it("is what res.text() would have got wrong", () => {
    // The failure this function exists to prevent: no error, just mojibake.
    const naive = new TextDecoder("utf-8").decode(SJIS_TITLE);
    expect(naive).not.toContain("夏目漱石");
    expect(naive).toContain("�");
  });

  it("takes the charset from the header when there is one", () => {
    // 0x93 0x94 are curly quotes in windows-1252 and invalid UTF-8.
    const page = new Uint8Array([...new TextEncoder().encode("<html><p>"), 0x93, 0x94]);
    const { text, encoding } = decodeHtml(page, "text/html; charset=windows-1252");
    expect(encoding).toBe("windows-1252");
    expect(text).toContain("“”");
  });

  it("decodes the windows-1252 C1 range as punctuation, not control characters", () => {
    /* Byte 0x80 and 0x91–0x97 are the euro sign, both pairs of curly quotes and
       the en- and em-dash — the punctuation of ordinary English prose. Decode
       them as ISO-8859-1 and they become invisible C1 control characters:
       nothing throws, the text just quietly stops having quotation marks in it. */
    const punctuation = new Uint8Array([0x80, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97]);
    expect(decodeHtml(punctuation, "text/plain; charset=windows-1252").text).toBe("€‘’“”–—");
  });

  it("decodes the Shift_JIS bytes Node's own decoder still gets wrong", () => {
    /* This is the test that catches src/fetch.ts being switched to the global
       TextDecoder, and it deliberately asserts nothing about Node.

       The test that used to do that job asserted Node decoded windows-1252
       *wrongly*. Node fixed that in 24.13.1, so the assertion went red without
       anything here having changed, and the red looked like our bug. Never pin
       somebody else's defect: docs/postmortems/windows-1252-node-caught-up.md.

       Node's single-byte decoders are conformant now, but its multi-byte legacy
       ones still go through ICU and are not. The spec says a Shift_JIS byte of
       0x80 or below decodes to its own code point; ICU rotates 0x1A/0x1C/0x7F
       and rejects 0x80. So this fails today if the import is swapped, and it
       goes on passing — rather than going red — if Node ever agrees. */
    const controls = new Uint8Array([0x1a, 0x1c, 0x7f, 0x80]);
    const { text, encoding } = decodeHtml(controls, "text/plain; charset=shift_jis");
    expect(encoding).toBe("Shift_JIS");
    expect(text).toBe("\u001a\u001c\u007f\u0080");
  });

  it("lets a BOM overrule the header", () => {
    const page = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<html><p>café")]);
    const { text, encoding } = decodeHtml(page, "text/html; charset=windows-1252");
    expect(encoding).toBe("UTF-8");
    expect(text).toContain("café");
  });

  it("is not fooled by a charset hidden inside another quoted parameter", () => {
    /* HTTP allows a semicolon inside a quoted value, so a regex that splits on
       semicolons reads the decoy and decodes the whole page with it. */
    const header = 'text/html; note="x;charset=shift_jis"; charset=utf-8';
    expect(charsetFromContentType(header)).toBe("utf-8");
    expect(decodeHtml(new TextEncoder().encode("<html><p>café"), header).text).toContain("café");
  });

  it("decodes XHTML by XML's rules, not HTML's", () => {
    /* XML defaults to UTF-8 and has no `<meta charset>` prescan. Run through
       the HTML algorithm it defaults to windows-1252 instead — which decodes
       any byte sequence at all, so it never fails loudly, it just quietly
       produces `café`. */
    const doc = new TextEncoder().encode('<?xml version="1.0"?><html><p>café</p></html>');
    const { text, encoding } = decodeHtml(doc, "application/xhtml+xml");
    expect(encoding).toBe("UTF-8");
    expect(text).toContain("café");
  });

  it("handles the quoted header charset end to end", () => {
    const page = new TextEncoder().encode("<html><p>café");
    expect(decodeHtml(page, 'text/html; charset="utf-8"').text).toContain("café");
  });
});

describe("readCapped", () => {
  it("returns the whole body when it fits, in order", async () => {
    const out = await readCapped(streamOf(bytes(1, 2), bytes(3)), 10, "u");
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("allows exactly the cap", async () => {
    const out = await readCapped(streamOf(bytes(1, 2, 3)), 3, "u");
    expect(out.byteLength).toBe(3);
  });

  it("gives up one byte over, and closes the socket", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(1, 2, 3, 4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const err = await failureFrom(readCapped(stream, 3, "https://example.com/big"));
    expect(err.code).toBe("too-large");
    expect(cancelled).toBe(true);
  });

  it("treats a bodyless response as empty rather than throwing", async () => {
    expect((await readCapped(null, 10, "u")).byteLength).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Size, and the header that lies about it
 * ------------------------------------------------------------------ */

describe("the size cap", () => {
  it("catches a body bigger than its own content-length", async () => {
    /* google.com declares 86,616 and hands over 285,514 — the header describes
       the compressed wire size, and what arrives is decompressed. A cap read
       off the header is a cap on the wrong number. */
    const body = new Uint8Array(300);
    const { impl } = scripted([
      new Response(streamOf(body), {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "86" },
      }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl, maxBytes: 100 })));
    expect(err.code).toBe("too-large");
  });

  it("does not refuse a real page because the header overstates its size", async () => {
    /* The mirror of the case above, and the reason the cap is enforced in one
       place only. A tiny document with an absurd declared length is a server
       being wrong about its own body — the same server whose header we already
       decided not to believe. Refusing it would be confident and wrong. */
    const small = new TextEncoder().encode("%PDF-1.4\nshort but real\n");
    const { impl } = scripted([
      new Response(small, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(50 * 1024 * 1024) },
      }),
    ]);
    const doc = await fetchDocument("https://example.com/small.pdf", opts({ fetchImpl: impl, maxBytes: 1000 }));
    expect(doc.kind).toBe("pdf");
    expect(doc.bytes.byteLength).toBe(small.byteLength);
  });

  it("cannot have its cap removed by a nonsense value", async () => {
    /* `total > NaN` is false for every total, so a NaN here silently uncaps the
       read rather than raising the ceiling. */
    const { impl } = scripted([
      new Response(streamOf(new Uint8Array(5_000)), { status: 200, headers: { "content-type": "text/html" } }),
    ]);
    const doc = await fetchDocument("https://example.com/", opts({ fetchImpl: impl, maxBytes: Number.NaN }));
    expect(doc.bytes.byteLength).toBe(5_000); // fell back to the real default, which is far larger
    expect(DEFAULTS.maxBytes).toBeGreaterThan(5_000);
  });

  it("has room for the 4.9 MB PDF that a 4 MB cap would have refused", () => {
    // sas.upenn.edu/~cavitch/pdf-library/Nagel_Bat.pdf, measured: 4,930,377 bytes.
    expect(DEFAULTS.maxBytes).toBeGreaterThan(4_930_377);
  });
});

/* ------------------------------------------------------------------ *
 * Redirects
 * ------------------------------------------------------------------ */

describe("redirects", () => {
  it("follows the chain, keeps it, and reports where it ended", async () => {
    const { impl, calls } = scripted([
      new Response(null, { status: 301, headers: { location: "https://www.example.com/a" } }),
      new Response(null, { status: 302, headers: { location: "/b" } }),
      html("<html><p>here"),
    ]);
    const doc = await fetchDocument("http://example.com/a", opts({ fetchImpl: impl }));
    expect(doc.requestedUrl).toBe("http://example.com/a");
    expect(doc.url).toBe("https://www.example.com/b");
    expect(doc.chain).toEqual([
      "http://example.com/a",
      "https://www.example.com/a",
      "https://www.example.com/b",
    ]);
    expect(calls.map((call) => call.url)).toEqual(doc.chain);
  });

  it("stops a loop rather than spinning to the hop limit", async () => {
    const { impl } = scripted([
      new Response(null, { status: 302, headers: { location: "https://example.com/b" } }),
      new Response(null, { status: 302, headers: { location: "https://example.com/" } }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("too-many-redirects");
    expect(err.message).toContain("loop");
  });

  it("gives up after the hop limit", async () => {
    const replies: Reply[] = [];
    for (let i = 0; i < 10; i++) {
      replies.push(new Response(null, { status: 302, headers: { location: `https://example.com/${i}` } }));
    }
    const { impl, calls } = scripted(replies);
    const err = await failureFrom(fetchDocument("https://example.com/start", opts({ fetchImpl: impl, maxRedirects: 3 })));
    expect(err.code).toBe("too-many-redirects");
    expect(calls).toHaveLength(4); // the original, then three hops
  });

  it("won't follow a redirect out of http and https", async () => {
    const { impl } = scripted([
      new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("unsupported-scheme");
  });

  it("checks each new address, not just the first", async () => {
    const { impl } = scripted([
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("blocked-address");
  });

  it("calls a fragment-only redirect a loop, not five wasted hops", async () => {
    /* The fragment never reaches the server, so `/a` → `/a#one` is a second
       request for the same resource. */
    const { impl, calls } = scripted([
      new Response(null, { status: 302, headers: { location: "https://example.com/a#one" } }),
      new Response(null, { status: 302, headers: { location: "https://example.com/a#two" } }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/a", opts({ fetchImpl: impl })));
    expect(err.code).toBe("too-many-redirects");
    expect(err.message).toContain("loop");
    expect(calls).toHaveLength(1);
  });

  it("doesn't quote an unreadable Location header back into the message", async () => {
    /* The `Location` header comes from a remote server we do not trust, and a
       `FetchFailure` message is LOGGED — a failed fetch step reaches
       src/jobs.ts, which records a thrown error's message and its stack. So
       whatever a hostile or broken site puts in that header would be written
       down twice, and redaction is path-based and can reach neither
       (docs/project/logging.md).

       This message used to interpolate it. Nothing is lost by dropping it: the
       reader cannot act on an address they never chose to visit, and the code
       already tells whoever is running the server which failure this was. */
    const { impl } = scripted([
      new Response(null, {
        status: 302,
        headers: { location: "http://[bad]/private?token=REDIRECT-SECRET-5555" },
      }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("invalid-url");
    expect(err.message).not.toContain("REDIRECT-SECRET-5555");
    expect(err.message).not.toContain("[bad]");
  });

  it("says so when a redirect names nowhere", async () => {
    const { impl } = scripted([new Response(null, { status: 302 })]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("http-error");
    expect(err.message).toContain("without saying where");
  });
});

/* ------------------------------------------------------------------ *
 * Statuses and failures
 * ------------------------------------------------------------------ */

describe("classifyStatus", () => {
  it("separates the three answers a reader can act on", () => {
    expect(classifyStatus(401, "u", null).code).toBe("unauthorized");
    expect(classifyStatus(403, "u", null).code).toBe("forbidden");
    expect(classifyStatus(404, "u", null).code).toBe("not-found");
  });

  it("marks only the transient ones retryable", () => {
    expect(classifyStatus(429, "u", null).retryable).toBe(true);
    expect(classifyStatus(503, "u", null).retryable).toBe(true);
    expect(classifyStatus(500, "u", null).retryable).toBe(false);
    expect(classifyStatus(403, "u", null).retryable).toBe(false);
    expect(classifyStatus(404, "u", null).retryable).toBe(false);
  });

  it("keeps the status on the failure", () => {
    expect(classifyStatus(418, "u", null).status).toBe(418);
  });
});

describe("retryAfterMs", () => {
  it("reads the seconds form", () => {
    expect(retryAfterMs("120", NOW)).toBe(120_000);
  });

  it("reads the date form, relative to now", () => {
    expect(retryAfterMs("Tue, 25 Aug 2026 12:00:30 GMT", NOW)).toBe(30_000);
  });

  it("never returns a negative wait for a date already past", () => {
    expect(retryAfterMs("Tue, 25 Aug 2026 11:59:00 GMT", NOW)).toBe(0);
  });

  it("is null for nonsense or nothing", () => {
    expect(retryAfterMs("soon", NOW)).toBeNull();
    expect(retryAfterMs(null, NOW)).toBeNull();
  });
});

describe("classifyNetworkError", () => {
  /* Every one of these arrives as `TypeError: fetch failed`. The whole point of
     this function is that the message cannot tell them apart and cause.code can. */
  it("tells the identical TypeErrors apart by cause.code", () => {
    const cases: Array<[string, string]> = [
      ["ENOTFOUND", "dns"],
      ["ECONNREFUSED", "connection"],
      ["ECONNRESET", "connection"],
      ["CERT_HAS_EXPIRED", "certificate"],
      ["DEPTH_ZERO_SELF_SIGNED_CERT", "certificate"],
      ["SELF_SIGNED_CERT_IN_CHAIN", "certificate"],
      ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "certificate"],
    ];
    for (const [code, expected] of cases) {
      const failure = classifyNetworkError(nodeFetchError(code), "https://example.com/");
      expect(failure.code, code).toBe(expected);
      expect(failure.message, code).not.toBe("fetch failed");
    }
  });

  it("explains the incomplete chain, because the browser made it look fine", () => {
    const failure = classifyNetworkError(
      nodeFetchError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "unable to verify the first certificate"),
      "https://incomplete-chain.badssl.com/",
    );
    expect(failure.message).toContain("intermediate");
    expect(failure.message).toContain("browser");
    expect(failure.retryable).toBe(false);
  });

  it("retries a reset connection and a flaky resolver, but not a missing name", () => {
    expect(classifyNetworkError(nodeFetchError("ECONNRESET"), "u").retryable).toBe(true);
    expect(classifyNetworkError(nodeFetchError("EAI_AGAIN"), "u").retryable).toBe(true);
    expect(classifyNetworkError(nodeFetchError("ENOTFOUND"), "u").retryable).toBe(false);
  });

  it("does not call a handshake failure a certificate problem", () => {
    /* `/SSL/` matched ERR_SSL_WRONG_VERSION_NUMBER, which has nothing wrong
       with its certificate — and telling someone to look at the certificate
       sends them somewhere with nothing in it. */
    const failure = classifyNetworkError(nodeFetchError("ERR_SSL_WRONG_VERSION_NUMBER"), "u");
    expect(failure.code).toBe("connection");
    expect(failure.message).not.toContain("certificate");
  });

  it("recognises a timeout", () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const failure = classifyNetworkError(timeout, "u");
    expect(failure.code).toBe("timeout");
    expect(failure.retryable).toBe(true);
  });

  it("finds the code on the error itself, not just on its cause", async () => {
    /* `dns.lookup` — which the address guard calls before any fetch — throws a
       bare Error with `.code` on it, where `fetch` hangs the code on `.cause`.
       Reading only `cause.code` reported every unresolvable domain as a generic
       connection failure. Found by running it against a real dead domain, not here. */
    const bare = Object.assign(new Error("getaddrinfo ENOTFOUND nope.example"), { code: "ENOTFOUND" });
    expect(classifyNetworkError(bare, "https://nope.example/").code).toBe("dns");

    const { impl, calls } = scripted([]);
    const failure = await failureFrom(
      fetchDocument(
        "https://nope.example/",
        opts({ fetchImpl: impl, resolve: async () => Promise.reject(bare) }),
      ),
    );
    expect(failure.code).toBe("dns");
    expect(calls).toHaveLength(0);
  });

  it("passes a FetchFailure through untouched", () => {
    const original = new FetchFailure("too-large", "u", "big");
    expect(classifyNetworkError(original, "u")).toBe(original);
  });
});

/* ------------------------------------------------------------------ *
 * Retrying
 * ------------------------------------------------------------------ */

describe("retryDelayMs", () => {
  it("does what the server asked, when it asked", () => {
    expect(retryDelayMs(1, 5_000, () => 0.5)).toBe(5_000);
  });

  it("caps an unreasonable Retry-After", () => {
    expect(retryDelayMs(1, 600_000, () => 0.5)).toBe(10_000);
  });

  it("backs off, with the jitter drawn from zero to the ceiling", () => {
    expect(retryDelayMs(1, null, () => 1)).toBe(500);
    expect(retryDelayMs(2, null, () => 1)).toBe(1_000);
    expect(retryDelayMs(3, null, () => 1)).toBe(2_000);
    expect(retryDelayMs(1, null, () => 0)).toBe(0);
    expect(retryDelayMs(9, null, () => 1)).toBe(4_000); // ceiling
  });
});

describe("retrying", () => {
  it("tries again after a 503 and takes the second answer", async () => {
    const { impl, calls } = scripted([
      new Response("busy", { status: 503 }),
      html("<html><p>at last"),
    ]);
    const doc = await fetchDocument("https://example.com/", opts({ fetchImpl: impl, attempts: 3 }));
    expect(doc.text).toContain("at last");
    expect(calls).toHaveLength(2);
  });

  it("does not try again after a 404", async () => {
    const { impl, calls } = scripted([new Response("gone", { status: 404 })]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl, attempts: 3 })));
    expect(err.code).toBe("not-found");
    expect(calls).toHaveLength(1);
  });

  it("waits what a 429 asked it to wait", async () => {
    const waits: number[] = [];
    const { impl } = scripted([
      new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
      html("<html><p>ok"),
    ]);
    await fetchDocument(
      "https://example.com/",
      opts({ fetchImpl: impl, attempts: 2, sleep: async (ms) => void waits.push(ms) }),
    );
    expect(waits).toEqual([2_000]);
  });

  it("gives up after the last attempt and reports the real reason", async () => {
    const { impl, calls } = scripted([
      nodeFetchError("ECONNRESET"),
      nodeFetchError("ECONNRESET"),
      nodeFetchError("ECONNRESET"),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl, attempts: 3 })));
    expect(err.code).toBe("connection");
    expect(calls).toHaveLength(3);
  });

  it("cannot be told to retry forever", async () => {
    /* Every one of these numbers is a bound something else compares against,
       and the comparisons fail open. `attempts: Infinity` never stops; a NaN
       makes every comparison false, so it does not raise the bound — it deletes
       it, while the code still reads as though a bound were in force. */
    const replies = Array.from({ length: 20 }, () => nodeFetchError("ECONNRESET"));
    const { impl, calls } = scripted(replies);
    const err = await failureFrom(
      fetchDocument("https://example.com/", opts({ fetchImpl: impl, attempts: Number.POSITIVE_INFINITY })),
    );
    expect(err.code).toBe("connection");
    expect(calls.length).toBeLessThanOrEqual(5);

    const nonsense = scripted(Array.from({ length: 20 }, () => nodeFetchError("ECONNRESET")));
    await failureFrom(
      fetchDocument("https://example.com/", opts({ fetchImpl: nonsense.impl, attempts: Number.NaN })),
    );
    expect(nonsense.calls).toHaveLength(DEFAULTS.attempts); // nonsense falls back to the default
  });

  it("does not retry a certificate problem — it will fail the same way forever", async () => {
    const { impl, calls } = scripted([nodeFetchError("UNABLE_TO_VERIFY_LEAF_SIGNATURE")]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl, attempts: 3 })));
    expect(err.code).toBe("certificate");
    expect(calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * The whole thing
 * ------------------------------------------------------------------ */

describe("fetchDocument", () => {
  it("returns decoded HTML, and stamps it with the injected clock", async () => {
    const { impl } = scripted([html("<html><p>hello")]);
    const doc = await fetchDocument("https://example.com/", opts({ fetchImpl: impl }));
    expect(doc.kind).toBe("html");
    expect(doc.text).toContain("hello");
    expect(doc.status).toBe(200);
    expect(doc.fetchedAt).toBe("2026-08-25T12:00:00.000Z");
    expect(doc.chain).toEqual(["https://example.com/"]);
  });

  it("returns a PDF as bytes, with no text and no encoding", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.3\nbody");
    const { impl } = scripted([
      new Response(pdf, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    ]);
    const doc = await fetchDocument("https://example.com/paper.pdf", opts({ fetchImpl: impl }));
    expect(doc.kind).toBe("pdf");
    expect(doc.text).toBeNull();
    expect(doc.encoding).toBeNull();
    expect(doc.bytes.byteLength).toBe(pdf.byteLength);
  });

  it("sends a User-Agent and leaves Accept-Encoding alone", async () => {
    const { impl, calls } = scripted([html("<html><p>x")]);
    await fetchDocument("https://example.com/", opts({ fetchImpl: impl, userAgent: "Spideryarn/test" }));
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Spideryarn/test");
    /* Setting this by hand is how you turn undici's automatic decompression
       off. The absence is the assertion. */
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("accept-encoding");
  });

  it("follows redirects itself rather than letting fetch do it", async () => {
    const { impl, calls } = scripted([html("<html><p>x")]);
    await fetchDocument("https://example.com/", opts({ fetchImpl: impl }));
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  it("refuses an image politely", async () => {
    const { impl } = scripted([
      new Response(bytes(0x89, 0x50, 0x4e, 0x47), { status: 200, headers: { "content-type": "image/png" } }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/cat.png", opts({ fetchImpl: impl })));
    expect(err.code).toBe("unsupported-type");
    expect(err.message).toContain("image/png");
  });

  it("calls an empty 200 empty rather than an article", async () => {
    const { impl } = scripted([new Response("", { status: 200, headers: { "content-type": "text/html" } })]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("empty");
  });

  it("lets go of the body of a page it is refusing", async () => {
    /* Wikipedia's 404 is a full 51 KB rendered page, not a stub — so a refused
       response is a live socket with real content still coming down it. This
       used to assert the status a second time and call itself a size test,
       which is a test that cannot fail. */
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<html><p>a full page of not-found"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { impl } = scripted([new Response(body, { status: 404, headers: { "content-type": "text/html" } })]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("not-found");
    expect(err.status).toBe(404);
    expect(cancelled).toBe(true);
  });

  it("lets go of the body of a redirect before following it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<html>moved"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { impl } = scripted([
      new Response(body, { status: 301, headers: { location: "https://example.com/b" } }),
      html("<html><p>arrived"),
    ]);
    await fetchDocument("https://example.com/a", opts({ fetchImpl: impl }));
    expect(cancelled).toBe(true);
  });

  it("refuses a partial response rather than storing half an article", async () => {
    /* We never ask for a range, so a 206 means something between us and the
       server is interfering. It is a 2xx, so `res.ok` waves it through. */
    const { impl } = scripted([
      new Response("<html><p>partial", {
        status: 206,
        headers: { "content-type": "text/html", "content-range": "bytes 0-15/1000" },
      }),
    ]);
    const err = await failureFrom(fetchDocument("https://example.com/", opts({ fetchImpl: impl })));
    expect(err.code).toBe("http-error");
    expect(err.message).toContain("only part");
  });
});

describe("the deadline", () => {
  it("covers the DNS lookup, not just the fetch", async () => {
    /* The deadline was applied to `fetch` and nothing else, so a resolver that
       never answered held the whole thing open past it — "30 seconds" really
       meaning "30 seconds, plus however long DNS feels like". A synthetic
       TimeoutError test passes happily while that is true, which is why this
       one hangs a real never-resolving promise instead. */
    const { impl, calls } = scripted([]);
    const err = await failureFrom(
      fetchDocument(
        "https://slow-dns.example/",
        opts({ fetchImpl: impl, timeoutMs: 20, resolve: () => new Promise<string[]>(() => {}) }),
      ),
    );
    expect(err.code).toBe("timeout");
    expect(calls).toHaveLength(0);
  });

  it("stops waiting to retry when the caller cancels", async () => {
    const controller = new AbortController();
    const { impl } = scripted([new Response("busy", { status: 503 }), html("<html><p>never reached")]);
    const err = await failureFrom(
      fetchDocument(
        "https://example.com/",
        opts({
          fetchImpl: impl,
          attempts: 3,
          signal: controller.signal,
          sleep: async () => {
            controller.abort();
            await new Promise<void>(() => {}); // a backoff that never ends on its own
          },
        }),
      ),
    );
    expect(err.code).toBe("timeout");
    expect(err.message).toContain("cancelled");
  });
});

describe("naming the right server", () => {
  it("blames the host that actually failed, not the one that redirected", async () => {
    /* After a redirect the two are different servers, and reporting the origin
       sends the reader to debug the end that behaved correctly. */
    const { impl } = scripted([
      new Response(null, { status: 301, headers: { location: "https://elsewhere.example/x" } }),
      nodeFetchError("ECONNREFUSED"),
    ]);
    const err = await failureFrom(fetchDocument("https://origin.example/a", opts({ fetchImpl: impl })));
    expect(err.message).toContain("elsewhere.example");
    expect(err.message).not.toContain("origin.example");
    expect(err.url).toBe("https://elsewhere.example/x");
  });
});

describe("fetchHtml", () => {
  it("hands back the text for a page", async () => {
    const { impl } = scripted([html("<html><p>hello")]);
    expect(await fetchHtml("https://example.com/", opts({ fetchImpl: impl }))).toContain("hello");
  });

  it("refuses a PDF by name rather than returning a blank article", async () => {
    const { impl } = scripted([
      new Response(new TextEncoder().encode("%PDF-1.4\nx"), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    ]);
    const err = await failureFrom(fetchHtml("https://example.com/p.pdf", opts({ fetchImpl: impl })));
    expect(err.code).toBe("unsupported-type");
    expect(err.message).toContain("PDF");
  });
});
