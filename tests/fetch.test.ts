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
  uploadedDocumentKind,
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

/* ------------------------------------------------------------------ *
 * What the document starts with
 * ------------------------------------------------------------------ */

const enc = new TextEncoder();

/** A whole page, well formed. The easy case, which both predicates must pass. */
const PAGE = "<!doctype html><html><head><title>U</title></head><body><p>Prose.</p></body></html>";

/**
 * The same markup in UTF-16 — the encoding a Latin-1 scan physically cannot
 * read, because every ASCII character is followed by a `\0`.
 *
 * `bom` is a parameter rather than a given because the two answers differ and
 * both are decided rather than accidental: with a BOM the file says what it is
 * and we read it; without one it says nothing, trips the binary-data-byte test
 * on its own null bytes, and is refused. See the two tests that pin each.
 */
function utf16(text: string, littleEndian: boolean, bom = true): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let at = 0;
  if (bom) {
    out[0] = littleEndian ? 0xff : 0xfe;
    out[1] = littleEndian ? 0xfe : 0xff;
    at = 2;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[at + i * 2] = littleEndian ? c & 0xff : c >> 8;
    out[at + 1 + i * 2] = littleEndian ? c >> 8 : c & 0xff;
  }
  return out;
}

/**
 * A **real** UTF-8 BOM, as three bytes.
 *
 * `enc.encode("﻿…")` would produce the same three bytes, but writing the
 * character in a fixture proves nothing: the thing under test has to tell a
 * decoded `U+FEFF` from the raw `EF BB BF` in front of undecoded bytes, and a
 * helper that only ever sees one of them cannot be shown to. ⟨Sol F3⟩
 */
function withUtf8Bom(text: string): Uint8Array {
  return new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(text)]);
}

/* The four things a substring search over 16 KB called documents, measured
   against the code that shipped on 2026-09-07. Each declares another
   vocabulary in its first token, and none of them is a web page.
   docs/plans/260908a-match-the-documents-leading-tokens-instead-of-searching-for-markup.md */
const ATOM =
  '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">' +
  "<title>Atom</title><link href=\"https://example.com/\"/></feed>";
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>RSS</title></channel></rss>';
const SVG =
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">' +
  "<title>Chart</title><style>text{fill:#000}</style></svg>";
const JSON_WITH_SCRIPT = '{"template":"<script>alert(1)</script>","id":7}';

/**
 * The shape of the file that started all this: a 4 KB comment, then a bare
 * `<title>`, and no `<!doctype>`, `<html>`, `<head>` or `<body>` anywhere.
 */
const NO_WRAPPER =
  `<!--\n  Request (Greg, 2026-09-07, verbatim):\n  ${"a request, quoted at length. ".repeat(140)}\n-->` +
  "<title>Agent Communication and Orchestration</title>" +
  '<meta name="description" content="How sessions find and message each other.">' +
  "<style>:root { --ink: #1a1a1a; }</style>" +
  "<main><h1>Agent communication</h1><p>Prose.</p></main>";

/** XHTML: an XML prolog, then a doctype, then a root that *is* `<html>`. */
const XHTML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" ' +
  '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">' +
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>X</title></head><body><p>Prose.</p></body></html>';

/**
 * **The same question, asked of a file somebody uploaded** — where the only
 * "header" is the reader's own filename.
 *
 * **This predicate is the negative one, and that is the whole design.** The
 * reader has told us what the file is; the bytes are asked only whether they
 * *disprove* it. So the cases here are things that are provably something else
 * — binary, or an XML vocabulary that names itself — and everything textual
 * that merely fails to look like the author's picture of a web page is
 * accepted and left to stage 2. Two tests below were reversed to say so.
 * docs/plans/260908a-match-the-documents-leading-tokens-instead-of-searching-for-markup.md
 *
 * The case that nearly shipped broken is still here: a UTF-16 page, whose
 * markup is `<\0!\0d\0o…` and so invisible to the Latin-1 scan `sniffKind`
 * does. Found by a GPT Sol review, 2026-09-07.
 */
