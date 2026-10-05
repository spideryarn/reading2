// @vitest-environment jsdom
/**
 * **A quiz answer is still there when you come back** — the real `useQuizRead`,
 * `useQuiz`, `QuizPanel` and `apiFetch`, over a posed server.
 * docs/plans/261005b-quiz-answers-are-kept-and-restored.md (report spya-e8ujxn);
 * the route and the table are tests/quiz-attempts-route.test.ts.
 *
 * "Back" is four different journeys and each lost the answer for its own
 * reason, so each is here: Next then Previous (`move` cleared the attempt),
 * leaving Quiz for another mode (the band unmounts), a reload (nothing was
 * stored), and a reload with no network (the offline copy of the quiz was
 * made before the answer was).
 *
 * The rest are GPT Sol's findings on the plan, one or two cases each — the
 * numbers in the test names are the review's:
 * docs/plans/261005b-quiz-answers-plan-review-sol.md.
 *
 * ## What is posed
 *
 * Only the network, the offline store (a Map with the real prefix semantics,
 * as tests/api-fetch-offline.test.ts) and the job queue. `server` below is the
 * whole of the posed server: which batch is current, which answers it holds,
 * and what the next mark does.
 */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Quiz, QuizKeptAnswer, QuizQuestion, QuizResponse } from "../src/types.js";
import type { QuizArrival } from "../src/web/QuizPanel.js";
import type { ReadSoFar } from "../src/web/read-filter.js";
import type { QuizRead, UseQuiz } from "../src/web/useQuiz.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "TOKEN-1" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

/** The offline copies, url → body, for the one reader these tests have. */
const held = new Map<string, unknown>();
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async (url: string) => (held.has(url) ? { body: held.get(url), savedAt: 1000 } : undefined),
  writeCached: async (url: string, body: unknown) => {
    held.set(url, body);
  },
  reserveTicket: async (url: string, userId: string | null) =>
    userId ? { userId, url, epoch: 0, seq: 1 } : null,
  /* Every row whose url starts with the prefix, as the real one. */
  invalidate: async (prefix: string) => {
    for (const url of [...held.keys()]) if (url.startsWith(prefix)) held.delete(url);
  },
  cachedSlugs: async () => new Set<string>(),
  rememberUser: () => {},
  lastKnownUser: () => "user-1",
  forgetUser: () => {},
}));

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [], loaded: true, driverFailures: {}, lastFailure: () => null,
    run: async () => {
      throw new Error("no job is started in this file");
    },
    cancel: async () => {},
  }),
}));
vi.mock("../src/web/useAutoRun.js", () => ({ useAutoRun: () => {} }));
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({ dictation: { supported: false }, readOnly: false, busy: false, toggle: () => {} }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null, DictationStrip: () => null,
}));
vi.mock("../src/web/WrittenForYou.js", () => ({ WrittenForYou: () => null }));

const { useQuiz, useQuizRead } = await import("../src/web/useQuiz.js");
const { QuizPanel } = await import("../src/web/QuizPanel.js");

const SLUG = "a-piece";
/* Real ids — `ID_PATTERN` has no `1`, `i`, `l` or `o` (tests/quiz-panel.test.tsx). */
const UNREAD = "spya-k3m9qt" as BlockId;
const READ = "spya-p7w2dn" as BlockId;
const BLOCKS = new Map<string, string>([
  [UNREAD, "The first paragraph."],
  [READ, "The second paragraph."],
]);
const Q1 = "spya-qm9qt2";
const Q2 = "spya-qm9qt3";
const Q3 = "spya-qm9qt4";

function question(id: string, n: number, blockId: BlockId, premise?: string): QuizQuestion {
  return {
    id,
    question: `Question number ${n}?`,
    referenceAnswer: `The reference answer to ${n}.`,
    evidence: [{ blockId, quote: "The", start: 0 }],
    ...(premise ? { premise } : {}),
  };
}

function batch(batchId: string): Quiz {
  return {
    version: "quiz/5",
    generator: "a-model",
    slug: SLUG,
    batchId,
    sourceHash: "hash",
    questions: [
      question(Q1, 1, UNREAD),
      question(Q2, 2, READ, "The premise that restates the answer to one."),
      question(Q3, 3, READ),
    ],
    dropped: { unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 },
    generatedAt: "2026-10-05T10:00:00.000Z",
    elapsedMs: 1,
  };
}

