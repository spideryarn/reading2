// @vitest-environment jsdom
/**
 * **Regenerate's hold, in the modes that have a forced rewrite** — a row each
 * in `ROWS`. src/web/rewrite-hold.ts;
 * docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md § 2a
 * for the first of them, and
 * docs/plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md
 * for the ones whose forced control is not the profile badge's Regenerate.
 * The second half of the file (§ the membership guard) fails a hook that
 * forces its step and is neither a row here nor a named exclusion.
 *
 * One table, a row per mode, and each row mounts the real band: the real hook,
 * the real panel, the real `useStepJob`, the real `useOrderedRead` and **the
 * real `apiFetch`**. That last one matters: a failed GET answered from the
 * offline copy is a 200 that only `apiFetch` makes, so a test that mocked it
 * could not pose the case (GPT Sol's plan review, F3). What is posed is `fetch`,
 * the offline store (an in-memory map, filled by the opening read like the real
 * one), and the queue transport (`useJobs`), as
 * tests/quiz-regenerate-revalidation.test.tsx does.
 *
 * The sequences are the reviewer's own (F2, F3, F9, F10), named on each test.
 */
import { readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { parse } from "@babel/parser";
import { type Node, VISITOR_KEYS } from "@babel/types";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId, Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------------------------------------------------------------- the queue -- */

let jobs: Job[] = [];
const posted: { slug: string; steps: string[]; force?: string[] }[] = [];
const retried: string[] = [];
let retryRefused = false;
/** Set to keep the POST in the air; call it to let the POST answer. */
let postGate: Promise<void> | null = null;
const job = (step: string, status: Job["status"]) =>
  ({
    id: "the-rewrite",
    slug: SLUG,
    status,
    steps: [{ name: step, status: status === "done" ? "done" : "pending" }],
    createdAt: "2026-10-04T12:00:00Z",
    ...(status === "error" ? { error: "The AI service is busy right now." } : {}),
  }) as Job;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs,
    loaded: true,
    driverFailures: {},
    lastFailure: () => null,
    run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
      posted.push(request);
      if (postGate) await postGate;
      return job(request.steps[0] ?? "", "queued");
    },
    cancel: async () => {},
    retry: async (id: string) => {
      retried.push(id);
      if (postGate) await postGate;
      return retryRefused ? null : { ...jobs.find((j) => j.id === id)!, id: "the-retry", status: "queued" };
    },
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

/* The offline store, in memory. `apiFetch` writes every good GET here itself,
   so the opening read seeds the copy a later dropped connection is answered
   from — which is how a reader comes to hold one. */
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

const ORIGINAL_SLUG = "a-piece";
let SLUG = ORIGINAL_SLUG;
const BLOCKS: Block[] = [
  { id: "spya-aaaaaa" as BlockId, tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
  { id: "spya-bbbbbb" as BlockId, tag: "p", kind: "text", text: "The instrument was built first.", words: 5, html: "<p>The instrument was built first.</p>", gistable: true },
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
    nodes: { n0: { id: "n0", depth: 0, parent: null, children: [], range: ["spya-aaaaaa", "spya-bbbbbb"], title: "A piece", gist: "Gist." } },
  },
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
} as unknown as Article;

/* -------------------------------------------------------------- the network -- */

