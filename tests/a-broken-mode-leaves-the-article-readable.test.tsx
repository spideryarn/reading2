// @vitest-environment jsdom
/**
 * **One mode may break without taking the article with it.**
 *
 * Until 2026-09-05 the app had exactly one error boundary, in `main.tsx`, and
 * its fallback replaces its children — so a throw inside one panel's render
 * took the prose, the spine, the dock and every route with it. This file is the
 * behavioural statement of the fix: with the Ideas controller made to throw,
 * the reader keeps the article, keeps the bar, and is told which one thing is
 * broken. docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.
 * Debate joined it on 2026-09-10 and has its own two blocks further down, and on
 * 2026-09-11 every other band did, through src/web/reader/ModeBoundary.tsx —
 * the last three blocks, which derive their list from `MODES` —
 * docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § B.
 *
 * There is a second, quieter half and it is the one that costs money. `Dock`
 * arms an activation token *before* changing mode, and `useAutoRun` claims it in
 * an **effect** — which never runs if the render before it throws. The token was
 * therefore left unclaimed and spendable, and a later Back could start a paid
 * job nobody pressed for. So half the cases below press buttons and count
 * `POST /api/jobs`.
 *
 * ## Every containment assertion carries a positive control
 *
 * A `vi.mock` that silently stopped being wired to anything would make every
 * "the app survived" assertion here pass over a page where nothing ever threw —
 * docs/reusable/silent-success.md. So each case asserts, beside the containment:
 * that the throwing mock **actually ran**, counted; that the root `[render]`
 * fallback is **absent**; that the report was made once and carries no message
 * text; and that the prose and the dock are still on screen. The zero-POST cases
 * have `succeeds → exactly one POST` beside them as their control.
 *
 * ## Under a real `<StrictMode>`, like the activation suite
 *
 * `main.tsx` mounts the app inside one, and the whole of the activation design
 * turns on surviving React invoking one mount's effects twice inside one commit
 * (src/web/activation.ts § Why a boolean will not do). A harness that left it
 * off would be testing a page nobody visits.
 *
 * Everything above the assertions is lifted from
 * tests/the-ideas-extraction-changed-no-requests.test.tsx, which lifted it from
 * tests/public-network-trace.test.tsx — the mocks, the fixtures, the fake
 * server, `settle`/`open`. That file owns the harness; this one borrows it and
 * adds `AppBoundary` above `App`, so that "the root fallback did not fire" is a
 * thing this file can see at all.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Ideas, IdeasResponse } from "../src/types.js";
import type { PublicArtefacts, PublicArticle } from "../src/public-types.js";
import { MODE_LABEL } from "../src/title-text.js";

/* -------------------------------------------------------------- the probe --

   One hoisted object, because a `vi.mock` factory is hoisted above every import
   and may only close over something that was hoisted with it. It carries the
   switches the cases flip, the counters that are their positive controls, and a
   tiny external store so a case can force the committed controller to render
   again — which is what "throws on a *later* render" needs and what nothing
   else in the page can be relied on to do on cue. */
const probe = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  const state = {
    /** The Ideas controller throws during its own render. */
    throwBand: false,
    /**
     * What it throws. `"error"` is the ordinary case; `"null"` is `throw null`,
     * which React hands to `componentDidCatch` unchanged — so the handler is
     * given something with no `.name` and must still contain the failure.
     */
    bandThrowKind: "error" as "error" | "null",
    /** `IdeasPanel` throws while the real controller's hooks run. */
    throwPanel: false,
    bandRenders: 0,
    bandThrows: 0,
    panelThrows: 0,
    /** The Debate controller throws during its own render. */
    throwDebate: false,
    /** `DebatePanel` throws while the real `useDebate` hooks run above it. */
    throwDebatePanel: false,
    debateRenders: 0,
    debateThrows: 0,
    debatePanelThrows: 0,
    /**
     * The `useRenderCount` label that throws — each witnessed entry component
     * calls it at the start of render, so this is one switch for all of them.
     * See the mock of src/web/perf.js below.
     */
    throwAt: null as string | null,
    labelThrows: 0,
    /** Every `captureClientFailure` the boundary made, in order. */
    reports: [] as { name: string; message: string; context: Record<string, unknown> }[],
    version: () => version,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /** Re-render the committed controller, deterministically. */
    bump() {
      version += 1;
      for (const fn of [...listeners]) fn();
    },
    reset() {
      state.throwBand = false;
      state.bandThrowKind = "error";
      state.throwPanel = false;
      state.bandRenders = 0;
      state.bandThrows = 0;
      state.panelThrows = 0;
      state.throwDebate = false;
      state.throwDebatePanel = false;
      state.debateRenders = 0;
      state.debateThrows = 0;
      state.debatePanelThrows = 0;
      state.throwAt = null;
      state.labelThrows = 0;
      state.reports.length = 0;
    },
  };
  return state;
});

/**
 * The words the mocks throw. Distinctive, and asserted to be **nowhere** — not
 * on screen, not in the log buffer. An `Error.message` in this codebase has
 * repeatedly turned out to contain the article. Hoisted, because a `vi.mock`
 * factory is hoisted above every ordinary `const` in the file.
 */
const BOOM = vi.hoisted(() => "IDEAS-FELL-OVER-and-this-string-is-the-article");

/** Who `useSession` says is here — a store, so a case can change reader. */
const who = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

/**
 * **Reactive**, unlike the harness this is copied from, because the owner
 * A → owner B case has to change reader *while the page is up* and a plain
 * module variable would never tell React it had.
 */
vi.mock("../src/web/useSession.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSession: () => ({
      session: null,
      user: useSyncExternalStore(who.subscribe, who.get, who.get),
      loading: false,
    }),
  };
});

/**
 * **The throw sites.** Both wrappers render the real component as a child
 * rather than calling it, so a throw in the wrapper leaves the real controller
 * exactly as it was — committed, with its effects registered — and React tears
 * it down through the boundary, which is what the stale-marks case is about.
 *
 * The `useSyncExternalStore` in the band wrapper is the only hook either of them
 * has. When `throwBand` is set from the start the wrapper throws before it ever
 * commits, so the failing controller has **no effects at all** and nothing in
 * the activation cases below can be depending on effects in a failed child.
 */
vi.mock("../src/web/modes/ideas/IdeasMode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/modes/ideas/IdeasMode.js")>();
  const { createElement: h, useSyncExternalStore } = await import("react");
  /* One thrower for both bands, so the two cannot drift into throwing
     different things. `throw null` is deliberate and is the case F10 is
     about: React hands `componentDidCatch` the thrown value unchanged, so a
     boundary that reads `error.name` throws a second time out of its own
     handler. */
  const fail = (): never => {
    probe.bandThrows += 1;
    if (probe.bandThrowKind === "null") throw null;
    throw new Error(BOOM);
  };
  return {
    ...actual,
    IdeasBand(props: Parameters<typeof actual.IdeasBand>[0]) {
      useSyncExternalStore(probe.subscribe, probe.version, probe.version);
      probe.bandRenders += 1;
      if (probe.throwBand) fail();
      return h(actual.IdeasBand, props);
    },
    VisitorIdeasBand(props: Parameters<typeof actual.VisitorIdeasBand>[0]) {
      useSyncExternalStore(probe.subscribe, probe.version, probe.version);
      probe.bandRenders += 1;
      if (probe.throwBand) fail();
      return h(actual.VisitorIdeasBand, props);
    },
  };
});

