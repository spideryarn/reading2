/**
 * An article may not address our own API.
 *
 * The class of problem no grep over our source can find: the sanitiser keeps
 * relative URLs by design (the block splitter needs figures), so a published
 * page can carry `<img src="/api/health">` and it resolves against *our*
 * origin in the reading view. GPT Sol found it, 2026-08-26; the rule lives in
 * src/sanitize-policy.ts.
 *
 * Every assertion here is a **removal**, and the last block is the one that
 * stops this becoming a rule that deletes everything.
 */
import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "../src/sanitize.js";

describe("article HTML cannot reach our API", () => {
  it("drops it from every attribute that can carry a URL", () => {
    const cases: [string, string][] = [
      ["img src", `<p><img src="/api/health" alt="x"></p>`],
      ["a href", `<p><a href="/api/library">shelf</a></p>`],
      ["dot-segments", `<p><img src="/figures/../api/health" alt="x"></p>`],
      ["bare /api", `<p><a href="/api">x</a></p>`],
      ["uppercase attribute", `<p><IMG SRC="/api/health" alt="x"></p>`],
      /* HTML 4's presentational table attribute. Browsers still fetch it, and
         it was not in the first version of the list. */
      ["table background", `<table background="/api/health"><tr><td>c</td></tr></table>`],
    ];
    for (const [what, html] of cases) {
      expect(sanitizeHtml(html), what).not.toContain("/api");
    }
  });

  /**
   * **The five that walked straight through the first version of this rule**,
   * every one found by GPT Sol running them rather than by reading the code.
   * They are kept together, and named, because the lesson is about the shape of
   * the mistake: an attribute allowlist is worth exactly the adversarial cases
   * somebody actually tried, and the first test here tried only the easy ones.
   */
  describe("the bypasses the first version had", () => {
    it("a mixed srcset — the bad candidate goes, the good ones stay", () => {
      const out = sanitizeHtml(
        `<p><img src="/safe.png" srcset="/safe.png 1x, /api/health 2x" alt="x"></p>`,
      );
      /* The whole value is not a URL, so handing it to `new URL()` threw and the
         old code concluded there was nothing to see. */
      expect(out).not.toContain("/api/health");
      /* And the reader keeps their other candidate — one bad entry must not cost
         them the image. */
      expect(out).toContain("/safe.png");
    });

    it("an SVG paint server, which is a URL inside a value rather than a URL", () => {
      const out = sanitizeHtml(`<p><svg><rect fill="url(/api/health)" /></svg></p>`);
      expect(out).not.toContain("/api/health");
    });

    it("our own host, spelled out in full", () => {
      const out = sanitizeHtml(
        `<p><a href="http://localhost:5273/api/library">x</a></p>`,
      );
      /* The first version resolved every URL against a placeholder origin, which
         made our own production host "foreign" — so it stripped `/api/health`
         and let the fully-qualified version through. */
      expect(out).not.toContain("/api/library");
    });

    it("our own host, protocol-relative", () => {
      const out = sanitizeHtml(`<p><a href="//localhost:5273/api/library">x</a></p>`);
      expect(out).not.toContain("/api/library");
    });

    it("an origin named in SPIDERYARN_ORIGINS", () => {
      const before = process.env.SPIDERYARN_ORIGINS;
      process.env.SPIDERYARN_ORIGINS = "https://spideryarn-greg-detre.vercel.app";
      try {
        const out = sanitizeHtml(
          `<p><img src="https://spideryarn-greg-detre.vercel.app/api/health" alt="x"></p>`,
        );
        expect(out).not.toContain("/api/health");
      } finally {
        if (before === undefined) delete process.env.SPIDERYARN_ORIGINS;
        else process.env.SPIDERYARN_ORIGINS = before;
      }
    });
  });

  /**
   * The other half, and the reason `isOwnApi` resolves rather than
   * string-matches. A rule that also ate ordinary article links and images
   * would break every scraped page in the library, and it would do it quietly.
   */
  it("leaves everything else alone", () => {
    const kept = [
      [`<p><img src="/d.png" alt="d"></p>`, "/d.png"],
      [`<p><a href="https://example.com/api/thing">their api</a></p>`, "https://example.com/api/thing"],
      [`<p><a href="//example.com/api/thing">protocol-relative</a></p>`, "//example.com/api/thing"],
      [`<p><img src="/ok.png" srcset="/a.png 1x, /b.png 2x" alt="x"></p>`, "/b.png 2x"],
      [`<p><svg><rect fill="url(#gradient)" /></svg></p>`, "url(#gradient)"],
      [`<p><a href="/apiary/notes">not our api</a></p>`, "/apiary/notes"],
      [`<p><a href="#spya-k3m9qt">a block</a></p>`, "#spya-k3m9qt"],
    ];
    for (const [html, expected] of kept) {
      expect(sanitizeHtml(html as string), expected as string).toContain(expected as string);
    }
  });
});
