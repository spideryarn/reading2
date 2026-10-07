// @vitest-environment jsdom
/**
 * **The metadata page's three relative times: "ran …", "last wrote …",
 * "fetched …".**
 *
 * Until 2026-10-04 the page had a private `ago()` that read `Date.now()` during
 * render. It had neither of the two things the shared formatter is arranged
 * around (src/web/relative-time.ts, src/web/useNow.ts), and both were visible:
 *
 * - **a clock a few seconds ahead of the browser's said "ran in 4 seconds"**,
 *   about a step that had already finished — the first case here, watched fail
 *   against the private copy;
 * - **the words never moved** while the page stayed open.
 *
 * And one thing the shared formatter does that needed grammar: past a month it
 * hands back a date, and "ran Aug 5, 2026" is not a sentence. So the three
 * callers say **"on <date>"** there (GPT Sol's plan review, S4, in
 * docs/plans/261004d-sweep-clusters-13-and-18-lint-gates-census-test-and-client-tidy.md).
 *
 * The date itself is the runner's locale, so it is asked of `timeAgo` rather
 * than written out.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, StageState } from "../src/types.js";

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

/* The same two stubs as tests/metadata-step-timing.test.tsx, for its reasons. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
/* The bar is stubbed; the module's helpers are real — Metadata.tsx calls
   `withPanel` from it, and a factory that names only `Dock` throws on the rest. */
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

const { Metadata } = await import("../src/web/Metadata.js");
const { timeAgo } = await import("../src/web/relative-time.js");

const SLUG = "temporal-context-reinstatement-spya-dhqkf9";
const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function article(fetchedAt: string | undefined): Article {
  return {
    meta: { slug: SLUG, title: "Temporal context reinstatement", fetchedAt },
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
    titleOverridden: false,
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
        },
      },
    },
  } as Article;
}

/** Two rows: one finished, one not — so both verbs are on the page. */
function stages(ranAt: string | null): StageState[] {
  return [
    { step: "fetch", label: "Fetching the page", outputs: ["raw/a.html"], done: true, ranAt, startedAt: null, bytes: null },
    { step: "extract", label: "Reading it", outputs: ["output/a.html"], done: false, ranAt, startedAt: null, bytes: null },
  ];
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* The clock and the minute timer only: the page's own fetches resolve on
     real microtasks. */
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Mount with every stamp on the page at `when`, and open *AI processing*. */
async function mount(when: string | null): Promise<void> {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          slug: SLUG,
          dir: `spideryarn.article_revisions/${SLUG}`,
          stages: stages(when),
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
        article: article(when ?? undefined),
        onRenamed: () => {},
        onVisibility: () => {},
      }),
    );
  });
  const disclosure = [...(host.querySelector("main")?.querySelectorAll("h2 button") ?? [])].find((b) =>
    b.textContent?.includes("AI processing"),
  ) as HTMLButtonElement | undefined;
  expect(disclosure, "no AI processing disclosure — the page shape moved").toBeTruthy();
  await act(async () => disclosure?.click());
}

/** The three places, as the reader reads them. */
function said(): { ran: string; lastWrote: string; pipeline: string; fetched: string } {
  const triggers = [...host.querySelectorAll("button")].map((b) => b.textContent ?? "");
  /* The heading's aside, read off the one leaf element that holds it — the
     whole page's text has no boundary after it to cut on. */
  const aside = [...host.querySelectorAll("*")]
    .filter((el) => el.children.length === 0)
    .map((el) => (el.textContent ?? "").trim())
    .find((t) => t.startsWith("1 of 2 stages"));
  return {
    ran: triggers.find((t) => t.startsWith("ran ")) ?? "(no 'ran' trigger)",
    lastWrote: triggers.find((t) => t.startsWith("last wrote ")) ?? "(no 'last wrote' trigger)",
    pipeline: /^1 of 2 stages · (last wrote .*)$/.exec(aside ?? "")?.[1] ?? "(no pipeline line)",
    fetched: [...host.querySelectorAll("span")].map((s) => s.textContent ?? "").find((t) => t.startsWith("fetched ")) ??
      "(no 'fetched')",
  };
}

describe("the metadata page's relative times", () => {
  it("a stamp a few seconds in the future is 'just now', never 'in 4 seconds'", async () => {
    await mount(at(4 * SECOND));
    expect(said()).toEqual({
      ran: "ran just now",
      lastWrote: "last wrote just now",
      pipeline: "last wrote just now",
      fetched: "fetched just now",
    });
    expect(host.textContent).not.toMatch(/\bin \d+ seconds?\b/);
  });

  it("a recent stamp is relative", async () => {
    await mount(at(-10 * DAY));
    const ago = timeAgo(at(-10 * DAY), NOW);
    expect(ago).toMatch(/10/);
    expect(said()).toEqual({
      ran: `ran ${ago}`,
      lastWrote: `last wrote ${ago}`,
      pipeline: `last wrote ${ago}`,
      fetched: `fetched ${ago}`,
    });
  });

  it("an old stamp is 'on <date>', which is a sentence after each of the three verbs", async () => {
    await mount(at(-60 * DAY));
    const date = timeAgo(at(-60 * DAY), NOW);
    expect(date, "past a month the shared formatter hands back a date").toMatch(/2026/);
    expect(said()).toEqual({
      ran: `ran on ${date}`,
      lastWrote: `last wrote on ${date}`,
      pipeline: `last wrote on ${date}`,
      fetched: `fetched on ${date}`,
    });
  });

  it("moves as the clock does, on a page nothing else re-renders", async () => {
    await mount(at(-2 * MINUTE));
    const before = said();
    expect(before.ran).toBe(`ran ${timeAgo(at(-2 * MINUTE), NOW)}`);

    await act(async () => {
      vi.advanceTimersByTime(3 * MINUTE);
    });
    const later = `${timeAgo(at(-2 * MINUTE), NOW + 3 * MINUTE)}`;
    expect(later).not.toBe(timeAgo(at(-2 * MINUTE), NOW));
    expect(said()).toEqual({
      ran: `ran ${later}`,
      lastWrote: `last wrote ${later}`,
      pipeline: `last wrote ${later}`,
      fetched: `fetched ${later}`,
    });
  });

  it("an unreadable stamp still draws nothing, rather than a wrong time", async () => {
    await mount("soon");
    expect(said()).toEqual({
      ran: "(no 'ran' trigger)",
      lastWrote: "(no 'last wrote' trigger)",
      pipeline: "(no pipeline line)",
      fetched: "(no 'fetched')",
    });
    expect(host.textContent).toContain("1 of 2 stages");
  });
});