vi.mock("../src/web/IdeasPanel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/IdeasPanel.js")>();
  const { createElement: h } = await import("react");
  return {
    ...actual,
    IdeasPanel(props: Parameters<typeof actual.IdeasPanel>[0]) {
      if (probe.throwPanel) {
        probe.panelThrows += 1;
        throw new Error(BOOM);
      }
      return h(actual.IdeasPanel, props);
    },
  };
});

/**
 * **Debate's two throw sites**, the same shape as Ideas': the controller throws
 * before any of its hooks run, and the panel throws with the real `useDebate`
 * — its read, its job poll and its `useAutoRun` — mounted above it. The second
 * is what shows the boundary encloses the controller's work and not only the
 * visible panel. docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § B.
 */
vi.mock("../src/web/modes/debate/DebateMode.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/modes/debate/DebateMode.js")>();
  const { createElement: h } = await import("react");
  return {
    ...actual,
    DebateBand(props: Parameters<typeof actual.DebateBand>[0]) {
      probe.debateRenders += 1;
      if (probe.throwDebate) {
        probe.debateThrows += 1;
        throw new Error(BOOM);
      }
      return h(actual.DebateBand, props);
    },
  };
});

vi.mock("../src/web/DebatePanel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/DebatePanel.js")>();
  const { createElement: h } = await import("react");
  return {
    ...actual,
    DebatePanel(props: Parameters<typeof actual.DebatePanel>[0]) {
      if (probe.throwDebatePanel) {
        probe.debatePanelThrows += 1;
        throw new Error(BOOM);
      }
      return h(actual.DebatePanel, props);
    },
  };
});

/**
 * **One throw site for every band.** Each tested entry component — controller,
 * panel, or `VisitorBand` — calls `useRenderCount("<Component>")` at the start
 * of its render, so throwing from it is a throw inside that component, before
 * any hook of its own has run (or, for a panel, after its controller's hooks all
 * have). It is a plain function with no hooks inside, so throwing from it
 * changes no hook order. The count is the positive control: a label nothing
 * renders never throws, and every case below asserts it did.
 */
vi.mock("../src/web/perf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/perf.js")>();
  return {
    ...actual,
    useRenderCount(label: string) {
      if (probe.throwAt === label) {
        probe.labelThrows += 1;
        throw new Error(BOOM);
      }
      actual.useRenderCount(label);
    },
  };
});

/**
 * Sentry is not started in a test, so the real `captureClientFailure` returns
 * without doing anything — which would make "the report was made" unfalsifiable.
 * The mock records the call; the *sanitising* half is `monitoring-scrub.ts`'s
 * own suite. What is asserted here is that the boundary called it once, tagged
 * it, and that nothing carrying the message reached the ring buffer.
 */
vi.mock("../src/web/monitoring.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/monitoring.js")>();
  return {
    ...actual,
    captureClientFailure: (err: unknown, context?: Record<string, unknown>) => {
      probe.reports.push({
        name: err instanceof Error ? err.name : "not-an-error",
        message: err instanceof Error ? err.message : "",
        context: context ?? {},
      });
    },
  };
});


const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/* The three browser APIs the reading view uses that jsdom does not have. */
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
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

/** Every request the page made, in order. */
const trace: { url: string; method: string; auth: string | null }[] = [];

const SLUG = "a-piece";
/** A second article of the same owner's, for the case that changes slug under a broken band. */
const OTHER_SLUG = "another-piece";
const PARAGRAPH = "The first paragraph of the piece.";
/** The phrase an idea occurrence quotes, so the prose really gets marks. */
const OCCURRENCE = "The first paragraph";

const BLOCKS: PublicArticle["blocks"] = [
  {
    id: "spya-aaaaaa",
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb",
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 6,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
];

const TREE: PublicArticle["tree"] = {
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1"],
      range: ["spya-aaaaaa", "spya-bbbbbb"],
      title: "A piece",
      gist: "What the piece says.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-bbbbbb", "spya-bbbbbb"],
      title: "The argument it makes",
      gist: "Where the piece gets to.",
    },
  },
};

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  comments: [],
  searches: [],
  assets: undefined,
  navLabelStatus: "ready",
};

const OWNED: Article = {
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  meta: { slug: SLUG, title: "A piece, as its owner renamed it", url: "https://example.com/a" },
};

/** The idea whose passage the stale-marks case publishes and then loses. */
const IDEA_NAME = "Measurement precedes theory";
/* A **valid** Spideryarn id: the charset excludes `i`, `l`, `o` and `1`, so a
   plausible-looking `spya-idea01` parses to null and `?idea=` selects nothing —
   which is a silent way for this case to stop testing anything. src/ids.ts. */
const IDEA_ID = "spya-kdea34";
const STORED_IDEAS: Ideas = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
  ideas: [
    {
      id: IDEA_ID,
      name: IDEA_NAME,
      provenance: "assumed",
      statement: "You cannot theorise about what you have no way to measure.",
      occurrences: [{ blockId: "spya-bbbbbb", quote: OCCURRENCE, reasoning: "It rests on it." }],
    },
  ],
};
const IDEAS_BODY: IdeasResponse = {
  ideas: STORED_IDEAS,
  stale: false,
  outdated: false,
  profileChanged: false,
};

let owned: () => Response;
/** A `/api/…/` prefix answered 404 — *nobody has asked for one of these yet*. */
let notBuilt: string | null = null;
let experimentalSince: string | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
  if (url === `/api/article/${SLUG}`) return owned();
  if (url === `/api/article/${OTHER_SLUG}`)
    return json({ ...OWNED, meta: { ...OWNED.meta, slug: OTHER_SLUG } });
  if (url === "/api/reader") return json({ experimentalSince });
  if (method === "POST") return new Response(null, { status: 204 });
  if (notBuilt !== null && url.startsWith(notBuilt)) return new Response(null, { status: 404 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
  if (url.startsWith("/api/ideas/")) return json(IDEAS_BODY);
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { FeatureBoundary } = await import("../src/web/FeatureBoundary.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const { clearLogBuffer, readLogBuffer } = await import("../src/web/log-buffer.js");
const activation = await import("../src/web/activation.js");
type Identity = NonNullable<ReturnType<typeof activation.activationIdentity>>;

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

const OWNER_A = { id: "owner-1", email: "a@example.com" };
const OWNER_B = { id: "owner-2", email: "b@example.com" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  who.set(null);
  notBuilt = null;
  experimentalSince = null;
  probe.reset();
  clearLogBuffer();
  activation.resetActivations();
  resetExperimental();
  owned = () => json(OWNED);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    trace.push({ url, method, auth: headers.get("Authorization") });
    return Promise.resolve(reply(url, method));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * The whole app at a shared article's address, **inside `AppBoundary` and
 * `StrictMode`**, exactly as `main.tsx` mounts it. The root boundary is here so
 * that "the whole page did not go" is falsifiable: delete `FeatureBoundary` and
 * every case below finds `[render]` instead of `[mode-render]`.
 */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          NuqsAdapter,
          null,
          createElement(AppBoundary, null, createElement(App, null)),
        ),
      ),
    );
  });
  await act(async () => {
    const user = who.get();
    const posed = user === null ? null : { user };
    for (const fn of [...authListeners]) fn(user === null ? "SIGNED_OUT" : "SIGNED_IN", posed);
  });
  await settle();
}

