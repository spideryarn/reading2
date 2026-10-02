/**
 * **The banner on a shared article** — the three lines plan 261002g added to a
 * visitor's `SharedNotice` (src/web/PublicChrome.tsx): where the piece came
 * from, the takedown offer, and the training promise.
 *
 * What is pinned is what can go wrong silently: which address is drawn and
 * when none is, that the offer reaches the mailbox and the page that qualifies
 * it, and that the training sentence keeps the hedge `/privacy` and the sharing
 * page both carry. The prose itself is not pinned — tests that quote prose are
 * tests somebody edits to make green (tests/takedown-privacy-section.test.tsx
 * says the same).
 */
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BANNER_TRAINING } from "../src/messages.js";
import { CONTACT_EMAIL } from "../src/site-text.js";
import type { SourceGuess } from "../src/types.js";
import { SharedNotice } from "../src/web/PublicChrome.js";
import { PRIVACY_HREF, TAKEDOWN_HREF } from "../src/web/router.js";

function render(source?: { url: string | null; guess: SourceGuess | undefined }): string {
  return renderToStaticMarkup(
    createElement(SharedNotice, {
      signedIn: true,
      sessionUnconfirmed: false,
      ...(source ? { source } : {}),
    }),
  );
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

const GUESS: SourceGuess = {
  status: "found",
  url: "https://arxiv.org/abs/2401.01234",
  host: "arxiv.org",
  kind: "canonical",
  matchedBy: "arxiv",
};

describe("the banner's source line", () => {
  it("draws the published address, host first", () => {
    const html = render({ url: "https://www.example.com/2026/the-piece", guess: undefined });
    expect(hrefs(html)).toContain("https://www.example.com/2026/the-piece");
    expect(html).toContain("example.com");
    expect(html).toContain("Source:");
  });

  it("draws a shared upload's found guess, with its question mark and a stranger's wording", () => {
    const html = render({ url: null, guess: GUESS });
    expect(hrefs(html)).toContain(GUESS.url);
    expect(html).toContain("origin-guess-mark");
    expect(html).not.toContain("your file");
  });

  it("prefers the published address to a guess", () => {
    const html = render({ url: "https://example.com/a", guess: GUESS });
    expect(hrefs(html)).not.toContain(GUESS.url);
  });

  /* An absent address may be one the policy withheld, so nothing is said —
     not "uploaded" (Masthead.tsx § OriginLine). */
  it("says nothing about the source when there is neither", () => {
    for (const guess of [undefined, { status: "none" } as const, { status: "searching" } as const]) {
      const html = render({ url: null, guess });
      expect(html).not.toContain("Source:");
      expect(html).not.toContain("origin-link");
      expect(html.toLowerCase()).not.toContain("uploaded");
    }
  });

  /* The details page passes no source: its own SourceRow prints it. */
  it("draws no source line when the caller passes none", () => {
    expect(render()).not.toContain("origin-link");
  });

  it("refuses a javascript: address for the guess", () => {
    const html = render({ url: null, guess: { ...GUESS, url: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
  });
});

describe("the takedown offer and the training promise", () => {
  it("names the mailbox, and links the page that says what taking down means", () => {
    for (const html of [render(), render({ url: null, guess: undefined })]) {
      expect(hrefs(html)).toContain(`mailto:${CONTACT_EMAIL}`);
      expect(hrefs(html)).toContain(TAKEDOWN_HREF);
      expect(hrefs(html)).toContain(PRIVACY_HREF);
    }
  });

  /* /privacy promises to act without proof; a banner asking for evidence would
     contradict the page it links to. */
  it("does not ask for evidence", () => {
    expect(render().toLowerCase()).not.toMatch(/evidence|prove/);
  });

  /**
   * **The same promise as /privacy and the sharing page, with the same hedge.**
   * tests/public-readable-sharing-page.test.tsx holds those two to each other;
   * this holds the banner to both. The promise rests partly on an account
   * setting, so a banner that dropped the hedge would claim more than either.
   */
  it("makes the no-training claim with the hedge both pages carry", () => {
    const privacy = readFileSync("src/web/PrivacyPage.tsx", "utf8");
    const sharing = readFileSync("src/web/PublicReadableSharingPage.tsx", "utf8");
    for (const phrase of [/nobody trains a model on it/i, /commitment we hold ourselves to/]) {
      expect(BANNER_TRAINING).toMatch(phrase);
      expect(privacy).toMatch(phrase);
      expect(sharing).toMatch(phrase);
    }
  });
});
