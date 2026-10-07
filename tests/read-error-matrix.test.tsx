// @vitest-environment jsdom
/**
 * **A failed read, in every mode that has one: a sentence written for a reader,
 * and a way to ask again.**
 *
 * FAQ got *Try again* in `418a3d57f`, and the fix reached four panels of
 * thirteen. Fourteen hooks put `(err as Error).message` on screen, so Safari's
 * "Load failed" reached a reader as the explanation. The pattern — *the fix
 * landed only in the mode being built* — was found three times by the fifth
 * sweep, so this is one table with a row per panel, and a second half that
 * finds the mode a fix missed.
 * docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md
 * § Stage 1d.
 *
 * ## The whole app, and only the network is posed
 *
 * `<App/>` under a `NuqsAdapter` at the owner's article, the harness
 * tests/every-mode-draws-its-surface.test.tsx establishes: the real hook, the
 * real band, the real panel, the real `apiFetch` and the real job engine. What
 * is faked is `fetch`. That matters for the first column: a lost connection is
 * recognised by the mark `apiFetch` puts on a `TypeError` that came out of
 * `fetch`, so a test that mocked `apiFetch` could not tell a hook that goes
 * through `describeFetchFailure` from one that happens to print the same words.
 *
 * ## Two columns, because Arc is in one and not the other
 *
 *  - **the sentence** — all fourteen hooks. A bare `TypeError("Load failed")`
 *    out of `fetch` is said as `COULD_NOT_REACH` and, on a built page, with none
 *    of the browser's words; an exception nobody wrote for a reader is said as
 *    `PAGE_FAULT`, never in its own words.
 *  - **the recovery** — the thirteen panels. A button named *Try again*; pressing
 *    it makes exactly one more GET and **no** `POST /api/jobs`; on success the
 *    artefact is on screen. `useArc` is not in this column: nothing draws its
 *    `error`, so there is nothing to put a button beside.
 *
 * ## What *Try again* may and may not spend (plan § F1)
 *
 * `retryRead` itself sends only a GET. A press still in hand is honoured exactly
 * as it would have been had the first read answered — useAutoRun.ts § A failed
 * read is not an answer. Both halves are pinned at the foot of this file, for an
 * ordinary mode and for Thread, which starts by arrival.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COULD_NOT_REACH, PAGE_FAULT, THREAD_RECHECK_FAILED } from "../src/messages.js";
import type { Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { modeDoor } from "./helpers/dock-more.js";
import type { Article, Block, BlockId } from "../src/types.js";
import { MalformedReply } from "../src/web/lib/reader-facing.js";

const OWNER = { id: "owner-1", email: "owner@example.com" };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: OWNER, loading: false, known: true }),
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

/* A failed GET is answered from the offline copy when there is one
   (lib/api.ts), and a copy is a 200. There is none here, said outright rather
   than left to jsdom having no IndexedDB. */
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => undefined,
  reserveTicket: async () => null,
  invalidate: async () => undefined,
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => null,
  forgetUser: () => {},
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

/* ------------------------------------------------------------- the article -- */

const SLUG = "a-piece";
const PARAGRAPH =
  "The instrument was built before anybody could say what it would measure, and the theory followed it.";
const SECOND = "A later chapter revisits the same episode from the other side again.";
const QUOTE_LINE = "before anybody could say what it would measure";

const BLOCKS: Block[] = [
  { id: "spya-aaaaaa" as BlockId, tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
  { id: "spya-bbbbbb" as BlockId, tag: "p", kind: "text", text: PARAGRAPH, words: 17, html: `<p>${PARAGRAPH}</p>`, gistable: true },
  { id: "spya-cccccc" as BlockId, tag: "p", kind: "text", text: SECOND, words: 11, html: `<p>${SECOND}</p>`, gistable: true },
];

const OWNED: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: {
    version: "test",
    generator: "test",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: { id: "n0", depth: 0, parent: null, children: ["n1"], range: ["spya-aaaaaa", "spya-cccccc"], title: "A piece", gist: "The root's gist." },
      n1: { id: "n1", depth: 1, parent: "n0", children: [], range: ["spya-bbbbbb", "spya-cccccc"], title: "The first section", gist: "The child's gist." },
    },
  } as Article["tree"],
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/* --------------------------------------------------------- what is stored --

   One invented string per artefact, so a band cannot satisfy its row with
   another band's content or with chrome. The shapes are
   tests/every-mode-draws-its-surface.test.tsx's, cut to one row each. */

const STAMP = { version: "test", generator: "test", slug: SLUG, sourceHash: "hash", generatedAt: "2026-09-01T09:00:00.000Z", elapsedMs: 1 };
const AT = { blockId: "spya-bbbbbb", quote: "The instrument was built", start: 0 };
const HASH = "a".repeat(64);

const SAYS = {
  faq: "Why trust a rig nobody could yet explain?",
  simple: "A short one about the rig.",
  skim: "Where the chapter turns",
  tweets: "The rig came first; the theory of what it measured came later.",
  ideas: "Instruments outrun explanation",
  timeline: "The Vienna calibration",
  quotes: QUOTE_LINE,
  debate: "The Leiden replication",
  glossary: "Kolmogorov depth",
  citations: "Elements of Episodic Memory",
  quiz: "What was built before it could be explained?",
  illustrated: "The rig, painted",
  sketch: "The calibrated rig",
} as const;

const NO_LOSSES = { uncited: 0, selfSource: 0, unverifiedSource: 0, directnessUnverified: 0, sourceIsCopy: 0, claimNotInBlock: 0, unknownBlockId: 0, malformed: 0 };
const COUNTS = { returnedSources: 1, reportedRows: 1, keptRows: 1, omittedOverCap: 0, lost: NO_LOSSES, webSearches: 1 };

const para = (text: string, id = "spya-bbbbbb") => ({ text, ids: [id] });

