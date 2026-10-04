// @vitest-environment jsdom
/**
 * **Regenerate's hold, in the six modes that have a forced rewrite** — Quiz,
 * Summary, Thread, Ideas, Glossary and Sketch. src/web/rewrite-hold.ts;
 * docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md § 2a.
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
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId, Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------------------------------------------------------------- the queue -- */

let jobs: Job[] = [];
const posted: { slug: string; steps: string[]; force?: string[] }[] = [];
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
    retry: async () => null,
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
  useDictationField: () => ({ dictation: { supported: false }, readOnly: false, toggle: () => {} }),
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
  /** A forced control pressed directly: its label, and whether it needs a stale artefact. */
  direct: { label: string; stale: boolean }[];
  /** The quiet line a held panel with nothing running draws. */
  waiting: string;
  /** Its read-only retry. */
  readAgain: string;
}

const noop = () => {};

const { useQuiz, useQuizRead } = await import("../src/web/useQuiz.js");
const { QuizPanel } = await import("../src/web/QuizPanel.js");
const { SummaryBand } = await import("../src/web/modes/summary/SummaryMode.js");
const { IdeasBand } = await import("../src/web/modes/ideas/IdeasMode.js");
const { GlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { SketchView } = await import("../src/web/SketchView.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

/* Quiz and Glossary read above their band (ArticlePage.tsx § `OwnedReader`), so
   closing the band leaves the read mounted. The other four read inside it. */
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

const summary = (show: boolean) =>
  show ? createElement(SummaryBand, { slug: SLUG, article: ARTICLE, onJump: noop }) : null;

const ROWS: Row[] = [
  {
    name: "Quiz",
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
    forced: ["Find more", "Find terms again"],
    direct: [
      { label: "Find terms again", stale: true },
      { label: "Find more", stale: false },
    ],
    waiting: "The new terms haven't loaded yet.",
    readAgain: "Try again",
  },
  {
    name: "Sketch",
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
        { searchParams: row.search ?? "", hasMemory: true } as Parameters<typeof NuqsTestingAdapter>[0],
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

/** The badge's Regenerate, read by opening its panel and closing it again. */
async function regenerate(): Promise<"enabled" | "disabled" | "absent"> {
  const badge = document.querySelector<HTMLButtonElement>(".prof-badge");
  if (!badge) return "absent";
  await act(async () => badge.click());
  await flush();
  const [b] = buttons("Regenerate");
  const state = b === undefined ? "absent" : b.disabled ? "disabled" : "enabled";
  await press("Done");
  return state;
}
async function pressRegenerate() {
  const badge = document.querySelector<HTMLButtonElement>(".prof-badge");
  expect(badge, "the written-for-you badge").not.toBeNull();
  await act(async () => badge!.click());
  await flush();
  expect(buttons("Regenerate")[0]?.disabled, "Regenerate is offered before the press").toBe(false);
  await press("Regenerate");
}
/** No forced control can be pressed: each is gone, or disabled. */
async function expectHeld(why: string) {
  expect(await regenerate(), `${why}: the badge's Regenerate`).toBe("disabled");
  for (const label of row.forced) {
    expect(buttons(label).filter((b) => !b.disabled), `${why}: ${label}`).toHaveLength(0);
  }
}

const PROFILED: Shape = { stale: false, profiled: true };

function start(which: Row, shape: Shape = PROFILED) {
  row = which;
  path = `${row.path}${SLUG}`;
  serve = () => json(row.body("old", shape));
}
const finishJob = (status: Job["status"] = "done") => {
  jobs = [job(row.step, status)];
};

beforeEach(() => {
  jobs = [];
  posted.length = 0;
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

describe.each(ROWS)("$name", (mode) => {
  it("holds every forced control after the job finishes and the reload fails, and a fresh read of the new one lets go", async () => {
    start(mode);
    await paint();
    expect(onScreen("old")).toBe(true);
    await pressRegenerate();
    expect(posted).toEqual([{ slug: SLUG, steps: [mode.step], force: [mode.step] }]);

    serve = broken;
    finishJob();
    await paint();
    expect(onScreen("old"), "a failed reload keeps what was there").toBe(true);
    await expectHeld("the reload failed");
    expect(posted, "exactly one forced POST").toHaveLength(1);

    serve = () => json(mode.body("new", PROFILED));
    await press("Try again");
    expect(onScreen("new")).toBe(true);
    expect(await regenerate(), "the replacement is here").toBe("enabled");
    expect(posted).toHaveLength(1);
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

    await act(async () => landOld(json(mode.body("old", PROFILED))));
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

    serve = () => json(mode.body("new", PROFILED));
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

    serve = () => json(mode.body("new", PROFILED));
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
    serve = () => json(mode.body("old", PROFILED));
    await paint();
    expect(await regenerate()).toBe("enabled");
  });

  /* F5: the badge is not the only forced control, and a stale or unprofiled
     artefact has no badge to hold. */
  it.each(mode.direct)("F5: $label holds itself, on an artefact with no profile", async ({ label, stale }) => {
    start(mode, { stale, profiled: false });
    await paint();
    expect(buttons(label).filter((b) => !b.disabled), `${label} is offered`).toHaveLength(1);
    await press(label);
    expect(posted).toEqual([{ slug: SLUG, steps: [mode.step], force: [mode.step], ...(mode.step === "glossary" ? { useProfile: false } : {}) }]);

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
