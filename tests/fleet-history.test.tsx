// @vitest-environment jsdom
/**
 * What the browser's Back button does on the fleet dashboard.
 *
 * The rule is mode.ts § `historyKindFor`: a mode change and opening a session
 * from the list are history entries; everything else rewrites the entry it is
 * on. Until 2026-10-06 every write was `window.location.hash =`, which is an
 * entry per keystroke in the feed's text filter and an entry per session
 * clicked through.
 *
 * **Every history assertion here is a DELTA of `history.length`.** jsdom keeps
 * one session history for the whole file, so an absolute length is a statement
 * about the tests that ran before this one.
 *
 * The fixtures are local copies of the ones in tests/fleet-feed-panel.test.tsx,
 * which does not export them.
 *
 * Plan: docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md § Stage 1.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import type { FeedApi, FeedView } from "../tools/fleet/web/src/feed-client";
import { type HashState, historyKindFor, parseHash, useHashState } from "../tools/fleet/web/src/mode";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import { parseFleetState, type FleetRow, type FleetState } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let undoWidth: (() => void) | null = null;

beforeEach(() => {
  /* No panel here may reach the network: the detail's own routes default to
     `fetch`, and a rejected read is a state every one of them already draws. */
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
  /* Let the `hashchange` that assignment queued be delivered to nobody, rather
     than to the next test's page. */
  await tick();
});

/** One macrotask, which is when jsdom delivers a queued `hashchange`. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Pin every element's width — tests/fleet-web.test.tsx § `pinWidth`. */
function pinWidth(px: number): void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => px });
  undoWidth = () => {
    if (original) Object.defineProperty(Element.prototype, "clientWidth", original);
  };
}

function sessionRow(id: string, name: string): FleetRow {
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

/** The page at `hash`, holding two sessions called alpha and beta. */
async function mountApp(hash: string): Promise<void> {
  window.location.hash = hash;
  await tick();
  let sink: TransportSink | null = null;
  const transport: Transport = (s) => {
    sink = s;
    return { refresh: () => {}, stop: () => { sink = null; } };
  };
  await act(async () => {
    root.render(<App transport={transport} feedApi={feedApi} actionsPollMs={3_600_000} />);
  });
  await act(async () => sink?.onState(stateWith([sessionRow("$a", "alpha"), sessionRow("$b", "beta")])));
}

/** Throws rather than returning `undefined`, so a missing control cannot pass as a no-op click. */
function button(what: string, find: (b: HTMLButtonElement) => boolean): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(find);
  if (found === undefined) throw new Error(`no ${what} on the page`);
  return found;
}
const rowButton = (name: string): HTMLButtonElement =>
  button(`row for ${name}`, (b) => b.classList.contains("session-open") && b.textContent === name);
const backButton = (): HTMLButtonElement => button("← All sessions", (b) => b.textContent === "← All sessions");
const dockButton = (label: string): HTMLButtonElement =>
  button(`dock button ${label}`, (b) => b.getAttribute("aria-label") === label);

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
}

/** Set a controlled input the way a keystroke does. */
async function setInput(el: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setValue?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

/** Traverse, and wait for the browser to say it has. Fails if it never does. */
async function traverse(by: -1 | 1): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve, reject) => {
      const giveUp = setTimeout(() => reject(new Error("the traversal fired no popstate")), 1000);
      window.addEventListener(
        "popstate",
        () => {
          clearTimeout(giveUp);
          resolve();
        },
        { once: true },
      );
      window.history.go(by);
    });
    await tick();
  });
}

const detail = (): Element | null => host.querySelector('[aria-label="The selected session"]');
const here = (): HashState => parseHash(window.location.hash);

