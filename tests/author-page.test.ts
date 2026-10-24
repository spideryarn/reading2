/**
 * **Reading the author's own page for an address** — src/author-page.ts,
 * plan docs/plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md § D2.
 *
 * The first case is Greg's example (#686), the markup as fetched on
 * 2026-10-24: the `@` is an image between two table cells.
 */
import { describe, expect, it } from "vitest";

import { addressNamesAuthor, pageAddresses, pageText, readAuthorPage } from "../src/author-page.js";
import { FetchFailure } from "../src/fetch.js";

const addresses = (html: string) => pageAddresses(pageText(html)).map((a) => `${a.address}${a.disguised ? " (decoded)" : ""}`);

describe("pageAddresses", () => {
  it("reads an @ drawn as an image between table cells — Greg's example", () => {
    const html = `<html><body>Los Angeles, CA 90024<br><br>
      <table cellpadding=0 cellspacing=0>
        <tr><td>alexwarth</td><td><img src=images/at.gif></td><td>gmail.com</td></tr>
      </table><br><img border=0 src=images/new.gif></body></html>`;
    expect(addresses(html)).toEqual(["alexwarth@gmail.com (decoded)"]);
  });

  it("reads an @ image by its alt text, and a dot image", () => {
    expect(addresses(`<p>jane.doe<img alt="@" src="x.png">example<img src="/i/dot.png">org</p>`)).toEqual([
      "jane.doe@example.org (decoded)",
    ]);
  });

  it("reads the bracketed and spelled-out disguises", () => {
    expect(addresses("<p>jane [at] example [dot] org</p>")).toEqual(["jane@example.org (decoded)"]);
    expect(addresses("<p>jane (at) cs.example.edu</p>")).toEqual(["jane@cs.example.edu (decoded)"]);
    expect(addresses("<p>Write to jane at example dot org, please.</p>")).toEqual(["jane@example.org (decoded)"]);
  });

  it("takes plain addresses and mailto links as written, not decoded", () => {
    expect(addresses(`<p>Mail <a href="mailto:Ann@Example.org?subject=hi">me</a> or bob@example.com.</p>`)).toEqual([
      "ann@example.org",
      "bob@example.com",
    ]);
  });

  it("does not read prose as an address", () => {
    expect(addresses("<p>Slides are available at example.com and at arxiv.org.</p>")).toEqual([]);
    expect(addresses("<p>I arrived at Stanford. Then I left.</p>")).toEqual([]);
    expect(addresses("<p>See <img src=photo.jpg> at the top.</p>")).toEqual([]);
  });

  it("does not fuse cells or blocks into one word", () => {
    expect(pageText("<table><tr><td>a</td><td>b</td></tr></table><p>c</p><div>d</div>").text).toBe("a b c d");
  });

  it("ignores scripts and styles", () => {
    expect(addresses("<script>var e='x@evil.example'</script><style>a{}</style><p>hi</p>")).toEqual([]);
  });
});

describe("addressNamesAuthor", () => {
  it("is true for the surname, a first name, or initials with the surname", () => {
    expect(addressNamesAuthor("alexwarth@gmail.com", "Alessandro Warth")).toBe(true);
    expect(addressNamesAuthor("alessandro@example.org", "Alessandro Warth")).toBe(true);
    expect(addressNamesAuthor("awarth@example.org", "Alessandro Warth")).toBe(true);
    expect(addressNamesAuthor("jmuller@example.de", "Jörg Müller")).toBe(true);
  });

  it("is false for someone else's address", () => {
    expect(addressNamesAuthor("labmanager@example.org", "Alessandro Warth")).toBe(false);
    expect(addressNamesAuthor("info@example.org", null)).toBe(false);
  });
});

describe("readAuthorPage", () => {
  it("reads a page through the injected fetch", async () => {
    const read = await readAuthorPage("http://example.org/~a", async () => ({
      kind: "html",
      text: "<p>a [at] example.org</p>",
      finalUrl: "https://example.org/~a/",
    }));
    /* The page named is where the fetch ended, after redirects (R2). */
    expect(read).toMatchObject({ kind: "read", url: "https://example.org/~a/", addresses: [{ address: "a@example.org", disguised: true }] });
  });

  it("turns a failure into a reason, never a throw", async () => {
    const blocked = await readAuthorPage("http://10.0.0.1/", async (url) => {
      throw new FetchFailure("blocked-address", url, "blocked");
    });
    expect(blocked).toEqual({ kind: "unread", url: "http://10.0.0.1/", reason: "blocked-address" });
    const pdf = await readAuthorPage("https://example.org/cv.pdf", async () => ({ kind: "pdf" }));
    expect(pdf).toEqual({ kind: "unread", url: "https://example.org/cv.pdf", reason: "not-html" });
  });
});
