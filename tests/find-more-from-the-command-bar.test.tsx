// @vitest-environment jsdom
/**
 * **A *Find more* press from the command bar, as the band takes it** — Stage 2
 * of docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md.
 * The bar's half (the rows, the hand-off's own rules) is
 * tests/find-more-commands.test.tsx.
 *
 * The bar posts nothing: it leaves a one-shot hand-off and opens the band, and
 * the band presses **the function its own Find more button calls**, once, in
 * the list's own profile setting — and only if a fresh Find more is what the
 * band is offering at that moment (GPT Sol's F1, F2). Otherwise the press is
 * **taken and dropped**, so it cannot fire seconds later when a job finishes.
 *
 * Two halves:
 *
 *  1. **The real bands over the real hooks**, under `<StrictMode>` — which runs
 *     every effect twice on mount, the case a take that is not atomic fails —
 *     counting what reaches the job queue: one request, forced, and
 *     `useProfile: false` exactly when the list was written without a profile.
 *  2. **The panels over a posed owner**, one state at a time. For every state
 *     in which Find more is not offered, nothing is pressed — **and nothing is
 *     pressed when the same mounted band then becomes eligible** inside the
 *     hand-off's ten seconds (F6): "no immediate press" alone would pass for a
 *     consumer that left the hand-off waiting.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryOwner } from "../src/web/GlossaryPanel.js";
import type { QuotesOwner } from "../src/web/QuotesPanel.js";
import {
  MAX_QUOTES_TOTAL,
  type BlockId,
  type Glossary,
  type GlossaryResponse,
  type Job,
  type Quote,
  type Quotes,
  type QuotesResponse,
} from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const BLOCK = "spya-adq4zt" as BlockId;

/** Every job the bands asked the queue for. */
let jobPosts: unknown[] = [];
/** What the two reads answer with. */
let glossaryAnswer: GlossaryResponse;
let quotesAnswer: QuotesResponse;

function glossaryList(profileHash: string | null): Glossary {
  return {
    version: "glossary/5",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    profileHash,
    entries: [
      {
        id: "spya-adq5wr",
        name: "Win-shift",
        kind: "concept",
        aliases: [],
        senseHere: "What it means here.",
        blocks: [BLOCK],
      },
    ],
    passes: 1,
    generatedAt: "2026-10-01T09:00:00.000Z",
    elapsedMs: 1,
  } as unknown as Glossary;
}

function quote(i: number): Quote {
  return {
    id: `spya-q${String(i).padStart(4, "0")}`,
    blockId: BLOCK,
    text: `Line number ${i} of the piece, long enough.`,
    importance: 0.9,
  } as Quote;
}

function quotesList(over: Partial<Quotes> = {}): Quotes {
  return {
    version: "quotes/5",
    generator: "m",
    slug: SLUG,
    sourceHash: "h",
    profileHash: null,
    quotes: [quote(1), quote(2)],
    discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    generatedAt: "2026-10-01T00:00:00.000Z",
    elapsedMs: 1,
    passes: 1,
    lastAdded: 2,
    ...over,
  } as Quotes;
}

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

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string) => {
      const body = input.startsWith("/api/quotes/") ? quotesAnswer : glossaryAnswer;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
    readJson: async (res: Response) => {
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? String(res.status));
      return data;
    },
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
  };
  return api;
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async (request: unknown) => {
      jobPosts.push(request);
      return null;
    },
    retry: async () => null,
    cancel: async () => {},
  }),
}));

const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { useQuotesRead } = await import("../src/web/useQuotes.js");
const { GlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");
const { QuotesBand } = await import("../src/web/modes/quotes/QuotesMode.js");
const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");
const { QuotesPanel } = await import("../src/web/QuotesPanel.js");
const { readingExecutor } = await import("../src/web/command-runners.js");
const { pendingFindMore, resetFindMoreForTests } = await import("../src/web/find-more-handoff.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { pendingActivation, resetActivations } = await import("../src/web/activation.js");

enableHistorySync();

const noop = () => {};
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  jobPosts = [];
  glossaryAnswer = {
    glossary: glossaryList(null),
    stale: false,
    outdated: false,
    profileChanged: false,
    panelRun: "append",
  } as unknown as GlossaryResponse;
  quotesAnswer = { quotes: quotesList(), stale: false, outdated: false, profileChanged: false };
  resetFindMoreForTests();
  resetActivations();
  history.replaceState(null, "", `/read/${SLUG}?mode=glossary&sort=document`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function draw(element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(NuqsAdapter, null, element)));
  });
  await settle();
}

