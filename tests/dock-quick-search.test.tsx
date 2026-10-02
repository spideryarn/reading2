// @vitest-environment jsdom
/**
 * **The quick-search box in the bottom bar** — plan 261002h, stage 3.
 *
 * The bar's box and the panel's box are two views of one draft
 * (src/web/search-draft.ts), and the asking happens in one place, the band's
 * typing session. So most of this file mounts the real `DockQuickSearch`
 * beside the real `SearchBand` over the real `useSearch`, with `apiFetch`
 * mocked as tests/search-as-you-type.test.tsx does, and a host that stands in
 * for the reading view's one job here: drawing the band when Search mode is
 * open. The owner gate is the Dock's, so it is asked of the real `Dock`.
 *
 * jsdom has no layout and loads no stylesheet, so which of the box and the ⚡
 * a narrow window or a touch screen shows is not visible here — that is the
 * fit ladder's CSS (styles/dock-quick-search.css) and the browser check's.
 * What is visible is the class that says which one Search mode wants.
 */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, SearchRun } from "../src/types.js";
import { PAUSE_MS } from "../src/web/quick-session.js";
import { EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { SearchBand } = await import("../src/web/modes/search/SearchMode.js");
const { DockQuickSearch } = await import("../src/web/DockQuickSearch.js");
const { Dock } = await import("../src/web/Dock.js");

let slugCounter = 0;
/** A fresh article per case: the draft store is per article and outlives a mount. */
let SLUG = "a-paper";
const BLOCKS: Block[] = [
  {
    id: "spya-k3m9qt" as BlockId,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

let host: HTMLDivElement;
let root: Root;

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function pause(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, PAUSE_MS + 80));
  });
  await flush();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Posted {
  id: string;
  criterion: string;
  kind: string;
  revises?: boolean;
}

/** POSTs answer `begin` and hold; the GET answers an empty list. */
function server(): Posted[] {
  const posted: Posted[] = [];
  answer = (_url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") return Promise.resolve(json({ runs: [] }));
    if (method === "POST") {
      const body = JSON.parse(String(init.body)) as Posted;
      posted.push(body);
      const run: SearchRun = {
        id: body.id,
        criterion: body.criterion,
        kind: "quick",
        createdAt: "2026-10-02T09:00:00.000Z",
        status: "pending",
        hits: [],
      };
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`event: begin\ndata: ${JSON.stringify(run)}\n\n`));
        },
      });
      return Promise.resolve(
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      );
    }
    return Promise.resolve(json({ ok: true }));
  };
  return posted;
}

/** Counts the times Search mode was asked to open. */
let opened = 0;

/** The reading view, as far as this feature can see it: the bar, and the band when Search is open. */
function Host({ startOpen, deferBand = false }: { startOpen: boolean; deferBand?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return createElement(
    "div",
    null,
    createElement("input", { className: "elsewhere", "aria-label": "some other box" }),
    open && !deferBand
      ? createElement(SearchBand, {
          slug: SLUG,
          blocks: BLOCKS,
          onJump: () => {},
          onFound: () => {},
          openHit: null,
          onOpenHit: () => {},
        })
      : null,
    createElement(
      "div",
      { className: "dock" },
      createElement(DockQuickSearch, {
        slug: SLUG,
        searching: open,
        onOpen: () => {
          opened++;
          setOpen(true);
        },
      }),
    ),
  );
}

function mount({ startOpen = false, url = "", deferBand = false, strict = false } = {}): void {
  history.replaceState(null, "", `/read/${SLUG}${url}`);
  act(() => {
    root.render(createElement(strict ? StrictMode : "div", null, createElement(NuqsAdapter, null, createElement(Host, { startOpen, deferBand }))));
  });
}

function must<T extends Element>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}
const barBox = () => must<HTMLInputElement>("input.dock-qs-input");
const bolt = () => must<HTMLButtonElement>("button.dock-qs-bolt");
const panelBox = () => host.querySelector<HTMLInputElement>("input.srch-input");
const control = () => must<HTMLElement>(".dock-qs");

