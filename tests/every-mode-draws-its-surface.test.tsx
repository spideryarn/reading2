// @vitest-environment jsdom
/**
 * **Every mode, as its owner gets it: what the press spends, and what the band
 * draws.**
 *
 * `BAND_SAYS` in tests/public-network-trace.test.tsx is total over `Mode` and
 * already makes a fifteenth mode a red compile — but it checks what a
 * **visitor** sees, and six of the fourteen end at one shared sentence there.
 * Nothing rendered an **owner's** real controller and asked what it drew. So a
 * fifteenth mode could be wired end to end with a band that renders nothing at
 * all, and every test in the suite would stay green.
 * docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md
 * § Stage 4.
 *
 * ## One file, one harness, two phases — and the two phases are not a
 * duplication
 *
 * The first instinct was one sweep over one fixture state, on the grounds that
 * two sweeps would be two harnesses agreeing with each other. That is a
 * contradiction rather than a simplification, and GPT Sol showed why:
 *
 *  - to prove a Dock press **posts a job**, the artefact has to be **missing** —
 *    a mode with its artefact already there spends nothing, correctly;
 *  - but a controller with a missing artefact draws its *empty* or *running*
 *    state, not its populated body. Any `says` asserted from there would be
 *    matching chrome, and deleting the real Ideas, Quotes, Timeline or Debate
 *    renderer would leave the sweep green.
 *
 * So: one `<App/>`/`NuqsAdapter`/`StrictMode` harness — the one
 * tests/a-broken-mode-leaves-the-article-readable.test.tsx establishes — and two
 * phases with **different fixtures**. Phase A serves 404 for every artefact and
 * checks `SPENDS`. Phase B serves a populated, deliberately asymmetric one for
 * each and checks `DRAWS`.
 *
 * ## Neither table is derived from the code it is about
 *
 * `SPENDS` is written from the product rule — *pressing a mode with nothing in
 * it generates it* — and never from `MODE_TARGET` in src/web/activation.ts.
 * Deriving it would make this file agree with whatever the implementation does,
 * which is the whole failure mode it exists to prevent. Same rule as
 * `BAND_SAYS`' own literals, and for the same reason.
 *
 * ## `DRAWS` is not nullable, and that is the point of it
 *
 * A `{ where: string | null; says: string | null }` permits exactly the omission
 * this file exists to catch: `{ where: ".mode-band.research", says: null }`
 * passes over an empty band shell, and `{ where: null, says: null }` passes over
 * a controller nobody wrote. So both fields are required and non-empty, and the
 * two modes that genuinely draw no band are named in `NO_BAND_MODES` — a list
 * somebody has to edit on purpose, rather than a row they can leave out.
 *
 * And `says` is a **body literal unique to this file's fixture** — a term
 * invented here, a sentence written here — never a heading, a status line, a
 * button label or an empty-state sentence. A string the empty state could draw
 * is a string that proves nothing.
 *
 * ## Read only what a reader can read
 *
 * `readable()` below strips `[hidden]`, `[aria-hidden="true"]` and screen-reader
 * copies before matching, and every match is scoped to the exact band.
 * `BAND_SAYS`' docblock records why: `OutlinePanel` draws five `aria-hidden`
 * copies of its rows to measure them, so deleting the visible list left the
 * expected text on the page and the sweep green.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import type {
  Article,
  ChatThread,
  Debate,
  Glossary,
  Ideas,
  Quotes,
  SearchRun,
  Timeline,
} from "../src/types.js";
import type { SavedCriterion } from "../src/saved-criteria.js";

/* ------------------------------------------------------------- the reader --

   One owner, all the way through: this file is about the surface *nobody else
   renders*, so there is no visitor arm anywhere in it. */

const OWNER = { id: "owner-1", email: "owner@example.com" };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: OWNER, loading: false }),
}));

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

/* The browser APIs the reading view uses that jsdom does not have. */
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

/* ------------------------------------------------------------- the article --

   Three blocks and a two-node tree, the same shape the other `<App/>` harnesses
   use. The child node is what gives Outline any structure to draw at all. */

const SLUG = "a-piece";
const PARAGRAPH =
  "The instrument was built before anybody could say what it would measure, and the theory followed it.";
const SECOND = "A later chapter revisits the same episode from the other side.";

/**
 * **What the gist columns must be showing** — Hierarchy's whole surface, and it
 * is not a band. Deliberately different from every string in `DRAWS`, so that
 * "Hierarchy drew its columns" cannot be satisfied by a band's content.
 */
