// @vitest-environment jsdom
/**
 * **A second meaning-search can start while the first is still running.**
 *
 * Greg, 2026-09-29 (SPIDERYARN-READING2-5V): *"In the search mode, I want to be
 * able to kick off multiple searches in parallel."* Until then Find was refused
 * while any ticked search was pending — the server, the hook and `?runs=` all
 * coped with several at once, and one `!busy` in `Box` was the whole
 * restriction. docs/plans/260930f-parallel-searches.md.
 *
 * The one refusal kept: **the same question again while it is still running**,
 * because the draft stays in the box after Find and a second press on an
 * unchanged box would pay for an identical search. Every "nothing was sent" is
 * paired with a positive control, so a harness that had stopped reaching the
 * handler could not pass as a refusal.
 *
 * Mounts the real `SearchBand` over the real `useSearch`, with `apiFetch`
 * mocked — the harness tests/opening-read-gates-writes.test.tsx uses. Each POST
 * is a stream the case feeds by hand, so a search can be held open.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, SearchRun } from "../src/types.js";

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
const BLOCK = "spya-k3m9qt" as BlockId;
const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

const FIRST = "anywhere he gives numbers";
const SECOND = "what the controls were";

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** An SSE stream the case writes frames into and closes by hand. */
function openStream(): { response: Response; frame(event: string, data: unknown): void; end(): void } {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
    },
  });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    frame(event, data) {
      ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    end() {
      ctl.close();
    },
  };
}

interface Posted {
  id: string;
  criterion: string;
  stream: ReturnType<typeof openStream>;
}

function server(): Posted[] {
  const posted: Posted[] = [];
  answer = (_url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") return Promise.resolve(json({ runs: [] }));
    if (method === "POST") {
      const { id, criterion } = JSON.parse(String(init.body)) as { id: string; criterion: string };
      const stream = openStream();
      posted.push({ id, criterion, stream });
      stream.frame("begin", run(id, criterion, "pending"));
      return Promise.resolve(stream.response);
    }
    return Promise.resolve(json({ ok: true }));
  };
  return posted;
}

function run(id: string, criterion: string, status: SearchRun["status"]): SearchRun {
  return { id, criterion, createdAt: "2026-09-30T09:00:00.000Z", status, hits: [], sourceHash: "h" };
}

/** Each search finds its own words, so a row can be traced to the search that found it. */
const QUOTE: Record<string, string> = {
  [FIRST]: "Thirty-one participants",
  [SECOND]: "no unexposed comparison group",
};
const hitFor = (p: Posted) => ({
  blockId: BLOCK,
  quote: QUOTE[p.criterion] ?? "",
  confidence: 80,
  reasoning: "r",
});

function hit(p: Posted): void {
  act(() => {
    p.stream.frame("hit", { hit: hitFor(p) });
  });
}

function finish(p: Posted): void {
  act(() => {
    p.stream.frame("done", { ...run(p.id, p.criterion, "done"), hits: [hitFor(p)] });
    p.stream.end();
  });
}

/** A model failure: the request succeeded at recording the question, so it is a `done` carrying `error`. */
function fail(p: Posted, message: string): void {
  act(() => {
    p.stream.frame("done", { ...run(p.id, p.criterion, "error"), error: message });
    p.stream.end();
  });
}

