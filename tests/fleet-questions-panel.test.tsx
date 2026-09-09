// @vitest-environment jsdom
/**
 * The Questions tab is a composition test as much as a rendering test. Dialog
 * cards resolve back into the parsed fleet row that owns the raw question, and
 * freshness is recomputed from App's clock after the payload has stopped.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import { QuestionsPanel } from "../tools/fleet/web/src/QuestionsPanel";
import type { ActionsApi } from "../tools/fleet/web/src/actions-client";
import type { QueueApi, QueueView } from "../tools/fleet/web/src/queue-client";
import { makeSteerApi, type SteerApi, type SteerOutcome } from "../tools/fleet/web/src/steer-client";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import {
  ANSWERING_NOT_REPORTED,
  parseFleetState,
  type AnsweringReading,
  type FleetRow,
  type FleetState,
  type QuestionsView,
} from "../tools/fleet/web/src/types";
import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const FRESH = "2026-09-09T11:59:30.000Z";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.location.hash = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const RAW_QUESTION = {
  kind: "question",
  prompt: "Which colour should the new state use?",
  material: { kind: "read", text: "Choose the status colour", fingerprint: "material-1" },
  options: [
    { label: "Red", consequence: "once", key: { via: "digit", digit: "1" } },
    { label: "Blue", consequence: "unknown", key: { via: "digit", digit: "2" } },
  ],
  gate: { kind: "conversation" },
  /* A field this client does not parse. Losing it is the rawQuestion defect. */
  capturedAt: "2026-09-09T11:59:29.500Z",
};

function wireRow(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "$1",
    paneId: "%1",
    name: "questions-agent",
    status: { kind: "needs-you" },
    question: RAW_QUESTION,
    panePid: 101,
    claudeSessionId: "9f2c41a7-6b5e-4d38-9a10-7c4e2b8f0d61",
    execution: {
      kind: "verified",
      token: { boot: "boot-a", pid: 202, startTicks: 10 },
      harness: "claude-code",
      conversation: { kind: "verified", id: "9f2c41a7-6b5e-4d38-9a10-7c4e2b8f0d61" },
    },
    ...over,
  };
}

function attention(items: readonly unknown[] = []): Record<string, unknown> {
  return {
    kind: "published",
    coordinatorWrittenAt: FRESH,
    list: { kind: "list", items, sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: FRESH },
  };
}

function wireDialogItem(rowId = "$1"): Record<string, unknown> {
  return {
    kind: "dialog",
    rowId,
    target: { kind: "addressable", sessionId: rowId, sessionName: "questions-agent" },
  };
}

function proseSource(): Record<string, unknown> {
  return {
    id: "prose-1",
    sessionId: "$1",
    sessionName: "questions-agent",
    waitingSince: "2026-09-09T11:30:00.000Z",
    kind: "product",
    evidence: {
      kind: "prose",
      excerpt: "The cache can be strict or compatible; I need the product choice.",
      why: "the turn ended by handing over a product decision",
    },
    answerability: { kind: "phone" },
    duplicates: [{ sessionId: "$2", sessionName: "duplicate-agent", waitingSince: "2026-09-09T11:31:00.000Z" }],
  };
}

function wireProseItem(): Record<string, unknown> {
  return {
    kind: "prose",
    itemId: "prose-1",
    target: { kind: "addressable", sessionId: "$1", sessionName: "questions-agent" },
    excerpt: "The cache can be strict or compatible; I need the product choice.",
    why: "the turn ended by handing over a product decision",
    waitingSince: "2026-09-09T11:30:00.000Z",
    attentionKind: "product",
    duplicates: [
      {
        kind: "unaddressable",
        sessionId: "$2",
        sessionName: "duplicate-agent",
        why: "no fleet row was observed for this session",
      },
    ],
  };
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    servedAt: new Date(NOW).toISOString(),
    rows: [wireRow()],
    collectedAt: FRESH,
    tmuxServerPid: 1,
    tookMs: 10,
    error: null,
    health: null,
    refreshMs: 60_000,
    answeringEnabled: true,
    attemptedAt: FRESH,
    attention: attention(),
    questions: { kind: "complete", items: [wireDialogItem()] },
    overseer: { kind: "not-asked" },
    usage: { kind: "not-asked" },
    ...over,
  };
}

