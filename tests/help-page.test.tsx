// @vitest-environment jsdom
/**
 * `/help` — src/web/help/. docs/plans/261002b-help-page.md.
 *
 * Two halves. The first is about **links people already have**: every anchor
 * is unique, kebab-case, in exactly one group, and every anchor ever shipped
 * still lands somewhere (`PINNED_ANCHORS`). The second renders the page and
 * drives what only a render can show: each section exists under its id, the
 * search box finds what a reader would type, and arriving at a fragment —
 * directly, by `hashchange`, through an old anchor, or by clicking the place
 * you are already at — scrolls to and flashes the right section.
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
  HELP_TOPIC_IDS,
  helpHref,
  resolveHelpAnchor,
} from "../src/web/help/help-anchors.js";
import { HELP_GROUPS, HELP_SYNONYMS } from "../src/web/help/help-content.js";
import { HelpPage } from "../src/web/help/HelpPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * **Every anchor the Help page has ever shipped. Never delete from this list —
 * add an alias instead** (help-anchors.ts § `HELP_ANCHOR_ALIASES`).
 *
 * Hand-written on purpose, never derived from `HELP_ANCHORS`: a list built
 * from the code would follow a rename and pass, which is exactly the silent
 * 404 for every old link this exists to catch. Append each new anchor when
 * its section ships.
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
];

const LIVE = new Set<string>(HELP_ANCHORS);

describe("the anchors", () => {
  it("are unique and kebab-case", () => {
    expect(new Set(HELP_ANCHORS).size).toBe(HELP_ANCHORS.length);
    for (const a of HELP_ANCHORS) expect(a, a).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("include a section for every mode and every topic", () => {
    for (const m of MODES) expect(LIVE.has(`mode-${m}`), m).toBe(true);
    for (const t of HELP_TOPIC_IDS) expect(LIVE.has(t), t).toBe(true);
    for (const f of FAQ_IDS) expect(LIVE.has(f), f).toBe(true);
  });

  it("each sit in exactly one group, exactly once, and the groups name nothing else", () => {
    const seen = HELP_GROUPS.flatMap((g) => g.anchors);
    expect(new Set(seen).size, "an anchor appears twice").toBe(seen.length);
    expect([...seen].sort()).toEqual([...HELP_ANCHORS].sort());
  });

  it("include every anchor ever shipped, live or redirected", () => {
    for (const a of PINNED_ANCHORS) {
      const isLive = LIVE.has(a);
      const isAlias = Object.hasOwn(HELP_ANCHOR_ALIASES, a);
      expect(isLive || isAlias, `#${a} no longer lands anywhere — add an alias, never delete`).toBe(true);
      expect(resolveHelpAnchor(a), a).not.toBeNull();
    }
  });

  it("redirect only to live sections", () => {
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

  it("build links of one shape", () => {
    expect(helpHref("spine")).toBe("/help#spine");
    expect(helpHref("mode-skim")).toBe("/help#mode-skim");
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
let scrolled: Element[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  scrolled = [];
  /* jsdom has no `scrollIntoView`; the page optional-calls it. Recording the
     element it was called on is how these tests see where the page went. */
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  history.replaceState(null, "", "/");
  vi.useRealTimers();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function mountAt(address: string): void {
  history.replaceState(null, "", address);
  act(() => root.render(<HelpPage />));
}

const searchBox = () => host.querySelector<HTMLInputElement>('input[type="search"]');

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
  [...host.querySelectorAll('ul[aria-label="Matching sections"] a')].map((a) => a.getAttribute("href"));

