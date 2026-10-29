// @vitest-environment jsdom
/**
 * **A Quiz question in the margin is answered there** — plan 261029i.
 *
 * > Yes, let's try and avoid having to jump away from marginalia mode to the
 * > learn mode, because that'll take us out the flow. … some kind of nice
 * > feedback, visual feedback actually … turning it a subtle green
 * >
 * > — Greg, 2026-10-29 (spya-jzgrua)
 *
 * The real `useQuizRead`, `useQuizMark`, `QuizNote` and `apiFetch`, over the
 * posed server tests/quiz-kept-answers.test.tsx uses; and, for the one case
 * that needs it, the band beside the margin, as a reader with both open has
 * them. The one-press microphone needs a real microphone and is checked in a
 * browser (the plan's § Browser check); here dictation is unsupported, as in
 * jsdom it is.
 */
import { act, createElement, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Quiz, QuizKeptAnswer, QuizQuestion, QuizResponse } from "../src/types.js";
import type { MarginQuiz } from "../src/web/marginalia/MarginQuiz.js";
import type { QuizRead } from "../src/web/useQuiz.js";

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
vi.mock("../src/web/lib/offline-store.js", () => ({
  readCached: async () => undefined,
  writeCached: async () => {},
  reserveTicket: async (url: string, userId: string | null) => (userId ? { userId, url, epoch: 0, seq: 1 } : null),
  invalidate: async () => {},
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
  DictationButton: () => null, DictationStrip: () => null, TalkLabel: () => null,
}));
vi.mock("../src/web/WrittenForYou.js", () => ({ WrittenForYou: () => null }));

const { useQuiz, useQuizRead } = await import("../src/web/useQuiz.js");
const { QuizPanel } = await import("../src/web/QuizPanel.js");
const { QuizNote, MarginQuizContext } = await import("../src/web/marginalia/MarginQuiz.js");

const SLUG = "a-piece";
const BLOCK = "spya-k3m9qt" as BlockId;
const BLOCKS = new Map<string, string>([[BLOCK, "The first passage."]]);
const Q1 = "spya-qm9qt2";
const Q2 = "spya-qm9qt3";

function question(id: string, n: number): QuizQuestion {
  return { id, question: `Question number ${n}?`, referenceAnswer: `Reference ${n}.`, evidence: [{ blockId: BLOCK, quote: "The", start: 0 }] };
}
function batch(batchId: string): Quiz {
  return {
    version: "quiz/5",
    generator: "a-model",
    slug: SLUG,
    batchId,
    sourceHash: "hash",
    questions: [question(Q1, 1), question(Q2, 2)],
    dropped: { unknownIds: 0, unquoted: 0, truncated: 0, overCap: 0, malformed: 0, duplicate: 0, unanchored: 0 },
    generatedAt: "2026-10-29T10:00:00.000Z",
    elapsedMs: 1,
  };
}

const server = {
  batchId: "spya-batch1",
  attempts: [] as QuizKeptAnswer[],
  verdict: undefined as "right" | "wrong" | undefined,
  marks: [] as { batchId: string; questionId: string; answer: string }[],
  /** Hold every mark's stream open until released, to have two in flight at once. */
  hold: false,
  release: [] as (() => void)[],
  clock: Date.parse("2026-10-29T12:00:00.000Z"),
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const enc = new TextEncoder();
const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function markResponse(body: { batchId: string; questionId: string; answer: string }): Response {
  server.marks.push(body);
  const reply = `A mark of “${body.answer}”.`;
  server.clock += 1000;
  const answeredAt = new Date(server.clock).toISOString();
  const attemptId = `00000000-0000-4000-8000-${String(server.clock).padStart(12, "0")}`;
  server.attempts = [
    ...server.attempts.filter((a) => a.questionId !== body.questionId),
    { questionId: body.questionId, attemptId, answer: body.answer, reply, answeredAt },
  ];
  const finish = (c: ReadableStreamDefaultController<Uint8Array>) => {
    c.enqueue(frame("done", { reply, model: "m", answeredAt, attemptId, ...(server.verdict ? { verdict: server.verdict } : {}) }));
    c.close();
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("delta", { text: reply }));
        if (server.hold) server.release.push(() => finish(c));
        else finish(c);
      },
    }),
    { status: 200 },
  );
}

