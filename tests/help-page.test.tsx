// @vitest-environment jsdom
/**
 * Help — src/web/help/. docs/plans/261002b-help-page.md, and for its pages
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md.
 *
 * Two halves. The first is about **links people already have**: every anchor
 * is unique, kebab-case, in exactly one group, and every anchor ever shipped
 * still lands somewhere (`PINNED_ANCHORS`). The second draws Help and drives
 * what only a render can show: the contents page lists every page, every page
 * draws and links only to places that exist, the search box finds what a
 * reader would type, and **arriving** works every way a reader can arrive —
 * a direct load, a move inside the app, Back and Forward, and each of the
 * addresses that were right before Help was pages (`/help#spine`).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import {
  FAQ_IDS,
  HELP_ANCHOR_ALIASES,
  HELP_ANCHORS,
  HELP_GUIDE_IDS,
  HELP_QUESTIONS_HREF,
  HELP_QUESTIONS_PAGE,
  HELP_TOPIC_IDS,
  helpAnchorKind,
  helpHref,
  isFaqId,
  resolveHelpAnchor,
  resolveHelpPage,
  type HelpAnchor,
} from "../src/web/help/help-anchors.js";
import { HELP_GROUPS, HELP_SYNONYMS, helpEntry, helpPlace } from "../src/web/help/help-content.js";
import { HelpPage } from "../src/web/help/HelpPage.js";
import { SignedInShell } from "../src/web/BackLink.js";
import { SignedInReader } from "../src/web/lib/made-for.js";
import { HELP_HREF, navigate, parseRoute } from "../src/web/router.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * **Every anchor Help has ever shipped. Never delete from this list — add an
 * alias instead** (help-anchors.ts § `HELP_ANCHOR_ALIASES`).
 *
 * Hand-written on purpose, never derived from `HELP_ANCHORS`: a list built
 * from the code would follow a rename and pass, which is exactly the silent
 * 404 for every old link this exists to catch. Append each new anchor when
 * its page ships.
 */
const PINNED_ANCHORS = [
  "what-it-is-for",
  "adding-articles",
  "the-reading-view",
  "spine",
  "jumping-around",
  "gutter",
  "linking-to-a-passage",
  "keyboard",
  "touch",
  "ai-words",
  "waiting-and-cost",
  "modes",
  "shelf",
  "sharing",
  "comments",
  "reader-profile",
  "experimental-features",
  "plans",
  "your-data",
  "feedback",
  "whats-new",
  "mode-plain",
  "mode-chat",
  "mode-glossary",
  "mode-search",
  "mode-referee",
  "mode-summary",
  "mode-diagram",
  "mode-ideas",
  "mode-remember",
  "mode-quotes",
  "mode-timeline",
  "mode-debate",
  "mode-structure",
  "mode-citations",
  "mode-faq",
  "mode-skim",
  "mode-tweets",
  "mode-marginalia",
  "faq-is-the-ai-reading-for-me",
  "faq-why-slow-first-time",
  "faq-does-a-mode-use-my-allowance",
  "faq-missing-parts",
  "faq-beyond-the-article",
  "faq-older-profile",
  "faq-find-archived",
  "faq-shared-personalised",
  /* 2026-10-06: Learn's id followed its name. `mode-remember` above is the
     anchor that shipped; it is an alias now (RETIRED_MODES), never deleted. */
  "mode-learn",
  /* 2026-10-07: the four guides, with Help becoming pages (plan 261007e). */
  "first-article",
  "for-students",
  "for-reviewers",
  "for-experts",
  /* 2026-10-09: Citations and Debate became Peer review (plan 261009l).
     `mode-citations` and `mode-debate` above are aliases now (RETIRED_MODES). */
  "mode-peer-review",
];

const LIVE = new Set<string>(HELP_ANCHORS);
/** Every anchor with a page of its own: all but the questions. */
const PAGES = HELP_ANCHORS.filter((a) => !isFaqId(a));

