// @vitest-environment jsdom
/**
 * The preview card on a session in the left-hand column.
 *
 * Beside an open detail the list's cards are `compact`: a question keeps its
 * prompt and says "N options — open it to read them". The preview is where the
 * dropped half can be read without switching session. It is a `Tooltip` on the
 * card's one button, so it has that surface's limits — `pointer-events: none`,
 * `role="tooltip"` — and several of the tests below are those limits.
 *
 * Real timers, because the page under test is the whole `App` and its mount
 * waits on a macrotask (`tick`); the open delay is waited out rather than
 * advanced.
 *
 * The fixtures are local copies of the ones in tests/fleet-history.test.tsx,
 * which does not export them.
 *
 * Plan: docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md § Stage 2.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import type { FeedApi, FeedView } from "../tools/fleet/web/src/feed-client";
import { PREVIEW_OPTION_CAP, PREVIEW_TEXT_CAP } from "../tools/fleet/web/src/SessionPreview";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import { parseFleetState, type FleetRow, type FleetState } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let undoWidth: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in this test")));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  undoWidth?.();
  undoWidth = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.location.hash = "";
  await tick();
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let pinnedWidth = 0;
function pinWidth(px: number): void {
  pinnedWidth = px;
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => pinnedWidth });
  undoWidth = () => {
    if (original) Object.defineProperty(Element.prototype, "clientWidth", original);
  };
}

/** A row as the SERVER would send it: `stateWith` parses it, so a question needs its wire `kind`. */
function sessionRow(id: string, name: string, over: Record<string, unknown> = {}): FleetRow {
  const status: FleetRow["status"] = { kind: "idle" };
  return {
    id,
    paneId: null,
    name,
    title: null,
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    repo: null,
    worktree: null,
    startedAt: "2026-09-08T10:00:00.000Z",
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: null,
    claudeSessionId: null,
    rawStatus: status,
    rawQuestion: null,
    ...over,
  } as FleetRow;
}

function question(prompt: string, labels: string[], material: Record<string, unknown> = { kind: "no-material" }): unknown {
  return {
    kind: "question",
    prompt,
    options: labels.map((label, i) => ({ label, key: { via: "digit", digit: String(i + 1) }, consequence: "once" })),
    material,
    gate: { kind: "conversation" },
  };
}

function stateWith(rows: FleetRow[]): FleetState {
  const read = parseFleetState(
    { schema: 1, rows, collectedAt: "2026-09-09T00:59:30.000Z", tmuxServerPid: 132280, servedAt: "2026-09-09T01:00:00.000Z" },
    Date.parse("2026-09-09T01:00:00.000Z"),
  );
  if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
  return read.state;
}

const EMPTY_FEED: FeedView = {
  kind: "feed",
  limit: 50,
  messages: [],
  undated: [],
  sessions: [],
  sessionsOffered: true,
  unreadableRows: 0,
  coverage: { kind: "complete" },
  collectedAt: null,
  readStartedAt: null,
  readFinishedAt: null,
  servedAt: null,
  tmuxServerPid: 132280,
};
const feedApi: FeedApi = { recent: () => Promise.resolve(EMPTY_FEED) };

const ASKING = "Which of these should the migration keep?";
const LABELS = ["Keep the column", "Drop the column", "Ask Greg first"];

/** The Sessions tab holding `alpha` and whatever `beta` is given. */
async function mountApp(beta: Record<string, unknown> = {}): Promise<void> {
  window.location.hash = "#sessions";
  await tick();
  let sink: TransportSink | null = null;
  const transport: Transport = (s) => {
    sink = s;
    return { refresh: () => {}, stop: () => { sink = null; } };
  };
  await act(async () => {
    root.render(<App transport={transport} feedApi={feedApi} actionsPollMs={3_600_000} />);
  });
  await act(async () => {
    if (sink === null) throw new Error("no active transport");
    sink.onState(stateWith([sessionRow("$a", "alpha"), sessionRow("$b", "beta", beta)]));
  });
}

/** Throws rather than returning `undefined`, so a missing card cannot pass as a hover that opened nothing. */
function rowButton(id: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button.session-open")].find(
    (b) => b.dataset.session === id,
  );
  if (found === undefined) throw new Error(`no row for ${id} on the page`);
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
}

/** Longer than the open delay (240ms), and long enough that a card which only lived for its exit fade is gone. */
async function wait(ms = 400): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function hover(el: HTMLElement): Promise<void> {
  // `useHover` listens for the native event on the node the ref gave it.
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await wait();
}

const preview = (): HTMLElement | null => document.querySelector<HTMLElement>(".tooltip .session-preview");

function openPreview(): HTMLElement {
  const found = preview();
  if (found === null) throw new Error("no preview is open");
  return found;
}

