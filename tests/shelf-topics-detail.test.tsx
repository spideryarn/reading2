// @vitest-environment jsdom
/**
 * **The Topics row's two views** — pills, and "More detail" — mounted with the
 * URL real (plan 260928d § Stage 2).
 *
 * What has to hold:
 *  - "All N topics" expands the **same row of pills** to every topic, in rank
 *    order — no list, no change of style;
 *  - "More detail" (`?topicsView=detail`) turns them into one row per topic,
 *    every topic in rank order, each with a colour swatch, a count bar
 *    proportional to the largest count shown, "n of M on the shelf", and its
 *    top three articles as links to `/read/<slug>`;
 *  - the chip in a row is the pill: it toggles the same key, with the same
 *    `aria-pressed`;
 *  - a topic's pill dot and its row swatch are the same palette slot;
 *  - the view round-trips through the URL, and focus stays on the toggle.
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryTermsResponse } from "../src/types.js";
import { ShelfTerms } from "../src/web/ShelfTerms.js";
import { topArticles } from "../src/web/ShelfTermChip.js";
import { topicSlot } from "../src/web/topic-colour.js";

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
enableHistorySync();

/* Fourteen topics, so "All 14" has two more than the collapsed twelve. Topic
   i is used by articles a{i}, a{i+1}, a{i+2}; its live count is 14 − i, so the
   first (rank 0) has the largest count and the bars can be checked. */
const KEYS = Array.from({ length: 14 }, (_, i) => `topic${String(i).padStart(2, "0")}`);
const DATA: LibraryTermsResponse = {
  terms: KEYS.map((key, i) => ({
    key,
    label: key,
    articles: [0, 1, 2].map((d) => ({ slug: `a${i + d}`, count: 9 - d })),
  })),
  scope: { articles: 20, works: 20, skipped: 0 },
  pending: 0,
  chosenBy: "program",
  refreshing: false,
};
const SLUGS = Array.from({ length: 20 }, (_, i) => `a${i}`);
const countOf = (key: string) => 14 - KEYS.indexOf(key);

/* What the harness draws; a test may swap either before `show`. */
let data: LibraryTermsResponse = DATA;
let scopeSlugs: string[] = SLUGS;
let titleOf = (slug: string): string | undefined => `Title of ${slug}`;

let host: HTMLDivElement;
let root: Root;
let toggled: string[];

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  return createElement(ShelfTerms, {
    data,
    /* A topic of a test's own `data` counts all its articles: at zero it
       would not be drawn at all (plan 260929a, `availableTopics`). */
    counts: new Map(
      data.terms.map((t) => [t.key, KEYS.includes(t.key) ? countOf(t.key) : t.articles.length]),
    ),
    selected,
    onToggle: (key: string) => {
      toggled.push(key);
      setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
    },
    onClear: () => setSelected([]),
    titleOf,
    inScope: new Set(scopeSlugs),
    archived: false,
  });
}

async function show(path: string) {
  toggled = [];
  history.replaceState(null, "", path);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Harness)));
  });
  await settle();
}

async function settle(ms = 60) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  data = DATA;
  scopeSlugs = SLUGS;
  titleOf = (slug) => `Title of ${slug}`;
});

const params = () => new URLSearchParams(location.search);
const detailList = () => host.querySelector<HTMLElement>('[aria-label="Topics in detail"]');
/** The topic chips drawn as pills, outside the detail view, in DOM order. */
const pills = () =>
  [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].filter((b) => !b.closest('[aria-label="Topics in detail"]'));
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(text));

async function click(el: HTMLElement | undefined | null) {
  expect(el, "the thing to click").toBeTruthy();
  await act(async () => el?.click());
  await settle();
}

describe("All N topics", () => {
  it("expands the same row of pills to every topic, in rank order, with no list", async () => {
    await show("/");
    expect(pills().map((b) => b.getAttribute("aria-label")?.split(" ")[0])).toEqual(KEYS.slice(0, 12));
    const row = pills()[0]?.parentElement;

    await click(button("All 14 topics"));
    expect(pills().map((b) => b.getAttribute("aria-label")?.split(" ")[0])).toEqual(KEYS);
    // The same row, and no list of any kind beneath it.
    expect(pills().every((b) => b.parentElement === row)).toBe(true);
    expect(host.querySelector("ul")).toBeNull();
  });
});

