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
import { act, Component, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import type { FeedApi, FeedView } from "../tools/fleet/web/src/feed-client";
import { PREVIEW_OPTION_CAP, PREVIEW_TEXT_CAP, SessionPreview } from "../tools/fleet/web/src/SessionPreview";
import { Tooltip } from "../tools/fleet/web/src/Tooltip";
import { SessionsPanel } from "../tools/fleet/web/src/SessionsPanel";
import { httpActionsApi } from "../tools/fleet/web/src/actions-client";
import { httpMessagesApi } from "../tools/fleet/web/src/messages-client";
import { httpNewSessionApi } from "../tools/fleet/web/src/new-session-client";
import { httpRenameApi } from "../tools/fleet/web/src/rename-client";
import { httpSteerApi } from "../tools/fleet/web/src/steer-client";
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
async function mountApp(beta: Record<string, unknown> = {}): Promise<(rows: FleetRow[]) => void> {
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
  return (rows) => {
    if (sink === null) throw new Error("no active transport");
    sink.onState(stateWith(rows));
  };
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

describe("preview composition contracts", () => {
  it("does not present the captured option list as the whole terminal menu", async () => {
    const row = stateWith([sessionRow("$b", "beta", { question: question(ASKING, LABELS) })]).rows[0]!;
    await act(async () => root.render(<SessionPreview row={row} heading="beta" />));
    expect(host.textContent).toContain("A long menu scrolls, so there may be more below.");
  });

  it("makes no request on hover or keyboard focus", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));
    await wait();
    const reads = vi.spyOn(globalThis, "fetch");
    await hover(rowButton("$b"));
    openPreview();
    await act(async () => rowButton("$b").focus());
    await wait();
    expect(reads).not.toHaveBeenCalled();
  });

  it("keeps an open preview and its accessible description on the latest pushed row", async () => {
    pinWidth(1280);
    const push = await mountApp({ title: "Beta before", status: { kind: "needs-you" }, question: question("OLD PROMPT", ["OLD OPTION"]) });
    await click(rowButton("$a"));
    await act(async () => rowButton("$b").focus());
    await wait();
    expect(openPreview().textContent).toContain("OLD OPTION");
    const focused = rowButton("$b");
    await act(async () => push([
      sessionRow("$a", "alpha"),
      sessionRow("$b", "beta", { title: "Beta after", status: { kind: "needs-you" }, question: question("NEW PROMPT", ["NEW OPTION"]) }),
    ]));
    expect(rowButton("$b")).toBe(focused);
    expect(document.activeElement).toBe(focused);
    const card = openPreview();
    expect(card.textContent).toContain("Beta after");
    expect(card.textContent).toContain("NEW PROMPT");
    expect(card.textContent).toContain("NEW OPTION");
    expect(card.textContent).not.toMatch(/Beta before|OLD PROMPT|OLD OPTION/);
    const described = focused.getAttribute("aria-describedby");
    expect(document.getElementById(described ?? "")?.getAttribute("role")).toBe("tooltip");
    expect(document.getElementById(described ?? "")?.contains(card)).toBe(true);

    await act(async () => focused.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await wait();
    expect(preview()).toBeNull();
    expect(focused.getAttribute("aria-describedby")).toBeNull();
    expect(document.activeElement).toBe(focused);
  });
});

