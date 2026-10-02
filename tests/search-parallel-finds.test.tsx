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

/**
 * `renamed` maps an id the client sends to the id the server answers `begin`
 * with — what `withRun` does when a "retry" names a row that has not actually
 * failed on the server, so it mints instead of resetting.
 */
function server(
  saved: SearchRun[] = [],
  renamed: Record<string, string> = {},
  beginImmediately = true,
): Posted[] {
  const posted: Posted[] = [];
  answer = (_url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") return Promise.resolve(json({ runs: saved }));
    if (method === "POST") {
      const sent = JSON.parse(String(init.body)) as { id: string; criterion: string };
      const { criterion } = sent;
      const id = renamed[sent.id] ?? sent.id;
      const stream = openStream();
      posted.push({ id, criterion, stream });
      if (beginImmediately) stream.frame("begin", run(id, criterion, "pending"));
      return Promise.resolve(stream.response);
    }
    return Promise.resolve(json({ ok: true }));
  };
  return posted;
}

function run(id: string, criterion: string, status: SearchRun["status"]): SearchRun {
  return { id, criterion, kind: "meaning", createdAt: "2026-09-30T09:00:00.000Z", status, hits: [], sourceHash: "h" };
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

    // Active-set writes compose even if React batches them. nuqs's own
    // functional updater does not advance its ref until React runs its queued
    // state updater, so the mode keeps the synchronous accumulator.
    const ticks = [...host.querySelectorAll<HTMLInputElement>('input[aria-label^="Also mark: "]')];
    act(() => {
      for (const tick of ticks) tick.click();
    });
    await flush();
    expect(ticked(), "one batched untick resurrected the other search").toEqual([]);
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

  it("keeps one search's transport failure visible while the other finishes", async () => {
    const posted = server();
    mount();
    await flush();
    type(FIRST);
    enter();
    type(SECOND);
    enter();
    await flush();
    const [first, second] = posted as [Posted, Posted];

    act(() => first.stream.end());
    await flush();
    finish(second);
    await flush();

    expect(foundBy()).toEqual([SECOND]);
    expect(host.textContent).toContain("The search stopped arriving. Try again.");
    expect(host.querySelector('.srch-icon[title*="stopped arriving"]')).not.toBeNull();
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
    // Both handlers see the same rendered `ready`; the controller's in-flight
    // registry is what makes duplicate protection survive one React batch.
    act(() => {
      findButton().click();
      findButton().click();
    });
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

  it("does not mistake a pending row loaded from the server for a request this tab is watching", async () => {
    const old = run("spya-q7w2er", FIRST, "pending");
    const posted = server([old]);
    mount();
    await flush();

    type(FIRST);
    expect(findButton().disabled, "a persisted pending row wedged Find in this tab").toBe(false);
    enter();
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual([FIRST]);

    // Once this tab has actually sent it, the ordinary duplicate guard applies.
    expect(findButton().disabled).toBe(true);
    enter();
    await flush();
    expect(posted).toHaveLength(1);

    finish(posted[0] as Posted);
    await flush();
    expect(
      findButton().disabled,
      "the persisted pending row kept blocking after this tab's request finished",
    ).toBe(false);
  });

  it("refuses retry while this tab already has the same criterion in flight", async () => {
    const message = "The model service was unavailable. Try again. [ai-500]";
    const failed = { ...run("spya-r8x3tf", FIRST, "error"), error: message };
    const posted = server([failed]);
    mount();
    await flush();

    type(FIRST);
    enter();
    await flush();
    expect(posted).toHaveLength(1);

    const retry = must<HTMLButtonElement>('button.srch-icon[title="Already searching for this question"]');
    expect(retry.disabled).toBe(true);
    click(retry);
    await flush();
    expect(posted, "retry sent a second paid call for the same question").toHaveLength(1);

    finish(posted[0] as Posted);
    await flush();
    const enabled = must<HTMLButtonElement>(`button.srch-icon[title="${message}"]`);
    expect(enabled.disabled).toBe(false);
    click(enabled);
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual([FIRST, FIRST]);
  });

  it("keeps refusing the question when the server answers a retry under a new id, and keeps it ticked", async () => {
    /* The deferred finding from docs/plans/260930f-parallel-searches.md: the
       guard recorded the id this tab sent, `begin` answered with another one,
       and the sent id fell out of the list — so the same question could be
       paid for again while it was still running, and the search the reader was
       watching dropped out of `?runs=`.
       docs/plans/261001i-search-pending-rows-survive-the-trim-and-the-duplicate-guard-follows-a-renamed-run.md */
    const message = "The model service was unavailable. Try again. [ai-500]";
    const sentId = "spya-r8x3tf";
    const serverId = "spya-w4n7pk";
    history.replaceState(null, "", `/read/${SLUG}?mode=search&runs=${sentId}`);
    const posted = server([{ ...run(sentId, FIRST, "error"), error: message }], {
      [sentId]: serverId,
    });
    mount();
    await flush();
    expect(ticked()).toEqual([FIRST]);

    click(must<HTMLButtonElement>(`button.srch-icon[title="${message}"]`));
    await flush();
    expect(posted.map((p) => p.id)).toEqual([serverId]);

    // The same question, while the renamed run is still open: refused.
    type(FIRST);
    enter();
    await flush();
    expect
      .soft(posted, "an identical search was sent while the renamed one was running")
      .toHaveLength(1);
    expect(ticked(), "the renamed search dropped out of ?runs=").toEqual([FIRST]);
    // The URL itself, past nuqs's throttle: `ticked()` reads rows by question,
    // so it cannot see a stale id left beside the live one.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const inUrl = new URLSearchParams(location.search).get("runs") ?? "";
    expect(inUrl).toContain(serverId);
    expect(inUrl).not.toContain(sentId);

    // Positive control: a different question goes.
    type(SECOND);
    enter();
    await flush();
    expect(posted).toHaveLength(2);

    // And once the renamed run has finished, the question is free again.
    finish(posted[0] as Posted);
    await flush();
    type(FIRST);
    enter();
    await flush();
    expect(posted.map((p) => p.criterion)).toEqual([FIRST, SECOND, FIRST]);
  });

  it("does not retick a retry unticked before its renamed begin arrives", async () => {
    const message = "The model service was unavailable. Try again. [ai-500]";
    const sentId = "spya-r8x3tf";
    const serverId = "spya-w4n7pk";
    history.replaceState(null, "", `/read/${SLUG}?mode=search&runs=${sentId}`);
    const posted = server(
      [{ ...run(sentId, FIRST, "error"), error: message }],
      { [sentId]: serverId },
      false,
    );
    mount();
    await flush();

    click(must<HTMLButtonElement>(`button.srch-icon[title="${message}"]`));
    await flush();
    click(must(`input[aria-label="Also mark: ${FIRST}"]`));
    await flush();
    expect(ticked()).toEqual([]);

    act(() => posted[0]?.stream.frame("begin", run(serverId, FIRST, "pending")));
    await flush();
    expect(ticked(), "the delayed rename undid the reader's untick").toEqual([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const inUrl = new URLSearchParams(location.search).get("runs") ?? "";
    expect(inUrl).not.toContain(sentId);
    expect(inUrl).not.toContain(serverId);
  });

  it("keeps a legacy run seed when it appends, and removes that id on delete", async () => {
    const legacyId = "spya-s9y4ug";
    history.replaceState(null, "", `/read/${SLUG}?mode=search&run=${legacyId}`);
    const posted = server([{ ...run(legacyId, FIRST, "done"), hits: [] }]);
    mount();
    await flush();
    expect(ticked()).toEqual([FIRST]);

    type(SECOND);
    enter();
    await flush();
    expect(ticked()).toEqual([FIRST, SECOND].sort());

    const legacyRow = [...host.querySelectorAll<HTMLElement>(".srch-saved-row")].find((row) =>
      row.textContent?.includes(FIRST),
    );
    const remove = legacyRow?.querySelector<HTMLButtonElement>('button[title="Delete this search"]');
    if (!remove) throw new Error("the legacy search has no delete button");
    click(remove);
    await flush();
    expect(ticked()).toEqual([SECOND]);

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    const ids = new URLSearchParams(location.search).get("runs")?.split(",");
    expect(ids).toEqual([posted[0]?.id]);
  });
});