/** What each artefact's GET answers when it answers. Keyed by the path segment after `/api/`. */
const BODIES: Record<string, unknown> = {
  faq: {
    faq: {
      ...STAMP,
      questions: [{ id: "faq-q1", question: SAYS.faq, passages: [AT] }],
      dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, unanchored: 0, overCap: 0, malformed: 0 },
    },
    stale: false,
    outdated: false,
  },
  simple: {
    simpleSummary: {
      ...STAMP,
      version: "simple/2",
      profileHash: null,
      levels: {
        brief: [para(SAYS.simple), para("And why it matters.", "spya-cccccc")],
        simple: [para("The plain one."), para("Its second.", "spya-cccccc")],
        fuller: [para("The fuller one."), para("Its second."), para("Its third.", "spya-cccccc")],
      },
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  skim: {
    skim: {
      ...STAMP,
      profileHash: null,
      stops: [{ quoteId: "spya-qte234", depth: 1, role: SAYS.skim }],
      visible: [1, 1, 1],
      offered: 1,
      dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
    },
    stale: false,
    outdated: false,
    profileChanged: false,
    notOnRoute: 0,
  },
  tweets: {
    thread: {
      ...STAMP,
      version: "tweets/5",
      limit: 280,
      tweets: [{ text: SAYS.tweets, chars: [...SAYS.tweets].length, blocks: ["spya-bbbbbb"] }],
    },
    stale: false,
    profileChanged: false,
  },
  ideas: {
    ideas: {
      ...STAMP,
      ideas: [
        {
          id: "spya-kdea34",
          name: SAYS.ideas,
          provenance: "assumed",
          statement: "You cannot theorise about what you have no way to measure.",
          occurrences: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", reasoning: "It rests on it." }],
        },
      ],
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  timeline: {
    timeline: {
      ...STAMP,
      events: [
        {
          id: "spya-evt234",
          label: SAYS.timeline,
          dating: { kind: "words", phrase: "before the theory" },
          order: 1,
          modality: "happened",
          occurrences: [AT],
        },
      ],
      orderConflicts: 0,
    },
    stale: false,
    outdated: false,
  },
  quotes: {
    quotes: {
      ...STAMP,
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
      discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  debate: {
    debate: {
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
            title: SAYS.debate,
            sourceQuote: "We could not reproduce the calibration.",
            relation: "disputes",
            lean: "leans-against",
            applies: "A replication in Leiden reached the opposite reading.",
            articleReferenceQuote: "The instrument was built",
            /* `quoted`, or the identification bar hides the row — every-mode
               test's note on this fixture has the story. */
            identifies: [
              {
                kind: "quoted",
                quote: "instrument was built before anybody could say what it would measure",
                blockId: "spya-bbbbbb",
                coverage: 0.5,
                density: 0.2,
              },
              { kind: "named", by: "title", witness: "The instrument was built" },
            ],
          },
        ],
        counts: COUNTS,
      },
      claims: { rows: [], counts: { ...COUNTS, returnedSources: 0, reportedRows: 0, keptRows: 0 } },
      elapsedMs: 1,
    },
    stale: false,
    outdated: false,
  },
  glossary: {
    glossary: {
      ...STAMP,
      entries: [
        {
          id: "spya-term23",
          name: SAYS.glossary,
          kind: "concept",
          aliases: [],
          senseHere: "How much work it took to build the thing.",
          blocks: ["spya-bbbbbb"],
        },
      ],
      passes: 1,
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  citations: {
    citations: {
      ...STAMP,
      citations: [
        {
          id: "spya-c7t2wd",
          key: "work:elements of episodic memory|tulving|1983",
          title: SAYS.citations,
          authors: "Tulving",
          year: "1983",
          why: "The idea the piece tests.",
          relevance: 0.9,
          influence: 0.9,
          mentions: [AT],
          citedAt: ["spya-bbbbbb"],
          firstCited: "spya-bbbbbb",
          citedInBody: true,
          url: "https://scholar.google.com/scholar?q=Elements",
          linkFrom: "search",
        },
      ],
      capped: false,
    },
    stale: false,
    outdated: false,
  },
  quiz: {
    quiz: {
      ...STAMP,
      version: "quiz/1",
      batchId: "spya-batch2",
      questions: [
        {
          id: "spya-qm9qt2",
          question: SAYS.quiz,
          referenceAnswer: "The instrument.",
          evidence: [AT],
        },
      ],
      dropped: { unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 },
    },
    stale: false,
    outdated: false,
    profileChanged: false,
    /* As the route sends it: the reader has answered nothing. Left off, the
       panel says their earlier answers could not be loaded and draws its own
       Try again — which is true of a response with no `attempts`, and not what
       this row is about. */
    attempts: [],
  },
  illustrated: {
    illustrated: {
      version: "illustrated/1",
      generator: "a-model",
      illustrator: "openai/gpt-image-2",
      style: "A plain register.",
      profileHash: null,
      plates: [
        {
          sceneId: "overview",
          title: SAYS.illustrated,
          prompt: "A workbench, in gouache.",
          vignettes: [{ block: "spya-bbbbbb", quote: QUOTE_LINE, depicts: "A rig on a workbench" }],
          image: { sha256: HASH, ext: "jpeg", bytes: 73_000, width: 1024, height: 1536 },
        },
      ],
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  sketch: {
    sketch: {
      title: "One instrument, one claim",
      caption: "The measurement is doing the arguing.",
      scenes: [
        {
          id: "s0",
          title: "Overview",
          height: 200,
          items: [
            { kind: "node", id: "n1", shape: "box", x: 10, y: 10, w: 140, h: 40, text: SAYS.sketch, size: "md", block: "spya-bbbbbb" },
          ],
        },
      ],
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  arc: { arc: { ...STAMP, entries: [] }, stale: false },
};

/* ------------------------------------------------------------ the network -- */

type Answer =
  /** 200 with `BODIES[kind]`. */
  | "ok"
  /** 200 with exactly this body, whatever it is. */
  | { body: unknown }
  /** 404 — nobody has asked for one. The default. */
  | "missing"
  /** `fetch` rejects the way a dropped connection does, in Safari's words. */
  | "transport"
  /** A 200 whose artefact is null, contradicting the declared response type. */
  | "null-artefact"
  /** `fetch` rejects with an exception nobody wrote for a reader. */
  | "fault";

/** What the browser says, and what a reader must never be shown. */
const BROWSER_WORDS = "Load failed";
/** A programming fault's own text, which must stop at the console. */
const FAULT_WORDS = "zq-internal: cannot read properties of undefined";

let answers: Record<string, Answer> = {};
/** What another article's artefact GETs answer, by slug then kind — the slug-change rows. */
let elsewhere: Record<string, Record<string, Answer>> = {};
/** What `GET /api/jobs` lists — empty unless a test runs a job to make a read refresh. */
let jobs: unknown[] = [];
/** Every artefact GET, by kind — the exact `/api/<kind>/<slug>` and nothing under it. */
let gets: Record<string, number> = {};
/** Every `POST /api/jobs` body, in order. */
let posts: { slug?: string; steps?: string[]; force?: string[] }[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function artefactResponse(kind: string, answer: Answer): Response {
  if (typeof answer === "object") return json(answer.body);
  if (answer === "transport") throw new TypeError(BROWSER_WORDS);
  if (answer === "fault") throw new Error(FAULT_WORDS);
  if (answer === "null-artefact") return json({ [kind]: null, stale: true, outdated: true, profileChanged: true });
  return answer === "ok" ? json(BODIES[kind]) : new Response(null, { status: 404 });
}

async function reply(url: string, method: string, body: string | null): Promise<Response> {
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: "2026-01-01T00:00:00.000Z" });
  if (url === "/api/jobs" && method === "POST") {
    posts.push(JSON.parse(body ?? "{}"));
    return new Response(null, { status: 204 });
  }
  if (/\/api\/illustrated\/[^/]+\/[0-9a-f]{64}\.jpeg$/.test(url)) {
    return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  }
  if (method !== "GET") return new Response(null, { status: 204 });
  if (url === "/api/jobs") return json({ jobs });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/search/")) return json({ runs: [] });
  /* Reception's *Cited by*, answered as the route answers an article with no
     DOI. A 404 here would be its `unavailable`, which draws a second *Try
     again* in Debate's band beside the one this file counts (plan 261004h). */
  if (url.startsWith("/api/citers/")) return json({ kind: "no-doi" });
  const other = /^\/api\/([a-z]+)\/([^/]+)$/.exec(url);
  const there = other?.[2] === undefined ? undefined : elsewhere[other[2]];
  if (there && other?.[1] && other[1] in there) return artefactResponse(other[1], there[other[1]] as Answer);
  const kind = new RegExp(`^/api/([a-z]+)/${SLUG}$`).exec(url)?.[1];
  if (kind && kind in BODIES) {
    gets[kind] = (gets[kind] ?? 0) + 1;
    /* The arc is there unless a test says otherwise: `useArc` asks for one the
       moment it reads a 404, on every owned article, and that job would be in
       every row's `posts`. */
    const answer = answers[kind] ?? (kind === "arc" ? "ok" : "missing");
    return artefactResponse(kind, answer);
  }
  if (kind) return new Response(null, { status: 404 });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { useArc } = await import("../src/web/useArc.js");
const { SketchView } = await import("../src/web/SketchView.js");
const { IllustratedView } = await import("../src/web/IllustratedView.js");
const { useIdeasRead } = await import("../src/web/useIdeas.js");
const { useQuotesRead } = await import("../src/web/useQuotes.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { useQuizRead } = await import("../src/web/useQuiz.js");
const { useTweets } = await import("../src/web/useTweets.js");
const { useSkim } = await import("../src/web/useSkim.js");
const { useSketch } = await import("../src/web/useSketch.js");
const { useIllustrated } = await import("../src/web/useIllustrated.js");
const { useFaqRead } = await import("../src/web/useFaq.js");
const { useTimelineRead } = await import("../src/web/useTimeline.js");
const { useDebateRead } = await import("../src/web/useDebate.js");
const { useCitationsRead } = await import("../src/web/useCitations.js");
const { useSimple } = await import("../src/web/useSimple.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answers = {};
  elsewhere = {};
  jobs = [];
  gets = {};
  posts = [];
  resetActivations();
  jobEngine.reset();
  resetExperimental();
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
  URL.createObjectURL = vi.fn(() => "blob:spideryarn/plate-1");
  URL.revokeObjectURL = vi.fn();
  /* `describeFetchFailure` reports a fault to the console, and Tweets logs its
     own; neither is what a failing row should be read through. */
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    reply(String(input), (init?.method ?? "GET").toUpperCase(), (init?.body as string | undefined) ?? null),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The whole app at the owner's article. Not under `<StrictMode>`: requests are counted. */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await act(async () => {
    for (const fn of [...authListeners]) fn("SIGNED_IN", { user: OWNER });
  });
  await settle();
}

const UNREADABLE = '[aria-hidden="true"], [hidden], [class*="sr-only"]';

/** What a reader can read in `el` — every-mode test § `readable`. */
function readable(el: Element | null): string {
  if (!el || el.closest(UNREADABLE)) return "";
  const copy = el.cloneNode(true) as HTMLElement;
  for (const unread of copy.querySelectorAll(UNREADABLE)) unread.remove();
  return copy.textContent ?? "";
}

function tryAgain(within: Element | null): HTMLButtonElement | undefined {
  return [...(within?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === "Try again",
  );
}

async function press(button: HTMLButtonElement | undefined): Promise<void> {
  await act(async () => button?.click());
  await settle();
}

/* --------------------------------------------------------------- the table -- */

interface Row {
  /** The hook file under src/web whose read this is — the static half's key. */
  hook: string;
  /** The path segment of its GET: `/api/<kind>/<slug>`. */
  kind: keyof typeof SAYS;
  /** The address that opens its band — a pasted link, so nothing is armed. */
  search: string;
  /** The band the sentence and the button must be inside. */
  where: string;
  /** Other artefacts that must be there for this one's body to draw. */
  needs?: readonly string[];
  /** What the loaded artefact puts on screen, where that is not `SAYS[kind]`. */
  shows?: string;
}

const ROWS: readonly Row[] = [
  { hook: "useFaq.ts", kind: "faq", search: "?mode=faq", where: ".mode-band.faq" },
  { hook: "useSimple.ts", kind: "simple", search: "?mode=summary", where: ".mode-band.summ" },
  { hook: "useSkim.ts", kind: "skim", search: "?mode=skim", where: ".mode-band.skim", needs: ["quotes"] },
  { hook: "useTweets.ts", kind: "tweets", search: "?mode=summary&summary=thread", where: ".mode-band.summ.tweets" },
  { hook: "useIdeas.ts", kind: "ideas", search: "?mode=ideas", where: ".mode-band.ideas" },
  { hook: "useTimeline.ts", kind: "timeline", search: "?mode=timeline", where: ".mode-band.timeline" },
  { hook: "useQuotes.ts", kind: "quotes", search: "?mode=quotes", where: ".mode-band.quotes" },
  { hook: "useDebate.ts", kind: "debate", search: "?mode=debate", where: ".mode-band.dbt" },
  { hook: "useGlossary.ts", kind: "glossary", search: "?mode=glossary", where: ".mode-band.gloss" },
  { hook: "useCitations.ts", kind: "citations", search: "?mode=citations", where: ".mode-band.citations" },
  {
    hook: "useQuiz.ts",
    kind: "quiz",
    search: "?mode=learn&learn=quiz",
    where: ".mode-band.quiz",
    /* Nothing has been read in this harness, so *Only what I've read* holds the
       one question back and says how many there are — a sentence the panel can
       only draw from the loaded batch. */
    shows: "to see all 1",
  },
  { hook: "useIllustrated.ts", kind: "illustrated", search: "?mode=diagram&diagram=illustrated", where: ".mode-band.diag" },
  { hook: "useSketch.ts", kind: "sketch", search: "?mode=diagram", where: ".mode-band.diag" },
];

/**
 * **Every other caller of `useOrderedRead`, and why it has no row.** A new
 * caller is red until it is a row above or a line here; see the static half.
 */
const NOT_A_ROW: Record<string, string> = {
  "useOrderedRead.ts": "the definition itself",
  "useCiters.ts":
    "Reception's Cited by is a section inside Debate's band, not a mode's artefact read: it has no error string at all. Every failed request is its `unavailable` outcome, with its own fixed sentence and its own Try again, checked in tests/use-citers.test.tsx and tests/debate-panel.test.tsx.",
  "useArc.ts":
    "its `error` is never drawn — Reader reads `capability.arc.arc` and nothing else of it — so there is nothing to put a button beside. Its sentence is checked below.",
  "useClaims.ts":
    "Referee's claims run is a stored stream run, not a mode panel's artefact read; it already goes through `describeFetchFailure` and words its own load failure.",
  "useRelations.ts":
    "Marginalia's relation words: a failed read stores no message and draws nothing, the notes simply have no connective.",
  "useCrossrefs.ts":
    "an enhancement over the prose with no error state at all: a failed first read draws no links, a failed re-read keeps the ones it had, and neither says anything (tests/crossrefs-revalidate.test.tsx).",
  "Metadata.tsx":
    "the metadata page's provenance read, not a mode band: no ReadError and no Try again, the sentence heads AI processing and a failed first read asks again on a timer. It goes through `describeFetchFailure` since 2026-10-06, checked in tests/metadata-failed-read-says-a-readers-sentence.test.tsx.",
};

function arrange(row: Row, answer: Answer): void {
  answers = { [row.kind]: answer };
  for (const kind of row.needs ?? []) answers[kind] = "ok";
}

describe.each(ROWS)("$hook: a failed opening read", (row) => {
  const band = () => host.querySelector(row.where);

  it("says a lost connection in the reader's sentence, with none of the browser's words on a built page", async () => {
    vi.stubEnv("PROD", true);
    arrange(row, "transport");
    await open(row.search);
    const said = readable(band());
    expect(said).toContain(COULD_NOT_REACH.message);
    expect(said).not.toContain(BROWSER_WORDS);
  });

  it("says a fault of the page's own as PAGE_FAULT, never in the fault's words", async () => {
    arrange(row, "fault");
    await open(row.search);
    const said = readable(band());
    expect(said).toContain(PAGE_FAULT.message);
    expect(said).not.toContain(FAULT_WORDS);
  });

  it("draws Try again; pressing it is one more GET, no job, and the artefact", async () => {
    arrange(row, "transport");
    await open(row.search);
    expect(band()?.querySelector('[role="alert"]'), "the sentence is not announced").not.toBeNull();
    const button = tryAgain(band());
    expect(button, "no button named Try again in the band").toBeDefined();

    const before = gets[row.kind] ?? 0;
    expect(before, "the opening read was never made").toBeGreaterThan(0);
    arrange(row, "ok");
    await press(button);

    expect((gets[row.kind] ?? 0) - before, "Try again must be exactly one more GET").toBe(1);
    expect(posts, "Try again started a job on a pasted link").toEqual([]);
    expect(readable(band())).toContain(row.shows ?? SAYS[row.kind]);
    expect(band()?.querySelector('[role="alert"]'), "the error outlived the recovery").toBeNull();
    expect(tryAgain(band())).toBeUndefined();
  });
});

/* ------------------------------------------------------ Arc, sentence only -- */

describe("useArc.ts: a failed read", () => {
  let seen: { status: string; error: string | null } | null = null;
  function Probe(): ReactElement | null {
    seen = useArc(SLUG, undefined);
    return null;
  }
  async function mount(): Promise<void> {
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
  }

  it("holds a lost connection as the reader's sentence", async () => {
    vi.stubEnv("PROD", true);
    answers = { arc: "transport" };
    await mount();
    expect(seen).toMatchObject({ status: "error", error: COULD_NOT_REACH.message });
  });

  it("holds a fault of the page's own as PAGE_FAULT", async () => {
    answers = { arc: "fault" };
    await mount();
    expect(seen).toMatchObject({ status: "error", error: PAGE_FAULT.message });
  });
});

/* ------------------------------------------- a picture kept through a failure --

   Sketch and Illustrated keep a loaded picture through a failed revalidation
   (the `was === "loading" ? "error" : was` guard) and drew the error only in
   their empty branch — so the failure was silent, and there was no way to ask
   again. Plan § F4. The revalidation here is the one both hooks already make
   on their own: a new block order re-keys the read. */

const MORE_BLOCKS: Block[] = [
  ...BLOCKS,
  { id: "spya-dddddd" as BlockId, tag: "p", kind: "text", text: "A fourth.", words: 2, html: "<p>A fourth.</p>", gistable: true },
];

describe.each([
  {
    name: "Sketch",
    kind: "sketch" as const,
    view: (blocks: Block[]) =>
      createElement(SketchView, { access: { kind: "owner", slug: SLUG }, blocks, atRow: null, onJump: () => {} }),
  },
  {
    name: "Illustrated",
    kind: "illustrated" as const,
    view: (blocks: Block[]) => createElement(IllustratedView, { slug: SLUG, blocks, onJump: () => {} }),
  },
])("$name: a failed revalidation beside a picture that is there", ({ kind, view }) => {
  it("also offers the failed read again after an earlier 404", async () => {
    vi.stubEnv("PROD", true);
    answers = { [kind]: "missing" };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(view(BLOCKS)));
    await settle();
    expect(gets[kind]).toBe(1);

    answers = { [kind]: "transport" };
    await act(async () => root.render(view(MORE_BLOCKS)));
    await settle();
    expect(gets[kind]).toBe(2);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(COULD_NOT_REACH.message);
    expect(tryAgain(host)).toBeDefined();

    answers = { [kind]: "ok" };
    await press(tryAgain(host));
    expect(gets[kind]).toBe(3);
    expect(posts).toEqual([]);
    expect(readable(host)).toContain(SAYS[kind]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps the picture, says so with Try again, and recovers on one GET with no job", async () => {
    vi.stubEnv("PROD", true);
    answers = { [kind]: "ok" };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(view(BLOCKS)));
    await settle();
    expect(readable(host)).toContain(SAYS[kind]);
    expect(host.querySelector('[role="alert"]')).toBeNull();

    answers = { [kind]: "transport" };
    await act(async () => root.render(view(MORE_BLOCKS)));
    await settle();
    expect(readable(host), "the failed revalidation took the picture away").toContain(SAYS[kind]);
    expect(host.querySelector('[role="alert"]')?.textContent, "the failure was silent").toBe(
      COULD_NOT_REACH.message,
    );
    const button = tryAgain(host);
    expect(button, "no Try again beside the kept picture").toBeDefined();

    const before = gets[kind] ?? 0;
    answers = { [kind]: "ok" };
    await press(button);
    expect((gets[kind] ?? 0) - before).toBe(1);
    expect(posts).toEqual([]);
    expect(readable(host)).toContain(SAYS[kind]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe.each([
  { kind: "ideas", use: () => { const read = useIdeasRead(SLUG); return { read, artefact: read.ideas }; } },
  { kind: "quotes", use: () => { const read = useQuotesRead(SLUG); return { read, artefact: read.quotes }; } },
  { kind: "glossary", use: () => { const read = useGlossaryRead(SLUG); return { read, artefact: read.glossary }; } },
  { kind: "quiz", use: () => { const read = useQuizRead(SLUG); return { read, artefact: read.quiz }; } },
])("$kind: a malformed revalidation", ({ kind, use }) => {
  it("reports PAGE_FAULT without committing the broken artefact, and retry keeps the loaded one", async () => {
    let seen!: ReturnType<typeof use>;
    function Probe() {
      seen = use();
      return null;
    }
    answers = { [kind]: "ok" };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    const kept = seen.artefact;
    expect(kept).toBeTruthy();
    expect(seen.read.status).toBe("ready");

    answers = { [kind]: "null-artefact" };
    await act(async () => seen.read.refresh());
    expect(seen.read.error).toBe(PAGE_FAULT.message);
    expect(seen.read.status).toBe("ready");
    expect(seen.artefact, "a rejected response replaced the loaded artefact").toBe(kept);
    expect([seen.read.stale, seen.read.outdated, seen.read.profileChanged, seen.read.profiled]).toEqual([
      false, false, false, false,
    ]);

    const before = gets[kind] ?? 0;
    answers = { [kind]: "ok" };
    await act(async () => seen.read.retryRead());
    expect((gets[kind] ?? 0) - before).toBe(1);
    expect(seen.read.error).toBeNull();
    expect(seen.read.status).toBe("ready");
    expect(seen.artefact).toEqual(kept);
    expect(posts).toEqual([]);
  });
});

/* ------------------------------------------ a picture's flags go with the picture --

   **A reply that was read and found to hold nothing drawable is "none", and
   "none" carries no flags.** Both picture hooks have a second way to `none`
   besides the 404: the stored value came back and the checker kept no scene
   (Sketch) or no plate (Illustrated). That branch cleared the picture and left
   `stale`, `outdated`, `profiled` and `profileChanged` as the previous picture
   had them. What the checker refused (`faults`) is kept on purpose: it is the
   only thing that says why there is nothing to draw. Plan 261007e § 3. */

const FLAGGED = { stale: true, outdated: true, profileChanged: true };
const BLOCK_IDS = BLOCKS.map((block) => block.id);

describe.each([
  {
    name: "Sketch",
    kind: "sketch",
    use: () => {
      const read = useSketch(SLUG, BLOCK_IDS);
      return { read, picture: read.sketch };
    },
    /* Something the checker refuses whole, so there are faults to keep. */
    nothingDrawable: { title: "t", caption: "c", scenes: ["not a scene"] },
  },
  {
    name: "Illustrated",
    kind: "illustrated",
    use: () => {
      const read = useIllustrated(SLUG, BLOCKS);
      return { read, picture: read.illustrated };
    },
    nothingDrawable: {
      ...(BODIES.illustrated as { illustrated: object }).illustrated,
      plates: "not a list",
    },
  },
])("$name: a checked-empty answer carries none of the last picture's flags", ({ kind, use, nothingDrawable }) => {
  const stored = (BODIES[kind] as Record<string, object>)[kind]!;
  const flagsOf = (read: ReturnType<typeof use>["read"]) => ({
    stale: read.stale,
    outdated: read.outdated,
    profiled: read.profiled,
    profileChanged: read.profileChanged,
  });

  it("flagged picture, then nothing drawable, then a fresh picture with flags of its own", async () => {
    let seen!: ReturnType<typeof use>;
    function Probe() {
      seen = use();
      return null;
    }
    answers = { [kind]: { body: { [kind]: { ...stored, profileHash: "a-profile" }, ...FLAGGED } } };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(seen.read.status).toBe("ready");
    expect(seen.picture).not.toBeNull();
    expect(flagsOf(seen.read)).toEqual({ stale: true, outdated: true, profiled: true, profileChanged: true });

    answers = { [kind]: { body: { [kind]: { ...nothingDrawable, profileHash: "a-profile" }, ...FLAGGED } } };
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.status).toBe("none");
    expect(seen.read.error).toBeNull();
    expect(seen.picture).toBeNull();
    expect(seen.read.faults.length, "what the checker refused is the only account of the emptiness").toBeGreaterThan(0);
    expect(flagsOf(seen.read), "the previous picture's flags, beside no picture").toEqual({
      stale: false,
      outdated: false,
      profiled: false,
      profileChanged: false,
    });

    answers = { [kind]: { body: { [kind]: stored, stale: false, outdated: true, profileChanged: false } } };
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.status).toBe("ready");
    expect(seen.picture).not.toBeNull();
    expect(flagsOf(seen.read)).toEqual({ stale: false, outdated: true, profiled: false, profileChanged: false });
    expect(posts).toEqual([]);
  });

  it("a 404 after a flagged picture clears the flags and the faults", async () => {
    let seen!: ReturnType<typeof use>;
    function Probe() {
      seen = use();
      return null;
    }
    answers = { [kind]: { body: { [kind]: { ...stored, profileHash: "a-profile" }, ...FLAGGED } } };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    /* Through the checked-empty answer first, so there are faults for the 404 to clear. */
    answers = { [kind]: { body: { [kind]: nothingDrawable, ...FLAGGED } } };
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.faults.length).toBeGreaterThan(0);
    answers = { [kind]: "missing" };
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.status).toBe("none");
    expect(seen.picture).toBeNull();
    expect(seen.read.faults).toEqual([]);
    expect(flagsOf(seen.read)).toEqual({ stale: false, outdated: false, profiled: false, profileChanged: false });
  });

  it("a failed re-read keeps the picture and its flags", async () => {
    let seen!: ReturnType<typeof use>;
    function Probe() {
      seen = use();
      return null;
    }
    answers = { [kind]: { body: { [kind]: { ...stored, profileHash: "a-profile" }, ...FLAGGED } } };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    const kept = seen.picture;
    answers = { [kind]: "transport" };
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.status).toBe("ready");
    expect(seen.read.error).not.toBeNull();
    expect(seen.picture).toBe(kept);
    expect(flagsOf(seen.read)).toEqual({ stale: true, outdated: true, profiled: true, profileChanged: true });
  });
});

/* **Thread and Skim, which published a reply before checking it** (WCO4, plan
   261007e). Their envelope's key is not their path's word, and Skim's hook
   stands on two other reads, so they are rows of their own. `readJson` checks
   no shape: an empty 200 is `{}`, and a reply with no artefact used to be
   committed as one (Thread ended `ready` with no thread; Skim ended `ready`
   with `undefined` for a route).

   **`200 null` is not one of the broken ones** (the umbrella's U15). It is how
   a route says "none yet" under `NONE_YET_AS_NULL_HEADER`; neither of these
   routes sends it today, and a reader of one must not call it a fault. */
const CORPUS = path.resolve(import.meta.dirname, "fixtures", "data-root", "data");

describe.each([
  {
    kind: "tweets",
    needs: [] as string[],
    use: () => {
      const read = useTweets(SLUG);
      return { read, artefact: read.thread, flags: [read.stale, read.profileChanged] };
    },
    /* Thread's own sentence for any failed re-read of a thread it has (useTweets.ts § the catch). */
    recheck: THREAD_RECHECK_FAILED.message,
    /* Thread starts by arrival: "none yet" is its cue to write one, a 404's or a null's alike. */
    onNone: [{ slug: SLUG, steps: ["tweets"] }] as unknown[],
    broken: [
      {},
      [],
      "a thread",
      { stale: true, profileChanged: true },
      { thread: null, stale: true, profileChanged: true },
      { thread: "a thread", stale: true, profileChanged: true },
    ] as unknown[],
  },
  {
    kind: "skim",
    needs: ["quotes", "ideas"],
    use: () => {
      const read = useSkim(SLUG, useQuotesRead(SLUG), useIdeasRead(SLUG));
      return {
        read,
        artefact: read.skim,
        flags: [read.stale, read.outdated, read.profileChanged, read.notOnRoute > 0],
      };
    },
    recheck: PAGE_FAULT.message,
    onNone: [] as unknown[],
    broken: [
      {},
      [],
      "a route",
      { stale: true, outdated: true, profileChanged: true, notOnRoute: 3 },
      { skim: null, stale: true, outdated: true, profileChanged: true, notOnRoute: 3 },
      /* The server refuses a route with no `stops` list as a 404 (`loadSkim`); so does the page. */
      { skim: { ...STAMP, profileHash: null }, stale: true, outdated: true, profileChanged: true, notOnRoute: 3 },
    ] as unknown[],
  },
])("$kind: a reply is checked before it is published", ({ kind, needs, use, recheck, onNone, broken }) => {
  let seen!: ReturnType<typeof use>;
  function Probe() {
    seen = use();
    return null;
  }
  const ready = (answer: Answer): Record<string, Answer> => ({
    ...Object.fromEntries(needs.map((need) => [need, "ok" as Answer])),
    [kind]: answer,
  });
  async function mount(answer: Answer) {
    answers = ready(answer);
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
  }

  const expectMalformedReply = () => {
    /* PAGE_FAULT alone also accepts a missing import's ReferenceError. Pin
       the deliberate refusal, through the real catch's diagnostic. */
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.any(MalformedReply));
  };

  it.each(["empty", "legacy"] as const)("accepts a stored %s artefact", async (variant) => {
    /* The current writers refuse empty output, but the store can still
       answer 200 for an empty array or an older producer's object. */
    const envelope = BODIES[kind] as Record<string, object>;
    const key = kind === "tweets" ? "thread" : "skim";
    const artefact = {
      ...envelope[key],
      ...(kind === "tweets"
        ? { version: "tweets/1", tweets: variant === "empty" ? [] : ["A stored legacy post."] }
        : { version: "trajectory/1", stops: variant === "empty" ? [] : [{ quoteId: "spya-qte234", depth: 1, role: "An old stop" }] }),
    };
    await mount({ body: { ...envelope, [key]: artefact } });
    expect(seen.read.status).toBe("ready");
    expect(seen.read.error).toBeNull();
    expect(seen.artefact).toEqual(artefact);
    expect(posts).toEqual([]);
  });

  it.each(broken.map((body) => ({ body, says: JSON.stringify(body) })))(
    "a malformed revalidation ($says) keeps the accepted answer and its flags, and says so",
    async ({ body }) => {
      await mount("ok");
      const kept = seen.artefact;
      expect(kept).toBeTruthy();
      expect(seen.read.status).toBe("ready");

      vi.mocked(console.error).mockClear();

      answers = ready({ body });
      await act(async () => seen.read.refresh());
      await settle(2);
      expect(seen.read.error).toBe(recheck);
      expectMalformedReply();
      expect(seen.read.status).toBe("ready");
      expect(seen.artefact, "a rejected reply replaced the loaded artefact").toBe(kept);
      expect(seen.flags, "a rejected reply's flags were published").toEqual(seen.flags.map(() => false));

      const before = gets[kind] ?? 0;
      answers = ready("ok");
      await act(async () => seen.read.retryRead());
      await settle(2);
      expect((gets[kind] ?? 0) - before).toBe(1);
      expect(seen.read.error).toBeNull();
      expect(seen.read.status).toBe("ready");
      expect(seen.artefact).toEqual(kept);
      expect(posts).toEqual([]);
    },
  );

  it.each(broken.map((body) => ({ body, says: JSON.stringify(body) })))(
    "a malformed opening read ($says) is a failed read, not an artefact",
    async ({ body }) => {
      await mount({ body });
      expectMalformedReply();
      expect(seen.read.status).toBe("error");
      expect(seen.read.error).toBe(PAGE_FAULT.message);
      expect(seen.artefact).toBeNull();
      expect(posts).toEqual([]);
    },
  );

  it("reads 200 null as none yet, exactly as it reads a 404", async () => {
    await mount("missing");
    const after404 = [...posts];
    expect(after404).toEqual(onNone);
    await act(async () => root.unmount());
    root = createRoot(host);
    posts = [];
    resetActivations();
    jobEngine.reset();

    await mount({ body: null });
    expect(seen.read.status).toBe("none");
    expect(seen.read.error).toBeNull();
    expect(seen.artefact).toBeNull();
    expect(posts).toEqual(after404);

    answers = ready("ok");
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.status).toBe("ready");
    expect(seen.artefact).toBeTruthy();

    answers = ready({ body: null });
    await act(async () => seen.read.refresh());
    await settle(2);
    expect(seen.read.status).toBe("none");
    expect(seen.read.error).toBeNull();
    expect(seen.artefact).toBeNull();
    expect(seen.flags).toEqual(seen.flags.map(() => false));
    expect(posts.filter((post) => post.force), "absence is never a forced run").toEqual([]);
  });
});

/* **The envelopes the server really sends pass.** The corpus holds two stored
   threads, each wrapped here as `GET /api/tweets/:slug` wraps one (`loadTweets`
   then `withProfileChanged`, src/routes.ts). It holds no Skim route, so Skim's
   real envelope is argued from `loadSkim`, which answers 404 unless `skim.stops`
   is a list: the one thing the page asks of a route. */
describe("tweets: every thread stored in the fixture corpus is accepted", () => {
  const stored = readdirSync(CORPUS).filter((slug) => {
    try {
      readFileSync(path.join(CORPUS, slug, "tweets.json"));
      return true;
    } catch {
      return false;
    }
  });

  it("finds some", () => {
    expect(stored.length).toBeGreaterThanOrEqual(2);
  });

  it.each(stored)("%s", async (slug) => {
    const thread = JSON.parse(readFileSync(path.join(CORPUS, slug, "tweets.json"), "utf8")) as { tweets: unknown[] };
    let seen!: ReturnType<typeof useTweets>;
    function Probe() {
      seen = useTweets(SLUG);
      return null;
    }
    answers = { tweets: { body: { thread, stale: false, profileChanged: false } } };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(seen.error).toBeNull();
    expect(seen.status).toBe("ready");
    expect(seen.thread?.tweets).toHaveLength(thread.tweets.length);
  });
});

/* -------------------------------------------- what Try again may spend (F1) -- */

/* The bar's button, or the mode's item under More where it is one of the
   five gathered there (plan 261007c) — `modeDoor` opens More to find it. */
function modeButton(mode: Mode): HTMLElement {
  const label = MODE_LABEL[mode];
  const found = modeDoor(host, label);
  expect(found, `the bar must offer ${label}`).toBeDefined();
  return found as HTMLElement;
}

describe("Try again answered by a 404", () => {
  const ideasBand = () => host.querySelector(".mode-band.ideas");
  const threadBand = () => host.querySelector(".mode-band.summ.tweets");

  it("honours a press still in hand: exactly one unforced run, as if the first read had answered", async () => {
    answers = { ideas: "transport" };
    await open("");
    await act(async () => modeButton("ideas").click());
    for (let i = 0; i < 40 && !ideasBand(); i++) await settle(1);
    await settle();
    expect(tryAgain(ideasBand()), "the armed press did not end at the error").toBeDefined();
    expect(posts, "a failed read is not an answer, and it spent").toEqual([]);

    answers = { ideas: "missing" };
    await press(tryAgain(ideasBand()));
    await settle();
    expect(posts.map((p) => p.steps)).toEqual([["ideas"]]);
    expect(posts[0]?.force ?? [], "the honoured press must be the unforced verb").toEqual([]);
  });

  it("spends nothing when nobody pressed: a pasted link, then Try again", async () => {
    answers = { ideas: "transport" };
    await open("?mode=ideas");
    expect(tryAgain(ideasBand())).toBeDefined();

    answers = { ideas: "missing" };
    await press(tryAgain(ideasBand()));
    await settle();
    expect(readable(ideasBand())).not.toContain(COULD_NOT_REACH.message);
    expect(posts).toEqual([]);
  });

  it("Thread starts by arrival, so its Try again ends in exactly one unforced run", async () => {
    answers = { tweets: "transport" };
    await open("?mode=summary&summary=thread");
    expect(tryAgain(threadBand())).toBeDefined();
    expect(posts).toEqual([]);

    answers = { tweets: "missing" };
    await press(tryAgain(threadBand()));
    await settle();
    expect(posts.map((p) => p.steps)).toEqual([["tweets"]]);
    expect(posts[0]?.force ?? []).toEqual([]);
  });
});

/* ------------------------ Try again answered by another failure, after a 404 --

   The owner's answer to the seventh sweep's question 4 (WCO6), relayed by the
   Overseer:

   > ok, i'll go along with you on this. I don't quite follow
   >
   > — Greg, 2026-10-07

   **Once the server has said "none yet" for this article, a failure does not
   unsay it.** A failed refresh already kept the empty state; a failed *Try
   again* took it away in twelve modes until 2026-10-07 — the retry went back to
   asking, and a failure with nothing loaded was the opening read's `error` —
   so the button that starts a run was gone and only a reload brought it back.
   Thread had always kept it (useTweets.ts § the catch, postmortem 261004f), so
   it is the precedent and not a row. A failed *opening* read still ends at
   `error`: nothing was ever answered. docs/project/mode.md § The artefact, if
   the mode shows one;
   docs/plans/261007f-keep-the-generate-button-and-drop-the-unused-queue-column.md. */

const AFTER_NONE = ROWS.filter((row) => row.hook !== "useTweets.ts");

/** The words on every button a reader can see in `within`. */
function labels(within: Element | null): string[] {
  return [...(within?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .filter((b) => !b.closest(UNREADABLE))
    .map((b) => b.textContent?.trim() ?? "");
}

/** A job writing `step` runs and finishes: the real cause of a read's refresh. */
async function finishes(step: string): Promise<void> {
  for (const status of ["running", "done"]) {
    jobs = [
      {
        id: `job-${step}`,
        slug: SLUG,
        status,
        steps: [{ name: step, status: status === "done" ? "done" : "running" }],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    await act(async () => jobEngine.poke());
    await settle();
  }
}

describe.each(AFTER_NONE)("$hook: Try again answered by another failure, after none yet", (row) => {
  const band = () => host.querySelector(row.where);

  it("keeps the empty state's buttons beside the failure, and spends nothing", async () => {
    vi.stubEnv("PROD", true);
    arrange(row, "missing");
    await open(row.search);
    const empty = labels(band());
    expect(empty, "the empty state drew no button to keep").not.toEqual([]);
    expect(tryAgain(band())).toBeUndefined();

    /* A failed refresh: already kept the empty state before 2026-10-07. */
    arrange(row, "transport");
    await finishes(row.kind);
    expect(readable(band()), "the refresh did not fail").toContain(COULD_NOT_REACH.message);
    expect(labels(band())).toEqual(expect.arrayContaining(empty));

    /* A failed Try again: the change. */
    const before = gets[row.kind] ?? 0;
    await press(tryAgain(band()));
    expect((gets[row.kind] ?? 0) - before, "Try again must be exactly one more GET").toBe(1);
    expect(readable(band()), "the failure was not shown").toContain(COULD_NOT_REACH.message);
    expect(tryAgain(band())).toBeDefined();
    expect(labels(band()), "a failed Try again took the empty state's button away").toEqual(
      expect.arrayContaining(empty),
    );
    expect(posts, "no read, failed or retried, ever spends").toEqual([]);
  });
});

interface ArtefactReadState {
  status: string;
  error: string | null;
  retryRead(): Promise<void>;
  refresh(): Promise<void>;
}

/** The same twelve reads, alone: the control and the change of article. */
const AFTER_NONE_READS: readonly { kind: string; use: (slug: string) => ArtefactReadState }[] = [
  { kind: "faq", use: useFaqRead },
  { kind: "simple", use: useSimple },
  { kind: "skim", use: (slug) => useSkim(slug, useQuotesRead(slug), useIdeasRead(slug)) },
  { kind: "ideas", use: useIdeasRead },
  { kind: "timeline", use: useTimelineRead },
  { kind: "quotes", use: useQuotesRead },
  { kind: "debate", use: useDebateRead },
  { kind: "glossary", use: useGlossaryRead },
  { kind: "citations", use: useCitationsRead },
  { kind: "quiz", use: useQuizRead },
  { kind: "illustrated", use: (slug) => useIllustrated(slug, BLOCKS) },
  { kind: "sketch", use: (slug) => useSketch(slug, BLOCKS.map((b) => b.id)) },
];

it("the reads alone are the same twelve as the bands", () => {
  expect(AFTER_NONE_READS.map((r) => r.kind)).toEqual(AFTER_NONE.map((r) => r.kind));
});

describe.each(AFTER_NONE_READS)("$kind: what a failed Try again remembers", ({ kind, use }) => {
  const OTHER = "another-piece";
  let seen!: ArtefactReadState;
  function Probe({ slug }: { slug: string }) {
    seen = use(slug);
    return null;
  }
  async function mount(slug = SLUG): Promise<void> {
    vi.stubEnv("PROD", true);
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe, { slug })));
    await settle();
  }
  const needs = kind === "skim" ? { quotes: "ok" as Answer, ideas: "ok" as Answer } : {};

  it("none yet, a failed refresh, a failed Try again: none, with the failure", async () => {
    answers = { ...needs, [kind]: "missing" };
    await mount();
    expect(seen.status).toBe("none");

    answers = { ...needs, [kind]: "transport" };
    await act(async () => seen.refresh());
    await settle(2);
    expect(seen.status).toBe("none");
    expect(seen.error).toBe(COULD_NOT_REACH.message);

    await act(async () => seen.retryRead());
    await settle(2);
    expect(seen.status, "the failed Try again forgot the server's answer").toBe("none");
    expect(seen.error).toBe(COULD_NOT_REACH.message);
    expect(posts).toEqual([]);
  });

  it("a failed opening read, then a failed Try again: still error, since nothing was answered", async () => {
    answers = { ...needs, [kind]: "transport" };
    await mount();
    expect(seen.status).toBe("error");

    await act(async () => seen.retryRead());
    await settle(2);
    expect(seen.status).toBe("error");
    expect(seen.error).toBe(COULD_NOT_REACH.message);
  });

  it("another article's none yet is not this one's: a new slug starts with nothing answered", async () => {
    answers = { ...needs, [kind]: "missing" };
    await mount();
    expect(seen.status).toBe("none");

    elsewhere = { [OTHER]: { ...needs, [kind]: "transport" } };
    await mount(OTHER);
    await act(async () => seen.retryRead());
    await settle(2);
    expect(seen.status, "the first article's answer stood in for the second's").toBe("error");
    expect(seen.error).toBe(COULD_NOT_REACH.message);
  });
});

/* Sketch and Illustrated have a second "none": a 200 with nothing drawable in
   it, which keeps the faults that say why. The server answered, so it is
   remembered like a 404 — and the faults are left as that answer set them. */
describe.each([
  {
    kind: "sketch" as const,
    use: (slug: string) => useSketch(slug, BLOCKS.map((b) => b.id)),
    empty: { ...BODIES.sketch, sketch: { ...(BODIES.sketch as { sketch: object }).sketch, scenes: [] } },
  },
  {
    kind: "illustrated" as const,
    use: (slug: string) => useIllustrated(slug, BLOCKS),
    empty: {
      ...BODIES.illustrated,
      illustrated: { ...(BODIES.illustrated as { illustrated: object }).illustrated, plates: [] },
    },
  },
])("$kind: nothing drawable, then a failed Try again", ({ kind, use, empty }) => {
  let seen!: ReturnType<typeof use>;
  function Probe() {
    seen = use(SLUG);
    return null;
  }

  it("is still none, with the same faults and the failure", async () => {
    vi.stubEnv("PROD", true);
    answers = { [kind]: { body: empty } };
    jobEngine.start(OWNER.id);
    await act(async () => root.render(createElement(Probe)));
    await settle();
    expect(seen.status).toBe("none");
    const faults = seen.faults;

    answers = { [kind]: "transport" };
    await act(async () => seen.retryRead());
    await settle(2);
    expect(seen.status, "the failed Try again forgot the server's answer").toBe("none");
    expect(seen.error).toBe(COULD_NOT_REACH.message);
    expect(seen.faults).toEqual(faults);
    expect(posts).toEqual([]);
  });
});

/* ------------------------------------------------ the mode a fix would miss -- */

describe("every caller of useOrderedRead", () => {
  const web = path.resolve(import.meta.dirname, "..", "src", "web");
  /** A call, not a mention: comment lines name the hook in a dozen other files. */
  const calls = (source: string) =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .some((line) => /\buseOrderedRead\(/.test(line));
  const callers = (readdirSync(web, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => calls(readFileSync(path.join(web, f), "utf8")))
    .sort();

  it("is a row in the table or a named exclusion, and never both", () => {
    expect(callers.length, "the search found nothing, so it proves nothing").toBeGreaterThanOrEqual(14);
    const rows = new Set(ROWS.map((r) => r.hook));
    const unaccounted = callers.filter((f) => !rows.has(f) && !(f in NOT_A_ROW));
    expect(
      unaccounted,
      "a read with no row here has no checked sentence and no checked Try again — add a row, or an exclusion with its reason",
    ).toEqual([]);
    expect(callers.filter((f) => rows.has(f) && f in NOT_A_ROW)).toEqual([]);
  });

  it("names no file that is not one", () => {
    const named = [...ROWS.map((r) => r.hook), ...Object.keys(NOT_A_ROW)];
    expect(named.filter((f) => !callers.includes(f))).toEqual([]);
  });

  it("gives every exclusion a reason", () => {
    for (const [file, why] of Object.entries(NOT_A_ROW)) {
      expect(why.length, `${file} is excused with no reason`).toBeGreaterThan(10);
    }
  });
});