const text = (): string => host.textContent ?? "";

function modeButton(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  expect(found, `the bar must draw ${label}`).toBeDefined();
  return found as HTMLButtonElement;
}

function buttonNamed(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  expect(found, `the fallback must draw a "${label}" button`).toBeDefined();
  return found as HTMLButtonElement;
}

const modeInUrl = (): string =>
  new URLSearchParams(location.search).get("mode") ?? "plain";

/** `?mode=` is written behind nuqs' throttle, so a single read is a race. */
async function modeAfterPress(before: string): Promise<string> {
  for (let i = 0; i < 40 && modeInUrl() === before; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  return modeInUrl();
}

async function press(label: string): Promise<void> {
  const before = modeInUrl();
  const button = modeButton(label);
  await act(async () => button.click());
  await modeAfterPress(before);
  await settle();
}

const jobPosts = (): { url: string; method: string }[] =>
  trace.filter((r) => r.method === "POST" && r.url === "/api/jobs");

/**
 * Everything that must be true when Ideas has failed, asserted in one place so
 * that no case can quietly assert less than another.
 *
 * Note what it matches the fallback on: the **bracketed code**, never the
 * sentence — docs/project/copy.md § The bracketed code, so the words stay
 * rewritable. And `[render]` is checked absent in the same breath, because a
 * missing `FeatureBoundary` gives a page carrying that and no prose at all.
 */
function containedInsideIdeas(): void {
  expect(probe.bandThrows + probe.panelThrows, "the throwing mock never ran").toBeGreaterThan(0);
  expect(text(), "the Ideas fallback").toContain("[mode-render]");
  expect(text(), "the root fallback fired").not.toContain("[render]");
  expect(text(), "the exception text reached the reader").not.toContain(BOOM);
  expect(text(), "the prose went with it").toContain(PARAGRAPH);
  expect(host.querySelector(".dock-modes"), "the dock went with it").not.toBeNull();
}

/** The report half: made once, tagged, and carrying no message anywhere. */
function reportedOnce(feature = "Ideas"): void {
  expect(probe.reports, "one sanitised report").toHaveLength(1);
  expect(probe.reports[0]?.context).toMatchObject({ boundary: "feature", feature });
  const logged = readLogBuffer().filter((e) => e.kind === "client-error");
  expect(logged, "one client-error in the ring buffer").toHaveLength(1);
  expect(JSON.stringify(logged), "the message reached the buffer").not.toContain(BOOM);
  expect(JSON.stringify(logged)).toContain('"source":"boundary"');
}

describe("a mode that throws is replaced by a band, not by an empty page", () => {
  it("contains a throw from the controller's own render", async () => {
    who.set(OWNER_A);
    probe.throwBand = true;
    await open("?mode=ideas");

    containedInsideIdeas();
    expect(probe.bandThrows).toBeGreaterThan(0);
    reportedOnce();
    /* And Plain still works — pressing it takes the fallback away and leaves
       the article, which is the whole of "still a usable reader". */
    await press(MODE_LABEL.plain);
    expect(modeInUrl()).toBe("plain");
    expect(text()).not.toContain("[mode-render]");
    expect(text()).toContain(PARAGRAPH);
  });

  /**
   * **`throw null`, which is the case the containment was failing on** — Sol
   * F10. React passes the thrown value to `componentDidCatch` unchanged, so
   * `error` is not always an `Error`; the handler used to read `error.name`
   * before retiring anything, that read threw a `TypeError` out of the handler
   * itself, and `AppBoundary` then replaced the whole reader — the containment
   * failing in exactly the case it exists for. So this asserts all three: the
   * band fallback is up, `[render]` is **not**, and the press was retired.
   */
  it("contains a throw of something that is not an Error at all", async () => {
    who.set(OWNER_A);
    notBuilt = "/api/ideas/";
    await open();
    trace.length = 0;

    probe.throwBand = true;
    probe.bandThrowKind = "null";
    await press(MODE_LABEL.ideas);

    containedInsideIdeas();
    expect(
      activation.pendingActivation(SLUG, "ideas"),
      "the press survived a non-Error throw",
    ).toBeNull();
    expect(jobPosts(), "the failed render bought something").toEqual([]);
    /* The handler ran to the end rather than throwing out of the middle of
       itself, and the name it could not read fell back to a constant. */
    const logged = readLogBuffer().filter((e) => e.kind === "client-error");
    expect(logged, "one client-error in the ring buffer").toHaveLength(1);
    expect(JSON.stringify(logged)).toContain('"name":"Error"');
  });

  it("contains a throw from IdeasPanel while the real controller's hooks run", async () => {
    who.set(OWNER_A);
    probe.throwPanel = true;
    await open("?mode=ideas");

    containedInsideIdeas();
    expect(probe.panelThrows, "the panel mock never ran").toBeGreaterThan(0);
    expect(probe.bandRenders, "the real controller never got as far as its panel").toBeGreaterThan(
      0,
    );
    reportedOnce();
  });

  /**
   * **The marks the failed controller put in the prose must go with it** — Sol
   * F4. `useIdeasMode` already has the unmount-only clear that does it; what is
   * being proved is that a boundary tearing the controller down runs it, so the
   * reader is not left with a washed passage and a selected ring belonging to a
   * panel that is no longer there.
   */
  it("takes its marks out of the prose when it fails on a later render", async () => {
    who.set(OWNER_A);
    await open(`?mode=ideas&idea=${IDEA_ID}`);

    /* The positive control, and without it the assertion below is vacuous: the
       marks and the ring really were there before the throw. */
    expect(host.querySelectorAll("mark.hit").length, "no marks to lose").toBeGreaterThan(0);
    expect(
      host.querySelectorAll("mark.hit[data-hit-open]").length,
      "nothing was selected",
    ).toBeGreaterThan(0);

    probe.throwBand = true;
    await act(async () => probe.bump());
    await settle();

    containedInsideIdeas();
    expect(host.querySelectorAll("mark.hit"), "stale passage marks").toHaveLength(0);
    expect(host.querySelectorAll("mark.hit[data-hit-open]"), "a stale ring").toHaveLength(0);
  });

  it("settles back to the same actionable fallback when retry fails again", async () => {
    who.set(OWNER_A);
    probe.throwBand = true;
    await open("?mode=ideas");
    const first = probe.bandThrows;

    await act(async () => buttonNamed("Try Ideas again").click());
    await settle();

    expect(probe.bandThrows, "retry did not re-render the feature").toBeGreaterThan(first);
    containedInsideIdeas();
    /* Still actionable rather than stuck: both buttons are back. */
    buttonNamed("Try Ideas again");
    buttonNamed("Back to the article");
    expect(jobPosts(), "a retry is not a fresh intent to spend").toEqual([]);
  });

  /**
   * **The retry that works** — Sol F13. The case above keeps the mock throwing,
   * so a `retry` that wrongly armed a token would have it retired by the second
   * throw and the zero-POST assertion would pass anyway. Here the second render
   * succeeds, which is the only arrangement in which a token armed by `retry`
   * would survive long enough to be spent.
   */
  it("comes back to a working Ideas from retry, and buys nothing doing it", async () => {
    who.set(OWNER_A);
    notBuilt = "/api/ideas/";
    probe.throwBand = true;
    await open("?mode=ideas");
    containedInsideIdeas();

    probe.throwBand = false;
    trace.length = 0;

    await act(async () => buttonNamed("Try Ideas again").click());
    await settle();

    expect(text(), "the fallback outlived a successful retry").not.toContain("[mode-render]");
    expect(jobPosts(), "retry minted a fresh intent to spend").toEqual([]);
  });

  it("returns to Plain from the fallback's own button", async () => {
    who.set(OWNER_A);
    probe.throwBand = true;
    await open("?mode=ideas");

    await act(async () => buttonNamed("Back to the article").click());
    await modeAfterPress("ideas");
    await settle();

    expect(modeInUrl()).toBe("plain");
    expect(text()).not.toContain("[mode-render]");
    expect(text()).toContain(PARAGRAPH);
  });

  /**
   * **Owner A → owner B on the same slug resets it structurally** — Sol F6. The
   * reset key holds an access *class*, not an identity, so it does not change
   * here; what makes the switch safe is that `useArticleAccess` drops to
   * `loading` the moment the reader changes, which unmounts `Reader` and
   * destroys the boundary with it. A healthy panel on the far side, with no
   * retry pressed and no press armed, is what proves it.
   */
  it("is destroyed rather than reset when the reader changes underneath it", async () => {
    who.set(OWNER_A);
    probe.throwBand = true;
    await open("?mode=ideas");
    containedInsideIdeas();

    probe.throwBand = false;
    await act(async () => who.set(OWNER_B));
    await settle();

    expect(text(), "the fallback survived a remount").not.toContain("[mode-render]");
    expect(text(), "Ideas did not come back").toContain(IDEA_NAME);
    expect(jobPosts(), "changing reader is not a press").toEqual([]);
  });
});

/* ------------------------------------------------------- and the money half --

   Every case here counts `POST /api/jobs`, and every zero has the *succeeds*
   case beside it as its control. `notBuilt` puts the article in the one state
   that makes a press cost anything: nobody has run Ideas on it. */

describe("a press that met a broken mode cannot be spent later", () => {
  it("gives no job at all when the press throws and the reader comes back", async () => {
    who.set(OWNER_A);
    notBuilt = "/api/ideas/";
    await open();
    trace.length = 0;

    probe.throwBand = true;
    await press(MODE_LABEL.ideas);
    containedInsideIdeas();
    expect(jobPosts(), "the failed render bought something").toEqual([]);

    /* The failure was transient: the band works again. If the press were still
       lying about, this is the mount that would spend it. */
    probe.throwBand = false;
    await press(MODE_LABEL.plain);
    await act(async () => history.back());
    await modeAfterPress("plain");
    await settle();

    expect(modeInUrl(), "Back did not return to Ideas").toBe("ideas");
    expect(trace.some((r) => r.url.startsWith("/api/ideas/")), "the GET settled").toBe(true);
    expect(jobPosts(), "Back spent the retired press").toEqual([]);
  });

  /**
   * **The F1 hole, and it is the one that survives everything else.** `Dock`
   * arms a token on *every* press, the already-active mode included — so a
   * reader who presses Ideas while looking at the fallback arms something that,
   * without the reset-on-fresh-press rule, nothing renders to claim and nothing
   * retires.
   */
  it("gives no job when the press made at the fallback throws too", async () => {
    who.set(OWNER_A);
    notBuilt = "/api/ideas/";
    await open();
    trace.length = 0;

    probe.throwBand = true;
    await press(MODE_LABEL.ideas);
    const afterFirst = probe.bandThrows;

    /* Pressing the mode already showing the fallback. It must reach the
       controller — otherwise the press is parked behind the fallback. */
    await press(MODE_LABEL.ideas);
    expect(probe.bandThrows, "the fresh press never reset the boundary").toBeGreaterThan(
      afterFirst,
    );
    containedInsideIdeas();
    expect(jobPosts()).toEqual([]);

    probe.throwBand = false;
    await press(MODE_LABEL.plain);
    await act(async () => history.back());
    await modeAfterPress("plain");
    await settle();

    expect(modeInUrl()).toBe("ideas");
    expect(jobPosts(), "the second press was spent on Back").toEqual([]);
  });

  it("gives exactly one job when the press made at the fallback succeeds", async () => {
    who.set(OWNER_A);
    notBuilt = "/api/ideas/";
    await open();

    probe.throwBand = true;
    await press(MODE_LABEL.ideas);
    containedInsideIdeas();
    trace.length = 0;

    probe.throwBand = false;
    await press(MODE_LABEL.ideas);

    expect(text(), "Ideas did not come back").not.toContain("[mode-render]");
    expect(
      jobPosts(),
      "one job, attributable to that click, under React's double-invoked effects",
    ).toHaveLength(1);
  });
});

/* ---------------------------------------------- and the seam, on its own ---

   `retireActivation` is a compare-and-retire, and the three things it must
   refuse are not reachable from the page: a newer press, another target's
   token, and a press minted in a different session. They are asserted directly
   rather than staged, which is the only way to be sure the comparison is the
   comparison and not the ordering. */

describe("retireActivation retires exactly the press it was given", () => {
  beforeEach(() => activation.resetActivations());

  it("retires the press it names, once", () => {
    activation.armActivation(SLUG, "ideas");
    const nonce = activation.pendingActivation(SLUG, "ideas");
    expect(nonce).not.toBeNull();
    const id = activation.activationIdentity(SLUG, "ideas", nonce as number);
    expect(id).not.toBeNull();

    expect(activation.retireActivation(SLUG, "ideas", id as Identity))
      .toBe(true);
    expect(activation.pendingActivation(SLUG, "ideas")).toBeNull();
    /* Idempotent: a second call finds nothing, which is what makes a double
       `componentDidCatch` harmless whatever React does. */
    expect(activation.retireActivation(SLUG, "ideas", id as Identity))
      .toBe(false);
  });

  it("leaves a newer press alone", () => {
    activation.armActivation(SLUG, "ideas");
    const first = activation.activationIdentity(
      SLUG,
      "ideas",
      activation.pendingActivation(SLUG, "ideas") as number,
    );
    activation.armActivation(SLUG, "ideas");
    const second = activation.pendingActivation(SLUG, "ideas");

    expect(
      activation.retireActivation(SLUG, "ideas", first as Identity),
    ).toBe(false);
    expect(activation.pendingActivation(SLUG, "ideas")).toBe(second);
  });

  it("leaves another target's token alone", () => {
    activation.armActivation(SLUG, "quotes");
    const quotes = activation.pendingActivation(SLUG, "quotes");
    activation.armActivation(SLUG, "ideas");
    const ideas = activation.activationIdentity(
      SLUG,
      "ideas",
      activation.pendingActivation(SLUG, "ideas") as number,
    );

    expect(
      activation.retireActivation(SLUG, "ideas", ideas as Identity),
    ).toBe(true);
    expect(activation.pendingActivation(SLUG, "quotes"), "Quotes lost its press").toBe(quotes);
  });

  it("leaves a press from another session alone", () => {
    activation.armActivation(SLUG, "ideas");
    const nonce = activation.pendingActivation(SLUG, "ideas") as number;
    const held = activation.activationIdentity(SLUG, "ideas", nonce) as Identity;

    /* The same press, claimed by a *previous* reader's boundary. The epoch is
       the field that says so, and it is why the identity carries two. */
    expect(
      activation.retireActivation(SLUG, "ideas", {
        nonce: held.nonce,
        sessionEpoch: held.sessionEpoch - 1,
      }),
    ).toBe(false);
    expect(activation.pendingActivation(SLUG, "ideas")).toBe(nonce);
  });

  it("reports no identity for a nonce the slot no longer holds", () => {
    activation.armActivation(SLUG, "ideas");
    const stale = activation.pendingActivation(SLUG, "ideas") as number;
    activation.armActivation(SLUG, "ideas");

    expect(activation.activationIdentity(SLUG, "ideas", stale)).toBeNull();
  });
});

/* --------------------------------- and the wiring between the two, isolated --

   The cases in the first two blocks go through the page; the ones just above go
   straight at `retireActivation`. Neither reaches the half of the claim that
   says `componentDidCatch` must retire **`this.props.press`** rather than
   whatever the store happens to hold by the time the catch runs — the
   *refusal*. Every other test in this file would stay green if the handler
   looked the token up at catch time, because none of them puts a newer press
   between the failed render and its catch. Sol F12.

   So this one mounts `FeatureBoundary` on its own, with nothing but a throwing
   child, and puts the newer press exactly there. */

describe("the boundary will not retire a token newer than the one its render was holding", () => {
  /**
   * **What this establishes, exactly** — narrowed after Sol F16, because the
   * block used to claim more than it tests.
   *
   * 1. It **deliberately creates a stale-props/store state that is otherwise
   *    unreachable.** The child arms a fresh token on *every* render attempt,
   *    so by the caught render the props hold `Nk` while the store already
   *    holds `Nk+1`. `retireActivation(Nk)` therefore returns `false` and
   *    deletes nothing. Arming during render is a side effect during render: a
   *    real controller doing it would be a bug, and it is only acceptable in a
   *    probe.
   * 2. So what is under test is **compare-and-retire refusal** — that a token
   *    the boundary was not holding survives. It is *not* the successful
   *    retirement of the older token, and it is *not* a racing user click:
   *    once a render throws, React 19.2.8 performs its recovery synchronously
   *    in the same JavaScript task, so a browser click cannot enter that gap.
   *    That is why the production argument holds, and why this state has to be
   *    manufactured to be seen at all. Confirmed by Sol, 2026-09-06.
   * 3. **That a matching token is actually retired is proved by the normal page
   *    cases in this file**: § contains a throw of something that is not an
   *    Error at all, which asserts the pending activation is gone after the
   *    throw, and § gives no job at all when the press throws and the reader
   *    comes back, which asserts the later Back buys nothing.
   *
   * Narrow as it is, it is the one case that fails the mutation that matters:
   * a `componentDidCatch` that looked the token up at catch time would delete
   * `Nk+1`, which is failure mode (b), destroying a press the reader
   * legitimately made.
   *
   * **The child throws until it has been caught, rather than a fixed number of
   * times.** React answers a throw in a concurrent render by re-rendering the
   * whole root synchronously and letting it throw again, so "how many times" is
   * React's business and not a thing to hard-code. The stop condition is the
   * report the boundary makes, which is mocked at the top of this file — and it
   * matters, because each newer press legitimately resets the boundary and a
   * child that threw for ever would sit in a loop.
   */
  it("leaves a press armed during that render standing, and deletes nothing", async () => {
    activation.armActivation(SLUG, "ideas");
    const failed = activation.pendingActivation(SLUG, "ideas");
    expect(failed, "nothing was armed to fail with").not.toBeNull();

    let threw = 0;
    function ThrowsUntilCaughtAndArms() {
      if (probe.reports.length > 0) return null;
      threw += 1;
      activation.armActivation(SLUG, "ideas");
      throw new Error(BOOM);
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <FeatureBoundary
            name="Ideas"
            slug={SLUG}
            target="ideas"
            resetKey={`${SLUG}|owner`}
            onPlain={() => {}}
          >
            <ThrowsUntilCaughtAndArms />
          </FeatureBoundary>
        </StrictMode>,
      );
    });
    await settle();

    expect(threw, "the probe never threw, so nothing was contained").toBeGreaterThan(0);
    expect(probe.reports, "the boundary never caught it").toHaveLength(1);
    expect(probe.reports[0]?.context).toMatchObject({ boundary: "feature", feature: "Ideas" });

    const surviving = activation.pendingActivation(SLUG, "ideas");
    expect(surviving, "the newer press went with the old one").not.toBeNull();
    expect(surviving, "the retirement took the wrong press").not.toBe(failed);
  });
});