const COLUMN_GIST = "Where the argument finally lands.";
/** The root's gist, which is what Summary's band is built from. */
const ROOT_GIST = "The piece says the instruments came first.";
/** The child node's title — the one row Outline can draw on this fixture. */
const OUTLINE_ROW = "The instrument came first";

const BLOCKS: Article["blocks"] = [
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
    words: 17,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
  {
    id: "spya-cccccc",
    tag: "p",
    kind: "text",
    text: SECOND,
    words: 11,
    html: `<p>${SECOND}</p>`,
    gistable: true,
  },
];

const TREE: Article["tree"] = {
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
      range: ["spya-aaaaaa", "spya-cccccc"],
      title: "A piece",
      gist: ROOT_GIST,
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-bbbbbb", "spya-cccccc"],
      title: OUTLINE_ROW,
      gist: COLUMN_GIST,
    },
  },
};

const OWNED: Article = {
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/* ------------------------------------------------------- the populated set --

   One invented string per mode, and no two the same. A band drawing another
   band's content, or drawing shared chrome, cannot satisfy its own row. */

const GLOSSARY_TERM = "Kolmogorov depth";
const IDEA_NAME = "Instruments outrun explanation";
/**
 * **The line the panel actually draws.** Quotes are verbatim, so this one is
 * necessarily a span of the paragraph above — which is why the match is scoped
 * to the band and not to the page.
 */
const QUOTE_LINE = "before anybody could say what it would measure";
const TIMELINE_LABEL = "The Vienna calibration";
const DEBATE_APPLIES = "A replication in Leiden reached the opposite reading.";
const SKETCH_NODE = "The calibrated rig";
const SEARCH_CRITERION = "wherever the piece leans on an unnamed source";
const CRITERION_TEXT = "every claim that rests on a single study";
const CHAT_TITLE = "Why the instrument comes first";
const CHAT_ANSWER = "Because the measurement is doing the arguing.";
const REMEMBER_TITLE = "What I took from the middle section";
const REMEMBER_ANSWER = "You held on to the calibration and lost the caveat.";

const GLOSSARY: Glossary = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  entries: [
    {
      id: "spya-term23",
      name: GLOSSARY_TERM,
      kind: "concept",
      aliases: [],
      senseHere: "How much work it took to build the thing.",
      blocks: ["spya-bbbbbb"],
    },
  ],
  passes: 1,
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const IDEAS: Ideas = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  ideas: [
    {
      id: "spya-kdea34",
      name: IDEA_NAME,
      provenance: "assumed",
      statement: "You cannot theorise about what you have no way to measure.",
      occurrences: [
        { blockId: "spya-bbbbbb", quote: "The instrument was built", reasoning: "It rests on it." },
      ],
    },
  ],
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const QUOTES: Quotes = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  quotes: [
    {
      id: "spya-qte234",
      blockId: "spya-bbbbbb",
      text: QUOTE_LINE,
      start: PARAGRAPH.indexOf(QUOTE_LINE),
      reason: "It is the sentence the whole chapter turns on.",
      importance: 90,
      striking: 80,
    },
  ],
  discarded: {
    unfound: 0,
    otherVoice: 0,
    wrongLength: 0,
    overlapping: 0,
    overCap: 0,
    malformed: 0,
  },
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const TIMELINE: Timeline = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  events: [
    {
      id: "spya-evt234",
      label: TIMELINE_LABEL,
      dating: { kind: "words", phrase: "before the theory" },
      order: 1,
      modality: "happened",
      occurrences: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", start: 0 }],
    },
  ],
  orderConflicts: 0,
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const NO_LOSSES = {
  uncited: 0,
  selfSource: 0,
  unverifiedSource: 0,
  directnessUnverified: 0,
  claimNotInBlock: 0,
  unknownBlockId: 0,
  malformed: 0,
};
const COUNTS = {
  returnedSources: 1,
  reportedRows: 1,
  keptRows: 1,
  omittedOverCap: 0,
  lost: NO_LOSSES,
  webSearches: 1,
};

const DEBATE: Debate = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  searchedAt: "2026-09-01T09:00:00.000Z",
  direct: {
    rows: [
      {
        id: "spya-dbt234",
        url: "https://example.org/leiden",
        title: "The Leiden replication",
        sourceQuote: "We could not reproduce the calibration.",
        relation: "disputes",
        valence: "negative",
        applies: DEBATE_APPLIES,
        articleReferenceQuote: "The instrument was built",
      },
    ],
    counts: COUNTS,
  },
  claims: { rows: [], counts: { ...COUNTS, returnedSources: 0, reportedRows: 0, keptRows: 0 } },
  elapsedMs: 1,
};