describe("More detail", () => {
  it("draws one row per topic, every topic in rank order, with links, bars, swatches and n of M", async () => {
    await show("/");
    await click(button("More detail"));
    expect(params().get("topicsView")).toBe("detail");

    const list = detailList();
    expect(list).toBeTruthy();
    const rows = [...(list?.querySelectorAll(":scope > li") ?? [])];
    expect(rows).toHaveLength(14);
    // No pill row, and no "All N" in this view: it always shows every topic.
    expect(pills()).toHaveLength(0);
    expect(button("All 14 topics")).toBeUndefined();

    const first = rows[0] as HTMLElement;
    expect(first.querySelector("button[aria-pressed]")?.getAttribute("aria-label")).toMatch(/^topic00 14 /);
    const links = [...first.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/read/a0", "/read/a1", "/read/a2"]);
    expect(links.map((a) => a.textContent)).toEqual(["Title of a0", "Title of a1", "Title of a2"]);
    expect(first.textContent).toContain("3 of 20 on the shelf");

    // The bar: the live count over the largest live count shown.
    const bars = rows.map((r) => r.querySelector("[data-count-bar]")?.getAttribute("data-count-bar"));
    expect(bars[0]).toBe("100");
    expect(bars[7]).toBe(String(Math.round((7 / 14) * 100)));
    expect(rows.every((r) => r.querySelector("[data-count-bar]")?.getAttribute("aria-hidden") === "true")).toBe(true);

    // A swatch per row, decorative, in the topic's palette slot.
    for (const [i, r] of rows.entries()) {
      const swatch = r.querySelector("[data-topic-slot]");
      expect(swatch?.getAttribute("aria-hidden")).toBe("true");
      expect(swatch?.getAttribute("data-topic-slot")).toBe(String(topicSlot(i)));
    }
  });

  it("keeps focus on the toggle, and its label says which way it goes", async () => {
    await show("/");
    const toggle = button("More detail");
    toggle?.focus();
    await click(toggle);
    expect(document.activeElement?.textContent?.trim()).toMatch(/^Fewer details/);
    await click(button("Fewer details"));
    expect(document.activeElement?.textContent?.trim()).toMatch(/^More detail/);
    expect(params().get("topicsView")).toBeNull();
  });

  it("a row's chip toggles the topic exactly as its pill does", async () => {
    await show("/?topicsView=detail");
    const chipIn = (key: string) =>
      [...(detailList()?.querySelectorAll<HTMLButtonElement>("button[aria-pressed]") ?? [])].find((b) =>
        b.getAttribute("aria-label")?.startsWith(`${key} `),
      );
    expect(chipIn("topic03")?.getAttribute("aria-pressed")).toBe("false");
    await click(chipIn("topic03"));
    expect(toggled).toEqual(["topic03"]);
    expect(chipIn("topic03")?.getAttribute("aria-pressed")).toBe("true");

    // The same topic, chosen, is pressed in the pill view too.
    await click(button("Fewer details"));
    const pill = pills().find((b) => b.getAttribute("aria-label")?.startsWith("topic03 "));
    expect(pill?.getAttribute("aria-pressed")).toBe("true");
    await click(pill);
    expect(toggled).toEqual(["topic03", "topic03"]);
    expect(pills().find((b) => b.getAttribute("aria-label")?.startsWith("topic03 "))?.getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("gives a topic's pill dot and its row swatch the same colour", async () => {
    await show("/");
    await click(button("All 14 topics"));
    const dotOf = new Map(
      pills().map((b) => [
        b.getAttribute("aria-label")?.split(" ")[0],
        b.querySelector<HTMLElement>("[data-topic-slot]"),
      ]),
    );
    await click(button("More detail"));
    const rows = [...(detailList()?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
    expect(rows).toHaveLength(14);
    for (const row of rows) {
      const key = row.querySelector("button[aria-pressed]")?.getAttribute("aria-label")?.split(" ")[0];
      const dot = dotOf.get(key);
      const swatch = row.querySelector<HTMLElement>("[data-topic-slot]");
      expect(dot, `${key}'s pill dot`).toBeTruthy();
      expect(swatch?.getAttribute("data-topic-slot"), key).toBe(dot?.getAttribute("data-topic-slot"));
      // The colour itself is the same palette reference on both.
      expect(swatch?.style.getPropertyValue("--topic"), key).toBe(dot?.style.getPropertyValue("--topic"));
      expect(swatch?.style.getPropertyValue("--topic")).toMatch(/^var\(--cat-\d+\)$/);
    }
    // Distinct neighbours: the first seven are seven different slots.
    const firstSeven = rows.slice(0, 7).map((r) => r.querySelector("[data-topic-slot]")?.getAttribute("data-topic-slot"));
    expect(new Set(firstSeven).size).toBe(7);
  });
});

describe("?topicsView=detail", () => {
  it("round-trips: arriving with it shows the detail view, and leaving it removes it", async () => {
    await show("/?topicsView=detail");
    expect(detailList()).toBeTruthy();
    expect(button("Fewer details")).toBeTruthy();
    await click(button("Fewer details"));
    expect(detailList()).toBeNull();
    expect(params().get("topicsView")).toBeNull();
    await click(button("More detail"));
    expect(params().get("topicsView")).toBe("detail");
    expect(detailList()).toBeTruthy();
  });

  it("ignores a value it does not know", async () => {
    await show("/?topicsView=nonsense");
    expect(detailList()).toBeNull();
    expect(pills().length).toBeGreaterThan(0);
  });

});

describe("copies of one article", () => {
  /* Three physical copies of one piece, saved twice over: each is its own
     slug with the same title. A row that named it three times would be a row
     that named one article (Stage 2, coordinator 2026-09-28). */
  const COPIES: LibraryTermsResponse = {
    terms: [
      {
        key: "lightning",
        label: "lightning",
        articles: [
          { slug: "ball-1", count: 9 },
          { slug: "ball-2", count: 9 },
          { slug: "ball-3", count: 9 },
          { slug: "storms", count: 5 },
          { slug: "ball-4", count: 4 },
          { slug: "sprites", count: 3 },
          { slug: "plasma", count: 2 },
        ],
      },
    ],
    scope: { articles: 7, works: 5, skipped: 0 },
    pending: 0,
    chosenBy: "program",
    refreshing: false,
  };
  const TITLES: Record<string, string> = {
    "ball-1": "A brief history of ball lightning",
    "ball-2": "A brief history of ball lightning",
    "ball-3": "A brief history of ball lightning",
    "ball-4": "A brief history of ball lightning",
    storms: "Storms",
    sprites: "Red sprites",
    plasma: "Plasma",
  };

  it("names distinct titles in a detail row, the first copy's slug for each, up to three", async () => {
    data = COPIES;
    titleOf = (slug) => TITLES[slug];
    scopeSlugs = Object.keys(TITLES);
    await show("/?topicsView=detail");
    const row = detailList()?.querySelector(":scope > li");
    const links = [...(row?.querySelectorAll("a") ?? [])];
    expect(links.map((a) => a.textContent)).toEqual(["A brief history of ball lightning", "Storms", "Red sprites"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/read/ball-1", "/read/storms", "/read/sprites"]);
    // The counts stay physical: seven articles use it, copies and all.
    expect(row?.textContent).toContain("7 of 7 on the shelf");
  });

  it("names distinct titles in the tooltip too", () => {
    const titled = (slugs: { slug: string }[]) => slugs.map((a) => TITLES[a.slug]);
    const [term] = COPIES.terms;
    if (!term) throw new Error("fixture");
    const inScope = new Set(Object.keys(TITLES));
    expect(titled(topArticles(term, inScope, 5, (s) => TITLES[s]))).toEqual([
      "A brief history of ball lightning",
      "Storms",
      "Red sprites",
      "Plasma",
    ]);
  });
});