describe("uploadedDocumentKind", () => {
  const aPdf = enc.encode("%PDF-1.4\nhello\n%%EOF\n");

  it("reads a page whose markup no Latin-1 scan can see", () => {
    expect(uploadedDocumentKind("saved.html", utf16(PAGE, true))).toBe("html");
    expect(uploadedDocumentKind("saved.html", utf16(PAGE, false))).toBe("html");
    /* The plain case, so the fallback above cannot be the only thing working. */
    expect(uploadedDocumentKind("saved.html", enc.encode(PAGE))).toBe("html");
  });

  /**
   * **The name says PDF and the bytes say UTF-16 HTML** — and the bytes win.
   *
   * ⟨Sol F2.⟩ Until 2026-09-08 this returned `null`: `sniffKind` scanned the
   * raw bytes only, and `uploadedDocumentKind` reached its decoder only after
   * `sniffKind` had already said `"html"`, which for a `.pdf` name it never
   * would. So the filename overruled the bytes — the opposite of the rule this
   * module's docstrings state in three places. The fix put the decoded
   * fallback inside `sniffKind`'s own evidence path, which is why the same
   * fixture now works through both functions.
   */
  it("reads UTF-16 markup even when the name claims a PDF", () => {
    expect(uploadedDocumentKind("a.pdf", utf16(PAGE, true))).toBe("html");
    expect(uploadedDocumentKind("a.pdf", utf16(PAGE, false))).toBe("html");
  });

  it("believes the bytes over the name, in both directions", () => {
    expect(uploadedDocumentKind("mislabelled.html", aPdf)).toBe("pdf");
    expect(uploadedDocumentKind("mislabelled.pdf", enc.encode(PAGE))).toBe("html");
  });

  /* The tie the filename exists to break: `%PDF-` at byte zero is a PDF whatever
     anyone says, but a page that merely *mentions* one is a page — and without
     the claim it would go to the transcriber and be charged for. */
  it("does not send a page that mentions a PDF to the transcriber", () => {
    const mentions = enc.encode(PAGE.replace("<p>", "<p>about %PDF-1.7 files, "));
    expect(uploadedDocumentKind("p.html", mentions)).toBe("html");
  });

  /**
   * **The page with no `<body>`, because HTML does not require one.**
   *
   * Greg uploaded one of our own tutorial pages on 2026-09-07 and got
   * `[up-pdf]` — the sentence this feature had just reworded, from the check
   * this feature had just written. **Two independent things refused it and
   * either alone was enough**, which is why both are pinned in one case rather
   * than two:
   *
   *  1. It has no `<!doctype>`, no `<html>`, no `<head>` and no `<body>`
   *     **anywhere in 108 KB**. That is not a malformed file: tag omission is
   *     in the HTML spec, all three of those start tags are optional, and every
   *     browser builds the same tree from it.
   *  2. Its first tag is at byte 4106, behind a comment holding the request the
   *     page was written from. The old raw window was 1030 bytes and the old
   *     decoded window 4096 — so the marker sat ten bytes past the end of the
   *     only slice that could have seen it.
   *
   * The fixture keeps both properties. Its own `<title>` lands at 4111 rather
   * than the real file's 4106 — the assertion below is what makes it past the
   * old window, not the exact number, which nothing should depend on.
   * docs/postmortems/260907c-a-heuristic-promoted-to-a-gate.md.
   */
  it("reads a page that omits html, head and body, as the spec allows", () => {
    /* The guard that keeps this case about the *marker* and not only the
       window: move the comment and the assertion below still passes for the
       wrong reason. */
    expect(NO_WRAPPER.indexOf("<title")).toBeGreaterThan(4096);
    expect(uploadedDocumentKind("tutorial.html", enc.encode(NO_WRAPPER))).toBe("html");
    /* And on the fetched path too, where nothing declared anything: this file
       is the reason the positive predicate skips comments rather than stopping
       at the first byte. */
    expect(sniffKind(null, enc.encode(NO_WRAPPER))).toBe("html");
  });

  /**
   * **Every HTML file this repo actually holds**, rather than one this file's
   * author wrote.
   *
   * The countermeasure from
   * docs/postmortems/260907c-a-heuristic-promoted-to-a-gate.md, mechanised
   * rather than left as advice. Every fixture above began
   * `<!doctype html><html><head>`, because that is the picture of an HTML file
   * the person writing the check had in their head — so the suite proved the
   * check agreed with its author about what a document looks like, which is
   * docs/reusable/silent-success.md and not evidence.
   *
   * `docs/tutorials/` is the corpus because nobody wrote it for this test, and
   * one of its six files is the one that was refused in production. Reading the
   * repo from a unit test is unusual and deliberate: a detector needs input its
   * author did not choose, and this is the cheapest source of it we have.
   *
   * **If this goes red on a tutorial you just added**, the tutorial is probably
   * fine and the detector is probably wrong — that is the direction this failed
   * in last time. Read the file before you touch the detector.
   */
  it("reads every HTML file this repo already holds", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = new URL("../docs/tutorials/", import.meta.url);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".html"));
    /* A corpus that quietly became empty would make this test pass forever
       while checking nothing. */
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const fileBytes = new Uint8Array(await readFile(new URL(name, dir)));
      expect(uploadedDocumentKind(name, fileBytes), name).toBe("html");
    }
  });

  /**
   * **Reversed on 2026-09-08, and the reversal is the point of the change.**
   *
   * Both of these were pinned as `null` by the author of the old check, from
   * the author's own picture of what an HTML file looks like — which is the
   * last paragraph of
   * docs/postmortems/260907c-a-heuristic-promoted-to-a-gate.md and the mistake
   * that refused a real file in production. A `<div>` fragment and a page of
   * prose are both things a browser opens and a reader may legitimately hand
   * us; neither proves it is something *other* than a web page, and proof of
   * something else is now the only ground for refusing an upload. Stage 2 says
   * whether there is an article in it, which is stage 2's question.
   *
   * They stay `null` from `sniffKind`, where nothing has claimed anything and
   * we need a reason to say yes rather than a reason to say no. The two
   * predicates disagreeing here is the design working, not drift.
   */
  it("accepts a fragment and plain prose, and lets stage 2 judge them", () => {
    const fragment = enc.encode("<div><p>Just a fragment.</p></div>");
    const prose = enc.encode(`prose, ${"x".repeat(400)}`);
    expect(uploadedDocumentKind("part.html", fragment)).toBe("html");
    expect(uploadedDocumentKind("notes.html", prose)).toBe("html");
    expect(sniffKind(null, fragment)).toBeNull();
    expect(sniffKind(null, prose)).toBeNull();
  });

  /**
   * **The veto, and it is a closed rule rather than a list of formats.**
   *
   * The WHATWG binary-data-byte test — any of `0x00–0x08`, `0x0B`, `0x0E–0x1A`,
   * `0x1C–0x1F` in the resource header — is the spec's own answer to *is this
   * text at all*, and one rule covers PNG, ZIP and everything built on it, a
   * renamed video and the rest without anybody enumerating them. Enumerating
   * them is the open-ended blocklist this design rejected, and forgetting an
   * entry is exactly how the original bug was made.
   */
  it("refuses a file whose bytes are not text, whatever it is called", () => {
    expect(uploadedDocumentKind("movie.html", new Uint8Array(3000).fill(7))).toBeNull();
    expect(uploadedDocumentKind("shot.html", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00))).toBeNull();
    expect(uploadedDocumentKind("book.html", bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00))).toBeNull();
    expect(uploadedDocumentKind("paper.pdf", enc.encode("PK this is a zip"))).toBeNull();
  });

  /**
   * **The one text rule beside it: an `<?xml` prolog whose root is not `<html`.**
   *
   * A rule *about XML* rather than a list of XML vocabularies, so Atom, RSS,
   * RDF and a prolog'd SVG all go in one line — and none of them needed
   * naming. All four were accepted as web pages by the substring search that
   * shipped on 2026-09-07.
   */
  it("refuses a file that declares itself another XML vocabulary", () => {
    expect(uploadedDocumentKind("feed.html", enc.encode(ATOM))).toBeNull();
    expect(uploadedDocumentKind("feed.html", enc.encode(RSS))).toBeNull();
    expect(uploadedDocumentKind("chart.html", enc.encode(SVG))).toBeNull();
  });

  /** XHTML is the case the rule above must not catch: its root *is* `<html>`. */
  it("reads XHTML, prolog, doctype and all", () => {
    expect(uploadedDocumentKind("page.html", enc.encode(XHTML))).toBe("html");
    expect(sniffKind(null, enc.encode(XHTML))).toBe("html");
  });

  /**
   * **The cost of the veto being closed, named rather than discovered later.**
   *
   * A feed with no `<?xml` prolog declares nothing about itself and is text, so
   * the upload path accepts it and stage 2 decides. That is the knowingly
   * imperfect label moving from stage 1 to stage 2, argued in the plan's review
   * ledger under F4: one reader's own chosen file, their own slot, visible to
   * nobody else — against the unbounded alternative of a valid file with no
   * route in, which is the bug this whole thread started with.
   */
  it("accepts a prolog-less feed, which is the trade being made", () => {
    const prologLess = enc.encode("<feed><title>Atom</title><entry><summary>x</summary></entry></feed>");
    expect(uploadedDocumentKind("feed.html", prologLess)).toBe("html");
    /* Not on the fetched path, where `<feed` is no reason to say yes. */
    expect(sniffKind(null, prologLess)).toBeNull();
  });

  /**
   * **BOM-less UTF-16 is refused, and that is a decision.**
   *
   * It is full of `0x00`, so the binary-data-byte test trips. The spec's UTF-16
   * BOM check runs first, which is why the BOM'd fixture at the top of this
   * describe is read — a file that says what it is gets read, a file that says
   * nothing and looks like binary does not. Pinned so the next person finds a
   * decision here rather than a gap.
   */
  it("refuses BOM-less UTF-16, deliberately", () => {
    expect(uploadedDocumentKind("saved.html", utf16(PAGE, true, false))).toBeNull();
    expect(uploadedDocumentKind("saved.html", utf16(PAGE, false, false))).toBeNull();
  });

  /**
   * **Sol F3: three independent cases, because one combined case proved less
   * than it looked.**
   *
   * The combined version would pass under an implementation that treats a
   * leading `<!--` as *positive* HTML evidence — which is what the WHATWG table
   * actually says — instead of skipping the comment and asking what follows it.
   * That mistake accepts `<!-- generated --><feed>…`, so the third case is the
   * one that can tell them apart, and it belongs on the fetched path where a
   * wrong yes is unrecoverable.
   */
  it("skips a comment rather than counting it as evidence", () => {
    expect(uploadedDocumentKind("page.html", enc.encode("<title>T</title><main>Prose.</main>"))).toBe("html");
    expect(
      uploadedDocumentKind("page.html", enc.encode(`<!--${"x".repeat(5000)}--><title>T</title><main>Prose.</main>`)),
    ).toBe("html");
    expect(sniffKind(null, enc.encode("<!-- generated --><feed><title>Atom</title></feed>"))).toBeNull();
  });

  /** A page Chrome saved: its own comment first, then the document. */
  it("reads a page saved by a browser", () => {
    const saved = `<!-- saved from url=(0035)https://example.com/a-page -->\n${PAGE}`;
    expect(uploadedDocumentKind("saved.html", enc.encode(saved))).toBe("html");
    expect(sniffKind(null, enc.encode(saved))).toBe("html");
  });

  /**
   * **A real three-byte BOM in front of real bytes**, not a `U+FEFF` in a
   * string — because the thing under test walks raw bytes *and* decoded text,
   * and a fixture that only ever holds one spelling cannot show it handles
   * both. ⟨Sol F3⟩
   *
   * **The third case is the one that isolates the byte walk**, and it was added
   * after mutation testing: with only the first two, deleting the raw
   * `EF BB BF` skip left the suite green, because the decoded fallback strips
   * the BOM itself and answered for it. The byte walk is the only uncapped one,
   * so a BOM followed by a comment longer than `MARKUP_WINDOW` is the case the
   * decoder cannot rescue — and it is not contrived: the tutorial page that
   * caused all this carries 4 KB of quoted request, and 16 KB of it is a
   * licence header away.
   */
  it("looks past a UTF-8 BOM, as bytes", () => {
    expect(uploadedDocumentKind("bom.html", withUtf8Bom(PAGE))).toBe("html");
    expect(sniffKind(null, withUtf8Bom(PAGE))).toBe("html");
    expect(sniffKind(null, withUtf8Bom(ATOM))).toBeNull();
    const behindALongComment = `<!--${"x".repeat(20_000)}--><title>T</title><main>Prose.</main>`;
    expect(sniffKind(null, withUtf8Bom(behindALongComment))).toBe("html");
  });
});

