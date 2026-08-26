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
      ["img srcset", `<p><img src="/ok.png" srcset="/api/health 2x" alt="x"></p>`],
      ["absolute, same origin", `<p><a href="https://spideryarn.invalid/api/library">x</a></p>`],
      ["dot-segments", `<p><img src="/figures/../api/health" alt="x"></p>`],
      ["bare /api", `<p><a href="/api">x</a></p>`],
    ];
    for (const [what, html] of cases) {
      expect(sanitizeHtml(html), what).not.toContain("/api");
    }
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
      [`<p><a href="/apiary/notes">not our api</a></p>`, "/apiary/notes"],
      [`<p><a href="#spya-k3m9qt">a block</a></p>`, "#spya-k3m9qt"],
    ];
    for (const [html, expected] of kept) {
      expect(sanitizeHtml(html as string), expected as string).toContain(expected as string);
    }
  });
});