function type(el: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    el.focus();
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(el: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}
const match = () => new URLSearchParams(location.search).get("match");

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  SLUG = `a-paper-${++slugCounter}`;
  opened = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const d of document.querySelectorAll("dialog")) d.remove();
});

describe("typing in the bar's box", () => {
  it("opens Search mode on quick at the first pause, asks there, and keeps focus in the bar", async () => {
    const posted = server();
    mount();
    type(barBox(), "why replication");
    await flush();
    expect(opened, "opened before the pause").toBe(0);
    expect(panelBox()).toBeNull();

    await pause();
    expect(opened).toBe(1);
    expect(match()).toBe("quick");
    expect(posted.map((p) => [p.criterion, p.kind, p.revises ?? false])).toEqual([
      ["why replication", "quick", false],
    ]);
    // Sol F2: the panel did not take focus from the box the reader is typing in.
    expect(document.activeElement).toBe(barBox());
    // One draft: the panel's box shows the words typed in the bar.
    expect(panelBox()?.value).toBe("why replication");
    // While it has focus the bar keeps its box, even in Search mode.
    expect(control().classList.contains("dock-qs--bolt")).toBe(false);
  });

  it("only accepts bar edits while its input has focus", async () => {
    const posted = server();
    mount();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(barBox(), "unfocused words");
      barBox().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pause();
    expect(opened).toBe(0);
    expect(posted).toHaveLength(0);
    type(barBox(), "focused words");
    await pause();
    expect(posted.map((p) => p.criterion)).toEqual(["focused words"]);
  });

  it("does not open on a pause of fewer than three characters", async () => {
    server();
    mount();
    type(barBox(), "wh");
    await pause();
    expect(opened).toBe(0);
  });

  it("goes on revising the same row as the reader keeps typing in the bar", async () => {
    const posted = server();
    mount();
    type(barBox(), "why replication");
    await pause();
    type(barBox(), "why replication fails");
    await pause();
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual({
      id: posted[0]?.id,
      criterion: "why replication fails",
      kind: "quick",
      revises: true,
    });
    expect(panelBox()?.value).toBe("why replication fails");
  });

  it("asks at once on Enter, without waiting for the pause", async () => {
    const posted = server();
    mount();
    type(barBox(), "why");
    key(barBox(), { key: "Enter" });
    await flush();
    expect(opened).toBe(1);
    expect(posted.map((p) => p.criterion)).toEqual(["why"]);
    expect(document.activeElement).toBe(barBox());
  });

  it("clears and lets go on Escape", async () => {
    server();
    mount();
    type(barBox(), "why repl");
    key(barBox(), { key: "Escape" });
    expect(barBox().value).toBe("");
    expect(document.activeElement).not.toBe(barBox());
    await pause();
    expect(opened, "a cleared box still opened Search mode").toBe(0);
  });

  it("switches Search mode to quick when it is open on another matcher", async () => {
    const posted = server();
    mount({ startOpen: true, url: "?mode=search&match=meaning" });
    await flush();
    // Open from another door: the panel took focus, as it always has.
    expect(document.activeElement).toBe(panelBox());
    // Search mode open and the bar not focused: the ⚡, not a second box.
    expect(control().classList.contains("dock-qs--bolt")).toBe(true);
    // …so typing in the bar happens after somebody focused it; do so.
    type(barBox(), "why replication");
    await pause();
    expect(match()).toBe("quick");
    expect(posted.map((p) => [p.criterion, p.kind])).toEqual([["why replication", "quick"]]);
  });
});

