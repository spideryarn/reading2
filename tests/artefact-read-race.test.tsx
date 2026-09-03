// @vitest-environment jsdom
/**
 * **The same-slug read race, against every reader that can meet it.**
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T2.1,
 * from GPT Sol's 2026-08-28 reasoning in
 * docs/plans/260828aj-simplification-wave-2.md § 2.6.
 *
 * The sequence Sol argued reachable, and this file reproduced on 2026-09-02:
 *
 *   1. a reader opens a mode while a job for that article is already running;
 *   2. the opening GET reads the **old** artefact;
 *   3. the job finishes and `useStepJob`'s poll calls `onFinished`;
 *   4. the completion GET returns **first**, with the new artefact;
 *   5. the opening GET lands **last** and overwrites it, permanently — nothing
 *      retries, because `useJobs` has already announced the job.
 *
 * It began as a two-case spike: `useIdeas` red, `useGlossary` green, because
 * only the glossary ordered its reads. All eight now share that ordering
 * (src/web/useOrderedRead.ts), so all eight are driven here, through the same
 * body — which is the point of the extraction rather than a convenience.
 *
 * **The assertion names the stale value.** A request count would go green on
 * both the broken and the fixed hook; what separates them is which artefact is
 * on screen at the end.
 *
 * **The replies are released one at a time, newest first**, rather than in a
 * batch. Releasing them together leaves the interleaving to the microtask queue,
 * and a test that cannot state the order it is testing cannot claim to have
 * tested it. Newest-first is what makes the pre-job read land last, which is the
 * whole hypothesis; it also works for a hook that orders its reads, because that
 * one only ever has a single read out at a time and answers the trailing read
 * afterwards. See `answerNewestFirst`.
 *
 * Shaped after tests/background-reload-keeps-the-list.test.tsx.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Arc,
  Article,
  BlockId,
  Glossary,
  Ideas,
  Quiz,
  Quotes,
  Timeline,
  TweetThread,
} from "../src/types.js";

/* React only permits `act` when the environment says it is a test one. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "constitution";
const OLD = "the old one";
const NEW = "the new one";

/** A request that has been made and not yet answered. */
interface Held {
  url: string;
  /** Let it answer, with the body decided when it was **asked**. */
  go: () => void;
}

const asked: string[] = [];
const held: Held[] = [];

/**
 * What every endpoint would say **right now** — one value, because one reader is
 * under test at a time and the race is about which of two answers survives.
 */
let value = OLD;

/** The article's block ids, so `useSketch` has an order to validate against. */
const BLOCKS = ["spya-aaaaaa", "spya-bbbbbb"] as BlockId[];

const STAMP = { generator: "test", slug: SLUG, sourceHash: "abc", profileHash: null } as const;

function ideasArtefact(): Ideas {
  return {
    ...STAMP,
    version: "ideas/1",
    ideas: [{ id: "spya-idea0", name: value, provenance: "assumed", statement: value, blocks: [] }],
  } as unknown as Ideas;
}

function glossaryArtefact(): Glossary {
  return {
    ...STAMP,
    version: "glossary/2",
    entries: [{ id: "spya-term0", name: value, kind: "concept", aliases: [], blocks: [] }],
  } as unknown as Glossary;
}

function quotesArtefact(): Quotes {
  return {
    ...STAMP,
    version: "quotes/1",
    quotes: [{ id: "spya-quote0", blockId: BLOCKS[0], text: value }],
  } as unknown as Quotes;
}

function timelineArtefact(): Timeline {
  return {
    ...STAMP,
    version: "timeline/1",
    events: [
      { id: "spya-event0", label: value, order: 1, modality: "actual", occurrences: [] },
    ],
  } as unknown as Timeline;
}

function quizArtefact(): Quiz {
  return {
    ...STAMP,
    version: "quiz/1",
    batchId: "batch0",
    questions: [{ id: "spya-q0", question: value, referenceAnswer: "x", evidence: [], band: "recall", value: 1 }],
  } as unknown as Quiz;
}

function arcArtefact(): Arc {
  return {
    ...STAMP,
    version: "arc/1",
    entries: [{ range: [BLOCKS[0], BLOCKS[1]], text: value }],
  } as unknown as Arc;
}

function threadArtefact(): TweetThread {
  return {
    ...STAMP,
    version: "tweets/1",
    limit: 280,
    tweets: [{ text: value, chars: [...value].length }],
  } as unknown as TweetThread;
}

/** A scene `readSketch` will keep whole — one node, whose label is the value. */
function sketchArtefact(): unknown {
  return {
    version: "sketch/1",
    title: "t",
    caption: "c",
    scenes: [
      {
        id: "overview",
        title: "s",
        height: 600,
        items: [{ kind: "node", id: "n", x: 10, y: 10, w: 120, h: 40, text: value }],
      },
    ],
  };
}