/** The posed server. Reset before every case. */
const server = {
  batchId: "spya-batch2",
  /** What `GET` answers under `attempts`: the rows it holds, or `null` for a read that failed. */
  attempts: [] as QuizKeptAnswer[] | null,
  /** A read that started before any save: `GET` goes on answering `[]`. */
  answersNothingKept: false,
  /** The network is gone: every request throws as `fetch` does. */
  offline: false,
  /** The next quiz `GET` waits on this instead of answering at once. */
  nextRead: null as Promise<Response> | null,
  /** What the next mark does. */
  mark: "saves" as "saves" | "cannot-save" | "fails",
  verdict: undefined as "right" | "wrong" | undefined,
  quizReads: 0,
  clock: Date.parse("2026-10-05T12:00:00.000Z"),
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function quizResponse(): Response {
  return json({
    quiz: batch(server.batchId),
    stale: false,
    outdated: false,
    profileChanged: false,
    attempts: server.answersNothingKept ? [] : server.attempts,
  } satisfies QuizResponse);
}

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function markResponse(body: { questionId: string; answer: string }): Response {
  const reply = `A mark of “${body.answer}”.`;
  const frames: Uint8Array[] = [frame("delta", { text: reply })];
  if (server.mark === "fails") {
    frames.push(frame("error", { error: "The model stopped talking.", text: reply }));
  } else if (server.mark === "cannot-save") {
    frames.push(frame("done", { reply, model: "m", kept: false, ...(server.verdict ? { verdict: server.verdict } : {}) }));
  } else {
    server.clock += 1000;
    const answeredAt = new Date(server.clock).toISOString();
    /* Kept, as the route keeps it: before the `done` frame goes. */
    if (server.attempts) {
      server.attempts = [
        ...server.attempts.filter((a) => a.questionId !== body.questionId),
        { questionId: body.questionId, answer: body.answer, reply, answeredAt },
      ];
    }
    frames.push(frame("done", { reply, model: "m", answeredAt, ...(server.verdict ? { verdict: server.verdict } : {}) }));
  }
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(f);
        c.close();
      },
    }),
    { status: 200 },
  );
}

function stubFetch(): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (server.offline) throw new TypeError("Failed to fetch");
    const url = String(input);
    if (url === `/api/quiz/${SLUG}` && (!init?.method || init.method === "GET")) {
      server.quizReads++;
      const waiting = server.nextRead;
      server.nextRead = null;
      return waiting ?? quizResponse();
    }
    if (url === `/api/quiz/${SLUG}/mark` && init?.method === "POST") {
      return markResponse(JSON.parse(String(init.body)) as { questionId: string; answer: string });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  });
}

let owner: UseQuiz;
let showBand = true;
let strict = false;
let arrival: QuizArrival | null = null;
let readSoFar: ReadSoFar | undefined;

function Probe() {
  const read = useQuizRead(SLUG);
  return showBand ? createElement(Band, { read }) : null;
}
function Band({ read }: { read: QuizRead }) {
  owner = useQuiz(SLUG, read);
  const [, arrivalTaken] = useState(0);
  return createElement(QuizPanel, {
    owner,
    blocks: BLOCKS,
    onJump: () => {},
    arrival,
    onArrivalTaken: () => {
      arrival = null;
      /* Reader clears the arrival through state, so the next panel render
         must receive null even when only the panel's own effects wrote state. */
      arrivalTaken((n) => n + 1);
    },
    readSoFar,
  });
}

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function paint(): Promise<void> {
  await act(async () => {
    root.render(strict ? createElement(StrictMode, null, createElement(Probe)) : createElement(Probe));
  });
  await settle();
}
/** A reload: every hook's state gone, the server and the offline copies as they were. */
async function reload(): Promise<void> {
  act(() => root.unmount());
  root = createRoot(host);
  await paint();
}