describe("handoffs before the band mounts", () => {
  it("carries Enter through StrictMode effect replay and delayed loading", async () => {
    const posted = server();
    const originalAnswer = answer;
    let releaseGet = () => {};
    answer = (url, init) => (init.method ?? "GET") === "GET"
      ? new Promise((resolve) => { releaseGet = () => resolve(json({ runs: [] })); })
      : originalAnswer(url, init);
    mount({ url: "?match=quick", strict: true });
    type(barBox(), "why");
    key(barBox(), { key: "Enter" });
    await flush();
    expect(posted).toHaveLength(0);
    releaseGet();
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual(["why"]);
    expect(document.activeElement).toBe(barBox());
  });

  it("seals each Enter with its words and preserves subsequent edits", async () => {
    const posted = server();
    mount({ deferBand: true });
    type(barBox(), "why");
    key(barBox(), { key: "Enter" });
    type(barBox(), "how");
    key(barBox(), { key: "Enter" });
    type(barBox(), "why replication fails");
    mount();
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual(["why", "how"]);
    await pause();
    expect(posted.map((p) => p.criterion)).toEqual(["why", "how", "why replication fails"]);
    expect(new Set(posted.map((p) => p.id)).size).toBe(3);
  });

  it("cancels the old bar timer when the band takes over", async () => {
    const posted = server();
    mount({ deferBand: true });
    type(barBox(), "why");
    key(barBox(), { key: "Enter" });
    type(barBox(), "how replication");
    mount();
    await flush();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    type(barBox(), "how replication fails");
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual(["why"]);
    expect(opened).toBe(1);
    await pause();
    expect(posted.map((p) => p.criterion)).toEqual(["why", "how replication fails"]);
  });

  it("drops an unconsumed handoff when leaving Search mode before its matcher switches", async () => {
    const posted = server();
    mount({ startOpen: true, url: "?mode=search&match=meaning" });
    await flush();
    type(barBox(), "why replication");
    key(barBox(), { key: "Enter" });
    mount({ deferBand: true });
    await flush();
    mount({ startOpen: true, url: "?mode=search&match=quick" });
    await flush();
    await pause();
    expect(posted).toHaveLength(0);
    expect(barBox().value).toBe("why replication");
  });

  it("drops an unconsumed handoff on article departure, retaining only the draft", async () => {
    const posted = server();
    mount({ deferBand: true });
    type(barBox(), "why replication");
    key(barBox(), { key: "Enter" });
    act(() => root.render(null));
    mount({ startOpen: true, url: "?mode=search&match=quick" });
    await flush();
    await pause();
    expect(panelBox()?.value).toBe("why replication");
    expect(posted).toHaveLength(0);
    type(panelBox()!, "why replication fails");
    await pause();
    expect(posted.map((p) => p.criterion)).toEqual(["why replication fails"]);
  });
});

