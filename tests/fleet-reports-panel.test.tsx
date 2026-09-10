// @vitest-environment jsdom
/**
 * The Claims section of the Decisions tab (plan 260910e, Stage 3a): every
 * claim reads as a claim, an unreported session reads as nothing said, and a
 * link is built only by `artefactHref`.
 */
import { randomUUID } from "node:crypto";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DecisionsPanel } from "../tools/fleet/web/src/DecisionsPanel";
import type { DecisionsApi, DecisionsView } from "../tools/fleet/web/src/decisions-client";
import type { ReportsApi, ReportsView } from "../tools/fleet/web/src/reports-client";
import { artefactHref } from "../tools/fleet/artefact-ref";
import type { DecisionRow, ReportsFeed, ReportWireClaim } from "../tools/fleet/wire";

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
});

const COMPOSED = "2026-09-10T12:05:00.000Z";

const NO_DECISIONS: DecisionsView = {
  schema: 2,
  kind: "never-written",
  composedAt: COMPOSED,
  why: "the decision log has never been written",
};

function claim(over: Partial<ReportWireClaim> = {}): ReportWireClaim {
  return {
    eventId: randomUUID(),
    claimedBy: { kind: "session", name: "work-reports" },
    submittedAt: "2026-09-10T11:59:00.000Z",
    receivedAt: "2026-09-10T12:00:00.000Z",
    execution: "same-verified-run",
    job: { plan: null, queueItem: null, occurrence: null },
    summary: "stage 3a tests written",
    artefacts: [],
    corrects: null,
    correctedBy: null,
    laterClaim: null,
    kind: "progress",
    ...over,
  } as ReportWireClaim;
}

function feed(recent: ReportWireClaim[], over: Partial<Extract<ReportsFeed, { kind: "reports" }>> = {}): ReportsFeed {
  return {
    schema: 1,
    kind: "reports",
    path: "/tmp/fake/reports.jsonl",
    composedAt: COMPOSED,
    sessions: { kind: "joined-with-register", rows: [] },
    recent,
    recentWithheld: 0,
    inFlight: 0,
    refused: 0,
    problems: [],
    ...over,
  };
}

function decisionsApi(view: DecisionsView): DecisionsApi {
  return { fetch: async () => view };
}

function reportsApi(view: ReportsView): ReportsApi {
  return { fetch: async () => view };
}

async function render(reports: ReportsView, decisions: DecisionsView = NO_DECISIONS): Promise<void> {
  await act(async () => {
    root.render(<DecisionsPanel api={decisionsApi(decisions)} reportsApi={reportsApi(reports)} />);
  });
}

function claims(): HTMLElement {
  const section = host.querySelector<HTMLElement>('[data-testid="claims"]');
  if (section === null) throw new Error("no Claims section");
  return section;
}

