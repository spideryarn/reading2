// @vitest-environment jsdom
/**
 * **Quiz runs when the margin is shown, and its questions sit in it.**
 *
 * > let's say the quiz mode does run as one of the default modes whenever you
 * > open marginalia mode, for example, because I think we include the quiz
 * > questions in the marginalia annotations. If not, we should, to really
 * > encourage the user to reflect on what they're reading.
 * >
 * > — Greg, 2026-10-29 (spya-fytjtf)
 *
 * Two halves: `OwnerMarginFeed` writes a quiz for an article that has none,
 * on the relation words' terms (useQuiz.ts § `useQuizOnShow`), and
 * `marginaliaNotes` places each question beside the block the prose would
 * hang it after (notes.ts; quiz-anchors.ts). The real `jobEngine` and
 * `useStepJob` sit on the mocked network, as in
 * tests/marginalia-relations-on-open.test.tsx.
 * docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Job, QuizQuestion } from "../src/types.js";
import type { QuizRead } from "../src/web/useQuiz.js";
import { marginaliaNotes } from "../src/web/marginalia/notes.js";
import { quizReadStub } from "./helpers/quiz-read-stub.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "quiz-on-show";
const trace: string[] = [];
const posted: unknown[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    trace.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "POST") {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ id: "j-quiz", slug: SLUG, status: "queued", steps: [], createdAt: 1, updatedAt: 1 } as unknown as Job),
        { status: 200 },
      );
    }
    if (url === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    /* The relation words are stored, so the one other thing the feed may
       make has nothing to make, and every POST here is the quiz's. */
    if (url === `/api/relations/${SLUG}`) {
      return new Response(JSON.stringify({ relations: { relations: {}, notes: [] }, stale: false, outdated: false }), {
        status: 200,
      });
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { OwnerMarginFeed } = await import("../src/web/marginalia/MarginaliaColumn.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { resetActivations } = await import("../src/web/activation.js");

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openMargin(
  quiz: QuizRead,
  { shown = true, awaitingStructure = false, strict = false } = {},
): Promise<void> {
  const el = createElement(OwnerMarginFeed, { slug: SLUG, shown, awaitingStructure, quiz, onFeed: () => {} });
  await act(async () => root.render(strict ? createElement(StrictMode, null, el) : el));
  await settle();
}

const quizPosts = () => posted.filter((p) => JSON.stringify((p as { steps?: unknown }).steps) === '["quiz"]');

beforeEach(async () => {
  trace.length = 0;
  posted.length = 0;
  jobEngine.reset();
  resetActivations();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => jobEngine.start("reader-1"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("the margin shown on an article with no quiz", () => {
  it("writes one, unforced, with nobody having pressed anything", async () => {
    await openMargin(quizReadStub({ status: "none" }));
    expect(quizPosts()).toHaveLength(1);
    expect(quizPosts()[0]).toMatchObject({ slug: SLUG, steps: ["quiz"] });
    expect(quizPosts()[0]).not.toMatchObject({ force: true });
  });

  it("asks once under StrictMode, and not again on a second mount in the same page load", async () => {
    await openMargin(quizReadStub({ status: "none" }), { strict: true });
    await act(async () => root.unmount());
    root = createRoot(host);
    await openMargin(quizReadStub({ status: "none" }));
    expect(quizPosts()).toHaveLength(1);
  });

  it("asks for nothing while the notes are not on screen, and asks when they are", async () => {
    await openMargin(quizReadStub({ status: "none" }), { shown: false });
    expect(quizPosts(), "a window with no room for the notes bought a quiz").toHaveLength(0);
    await openMargin(quizReadStub({ status: "none" }), { shown: true });
    expect(quizPosts()).toHaveLength(1);
  });

  it("asks for nothing while the article is still showing its opening outline", async () => {
    await openMargin(quizReadStub({ status: "none" }), { awaitingStructure: true });
    expect(quizPosts()).toHaveLength(0);
  });
});

describe("the margin shown on an article that has a quiz", () => {
  it("writes nothing, stale or outdated included: a rewrite would hide the reader's kept answers", async () => {
    await openMargin(quizReadStub({ status: "ready", stale: true, outdated: true }));
    expect(quizPosts()).toHaveLength(0);
  });

  it("reads the quiz again on a failed read rather than spending", async () => {
    const reload = vi.fn(async () => {});
    await openMargin(quizReadStub({ status: "error", reload }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(quizPosts()).toHaveLength(0);
  });
});

describe("where the margin puts the questions", () => {
  const block = (id: string, text: string): Block =>
    ({ id, kind: "text", text, html: text, gistable: true, words: text.split(" ").length }) as unknown as Block;
  const blocks = [
    block("spya-qza111", "The first passage of the article, long enough to be a paragraph of its own here."),
    block("spya-qza222", "The second passage of the article, long enough to be a paragraph of its own here."),
    block("spya-qza333", "The third passage of the article, long enough to be a paragraph of its own here."),
  ];
  const question = (id: string, q: string, at: string[]): QuizQuestion =>
    ({ id, question: q, evidence: at.map((blockId) => ({ blockId, quote: "passage", start: 0 })) }) as unknown as QuizQuestion;

  it("beside the block holding each question's last evidence passage, in path order, last in the note", () => {
    const quiz = {
      batchId: "b-1",
      questions: [
        question("spya-qzq001", "What does the first passage claim?", ["spya-qza111", "spya-qza222"]),
        question("spya-qzq002", "And the second?", ["spya-qza222"]),
        question("spya-qzq003", "Nowhere to put me?", ["spya-gone00"]),
      ],
    };
    const notes = marginaliaNotes(null, blocks, null, {
      faq: [
        {
          id: "f1",
          question: "An FAQ question?",
          passages: [{ blockId: "spya-qza222", quote: "second passage", start: 4 }],
        },
      ] as never,
      quiz,
    });
    const here = notes.get("spya-qza222") ?? [];
    expect(here.map((n) => n.kind)).toEqual(["faq", "quiz"]);
    const last = here[here.length - 1];
    expect(last?.kind === "quiz" && last.batchId).toBe("b-1");
    expect(last?.kind === "quiz" && last.questions.map((q) => q.id)).toEqual(["spya-qzq001", "spya-qzq002"]);
    expect(notes.has("spya-qza111")).toBe(false);
  });

  it("draws none without a quiz", () => {
    const notes = marginaliaNotes(null, blocks, null, { quiz: null });
    expect([...notes.values()].flat().some((n) => n.kind === "quiz")).toBe(false);
  });
});