/* ---------------------------------------------------- the second mode: Debate --

   The first stage of cluster B in
   docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md: the same
   boundary, around `DebateBand` where `Reader` composes it. Debate is the one
   worth doing next because it is the dearest press in the app — two metered
   web searches — so an unretired token here is the most expensive one to leave
   lying about.

   Debate is behind the experimental-features switch, so every case turns it on:
   the bar draws an experimental mode only for a reader who has, or for the mode
   they are already in. And every case answers the debate GET 404 — *nobody has
   searched the web about this piece* — which is both the commonest state and
   the only one in which a press costs anything. */

const { navigate } = await import("../src/web/router.js");

const DEBATE_FALLBACK = '[aria-label="Debate is not working"]';
/** The article's spine (src/web/Spine.tsx), drawn in every mode, outside every band. */
const SPINE = ".spine";

/** Debate's counterpart to `containedInsideIdeas`, and it names the mode. */
function containedInsideDebate(): void {
  expect(probe.debateThrows + probe.debatePanelThrows, "the throwing mock never ran").toBeGreaterThan(
    0,
  );
  expect(text(), "the Debate fallback").toContain("[mode-render]");
  expect(host.querySelector(DEBATE_FALLBACK), "the fallback does not name Debate").not.toBeNull();
  expect(text(), "the root fallback fired").not.toContain("[render]");
  expect(text(), "the exception text reached the reader").not.toContain(BOOM);
  expect(text(), "the prose went with it").toContain(PARAGRAPH);
  expect(host.querySelector(SPINE), "the spine went with it").not.toBeNull();
  expect(host.querySelector(".dock-modes"), "the dock went with it").not.toBeNull();
}