function read(over: Record<string, unknown> = {}): FleetState {
  const parsed = parseFleetState(payload(over), NOW);
  if (!parsed.ok) throw new Error(parsed.why);
  return parsed.state;
}

function readProseState(): FleetState {
  const source = proseSource();
  return read({
    rows: [wireRow({ status: { kind: "idle" }, question: { kind: "none" } })],
    attention: attention([source]),
    questions: { kind: "complete", items: [wireProseItem()] },
  });
}

function manualTransport(): { transport: Transport; push: (state: FleetState) => void } {
  let sink: TransportSink | null = null;
  return {
    transport: (next) => {
      sink = next;
      return { refresh: () => {}, stop: () => { sink = null; } };
    },
    push: (state) => sink?.onState(state),
  };
}

function queueView(needsGreg = 0): Extract<QueueView, { kind: "queue" }> {
  return {
    schema: 1,
    kind: "queue",
    version: "1.ev-1",
    rows: [],
    settled: [],
    settledWithheld: 0,
    depth: { dispatchable: 0, needsGreg, unauthorized: 0, queueHeld: 0, dispatched: 0, done: 0, dropped: 0 },
    throughput: {
      windows: [
        { days: 7, dispatched: 0, done: 0 },
        { days: 30, dispatched: 0, done: 0 },
      ],
      dispatchesEver: 0,
      completionsEver: 0,
      duration: { kind: "not-enough", why: "nothing has been through this queue yet" },
    },
    problems: [],
    path: "/tmp/fake/queue.jsonl",
  };
}

function queueApi(view: QueueView): QueueApi {
  return { fetch: () => Promise.resolve(view) };
}

const UNUSED_ACTIONS: ActionsApi = {
  feed: async () => ({ ok: false, why: "not part of this fixture" }),
  run: async () => { throw new Error("unused"); },
  queueMessage: async () => { throw new Error("unused"); },
  cancel: async () => { throw new Error("unused"); },
  revive: async () => { throw new Error("unused"); },
  abandon: async () => { throw new Error("unused"); },
  clear: async () => { throw new Error("unused"); },
  releaseHold: async () => { throw new Error("unused"); },
  box: async () => { throw new Error("unused"); },
};

const SENT: SteerOutcome = {
  ok: true,
  op: "answer",
  sent: [["tmux", "send-keys", "-t", "%1", "2"]],
  verified: { kind: "verified", paneId: "%1", sessionId: "$1", panePid: 101, claudePid: 202 },
};

function apiReturning(outcome: SteerOutcome): { api: SteerApi; calls: { row: FleetRow; index: number }[] } {
  const calls: { row: FleetRow; index: number }[] = [];
  return {
    calls,
    api: {
      message: async () => { throw new Error("QuestionsPanel must not send prose"); },
      answer: async (row, index) => {
        calls.push({ row, index });
        return outcome;
      },
    },
  };
}

function drawPanel(
  view: QuestionsView | null,
  rows: readonly FleetRow[] = [],
  over: {
    answeringEnabled?: AnsweringReading;
    steer?: SteerApi;
    queueApi?: QueueApi;
    refreshNonce?: number;
    onOpenQueue?: () => void;
    onSelect?: (id: string) => void;
    now?: number;
  } = {},
): void {
  act(() => root.render(
    <QuestionsPanel
      view={view}
      rows={rows}
      answeringEnabled={over.answeringEnabled ?? { kind: "enabled" }}
      queueApi={over.queueApi ?? queueApi(queueView())}
      refreshNonce={over.refreshNonce ?? 0}
      onOpenQueue={over.onOpenQueue ?? (() => {})}
      onSelect={over.onSelect ?? (() => {})}
      now={over.now ?? NOW}
      {...(over.steer === undefined ? {} : { steer: over.steer })}
    />,
  ));
}

function mountApp(transport: Transport, steer?: SteerApi, queue: QueueApi = queueApi(queueView())): void {
  act(() => root.render(
    <App
      transport={transport}
      actionsApi={UNUSED_ACTIONS}
      queueApi={queue}
      actionsPollMs={3_600_000}
      {...(steer === undefined ? {} : { steer })}
    />,
  ));
}

function optionButtons(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button.answer")];
}