/**
 * The body is decided when the request **arrives**, not when it is answered —
 * which is what a server does, and what makes a held reply describe the world as
 * it was at the moment of asking. Without this the whole race is invisible:
 * every reply would carry the newest fixture and the overwrite would be an
 * overwrite by the same value.
 */
function bodyFor(url: string): string {
  const dated = { stale: false, outdated: false, profileChanged: false };
  if (url.startsWith("/api/ideas/")) return JSON.stringify({ ideas: ideasArtefact(), ...dated });
  if (url.startsWith("/api/glossary/")) {
    return JSON.stringify({ glossary: glossaryArtefact(), ...dated });
  }
  if (url.startsWith("/api/quotes/")) return JSON.stringify({ quotes: quotesArtefact(), ...dated });
  if (url.startsWith("/api/timeline/")) {
    return JSON.stringify({ timeline: timelineArtefact(), ...dated });
  }
  if (url.startsWith("/api/quiz/")) return JSON.stringify({ quiz: quizArtefact(), ...dated });
  if (url.startsWith("/api/arc/")) return JSON.stringify({ arc: arcArtefact(), ...dated });
  if (url.startsWith("/api/sketch/")) return JSON.stringify({ sketch: sketchArtefact(), ...dated });
  if (url.startsWith("/api/tweets/")) {
    return JSON.stringify({ thread: threadArtefact(), ...dated });
  }
  throw new Error(`the test made an unexpected request: ${url}`);
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string) => {
    asked.push(input);
    const body = bodyFor(input);
    await new Promise<void>((go) => held.push({ url: input, go }));
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  },
  fetchOk: async (input: string) => {
    asked.push(input);
    const body = bodyFor(input);
    await new Promise<void>((go) => held.push({ url: input, go }));
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  },
  leavingFetch: async () => undefined,
  readJson: async (res: Response) => res.json(),
  failure: async (res: Response) => new Error(String(res.status)),
}));

/** The job poller, posed by the test. `finishJob` is the seam under test. */
let announce: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null =
  null;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (cb?: (job: never) => void) => {
    announce = (cb ?? null) as typeof announce;
    return {
      jobs: [],
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => null,
      run: async () => ({ id: "job1" }),
      cancel: async () => {},
    };
  },
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

/* The thread page's bottom bar reaches Supabase and the whole visitor layer, and
   none of it is what this file is about. */
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { useIdeas } = await import("../src/web/useIdeas.js");
const { useGlossary, useGlossaryRead } = await import("../src/web/useGlossary.js");
const { useQuotes } = await import("../src/web/useQuotes.js");
const { useTimeline } = await import("../src/web/useTimeline.js");
const { useQuiz } = await import("../src/web/useQuiz.js");
const { useArc } = await import("../src/web/useArc.js");
const { useSketch } = await import("../src/web/useSketch.js");
const { Tweets } = await import("../src/web/Tweets.js");

/** A job for this article, arriving in the poll as finished. */
function finishJob(step: string): void {
  announce?.({ slug: SLUG, status: "done", steps: [{ name: step }] });
}

/**
 * Each harness renders **what the reader would see** — the artefact's own words,
 * or the status word when there is no artefact to show. The assertion is against
 * the DOM for all eight, so a hook that quietly went back to `loading` or `none`
 * fails as loudly as one holding the stale list.
 */
function IdeasHarness({ slug }: { slug: string }): ReactElement {
  const all = useIdeas(slug);
  return createElement("aside", null, all.ideas?.ideas.map((i) => i.name).join(",") ?? all.status);
}

/**
 * `Reader` owns the glossary read and the band layers the jobs over it
 * (src/web/App.tsx), so this harness mounts both halves — the opening GET
 * belongs to `useGlossaryRead` and the `onFinished` wiring to `useGlossary`.
 */
function GlossaryHarness({ slug }: { slug: string }): ReactElement {
  const read = useGlossaryRead(slug);
  const all = useGlossary(slug, read);
  return createElement(
    "aside",
    null,
    all.glossary?.entries.map((e) => e.name).join(",") ?? all.status,
  );
}

function QuotesHarness({ slug }: { slug: string }): ReactElement {
  const all = useQuotes(slug);
  return createElement("aside", null, all.quotes?.quotes.map((q) => q.text).join(",") ?? all.status);
}

function TimelineHarness({ slug }: { slug: string }): ReactElement {
  const all = useTimeline(slug);
  return createElement(
    "aside",
    null,
    all.timeline?.events.map((e) => e.label).join(",") ?? all.status,
  );
}

function QuizHarness({ slug }: { slug: string }): ReactElement {
  const all = useQuiz(slug);
  return createElement(
    "aside",
    null,
    all.quiz?.questions.map((q) => q.question).join(",") ?? all.status,
  );
}

