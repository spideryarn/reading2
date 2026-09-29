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

const { Masthead } = await import("../src/web/Masthead.js");
const { shelfHrefFor } = await import("../src/web/AuthorNames.js");
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
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));
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
});