/**
 * **The fetched path, where nothing has claimed anything.**
 *
 * This predicate is the positive one: a vague or absent content type means we
 * are guessing, so we need a reason to say yes, and the reason is the WHATWG
 * signature table matched **at the leading position** — never searched for. The
 * asymmetry with `uploadedDocumentKind` above is deliberate and argued in
 * docs/plans/260908a-match-the-documents-leading-tokens-instead-of-searching-for-markup.md.
 */
describe("sniffKind", () => {
  const pdf = enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const page = enc.encode("<!doctype html><html><body><p>hello</p></body></html>");

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
    expect(sniffKind("application/json", enc.encode('{"a":1}'))).toBeNull();
    expect(sniffKind("text/plain", enc.encode("Chapter 1. It is a truth"))).toBeNull();
  });

  /**
   * **⟨Sol F5⟩ A live bug, and the suite was green over it for the third time
   * in this one function.**
   *
   * The case below existed and passed `"text/html"` as the content type — so
   * `declaredHtml` short-circuited and the branch under test never ran. With a
   * vague header, which is the only header that reaches this branch, a page
   * that merely mentions `%PDF-1.7` in its first kilobyte was filed as a PDF
   * and sent to the transcriber: money spent to produce nothing readable. The
   * ordering is the detector's contract — `%PDF-` at byte zero is unconditional
   * because that is where the format puts it, and a `%PDF-` further in loses to
   * positive leading HTML evidence.
   */
  it("is not fooled by a page that talks about PDFs", () => {
    const talksAboutPdfs = enc.encode(
      '<!doctype html><html><head><script>const header = "%PDF-1.7";</script></head><body><p>About PDFs</p></body></html>',
    );
    expect(sniffKind("text/html", talksAboutPdfs)).toBe("html");
    expect(sniffKind(null, talksAboutPdfs)).toBe("html");
    expect(sniffKind("application/octet-stream", talksAboutPdfs)).toBe("html");
    expect(sniffKind("application/pdf", talksAboutPdfs)).toBe("html");
    expect(uploadedDocumentKind("about-pdfs.html", talksAboutPdfs)).toBe("html");
  });

  /** And the other side of that ordering: at byte zero nothing outranks it. */
  it("still trusts %PDF- at byte zero over anything a header says", () => {
    expect(sniffKind("text/html", pdf)).toBe("pdf");
    expect(sniffKind(null, pdf)).toBe("pdf");
  });

  /**
   * **The four things a substring search called web pages.** Every one of them
   * was measured against the code that shipped on 2026-09-07, and every one was
   * fed enough text to clear Readability's floor and came back a publishable
   * article — so "a false positive only costs a later *no article here*" was
   * false as well as untested.
   */
  it("refuses documents that declare another vocabulary", () => {
    expect(sniffKind(null, enc.encode(JSON_WITH_SCRIPT))).toBeNull();
    expect(sniffKind("application/octet-stream", enc.encode(JSON_WITH_SCRIPT))).toBeNull();
    expect(sniffKind(null, enc.encode(ATOM))).toBeNull();
    expect(sniffKind(null, enc.encode(RSS))).toBeNull();
    expect(sniffKind(null, enc.encode(SVG))).toBeNull();
  });

  /**
   * **`< html>` — a space after the `<`.**
   *
   * The old regex was `/<\s*(html…)/`, which is not any tag HTML has. A search
   * that can land mid-string needs that kind of tolerance; matching at the
   * leading position does not, so the defect goes away rather than being fixed.
   */
  it("refuses a tag that is not a tag", () => {
    expect(sniffKind(null, enc.encode("< html><body><p>hello</p></body>"))).toBeNull();
  });

  it("is not fooled by JSON that happens to contain markup", () => {
    const json = enc.encode('{"template":"<p>hello</p>","id":7}');
    expect(sniffKind(null, json)).toBeNull();
    expect(sniffKind("application/octet-stream", json)).toBeNull();
  });

  /**
   * ⟨Sol F2, widened.⟩ A *fetched* UTF-16 page with a vague header was refused
   * too, which is the body-wins rule broken on the path it was written for. The
   * decoded fallback lives in this function's shared evidence path for exactly
   * that reason.
   */
  it("reads UTF-16 through the header shrugs that reach this branch", () => {
    for (const header of [null, "application/octet-stream", "application/pdf", "text/plain"]) {
      expect(sniffKind(header, utf16(PAGE, true)), `LE / ${header}`).toBe("html");
      expect(sniffKind(header, utf16(PAGE, false)), `BE / ${header}`).toBe("html");
    }
  });

  /** A document may begin at its head, and often does. */
  it("reads a document that begins at a head-level tag", () => {
    expect(sniffKind(null, enc.encode('<meta charset="utf-8"><title>T</title><main>Prose.</main>'))).toBe("html");
    expect(sniffKind(null, enc.encode("<body><p>hello</p></body>"))).toBe("html");
    expect(sniffKind(null, enc.encode("<title>T</title><p>hello</p>"))).toBe("html");
  });

  it("finds a PDF header that straddles the end of the window", () => {
    const padded = new Uint8Array([...new Uint8Array(1020).fill(0x20), ...enc.encode("%PDF-1.4\n")]);
    expect(sniffKind("application/octet-stream", padded)).toBe("pdf");
  });

  it("finds a PDF header hiding behind a few junk bytes", () => {
    const junked = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a, ...pdf]);
    expect(sniffKind(null, junked)).toBe("pdf");
  });
});