describe("the anchors", () => {
  it("are unique and kebab-case", () => {
    expect(new Set(HELP_ANCHORS).size).toBe(HELP_ANCHORS.length);
    for (const a of HELP_ANCHORS) expect(a, a).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("include a page for every mode, topic and guide, and every question", () => {
    for (const m of MODES) expect(LIVE.has(`mode-${m}`), m).toBe(true);
    for (const t of HELP_TOPIC_IDS) expect(LIVE.has(t), t).toBe(true);
    for (const f of FAQ_IDS) expect(LIVE.has(f), f).toBe(true);
    for (const g of HELP_GUIDE_IDS) expect(LIVE.has(g), g).toBe(true);
  });

  /* `helpAnchorKind` takes whatever is not a topic, a question or a guide for
     a mode, and `resolveHelpPage` reads `questions` before any anchor. Both
     are sound only while the ids keep to their own shapes. */
  it("keep each kind's shape: only a mode starts mode-, only a question faq-, and none is the questions' page", () => {
    for (const a of [...HELP_TOPIC_IDS, ...HELP_GUIDE_IDS]) {
      expect(a.startsWith("mode-") || a.startsWith("faq-"), a).toBe(false);
    }
    expect(LIVE.has(HELP_QUESTIONS_PAGE)).toBe(false);
    expect(Object.hasOwn(HELP_ANCHOR_ALIASES, HELP_QUESTIONS_PAGE)).toBe(false);
    expect(helpAnchorKind("spine")).toEqual({ kind: "topic", id: "spine" });
    expect(helpAnchorKind("mode-skim")).toEqual({ kind: "mode", mode: "skim" });
    expect(helpAnchorKind("faq-older-profile")).toEqual({ kind: "faq", id: "faq-older-profile" });
    expect(helpAnchorKind("for-reviewers")).toEqual({ kind: "guide", id: "for-reviewers" });
  });

  it("each sit in exactly one group, exactly once, and the groups name nothing else", () => {
    const seen = HELP_GROUPS.flatMap((g) => g.anchors);
    expect(new Set(seen).size, "an anchor appears twice").toBe(seen.length);
    expect([...seen].sort()).toEqual([...HELP_ANCHORS].sort());
    /* The questions are the one group that is a page, and they are all in it. */
    expect(HELP_GROUPS.filter((g) => g.together).map((g) => [...g.anchors])).toEqual([[...FAQ_IDS]]);
  });

  it("put the guides second, under Ways to read", () => {
    expect(HELP_GROUPS.map((g) => g.title)).toEqual([
      "Start here",
      "Ways to read",
      "Reading an article",
      "The modes",
      "Your shelf and your account",
      "Questions people ask",
    ]);
    expect(HELP_GROUPS[1]?.anchors).toEqual(HELP_GUIDE_IDS);
  });

  it("include every anchor ever shipped, live or redirected, and pin every live anchor", () => {
    for (const a of PINNED_ANCHORS) {
      const isLive = LIVE.has(a);
      const isAlias = Object.hasOwn(HELP_ANCHOR_ALIASES, a);
      expect(isLive || isAlias, `${a} no longer lands anywhere — add an alias, never delete`).toBe(true);
      expect(resolveHelpAnchor(a), a).not.toBeNull();
      /* And as an address, old or new, it shows a page: never `missing`. */
      expect(resolveHelpPage(a).kind, `/help/${a}`).not.toBe("missing");
    }
    for (const a of HELP_ANCHORS) {
      expect(PINNED_ANCHORS, `${a} is live but not pinned — append it before shipping`).toContain(a);
    }
  });

  it("redirect only to live pages", () => {
    expect(Object.keys(HELP_ANCHOR_ALIASES).length).toBeGreaterThan(0);
    for (const [old, to] of Object.entries(HELP_ANCHOR_ALIASES)) {
      expect(LIVE.has(to), `${old} → ${to}`).toBe(true);
      expect(LIVE.has(old), `${old} is live and an alias at once`).toBe(false);
    }
  });

  it("carry a retired mode to the mode that took its place", () => {
    expect(resolveHelpAnchor("#mode-trajectory")).toBe("mode-skim");
    expect(resolveHelpAnchor("mode-outline")).toBe("mode-structure");
  });

  it("resolve with or without the #, encoded or not, and refuse anything else", () => {
    expect(resolveHelpAnchor("#spine")).toBe("spine");
    expect(resolveHelpAnchor("spine")).toBe("spine");
    expect(resolveHelpAnchor("#mode%2Dskim")).toBe("mode-skim");
    expect(resolveHelpAnchor("#nonsense")).toBeNull();
    expect(resolveHelpAnchor("#%E0%A4%A")).toBeNull();
    expect(resolveHelpAnchor("#toString")).toBeNull();
  });

  /* The plan's table, § One file per anchor. */
  it("build a page's address for everything but a question, which is a place on the questions' page", () => {
    expect(helpHref("spine")).toBe("/help/spine");
    expect(helpHref("mode-glossary")).toBe("/help/mode-glossary");
    expect(helpHref("for-reviewers")).toBe("/help/for-reviewers");
    expect(helpHref("faq-older-profile")).toBe("/help/questions#faq-older-profile");
    expect(HELP_QUESTIONS_HREF).toBe("/help/questions");
    /* Every one is an address the router gives to Help. */
    for (const a of HELP_ANCHORS) {
      const path = helpHref(a).split("#")[0] ?? "";
      expect(parseRoute(path), a).toEqual({ kind: "help", page: isFaqId(a) ? HELP_QUESTIONS_PAGE : a });
    }
  });
});

describe("what an address under /help shows", () => {
  it("is the contents for none, a page for a live anchor, and the questions together", () => {
    expect(resolveHelpPage(undefined)).toEqual({ kind: "contents" });
    expect(resolveHelpPage("spine")).toEqual({ kind: "page", anchor: "spine" });
    expect(resolveHelpPage("mode-skim")).toEqual({ kind: "page", anchor: "mode-skim" });
    expect(resolveHelpPage("for-experts")).toEqual({ kind: "page", anchor: "for-experts" });
    expect(resolveHelpPage("questions")).toEqual({ kind: "questions" });
  });

  it("is moved for a retired mode's page and for a question asked for as a page", () => {
    expect(resolveHelpPage("mode-trajectory")).toEqual({ kind: "moved", to: "mode-skim" });
    expect(resolveHelpPage("mode-remember")).toEqual({ kind: "moved", to: "mode-learn" });
    expect(resolveHelpPage("faq-older-profile")).toEqual({ kind: "moved", to: "faq-older-profile" });
  });

  it("is missing for anything else, a property of Object included", () => {
    for (const page of ["nonsense", "", "toString", "Spine", "spine/x", "%E0%A4%A"]) {
      expect(resolveHelpPage(page), page).toEqual({ kind: "missing" });
    }
  });
});

describe("a page's place", () => {
  it("is its group, with the pages either side of it there and nothing past the group's ends", () => {
    expect(helpPlace("spine")).toMatchObject({ group: { id: "reading" }, previous: null, next: "jumping-around" });
    expect(helpPlace("jumping-around")).toMatchObject({ previous: "spine", next: "gutter" });
    expect(helpPlace("waiting-and-cost")).toMatchObject({ previous: "ai-words", next: null });
    expect(helpPlace("modes")).toMatchObject({ group: { id: "modes" }, previous: null, next: `mode-${MODES[0]}` });
    /* The questions are one page, so none has a neighbour. */
    expect(helpPlace("faq-older-profile")).toMatchObject({ group: { id: "questions" }, previous: null, next: null });
  });
});

describe("See also", () => {
  it("names only live pages, never the page itself, and nothing twice", () => {
    for (const a of HELP_ANCHORS) {
      const { related } = helpEntry(a);
      expect(new Set(related).size, a).toBe(related.length);
      expect(related, a).not.toContain(a);
      for (const r of related) expect(LIVE.has(r), `${a} → ${r}`).toBe(true);
    }
  });

  it("always ends a mode's with Which mode when", () => {
    for (const m of MODES) expect(helpEntry(`mode-${m}`).related.at(-1), m).toBe("modes");
  });

  it("is written for every topic and every guide", () => {
    for (const a of [...HELP_TOPIC_IDS, ...HELP_GUIDE_IDS]) expect(helpEntry(a).related.length, a).toBeGreaterThan(1);
  });
});

describe("the synonym table", () => {
  it("puts each word in one group only", () => {
    const words = HELP_SYNONYMS.flat();
    expect(new Set(words).size).toBe(words.length);
  });
});

let host: HTMLDivElement;
let root: Root;
/** Every element the page scrolled to, in order. */
let scrolled: Element[];
/** How many times the window was sent to the top, which is what `navigate` does. */
let tops: number;
const realScrollTo = window.scrollTo;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  scrolled = [];
  tops = 0;
  /* jsdom has no `scrollIntoView`; the page optional-calls it. Recording the
     element it was called on is how these tests see where the page went. */
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  window.scrollTo = (() => {
    tops += 1;
  }) as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  history.replaceState(null, "", "/");
  vi.useRealTimers();
  window.scrollTo = realScrollTo;
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function mountAt(address: string): void {
  history.replaceState(null, "", address);
  act(() => root.render(<HelpPage />));
}

function mountForReader(readerId: string): void {
  act(() =>
    root.render(
      <SignedInReader.Provider value={readerId}>
        <SignedInShell.Provider value={true}>
          <HelpPage />
        </SignedInShell.Provider>
      </SignedInReader.Provider>,
    ),
  );
}

const address = (): string => location.pathname + location.search + location.hash;
const h1 = (): string => host.querySelector("h1")?.textContent ?? "";
const words = (): string => host.querySelector("article")?.textContent ?? "";
const searchBox = () => host.querySelector<HTMLInputElement>('input[type="search"]');
const link = (within: string, href: string) =>
  host.querySelector<HTMLAnchorElement>(`${within} a[href="${href}"]`);

/** An ordinary press on a link, and whether the page kept it from the browser. */
function press(a: HTMLAnchorElement | null): MouseEvent {
  if (!a) throw new Error("no such link");
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  act(() => {
    a.dispatchEvent(click);
  });
  return click;
}

/** Type into the controlled box the way React hears it. */
function type(q: string): void {
  const box = searchBox();
  if (!box) throw new Error("no search box");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(box, q);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const resultHrefs = () =>
  [...host.querySelectorAll('ul[aria-label="Search results"] a')].map((a) => a.getAttribute("href"));

/** Back or Forward to `to`, as the browser reports it: the address has changed, then the event. */
function traverse(to: string): void {
  const hashOnly = to.split("#")[0] === location.pathname;
  act(() => {
    history.replaceState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
    if (hashOnly) window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("the contents page", () => {
  it("shows a new reader none of the previous reader's question", () => {
    history.replaceState(null, "", "/help");
    mountForReader("reader-a");
    const question = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Ask a question about Spideryarn"]',
    );
    if (!question) throw new Error("no Help question box");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(question, "A's private question");
      question.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(question.value).toBe("A's private question");

    mountForReader("reader-b");
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Ask a question about Spideryarn"]',
      )?.value,
    ).toBe("");
  });

  it("is headed Help, keeps the title the server pre-renders, and has the search box", () => {
    mountAt("/help");
    expect(h1()).toBe("Help");
    expect(document.title).toBe("Help · Spideryarn");
    expect(searchBox()).not.toBeNull();
    expect(host.querySelector("aside")).toBeNull();
  });

  it("lists every page and every question under its group, each at its own address", () => {
    mountAt("/help");
    const nav = host.querySelector('nav[aria-label="Help contents"]');
    const sections = [...(nav?.querySelectorAll("section") ?? [])];
    expect(sections.map((s) => s.querySelector("h2")?.textContent)).toEqual(HELP_GROUPS.map((g) => g.title));
    for (const [i, group] of HELP_GROUPS.entries()) {
      const rows = [...(sections[i]?.querySelectorAll("li a") ?? [])];
      expect(rows.map((a) => a.getAttribute("href")), group.id).toEqual(group.anchors.map(helpHref));
      expect(rows.map((a) => a.textContent), group.id).toEqual(group.anchors.map((a) => helpEntry(a).title));
    }
    /* The questions' heading is the way to their page as a whole. */
    expect(link('nav[aria-label="Help contents"] h2', HELP_QUESTIONS_HREF)).not.toBeNull();
  });

  it("says a line about every page: a topic's or a guide's own, a mode's from the catalog, and none for a question", () => {
    mountAt("/help");
    const rowOf = (a: HelpAnchor) => link('nav[aria-label="Help contents"] li', helpHref(a))?.closest("li");
    expect(rowOf("spine")?.querySelector("p")?.textContent).toBe(helpEntry("spine").summary);
    expect(rowOf("for-reviewers")?.querySelector("p")?.textContent).toMatch(/^For a peer reviewer/);
    for (const m of MODES) {
      const row = rowOf(`mode-${m}`);
      expect(row?.querySelector("p")?.textContent, m).toBe(`${MODE_CATALOG[m].description}.`);
      expect(row?.textContent?.includes("Experimental"), m).toBe(MODE_CATALOG[m].experimental);
    }
    for (const f of FAQ_IDS) expect(rowOf(f)?.querySelector("p"), f).toBeNull();
    for (const a of PAGES) expect(helpEntry(a).summary, a).toMatch(/\.$/);
    // The control: without one experimental mode the tag's line proves nothing.
    expect(MODES.some((m) => MODE_CATALOG[m].experimental)).toBe(true);
  });
});

describe("a page", () => {
  it("draws for every anchor that has one: its title as the heading and in the tab, and its words", () => {
    for (const a of PAGES) {
      mountAt(helpHref(a));
      const { title } = helpEntry(a);
      expect(host.querySelectorAll("h1"), a).toHaveLength(1);
      expect(host.querySelector("h1 > span")?.textContent, a).toBe(title);
      expect(document.title, a).toBe(`${title} · Help · Spideryarn`);
      expect(host.querySelector("article div")?.textContent?.length ?? 0, a).toBeGreaterThan(80);
      expect(address(), a).toBe(helpHref(a));
    }
  });

  it("marks itself, and only itself, in the contents beside it", () => {
    for (const a of ["spine", "mode-glossary", "for-students"] as const) {
      mountAt(helpHref(a));
      const nav = host.querySelector('nav[aria-label="Help contents"]');
      const hrefs = [...(nav?.querySelectorAll("li a") ?? [])].map((x) => x.getAttribute("href"));
      expect(hrefs, a).toEqual(HELP_GROUPS.flatMap((g) => g.anchors).map(helpHref));
      const current = [...(nav?.querySelectorAll('[aria-current="page"]') ?? [])];
      expect(current.map((x) => x.getAttribute("href")), a).toEqual([helpHref(a)]);
    }
  });

  it("has the contents twice, folded for a narrow window and open for a wide one, and the search box once", () => {
    mountAt("/help/spine");
    expect(host.querySelector("aside details nav, aside details a")).not.toBeNull();
    expect(host.querySelector("aside details")?.hasAttribute("open")).toBe(false);
    expect(host.querySelectorAll('aside input[type="search"]')).toHaveLength(1);
  });

  it("has a way back to the contents, and says which part of Help it is in", () => {
    mountAt("/help/spine");
    const crumb = host.querySelector('nav[aria-label="Breadcrumb"]');
    expect(crumb?.querySelector("a")?.getAttribute("href")).toBe(HELP_HREF);
    expect(crumb?.textContent).toContain("Reading an article");
    press(crumb?.querySelector("a") ?? null);
    expect(address()).toBe("/help");
    expect(h1()).toBe("Help");
  });

  it("opens every mode's page with its In short and a picture, before How it works and the catalog's sentences", () => {
    for (const m of MODES) {
      mountAt(helpHref(`mode-${m}`));
      const article = host.querySelector("article");
      /* The page's own blocks, in order, after its title. */
      const blocks = [...(article?.querySelectorAll("p, figure, h2") ?? [])].filter((el) => !el.closest("figure") || el.tagName === "FIGURE");
      const first = blocks[0];
      expect(first?.tagName, m).toBe("P");
      expect(first?.textContent?.length ?? 0, m).toBeGreaterThan(80);
      expect(first?.textContent, m).not.toContain(`${MODE_CATALOG[m].description}.`);
      const figure = blocks.findIndex((el) => el.tagName === "FIGURE");
      const how = blocks.findIndex((el) => el.tagName === "H2" && el.textContent === "How it works");
      const description = blocks.findIndex((el) => el.textContent === `${MODE_CATALOG[m].description}.`);
      expect(figure, m).toBeGreaterThan(0);
      expect(how, m).toBeGreaterThan(figure);
      expect(description, m).toBe(how + 1);
      /* Nothing but the opening between the title and the picture. */
      expect(blocks.slice(0, figure).every((el) => el.tagName === "P"), m).toBe(true);
    }
  });

  it("draws a mode's catalog sentences, its sections and its Experimental tag", () => {
    for (const m of MODES) {
      mountAt(helpHref(`mode-${m}`));
      expect(host.querySelector("h1 > span")?.textContent, m).toBe(MODE_LABEL[m]);
      expect(words(), m).toContain(`${MODE_CATALOG[m].description}.`);
      expect(words(), m).toContain(MODE_CATALOG[m].how);
      const tag = link("h1", helpHref("experimental-features"));
      expect(tag !== null, m).toBe(MODE_CATALOG[m].experimental);
      if (tag) expect(tag.textContent).toBe("Experimental");
    }
    mountAt("/help/mode-chat");
    expect([...host.querySelectorAll("article h2")].map((h) => h.textContent)).toEqual([
      "How it works",
      "When to use it",
      "Reading it",
      "See also",
    ]);
  });

  it("describes Quotes without promising scores or a reason that a row may not have", () => {
    mountAt("/help/mode-quotes");
    expect(words()).toMatch(/every available score under prioritised/i);
    expect(words()).toMatch(/when it has one/i);
    expect(words()).toMatch(/when the AI gave one/i);
  });

  it("does not attribute every quote to the article's author", () => {
    mountAt("/help/mode-quotes");
    expect(words().length).toBeGreaterThan(200);
    expect(words()).not.toMatch(/author put best/i);
    const article = host.querySelector("article");
    const opening = [...(article?.children ?? [])]
      .slice(0, [...(article?.children ?? [])].findIndex((el) => el.textContent === "How it works"))
      .map((el) => el.textContent)
      .join(" ");
    /* The opening may say the words are the article's, never the author's:
       a quotation the article left unmarked is in it too (the catalog's
       `how`, drawn just below it, says so). */
    expect(opening.length).toBeGreaterThan(80);
    expect(opening).not.toMatch(/author/i);

    mountAt("/help/mode-skim");
    expect(words()).not.toMatch(/author’s sentence/i);
    mountAt("/help/mode-summary");
    expect(words()).not.toMatch(/what the author actually wrote/i);
  });

  it("names every reason Glossary can replace a list", () => {
    mountAt("/help/mode-glossary");
    expect(words()).toMatch(/cannot safely add.*article.*profile.*version of Spideryarn/is);
  });

  it("lists every mode in the Which mode when table, linked to its page", () => {
    mountAt("/help/modes");
    const rows = [...host.querySelectorAll("article tbody tr")];
    expect(rows.map((r) => r.querySelector("a")?.getAttribute("href"))).toEqual(MODES.map((m) => `/help/mode-${m}`));
    for (const [i, m] of MODES.entries()) {
      expect(rows[i]?.textContent?.includes("experimental"), m).toBe(MODE_CATALOG[m].experimental);
    }
  });

  it("offers See also from the file, and Which mode when at the end of every mode's", () => {
    const seeAlso = () => {
      const heading = [...host.querySelectorAll("article h2")].find((h) => h.textContent === "See also");
      return [...(heading?.parentElement?.querySelectorAll("li a") ?? [])].map((a) => [a.getAttribute("href"), a.textContent]);
    };
    mountAt("/help/spine");
    expect(seeAlso()).toEqual(helpEntry("spine").related.map((a) => [helpHref(a), helpEntry(a).title]));
    expect(seeAlso().length).toBeGreaterThan(1);
    for (const m of MODES) {
      mountAt(helpHref(`mode-${m}`));
      expect(seeAlso().at(-1), m).toEqual(["/help/modes", helpEntry("modes").title]);
    }
  });

  it("offers the pages before and after it in its group, and neither past the group's end", () => {
    const steps = () => {
      const nav = host.querySelector('nav[aria-label="Previous and next page"]');
      return {
        prev: nav?.querySelector('a[rel="prev"]')?.getAttribute("href") ?? null,
        next: nav?.querySelector('a[rel="next"]')?.getAttribute("href") ?? null,
      };
    };
    mountAt("/help/jumping-around");
    expect(steps()).toEqual({ prev: "/help/spine", next: "/help/gutter" });
    expect(host.querySelector('a[rel="next"]')?.textContent).toContain(helpEntry("gutter").title);
    mountAt("/help/spine");
    expect(steps()).toEqual({ prev: null, next: "/help/jumping-around" });
    mountAt("/help/waiting-and-cost");
    expect(steps()).toEqual({ prev: "/help/ai-words", next: null });
    mountAt("/help/questions");
    expect(host.querySelector('nav[aria-label="Previous and next page"]')).toBeNull();
  });
});

describe("the questions' page", () => {
  it("draws every question as a section under its own id, with a link to itself", () => {
    mountAt("/help/questions");
    expect(h1()).toBe("Questions people ask");
    expect(document.title).toBe("Questions people ask · Help · Spideryarn");
    for (const f of FAQ_IDS) {
      const section = host.querySelector(`article section[data-section][id="${f}"]`);
      expect(section, f).not.toBeNull();
      const title = section?.querySelector("h2 > span")?.textContent;
      expect(title, f).toBe(helpEntry(f).title);
      const self = section?.querySelector(`h2 a[href="${helpHref(f)}"]`);
      expect(self?.getAttribute("aria-label"), f).toBe(`Link to ${title}`);
      expect(section?.querySelector("div")?.textContent?.length ?? 0, f).toBeGreaterThan(40);
    }
  });

  it("marks the questions' heading in the contents, and no one question", () => {
    mountAt("/help/questions");
    const current = [...host.querySelectorAll('nav[aria-label="Help contents"] [aria-current="page"]')];
    expect(current.map((a) => a.getAttribute("href"))).toEqual([HELP_QUESTIONS_HREF]);
  });
});

/* The Markdown is checked link by link when it is drawn (help-markdown.tsx §
   targetOf), but the Experimental tag, the contents, See also and the steps
   are built here, and a path is only good if the router knows it. This is the
   check that covers all of it, on what the reader is actually given. */
describe("every link Help draws", () => {
  const HELP_ADDRESSES = new Set<string>([HELP_HREF, HELP_QUESTIONS_HREF, ...HELP_ANCHORS.map(helpHref)]);

  it("lands on a live page of Help or on a page the router knows", () => {
    let seen = 0;
    let inWords = 0;
    for (const at of [HELP_HREF, HELP_QUESTIONS_HREF, ...PAGES.map(helpHref), "/help/nonsense"]) {
      mountAt(at);
      /* The footer and the Home link are the site's, with their own tests. */
      const links = [...host.querySelectorAll<HTMLAnchorElement>("main a[href]")].filter(
        (a) => !a.closest("footer") && a.getAttribute("href") !== "/",
      );
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        seen += 1;
        if (a.closest("article div")) inWords += 1;
        expect(href, `${at}: “${a.textContent}”`).toMatch(/^\/[^/]/);
        if (href === HELP_HREF || href.startsWith(`${HELP_HREF}/`)) {
          expect(HELP_ADDRESSES.has(href), `${at}: “${a.textContent}” → ${href}`).toBe(true);
        } else {
          const path = href.split(/[?#]/)[0] ?? "";
          expect(parseRoute(path).kind, `${at}: “${a.textContent}” → ${href}`).not.toBe("not-found");
        }
      }
    }
    // The controls: the pages do cross-refer, so an empty walk proves nothing.
    expect(seen).toBeGreaterThan(2000);
    expect(inWords).toBeGreaterThan(60);
  });
});

describe("the search box", () => {
  it("never uses type below 16px on a touch screen", () => {
    for (const at of ["/help", "/help/spine"]) {
      mountAt(at);
      /* This field has a Tailwind font-size utility, so the app-layer input
         floor cannot win. `text-base` alone would still be under 16px for a
         reader whose root type is smaller than the browser default. */
      expect(searchBox()?.classList.contains("tw:any-pointer-coarse:text-[max(1rem,16px)]"), at).toBe(true);
    }
  });

  it("finds what a reader would type, from the contents page and from a page", () => {
    for (const at of ["/help", "/help/keyboard"]) {
      mountAt(at);
      for (const [q, want] of [
        ["heat", "/help/spine"],
        ["price", "/help/plans"],
        ["skim", "/help/mode-skim"],
        ["sidebar", "/help/spine"],
        ["ipad", "/help/touch"],
        ["where did my article go", "/help/questions#faq-find-archived"],
        ["how long does a mode take", "/help/questions#faq-why-slow-first-time"],
        ["can a visitor see my comments", "/help/sharing"],
        ["reviewer", "/help/for-reviewers"],
        ["student", "/help/for-students"],
      ] as const) {
        type(q);
        expect(resultHrefs()[0], `${at}: ${q}`).toBe(want);
      }
    }
  });

  /* While Help was one page a remembered phrase could be found with the
     browser's Find. It cannot see a page that is not open, so the search
     reads the words. GPT Sol, plan review of 261007e, R4. */
  it("finds a page by words that are only in its text, below the pages named for them", () => {
    mountAt("/help");
    type("fills half the piece");
    expect(resultHrefs()).toEqual(["/help/spine"]);
    /* A mode's second catalog sentence is on its page and in no file. */
    type(MODE_CATALOG.glossary.how);
    expect(resultHrefs()).toContain("/help/mode-glossary");
    /* Named for it first; then the pages that only mention it. */
    type("spine");
    expect(resultHrefs()[0]).toBe("/help/spine");
    expect(resultHrefs().length).toBeGreaterThan(3);
    expect(resultHrefs()).toContain("/help/mode-search");
  });

  it("replaces the contents while there is a query, and gives them back after", () => {
    for (const at of ["/help", "/help/spine"]) {
      mountAt(at);
      type("heat");
      expect(host.querySelector('nav[aria-label="Help contents"]'), at).toBeNull();
      type("");
      expect(host.querySelector('nav[aria-label="Help contents"]'), at).not.toBeNull();
    }
  });

  it("says so when nothing matches, and no longer sends the reader to the browser's Find", () => {
    mountAt("/help");
    type("zebra");
    expect(resultHrefs()).toEqual([]);
    const said = host.querySelector('[role="status"]')?.textContent ?? "";
    expect(said).toContain("Nothing in Help matches “zebra”");
    expect(said).not.toMatch(/Find|Ctrl|⌘/);
    expect(host.querySelector('[role="status"]')?.className).not.toContain("sr-only");
  });

  it("goes to the best match on Enter, and empties the box so the page is not left under the matches", () => {
    mountAt("/help");
    const before = history.length;
    type("heat");
    act(() => {
      searchBox()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(address()).toBe("/help/spine");
    expect(history.length).toBe(before + 1);
    expect(host.querySelector("h1 > span")?.textContent).toBe(helpEntry("spine").title);
    expect(searchBox()?.value).toBe("");
    expect(tops).toBe(1);
  });

  it("goes to a match that is pressed, and empties the box; a ⌘-press leaves both alone", () => {
    mountAt("/help/keyboard");
    type("heat");
    const row = link('ul[aria-label="Search results"]', "/help/spine");
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
    act(() => {
      row?.dispatchEvent(modified);
    });
    expect(modified.defaultPrevented).toBe(false);
    expect(address()).toBe("/help/keyboard");
    expect(searchBox()?.value).toBe("heat");
    press(row);
    expect(address()).toBe("/help/spine");
    expect(searchBox()?.value).toBe("");
    expect(link('nav[aria-label="Help contents"]', "/help/spine")?.getAttribute("aria-current")).toBe("page");
  });

  /* A reader typing Japanese or Chinese presses Enter to accept a candidate
     and Escape to dismiss the list; neither is a press on this box. Both
     spellings of "composing" (key-chord.ts § `isImeComposing`). Plan
     261007a-ui-sweep-k2. */
  it.each([
    ["isComposing", { isComposing: true }],
    ["keyCode 229", { keyCode: 229 } as KeyboardEventInit],
  ])("goes nowhere and clears nothing while an input method is composing (%s)", (_how, init) => {
    mountAt("/help");
    type("heat");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
    const escapeKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
    const heard: string[] = [];
    const watch = (e: Event) => heard.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", watch);
    try {
      act(() => {
        searchBox()?.dispatchEvent(enter);
        searchBox()?.dispatchEvent(escapeKey);
      });
    } finally {
      document.removeEventListener("keydown", watch);
    }
    expect(heard).toEqual(["Enter"]);
    expect(address()).toBe("/help");
    expect(tops).toBe(0);
    expect(searchBox()?.value).toBe("heat");
    expect(enter.defaultPrevented).toBe(false);
    /* Cancelled, because a `type="search"` box is emptied by the browser itself
       on Escape; jsdom has no such default, so this flag is all it can show. */
    expect(escapeKey.defaultPrevented).toBe(true);
  });

  it("and an ordinary Escape still clears the box", () => {
    mountAt("/help");
    type("heat");
    act(() => {
      searchBox()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(searchBox()?.value).toBe("");
  });
});

describe("arriving", () => {
  describe("at an address that was right before Help was pages", () => {
    /* Replaced, never pushed: the reader asked for one place, and Back should
       not visit its old name. `history.length` is how a push would show. */
    it.each([
      ["/help#spine", "/help/spine", "Reading the spine"],
      ["/help#mode-glossary", "/help/mode-glossary", MODE_LABEL.glossary],
      ["/help#mode-trajectory", "/help/mode-skim", MODE_LABEL.skim],
      ["/help/mode-trajectory", "/help/mode-skim", MODE_LABEL.skim],
      ["/help/mode-remember", "/help/mode-learn", MODE_LABEL.learn],
      ["/help/#spine", "/help/spine", "Reading the spine"],
    ])("%s becomes %s, in place", (old, now, title) => {
      history.replaceState(null, "", old);
      const before = history.length;
      act(() => root.render(<HelpPage />));
      expect(address()).toBe(now);
      expect(history.length).toBe(before);
      expect(host.querySelector("h1 > span")?.textContent).toBe(title);
      expect(document.title).toBe(`${title} · Help · Spideryarn`);
      expect(scrolled).toEqual([]);
    });

    it.each([["/help#faq-older-profile"], ["/help/faq-older-profile"]])(
      "%s becomes its place on the questions' page, scrolled to and flashed",
      (old) => {
        vi.useFakeTimers();
        history.replaceState(null, "", old);
        const before = history.length;
        act(() => root.render(<HelpPage />));
        expect(address()).toBe("/help/questions#faq-older-profile");
        expect(history.length).toBe(before);
        expect(h1()).toBe("Questions people ask");
        expect(scrolled.map((el) => el.id)).toEqual(["faq-older-profile"]);
        act(() => vi.advanceTimersByTime(200));
        expect(host.querySelector("#faq-older-profile")?.className).toMatch(/element-flash/);
      },
    );

  });

  describe("at an address that names nothing", () => {
    it("says there is no such page, above the contents, and leaves the address alone", () => {
      mountAt("/help/nonsense");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("There is no Help page at this address");
      expect(h1()).toBe("Help");
      expect(document.title).toBe("Not found · Help · Spideryarn");
      expect(address()).toBe("/help/nonsense");
      /* The contents, whole, are what it is given instead. */
      const rows = [...host.querySelectorAll('nav[aria-label="Help contents"] li a')];
      expect(rows.map((a) => a.getAttribute("href"))).toEqual(HELP_GROUPS.flatMap((g) => g.anchors).map(helpHref));
      const alert = host.querySelector('[role="alert"]') as Element;
      const heading = host.querySelector("h1") as Element;
      expect(alert.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("does nothing for a fragment that names nothing, on the contents or on a page", () => {
      for (const at of ["/help#nonsense", "/help/spine#nonsense", "/help/questions#nonsense", "/help/spine#faq-older-profile"]) {
        mountAt(at);
        expect(address(), at).toBe(at);
        expect(scrolled, at).toEqual([]);
        expect(host.querySelector('[role="alert"]'), at).toBeNull();
      }
    });
  });

  describe("by a direct load of a question", () => {
    it("scrolls to it, and flashes it once settled", () => {
      vi.useFakeTimers();
      mountAt("/help/questions#faq-missing-parts");
      expect(scrolled.map((el) => el.id)).toEqual(["faq-missing-parts"]);
      expect(tops).toBe(0);
      act(() => vi.advanceTimersByTime(200));
      expect(host.querySelector("#faq-missing-parts")?.className).toMatch(/element-flash/);
    });
  });

  /* The page is not remounted between Help pages (App.tsx gives them one
     `routeKey`), and the router's `pushState` fires no `hashchange`. So an
     arrival that ran only on mount would work for a direct load and for
     nothing after it. GPT Sol, plan review of 261007e, R5. */
  describe("by a move inside the app", () => {
    it("changes the page, the tab and the marked row, and starts at the top", () => {
      mountAt("/help/spine");
      const before = history.length;
      press(link('nav[aria-label="Previous and next page"]', "/help/jumping-around"));
      expect(address()).toBe("/help/jumping-around");
      expect(history.length).toBe(before + 1);
      expect(host.querySelector("h1 > span")?.textContent).toBe(helpEntry("jumping-around").title);
      expect(document.title).toBe(`${helpEntry("jumping-around").title} · Help · Spideryarn`);
      expect(tops).toBe(1);
      expect(scrolled).toEqual([]);
      const current = [...host.querySelectorAll('nav[aria-label="Help contents"] [aria-current="page"]')];
      expect(current.map((a) => a.getAttribute("href"))).toEqual(["/help/jumping-around"]);
    });

    it("lands on a question reached from another page, after the router has gone to the top", () => {
      vi.useFakeTimers();
      mountAt("/help/spine");
      const order: string[] = [];
      window.scrollTo = (() => order.push("top")) as typeof window.scrollTo;
      Element.prototype.scrollIntoView = function (this: Element) {
        order.push(this.id);
      };
      press(link('nav[aria-label="Help contents"]', "/help/questions#faq-find-archived"));
      expect(address()).toBe("/help/questions#faq-find-archived");
      expect(h1()).toBe("Questions people ask");
      expect(order).toEqual(["top", "faq-find-archived"]);
      act(() => vi.advanceTimersByTime(200));
      expect(host.querySelector("#faq-find-archived")?.className).toMatch(/element-flash/);
    });

    it("lands on a question reached from the contents page, by its own link there", () => {
      mountAt("/help");
      press(link('nav[aria-label="Help contents"]', "/help/questions#faq-missing-parts"));
      expect(address()).toBe("/help/questions#faq-missing-parts");
      expect(scrolled.map((el) => el.id)).toEqual(["faq-missing-parts"]);
    });

    it("follows the router wherever it is sent from, a link or not", () => {
      mountAt("/help/spine");
      act(() => navigate(helpHref("faq-older-profile")));
      expect(scrolled.map((el) => el.id)).toEqual(["faq-older-profile"]);
      act(() => navigate(helpHref("mode-chat")));
      expect(host.querySelector("h1 > span")?.textContent).toBe(MODE_LABEL.chat);
      /* And an old address handed to the router is carried over like a typed one. */
      act(() => navigate("/help#keyboard"));
      expect(address()).toBe("/help/keyboard");
      expect(host.querySelector("h1 > span")?.textContent).toBe(helpEntry("keyboard").title);
    });
  });

  describe("by Back and Forward", () => {
    it("draws the page the address now names", () => {
      mountAt("/help/spine");
      traverse("/help/keyboard");
      expect(host.querySelector("h1 > span")?.textContent).toBe(helpEntry("keyboard").title);
      traverse("/help");
      expect(h1()).toBe("Help");
      traverse("/help/questions#faq-find-archived");
      expect(h1()).toBe("Questions people ask");
      expect(scrolled.map((el) => el.id)).toEqual(["faq-find-archived"]);
    });

    it("follows a change of question on the questions' page, which changes no route", () => {
      mountAt("/help/questions#faq-find-archived");
      traverse("/help/questions#faq-older-profile");
      expect(scrolled.map((el) => el.id)).toEqual(["faq-find-archived", "faq-older-profile"]);
    });
  });

  describe("from the questions' page to one of its own questions", () => {
    it("owns the press, so the page is not sent to the top on its way there", () => {
      mountAt("/help/questions");
      const before = history.length;
      const click = press(link('nav[aria-label="Help contents"]', "/help/questions#faq-older-profile"));
      expect(click.defaultPrevented).toBe(true);
      expect(address()).toBe("/help/questions#faq-older-profile");
      expect(history.length).toBe(before + 1);
      expect(tops).toBe(0);
      expect(scrolled.map((el) => el.id)).toEqual(["faq-older-profile"]);
    });

    it("leaves a ⌘-press to the browser", () => {
      mountAt("/help/questions");
      const a = link("article h2", "/help/questions#faq-older-profile");
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true });
      act(() => {
        a?.dispatchEvent(click);
      });
      expect(click.defaultPrevented).toBe(false);
      expect(address()).toBe("/help/questions");
      expect(scrolled).toEqual([]);
    });

    it("flashes again on a press of the question you are already at, and adds nothing to history", () => {
      vi.useFakeTimers();
      mountAt("/help/questions#faq-older-profile");
      act(() => vi.advanceTimersByTime(2000));
      expect(host.querySelector("#faq-older-profile")?.className).not.toMatch(/element-flash/);
      const before = history.length;
      press(link("article h2", "/help/questions#faq-older-profile"));
      expect(history.length).toBe(before);
      expect(scrolled.map((el) => el.id)).toEqual(["faq-older-profile", "faq-older-profile"]);
      act(() => vi.advanceTimersByTime(200));
      expect(host.querySelector("#faq-older-profile")?.className).toMatch(/element-flash/);
    });

    it("leaves a link to another page of Help to the router", () => {
      mountAt("/help/questions");
      const click = press(link('nav[aria-label="Help contents"]', "/help/spine"));
      expect(click.defaultPrevented).toBe(true);
      expect(address()).toBe("/help/spine");
      expect(tops).toBe(1);
    });
  });

  it("stops listening when the page goes", () => {
    mountAt("/help/questions");
    act(() => root.unmount());
    root = createRoot(host);
    history.replaceState(null, "", "/help/questions#faq-older-profile");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(scrolled).toEqual([]);
  });
});
