// @vitest-environment jsdom
/**
 * The Decisions tab: every kind of absence stays distinct, and a full record
 * exposes the alternatives Greg needs in order to review what happened in his
 * name. The composition tests also guard the two registrations TypeScript
 * cannot: membership in `MODES`, and the mount arm in `App.tsx`.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import { DecisionsPanel } from "../tools/fleet/web/src/DecisionsPanel";
import { Dock } from "../tools/fleet/web/src/Dock";
import type { DecisionsApi, DecisionsView } from "../tools/fleet/web/src/decisions-client";
import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";
import type { Transport } from "../tools/fleet/web/src/transport";
import type { DecisionRow } from "../tools/fleet/wire";

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
  vi.restoreAllMocks();
});

const ROW: DecisionRow = {
  record: {
    id: "dec-23456789",
    recordedBy: "overseer",
    class: "decision",
    question: "Should the dock scroll when its active mode is out of view?",
    options: [
      { name: "Leave it", tradeoffs: "No implementation cost, but the active mode can stay unreachable." },
      { name: "Scroll nearest", tradeoffs: "Keeps the chosen mode visible, but moves the dock on a direct load." },
    ],
    chose: { option: "Scroll nearest", note: "Move immediately, without a smooth transition." },
    why: "A selected mode that cannot be reached makes the hash and the visible navigation disagree.",
    advisers: ["sol", "fable"],
    bearsOn: {
      sessions: [
        { name: "live-session", execution: { kind: "not-found" } },
        { name: "old-session", execution: { kind: "not-found" } },
        { name: "unknown-session", execution: { kind: "not-found" } },
        { name: "ambiguous-session", execution: { kind: "not-found" } },
      ],
      plan: "docs/plans/260909e-decisions-made.md",
    },
    decidedAt: "2026-09-09T10:20:00.000Z",
    supersedes: null,
    supersededBy: null,
    reviewed: false,
    reviewedAt: null,
    reviewNote: null,
    reversed: false,
    reversedAt: null,
    reversedWhy: null,
    touches: [
      {
        kind: "decided",
        at: "2026-09-09T10:20:00.000Z",
        by: "overseer",
        what: "recorded the dock decision",
      },
    ],
  },
  ageMs: 3_600_000,
  pendingReview: true,
  sessions: [
    { name: "live-session", state: { kind: "live" } },
    { name: "old-session", state: { kind: "ended-or-replaced" } },
    {
      name: "unknown-session",
      state: { kind: "unavailable", why: { kind: "checkpoint-unavailable" } },
    },
    {
      name: "ambiguous-session",
      state: {
        kind: "unavailable",
        why: { kind: "execution-unavailable", detail: "session ambiguous-session is ambiguous in the register" },
      },
    },
  ],
};

function decisionsView(
  over: Partial<Extract<DecisionsView, { kind: "decisions" }>> = {},
): Extract<DecisionsView, { kind: "decisions" }> {
  return {
    schema: 1,
    kind: "decisions",
    version: "1.ev-1",
    path: "/tmp/fake/decisions.jsonl",
    composedAt: "2026-09-09T11:20:00.000Z",
    checkpoint: { kind: "current" },
    aggregates: {
      kind: "counts",
      notYetReviewed: 1,
      trailingSevenDays: { decisions: 3, reviews: 2, reversals: 1 },
    },
    rows: [ROW],
    reviewedWithheld: 0,
    problems: [],
    ...over,
  };
}

function apiOf(view: DecisionsView, calls: AbortSignal[] = []): DecisionsApi {
  return {
    fetch: async (signal) => {
      if (signal !== undefined) calls.push(signal);
      return view;
    },
  };
}

async function renderPanel(view: DecisionsView): Promise<void> {
  await act(async () => {
    root.render(<DecisionsPanel api={apiOf(view)} />);
  });
}

const quietTransport: Transport = () => ({ refresh: () => {}, stop: () => {} });

async function mountFull(hash: string, view: DecisionsView, calls: AbortSignal[] = []): Promise<void> {
  window.location.hash = hash;
  await act(async () => {
    root.render(
      <App
        transport={quietTransport}
        decisionsApi={apiOf(view, calls)}
        actionsPollMs={0}
      />,
    );
  });
}

describe("the tab is actually registered", () => {
  it("is in the mode list, with a standalone label, and the dock follows the registers", async () => {
    expect(MODES).toContain("decisions");
    expect(MODE_LABELS.decisions).toBe("Decisions");

    await mountFull("#sessions", decisionsView());
    const labels = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual(MODES.map((mode) => MODE_LABELS[mode]));
  });

  it("opens from the hash through App's mount arm and starts the on-demand request", async () => {
    const calls: AbortSignal[] = [];
    await mountFull(
      "#decisions",
      { schema: 1, kind: "never-written", why: "the decision log has never been written" },
      calls,
    );

    expect(host.textContent).toContain("No decision has been recorded here yet");
    expect(calls).toHaveLength(1);
  });

  it("pressing the Decisions button writes the hash, switches the panel, and fetches", async () => {
    const calls: AbortSignal[] = [];
    await mountFull(
      "#sessions",
      { schema: 1, kind: "never-written", why: "the decision log has never been written" },
      calls,
    );
    expect(calls).toHaveLength(0);

    const button = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
      (candidate) => candidate.getAttribute("aria-label") === "Decisions",
    );
    if (button === undefined) throw new Error("the Decisions dock button was not drawn");
    await act(async () => button.click());

    expect(window.location.hash).toBe("#decisions");
    expect(host.textContent).toContain("No decision has been recorded here yet");
    expect(calls).toHaveLength(1);
  });

  it("global Refresh refetches and replaces a stale headline with a failed answer", async () => {
    let calls = 0;
    const api: DecisionsApi = {
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? decisionsView()
          : { kind: "no-answer", why: "this browser could not reach the dashboard" };
      },
    };
    window.location.hash = "#decisions";
    await act(async () => {
      root.render(<App transport={quietTransport} decisionsApi={api} actionsPollMs={0} />);
    });
    expect(host.querySelector('[data-testid="decisions-headline"]')?.textContent).toContain("1");

    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh now"]');
    if (refresh === null) throw new Error("the dock's Refresh button was not drawn");
    await act(async () => refresh.click());

    expect(calls).toBe(2);
    expect(host.textContent).toContain("This browser did not get an answer from the decisions API");
    expect(host.querySelector('[data-testid="decisions-headline"]')).toBeNull();
  });

  it("an empty readable log says every decision is reviewed, not that none was ever recorded", async () => {
    await renderPanel(
      decisionsView({
        aggregates: {
          kind: "counts",
          notYetReviewed: 0,
          trailingSevenDays: { decisions: 0, reviews: 2, reversals: 0 },
        },
        rows: [],
      }),
    );
    expect(host.textContent).toContain("Nothing is waiting for review");
    expect(host.textContent).toContain("every decision in it has been reviewed");
    expect(host.textContent).not.toContain("No decision has been recorded here yet");
  });
});

describe("the record's distinctions are visible", () => {
  it("keeps a browser failure in the browser's voice", async () => {
    await renderPanel({ kind: "no-answer", why: "this browser could not reach the dashboard" });
    expect(host.textContent).toContain("This browser did not get an answer from the decisions API");
    expect(host.textContent).not.toContain("The decision record could not be read");
  });

  it("does not draw an unreadable record as an empty one", async () => {
    await renderPanel({ schema: 1, kind: "unreadable", why: "line four is not valid JSON" });
    expect(host.textContent).toContain("The decision record could not be read");
    expect(host.textContent).toContain("This is not an empty record");
    expect(host.textContent).not.toContain("Nothing is waiting for review");
  });

  it("states when mandatory unreviewed rows exceeded the response bound", async () => {
    await renderPanel({
      schema: 1,
      kind: "oversized-unreviewed",
      why: "unreviewed rows alone exceed the response bound",
      unreviewedCount: 12,
      limitBytes: 2_097_152,
    });
    expect(host.textContent).toContain("too large to show safely");
    expect(host.textContent).toContain("refused to truncate 12 unreviewed decisions");
  });

  it("states an unavailable aggregate without drawing a numeric headline", async () => {
    await renderPanel(
      decisionsView({
        aggregates: {
          kind: "unavailable",
          why: "the record has one problem; a line could have hidden a decision, review, or reversal",
        },
        problems: [{ kind: "unreadable-line", why: "line nine is not JSON", eventId: null }],
      }),
    );
    const headline = host.querySelector<HTMLElement>('[data-testid="decisions-headline"]');
    expect(headline?.textContent).toContain("The not-yet-reviewed count is unavailable");
    expect(headline?.textContent).toContain("a line could have hidden a decision");
    expect(headline?.textContent).not.toContain("0");
  });

  it("draws all three session states distinctly, including both unavailable reasons", async () => {
    await renderPanel(decisionsView());
    const opener = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    if (opener === null) throw new Error("the decision row disclosure was not drawn");
    await act(async () => opener.click());

    const text = host.textContent ?? "";
    expect(text).toContain("live-sessionlive");
    expect(text).toContain("same verified run is still in the Overseer register");
    expect(text).toContain("old-sessionended or replaced");
    expect(text).toContain("recorded with the decision is no longer the verified run");
    expect(text).toContain("unknown-sessionstate unavailable");
    expect(text).toContain("the Overseer checkpoint could not be read");
    expect(text).toContain("ambiguous-sessionstate unavailable");
    expect(text).toContain("ambiguous in the register");
  });

  it("a complete row exposes the question, class, options, choice, why, advisers and sessions", async () => {
    await renderPanel(decisionsView());
    expect(host.textContent).toContain(ROW.record.question);
    expect(host.textContent).toContain("decision");
    expect(host.textContent).toContain("Chose Scroll nearest — Move immediately, without a smooth transition.");

    const opener = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    if (opener === null) throw new Error("the decision row disclosure was not drawn");
    await act(async () => opener.click());

    const text = host.textContent ?? "";
    expect(text).toContain("Leave it — No implementation cost, but the active mode can stay unreachable.");
    expect(text).toContain("Scroll nearest — chosen — Keeps the chosen mode visible");
    expect(text).toContain(ROW.record.why);
    expect(text).toContain("GPT Sol, Fable");
    expect(text).toContain("live-session");
    expect(text).toContain("docs/plans/260909e-decisions-made.md");
  });

  it("draws the instant at which the payload was composed", async () => {
    await renderPanel(decisionsView());
    expect(host.textContent).toContain("Composed at 2026-09-09T11:20:00.000Z");
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-09T11:20:00.000Z");
  });

  it("advances decision ages while the fetched snapshot remains open", async () => {
    const receivedAt = Date.parse("2026-09-09T11:20:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(receivedAt);
    const api = apiOf(decisionsView());
    await act(async () => {
      root.render(<DecisionsPanel api={api} nowMs={receivedAt} />);
    });
    expect(host.textContent).toContain("1h ago");

    await act(async () => {
      root.render(<DecisionsPanel api={api} nowMs={receivedAt + 3_600_000} />);
    });
    expect(host.textContent).toContain("2h ago");
  });
});

describe("the dock's overflow affordance", () => {
  async function renderDock(fitClass = " dock-fit-2"): Promise<HTMLDivElement> {
    const barRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(
        <Dock
          mode="decisions"
          onChoose={() => {}}
          needsYou={0}
          onRefresh={() => {}}
          fitClass={fitClass}
          barRef={barRef}
        />,
      );
    });
    if (barRef.current === null) throw new Error("the dock ref was not attached");
    return barRef.current;
  }

  it("shows right, both, then left fades as a person scrolls, and updates on resize", async () => {
    const dock = await renderDock();
    let scrollLeft = 0;
    let clientWidth = 100;
    Object.defineProperties(dock, {
      clientWidth: { configurable: true, get: () => clientWidth },
      scrollWidth: { configurable: true, get: () => 300 },
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (next: number) => {
          scrollLeft = next;
        },
      },
    });

    await act(async () => dock.dispatchEvent(new Event("scroll")));
    expect(dock.classList.contains("dock-overflow-left")).toBe(false);
    expect(dock.classList.contains("dock-overflow-right")).toBe(true);

    scrollLeft = 100;
    await act(async () => dock.dispatchEvent(new Event("scroll")));
    expect(dock.classList.contains("dock-overflow-left")).toBe(true);
    expect(dock.classList.contains("dock-overflow-right")).toBe(true);

    scrollLeft = 200;
    await act(async () => dock.dispatchEvent(new Event("scroll")));
    expect(dock.classList.contains("dock-overflow-left")).toBe(true);
    expect(dock.classList.contains("dock-overflow-right")).toBe(false);

    clientWidth = 300;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(dock.classList.contains("dock-overflow-left")).toBe(false);
    expect(dock.classList.contains("dock-overflow-right")).toBe(false);
  });

  it("scrolls the active mode nearest again when the fit rung changes, then recomputes overflow", async () => {
    let scrollLeft = 0;
    const scrollIntoView = vi.fn(function (this: HTMLElement, options?: ScrollIntoViewOptions) {
      expect(options).toEqual({ inline: "nearest", block: "nearest" });
      scrollLeft = 200;
    });
    const barRef = createRef<HTMLDivElement>();

    await act(async () => {
      root.render(
        <Dock
          mode="decisions"
          onChoose={() => {}}
          needsYou={0}
          onRefresh={() => {}}
          fitClass=" dock-fit-1"
          barRef={barRef}
        />,
      );
    });
    const dock = barRef.current;
    if (dock === null) throw new Error("the dock ref was not attached");
    Object.defineProperties(dock, {
      clientWidth: { configurable: true, get: () => 100 },
      scrollWidth: { configurable: true, get: () => 300 },
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (next: number) => {
          scrollLeft = next;
        },
      },
    });
    const active = dock.querySelector<HTMLButtonElement>(".dock-modes .dock-btn.on");
    if (active === null) throw new Error("the dock's active mode was not drawn");
    Object.defineProperty(active, "scrollIntoView", { configurable: true, value: scrollIntoView });

    await act(async () => {
      root.render(
        <Dock
          mode="decisions"
          onChoose={() => {}}
          needsYou={0}
          onRefresh={() => {}}
          fitClass=" dock-fit-2"
          barRef={barRef}
        />,
      );
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(barRef.current?.classList.contains("dock-overflow-left")).toBe(true);
    expect(barRef.current?.classList.contains("dock-overflow-right")).toBe(false);

    await act(async () => {
      root.render(
        <Dock
          mode="decisions"
          onChoose={() => {}}
          needsYou={0}
          onRefresh={() => {}}
          fitClass=" dock-fit-1"
          barRef={barRef}
        />,
      );
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    const ideas = dock.querySelector<HTMLButtonElement>('[aria-label="Queued ideas"]');
    if (ideas === null) throw new Error("the Queued ideas mode was not drawn");
    Object.defineProperty(ideas, "scrollIntoView", { configurable: true, value: scrollIntoView });
    await act(async () => {
      root.render(
        <Dock
          mode="ideas"
          onChoose={() => {}}
          needsYou={0}
          onRefresh={() => {}}
          fitClass=" dock-fit-1"
          barRef={barRef}
        />,
      );
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it("does not throw or invent a fade when scroll APIs and layout metrics are absent", async () => {
    const dock = await renderDock();
    expect(dock.classList.contains("dock-overflow-left")).toBe(false);
    expect(dock.classList.contains("dock-overflow-right")).toBe(false);
  });
});