const SKETCH = {
  title: "One instrument, one claim",
  caption: "The measurement is doing the arguing.",
  scenes: [
    {
      id: "s0",
      title: "Overview",
      height: 200,
      items: [
        {
          kind: "node",
          id: "n1",
          shape: "box",
          x: 10,
          y: 10,
          w: 140,
          h: 40,
          text: SKETCH_NODE,
          size: "md",
          block: "spya-bbbbbb",
        },
      ],
    },
  ],
};

const SEARCHES: SearchRun[] = [
  {
    id: "spya-run234",
    criterion: SEARCH_CRITERION,
    createdAt: "2026-09-02T09:00:00.000Z",
    status: "done",
    hits: [
      {
        blockId: "spya-bbbbbb",
        quote: "The instrument was built",
        confidence: 90,
        reasoning: "It says the thing.",
      },
    ],
  },
];

const CRITERIA: SavedCriterion[] = [
  {
    id: "spya-crt234",
    criterion: CRITERION_TEXT,
    config: { kind: "single" },
    createdAt: "2026-09-02T09:00:00.000Z",
    status: "done",
    results: [],
  },
];

type Seeded = ChatThread & { turns: number };

const CHAT_THREAD: Seeded = {
  id: "spya-thr234",
  title: CHAT_TITLE,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:01:00.000Z",
  kind: "chat",
  anchor: { blockId: "spya-bbbbbb" },
  turns: 1,
  messages: [
    {
      id: "spya-msg234",
      role: "user",
      text: "Why is the instrument carrying the argument?",
      createdAt: "2026-09-04T10:00:00.000Z",
      status: "done",
    },
    {
      id: "spya-msg235",
      role: "assistant",
      text: CHAT_ANSWER,
      createdAt: "2026-09-04T10:01:00.000Z",
      status: "done",
    },
  ],
};

const REMEMBER_THREAD: Seeded = {
  id: "spya-thr235",
  title: REMEMBER_TITLE,
  createdAt: "2026-09-04T11:00:00.000Z",
  updatedAt: "2026-09-04T11:01:00.000Z",
  kind: "remember",
  turns: 1,
  messages: [
    {
      id: "spya-msg236",
      role: "user",
      text: "I remember the calibration came first.",
      createdAt: "2026-09-04T11:00:00.000Z",
      status: "done",
    },
    {
      id: "spya-msg237",
      role: "assistant",
      text: REMEMBER_ANSWER,
      createdAt: "2026-09-04T11:01:00.000Z",
      status: "done",
    },
  ],
};

/* --------------------------------------------------------------- the server --

   Two states, chosen per phase. `missing` answers 404 for every artefact — the
   state in which a press costs money. `populated` answers all of them, which is
   the only state in which a band's *body* is on screen at all. */

type Fixtures = "missing" | "populated";
let fixtures: Fixtures;
/**
 * **The Sketch, served even in the `missing` state.** Set only by the
 * Illustrated press: the plates are painted from the Sketch, so with no Sketch
 * drawn there is nothing for that press to arm and `useAutoRun` retires it
 * unspent (src/web/useIllustrated.ts § the automatic run waits for the Sketch).
 * Arming Illustrated is therefore only observable on an article that already
 * has one.
 */
let sketchDrawn = false;

/** Every `POST /api/jobs` body, in order. */
const posts: { slug: string; steps: string[] }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GONE = () => new Response(null, { status: 404 });

function artefact(url: string): Response | null {
  const has = fixtures === "populated";
  if (url.startsWith("/api/glossary/"))
    return has ? json({ glossary: GLOSSARY, stale: false, outdated: false, profileChanged: false }) : GONE();
  if (url.startsWith("/api/ideas/"))
    return has ? json({ ideas: IDEAS, stale: false, outdated: false, profileChanged: false }) : GONE();
  if (url.startsWith("/api/quotes/"))
    return has ? json({ quotes: QUOTES, stale: false, outdated: false, profileChanged: false }) : GONE();
  if (url.startsWith("/api/timeline/"))
    return has ? json({ timeline: TIMELINE, stale: false, outdated: false }) : GONE();
  if (url.startsWith("/api/debate/"))
    return has ? json({ debate: DEBATE, stale: false, outdated: false }) : GONE();
  if (url.startsWith("/api/sketch/"))
    return has || sketchDrawn
      ? json({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false })
      : GONE();
  if (url.startsWith("/api/illustrated/")) return GONE();
  return null;
}

