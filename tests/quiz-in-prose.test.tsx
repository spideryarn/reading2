// @vitest-environment jsdom
/**
 * **The quiz's questions, in the prose, in every mode** — SPIDERYARN-READING2-6V,
 * docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md § Tests.
 *
 * > if you've generated quiz questions, it should always show them in situ in
 * > the text, whether you're in quiz mode or not.
 * >
 * > — Greg, 2026-09-30
 *
 * The real App and Reader, mounted as `main.tsx` mounts them (StrictMode,
 * nuqs with history sync), against a fake server whose `GET /api/quiz/<slug>`
 * answers a `quiz/5`-shaped artefact. What is asserted:
 *
 * 1. Each question hangs after the block holding its **last evidence passage in
 *    document order** — not the last one listed — in Plain and with another
 *    mode open; the question's words are there and its premise is **nowhere**
 *    in the prose.
 * 2. A `stale` quiz draws nothing; an `outdated`, non-stale one still does.
 * 3. Pressing a line is **one** pushed entry to `mode=remember&remember=quiz`
 *    with `thread` cleared, undone by one Back, buying nothing — and the band
 *    lands on that question with its premise shown (a jump).
 * 4. A second press while Quiz is open moves the band.
 * 5. `memo(TableView)` holds across an `?at=`-only change with the lines drawn,
 *    and a new batch does re-render it and changes the lines.
 *
 * Every "nothing" here has a control beside it that shows the same page drawing
 * something (docs/reusable/silent-success.md). The harness is borrowed, trimmed,
 * from tests/a-broken-mode-leaves-the-article-readable.test.tsx, which owns it.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Quiz, QuizQuestion, QuizResponse } from "../src/types.js";

/** Render counts by `useRenderCount` label — the TableView memo's witness. */
const renders = vi.hoisted(() => new Map<string, number>());

/** Who `useSession` says is here. */
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

/* Counts every component body that opts in. The real probe is off unless
   `?perf=1`, so it would count nothing; this counts regardless. */
vi.mock("../src/web/perf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/perf.js")>();
  return {
    ...actual,
    useRenderCount(label: string) {
      renders.set(label, (renders.get(label) ?? 0) + 1);
      actual.useRenderCount(label);
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

/* ---------------------------------------------------------------- fixture -- */

const SLUG = "a-piece";
/* Valid Spideryarn ids: the charset excludes `i`, `l`, `o` and `1` (src/ids.ts). */
const H = "spya-aaaaaa";
const B = "spya-bbbbbb";
const C = "spya-cccccc";
const D = "spya-dddddd";
const E = "spya-eeeeee";
const THREAD = "spya-thread";

const para = (id: string, text: string): Article["blocks"][number] => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(" ").length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const BLOCKS: Article["blocks"] = [
  {
    id: H,
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  para(B, "The first paragraph of the piece."),
  para(C, "The second paragraph says something else."),
  para(D, "The third paragraph builds on the first."),
  para(E, "The fourth paragraph concludes."),
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
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: ["n1"],
        range: [H, E],
        title: "A piece",
        gist: "What the piece says.",
      },
      n1: {
        id: "n1",
        depth: 1,
        parent: "n0",
        children: [],
        range: [B, E],
        title: "The argument it makes",
        gist: "Where the piece gets to.",
      },
    },
  },
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

const ev = (blockId: string) => ({ blockId, quote: "paragraph", start: 0 });

/**
 * The path. `Q1`'s evidence is listed later-block-first, so "the last one
 * listed" (B) and "the last in document order" (D) disagree — only the second is
 * right. `Q2` and `Q3` share C, in path order. `Q3` and `Q4` carry premises.
 */
const Q1: QuizQuestion = {
  id: "spya-qaaaaa",
  question: "QUESTION-ONE what does the third paragraph build on?",
  referenceAnswer: "The first.",
  evidence: [ev(D), ev(B)],
};
const Q2: QuizQuestion = {
  id: "spya-qbbbbb",
  question: "QUESTION-TWO what does the second paragraph say?",
  referenceAnswer: "Something else.",
  evidence: [ev(C)],
};
const Q3: QuizQuestion = {
  id: "spya-qccccc",
  question: "QUESTION-THREE and why does that matter?",
  premise: "PREMISE-THREE the second paragraph says something else.",
  referenceAnswer: "Because.",
  evidence: [ev(C)],
};
const Q4: QuizQuestion = {
  id: "spya-qddddd",
  question: "QUESTION-FOUR how does it conclude?",
  premise: "PREMISE-FOUR it matters because.",
  referenceAnswer: "It concludes.",
  evidence: [ev(E)],
};

function quizOf(batchId: string, questions: QuizQuestion[]): Quiz {
  return {
    version: "quiz/5",
    generator: "test",
    slug: SLUG,
    batchId,
    sourceHash: "hash",
    questions,
    dropped: {
      unknownIds: 0,
      unquoted: 0,
      truncated: 0,
      overCap: 0,
      malformed: 0,
      duplicate: 0,
      unanchored: 0,
      gaps: 0,
    },
    generatedAt: "2026-09-30T09:00:00.000Z",
    elapsedMs: 1,
  };
}

const QUIZ_A = quizOf("batch-a", [Q1, Q2, Q3, Q4]);
const PREMISES = [Q3.premise, Q4.premise] as string[];

/* ------------------------------------------------------------ fake server -- */

const trace: { url: string; method: string }[] = [];
/** What the next `GET /api/quiz/<slug>` answers. */
let quizReply: () => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const quizBody = (quiz: Quiz, stale = false, outdated = false): Response =>
  json({ quiz, stale, outdated, profileChanged: false } satisfies QuizResponse);

function reply(url: string, method: string): Response | Promise<Response> {
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: null });
  if (method === "POST") return new Response(null, { status: 204 });
  if (url === `/api/quiz/${SLUG}`) return quizReply();
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

