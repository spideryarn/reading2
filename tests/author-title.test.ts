/**
 * An article's own `title` attribute: moved by the policy onto
 * `data-author-title`, so the browser draws no grey box, and shown in the prose
 * card when it says something the reader cannot already see.
 * docs/plans/261018n-an-article-s-own-title-attributes-shown-in-our-card-marked-as-the-author-s.md.
 */
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../src/sanitize.js";
import { AUTHOR_TITLE_ATTR } from "../src/sanitize-policy.js";
import { anchorsOf } from "../src/bibliography.js";
import { authorTitleWorthShowing } from "../src/web/author-title.js";

describe("the policy moves an article's title off the element", () => {
  it("renames title on a link, an abbreviation and a span", () => {
    for (const html of [
      `<p><a href="https://example.com/a" title="'A paper', Smith 2020">a paper</a></p>`,
      `<p><abbr title="circa">c.</abbr> 1900</p>`,
      `<p><span title="1981 was 45 years ago.">45ya</span></p>`,
    ]) {
      const out = sanitizeHtml(html);
      expect(out, html).not.toMatch(/\stitle=/);
      expect(out, html).toContain(`${AUTHOR_TITLE_ATTR}="`);
    }
  });

  it("keeps the words exactly", () => {
    const out = sanitizeHtml(`<p><span title="Ancient &amp; &quot;Greek&quot;">AG</span></p>`);
    expect(out).toBe(`<p><span ${AUTHOR_TITLE_ATTR}="Ancient &amp; &quot;Greek&quot;">AG</span></p>`);
  });

  it("leaves an embed's title alone, because it is the frame's name and not a tooltip", () => {
    const out = sanitizeHtml(`<iframe src="https://www.youtube.com/embed/abc" title="A talk"></iframe>`);
    expect(out).toContain(`title="A talk"`);
    expect(out).not.toContain(AUTHOR_TITLE_ATTR);
  });

  it("gives a link whose only name was its title that name as aria-label", () => {
    const out = sanitizeHtml(`<p><a href="https://example.com/" title="Home page"><img src="/i.png" alt=""></a></p>`);
    expect(out).toContain(`aria-label="Home page"`);
    expect(out).toContain(`${AUTHOR_TITLE_ATTR}="Home page"`);
  });

  it("keeps an abbreviation's expansion for a screen reader", () => {
    const out = sanitizeHtml(`<p><abbr title="circa">c.</abbr></p>`);
    expect(out).toContain(`aria-description="circa"`);
  });

  it("names an image that had no alt, and leaves a decorative one decorative", () => {
    expect(sanitizeHtml(`<p><img src="/i.png" title="A chart"></p>`)).toContain(`aria-label="A chart"`);
    expect(sanitizeHtml(`<p><img src="/i.png" alt="" title="A chart"></p>`)).not.toContain("aria-label");
  });

  it("does not add aria-label where the element already has words", () => {
    const out = sanitizeHtml(`<p><a href="https://example.com/" title="Home page">home</a></p>`);
    expect(out).not.toContain("aria-label");
  });

  it("is idempotent", () => {
    for (const html of [
      `<p><a href="https://example.com/a" title="t">x</a></p>`,
      `<p><a href="https://example.com/" title="Home"><img src="/i.png" alt=""></a></p>`,
      `<svg><circle r="5" title="a circle"></circle></svg>`,
    ]) {
      const once = sanitizeHtml(html);
      expect(sanitizeHtml(once), html).toBe(once);
    }
  });

  it("keeps an article's own data-author-title, which gives it nothing title did not", () => {
    const out = sanitizeHtml(`<p><span ${AUTHOR_TITLE_ATTR}="hi">x</span></p>`);
    expect(out).toContain(`${AUTHOR_TITLE_ATTR}="hi"`);
  });
});

describe("the bibliography still reads a link's label", () => {
  it("from the new name and from the old one, which stored blocks still carry", () => {
    const fresh = anchorsOf(sanitizeHtml(`<p><a href="https://example.com/a" title="A paper">x</a></p>`));
    const stored = anchorsOf(`<p><a href="https://example.com/a" title="A paper">x</a></p>`);
    expect(fresh[0]?.label).toBe("A paper");
    expect(stored[0]?.label).toBe("A paper");
  });
});

describe("authorTitleWorthShowing", () => {
  it("keeps a citation the link stands for", () => {
    expect(
      authorTitleWorthShowing(
        "'Scaling Laws for Neural Language Models', Kaplan et al 2020",
        "science",
        "https://gwern.net/doc/www/arxiv.org/abc",
      ),
    ).toBe("'Scaling Laws for Neural Language Models', Kaplan et al 2020");
  });

  it("keeps an abbreviation's expansion", () => {
    expect(authorTitleWorthShowing("circa", "c.", null)).toBe("circa");
  });

  it("drops a title that is the element's own words", () => {
    expect(authorTitleWorthShowing("Leo", " leo ", null)).toBeNull();
    expect(authorTitleWorthShowing("“Scaling Laws”", "Scaling laws", null)).toBeNull();
  });

  it("drops a title that restates the address — every Wikipedia link", () => {
    expect(authorTitleWorthShowing("Ancient Corinth", "Corinth", "https://en.wikipedia.org/wiki/Ancient_Corinth")).toBeNull();
    expect(authorTitleWorthShowing("Bibcode (identifier)", "Bibcode", "/wiki/Bibcode_(identifier)")).toBeNull();
    expect(
      authorTitleWorthShowing(
        "Special:BookSources/978-0-19-509594-4",
        "978-0-19-509594-4",
        "https://en.wikipedia.org/wiki/Special:BookSources/978-0-19-509594-4",
      ),
    ).toBeNull();
  });

  it("keeps punctuation that is part of the meaning", () => {
    expect(authorTitleWorthShowing("C++", "C", null)).toBe("C++");
    expect(authorTitleWorthShowing("C#", "C", null)).toBe("C#");
  });

  it("drops COinS metadata and blank titles", () => {
    expect(authorTitleWorthShowing("ctx_ver=Z39.88-2004&rft_val_fmt=info", "", null)).toBeNull();
    expect(authorTitleWorthShowing("   ", "x", null)).toBeNull();
  });

  it("collapses whitespace and clips a long one", () => {
    const long = "word ".repeat(200);
    const shown = authorTitleWorthShowing(`a\n  b ${long}`, "x", null);
    expect(shown?.startsWith("a b word")).toBe(true);
    expect(shown?.length).toBeLessThanOrEqual(301);
    expect(shown?.endsWith("…")).toBe(true);
  });
});