function debateOn(): void {
  who.set(OWNER_A);
  experimentalSince = "2026-09-01T09:00:00.000Z";
  notBuilt = "/api/debate/";
}

describe("Debate that throws is replaced by a band, not by an empty page", () => {
  it("contains a throw from the controller's own render", async () => {
    debateOn();
    probe.throwDebate = true;
    await open("?mode=debate");

    containedInsideDebate();
    expect(probe.debateThrows, "the controller mock never threw").toBeGreaterThan(0);
    reportedOnce("Debate");

    await press(MODE_LABEL.plain);
    expect(modeInUrl()).toBe("plain");
    expect(text()).not.toContain("[mode-render]");
    expect(text()).toContain(PARAGRAPH);
  });

  it("contains a throw from DebatePanel while the real controller's hooks run", async () => {
    debateOn();
    probe.throwDebatePanel = true;
    await open("?mode=debate");

    containedInsideDebate();
    expect(probe.debatePanelThrows, "the panel mock never ran").toBeGreaterThan(0);
    expect(probe.debateRenders, "the real controller never rendered").toBeGreaterThan(0);
    reportedOnce("Debate");
  });

  it("settles back to the same actionable fallback when retry fails again", async () => {
    debateOn();
    probe.throwDebate = true;
    await open("?mode=debate");
    const first = probe.debateThrows;

    await act(async () => buttonNamed("Try Debate again").click());
    await settle();

    expect(probe.debateThrows, "retry did not re-render the feature").toBeGreaterThan(first);
    containedInsideDebate();
    buttonNamed("Try Debate again");
    buttonNamed("Back to the article");
    expect(jobPosts(), "a retry is not a fresh intent to spend").toEqual([]);
  });

  it("comes back to a working Debate from retry, and buys nothing doing it", async () => {
    debateOn();
    probe.throwDebate = true;
    await open("?mode=debate");
    containedInsideDebate();

    probe.throwDebate = false;
    trace.length = 0;
    await act(async () => buttonNamed("Try Debate again").click());
    await settle();

    expect(text(), "the fallback outlived a successful retry").not.toContain("[mode-render]");
    expect(trace.some((r) => r.url === `/api/debate/${SLUG}`), "the fresh Debate never read").toBe(
      true,
    );
    expect(jobPosts(), "retry minted a fresh intent to spend").toEqual([]);
  });

  it("returns to Plain from the fallback's own button", async () => {
    debateOn();
    probe.throwDebate = true;
    await open("?mode=debate");

    await act(async () => buttonNamed("Back to the article").click());
    await modeAfterPress("debate");
    await settle();

    expect(modeInUrl()).toBe("plain");
    expect(text()).not.toContain("[mode-render]");
    expect(text()).toContain(PARAGRAPH);
  });

  /**
   * **A different article gets a fresh band.** The mock stops throwing before
   * the move, so a fallback on the far side could only be carried-over state.
   *
   * What this proves is the outcome, not the reset key: it stays green with the
   * slug taken out of the key, checked 2026-09-10, because `ArticlePage` renders
   * `OwnedArticle key={slug}` and drops to `loading` between articles — so the
   * boundary is destroyed structurally, as it is for owner A → owner B above.
   * The slug in the key is the second lock, for a future composition that keeps
   * `Reader` mounted across articles.
   */
  it("does not carry its fallback to a different article", async () => {
    debateOn();
    probe.throwDebate = true;
    await open("?mode=debate");
    containedInsideDebate();

    probe.throwDebate = false;
    trace.length = 0;
    await act(async () => navigate(`/read/${OTHER_SLUG}?mode=debate`));
    await settle();

    expect(location.pathname).toBe(`/read/${OTHER_SLUG}`);
    expect(text(), "the fallback followed the reader").not.toContain("[mode-render]");
    expect(
      trace.some((r) => r.url === `/api/debate/${OTHER_SLUG}`),
      "the new article's Debate never mounted",
    ).toBe(true);
    expect(jobPosts(), "changing article is not a press").toEqual([]);
  });

  /**
   * **Owner → visitor.** Debate has no visitor band yet (`POLICY.debate` is
   * owners-only), so the far side is not a Debate panel; what matters is that
   * neither the fallback nor a press survives the change of reader, that the
   * owner's controller is not mounted for a visitor, and that the article is
   * still there.
   */
  it("leaves nothing behind when the owner signs out underneath it", async () => {
    debateOn();
    probe.throwDebate = true;
    await open("?mode=debate");
    containedInsideDebate();
    const rendered = probe.debateRenders;

    probe.throwDebate = false;
    trace.length = 0;
    await act(async () => who.set(null));
    await settle();

    expect(modeInUrl(), "signing out changed the mode instead of changing its access").toBe(
      "debate",
    );
    expect(
      host.querySelector('.mode-band[aria-label="Not available on a shared link"]'),
      "the visitor's owners-only band never replaced Debate",
    ).not.toBeNull();
    expect(text(), "the fallback survived the change of reader").not.toContain("[mode-render]");
    expect(text(), "the article went with it").toContain(PARAGRAPH);
    expect(probe.debateRenders, "a visitor mounted the owner's controller").toBe(rendered);
    expect(jobPosts(), "signing out is not a press").toEqual([]);
  });
});