/** Which artefact the server holds: the one pressed on, or its replacement. */
type Which = "old" | "new";
interface Shape {
  stale: boolean;
  profiled: boolean;
}
/** A word only that artefact draws, so the screen says which one it is showing. */
const SAYS: Record<Which, string> = { old: "Oldmark", new: "Newmark" };
const AT: Record<Which, string> = { old: "2026-09-01T09:00:00.000Z", new: "2026-10-04T09:00:00.000Z" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** The server answered, and it was a failure — never answered from a copy. */
const broken = () => json({ error: "Couldn't read it." }, 500);
/** The connection dropped: `apiFetch` answers from the offline copy if it has one. */
const dropped = () => Promise.reject(new TypeError("Load failed"));

/** What the artefact's GET answers next. Reassigned by each test as it goes. */
let serve: () => Response | Promise<Response> = () => json({}, 404);
let reads = 0;
let path = "";

/* ------------------------------------------------------------------ the rows -- */

const stamp = (which: Which, profiled: boolean) => ({
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  generatedAt: AT[which],
  elapsedMs: 1,
  profileHash: profiled ? "the-old-profile" : null,
});

interface Row {
  name: string;
  /** The hook file under src/web that makes the forced run — the membership guard's key. */
  hook: string;
  step: string;
  /** The artefact's GET, without the slug. */
  path: string;
  /** `?summary=` for the two bands that share Summary's. */
  search?: string;
  body(which: Which, shape: Shape): unknown;
  /** The band, mounted as the app mounts it. `show` false is the band closed. */
  mount(show: boolean): ReactNode;
  /** Every forced paid control besides the badge's Regenerate, by its label. */
  forced: string[];
  /**
   * A forced control pressed directly: its label, whether it needs a stale
   * artefact, and what its POST carries besides the step.
   */
  direct: { label: string; stale: boolean; posts?: Record<string, unknown> }[];
  /**
   * **The forced control these tests press, for a mode with no Regenerate in a
   * profile badge** — Illustrated's *Paint again*, Quotes' *Find more*, a stale
   * banner's run button. Absent: the badge's Regenerate.
   */
  verb?: string;
  /**
   * The artefact these tests serve when they do not say. A mode whose forced
   * control needs a stale banner or a failure is served stale, before and after.
   */
  shape?: Shape;
  /** The quiet line a held panel with nothing running draws. */
  waiting: string;
  /** Its read-only retry. */
  readAgain: string;
  /** What the POST these tests' press makes carries besides the step. */
  posts?: Record<string, unknown>;
  /**
   * **Other GETs the band stands on, answered the same way every time**, keyed
   * like `path`. Skim's: with its Quotes and Ideas read as current, its request
   * names the route alone, which is the request this file is about.
   */
  also?: Record<string, unknown>;
}

const noop = () => {};

const { useQuiz, useQuizRead } = await import("../src/web/useQuiz.js");
const { QuizPanel } = await import("../src/web/QuizPanel.js");
const { SummaryBand } = await import("../src/web/modes/summary/SummaryMode.js");
const { IdeasBand } = await import("../src/web/modes/ideas/IdeasMode.js");
const { GlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { SketchView } = await import("../src/web/SketchView.js");
const { useSketch } = await import("../src/web/useSketch.js");
const { IllustratedView } = await import("../src/web/IllustratedView.js");
const { useIllustrated } = await import("../src/web/useIllustrated.js");
const { QuotesBand } = await import("../src/web/modes/quotes/QuotesMode.js");
const { useQuotesRead } = await import("../src/web/useQuotes.js");
const { TimelineBand } = await import("../src/web/modes/timeline/TimelineMode.js");
const { FaqBand } = await import("../src/web/modes/faq/FaqMode.js");
const { DebateBand } = await import("../src/web/modes/debate/DebateMode.js");
const { CitationsBand } = await import("../src/web/modes/citations/CitationsMode.js");
const { useCitationsRead } = await import("../src/web/useCitations.js");
const { SkimBand } = await import("../src/web/modes/skim/SkimMode.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { useFreshReads, useRewriteHold } = await import("../src/web/rewrite-hold.js");

/* Quiz and Glossary read above their band (ArticlePage.tsx § `OwnedReader`), so
   closing the band leaves the read mounted. Summary, Thread, Ideas and Sketch
   read inside it. */
function QuizOuter({ show }: { show: boolean }) {
  const read = useQuizRead(SLUG);
  return show ? createElement(QuizInner, { read }) : null;
}
function QuizInner({ read }: { read: ReturnType<typeof useQuizRead> }) {
  const owner = useQuiz(SLUG, read);
  return createElement(QuizPanel, { owner, blocks: new Map(), onJump: noop });
}
function GlossaryOuter({ show }: { show: boolean }) {
  const read = useGlossaryRead(SLUG);
  return show
    ? createElement(GlossaryBand, { slug: SLUG, read, onJump: noop, onSelected: noop, onAskChat: noop })
    : null;
}

/* Quotes and Citations read above their band too, for the marks in the prose
   (useQuotes.ts § `useQuotesRead`, useCitations.ts § `useCitationsRead`). */
function QuotesOuter({ show }: { show: boolean }) {
  const read = useQuotesRead(SLUG);
  return show
    ? createElement(QuotesBand, { slug: SLUG, read, onJump: noop, steps: [], yours: { rows: [], blocks: [], onOpen: noop } })
    : null;
}
function CitationsOuter({ show }: { show: boolean }) {
  const read = useCitationsRead(SLUG);
  return show
    ? createElement(CitationsBand, { slug: SLUG, read, onJump: noop, focus: null, onFocusTaken: noop })
    : null;
}

/* Skim stands on the Quotes read `OwnedReader` holds and the glossary read
   `Reader` holds; its own read, and the Ideas', are the band's. */
function SkimOuter({ show }: { show: boolean }) {
  const quotes = useQuotesRead(SLUG);
  const glossary = useGlossaryRead(SLUG);
  return show
    ? createElement(SkimBand, {
        slug: SLUG,
        blocks: BLOCKS,
        tree: ARTICLE.tree,
        quotes,
        glossary,
        onAskTerm: noop,
        onOpen: noop,
        canOpen: () => false,
        arrival: { stop: null, open: false },
        quoteMarks: [],
        covers: false,
        away: false,
        onAway: noop,
        onJump: noop,
        onFound: noop,
        openKey: null,
        onOpenKey: noop,
        onControl: noop,
      })
    : null;
}

/** These modes offer their forced control on a stale banner without needing a failure. */
const ON_THE_BANNER: Shape = { stale: true, profiled: false };

const DEBATE_LOSSES = { uncited: 0, selfSource: 0, unverifiedSource: 0, directnessUnverified: 0, sourceIsCopy: 0, claimNotInBlock: 0, unknownBlockId: 0, malformed: 0 };
const DEBATE_COUNTS = { returnedSources: 1, reportedRows: 1, keptRows: 1, omittedOverCap: 0, lost: DEBATE_LOSSES, webSearches: 1 };

const summary = (show: boolean) =>
  show ? createElement(SummaryBand, { slug: SLUG, article: ARTICLE, onJump: noop }) : null;

const ROWS: Row[] = [
  {
    name: "Quiz",
    hook: "useQuiz.ts",
    step: "quiz",
    path: "/api/quiz/",
    body: (which, { stale, profiled }) => ({
      quiz: {
        ...stamp(which, profiled),
        batchId: `batch-${which}`,
        questions: [
          {
            id: "spya-qm9qt2",
            question: `${SAYS[which]}: what was built first?`,
            referenceAnswer: "The instrument.",
            evidence: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", start: 0 }],
          },
        ],
        dropped: { unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 },
      },
      stale,
      outdated: false,
      profileChanged: profiled,
    }),
    mount: (show) => createElement(QuizOuter, { show }),
    forced: ["Write them again"],
    direct: [{ label: "Write them again", stale: true }],
    waiting: "The new questions haven't loaded yet.",
    readAgain: "Read the new questions",
  },
  {
    name: "Summary",
    hook: "useSimple.ts",
    step: "simple",
    path: "/api/simple/",
    search: "?summary=brief",
    body: (which, { stale, profiled }) => ({
      simpleSummary: {
        ...stamp(which, profiled),
        version: "simple/2",
        levels: {
          brief: [{ text: `${SAYS[which]} in brief.`, ids: ["spya-bbbbbb"] }],
          simple: [{ text: "The plain one.", ids: ["spya-bbbbbb"] }],
          fuller: [{ text: "The fuller one.", ids: ["spya-bbbbbb"] }],
        },
      },
      stale,
      outdated: false,
      profileChanged: profiled,
    }),
    mount: summary,
    forced: ["Write it again"],
    direct: [{ label: "Write it again", stale: true }],
    waiting: "The new summary hasn't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Thread",
    hook: "useTweets.ts",
    step: "tweets",
    path: "/api/tweets/",
    search: "?summary=thread",
    body: (which, { stale, profiled }) => ({
      thread: {
        ...stamp(which, profiled),
        version: "tweets/5",
        limit: 280,
        tweets: [{ text: `${SAYS[which]} thread.`, chars: 15, blocks: ["spya-bbbbbb"] }],
      },
      stale,
      profileChanged: profiled,
    }),
    mount: summary,
    forced: ["Write it again"],
    direct: [{ label: "Write it again", stale: true }],
    waiting: "The new thread hasn't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Ideas",
    hook: "useIdeas.ts",
    step: "ideas",
    path: "/api/ideas/",
    body: (which, { stale, profiled }) => ({
      ideas: {
        ...stamp(which, profiled),
        ideas: [
          {
            id: "spya-kdea34",
            name: `${SAYS[which]} idea`,
            provenance: "assumed",
            statement: "You cannot theorise about what you cannot measure.",
            occurrences: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", reasoning: "It rests on it." }],
          },
        ],
      },
      stale,
      outdated: false,
      profileChanged: profiled,
    }),
    mount: (show) =>
      show
        ? createElement(IdeasBand, { slug: SLUG, blocks: BLOCKS, onJump: noop, onFound: noop, openKey: null, onOpenKey: noop })
        : null,
    forced: ["Find them again"],
    direct: [{ label: "Find them again", stale: true }],
    waiting: "The new ideas haven't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Glossary",
    hook: "useGlossary.ts",
    step: "glossary",
    path: "/api/glossary/",
    body: (which, { stale, profiled }) => ({
      glossary: {
        ...stamp(which, profiled),
        entries: [
          {
            id: "spya-term23",
            name: `${SAYS[which]} depth`,
            kind: "concept",
            aliases: [],
            senseHere: "How much work it took to build the thing.",
            blocks: ["spya-bbbbbb"],
          },
        ],
        passes: 1,
      },
      stale,
      outdated: false,
      profileChanged: profiled,
    }),
    mount: (show) => createElement(GlossaryOuter, { show }),
    forced: ["Find more", "Write a new list"],
    direct: [
      { label: "Write a new list", stale: true, posts: { useProfile: false } },
      { label: "Find more", stale: false, posts: { useProfile: false } },
    ],
    waiting: "The new terms haven't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Sketch",
    hook: "useSketch.ts",
    step: "sketch",
    path: "/api/sketch/",
    body: (which, { stale, profiled }) => ({
      /* No clock on a sketch: what differs between the two is the picture. */
      sketch: {
        title: "One instrument, one claim",
        caption: "The measurement is doing the arguing.",
        profileHash: profiled ? "the-old-profile" : null,
        scenes: [
          {
            id: "s0",
            title: "Overview",
            height: 200,
            items: [
              { kind: "node", id: "n1", shape: "box", x: 10, y: 10, w: 140, h: 40, text: `${SAYS[which]} rig`, size: "md", block: "spya-bbbbbb" },
            ],
          },
        ],
      },
      stale,
      outdated: false,
      profileChanged: profiled,
    }),
    mount: (show) =>
      show ? createElement(SketchView, { access: { kind: "owner", slug: SLUG }, blocks: BLOCKS, atRow: null, onJump: noop }) : null,
    forced: [],
    direct: [],
    waiting: "The new picture hasn't loaded yet.",
    readAgain: "Try again",
  },
  /* The rows below have no Regenerate in a profile badge: each names the forced
     control it has as `verb`. Plan 261007b. */
  {
    name: "Illustrated",
    hook: "useIllustrated.ts",
    step: "illustrated",
    path: "/api/illustrated/",
    body: (which, { stale }) => ({
      /* No clock on a painting either: what differs is the plate. */
      illustrated: {
        version: "illustrated/1",
        generator: "a-model",
        illustrator: "an-image-model",
        style: "A plain register.",
        profileHash: null,
        plates: [
          {
            sceneId: "overview",
            title: `${SAYS[which]} plate`,
            prompt: "A workbench, in gouache.",
            vignettes: [{ block: "spya-bbbbbb", quote: "The instrument was built", depicts: "A rig on a workbench" }],
            image: { sha256: (which === "old" ? "a" : "b").repeat(64), ext: "jpeg", bytes: 73_000, width: 1024, height: 1536 },
          },
        ],
      },
      stale,
      outdated: false,
      /* Never changed: that would relabel the button *Draw the Sketch, then
         paint again*, and which label it has is not what this file is about. */
      profileChanged: false,
    }),
    mount: (show) => (show ? createElement(IllustratedView, { slug: SLUG, blocks: BLOCKS, onJump: noop }) : null),
    verb: "Paint again",
    forced: ["Paint again"],
    direct: [{ label: "Paint again", stale: false }],
    waiting: "The new picture hasn't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Quotes",
    hook: "useQuotes.ts",
    step: "quotes",
    path: "/api/quotes/",
    body: (which, { stale, profiled }) => ({
      quotes: {
        ...stamp(which, profiled),
        quotes: [
          {
            id: "spya-qte234",
            blockId: "spya-bbbbbb",
            text: `${SAYS[which]} was built first`,
            start: 0,
            reason: "It is the sentence the piece turns on.",
            importance: 90,
            striking: 80,
          },
        ],
        discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
      },
      stale,
      outdated: false,
      profileChanged: false,
    }),
    mount: (show) => createElement(QuotesOuter, { show }),
    /* The appending verb. *Choose them again* is the stale banner's, and
       replaces. A profiled list is added to with the profile, which is the
       request's default and so not in the POST. */
    verb: "Find more",
    forced: ["Find more", "Choose them again"],
    direct: [
      { label: "Find more", stale: false, posts: { useProfile: false } },
      { label: "Choose them again", stale: true },
    ],
    waiting: "The new quotes haven't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Timeline",
    hook: "useTimeline.ts",
    step: "timeline",
    path: "/api/timeline/",
    body: (which, { stale }) => ({
      timeline: {
        ...stamp(which, false),
        events: [
          {
            id: "spya-evt234",
            label: `${SAYS[which]} calibration`,
            dating: { kind: "words", phrase: "before the theory" },
            order: 1,
            modality: "happened",
            occurrences: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", start: 0 }],
          },
        ],
        orderConflicts: 0,
      },
      stale,
      outdated: false,
    }),
    mount: (show) =>
      show
        ? createElement(TimelineBand, { slug: SLUG, blocks: BLOCKS, onJump: noop, onFound: noop, openKey: null, onOpenKey: noop })
        : null,
    verb: "Read it again",
    shape: ON_THE_BANNER,
    forced: ["Read it again"],
    direct: [{ label: "Read it again", stale: true }],
    waiting: "The new timeline hasn't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "FAQ",
    hook: "useFaq.ts",
    step: "faq",
    path: "/api/faq/",
    body: (which, { stale }) => ({
      faq: {
        ...stamp(which, false),
        questions: [
          {
            id: "faq-q1",
            question: `${SAYS[which]}: why trust the rig?`,
            passages: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", start: 0 }],
          },
        ],
        dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, unanchored: 0, overCap: 0, malformed: 0 },
      },
      stale,
      outdated: false,
    }),
    mount: (show) => (show ? createElement(FaqBand, { slug: SLUG, onJump: noop }) : null),
    verb: "Find them again",
    shape: ON_THE_BANNER,
    forced: ["Find them again"],
    direct: [{ label: "Find them again", stale: true }],
    waiting: "The new questions haven't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Debate",
    hook: "useDebate.ts",
    step: "debate",
    path: "/api/debate/",
    body: (which, { stale }) => ({
      debate: {
        version: "test",
        generator: "test",
        slug: SLUG,
        sourceHash: "hash",
        /* Debate's only clock, and so its identity. */
        searchedAt: AT[which],
        direct: {
          rows: [
            {
              id: "spya-dbt234",
              url: "https://example.org/leiden",
              title: `${SAYS[which]} replication`,
              sourceQuote: "We could not reproduce the calibration.",
              relation: "disputes",
              lean: "leans-against",
              applies: "A replication reached the opposite reading.",
              articleReferenceQuote: "The instrument was built",
              /* `quoted`, or the identification bar hides the row. */
              identifies: [
                { kind: "quoted", quote: "The instrument was built first", blockId: "spya-bbbbbb", coverage: 0.9, density: 0.9 },
                { kind: "named", by: "title", witness: "A piece" },
              ],
            },
          ],
          counts: DEBATE_COUNTS,
        },
        claims: { rows: [], counts: { ...DEBATE_COUNTS, returnedSources: 0, reportedRows: 0, keptRows: 0 } },
        elapsedMs: 1,
      },
      stale,
      outdated: false,
    }),
    mount: (show) =>
      show
        ? createElement(DebateBand, {
            slug: SLUG,
            onJump: noop,
            blockOrder: new Map(BLOCKS.map((b, i) => [b.id, i])),
            publishedAt: undefined,
            articleTitle: "A piece",
            claimChats: { summaries: [], onCheck: noop, onLens: noop, onOpen: noop },
          })
        : null,
    verb: "Search again",
    shape: ON_THE_BANNER,
    forced: ["Search again"],
    direct: [{ label: "Search again", stale: true }],
    waiting: "The new search hasn't loaded yet.",
    readAgain: "Try again",
  },
  /* Claims' list (plan 261008i stage 2): the same band on `?debate=claims`,
     whose stale banner's *List again* is the forced verb. */
  {
    name: "Debate's claims list",
    hook: "useDebateClaims.ts",
    step: "debate-claims",
    path: "/api/debate-claims/",
    search: "?debate=claims",
    body: (which, { stale }) => ({
      claimList: {
        ...stamp(which, false),
        claims: [
          {
            id: "spya-cdm2a4",
            blockId: "spya-bbbbbb",
            quote: "The instrument was built",
            statement: `${SAYS[which]}: the rig came before its theory.`,
          },
        ],
        dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, overCap: 0, malformed: 0 },
      },
      stale,
      outdated: false,
    }),
    mount: (show) =>
      show
        ? createElement(DebateBand, {
            slug: SLUG,
            onJump: noop,
            blockOrder: new Map(BLOCKS.map((b, i) => [b.id, i])),
            publishedAt: undefined,
            articleTitle: "A piece",
            claimChats: { summaries: [], onCheck: noop, onLens: noop, onOpen: noop },
          })
        : null,
    verb: "List again",
    shape: ON_THE_BANNER,
    forced: ["List again"],
    direct: [{ label: "List again", stale: true }],
    waiting: "The new list hasn't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Citations",
    hook: "useCitations.ts",
    step: "citations",
    path: "/api/citations/",
    body: (which, { stale }) => ({
      citations: {
        ...stamp(which, false),
        citations: [
          {
            id: "spya-c7t2wd",
            key: "work:elements of episodic memory|tulving|1983",
            title: `${SAYS[which]} of Episodic Memory`,
            authors: "Tulving",
            year: "1983",
            why: "The idea the piece tests.",
            relevance: 0.9,
            influence: 0.9,
            mentions: [{ blockId: "spya-bbbbbb", quote: "The instrument was built", start: 0 }],
            citedAt: ["spya-bbbbbb"],
            firstCited: "spya-bbbbbb",
            citedInBody: true,
            url: "https://scholar.google.com/scholar?q=Elements",
            linkFrom: "search",
          },
        ],
        capped: false,
      },
      stale,
      outdated: false,
    }),
    mount: (show) => createElement(CitationsOuter, { show }),
    verb: "Find them again",
    shape: ON_THE_BANNER,
    forced: ["Find them again"],
    direct: [{ label: "Find them again", stale: true }],
    waiting: "The new citations haven't loaded yet.",
    readAgain: "Try again",
  },
  /* The seventh of the seven that had a forced verb and no hold (plan 261007e).
     Its forced control is the stale or profile-changed banner's, and the same
     button in the status foot of a current route. The Quotes and the Ideas are
     served current, so the press asks for the route alone: what a run does
     about its prerequisites is tests/modes-that-start-themselves.test.tsx's. */
  {
    name: "Skim",
    hook: "useSkim.ts",
    step: "skim",
    path: "/api/skim/",
    body: (which, { stale }) => ({
      skim: {
        ...stamp(which, false),
        stops: [{ quoteId: "spya-qte234", depth: 1, role: `${SAYS[which]} turn` }],
        visible: [1, 1, 1],
        offered: 1,
        dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
      },
      stale,
      outdated: false,
      profileChanged: false,
      notOnRoute: 0,
    }),
    also: {
      "/api/quotes/": {
        quotes: {
          ...stamp("old", false),
          quotes: [
            {
              id: "spya-qte234",
              blockId: "spya-bbbbbb",
              text: "The instrument was built first",
              start: 0,
              reason: "It is the sentence the piece turns on.",
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
      "/api/ideas/": {
        ideas: {
          ...stamp("old", false),
          ideas: [
            {
              id: "spya-kdea34",
              name: "Instruments outrun explanation",
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
    },
    mount: (show) => createElement(SkimOuter, { show }),
    verb: "Plan it again",
    shape: ON_THE_BANNER,
    forced: ["Plan it again"],
    direct: [{ label: "Plan it again", stale: true }],
    waiting: "The new route hasn't loaded yet.",
    readAgain: "Try again",
  },
];

/* --------------------------------------------------------------- the harness -- */

let host: HTMLDivElement;
let root: Root;
let row: Row;
let showBand = true;

const flush = async () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const paint = async () => {
  await act(async () =>
    root.render(
      createElement(
        NuqsTestingAdapter,
        /* ArticlePage keys OwnedArticle on the slug, so navigation remounts
           both the band and its always-mounted readers. */
        { key: SLUG, ...({ searchParams: row.search ?? "", hasMemory: true } as Parameters<typeof NuqsTestingAdapter>[0]) },
        row.mount(showBand),
      ),
    ),
  );
  await flush();
};
const buttons = (label: string) =>
  [...document.querySelectorAll("button")].filter(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label,
  );
const press = async (label: string) => {
  const [b] = buttons(label);
  expect(b, `a button named ${label} to press`).toBeDefined();
  await act(async () => b!.click());
  await flush();
};
const onScreen = (which: Which) => (document.body.textContent ?? "").includes(SAYS[which]);

/**
 * **Whether a forced run can be asked for right now.** The badge's Regenerate,
 * read by opening its panel and closing it again — or, for a row with a `verb`,
 * that control.
 *
 * A `verb` row answers `"disabled"` whenever there is nothing to press, which
 * is two cases: the button is disabled, or `RewriteWaiting` stands in its place
 * (IdeasPanel.tsx § `run`). And it answers `"enabled"` for a **Retry** too:
 * `JobProgress` draws that in the run button's place under a failed job, and a
 * hook hides the failure for as long as it holds (`failed: hold.rewriting ?
 * null : …`), so a Retry on screen is the hold having let go.
 */
async function regenerate(): Promise<"enabled" | "disabled" | "absent"> {
  if (row.verb) {
    return [...buttons(row.verb), ...buttons("Retry")].some((b) => !b.disabled) ? "enabled" : "disabled";
  }
  const badge = document.querySelector<HTMLButtonElement>(".prof-badge");
  if (!badge) return "absent";
  await act(async () => badge.click());
  await flush();
  const [b] = buttons("Regenerate");
  const state = b === undefined ? "absent" : b.disabled ? "disabled" : "enabled";
  await press("Done");
  return state;
}
/** The forced control itself, on screen and pressable: the row's `verb`, or the badge's Regenerate with its panel opened. */
async function forcedButton(): Promise<HTMLButtonElement> {
  if (!row.verb) {
    const badge = document.querySelector<HTMLButtonElement>(".prof-badge");
    expect(badge, "the profile icon").not.toBeNull();
    await act(async () => badge!.click());
    await flush();
  }
  const [b] = buttons(row.verb ?? "Regenerate");
  expect(b?.disabled, `${row.verb ?? "Regenerate"} is offered before the press`).toBe(false);
  return b!;
}
async function pressRegenerate() {
  const b = await forcedButton();
  await act(async () => b.click());
  await flush();
}
/** No forced control can be pressed: each is gone, or disabled. */
async function expectHeld(why: string) {
  expect(await regenerate(), `${why}: ${row.verb ?? "the badge's Regenerate"}`).toBe("disabled");
  for (const label of row.forced) {
    expect(buttons(label).filter((b) => !b.disabled), `${why}: ${label}`).toHaveLength(0);
  }
}

const PROFILED: Shape = { stale: false, profiled: true };
/** The shape the row on stage is served when a test does not say. */
const usual = (): Shape => row.shape ?? PROFILED;

function start(which: Row, shape: Shape = which.shape ?? PROFILED) {
  row = which;
  path = `${row.path}${SLUG}`;
  serve = () => json(row.body("old", shape));
}
const finishJob = (status: Job["status"] = "done") => {
  jobs = [job(row.step, status)];
};

beforeEach(() => {
  SLUG = ORIGINAL_SLUG;
  jobs = [];
  posted.length = 0;
  retried.length = 0;
  retryRefused = false;
  postGate = null;
  reads = 0;
  cache.clear();
  showBand = true;
  /* Sign-out's teardown, which is also what forgets a hold. */
  jobEngine.reset();
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") !== "GET") return json({});
    if (url.startsWith("/api/reader")) return json({ profile: "My current profile", purpose: null });
    if (url === path) {
      reads++;
      return serve();
    }
    for (const [prefix, body] of Object.entries(row.also ?? {})) {
      if (url === `${prefix}${SLUG}`) return json(body);
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

it("releases a refused press even if the start callback rejects", async () => {
  let hold!: ReturnType<typeof useRewriteHold>;
  function Probe() {
    const fresh = useFreshReads();
    hold = useRewriteHold({
      slug: "throwing-press",
      step: "quiz",
      identity: "old",
      queue: { job: null, loaded: true, starting: false, failed: null, ended: () => null },
      fresh,
      refresh: async () => {},
    });
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  await act(async () => {
    await expect(hold.run(async () => { throw new Error("start rejected"); })).rejects.toThrow("start rejected");
  });
  expect(hold.rewriting, "no posted job can ever settle a rejected start").toBe(false);
});

describe.each(ROWS)("$name", (mode) => {
  it.skipIf(["Sketch", "Illustrated"].includes(mode.name))("Retry holds the old result through its completion GET", async () => {
    /* Thread's current-result foot draws only the failure's sentence; its
       stale banner is the loaded branch that offers JobProgress's Retry. */
    start(mode, mode.name === "Thread" ? { ...PROFILED, stale: true } : mode.shape ?? PROFILED);
    await paint();
    await pressRegenerate();
    finishJob("error");
    await paint();
    await press("Retry");
    expect(retried).toEqual(["the-rewrite"]);
    jobs = [{ ...job(mode.step, "running"), id: "the-retry" }];
    await paint();

    let land!: (res: Response) => void;
    serve = () => new Promise((resolve) => { land = resolve; });
    jobs = [{ ...job(mode.step, "done"), id: "the-retry" }];
    await paint();
    expect(onScreen("old")).toBe(true);
    await expectHeld("the retried job finished, but its GET is still in flight");
    expect(posted).toHaveLength(1);

    await act(async () => land(json(mode.body("new", usual()))));
    await flush();
    expect(await regenerate()).toBe("enabled");
  });

  it.skipIf(["Sketch", "Illustrated"].includes(mode.name)).each(["error", "cancelled", "refused", "unchanged", "offline"] as const)(
    "Retry releases or offers a read-only recovery after %s", async (outcome) => {
      start(mode, mode.name === "Thread" ? { ...PROFILED, stale: true } : mode.shape ?? PROFILED);
      await paint();
      await pressRegenerate();
      finishJob("error");
      await paint();
      retryRefused = outcome === "refused";
      const [retry] = buttons("Retry");
      expect(retry).toBeDefined();
      await act(async () => { retry!.click(); retry!.click(); });
      await flush();
      expect(retried).toEqual(["the-rewrite"]);
      if (outcome === "refused") {
        expect(await regenerate()).toBe("enabled");
        return;
      }
      jobs = [{ ...job(mode.step, "running"), id: "the-retry" }];
      await paint();
      if (outcome === "offline") serve = dropped;
      jobs = [{ ...job(mode.step, outcome === "error" || outcome === "cancelled" ? outcome : "done"), id: "the-retry" }];
      await paint();
      if (outcome === "offline") {
        await expectHeld("the retried result was read from the offline copy");
        serve = () => json(mode.body("old", usual()));
        await press(mode.readAgain);
      }
      expect(await regenerate()).toBe("enabled");
      expect(posted).toHaveLength(1);
    },
  );

  it("releases after a successful rewrite returns the same identity", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    jobs = [job(mode.step, "running")];
    await paint();
    finishJob();
    await paint();
    expect(onScreen("old")).toBe(true);
    expect(await regenerate()).toBe("enabled");
    expect(posted).toHaveLength(1);
  });

  it.skipIf(!mode.verb)("a slug change does not disable another article, and returning releases a finished unchanged hold", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    const originalPath = path;
    const finished = job(mode.step, "done");
    SLUG = "another-piece";
    path = `${mode.path}${SLUG}`;
    await paint();
    expect(await regenerate(), "the second article has no rewrite hold").toBe("enabled");
    jobs = [finished];
    SLUG = ORIGINAL_SLUG;
    path = originalPath;
    await paint();
    expect(await regenerate(), "the original ended with an unchanged server result").toBe("enabled");
    expect(posted).toHaveLength(1);
  });

  /* GPT Sol's C3 (plan 261007b): the job fails while the band is closed and its
     row is trimmed before anything mounted sees it. The hold used to outlive
     every way of learning the outcome, and the control was dead until a
     reload. The engine's word that the job is over, or gone, is what settles
     it — never the job's mere absence from a list, which is also what a job
     not listed yet looks like. */
  it("a job that ended unseen and was trimmed releases on a read the server answered after that, and on nothing less", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    showBand = false;
    await paint();
    jobs = [];
    showBand = true;
    await paint();
    await expectHeld("absent from a list is not an outcome");
    await press(mode.readAgain);
    await expectHeld("nor does an unchanged read make it one");

    /* A read already in the air when the engine finds the job gone. */
    showBand = false;
    await paint();
    let land!: (res: Response) => void;
    serve = () => new Promise((resolve) => { land = resolve; });
    showBand = true;
    await paint();
    await act(async () => jobEngine.receive([]));
    serve = dropped;
    await act(async () => land(json(mode.body("old", usual()))));
    await flush();
    await expectHeld("a read asked before the job was found gone, then the offline copy");

    serve = () => json(mode.body("old", usual()));
    await press(mode.readAgain);
    expect(await regenerate(), "the server answered a read asked after the job was gone").toBe("enabled");
    expect(posted).toHaveLength(1);
  });

  it.each([true, false])("keeps the read-only escape on a stale offline copy (profiled=%s)", async (profiled) => {
    start(mode);
    await paint();
    await pressRegenerate();
    showBand = false;
    await paint();
    cache.set(path, { body: mode.body("old", { stale: true, profiled }), savedAt: 2 });
    serve = dropped;
    finishJob();
    showBand = true;
    await paint();
    expect(document.body.textContent).toContain(mode.waiting);
    for (const label of mode.forced) {
      expect(buttons(label).filter((b) => !b.disabled)).toHaveLength(0);
    }
    const before = reads;
    serve = () => json(mode.body("new", { stale: true, profiled }));
    await press(mode.readAgain);
    expect(reads).toBe(before + 1);
    expect(posted).toHaveLength(1);
    expect(onScreen("new")).toBe(true);
    expect(document.body.textContent).not.toContain(mode.waiting);
  });

  it("a different offline identity landing during the rewrite still keeps every forced control held", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    showBand = false;
    await paint();
    cache.set(path, { body: mode.body("new", usual()), savedAt: 2 });
    serve = dropped;
    finishJob();
    showBand = true;
    await paint();
    expect(onScreen("new")).toBe(true);
    await expectHeld("a different offline identity is still not the server's word");
    expect(document.body.textContent).toContain(mode.waiting);
  });

  it.each(["error", "cancelled"] as const)("a listed %s of this press releases even on an offline remount", async (outcome) => {
    start(mode);
    await paint();
    await pressRegenerate();
    showBand = false;
    await paint();
    serve = dropped;
    finishJob(outcome);
    showBand = true;
    await paint();
    expect(await regenerate(), "this press is known to have stopped; no fresh GET is needed").toBe("enabled");
  });

  it("another job's failure cannot release a forced POST that is still in the air after remount", async () => {
    start(mode);
    await paint();
    let land!: () => void;
    postGate = new Promise((resolve) => { land = resolve; });
    await pressRegenerate();
    showBand = false;
    await paint();
    jobs = [{ ...job(mode.step, "running"), id: "another-tab" }];
    showBand = true;
    await paint();
    jobs = [{ ...job(mode.step, "error"), id: "another-tab" }];
    await paint();
    await expectHeld("only the other tab's job failed");
    expect(document.body.textContent).toContain(mode.waiting);
    serve = dropped;
    const before = reads;
    await press(mode.readAgain);
    expect(reads).toBe(before + 1);
    expect(posted).toHaveLength(1);
    await expectHeld("the unrelated failure must leave a read-only way out");
    await act(async () => land());
    await flush();
    await expectHeld("our POST answered but our job has never been listed");
  });

  it("a different offline copy cannot use an older online answer to release the new hold", async () => {
    start(mode);
    await paint();
    showBand = false;
    await paint();
    /* Another reader (Marginalia or another tab) has updated the shared copy.
       Quiz and Glossary keep their read instance while the band is closed. */
    cache.set(path, { body: mode.body("new", usual()), savedAt: 2 });
    serve = dropped;
    showBand = true;
    await paint();
    expect(onScreen("new")).toBe(true);
    await pressRegenerate();
    serve = broken;
    finishJob();
    await paint();
    await expectHeld("the new hold cannot be settled by the earlier online answer");
  });

  it("holds the forced verb synchronously before the next render", async () => {
    start(mode);
    await paint();
    const button = await forcedButton();
    await act(async () => {
      button.click();
      button.click();
    });
    await flush();
    expect(posted, "the hold fences the verb before React disables its controls").toHaveLength(1);
  });

  it("holds every forced control after the job finishes and the reload fails, and a fresh read of the new one lets go", async () => {
    start(mode);
    await paint();
    expect(onScreen("old")).toBe(true);
    await pressRegenerate();
    expect(posted).toEqual([{ slug: SLUG, steps: [mode.step], force: [mode.step], ...(mode.posts ?? {}) }]);

    serve = broken;
    finishJob();
    await paint();
    expect(onScreen("old"), "a failed reload keeps what was there").toBe(true);
    await expectHeld("the reload failed");
    expect(posted, "exactly one forced POST").toHaveLength(1);

    serve = () => json(mode.body("new", usual()));
    await press("Try again");
    expect(onScreen("new")).toBe(true);
    expect(await regenerate(), "the replacement is here").toBe("enabled");
    expect(posted).toHaveLength(1);
  });

  /* The gap itself, with nothing else going wrong: the job has left the list
     and the GET that will bring its result is still in the air. The old
     artefact is on screen, and without the hold its forced control is live. */
  it("holds every forced control while the completion GET is still in the air", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    jobs = [job(mode.step, "running")];
    await paint();

    let land!: (res: Response) => void;
    serve = () => new Promise((resolve) => { land = resolve; });
    finishJob();
    await paint();
    expect(onScreen("old"), "the old artefact is still what is drawn").toBe(true);
    await expectHeld("the job is done and its result has not been read");
    expect(posted, "exactly one forced POST").toHaveLength(1);

    await act(async () => land(json(mode.body("new", usual()))));
    await flush();
    expect(onScreen("new")).toBe(true);
    expect(await regenerate(), "the replacement is here").toBe("enabled");
  });

  it("lets go when the job fails", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    jobs = [job(mode.step, "running")];
    await paint();
    finishJob("error");
    await paint();
    expect(await regenerate(), "a failed rewrite may be asked for again").toBe("enabled");
  });

  /* GPT Sol's plan review, F2: completion's `refresh()` trails a GET already in
     the air, and that older GET, landing after the list went idle with the old
     artefact, was counted as "a read has landed since". */
  it("F2: a GET that started before the job finished does not release it", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    jobs = [job(mode.step, "running")];
    await paint();

    /* A read goes out while the job runs — the band reopened. */
    showBand = false;
    await paint();
    let landOld!: (res: Response) => void;
    serve = () => new Promise((resolve) => { landOld = resolve; });
    showBand = true;
    await paint();
    const before = reads;

    /* The job finishes; the old GET is still in the air. */
    let landNext!: (res: Response) => void;
    serve = () => new Promise((resolve) => { landNext = resolve; });
    finishJob();
    await paint();

    await act(async () => landOld(json(mode.body("old", usual()))));
    await flush();
    expect(onScreen("old")).toBe(true);
    expect(reads, "the read that will answer has been asked for").toBe(before + 1);
    await expectHeld("only the pre-completion GET has landed");

    await act(async () => landNext(broken()));
    await flush();
    await expectHeld("the trailing read failed");
    expect(posted).toHaveLength(1);
  });

  /* F3 and F10: a dropped connection is answered from the offline copy with a
     real 200. It is the old artefact, it clears `error`, and it must neither
     release the hold nor leave the reader without a way to read again. */
  it("F3/F10: an offline copy keeps the hold, mounted, and the read-only retry recovers", async () => {
    start(mode);
    await paint();
    await pressRegenerate();

    serve = dropped;
    finishJob();
    await paint();
    expect(onScreen("old")).toBe(true);
    expect(document.querySelector('[role="alert"]'), "a copy is not an error").toBeNull();
    await expectHeld("the reload was answered from the offline copy");
    expect(document.body.textContent).toContain(mode.waiting);

    serve = () => json(mode.body("new", usual()));
    const before = reads;
    await press(mode.readAgain);
    expect(reads, "one GET").toBe(before + 1);
    expect(posted, "and no second paid run").toHaveLength(1);
    expect(onScreen("new")).toBe(true);
    expect(await regenerate()).toBe("enabled");
    expect(document.body.textContent).not.toContain(mode.waiting);
  });

  it("F3/F10: closed during the job and reopened onto an offline copy, it is still held and recovers", async () => {
    start(mode);
    await paint();
    await pressRegenerate();

    showBand = false;
    await paint();
    serve = dropped;
    finishJob();
    showBand = true;
    await paint();
    expect(onScreen("old")).toBe(true);
    await expectHeld("reopened onto the offline copy");
    expect(document.body.textContent).toContain(mode.waiting);

    /* Still offline: asking again is another copy, and still held. */
    await press(mode.readAgain);
    await expectHeld("a second copy");

    serve = () => json(mode.body("new", usual()));
    await press(mode.readAgain);
    expect(posted).toHaveLength(1);
    expect(onScreen("new")).toBe(true);
    expect(await regenerate()).toBe("enabled");
  });

  /* F9: `starting` is the pressing mount's own, so a band reopened while the
     POST is in the air sees an idle list and nothing to say a job is coming. */
  it("F9: reopened while the POST is still in the air, an unchanged read does not release it", async () => {
    start(mode);
    await paint();
    let land!: () => void;
    postGate = new Promise((resolve) => { land = resolve; });
    await pressRegenerate();
    expect(posted).toHaveLength(1);

    showBand = false;
    await paint();
    showBand = true;
    await paint();
    expect(onScreen("old")).toBe(true);
    await expectHeld("the POST has not answered");

    /* The POST answers. The job list has not been polled since, so the job is
       not in it yet — and an idle-looking list is not this rewrite having ended. */
    await act(async () => land());
    await flush();
    await expectHeld("the POST answered and the list has not shown the job");
    showBand = false;
    await paint();
    showBand = true;
    await paint();
    await expectHeld("reopened again, a fresh unchanged read, the job still unlisted");

    serve = broken;
    finishJob();
    await paint();
    await expectHeld("the job finished and the reload failed");
    expect(posted).toHaveLength(1);
  });

  it("lets go when the rewrite ended without replacing it, once a read started after that says so", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    showBand = false;
    await paint();
    /* It failed while the band was closed: this mount never watched it. */
    finishJob("error");
    showBand = true;
    await paint();
    expect(onScreen("old")).toBe(true);
    expect(await regenerate(), "held for ever after a rewrite that failed out of sight").toBe("enabled");
  });

  it("forgets the hold with the job engine's session", async () => {
    start(mode);
    await paint();
    await pressRegenerate();
    serve = broken;
    finishJob();
    await paint();
    await expectHeld("before sign-out");
    await act(async () => jobEngine.reset());
    jobs = [];
    showBand = false;
    await paint();
    showBand = true;
    serve = () => json(mode.body("old", usual()));
    await paint();
    expect(await regenerate()).toBe("enabled");
  });

  /* F5: the badge is not the only forced control, and a stale or unprofiled
     artefact has no badge to hold. */
  it.each(mode.direct)("F5: $label holds itself, on an artefact with no profile", async ({ label, stale, posts }) => {
    start(mode, { stale, profiled: false });
    await paint();
    expect(buttons(label).filter((b) => !b.disabled), `${label} is offered`).toHaveLength(1);
    await press(label);
    expect(posted).toEqual([{ slug: SLUG, steps: [mode.step], force: [mode.step], ...(posts ?? {}) }]);

    serve = broken;
    finishJob();
    await paint();
    for (const other of mode.forced) {
      expect(buttons(other).filter((b) => !b.disabled), `${other} after the reload failed`).toHaveLength(0);
    }
    expect(posted).toHaveLength(1);

    serve = () => json(mode.body("new", { stale, profiled: false }));
    await press("Try again");
    expect(onScreen("new")).toBe(true);
    expect(buttons(label).filter((b) => !b.disabled), `${label} is offered again`).toHaveLength(1);
  });
});

/* **Skim's hold and the steps its job may run first** (plan 261007e). A run
   names the Quotes or the Ideas in `precededBy` when they are missing or
   stale, unforced, in the one job. The hold follows that job: it is not a hold
   on the prerequisite, and a press that had to wait for the prerequisite reads
   is one press. */
describe("Skim: the forced run and its prerequisites", () => {
  const skim = ROWS.find((r) => r.name === "Skim")!;
  const without = (prefix: string): Row => ({
    ...skim,
    also: Object.fromEntries(Object.entries(skim.also ?? {}).filter(([key]) => key !== prefix)),
  });

  it.each((["quotes", "ideas"] as const).flatMap((prerequisite) =>
    (["error", "cancelled", "skim-refused"] as const).map((outcome) => ({ prerequisite, outcome })),
  ))("releases after $prerequisite ends with $outcome, even without a new route", async ({ prerequisite, outcome }) => {
    start(without(`/api/${prerequisite}/`));
    await paint();
    await pressRegenerate();
    jobs = [{
      ...job(prerequisite, "running"),
      steps: [{ name: prerequisite, status: "running" }, { name: "skim", status: "pending" }],
    } as Job];
    await paint();
    await expectHeld("the prerequisite is still running");

    /* Keep the completion read in the air: the terminal job alone must
       release, even though Skim never wrote a replacement. */
    serve = () => new Promise(() => {});
    jobs = [{
      ...job(prerequisite, outcome === "cancelled" ? "cancelled" : "error"),
      steps: [
        { name: prerequisite, status: outcome === "skim-refused" ? "done" : "error" },
        { name: "skim", status: outcome === "skim-refused" ? "error" : "pending" },
      ],
    } as Job];
    await paint();
    expect(await regenerate(), outcome).toBe("enabled");
    expect(onScreen("old")).toBe(true);
    expect(posted).toHaveLength(1);
  });

  it("holds through a job that chose the Quotes first, and forces the route alone", async () => {
    start(without("/api/quotes/"));
    await paint();
    const button = await forcedButton();
    await act(async () => {
      button.click();
      button.click();
    });
    await flush();
    expect(posted).toEqual([{ slug: SLUG, steps: ["quotes", "skim"], force: ["skim"] }]);

    let land!: (res: Response) => void;
    serve = () => new Promise((resolve) => { land = resolve; });
    jobs = [{ ...job("quotes", "done"), steps: [{ name: "quotes", status: "done" }, { name: "skim", status: "done" }] } as Job];
    await paint();
    expect(onScreen("old")).toBe(true);
    await expectHeld("the job is done and the new route has not been read");
    expect(posted).toHaveLength(1);

    await act(async () => land(json(skim.body("new", usual()))));
    await flush();
    expect(onScreen("new")).toBe(true);
    expect(await regenerate()).toBe("enabled");
  });

  it("a press made while the Ideas read is still out is one forced run, held once it is made", async () => {
    const mode = without("/api/ideas/");
    let landIdeas!: (res: Response) => void;
    const ideas = new Promise<Response>((resolve) => { landIdeas = resolve; });
    start(mode);
    const usualFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) =>
      String(input) === `/api/ideas/${SLUG}` && (init?.method ?? "GET") === "GET" ? ideas : usualFetch(input as string, init),
    );
    await paint();
    const button = await forcedButton();
    await act(async () => {
      button.click();
      button.click();
    });
    await flush();
    expect(posted, "nothing is asked for until the request can name its prerequisites").toHaveLength(0);
    await expectHeld("the kept intent already takes the control away before the POST");

    await act(async () => landIdeas(json(skim.also!["/api/ideas/"])));
    await flush();
    expect(posted).toEqual([{ slug: SLUG, steps: ["skim"], force: ["skim"] }]);
    serve = () => new Promise(() => {});
    finishJob();
    await paint();
    await expectHeld("the deferred press is held like any other");
    expect(posted).toHaveLength(1);
  });
});

/* Loaded pictures deliberately draw no JobProgress Retry. Exercise their real
   hooks' shared failure callback without adding a control to either view. */
describe.each(ROWS.filter((mode) => ["Sketch", "Illustrated"].includes(mode.name)))("$name Retry seam", (mode) => {
  let owner: ReturnType<typeof useSketch> | ReturnType<typeof useIllustrated>;
  function SketchProbe() {
    owner = useSketch(SLUG, BLOCKS.map((block) => block.id));
    return null;
  }
  function IllustratedProbe() {
    owner = useIllustrated(SLUG, BLOCKS);
    return null;
  }
  it.each(["slow", "error", "cancelled", "refused", "unchanged", "offline", "remounted"] as const)(
    "holds Retry and recovers after %s", async (outcome) => {
      start(mode);
      row = { ...mode, mount: (show) => show ? createElement(mode.name === "Sketch" ? SketchProbe : IllustratedProbe) : null };
      await paint();
      await act(async () => owner.regenerate());
      finishJob("error");
      await paint();
      const retry = owner.failed?.retry;
      expect(retry).toBeTypeOf("function");
      retryRefused = outcome === "refused";
      let finishPost!: () => void;
      if (outcome === "remounted") postGate = new Promise((resolve) => { finishPost = resolve; });
      await act(async () => { retry!(); retry!(); });
      await flush();
      expect(retried).toEqual(["the-rewrite"]);
      if (outcome === "refused") {
        expect(owner.rewriting).toBe(false);
        return;
      }
      expect(owner.rewriting).toBe(true);
      if (outcome === "remounted") {
        showBand = false;
        await paint();
        showBand = true;
        await paint();
        expect(owner.rewriting).toBe(true);
        await act(async () => finishPost());
        await flush();
      }
      jobs = [{ ...job(mode.step, "running"), id: "the-retry" }];
      await paint();
      let land!: (res: Response) => void;
      if (outcome === "slow") serve = () => new Promise((resolve) => { land = resolve; });
      if (outcome === "offline") serve = dropped;
      jobs = [{ ...job(mode.step, outcome === "error" || outcome === "cancelled" ? outcome : "done"), id: "the-retry" }];
      await paint();
      if (outcome === "slow" || outcome === "offline") {
        expect(owner.rewriting).toBe(true);
        await act(async () => owner.regenerate());
        expect(posted).toHaveLength(1);
        if (outcome === "slow") await act(async () => land(json(mode.body("new", usual()))));
        else {
          serve = () => json(mode.body("old", usual()));
          await act(async () => owner.refresh());
        }
        await flush();
      }
      expect(owner.rewriting).toBe(false);
      expect(posted).toHaveLength(1);
    },
  );
});

/* **The command bar's *Run again* row asks the mode's hold** (GPT Sol's C4,
   plan 261007b § Left; fixed in plan 261007i). Until then the row posted its
   forced run straight through the queue, so with FAQ held it bought a second
   run for the one result on screen; this test was a pin of that, and was seen
   red in this form against the unfixed row (two POSTs, and the row went on to
   Metadata). It drives the row's own action out of `besideTheModes` rather
   than the drawn bar, so it says nothing about which rows are drawn. */
it("the command bar's Run again refuses while the mode's rewrite is held (C4)", async () => {
  const { besideTheModes } = await import("../src/web/CommandBar.js");
  const { useJobs } = await import("../src/web/useJobs.js");
  const mode = ROWS.find((r) => r.step === "faq")!;
  start(mode);
  await paint();
  await pressRegenerate();
  serve = () => new Promise(() => {});
  finishJob();
  await paint();
  await expectHeld("the rewrite finished and its GET is still in the air");
  expect(posted).toHaveLength(1);

  const again = besideTheModes({
    article: { slug: SLUG, search: "", view: "article" },
    openComments: undefined,
    openFeedback: null,
    queue: useJobs("quiet"),
  }).find((command) => command.kind === "action" && command.id === "rerun-faq");
  expect(again?.kind).toBe("action");
  if (again?.kind !== "action") return;
  const here = location.href;
  let outcome: Awaited<ReturnType<typeof again.run>> | undefined;
  await act(async () => void (outcome = await again.run()));
  const landed = location.href;
  /* A row that ran would have gone to Metadata; put the address back for whatever runs next. */
  history.replaceState(null, "", here);
  expect(outcome).toEqual({
    kind: "stay",
    message: "FAQ was just run again and hasn't loaded yet. Open it to see the result first.",
  });
  expect(landed).toBe(here);
  await expectHeld("the mode's own controls are still held");
  expect(posted).toEqual([{ slug: SLUG, steps: ["faq"], force: ["faq"] }]);
});

/* ------------------------------------------------------ the membership guard --

   **A file under src/web that forces a step is a row above, or is named here
   with its reason.** The rows prove the hold works where it is wired; nothing
   in them notices a new forced verb that never asked for one, which is how
   seven hooks came to have a forced run and no hold (plan 261007b).

   What it reads is the syntax tree, with `@babel/parser` as
   tests/use-copy.test.tsx does, because the text will not do: Skim forced
   through a conditional spread (`...(again ? { force: true } : {})`) until it
   got its hold, the glossary passes it through a parameter
   (`queue.start({ force, … })`), and a dozen comments say `force: true`
   without doing it. So a hit is **an object
   literal with a `force` property** — written out, shorthand, or nested in a
   spread — whose value is not `false` and not itself an object literal (which
   is the force-directed diagram's table, a different word).

   What it does not see: a request built some other way (a computed key, an
   object handed in from another module), and whether every forced path in a
   file goes through the hold rather than beside it. The second is each row's
   own *holds the forced verb synchronously* test, for the control it names. */

/** Whether this source writes a `force` into a request, and whether it calls `useRewriteHold`. */
function forcing(code: string): { forces: boolean; holds: boolean } {
  const tree = parse(code, { sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy"] });
  let forces = false;
  let holds = false;
  const visit = (node: Node): void => {
    if (node.type === "ObjectExpression") {
      for (const p of node.properties) {
        if (p.type !== "ObjectProperty" || p.computed) continue;
        const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null;
        if (key !== "force") continue;
        if (p.value.type === "ObjectExpression") continue;
        if (p.value.type === "BooleanLiteral" && !p.value.value) continue;
        forces = true;
      }
    }
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "useRewriteHold") {
      holds = true;
    }
    const fields = node as unknown as Record<string, unknown>;
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = fields[key];
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item != null) visit(item as Node);
      }
    }
  };
  visit(tree.program);
  return { forces, holds };
}

/**
 * **Every other file that forces a step, and why it holds nothing.** A new one
 * is red until it is a row above or a line here.
 */
const NOT_HELD: Record<string, string> = {
  "useStepJob.ts": "the transport: it turns a hook's `force: true` into the request's `force: [step]`, and decides nothing.",
  "Metadata.tsx":
    "the Metadata page's *AI processing* re-run rows, not a mode's artefact hook: no artefact is on screen beside the button to be mistaken for the new one, and the row has a press latch of its own (§ `RerunRow`).",
  "CommandBar.tsx":
    "the command bar's *Run again* rows, which are Metadata's re-runs reached by typing: the press leaves for the Metadata section, where the row above shows the job. It asks a mode's hold before posting (`rewriteHeld`, plan 261007i) but has no artefact identity to take one of its own.",
  "StructureNotice.tsx":
    "the Structure notice's press for the real tree, with `RerunRow`'s press latch (§ `run`). The tree is part of the article, not a mode artefact with a read of its own for a hold to watch.",
  "ShelfEntry.tsx":
    "the shelf card's rebuild of a whole article (`force: [\"fetch\"]` or `[\"extract\"]`), posted to the queue by hand. Nothing it replaces is drawn on the card.",
};

describe("every file under src/web that forces a step", () => {
  const web = nodePath.resolve(import.meta.dirname, "..", "src", "web");
  const files = (readdirSync(web, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f)).sort();
  const read = Object.fromEntries(files.map((f) => [f, forcing(readFileSync(nodePath.join(web, f), "utf8"))]));
  const forcers = files.filter((f) => read[f]?.forces);
  const rows = new Set(ROWS.map((r) => r.hook));

  it.each([
    ["queue.start({ force: true });", true],
    ["start({ force: true, useProfile });", true],
    ["queue.start({ ...(kind === 'regenerate' ? { force: true } : {}), ...rest });", true],
    ["const run = (force: boolean) => queue.start({ force, useProfile });", true],
    ["post({ slug, 'force': [step] });", true],
    ["queue.start({ force: again });", true],
    ["queue.start({ force: false });", false],
    ["const SIZES = { force: { title: 12 } };", false],
    ["/* queue.start({ force: true }) */ queue.start();", false],
    ["function start({ force = false }: Run = {}) {}", false],
    ["const { force } = run;", false],
  ] as const)("reads %s as forcing: %s", (code, expected) => {
    expect(forcing(code).forces).toBe(expected);
  });

  it("is a row in the table or a named exclusion, and never both", () => {
    expect(forcers.length, "the search found nothing, so it proves nothing").toBeGreaterThanOrEqual(ROWS.length);
    /* A form a search of the text misses: without this hit the scan is the
       literal scan again. (The conditional spread, which Skim used until plan
       261007e, is pinned by the snippets above.) */
    expect(forcers, "the glossary's shorthand `force`").toContain("useGlossary.ts");
    expect(
      forcers.filter((f) => !rows.has(f) && !(f in NOT_HELD)),
      "a forced run with no row here can be pressed twice for one result — give its hook the hold and a row, or an exclusion with its reason",
    ).toEqual([]);
    expect(forcers.filter((f) => rows.has(f) && f in NOT_HELD)).toEqual([]);
  });

  it("names no file that does not force one", () => {
    const named = [...rows, ...Object.keys(NOT_HELD)];
    expect(named.filter((f) => !forcers.includes(f))).toEqual([]);
  });

  it("finds useRewriteHold called in every row's hook, and in no excluded file", () => {
    expect([...rows].filter((f) => !read[f]?.holds), "a row whose hook does not call the hold").toEqual([]);
    expect(
      Object.keys(NOT_HELD).filter((f) => read[f]?.holds),
      "an excluded file that has the hold now: make it a row and delete its exclusion",
    ).toEqual([]);
  });

  it("gives every exclusion a reason", () => {
    for (const [file, why] of Object.entries(NOT_HELD)) {
      expect(why.length, `${file} is excused with no reason`).toBeGreaterThan(10);
    }
  });
});
