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
    claudeSessionId: "00000000-0000-4000-8000-000000000001",
    execution: {
      kind: "verified",
      token: { boot: "boot-a", pid: 202, startTicks: 10 },
      harness: "claude-code",
      conversation: { kind: "verified", id: "00000000-0000-4000-8000-000000000001" },
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
  over: { answeringEnabled?: AnsweringReading; steer?: SteerApi; onSelect?: (id: string) => void; now?: number } = {},
): void {
  act(() => root.render(
    <QuestionsPanel
      view={view}
      rows={rows}
      answeringEnabled={over.answeringEnabled ?? { kind: "enabled" }}
      onSelect={over.onSelect ?? (() => {})}
      now={over.now ?? NOW}
      {...(over.steer === undefined ? {} : { steer: over.steer })}
    />,
  ));
}

function mountApp(transport: Transport, steer?: SteerApi): void {
  act(() => root.render(
    <App
      transport={transport}
      actionsApi={UNUSED_ACTIONS}
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
});

describe("which empty answer the view has earned", () => {
  it("keeps not-observed, partial and complete empty views distinct", () => {
    drawPanel({ kind: "not-observed", gaps: [{ kind: "collection-not-observed" }] });
    expect(host.textContent).toContain("Questions were not observed");
    expect(host.textContent).not.toContain("Nothing needs you");
    expect(host.textContent).not.toMatch(/\b0\b/);

    drawPanel({ kind: "partial", items: [], gaps: [{ kind: "questions-not-reported" }] });
    expect(host.textContent).toContain("This list may be incomplete");
    expect((host.textContent ?? "").toLowerCase()).not.toContain("nothing needs you");

    drawPanel({ kind: "complete", items: [] });
    expect(host.textContent).toContain("Nothing needs you.");
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
          conversation: { kind: "verified", id: "00000000-0000-4000-8000-000000000001" },
        },
      })],
    });
    drawPanel(replaced.questions, replaced.rows, { steer: recorder.api });
    expect(host.textContent).not.toContain("Sent.");
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
          conversation: { kind: "verified", id: "00000000-0000-4000-8000-000000000001" },
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
});

describe("prose stays observational", () => {
  function proseState(): FleetState {
    const source = proseSource();
    return read({ attention: attention([source]), questions: { kind: "complete", items: [wireProseItem()] } });
  }

  it("renders no writing control on a prose card", () => {
    const state = proseState();
    drawPanel(state.questions, state.rows);
    const card = host.querySelector<HTMLElement>('[data-question-kind="prose"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector("textarea")).toBeNull();
    expect([...(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((button) => !button.disabled)).toHaveLength(0);
    expect(card?.textContent).toContain("duplicate-agent");
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
    expect(host.textContent).toContain("Nothing needs you.");

    await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000));
    expect(host.textContent).not.toContain("Nothing needs you.");
    expect(host.textContent).toContain("This list may be incomplete");
    expect(host.textContent).toContain("fleet snapshot is stale");
  });
});
