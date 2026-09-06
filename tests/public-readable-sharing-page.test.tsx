/**
 * **`/features/public-readable-sharing` makes four claims about things that
 * live outside it**, and every one of them can stop being true without anybody
 * opening the page.
 *
 * The page is written to the author of a republished article
 * (docs/project/public-readable-sharing.md). That reader cannot check anything
 * on it — they are relying on us to have — which makes a stale sentence here
 * worse than a stale sentence anywhere else on the site. And the four sentences
 * most likely to go stale are the four that describe a header, a file or a
 * routing table rather than an arrangement:
 *
 *  1. `robots.txt` disallows crawling.
 *  2. Every response carries `X-Robots-Tag: noindex, nofollow`.
 *  3. A public article's head carries a `<link rel="canonical">`.
 *  4. The no-training commitment carries the same hedge `/privacy` gives it.
 *
 * Nothing about deleting a header would make somebody open this page, which is
 * the whole argument for the test — the same one tests/privacy-page.test.ts
 * makes about model names.
 *
 * **What this deliberately does not pin is the prose.** Those are words that
 * will be rewritten, and a test quoting them is a test somebody edits to make
 * green — the rule tests/takedown-privacy-section.test.tsx already states. What
 * is pinned is that a claim and the thing it claims about still agree.
 *
 * ## The hole this test was written around
 *
 * Searching the raw file would be silent success
 * (docs/reusable/silent-success.md): this page's own header comment quotes the
 * two claims that turned out to be **false** — zero-data-retention and the SEO
 * framing of the canonical — so a page that had started making them again would
 * pass a naive grep on the strength of the comment warning against them. The
 * comments are stripped first, and `it("is reading the prose rather than the
 * comments")` is what stops the regex quietly matching nothing and handing back
 * the whole file. GPT Sol found that hole in the privacy test; it is copied
 * here because this page has a much larger comment than that one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL } from "../src/site-text.js";
import { PUBLIC_SHARING_HREF } from "../src/web/router.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The page with its comments removed — the prose a reader actually sees. */
const PAGE = (() => {
  const raw = read("src/web/PublicReadableSharingPage.tsx");
  return raw.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
})();

const ROBOTS = read("public/robots.txt");
const VERCEL = read("vercel.json");
const PAGE_HEAD = read("src/public/page-head.ts");
const PRIVACY = read("src/web/PrivacyPage.tsx");

describe("the public-readable-sharing page", () => {
  it("is reading the prose rather than the comments", () => {
    /* The header comment names both false claims. If stripping ever stops
       working, these two are the words that would sneak back in — so their
       absence is the proof the stripper ran, and the assertion below is the
       proof it did not simply eat the file. */
    expect(PAGE).not.toMatch(/zero-data-retention/i);
    expect(PAGE.length).toBeGreaterThan(2000);
    expect(PAGE.length).toBeLessThan(read("src/web/PublicReadableSharingPage.tsx").length);
  });

  it("lives at an address built from /features", () => {
    expect(PUBLIC_SHARING_HREF).toBe("/features/public-readable-sharing");
  });

  it("offers the one address we publish, and no other", () => {
    expect(PAGE).toContain("CONTACT_EMAIL");
    /* A hard-coded address beside the constant is the drift this catches — the
       feedback dialog shipped exactly that once (docs/project/website-text.md). */
    expect(PAGE).not.toMatch(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(CONTACT_EMAIL).toMatch(/@/);
  });

  /* ── the four claims about things outside the page ────────────────────── */

  it("claims robots.txt disallows crawling, and it does", () => {
    expect(PAGE).toMatch(/robots\.txt/);
    expect(PAGE).toMatch(/disallow/i);
    /* The `*` group, not one of the two card-fetcher groups below it — those
       carry an `Allow: /read/` and a `Disallow: /` of their own, so a bare
       search for "Disallow: /" would go on passing after the site-wide rule
       was deleted. */
    const universal = ROBOTS.split(/^User-agent:/m).find((g) => g.trimStart().startsWith("*"));
    expect(universal).toBeDefined();
    expect(universal).toMatch(/^\s*Disallow:\s*\/\s*$/m);
  });

  it("claims a noindex header on every response, and vercel.json sets one", () => {
    expect(PAGE).toMatch(/X-Robots-Tag/);
    expect(PAGE).toMatch(/noindex/);
    const json = JSON.parse(VERCEL) as {
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };
    const all = json.headers?.find((h) => h.source === "/(.*)");
    expect(all, "vercel.json no longer has a site-wide header block").toBeDefined();
    expect(all?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
    /* And the page says the *pages* carry the matching meta, which is the half
       that survives somebody serving the app from somewhere other than Vercel. */
    expect(PAGE_HEAD).toMatch(/meta\(\s*"name",\s*"robots",\s*"noindex, nofollow"\s*\)/);
  });

  it("claims a canonical link, and page-head emits one", () => {
    expect(PAGE).toMatch(/rel="canonical"/);
    expect(PAGE_HEAD).toMatch(/rel="canonical"/);
    /* **The hedge is load-bearing and is asserted too.** `safePublicCanonical`
       returns null for a source URL carrying a query string, so the tag is not
       always emitted — the page says "where we recorded the address" rather
       than "always", and a rewrite that promoted it to a promise would be a
       false sentence nothing else would catch. */
    expect(PAGE).toMatch(/[Ww]here we recorded the address/);
  });

  it("makes the no-training claim with the same hedge /privacy gives it", () => {
    expect(PAGE).toMatch(/nobody trains a model on it/);
    expect(PRIVACY).toMatch(/nobody trains a model on it/);
    /* The hedge, in both places and in the same words on neither — what has to
       match is that each one *has* one, because the promise rests on an account
       setting rather than on a line of code. A page that dropped it would be
       claiming more than the code can support. */
    expect(PAGE).toMatch(/commitment we hold ourselves to/);
    expect(PRIVACY).toMatch(/commitment we hold ourselves to/);
  });

  /* ── the two admissions, which are the point of the page ──────────────── */

  it("says the rights tick-box is a promise rather than a check", () => {
    expect(PAGE).toMatch(/a promise they make, not a check we run/);
    expect(PAGE).toMatch(/[Nn]obody at Spideryarn reads an article before it appears/);
  });

  it("says the generated text is the model's and not the author's", () => {
    expect(PAGE).toMatch(/written by a language model/);
    /* Written as an admission that nothing beside them says so. **If a label
       ever lands in the visitor's view, this sentence has to change with it** —
       an admission left standing after the fix is a lie the other way round.
       docs/project/public-readable-sharing.md § the three awkward facts. */
    expect(PAGE).toMatch(/nothing printed beside them says so/);
  });

  it("names the two things a rights-holder would otherwise have to discover", () => {
    /* Greg, 2026-09-06, chose to name all three and asked us not to make a meal
       of it — so this checks they are present, not how much room they get. */
    expect(PAGE).toMatch(/home and features pages/);
    expect(PAGE).toMatch(/halves what it counts against/);
  });

  it("does not claim to behave legally and ethically", () => {
    /* Nobody who is behaving legally says so; it invites "so are you?" and it
       is the sentence somebody would quote back. The facts and the offer say it
       instead. docs/plans/260906g-…§ Two of the five claims were not true. */
    expect(PAGE).not.toMatch(/legally and ethically/i);
  });
});