describe("the six registrations", () => {
  it("registers the mode and its label", () => {
    expect(MODES).toContain("questions");
    expect(MODE_LABELS.questions).toBe("Questions");
  });

  it("mounts the Questions panel when the initial hash names it", () => {
    window.location.hash = "#questions";
    const feed = manualTransport();
    mountApp(feed.transport);
    expect(host.textContent).toContain("No Questions payload has arrived yet");
    /* **AND SAYS NOTHING ABOUT ANSWERING WHILE IT SAYS THAT.** `App.tsx`
       defaults the prop to `ANSWERING_NOT_REPORTED`, correctly — silence must
       not become `false` — but that arm's sentence is *this server did not
       report whether answering works*, and before a payload arrives no server
       has said anything at all. Drawing it here attributes a silence to
       somebody who has not spoken. */
    expect(host.textContent).not.toContain("did not report whether answering works");
  });

  /**
   * **THE SIXTH REGISTRATION, AND THE ONLY ONE WHOSE FAILURE IS SILENT IN BOTH
   * DIRECTIONS.** The coarse-pointer share count used to be a hand-kept `8` in
   * tailwind.css and was wrong for two modes before GPT Sol found it. Replacing
   * it with `var(--dock-mode-count, 8)` removes the hand-keeping and introduces
   * a new way to fail quietly: if the property never reaches the element — a
   * refactor to a wrapper, a value React declines to write — the fallback makes
   * the bar look exactly as it did while it was wrong. A fallback that hides its
   * own failure needs a test that reads the DOM.
   *
   * Asserted against `MODES.length` rather than against `9`, so the next session
   * to add a mode inherits a check that is still true rather than one that has
   * to be edited.
   */
  it("hands the coarse-pointer share count to the stylesheet, off MODES itself", () => {
    const feed = manualTransport();
    mountApp(feed.transport);
    const modes = host.querySelector<HTMLElement>(".dock-modes");
    expect(modes).not.toBeNull();
    expect(modes?.style.getPropertyValue("--dock-mode-count")).toBe(String(MODES.length));
  });

  it("switches to the panel when its dock button is pressed", () => {
    const feed = manualTransport();
    mountApp(feed.transport);
    const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Questions"));
    expect(button).toBeDefined();
    act(() => button?.click());
    expect(window.location.hash).toBe("#questions");
    expect(host.textContent).toContain("No Questions payload has arrived yet");
  });

  it("shows the queued count and opens the Queued ideas tab through App", async () => {
    window.location.hash = "#questions";
    const feed = manualTransport();
    mountApp(feed.transport, undefined, queueApi(queueView(2)));
    await act(async () => {});

    expect(host.textContent).toContain("2 queued ideas are waiting on you.");
    const open = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Open Queued ideas"));
    expect(open).toBeDefined();
    act(() => open?.click());
    expect(window.location.hash).toBe("#ideas");
  });
});