function reply(url: string, method: string, body: string | null): Response {
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: "2026-01-01T00:00:00.000Z" });
  if (url === "/api/jobs" && method === "POST") {
    posts.push(JSON.parse(body ?? "{}") as { slug: string; steps: string[] });
    return new Response(null, { status: 204 });
  }
  if (method === "POST" || method === "PATCH" || method === "DELETE")
    return new Response(null, { status: 204 });
  if (url === "/api/jobs") return json({ jobs: [] });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/"))
    return json({ threads: fixtures === "populated" ? [CHAT_THREAD, REMEMBER_THREAD] : [] });
  if (url.startsWith("/api/search/"))
    return json({ runs: fixtures === "populated" ? SEARCHES : [] });
  if (url.startsWith("/api/referee/criteria/"))
    return json({ criteria: fixtures === "populated" ? CRITERIA : [], sourceHash: "hash" });
  const art = artefact(url);
  if (art) return art;
  return json({});
}

/* Dynamic, for the reason public-network-trace.test.tsx gives: the first import
   transforms the whole client graph, which is slow enough to blow a default
   timeout on whichever test happens to run first. */
const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  posts.length = 0;
  fixtures = "missing";
  sketchDrawn = false;
  resetActivations();
  jobEngine.reset();
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      reply(String(input), init?.method ?? "GET", (init?.body as string | undefined) ?? null),
    ),
  );
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

/** The whole app at the owner's article, exactly as `main.tsx` mounts it. */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(App, null)),
      ),
    );
  });
  await act(async () => {
    for (const fn of [...authListeners]) fn("SIGNED_IN", { user: OWNER });
  });
  await settle();
}

const modeInUrl = (): string => new URLSearchParams(location.search).get("mode") ?? "plain";

/** `?mode=` is written behind nuqs' throttle, so a single read is a race. */
async function modeAfterPress(before: string): Promise<string> {
  for (let i = 0; i < 40 && modeInUrl() === before; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  return modeInUrl();
}

/** The real bar button, found the way a screen reader would find it. */
function modeButton(mode: Mode): HTMLButtonElement {
  const label = MODE_LABEL[mode];
  const found = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  expect(found, `the bar must draw ${label}`).toBeDefined();
  return found as HTMLButtonElement;
}

async function press(mode: Mode): Promise<void> {
  const before = modeInUrl();
  const button = modeButton(mode);
  await act(async () => button.click());
  await modeAfterPress(before);
  await settle();
}

/**
 * **What a reader can actually read.** `aria-hidden` and `hidden` subtrees and
 * screen-reader copies come out first — `OutlinePanel` alone draws five
 * `aria-hidden` copies of its rows to measure them, so raw `textContent` has
 * Outline's rows on the page whether or not the visible list rendered at all.
 */
function readable(el: Element): string {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const unread of copy.querySelectorAll(
    '[aria-hidden="true"], [hidden], [class*="sr-only"]',
  ))
    unread.remove();
  return copy.textContent ?? "";
}

/* ============================================================== phase A ====

   Artefacts missing. What each mode's press spends. */

/**
 * **What pressing this mode's bar button must POST**, written from the product
 * rule and never from `MODE_TARGET`.
 *
 * Greg's rule is *"if the user clicks a mode that hasn't been run yet,
 * automatically run it"* — so a mode with a generated artefact behind it posts
 * its step, and a mode with nothing to generate posts nothing and says why.
 */
type Spend =
  /** One press, one job. The steps it must ask the queue for. */
  | { kind: "posts"; steps: readonly string[] }
  /**
   * The press arms something, but *which* thing depends on what the address bar
   * says — so the row lists the presses, one per target, and every one of them
   * is exercised.
   */
  | { kind: "delegated"; presses: readonly { search: string; steps: readonly string[] }[] }
  /** Nothing to arm, with the reason written out rather than left as a blank. */
  | { kind: "none"; why: string };