describe("a Debate press that met a broken band cannot be spent later", () => {
  /** The positive control for every zero below: a press that works buys one search. */
  it("gives exactly one job for an ordinary press on a working Debate", async () => {
    debateOn();
    await open();
    trace.length = 0;

    await press(MODE_LABEL.debate);

    expect(modeInUrl()).toBe("debate");
    expect(text()).not.toContain("[mode-render]");
    expect(jobPosts(), "one job, under React's double-invoked effects").toHaveLength(1);
  });

  it("gives no job at all when the press throws and the reader comes back", async () => {
    debateOn();
    await open();
    trace.length = 0;

    probe.throwDebate = true;
    await press(MODE_LABEL.debate);
    containedInsideDebate();
    expect(
      activation.pendingActivation(SLUG, "debate"),
      "the press outlived the failed render",
    ).toBeNull();
    expect(jobPosts(), "the failed render bought something").toEqual([]);

    probe.throwDebate = false;
    await press(MODE_LABEL.plain);
    await act(async () => history.back());
    await modeAfterPress("plain");
    await settle();

    expect(modeInUrl(), "Back did not return to Debate").toBe("debate");
    expect(trace.some((r) => r.url === `/api/debate/${SLUG}`), "the GET settled").toBe(true);
    expect(jobPosts(), "Back spent the retired press").toEqual([]);
  });

  it("gives no job when the press made at the fallback throws too", async () => {
    debateOn();
    await open();
    trace.length = 0;

    probe.throwDebate = true;
    await press(MODE_LABEL.debate);
    const afterFirst = probe.debateThrows;

    await press(MODE_LABEL.debate);
    expect(probe.debateThrows, "the fresh press never reset the boundary").toBeGreaterThan(
      afterFirst,
    );
    containedInsideDebate();
    expect(jobPosts()).toEqual([]);

    probe.throwDebate = false;
    await press(MODE_LABEL.plain);
    await act(async () => history.back());
    await modeAfterPress("plain");
    await settle();

    expect(modeInUrl()).toBe("debate");
    expect(jobPosts(), "the second press was spent on Back").toEqual([]);
  });

  it("gives exactly one job when the press made at the fallback succeeds", async () => {
    debateOn();
    await open();

    probe.throwDebate = true;
    await press(MODE_LABEL.debate);
    containedInsideDebate();
    trace.length = 0;

    probe.throwDebate = false;
    await press(MODE_LABEL.debate);

    expect(text(), "Debate did not come back").not.toContain("[mode-render]");
    expect(jobPosts(), "one job, attributable to that click").toHaveLength(1);
  });
});

