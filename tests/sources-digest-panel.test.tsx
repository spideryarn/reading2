// @vitest-environment jsdom
/**
 * **Sources › Digest, on screen** — plan
 * docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
 * § Stages, 2.
 *
 *  - **The press starts it; arriving does not.** The digest is the dearest
 *    press in the app (about a dollar), so the rule *Where it sits* follows —
 *    opening it is the request, and only a press opens it — matters most here
 *    (docs/project/sources.md § Opening it is the request). The press is
 *    `armActivationForSubMode`, exactly what the chip and its command-bar row
 *    call; arriving is a mount with no token. Under a real `<StrictMode>`, so
 *    *one POST* is also the double-invoked-effect assertion
 *    (tests/modes-that-start-themselves.test.tsx says why).
 *  - **Each sentence is a door**: a `BlockRef`, so the band's on-screen wash
 *    lights it and a press jumps (on-screen.ts § `onScreenLinkCss` selects
 *    `[data-block-link]` inside the band).
 *  - **A visitor never asks the route**: a shared `?sources=digest` draws
 *    Bibliography.
 *
 * The chip row's half (switch off hides the chip, a pasted address still
 * draws it lit) is in tests/sources-chips.test.tsx with the other chips.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Job, SourcesDigest, SourcesDigestParagraph } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
});

const SLUG = "a-piece";
const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;

/* ------------------------------------------------------------ the network -- */

/** Every GET through `apiFetch`, in order. */
const gets: string[] = [];
/** Every job request the queue was asked for. */
const posts: { slug: string; steps: string[]; force?: string[] }[] = [];
/** What `GET /api/sources-digest/:slug` answers: `null` is "none yet". */
let stored: SourcesDigest | null = null;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (url.startsWith("/api/sources-digest/")) {
      return new Response(
        JSON.stringify(
          stored === null ? null : { sourcesDigest: stored, stale: false, outdated: false, profileChanged: false },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(null, { status: 404 });
  },
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
}));

let jobs: Job[] = [];
vi.mock("../src/web/useJobs.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    ...actual,
    useJobs: () => ({
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => "The queue said no.",
      run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
        posts.push(request);
        return { id: `job${posts.length}` };
      },
      cancel: async () => {},
      add: async () => null,
      addUpload: async () => null,
      retry: async () => {},
      forget: async () => {},
    }),
  };
});

const { useSourcesDigest } = await import("../src/web/useSourcesDigest.js");
const { SourcesDigestPanel, DIGEST_MORE } = await import("../src/web/SourcesDigestPanel.js");
const { VisitorSourcesBand } = await import("../src/web/modes/sources/SourcesMode.js");
const { armActivationForSubMode, pendingActivation, resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

/* ------------------------------------------------------------ fixtures -- */

function paragraph(over: Partial<SourcesDigestParagraph> = {}): SourcesDigestParagraph {
  const sentences = over.sentences ?? [
    { text: "Smith 2019 says it only for adults.", id: A },
    { text: "Nobody has replied to that yet.", id: null },
  ];
  return {
    text: sentences.map((s) => s.text).join(" "),
    sentences,
    ids: [A],
    more: "The detail behind it, in the model's words.",
    sources: ["S1"],
    leadIds: ["L1"],
    ...over,
  };
}

function digest(): SourcesDigest {
  return {
    version: "sources-digest/1",
    generator: "test-planner",
    phases: { plan: "test-planner", read: "test-reader", write: "test-writer" },
    slug: SLUG,
    sourceHash: "h",
    profileHash: null,
    generatedAt: "2026-10-30T12:00:00.000Z",
    elapsedMs: 120_000,
    year: 2023,
    outcome: "written",
    overview: [
      { text: "The piece leans on two reviews.", id: B },
      { text: "Its reception has been quiet.", id: null },
    ],
    sections: { cites: [paragraph()], citedBy: [], missed: [], check: [] },
    leads: [
      {
        id: "L1",
        angle: "check",
        question: "Does Smith 2019 say that?",
        blockIds: [A],
        searches: [{ q: "smith 2019 adults", outcome: "found", pages: 3 }],
      },
    ],
    pieceSearch: null,
    citers: 0,
    reports: [{ leadId: "L1", verdict: "partly", summary: "It does, for adults.", quotes: [], digFurther: null }],
    evidence: [
      {
        id: "S1",
        origin: "web",
        url: "https://example.org/smith-2019",
        title: "Smith 2019",
        year: 2019,
        quoted: ["only in adults"],
      },
    ],
    counts: {
      leadsWritten: 1, leadsDropped: 0, queriesRefused: 0, searches: 1, readers: 1, readersFailed: 0,
      offVerdict: 0, quotesWritten: 1, quotesUnknownSource: 0, quotesUnchecked: 0, unknownIds: 0,
      sentenceIds: 0, unanchored: 0, emptyParagraphs: 0, unknownSources: 0, unknownLeads: 0, overCap: 0,
    },
  };
}

/* ------------------------------------------------------------ the page -- */

let host: HTMLDivElement;
let root: Root;
const jumps: BlockId[] = [];

/** The owner's band as SourcesMode.tsx § `DigestBand` mounts it: the real hook, the real panel. */
function Band(): ReactElement {
  const owner = useSourcesDigest(SLUG);
  return createElement(SourcesDigestPanel, { head: null, owner, onJump: (id: BlockId) => jumps.push(id) });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Band)));
  });
  await settle();
}