describe("historyKindFor", () => {
  const at = (mode: HashState["mode"], params: Record<string, string> = {}): HashState => ({ mode, params });

  it("pushes a mode change, whatever else changed with it", () => {
    expect(historyKindFor(at("sessions"), at("health"))).toBe("push");
    expect(historyKindFor(at("messages", { mt: "x" }), at("sessions", { mt: "x", sel: "$a" }))).toBe("push");
    expect(historyKindFor(at("sessions", { sel: "$a" }), at("messages"))).toBe("push");
  });

  it("pushes a session opened from nothing", () => {
    expect(historyKindFor(at("sessions"), at("sessions", { sel: "$a" }))).toBe("push");
    expect(historyKindFor(at("sessions", { order: "name" }), at("sessions", { order: "name", sel: "$a", selpid: "7" }))).toBe("push");
  });

  it("replaces a switch between sessions, and a close", () => {
    expect(historyKindFor(at("sessions", { sel: "$a" }), at("sessions", { sel: "$b" }))).toBe("replace");
    expect(historyKindFor(at("sessions", { sel: "$a" }), at("sessions"))).toBe("replace");
  });

  it("replaces every other parameter, including one it has never heard of", () => {
    expect(historyKindFor(at("sessions"), at("sessions", { order: "name" }))).toBe("replace");
    expect(historyKindFor(at("messages"), at("messages", { mt: "d" }))).toBe("replace");
    expect(historyKindFor(at("messages", { ml: "50" }), at("messages", { ml: "200" }))).toBe("replace");
    expect(historyKindFor(at("sessions", { sel: "$a" }), at("sessions", { sel: "$a", order: "name" }))).toBe("replace");
    expect(historyKindFor(at("health"), at("health", { fromALaterBuild: "1" }))).toBe("replace");
  });

  it("replaces an identical state, so writing it twice is one entry", () => {
    expect(historyKindFor(at("health"), at("health"))).toBe("replace");
    expect(historyKindFor(at("sessions", { sel: "$a" }), at("sessions", { sel: "$a" }))).toBe("replace");
  });
});