/**
 * The bar's press, as the reading view builds it — the mover is a plain move.
 *
 * **And the job list it asks for, answered.** A press is taken only on a list
 * asked for after it (code review F11), and the queue here is posed, with no
 * engine polling behind it — so the list is handed to the engine directly.
 * What the band then makes of the press is this file's subject; the wait
 * itself, over the real engine, is
 * tests/find-more-waits-for-a-fresh-job-list.test.tsx.
 */
function pressFindMore(mode: "glossary" | "quotes", slug = SLUG): void {
  const executor = readingExecutor({ slug, blocks: [], jump: noop, findMore: { [mode]: noop } });
  executor.findMore?.[mode]?.();
  jobEngine.receive([]);
}

/* ------------------------------------------- the real bands, real hooks -- */

function GlossaryReading(): ReactElement {
  const read = useGlossaryRead(SLUG);
  return createElement(GlossaryBand, { slug: SLUG, read, onJump: noop, onSelected: noop, onAskChat: noop });
}

function QuotesReading(): ReactElement {
  const read = useQuotesRead(SLUG);
  return createElement(QuotesBand, {
    slug: SLUG,
    read,
    onJump: noop,
    steps: [],
    yours: { rows: [], blocks: [], onOpen: noop },
  });
}

describe("the glossary band, opened by the bar's Find more", () => {
  it("posts one forced run, plainly for a list written without a profile, and arms nothing", async () => {
    pressFindMore("glossary");
    expect(pendingActivation(SLUG, "glossary")).toBeNull();
    await draw(createElement(GlossaryReading));
    expect(jobPosts).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"], useProfile: false }]);
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
  });

  it("posts it for the profile when the list was written for one", async () => {
    glossaryAnswer = { ...glossaryAnswer, glossary: glossaryList("the-profile") };
    pressFindMore("glossary");
    await draw(createElement(GlossaryReading));
    expect(jobPosts).toEqual([{ slug: SLUG, steps: ["glossary"], force: ["glossary"] }]);
  });

  it("posts nothing when the band opens on its own, or for another article's press", async () => {
    pressFindMore("glossary", "another-piece");
    await draw(createElement(GlossaryReading));
    expect(host.textContent).toContain("Find more");
    expect(jobPosts).toEqual([]);
  });

  it("posts nothing for a press that was for Quotes", async () => {
    pressFindMore("quotes");
    await draw(createElement(GlossaryReading));
    expect(jobPosts).toEqual([]);
  });

  it("posts nothing, ever, when the server says the run would rewrite the list", async () => {
    glossaryAnswer = { ...glossaryAnswer, panelRun: "rewrite" };
    pressFindMore("glossary");
    await draw(createElement(GlossaryReading));
    expect(host.textContent).toContain("Write a new list");
    expect(jobPosts).toEqual([]);
    expect(pendingFindMore(SLUG, "glossary")).toBeNull();
  });
});

describe("the quotes band, opened by the bar's Find more", () => {
  beforeEach(() => {
    history.replaceState(null, "", `/read/${SLUG}?mode=quotes`);
  });

  it("posts one forced run, plainly for a list chosen without a profile", async () => {
    pressFindMore("quotes");
    await draw(createElement(QuotesReading));
    expect(jobPosts).toEqual([{ slug: SLUG, steps: ["quotes"], force: ["quotes"], useProfile: false }]);
    expect(pendingFindMore(SLUG, "quotes")).toBeNull();
  });

  it("posts it for the profile when the list was chosen for one", async () => {
    quotesAnswer = { ...quotesAnswer, quotes: quotesList({ profileHash: "the-profile" }) };
    pressFindMore("quotes");
    await draw(createElement(QuotesReading));
    expect(jobPosts).toEqual([{ slug: SLUG, steps: ["quotes"], force: ["quotes"] }]);
  });

  it("posts nothing when the band opens on its own", async () => {
    await draw(createElement(QuotesReading));
    expect(host.textContent).toContain("Find more");
    expect(jobPosts).toEqual([]);
  });

  it("posts nothing, ever, on a list at the ceiling", async () => {
    quotesAnswer = {
      ...quotesAnswer,
      quotes: quotesList({ quotes: Array.from({ length: MAX_QUOTES_TOTAL }, (_, i) => quote(i)) }),
    };
    pressFindMore("quotes");
    await draw(createElement(QuotesReading));
    expect(host.textContent).toContain("as many as we keep");
    expect(jobPosts).toEqual([]);
    expect(pendingFindMore(SLUG, "quotes")).toBeNull();
  });
});

