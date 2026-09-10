// @vitest-environment jsdom
/**
 * The proposal at the browser's end of the wire — the third parser
 * (`parseAttentionItem` in tools/fleet/web/src/types.ts) and the card that draws
 * it (tools/fleet/web/src/AttentionPanel.tsx). Plan 260910f Stage 2.
 *
 * Two promises are held here, and neither is a styling preference:
 *
 *  - **Nothing is sent.** The card gains no control. A proposal is text with an
 *    attribution; the only buttons on a card are the stretched link that selects
 *    the session and the `Explain` triggers, as before.
 *  - **No caveat wallpaper.** `off`, `not-applicable`, `not-reported` and
 *    `not-reached` draw exactly what a card drew before proposals existed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AttentionPanel } from "../tools/fleet/web/src/AttentionPanel";
import { parseFleetState, type FleetState } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const FRESH = "2026-09-09T11:59:30.000Z";
const BY = { kind: "model", model: "openai/gpt-5.6-luna", via: "overseer" };
const QUOTE = "Tell me which wording you'd rather and I'll use it.";

const PROPOSED = {
  kind: "proposed",
  id: "fp-1:v2",
  recipient: "fable",
  reason: "it is a question of wording, which Fable is for",
  asks: QUOTE,
  by: BY,
  reach: { kind: "unavailable", why: "the last usage pass found this account's Claude limit hit" },
};

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

/** A prose item as the Overseer publishes it; `proposal` absent means an older producer. */
function proseItem(proposal?: unknown): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: "prose-1",
    sessionId: "$1",
    sessionName: "copy-agent",
    waitingSince: "2026-09-09T11:30:00.000Z",
    kind: "product",
    evidence: {
      kind: "prose",
      excerpt: `Two wordings are in the plan.\n${QUOTE}`,
      why: "the turn ended by handing over a wording decision",
    },
    answerability: { kind: "phone" },
    duplicates: [],
  };
  if (proposal !== undefined) item["proposal"] = proposal;
  return item;
}

function read(items: readonly unknown[]): FleetState {
  const parsed = parseFleetState(
    {
      schema: 1,
      servedAt: new Date(NOW).toISOString(),
      rows: [],
      collectedAt: FRESH,
      tmuxServerPid: 1,
      tookMs: 10,
      error: null,
      health: null,
      refreshMs: 60_000,
      answeringEnabled: true,
      attemptedAt: FRESH,
      attention: {
        kind: "published",
        coordinatorWrittenAt: FRESH,
        list: { kind: "list", items, sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: FRESH },
      },
      questions: { kind: "complete", items: [] },
      overseer: { kind: "not-asked" },
      usage: { kind: "not-asked" },
    },
    NOW,
  );
  if (!parsed.ok) throw new Error(parsed.why);
  return parsed.state;
}

function listOf(state: FleetState) {
  if (state.attention.kind !== "published") throw new Error(`expected a published inbox, got ${state.attention.kind}`);
  return state.attention.list;
}

function draw(items: readonly unknown[]): void {
  const state = read(items);
  act(() => root.render(<AttentionPanel attention={state.attention} now={NOW} receivedAt={NOW} onSelect={() => {}} />));
}

describe("the browser's parser", () => {
  it("reads a proposal back whole", () => {
    const list = listOf(read([proseItem(PROPOSED)]));
    if (list.kind !== "list") throw new Error(`expected a list, got ${list.kind}`);
    expect(list.items[0]?.proposal).toEqual(PROPOSED);
  });

  it("reads an item from an older producer, with no proposal, as `not-reported` — not a failure", () => {
    const list = listOf(read([proseItem()]));
    if (list.kind !== "list") throw new Error(`expected a list, got ${list.kind}`);
    expect(list.items[0]?.proposal).toEqual({ kind: "not-reported" });
  });

  it("refuses a malformed proposal, every arm strictly, rather than half-drawing one", () => {
    for (const proposal of [
      { kind: "sent" },
      { ...PROPOSED, recipient: "gpt" },
      { ...PROPOSED, reach: undefined },
      { ...PROPOSED, asks: "" },
      { ...PROPOSED, by: { kind: "person", model: "Greg", via: "overseer" } },
      { kind: "unplaced", id: "i", by: BY },
      { kind: "off", why: "" },
      "fable",
    ]) {
      expect(listOf(read([proseItem(JSON.parse(JSON.stringify(proposal)))])).kind, JSON.stringify(proposal)).toBe("unknown");
    }
  });
});

describe("the card", () => {
  it("draws the proposal, its reason, its quote and its attribution — and adds no control", () => {
    draw([proseItem(PROPOSED)]);
    const text = host.textContent ?? "";
    expect(text).toContain("Proposed: ask Fable");
    expect(text).toContain("it is a question of wording, which Fable is for");
    expect(text).toContain(QUOTE);
    expect(text).toContain("openai/gpt-5.6-luna");
    expect(text).toContain("nothing has been sent");
    // Missing capability is SHOWN, never substituted: it still says Fable.
    expect(text).toMatch(/not available/i);

    // NO NEW CONTROL. The only buttons are the stretched link that SELECTS the
    // session and the Explain triggers; nothing that could deliver a proposal.
    const buttons = [...host.querySelectorAll("button")];
    for (const b of buttons) {
      expect(b.classList.contains("session-open") || b.classList.contains("explain"), b.outerHTML).toBe(true);
    }
    expect(host.querySelectorAll("form, input, textarea, a[href]")).toHaveLength(0);
  });

  it("never presents a proposal as Greg's, even when it proposes asking Greg", () => {
    draw([proseItem({ ...PROPOSED, recipient: "greg", reach: { kind: "available" } })]);
    const text = host.textContent ?? "";
    expect(text).toContain("openai/gpt-5.6-luna");
    expect(text).not.toMatch(/greg (says|said|proposes|proposed|decided|approved)/i);
    expect(text).not.toMatch(/(proposed|proposal) by greg/i);
  });

  it("keeps the tail one tap away, with its position caveat, and labels the quote as what the proposal is about", () => {
    draw([proseItem(PROPOSED)]);
    const details = host.querySelector("details.attention-evidence");
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain("taken by position rather than by search");
    // The quote is in the flow, outside the disclosure.
    const quote = [...host.querySelectorAll("blockquote")].find((q) => q.textContent?.includes(QUOTE));
    expect(quote).toBeDefined();
    expect(details?.contains(quote ?? null)).toBe(false);
  });

  it("draws `unplaced` as one plain line, with no holder named", () => {
    draw([proseItem({ kind: "unplaced", id: "fp:v2", why: "it could be technical or product", by: BY })]);
    const text = host.textContent ?? "";
    expect(text).toContain("No proposal — the model could not tell who holds the answer");
    expect(text).not.toContain("Proposed:");
  });

  it("draws NOTHING extra for `off`, `not-reached`, `not-applicable` or `not-reported`", () => {
    draw([proseItem()]);
    const before = host.innerHTML;
    expect(before).not.toContain("Proposed");
    for (const proposal of [
      { kind: "off", why: "proposals are off: set OVERSEER_PROPOSALS=1" },
      { kind: "not-reached", why: "the budget refused the re-read" },
      { kind: "not-applicable" },
      { kind: "not-reported" },
    ]) {
      draw([proseItem(proposal)]);
      expect(host.innerHTML, JSON.stringify(proposal)).toBe(before);
    }
  });
});