const { App } = await import("../src/web/App.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

const OWNER_A = { id: "owner-1", email: "a@example.com" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  renders.clear();
  who.set(null);
  activation.resetActivations();
  resetExperimental();
  quizReply = () => quizBody(QUIZ_A);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    trace.push({ url, method });
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

async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(AppBoundary, null, createElement(App, null))),
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

const param = (key: string): string | null => new URLSearchParams(location.search).get(key);

/** nuqs writes behind a throttle, so a single read is a race. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 60 && !check(); i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
}

const row = (id: string): HTMLTableRowElement => {
  const found = host.querySelector<HTMLTableRowElement>(`tr[data-block="${id}"]`);
  expect(found, `the prose must draw ${id}`).not.toBeNull();
  return found as HTMLTableRowElement;
};

/** The question texts hung after one block, in the order drawn. */
const linesAfter = (id: string): string[] =>
  [...row(id).querySelectorAll(".quiz-in-prose .quiz-in-prose-q")].map((b) =>
    (b.textContent ?? "").trim(),
  );

const allLines = (): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(".quiz-in-prose .quiz-in-prose-q"),
];

const lineFor = (q: QuizQuestion): HTMLButtonElement => {
  const found = allLines().find((b) => (b.textContent ?? "").trim() === q.question);
  expect(found, `a line for ${q.id}`).toBeDefined();
  return found as HTMLButtonElement;
};

/** The whole reading table — everything `TableView` draws. */
const prose = (): string => host.querySelector("table")?.textContent ?? "";

const jobPosts = () => trace.filter((r) => r.method === "POST" && r.url === "/api/jobs");

/** The question the Quiz band has open, and whether its premise is shown. */
function bandQuestion(): { question: string | null; premise: string | null } {
  const one = host.querySelector(".quiz-one");
  return {
    question: one?.querySelector(".quiz-question")?.textContent ?? null,
    premise: one?.querySelector(".quiz-premise")?.textContent ?? null,
  };
}

/* ------------------------------------------------------------------ cases -- */

