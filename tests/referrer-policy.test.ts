/**
 * **No referrer leaves this app, and it is said in two places on purpose.**
 *
 * Settled in docs/plans/260827ai-public-read-only-access.md § Stage 1 — *"Also stage 1:
 * an explicit `Referrer-Policy`. The public slug is not a secret, but the page
 * URL carries reading state, and the original source URL can carry query data
 * of its own"* — and then not built. GPT Sol's second pass found it missing,
 * 2026-08-28.
 *
 * It matters more since that pass than it did when it was written. A shared
 * article's own HTML retains third-party images, `srcset`s and allowlisted
 * embeds (sanitize-policy.ts keeps them deliberately), so **a visitor's browser
 * contacts other hosts while they read**. Without this, each of those hosts
 * learns the exact address of the article being read — and `/read/<slug>?at=…`
 * is reading position as well as an identity.
 *
 * ## Two mechanisms, neither depending on the other
 *
 * - `vercel.json` sets the response header, which applies where Vercel serves.
 * - `index.html` carries `<meta name="referrer">`, which applies wherever the
 *   document is served from: the dev server, a preview, a saved copy.
 *
 * ## What this test does and does not prove
 *
 * **The meta tag is response-level**: it is in the document body every request
 * for a page receives, and Vite copies it into `dist/index.html` unchanged.
 * That is the assertion below with real weight.
 *
 * **The `vercel.json` assertion is weaker and is labelled as such** — it reads
 * a config file and says nothing about what an edge actually returns. Nothing
 * in vitest can: Vite serves the SPA in development, so there is no server of
 * ours to ask. Proving the deployed header needs a request against a real
 * deployment, which belongs with the other post-deploy judgements in
 * scripts/deploy-checks.ts. Recorded here rather than left as a gap somebody
 * discovers.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (name: string) => readFileSync(path.join(ROOT, name), "utf8");

describe("the referrer policy", () => {
  /**
   * The half that travels with the document, and so the half that holds when
   * somebody serves this from anywhere other than Vercel.
   */
  it("is in the document every page response carries", () => {
    const html = read("index.html");
    const tag = html.match(/<meta\s+name="referrer"\s+content="([^"]+)"\s*\/?>/);

    expect(tag, "index.html must carry a referrer meta tag").not.toBeNull();
    /* `no-referrer` and not `strict-origin-when-cross-origin`, which is the
       browser default and still sends the origin. The origin is the thing worth
       withholding: it says a reader is using Spideryarn at all. */
    expect(tag?.[1]).toBe("no-referrer");
  });

  /**
   * And the header, which is what a browser obeys first.
   *
   * **A config assertion, which is the weaker kind** — see the header. It
   * catches the case that actually happened, which is the line never being
   * written at all.
   */
  it("is declared as a response header for every path", () => {
    const config = JSON.parse(read("vercel.json")) as {
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };

    const everyPath = config.headers?.find((h) => h.source === "/(.*)");
    expect(everyPath, "a site-wide header rule must exist").toBeDefined();

    const policy = everyPath?.headers.find((h) => h.key === "Referrer-Policy");
    expect(policy?.value).toBe("no-referrer");

    /* The rule it shares a block with, asserted so that a rewrite of this block
       cannot quietly drop one while satisfying the other. Stage 1 leaves
       `noindex` exactly as it is — the indexing decision belongs to stage 2,
       when the pages are worth indexing. */
    expect(everyPath?.headers.find((h) => h.key === "X-Robots-Tag")?.value).toBe(
      "noindex, nofollow",
    );
  });
});