/* ---------------------------------------------------- and every other band --

   The second stage of cluster B: the boundary moved out of the band switch to
   its one call site, src/web/reader/ModeBoundary.tsx, so every band is inside
   one. Three things are checked, and only the first is about declarations:

   1. **Every mode has a containment decision**, derived from `MODES`, and the
      exemptions are pinned by name — so a new mode, or a band quietly moved to
      the exempt list, is a red test and not a review comment. A synthetic mode
      is run through the same check to show it can fail.
   2. **Every contained mode has a throw witness, and it runs.** A declaration
      says nothing about where the throw lands; the witness makes the band's own
      controller throw and requires the fallback that names that mode.
   3. **The press each band would have claimed is retired when it throws** —
      the Ideas/Debate money rule, for the five other targets a press can arm. */

const { MODES } = await import("../src/modes.js");
const { MODE_CONTAINMENT } = await import("../src/web/reader/ModeBoundary.js");
const { visitorGap } = await import("../src/web/visitor.js");
type AnyMode = (typeof MODES)[number];

/** How to make each contained mode's band throw from inside itself. */
interface Witness {
  /** The `useRenderCount` label that throws. */
  label: string;
  /** Whose band: the owner's, or a signed-out visitor's on a shared link. */
  as: "owner" | "visitor";
  /** Anything else the address needs, beside `?mode=`. */
  extra?: string;
}

/**
 * One row per mode, with a witness for the owner's component and for every
 * composition path that can replace it: `VisitorBand` when policy stands in
 * front, and fixture-free visitor components where there is no gap. The
 * boundary is outside that choice, so the owner witness proves the artefact
 * visitor twins' composition too; Search, Summary, Diagram and Structure still
 * exercise the real visitor branch independently.
 */
