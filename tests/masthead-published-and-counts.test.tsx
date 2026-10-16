// @vitest-environment jsdom
/**
 * **The masthead says when and where the piece was published, and keeps its
 * counts behind *Show counts*** — Greg, 2026-10-15 (`spya-u7yfns`):
 *
 * > Please include the publication date at the top of the article along with
 * > the other metadata
 * >
 * > And maybe hide some of the less-likely-to-be-useful metadata behind a
 * > default-collapsed section
 *
 * docs/plans/261015c-why-you-are-reading-higher-in-metadata-and-the-publication-date-in-the-masthead.md.
 *
 * What a reader would notice if it broke: no date at the top of a paper that
 * has one; a visitor (whose meta carries `published`, not `publishedAt`) seeing
 * none; or the counts on the line from the start, or never reachable.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

const { Masthead } = await import("../src/web/Masthead.js");

const SLUG = "a-dated-paper";

/* `meta` is loose on purpose: a visitor's article carries a `PublicMeta`
   under the owner's `Meta` type (article/access.ts), which is the case the
   second test exists for. */
function article(meta: Record<string, unknown>): Article {
  return {
    highPowerSince: null,
    titleOverridden: false,
    meta: { slug: SLUG, title: "A paper", ...meta },
    blocks: [
      { id: "spya-aaaaaa", tag: "p", kind: "text", text: "A paragraph.", words: 2, html: "<p>A paragraph.</p>", gistable: true },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A paper" },
      },
    },
  } as Article;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(a: Article, owner: boolean) {
  await act(async () => {
    root.render(createElement(Masthead, { article: a, slug: SLUG, ...(owner ? { onRenamed: () => {} } : {}) }));
  });
}

const facts = () => (host.querySelector(".facts") as HTMLElement).textContent ?? "";
const countsButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".facts button")].find((b) => /counts/i.test(b.textContent ?? ""));

describe("when and where it was published", () => {
  it("prints the journal and the day for an owner", async () => {
    await mount(
      article({
        byline: "Ada Lovelace",
        siteName: "PubMed Central",
        journal: "Nature Reviews Neuroscience",
        publishedAt: "2024-05-31T09:00:00Z",
      }),
      true,
    );
    /* In the order both Metadata pages print them: byline, journal, site,
       date — then the read time. */
    const spans = [...host.querySelectorAll(".facts > span")].map((el) => el.textContent);
    /* The day in the reader's own locale, as metadata-origin.test.tsx reads it. */
    expect(spans.slice(0, 3)).toEqual(["Ada Lovelace", "Nature Reviews Neuroscience", "PubMed Central"]);
    expect(spans[3]).toMatch(/^Published (31 May|May 31),? 2024$/);
    expect(spans[4]).toMatch(/^~\d+ min$/);
  });

  it("prints the journal and the day for a visitor, whose meta says `published`", async () => {
    await mount(article({ journal: "Brain", published: "2024-05-31" }), false);
    expect(facts()).toContain("Brain");
    expect(facts()).toMatch(/Published (31 May|May 31),? 2024/);
  });

  it("does not print the journal twice when the site already says it", async () => {
    await mount(article({ journal: "eLife", siteName: "eLife" }), true);
    expect(facts().match(/eLife/g)).toHaveLength(1);
  });

  it("prints a year alone as a year", async () => {
    await mount(article({ publishedYear: 2011 }), false);
    expect(facts()).toContain("Published 2011");
  });

  it("says nothing about a date it does not have", async () => {
    await mount(article({}), true);
    expect(facts()).not.toContain("Published");
  });
});

describe("the counts, shut until asked for", () => {
  it("keeps words, parts and sections off the line until Show counts is pressed", async () => {
    await mount(article({}), true);
    expect(facts()).not.toMatch(/\bwords\b/);
    expect(facts()).not.toMatch(/\bparts\b/);
    expect(facts()).not.toMatch(/\bsections\b/);
    /* The read time is not a count and stays. */
    expect(facts()).toMatch(/~\d+ min/);

    const button = countsButton();
    expect(button?.textContent).toBe("Show counts");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button?.focus());
    expect(document.querySelector(".tooltip.tip-soon")?.textContent).toContain(
      "The Metadata page has them too.",
    );

    await act(async () => button?.click());
    expect(facts()).toMatch(/2 words/);
    expect(facts()).toMatch(/\d+ parts/);
    expect(facts()).toMatch(/\d+ sections/);
    expect(countsButton()?.textContent).toBe("Hide counts");
    expect(countsButton()?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => countsButton()?.click());
    expect(facts()).not.toMatch(/\bwords\b/);
  });
});
