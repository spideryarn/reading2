/**
 * **The three notions of "the same address", and why they must stay three.**
 *
 * `src/urls.ts` holds two of them and `src/ingest.ts` the third, and getting the
 * wrong one is the shape of the sharpest finding in both reviews of this
 * feature:
 *
 * - `urlKey` (the shelf) folds `http`/`https`, `www.` and tracking parameters
 *   together, because two spellings of one address should be one row on a
 *   bookshelf.
 * - `requestTarget` (the cache, and the **authorization** key) folds nothing at
 *   all except the fragment, because a fragment is the one part of a URL that is
 *   never sent.
 * - `sameTarget` (the chat tool's *"you already have that page open"* refusal)
 *   deliberately folds a little more than `requestTarget`, because there
 *   over-matching costs a fetch that was not needed and under-matching costs the
 *   reader ten seconds and a request to their publisher.
 *
 * **The middle one used to be the third one, and that was a real hole.** Until
 * 2026-09-05 `requestTarget` percent-decoded the path, so `/a%2Fb` and `/a/b`
 * were one key — which, once the same function became the link-preview route's
 * membership test, meant *an article publishing one address authorized a fetch
 * of the other*, and one page's cached content could be served for another's.
 * GPT Sol, 2026-09-05, finding P1-1.
 *
 * Every case below is a pair that must **not** merge under `requestTarget`, or a
 * pair that must merge under `sameTarget` and would be a regression to lose.
 * Pure string in, string out; no network and no store.
 */
import { describe, expect, it } from "vitest";

import { urlKey } from "../src/ingest.js";
import { carriesCredential, requestTarget, sameTarget } from "../src/urls.js";

describe("requestTarget — what a GET actually asks for", () => {
  it("drops the fragment and nothing else", () => {
    expect(requestTarget("https://a.example/x#spya-k3m9qt")).toBe("https://a.example/x");
    expect(requestTarget("https://a.example/x")).toBe("https://a.example/x");
  });

  it("keeps an escaped slash escaped", () => {
    /* One path segment containing a slash, against two segments. A server may
       serve completely different things at each, and merging them is what let
       one article's link authorize a fetch of a different address. */
    expect(requestTarget("https://a.example/p/a%2Fb")).not.toBe(
      requestTarget("https://a.example/p/a/b"),
    );
  });

  it("keeps an escaped question mark out of the query", () => {
    expect(requestTarget("https://a.example/a%3Fb")).not.toBe(
      requestTarget("https://a.example/a?b"),
    );
  });

  it("keeps a trailing dot on the host", () => {
    /* `example.com.` is a distinguishable virtual host, and the version of this
       function that stripped the dot said otherwise. */
    expect(requestTarget("https://a.example./x")).not.toBe(requestTarget("https://a.example/x"));
  });

  it("keeps every distinction urlKey deliberately throws away", () => {
    const spellings = [
      "https://a.example/x",
      "http://a.example/x",
      "https://www.a.example/x",
      "https://a.example/x?utm_source=newsletter",
    ];
    /* The shelf calls all four one page, and it is right to. The network does
       not, and this is the function that must agree with the network. */
    expect(new Set(spellings.map(urlKey)).size).toBe(1);
    expect(new Set(spellings.map(requestTarget)).size).toBe(4);
  });

  it("refuses anything that is not http(s)", () => {
    expect(requestTarget("mailto:someone@example.com")).toBeNull();
    expect(requestTarget("javascript:alert(1)")).toBeNull();
    expect(requestTarget("not a url at all")).toBeNull();
  });
});

describe("sameTarget — the chat tool's generous version", () => {
  it("still folds a percent-encoded path, which requestTarget will not", () => {
    /* `read_web_page` refuses to re-fetch the article the reader already has
       open, and a model holding `meta.url` can spell the same path either way.
       Over-matching there is the safe direction; the assertion pairs the two
       functions so that nobody can "fix" one into the other. */
    expect(sameTarget("https://a.example/essays/%78", "https://a.example/essays/x")).toBe(true);
    expect(requestTarget("https://a.example/essays/%78")).not.toBe(
      requestTarget("https://a.example/essays/x"),
    );
  });

  it("still refuses a www or http spelling, which urlKey would fold", () => {
    expect(sameTarget("https://a.example/x", "https://www.a.example/x")).toBe(false);
    expect(sameTarget("https://a.example/x", "http://a.example/x")).toBe(false);
  });

  it("ignores the fragment, because HTTP never sends one", () => {
    expect(sameTarget("https://a.example/x#part", "https://a.example/x")).toBe(true);
  });
});

describe("carriesCredential — what must not reach an ownerless table", () => {
  it("catches the address that is its own password", () => {
    expect(carriesCredential("https://user:pass@a.example/x")).toBe(true);
  });

  it("catches the common capability parameters, however they are spelled", () => {
    for (const url of [
      "https://a.example/x?token=abc",
      "https://a.example/x?access_token=abc",
      "https://a.example/x?apiKey=abc",
      "https://a.example/x?X-Amz-Signature=abc",
      "https://a.example/x?rlkey=abc",
      "https://a.example/x?token_hash=abc",
    ]) {
      expect(carriesCredential(url), url).toBe(true);
    }
  });

  it("leaves an ordinary article address alone", () => {
    for (const url of [
      "https://philpapers.org/rec/NAGWII",
      "https://arxiv.org/abs/2411.00986v1",
      "https://www.noemamag.com/the-mythology-of-conscious-ai/?ref=footer",
      "https://plato.stanford.edu/entries/consciousness/",
    ]) {
      expect(carriesCredential(url), url).toBe(false);
    }
  });

  it("refuses anything it cannot parse", () => {
    /* The safe direction: something this cannot read is certainly not something
       to write into a table every reader can see. */
    expect(carriesCredential("not a url")).toBe(true);
  });
});