describe("preview bounds at the complete surface", () => {
  it.each(["heading", "reason", "where", "directory", "option"])(
    "bounds wire-supported long %s text and announces the cut",
    async (field) => {
      const long = `START ${"word ".repeat(400)}UNREACHABLE-TAIL`;
      const row = stateWith([sessionRow("$b", "beta", {
        title: field === "heading" ? long : "beta title",
        status: field === "reason" ? { kind: "unknown", why: long } : { kind: "needs-you" },
        repo: field === "where" ? long : "repo",
        meta: { version: 1, dir: field === "directory" ? long : "/tmp/repo" },
        question: question(ASKING, [field === "option" ? long : "Keep it"]),
      })]).rows[0]!;
      await act(async () => root.render(<SessionPreview row={row} heading={row.title!} />));
      expect(host.textContent).toContain("START word");
      expect(host.textContent).not.toContain("UNREACHABLE-TAIL");
      expect(host.querySelector("[data-cut]")?.textContent).toContain("open the session to read the rest");
    },
  );

  it("bounds the complete height and announces overflow outside the clipped body", async () => {
    let contentHeight = 400;
    let resized: ResizeObserverCallback | null = null;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => contentHeight);
    const row = stateWith([sessionRow("$b", "beta")]).rows[0]!;
    await act(async () => root.render(<SessionPreview row={row} heading="beta" />));
    const body = host.querySelector<HTMLElement>(".session-preview-body");
    expect(body, "a text cap alone does not bound the complete surface").not.toBeNull();
    expect(body?.style.maxHeight).toBe("min(32rem, calc(100vh - 5rem))");
    expect(body?.style.overflow).toBe("hidden");
    const note = host.querySelector("[data-preview-overflow]");
    expect(note?.textContent).toContain("Cut short to fit this window");
    expect(body?.contains(note)).toBe(false);

    if (resized === null) throw new Error("the measured body has no resize observer");
    const notify = resized as ResizeObserverCallback;
    contentHeight = 100;
    await act(async () => notify([], {} as ResizeObserver));
    expect(host.querySelector("[data-preview-overflow]")).toBeNull();
    contentHeight = 400;
    await act(async () => notify([], {} as ResizeObserver));
    expect(host.querySelector("[data-preview-overflow]")).not.toBeNull();
  });
});

/** Navigate by the hash, which is what the browser's Back does to this page. */
async function goTo(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    await tick();
  });
}

/** Deterministic focus changes on either side of DOM mutation; no timer race. */
class CommitFocus extends Component<{ beforeMutation: () => void; afterMutation: () => void }> {
  override getSnapshotBeforeUpdate(): null {
    this.props.beforeMutation();
    return null;
  }
  override componentDidUpdate(): void {
    this.props.afterMutation();
  }
  override render() { return null; }
}

/** Direct panel fixture: change its band ancestry without a URL or transport update. */
function listAtCommit(split: boolean, beforeMutation: () => void = () => {}, afterMutation: () => void = () => {}) {
  return (
    <StrictMode>
      <CommitFocus beforeMutation={beforeMutation} afterMutation={afterMutation} />
      <SessionsPanel
        rows={stateWith([
          sessionRow("$a", "alpha"),
          sessionRow("$b", "beta", split ? { status: { kind: "needs-you" } } : {}),
        ]).rows}
        now={Date.now()} collected unreadableRows={0}
        answeringEnabled={{ kind: "not-reported" }} answeringRefusal={null}
        onAnsweringRefused={() => {}} tmuxServerPid={132280}
        order="status" onOrder={() => {}} selectedId={null} selectedPid={null}
        onSelect={() => {}} steer={httpSteerApi} rename={httpRenameApi}
        actions={{ api: httpActionsApi, feed: null, error: null, asked: false, lastGoodAt: null, pollMs: 3_600_000, refresh: () => {} }}
        messages={httpMessagesApi} newSession={httpNewSessionApi} onRefresh={() => {}}
      />
    </StrictMode>
  );
}

/**
 * **The reader's place in the list is a session, not a DOM node.**
 *
 * Closing the two-pane detail moves the list under a different ancestor, so
 * every title button is a new node and the focused one takes focus to `<body>`
 * with it. docs/postmortems/261006r-logical-list-continuity-does-not-preserve-dom-focus.md.
 */