function expectPlacedLines(): void {
  expect(linesAfter(D), "Q1 hangs after its document-last evidence block").toEqual([Q1.question]);
  expect(linesAfter(B), "not after the last-listed one").toEqual([]);
  expect(linesAfter(C), "a shared anchor keeps path order").toEqual([Q2.question, Q3.question]);
  expect(linesAfter(E)).toEqual([Q4.question]);
  expect(linesAfter(H)).toEqual([]);
  expect(allLines()).toHaveLength(4);
  for (const premise of PREMISES) {
    expect(prose(), "a premise is an earlier answer; the prose must not show it").not.toContain(
      premise,
    );
  }
  /* The lines are siblings of the prose, never inside it. */
  expect(row(C).querySelector(".prose .quiz-in-prose")).toBeNull();
  /* The visible question is the button's accessible name. Native `title`
     tooltips are explicitly forbidden by docs/project/tooltips.md: they add a
     second, hover-only sentence that a finger can never reach. */
  expect(lineFor(Q1).getAttribute("title"), "the question grew a native tooltip").toBeNull();
}

describe("the quiz's questions in the prose", () => {
  it("hang after the block of their last evidence passage, in Plain", async () => {
    who.set(OWNER_A);
    await open();
    expect(param("mode")).toBeNull();
    expectPlacedLines();
  });

  it("hang in the same places with another mode open", async () => {
    who.set(OWNER_A);
    await open("?mode=glossary");
    /* The control that the other mode really is open. */
    expect(param("mode")).toBe("glossary");
    expect(renders.get("GlossaryBand") ?? 0, "the glossary band never rendered").toBeGreaterThan(0);
    expectPlacedLines();
  });

  it("are not drawn for a stale quiz, and are for an outdated one", async () => {
    who.set(OWNER_A);
    quizReply = () => quizBody(QUIZ_A, true, false);
    await open();
    expect(
      trace.some((r) => r.url === `/api/quiz/${SLUG}`),
      "the quiz was never read",
    ).toBe(true);
    expect(row(D), "the prose is up").toBeTruthy();
    expect(host.querySelectorAll(".quiz-in-prose"), "a stale quiz drew lines").toHaveLength(0);

    await act(async () => root.unmount());
    root = createRoot(host);
    quizReply = () => quizBody(QUIZ_A, false, true);
    await open();
    expect(allLines(), "an outdated, current quiz must still be drawn").toHaveLength(4);

    await act(async () => root.unmount());
    root = createRoot(host);
    quizReply = () => quizBody(QUIZ_A, false, false);
    await open();
    expect(allLines(), "the control: a fresh quiz draws").toHaveLength(4);
  });
});

