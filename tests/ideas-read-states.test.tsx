// @vitest-environment jsdom
/**
 * **What the Ideas read can be, and what every consumer draws for each** —
 * written against the code as it stood on 2026-10-07, before the spike in
 * docs/plans/261006n-one-type-for-a-read-spiked-on-useideas.md changed how
 * `useIdeasRead` stores its state. Every test here was watched to fail under a
 * deliberate one-line break of that code; the breaks are listed in the plan's
 * § What the spike found.
 *
 * Six things can be true of the read, and they are this file's vocabulary:
 * *asking*, *failed*, *none*, *none with a failed recheck*, *list*, and *list
 * with a failed recheck*. The consumers are the band (`IdeasBand` over
 * `IdeasPanel`), the automatic run (`useAutoRun`), Skim's gate (`useSkim`), and
 * Marginalia's feed (`OwnerMarginFeed`). Skim's stop card is in
 * tests/skim-panel.test.tsx, which has the harness for it.
 *
 * **How the state is read is in one place, `seen()`**, so a change to the
 * hook's interface changes that function and no assertion.
 *
 * The harness is tests/rewrite-hold.test.tsx's: the real hook, the real panel,
 * the real `useStepJob`, `useOrderedRead` and `apiFetch`; what is posed is
 * `fetch` and the queue transport (`useJobs`).
 */
import { act, createElement, type ReactNode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Job } from "../src/types.js";
import { PAGE_FAULT } from "../src/messages.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------------------------------------------------------------- the queue -- */

type Announce = (job: Job) => void;
const { live } = vi.hoisted(() => ({ live: new Set<{ cb: ((job: never) => void) | undefined }>() }));
let jobs: Job[] = [];
const posted: { slug: string; steps: string[]; force?: string[] }[] = [];
const job = (id: string, steps: string[], status: Job["status"], slug = SLUG) =>
  ({
    id,
    slug,
    status,
    steps: steps.map((name) => ({ name, status: status === "done" ? "done" : "pending" })),
    createdAt: "2026-10-07T12:00:00Z",
  }) as Job;
