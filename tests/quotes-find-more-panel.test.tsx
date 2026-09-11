// @vitest-environment jsdom
/**
 * **The panel's half of Find more** — which button a reader is offered in
 * each state, and what pressing it sends. Greg, 2026-09-10
 * (SPIDERYARN-READING2-2W):
 *
 * > Remove the "Choose them again" button, and add a "Find more" button
 *
 * The table this holds is docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md § 3:
 *
 * | state | banner | foot |
 * |---|---|---|
 * | current | — | Find more |
 * | outdated | says Find more uses the current prompt, no button | Find more |
 * | stale | Choose them again | — |
 * | at the ceiling | — | the sentence, no button |
 *
 * The stage's half — that a forced run appends — is tests/quotes-find-more.test.ts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotesOwner } from "../src/web/QuotesPanel.js";
import { MAX_QUOTES_TOTAL, type Quote, type Quotes } from "../src/types.js";

/* The same two stubs tests/mode-surface-changes-no-markup.test.tsx installs, for
   its reasons: the profile hook fetches on mount, and src/web/lib/api.ts reaches
   supabase at module scope. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

const { QuotesPanel } = await import("../src/web/QuotesPanel.js");

const noop = () => {};

function quote(i: number): Quote {
  return { id: `spya-q${String(i).padStart(4, "0")}`, blockId: "spya-aaaaaa", text: `Line number ${i} of the piece, long enough.`, importance: 0.9 };
}

function list(over: Partial<Quotes> = {}): Quotes {
  return {
    version: "quotes/4",
    generator: "m",
    slug: "writes",
    sourceHash: "h",
    profileHash: null,
    quotes: [quote(1), quote(2)],
    discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    generatedAt: "2026-09-11T00:00:00.000Z",
    elapsedMs: 1,
    passes: 1,
    lastAdded: 2,
    ...over,
  };
}

function owner(quotes: Quotes, over: Partial<QuotesOwner> = {}): QuotesOwner {
  return {
    status: "ready",
    quotes,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    hasProfile: false,
    slug: "writes",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: noop,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(o: QuotesOwner): Promise<void> {
  await act(async () =>
    root.render(
      createElement(QuotesPanel, {
        access: { kind: "owner", owner: o, quotes: o.quotes },
        quoteId: null,
        onQuote: noop,
        rank: "document",
        onRank: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
      }),
    ),
  );
}

const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
const foot = () => host.querySelector(".quotes-foot");
const banner = () => host.querySelector(".quotes-stale");

describe("the foot", () => {
  it("offers Find more beside a current list, and nothing called Choose them again anywhere", async () => {
    await mount(owner(list()));
    expect(foot()?.textContent).toContain("Find more");
    expect(buttons().some((b) => /choose them again/i.test(b))).toBe(false);
  });

  it("sends the forced run with the LIST's own profile setting, and shows no checkbox", async () => {
    /* Find more continues the list rather than choosing it for somebody else:
       src/quotes.ts § existingFor keeps the first pass's stamp, so the pass
       has to be asked the way the list was. */
    const regenerate = vi.fn(async () => {});
    await mount(owner(list({ profileHash: "p" }), { profiled: true, hasProfile: true, regenerate }));
    expect(foot()?.querySelector('input[type="checkbox"]')).toBeNull();
    const find = [...(foot()?.querySelectorAll("button") ?? [])].find((b) => /find more/i.test(b.textContent ?? ""));
    expect(find).toBeDefined();
    await act(async () => find?.click());
    expect(regenerate).toHaveBeenCalledWith(true);
  });

  it("says so when the last Find more added nothing, rather than looking like a dead button", async () => {
    await mount(owner(list({ passes: 2, lastAdded: 0 })));
    expect(foot()?.textContent).toContain("Nothing more worth keeping turned up.");
  });

  it("does not say it on a first pass", async () => {
    await mount(owner(list({ passes: 1, lastAdded: 2 })));
    expect(foot()?.textContent).not.toContain("Nothing more");
  });

  it("stops offering Find more at the ceiling, and says why", async () => {
    const full = Array.from({ length: MAX_QUOTES_TOTAL }, (_, i) => quote(i));
    await mount(owner(list({ quotes: full })));
    expect(foot()?.textContent).toContain("as many as we keep");
    expect(foot()?.textContent).not.toContain("Find more");
  });
});

describe("the banners", () => {
  it("an outdated list: says Find more uses the current prompt, and has no button of its own", async () => {
    await mount(owner(list({ version: "quotes/3" }), { outdated: true }));
    expect(banner()?.textContent).toContain("Find more uses the current one");
    expect(banner()?.querySelector("button")).toBeNull();
    expect(foot()?.textContent).toContain("Find more");
  });

  it("a stale list: Choose them again on the banner — the one place it survives — and no Find more", async () => {
    await mount(owner(list(), { stale: true }));
    expect(banner()?.textContent).toContain("Choose them again");
    expect(foot()).toBeNull();
    expect(buttons().some((b) => /find more/i.test(b))).toBe(false);
  });

  it("labels a profiled list whose profile was deleted as older, not written for you", async () => {
    await mount(
      owner(list({ profileHash: "the-first-pass" }), {
        profiled: true,
        profileChanged: true,
        hasProfile: false,
      }),
    );
    const badge = host.querySelector(".prof-badge");
    expect(badge?.textContent).toContain("older profile");
    expect(badge?.textContent).not.toContain("written for you");
  });
});
