// @vitest-environment jsdom
/**
 * **The authors in the masthead, one at a time** — plan 260929d § 4.
 *
 * What a reader would notice if it broke: the names run together or lose their
 * separators, a visitor is handed a link into a shelf that is not theirs, a
 * twenty-five-author paper fills the header, or an article with no author list
 * stops showing the byline it always showed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Author } from "../src/types.js";

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

/* Metadata's query-state adapter and fixed dock are immaterial to the author
   row. Keep this integration check on the row itself, not their machinery. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Masthead } = await import("../src/web/Masthead.js");
const { Metadata } = await import("../src/web/Metadata.js");
const { authorSearchLinks, shelfHrefFor } = await import("../src/web/AuthorNames.js");
const { filterEntries } = await import("../src/web/shelf-narrow.js");
type LibraryEntry = import("../src/types.js").LibraryEntry;

const SLUG = "a-paper-with-authors";

const FIVE: Author[] = [
  { name: "Samuel A. Nastase", affiliations: ["Princeton Neuroscience Institute, Princeton University"] },
  { name: "Yun-Fei Liu", affiliations: ["Johns Hopkins University"] },
  { name: "Hanna Hillman", affiliations: [] },
  { name: "Asieh Zadbood", affiliations: [] },
  { name: "Uri Hasson", affiliations: [] },
];

function article(meta: Partial<Article["meta"]>): Article {
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
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}`);
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          slug: SLUG,
          dir: "spideryarn.article_revisions/test/",
          stages: [],
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(a: Article, owner: boolean) {
  await act(async () => {
    root.render(createElement(Masthead, { article: a, slug: SLUG, ...(owner ? { onRenamed: () => {} } : {}) }));
  });
}

const facts = () => host.querySelector(".facts") as HTMLElement;
const names = () => [...facts().querySelectorAll(".author-name")].map((el) => el.textContent);

describe("the masthead's authors", () => {
  it("shows the first three names as links to the shelf searched for each, and folds the rest", async () => {
    await mount(article({ byline: FIVE.map((a) => a.name).join("; "), authors: FIVE }), true);
    expect(names()).toEqual(["Samuel A. Nastase", "Yun-Fei Liu", "Hanna Hillman"]);
    const first = facts().querySelector("a.author-name") as HTMLAnchorElement;
    expect(first.getAttribute("href")).toBe("/?q=Samuel%20Nastase");
    expect(facts().textContent).toContain("+ 2 more");
    /* The byline string itself is not also printed. */
    expect(facts().textContent).not.toContain("Nastase; ");
  });

  it("unfolds every name in place when asked", async () => {
    await mount(article({ byline: "x", authors: FIVE }), true);
    const more = [...facts().querySelectorAll("button")].find((b) => b.textContent?.includes("more")) as HTMLButtonElement;
    expect(more.getAttribute("aria-label")).toBe("Show 2 more authors");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.focus();
    await act(async () => more.click());
    expect(names()).toEqual(FIVE.map((a) => a.name));
    expect(more.textContent).toBe("Show fewer");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(more);
  });

  it("does not fold a list only one name longer than the fold — '+ 1 more' saves nothing", async () => {
    await mount(article({ byline: "x", authors: FIVE.slice(0, 4) }), true);
    expect(names()).toHaveLength(4);
  });

  it("gives a visitor the names and their cards but no link into a shelf that is not theirs", async () => {
    await mount(article({ byline: "x", authors: FIVE }), false);
    expect(facts().querySelectorAll("a.author-name")).toHaveLength(0);
    const first = facts().querySelector(".author-name") as HTMLElement;
    expect(first.tabIndex).toBe(0);
  });

  it("keeps the line's separators between its own items only, not between names", async () => {
    await mount(article({ byline: "x", authors: FIVE, siteName: "Nature" }), true);
    const items = [...facts().children].map((el) => el.tagName);
    /* authors · site · words · min · parts · sections */
    expect(items).toEqual(["SPAN", "SPAN", "SPAN", "SPAN", "SPAN", "SPAN"]);
    /* jsdom applies no stylesheet, so the separator rule is read from the file:
       a descendant `.facts span + span` would put a dot before every name. */
    const css = readFileSync(path.join(process.cwd(), "src/web/styles/shell.css"), "utf8");
    expect(css).toContain(".facts > span + span::before");
    expect(css).not.toMatch(/\.facts span \+ span/);
  });

  it("shows the byline string exactly as before when there is no author list", async () => {
    await mount(article({ byline: "By Jane Doe and John Roe" }), true);
    expect(facts().querySelector(".author-names")).toBeNull();
    expect(facts().firstElementChild?.textContent).toBe("By Jane Doe and John Roe");
  });

  it("links to a shelf search that finds the same author however another card spells them", () => {
    const entry = (slug: string, byline: string) => ({ slug, title: slug, byline }) as unknown as LibraryEntry;
    const shelf = [
      entry("as-written", "Samuel A. Nastase; Uri Hasson"),
      entry("no-stop", "Samuel A Nastase"),
      entry("surname-first", "Nastase, Samuel A."),
      entry("someone-else", "Samuel Beckett"),
    ];
    const q = (name: string) => new URL(shelfHrefFor(name), "https://x").searchParams.get("q") ?? "";
    expect(filterEntries(shelf, q("Samuel A. Nastase")).map((e) => e.slug)).toEqual(["as-written", "no-stop", "surname-first"]);
    expect(filterEntries([entry("spaced", "Yun Fei Liu")], q("Yun-Fei Liu"))).toHaveLength(1);
  });

  it("opens a card with the author's affiliations when the name is focused", async () => {
    await mount(article({ byline: "x", authors: FIVE }), true);
    const first = facts().querySelector("a.author-name") as HTMLElement;
    await act(async () => {
      first.focus();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.body.textContent).toContain("Princeton Neuroscience Institute, Princeton University");
    expect(document.body.textContent).toContain("Click for everything on your shelf by Samuel A. Nastase.");
  });

  /* Plan 261003f: Greg's "something I could click on … that would take me to
     the top few links for them" (spya-uvxq8e). The card is now one the pointer
     and the keyboard can enter, and its two links leave the site without
     telling Google which article the reader is in. */
  it("puts two outside searches in the card, which is a named dialog the keyboard can reach", async () => {
    await mount(article({ byline: "x", authors: FIVE }), true);
    const first = facts().querySelector("a.author-name") as HTMLAnchorElement;
    await act(async () => {
      first.focus();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(first.getAttribute("aria-haspopup")).toBe("dialog");
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("About Samuel A. Nastase");
    const out = [...dialog.querySelectorAll<HTMLAnchorElement>('[data-testid="author-out"] a')];
    expect(out.map((a) => a.textContent)).toEqual(["Google Scholar", "Web search"]);
    for (const a of out) {
      expect(a.target).toBe("_blank");
      expect(a.rel.split(" ")).toContain("noreferrer");
      expect(a.rel.split(" ")).toContain("noopener");
      /* No global link rule: without an explicit house colour these fall back
         to the browser's dark blue, on both the dark card and Metadata page. */
      expect(a.className).toContain("tw:text-highlight-text");
      expect(a.className).toContain("tw:underline");
    }
    /* Tab from the name lands on the card's links: the guard after the
       trigger hands focus into the card (tests/tooltip-interactive.test.tsx
       says why it is pressed this way in jsdom). The shelf link stays the name. */
    const guard = first.parentElement?.querySelector('[data-type="outside"]') as HTMLElement;
    await act(async () => {
      guard.focus();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(first);
    expect(first.getAttribute("href")).toBe("/?q=Samuel%20Nastase");
  });

  it("still follows the shelf link when touch hover opens the interactive card before click", async () => {
    vi.stubGlobal("scrollTo", vi.fn());
    await mount(article({ byline: "x", authors: FIVE }), true);
    const first = facts().querySelector("a.author-name") as HTMLAnchorElement;
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    await act(async () => {
      first.dispatchEvent(down);
      first.dispatchEvent(new MouseEvent("mouseenter"));
      first.click();
    });
    expect(location.pathname + location.search).toBe("/?q=Samuel%20Nastase");
  });
});

describe("authorSearchLinks", () => {
  const q = (url: string) => new URL(url).searchParams.get("q");

  it("searches Scholar by author, and the web by name and first affiliation", () => {
    const links = authorSearchLinks({ name: "Samuel A. Nastase", affiliations: ["Princeton University", "Elsewhere"] });
    expect(links.scholar.startsWith("https://scholar.google.com/scholar?q=")).toBe(true);
    expect(q(links.scholar)).toBe('author:"Samuel A. Nastase"');
    expect(links.web.startsWith("https://www.google.com/search?q=")).toBe(true);
    expect(q(links.web)).toBe('"Samuel A. Nastase" Princeton University');
  });

  it("searches the name alone when there is no affiliation", () => {
    expect(q(authorSearchLinks({ name: "Uri Hasson", affiliations: [] }).web)).toBe('"Uri Hasson"');
  });

  it("takes quote marks out of a name, so they cannot close the quotes around it", () => {
    const links = authorSearchLinks({ name: 'Jane “JJ” "Doe" & Co', affiliations: ['The "Best" Lab'] });
    expect(q(links.scholar)).toBe('author:"Jane JJ Doe & Co"');
    expect(q(links.web)).toBe('"Jane JJ Doe & Co" The Best Lab');
  });

  it("keeps diacritics, and cuts a long affiliation at a word", () => {
    const long = `Département de ${"très longue ".repeat(30)}Université`;
    const hint = q(authorSearchLinks({ name: "Zoë Brontë", affiliations: [long] }).web) ?? "";
    expect(hint.startsWith('"Zoë Brontë" Département de très')).toBe(true);
    const after = hint.slice('"Zoë Brontë" '.length);
    expect([...after].length).toBeLessThanOrEqual(80);
    expect(long.startsWith(after)).toBe(true);
    expect(long.charAt(after.length)).toBe(" ");
  });

  it("counts Unicode code points, hard-cuts a no-space affiliation, and drops trailing punctuation", () => {
    const affiliation = `${"𠮷".repeat(79)}Xmore`;
    const web = q(authorSearchLinks({ name: "Zoë Brontë", affiliations: [`${affiliation},`] }).web) ?? "";
    const hint = web.slice('"Zoë Brontë" '.length);
    expect([...hint]).toHaveLength(80);
    expect(hint).toBe(`${"𠮷".repeat(79)}X`);
    expect(hint).not.toContain("�");

    expect(q(authorSearchLinks({ name: "Ada Lovelace", affiliations: ["Analytical Society, "] }).web)).toBe(
      '"Ada Lovelace" Analytical Society',
    );
  });
});

describe("the Metadata page's authors", () => {
  it("puts the outside searches inline under an author, without needing their card", async () => {
    const a = article({ authors: [FIVE[0]!] });
    await act(async () => {
      root.render(
        createElement(Metadata, {
          slug: SLUG,
          article: a,
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      );
    });
    const authors = host.querySelector('[data-section="Authors"]') as HTMLElement;
    const toggle = authors.querySelector("h2 button") as HTMLButtonElement;
    await act(async () => toggle.click());
    const links = [...authors.querySelectorAll<HTMLAnchorElement>('[data-testid="author-out"] a')];
    expect(links.map((link) => link.textContent)).toEqual(["Google Scholar", "Web search"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