vi.mock("../src/web/useJobs.js", () => ({
  /* A hook, so it may keep which mounts are listening: a finished job is
     announced to every live subscriber, as the engine does. */
  useJobs: (_cadence: unknown, cb?: (job: never) => void) => {
    const mine = useRef({ cb });
    mine.current.cb = cb;
    useEffect(() => {
      const entry = mine.current;
      live.add(entry);
      return () => void live.delete(entry);
    }, []);
    return {
      jobs,
      loaded: true,
      driverFailures: {},
      lastFailure: () => null,
      run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
        posted.push(request);
        return job("the-rewrite", request.steps, "queued", request.slug);
      },
      cancel: async () => {},
      retry: async () => null,
    };
  },
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

/* No offline copy, ever: a failed GET here is a failed read, never a 200 from
   the store. tests/rewrite-hold.test.tsx owns the offline cases. */
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => {},
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => "owner-1",
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

const SLUG = "a-piece";
const OTHER = "another-piece";
const BLOCKS: Block[] = [
  { id: "spya-aaaaaa" as BlockId, tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
  { id: "spya-bbbbbb" as BlockId, tag: "p", kind: "text", text: "The instrument was built first.", words: 5, html: "<p>The instrument was built first.</p>", gistable: true },
];

/* -------------------------------------------------------------- the network -- */

interface Flags {
  stale?: boolean;
  outdated?: boolean;
  profileChanged?: boolean;
  /** `undefined` leaves the field off the artefact altogether. */
  profileHash?: string | null | undefined;
}
const AT = { first: "2026-09-01T09:00:00.000Z", second: "2026-10-04T09:00:00.000Z" };
/** A stored list whose one idea is called `name`. Every flag defaults to off. */
function list(name: string, flags: Flags = {}, at: string = AT.first, slug = SLUG) {
  const artefact: Record<string, unknown> = {
    version: "ideas/t",
    generator: "test",
    slug,
    sourceHash: "hash",
    generatedAt: at,
    elapsedMs: 1,
    ideas: [
      {
        id: "spya-kdea34",
        name,
        provenance: "assumed",
        statement: "You cannot theorise about what you cannot measure.",
        occurrences: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", reasoning: "It rests on it." }],
      },
    ],
  };
  if (!("profileHash" in flags)) artefact.profileHash = null;
  else if (flags.profileHash !== undefined) artefact.profileHash = flags.profileHash;
  return {
    ideas: artefact,
    stale: flags.stale ?? false,
    outdated: flags.outdated ?? false,
    profileChanged: flags.profileChanged ?? false,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FIRST_FAILURE = "The first thing that went wrong.";
const SECOND_FAILURE = "A different thing went wrong.";
/** The server answered, and it was a failure, in the server's own sentence. */
const broken = (sentence = FIRST_FAILURE) => () => json({ error: sentence }, 500);
const noneYet = () => json(null);
/** The connection dropped, and there is no offline copy to answer from. */
const dropped = () => Promise.reject(new TypeError("Load failed"));
const serves = (body: unknown) => () => json(body);

type Serve = () => Response | Promise<Response>;
/** What each article's Ideas GET answers next. Reassigned by each test as it goes. */
let serve: Record<string, Serve> = {};
let reads: Record<string, number> = {};
const answer = (next: Serve, slug = SLUG) => {
  serve[slug] = next;
};
/**
 * **Keep the next reads in the air.** Every Ideas GET for `slug` from now waits
 * for `land`, which says what they all answer. A test reads the screen between
 * the two — the only way to see what a read in flight draws.
 */
function hold(slug = SLUG): { land(next: Serve): Promise<void> } {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let landing: Serve = noneYet;
  serve[slug] = async () => {
    await gate;
    return landing();
  };
  return {
    land: async (next) => {
      landing = next;
      /* Reads asked after it lands answer straight away. */
      serve[slug] = next;
      await act(async () => open());
      await flush();
    },
  };
}

/* ---------------------------------------------------------------- the mounts -- */

const noop = () => {};

const { IdeasBand } = await import("../src/web/modes/ideas/IdeasMode.js");
const { useIdeasRead } = await import("../src/web/useIdeas.js");
const { useSkim } = await import("../src/web/useSkim.js");
const { OwnerMarginFeed } = await import("../src/web/marginalia/MarginaliaColumn.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { armActivation, resetActivations } = await import("../src/web/activation.js");
type IdeasRead = import("../src/web/useIdeas.js").IdeasRead;
type UseSkim = import("../src/web/useSkim.js").UseSkim;
type QuotesRead = import("../src/web/useQuotes.js").QuotesRead;
type MarginFeed = import("../src/web/marginalia/MarginaliaColumn.js").MarginFeed;

/** The Quotes, there and current, so the only prerequisite in question is the Ideas. */
const QUOTES: QuotesRead = {
  status: "ready",
  quotes: { quotes: [] } as unknown as QuotesRead["quotes"],
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};

let read: IdeasRead | null = null;
let skim: UseSkim | null = null;
/** Every `reload` and `refresh` the read has handed out, for the identity claim. */
const handed: { reload: unknown; refresh: unknown }[] = [];

/** The read alone, and Skim's gate standing on it — as `SkimBand` wires them. */
function Probe({ slug, withSkim }: { slug: string; withSkim: boolean }) {
  const ideas = useIdeasRead(slug);
  read = ideas;
  handed.push({ reload: ideas.reload, refresh: ideas.refresh });
  return withSkim ? createElement(SkimGate, { slug, ideas }) : null;
}
function SkimGate({ slug, ideas }: { slug: string; ideas: IdeasRead }) {
  skim = useSkim(slug, QUOTES, ideas);
  return null;
}

let feed: MarginFeed | null = null;
const onFeed = (next: MarginFeed) => {
  feed = next;
};

type Part = "band" | "probe" | "skim" | "margin";
let host: HTMLDivElement;
let root: Root;

const flush = async () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
async function mount(parts: Part[], slug = SLUG) {
  const children: ReactNode[] = [];
  if (parts.includes("band")) {
    children.push(
      createElement(IdeasBand, { key: "band", slug, blocks: BLOCKS, onJump: noop, onFound: noop, openKey: null, onOpenKey: noop }),
    );
  }
  if (parts.includes("probe") || parts.includes("skim")) {
    children.push(createElement(Probe, { key: "probe", slug, withSkim: parts.includes("skim") }));
  }
  if (parts.includes("margin")) {
    /* `shown: false`: the relation words are the one thing this feed can buy. */
    children.push(createElement(OwnerMarginFeed, { key: "margin", slug, shown: false, onFeed }));
  }
  await act(async () =>
    root.render(
      createElement(NuqsTestingAdapter, { searchParams: "", hasMemory: true } as Parameters<typeof NuqsTestingAdapter>[0], children),
    ),
  );
  await flush();
}

/* ------------------------------------------------------- reading the screen -- */

const buttons = (label: string) =>
  [...document.querySelectorAll("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label,
  );
const press = async (label: string) => {
  const [b] = buttons(label);
  expect(b, `a button named ${label} to press`).toBeDefined();
  await act(async () => b!.click());
};

const LOOKING = "Looking for the ideas…";
const NOBODY = "Nobody has found the ideas for this one yet.";
const OLDER = "These describe an older version of the article.";

interface Screen {
  /** The quiet line of a read with nothing to show yet. */
  looking: boolean;
  /** The failed read's sentence, or null when none is drawn. */
  error: string | null;
  tryAgain: boolean;
  /** The empty state's own sentence. */
  nobody: boolean;
  /** The empty state's button — the one that spends. */
  find: boolean;
  /** The ideas drawn, by name. */
  names: string[];
  /** The stale banner. */
  older: boolean;
  /** The profile badge in the band's corner. */
  badge: "none" | "written" | "changed";
  /** The footer that carries a current list's job. */
  foot: boolean;
}
function screen(): Screen {
  const band = host.querySelector(".mode-band.ideas");
  if (!band) throw new Error("the Ideas band is not on screen");
  const text = band.textContent ?? "";
  const badge = band.querySelector(".prof-badge");
  return {
    looking: text.includes(LOOKING),
    error: band.querySelector('[role="alert"]')?.textContent ?? null,
    tryAgain: buttons("Try again").length > 0,
    nobody: text.includes(NOBODY),
    find: buttons("Find the ideas").length > 0,
    names: [...band.querySelectorAll(".ideas-name")].map((n) => n.textContent ?? ""),
    older: text.includes(OLDER),
    badge: badge === null ? "none" : badge.classList.contains("changed") ? "changed" : "written",
    foot: band.querySelector(".ideas-again") !== null,
  };
}
/** The screens the six states draw; a test spreads one and names what differs. */
const BLANK: Screen = {
  looking: false,
  error: null,
  tryAgain: false,
  nobody: false,
  find: false,
  names: [],
  older: false,
  badge: "none",
  foot: false,
};
const ASKING: Screen = { ...BLANK, looking: true };
const FAILED = (error: string): Screen => ({ ...BLANK, error, tryAgain: true });
const NONE: Screen = { ...BLANK, nobody: true, find: true };
const NONE_RECHECK = (error: string): Screen => ({ ...NONE, error, tryAgain: true });
const LIST = (name: string): Screen => ({ ...BLANK, names: [name] });
const LIST_RECHECK = (name: string, error: string): Screen => ({ ...LIST(name), error, tryAgain: true });

/* --------------------------------------------------------- reading the hook -- */

type ReadClass = "asking" | "failed" | "none" | "none, recheck failed" | "list" | "list, recheck failed";
interface Seen {
  is: ReadClass;
  error: string | null;
  names: string[] | null;
  stale: boolean;
  outdated: boolean;
  profiled: boolean;
  profileChanged: boolean;
}
/**
 * **The one place that knows how the hook stores its state.** Until stage 2b of
 * the spike it read a status word, a list, an error and four flags, and threw
 * on a combination the six classes do not contain; `Read` cannot hold one, so
 * there is nothing left to refuse.
 */
function seen(from: IdeasRead | null = read): Seen {
  if (!from) throw new Error("the read probe is not mounted");
  const { read: state } = from;
  if (state.kind === "asking") return { is: "asking", ...KNOWN_NOTHING };
  if (state.kind === "failed") return { is: "failed", ...KNOWN_NOTHING, error: state.error };
  const { answer, recheck } = state;
  if (answer === null) {
    return { is: recheck === null ? "none" : "none, recheck failed", ...KNOWN_NOTHING, error: recheck };
  }
  return {
    is: recheck === null ? "list" : "list, recheck failed",
    error: recheck,
    names: answer.ideas.ideas.map((i) => i.name),
    stale: answer.stale,
    outdated: answer.outdated,
    profiled: answer.profiled,
    profileChanged: answer.profileChanged,
  };
}
const NO_FLAGS = { stale: false, outdated: false, profiled: false, profileChanged: false };
const KNOWN_NOTHING = { error: null, names: null, ...NO_FLAGS };

/* ------------------------------------------------------------------ the verbs -- */

let finished = 0;
/**
 * **A job that wrote the Ideas has finished** — the real cause of a `refresh`:
 * the band's and the margin's reads hear it through the queue, and the probe's
 * is asked directly, as `useSkim` asks it.
 */
async function refreshAll() {
  const done = job(`somebody-elses-${++finished}`, ["ideas"], "done");
  await act(async () => {
    for (const entry of [...live]) (entry.cb as Announce | undefined)?.(done);
    void read?.refresh();
  });
}
async function refreshed() {
  await refreshAll();
  await flush();
}
/** The reader pressed a mode button on this band: the automatic run is armed. */
async function arm() {
  await act(async () => armActivation(SLUG, "ideas"));
}
const asked = (slug = SLUG) => reads[slug] ?? 0;

beforeEach(() => {
  jobs = [];
  posted.length = 0;
  serve = {};
  reads = {};
  read = null;
  skim = null;
  feed = null;
  handed.length = 0;
  live.clear();
  jobEngine.reset();
  resetActivations();
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") !== "GET") return json({});
    if (url.startsWith("/api/reader")) return json({ profile: "My current profile", purpose: null });
    const slug = /^\/api\/ideas\/([^/?]+)$/.exec(url)?.[1];
    if (slug !== undefined) {
      reads[slug] = (reads[slug] ?? 0) + 1;
      return (serve[slug] ?? noneYet)();
    }
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

/* ===================================================================== tests == */

describe("the six things the Ideas read can be", () => {
  it("asking: the opening read is out, and the band says it is looking", async () => {
    const opening = hold();
    await mount(["band", "probe"]);
    expect(screen()).toEqual(ASKING);
    expect(seen()).toEqual({ is: "asking", ...KNOWN_NOTHING });
    await opening.land(noneYet);
  });

  it("failed: the opening read failed, and the band offers the read again and nothing that spends", async () => {
    answer(broken());
    await mount(["band", "probe"]);
    expect(screen()).toEqual(FAILED(FIRST_FAILURE));
    expect(seen()).toEqual({ is: "failed", ...KNOWN_NOTHING, error: FIRST_FAILURE });
  });

  it.each([
    ["200 null", noneYet],
    ["a 404, from a server that has not heard of the header", () => json({ error: "Not found." }, 404)],
  ])("none: the server said there are none yet (%s), and the band offers to find them", async (_name, reply) => {
    answer(reply);
    await mount(["band", "probe"]);
    expect(screen()).toEqual(NONE);
    expect(seen()).toEqual({ is: "none", ...KNOWN_NOTHING });
  });

  it("none, recheck failed: both the failure and the empty state with its button", async () => {
    answer(noneYet);
    await mount(["band", "probe"]);
    answer(broken());
    await refreshed();
    expect(screen()).toEqual(NONE_RECHECK(FIRST_FAILURE));
    expect(seen()).toEqual({ is: "none, recheck failed", ...KNOWN_NOTHING, error: FIRST_FAILURE });
  });

  it("list: the ideas, and nothing else", async () => {
    answer(serves(list("Measure first")));
    await mount(["band", "probe"]);
    expect(screen()).toEqual(LIST("Measure first"));
    expect(seen()).toEqual({ is: "list", error: null, names: ["Measure first"], ...NO_FLAGS });
  });

  it("list, recheck failed: the ideas and the failure together, and still no footer", async () => {
    answer(serves(list("Measure first")));
    await mount(["band", "probe"]);
    answer(broken());
    await refreshed();
    expect(screen()).toEqual(LIST_RECHECK("Measure first", FIRST_FAILURE));
    expect(seen()).toEqual({ is: "list, recheck failed", error: FIRST_FAILURE, names: ["Measure first"], ...NO_FLAGS });
  });
});

describe("a failure is the last read's, and any read that answers takes it away", () => {
  const cases: [string, Serve, Serve, Serve, Screen][] = [
    ["a list's failed recheck, by a refresh that brings a list", serves(list("Measure first")), broken(), serves(list("Theory follows", {}, AT.second)), LIST("Theory follows")],
    ["a list's failed recheck, by a refresh that finds none yet", serves(list("Measure first")), broken(), noneYet, NONE],
    ["none yet's failed recheck, by a refresh that finds none yet", noneYet, broken(), noneYet, NONE],
    ["none yet's failed recheck, by a refresh that brings a list", noneYet, broken(), serves(list("Theory follows")), LIST("Theory follows")],
  ];
  it.each(cases)("%s", async (_name, opening, failing, answering, expected) => {
    answer(opening);
    await mount(["band", "probe"]);
    answer(failing);
    await refreshed();
    expect(screen().error).toBe(FIRST_FAILURE);
    answer(answering);
    await refreshed();
    expect(screen()).toEqual(expected);
    expect(seen().error).toBeNull();
    expect(seen().is).toBe(expected.names.length > 0 ? "list" : "none");
  });

  it.each([
    ["none yet", noneYet, NONE],
    ["a list", serves(list("Measure first")), LIST("Measure first")],
  ] as [string, Serve, Screen][])("a failed opening read, by a refresh that answers %s — no Try again needed", async (_name, answering, expected) => {
    answer(broken());
    await mount(["band", "probe"]);
    expect(screen()).toEqual(FAILED(FIRST_FAILURE));
    answer(answering);
    await refreshed();
    expect(screen()).toEqual(expected);
    expect(seen().error).toBeNull();
  });
});

describe("a list, then a failed refresh", () => {
  it("draws nothing new while the refresh is out, keeps the list through every retry, and says the newest failure", async () => {
    answer(serves(list("Measure first")));
    await mount(["band", "probe"]);

    /* The refresh in flight changes nothing on screen. */
    const refresh = hold();
    await refreshAll();
    expect(screen()).toEqual(LIST("Measure first"));
    expect(seen().is).toBe("list");
    await refresh.land(broken());
    expect(screen()).toEqual(LIST_RECHECK("Measure first", FIRST_FAILURE));

    /* Try again: the error is gone from the press, the list stays, and the band
       never says it is looking. */
    const retry = hold();
    await press("Try again");
    await act(async () => void read?.retryRead());
    expect(screen()).toEqual(LIST("Measure first"));
    expect(seen()).toEqual({ is: "list", error: null, names: ["Measure first"], ...NO_FLAGS });

    /* It fails again, differently: the list is still there, under the new sentence. */
    await retry.land(broken(SECOND_FAILURE));
    expect(screen()).toEqual(LIST_RECHECK("Measure first", SECOND_FAILURE));
    expect(seen()).toEqual({ is: "list, recheck failed", error: SECOND_FAILURE, names: ["Measure first"], ...NO_FLAGS });

    /* And a third failure, by a plain refresh this time, replaces the sentence again. */
    answer(broken(FIRST_FAILURE));
    await refreshed();
    expect(screen()).toEqual(LIST_RECHECK("Measure first", FIRST_FAILURE));
    expect(seen().error).toBe(FIRST_FAILURE);

    /* Try again, answered: the new list, and no failure. */
    answer(serves(list("Theory follows", {}, AT.second)));
    await press("Try again");
    await act(async () => void read?.retryRead());
    await flush();
    expect(screen()).toEqual(LIST("Theory follows"));
    expect(seen()).toEqual({ is: "list", error: null, names: ["Theory follows"], ...NO_FLAGS });
  });
});

/**
 * **Today's behaviour, pinned, and an open question for the owner** (Opus's
 * WCO6; Q-retry-button in the seventh sweep's umbrella). After "none yet", a
 * failed read and a failed *Try again*, the *Find the ideas* button is gone:
 * the retry goes back to *asking*, and a failure with nothing known is
 * *failed*. Tweets keeps its button through the same sequence. Whichever way
 * the owner answers, this is the test that changes.
 */
describe("none yet, then a failed refresh (today's behaviour; the retry's lost button is an open question)", () => {
  it("keeps the empty state through the refresh, and loses it to the retry", async () => {
    answer(noneYet);
    await mount(["band", "probe"]);

    const refresh = hold();
    await refreshAll();
    expect(screen()).toEqual(NONE);
    expect(seen().is).toBe("none");
    await refresh.land(broken());
    expect(screen()).toEqual(NONE_RECHECK(FIRST_FAILURE));

    /* Try again: looking, and no button. */
    const retry = hold();
    await press("Try again");
    await act(async () => void read?.retryRead());
    expect(screen()).toEqual(ASKING);
    expect(seen()).toEqual({ is: "asking", ...KNOWN_NOTHING });

    /* A second failure: the error alone. */
    await retry.land(broken(SECOND_FAILURE));
    expect(screen()).toEqual(FAILED(SECOND_FAILURE));
    expect(seen()).toEqual({ is: "failed", ...KNOWN_NOTHING, error: SECOND_FAILURE });

    /* A failure over *failed* is still *failed*, in the newest words. */
    answer(broken(FIRST_FAILURE));
    await refreshed();
    expect(screen()).toEqual(FAILED(FIRST_FAILURE));
    expect(seen().is).toBe("failed");

    /* And the way back: the read answers "none yet", and the button returns. */
    answer(noneYet);
    await press("Try again");
    await act(async () => void read?.retryRead());
    await flush();
    expect(screen()).toEqual(NONE);
    expect(seen()).toEqual({ is: "none", ...KNOWN_NOTHING });
    expect(posted, "no read, failed or retried, ever spends").toEqual([]);
  });
});

describe("what arrives with the answer", () => {
  const EVERY_FLAG: Flags = { stale: true, outdated: true, profileChanged: true, profileHash: "an-old-profile" };

  it("goes when the list goes: a flagged list, then none yet, then a fresh list with flags of its own", async () => {
    answer(serves(list("Measure first", EVERY_FLAG)));
    await mount(["band", "probe"]);
    expect(seen()).toEqual({
      is: "list",
      error: null,
      names: ["Measure first"],
      stale: true,
      outdated: true,
      profiled: true,
      profileChanged: true,
    });
    expect(screen()).toEqual({ ...LIST("Measure first"), older: true, badge: "changed" });
    /* The stale banner's own button — pinned because it is drawn from `stale`. */
    expect(buttons("Find them again")).toHaveLength(1);

    answer(noneYet);
    await refreshed();
    expect(seen()).toEqual({ is: "none", ...KNOWN_NOTHING });
    expect(screen()).toEqual(NONE);

    answer(serves(list("Theory follows", { profileHash: "a-profile" }, AT.second)));
    await refreshed();
    expect(seen()).toEqual({ is: "list", error: null, names: ["Theory follows"], ...NO_FLAGS, profiled: true });
    expect(screen()).toEqual({ ...LIST("Theory follows"), badge: "written" });
  });

  it("stays when a malformed 200 arrives over a list: the list, all four flags, and the page's own sentence", async () => {
    answer(serves(list("Measure first", EVERY_FLAG)));
    await mount(["band", "probe"]);
    /* A 200 with the freshness fields and no artefact. */
    answer(serves({ stale: false, outdated: false, profileChanged: false }));
    await refreshed();
    expect(seen()).toEqual({
      is: "list, recheck failed",
      error: PAGE_FAULT.message,
      names: ["Measure first"],
      stale: true,
      outdated: true,
      profiled: true,
      profileChanged: true,
    });
    expect(screen()).toEqual({
      ...LIST_RECHECK("Measure first", PAGE_FAULT.message),
      older: true,
      badge: "changed",
    });
  });

  it.each([
    ["stale", { stale: true }, { stale: true }],
    ["outdated", { outdated: true }, { outdated: true }],
    ["profileChanged", { profileChanged: true }, { profileChanged: true }],
    ["profiled", { profileHash: "a-profile" }, { profiled: true }],
  ] as [string, Flags, Partial<Seen>][])("carries %s alone when it alone is set", async (_flag, flags, expected) => {
    answer(serves(list("Measure first", flags)));
    await mount(["probe"]);
    expect(seen()).toEqual({ is: "list", error: null, names: ["Measure first"], ...NO_FLAGS, ...expected });
  });

  it.each([
    ["an empty string", "", true],
    ["null", null, false],
    ["absent", undefined, false],
  ] as [string, string | null | undefined, boolean][])(
    "reads a profileHash that is %s as profiled=%s — only null and absent mean written without one",
    async (_name, profileHash, profiled) => {
      answer(serves(list("Measure first", { profileHash })));
      await mount(["band", "probe"]);
      expect(seen().profiled).toBe(profiled);
      expect(screen().badge).toBe(profiled ? "written" : "none");
    },
  );

  /* Added in stage 2b, when removing the footer's stale gate turned nothing
     red: the footer carries a current list's job, the banner a stale one's. */
  it.each([
    ["a current list's running job shows in the footer", {}, true],
    ["a stale list's running job shows in its banner, and the footer stays away", { stale: true }, false],
  ] as [string, Flags, boolean][])("%s", async (_name, flags, foot) => {
    answer(serves(list("Measure first", flags)));
    await mount(["band"]);
    expect(screen().foot).toBe(false);
    jobs = [job("somebody-started-this", ["ideas"], "running")];
    await mount(["band"]);
    expect(screen().foot).toBe(foot);
    expect(screen().older).toBe(!foot);
    expect(screen().names).toEqual(["Measure first"]);
  });

  it("keeps an artefact with no ideas in it as a list, not as none yet", async () => {
    const empty = list("unused");
    (empty.ideas as { ideas: unknown[] }).ideas = [];
    answer(serves(empty));
    await mount(["band", "probe"]);
    expect(seen()).toEqual({ is: "list", error: null, names: [], ...NO_FLAGS });
    expect(screen()).toEqual(BLANK);
  });
});

describe("the automatic run, across the read", () => {
  it("an armed press over none with a failed recheck spends once, unforced", async () => {
    answer(noneYet);
    await mount(["band"]);
    answer(broken());
    await refreshed();
    expect(screen()).toEqual(NONE_RECHECK(FIRST_FAILURE));
    expect(posted).toEqual([]);

    await arm();
    await flush();
    expect(posted).toEqual([{ slug: SLUG, steps: ["ideas"] }]);
  });

  it("an armed press over a failed read reads once more, keeps the old sentence up while it does, and spends nothing", async () => {
    answer(broken());
    await mount(["band"]);
    expect(screen()).toEqual(FAILED(FIRST_FAILURE));
    const before = asked();

    /* The automatic re-read, in the air: the failure it is answering stays. */
    const reread = hold();
    await arm();
    expect(asked(), "one read, for the press").toBe(before + 1);
    expect(screen()).toEqual(FAILED(FIRST_FAILURE));

    await reread.land(broken(SECOND_FAILURE));
    expect(screen()).toEqual(FAILED(SECOND_FAILURE));
    expect(asked(), "a second failure is the end of it, not a loop").toBe(before + 1);
    expect(posted).toEqual([]);
  });

  it("an armed press over a failed read whose re-read finds none yet then spends, once", async () => {
    answer(broken());
    await mount(["band"]);
    answer(noneYet);
    await arm();
    await flush();
    expect(posted).toEqual([{ slug: SLUG, steps: ["ideas"] }]);
  });

  it("an armed press over a list with a failed recheck spends nothing and reads nothing", async () => {
    answer(serves(list("Measure first")));
    await mount(["band"]);
    answer(broken());
    await refreshed();
    const before = asked();
    await arm();
    await flush();
    expect(posted).toEqual([]);
    expect(asked()).toBe(before);
    expect(screen()).toEqual(LIST_RECHECK("Measure first", FIRST_FAILURE));
  });
});

describe("Skim's gate on the Ideas", () => {
  /** What a route press asks the queue for, once the gate lets it through. */
  const pressRoute = async () => {
    posted.length = 0;
    await act(async () => void skim?.ensure());
    await flush();
    return posted.map((p) => p.steps);
  };

  it("finds the Ideas first when there are none", async () => {
    answer(noneYet);
    await mount(["skim"]);
    expect(skim?.ideasFirst).toBe(true);
    expect(await pressRoute()).toEqual([["ideas", "skim"]]);
  });

  it("finds the Ideas first when the opening read failed", async () => {
    answer(broken());
    await mount(["skim"]);
    expect(seen().is).toBe("failed");
    expect(skim?.ideasFirst).toBe(true);
    expect(await pressRoute()).toEqual([["ideas", "skim"]]);
  });

  it("finds the Ideas first when none yet could not be rechecked", async () => {
    answer(noneYet);
    await mount(["skim"]);
    answer(broken());
    await refreshed();
    expect(seen().is).toBe("none, recheck failed");
    expect(skim?.ideasFirst).toBe(true);
    expect(await pressRoute()).toEqual([["ideas", "skim"]]);
  });

  it("finds a stale list again first", async () => {
    answer(serves(list("Measure first", { stale: true })));
    await mount(["skim"]);
    expect(skim?.ideasFirst).toBe(true);
    expect(await pressRoute()).toEqual([["ideas", "skim"]]);
  });

  it("does not, for a current list — even one whose recheck failed", async () => {
    answer(serves(list("Measure first")));
    await mount(["skim"]);
    expect(skim?.ideasFirst).toBe(false);
    answer(broken());
    await refreshed();
    expect(seen().is).toBe("list, recheck failed");
    expect(skim?.ideasFirst).toBe(false);
    expect(await pressRoute()).toEqual([["skim"]]);
  });

  it("does not, for a list that is merely outdated or written for another profile", async () => {
    answer(serves(list("Measure first", { outdated: true, profileChanged: true, profileHash: "an-old-profile" })));
    await mount(["skim"]);
    expect(skim?.ideasFirst).toBe(false);
    expect(await pressRoute()).toEqual([["skim"]]);
  });

  it("waits for a read that is asking, and for nothing else: a refresh in flight does not hold a press", async () => {
    /* Asking: the press is kept, not guessed. */
    const opening = hold();
    await mount(["skim"]);
    expect(seen().is).toBe("asking");
    await act(async () => void skim?.ensure());
    await flush();
    expect(posted, "spent before the Ideas had answered").toEqual([]);
    expect(skim?.starting).toBe(true);
    await opening.land(serves(list("Measure first")));
    expect(posted.map((p) => p.steps)).toEqual([["skim"]]);

    /* A refresh over a known list, held: the press goes straight through. */
    const refresh = hold();
    await act(async () => void read?.refresh());
    expect(await pressRoute()).toEqual([["skim"]]);
    await refresh.land(serves(list("Measure first")));
  });

  it("waits again when Try again goes back to asking over none yet", async () => {
    answer(noneYet);
    await mount(["skim"]);
    answer(broken());
    await refreshed();
    const retry = hold();
    await act(async () => void read?.retryRead());
    expect(seen().is).toBe("asking");
    posted.length = 0;
    await act(async () => void skim?.ensure());
    await flush();
    expect(posted).toEqual([]);
    await retry.land(noneYet);
    expect(posted.map((p) => p.steps)).toEqual([["ideas", "skim"]]);
  });
});

describe("Marginalia's feed", () => {
  const names = () => feed?.ideas?.map((i) => i.name) ?? null;

  it("draws a current list, and goes on drawing it after a failed refresh", async () => {
    answer(serves(list("Measure first")));
    await mount(["margin"]);
    expect(names()).toEqual(["Measure first"]);
    const before = asked();
    answer(broken());
    await refreshed();
    expect(asked(), "the margin heard the job finish and read again").toBe(before + 1);
    expect(names()).toEqual(["Measure first"]);
  });

  it("draws nothing from a stale list, from none yet, or from a failed read", async () => {
    answer(serves(list("Measure first", { stale: true })));
    await mount(["margin"]);
    expect(names()).toBeNull();

    answer(serves(list("Measure first")));
    await refreshed();
    expect(names(), "the control: the same list, current, is drawn").toEqual(["Measure first"]);

    answer(noneYet);
    await refreshed();
    expect(names()).toBeNull();
  });

  it("draws nothing when the opening read failed", async () => {
    answer(broken());
    await mount(["margin", "probe"]);
    expect(seen().is).toBe("failed");
    expect(names()).toBeNull();
  });
});

describe("the forced rewrite's hold, across a failed re-read", () => {
  async function regenerateIs(): Promise<"enabled" | "disabled" | "absent"> {
    const badge = document.querySelector<HTMLButtonElement>(".prof-badge");
    if (!badge) return "absent";
    await act(async () => badge.click());
    await flush();
    const [b] = buttons("Regenerate");
    const state = b === undefined ? "absent" : b.disabled ? "disabled" : "enabled";
    await press("Done");
    await flush();
    return state;
  }

  it("stays up over the old list through a failed re-read and a failed retry, and lets go on a read the server answered", async () => {
    const PROFILED: Flags = { profileHash: "the-old-profile", profileChanged: true };
    answer(serves(list("Measure first", PROFILED)));
    await mount(["band"]);
    expect(await regenerateIs()).toBe("enabled");

    await act(async () => document.querySelector<HTMLButtonElement>(".prof-badge")!.click());
    await flush();
    await press("Regenerate");
    await flush();
    expect(posted).toEqual([{ slug: SLUG, steps: ["ideas"], force: ["ideas"] }]);

    /* The rewrite finishes, and the read that should bring its list in fails. */
    answer(broken());
    jobs = [job("the-rewrite", ["ideas"], "done")];
    await mount(["band"]);
    expect(screen().names).toEqual(["Measure first"]);
    expect(screen().error).toBe(FIRST_FAILURE);
    expect(await regenerateIs(), "held: the new list has not been read").toBe("disabled");

    /* Try again fails too: still held, still the old list. */
    answer(broken(SECOND_FAILURE));
    await press("Try again");
    await flush();
    expect(screen().names).toEqual(["Measure first"]);
    expect(screen().error).toBe(SECOND_FAILURE);
    expect(await regenerateIs()).toBe("disabled");

    /* The server answers with the rewrite: the hold lets go. */
    answer(serves(list("Theory follows", PROFILED, AT.second)));
    await press("Try again");
    await flush();
    expect(screen()).toEqual({ ...LIST("Theory follows"), badge: "changed" });
    expect(await regenerateIs()).toBe("enabled");
    expect(posted, "one paid run, however many reads").toHaveLength(1);
  });
});

describe("a reply for an article the hook has moved on from", () => {
  it.each([
    ["an answer", serves(list("From the first article", { stale: true, profileHash: "p" }, AT.first, SLUG))],
    ["none yet", noneYet],
    ["a failure the server sent", broken()],
    /* The request itself rejects, so the only guard it meets is the catch's. */
    ["a connection that dropped", dropped],
  ] as [string, Serve][])("is dropped when it is %s: the second article's list stands, with no error", async (_name, late) => {
    const first = hold(SLUG);
    answer(serves(list("From the second article", {}, AT.second, OTHER)), OTHER);
    await mount(["band", "probe"], SLUG);
    expect(seen().is).toBe("asking");

    await mount(["band", "probe"], OTHER);
    expect(seen()).toEqual({ is: "list", error: null, names: ["From the second article"], ...NO_FLAGS });

    await first.land(late);
    expect(seen()).toEqual({ is: "list", error: null, names: ["From the second article"], ...NO_FLAGS });
    expect(screen()).toEqual(LIST("From the second article"));
  });

  /* The headers are in and the body is not: the only guard this meets is the
     one after the body is read. */
  it.each([
    ["a list", JSON.stringify(list("From the first article", { stale: true }))],
    ["none yet", "null"],
    ["not JSON at all", "<!doctype html>"],
  ])("is dropped when its body (%s) finishes arriving after the move", async (_name, text) => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    answer(
      () =>
        new Response(new ReadableStream<Uint8Array>({ start(c) {
              body = c;
            } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      SLUG,
    );
    answer(serves(list("From the second article", {}, AT.second, OTHER)), OTHER);
    await mount(["band", "probe"], SLUG);
    expect(seen().is).toBe("asking");
    expect(body, "the first article's reply has its headers and is waiting on its body").toBeDefined();

    await mount(["band", "probe"], OTHER);
    expect(seen().names).toEqual(["From the second article"]);

    await act(async () => {
      body.enqueue(new TextEncoder().encode(text));
      body.close();
    });
    await flush();
    expect(seen()).toEqual({ is: "list", error: null, names: ["From the second article"], ...NO_FLAGS });
    expect(screen()).toEqual(LIST("From the second article"));
  });
});

describe("the read's own verbs", () => {
  it("hands out one reload and one refresh for the life of the mount, and asks only when asked", async () => {
    answer(noneYet);
    await mount(["probe"]);
    expect(asked(), "the opening read").toBe(1);

    answer(broken());
    await refreshed();
    answer(serves(list("Measure first")));
    await refreshed();
    answer(broken());
    await refreshed();
    await act(async () => void read?.retryRead());
    await flush();
    expect(seen().is).toBe("list, recheck failed");

    /* Four more reads, one for each thing asked — a state change that changed
       `reload`'s identity would run the opening effect again and add to this. */
    expect(asked()).toBe(5);
    expect(new Set(handed.map((h) => h.reload)).size, "reload's identity").toBe(1);
    expect(new Set(handed.map((h) => h.refresh)).size, "refresh's identity").toBe(1);
  });
});