function ArcHarness({ slug }: { slug: string }): ReactElement {
  /* `undefined` is the case this hook exists for: the article payload carried no
     arc, so the hook reads one of its own. */
  const all = useArc(slug, undefined);
  return createElement("aside", null, all.arc?.entries.map((e) => e.text).join(",") ?? all.status);
}

function SketchHarness({ slug }: { slug: string }): ReactElement {
  const all = useSketch(slug, BLOCKS);
  const labels = all.sketch?.scenes
    .flatMap((s) => s.items)
    .flatMap((i) => (i.kind === "node" ? [i.text] : []))
    .join(",");
  return createElement("aside", null, labels || all.status);
}

const ARTICLE = {
  meta: { slug: SLUG, title: "A Constitution", url: "https://example.com/c" },
  blocks: [{ id: BLOCKS[0], kind: "p", text: "some words here" }],
  tree: { rootId: "spya-root", nodes: {} },
} as unknown as Article;

function TweetsHarness({ slug }: { slug: string }): ReactElement {
  /* The eighth reader is a page rather than a hook — its GET is inline in the
     component — so it is mounted whole, as its own tests mount it. */
  return createElement(Tweets, { slug, article: ARTICLE });
}

interface Reader {
  /** The hook or component, as its file names it. */
  name: string;
  /** The pipeline step whose completion sends the second read out. */
  step: string;
  /** The one URL this reader asks for. */
  url: string;
  Harness: (props: { slug: string }) => ReactElement;
}

const READERS: Reader[] = [
  { name: "useIdeas", step: "ideas", url: `/api/ideas/${SLUG}`, Harness: IdeasHarness },
  { name: "useGlossary", step: "glossary", url: `/api/glossary/${SLUG}`, Harness: GlossaryHarness },
  { name: "useQuotes", step: "quotes", url: `/api/quotes/${SLUG}`, Harness: QuotesHarness },
  { name: "useTimeline", step: "timeline", url: `/api/timeline/${SLUG}`, Harness: TimelineHarness },
  { name: "useQuiz", step: "quiz", url: `/api/quiz/${SLUG}`, Harness: QuizHarness },
  { name: "useArc", step: "arc", url: `/api/arc/${SLUG}`, Harness: ArcHarness },
  { name: "useSketch", step: "sketch", url: `/api/sketch/${SLUG}`, Harness: SketchHarness },
  { name: "Tweets.tsx", step: "tweets", url: `/api/tweets/${SLUG}`, Harness: TweetsHarness },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked.length = 0;
  held.length = 0;
  announce = null;
  value = OLD;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Render, and let the effects run — but answer nothing. */
async function render(el: ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

/** Let the microtasks and the renders they cause finish. */
async function drain(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Answer every read that is out, **newest first**, until the reader stops
 * asking — and count them.
 *
 * Newest-first is the hypothesis: it makes the completion read land before the
 * pre-job one, which is the interleaving that loses the new artefact. A reader
 * that orders its reads never has two out at once, so the same loop answers its
 * single read and then the trailing one it arms — which is why one body can
 * drive both the broken shape and the fixed one.
 */
async function answerNewestFirst(): Promise<number> {
  let answered = 0;
  while (held.length > 0) {
    if (answered > 6) throw new Error("the reader never stopped reading");
    const entry = held.pop();
    if (!entry) break;
    entry.go();
    await drain();
    answered++;
  }
  return answered;
}

describe("two reads of one slug, the opening one landing last", () => {
  for (const reader of READERS) {
    it(`${reader.name}: the completion read is not overwritten by the pre-job read`, async () => {
      /* 1. The reader opens the mode. The opening GET reads the OLD artefact —
            and is held, as it would be while the server is answering. */
      await render(createElement(reader.Harness, { slug: SLUG }));
      expect(held).toHaveLength(1);
      expect(held[0]?.url).toBe(reader.url);

      /* 2. The job that was already running finishes and writes a new one. */
      value = NEW;
      await act(async () => {
        finishJob(reader.step);
      });

      /* 3. Everything in flight answers, newest first, and anything armed by
            that follows. */
      const answered = await answerNewestFirst();

      /* The completion read really happened. Without this the test would pass on
         a reader whose `onFinished` was wired to nothing and which simply never
         asked again — two reads either way, and *which* two is the difference
         the shared ordering makes. */
      expect(answered).toBeGreaterThanOrEqual(2);
      expect(asked.filter((u) => u === reader.url)).toHaveLength(answered);

      /* 4. ...and the new artefact is what is on screen. The stale value is
            named, because a request count cannot tell these two apart. */
      expect(host.textContent).toContain(NEW);
      expect(host.textContent).not.toContain(OLD);
    });
  }
});
