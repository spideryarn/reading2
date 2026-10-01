// @vitest-environment jsdom
/**
 * **The Metadata page's contents list opens, scrolls to and flashes a section,
 * and the search box above it finds one** — PageContents.tsx § reveal, and
 * Metadata.tsx § Section, which listens for `SECTION_REVEAL`.
 *
 * Greg, SPIDERYARN-READING2-7Y, 2026-10-01:
 *
 * > If I click on the Table of Contents in the left-hand of the Metadata page,
 * > expand that section (if needed) and flash to show where it is in the page.
 *
 * And -83: a search box above that list, synonyms included, that does the same.
 *
 * Driven through the real page rather than a stand-in section, because the
 * half most likely to break silently is the hand-off between the two files —
 * an event sent to an element nobody listens on looks exactly like success
 * from the sending side. docs/plans/261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it.md.
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

/* The same two stubs as tests/metadata-page-order.test.tsx, for its reasons. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Metadata } = await import("../src/web/Metadata.js");
const { FLASH_MS } = await import("../src/web/flash.js");

const SLUG = "temporal-context-reinstatement-spya-dhqkf9";
const DIR = "spideryarn.article_revisions/e7efb065-b82d-4442-af7a-148d37895171/";

function article(): Article {
  return {
    meta: { slug: SLUG, title: "Temporal context reinstatement" },
    blocks: [
      {
        id: "spya-aaaaaa",
        tag: "p",
        kind: "text",
        text: "A paragraph.",
        words: 2,
        html: "<p>A paragraph.</p>",
        gistable: true,
      },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    highPowerSince: null,
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: {
          id: "n0",
          depth: 0,
          parent: null,
          children: [],
          range: ["spya-aaaaaa", "spya-aaaaaa"],
          title: "Temporal context reinstatement",
          gist: "Putting yourself back where you learned it helps you recall it.",
        },
      },
    },
  } as Article;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          slug: SLUG,
          dir: DIR,
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
  await act(async () => {
    root.render(
      createElement(Metadata, {
        slug: SLUG,
        article: article(),
        onRenamed: () => {},
        onVisibility: () => {},
      }),
    );
  });
  /* After the mount, so the page's own requests resolved on real timers; from
     here only the reveal's scroll-idle wait and the flash's timer are ours. */
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const nav = () => host.querySelector<HTMLElement>('nav[aria-label="Sections of this page"]');
const entries = () => [...(nav()?.querySelectorAll("li button") ?? [])].map((b) => b.textContent);
const entry = (label: string) =>
  [...(nav()?.querySelectorAll<HTMLButtonElement>("li button") ?? [])].find(
    (b) => b.textContent === label,
  );
const section = (label: string) =>
  host.querySelector<HTMLElement>(`main [data-section="${label}"]`);
/** A collapsible section's own disclosure button — in `main`, not the nav. */
const toggle = (label: string) => section(label)?.querySelector<HTMLButtonElement>("h2 button");
const searchBox = () => nav()?.querySelector<HTMLInputElement>('input[type="search"]');

