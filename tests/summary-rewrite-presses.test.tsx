// @vitest-environment jsdom
/**
 * **Summary's two rewrite presses, and the reason each needs before it is drawn.**
 * docs/plans/261004f-stop-writing-the-simple-summary-level.md § S2,
 * docs/project/summaries.md.
 *
 * A stored summary is rewritten only when the reader presses for it. Summary's
 * band has two such presses, and this file pins when each may be on screen:
 *
 *  1. **Write it again** (src/web/SimplePanel.tsx). Drawn when the article has
 *     changed since the summary was written (`stale`), under the notice that
 *     says so; or when the reader has changed their profile since
 *     (`profileChanged`), under the paragraphs, with no notice.
 *  2. **Regenerate**, in the profile icon's panel (src/web/ProfilePanel.tsx,
 *     handed its verb by src/web/modes/summary/SummaryMode.tsx § `OwnerSimple`).
 *     Offered only when the profile has changed.
 *
 * With neither reason there is no rewrite press at all. The profile icon may
 * still be there, because the summary was written for a profile, and its panel
 * then opens with no Regenerate. An older prompt (`outdated`) is not a reason:
 * no press and no notice.
 *
 * Every case mounts the real band: the real `SummaryBand`, the real
 * `useSimple`, the real panel and the real `apiFetch`. What is posed is
 * `fetch`, the offline store and the queue transport (`useJobs`), the way
 * tests/rewrite-hold.test.tsx poses them. Buttons are counted as `<button>`
 * elements by name, so a sentence that happens to hold the same words can
 * neither satisfy a case nor break one.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId, Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------------------------------------------------------------- the queue -- */

const SLUG = "a-summarised-piece";

/** Every request the band made of the jobs queue. */
const posted: { slug: string; steps: string[]; force?: string[] }[] = [];
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [] as Job[],
    loaded: true,
    driverFailures: {},
    lastFailure: () => null,
    run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
      posted.push(request);
      return {
        id: "the-job",
        slug: SLUG,
        status: "queued",
        steps: [{ name: request.steps[0] ?? "", status: "pending" }],
        createdAt: "2026-10-04T12:00:00Z",
      } as Job;
    },
    cancel: async () => {},
    retry: async () => null,
  }),
}));

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

/* The offline store, in memory: `apiFetch` writes every good GET to it. */
const cache = new Map<string, { body: unknown; savedAt: number }>();
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async (url: string) => cache.get(url),
  writeCached: async (url: string, body: unknown) => {
    cache.set(url, { body, savedAt: 1 });
  },
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => "the-owner",
  forgetUser: () => {},
}));

vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({ dictation: { supported: false }, readOnly: false, busy: false, toggle: () => {} }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

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
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

/* -------------------------------------------------------------- the article -- */

const BLOCKS: Block[] = [
  { id: "spya-cccccc" as BlockId, tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
  { id: "spya-dddddd" as BlockId, tag: "p", kind: "text", text: "The instrument was built first.", words: 5, html: "<p>The instrument was built first.</p>", gistable: true },
];
const ARTICLE = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: {
    version: "test",
    generator: "test",
    slug: SLUG,
    rootId: "n0",
    nodes: { n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-cccccc", "spya-dddddd"], title: "A piece", gist: "Gist." } },
  },
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
} as unknown as Article;

/* -------------------------------------------------------------- the network -- */

/** What the server says about the stored summary, beside the summary itself. */
interface Says {
  stale: boolean;
  outdated: boolean;
  profileChanged: boolean;
  /** Whether the summary was written for a profile (it carries a `profileHash`). */
  profiled: boolean;
}

const BRIEF = "The instrument came before the theory.";

const answer = ({ stale, outdated, profileChanged, profiled }: Says) => ({
  simpleSummary: {
    version: "simple/2",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    generatedAt: "2026-09-01T09:00:00.000Z",
    elapsedMs: 1,
    profileHash: profiled ? "the-profile-it-was-written-for" : null,
    levels: {
      brief: [{ text: BRIEF, ids: ["spya-dddddd"] }],
      fuller: [{ text: "The fuller one.", ids: ["spya-dddddd"] }],
    },
  },
  stale,
  outdated,
  profileChanged,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let says: Says;
/** Every request that was not a GET, whatever it was for. */
const writes: string[] = [];

/* --------------------------------------------------------------- the harness -- */

const { SummaryBand } = await import("../src/web/modes/summary/SummaryMode.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let host: HTMLDivElement;
let root: Root;
const noop = () => {};

const flush = async () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Mount either length of the owner's band, with the server saying `what`. */
async function open(what: Says, level: "brief" | "fuller" = "brief") {
  says = what;
  await act(async () =>
    root.render(
      createElement(
        NuqsTestingAdapter,
        { searchParams: `?summary=${level}`, hasMemory: true } as Parameters<typeof NuqsTestingAdapter>[0],
        createElement(SummaryBand, { slug: SLUG, article: ARTICLE, onJump: noop }),
      ),
    ),
  );
  await flush();
  expect(document.body.textContent, "the stored summary is on screen").toContain(level === "brief" ? BRIEF : "The fuller one.");
}

/** Real `<button>`s with exactly this name: `aria-label`, or else their text. */
const buttons = (name: string) =>
  [...document.querySelectorAll("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
  );
const press = async (name: string) => {
  const [b] = buttons(name);
  expect(b, `a button named ${name} to press`).toBeDefined();
  await act(async () => b!.click());
  await flush();
};

const WRITE_AGAIN = "Write it again";
const REGENERATE = "Regenerate";
const badge = () => document.querySelector<HTMLButtonElement>(".prof-badge");
const notice = () => document.querySelector(".gloss-stale");

/**
 * What the profile icon offers: no icon at all, a panel with no Regenerate, or
 * a panel with one. Read by opening the panel, and closed again afterwards.
 */
async function badgeOffers(): Promise<"no badge" | "no Regenerate" | "Regenerate" | "Regenerate, disabled"> {
  const b = badge();
  if (!b) return "no badge";
  await act(async () => b.click());
  await flush();
  expect(document.querySelector(".prof-panel"), "the badge opened its panel").not.toBeNull();
  const found = buttons(REGENERATE);
  expect(found.length, "at most one Regenerate").toBeLessThanOrEqual(1);
  const [r] = found;
  const state = r === undefined ? "no Regenerate" : r.disabled ? "Regenerate, disabled" : "Regenerate";
  await press("Done");
  expect(document.querySelector(".prof-panel"), "the panel closed").toBeNull();
  return state;
}

/** Nothing was asked of the model: no job, and no write of any kind. */
function expectNothingSpent() {
  expect(posted, "no job was asked for").toEqual([]);
  expect(writes, "no request but GETs").toEqual([]);
}

const FRESH: Says = { stale: false, outdated: false, profileChanged: false, profiled: true };

beforeEach(() => {
  posted.length = 0;
  writes.length = 0;
  cache.clear();
  jobEngine.reset();
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      writes.push(`${method} ${url}`);
      return json({});
    }
    if (url.startsWith("/api/reader")) return json({ profile: "My current profile", purpose: null });
    if (url === `/api/simple/${SLUG}`) return json(answer(says));
    return json({ error: "Not here." }, 404);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ the rule -- */

interface Case {
  name: string;
  says: Says;
  /** The "older version of the article" notice. */
  notice: boolean;
  /** How many *Write it again* buttons: none, or exactly one. */
  writeAgain: 0 | 1;
  badge: Awaited<ReturnType<typeof badgeOffers>>;
}

const CASES: Case[] = [
  {
    name: "fresh: nothing has changed, so there is no rewrite press",
    says: FRESH,
    notice: false,
    writeAgain: 0,
    badge: "no Regenerate",
  },
  {
    name: "written by an older prompt only: the same as fresh",
    says: { ...FRESH, outdated: true },
    notice: false,
    writeAgain: 0,
    badge: "no Regenerate",
  },
  {
    name: "the article changed: the notice and one Write it again, and the badge offers nothing",
    says: { ...FRESH, stale: true },
    notice: true,
    writeAgain: 1,
    badge: "no Regenerate",
  },
  {
    name: "the article changed and the prompt is older: still only the article's press",
    says: { ...FRESH, stale: true, outdated: true },
    notice: true,
    writeAgain: 1,
    badge: "no Regenerate",
  },
  {
    name: "the profile changed: one Write it again with no notice, and the badge offers Regenerate",
    says: { ...FRESH, profileChanged: true },
    notice: false,
    writeAgain: 1,
    badge: "Regenerate",
  },
  {
    name: "the article and the profile both changed: the notice, one Write it again and Regenerate",
    says: { ...FRESH, stale: true, profileChanged: true },
    notice: true,
    writeAgain: 1,
    badge: "Regenerate",
  },
  {
    name: "the profile changed and the prompt is older: both presses still follow the profile",
    says: { ...FRESH, profileChanged: true, outdated: true },
    notice: false,
    writeAgain: 1,
    badge: "Regenerate",
  },
  {
    name: "all three flags: one Write it again and Regenerate",
    says: { ...FRESH, stale: true, profileChanged: true, outdated: true },
    notice: true,
    writeAgain: 1,
    badge: "Regenerate",
  },
  {
    name: "written without a profile, the article changed: the notice and its press, without a badge",
    says: { ...FRESH, stale: true, profiled: false },
    notice: true,
    writeAgain: 1,
    badge: "no badge",
  },
  {
    name: "written without a profile, fresh: no badge and no press",
    says: { ...FRESH, profiled: false },
    notice: false,
    writeAgain: 0,
    badge: "no badge",
  },
  {
    name: "written without a profile, by an older prompt: no badge and no press",
    says: { ...FRESH, profiled: false, outdated: true },
    notice: false,
    writeAgain: 0,
    badge: "no badge",
  },
];

describe("a rewrite press is drawn only when its reason holds", () => {
  const lengths = (["brief", "fuller"] as const).flatMap((level) => CASES.map((c) => ({ ...c, level })));
  it.each(lengths)("$level: $name", async (c) => {
    await open(c.says, c.level);

    expect(notice() !== null, "the older-version notice").toBe(c.notice);
    expect(buttons(WRITE_AGAIN), "Write it again").toHaveLength(c.writeAgain);
    if (c.notice) {
      /* The article's press sits in its notice, not under the paragraphs. */
      expect(notice()!.contains(buttons(WRITE_AGAIN)[0]!), "the press is inside the notice").toBe(true);
      expect(document.querySelector(".simple-job"), "no second press under the paragraphs").toBeNull();
    }
    expect(buttons(REGENERATE), "no Regenerate before the badge is pressed").toHaveLength(0);
    expect(await badgeOffers(), "the profile badge").toBe(c.badge);

    /* Looking, and opening the panel, bought nothing. */
    expectNothingSpent();
  });
});

describe("choosing a stored length never rewrites it", () => {
  it.each([false, true])("outdated=%s: selecting either length, including the current one, spends nothing", async (outdated) => {
    await open({ ...FRESH, outdated });
    for (const label of ["Brief", "Fuller", "Fuller", "Brief"]) {
      await press(label);
      expect(document.body.textContent).toContain(label === "Brief" ? BRIEF : "The fuller one.");
      expect(buttons(WRITE_AGAIN)).toHaveLength(0);
      expectNothingSpent();
    }
    await press("About this mode");
    expect(document.querySelector(".band-about-card")).not.toBeNull();
    expect(buttons(WRITE_AGAIN)).toHaveLength(0);
    expect(buttons(REGENERATE)).toHaveLength(0);
    expectNothingSpent();
  });
});

describe("each press, pressed, asks for one forced run", () => {
  const FORCED = [{ slug: SLUG, steps: ["simple"], force: ["simple"] }];

  it("Write it again, under the older-version notice", async () => {
    await open({ ...FRESH, stale: true });
    expectNothingSpent();
    await press(WRITE_AGAIN);
    expect(posted).toEqual(FORCED);
  });

  it("Write it again, for a changed profile", async () => {
    await open({ ...FRESH, profileChanged: true });
    expectNothingSpent();
    await press(WRITE_AGAIN);
    expect(posted).toEqual(FORCED);
  });

  it("Regenerate, in the profile badge's panel", async () => {
    await open({ ...FRESH, profileChanged: true });
    expectNothingSpent();
    await act(async () => badge()!.click());
    await flush();
    expect(buttons(REGENERATE)[0]?.disabled, "Regenerate is offered").toBe(false);
    await press(REGENERATE);
    expect(posted).toEqual(FORCED);
    expect(document.querySelector(".prof-panel"), "the press closes the panel").toBeNull();
  });
});
