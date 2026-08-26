/**
 * Slugs, and whether one is safe to turn into a path — src/ingest.ts.
 *
 * Two reasons this is tested at all. The homepage's add box shows you the slug
 * you are about to get, and the server derives the one it actually uses; they
 * call the same function, and these tests are what keeps that worth relying on.
 * And `isSlug` guards a string that arrives over HTTP and is then joined onto
 * `data/` and `output/` — see docs/project/ingest-queue.md#the-one-security-check.
 */
import { describe, expect, it } from "vitest";
import { isSlug, normaliseUrl, slugFromUrl, urlKey } from "../src/ingest.js";

describe("slugFromUrl", () => {
  it("uses the last path segment, which is where the headline lives", () => {
    expect(slugFromUrl("https://www.noemamag.com/the-mythology-of-conscious-ai/")).toBe(
      "the-mythology-of-conscious-ai",
    );
  });

  it("drops the server's file extension", () => {
    expect(slugFromUrl("https://example.com/posts/why-trees.html")).toBe("why-trees");
  });

  it("falls back to the host when there is no path", () => {
    expect(slugFromUrl("https://www.example.com/")).toBe("example");
  });

  it("prefixes the host when the segment is a bare id, which names nothing", () => {
    expect(slugFromUrl("https://site.com/2026/08/12345")).toBe("site-12345");
  });

  it("flattens accents and punctuation rather than dropping the word", () => {
    expect(slugFromUrl("https://example.com/café-du-monde!")).toBe("cafe-du-monde");
  });

  it("returns nothing for something that isn't a URL, so the box stays quiet", () => {
    for (const junk of ["", "  ", "not a url", "https://", "/just/a/path"]) {
      expect(slugFromUrl(junk), junk).toBe("");
    }
  });

  /* `example.com` was in the list above until 2026-08-26. It is a URL now —
     `normaliseUrl` supplies the scheme nobody wants to type — which is Greg's
     "or without url protocol". See § normaliseUrl below. */
  it("accepts a URL with no scheme, because that is how people write them", () => {
    expect(slugFromUrl("example.com")).toBe("example");
    expect(slugFromUrl("example.com/posts/why-trees")).toBe("why-trees");
    expect(slugFromUrl("www.example.com/why-trees")).toBe("why-trees");
  });

  /* This used to return `alert-1`: `new URL` accepts the string, and the slug
     only ever looked at the last path segment. Harmless in itself — the fetch
     happens on the server and would fail — but it meant the add page had to
     carry a scheme check of its own, and two places deciding what a URL is is
     how they come to disagree. */
  it("refuses a scheme we could never fetch", () => {
    for (const junk of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x"]) {
      expect(slugFromUrl(junk), junk).toBe("");
    }
  });
});

/**
 * The two questions a pasted URL raises, and they are not the same question.
 *
 * > And will this de-dupe correctly if near-identical versions of the url are
 * > used, e.g. http vs https or without url protocol or capitalised similar
 * > non-significant changes, or if we already have the article?
 * >
 * > — Greg, 2026-08-26
 *
 * `normaliseUrl` answers **what do we fetch and store** and is deliberately
 * conservative: it may not turn the address into a different one. `urlKey`
 * answers **is this the article we already have** and is allowed to be much
 * more aggressive, because getting it wrong costs a duplicate rather than a
 * 404. See docs/project/ingest-queue.md#two-urls-one-article.
 */