describe("the preview on a compact session card", () => {
  it("opens on hover beside an open detail, and names the options the compact card dropped", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));

    /* The premise, checked rather than assumed: the card IS compact, so the
       labels are not on it. Without this the test below would pass against a
       page that simply never dropped them. */
    const card = rowButton("$b").closest(".session-card");
    expect(card?.textContent).toContain("3 options — open it to read them.");
    expect(card?.textContent).not.toContain("Drop the column");

    await hover(rowButton("$b"));
    const text = openPreview().textContent ?? "";
    expect(text).toContain("beta");
    expect(text).toContain("needs you");
    expect(text).toContain(ASKING);
    for (const label of LABELS) expect(text).toContain(label);
  });

  it("opens when the keyboard focuses the title button", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));

    await act(async () => rowButton("$b").focus());
    await wait();
    expect(openPreview().textContent).toContain("Ask Greg first");
  });

  it("holds nothing focusable, because the surface it is drawn on cannot be pointed at", async () => {
    pinWidth(1280);
    await mountApp({
      status: { kind: "needs-you" },
      repo: "spideryarn2",
      worktree: "fleet-borrow",
      meta: { version: 1, dir: "/var/tmp/spideryarn-worktrees/fleet-borrow" },
      description: {
        kind: "described",
        title: "Borrowing the reading machinery",
        description: "Moves the dashboard's history onto pushState.",
        describedAt: "2026-09-09T00:00:00.000Z",
      },
      question: question(ASKING, LABELS, { kind: "read", text: "DROP COLUMN gist;", fingerprint: "f1" }),
    });
    await click(rowButton("$a"));
    await hover(rowButton("$b"));

    const card = openPreview();
    expect(card.querySelectorAll("button, a[href], input, select, textarea, [tabindex]")).toHaveLength(0);
    // …and it is the full preview being checked, not an empty one.
    expect(card.textContent).toContain("/var/tmp/spideryarn-worktrees/fleet-borrow");
    expect(card.textContent).toContain("Moves the dashboard's history onto pushState.");
  });

  it("caps a long menu and long text, and says what it left out", async () => {
    pinWidth(1280);
    const many = Array.from({ length: 10 }, (_, i) => `Option number ${i + 1}`);
    const longDescription = `START ${"word ".repeat(400)}END-OF-DESCRIPTION`;
    const longPrompt = `ASK ${"why ".repeat(400)}END-OF-PROMPT`;
    await mountApp({
      status: { kind: "needs-you" },
      description: {
        kind: "described",
        title: "A long one",
        description: longDescription,
        describedAt: "2026-09-09T00:00:00.000Z",
      },
      question: question(longPrompt, many, { kind: "read", text: "SECRET-MATERIAL-BODY", fingerprint: "f1" }),
    });
    await click(rowButton("$a"));
    await hover(rowButton("$b"));

    const card = openPreview();
    const text = card.textContent ?? "";
    expect(card.querySelectorAll("li")).toHaveLength(PREVIEW_OPTION_CAP);
    expect(text).toContain(`Option number ${PREVIEW_OPTION_CAP}`);
    expect(text).not.toContain(`Option number ${PREVIEW_OPTION_CAP + 1}`);
    expect(text).toContain(`and ${10 - PREVIEW_OPTION_CAP} more — open the session to read them`);

    // Both long texts start, neither ends, and each says it was cut.
    expect(text).toContain("START word");
    expect(text).not.toContain("END-OF-DESCRIPTION");
    expect(text).toContain("ASK why");
    expect(text).not.toContain("END-OF-PROMPT");
    expect(card.querySelectorAll("[data-cut]")).toHaveLength(2);
    for (const cut of card.querySelectorAll("[data-cut]")) {
      expect(cut.textContent).toContain("open the session to read the rest");
    }
    expect(text.length).toBeLessThan(2 * PREVIEW_TEXT_CAP + 1200);

    // The material is not shown, and its absence is said.
    expect(text).not.toContain("SECRET-MATERIAL-BODY");
    expect(text).toContain("What it would approve is not shown here — open the session to read it.");
  });

  it("says nothing was cut when nothing was", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));
    await hover(rowButton("$b"));
    const card = openPreview();
    expect(card.querySelectorAll("[data-cut]")).toHaveLength(0);
    expect(card.textContent).not.toContain("more — open the session");
    expect(card.textContent).not.toContain("is not shown here");
  });

  it("does not exist on a full-width card, which already shows all of it", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    // No selection: the list is full width and the card carries its own options.
    expect(rowButton("$b").closest(".session-card")?.textContent).toContain("Drop the column");

    await hover(rowButton("$b"));
    expect(preview()).toBeNull();
    await act(async () => rowButton("$b").focus());
    await wait();
    expect(preview()).toBeNull();
    expect(document.querySelector(".tooltip-anchor")).toBeNull();
  });

  it("does not open under a finger, whose tap already selects", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));

    /* jsdom has no `PointerEvent`; `useHover` reads `pointerType` off React's
       `onPointerDown`, which is what a real tap fires before the browser
       synthesises the `mouseenter` — tests/shelf-action-touch.test.tsx § `press`. */
    const el = rowButton("$b");
    const down = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    await act(async () => {
      el.dispatchEvent(down);
    });
    await hover(el);
    expect(preview()).toBeNull();
  });

  it("leaves the button's accessible name as exactly the heading", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));
    await hover(rowButton("$b"));
    openPreview();

    const el = rowButton("$b");
    expect(el.textContent).toBe("beta");
    expect(el.getAttribute("aria-label")).toBeNull();
    expect(el.getAttribute("aria-labelledby")).toBeNull();
    // The card is its description, and only while it is open.
    const described = el.getAttribute("aria-describedby");
    expect(described).not.toBeNull();
    expect(document.getElementById(described ?? "")?.contains(openPreview())).toBe(true);
  });

  it("is not offered on the selected card, and goes when its session is opened", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));

    await hover(rowButton("$a"));
    expect(preview()).toBeNull();

    // Open over beta, then click it: the detail the click opened is not left under a card.
    await hover(rowButton("$b"));
    openPreview();
    await click(rowButton("$b"));
    await wait();
    expect(preview()).toBeNull();
    expect(rowButton("$b").getAttribute("aria-current")).toBe("true");
  });
});