describe("Back undoes the last deliberate act", () => {
  it("typing in the feed's text filter adds no history entry, and the hash holds all of it", async () => {
    await mountApp("#messages");
    const before = window.history.length;
    const typed = "deploy";
    for (let n = 1; n <= typed.length; n++) {
      const box = host.querySelector<HTMLInputElement>('input[aria-label="Filter messages by text"]');
      if (box === null) throw new Error("no text filter on the feed");
      await setInput(box, typed.slice(0, n));
    }
    expect(Object.values(here().params)).toContain("deploy");
    expect(window.history.length - before).toBe(0);
  });

  it("opening a session is one entry, switching is none, and Back lands on the list", async () => {
    pinWidth(1280);
    await mountApp("#sessions");
    const before = window.history.length;

    await click(rowButton("alpha"));
    expect(here().params["sel"]).toBe("$a");
    expect(window.history.length - before).toBe(1);

    await click(rowButton("beta"));
    expect(here().params["sel"]).toBe("$b");
    expect(window.history.length - before).toBe(1);

    await traverse(-1);
    expect(here()).toEqual({ mode: "sessions", params: {} });
    expect(detail()).toBeNull();
    expect(rowButton("alpha")).toBeDefined();
  });

  it("← All sessions at 390px adds no entry, and keeps an order set while the detail was open", async () => {
    pinWidth(390);
    await mountApp("#sessions");
    await click(rowButton("alpha"));
    const opened = window.history.length;

    const order = host.querySelector<HTMLSelectElement>('select[aria-label="Order the session list"]');
    if (order === null) throw new Error("no ordering control beside the open detail");
    await setInput(order, "name");
    expect(here().params).toEqual({ sel: "$a", order: "name" });

    await click(backButton());
    expect(here()).toEqual({ mode: "sessions", params: { order: "name" } });
    expect(detail()).toBeNull();
    expect(window.history.length - opened).toBe(0);
  });

  it("a mode change is an entry, and Back returns to the mode it left with its parameters", async () => {
    await mountApp("#sessions?order=name");
    const before = window.history.length;

    await click(dockButton("Box health"));
    expect(here()).toEqual({ mode: "health", params: { order: "name" } });
    expect(window.history.length - before).toBe(1);

    /* The button for the mode already showing is not a second entry. */
    await click(dockButton("Box health"));
    expect(window.history.length - before).toBe(1);

    await traverse(-1);
    expect(here()).toEqual({ mode: "sessions", params: { order: "name" } });
    expect(rowButton("alpha")).toBeDefined();
  });

  it("Back and Forward each show the entry they land on", async () => {
    pinWidth(1280);
    await mountApp("#sessions");
    await click(rowButton("alpha"));
    await click(dockButton("Box health"));
    expect(here().mode).toBe("health");

    await traverse(-1);
    expect(here()).toEqual({ mode: "sessions", params: { sel: "$a" } });
    expect(detail()?.textContent ?? "").toContain("$a");

    await traverse(-1);
    expect(here()).toEqual({ mode: "sessions", params: {} });
    expect(detail()).toBeNull();

    await traverse(1);
    expect(detail()?.textContent ?? "").toContain("$a");

    await traverse(1);
    expect(here().mode).toBe("health");
    expect(detail()).toBeNull();
    expect(host.querySelectorAll("button.session-open")).toHaveLength(0);
  });

  /**
   * GPT Sol's F10 on the plan's second review. Safari refuses History API calls
   * past 100 in 30 seconds with a `SecurityError`. If the push that opened A
   * were a `location.hash` assignment, its `hashchange` would still be queued
   * when the replace to B throws, and would then re-read an address still
   * saying A and put A back on screen.
   */
  it("a write the browser refuses keeps what the reader chose, and the next one persists all of it", async () => {
    pinWidth(1280);
    await mountApp("#sessions");
    const refuse = vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("too many calls to the History API", "SecurityError");
    });
    /* **Both clicks before anything is awaited**, which is the whole test: an
       awaited `act` lets jsdom deliver queued events, and the defect is an
       event from the first write arriving after the second was refused. */
    act(() => rowButton("alpha").click());
    act(() => rowButton("beta").click());
    /* Without this the rest proves nothing: a page that never asked was never refused. */
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(here().params["sel"], "the address is stale, which is the accepted cost").toBe("$a");

    await act(async () => {
      await tick();
      await tick();
    });
    expect(detail()?.textContent ?? "").toContain("$b");
    expect(detail()?.textContent ?? "").not.toContain("$a");

    refuse.mockRestore();
    const order = host.querySelector<HTMLSelectElement>('select[aria-label="Order the session list"]');
    if (order === null) throw new Error("no ordering control");
    await setInput(order, "name");
    expect(here()).toEqual({ mode: "sessions", params: { sel: "$b", order: "name" } });
    expect(detail()?.textContent ?? "").toContain("$b");
  });

  it("a refused push keeps the session open too", async () => {
    pinWidth(1280);
    await mountApp("#sessions");
    const refuse = vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new DOMException("too many calls to the History API", "SecurityError");
    });
    await click(rowButton("alpha"));
    expect(refuse).toHaveBeenCalledTimes(1);
    await act(async () => {
      await tick();
    });
    expect(detail()?.textContent ?? "").toContain("$a");
    expect(here().params["sel"]).toBeUndefined();
  });

  it("writes only the fragment: the path and a real query string are left alone", async () => {
    window.history.replaceState(null, "", "/fleet/?debug=1");
    try {
      await mountApp("#sessions");
      await click(dockButton("Box health"));
      expect(window.location.pathname + window.location.search + window.location.hash).toBe("/fleet/?debug=1#health");
      await click(dockButton("Sessions"));
      await click(rowButton("alpha"));
      expect(window.location.pathname + window.location.search).toBe("/fleet/?debug=1");
      expect(here().params["sel"]).toBe("$a");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("useHashState", () => {
  type Hook = ReturnType<typeof useHashState>;

  function mountHook(): { current: Hook } {
    const seen = { current: null as Hook | null };
    function Probe(): null {
      seen.current = useHashState();
      return null;
    }
    act(() => root.render(<Probe />));
    return seen as { current: Hook };
  }

  /**
   * Each writer used to start from the parameters of the render it was created
   * in, so the second of two calls in one handler discarded the first. They now
   * start from the latest state, wherever it came from.
   */
  it("two writes in one tick both survive", async () => {
    window.location.hash = "#messages";
    await tick();
    const hook = mountHook();
    act(() => {
      hook.current.setParam("a", "1");
      hook.current.setParam("b", "2");
    });
    expect(here()).toEqual({ mode: "messages", params: { a: "1", b: "2" } });
    expect(hook.current.params).toEqual({ a: "1", b: "2" });
  });

  it("a mode change and a parameter written separately in one tick both survive", async () => {
    window.location.hash = "#messages?mt=x";
    await tick();
    const hook = mountHook();
    act(() => {
      hook.current.chooseMode("sessions");
      hook.current.setParam("sel", "$a");
    });
    expect(here()).toEqual({ mode: "sessions", params: { mt: "x", sel: "$a" } });
    expect(hook.current.mode).toBe("sessions");
  });

  it("adopts an address edited by hand", async () => {
    window.location.hash = "#sessions";
    await tick();
    const hook = mountHook();
    await act(async () => {
      window.location.hash = "#health?order=name";
      await tick();
    });
    expect(hook.current.mode).toBe("health");
    expect(hook.current.params).toEqual({ order: "name" });
    /* And the next write starts from what was adopted, not from before it. */
    act(() => hook.current.setParam("x", "1"));
    expect(here()).toEqual({ mode: "health", params: { order: "name", x: "1" } });
  });
});

describe("the list's scroll position at one pane", () => {
  /** jsdom lays nothing out, so the page's scroll offset is whatever this says. */
  function scrolledTo(y: number): { scrollTo: ReturnType<typeof vi.fn> } {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollY", y);
    vi.stubGlobal("scrollTo", scrollTo);
    return { scrollTo };
  }

  it("comes back when the detail is closed", async () => {
    pinWidth(390);
    await mountApp("#sessions");
    const page = scrolledTo(1234);
    await click(rowButton("beta"));
    expect(page.scrollTo, "opening is the detail's scroll to decide, not this one's").not.toHaveBeenCalled();

    vi.stubGlobal("scrollY", 0);
    await click(backButton());
    expect(page.scrollTo).toHaveBeenCalledTimes(1);
    expect(page.scrollTo).toHaveBeenCalledWith(0, 1234);
    expect(document.activeElement, "focus goes back to the row it left").toBe(rowButton("beta"));
  });

  it("comes back on the browser's Back as well", async () => {
    pinWidth(390);
    await mountApp("#sessions");
    const page = scrolledTo(800);
    await click(rowButton("alpha"));
    vi.stubGlobal("scrollY", 0);
    await traverse(-1);
    expect(detail()).toBeNull();
    expect(page.scrollTo).toHaveBeenCalledWith(0, 800);
  });

  it("is restored once: a later close with nothing saved moves nothing", async () => {
    pinWidth(390);
    await mountApp("#sessions?sel=%24a");
    const page = scrolledTo(500);
    expect(detail()).not.toBeNull();
    await click(backButton());
    expect(detail()).toBeNull();
    expect(page.scrollTo).not.toHaveBeenCalled();
  });

  it("is not touched at two panes, where the list never left", async () => {
    pinWidth(1280);
    await mountApp("#sessions");
    const page = scrolledTo(900);
    await click(rowButton("alpha"));
    await act(async () => {
      window.history.replaceState(null, "", "#sessions");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(detail()).toBeNull();
    expect(page.scrollTo).not.toHaveBeenCalled();
  });
});