describe("pressing a line", () => {
  it("opens Quiz at that question in one pushed entry, and buys nothing", async () => {
    who.set(OWNER_A);
    const before = `?mode=glossary&remember=recall&thread=${THREAD}`;
    await open(before);
    const startSearch = location.search;
    /* The starting address survived the mount, so the Back check means something. */
    expect(param("mode")).toBe("glossary");
    expect(param("remember")).toBe("recall");
    expect(param("thread")).toBe(THREAD);
    expect(host.querySelector(".quiz-one"), "Quiz is not open yet").toBeNull();
    trace.length = 0;
    const length = history.length;
    /* Every address written, pushed or replaced, so "no frame in which the URL
       says both" is something this can see: Remember's rule 2 would clean a
       leftover `thread` up afterwards with a replace, and the end state alone
       would not know. */
    const writes: { kind: "push" | "replace"; search: string }[] = [];
    const record = (kind: "push" | "replace") => (_d: unknown, _t: string, url?: string | URL | null) => {
      if (url != null) writes.push({ kind, search: new URL(String(url), location.href).search });
    };
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    const onPush = record("push");
    const onReplace = record("replace");
    history.pushState = (d, t, url) => {
      onPush(d, t, url);
      origPush(d, t, url);
    };
    history.replaceState = (d, t, url) => {
      onReplace(d, t, url);
      origReplace(d, t, url);
    };

    try {
      await act(async () => lineFor(Q3).click());
      await until(() => param("mode") === "remember");
      await settle();
    } finally {
      history.pushState = origPush;
      history.replaceState = origReplace;
    }

    expect(writes.filter((w) => w.kind === "push"), "exactly one pushed write").toHaveLength(1);
    for (const w of writes) {
      const q = new URLSearchParams(w.search);
      expect(
        q.get("remember") === "quiz" && q.get("thread") !== null,
        `an address said both remember=quiz and thread: ${w.search}`,
      ).toBe(false);
    }

    expect(param("mode")).toBe("remember");
    expect(param("remember")).toBe("quiz");
    expect(param("thread"), "thread must be cleared in the same write").toBeNull();
    expect(history.length, "exactly one pushed entry").toBe(length + 1);
    expect(jobPosts(), "a press in the prose bought something").toEqual([]);
    expect(bandQuestion(), "the band lands on the pressed question, premise shown").toEqual({
      question: Q3.question,
      premise: Q3.premise,
    });
    /* And still drawn in the prose while Quiz is open. */
    expect(allLines()).toHaveLength(4);

    await act(async () => history.back());
    await until(() => param("mode") === "glossary");
    await settle();
    expect(location.search, "one Back restores the whole address").toBe(startSearch);
    expect(jobPosts()).toEqual([]);
  });

  it("moves an open Quiz band to another pressed question", async () => {
    who.set(OWNER_A);
    await open();
    await act(async () => lineFor(Q2).click());
    await until(() => param("mode") === "remember");
    await settle();
    expect(bandQuestion().question, "the first press landed").toBe(Q2.question);
    expect(bandQuestion().premise, "Q2 has no premise").toBeNull();

    /* **A second press while Quiz is open adds no history entry** — the browser
       check found one Back doing nothing after two presses (260930i). Which
       question is open is not in the URL, so there is nothing for an entry to
       hold. The write is counted, not just the length, because nuqs may push
       an identical address. */
    const length = history.length;
    const origPush = history.pushState.bind(history);
    let pushes = 0;
    history.pushState = (d, t, url) => {
      pushes++;
      origPush(d, t, url);
    };
    try {
      await act(async () => lineFor(Q4).click());
      await settle();
    } finally {
      history.pushState = origPush;
    }
    expect(pushes, "a second press pushed an entry").toBe(0);
    expect(history.length).toBe(length);
    expect(bandQuestion()).toEqual({ question: Q4.question, premise: Q4.premise });
    expect(param("mode")).toBe("remember");
    expect(param("remember")).toBe("quiz");
    expect(jobPosts()).toEqual([]);
  });
});

describe("memo(TableView) and the quiz lines", () => {
  it("holds across an ?at=-only change, and gives way to a new batch", async () => {
    who.set(OWNER_A);
    await open("?mode=remember&remember=recall");
    expect(allLines()).toHaveLength(4);

    /* The next quiz read is held open, so the band's mount reload can be let
       go on cue — the only change in the last step is then the batch. */
    let release: (r: Response) => void = () => {};
    const Q5: QuizQuestion = {
      id: "spya-qeeeee",
      question: "QUESTION-FIVE a new batch's question?",
      referenceAnswer: "New.",
      evidence: [ev(B)],
    };
    quizReply = () =>
      new Promise<Response>((go) => {
        release = go;
      });
    await act(async () => lineFor(Q1).click());
    await until(() => param("remember") === "quiz");
    await settle();
    expect(
      trace.filter((r) => r.url === `/api/quiz/${SLUG}`).length,
      "the band's mount reload was made",
    ).toBeGreaterThanOrEqual(2);

    /* The ?at=-only change: Reader renders, TableView must not. */
    renders.clear();
    await act(async () => {
      history.replaceState(null, "", `${location.pathname}${location.search}&at=${C}`);
    });
    await settle();
    expect(param("at")).toBe(C);
    expect(renders.get("Reader") ?? 0, "the at change never reached Reader").toBeGreaterThan(0);
    expect(renders.get("TableView") ?? 0, "an ?at=-only change rendered TableView").toBe(0);
    expect(allLines(), "and the lines are still drawn").toHaveLength(4);

    /* The control: a new batch does re-render it, and the lines follow. */
    renders.clear();
    await act(async () => release(quizBody(quizOf("batch-b", [Q5]))));
    await settle();
    expect(renders.get("TableView") ?? 0, "a new batch must re-render TableView").toBeGreaterThan(0);
    expect(allLines().map((b) => (b.textContent ?? "").trim())).toEqual([Q5.question]);
    expect(linesAfter(B)).toEqual([Q5.question]);
  });
});