/**
 * **Round 2: the six things a cross-family review found in the first cut**, and
 * one pattern under three of them.
 *
 * ⟨Sol F9–F14, plus F16, 2026-09-08.⟩ Kept in their own describe because they
 * are a *class* rather than six incidents, and the class is worth reading
 * whole: **the same bytes were getting a different answer depending on the
 * filename**, in both directions. F12 and F11 were `null` fetched and `"html"`
 * uploaded; F13 and F14 were the other way about. That is the body-wins rule —
 * the one thing the plan calls non-negotiable — broken three ways at once.
 *
 * The cause was structural rather than six bugs: wherever the tokenizer gave
 * up, the veto read "nothing proven against it" and accepted, while the
 * positive predicate read "no evidence for it" and refused. **The two
 * predicates were always meant to differ in how much evidence they demand,
 * never in what the bytes say.** So the fix was one shared reading of the
 * bytes — one encoding-aware view, one walk, three facts off it — and the
 * invariant at the bottom of this describe is what stops it drifting apart
 * again.
 */
describe("the two predicates over one set of bytes", () => {
  /* Long enough that Readability would publish it — which is what makes each of
     these a real cost rather than a curiosity. Sol got 7,209 characters and
     `refusal: null` out of `readArticle` for the component below. */
  const prose = "<p>Real article prose, at length. </p>".repeat(60);

  /**
   * **⟨F9⟩ `<script>` and `<style>` are how a component file opens**, not how a
   * document does.
   *
   * The plan's own review ledger said so under F4 and the first cut kept them
   * anyway, on the strength of their being in the WHATWG table. They are — but
   * that table answers *is there any HTML here* for a browser that has already
   * decided to render something, and we are answering *is this a document* with
   * nothing else to go on.
   *
   * **The last two assertions are the two-predicate design working**, not a
   * contradiction: named `.html` the reader has told us what it is and a Svelte
   * file is not provably anything else, so it goes to stage 2. Removing these
   * from the *positive* set therefore costs the upload path nothing at all.
   */
  it("does not take a component's opening tag as evidence of a document", () => {
    const svelte = enc.encode(`<script lang="ts">export let a;</script>\n<main>${prose}</main>`);
    const vue = enc.encode(`<style scoped>main { color: red }</style>\n<main>${prose}</main>`);
    expect(sniffKind(null, svelte)).toBeNull();
    expect(sniffKind("application/pdf", svelte)).toBeNull();
    expect(sniffKind(null, vue)).toBeNull();
    expect(uploadedDocumentKind("case.pdf", svelte)).toBeNull();
    expect(uploadedDocumentKind("case.html", svelte)).toBe("html");
  });

  /**
   * **⟨F10⟩ A real PDF behind one junk byte, called `.html`.**
   *
   * The reordering that fixed F5 put `declaredHtml` in front of `pdfAt > 0`, so
   * a header or a filename saying HTML beat PDF bytes the detector had already
   * recognised — the body-wins rule inverted, and money either way: a PDF filed
   * as HTML produces an empty article, a page filed as PDF pays a transcriber.
   *
   * Both halves are pinned together because the fix is one ordering: **leading
   * HTML evidence beats a `%PDF-` found further in; nothing else does.** A test
   * of either half alone passes under the version that got the other wrong.
   */
  it("lets PDF bytes beat a claim, without losing the page that mentions one", () => {
    const realPdf = enc.encode("\n%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n");
    expect(sniffKind(null, realPdf)).toBe("pdf");
    expect(sniffKind("text/html", realPdf)).toBe("pdf");
    expect(uploadedDocumentKind("case.html", realPdf)).toBe("pdf");
    expect(uploadedDocumentKind("case.pdf", realPdf)).toBe("pdf");

    const talksAboutOne = enc.encode(`<!doctype html><html><body>About %PDF-1.7 files. ${prose}</body></html>`);
    expect(sniffKind(null, talksAboutOne)).toBe("html");
    expect(sniffKind("text/html", talksAboutOne)).toBe("html");
    expect(uploadedDocumentKind("case.html", talksAboutOne)).toBe("html");
  });

  /**
   * **⟨F11⟩ UTF-16 with a long comment, which is where the capped fallback
   * showed.**
   *
   * The first cut read UTF-16 by decoding a 16 KB prefix, so a BOM'd UTF-16
   * page whose first tag sat behind a 9,000-character comment was invisible to
   * the positive predicate and visible to nothing at all — which meant the
   * *upload* path accepted it (nothing proven against it) and the *fetched*
   * path refused it. The documented "false negative" turned out to be a
   * filename changing the meaning of bytes.
   *
   * The fix is a UTF-16 `CodeUnits` view chosen from the BOM, over which the
   * ordinary uncapped walk runs — so there is no separate horizon for UTF-16 to
   * fall off, and `MARKUP_WINDOW` is gone rather than merely enlarged.
   */
  it("reads UTF-16 as far in as it reads anything else", () => {
    const behindAComment = `<!--${"x".repeat(9000)}--><!doctype html><html><body>Prose.</body></html>`;
    for (const littleEndian of [true, false]) {
      const b = utf16(behindAComment, littleEndian);
      const which = littleEndian ? "LE" : "BE";
      expect(sniffKind(null, b), `${which} fetched, no header`).toBe("html");
      expect(sniffKind("application/pdf", b), `${which} fetched, application/pdf`).toBe("html");
      expect(uploadedDocumentKind("case.html", b), `${which} upload .html`).toBe("html");
      expect(uploadedDocumentKind("case.pdf", b), `${which} upload .pdf`).toBe("html");
    }
  });

  /**
   * **⟨F12⟩ `--!>` closes a comment**, and every browser agrees.
   *
   * The HTML parser calls it an *incorrectly-closed comment*, raises a parse
   * error and closes the comment anyway
   * (https://html.spec.whatwg.org/multipage/parsing.html#parse-error-incorrectly-closed-comment).
   * Reading only `-->` meant a page whose licence header ends that way looked
   * like one unterminated comment and nothing else — no first tag, no evidence,
   * refused when fetched. JSDOM renders its prose perfectly well.
   */
  it("closes a comment the way a browser does", () => {
    const page = enc.encode(`<!-- license --!><!doctype html><html><body>${prose}</body></html>`);
    expect(sniffKind(null, page)).toBe("html");
    expect(sniffKind("application/pdf", page)).toBe("html");
    expect(uploadedDocumentKind("case.pdf", page)).toBe("html");
    /* Whichever terminator comes first is the one that ends it, or a `--!>`
       inside a normally-closed comment would swallow the document after it. */
    expect(sniffKind(null, enc.encode("<!-- a --> <!doctype html><html><body>hi --!> there</body></html>"))).toBe(
      "html",
    );
  });

  /**
   * **⟨F13⟩ `<?xml-stylesheet …?>` is not an XML declaration.**
   *
   * A case-insensitive prefix match on `<?xml` claimed it was one, which set
   * the XML flag and turned the veto on: fetched it read `"html"`, uploaded as
   * `.html` it read `null`. Two rules put that right, and they are different
   * rules rather than one loosened:
   *
   *  - **A declaration** is lowercase `<?xml` followed by the whitespace XML
   *    requires. `<?xml-stylesheet` is a processing instruction, not that.
   *  - **A processing instruction is skippable anyway**, because the HTML
   *    parser treats `<?…>` as a bogus comment and ends it at the first `>`
   *    (https://html.spec.whatwg.org/multipage/parsing.html#parse-error-disallowed-processing-instruction-target).
   *    So the document after it is still the document, on both paths.
   */
  it("tells an XML declaration from a processing instruction", () => {
    const styled = enc.encode(`<?xml-stylesheet href="x.css"?><body><p>Prose.</p>${prose}</body>`);
    expect(sniffKind(null, styled)).toBe("html");
    expect(uploadedDocumentKind("case.html", styled)).toBe("html");
    expect(uploadedDocumentKind("case.pdf", styled)).toBe("html");
    /* And a real declaration still declares: uppercase is not one either. */
    expect(sniffKind(null, enc.encode('<?XML version="1.0"?><body><p>Prose.</p></body>'))).toBe("html");
  });

  /**
   * **⟨F14, and then reversed by F22⟩ A doctype names the vocabulary, and that
   * is the end of the question.**
   *
   * **This test asserted the opposite until 2026-09-08 and the reversal is
   * deliberate**, so read the argument before restoring it. F14 was real: the
   * rule *an XML prolog whose root is not `<html>`* was being answered `yes` on
   * the doctype without ever looking at the root, and `<?xml?><!doctype html>
   * <feed>` walked through both paths. The fix skipped the doctype and asked
   * the first element — and that fix is what has now gone.
   *
   * **Because the line it defended is not one the design holds anywhere else.**
   * Measured:
   *
   * ```
   * fetch upload  input
   * html  html    <!doctype html><feed>            (no prolog)
   * null  null    <?xml?><!doctype html><feed>     (the same document + 21 bytes)
   * ```
   *
   * Without a prolog `<!doctype html` is already sufficient positive evidence,
   * on both paths, and nobody has objected to that. **One document must not get
   * two answers over a prolog** — that is the same coherence rule the property
   * test at the bottom of this describe exists for, and F14's fix was breaking
   * it in a place the property test could not see.
   *
   * The rule is now: *an XML prolog whose document does not declare itself
   * HTML, **by root or by doctype**, is another vocabulary.* The cases the veto
   * exists for do not move, because neither of them says `html` — pinned below.
   */
  it("takes a doctype as the vocabulary's own declaration", () => {
    const feed = enc.encode(`<?xml version="1.0"?><!doctype html><feed><title>Atom</title>${prose}</feed>`);
    const prologLess = enc.encode(`<!doctype html><feed><title>Atom</title>${prose}</feed>`);
    /* The pair, asserted together, because the point is that they agree. */
    for (const [label, b] of [["with a prolog", feed], ["without one", prologLess]] as const) {
      expect(sniffKind(null, b), label).toBe("html");
      expect(sniffKind("application/pdf", b), label).toBe("html");
      expect(uploadedDocumentKind("case.html", b), label).toBe("html");
      expect(uploadedDocumentKind("case.pdf", b), label).toBe("html");
    }
    /* XHTML, which is what the allowance exists for. */
    expect(uploadedDocumentKind("case.html", enc.encode(XHTML))).toBe("html");
    expect(sniffKind(null, enc.encode(XHTML))).toBe("html");
    /* XHTML with no doctype at all, which is how most of it is written: the
       root element is the other half of the rule, and a mutant that kept only
       the doctype clause passed the whole suite without this. */
    const rootOnly = enc.encode(
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${prose}</body></html>`,
    );
    expect(sniffKind(null, rootOnly)).toBe("html");
    expect(uploadedDocumentKind("case.html", rootOnly)).toBe("html");
    /* And the converse: a prolog over a root that is neither `html` nor a
       doctype is another vocabulary even when its first tag is one this module
       would otherwise take as evidence. Both paths must agree — without the
       suppression in `documentEvidence` the fetched path called this `html`
       while the veto refused it, which is the round-2 incoherence again. */
    const xmlTitle = enc.encode(`<?xml version="1.0"?><title>Atom</title><summary>${prose}</summary>`);
    expect(sniffKind(null, xmlTitle)).toBeNull();
    expect(uploadedDocumentKind("case.html", xmlTitle)).toBeNull();
    /* And what the veto still catches, since neither doctype says `html`. */
    const svg = enc.encode(
      '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "s.dtd"><svg><title>T</title></svg>',
    );
    const rss = enc.encode('<?xml version="1.0"?><rss version="2.0"><channel><title>R</title></channel></rss>');
    expect(sniffKind(null, svg)).toBeNull();
    expect(uploadedDocumentKind("case.html", svg)).toBeNull();
    expect(sniffKind(null, rss)).toBeNull();
    expect(uploadedDocumentKind("case.html", rss)).toBeNull();
  });

  /**
   * **⟨F16⟩ A BOM in front of a PNG.**
   *
   * The WHATWG text-or-binary rule returns *text* the moment it sees a BOM and
   * never looks further, which is correct for the question a browser is asking
   * and wrong for the claim this module makes — that one closed rule catches
   * PNG, ZIP and everything built on them. Three bytes in front of any of them
   * defeated it.
   *
   * So the BOM is **skipped** rather than treated as an answer, and the scan
   * runs over what follows; for UTF-16 the scan runs over decoded code units,
   * which is the same question asked in the units that file is actually made
   * of. A real BOM'd UTF-16 page still passes — pinned above and below.
   */
  it("does not let a BOM excuse the bytes behind it", () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(400).fill(0x03)];
    expect(uploadedDocumentKind("case.html", new Uint8Array([0xef, 0xbb, 0xbf, ...png]))).toBeNull();
    expect(uploadedDocumentKind("case.html", new Uint8Array(png))).toBeNull();
    expect(uploadedDocumentKind("case.html", withUtf8Bom(PAGE))).toBe("html");
  });

  /**
   * **A page with a stray `0x00` in it is still a page**, and this is the one
   * case where the veto and the evidence genuinely disagree.
   *
   * The binary-data test trips — a NUL is a NUL — but the file opens with a
   * doctype, so the fetched path calls it a web page, and a filename may not
   * then unsay that. Positive evidence is therefore checked **before** the veto
   * in `uploadedDocumentKind`, and this is the fixture that makes that ordering
   * load-bearing rather than decorative: added after a mutant that deleted the
   * line survived the whole suite.
   *
   * Not invented, either. Truncated exports, mangled UTF-16 conversions and
   * some CMS output carry a NUL in the body; a browser replaces it with U+FFFD
   * and renders the page.
   */
  it("reads a page that carries a stray NUL byte", () => {
    const withNul = new Uint8Array([
      ...enc.encode("<!doctype html><html><body><p>Prose "),
      0x00,
      ...enc.encode(`more prose. ${prose}</p></body></html>`),
    ]);
    expect(sniffKind(null, withNul)).toBe("html");
    expect(uploadedDocumentKind("case.html", withNul)).toBe("html");
  });

  /**
   * **A UTF-16 needle found half a character out.**
   *
   * Terminators are searched for as bytes, and a multi-byte needle can be
   * spelled by the *tails* of ordinary characters. `?>` in UTF-16LE is
   * `3F 00 3E 00`, and `U+3F41 U+3E00 U+0100` lays exactly those four bytes
   * down starting at an **odd** offset. A search that accepted it would put the
   * cursor half a character out and read the rest of the file shifted, so the
   * document behind the declaration would vanish — which is why the view
   * rejects odd-numbered hits and keeps looking.
   *
   * Written after a mutant that removed that check survived the whole suite:
   * every other UTF-16 fixture here is ASCII behind a BOM, and ASCII cannot
   * produce a straddling match.
   *
   * **The fixture is an `?>` rather than the `-->` it started as**, and the
   * reason is worth keeping. The comment walk now looks for a single `>` and
   * then checks what precedes it, so a straddling hit there is merely rejected
   * on the next line and the old fixture stopped discriminating — it went on
   * passing with the guard removed. The XML declaration's `?>` is the two-byte
   * needle that is left, so that is where the check has to be proved.
   */
  it("does not find a UTF-16 terminator straddling two characters", () => {
    const straddling = utf16("<?xml 㽁㸀Ā?><!doctype html><html><body>Prose.</body></html>", true);
    expect(sniffKind(null, straddling)).toBe("html");
    expect(uploadedDocumentKind("case.html", straddling)).toBe("html");
  });

  /**
   * **⟨F17⟩ A ceiling, because no correctness test can see this one.**
   *
   * Reading `-->` and `--!>` as two separate searches made detection
   * **quadratic**: in a document of ordinary empty comments the first search
   * closes at once and the second scans to the end of the file, once per
   * comment. Measured before the fix — 16 KiB 134 ms, 32 KiB 429 ms, 64 KiB
   * 2.2 s, 128 KiB 6.6 s, and 1 MiB still running after a minute. Synchronous
   * CPU in the one server process, reachable from any uploaded file: a 100 KB
   * document takes the service down for everyone.
   *
   * Every correctness test in this file passed throughout, and would have gone
   * on passing, which is the whole reason this test exists and is written as a
   * clock rather than a value.
   *
   * **128 KiB and 400 ms, and both numbers were chosen against measurements
   * rather than picked.** The brief suggested 1 MiB under 100 ms; neither half
   * of that survived contact.
   *
   *  - **Not 1 MiB.** A regression makes this test *hang* rather than fail —
   *    the quadratic version did not finish 1 MiB in a minute, and a
   *    synchronous test body cannot be timed out. At 128 KiB it was 6.6 s, so
   *    the regression fails in seconds and says so.
   *  - **Not 100 ms.** Both calls together measure ~6 ms fixed, but this box
   *    runs the suite beside twenty-odd other vitest processes, and a ceiling
   *    five times the real number is a test that fails on a busy afternoon.
   *    400 ms sits ~65× above what it costs and ~16× below what the bug cost,
   *    which is a gap no amount of load closes.
   *
   * If this ever goes red, do not raise the number: run the shape at 2× and 4×
   * and see whether the time quadruples.
   */
  it("stays linear over documents built of the things it skips", () => {
    /* `<!---->` is the shape that was quadratic: the first terminator closes at
       once so the second search had the whole rest of the file to scan. */
    const manyComments = enc.encode("<!---->".repeat(18_724)); // ~128 KiB
    /* Banner dashes, the other shape a comment scan can go quadratic on:
       `<!-- ------------------------------- -->` punctuates half the CSS in the
       world, and a scan that advances one character per `--` would crawl. */
    const bannerDashes = enc.encode(`<!--${"-".repeat(1_000_000)}--><title>T</title><main>x</main>`);

    /* **A third arm was here and has been removed rather than left to rot** —
       an unterminated doctype internal subset, which used to run `doctypeEnd`
       to the end of the file. That function is gone (the plan's § F22 and F14),
       so `<!doctype html [` is now answered by the first token and the fixture
       measured nothing at all. A timing arm that exercises no loop is worse than
       no arm: it passes for ever and reads like coverage. ⟨Sol F24.⟩ */

    for (const [label, b] of [
      ["128 KiB of empty comments", manyComments],
      ["a comment of nothing but dashes", bannerDashes],
    ] as const) {
      const started = performance.now();
      sniffKind(null, b);
      uploadedDocumentKind("case.html", b);
      expect(performance.now() - started, `${label}: fetched + uploaded`).toBeLessThan(400);
    }
  });

  /**
   * **⟨F23⟩ Linear is not the whole of the promise — the constant has to be
   * small too.**
   *
   * The first fix for the quadratic scan searched for the next `>` and checked
   * what preceded it. That is linear in the document, and it is also **one
   * native `Buffer.indexOf` call per `>` in it**, so a comment stuffed with
   * them cost a call per character: 168 ms for 1 MiB, 776 ms for 4 MiB, 2.4 s
   * for 16 MiB, measured through a real upload. The fetch cap is 32 MiB and the
   * upload cap 50 MiB, so that is seconds of the one server process, and the
   * 128 KiB ceiling above never saw it — a `>` costs nothing there.
   *
   * The fix is what was suggested for the P0 in the first place and not taken:
   * **bound the second search by the first.** Find `-->` once; look for `--!>`
   * only in front of it. Two native scans per comment, each over that comment's
   * own span, and no single stuffing character can make either of them
   * degrade — which is the property the `>` scan lacked and this test exists to
   * hold.
   *
   * **The `x` after `<!--` is load-bearing in the fixture.** Without it the
   * first `>` is an abrupt-closing empty comment, the walk stops at byte four,
   * and the megabyte behind it is never read: the test would pass in 0 ms while
   * proving nothing. That mistake was made once while writing this.
   *
   * **The answer was to stop searching natively at all.** `Buffer.indexOf`
   * costs ~300 ns per call whatever the size, and degrades to 151 ms per 16 MiB
   * when the haystack repeats the needle's prefix — so every native variant had
   * *some* stuffing character that punished it, and each round of review found
   * the next one. A `unit()` read is 6.6 ns and does not care what the byte is.
   * The sliding window in `commentEnd` measures 78–90 ms per 16 MiB across
   * dashes, `>`, ordinary text and a million small comments alike: worse than a
   * native scan at its best, better than all of them at their worst, and — the
   * point — **a function of length alone, so no input makes it slower**.
   *
   * **4 MiB and 400 ms**, calibrated like the ceiling above. The fixed version
   * measures 40–66 ms across all three shapes, so the ceiling is six times the
   * worst of them — the headroom a box running twenty other suites needs. The
   * defects it has to catch are all above it at this size and, since load can
   * only make a measurement larger, that direction never flakes: the `>` scan
   * cost 776 ms here, and the bounded two-search 591 ms on the third shape.
   *
   * **Each shape broke a different version of this function**, and a fix for
   * one was never a fix for the others — which is the whole reason there are
   * three and not one. Not all three catch every past defect (a comment of
   * dashes was only 148 ms under the bounded search); together they cover the
   * designs that have actually been written here.
   *
   * Two mechanical notes, both learned by getting them wrong:
   *
   *  - **Warm up first.** Cold, the first megabyte pays for V8 compiling the
   *    loop: 420 ms against 45 ms warm. That is a fixed cost this test is not
   *    about, and it would have had us raising the ceiling for a reason that is
   *    not the algorithm.
   *  - **Build one fixture at a time.** Holding three multi-megabyte buffers
   *    alive at once put the measurement up from 208 ms to 580 ms in GC alone.
   */
  it("stays cheap over comments stuffed with terminator candidates", () => {
    const size = 4 * 1024 * 1024;
    const tail = "--><title>T</title><main>x</main>";
    sniffKind(null, enc.encode(`<!--x${">".repeat(4096)}${tail}`));

    /* Thunks, so each fixture can be collected before the next is built. */
    for (const [label, build] of [
      ["4 MiB of '>' in one comment", () => enc.encode(`<!--x${">".repeat(size)}${tail}`)],
      ["4 MiB of '-' in one comment", () => enc.encode(`<!--x${"-".repeat(size)}${tail}`)],
      ["4 MiB of tiny comments", () => enc.encode("<!--x>-->".repeat(size / 9))],
    ] as const) {
      const b = build();
      const started = performance.now();
      sniffKind(null, b);
      uploadedDocumentKind("case.html", b);
      expect(performance.now() - started, label).toBeLessThan(400);
    }
  });

  /**
   * **⟨F18⟩ `<!-->` is an empty comment, not the start of one.**
   *
   * HTML calls it *abrupt closing of an empty comment*: a parse error, and the
   * comment ends anyway — so `<!--><!doctype html>…` is a document with a
   * useless comment in front of it, and JSDOM renders its body. Reading only
   * `-->` and `--!>` as terminators meant the comment never closed, there was
   * no first tag, and the filename decided the answer again.
   * https://html.spec.whatwg.org/multipage/parsing.html#parse-error-abrupt-closing-of-empty-comment
   *
   * **It falls out of F17's fix rather than being patched in**, which is the
   * part worth knowing: a comment now ends at the first `>` whose preceding
   * characters are `--`, and in `<!-->` those are the opener's own dashes.
   * Both abrupt-closing forms the spec lists are that one rule.
   *
   * **`<!--!>` is the case that does *not* close** — the `!` puts the parser in
   * the comment state with `!` as data, so a browser swallows the rest of the
   * file. It is pinned because it is the only thing separating "the terminator
   * may overlap the opener" from "anything ending in `>` closes a comment".
   */
  it("closes an empty comment the way the parser does, and only then", () => {
    const tail = `<!doctype html><html><body>${prose}</body></html>`;
    for (const opener of ["<!-->", "<!--->"]) {
      const b = enc.encode(opener + tail);
      expect(sniffKind(null, b), opener).toBe("html");
      expect(uploadedDocumentKind("case.html", b), opener).toBe("html");
      expect(uploadedDocumentKind("case.pdf", b), opener).toBe("html");
    }
    /* Not a terminator: a browser reads the rest of the file as comment data,
       so there is no document here and we must not invent one. */
    expect(sniffKind(null, enc.encode(`<!--!>${tail}`))).toBeNull();
  });

  /**
   * **⟨F19⟩ A doctype does not end at its first `>`.**
   *
   * An internal subset holds markup declarations of its own, and a public
   * identifier is a quoted literal that may contain anything. Taking the first
   * `>` cut the doctype in half and left the root check reading `<!ENTITY`, so
   * perfectly valid XHTML — which JSDOM parses and whose body text is
   * `article` — was refused on every path.
   *
   * Both shapes are here because they fail the same naive scan for two
   * different reasons, and a fix for one need not be a fix for the other.
   */
  it("reads a doctype with an internal subset, and one with a quoted >", () => {
    const subset = enc.encode(
      '<?xml version="1.0"?>\n<!DOCTYPE html [<!ENTITY article "article">]>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml"><body>&article;</body></html>',
    );
    const quoted = enc.encode(
      '<?xml version="1.0"?><!DOCTYPE html SYSTEM "a>b.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><body>x</body></html>',
    );
    for (const [label, b] of [
      ["an internal subset", subset],
      ["a > inside a quoted literal", quoted],
    ] as const) {
      expect(sniffKind(null, b), label).toBe("html");
      expect(uploadedDocumentKind("case.html", b), label).toBe("html");
      expect(uploadedDocumentKind("case.pdf", b), label).toBe("html");
    }
  });

  /**
   * **The subsets that are only readable because nothing reads them** ⟨F22, and
   * the reason `doctypeEnd` was deleted rather than made nesting-aware⟩.
   *
   * **Do not "fix" these by reintroducing a DTD lexer.** They are here to say
   * that the lexer is gone on purpose. It tracked quotes and one level of
   * brackets, and both cases below defeated it:
   *
   *  - a **nested** `[` inside the subset closed it early;
   *  - an **apostrophe** in an English comment inside the subset — *can't* —
   *    opened a quoted literal that never closed, so the doctype ran to the end
   *    of the file and the document was refused outright.
   *
   * The second is not exotic. An entity subset is the canonical reason to
   * hand-write a doctype in XHTML, and a comment beside it is ordinary
   * authoring. A nesting-depth fix would not have helped it at all — the real
   * gap was that comments and processing instructions *inside* a subset were
   * being lexed as declarations, which is a DTD parser, not a delimiter.
   *
   * And it was modelling a grammar nothing downstream applies: stage 2 is
   * `new JSDOM(html)` with no content type, so it runs the **HTML** parser,
   * whose rule for `<!DOCTYPE html [` is to end at the first `>` and let `]>`
   * fall into the body text. `commentEnd` and the processing-instruction skip
   * find *one delimiter* each and cite the spec for it; this function was
   * parsing the inside of a construct, which is why it alone kept producing
   * findings.
   */
  it("reads doctype subsets it does not parse", () => {
    const body = '<html xmlns="http://www.w3.org/1999/xhtml"><body>article</body></html>';
    for (const [label, src] of [
      ["a nested bracket", `<?xml version="1.0"?><!DOCTYPE html [<!ELEMENT p (#PCDATA)[x]>]>${body}`],
      [
        "an apostrophe in a comment inside the subset",
        `<?xml version="1.0"?><!DOCTYPE html [<!ENTITY nbsp "&#160;"><!-- we can't use one here -->]>${body}`,
      ],
    ] as const) {
      expect(sniffKind(null, enc.encode(src)), label).toBe("html");
      expect(uploadedDocumentKind("case.html", enc.encode(src)), label).toBe("html");
    }
  });

  /**
   * **The invariant the six of round 2 were instances of — now with an expected
   * column** ⟨Sol F20⟩.
   *
   * The first version of this test skipped every fixture whose fetched answer
   * was not `"html"`, so it proved that *already-recognised* evidence survives
   * a filename and nothing about whether the reading found the evidence in the
   * first place. Both F18 and F19 passed it while being broken — they returned
   * `null`, so the test looked away.
   *
   * **Consistency and correctness are two properties**, and a table that only
   * checks the first is the shape of test this whole thread keeps producing:
   * one that agrees with the code about what to examine
   * (docs/reusable/silent-success.md). So every fixture now names the answer it
   * expects, and a fixture that quietly stops being recognised fails here
   * rather than dropping out of the loop.
   *
   * The two predicates may still differ in **how much evidence they demand** —
   * a `<div>` fragment is refused when fetched and accepted when uploaded, and
   * that is the design. What they may never do is contradict each other about
   * the bytes.
   */
  it("reads the same bytes the same way, whatever the file is called", () => {
    const corpus: [string, Uint8Array, "html" | "pdf" | null][] = [
      ["a whole page", enc.encode(PAGE), "html"],
      ["a page with no wrapper", enc.encode(NO_WRAPPER), "html"],
      ["XHTML", enc.encode(XHTML), "html"],
      [
        "XHTML with an internal subset",
        enc.encode('<?xml version="1.0"?><!DOCTYPE html [<!ENTITY a "b">]><html><body>x</body></html>'),
        "html",
      ],
      ["an abruptly-closed empty comment", enc.encode(`<!--><!doctype html><html><body>${prose}</body></html>`), "html"],
      ["a browser-closed comment", enc.encode(`<!-- x --!><!doctype html><html><body>${prose}</body></html>`), "html"],
      ["a processing instruction", enc.encode(`<?xml-stylesheet href="x.css"?><body>${prose}</body>`), "html"],
      ["a comment longer than any window", enc.encode(`<!--${"x".repeat(30_000)}--><title>T</title><main>x</main>`), "html"],
      ["UTF-16LE, BOM'd", utf16(PAGE, true), "html"],
      ["UTF-16BE, BOM'd", utf16(PAGE, false), "html"],
      ["UTF-8 BOM", withUtf8Bom(PAGE), "html"],
      ["UTF-16LE behind a long comment", utf16(`<!--${"x".repeat(9000)}--><!doctype html><html><body>P</body></html>`, true), "html"],
      ["UTF-16LE with a straddling terminator", utf16("<?xml 㽁㸀Ā?><!doctype html><html><body>P</body></html>", true), "html"],
      [
        "a page with a stray NUL",
        new Uint8Array([...enc.encode("<!doctype html><html><body><p>Prose "), 0x00, ...enc.encode("more.</p>")]),
        "html",
      ],
      ["a real PDF behind a junk byte", enc.encode("\n%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"), "pdf"],
      ["an Atom feed", enc.encode(ATOM), null],
      ["an RSS feed", enc.encode(RSS), null],
      ["an SVG", enc.encode(SVG), null],
      ["JSON holding a script tag", enc.encode(JSON_WITH_SCRIPT), null],
      ["a fragment", enc.encode("<div><p>Just a fragment.</p></div>"), null],
      ["prose", enc.encode(`prose, ${"x".repeat(400)}`), null],
      /* `html`, and its prolog-less twin two rows down must match it: see
         "takes a doctype as the vocabulary's own declaration" above. */
      ["a doctype'd feed", enc.encode(`<?xml version="1.0"?><!doctype html><feed>${prose}</feed>`), "html"],
      ["the same feed with no prolog", enc.encode(`<!doctype html><feed>${prose}</feed>`), "html"],
      ["a doctype'd SVG", enc.encode('<?xml version="1.0"?><!DOCTYPE svg SYSTEM "s.dtd"><svg><title>T</title></svg>'), null],
      ["XHTML with no doctype", enc.encode(`<?xml version="1.0"?><html xmlns="x"><body>${prose}</body></html>`), "html"],
      ["a prolog over a bare title", enc.encode(`<?xml version="1.0"?><title>A</title><summary>${prose}</summary>`), null],
      ["a Svelte component", enc.encode(`<script lang="ts">export let a;</script>\n<main>${prose}</main>`), null],
      ["a tag that is not a tag", enc.encode("< html><body><p>hello</p></body>"), null],
      ["a comment a browser never closes", enc.encode(`<!--!><!doctype html><html><body>${prose}</body></html>`), null],
    ];
    for (const [label, b, expected] of corpus) {
      /* Correctness: the reading itself, which the old version of this test
         never asked about. */
      expect(sniffKind(null, b), `${label}: fetched`).toBe(expected);
      /* Consistency: and no filename may then unsay it. Only checked where the
         bytes said something — where they did not, the two predicates are
         *meant* to differ, and their own tests pin that. */
      if (expected === null) continue;
      expect(uploadedDocumentKind("case.html", b), `${label}: uploaded as .html`).toBe(expected);
      expect(uploadedDocumentKind("case.pdf", b), `${label}: uploaded as .pdf`).toBe(expected);
    }
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
       somebody else's defect: docs/postmortems/260826b-windows-1252-node-caught-up.md.

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