const digestGets = () => gets.filter((u) => u.startsWith("/api/sources-digest/"));

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  jumps.length = 0;
  jobs = [];
  stored = null;
  resetActivations();
  jobEngine.reset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetActivations();
});

/* ------------------------------------------------------------ the tests -- */

describe("opening it is the request", () => {
  it("starts the digest on a press of its chip where none is stored, once under StrictMode", async () => {
    armActivationForSubMode(SLUG, { mode: "sources", view: "digest" });
    await mount();
    expect(digestGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: SLUG, steps: ["sources-digest"] }]);
  });

  it("starts nothing on arrival — a link, a reload or Back — and offers its own button instead", async () => {
    await mount();
    /* The GET really happened, so "no POST" is about a settled panel. */
    expect(digestGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
    expect(host.textContent).toContain("Write the digest");
  });

  it("spends a press on a stored digest without a run, so a press never re-runs one", async () => {
    stored = digest();
    armActivationForSubMode(SLUG, { mode: "sources", view: "digest" });
    await mount();
    expect(posts).toEqual([]);
    expect(pendingActivation(SLUG, "sources-digest")).toBeNull();
  });

  it("makes the same unforced request from its own button as the press does", async () => {
    await mount();
    const write = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Write the digest"));
    await act(async () => write?.click());
    await settle();
    expect(posts).toEqual([{ slug: SLUG, steps: ["sources-digest"] }]);
  });
});

describe("each sentence is a door", () => {
  it("draws a sentence that names its passage as a BlockRef, and one that names none as plain words", async () => {
    stored = digest();
    await mount();
    const overview = host.querySelector<HTMLAnchorElement>(`.digest-overview a[data-block-link="${B}"]`);
    expect(overview?.textContent).toBe("The piece leans on two reviews.");
    expect(overview?.classList.contains("simple-sentence")).toBe(true);
    const para = host.querySelector<HTMLAnchorElement>(`.digest-para .simple-text a[data-block-link="${A}"]`);
    expect(para?.textContent).toBe("Smith 2019 says it only for adults.");
    /* The unanchored sentence is words, not a link. */
    const links = [...host.querySelectorAll(".digest-para .simple-text a")].map((a) => a.textContent);
    expect(links).not.toContain("Nobody has replied to that yet.");
    expect(host.querySelector(".digest-para .simple-text")?.textContent).toContain("Nobody has replied to that yet.");
  });

  it("jumps to the passage on a press", async () => {
    stored = digest();
    await mount();
    const link = host.querySelector<HTMLAnchorElement>(`.digest-overview a[data-block-link="${B}"]`);
    await act(async () => link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(jumps).toEqual([B]);
  });

  it("puts the paragraph's ids under it as chips, and More opens the detail and its sources with the checked words", async () => {
    stored = digest();
    await mount();
    expect(host.querySelector(`.digest-para .simple-refs a[data-block-link="${A}"]`)).not.toBeNull();
    const more = [...host.querySelectorAll<HTMLButtonElement>(".digest-more-toggle")].find(
      (b) => b.textContent === DIGEST_MORE,
    );
    const fold = host.querySelector<HTMLElement>(".digest-more");
    expect(fold?.hidden).toBe(true);
    await act(async () => more?.click());
    expect(fold?.hidden).toBe(false);
    const out = fold?.querySelector<HTMLAnchorElement>("a.situate-source-link");
    expect(out?.getAttribute("href")).toBe("https://example.org/smith-2019");
    expect(fold?.querySelector(".rcp-quote")?.textContent).toBe("“only in adults”");
  });

  it("says what was searched, folded, with the question's verdict", async () => {
    stored = digest();
    await mount();
    expect(host.textContent).toContain("What was searched (1 question, 1 search)");
    expect(host.querySelector(".digest-lead")?.textContent).toContain("partly");
  });
});

describe("a visitor", () => {
  it("never asks the route: a shared ?sources=digest draws Bibliography", async () => {
    await act(async () => {
      root.render(
        createElement(
          NuqsTestingAdapter,
          { searchParams: "?sources=digest", hasMemory: true } as Parameters<typeof NuqsTestingAdapter>[0],
          createElement(VisitorSourcesBand, {
            blocks: [],
            sourceUrl: null,
            bibliography: null,
            reception: null,
            claimList: null,
            onJump: () => {},
            blockOrder: new Map(),
            publishedAt: undefined,
            articleTitle: null,
            onOpenWork: () => {},
          }),
        ),
      );
    });
    await settle();
    expect(digestGets()).toEqual([]);
    const checked = host.querySelector('[role="radio"][aria-checked="true"]');
    expect(checked?.textContent).toContain("Bibliography");
    expect([...host.querySelectorAll('[role="radio"]')].map((r) => r.firstChild?.textContent)).not.toContain("Digest");
  });
});
