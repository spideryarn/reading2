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
let dictationBusy = false;
let dictationSupported = false;
/** The field the last render asked for, and every `toggle` with the box it was bound to then. */
let lastField: { keep?: { box: string }; onChange(text: string): void } | null = null;
const toggled: { box: string; onChange(text: string): void }[] = [];
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (opts: { keep?: { box: string }; onChange(text: string): void }) => {
    lastField = opts;
    return {
      dictation: { supported: dictationSupported },
      readOnly: dictationBusy,
      busy: dictationBusy,
      /* Read at the press, as the real one binds the keeper's box at the
         press (useDictation.ts § `elsewhere`). */
      toggle: () => {
        if (lastField) toggled.push({ box: lastField.keep?.box ?? "", onChange: lastField.onChange });
      },
    };
  },
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
  /* Real time, not a fixed date: the looks are judged against `Date.now()`, and
     a fixed date would turn every answer here "due" three days after it was
     written (plan 261029m). */
  clock: Date.now(),
};
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
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
let latestRead: QuizRead | null = null;

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
  latestRead = read;
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
function showEarlier(scope: Element): HTMLButtonElement {
  const b = [...scope.querySelectorAll("button")].find((x) => x.textContent === "Show my earlier answer");
  if (!b) throw new Error("no Show my earlier answer");
  return b as HTMLButtonElement;
}
function answerButton(scope: Element): HTMLButtonElement {
  const b = [...scope.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Answer");
  if (!b) throw new Error("no Answer button");
  return b as HTMLButtonElement;
}
function visibleText(scope: Element): string {
  const visible = scope.cloneNode(true) as Element;
  visible.querySelectorAll(".sr-only").forEach((node) => {
    node.remove();
  });
  return visible.textContent ?? "";
}

beforeEach(() => {
  Object.assign(server, { batchId: "spya-batch1", attempts: [], verdict: undefined, marks: [], hold: false, release: [], clock: Date.now() });
  opened.length = 0;
  withBand = false;
  dictationBusy = false;
  dictationSupported = false;
  lastField = null;
  toggled.length = 0;
  latestRead = null;
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
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Kept words.", reply: "A mark of “Kept words.”.", answeredAt: daysAgo(1) },
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

  it("does not close or switch the box while its dictation is still arriving", async () => {
    await paint();
    await click(line(1));
    dictationBusy = true;
    await paint();
    await click(line(2));
    expect(box()?.closest(".marg-quiz-item")).toBe(item(1));
    await click(line(1));
    expect(box()?.closest(".marg-quiz-item")).toBe(item(1));
  });

  it("does not restore a late kept answer underneath a dictation in progress", async () => {
    withBand = true;
    server.hold = true;
    await paint();
    const band = host.querySelector(".band")!;
    type(band.querySelector<HTMLTextAreaElement>("textarea")!, "From the band.");
    await click(answerButton(band));
    await click(line(1));
    dictationBusy = true;
    await paint();

    await act(async () => {
      for (const go of server.release) go();
    });
    await settle();
    expect(box()?.value, "the old answer was inserted while this box was listening").toBe("");

    dictationBusy = false;
    await paint();
    expect(box()?.value).toBe("From the band.");
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
    expect(asked().querySelector(".quiz-tick")).not.toBeNull();
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
    expect(margin().textContent).not.toContain("already being marked elsewhere on the page");
    expect(reply()).toBe("A mark of “From the band.”.");
    expect(box()?.value, "the losing draft is still the reader's words").toBe("From the margin.");
  });
});

/**
 * **Deeper for right, a faint wash and an empty box once due** — plan 261029m,
 * Greg's spya-v2aehw: *"even more positive feedback if they got it right, and
 * maybe some other indication if it's sort of stale … a kind of basic version
 * of the spacing effect"*.
 */
describe("right, and time to recall it again", () => {
  it("turns a deeper green when this visit's check says right, and only then", async () => {
    server.verdict = "right";
    await paint();
    await click(line(1));
    type(box()!, "Spot on.");
    await click(answerButton(margin()));
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
    expect(item(1).classList.contains("quiz-right")).toBe(true);

    server.verdict = "wrong";
    await click(line(2));
    type(box()!, "Not quite.");
    await click(answerButton(margin()));
    expect(item(2).classList.contains("quiz-answered")).toBe(true);
    expect(item(2).classList.contains("quiz-right"), "wrong must look like plain answered").toBe(false);
  });

  it("is plain answered when the check failed or declined (no verdict)", async () => {
    await paint();
    await click(line(1));
    type(box()!, "Whatever.");
    await click(answerButton(margin()));
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
    expect(item(1).classList.contains("quiz-right")).toBe(false);
  });

  it("shows the band's right in the margin, and the margin's in the band: one kept verdict", async () => {
    withBand = true;
    server.verdict = "right";
    await paint();
    const band = host.querySelector(".band")!;
    type(band.querySelector<HTMLTextAreaElement>("textarea")!, "From the band.");
    await click(answerButton(band));
    expect(band.querySelector(".quiz-question")!.classList.contains("quiz-right")).toBe(true);
    expect(band.querySelector(".quiz-question .sr-only")?.textContent).toBe(
      " (answered; the check thought it looked right)",
    );
    expect(item(1).classList.contains("quiz-right")).toBe(true);

    type(band.querySelector<HTMLTextAreaElement>("textarea")!, "Different words in the band.");
    expect(band.querySelector(".quiz-question")!.classList.contains("quiz-right")).toBe(false);
    expect(
      band.querySelector(".quiz-question")!.classList.contains("quiz-answered"),
      "right should step down to answered when the box no longer holds the judged words",
    ).toBe(true);
  });

  it("is not right after a reload: the verdict is never stored", async () => {
    server.attempts = [
      { questionId: Q1, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Kept.", reply: "A mark.", answeredAt: daysAgo(1) },
    ];
    server.verdict = "right";
    await paint();
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
    expect(item(1).classList.contains("quiz-right")).toBe(false);
  });

  it("drains to due after three days, and opens empty, for recall, with the earlier answer one press away", async () => {
    server.attempts = [
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Old words.", reply: "A mark of “Old words.”.", answeredAt: daysAgo(4) },
    ];
    await paint();
    expect(item(2).classList.contains("quiz-due")).toBe(true);
    expect(item(2).querySelector(".marg-quiz-due")).not.toBeNull();
    expect(item(2).textContent).toContain("answered 4 days ago: worth trying again from memory");
    expect(item(1).classList.contains("quiz-due")).toBe(false);

    await click(line(2));
    expect(box()?.value, "the old answer would make it a re-read").toBe("");
    expect(reply()).toBeNull();
    expect(visibleText(margin().querySelector(".quiz-recall")!)).toContain(
      "You answered this 4 days ago. Try it from memory first.",
    );

    const reveal = showEarlier(margin());
    const when = margin().querySelector("time");
    expect(when?.getAttribute("datetime")).toBe(server.attempts[0]!.answeredAt);
    expect(when?.getAttribute("data-tip")).toBeTruthy();
    act(() => reveal.focus());
    await click(reveal);
    expect(box()?.value).toBe("Old words.");
    expect(reply()).toBe("A mark of “Old words.”.");
    expect(margin().textContent).not.toContain("Try it from memory first.");
    expect(document.activeElement).toBe(box());
    expect(server.marks).toEqual([]);
  });

  it("disables Show my earlier answer while dictation owns the box", async () => {
    server.attempts = [
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Old words.", reply: "A mark.", answeredAt: daysAgo(4) },
    ];
    await paint();
    await click(line(2));
    dictationBusy = true;
    await paint();
    expect(showEarlier(margin()).disabled).toBe(true);
  });

  it("is no longer due once answered again", async () => {
    server.attempts = [
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Old words.", reply: "A mark.", answeredAt: daysAgo(5) },
    ];
    await paint();
    await click(line(2));
    type(box()!, "From memory, again.");
    await click(answerButton(margin()));
    expect(item(2).classList.contains("quiz-due")).toBe(false);
    expect(item(2).classList.contains("quiz-answered")).toBe(true);
    expect(reply()).toBe("A mark of “From memory, again.”.");
  });

  it("shows the earlier answer beside a draft written from memory, never over it", async () => {
    server.attempts = [
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Old words.", reply: "A mark of “Old words.”.", answeredAt: daysAgo(4) },
    ];
    await paint();
    await click(line(2));
    type(box()!, "Recalled just now.");
    await click(showEarlier(margin()));
    expect(box()?.value, "the recall was overwritten").toBe("Recalled just now.");
    expect(margin().textContent).toContain("Your earlier answer: Old words.");
    expect(margin().textContent).toContain(
      "The mark below is about that earlier answer. Press Answer to have your answer from memory marked.",
    );
    expect(reply()).toBe("A mark of “Old words.”.");
  });

  it("binds a one-press dictation on a due question to that question's empty box", async () => {
    dictationSupported = true;
    server.attempts = [
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Old words.", reply: "A mark.", answeredAt: daysAgo(4) },
    ];
    await paint();
    const mic = item(2).querySelector<HTMLButtonElement>('button[aria-label="Answer out loud"]')!;
    await click(mic);
    expect(toggled.map((t) => t.box)).toEqual([`quiz:${SLUG}:${Q2}`]);
    expect(box()?.value).toBe("");
    act(() => toggled[0]!.onChange("Spoken from memory."));
    expect(box()?.value).toBe("Spoken from memory.");
  });

  it("steps right down to answered while the margin's box holds other words", async () => {
    withBand = true;
    server.verdict = "right";
    await paint();
    const band = host.querySelector(".band")!;
    type(band.querySelector<HTMLTextAreaElement>("textarea")!, "From the band.");
    await click(answerButton(band));
    await click(line(1));
    expect(box()?.value).toBe("From the band.");
    expect(item(1).classList.contains("quiz-right")).toBe(true);
    type(box()!, "Different words in the margin.");
    expect(item(1).classList.contains("quiz-right"), "right vouched for words nobody judged").toBe(false);
    expect(item(1).classList.contains("quiz-answered")).toBe(true);
  });

  it("shows the band's question as due too", async () => {
    withBand = true;
    server.attempts = [
      { questionId: Q1, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Old words.", reply: "A mark.", answeredAt: daysAgo(6) },
      /* Q2 answered too, so the band, which opens at the first unanswered
         question, opens at the first. */
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a2", answer: "New.", reply: "A mark.", answeredAt: daysAgo(0) },
    ];
    await paint();
    const band = host.querySelector(".band")!;
    const asked = band.querySelector(".quiz-question")!;
    expect(asked.classList.contains("quiz-due")).toBe(true);
    expect(asked.querySelector(".sr-only")?.textContent).toContain("worth trying again from memory");
    /* …and behaves the same: empty for recall, the earlier answer one press away. */
    expect(band.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    expect(visibleText(band.querySelector(".quiz-recall")!)).toContain(
      "You answered this 6 days ago. Try it from memory first.",
    );
    const reveal = showEarlier(band);
    act(() => reveal.focus());
    await click(reveal);
    expect(band.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Old words.");
    expect(document.activeElement).toBe(band.querySelector<HTMLTextAreaElement>("textarea"));
  });

  it("opens the band at a due question, as at an unanswered one", async () => {
    withBand = true;
    server.attempts = [
      { questionId: Q1, attemptId: "00000000-0000-4000-8000-00000062f0a1", answer: "Fresh.", reply: "A mark.", answeredAt: daysAgo(0) },
      { questionId: Q2, attemptId: "00000000-0000-4000-8000-00000062f0a2", answer: "Old.", reply: "A mark.", answeredAt: daysAgo(4) },
    ];
    await paint();
    expect(host.querySelector(".band .quiz-question")!.textContent).toContain("Question number 2?");
  });

  it.each(["margin", "band"] as const)(
    "does not reveal a due answer that arrives late over a claimed-elsewhere collision in the %s",
    async (loser) => {
      withBand = true;
      server.hold = true;
      await paint();
      const band = host.querySelector(".band")!;

      if (loser === "margin") {
        type(band.querySelector<HTMLTextAreaElement>("textarea")!, "Winning band answer.");
        await click(answerButton(band));
        await click(line(1));
        type(box()!, "Margin draft from memory.");
        await click(answerButton(margin()));
      } else {
        await click(line(1));
        type(box()!, "Winning margin answer.");
        await click(answerButton(margin()));
        type(band.querySelector<HTMLTextAreaElement>("textarea")!, "Band draft from memory.");
        await click(answerButton(band));
      }

      server.attempts = [
        { questionId: Q1, attemptId: "00000000-0000-4000-8000-00000062f0a9", answer: "Late old words.", reply: "Late old mark.", answeredAt: daysAgo(4) },
      ];
      await act(async () => latestRead!.refresh());
      await settle();

      const scope = loser === "margin" ? margin() : band;
      expect(scope.querySelector(".quiz-reply"), "the due mark was disclosed without the reader asking").toBeNull();
      expect(scope.textContent).not.toContain("Late old words.");

      await act(async () => {
        for (const go of server.release) go();
      });
      await settle();
      expect(scope.textContent).toContain(`A mark of “Winning ${loser === "margin" ? "band" : "margin"} answer.”.`);
      expect(scope.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        loser === "margin" ? "Margin draft from memory." : "Band draft from memory.",
      );
    },
  );
});