const SPENDS: Record<Mode, Spend> = {
  /* The way out of every other mode: the article and nothing else. */
  plain: { kind: "none", why: "the article and nothing else — there is nothing to generate" },
  /* The gist columns are drawn from the tree the pipeline already built. */
  hierarchy: { kind: "none", why: "the gist columns come from the tree that is already there" },
  /* The same tree, one nested list. */
  outline: { kind: "none", why: "the nested list is that same tree; no model call" },
  /* And the same gists again, in a band instead of in the columns. */
  summary: { kind: "none", why: "the gists are the tree's own; no artefact behind them" },
  /* The five artefact modes, each arming its own name. */
  glossary: { kind: "posts", steps: ["glossary"] },
  ideas: { kind: "posts", steps: ["ideas"] },
  quotes: { kind: "posts", steps: ["quotes"] },
  timeline: { kind: "posts", steps: ["timeline"] },
  /* The dearest press in the app — two calls out to the open web. */
  debate: { kind: "posts", steps: ["debate"] },
  /* **The one mode where the button and the target are not the same word.**
     Diagram opens on whichever picture `?diagram=` names, so a press on the bar
     has to arm the picture that is about to mount — both of them are here
     because a row that armed only the default would be a lie about half the
     presses, and an expensive one. */
  diagram: {
    kind: "delegated",
    presses: [
      { search: "", steps: ["sketch"] },
      { search: "?diagram=illustrated", steps: ["illustrated"] },
    ],
  },
  /* Nothing exists to fill until the reader has typed a question. */
  search: { kind: "none", why: "stores nothing until the reader types a criterion" },
  chat: { kind: "none", why: "stores nothing until the reader asks something" },
  /* These two open on a sub-mode that waits on somebody's own words, so there
     is no empty artefact for the press to fill; their chips arm for themselves
     one level down. */
  referee: {
    kind: "none",
    why: "opens on Criteria, which has nothing to run until the referee has written one",
  },
  remember: {
    kind: "none",
    why: "opens on Recall, which waits on the reader's own words before there is anything to say",
  },
};

/** Every press a row asks for, as `(search, expected steps)` pairs. */
function pressesFor(spend: Spend): { search: string; steps: readonly string[] }[] {
  if (spend.kind === "delegated") return [...spend.presses];
  return [{ search: "", steps: spend.kind === "posts" ? spend.steps : [] }];
}

const PHASE_MS = 30_000;

describe("phase A — what a press on each mode's real bar button spends", () => {
  for (const mode of MODES) {
    const spend = SPENDS[mode];
    it(
      `${mode}: ${spend.kind === "none" ? `spends nothing — ${spend.why}` : "arms what it says it arms"}`,
      async () => {
        for (const want of pressesFor(spend)) {
          /* A fresh root per press: `root.render` reconciles rather than
             remounts, so a second address would inherit the first's mode. */
          await act(async () => root.unmount());
          host.remove();
          host = document.createElement("div");
          document.body.append(host);
          root = createRoot(host);
          posts.length = 0;
          resetActivations();
          jobEngine.reset();
          /* Illustrated is painted from the Sketch, so its press can only arm
             anything on an article that has one. See `sketchDrawn`. */
          sketchDrawn = want.steps.includes("illustrated");

          await open(want.search);
          /* The positive control: the page is a working reader before the
             press, so "no POST" below is a settled page rather than an empty
             one. */
          expect(host.querySelector(".dock-modes"), "no bar to press").not.toBeNull();
          await press(mode);
          await settle();

          expect(modeInUrl(), `${mode}: the button did not change mode`).toBe(mode);
          expect(
            posts.map((p) => p.steps),
            `${mode}${want.search}: what the press bought`,
          ).toEqual(want.steps.length === 0 ? [] : [[...want.steps]]);
        }
      },
      PHASE_MS,
    );
  }
});

/* ============================================================== phase B ====

   Artefacts populated. What each mode's controller actually drew. */

/**
 * **The two modes that draw no band**, and they are a list somebody edits on
 * purpose rather than a row anybody can omit. A fifteenth bandless mode has to
 * be added here deliberately.
 */
const NO_BAND_MODES = ["plain", "hierarchy"] as const;

/**
 * **What the owner's own controller must have on screen**, on this file's
 * populated fixture.
 *
 * Neither field may be null or empty:
 *
 *  - `where` — the band, as a selector. A nullable one would let a mode that
 *    draws no band at all pass by saying so.
 *  - `says` — one string that must be readable **inside that band**, and it is
 *    a body literal invented in this file: not a heading, not a status line, not
 *    a button label, and never a sentence the empty state could draw.
 */
const DRAWS: Record<
  Exclude<Mode, (typeof NO_BAND_MODES)[number]>,
  { where: string; says: string }