const WITNESS: Partial<Record<AnyMode, Witness[]>> = {
  chat: [
    { label: "ConversationBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  glossary: [
    { label: "GlossaryBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  search: [
    { label: "SearchBand", as: "owner" },
    { label: "VisitorSearchBand", as: "visitor" },
  ],
  referee: [
    { label: "RefereeBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  summary: [
    { label: "SummaryBand", as: "owner" },
    { label: "SummaryBand", as: "visitor" },
  ],
  diagram: [
    { label: "DiagramBand", as: "owner" },
    { label: "DiagramBand", as: "visitor" },
  ],
  ideas: [
    { label: "IdeasBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  remember: [
    { label: "RememberBand", as: "owner" },
    { label: "ConversationBand", as: "owner", extra: "&remember=recall" },
    { label: "QuizSubBand", as: "owner", extra: "&remember=quiz" },
    { label: "VisitorBand", as: "visitor" },
  ],
  quotes: [
    { label: "QuotesBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  timeline: [
    { label: "TimelineBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  debate: [
    { label: "DebateBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  citations: [
    { label: "CitationsBand", as: "owner" },
    { label: "VisitorBand", as: "visitor" },
  ],
  structure: [
    { label: "StructureBand", as: "owner" },
    { label: "StructureBand", as: "visitor" },
  ],
};

/** The modes allowed to have no boundary, by name. Growing this is a decision. */
const EXEMPT = ["plain", "hierarchy"];

/** No public artefacts, so every artefact-backed visitor gap is reachable. */
const NOTHING_AVAILABLE: PublicArtefacts = {
  arc: false,
  glossary: false,
  ideas: false,
  quotes: false,
  tweets: false,
  timeline: false,
  sketch: false,
};

/**
 * **The completeness check, as a function of the mode list**, so it can be
 * handed a mode that does not exist. A mode fails it by having no decision at
 * all, or by being contained with no witness to show it.
 */
function uncontained(modes: readonly string[]): string[] {
  const decided = MODE_CONTAINMENT as Record<string, { kind: string } | undefined>;
  const witnessed = WITNESS as Record<string, Witness[] | undefined>;
  return modes.filter((m) => {
    const decision = decided[m];
    if (decision === undefined) return true;
    return decision.kind === "contained" && (witnessed[m]?.length ?? 0) === 0;
  });
}

function containedInside(mode: AnyMode): void {
  const name = MODE_LABEL[mode];
  expect(probe.labelThrows, "the throwing mock never ran").toBeGreaterThan(0);
  expect(
    host.querySelector(`[aria-label="${name} is not working"]`),
    `the fallback does not name ${name}`,
  ).not.toBeNull();
  expect(text(), "the root fallback fired").not.toContain("[render]");
  expect(text(), "the exception text reached the reader").not.toContain(BOOM);
  expect(text(), "the prose went with it").toContain(PARAGRAPH);
  expect(host.querySelector(SPINE), "the spine went with it").not.toBeNull();
  expect(host.querySelector(".dock-modes"), "the dock went with it").not.toBeNull();
}

describe("every mode has decided whether its band may break on its own", () => {
  it("gives every mode in MODES a decision, and every contained one a witness", () => {
    expect(uncontained(MODES)).toEqual([]);
  });

  it("fails a mode nobody has decided about", () => {
    expect(uncontained([...MODES, "a-mode-added-tomorrow"])).toEqual(["a-mode-added-tomorrow"]);
  });

  it("exempts only the two modes that have no band", () => {
    const exempt = MODES.filter((m) => MODE_CONTAINMENT[m].kind === "exempt");
    expect(exempt).toEqual(EXEMPT);
  });

  it("has no witness for a mode it does not contain", () => {
    for (const m of EXEMPT) expect(WITNESS[m as AnyMode], m).toBeUndefined();
  });

  it("witnesses every visitor gap as a band, not as parent chrome", () => {
    for (const mode of MODES) {
      const hasGap = visitorGap(mode, NOTHING_AVAILABLE) !== null;
      const witnessesGap = WITNESS[mode]?.some(
        (w) => w.as === "visitor" && w.label === "VisitorBand",
      );
      expect(Boolean(witnessesGap), mode).toBe(hasGap);
    }
  });
});

const CONTAINED = MODES.filter((m) => MODE_CONTAINMENT[m].kind === "contained");
const WITNESSES = CONTAINED.flatMap((mode) =>
  (WITNESS[mode] ?? []).map((w) => ({ mode, extra: "", ...w })),
);

describe("a throw inside any band leaves the article", () => {
  it.each(WITNESSES)("$mode: $label, as $as $extra", async ({ mode, label, as, extra }) => {
    if (as === "owner") who.set(OWNER_A);
    /* Every experimental mode's button is only drawn for a reader who has the
       switch on; the band itself opens from the address either way. */
    experimentalSince = "2026-09-01T09:00:00.000Z";
    probe.throwAt = label;
    await open(`?mode=${mode}${extra}`);

    containedInside(mode);
    reportedOnce(MODE_LABEL[mode]);

    /* And the reader can still leave it. */
    await press(MODE_LABEL.plain);
    expect(modeInUrl()).toBe("plain");
    expect(text()).not.toContain("[mode-render]");
    expect(text()).toContain(PARAGRAPH);
  });

  /**
   * **Each mode gets a boundary of its own.** Summary arms nothing, so a press
   * on it cannot reset a broken boundary the way a fresh token does — only
   * `key={mode}` at the call site stands between a broken Quotes and a Summary
   * band that says "Summary is not working" when nothing in Summary threw.
   */
  it("does not follow the reader into another mode", async () => {
    who.set(OWNER_A);
    probe.throwAt = "QuotesBand";
    await open("?mode=quotes");
    containedInside("quotes");

    await press(MODE_LABEL.summary);
    expect(modeInUrl()).toBe("summary");
    expect(text(), "the broken band followed the reader").not.toContain("[mode-render]");
    expect(host.querySelector('.mode-band[aria-label="Summary"]'), "no Summary band").not.toBeNull();
  });

  it("does not reset a visitor's broken Sketch for a diagram parameter it ignores", async () => {
    probe.throwAt = "DiagramBand";
    await open("?mode=diagram&diagram=trail");
    containedInside("diagram");
    reportedOnce(MODE_LABEL.diagram);
    const throws = probe.labelThrows;

    /* A visitor is pinned to Sketch whatever this parameter says. Changing it
       therefore does not identify a different band and must not retry the
       broken one behind the reader's back. */
    await act(async () => history.pushState(null, "", `?mode=diagram&diagram=illustrated`));
    await settle();

    expect(probe.labelThrows, "an ignored parameter retried the band").toBe(throws);
    reportedOnce(MODE_LABEL.diagram);
    expect(text()).toContain(PARAGRAPH);
  });
});

/* ----------------------------------------- and the presses those bands take --

   Ideas' and Debate's blocks above carry the full set of money cases. These are
   the same rule for the other five things a press can arm, at the seam that
   arms each: the bar's button for a fixed mode and for Diagram's picture, and
   the chip inside the band for Referee and Remember. Each asserts the token is
   gone — the direct statement of retirement — and that nothing was bought. */

describe("a press that met any broken band is retired", () => {
  it.each([
    { mode: "glossary" as const, label: "GlossaryBand", read: "/api/glossary/" },
    { mode: "quotes" as const, label: "QuotesBand", read: "/api/quotes/" },
    { mode: "timeline" as const, label: "TimelineBand", read: "/api/timeline/" },
  ])("$mode: the bar's press, and a Back after it", async ({ mode, label, read }) => {
    who.set(OWNER_A);
    /* Timeline's button is behind the experimental switch. */
    experimentalSince = "2026-09-01T09:00:00.000Z";
    notBuilt = read;
    await open();
    trace.length = 0;

    probe.throwAt = label;
    await press(MODE_LABEL[mode]);
    containedInside(mode);
    expect(activation.pendingActivation(SLUG, mode), "the press outlived the throw").toBeNull();
    expect(jobPosts(), "the failed render bought something").toEqual([]);

    probe.throwAt = null;
    await press(MODE_LABEL.plain);
    await act(async () => history.back());
    await modeAfterPress("plain");
    await settle();

    expect(modeInUrl(), `Back did not return to ${mode}`).toBe(mode);
    expect(text()).not.toContain("[mode-render]");
    expect(jobPosts(), "Back spent the retired press").toEqual([]);
  });

  it("diagram: the bar's press lands on the Sketch, and that is the token retired", async () => {
    who.set(OWNER_A);
    notBuilt = "/api/sketch/";
    await open("?diagram=sketch");
    trace.length = 0;

    probe.throwAt = "DiagramBand";
    await press(MODE_LABEL.diagram);
    containedInside("diagram");
    expect(activation.pendingActivation(SLUG, "sketch"), "the Sketch press survived").toBeNull();
    expect(jobPosts()).toEqual([]);
  });

  it("referee: the Candidates chip, when Candidates throws", async () => {
    who.set(OWNER_A);
    await open("?mode=referee");
    expect(text()).not.toContain("[mode-render]");
    trace.length = 0;

    probe.throwAt = "CandidatesBand";
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".ref-view-btn")].find(
      (b) => (b.textContent ?? "").trim() === "Candidates",
    );
    expect(chip, "no Candidates chip").toBeDefined();
    await act(async () => chip?.click());
    await settle();

    containedInside("referee");
    expect(
      activation.pendingActivation(SLUG, "candidates"),
      "the Candidates press survived",
    ).toBeNull();
    expect(jobPosts()).toEqual([]);

    /* **Back to Criteria is a different band, and gets a fresh start** — the
       sub-mode is in the reset key, and nothing else would reset it: Back is not
       a press, and Criteria arms nothing. */
    await act(async () => history.back());
    for (let i = 0; i < 40 && new URLSearchParams(location.search).get("referee") !== null; i++) {
      await act(async () => {
        await new Promise((go) => setTimeout(go, 10));
      });
    }
    await settle();
    expect(modeInUrl()).toBe("referee");
    expect(new URLSearchParams(location.search).get("referee"), "Back did not leave Candidates").toBeNull();
    expect(text(), "the broken Candidates followed the reader to Criteria").not.toContain(
      "[mode-render]",
    );
  });

  it("remember: the Quiz chip, when the panel throws under the real useQuiz", async () => {
    who.set(OWNER_A);
    await open("?mode=remember");
    expect(text()).not.toContain("[mode-render]");
    trace.length = 0;

    probe.throwAt = "QuizPanel";
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".remember-submode-btn")].find(
      (b) => (b.textContent ?? "").trim() === "Quiz",
    );
    expect(chip, "no Quiz chip").toBeDefined();
    await act(async () => chip?.click());
    await settle();

    containedInside("remember");
    expect(activation.pendingActivation(SLUG, "quiz"), "the Quiz press survived").toBeNull();
    expect(jobPosts()).toEqual([]);
  });
});