describe("keyboard focus across a change of layout", () => {
  it("restores the title focused just before mutation, under StrictMode", async () => {
    pinWidth(1280);
    await act(async () => root.render(listAtCommit(false)));
    const before = rowButton("$b");
    await act(async () => rowButton("$a").focus());
    await act(async () => root.render(listAtCommit(true, () => before.focus())));
    expect(rowButton("$b")).not.toBe(before);
    expect(document.activeElement === rowButton("$b")).toBe(true);
  });

  it("stays on the focused row when the two-pane detail closes", async () => {
    pinWidth(1280);
    await mountApp();
    await click(rowButton("$a"));
    const before = rowButton("$b");
    await act(async () => before.focus());
    expect(document.activeElement).toBe(before);

    await goTo("#sessions");
    // The premise: the detail is gone and the list was rebuilt, not merely kept.
    expect(host.querySelector('section[aria-label="The selected session"]')).toBeNull();
    expect(rowButton("$b")).not.toBe(before);
    expect(document.activeElement).toBe(rowButton("$b"));
  });

  it("stays on the SELECTED row's title when its own detail closes", async () => {
    pinWidth(1280);
    await mountApp();
    await click(rowButton("$a"));
    await act(async () => rowButton("$a").focus());

    await goTo("#sessions");
    expect(document.activeElement).toBe(rowButton("$a"));
  });

  it("stays on the focused row when the list is dealt into columns instead", async () => {
    pinWidth(1280);
    // Two bands, so with nothing selected the list is spread: a third ancestry.
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));
    await act(async () => rowButton("$b").focus());

    await goTo("#sessions");
    expect(document.activeElement).toBe(rowButton("$b"));
  });

  it("does not take focus from a control the reader moved to", async () => {
    pinWidth(1280);
    await act(async () => root.render(listAtCommit(true)));
    const before = rowButton("$b");
    await act(async () => before.focus());
    const order = host.querySelector<HTMLSelectElement>('select[aria-label="Order the session list"]');
    if (order === null) throw new Error("no ordering control on the page");

    // The title is focused at the snapshot. A preceding layout lifecycle then
    // moves focus onto a surviving control before restoration gets its turn.
    await act(async () => root.render(listAtCommit(false, undefined, () => order.focus())));
    expect(rowButton("$b")).not.toBe(before);
    expect(host.querySelector('select[aria-label="Order the session list"]')).toBe(order);
    expect(document.activeElement === order).toBe(true);
  });

  it("does not put focus on a row when it was inside the detail that closed", async () => {
    pinWidth(1280);
    const push = await mountApp();
    await click(rowButton("$a"));
    await act(async () => rowButton("$b").focus());
    /* A poll lands while the row has focus, so the page has rendered with it
       there — which is what a version that REMEMBERED the last focused row,
       rather than asking which one has focus now, would need to go wrong. */
    await act(async () => push([sessionRow("$a", "alpha"), sessionRow("$b", "beta")]));
    expect(document.activeElement).toBe(rowButton("$b"));
    const box = host.querySelector<HTMLElement>(
      'section[aria-label="The selected session"] :is(button, textarea, input):not([disabled])',
    );
    if (box === null) throw new Error("the detail has no control to focus");
    await act(async () => box.focus());
    expect(document.activeElement).toBe(box);

    await goTo("#sessions");
    expect(document.activeElement).toBe(document.body);
  });

  it("still moves focus INTO the detail when a focused row is opened", async () => {
    pinWidth(1280);
    await mountApp();
    // From the full-width list: opening rebuilds the list under the two-pane grid.
    await act(async () => rowButton("$b").focus());
    await click(rowButton("$b"));
    const region = host.querySelector<HTMLElement>('section[aria-label="The selected session"]');
    expect(region).not.toBeNull();
    expect(document.activeElement).toBe(region);

    // And from the left-hand column, where nothing is rebuilt.
    await act(async () => rowButton("$a").focus());
    await click(rowButton("$a"));
    expect(document.activeElement).toBe(region);
  });

  it("leaves focus alone, and does not throw, when the focused row has left the list", async () => {
    pinWidth(1280);
    const push = await mountApp();
    await click(rowButton("$a"));
    await act(async () => rowButton("$b").focus());

    await act(async () => {
      push([sessionRow("$a", "alpha")]);
      window.location.hash = "#sessions";
      await tick();
    });
    expect(host.querySelectorAll("button.session-open")).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
  });

  it("returns to the opened row at one pane, as it did, with the scroll put back", async () => {
    pinWidth(390);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    try {
      await mountApp();
      await click(rowButton("$b"));
      expect(host.querySelectorAll("button.session-open")).toHaveLength(0);

      await goTo("#sessions");
      expect(document.activeElement).toBe(rowButton("$b"));
      expect(scrollTo).toHaveBeenCalledWith(0, 640);
    } finally {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    }
  });
});