describe("which empty answer the view has earned", () => {
  it("keeps not-observed, partial and complete empty views distinct", async () => {
    drawPanel({ kind: "not-observed", gaps: [{ kind: "collection-not-observed" }] });
    expect(host.textContent).toContain("Questions were not observed");
    expect(host.textContent).not.toContain("Nothing needs you");
    expect(host.textContent).not.toMatch(/\b0\b/);

    drawPanel({ kind: "partial", items: [], gaps: [{ kind: "questions-not-reported" }] });
    expect(host.textContent).toContain("This list may be incomplete");
    expect((host.textContent ?? "").toLowerCase()).not.toContain("nothing needs you");

    drawPanel({ kind: "complete", items: [] });
    await act(async () => {});
    expect(host.textContent).toContain("Nothing needs you.");
  });

  it("says Nothing needs you only after a readable empty queue", async () => {
    drawPanel({ kind: "complete", items: [] }, [], { queueApi: queueApi(queueView()) });
    await act(async () => {});
    expect(host.textContent).toContain("Nothing needs you.");
    expect(host.textContent).toContain("The queue was read and nothing in it is waiting on you.");
  });

  it("does not reassure while the queued ideas are still being read", () => {
    drawPanel(
      { kind: "complete", items: [] },
      [],
      { queueApi: { fetch: () => new Promise(() => {}) } },
    );
    expect(host.textContent).toContain("Sessions were observed and found quiet, but queued ideas could not be checked");
    expect(host.textContent).toContain("the queued ideas are still being read");
    expect(host.textContent).not.toContain("Nothing needs you.");
  });

  it("does not reassure when this browser got no queue answer", async () => {
    drawPanel(
      { kind: "complete", items: [] },
      [],
      { queueApi: queueApi({ kind: "no-answer", why: "the phone lost the reply" }) },
    );
    await act(async () => {});
    expect(host.textContent).toContain("Sessions were observed and found quiet, but queued ideas could not be checked");
    expect(host.textContent).toContain("the phone lost the reply");
    expect(host.textContent).not.toContain("Nothing needs you.");
  });

  it("does not reassure when the server could not read the queue file", async () => {
    drawPanel(
      { kind: "complete", items: [] },
      [],
      { queueApi: queueApi({ schema: 1, kind: "unreadable", why: "line 4 is malformed" }) },
    );
    await act(async () => {});
    expect(host.textContent).toContain("Sessions were observed and found quiet, but queued ideas could not be checked");
    expect(host.textContent).toContain("line 4 is malformed");
    expect(host.textContent).not.toContain("Nothing needs you.");
  });

  it("does not reassure when no queue file has been written", async () => {
    drawPanel(
      { kind: "complete", items: [] },
      [],
      { queueApi: queueApi({ schema: 1, kind: "never-written", why: "no queue file has been written yet" }) },
    );
    await act(async () => {});
    expect(host.textContent).toContain("Sessions were observed and found quiet, but queued ideas could not be checked");
    expect(host.textContent).toContain("no queue file has been written yet");
    expect(host.textContent).not.toContain("Nothing needs you.");
  });

  it("does not reassure when a reported item set omits a live dialog or prose observation", async () => {
    const dialogOmitted = read({ questions: { kind: "complete", items: [] } });
    drawPanel(dialogOmitted.questions, dialogOmitted.rows, { queueApi: queueApi(queueView()) });
    await act(async () => {});
    expect(host.textContent).toContain("This list may be incomplete");
    expect(host.textContent).not.toContain("Nothing needs you.");

    const source = proseSource();
    const proseOmitted = read({
      rows: [wireRow({ status: { kind: "idle" }, question: { kind: "none" } })],
      attention: attention([source]),
      questions: { kind: "complete", items: [] },
    });
    drawPanel(proseOmitted.questions, proseOmitted.rows, { queueApi: queueApi(queueView()) });
    await act(async () => {});
    expect(host.textContent).toContain("This list may be incomplete");
    expect(host.textContent).not.toContain("Nothing needs you.");
  });
});

describe("the queued ideas pointer", () => {
  it("gives all six readings their own sentence", async () => {
    const cases: { api: QueueApi; sentence: string; settles: boolean }[] = [
      {
        api: { fetch: () => new Promise(() => {}) },
        sentence: "The queued ideas are still being read.",
        settles: false,
      },
      {
        api: queueApi(queueView(2)),
        sentence: "2 queued ideas are waiting on you. Open Queued ideas.",
        settles: true,
      },
      {
        api: queueApi(queueView()),
        sentence: "The queue was read and nothing in it is waiting on you.",
        settles: true,
      },
      {
        api: queueApi({ schema: 1, kind: "never-written", why: "no queue file has been written yet" }),
        sentence: "No queue file exists yet. This is ordinary, but it is not an empty queue: no queue file has been written yet.",
        settles: true,
      },
      {
        api: queueApi({ schema: 1, kind: "unreadable", why: "line 4 is malformed" }),
        sentence: "The server could not read the queue file: line 4 is malformed.",
        settles: true,
      },
      {
        api: queueApi({ kind: "no-answer", why: "the phone lost the reply" }),
        sentence: "This browser never got an answer from the queue: the phone lost the reply.",
        settles: true,
      },
    ];
    const seen: string[] = [];

    for (const current of cases) {
      drawPanel({ kind: "not-observed", gaps: [{ kind: "collection-not-observed" }] }, [], { queueApi: current.api });
      if (current.settles) await act(async () => {});
      const pointer = host.querySelector<HTMLElement>("[data-queue-pointer]");
      expect(pointer).toBe(host.querySelector("section")?.lastElementChild);
      const sentence = pointer?.textContent ?? "";
      expect(sentence).toBe(current.sentence);
      seen.push(sentence);
    }

    expect(new Set(seen).size).toBe(cases.length);
  });

  it("reads once on entry, ignores payload pushes, and reads again for refreshNonce", async () => {
    let calls = 0;
    const api: QueueApi = {
      fetch: () => {
        calls += 1;
        return Promise.resolve(queueView());
      },
    };
    drawPanel({ kind: "complete", items: [] }, [], { queueApi: api, refreshNonce: 0 });
    await act(async () => {});
    expect(calls).toBe(1);

    drawPanel({ kind: "partial", items: [], gaps: [{ kind: "questions-not-reported" }] }, [], { queueApi: api, refreshNonce: 0 });
    await act(async () => {});
    expect(calls).toBe(1);

    drawPanel({ kind: "partial", items: [], gaps: [{ kind: "questions-not-reported" }] }, [], { queueApi: api, refreshNonce: 1 });
    await act(async () => {});
    expect(calls).toBe(2);
  });

  it("uses the injected seam without reaching fetch", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    drawPanel({ kind: "complete", items: [] }, [], { queueApi: queueApi(queueView()) });
    await act(async () => {});
    expect(network).not.toHaveBeenCalled();
  });
});

