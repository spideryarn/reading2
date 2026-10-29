// @vitest-environment jsdom
/**
 * **The reminder bar: the masthead in brief, while you scroll back** — Greg,
 * 2026-10-28 (spya-ga6m76). ReminderBar.tsx; plan 261029d, Part 1.
 *
 * When it shows is CSS on two attributes, and scroll.ts's half of that is
 * tests/scroll-settlement.test.ts § marks a reader's scroll back. This file is
 * the rest: what it says, that nothing in it can be reached (GPT Sol, plan
 * review F4), the masthead observer, and pins on the stylesheet and the mount
 * that jsdom cannot evaluate.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Article } from "../src/types.js";
import { ReminderBar, reminderFacts } from "../src/web/ReminderBar.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Meta = Article["meta"];
const meta = (extra: Partial<Meta>): Meta => ({ slug: "a-piece", title: "A piece", ...extra }) as Meta;

describe("reminderFacts — the masthead's facts, as words", () => {
  it("keeps the masthead's order: who, journal, site, published, read time", () => {
    expect(
      reminderFacts(
        meta({ byline: "Ada Lovelace", journal: "Nature", siteName: "nature.com", publishedAt: "2023-08-17" }),
        12,
      ),
    ).toEqual(["Ada Lovelace", "Nature", "nature.com", expect.stringMatching(/2023/), "~12 min"]);
  });

  it("names three authors and folds the rest into et al.", () => {
    const authors = ["Patrick Butlin", "Robert Long", "Eric Elmoznino", "Yoshua Bengio"].map((name) => ({ name }));
    expect(reminderFacts(meta({ authors, byline: "ignored when there is a list" } as Partial<Meta>), 95)[0]).toBe(
      "Patrick Butlin, Robert Long, Eric Elmoznino et al.",
    );
  });

  it("says the journal once when it is the site, and leaves out what it does not know", () => {
    expect(reminderFacts(meta({ journal: "arXiv", siteName: "arXiv" }), 3)).toEqual(["arXiv", "~3 min"]);
    expect(reminderFacts(meta({}), 1)).toEqual(["~1 min"]);
  });
});

/* ------------------------------------------------------------------------- */

const ARTICLE = {
  highPowerSince: null,
  titleOverridden: false,
  meta: meta({ byline: "Ada Lovelace", siteName: "Example" }),
  blocks: [
    { id: "spya-aaaaaa", tag: "p", kind: "text", text: "Some words here.", words: 3, html: "<p>Some words here.</p>", gistable: true },
  ],
  tree: {
    version: "t",
    generator: "t",
    slug: "a-piece",
    rootId: "n0",
    nodes: { n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-aaaaaa"], title: "A piece" } },
  },
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
} as unknown as Article;

/** The one observer the bar makes, so a test can say what it sees. */
let observed: { callback: IntersectionObserverCallback; target: Element | null; disconnected: boolean } | null = null;
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observed = { callback, target: null, disconnected: false };
  }
  observe(target: Element) {
    if (observed) observed.target = target;
  }
  disconnect() {
    if (observed) observed.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  observed = null;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver;
  host = document.createElement("div");
  host.className = "reader";
  host.innerHTML = `<div class="masthead"></div><div class="slot"></div>`;
  document.body.append(host);
  root = createRoot(host.querySelector(".slot")!);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

const bar = () => host.querySelector<HTMLElement>(".reminder-bar");

function see(isIntersecting: boolean, bottom: number): void {
  act(() => {
    observed?.callback(
      [{ isIntersecting, boundingClientRect: { bottom } } as unknown as IntersectionObserverEntry],
      observed as unknown as IntersectionObserver,
    );
  });
}

describe("ReminderBar", () => {
  it("says the title and the facts, and holds nothing anybody can reach", () => {
    act(() => root.render(createElement(ReminderBar, { article: ARTICLE, readBand: "half" })));
    expect(bar()?.textContent).toContain("A piece");
    expect(bar()?.textContent).toContain("Ada Lovelace · Example · ~1 min");
    expect(bar()?.getAttribute("aria-hidden")).toBe("true");
    expect(bar()?.hasAttribute("inert"), "inert as well as hidden: aria-hidden alone keeps the tab order").toBe(true);
    expect(bar()?.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
    expect(bar()?.querySelector(".reminder-pie svg"), "the owner's pie, drawn bare").not.toBeNull();
  });

  it("draws no pie for a visitor, or before anything has been read", () => {
    act(() => root.render(createElement(ReminderBar, { article: ARTICLE })));
    expect(bar()?.querySelector(".reminder-pie")).toBeNull();
    act(() => root.render(createElement(ReminderBar, { article: ARTICLE, readBand: "none" })));
    expect(bar()?.querySelector(".reminder-pie")).toBeNull();
  });

  it("knows when the masthead has gone off the top, and only then", () => {
    act(() => root.render(createElement(ReminderBar, { article: ARTICLE })));
    expect(observed?.target, "it watches the masthead").toBe(host.querySelector(".masthead"));
    expect(bar()?.hasAttribute("data-masthead-gone")).toBe(false);
    see(false, -40);
    expect(bar()?.hasAttribute("data-masthead-gone")).toBe(true);
    see(true, 120);
    expect(bar()?.hasAttribute("data-masthead-gone")).toBe(false);
    see(false, 2000);
    expect(bar()?.hasAttribute("data-masthead-gone"), "below the window is not gone").toBe(false);
    act(() => root.unmount());
    root = createRoot(host.querySelector(".slot")!);
    expect(observed?.disconnected).toBe(true);
  });
});

describe("what jsdom cannot evaluate", () => {
  const css = readFileSync("src/web/styles/narrow-window.css", "utf8");

  it("is shown only inside the small-device query, on the scroll-back and masthead attributes", () => {
    const start = css.indexOf("@media (max-height: 620px), (max-width: 731px) {");
    const show = css.indexOf(":root[data-scrolled-back] .reminder-bar[data-masthead-gone] {");
    const base = css.indexOf(":where(.reminder-bar) { display: none; }");
    expect(start).toBeGreaterThan(-1);
    expect(show, "the rule that shows it").toBeGreaterThan(start);
    expect(base, "hidden everywhere else, at zero specificity").toBeGreaterThan(-1);
    const rule = css.slice(css.indexOf("  .reminder-bar {", start), show);
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("top: var(--bar-bottom)");
    expect(rule, "the reading column, not Marginalia's").toContain("var(--marg-reserve)");
    expect(rule, "under Marginalia's head (30)").toContain("z-index: 29");
  });

  it("is mounted beside the masthead, and only while no band is open", () => {
    const reader = readFileSync("src/web/reader/Reader.tsx", "utf8");
    expect(reader).toContain("{!bandOpen && <ReminderBar article={article} readBand={readSoFarBand} />}");
  });
});
