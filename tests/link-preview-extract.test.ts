/**
 * **What a page says about itself**, and the sanity check that keeps furniture
 * off a card.
 *
 * This is the pure half of the link preview — HTML in, four fields out — and it
 * is tested hard for the same reason `tests/link-preview.test.ts` tests the href
 * half hard: it is where somebody else's bytes become something a React render
 * trusts, and every case here came off a real destination rather than being
 * invented.
 *
 * Two things measured over ten corpus destinations on 2026-09-05 shape all of
 * it, and both are counter-intuitive enough to be worth a test each:
 *
 * - **Three of the eight successes carry no `og:` tags at all** — plato.stanford,
 *   paulgraham, gwern — so the `<title>` / `<meta name=description>` fallback
 *   chain is load-bearing rather than a nicety. A version that read only Open
 *   Graph would have lost more than a third of what works and looked fine.
 * - **Readability's "first paragraph" can be a byline artefact.** noema's comes
 *   back as the word "Credits", and a card headed with the destination's own
 *   words that then says "Credits" reads as a lookup that half worked.
 *
 * No network and no store: `extractPreview` takes a string.
 */
import { describe, expect, it } from "vitest";

import { extractPreview, saneParagraph } from "../src/link-previews.js";

const AT = "https://destination.example/piece";

/** Wrap a `<head>` and a body in the least markup that parses as a document. */
function page(head: string, body = "<p>Nothing much.</p>"): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

describe("what a page says about itself", () => {
  it("prefers Open Graph, which is what most of the corpus carries", () => {
    const found = extractPreview(
      page(
        '<title>Site name — A Paper</title>' +
          '<meta property="og:title" content="A Paper">' +
          '<meta property="og:site_name" content="The Journal">' +
          '<meta property="og:description" content="What it argues.">',
      ),
      AT,
    );
    expect(found?.page).toMatchObject({
      title: "A Paper",
      siteName: "The Journal",
      description: "What it argues.",
    });
  });

  it("falls back to twitter: tags, spelled either way", () => {
    /* Pages spell `twitter:` on `name` and on `property` and neither is rare,
       so both are matched — a chain that only knew one of them would miss
       silently, which is the shape of every bug in this file. */
    const byName = extractPreview(
      page('<title>Ignored</title><meta name="twitter:title" content="By name">'),
      AT,
    );
    const byProperty = extractPreview(
      page('<title>Ignored</title><meta property="twitter:title" content="By property">'),
      AT,
    );
    expect(byName?.page.title).toBe("By name");
    expect(byProperty?.page.title).toBe("By property");
  });

  it("falls back to <title> and <meta name=description>, which three of eight need", () => {
    /* plato.stanford, paulgraham and gwern. This is the case that would have
       been lost by taking a metadata library's Open Graph path and stopping. */
    const found = extractPreview(
      page(
        "<title>Writes and Write-Nots</title>" +
          '<meta name="description" content="What happens when writing gets easy.">',
      ),
      AT,
    );
    expect(found?.page).toMatchObject({
      title: "Writes and Write-Nots",
      description: "What happens when writing gets easy.",
    });
    /* No `og:site_name` means no site name. It is never guessed from the host,
       because the card already prints the host one line up. */
    expect(found?.page.siteName).toBeUndefined();
  });

  it("counts the destination's words", () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const found = extractPreview(
      page("<title>Long</title>", `<article><p>${words}</p></article>`),
      AT,
    );
    expect(found?.page.words).toBeGreaterThan(250);
  });

  it("says nothing about length when there is barely anything to count", () => {
    /* Readability answers with *something* for almost any document, and on a
       landing page or a JavaScript shell that something is a handful of words
       off a button. "1 word · ~1 min" under a title reads as a measurement of
       the destination when it is a measurement of what Readability could find,
       so the line is simply absent. */
    const found = extractPreview(
      page('<meta property="og:title" content="A shell">', "<p>Body.</p>"),
      AT,
    );
    expect(found?.page).toMatchObject({ title: "A shell" });
    expect(found?.page.words).toBeUndefined();
  });

  it("answers null when a page says nothing worth a card", () => {
    /* A landing page, a paywall, or a page that builds itself with JavaScript.
       That is a real and *stable* answer, and the caller caches it as one so
       every later hover is not another fetch — it is not an error. */
    expect(extractPreview(page("", "<div></div>"), AT)).toBeNull();
  });

  it("survives a document Readability cannot make sense of", () => {
    /* The `og:` half may already be everything worth showing, so a throw out of
       Readability must not lose it. */
    const found = extractPreview(
      page('<meta property="og:title" content="Still here">', ""),
      AT,
    );
    expect(found?.page).toMatchObject({ title: "Still here" });
  });
});

describe("the first paragraph, sanity-checked", () => {
  it("refuses noema's byline artefact", () => {
    /* Measured, verbatim: Readability's first block of text on the noema essay
       is the single word "Credits". */
    expect(saneParagraph("Credits")).toBeNull();
  });

  it("refuses a navigation label, however long", () => {
    expect(
      saneParagraph(
        "Subscribe to our newsletter for weekly updates about everything we publish, " +
          "delivered every Thursday morning.",
      ),
    ).toBeNull();
  });

  it("refuses a run of words with no sentence in it", () => {
    /* A wall of words and no full stop is a navigation bar far more often than
       it is prose. */
    expect(
      saneParagraph(
        "Home About Archive Contact Newsletter Search Topics Authors Issues Events Support Us Shop",
      ),
    ).toBeNull();
  });

  it("keeps a real opening", () => {
    const opening =
      "Widespread belief in imminent conscious AI stems mainly from psychological bias " +
      "and a flawed reading of what these systems actually do.";
    expect(saneParagraph(opening)).toBe(opening);
  });

  it("collapses the whitespace Readability leaves in", () => {
    const kept = saneParagraph(
      "  Widespread belief in imminent conscious AI stems\n\n  mainly from psychological bias.  ",
    );
    expect(kept).toBe(
      "Widespread belief in imminent conscious AI stems mainly from psychological bias.",
    );
  });

  it("treats nothing as nothing", () => {
    expect(saneParagraph(null)).toBeNull();
    expect(saneParagraph(undefined)).toBeNull();
    expect(saneParagraph("")).toBeNull();
  });
});