/* ---------------------------------------------- the panels, posed owners -- */

const JOB = {
  id: "job-1",
  slug: SLUG,
  status: "running",
  steps: [{ name: "glossary", status: "running" }],
  createdAt: "2026-10-04T10:00:00.000Z",
} as unknown as Job;

const RETRY = { message: "It stopped.", retryable: true, retry: noop };
const REFUSED_POST = { message: "Couldn't start the job.", retryable: true, retry: null };
const FOR_GOOD = { message: "No more runs on this plan. [pay-free]", retryable: false, retry: null };

function glossaryOwner(over: Partial<GlossaryOwner> = {}): GlossaryOwner {
  const list = glossaryList(null);
  return {
    status: "ready",
    glossary: list,
    stale: false,
    outdated: false,
    panelRun: "append",
    profiled: false,
    profileChanged: false,
    slug: SLUG,
    error: null,
    retryRead: async () => {},
    loaded: true,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    rewriting: false,
    find: async () => {},
    more: async () => {},
    refresh: async () => {},
    cancel: noop,
    look: async () => false,
    setHidden: async () => {},
    hiding: new Set<string>(),
    looking: null,
    lookFailed: null,
    lookDraft: null,
    lookKept: null,
    ask: async () => {},
    asking: false,
    askDraft: null,
    asked: null,
    askFailed: null,
    askTerm: null,
    clearAsked: noop,
    ...over,
  };
}

function glossaryPanel(view: GlossaryOwner): ReactElement {
  return createElement(GlossaryPanel, {
    access: { kind: "owner", owner: view, glossary: view.glossary },
    termId: null,
    onTerm: noop,
    sort: "prioritised",
    onSort: noop,
    gate: null,
    onGate: noop,
    onJump: noop,
    onAskChat: noop,
  });
}

function quotesOwner(over: Partial<QuotesOwner> = {}): QuotesOwner {
  return {
    status: "ready",
    quotes: quotesList(),
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    slug: SLUG,
    error: null,
    retryRead: async () => {},
    loaded: true,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: noop,
    ...over,
  };
}

function quotesPanel(view: QuotesOwner): ReactElement {
  return createElement(QuotesPanel, {
    access: { kind: "owner", owner: view, quotes: view.quotes },
    quoteId: null,
    onQuote: noop,
    rank: "document",
    onRank: noop,
    bar: null,
    onBar: noop,
    onJump: noop,
    steps: [],
  });
}

describe("the glossary panel takes the press", () => {
  it("presses its own Find more once, in the list's own setting", async () => {
    const more = vi.fn(async () => {});
    pressFindMore("glossary");
    await draw(glossaryPanel(glossaryOwner({ more })));
    expect(more.mock.calls).toEqual([[false]]);

    const forProfile = vi.fn(async () => {});
    pressFindMore("glossary");
    await draw(glossaryPanel(glossaryOwner({ more: forProfile, profiled: true, glossary: glossaryList("p") })));
    expect(forProfile.mock.calls).toEqual([[true]]);
  });

  it("waits for a read that has not settled, then presses once", async () => {
    const more = vi.fn(async () => {});
    pressFindMore("glossary");
    await draw(glossaryPanel(glossaryOwner({ more, status: "loading", glossary: null, panelRun: undefined })));
    expect(more).not.toHaveBeenCalled();
    expect(pendingFindMore(SLUG, "glossary")).not.toBeNull();
    await draw(glossaryPanel(glossaryOwner({ more })));
    expect(more.mock.calls).toEqual([[false]]);
  });

  it("waits for the first job poll, then drops the press when it finds a run", async () => {
    const more = vi.fn(async () => {});
    pressFindMore("glossary");
    await draw(glossaryPanel(glossaryOwner({ more, loaded: false })));
    expect(more).not.toHaveBeenCalled();
    expect(pendingFindMore(SLUG, "glossary")).not.toBeNull();

    await draw(glossaryPanel(glossaryOwner({ more, loaded: true, job: JOB })));
    expect(more).not.toHaveBeenCalled();
    expect(pendingFindMore(SLUG, "glossary"), "taken after the queue has an answer").toBeNull();
  });

  it.each([
    ["there is no list", { status: "none", glossary: null, panelRun: undefined }],
    ["the read failed", { status: "error", glossary: null, panelRun: undefined, error: "No." }],
    ["the run would rewrite the list", { panelRun: "rewrite", outdated: true }],
    [
      "there is no verdict, on a profiled list whose profile has changed (F2)",
      { panelRun: undefined, profiled: true, profileChanged: true, glossary: glossaryList("an-old-profile") },
    ],
    ["a job is running", { job: JOB }],
    ["the POST is out", { starting: true }],
    ["a run stopped and offers Retry", { failed: RETRY }],
    ["a POST was refused", { failed: REFUSED_POST }],
    ["a run failed for good", { failed: FOR_GOOD }],
    ["a forced run's list has not loaded", { rewriting: true }],
  ] as [string, Partial<GlossaryOwner>][])(
    "drops it when %s — and stays dropped when the band becomes eligible",
    async (_, state) => {
      const more = vi.fn(async () => {});
      pressFindMore("glossary");
      await draw(glossaryPanel(glossaryOwner({ more, ...state })));
      expect(more).not.toHaveBeenCalled();
      expect(pendingFindMore(SLUG, "glossary"), "taken, not left waiting").toBeNull();

      /* The same mounted band, eligible, well inside the ten seconds. */
      await draw(glossaryPanel(glossaryOwner({ more })));
      expect(host.textContent).toContain("Find more");
      expect(more).not.toHaveBeenCalled();
    },
  );
});

