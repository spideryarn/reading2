// @vitest-environment jsdom
/**
 * **The two things that stand between a stranger's page title and our `<head>`.**
 *
 * Stage 2 of the public-link work composes a document head on the server — a
 * `<title>`, a `<meta name="description">`, `og:*` and `twitter:*` — from the
 * article's extracted title and the model's root gist. Both are untrusted:
 * [security-map.md](../docs/project/security-map.md) counts the content and the
 * model's output as two of the four untrusted parties, and this is a new sink
 * for both. docs/plans/public-read-only-access.md § Stage 2.
 *
 * ## Why these assertions parse rather than compare
 *
 * The obvious test is `expect(escapeHtml(evil)).toBe("…")`, and it is the weak
 * one: it passes if the output is a string somebody once wrote down, and it
 * says nothing about what a browser does with it. So the injection cases build
 * the tag the function is *for*, parse it, and count elements. A second
 * `<meta>` appearing where one was written is the actual failure, and it is
 * visible in the DOM and invisible in a string comparison that was updated to
 * match the bug.
 *
 * Every case below has a mutation that must turn it red, and each was run:
 * map `<` to itself, map `"` to itself, delete the whitespace pass, delete the
 * bidi pass, delete the clamp. All five reddened, and only the case they belong
 * to. The list is Sol's, from the stage 2 design § 6.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { escapeHtml, headText } from "../src/html.js";
import { safePublicCanonical } from "../src/urls.js";

/** Parse a fragment and hand back the document, so assertions can be structural. */
function head(markup: string): Document {
  return new JSDOM(`<!doctype html><html><head>${markup}</head><body></body></html>`).window
    .document;
}

/** The head as this stage will really compose it: escape once, at the boundary. */
const titleTag = (raw: string) => `<title>${escapeHtml(headText(raw, 64))}</title>`;
const descTag = (raw: string) =>
  `<meta name="description" content="${escapeHtml(headText(raw, 240))}">`;