const box = () => host.querySelector("textarea");
const mark = () => host.querySelector(".quiz-reply")?.textContent ?? null;
const heading = () => host.querySelector(".gloss-count")?.textContent ?? "";
const asked = () => host.querySelector(".quiz-question")?.textContent ?? null;
const premise = () => host.querySelector(".quiz-premise")?.textContent ?? null;

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? (b.textContent ?? "").trim()) === label,
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found as HTMLButtonElement;
}
async function press(label: string): Promise<void> {
  const b = button(label);
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}
function type(text: string): void {
  const el = box();
  if (!el) throw new Error("no answer box");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function answer(text: string): Promise<void> {
  type(text);
  await press("Answer");
}

const NOT_SAVED = "This answer could not be saved, so it will not be here when you come back.";
const NOT_LOADED = "Your earlier answers could not be loaded.";

beforeEach(() => {
  held.clear();
  Object.assign(server, {
    batchId: "spya-batch2",
    attempts: [],
    answersNothingKept: false,
    offline: false,
    nextRead: null,
    mark: "saves",
    verdict: undefined,
    quizReads: 0,
    clock: Date.parse("2026-10-05T12:00:00.000Z"),
  });
  showBand = true;
  strict = false;
  arrival = null;
  readSoFar = undefined;
  stubFetch();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const kept = (questionId: string, text: string, answeredAt = "2026-10-04T09:00:00.000Z"): QuizKeptAnswer => ({
  questionId,
  answer: text,
  reply: `A mark of “${text}”.`,
  answeredAt,
});

describe("an answer is still there when you come back", () => {
  it("after Next and then Previous", async () => {
    /* The server goes on saying it holds nothing, so what puts the answer back
       is this visit's own record of the finished mark. */
    server.answersNothingKept = true;
    await paint();
    await answer("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");

    await press("Next question");
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
    expect(mark()).toBeNull();

    await press("Previous question");
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");
    expect(heading()).toContain("— answered");
  });

  it("after leaving Quiz for another mode and coming back", async () => {
    server.answersNothingKept = true;
    await paint();
    await answer("My answer to one.");

    showBand = false;
    await paint();
    expect(box()).toBeNull();
    showBand = true;
    await paint();
    /* It opens at two, the first not answered; one is a step back. */
    await press("Previous question");

    expect(box()?.value).toBe("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");
    expect(heading()).toContain("— answered");
  });

  it("after a reload, from the server", async () => {
    server.attempts = [kept(Q2, "What I said to two."), kept(Q1, "What I said to one.")];
    await paint();
    expect([...owner.answered].sort()).toEqual([Q1, Q2]);
    /* Where it opens is the last describe in this file; here, the answers. */
    await press("Previous question");
    await press("Previous question");

    expect(heading()).toContain("Question 1 of 3");
    expect(box()?.value).toBe("What I said to one.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
    expect(heading()).toContain("— answered");

    await press("Next question");
    expect(box()?.value).toBe("What I said to two.");
    await press("Next question");
    expect(box()?.value).toBe("");
    expect(mark()).toBeNull();
    expect(heading()).not.toContain("— answered");
  });

  it("after a reload with no network, because a saved mark refreshes the offline copy (F1)", async () => {
    await paint();
    const before = server.quizReads;
    await answer("My answer to one.");
    /* The re-read that puts the answer into the copy a dead network serves. */
    expect(server.quizReads).toBe(before + 1);

    server.offline = true;
    await reload();
    /* The offline copy knows one is answered, so the walk opens at two. */
    expect(asked()).toBe("Question number 2?");
    await press("Previous question");
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");
  });

  it("keeps the offline answers when a later same-batch read cannot load attempts", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    server.attempts = null;
    await act(async () => owner.refresh());
    await settle();
    await press("Previous question");
    expect(box()?.value).toBe("What I said to one.");

    server.offline = true;
    await reload();
    await press("Previous question");
    expect(box()?.value).toBe("What I said to one.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
  });

  it("never carries cached answers into a different batch whose attempts cannot be read", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    server.batchId = "spya-batch3";
    server.attempts = null;
    await act(async () => owner.refresh());
    await settle();

    server.offline = true;
    await reload();
    expect(owner.quiz?.batchId).toBe("spya-batch3");
    expect(box()?.value).toBe("");
    expect(owner.answered.size).toBe(0);
    expect(host.textContent).toContain(NOT_LOADED);
  });

  it("and a mark that failed neither re-reads nor costs the offline copy its questions (F1)", async () => {
    await paint();
    const before = server.quizReads;
    server.mark = "fails";
    await answer("My answer to one.");
    expect(server.quizReads).toBe(before);
    expect(heading()).not.toContain("— answered");

    server.offline = true;
    await reload();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("");
  });

  it("and a mark that fails further along leaves the reader on that question, with their words", async () => {
    /* The browser check saw the panel back on question 1 twice after a failed
       mark, while a reviewer was editing the tree under its dev server. This
       is the control that says the panel does not do that by itself. */
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two.")];
    await paint();
    expect(asked()).toBe("Question number 3?");

    server.mark = "fails";
    await answer("My answer to three.");
    expect(asked()).toBe("Question number 3?");
    expect(box()?.value).toBe("My answer to three.");
    expect(heading()).not.toContain("— answered");
  });
});

describe("what a restored answer must not do", () => {
  it("says the mark is about your previous answer once the box is edited", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    await press("Previous question");
    type("Something else entirely.");
    expect(host.textContent).toContain("This mark is about your previous answer");
    expect(heading()).not.toContain("— answered");
    /* And put back, it is a current mark again. */
    type("What I said to one.");
    expect(host.textContent).not.toContain("This mark is about your previous answer");
    expect(heading()).toContain("— answered");
  });

  it("restores nothing into a new batch", async () => {
    await paint();
    await answer("My answer to one.");
    expect(heading()).toContain("— answered");

    /* *Write them again*: the same question ids under a new batch id, and the
       old batch's row still on the server, where it is not this batch's. */
    server.batchId = "spya-batch3";
    server.attempts = [];
    await act(async () => owner.refresh());
    await settle();

    expect(owner.quiz?.batchId).toBe("spya-batch3");
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("");
    expect(mark()).toBeNull();
    expect(heading()).not.toContain("— answered");
    expect(owner.answered.size).toBe(0);
  });

  it("fills an empty box when kept answers arrive late, and never a draft (F3)", async () => {
    await paint();
    expect(box()?.value).toBe("");
    /* Answered on another device, and this tab reads again. */
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two.")];
    await act(async () => owner.refresh());
    await settle();
    expect(box()?.value).toBe("What I said to one.");

    await press("Next question");
    type("A draft I am half way through.");
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "A later answer to two.", "2026-10-04T10:00:00.000Z")];
    await act(async () => owner.refresh());
    await settle();
    expect(box()?.value).toBe("A draft I am half way through.");
    expect(mark()).toBe("A mark of “What I said to two.”.");
  });

  it("does not un-learn a verdict earned this visit (F4)", async () => {
    server.answersNothingKept = true;
    server.verdict = "right";
    await paint();
    await answer("My answer to one.");
    await press("Next question");
    /* Judged right and arrived by Next: the premise is not shown. */
    expect(asked()).toBe("Question number 2?");
    expect(premise()).toBeNull();

    /* Back to one — restored, with no verdict on the restored attempt — and on
       again. The restore is not a new mark, so two still has no premise. */
    await press("Previous question");
    expect(box()?.value).toBe("My answer to one.");
    await press("Next question");
    expect(premise()).toBeNull();

    /* The control: a genuinely new mark with no verdict does clear it. */
    await press("Previous question");
    server.verdict = undefined;
    await answer("A second answer to one.");
    await press("Next question");
    expect(premise()).toBe("The premise that restates the answer to one.");
  });
});