describe("normaliseUrl", () => {
  it("supplies the scheme nobody types", () => {
    expect(normaliseUrl("example.com/why-trees")).toBe("https://example.com/why-trees");
    expect(normaliseUrl("//example.com/why-trees")).toBe("https://example.com/why-trees");
  });

  it("lower-cases the parts that are case-insensitive, and only those", () => {
    // Host and scheme are case-insensitive by spec; a path is not, and plenty
    // of servers mean it.
    expect(normaliseUrl("HTTPS://EXAMPLE.COM/Why-Trees")).toBe("https://example.com/Why-Trees");
  });

  it("drops a default port and keeps one that isn't", () => {
    expect(normaliseUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(normaliseUrl("http://example.com:80/a")).toBe("http://example.com/a");
    expect(normaliseUrl("https://example.com:8443/a")).toBe("https://example.com:8443/a");
  });

  it("drops the fragment, which is never sent to a server anyway", () => {
    expect(normaliseUrl("https://example.com/a#section-3")).toBe("https://example.com/a");
  });

  it("does not turn http into https, because that is a different request", () => {
    expect(normaliseUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("keeps the query string, which usually decides which page you get", () => {
    expect(normaliseUrl("https://example.com/a?page=2")).toBe("https://example.com/a?page=2");
  });

  /* One answer for every refusal, and it is the empty string. An early version
     handed the input back, which reads well in an error message and is
     indistinguishable from "already normal" — so `http://127.0.0.1/x` was
     refused here and then slugged as `x` one function later. */
  it("gives nothing back for anything it will not fetch", () => {
    for (const junk of ["not a url", "javascript:alert(1)", "localhost:5273/x", "", "   "]) {
      expect(normaliseUrl(junk), junk).toBe("");
    }
  });

  /* An /add/ link is something a stranger can send, and opening one starts a
     server-side fetch with no second click. So the classic gadget — pointing
     our server at a cloud metadata endpoint or something behind the firewall —
     is refused here, in the one function every path to the queue goes through.
     `new URL` has already expanded the compressed spellings by the time we
     look, which is why `127.1` is caught by a check for `127.0.0.1`.

     This is not a claim to have stopped SSRF: a NAME that resolves into the
     private range still gets through, and only the fetch itself can catch that.
     See docs/project/security.md. */
  it("refuses a host on this machine or this network", () => {
    for (const local of [
      "http://127.0.0.1/x",
      "http://127.1/x",
      "http://0x7f.0.0.1/x",
      "http://localhost:5273/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/x",
      "http://172.16.0.1/x",
      "http://192.168.1.1/x",
      "http://[::1]/x",
      "http://0.0.0.0/x",
      // The hole the obvious version of this check has. `new URL` re-spells
      // `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`, which is neither a dotted
      // quad nor `::1`, so a check for those two waves loopback straight
      // through. Named by GPT Sol as the highest-value missing test.
      "http://[::ffff:127.0.0.1]/x",
      "http://[::ffff:10.0.0.1]/x",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:7f00:1]/x",
      // The rest of ::/96: unspecified, and the deprecated v4-compatible form.
      "http://[::]/x",
      "http://[::7f00:1]/x",
      "http://[fe80::1]/x",
      "http://[fd00::1]/x",
      // A trailing dot is the same host with the DNS root spelled out.
      "http://127.0.0.1./x",
    ]) {
      expect(normaliseUrl(local), local).toBe("");
      expect(slugFromUrl(local), local).toBe("");
    }
  });

  /* Refused rather than carried, because an /add/ URL is shareable now: it
     lives in browser history and in whatever access log sees it, and
     percent-encoding hides a password from nobody. */
  /* The check is about literal addresses, and a mapped one that is NOT local
     has to stay fetchable — otherwise the fix for the hole above is just a
     wider hole in the other direction. */
  it("still fetches a mapped address that is not local", () => {
    expect(normaliseUrl("http://[::ffff:8.8.8.8]/x")).not.toBe("");
    expect(normaliseUrl("http://93.184.216.34/x")).toBe("http://93.184.216.34/x");
  });

  it("refuses credentials in the address", () => {
    expect(normaliseUrl("https://alice:hunter2@example.com/x")).toBe("");
    expect(slugFromUrl("https://alice:hunter2@example.com/x")).toBe("");
  });
});

describe("urlKey", () => {
  const canonical = urlKey("https://www.example.com/why-trees");

  it("treats http and https as the same article", () => {
    expect(urlKey("http://www.example.com/why-trees")).toBe(canonical);
  });

  it("ignores www., a trailing slash, and a fragment", () => {
    expect(urlKey("https://example.com/why-trees")).toBe(canonical);
    expect(urlKey("https://example.com/why-trees/")).toBe(canonical);
    expect(urlKey("https://example.com/why-trees#notes")).toBe(canonical);
  });

  it("ignores capitalisation in the host, which the spec says is meaningless", () => {
    expect(urlKey("HTTPS://WWW.Example.COM/why-trees")).toBe(canonical);
  });

  it("ignores a missing scheme", () => {
    expect(urlKey("example.com/why-trees")).toBe(canonical);
    expect(urlKey("  www.example.com/why-trees  ")).toBe(canonical);
  });

  it("ignores the tracking junk a share button staples on", () => {
    expect(urlKey("https://example.com/why-trees?utm_source=twitter&utm_medium=social")).toBe(
      canonical,
    );
    expect(urlKey("https://example.com/why-trees?fbclid=abc123")).toBe(canonical);
    expect(urlKey("https://example.com/why-trees/?igshid=z&utm_campaign=q#top")).toBe(canonical);
  });

  /* Every one of these merged in the first version of this function, and each
     merges two requests a server can answer differently. They are here as a
     group because the reason is one reason: a wrong merge silently shows the
     wrong article, so a merge has to be guaranteed rather than usually right.
     Found by GPT Sol's review, 2026-08-26 — see the docstring on `urlKey`. */
  it("keeps apart the things that merged before, and could differ", () => {
    // A case-sensitive server is entitled to serve two pages here. The slug
    // collides either way; freeSlug is what resolves that, into a duplicate
    // rather than into the wrong article.
    expect(urlKey("https://example.com/Why-Trees")).not.toBe(canonical);

    // Sorting the query made a repeated parameter order-insensitive, and it
    // is not: ?tag=a&tag=b is a different request from ?tag=b&tag=a.
    expect(urlKey("https://example.com/a?tag=a&tag=b")).not.toBe(
      urlKey("https://example.com/a?tag=b&tag=a"),
    );

    // Decoding and re-joining on `=` and `&` is ambiguous. The first is ONE
    // parameter whose value contains an ampersand; the second is two.
    expect(urlKey("https://example.com/a?a=x%26b%3Dy")).not.toBe(
      urlKey("https://example.com/a?a=x&b=y"),
    );

    // `+` is a space only under form encoding, and a path is not a form.
    expect(urlKey("https://example.com/a?x=a+b")).not.toBe(
      urlKey("https://example.com/a?x=a%20b"),
    );

    // One trailing slash is decoration; two are a path.
    expect(urlKey("https://example.com/a//")).not.toBe(canonical.replace("/why-trees", "/a"));

    // An empty query field is part of the request target. Dropping it along
    // with the tracking pairs merged these two.
    expect(urlKey("https://example.com/a?a=1&&b=2")).not.toBe(
      urlKey("https://example.com/a?a=1&b=2"),
    );
  });

  /* Query-string ORDER between different names is left significant too. That
     is a deliberate non-merge rather than an oversight: nobody reorders a URL
     they copied, so the merge buys nothing, and it cannot be had without the
     sort that broke the repeated-parameter case above. */
  it("treats a reordered query as a different address, and that is on purpose", () => {
    expect(urlKey("https://example.com/a?b=2&a=1")).not.toBe(
      urlKey("https://example.com/a?a=1&b=2"),
    );
  });

  it("keeps a query parameter that decides which page you get", () => {
    expect(urlKey("https://example.com/a?page=2")).not.toBe(urlKey("https://example.com/a?page=3"));
    expect(urlKey("https://example.com/a?page=2")).not.toBe(urlKey("https://example.com/a"));
  });

  it("keeps two different articles apart, which is the whole point of the ladder", () => {
    // The case freeSlug exists for: same last path segment, different site.
    expect(urlKey("https://a.example/news")).not.toBe(urlKey("https://b.example/news"));
    expect(urlKey("https://example.com/a")).not.toBe(urlKey("https://example.com/b"));
    // A subdomain is a different host, not decoration. Only `www.` is.
    expect(urlKey("https://blog.example.com/a")).not.toBe(urlKey("https://example.com/a"));
    // A non-default port is part of the address.
    expect(urlKey("https://example.com:8443/a")).not.toBe(urlKey("https://example.com/a"));
  });

  it("gives something stable back for junk rather than throwing", () => {
    expect(urlKey("not a url")).toBe(urlKey("  NOT A URL "));
    expect(urlKey("")).toBe("");
  });

  it("never produces a slug that would change the shape of a path", () => {
    const slug = slugFromUrl("https://example.com/a/b/c%2Fd");
    expect(slug).not.toContain("/");
    expect(slug).toBe(encodeURIComponent(slug));
  });
});

describe("isSlug", () => {
  /* This is a path-traversal guard, not a tidiness check: the slug on
     POST /api/jobs is joined onto data/ and output/. Each of these is a real
     way in, not a hypothetical one. */
  it("refuses anything that could climb out of data/", () => {
    expect(isSlug("../../.ssh/id_rsa")).toBe(false);
    expect(isSlug("..")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("a\\b")).toBe(false);
    expect(isSlug("")).toBe(false);
    expect(isSlug("-leading-dash")).toBe(false);
    expect(isSlug("Upper")).toBe(false);
    expect(isSlug("has space")).toBe(false);
    expect(isSlug(null)).toBe(false);
    expect(isSlug(42)).toBe(false);
  });

  it("accepts what slugFromUrl produces", () => {
    for (const url of [
      "https://www.noemamag.com/the-mythology-of-conscious-ai/",
      "https://example.com/",
      "https://site.com/2026/08/12345",
      "https://blog.test/caf\u00e9-r\u00e9sum\u00e9.html",
    ]) {
      expect(isSlug(slugFromUrl(url))).toBe(true);
    }
  });
});
