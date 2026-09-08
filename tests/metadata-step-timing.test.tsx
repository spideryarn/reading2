// @vitest-environment jsdom
/**
 * **What a step row's card says: the exact instant, and how long the step took.**
 *
 * Greg, 2026-09-07 (`SPIDERYARN-READING2-2K`):
 *
 * > In the Metadata page in what we did to it, can you make sure it has a
 * > tooltip for exactly when it happened, rather than only showing the
 * > human-readable version? And also, how long it took.
 *
 * Half of that already existed and half did not, so this file is arranged
 * around the difference — see
 * docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md.
 *
 * **The card is asserted on, not the row.** The row deliberately keeps saying
 * "ran 3 days ago" and nothing else; a test that read the row would go green on
 * a change that dropped the card entirely, which is the whole feature.
 *
 * **The three ways the duration declines are each their own case**, because
 * they are three different kinds of not-knowing that a `0` would flatten into
 * one, and because the sentence that must survive all three is the exact stamp
 * beside it. A card that lost its timestamp along with its duration would pass
 * a check that only asked whether "took" was absent.
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

/* The same two stubs as tests/metadata-page-order.test.tsx, for the same
   reasons: `?at=` needs a nuqs adapter this file has no use for, and the dock
   is a fixed bar with fetches of its own. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { Metadata, tookFor } = await import("../src/web/Metadata.js");
const { howLong } = await import("../src/web/relative-time.js");

const SLUG = "temporal-context-reinstatement-spya-dhqkf9";

/* Eight and a bit seconds, so the duration is a string no other number on the
   page could be mistaken for. */
const BEGAN = "2026-09-03T12:20:43.400Z";
const FINISHED = "2026-09-03T12:20:51.800Z";

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

function stages(startedAt: string | null, ranAt: string | null = FINISHED): StageState[] {
  return [
    {
      step: "fetch",
      label: "Fetching the page",
      outputs: ["raw/a.html"],
      done: true,
      ranAt,
      startedAt,
      bytes: null,
    },
  ];
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function answer(stageRows: StageState[]) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          slug: SLUG,
          dir: `spideryarn.article_revisions/${SLUG}`,
          stages: stageRows,
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

/**
 * Mount the page, open *Technical details*, and hand back the step row's card.
 *
 * **The disclosure is not an implementation detail here.** `What we did to it`
 * is a subheading inside the shut `Technical details` section, so a test that
 * only mounted would find no rows at all — measured in a browser before this
 * file was written, and it is the likeliest reason the existing card went
 * unfound.
 *
 * Opening the card is `mouseenter` and a 400ms wait, and reading it means
 * looking in the **document** rather than in `host`: Floating UI portals the
 * panel to the end of `<body>`. Both borrowed from
 * tests/referee-tooltips.test.tsx, where they were found the hard way.
 */
async function cardText(stageRows: StageState[]): Promise<string> {
  answer(stageRows);
  const a = article();
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

  const disclosure = [...(host.querySelector("main")?.querySelectorAll("h2 button") ?? [])].find(
    (b) => b.textContent?.includes("Technical details"),
  ) as HTMLButtonElement | undefined;
  expect(disclosure, "no Technical details disclosure — the page shape moved").toBeTruthy();
  await act(async () => disclosure?.click());

  const trigger = [...host.querySelectorAll("button")].find((b) =>
    /^(ran|last wrote) /.test(b.textContent ?? ""),
  );
  expect(trigger, "no 'ran … ago' trigger in the step row").toBeTruthy();

  trigger?.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering the step row's time opened no card, or more than one").toHaveLength(1);
  return (cards[0]?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("the card on a step row", () => {
  it("gives the exact instant as well as the relative one", async () => {
    const text = await cardText(stages(BEGAN));

    /* The year and the seconds, which is what "exact" buys over "4 days ago" —
       and not the whole formatted string, which is the runner's locale and
       timezone rather than a fact about the page. */
    expect(text).toContain("2026");
    expect(text).toMatch(/:\d\d:\d\d/);
  });

  it("says how long the step took", async () => {
    expect(await cardText(stages(BEGAN))).toContain("took 8.4s");
  });

  it("keeps the exact instant when there is no start to subtract", async () => {
    const text = await cardText(stages(null));

    expect(text).not.toContain("took");
    expect(text).toContain("2026");
  });

  it("keeps the exact instant when the start is unreadable", async () => {
    const text = await cardText(stages("not a date"));

    expect(text).not.toContain("took");
    expect(text).toContain("2026");
  });

  /**
   * A finish before its start is two clocks disagreeing, not a fact about the
   * article — so the card says nothing rather than "took -3s".
   */
  it("keeps the exact instant when the run appears to have finished first", async () => {
    const text = await cardText(stages(FINISHED, BEGAN));

    expect(text).not.toContain("took");
    expect(text).toContain("2026");
  });
});

describe("tookFor", () => {
  const finished = Date.parse(FINISHED);

  it("is the interval between the two stamps", () => {
    expect(tookFor(BEGAN, finished)).toBe("8.4s");
  });

  it("declines a missing start, an unreadable one, and a negative interval", () => {
    expect(tookFor(null, finished)).toBeNull();
    expect(tookFor("soon", finished)).toBeNull();
    expect(tookFor(FINISHED, Date.parse(BEGAN))).toBeNull();
  });

  /**
   * Zero is a duration, not an absence: a step whose start and finish landed in
   * the same millisecond really did take no measurable time, and saying so is
   * different from saying nothing.
   */
  it("keeps a zero interval", () => {
    expect(tookFor(FINISHED, finished)).toBe("0ms");
  });
});

/**
 * The boundaries, and every one of them is a boundary a naive implementation
 * gets wrong by rounding after the comparison rather than before it.
 *
 * **`howLong` is shared with the Tweets page** (`src/web/relative-time.ts`),
 * which had its own copy until 2026-09-08 — these are the cases the merge
 * added, and `tests/tweets-page.test.ts` still holds that page's own, which the
 * merged version passes unchanged.
 */
describe("howLong", () => {
  it("counts milliseconds below a second", () => {
    expect(howLong(0)).toBe("0ms");
    expect(howLong(37)).toBe("37ms");
    expect(howLong(999)).toBe("999ms");
  });

  it("does not print 1000ms", () => {
    expect(howLong(999.7)).toBe("1.0s");
    expect(howLong(1000)).toBe("1.0s");
  });

  it("counts tenths of a second up to a minute", () => {
    expect(howLong(8400)).toBe("8.4s");
    expect(howLong(59_949)).toBe("59.9s");
  });

  it("does not print 60.0s", () => {
    expect(howLong(59_960)).toBe("1m 0s");
    expect(howLong(60_000)).toBe("1m 0s");
  });

  it("counts minutes and whole seconds above that", () => {
    expect(howLong(92_000)).toBe("1m 32s");
    expect(howLong(3_600_000)).toBe("60m 0s");
  });

  /**
   * `3m 60s` — what you get from flooring the minutes and then rounding the
   * seconds up past them. The one case here that was a real bug in the first
   * draft rather than a hypothetical.
   */
  it("does not print sixty seconds past a minute", () => {
    expect(howLong(239_600)).toBe("4m 0s");
  });
});