describe("a read and a save that cross (F2)", () => {
  it("keeps a just-saved answer when a read that started before the save lands after it", async () => {
    await paint();
    /* A revalidation goes out and hangs… */
    let land!: (res: Response) => void;
    server.nextRead = new Promise((resolve) => {
      land = resolve;
    });
    const early = owner.refresh();
    /* …the answer is marked and saved while it is out… */
    await answer("My answer to one.");
    /* …and it lands afterwards, saying what was true when it was asked. */
    const before = json({
      quiz: batch(server.batchId), stale: false, outdated: false, profileChanged: false, attempts: [],
    } satisfies QuizResponse);
    server.answersNothingKept = true;
    await act(async () => {
      land(before);
      await early;
    });
    await settle();

    expect(box()?.value).toBe("My answer to one.");
    expect(heading()).toContain("— answered");
    await press("Next question");
    await press("Previous question");
    expect(box()?.value).toBe("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");
  });
});

describe("kept answers that could not be read are not “none” (F5)", () => {
  it("says so on an opening read, and Try again brings them", async () => {
    const real = [kept(Q1, "What I said to one.")];
    server.attempts = null;
    await paint();
    expect(asked()).toBe("Question number 1?");
    expect(host.textContent).toContain(NOT_LOADED);
    expect(box()?.value).toBe("");

    server.attempts = real;
    const line = [...host.querySelectorAll("p")].find((p) => p.textContent?.includes(NOT_LOADED));
    const retry = line?.querySelector("button");
    expect(retry, "the line carries the way to ask again").toBeTruthy();
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.textContent).not.toContain(NOT_LOADED);
    expect(box()?.value).toBe("What I said to one.");
  });

  it("keeps what it had for the same batch when a later read cannot say", async () => {
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two.")];
    await paint();
    server.attempts = null;
    await act(async () => owner.refresh());
    await settle();

    expect(host.textContent).not.toContain(NOT_LOADED);
    await press("Previous question");
    expect(heading()).toContain("— answered");
    expect(box()?.value).toBe("What I said to two.");
  });

  it("but never keeps another batch's", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    server.batchId = "spya-batch3";
    server.attempts = null;
    await act(async () => owner.refresh());
    await settle();

    expect(owner.quiz?.batchId).toBe("spya-batch3");
    expect(box()?.value).toBe("");
    expect(owner.answered.size).toBe(0);
    expect(host.textContent).toContain(NOT_LOADED);
  });
});