/** Which searches the results list says found its rows — `found by …` in each row's label. */
function foundBy(): string[] {
  return [...host.querySelectorAll(".srch-gutter")]
    .map((b) => /found by (.*?)(,|$)/.exec(b.getAttribute("aria-label") ?? "")?.[1] ?? "?")
    .sort();
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
const box = () => must<HTMLInputElement>('input[aria-label="Describe what to look for"]');
const findButton = () => must<HTMLButtonElement>(".srch-go");

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
/**
 * Which searches are switched on, by criterion — read off the boxes, which
 * follow `?runs=` on every render, rather than off the URL, whose writes nuqs
 * throttles.
 */
function ticked(): string[] {
  return [...host.querySelectorAll<HTMLInputElement>('input[aria-label^="Also mark: "]')]
    .filter((b) => b.checked)
    .map((b) => (b.getAttribute("aria-label") ?? "").slice("Also mark: ".length))
    .sort();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?mode=search`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Search: several meaning-searches at once", () => {
  it("starts a second search while the first is still running, and keeps both switched on", async () => {
    const posted = server();
    mount();
    await flush();

    type(FIRST);
    enter();
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual([FIRST]);

    type(SECOND);
    expect(findButton().disabled, "Find is refused while the first search runs").toBe(false);
    click(findButton());
    await flush();
    expect(posted.map((p) => p.criterion), "the second search was never sent").toEqual([FIRST, SECOND]);
    expect(ticked(), "the second search unticked the first").toEqual([FIRST, SECOND].sort());
    expect(host.querySelectorAll(".srch-spin").length).toBeGreaterThan(0);

    // Hits interleave across the two streams, and each lands in its own search.
    const [first, second] = posted as [Posted, Posted];
    hit(second);
    await flush();
    expect(foundBy()).toEqual([SECOND]);
    hit(first);
    await flush();
    expect(foundBy(), "a streamed hit landed under the wrong search").toEqual([FIRST, SECOND].sort());
    expect(host.textContent).toContain("2 still searching");

    // They finish in the opposite order to the one they started in.
    finish(second);
    await flush();
    expect(host.textContent).toContain("1 still searching");
    finish(first);
    await flush();
    expect(foundBy()).toEqual([FIRST, SECOND].sort());
    expect(host.textContent).not.toContain("still searching");
    expect(host.textContent).not.toContain("searching…");
    expect(ticked()).toEqual([FIRST, SECOND].sort());
  });

  it("lets one search fail while the other finishes", async () => {
    const posted = server();
    mount();
    await flush();
    type(FIRST);
    enter();
    type(SECOND);
    enter();
    await flush();
    const [first, second] = posted as [Posted, Posted];

    fail(first, "The model refused. [ai-refused]");
    await flush();
    finish(second);
    await flush();

    expect(foundBy()).toEqual([SECOND]);
    const failed = host.querySelector('.srch-icon[title*="ai-refused"]');
    expect(failed, "the failed search shows no failure on its row").not.toBeNull();
    expect(host.textContent).not.toContain("still searching");
  });

  it("refuses a repeat of a running question even when it is not switched on", async () => {
    const posted = server();
    mount();
    await flush();
    type(FIRST);
    enter();
    await flush();
    // Untick it: it is still running.
    click(must(`input[aria-label="Also mark: ${FIRST}"]`));
    await flush();
    expect(ticked()).toEqual([]);

    expect(findButton().disabled).toBe(true);
    enter();
    await flush();
    expect(posted).toHaveLength(1);

    // Positive control: a different question goes.
    type(SECOND);
    enter();
    await flush();
    expect(posted).toHaveLength(2);
  });

  it("refuses the same question again while it is still running, and allows it once it has finished", async () => {
    const posted = server();
    mount();
    await flush();

    type(FIRST);
    click(findButton());
    await flush();
    expect(posted).toHaveLength(1);

    // The draft is still in the box. Pressing again would pay for the same search twice.
    expect(box().value).toBe(FIRST);
    expect(findButton().disabled).toBe(true);
    click(findButton());
    enter();
    await flush();
    expect(posted, "an identical search was sent while the first was running").toHaveLength(1);

    // Trailing space is the same question.
    type(`${FIRST} `);
    enter();
    await flush();
    expect(posted).toHaveLength(1);

    // Positive control: once it has finished, the same press sends.
    finish(posted[0] as Posted);
    await flush();
    expect(findButton().disabled).toBe(false);
    enter();
    await flush();
    expect(posted).toHaveLength(2);
  });
});
