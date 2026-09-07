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
 * ## Phase A runs twice: once per door into a mode
 *
 * Since 2026-09-07 there are two ways to open a mode — the bar button, and the
 * command bar's Enter — and Greg's rule is that the second costs exactly what
 * the first costs. So phase A is parameterised over `TRIGGERS` and the same
 * four assertions run through each. **That had to be here rather than in a unit
 * test**: GPT Sol's F4 on 260906h is that comparing `pendingActivation` proves
 * nothing, because a token is not a post and Diagram's Force, Drift and Trail
 * spend through mount-time POSTs that leave no token at all. See `Trigger`.
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
 * a controller nobody wrote. So both fields are required and non-empty.
 *
 * A mode that genuinely draws no band says so in the same table, as a
 * `kind: "none"` row that must carry **the control**: what is on screen
 * instead. There was a `NO_BAND_MODES` list here until GPT Sol's F21, and it
 * excused a mode from the table and skipped it at run time from one reading —
 * so a mode added to it was checked by nothing. `DRAWS` is total over `Mode`
 * now, and there is no way to be absent from it.
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
import type { AutoRunTarget } from "../src/web/auto-run-targets.js";
import { MODE_LABEL } from "../src/title-text.js";
import type {
  Article,
  ChatThread,
  Debate,
  DebateCounts,
  DebateLosses,
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
  /* Stage 5's labels are done, so the tree renders with its headings rather
     than the run of blank leaf cells a `pending` article would draw. Nothing
     here asserts on it; it is `ready` so that no mode's surface is missing for
     a reason this file is not about. */
  navLabelStatus: "ready",
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

const NO_LOSSES: DebateLosses = {
  uncited: 0,
  selfSource: 0,
  unverifiedSource: 0,
  directnessUnverified: 0,
  sourceIsCopy: 0,
  claimNotInBlock: 0,
  unknownBlockId: 0,
  malformed: 0,
};
const COUNTS: DebateCounts = {
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
        /* The witness is the same string as `articleReferenceQuote` — that is
           how src/debate.ts builds a `named` signal, and a fixture that split
           them would describe a row the pipeline cannot produce. */
        identifies: [{ kind: "named", by: "title", witness: "The instrument was built" }],
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

/**
 * **Every request that is not a `GET`, in order** — `METHOD /path`, verbatim.
 *
 * The recorder watched `POST /api/jobs` and threw the rest away, and that was
 * the hole: the job queue is not the only way this app spends money. GPT Sol,
 * F11, 2026-09-06 — adding `?diagram=force` to Diagram's row below stayed green
 * while the press bought an embedding through `POST /api/similar`, because
 * nothing was looking. So the recorder now takes **the class**: a mutation is
 * anything that is not a `GET`, and every scenario has to account for all of
 * them. A new paid endpoint a mode press can reach is a red test on the day it
 * is wired, whether or not anybody thought to name it here.
 */
const mutations: string[] = [];

/**
 * **The mutations a press may make that buy nothing**, each with the reason,
 * because an allowlist without one grows by accident.
 *
 * Deliberately short. Anything not on it must be named by the press that causes
 * it — `Press.spends` below.
 */
const FREE_MUTATIONS: readonly { what: RegExp; why: string }[] = [
  {
    what: /^POST \/api\/library\/[^/]+\/open$/,
    why: "the shelf's own bookkeeping — which article was last opened. No model call.",
  },
];

/**
 * **What this scenario bought outside the job queue**, sorted and **counted**.
 *
 * A list rather than a set. It was a set until GPT Sol's F22, on the grounds
 * that `<StrictMode>` invokes every effect twice — but that erased the
 * difference between a press that buys one request and a press that buys the
 * same one twice, and the second is money a reader really pays. The harness
 * artefact is dealt with where it is caused, in `open()`'s `strict` flag;
 * see its note for the measurement. `POST /api/jobs` is left out because it is
 * asserted in full, with its steps, through `posts`.
 */
function paidPosts(): string[] {
  return [...mutations]
    .filter((m) => m !== "POST /api/jobs")
    .filter((m) => !FREE_MUTATIONS.some((free) => free.what.test(m)))
    .sort();
}

/**
 * **Every `AutoRunTarget`, written out here rather than derived.**
 *
 * A `Record<AutoRunTarget, true>` so a twelfth target is a compile error in
 * this file — the same reason `SPENDS` is total over `Mode`. Not derived from
 * `MODE_TARGET`, which is the table this file exists to check.
 */
const EVERY_TARGET: Record<AutoRunTarget, true> = {
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
  debate: true,
  sketch: true,
  illustrated: true,
  tweets: true,
  quiz: true,
  claims: true,
  candidates: true,
};
const TARGETS = Object.keys(EVERY_TARGET) as AutoRunTarget[];

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
  /* First, before any route decides anything: a mutation this function forgot
     to record is a mutation the sweep cannot see. See `mutations`. */
  if (method !== "GET") mutations.push(`${method} ${url}`);
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: "2026-01-01T00:00:00.000Z" });
  if (url === "/api/jobs" && method === "POST") {
    posts.push(JSON.parse(body ?? "{}") as { slug: string; steps: string[] });
    return new Response(null, { status: 204 });
  }
  /* **The two paid Diagram POSTs, answered with an empty but real body.**
     Everything else that mutates gets a 204 below, and for these two that is a
     crash rather than a stub: `useProjection` reads `points` off the parsed
     answer and `DiagramPanel` asks it for `.length` on the next render. An
     empty answer is the honest one for phase A anyway — the artefacts are all
     missing here, and what these two scenarios are about is that the request
     was **made at all**, not what came back. */
  if (url.startsWith("/api/similar/") && method === "POST")
    return json({ model: "test-embed", blocks: 0, eligible: 0, omitted: 0, pairs: [] });
  if (url.startsWith("/api/projection/") && method === "POST")
    return json({
      model: "test-embed",
      blocks: 0,
      skipped: { nonProse: 0, tooShort: 0, capped: 0 },
      variance: [0, 0],
      k: 0,
      points: [],
    });
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
const { resetActivations, pendingActivation } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  posts.length = 0;
  mutations.length = 0;
  fixtures = "missing";
  sketchDrawn = false;
  resetActivations();
  jobEngine.reset();
  resetExperimental();
  /* The command bar is a native `<dialog>` and jsdom implements neither
     `showModal` nor `close`, while `open` is a real attribute — the same
     stand-in tests/feedback-dialog.test.tsx uses, for the same reason. Phase A
     presses through that bar as well as through the bar button (see
     `TRIGGERS`), so this file needs it too. */
  const dialogs = window.HTMLDialogElement?.prototype;
  if (dialogs) {
    dialogs.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    dialogs.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
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
/**
 * **`strict` is off for phase A, and that is a measurement decision.**
 *
 * `<StrictMode>` invokes every effect twice, so an effect-driven request
 * appears twice in `mutations` however many times the app really made it. The
 * money contract cannot count under that, and the first version of this file
 * answered by deduplicating — which made a mode that genuinely posted twice
 * indistinguishable from one that posted once (GPT Sol, F22). Discarding
 * cardinality to survive a harness artefact is the wrong trade: an accidental
 * duplicate inside one effect is money a reader actually pays.
 *
 * So the artefact is removed instead of its symptom. **Measured rather than
 * assumed**: with cardinality kept and StrictMode on, exactly one endpoint
 * doubled (`POST /api/similar/:slug`, Force's, from a mount effect); with
 * StrictMode off, all 28 tests pass with exact counts. That is the replay and
 * not a real double-spend — so there is no money bug here, and phase A can now
 * see one if it appears.
 *
 * Phase B keeps StrictMode, because it asserts what was *drawn* rather than
 * what was spent, and the double invocation is worth having there.
 */
async function open(search = "", { strict = true }: { strict?: boolean } = {}): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  const tree = createElement(NuqsAdapter, null, createElement(App, null));
  await act(async () => {
    root.render(strict ? createElement(StrictMode, null, tree) : tree);
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

/* ------------------------------------------------------- the two doors --

   Two surfaces open a mode, and phase A below runs the identical assertions
   through each. */

/**
 * **A way a reader opens a mode**, so that "and it costs the same from the
 * command bar" is the same sweep rather than a second, weaker one written
 * beside it.
 *
 * The command bar arrived on 2026-09-07 and its whole promise is Greg's answer
 * 1: pressing Enter on a row opens that mode *exactly as pressing its bar
 * button does — same activation, same generate-on-open, same cost*
 * (docs/plans/260906h-mode-catalog-and-a-command-bar.md).
 *
 * **A `pendingActivation` comparison would not have proved that**, and GPT Sol's
 * F4 is why this is here instead of in a cheap unit test: a token is not a
 * post (see `stillPending` above, and F12 before it), and Diagram's Force,
 * Drift and Trail spend through **mount-time POSTs that leave no token at
 * all**. The only instrument that can see those is the one already in this
 * file — the whole app, a stubbed `fetch`, and a list of what was asked for.
 *
 * The two doors share `activateMode` in Dock.tsx, which is what makes parity
 * *likely*; this is what makes it **checked**. If the bar ever grows its own
 * copy of the arming — a "cheap preview", a skipped token, a second POST — the
 * command-bar arm of the sweep goes red on the same four assertions the Dock
 * arm passes.
 */
interface Trigger {
  /** What the test name calls it. */
  readonly name: string;
  /** Open this mode, and come back when the page has settled. */
  press(mode: Mode): Promise<void>;
}

/**
 * The real bar button, found the way a screen reader would find it — and until
 * 2026-09-07 the only way in, which is why `press` above has the plain name.
 */
const BAR_BUTTON: Trigger = { name: "bar button", press };

/**
 * **The command bar**, reached through its own button in the bar rather than
 * through ⌘-K: the chord and the button set the same state, and the button is
 * the door a phone has. tests/command-bar.test.tsx owns the chord's own
 * contract (repeat, text fields, other modals, the drawer).
 *
 * The query typed is the mode's **whole label**, and the selection is asserted
 * before Enter rather than assumed. Labels are unique and a full label is a
 * label-prefix match, so the wanted mode is first — but "the sweep pressed
 * Enter on whatever happened to be at the top" is exactly the shape that turns
 * a money test green for the wrong reason.
 */
const COMMAND_BAR: Trigger = {
  name: "command bar",
  async press(mode: Mode): Promise<void> {
    const before = modeInUrl();
    const opener = host.querySelector<HTMLButtonElement>(".dock-commands");
    expect(opener, "the bar must draw a command-bar button").not.toBeNull();
    await act(async () => (opener as HTMLButtonElement).click());

    const box = host.querySelector<HTMLInputElement>("dialog.cmdbar input.cmdbar-input");
    expect(box, "the command bar must be open, with a box to type in").not.toBeNull();
    const field = box as HTMLInputElement;
    /* React's value tracker does not see a plain `.value =`, so the native
       setter goes first and the `input` event after — the standard workaround. */
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(field, MODE_LABEL[mode]);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const selected = field.getAttribute("aria-activedescendant");
    expect(selected, `typing "${MODE_LABEL[mode]}" selected nothing`).not.toBeNull();
    expect(
      selected?.endsWith(`-${mode}`),
      `typing "${MODE_LABEL[mode]}" selected ${selected} rather than ${mode}`,
    ).toBe(true);

    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await modeAfterPress(before);
    await settle();
  },
};

/** Both doors, and phase A runs the whole sweep through each of them. */
const TRIGGERS: readonly Trigger[] = [BAR_BUTTON, COMMAND_BAR];

/** Hidden either way, and screen-reader copies. Used on the element and inside it. */
const UNREADABLE = '[aria-hidden="true"], [hidden], [class*="sr-only"]';

/**
 * **What a reader can actually read.** `aria-hidden` and `hidden` subtrees and
 * screen-reader copies come out first — `OutlinePanel` alone draws five
 * `aria-hidden` copies of its rows to measure them, so raw `textContent` has
 * Outline's rows on the page whether or not the visible list rendered at all.
 */
function readable(el: Element): string {
  /* **The element itself and everything above it, first.** Stripping hidden
     *descendants* says nothing about a band that is hidden as a whole: GPT Sol
     put `hidden` on the real Quotes `<aside>`, so not one reader could see any
     of it, and phase B stayed green (F14, 2026-09-06). `closest` matches the
     element as well as its ancestors, which is both halves of the fix. */
  if (el.closest(UNREADABLE)) return "";
  const copy = el.cloneNode(true) as HTMLElement;
  for (const unread of copy.querySelectorAll(UNREADABLE)) unread.remove();
  return copy.textContent ?? "";
}

/**
 * **The targets still holding a press nobody spent.**
 *
 * Phase A watches what a press *posts*, and a token is not a post: GPT Sol
 * changed Plain's row to arm `ideas` and the sweep stayed green, because no
 * Ideas panel was mounted to claim it (F12, 2026-09-06). An unclaimed token is
 * not harmless — a later Ideas mount can consume it and buy a run nobody
 * pressed for — so every scenario ends by asking whether the map is empty.
 */
function stillPending(): AutoRunTarget[] {
  return TARGETS.filter((target) => pendingActivation(SLUG, target) !== null);
}

/* ============================================================== phase A ====

   Artefacts missing. What opening each mode spends, from each of the two doors
   into it — see `TRIGGERS`. */

/**
 * **One press the sweep makes, and everything it is allowed to spend.**
 *
 * Both lists are exhaustive: what is not here must not happen. `spends` is the
 * half that did not exist until GPT Sol's F11, and the half Force, Drift and
 * Trail need — they post no job at all and still buy a model call.
 */
interface Press {
  /** The address the reader is at when the button is pressed. */
  search: string;
  /** The `steps` of the one `POST /api/jobs` the press must make, or `[]`. */
  steps: readonly string[];
  /**
   * **Every paid request the press makes directly**, as `METHOD /path` —
   * everything the job queue is not, minus `FREE_MUTATIONS`. `[]` for a press
   * that buys nothing outside the queue, which is most of them.
   */
  spends: readonly string[];
}

/**
 * **A non-empty tuple**, and it is the type doing the work rather than a
 * comment: `presses: []` ran zero presses and passed, and `steps: []` on a
 * `posts` row asserted nothing (GPT Sol, F13, 2026-09-06). A positive claim
 * with no witness is not a weaker test, it is no test.
 */
type AtLeastOne<T> = readonly [T, ...T[]];

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
  | { kind: "posts"; steps: AtLeastOne<string> }
  /**
   * The press arms something, but *which* thing depends on what the address bar
   * says — so the row lists the presses, one per picture, and every one of them
   * is exercised.
   */
  | { kind: "delegated"; presses: AtLeastOne<Press> }
  /** Nothing to arm, with the reason written out rather than left as a blank. */
  | { kind: "none"; why: string };

const SPENDS: Record<Mode, Spend> = {
  /* The way out of every other mode: the article and nothing else. */
  plain: { kind: "none", why: "the article and nothing else — there is nothing to generate" },
  /* The gist columns are drawn from the tree the pipeline already built. */
  hierarchy: { kind: "none", why: "the gist columns come from the tree that is already there" },
  /* The same tree, one nested list. */
  outline: { kind: "none", why: "the nested list is that same tree; no model call" },
  /* And the same tree a third time, in linked columns. */
  structure: { kind: "none", why: "the columns are that same tree; no model call" },
  /* And the same gists again, in a band instead of in the columns. */
  summary: { kind: "none", why: "the gists are the tree's own; no artefact behind them" },
  /* The five artefact modes, each arming its own name. */
  glossary: { kind: "posts", steps: ["glossary"] },
  ideas: { kind: "posts", steps: ["ideas"] },
  quotes: { kind: "posts", steps: ["quotes"] },
  timeline: { kind: "posts", steps: ["timeline"] },
  /* The dearest press in the app — two calls out to the open web. */
  debate: { kind: "posts", steps: ["debate"] },
  /* **The one mode where the button and the target are not the same word**,
     and the one row where "what it costs" and "what it arms" are two questions.

     Diagram opens on whichever picture `?diagram=` names, so a press on the bar
     has to arm the picture that is about to mount — a row that armed only the
     default would be a lie about four fifths of the presses, and an expensive
     one. **All five are here**, because two of the three that arm nothing turn
     out to spend anyway: the picture's own hook buys an embedding on mount,
     with no token in front of it (src/web/activation.ts § `activationForDiagram`
     has what that means and why it is deliberate). `SPENDS` covered Sketch and
     Illustrated alone until GPT Sol's F11, 2026-09-06, and the prose it was
     written from said the geometries "cost nothing".

     Sketch is `search: ""` rather than `?diagram=sketch` on purpose: the
     default is what a reader who has never touched a chip gets. */
  diagram: {
    kind: "delegated",
    presses: [
      { search: "", steps: ["sketch"], spends: [] },
      { search: "?diagram=illustrated", steps: ["illustrated"], spends: [] },
      /* No artefact, so no job — and one embedding each, all the same. */
      { search: "?diagram=force", steps: [], spends: [`POST /api/similar/${SLUG}`] },
      { search: "?diagram=drift", steps: [], spends: [`POST /api/projection/${SLUG}`] },
      { search: "?diagram=trail", steps: [], spends: [`POST /api/projection/${SLUG}`] },
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

/**
 * Every press a row asks for. A row that is not `delegated` is one press at the
 * bare address, and **must buy nothing outside the job queue** — that default
 * is what makes a new paid endpoint reachable from an existing mode a red test.
 */
function pressesFor(spend: Spend): Press[] {
  if (spend.kind === "delegated") return [...spend.presses];
  return [{ search: "", steps: spend.kind === "posts" ? spend.steps : [], spends: [] }];
}

const PHASE_MS = 30_000;

/* **One sweep per door**, and the assertions inside are the same four either
   way — that identity is the test. See `Trigger`, and GPT Sol's F4, which is
   why cost parity is measured here rather than by comparing tokens. */
for (const trigger of TRIGGERS) {
  describe(`phase A — what opening each mode from the ${trigger.name} spends`, () => {
    for (const mode of MODES) {
      const spend = SPENDS[mode];
      it(
        `${mode}: ${spend.kind === "none" ? `spends nothing — ${spend.why}` : "arms what it says it arms"}`,
        async () => {
          let ran = 0;
          for (const want of pressesFor(spend)) {
            ran += 1;
            /* A fresh root per press: `root.render` reconciles rather than
               remounts, so a second address would inherit the first's mode. */
            await act(async () => root.unmount());
            host.remove();
            host = document.createElement("div");
            document.body.append(host);
            root = createRoot(host);
            posts.length = 0;
            mutations.length = 0;
            resetActivations();
            jobEngine.reset();
            /* Illustrated is painted from the Sketch, so its press can only arm
               anything on an article that has one. See `sketchDrawn`. */
            sketchDrawn = want.steps.includes("illustrated");

            await open(want.search, { strict: false });
            /* The positive control: the page is a working reader before the
               press, so "no POST" below is a settled page rather than an empty
               one. */
            expect(host.querySelector(".dock-modes"), "no bar to press").not.toBeNull();
            await trigger.press(mode);
            await settle();

            expect(modeInUrl(), `${mode}: the ${trigger.name} did not change mode`).toBe(mode);
            expect(
              posts.map((p) => p.steps),
              `${mode}${want.search}: what the ${trigger.name} asked the queue for`,
            ).toEqual(want.steps.length === 0 ? [] : [[...want.steps]]);
            /* The other half of the money, and the half nothing watched until
               2026-09-06: a paid request the press made for itself. */
            expect(
              paidPosts(),
              `${mode}${want.search}: what the ${trigger.name} bought outside the job queue`,
            ).toEqual([...want.spends].sort());
            /* And what it left **armed**. A token nobody claimed is money not yet
               spent rather than money not spent — see `stillPending`. */
            expect(
              stillPending(),
              `${mode}${want.search}: presses left armed and unclaimed after the page settled`,
            ).toEqual([]);
          }
          /* **Outside the loop**, because a table can promise a press and then
             list none, and a loop over nothing passes. See `AtLeastOne`. */
          expect(ran, `${mode}: the row named no press to make`).toBeGreaterThan(0);
        },
        PHASE_MS,
      );
    }
  });
}

/* ============================================================== phase B ====

   Artefacts populated. What each mode's controller actually drew. */

/**
 * **What the owner's own controller must have on screen**, on this file's
 * populated fixture — one row for **every** mode, with no exclusions.
 *
 * This was keyed `Exclude<Mode, (typeof NO_BAND_MODES)[number]>` off a
 * `NO_BAND_MODES` list until GPT Sol's F21, and that was the very mistake this
 * file exists to prevent, committed one level up. The list was read twice: once
 * to *excuse* a mode from having a row here, and once to *skip* it at run time.
 * So a fifteenth mode added to it needed no expectation, was skipped by phase
 * B, and — because the two absence tests were hand-written separately — got no
 * absence test either. A mode could be added, wired up wrongly, and pass
 * everything. Deriving the requirement and the skip from one list is exactly a
 * test that agrees with an omission.
 *
 * The union has no such door. Every mode is named, and **"draws no band" is a
 * decision written down with its own positive control** rather than an absence:
 *
 *  - `where` — the band, as a selector. Never nullable, or a mode that drew
 *    nothing could pass by saying so.
 *  - `says` — one string that must be readable **inside that band**, and it is
 *    a body literal invented in this file: not a heading, not a status line, not
 *    a button label, and never a sentence the empty state could draw.
 *  - `control` — for a bandless mode, what must be on screen *instead*. Not
 *    optional, because "no band" is also what a page that failed to load draws.
 */
type Draws =
  | { kind: "band"; where: string; says: string }
  | {
      kind: "none";
      why: string;
      /* Spelled out rather than built from the mode, because Hierarchy needs
         `&cols=1` — see its note below. */
      query: string;
      control: { where: string; says: string };
    };

const DRAWS: Record<Mode, Draws> = {
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
  hierarchy: {
    kind: "none",
    why: "it draws the gist columns beside the prose, not a band",
    query: "?mode=hierarchy&cols=1",
    control: { where: ".gist-text", says: COLUMN_GIST },
  },
  /* The article, and nothing over it. */
  plain: {
    kind: "none",
    why: "it leaves the article alone",
    query: "?mode=plain",
    control: { where: ".prose", says: PARAGRAPH },
  },
  /* The child node's title, from the tree in the payload — the one row this
     fixture's structure can produce. Deliberately **not** a gist: gists are in
     the columns beside the prose as well, so a gist would pass over an empty
     band the moment the columns happened to be open. */
  outline: { kind: "band", where: ".mode-band.outln", says: OUTLINE_ROW },
  /* **The part's title, and it is `OUTLINE_ROW` because the fixture has one
     depth-1 node and that is its title** — not because this row was copied from
     the one above. The two modes draw the same word here and the selectors are
     what tell them apart, which is the scope this table's `where` exists to
     provide: Outline's list and Structure's column A are the same tree read two
     ways, so on a one-part fixture they necessarily agree about the word.

     **This row can only ever prove column A**, and that is a limit of the
     fixture rather than of the table. The tree above has a root and one part and
     no section, so there is no depth-2 title to name and no reader position that
     puts column B on screen; a Structure that never rendered its right-hand
     column would satisfy this row exactly. Widening the fixture would change
     what Hierarchy, Outline and Summary draw in the same run, so the other half
     is asserted in a file of its own —
     tests/structure-panel-draws-both-columns.test.tsx, which mounts the panel on
     a two-part tree and reads both columns by position. GPT Sol's review of the
     plan, finding 8.

     Structure also draws **no measuring copies**, unlike Outline, so there is no
     `aria-hidden` duplicate for a raw `textContent` read to be satisfied by —
     the trap documented on `BAND_SAYS` in tests/public-network-trace.test.tsx.
     Stage 2 adds them, and this row's scope already survives that. */
  structure: { kind: "band", where: ".mode-band.struct", says: OUTLINE_ROW },
  /* The root's own gist, drawn as the band rather than as a column. */
  summary: { kind: "band", where: ".mode-band.summ", says: ROOT_GIST },
  /* An entry's name, which is what a closed row shows — a canary the panel
     cannot draw without having drawn the list. */
  glossary: { kind: "band", where: ".mode-band.gloss", says: GLOSSARY_TERM },
  /* The idea's **name** rather than its statement, for the same reason. */
  ideas: { kind: "band", where: ".mode-band.ideas", says: IDEA_NAME },
  /* **The line itself, and it had to be**: the panel draws the quoted words and
     not the model's reason for choosing them. See `QUOTE_LINE`. */
  quotes: { kind: "band", where: ".mode-band.quotes", says: QUOTE_LINE },
  /* The event's label. The dating phrase beside it is drawn too, but a label is
     the row's own content where a phrase could come from a formatter. */
  timeline: { kind: "band", where: ".mode-band.timeline", says: TIMELINE_LABEL },
  /* What the found page is said to bear on — a row's body, not the group
     heading above it, which is a constant sentence. */
  debate: { kind: "band", where: ".mode-band.dbt", says: DEBATE_APPLIES },
  /* A node **inside** the drawing, not the drawing's title: a title is drawn
     from the artefact's header and survives a scene that painted nothing. */
  diagram: { kind: "band", where: ".mode-band.diag", says: SKETCH_NODE },
  /* The owner's own saved question. Asserting the band's *"Search"* heading
     would pass over an empty `<aside>`. */
  search: { kind: "band", where: ".mode-band.srch", says: SEARCH_CRITERION },
  /* The referee's own criterion, off the saved list — and the band opens on
     Criteria, so this is the sub-mode a press actually lands on. */
  referee: { kind: "band", where: ".mode-band.referee", says: CRITERION_TEXT },
  /* **The two conversation bands share a component and a class**, so the
     negation is what keeps these two rows apart: Remember's band carries
     `remember` as well as `chat`, and without `:not()` a Remember panel drawn
     in Chat's place would satisfy this row. */
  chat: { kind: "band", where: ".mode-band.chat:not(.remember)", says: CHAT_TITLE },
  /* Recall, which is the half Remember opens on. */
  remember: { kind: "band", where: ".mode-band.remember", says: REMEMBER_TITLE },
};

describe("phase B — what each mode's real controller drew", () => {
  for (const mode of MODES) {
    const row = DRAWS[mode];

    if (row.kind === "none") {
      it(
        `${mode}: draws no band, because ${row.why}`,
        async () => {
          fixtures = "populated";
          await open(row.query);

          /* The control first, and it is the whole of the test. "No band" is
             also what a page that failed to load draws, so the absence below
             means nothing until something only this mode puts on screen has
             been found. */
          expect(row.control.says.trim(), `${mode}: the row named no control`).not.toBe("");
          const shown = [...host.querySelectorAll(row.control.where)].map(readable).join("\n");
          expect(shown, `${mode}: ${row.control.where} drew nothing`).toContain(row.control.says);

          expect(host.querySelector(".mode-band"), `${mode} opened a band`).toBeNull();
        },
        PHASE_MS,
      );
      continue;
    }

    it(
      `${mode}: draws its own body in ${row.where}`,
      async () => {
        fixtures = "populated";
        await open(`?mode=${mode}`);

        /* `toContain("")` is true of every string, the empty one included, so
           an empty `says` would assert nothing at all — GPT Sol, F13. The type
           cannot catch a string that is only spaces; this can. */
        expect(row.says.trim(), `${mode}: the row named nothing to look for`).not.toBe("");

        const band = host.querySelector(row.where);
        expect(band, `${mode}: no ${row.where} on the page`).not.toBeNull();
        expect(readable(band as Element), `${mode}: the band drew no body`).toContain(row.says);
      },
      PHASE_MS,
    );
  }

});

/* The two modes that draw no band used to be checked here, in tests written by
   hand beside the table rather than generated from it. They are rows in `DRAWS`
   now — GPT Sol's F21. Two hand-written tests cover the two modes somebody
   thought of; a `kind: "none"` row is *required of every mode that claims to
   draw nothing*, and carries the positive control with it. */