describe("the page", () => {
  it("draws every section under its own id, with a link to itself", () => {
    mountAt("/help");
    for (const a of HELP_ANCHORS) {
      const section = host.querySelector(`section[data-section][id="${a}"]`);
      expect(section, a).not.toBeNull();
      expect(section?.querySelector(`h3 a[href="#${a}"]`), `${a} has no # link`).not.toBeNull();
    }
  });

  it("lists every section in its contents, as plain fragment links", () => {
    mountAt("/help");
    const nav = host.querySelector('nav[aria-label="Help contents"]');
    const hrefs = [...(nav?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(HELP_GROUPS.flatMap((g) => g.anchors).map((a) => `#${a}`));
  });

  it("draws a mode's catalog sentences and its Experimental tag", () => {
    mountAt("/help");
    for (const m of MODES) {
      const section = host.querySelector(`#mode-${m}`);
      const heading = section?.querySelector("h3")?.textContent ?? "";
      expect(heading, m).toContain(MODE_LABEL[m]);
      expect(section?.textContent ?? "", m).toContain(MODE_CATALOG[m].description);
      expect(section?.textContent ?? "", m).toContain(MODE_CATALOG[m].how);
      expect(heading.includes("Experimental"), m).toBe(MODE_CATALOG[m].experimental);
    }
    // The control: without one experimental mode the last line proves nothing.
    expect(MODES.some((m) => MODE_CATALOG[m].experimental)).toBe(true);
  });
});

describe("the search box", () => {
  it("finds what a reader would type", () => {
    mountAt("/help");
    for (const [q, want] of [
      ["heat", "#spine"],
      ["price", "#plans"],
      ["skim", "#mode-skim"],
      ["sidebar", "#spine"],
      ["ipad", "#touch"],
    ] as const) {
      type(q);
      expect(resultHrefs()[0], q).toBe(want);
    }
  });

  it("replaces the contents while there is a query, and gives them back after", () => {
    mountAt("/help");
    type("heat");
    expect(host.querySelector('nav[aria-label="Help contents"]')).toBeNull();
    type("");
    expect(host.querySelector('nav[aria-label="Help contents"]')).not.toBeNull();
  });

  it("says so when nothing matches, and points at the browser's Find", () => {
    mountAt("/help");
    type("zebra");
    expect(resultHrefs()).toEqual([]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Find");
  });

  it("goes to the best match on Enter by setting the address, not by scrolling", () => {
    mountAt("/help");
    type("heat");
    act(() => {
      searchBox()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(window.location.hash).toBe("#spine");
  });
});

describe("arriving at a section", () => {
  it("scrolls to the section a direct load names, and flashes it once settled", () => {
    vi.useFakeTimers();
    mountAt("/help#gutter");
    expect(scrolled.map((el) => el.id)).toEqual(["gutter"]);
    act(() => vi.advanceTimersByTime(200));
    expect(host.querySelector("#gutter")?.className).toMatch(/element-flash/);
  });

  it("lands an old anchor on its successor, and corrects the address", () => {
    mountAt("/help#mode-trajectory");
    expect(scrolled.map((el) => el.id)).toEqual(["mode-skim"]);
    expect(window.location.hash).toBe("#mode-skim");
  });

  it("does nothing for a fragment that names nothing", () => {
    mountAt("/help#nonsense");
    expect(scrolled).toEqual([]);
  });

  it("follows a later change of fragment — Back, Forward, a link", () => {
    mountAt("/help");
    expect(scrolled).toEqual([]);
    act(() => {
      history.replaceState(null, "", "/help#keyboard");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(scrolled.map((el) => el.id)).toEqual(["keyboard"]);
  });

  it("flashes again on a click to the place you are already at", () => {
    vi.useFakeTimers();
    mountAt("/help#keyboard");
    act(() => vi.advanceTimersByTime(2000));
    expect(host.querySelector("#keyboard")?.className).not.toMatch(/element-flash/);
    const link = host.querySelector<HTMLAnchorElement>('nav[aria-label="Help contents"] a[href="#keyboard"]');
    act(() => link?.click());
    expect(scrolled.map((el) => el.id)).toEqual(["keyboard", "keyboard"]);
    act(() => vi.advanceTimersByTime(200));
    expect(host.querySelector("#keyboard")?.className).toMatch(/element-flash/);
  });

  it("stops listening when the page goes", () => {
    mountAt("/help");
    act(() => root.unmount());
    root = createRoot(host);
    history.replaceState(null, "", "/help#keyboard");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(scrolled).toEqual([]);
  });
});