> = {
  /* The child node's title, from the tree in the payload — the one row this
     fixture's structure can produce. Deliberately **not** a gist: gists are in
     the columns beside the prose as well, so a gist would pass over an empty
     band the moment the columns happened to be open. */
  outline: { where: ".mode-band.outln", says: OUTLINE_ROW },
  /* The root's own gist, drawn as the band rather than as a column. */
  summary: { where: ".mode-band.summ", says: ROOT_GIST },
  /* An entry's name, which is what a closed row shows — a canary the panel
     cannot draw without having drawn the list. */
  glossary: { where: ".mode-band.gloss", says: GLOSSARY_TERM },
  /* The idea's **name** rather than its statement, for the same reason. */
  ideas: { where: ".mode-band.ideas", says: IDEA_NAME },
  /* **The line itself, and it had to be**: the panel draws the quoted words and
     not the model's reason for choosing them. See `QUOTE_LINE`. */
  quotes: { where: ".mode-band.quotes", says: QUOTE_LINE },
  /* The event's label. The dating phrase beside it is drawn too, but a label is
     the row's own content where a phrase could come from a formatter. */
  timeline: { where: ".mode-band.timeline", says: TIMELINE_LABEL },
  /* What the found page is said to bear on — a row's body, not the group
     heading above it, which is a constant sentence. */
  debate: { where: ".mode-band.dbt", says: DEBATE_APPLIES },
  /* A node **inside** the drawing, not the drawing's title: a title is drawn
     from the artefact's header and survives a scene that painted nothing. */
  diagram: { where: ".mode-band.diag", says: SKETCH_NODE },
  /* The owner's own saved question. Asserting the band's *"Search"* heading
     would pass over an empty `<aside>`. */
  search: { where: ".mode-band.srch", says: SEARCH_CRITERION },
  /* The referee's own criterion, off the saved list — and the band opens on
     Criteria, so this is the sub-mode a press actually lands on. */
  referee: { where: ".mode-band.referee", says: CRITERION_TEXT },
  /* **The two conversation bands share a component and a class**, so the
     negation is what keeps these two rows apart: Remember's band carries
     `remember` as well as `chat`, and without `:not()` a Remember panel drawn
     in Chat's place would satisfy this row. */
  chat: { where: ".mode-band.chat:not(.remember)", says: CHAT_TITLE },
  /* Recall, which is the half Remember opens on. */
  remember: { where: ".mode-band.remember", says: REMEMBER_TITLE },
};

describe("phase B — what each mode's real controller drew", () => {
  for (const mode of MODES) {
    if ((NO_BAND_MODES as readonly string[]).includes(mode)) continue;
    const row = DRAWS[mode as Exclude<Mode, (typeof NO_BAND_MODES)[number]>];
    it(
      `${mode}: draws its own body in ${row.where}`,
      async () => {
        fixtures = "populated";
        await open(`?mode=${mode}`);

        const band = host.querySelector(row.where);
        expect(band, `${mode}: no ${row.where} on the page`).not.toBeNull();
        expect(readable(band as Element), `${mode}: the band drew no body`).toContain(row.says);
      },
      PHASE_MS,
    );
  }

});

/* ============================================ the two that draw no band ====

   Checked for their *deliberate absence*, and each with a positive control
   beside it — otherwise "no band" is satisfied by a page that failed to load. */

describe("the modes that deliberately draw no band", () => {
  it("plain leaves the article readable and opens nothing", async () => {
    fixtures = "populated";
    await open("?mode=plain");

    expect(readable(host), "the prose").toContain(PARAGRAPH);
    expect(host.querySelector(".mode-band"), "plain opened a band").toBeNull();
  });

  /**
   * **Scoped to the gist cells themselves**, and that scope is the whole of the
   * positive control. Read from the page as a whole, the root's own gist is in
   * the masthead in *every* mode — so a page-wide assertion would be satisfied
   * by a Hierarchy that drew no columns at all. `COLUMN_GIST` is the child
   * node's, which only a rendered column can be showing.
   *
   * **`?cols=1` is spelled out**, and it is not a cheat: an absent `cols` means
   * *whatever fits* (App.tsx), and nothing fits in jsdom, where every element
   * measures zero. So a link that names the column is the only way to reach the
   * surface a reader with a window gets by default.
   */
  it("hierarchy draws the gist columns and opens nothing", async () => {
    fixtures = "populated";
    await open("?mode=hierarchy&cols=1");

    const gists = [...host.querySelectorAll(".gist-text")].map(readable).join("\n");
    expect(gists, "the gist columns").toContain(COLUMN_GIST);
    expect(host.querySelector(".mode-band"), "hierarchy opened a band").toBeNull();
  });
});
