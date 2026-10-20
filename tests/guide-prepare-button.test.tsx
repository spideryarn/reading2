// @vitest-environment jsdom
/**
 * **The guide's `prepare` step, drawn** — src/web/GuideNextSteps.tsx §
 * `PrepareStep`, plan docs/plans/261019p-guide-chat-plainer.md § Stage 2b.
 *
 * B: *Get Skim ready* is pressed by the reader and never opens the mode. A: a
 * step marked `now` is pressed by the page itself, once, and only on an answer
 * this tab watched being written; never on a reload. Either way the press goes
 * through the job engine's action seam (GPT Sol's F5), and Skim is never
 * drawn beside an offer to save their reason (F4).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ToolRun } from "../src/types.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor, ModeTarget } from "../src/web/command-proposal.js";

const engine = vi.hoisted(() => ({
  posts: [] as { url: string; body: unknown }[],
  answer: { status: "started", job: { id: "job-1" } } as unknown,
  fail: null as null | Error,
  succeeded: 0,
  failed: 0,
}));

vi.mock("../src/web/jobEngine.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/jobEngine.js")>();
  return {
    ...real,
    send: async (url: string, init?: RequestInit) => {
      engine.posts.push({ url, body: JSON.parse(String(init?.body)) });
      if (engine.fail) throw engine.fail;
      return engine.answer;
    },
    jobEngine: {
      ...real.jobEngine,
      epoch: () => 0,
      actionSucceeded: () => {
        engine.succeeded += 1;
      },
      actionFailed: () => {
        engine.failed += 1;
      },
    },
  };
});

const { ChatCommands } = await import("../src/web/CommandChip.js");
const { GuideNextSteps, PREPARE_WORDS } = await import("../src/web/GuideNextSteps.js");
const { forgetAnsweredHere, markAnsweredHere } = await import("../src/web/chat/answered-here.js");
const { forgetPrepares } = await import("../src/web/prepare-press.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  engine.posts.length = 0;
  engine.answer = { status: "started", job: { id: "job-1" } };
  engine.fail = null;
  engine.succeeded = 0;
  engine.failed = 0;
  forgetAnsweredHere();
  forgetPrepares();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const CLOSE: ActionOutcome = { kind: "close" };
const target = (key: string, label: string): ModeTarget => ({ key, label, description: "A mode.", generates: true });
const MODES = new Map<string, ModeTarget>([
  ["mode:skim", target("mode:skim", "Skim")],
  ["mode:glossary", target("mode:glossary", "Glossary")],
]);

const answer = (tools: ToolRun[], id = "spya-ans001"): ChatMessage =>
  ({ id, role: "assistant", text: "Start with the method.", createdAt: "2026-10-20T09:00:00.000Z", status: "done", tools }) as ChatMessage;
const offered = (steps: unknown): ToolRun => ({ name: "offer_next_steps", label: "offered next steps", status: "done", steps } as ToolRun);
const reasonOffer: ToolRun = {
  name: "offer_to_save",
  label: "offered to save why you're reading",
  status: "done",
  offer: { field: "purpose", text: "To decide whether to cite it", basis: null },
} as ToolRun;

async function paint(message: ChatMessage, mode = vi.fn((_p: { key: string }) => CLOSE)) {
  const executor: CommandExecutor = { runners: { mode }, sources: { modes: MODES } };
  await act(async () => {
    root.render(
      <ChatCommands executor={executor}>
        <GuideNextSteps
          slug="a-piece"
          threadId="thread-1"
          message={message}
          blocks={new Map()}
          onAsk={() => {}}
        />
      </ChatCommands>,
    );
  });
  return mode;
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
const text = () => buttons().map((b) => b.textContent?.trim());

describe("a prepare step the reader presses", () => {
  it("draws Get Skim ready, posts nothing until pressed, then starts it without opening Skim", async () => {
    const mode = await paint(answer([offered([{ kind: "prepare", mode: "mode:skim", now: false }])]));
    expect(text()).toEqual([PREPARE_WORDS.idle("Skim")]);
    expect(engine.posts).toEqual([]);
    await act(async () => buttons()[0]?.click());
    expect(engine.posts).toEqual([
      { url: "/api/guide-prepare/a-piece", body: { mode: "mode:skim", threadId: "thread-1", now: false } },
    ]);
    expect(engine.succeeded).toBe(1);
    expect(mode).not.toHaveBeenCalled();
    expect(text()).toEqual([PREPARE_WORDS.started("Skim")]);
    expect(buttons()[0]?.disabled).toBe(true);
  });

  it("says ready only when the server found it made", async () => {
    engine.answer = { status: "ready" };
    await paint(answer([offered([{ kind: "prepare", mode: "mode:glossary", now: false }])]));
    await act(async () => buttons()[0]?.click());
    expect(text()).toEqual([PREPARE_WORDS.ready("Glossary")]);
  });

  it("does not say ready for an unfamiliar successful response", async () => {
    engine.answer = { status: "something-new" };
    await paint(answer([offered([{ kind: "prepare", mode: "mode:glossary", now: false }])]));
    await act(async () => buttons()[0]?.click());
    expect(text()).toEqual([PREPARE_WORDS.failed("Glossary")]);
    expect(engine.succeeded).toBe(0);
    expect(engine.failed).toBe(1);
  });
});

describe("a prepare step the guide marked now", () => {
  it("is pressed by the page, once, on an answer this tab watched being written", async () => {
    markAnsweredHere("spya-ans001");
    const message = answer([offered([{ kind: "prepare", mode: "mode:skim", now: true }])]);
    await paint(message);
    expect(engine.posts).toEqual([
      { url: "/api/guide-prepare/a-piece", body: { mode: "mode:skim", threadId: "thread-1", now: true } },
    ]);
    expect(text()).toEqual([PREPARE_WORDS.started("Skim")]);
    /* A remount (the transcript redrawn) shows the outcome and presses nothing more. */
    act(() => root.unmount());
    root = createRoot(host);
    await paint(message);
    expect(engine.posts).toHaveLength(1);
    expect(text()).toEqual([PREPARE_WORDS.started("Skim")]);
  });

  it("is only a button on an answer this tab did not watch: a reload presses nothing", async () => {
    await paint(answer([offered([{ kind: "prepare", mode: "mode:skim", now: true }])]));
    expect(engine.posts).toEqual([]);
    expect(text()).toEqual([PREPARE_WORDS.idle("Skim")]);
  });

  it("comes back as the button when the conversation had already spent its start", async () => {
    markAnsweredHere("spya-ans001");
    engine.fail = Object.assign(new Error("This conversation has already started a mode by itself."), { status: 409 });
    await paint(answer([offered([{ kind: "prepare", mode: "mode:skim", now: true }])]));
    expect(text()).toEqual([PREPARE_WORDS.idle("Skim")]);
    engine.fail = null;
    await act(async () => buttons()[0]?.click());
    expect(engine.posts.at(-1)?.body).toEqual({ mode: "mode:skim", threadId: "thread-1", now: false });
  });

  it("shows another 409 as a failure rather than mistaking it for a spent start", async () => {
    markAnsweredHere("spya-ans001");
    engine.fail = Object.assign(new Error("This paper has not been read through yet."), { status: 409 });
    await paint(answer([offered([{ kind: "prepare", mode: "mode:skim", now: true }])]));
    expect(text()).toEqual([PREPARE_WORDS.failed("Skim")]);
    expect(engine.failed).toBe(1);
  });
});

describe("what is never drawn", () => {
  it("no Skim step beside an offer to save their reason, whichever came first; another mode still is", async () => {
    markAnsweredHere("spya-ans001");
    await paint(answer([offered([{ kind: "prepare", mode: "mode:skim", now: true }]), reasonOffer]));
    expect(text()).toEqual([]);
    expect(engine.posts).toEqual([]);
    await paint(answer([reasonOffer, offered([{ kind: "prepare", mode: "mode:glossary", now: false }])], "spya-ans002"));
    expect(text()).toEqual([PREPARE_WORDS.idle("Glossary")]);
  });

  it("no step for a mode this page cannot open", async () => {
    await paint(answer([offered([{ kind: "prepare", mode: "submode:learn:quiz", now: false }])]));
    expect(text()).toEqual([]);
  });
});