describe("dialog answers", () => {
  it("posts the row's rawQuestion verbatim and the zero-based option index", async () => {
    const state = read();
    let request: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({ ok: true, op: "answer", sent: [], verified: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    drawPanel(state.questions, state.rows, { steer: makeSteerApi(fakeFetch) });
    await act(async () => optionButtons()[1]?.click());
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.question).toEqual(RAW_QUESTION);
    expect(body.optionIndex).toBe(1);
  });

  it("draws a stub and never calls the seam when the row no longer has a question", () => {
    const state = read({ rows: [wireRow({ question: null })] });
    const recorder = apiReturning(SENT);
    drawPanel(state.questions, state.rows, { steer: recorder.api });
    expect(host.textContent).toContain("A dialog was observed");
    expect(host.textContent).toContain("could not be read on this side");
    expect(optionButtons()).toHaveLength(0);
    expect(recorder.calls).toHaveLength(0);
  });

  it("withholds controls when a retained dialog item contradicts the current row", () => {
    const recorder = apiReturning(SENT);
    const noAddress = read({ rows: [wireRow({ paneId: null })] });
    expect(noAddress.questions.kind).toBe("partial");
    drawPanel(noAddress.questions, noAddress.rows, { steer: recorder.api });
    expect(optionButtons()).toHaveLength(0);

    const wrongTarget = read({
      questions: {
        kind: "complete",
        items: [{
          ...wireDialogItem(),
          target: { kind: "addressable", sessionId: "$9", sessionName: "some-other-session" },
        }],
      },
    });
    expect(wrongTarget.questions.kind).toBe("partial");
    drawPanel(wrongTarget.questions, wrongTarget.rows, { steer: recorder.api });
    expect(optionButtons()).toHaveLength(0);
    expect(host.textContent).toContain("questions-agent");
    expect(host.textContent).not.toContain("some-other-session");
    expect(recorder.calls).toHaveLength(0);
  });

  it.each([
    ["waiting", { kind: "waiting", secondsLeft: 30 }],
    ["no-claude", { kind: "no-claude" }],
    ["shell", { kind: "shell", busy: false }],
    ["unknown", { kind: "unknown", why: "the status pass failed" }],
  ] as const)("withholds controls and never calls the seam for %s rows", (_name, status) => {
    const state = read({ rows: [wireRow({ status })] });
    const recorder = apiReturning(SENT);
    drawPanel(state.questions, state.rows, { steer: recorder.api });

    expect(optionButtons().filter((button) => !button.disabled)).toHaveLength(0);
    act(() => optionButtons()[0]?.click());
    expect(recorder.calls).toHaveLength(0);
  });

  it("withholds controls and never calls the seam for a conversation gate with no material", () => {
    const question = { ...RAW_QUESTION, material: { kind: "no-material" } };
    const state = read({ rows: [wireRow({ question })] });
    const recorder = apiReturning(SENT);
    drawPanel(state.questions, state.rows, { steer: recorder.api });

    expect(optionButtons().filter((button) => !button.disabled)).toHaveLength(0);
    act(() => optionButtons()[0]?.click());
    expect(recorder.calls).toHaveLength(0);
  });

  it.each([
    ["pane id", { paneId: "pane-one" }, undefined],
    ["session id", { id: "session-one" }, { kind: "complete", items: [wireDialogItem("session-one")] }],
    ["conversation id", { claudeSessionId: "not-a-uuid" }, undefined],
  ] as const)("withholds controls and never calls the seam for a malformed %s", (_name, rowChanges, questions) => {
    const state = read({
      rows: [wireRow(rowChanges)],
      ...(questions === undefined ? {} : { questions }),
    });
    const recorder = apiReturning(SENT);
    drawPanel(state.questions, state.rows, { steer: recorder.api });

    expect(optionButtons().filter((button) => !button.disabled)).toHaveLength(0);
    act(() => optionButtons()[0]?.click());
    expect(recorder.calls).toHaveLength(0);
  });

  it("keeps state for the same execution token and discards it for a replacement", async () => {
    const recorder = apiReturning(SENT);
    const first = read();
    drawPanel(first.questions, first.rows, { steer: recorder.api });
    await act(async () => optionButtons()[0]?.click());
    expect(host.textContent).toContain("Sent.");

    const same = read({ rows: [wireRow()] });
    drawPanel(same.questions, same.rows, { steer: recorder.api });
    expect(host.textContent).toContain("Sent.");

    const replaced = read({
      rows: [wireRow({
        execution: {
          kind: "verified",
          token: { boot: "boot-a", pid: 202, startTicks: 11 },
          harness: "claude-code",
          conversation: { kind: "verified", id: "9f2c41a7-6b5e-4d38-9a10-7c4e2b8f0d61" },
        },
      })],
    });
    drawPanel(replaced.questions, replaced.rows, { steer: recorder.api });
    expect(host.textContent).not.toContain("Sent.");
  });

  it("discards a receipt and repeat lock when the question changes on the same execution", async () => {
    const recorder = apiReturning(SENT);
    const first = read();
    drawPanel(first.questions, first.rows, { steer: recorder.api });
    await act(async () => optionButtons()[0]?.click());
    expect(host.textContent).toContain("Sent.");

    const nextQuestion = {
      ...RAW_QUESTION,
      prompt: "Which deployment should run next?",
      material: { kind: "read", text: "Choose the deployment", fingerprint: "material-2" },
      options: [
        { label: "Dev", consequence: "once", key: { via: "digit", digit: "1" } },
        { label: "Production", consequence: "persistent", key: { via: "digit", digit: "2" } },
      ],
    };
    const second = read({ rows: [wireRow({ question: nextQuestion })] });
    drawPanel(second.questions, second.rows, { steer: recorder.api });

    expect(host.textContent).toContain("Which deployment should run next?");
    expect(host.textContent).not.toContain("Sent.");
    expect(optionButtons().filter((button) => !button.disabled)).toHaveLength(2);
  });

  it("discards a receipt when only an unfamiliar raw option key changes", async () => {
    const withKey = (via: string) => ({
      ...RAW_QUESTION,
      options: [
        { ...RAW_QUESTION.options[0], key: { via, chord: "Enter" } },
        RAW_QUESTION.options[1],
      ],
    });
    const recorder = apiReturning(SENT);
    const first = read({ rows: [wireRow({ question: withKey("future-a") })] });
    drawPanel(first.questions, first.rows, { steer: recorder.api });
    await act(async () => optionButtons()[0]?.click());
    expect(host.textContent).toContain("Sent.");

    const second = read({ rows: [wireRow({ question: withKey("future-b") })] });
    drawPanel(second.questions, second.rows, { steer: recorder.api });

    expect(host.textContent).not.toContain("Sent.");
    expect(optionButtons().filter((button) => !button.disabled)).toHaveLength(2);
  });

  it("reports success, partial delivery and unknown delivery without inviting a blind repeat", async () => {
    const cases: { outcome: SteerOutcome; words: string }[] = [
      { outcome: SENT, words: "Sent." },
      {
        outcome: { ok: false, code: "send-partial", why: "Enter did not go", status: 409, from: "server", delivery: { kind: "partial" } },
        words: "PART of it was sent.",
      },
      {
        outcome: { ok: false, code: "unreachable", why: "the reply was lost", status: null, from: "client", delivery: { kind: "unknown" } },
        words: "It is not known whether anything was sent.",
      },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const current = cases[index];
      if (current === undefined) throw new Error("missing case");
      const state = read({ rows: [wireRow({
        execution: {
          kind: "verified",
          token: { boot: "boot-a", pid: 202, startTicks: 20 + index },
          harness: "claude-code",
          conversation: { kind: "verified", id: "9f2c41a7-6b5e-4d38-9a10-7c4e2b8f0d61" },
        },
      })] });
      drawPanel(state.questions, state.rows, { steer: apiReturning(current.outcome).api });
      await act(async () => optionButtons()[0]?.click());
      expect(host.textContent).toContain(current.words);
      expect(optionButtons().filter((button) => !button.disabled)).toHaveLength(0);
    }
  });

  it("makes answering-disabled and not-reported visibly different refusals", () => {
    const state = read();
    drawPanel(state.questions, state.rows, { answeringEnabled: { kind: "disabled" } });
    const disabled = host.textContent ?? "";
    expect(disabled).toContain("server has declared an answering hold");
    expect(optionButtons()).toHaveLength(0);

    drawPanel(state.questions, state.rows, { answeringEnabled: ANSWERING_NOT_REPORTED });
    const silent = host.textContent ?? "";
    expect(silent).toContain("server did not report whether answering works");
    expect(silent).toContain("No hold has been declared");
    expect(silent).not.toBe(disabled);
    expect(optionButtons()).toHaveLength(0);
  });

  it("does not show an answering hold for an empty list", async () => {
    drawPanel(
      { kind: "complete", items: [] },
      [],
      { answeringEnabled: { kind: "disabled" }, queueApi: queueApi(queueView()) },
    );
    await act(async () => {});
    expect(host.textContent).toContain("Nothing needs you.");
    expect(host.textContent).not.toContain("server has declared an answering hold");
  });

  it("does not show an answering hold for a prose-only list", () => {
    const prose = readProseState();
    drawPanel(prose.questions, prose.rows, { answeringEnabled: { kind: "disabled" } });
    expect(host.querySelector('[data-question-kind="prose"]')).not.toBeNull();
    expect(host.textContent).not.toContain("server has declared an answering hold");
  });

  it("shows an answering hold when a dialog would otherwise carry option buttons", () => {
    const dialog = read();
    drawPanel(dialog.questions, dialog.rows, { answeringEnabled: { kind: "disabled" } });
    expect(host.textContent).toContain("server has declared an answering hold");
    expect(optionButtons()).toHaveLength(0);
  });
});

describe("prose stays observational", () => {
  function proseState(): FleetState {
    return readProseState();
  }

  it("navigates from a prose card without calling either writing seam", () => {
    vi.setSystemTime(NOW);
    window.location.hash = "#questions?sel=%24old&selpid=999";
    const state = proseState();
    const calls = { messages: 0, answers: 0 };
    const recordingSteer: SteerApi = {
      message: async () => {
        calls.messages += 1;
        return SENT;
      },
      answer: async () => {
        calls.answers += 1;
        return SENT;
      },
    };
    const feed = manualTransport();
    mountApp(feed.transport, recordingSteer);
    act(() => feed.push(state));
    const card = host.querySelector<HTMLElement>('[data-question-kind="prose"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector("textarea")).toBeNull();
    expect([...(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((button) => !button.disabled)).toHaveLength(0);
    expect(card?.textContent).toContain("duplicate-agent");
    act(() => card?.click());
    const hash = decodeURIComponent(window.location.hash);
    expect(hash).toContain("#sessions");
    expect(hash).toContain("sel=$1");
    expect(hash).not.toContain("selpid");
    expect(calls.messages).toBe(0);
    expect(calls.answers).toBe(0);
  });

  /**
   * **A CARD TALLER THAN THE PHONE ANSWERS THE WRONG QUESTION.** This tab exists
   * to answer three things and the third is *which one first?*, which nobody can
   * do when the first card fills the viewport. `AttentionPanel.tsx` found this on
   * live data on 2026-09-08 — real excerpts of 1,116 and 1,736 characters, 17 and
   * 21 lines — and this panel was built the way that file had already tried and
   * rejected. Reproduced at 390 x 844 on 2026-09-09: one card, whole screen, cut
   * off mid-sentence.
   *
   * jsdom has no layout, so this asserts the two things that are structural
   * rather than visual: the acted-on sentence comes FIRST, and the evidence
   * carries the clamp. The measurement itself is the screenshot.
   */
  it("leads with the sentence a person acts on and clamps the evidence", () => {
    const long = Array.from({ length: 25 }, (_, i) => `line ${i} of a very tall terminal tail`).join("\n");
    const item = {
      kind: "prose" as const,
      itemId: "prose-1",
      target: { kind: "addressable" as const, sessionId: "$1", sessionName: "questions-agent" },
      excerpt: long,
      why: "the turn ended by handing over a product decision",
      waitingSince: "2026-09-09T11:30:00.000Z",
      attentionKind: "product" as const,
      duplicates: [],
    };
    drawPanel({ kind: "complete", items: [item] }, []);
    const text = host.textContent ?? "";
    expect(text.indexOf(item.why)).toBeGreaterThan(-1);
    /* The sentence precedes the evidence in DOM order, which is what decides
       what a reader sees first when the card is cut off by the fold. */
    expect(text.indexOf(item.why)).toBeLessThan(text.indexOf("line 0 of a very tall terminal tail"));
    const excerpt = [...host.querySelectorAll("p")].find((p) => p.textContent?.startsWith("line 0 "));
    expect(excerpt?.className).toContain("line-clamp-3");
    /* And the caveat the producer's by-position selection makes necessary,
       which is stated ONCE for the class rather than on the card — see below. */
    expect(text).toContain("taken by position");
  });

  /**
   * **A CAVEAT ON EVERY CARD IS READ AS NOISE WITHIN A DAY**, which is the
   * plan's own rule (§ No badge, in either direction) and which the first build
   * of this card broke twice over: a by-position note and a one-tap-away note on
   * every prose card, identical on all of them and about as much small print as
   * content. Both are facts about the prose CLASS, so they are stated once.
   *
   * Two assertions, because only the pair is the rule: the sentence appears once
   * however many prose cards there are, and it does not appear at all when there
   * is nothing for it to caveat.
   */
  it("states the prose caveat once for the class, and not at all without prose", () => {
    const prose = (id: string) => ({
      kind: "prose" as const,
      itemId: id,
      target: { kind: "addressable" as const, sessionId: "$1", sessionName: "questions-agent" },
      excerpt: "a tail",
      why: "the turn ended by handing over a product decision",
      waitingSince: "2026-09-09T11:30:00.000Z",
      attentionKind: "product" as const,
      duplicates: [],
    });
    drawPanel({ kind: "complete", items: [prose("a"), prose("b"), prose("c")] }, []);
    const occurrences = (host.textContent ?? "").split("taken by position").length - 1;
    expect(occurrences).toBe(1);

    /* A dialog-only list has nothing to caveat, and a caveat with nothing to
       caveat is the noise the gap vocabulary exists to avoid. */
    act(() => root.render(<div />));
    drawPanel({ kind: "complete", items: [] }, []);
    expect(host.textContent).not.toContain("taken by position");
  });

  it("selects the asking session in one hash write and clears stale selpid", () => {
    vi.setSystemTime(NOW);
    window.location.hash = "#questions?sel=%24old&selpid=999";
    const feed = manualTransport();
    mountApp(feed.transport);
    act(() => feed.push(proseState()));
    const card = host.querySelector<HTMLElement>('[data-question-kind="prose"]');
    expect(card).not.toBeNull();
    act(() => card?.click());
    const hash = decodeURIComponent(window.location.hash);
    expect(hash).toContain("#sessions");
    expect(hash).toContain("sel=$1");
    expect(hash).not.toContain("selpid");
  });
});

describe("freshness belongs to App's ticking clock", () => {
  it("ages a complete view into a named partial view without another payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.location.hash = "#questions";
    const feed = manualTransport();
    mountApp(feed.transport);
    const complete = read({ rows: [], questions: { kind: "complete", items: [] } });
    act(() => feed.push(complete));
    await act(async () => {});
    expect(host.textContent).toContain("Nothing needs you.");

    await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect(host.textContent).not.toContain("Nothing needs you.");
    expect(host.textContent).toContain("This list may be incomplete");
    expect(host.textContent).toContain("fleet snapshot is stale");
  });
});