describe("a card gaining or losing its preview", () => {
  it("keeps the same title button node on both cards when the selection moves", async () => {
    pinWidth(1280);
    await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
    await click(rowButton("$a"));
    const alpha = rowButton("$a");
    const beta = rowButton("$b");

    // beta loses its preview and alpha gains one.
    await click(beta);
    expect(rowButton("$b").getAttribute("aria-current")).toBe("true");
    expect(rowButton("$b")).toBe(beta);
    expect(rowButton("$a")).toBe(alpha);

    // …and the one that gained it has a working one, on the node it already had.
    await hover(alpha);
    expect(openPreview().textContent).toContain("alpha");
  });

  it("does not open on the selected card under hover or focus, and describes it by nothing", async () => {
    pinWidth(1280);
    await mountApp();
    await click(rowButton("$a"));
    await click(rowButton("$b"));
    // alpha has been eligible and is not now; beta the reverse.
    await click(rowButton("$a"));

    const el = rowButton("$a");
    await hover(el);
    expect(preview()).toBeNull();
    await act(async () => el.focus());
    await wait();
    expect(preview()).toBeNull();
    expect(document.querySelector(".tooltip-anchor")).toBeNull();
    expect(el.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("Tooltip § enabled", () => {
  it("keeps the trigger's node and opens nothing while false, then works on the same node", async () => {
    const render = (enabled: boolean): Promise<void> =>
      act(async () =>
        root.render(
          <Tooltip content={<span className="probe">the card</span>} enabled={enabled}>
            <button type="button">trigger</button>
          </Tooltip>,
        ),
      );
    await render(false);
    const trigger = host.querySelector("button");
    if (trigger === null) throw new Error("no trigger rendered");

    await hover(trigger);
    expect(document.querySelector(".tooltip")).toBeNull();
    await act(async () => trigger.focus());
    await wait();
    expect(document.querySelector(".tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    await act(async () => trigger.blur());

    await render(true);
    expect(host.querySelector("button")).toBe(trigger);
    await hover(trigger);
    expect(document.querySelector(".tooltip .probe")).not.toBeNull();
    expect(trigger.getAttribute("aria-describedby")).not.toBeNull();

    // Switched off while open: it closes rather than staying up with no way to dismiss it.
    await render(false);
    await wait();
    expect(document.querySelector(".tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    expect(host.querySelector("button")).toBe(trigger);
  });
});

describe("where the preview is drawn", () => {
  it("uses the trigger by default and restores it when a position override becomes null or omitted", async () => {
    pinWidth(1280);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(800);
    const card = document.createElement("div");
    document.body.appendChild(card);
    card.getBoundingClientRect = () => new DOMRect(200, 100, 340, 80);
    const render = (reference?: Element | null) => act(async () => root.render(
      <StrictMode>
        <Tooltip content="geometry probe" placement="right-start" {...(reference === undefined ? {} : { positionReference: reference })}>
          <button type="button">trigger</button>
        </Tooltip>
      </StrictMode>,
    ));
    const position = () => {
      const anchor = document.querySelector<HTMLElement>(".tooltip-anchor");
      const at = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(anchor?.style.transform ?? "");
      if (at === null) throw new Error("the open tooltip has no position");
      return [Number(at[1]), Number(at[2])];
    };
    try {
      await render();
      const trigger = host.querySelector("button");
      if (trigger === null) throw new Error("no trigger rendered");
      trigger.getBoundingClientRect = () => new DOMRect(20, 50, 100, 30);
      await hover(trigger);
      expect(position()).toEqual([130, 50]);
      expect(trigger.getAttribute("aria-describedby")).not.toBeNull();

      for (const reference of [card, null, card, undefined]) {
        await render(reference);
        expect(host.querySelector("button")).toBe(trigger);
        expect(position()).toEqual(reference === card ? [550, 100] : [130, 50]);
      }
    } finally {
      card.remove();
    }
  });

  /**
   * jsdom lays nothing out, so every box is 0×0 at the origin unless a test
   * says otherwise. This one gives the CARD a box and leaves the title button
   * without one, then reads where Floating UI put the panel: beside the card's
   * right edge, level with its top. Anchored to the button it would be at
   * x = 10 (the offset alone), which is what this was before.
   */
  it("sits beside the card's right edge and level with its top, not beside the title text", async () => {
    pinWidth(1280);
    const height = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 800 });
    try {
      await mountApp({ status: { kind: "needs-you" }, question: question(ASKING, LABELS) });
      await click(rowButton("$a"));
      const card = rowButton("$b").closest<HTMLElement>(".session-card");
      if (card === null) throw new Error("the title is not inside a card");
      card.getBoundingClientRect = () => new DOMRect(12, 100, 340, 80);

      await hover(rowButton("$b"));
      openPreview();
      const anchor = document.querySelector<HTMLElement>(".tooltip-anchor");
      const at = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(anchor?.style.transform ?? "");
      if (at === null) throw new Error(`no position on the panel: ${anchor?.getAttribute("style")}`);
      expect(Number(at[1])).toBe(12 + 340 + 10);
      expect(Number(at[2])).toBe(100);
    } finally {
      if (height) Object.defineProperty(Element.prototype, "clientHeight", height);
    }
  });
});
