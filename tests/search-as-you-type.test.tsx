// @vitest-environment jsdom
/**
 * **Quick search, as you type** — plan 261002h, stage 2.
 *
 * The real `SearchBand` over the real `useSearch`, `apiFetch` mocked, as
 * tests/search-parallel-finds.test.tsx does. Real timers: the pause is 600 ms
 * and the cases wait it out, because a fake clock and a hand-fed stream fight
 * over the same `setTimeout`.
 *
 * Every "nothing was sent" sits beside a positive control, so a harness that
 * had stopped reaching the handler could not pass as a refusal.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, SearchRun } from "../src/types.js";
import { PAUSE_MS } from "../src/web/quick-session.js";

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

const SLUG = "a-paper";
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
/** Wait out the pause, and a little more. */
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
  body: { id: string; criterion: string; kind: string; revises?: boolean };
  signal: AbortSignal | undefined;
}

/** A server whose POSTs answer `begin` at once and then hold; the GET can be held too. */
function server({ holdGet = false } = {}): { posted: Posted[]; releaseGet(): void } {
  const posted: Posted[] = [];
  let releaseGet = () => {};
  answer = (_url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") {
      if (!holdGet) return Promise.resolve(json({ runs: [] }));
      return new Promise((resolve) => {
        releaseGet = () => resolve(json({ runs: [] }));
      });
    }
    if (method === "POST") {
      const body = JSON.parse(String(init.body)) as Posted["body"];
      posted.push({ body, signal: init.signal ?? undefined });
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
  return { posted, releaseGet: () => releaseGet() };
}

function mount(): void {
  act(() => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(SearchBand, {
          slug: SLUG,
          blocks: BLOCKS,
          onJump: () => {},
          onFound: () => {},
          openHit: null,
          onOpenHit: () => {},
        }),
      ),
    );
  });
}

function must<T extends Element>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}
const box = () => must<HTMLInputElement>("input.srch-input");

function type(text: string): void {
  const el = box();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function enter(): void {
  act(() => {
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}
function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}
const matcher = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".srch-mode")].find((b) =>
    b.textContent?.includes(name),
  )!;
/** Ticked rows, by criterion — read off the boxes, which follow `?runs=`. */
function ticked(): string[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[aria-label^="Also mark: "]')]
    .filter((b) => b.checked)
    .map((b) => (b.getAttribute("aria-label") ?? "").slice("Also mark: ".length));
}
const rows = () => host.querySelectorAll('input[aria-label^="Also mark: "]').length;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?mode=search&match=quick`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("quick search as you type", () => {
  it("asks on the first pause, then revises that same row — one row, ticked once", async () => {
    const { posted } = server();
    mount();
    await flush();

    type("why");
    await flush();
    expect(posted, "asked before the pause").toHaveLength(0);
    await pause();
    expect(posted.map((p) => p.body)).toEqual([
      { id: expect.any(String), criterion: "why", kind: "quick" },
    ]);
    const id = posted[0]!.body.id;

    type("why replication");
    await pause();
    expect(posted[1]?.body).toEqual({ id, criterion: "why replication", kind: "quick", revises: true });
    // The superseded request is cancelled at the client end too.
    expect(posted[0]!.signal?.aborted).toBe(true);
    expect(rows()).toBe(1);
    expect(ticked()).toEqual(["why replication"]);
  });

  it("asks nothing for fewer than three characters, or for unchanged words", async () => {
    const { posted } = server();
    mount();
    await flush();
    type("wh");
    await pause();
    expect(posted).toHaveLength(0);
    type("why");
    await pause();
    expect(posted).toHaveLength(1);
    type("why ");
    await pause();
    expect(posted).toHaveLength(1);
  });

  it("Enter flushes the words into the row and ends the session; the next words are a new row", async () => {
    const { posted } = server();
    mount();
    await flush();
    type("why");
    await pause();
    type("why not");
    enter();
    await flush();
    expect(posted.map((p) => [p.body.criterion, p.body.revises ?? false])).toEqual([
      ["why", false],
      ["why not", true],
    ]);
    // Enter again on unchanged words asks nothing: the words are already running.
    enter();
    await flush();
    expect(posted).toHaveLength(2);

    type("why not now");
    await pause();
    expect(posted[2]?.body.revises).toBeUndefined();
    expect(posted[2]?.body.id).not.toBe(posted[0]?.body.id);
    expect(rows()).toBe(2);
  });

  it("does not re-tick a row the reader unticked", async () => {
    const { posted } = server();
    mount();
    await flush();
    type("why");
    await pause();
    click(must('input[aria-label="Also mark: why"]'));
    await flush();
    expect(ticked()).toEqual([]);
    type("why not");
    await pause();
    expect(posted).toHaveLength(2);
    expect(ticked()).toEqual([]);
  });

  it("waits for the saved list before the first ask, then asks the latest words (F1)", async () => {
    const { posted, releaseGet } = server({ holdGet: true });
    mount();
    await flush();
    type("why replication");
    await pause();
    expect(posted).toHaveLength(0);
    act(() => releaseGet());
    await flush();
    expect(posted.map((p) => p.body.criterion)).toEqual(["why replication"]);
    expect(rows()).toBe(1);
  });

  it("leaves words inert after a matcher switch: nothing is asked until the next edit", async () => {
    const { posted } = server();
    mount();
    await flush();
    type("why");
    await pause();
    expect(posted).toHaveLength(1);
    click(matcher("meaning"));
    click(matcher("quick"));
    await pause();
    expect(posted).toHaveLength(1);
    // And the next edit starts a new row rather than revising the old one.
    type("why not");
    await pause();
    expect(posted[1]?.body.revises).toBeUndefined();
  });

  it("never asks while the matcher is meaning", async () => {
    const { posted } = server();
    history.replaceState(null, "", `/read/${SLUG}?mode=search&match=meaning`);
    mount();
    await flush();
    type("why replication");
    await pause();
    expect(posted).toHaveLength(0);
    enter();
    await flush();
    expect(posted.map((p) => p.body.kind)).toEqual(["meaning"]);
  });
});