describe("the quotes panel takes the press", () => {
  it("presses its own Find more once, in the list's own setting", async () => {
    const regenerate = vi.fn(async () => {});
    pressFindMore("quotes");
    await draw(quotesPanel(quotesOwner({ regenerate })));
    expect(regenerate.mock.calls).toEqual([[false]]);

    const forProfile = vi.fn(async () => {});
    pressFindMore("quotes");
    await draw(quotesPanel(quotesOwner({ regenerate: forProfile, profiled: true })));
    expect(forProfile.mock.calls).toEqual([[true]]);
  });

  it("waits for a read that has not settled, then presses once", async () => {
    const regenerate = vi.fn(async () => {});
    pressFindMore("quotes");
    await draw(quotesPanel(quotesOwner({ regenerate, status: "loading", quotes: null })));
    expect(regenerate).not.toHaveBeenCalled();
    await draw(quotesPanel(quotesOwner({ regenerate })));
    expect(regenerate.mock.calls).toEqual([[false]]);
  });

  it("waits for the first job poll, then drops the press when it finds a run", async () => {
    const regenerate = vi.fn(async () => {});
    pressFindMore("quotes");
    await draw(quotesPanel(quotesOwner({ regenerate, loaded: false })));
    expect(regenerate).not.toHaveBeenCalled();
    expect(pendingFindMore(SLUG, "quotes")).not.toBeNull();

    await draw(
      quotesPanel(
        quotesOwner({
          regenerate,
          loaded: true,
          job: { ...JOB, steps: [{ name: "quotes", status: "running" }] } as unknown as Job,
        }),
      ),
    );
    expect(regenerate).not.toHaveBeenCalled();
    expect(pendingFindMore(SLUG, "quotes"), "taken after the queue has an answer").toBeNull();
  });

  it.each([
    ["there is no list", { status: "none", quotes: null }],
    ["the article moved", { stale: true }],
    ["an older prompt chose them", { outdated: true }],
    ["the list is at the ceiling", { quotes: quotesList({ quotes: Array.from({ length: MAX_QUOTES_TOTAL }, (_, i) => quote(i)) }) }],
    ["a job is running", { job: { ...JOB, steps: [{ name: "quotes", status: "running" }] } as unknown as Job }],
    ["the POST is out", { starting: true }],
    ["a run stopped and offers Retry", { failed: RETRY }],
    ["a POST was refused", { failed: REFUSED_POST }],
    ["a run failed for good", { failed: FOR_GOOD }],
  ] as [string, Partial<QuotesOwner>][])(
    "drops it when %s — and stays dropped when the band becomes eligible",
    async (_, state) => {
      const regenerate = vi.fn(async () => {});
      pressFindMore("quotes");
      await draw(quotesPanel(quotesOwner({ regenerate, ...state })));
      expect(regenerate).not.toHaveBeenCalled();
      expect(pendingFindMore(SLUG, "quotes"), "taken, not left waiting").toBeNull();

      await draw(quotesPanel(quotesOwner({ regenerate })));
      expect(host.textContent).toContain("Find more");
      expect(regenerate).not.toHaveBeenCalled();
    },
  );
});