async function type(text: string) {
  const box = searchBox();
  if (!box) throw new Error("no search box");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string) {
  const box = searchBox();
  await act(async () => {
    box?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** Past the reveal's wait for the scroll to stop, into the flash. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}

describe("clicking an entry in the contents list (7Y)", () => {
  it("opens a shut section, then flashes it", async () => {
    expect(toggle("Technical details")?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain(DIR);

    await act(async () => entry("Technical details")?.click());

    expect(toggle("Technical details")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain(DIR);
    await settle();
    expect(section("Technical details")?.classList.contains("element-flash")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(section("Technical details")?.classList.contains("element-flash")).toBe(false);
  });

  it("has the body open before it asks for the scroll, and lands focus on the heading", async () => {
    /* Near the foot of the page a shut section may not leave the scroll range
       to bring its heading up, so the open must be committed first — not
       merely scheduled. jsdom has no scrollIntoView, so this one records what
       the page looked like at the moment it was called. */
    let bodyAtScroll: boolean | null = null;
    const spy = vi.fn(function (this: HTMLElement) {
      bodyAtScroll = (host.textContent ?? "").includes(DIR);
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: spy,
      configurable: true,
      writable: true,
    });
    try {
      await act(async () => entry("Technical details")?.click());
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.contexts[0]).toBe(section("Technical details"));
    expect(bodyAtScroll, "the body was in the DOM when the scroll was asked for").toBe(true);
    expect(document.activeElement).toBe(section("Technical details")?.querySelector("h2"));
  });

  it("acts on its own page only, when two are mounted with the same ids", async () => {
    /* Section ids are derived from labels, so a second page carries the same
       ones; a document-wide lookup would open the first page's section. */
    const host2 = document.createElement("div");
    document.body.append(host2);
    const root2 = createRoot(host2);
    vi.useRealTimers();
    await act(async () => {
      root2.render(
        createElement(Metadata, {
          slug: SLUG,
          article: article(),
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      );
    });
    vi.useFakeTimers();
    try {
      const nav2 = host2.querySelector('nav[aria-label="Sections of this page"]');
      const entry2 = [...(nav2?.querySelectorAll<HTMLButtonElement>("li button") ?? [])].find(
        (b) => b.textContent === "Technical details",
      );
      expect(entry2, "the second page has its own contents entry").toBeTruthy();
      await act(async () => entry2?.click());
      const section2 = host2.querySelector('main [data-section="Technical details"]');
      expect(section2?.querySelector("h2 button")?.getAttribute("aria-expanded")).toBe("true");
      expect(toggle("Technical details")?.getAttribute("aria-expanded"), "the first page").toBe(
        "false",
      );
      await settle();
      expect(section2?.classList.contains("element-flash")).toBe(true);
      expect(section("Technical details")?.classList.contains("element-flash")).toBe(false);
    } finally {
      await act(async () => root2.unmount());
      host2.remove();
    }
  });

  it("leaves an open section open, and flashes it all the same", async () => {
    await act(async () => toggle("Export")?.click());
    expect(toggle("Export")?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => entry("Export")?.click());

    expect(toggle("Export")?.getAttribute("aria-expanded")).toBe("true");
    await settle();
    expect(section("Export")?.classList.contains("element-flash")).toBe(true);
  });

  it("flashes a section that cannot be shut", async () => {
    await act(async () => entry("At a glance")?.click());
    await settle();
    expect(section("At a glance")?.classList.contains("element-flash")).toBe(true);
  });
});

describe("the search box above it (83)", () => {
  it("is there, above the list", () => {
    const box = searchBox();
    expect(box).toBeTruthy();
    const list = nav()?.querySelector("ul");
    expect(
      box && list && box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("narrows the list to what matches, by a synonym, and Enter opens and flashes the first", async () => {
    const all = entries();
    await type("download");
    expect(entries()[0]).toBe("Export");
    expect(entries().length).toBeLessThan(all.length);

    await press("Enter");
    expect(toggle("Export")?.getAttribute("aria-expanded")).toBe("true");
    await settle();
    expect(section("Export")?.classList.contains("element-flash")).toBe(true);
  });

  it("finds a shut section by a word only its keywords carry", async () => {
    /* Technical details unmounts its body while shut, so "fingerprint" is on
       the page only in its `data-keywords`. */
    expect(host.textContent?.toLowerCase()).not.toContain("fingerprint");
    await type("fingerprint");
    expect(entries()[0]).toBe("Technical details");
  });

  it("says so when nothing matches, and Escape puts the whole list back", async () => {
    const all = entries();
    await type("zebra");
    expect(entries()).toEqual([]);
    expect(nav()?.textContent).toContain("Nothing on this page matches");

    await press("Escape");
    expect(searchBox()?.value).toBe("");
    expect(entries()).toEqual(all);
  });
});