describe("a mark that finished and could not be saved (F7)", () => {
  it("says so, and is still there after Next and Previous", async () => {
    await paint();
    server.mark = "cannot-save";
    await answer("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");
    expect(host.textContent).toContain(NOT_SAVED);

    await press("Next question");
    expect(host.textContent).not.toContain(NOT_SAVED);
    await press("Previous question");
    expect(box()?.value).toBe("My answer to one.");
    expect(mark()).toBe("A mark of “My answer to one.”.");
    expect(host.textContent).toContain(NOT_SAVED);
  });

  it("is shown in place of an older saved answer, whatever this machine's clock says", async () => {
    /* The saved one is stamped by the server, far ahead of this clock. */
    server.attempts = [kept(Q1, "An older, saved answer.", "2099-01-01T00:00:00.000Z")];
    await paint();
    await press("Previous question");
    expect(box()?.value).toBe("An older, saved answer.");
    expect(host.textContent).not.toContain(NOT_SAVED);

    server.mark = "cannot-save";
    await answer("A newer answer that could not be saved.");
    await press("Next question");
    await press("Previous question");
    expect(box()?.value).toBe("A newer answer that could not be saved.");
    expect(host.textContent).toContain(NOT_SAVED);
  });
});

describe("the box is filled once the question on screen has settled (F3)", () => {
  it("restores the arrival's question when the band mounts over an already loaded batch", async () => {
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two.")];
    showBand = false;
    await paint();
    arrival = { batchId: server.batchId, questionId: Q2 };
    showBand = true;
    await paint();

    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("What I said to two.");
    expect(mark()).toBe("A mark of “What I said to two.”.");
    expect(owner.attempt?.questionId).toBe(Q2);
  });

  it("leaves an unanswered arrival empty, even when the opening question has a kept answer", async () => {
    strict = true;
    server.attempts = [kept(Q1, "What I said to one.")];
    showBand = false;
    await paint();
    arrival = { batchId: server.batchId, questionId: Q2 };
    showBand = true;
    await paint();

    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
    expect(mark()).toBeNull();
    expect(owner.attempt).toBeNull();
  });

  it.each([
    { batchId: "spya-anoldbatch", questionId: Q2 },
    { batchId: "spya-batch2", questionId: "spya-qm9qt5" },
  ])("still restores question one for an ignored arrival %j", async (ignored) => {
    /* Every one answered, so the walk opens at one. */
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two."), kept(Q3, "What I said to three.")];
    showBand = false;
    await paint();
    arrival = ignored;
    showBand = true;
    await paint();

    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("What I said to one.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
  });

  const reading = (): ReadSoFar => ({
    /* One is about a passage not read yet; two and three are read. */
    levels: new Map([[READ, 3]]) as ReadSoFar["levels"],
    status: "loaded",
    bodyWords: new Map([[UNREAD, 3], [READ, 3]]),
  });

  it("with the batch, the filter and an arrival all in one commit", async () => {
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two.")];
    /* The opening read lands first, with no band, so the band then mounts with
       the batch, the filter (which moves off the unread question one, to two)
       and the arrival (which asks for one by name) in a single commit. */
    showBand = false;
    await paint();
    readSoFar = reading();
    arrival = { batchId: server.batchId, questionId: Q1 };
    showBand = true;
    await paint();

    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("What I said to one.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
  });

  it("under the filter alone, with the answer of the question it lands on", async () => {
    /* Every one answered, so it opens at the first it may land on: two. */
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two."), kept(Q3, "What I said to three.")];
    readSoFar = reading();
    await paint();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("What I said to two.");
  });

  it("leaves a draft alone when the arrival is for the question already open", async () => {
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two."), kept(Q3, "What I said to three.")];
    await paint();
    type("A draft over my old answer.");
    arrival = { batchId: server.batchId, questionId: Q1 };
    await paint();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("A draft over my old answer.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
  });

  it("the same in StrictMode, where every effect runs twice", async () => {
    strict = true;
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two."), kept(Q3, "What I said to three.")];
    await paint();
    expect(box()?.value).toBe("What I said to one.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
    await press("Next question");
    expect(box()?.value).toBe("What I said to two.");
    await press("Previous question");
    expect(box()?.value).toBe("What I said to one.");
  });
});

/**
 * Greg, 2026-10-05, answering the plan's Q-quiz-resume: *"yes, first unanswered
 * question"*. The decision is taken once for a batch, before any question is
 * drawn, and nothing after it moves the reader.
 */
describe("coming back opens at the first question not yet answered", () => {
  const reading = (status: ReadSoFar["status"] = "loaded"): ReadSoFar => ({
    /* One is about a passage not read yet; two and three are read. */
    levels: (status === "loaded" ? new Map([[READ, 3]]) : new Map()) as ReadSoFar["levels"],
    status,
    bodyWords: new Map([[UNREAD, 3], [READ, 3]]),
  });

  it("after a reload, and Previous walks back to the answers", async () => {
    server.attempts = [kept(Q2, "What I said to two."), kept(Q1, "What I said to one.")];
    await paint();

    expect(asked()).toBe("Question number 3?");
    expect(heading()).toContain("Question 3 of 3");
    expect(heading()).not.toContain("— answered");
    expect(box()?.value).toBe("");
    expect(mark()).toBeNull();
    expect(owner.attempt).toBeNull();

    await press("Previous question");
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("What I said to two.");
    expect(mark()).toBe("A mark of “What I said to two.”.");
    await press("Previous question");
    expect(box()?.value).toBe("What I said to one.");
  });

  it("the first gap, not the question after the last answer", async () => {
    server.attempts = [kept(Q1, "What I said to one."), kept(Q3, "What I said to three.")];
    await paint();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
  });

  it("after leaving Quiz for another mode and coming back", async () => {
    server.answersNothingKept = true;
    await paint();
    await answer("My answer to one.");
    /* Answering does not move the reader: Next is theirs to press. */
    expect(asked()).toBe("Question number 1?");

    showBand = false;
    await paint();
    showBand = true;
    await paint();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
    expect(mark()).toBeNull();
  });

  it("at question one when every question is answered", async () => {
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two."), kept(Q3, "What I said to three.")];
    await paint();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("What I said to one.");
    expect(mark()).toBe("A mark of “What I said to one.”.");
  });

  it("does not move a reader already on a question when answers arrive late", async () => {
    await paint();
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "What I said to two.")];
    await act(async () => owner.refresh());
    await settle();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("What I said to one.");
  });

  it("gives way to a question asked for by name, whichever effect sees it first", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    showBand = false;
    await paint();
    /* Asked for while the reading levels are still loading: the arrival turns
       the tick-box off and lands, and the walk then stops waiting — which must
       not be taken for a fresh opening. */
    readSoFar = reading("loading");
    arrival = { batchId: server.batchId, questionId: Q3 };
    showBand = true;
    await paint();
    expect(asked()).toBe("Question number 3?");
    readSoFar = reading();
    await paint();
    expect(asked()).toBe("Question number 3?");
  });

  it("but not to an arrival that names another batch", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    showBand = false;
    await paint();
    arrival = { batchId: "spya-anoldbatch", questionId: Q3 };
    showBand = true;
    await paint();
    expect(asked()).toBe("Question number 2?");
  });

  it.each([false, true])("honours an arrival received after it started waiting for reading levels (StrictMode %s)", async (doubleEffects) => {
    strict = doubleEffects;
    server.attempts = [kept(Q1, "What I said to one.")];
    readSoFar = reading("loading");
    await paint();
    expect(asked()).toBeNull();

    arrival = { batchId: server.batchId, questionId: Q3 };
    await paint();
    expect(arrival).toBeNull();
    expect(asked()).toBe("Question number 3?");
    expect(box()?.value).toBe("");
    expect(owner.attempt).toBeNull();
    readSoFar = reading();
    await paint();
    expect(asked()).toBe("Question number 3?");
  });

  it("opens afresh when a 404 is followed by the same batch returning", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    expect(asked()).toBe("Question number 2?");
    type("A draft before the quiz went away.");

    server.nextRead = Promise.resolve(new Response(null, { status: 404 }));
    await act(async () => owner.refresh());
    await settle();
    expect(owner.quiz).toBeNull();
    expect(box()).toBeNull();
    await act(async () => owner.refresh());
    await settle();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
    expect(owner.attempt).toBeNull();
    await press("Previous question");
    expect(box()?.value).toBe("What I said to one.");
  });

  it("preserves a same-question arrival's draft when reading levels hide that question in the same commit", async () => {
    readSoFar = reading("failed");
    await paint();
    expect(asked()).toBe("Question number 1?");
    type("My draft on one.");
    arrival = { batchId: server.batchId, questionId: Q1 };
    readSoFar = reading();
    await paint();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("My draft on one.");
    expect(host.querySelector<HTMLInputElement>(".quiz-only-read input")?.checked).toBe(false);
  });

  it("counts only questions the reading filter lets the reader land on", async () => {
    /* One is unread and unanswered, two is answered: three is where to go on. */
    server.attempts = [kept(Q2, "What I said to two.")];
    readSoFar = reading();
    await paint();
    expect(asked()).toBe("Question number 3?");
    expect(heading()).toContain("Question 2 of 2");
    expect(box()?.value).toBe("");
  });

  it("waits for the reading levels before it chooses", async () => {
    server.attempts = [kept(Q2, "What I said to two.")];
    readSoFar = reading("loading");
    await paint();
    expect(asked()).toBeNull();
    readSoFar = reading();
    await paint();
    expect(asked()).toBe("Question number 3?");
  });

  it("stays usable with no landable questions, then follows the reader's filter press", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    readSoFar = { ...reading(), levels: new Map() };
    await paint();
    expect(asked()).toBeNull();
    expect(box()).toBeNull();
    expect(host.textContent).toContain("None of these questions is about a passage you have read yet.");
    await act(async () => host.querySelector<HTMLInputElement>(".quiz-only-read input")?.click());
    await settle();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("What I said to one.");
    await press("Next question");
    type("My draft on two.");
    server.attempts = [kept(Q1, "What I said to one."), kept(Q2, "An answer from another tab.")];
    await act(async () => owner.refresh());
    await settle();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("My draft on two.");
    expect(owner.attempt).toBeNull();
  });

  it("opens a replacement batch at its first landable question without carrying the old draft", async () => {
    readSoFar = reading();
    server.attempts = [kept(Q2, "What I said to two.")];
    await paint();
    expect(asked()).toBe("Question number 3?");
    type("My draft on the old batch.");
    server.batchId = "spya-batch3";
    server.attempts = [];
    await act(async () => owner.refresh());
    await settle();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
    expect(owner.attempt).toBeNull();
  });

  it("the same in StrictMode", async () => {
    strict = true;
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    expect(asked()).toBe("Question number 2?");
    expect(box()?.value).toBe("");
    expect(owner.attempt).toBeNull();
    await press("Previous question");
    expect(box()?.value).toBe("What I said to one.");
  });

  it("and a new batch opens at its own first question", async () => {
    server.attempts = [kept(Q1, "What I said to one.")];
    await paint();
    expect(asked()).toBe("Question number 2?");
    server.batchId = "spya-batch3";
    server.attempts = [];
    await act(async () => owner.refresh());
    await settle();
    expect(asked()).toBe("Question number 1?");
    expect(box()?.value).toBe("");
  });
});