describe("escaping, at the boundary where text becomes markup", () => {
  it("maps every one of the five, so no single mapping can be dropped", () => {
    /* Blunt and on purpose. The structural tests below are the interesting
       ones, but each of them is defeated by a *combination* — so a mutation
       that drops exactly one mapping can slip past all of them. This is the
       assertion that cannot. */
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("cannot be talked out of the title element", () => {
    const doc = head(titleTag('Real</title><meta name="robots" content="index">'));
    /* One `<title>`, and the injected `<meta>` is text inside it rather than an
       element beside it. */
    expect(doc.querySelectorAll("title")).toHaveLength(1);
    expect(doc.querySelectorAll("meta")).toHaveLength(0);
    /* **What this proves is "nothing broke out", and nothing more** — said
       plainly because two earlier versions of this assertion claimed more.

       `<title>` is RCDATA. Escaping `>` alone already stops the payload:
       `</title&gt;` is `</title` followed by `&`, which is not an end tag, so
       the whole thing stays text. Unescaping `<` therefore changes the bytes we
       emit and changes nothing about the parse.

       And it cannot be caught by looking at the parsed result either, because
       **every reader of the parsed result normalises**. `doc.title` decodes
       entities, so `</title&gt;` reads back as `</title>`; `innerHTML`
       re-serialises with correct escaping, so the two inputs produce
       byte-identical output. Measured both, 2026-08-29. An assertion that reads
       through a normalising layer cannot see the thing that layer normalises.

       So the per-character test above is what covers the mapping, and this test
       covers the composition: one element in, one element out. */
    expect((doc.querySelector("title") as Element).innerHTML).toBe(
      "Real&lt;/title&gt;&lt;meta name=\"robots\" content=\"index\"&gt;",
    );
  });

  it("cannot smuggle a second attribute into the tag it is inside", () => {
    /* **The first version of this test was inert, and the mutation found it.**
       It used the obvious payload — close the attribute, close the tag, open a
       new `<meta>` — and asserted the element count. Mapping `"` to itself left
       it green, because that payload needs `<` and `>` as well and those are
       escaped by a different entry in the table. The test was passing on the
       `<` rule while claiming to cover the `"` one.

       The payload that genuinely needs `"` and nothing else does not open a tag
       at all: it adds an **attribute** to the tag it is already inside. No
       angle brackets, so no other escape can save it.

       So the assertion is the attribute list, not the element count. */
    const doc = head(descTag('" onload="alert(1)'));
    const meta = doc.querySelector('meta[name="description"]');
    expect(meta).not.toBeNull();
    expect([...(meta as Element).attributes].map((a) => a.name).sort()).toEqual([
      "content",
      "name",
    ]);
  });

  it("closes the same hole in a single-quoted attribute", () => {
    /* Why the table has five entries and not four — `src/pdf-read.ts`'s copy
       still has four. A head composed with `content='…'` is open to exactly the
       case above by way of `'`, and nothing else in the table stops it. */
    const doc = head(`<meta name="description" content='${escapeHtml("' onload='alert(1)")}'>`);
    const meta = doc.querySelector('meta[name="description"]');
    expect([...(meta as Element).attributes].map((a) => a.name).sort()).toEqual([
      "content",
      "name",
    ]);
  });

  it("escapes ampersands once, not twice", () => {
    /* The chained-`replace` bug: `&` handled after `<` turns every entity the
       earlier passes produced into `&amp;lt;`. One pass with one table cannot
       be got into that order. */
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("normalising text before it is metadata", () => {
  it("makes a line break a space rather than a join", () => {
    /* `A\r\nB` is two words. Deleting the break rather than replacing it gives
       `AB`, which is one word and a different fact. */
    expect(headText("A\r\nB", 99)).toBe("A B");
    expect(headText("A\tB", 99)).toBe("A B");
    expect(headText("  A   B  ", 99)).toBe("A B");
  });

  it("removes the invisible direction changes, and keeps the visible letters", () => {
    /* U+202E RIGHT-TO-LEFT OVERRIDE reverses display order — the filename trick,
       and it works on a link preview too. It survives escaping untouched,
       because it is not markup. */
    expect(headText("A‮evil", 99)).toBe("Aevil");
    expect(headText("A⁦x⁩B", 99)).toBe("AxB");
    /* **And this is the half that makes the rule right rather than blunt.**
       Arabic and Hebrew letters carry their own direction and are not controls.
       A title in either keeps every character it had. */
    expect(headText("مرحبا بالعالم", 99)).toBe("مرحبا بالعالم");
    expect(headText("שלום עולם", 99)).toBe("שלום עולם");
  });

  it("clamps by code point, so an astral character cannot be cut in half", () => {
    const long = "\u{1D54F}".repeat(10); // 10 code points, 20 UTF-16 units
    const clamped = headText(long, 3);
    expect([...clamped]).toHaveLength(3);
    /* The failure a `.length` clamp produces: a high surrogate with nothing
       after it, which is not valid text and which the network and
       `JSON.stringify` each mangle differently. */
    expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(clamped).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("clamps a title that is not a title at all", () => {
    /* A real failure mode rather than an attack: a page whose `<title>` is its
       whole first paragraph. Escaping has nothing to say about it. */
    expect([...headText("x".repeat(10_000), 64)]).toHaveLength(64);
  });

  it("does not leave a trailing space where it cut", () => {
    /* The cut can land just after a space, and metadata ending in one will not
       compare equal to the obvious expectation of it. */
    expect(headText("abc defghij", 4)).toBe("abc");
  });
});

describe("the canonical URL, which is a public statement", () => {
  it("publishes an ordinary article address, without its fragment", () => {
    expect(safePublicCanonical("https://example.com/a/b")).toBe("https://example.com/a/b");
    expect(safePublicCanonical("https://example.com/a#s3")).toBe("https://example.com/a");
  });

  it("refuses anything with a query rather than stripping it", () => {
    /* Both directions of the judgement in one pair: `?utm_source=` is unsafe to
       publish, and `?id=123` *is* the article on a great many sites, so the
       stripped URL names a different page. Nothing distinguishes them from
       here, so both are refused. */
    expect(safePublicCanonical("https://example.com/a?utm_source=x")).toBeNull();
    expect(safePublicCanonical("https://example.com/article?id=123")).toBeNull();
  });

  it("drops a bare question mark rather than refusing or publishing it", () => {
    /* This assertion was written expecting a refusal and the test said
       otherwise. The URL standard parses a trailing `?` to an *empty* query, so
       it is not one of the cases above — there is nothing to be uncertain
       about, and refusing would have thrown away a perfectly good canonical.
       What it does need is removing from the serialisation, which keeps it. */
    expect(safePublicCanonical("https://example.com/a?")).toBe("https://example.com/a");
  });

  it("refuses a URL carrying a credential", () => {
    expect(safePublicCanonical("https://user:pw@example.com/a")).toBeNull();
    /* A password with an empty username is still a credential, and `new URL`
       keeps the two in separate fields — checking only `username` misses it. */
    expect(safePublicCanonical("https://:pw@example.com/a")).toBeNull();
  });

  it("refuses every scheme but http and https", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/a",
      "not a url at all",
      "",
    ]) {
      expect(safePublicCanonical(value), value).toBeNull();
    }
  });

  it("refuses a URL long enough to be a payload rather than an address", () => {
    expect(safePublicCanonical(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
    expect(safePublicCanonical(`https://example.com/${"a".repeat(2000)}`)).not.toBeNull();
  });

  it("hands back unescaped text, so the caller escapes exactly once", () => {
    /* A function returning pre-escaped text is the kind the next person escapes
       again. The boundary is one place and it is `escapeHtml`. */
    const url = safePublicCanonical("https://example.com/a&b");
    expect(url).toBe("https://example.com/a&b");
    expect(escapeHtml(url as string)).toBe("https://example.com/a&amp;b");
  });
});