function claimCard(eventId: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-event-id="${eventId}"]`);
  if (found === null) throw new Error(`no claim ${eventId}`);
  return found;
}

describe("sessions", () => {
  it("draws a register session with no claim as unreported — nothing said, neutrally", async () => {
    const said = claim();
    await render(
      feed([said], {
        sessions: {
          kind: "joined-with-register",
          rows: [
            { name: "work-reports", register: "in-register", latest: { kind: "claimed", claims: 1, latest: said } },
            { name: "quiet-one", register: "in-register", latest: { kind: "unreported" } },
          ],
        },
      }),
    );
    const quiet = host.querySelector<HTMLElement>('[data-session="quiet-one"]');
    expect(quiet?.textContent).toContain("unreported — nothing said");
    // Not idle, stuck or failed, and not drawn as a state.
    expect(quiet?.querySelector('[data-slot="pill"]')).toBeNull();
    expect(quiet?.textContent).not.toMatch(/idle|stuck|failed/i);
    expect(host.querySelector('[data-session="work-reports"]')?.textContent).toContain("stage 3a tests written");
  });

  it("marks a session that reported but is not in the register", async () => {
    const said = claim({ claimedBy: { kind: "session", name: "gone-now" } });
    await render(
      feed([said], {
        sessions: {
          kind: "joined-with-register",
          rows: [{ name: "gone-now", register: "not-in-register", latest: { kind: "claimed", claims: 1, latest: said } }],
        },
      }),
    );
    expect(host.querySelector('[data-session="gone-now"]')?.textContent).toContain("not in the register");
  });

  it("never calls anyone unreported when the register could not be read", async () => {
    const said = claim();
    await render(
      feed([said], {
        sessions: {
          kind: "register-unavailable",
          why: "the Overseer checkpoint is absent",
          reported: [{ name: "work-reports", latest: { kind: "claimed", claims: 1, latest: said } }],
        },
      }),
    );
    expect(claims().textContent).toContain("the Overseer checkpoint is absent");
    expect(claims().textContent).toContain("cannot be told");
    expect(claims().textContent).not.toContain("unreported — nothing said");
  });
});

describe("a claim reads as a claim", () => {
  it("says who claimed it, and never draws a kind as a pill", async () => {
    const one = claim({ kind: "completed", ending: "finished", revisions: { reviewed: [], tested: [], merged: [] } } as Partial<ReportWireClaim>);
    const two = claim({ claimedBy: { kind: "greg" }, execution: null, kind: "blocked", on: "peer", needs: "a review" } as Partial<ReportWireClaim>);
    await render(feed([one, two]));
    expect(claimCard(one.eventId).textContent).toContain("claimed by session work-reports");
    expect(claimCard(two.eventId).textContent).toContain("claimed by Greg");
    expect(claims().querySelector('[data-slot="pill"]')).toBeNull();
    expect(claims().textContent).not.toMatch(/\b(done|ready|landed|contradicts)\b/i);
  });

  it("writes an empty revision list as not stated, and a stated one as its shas", async () => {
    const done = claim({
      kind: "completed",
      ending: "done-enough",
      revisions: { reviewed: [], tested: ["abc1234"], merged: [] },
    } as Partial<ReportWireClaim>);
    await render(feed([done]));
    const text = claimCard(done.eventId).textContent ?? "";
    expect(text).toContain("reviewed: not stated");
    expect(text).toContain("tested: abc1234");
    expect(text).toContain("merged: not stated");
    expect(text).not.toContain("not reviewed");
  });

  it("puts the execution comparison in words", async () => {
    const same = claim({ execution: "same-verified-run" });
    const different = claim({ execution: "different-verified-run" });
    const unknown = claim({ execution: { unverifiable: "the register has never verified a run for work-reports" } });
    await render(feed([same, different, unknown]));
    expect(claimCard(same.eventId).textContent).toContain("same run as the register's");
    expect(claimCard(different.eventId).textContent).toContain("a different run from the register's");
    expect(claimCard(unknown.eventId).textContent).toContain(
      "could not verify: the register has never verified a run for work-reports",
    );
  });

  it("shows a correction as attributed, and a later claim as only a later claim", async () => {
    const correctionId = randomUUID();
    const laterId = randomUUID();
    const corrected = claim({
      correctedBy: { eventId: correctionId, actor: { kind: "overseer" }, at: "2026-09-10T12:03:00.000Z" },
      laterClaim: laterId,
    });
    await render(feed([corrected]));
    const text = claimCard(corrected.eventId).textContent ?? "";
    expect(text).toContain(`corrected by ${correctionId}, by the Overseer`);
    expect(text).toContain(laterId);
    expect(text).not.toMatch(/contradict|disagree|superseded/i);
  });

  it("links an artefact only when it is on dev, through artefactHref", async () => {
    const onDev = { ref: { kind: "commit" as const, sha: "f9970832" }, check: { state: "on-dev" as const } };
    const local = { ref: { kind: "commit" as const, sha: "abc1234" }, check: { state: "found-locally" as const } };
    const missing = { ref: { kind: "path" as const, path: "docs/nope.md" }, check: { state: "not-found" as const } };
    const said = claim({ artefacts: [onDev, local, missing] });
    await render(feed([said]));
    const links = [...claimCard(said.eventId).querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([artefactHref(onDev)]);
    expect(claimCard(said.eventId).textContent).toContain("commit:abc1234");
    expect(claimCard(said.eventId).textContent).toContain("found on the box, not on dev");
    expect(claimCard(said.eventId).textContent).toContain("not found at receipt");
  });

  it("draws a summary containing javascript: as text, never as a link", async () => {
    const said = claim({ summary: "see javascript:alert(document.cookie) for the fix" });
    await render(feed([said]));
    expect(claimCard(said.eventId).textContent).toContain("javascript:alert(document.cookie)");
    expect(host.querySelector('a[href^="javascript"]')).toBeNull();
    expect(claimCard(said.eventId).querySelectorAll("a")).toHaveLength(0);
  });
});

describe("the silences are distinct", () => {
  it("says what has been submitted but not recorded when nothing was ever written", async () => {
    await render({ schema: 1, kind: "never-written", composedAt: COMPOSED, why: "reports.jsonl has never been written", inFlight: 2, refused: 0 });
    expect(claims().textContent).toContain("No report has been recorded here yet");
    expect(claims().textContent).toContain("2 submitted, not yet recorded");
  });

  it("does not draw an unreadable log as an empty one", async () => {
    await render({ schema: 1, kind: "unreadable", composedAt: COMPOSED, why: "reports.jsonl is gone" });
    expect(claims().textContent).toContain("could not be read");
    expect(claims().textContent).toContain("not an empty log");
  });

  it("keeps a browser failure in the browser's voice", async () => {
    await render({ kind: "no-answer", why: "this browser could not reach the dashboard" });
    expect(claims().textContent).toContain("did not get an answer from the reports API");
  });

  it("says in-flight and refused counts and how many claims were withheld", async () => {
    await render(feed([claim()], { inFlight: 3, refused: 1, recentWithheld: 7 }));
    expect(claims().textContent).toContain("3 submitted, not yet recorded");
    expect(claims().textContent).toContain("1 refused");
    expect(claims().textContent).toContain("7 older claims are not shown");
  });
});

const DECISION: DecisionRow = {
  record: {
    id: "dec-zebra222",
    recordedBy: "overseer",
    class: "decision",
    question: "Which zebra crossing?",
    options: [
      { name: "North", tradeoffs: "Closer." },
      { name: "South", tradeoffs: "Wider." },
    ],
    chose: { option: "North", note: null },
    why: "It is closer.",
    advisers: ["nobody"],
    bearsOn: { sessions: [], plan: null },
    decidedAt: "2026-09-10T11:00:00.000Z",
    supersedes: null,
    supersededBy: null,
    reviewed: false,
    reviewedAt: null,
    reviewNote: null,
    reversed: false,
    reversedAt: null,
    reversedWhy: null,
    touches: [{ kind: "decided", at: "2026-09-10T11:00:00.000Z", by: "overseer", what: "decided" }],
    author: { kind: "overseer" },
    consequence: "low",
    reversibility: "easy",
    domain: "product",
    recommendation: { kind: "recorded", value: null },
    evidence: { kind: "recorded", value: [] },
    gregAsked: "no",
    confidence: null,
  },
  ageMs: 60_000,
  pendingReview: true,
  sessions: [],
};

async function type(value: string): Promise<void> {
  const inputs = host.querySelectorAll<HTMLInputElement>('input[type="search"]');
  expect(inputs).toHaveLength(1);
  const input = inputs[0] as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const shownClaims = (): string[] =>
  [...host.querySelectorAll<HTMLElement>("[data-event-id]")].map((element) => element.dataset["eventId"] ?? "");

describe("the one search box", () => {
  it("filters claims when there are no decisions, without reordering them", async () => {
    const a = claim({ summary: "Zebra first" });
    const b = claim({ summary: "Nothing striped" });
    const c = claim({ kind: "blocked", on: "greg", needs: "a ZEBRA answer", summary: "blocked" } as Partial<ReportWireClaim>);
    await render(feed([a, b, c]));
    expect(shownClaims()).toEqual([a.eventId, b.eventId, c.eventId]);
    await type("zebra");
    expect(shownClaims()).toEqual([a.eventId, c.eventId]);
    await type("no such thing");
    expect(shownClaims()).toEqual([]);
    expect(claims().textContent).toContain("No claim shown here matches");
    await type("");
    expect(shownClaims()).toEqual([a.eventId, b.eventId, c.eventId]);
  });

  it("is the decisions' own box, and filters decisions and claims together", async () => {
    const a = claim({ summary: "Zebra first" });
    const b = claim({ summary: "Nothing striped" });
    await render(feed([a, b]), {
      schema: 2,
      kind: "decisions",
      version: "1.ev-1",
      path: "/tmp/fake/decisions.jsonl",
      composedAt: COMPOSED,
      checkpoint: { kind: "current" },
      aggregates: { kind: "counts", notYetReviewed: 1, trailingSevenDays: { decisions: 1, reviews: 0, reversals: 0 } },
      rows: [DECISION],
      historyWithheld: 0,
      problems: [],
    });
    await type("striped");
    expect(shownClaims()).toEqual([b.eventId]);
    expect(host.querySelector("#decision-dec-zebra222")).toBeNull();
    await type("zebra");
    expect(shownClaims()).toEqual([a.eventId]);
    expect(host.querySelector("#decision-dec-zebra222")).not.toBeNull();
  });
});