describe("responsive focus", () => {
  it("moves focus to the panel when the final CSS shape hides the focused bar field", async () => {
    server();
    mount();
    act(() => barBox().focus());
    const field = must<HTMLElement>(".dock-qs-field");
    act(() => {
      field.style.display = "none";
      window.dispatchEvent(new Event("resize"));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    await flush();
    expect(opened).toBe(1);
    expect(document.activeElement).toBe(panelBox());
  });
});

describe("preserved boundaries", () => {
  it("words keeps find in the URL without overwriting the shared draft or asking", async () => {
    const posted = server();
    mount({ startOpen: true, url: "?mode=search&match=words" });
    await flush();
    type(panelBox()!, "comparison group");
    await pause();
    expect(new URLSearchParams(location.search).get("find")).toBe("comparison group");
    expect(barBox().value).toBe("");
    expect(posted).toHaveLength(0);
  });

  it("meaning edits share the draft and ask only on Enter", async () => {
    const posted = server();
    mount({ startOpen: true, url: "?mode=search&match=meaning" });
    await flush();
    type(panelBox()!, "comparison group");
    await pause();
    expect(barBox().value).toBe("comparison group");
    expect(posted).toHaveLength(0);
    key(panelBox()!, { key: "Enter" });
    await flush();
    expect(posted.map((p) => [p.criterion, p.kind])).toEqual([["comparison group", "meaning"]]);
  });

  it("unmount removes the shortcut and focus/band registrations", async () => {
    server();
    mount({ startOpen: true, url: "?mode=search&match=quick" });
    await flush();
    const { searchDraftFor } = await import("../src/web/search-draft.js");
    expect(searchDraftFor(SLUG).band()).not.toBeNull();
    act(() => root.render(null));
    expect(key(document.body, { key: "/" }).defaultPrevented).toBe(false);
    expect(searchDraftFor(SLUG).band()).toBeNull();
    expect(searchDraftFor(SLUG).focusBox()).toBe(false);
  });
});

describe("the ⚡ button", () => {
  it("opens Search mode on quick with the panel's box focused", async () => {
    server();
    mount();
    act(() => bolt().click());
    await flush();
    expect(opened).toBe(1);
    expect(match()).toBe("quick");
    expect(document.activeElement).toBe(panelBox());
  });

  it("with Search mode already open, focuses the panel's box inside the tap", async () => {
    server();
    mount({ startOpen: true, url: "?mode=search&match=meaning" });
    await flush();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => bolt().click());
    expect(document.activeElement, "focus waited for a later render").toBe(panelBox());
    await flush();
    expect(match()).toBe("quick");
  });
});

describe("the / key", () => {
  it("focuses the bar's box, and the / is not typed into it", async () => {
    server();
    mount();
    const e = key(document.body, { key: "/" });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(barBox());
    expect(barBox().value).toBe("");
  });

  it("works where / needs Shift", () => {
    server();
    mount();
    key(document.body, { key: "/", shiftKey: true });
    expect(document.activeElement).toBe(barBox());
  });

  it("is ignored while typing, over a dialog, with a modifier, on repeat or mid-composition", () => {
    server();
    mount();
    const other = must<HTMLInputElement>("input.elsewhere");
    act(() => other.focus());
    expect(key(other, { key: "/" }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);
    act(() => other.blur());

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    key(document.body, { key: "/" });
    expect(document.activeElement, "took / from an open dialog").not.toBe(barBox());
    dialog.remove();

    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }]) {
      key(document.body, { key: "/", ...mod });
      expect(document.activeElement, JSON.stringify(mod)).not.toBe(barBox());
    }
    // The positive control: the same harness, a plain /, does reach it.
    key(document.body, { key: "/" });
    expect(document.activeElement).toBe(barBox());
  });

  it("ignores a press somebody else already handled", () => {
    server();
    mount();
    const e = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    e.preventDefault();
    act(() => {
      document.body.dispatchEvent(e);
    });
    expect(document.activeElement).not.toBe(barBox());
  });

  it("in Search mode, where the bar shows the ⚡, focuses the panel's box", async () => {
    server();
    mount({ startOpen: true, url: "?mode=search&match=quick" });
    await flush();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    key(document.body, { key: "/" });
    expect(document.activeElement).toBe(panelBox());
  });
});

describe("only where the band can answer (Sol F8)", () => {
  const drawer = {
    comments: [],
    paragraphs: new Map<string, string>(),
    loaded: true,
    loadError: null,
    error: null,
    panel: null,
    onPanel: () => {},
    onOpenComment: () => {},
  };
  function bar(props: Record<string, unknown>): void {
    history.replaceState(null, "", `/read/${SLUG}`);
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: the bar's arms differ by which props are present, as tests/dock-help-link.test.tsx casts
        createElement(Dock as any, {
          slug: SLUG,
          view: "article",
          mode: "plain",
          onMode: () => {},
          experimental: EXPERIMENTAL_ON,
          ...props,
        }),
      );
    });
  }

  it("is in an owner's bar on the reading view, and / reaches it there", () => {
    bar({ drawer });
    expect(host.querySelector(".dock .dock-qs")).not.toBeNull();
    key(document.body, { key: "/" });
    expect(document.activeElement).toBe(barBox());
  });

  it("is not in a visitor's bar, and / does nothing there", () => {
    bar({ drawer: { ...drawer, visitor: true }, visitor: true });
    expect(host.querySelector(".dock-qs")).toBeNull();
    const e = key(document.body, { key: "/" });
    expect(e.defaultPrevented).toBe(false);
  });

  it("honours the visitor prop independently of the drawer arm", () => {
    bar({ drawer, visitor: true });
    expect(host.querySelector(".dock-qs")).toBeNull();
    expect(key(document.body, { key: "/" }).defaultPrevented).toBe(false);
  });

  it("is not on the metadata page, which has no band", () => {
    bar({ drawer, view: "metadata", mode: undefined, onMode: undefined });
    expect(host.querySelector(".dock-qs")).toBeNull();
  });
});
