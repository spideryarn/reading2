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
import { artefactHref, describeArtefactCheck, type CheckedArtefact } from "../tools/fleet/artefact-ref";
import type { DecisionRow, DecisionWireRecord } from "../tools/fleet/wire";

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
    author: { kind: "overseer" },
    consequence: "medium",
    reversibility: "easy",
    domain: "product",
    recommendation: { kind: "recorded", value: null },
    evidence: { kind: "recorded", value: [] },
    gregAsked: "no",
    confidence: null,
  },
  ageMs: 3_600_000,
  pendingReview: true,
  sessions: [
    {
      name: "live-session",
      state: { kind: "same-run-as-last-verified", since: "2026-09-09T10:00:00.000Z" },
    },
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
    schema: 2,
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
    historyWithheld: 0,
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
      {
        schema: 2,
        kind: "never-written",
        composedAt: "2026-09-09T11:20:00.000Z",
        why: "the decision log has never been written",
      },
      calls,
    );

    expect(host.textContent).toContain("No decision has been recorded here yet");
    expect(calls).toHaveLength(1);
  });

  it("pressing the Decisions button writes the hash, switches the panel, and fetches", async () => {
    const calls: AbortSignal[] = [];
    await mountFull(
      "#sessions",
      {
        schema: 2,
        kind: "never-written",
        composedAt: "2026-09-09T11:20:00.000Z",
        why: "the decision log has never been written",
      },
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
    await renderPanel({
      schema: 2,
      kind: "unreadable",
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "line four is not valid JSON",
    });
    expect(host.textContent).toContain("The decision record could not be read");
    expect(host.textContent).toContain("This is not an empty record");
    expect(host.textContent).not.toContain("Nothing is waiting for review");
  });

  it("states when mandatory unreviewed rows exceeded the response bound", async () => {
    await renderPanel({
      schema: 2,
      kind: "oversized-unreviewed",
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "unreviewed rows alone exceed the response bound",
      unreviewedCount: 12,
      limitBytes: 2_097_152,
    });
    /* The copy names the decisions AND the history they replace, not "the
       unreviewed decisions", because a small pending successor with a long
       superseded ancestry trips this same arm. */
    expect(host.textContent).toContain("too large to send");
    expect(host.textContent).toContain("superseded history they replace");
    expect(host.textContent).toContain("refused to truncate 12 unreviewed decisions");
  });

  it("states when the input file exceeds the synchronous-read bound", async () => {
    await renderPanel({
      schema: 2,
      kind: "oversized-file",
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "the file exceeds the route's bounded synchronous work",
      sizeBytes: 4_000_001,
      limitBytes: 4_000_000,
    });
    expect(host.textContent).toContain("too large to read synchronously");
    expect(host.textContent).toContain("refused to read 4000001 bytes");
  });

  it.each([
    {
      schema: 2 as const,
      kind: "never-written" as const,
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "the record has never been written",
    },
    {
      schema: 2 as const,
      kind: "unreadable" as const,
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "the record cannot be read",
    },
    {
      schema: 2 as const,
      kind: "oversized-unreviewed" as const,
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "required rows do not fit",
      unreviewedCount: 2,
      limitBytes: 2_097_152,
    },
    {
      schema: 2 as const,
      kind: "oversized-file" as const,
      composedAt: "2026-09-09T11:20:00.000Z",
      why: "the input is too large",
      sizeBytes: 4_000_001,
      limitBytes: 4_000_000,
    },
    decisionsView(),
  ])("draws the composition instant for server answer $kind", async (view) => {
    await renderPanel(view);
    expect(host.textContent).toContain("Composed at 2026-09-09T11:20:00.000Z");
    expect(host.querySelector('time[datetime="2026-09-09T11:20:00.000Z"]')).not.toBeNull();
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

  it("names withheld rows as history without claiming every one was reviewed", async () => {
    await renderPanel(decisionsView({ historyWithheld: 2 }));
    expect(host.textContent).toContain("2 older decisions are not shown from history");
    expect(host.textContent).not.toContain("older reviewed decisions");
  });

  it("draws all three session states distinctly, including both unavailable reasons", async () => {
    await renderPanel(decisionsView());
    const opener = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    if (opener === null) throw new Error("the decision row disclosure was not drawn");
    await act(async () => opener.click());

    const text = host.textContent ?? "";
    expect(text).toContain("live-sessionsame run (as last verified)");
    expect(text).toContain("last verified since 2026-09-09T10:00:00.000Z");
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

function rowWith(id: string, over: Partial<DecisionWireRecord>): DecisionRow {
  return { ...ROW, sessions: [], record: { ...ROW.record, id, ...over } };
}

async function openAll(): Promise<void> {
  for (const opener of [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')]) {
    await act(async () => opener.click());
  }
}

function card(id: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`#decision-${id}`);
  if (found === null) throw new Error(`no card #decision-${id}`);
  return found;
}

const SESSION_AUTHOR = {
  kind: "session" as const,
  name: "work-reports",
  execution: { kind: "not-found" as const },
};

describe("schema 2 on the card", () => {
  it("says who decided, separately from who recorded, and never calls a V1 author the Overseer", async () => {
    const rows = [
      rowWith("dec-sess2222", {
        recordedBy: "daemon",
        author: SESSION_AUTHOR,
        touches: [{ kind: "decided", at: "2026-09-09T10:20:00.000Z", by: "daemon", what: "decided" }],
      }),
      rowWith("dec-over2222", { author: { kind: "overseer" } }),
      rowWith("dec-greg2222", { author: { kind: "greg" }, recordedBy: "greg" }),
      rowWith("dec-lega2222", { author: { kind: "legacy-unrecorded" } }),
    ];
    await renderPanel(decisionsView({ rows, aggregates: { kind: "counts", notYetReviewed: 4, trailingSevenDays: { decisions: 4, reviews: 0, reversals: 0 } } }));

    expect(card("dec-sess2222").textContent).toContain("decided by work-reports (session)");
    expect(card("dec-sess2222").textContent).toContain("recorded by the report drain");
    expect(card("dec-over2222").textContent).toContain("decided by the Overseer");
    expect(card("dec-over2222").textContent).not.toContain("report drain");
    expect(card("dec-greg2222").textContent).toContain("decided by Greg");
    expect(card("dec-lega2222").textContent).toContain("author not recorded");
    expect(card("dec-lega2222").textContent).not.toContain("decided by the Overseer");
  });

  it("shows consequence and reversibility on the closed card, and not recorded for V1", async () => {
    const rows = [
      rowWith("dec-high2222", { consequence: "high", reversibility: "one-way" }),
      rowWith("dec-lega2222", { author: { kind: "legacy-unrecorded" }, consequence: "not-recorded", reversibility: "not-recorded" }),
    ];
    await renderPanel(decisionsView({ rows, aggregates: { kind: "counts", notYetReviewed: 2, trailingSevenDays: { decisions: 2, reviews: 0, reversals: 0 } } }));
    expect(card("dec-high2222").textContent).toContain("high consequence");
    expect(card("dec-high2222").textContent).toContain("one-way");
    expect(card("dec-lega2222").textContent).toContain("consequence not recorded");
    expect(card("dec-lega2222").textContent).toContain("reversibility not recorded");
  });

  it.each([
    ["no", "the author says Greg was not asked"],
    ["asked-answered", "the author says Greg answered"],
    ["asked-awaiting", "the author says Greg has been asked and has not answered"],
    ["not-recorded", "whether Greg was asked was not recorded"],
  ] as const)("renders gregAsked %s as the author's claim, apart from the review state", async (gregAsked, words) => {
    await renderPanel(decisionsView({ rows: [rowWith("dec-askd2222", { gregAsked })] }));
    await openAll();
    const claim = card("dec-askd2222").querySelector<HTMLElement>('[data-testid="greg-asked-claim"]');
    expect(claim?.textContent).toBe(words);
    /* The review state is a pill and still says what the fold says; the claim is
       never one, so "the author says Greg answered" cannot look like review. */
    expect(claim?.closest(".tw\\:rounded-full")).toBeNull();
    expect(card("dec-askd2222").textContent).toContain("needs review");
  });

  it("shows domain, recommendation and confidence, with confidence as a small annotation", async () => {
    await renderPanel(
      decisionsView({
        rows: [rowWith("dec-reco2222", { domain: "technical", recommendation: { kind: "recorded", value: "Try the small shape first." }, confidence: "low" })],
      }),
    );
    await openAll();
    const text = card("dec-reco2222").textContent ?? "";
    expect(text).toContain("technical");
    expect(text).toContain("Try the small shape first.");
    expect(card("dec-reco2222").querySelector('[data-testid="decision-confidence"]')?.textContent).toBe("author's confidence: low");
  });

  it("links evidence only through artefactHref, and not at all for a commit found only on the box", async () => {
    const evidence: CheckedArtefact[] = [
      { ref: { kind: "commit", sha: "f9970832" }, check: { state: "on-dev" } },
      { ref: { kind: "commit", sha: "abc1234" }, check: { state: "found-locally" } },
      { ref: { kind: "path", path: "docs/a+b@c.md" }, check: { state: "on-dev" } },
      { ref: { kind: "decision", id: "dec-a3k9mq2p" }, check: { state: "found" } },
      { ref: { kind: "queue-item", id: "qi-evwdxpkf" }, check: { state: "unchecked", why: "the queue was locked" } },
    ];
    await renderPanel(decisionsView({ rows: [rowWith("dec-evid2222", { evidence: { kind: "recorded", value: evidence } })] }));
    await openAll();
    const list = card("dec-evid2222").querySelector<HTMLElement>('[data-testid="decision-evidence"]');
    if (list === null) throw new Error("no evidence list");

    const links = [...list.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      evidence.map((item) => artefactHref(item)).filter((href) => href !== null),
    );
    for (const link of links) {
      const external = link.getAttribute("href")?.startsWith("https://") === true;
      expect(link.getAttribute("rel")).toBe("noreferrer");
      expect(link.getAttribute("target")).toBe(external ? "_blank" : null);
    }
    const local = [...list.querySelectorAll("li")].find((item) => item.textContent?.includes("commit:abc1234"));
    expect(local).toBeDefined();
    expect(local?.querySelector("a")).toBeNull();
    expect(local?.textContent).toContain(describeArtefactCheck({ state: "found-locally" }));
    expect(list.textContent).toContain("not checked: the queue was locked");
  });

  it("says evidence was not recorded for V1, and none was given for an empty list", async () => {
    await renderPanel(
      decisionsView({
        rows: [rowWith("dec-none2222", { evidence: { kind: "recorded", value: [] } }), rowWith("dec-lega2222", { evidence: { kind: "not-recorded" } })],
        aggregates: { kind: "counts", notYetReviewed: 2, trailingSevenDays: { decisions: 2, reviews: 0, reversals: 0 } },
      }),
    );
    await openAll();
    expect(card("dec-none2222").textContent).toContain("no evidence given");
    expect(card("dec-lega2222").textContent).toContain("evidence not recorded");
  });

  it("gives every card an id so #decision-<id> anchors land on it", async () => {
    await renderPanel(decisionsView());
    expect(card(ROW.record.id)).toBeDefined();
  });

  it("filters rows with the search box, case-insensitively, without reordering them", async () => {
    const rows = [
      rowWith("dec-aaaa2222", { question: "Zebra first?" }),
      rowWith("dec-bbbb2222", { question: "Nothing striped?" }),
      rowWith("dec-cccc2222", { recommendation: { kind: "recorded", value: "A ZEBRA crossing." } }),
    ];
    await renderPanel(decisionsView({ rows, aggregates: { kind: "counts", notYetReviewed: 3, trailingSevenDays: { decisions: 3, reviews: 0, reversals: 0 } } }));
    const drawn = () => [...host.querySelectorAll<HTMLElement>('[id^="decision-"]')].map((element) => element.id);
    expect(drawn()).toEqual(["decision-dec-aaaa2222", "decision-dec-bbbb2222", "decision-dec-cccc2222"]);

    const input = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (input === null) throw new Error("no search box");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const type = async (value: string) =>
      act(async () => {
        setValue?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

    await type("zebra");
    expect(drawn()).toEqual(["decision-dec-aaaa2222", "decision-dec-cccc2222"]);
    await type("no such thing");
    expect(drawn()).toEqual([]);
    expect(host.textContent).toContain("No decision shown here matches");
    await type("");
    expect(drawn()).toEqual(["decision-dec-aaaa2222", "decision-dec-bbbb2222", "decision-dec-cccc2222"]);
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