function stubFetch(): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/quiz/${SLUG}` && (!init?.method || init.method === "GET")) {
      return json({ quiz: batch(server.batchId), stale: false, outdated: false, profileChanged: false, attempts: server.attempts } satisfies QuizResponse);
    }
    if (url === `/api/quiz/${SLUG}/mark` && init?.method === "POST") {
      return markResponse(JSON.parse(String(init.body)) as { batchId: string; questionId: string; answer: string });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  });
}

const opened: [string, string][] = [];
let withBand = false;

function Margin({ read }: { read: QuizRead }) {
  const { quiz, kept, noteMark, refresh, claimMark } = read;
  const ctx = useMemo<MarginQuiz | null>(
    () =>
      quiz
        ? { slug: SLUG, quiz, stale: false, kept, noteMark, refresh, claimMark, blocks: BLOCKS, onJump: () => {} }
        : null,
    [quiz, kept, noteMark, refresh, claimMark],
  );
  if (!quiz) return null;
  return createElement(
    MarginQuizContext.Provider,
    { value: ctx },
    createElement(
      "div",
      { className: "margin" },
      createElement(QuizNote, { batchId: quiz.batchId, questions: quiz.questions, onOpen: (b: string, q: string) => opened.push([b, q]) }),
    ),
  );
}
function Band({ read }: { read: QuizRead }) {
  const owner = useQuiz(SLUG, read);
  return createElement("div", { className: "band" }, createElement(QuizPanel, { owner, blocks: BLOCKS, onJump: () => {} }));
}
function Probe() {
  const read = useQuizRead(SLUG);
  return createElement("div", null, createElement(Margin, { read }), withBand ? createElement(Band, { read }) : null);
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
  await act(async () => root.render(createElement(Probe)));
  await settle();
}
const margin = () => host.querySelector(".margin") as HTMLElement;
const item = (n: number) => margin().querySelectorAll<HTMLElement>(".marg-quiz-item")[n - 1]!;
const line = (n: number) => item(n).querySelector<HTMLButtonElement>("button.marg-quiz-q")!;
const box = () => margin().querySelector<HTMLTextAreaElement>("textarea.marg-quiz-box");
const reply = () => margin().querySelector(".quiz-reply")?.textContent ?? null;

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}
function type(el: HTMLTextAreaElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function answerButton(scope: Element): HTMLButtonElement {
  const b = [...scope.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Answer");
  if (!b) throw new Error("no Answer button");
  return b as HTMLButtonElement;
}

beforeEach(() => {
  Object.assign(server, { batchId: "spya-batch1", attempts: [], verdict: undefined, marks: [], hold: false, release: [], clock: Date.parse("2026-10-29T12:00:00.000Z") });
  opened.length = 0;
  withBand = false;
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

describe("a Quiz question in the margin", () => {
  it("opens an answer box under itself, rather than jumping to Learn", async () => {
    await paint();
    expect(box()).toBeNull();
    await click(line(1));
    expect(opened).toEqual([]);
    expect(box()).not.toBeNull();
    expect(line(1).getAttribute("aria-expanded")).toBe("true");
    expect(box()?.closest(".marg-quiz-item")).toBe(item(1));
    /* Pressed again, it closes. */
    await click(line(1));
    expect(box()).toBeNull();
  });

  it("puts the focus in the box when it opens, and Escape hands it back to the question", async () => {
    await paint();
    await click(line(1));
    expect(document.activeElement, "opened with Enter, typing went nowhere").toBe(box());
    await act(async () => {
      box()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(box()).toBeNull();
    expect(document.activeElement).toBe(line(1));
  });

  it("keeps the old press one line down: Open in Quiz", async () => {
    await paint();
    await click(line(2));
    const more = [...margin().querySelectorAll("button")].find((b) => b.textContent === "Open in Quiz")!;
    await click(more);
    expect(opened).toEqual([["spya-batch1", Q2]]);
  });

  it("marks an answer there, and the line turns green", async () => {
    await paint();
    expect(item(1).classList.contains("quiz-answered")).toBe(false);
    await click(line(1));
    type(box()!, "My answer to one.");
    await click(answerButton(margin()));
    expect(server.marks).toEqual([{ batchId: "spya-batch1", questionId: Q1, answer: "My answer to one." }]);
    expect(reply()).toBe("A mark of “My answer to one.”.");
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
    expect(item(2).classList.contains("quiz-answered")).toBe(false);
  });

  it("is green for any finished answer, right or wrong: green says answered, not how", async () => {
    server.verdict = "wrong";
    await paint();
    await click(line(1));
    type(box()!, "Something mistaken.");
    await click(answerButton(margin()));
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
    expect(margin().textContent).not.toMatch(/\b(right|wrong|correct|incorrect)\b/i);
  });

  it("is green, ticked and put back when it was answered on an earlier visit", async () => {
    server.attempts = [
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Kept words.", reply: "A mark of “Kept words.”.", answeredAt: "2026-10-28T09:00:00.000Z" },
    ];
    await paint();
    expect(item(2).classList.contains("quiz-answered")).toBe(true);
    expect(item(2).querySelector(".marg-quiz-tick")).not.toBeNull();
    expect(item(1).querySelector(".marg-quiz-tick")).toBeNull();
    await click(line(2));
    expect(box()?.value).toBe("Kept words.");
    expect(reply()).toBe("A mark of “Kept words.”.");
    expect(server.marks).toEqual([]);
  });

  it("takes the box and the draft away when another question is opened", async () => {
    await paint();
    await click(line(1));
    type(box()!, "Half a thought");
    await click(line(2));
    expect(margin().querySelectorAll("textarea")).toHaveLength(1);
    expect(box()?.closest(".marg-quiz-item")).toBe(item(2));
    expect(box()?.value).toBe("");
  });

  it("turns the band's question the same green, and not while its box holds an answer nobody has marked", async () => {
    withBand = true;
    await paint();
    const band = host.querySelector(".band")!;
    const asked = () => band.querySelector(".quiz-question")!;
    expect(asked().classList.contains("quiz-answered")).toBe(false);
    type(band.querySelector<HTMLTextAreaElement>("textarea")!, "From the band.");
    await click(answerButton(band));
    expect(asked().classList.contains("quiz-answered")).toBe(true);
    /* The margin hears it through the shared read. */
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
    type(band.querySelector<HTMLTextAreaElement>("textarea")!, "A different answer.");
    expect(asked().classList.contains("quiz-answered")).toBe(false);
  });

  it("will not mark a question the band is already marking, and says so", async () => {
    withBand = true;
    server.hold = true;
    await paint();
    const band = host.querySelector(".band")!;
    const bandBox = band.querySelector<HTMLTextAreaElement>("textarea")!;
    type(bandBox, "From the band.");
    await click(answerButton(band));
    expect(server.marks).toHaveLength(1);

    await click(line(1));
    type(box()!, "From the margin.");
    await click(answerButton(margin()));
    expect(server.marks, "the same question was bought twice").toHaveLength(1);
    expect(margin().textContent).toContain("already being marked elsewhere on the page");

    await act(async () => {
      for (const go of server.release) go();
    });
    await settle();
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
  });
});
