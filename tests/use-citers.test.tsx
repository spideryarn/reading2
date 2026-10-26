// @vitest-environment jsdom
/**
 * **`useCiters`, the read behind Reception's *Cited by*** — src/web/useCiters.ts,
 * plan 261004h.
 *
 * It is one GET and nothing else, so what is worth holding is *when* it asks:
 * not until the section is wanted, once per article however often Reception is
 * left and come back to, again on *Try again*, and again for another article.
 * And that a failed request is the `unavailable` answer rather than a throw or
 * a spinner that never ends.
 *
 * That it starts no job is tests/modes-that-start-themselves.test.tsx § Debate.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CitersResult } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every address asked for, in order. */
const gets: string[] = [];
const TARGET = { openalexId: "W2626778328", title: "Attention Is All You Need" };
/** What the next GETs answer: a body, or a status that is not ok. */
let answer: CitersResult | number = { kind: "not-indexed" };
let pending: Promise<Response> | null = null;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (pending) return pending;
    return typeof answer === "number"
      ? new Response(JSON.stringify({ error: "no" }), { status: answer })
      : new Response(JSON.stringify(answer), { status: 200 });
  },
  readJson: async (res: Response) => {
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
}));

const { useCiters } = await import("../src/web/useCiters.js");

let host: HTMLDivElement;
let root: Root;
let retry: () => void = () => {};

function Probe({ slug, wanted }: { slug: string; wanted: boolean }) {
  const citers = useCiters(slug, wanted);
  retry = citers.retry;
  return createElement("p", null, citers.result === null ? "waiting" : citers.result.kind);
}

async function show(slug: string, wanted: boolean): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Probe, { slug, wanted })));
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  gets.length = 0;
  answer = { kind: "not-indexed" };
  pending = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("asks nothing until the section is wanted", async () => {
  await show("a-piece", false);
  expect(gets).toEqual([]);
  expect(host.textContent).toBe("waiting");
});

it("asks once, and not again when Reception is left and come back to", async () => {
  await show("a-piece", true);
  expect(gets).toEqual(["/api/citers/a-piece"]);
  expect(host.textContent).toBe("not-indexed");
  await show("a-piece", false);
  await show("a-piece", true);
  expect(gets).toEqual(["/api/citers/a-piece"]);
  expect(host.textContent).toBe("not-indexed");
});

it("asks again on Try again, and shows the new answer", async () => {
  answer = 503;
  await show("a-piece", true);
  expect(host.textContent).toBe("unavailable");
  answer = { kind: "no-doi" };
  await act(async () => retry());
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(gets).toEqual(["/api/citers/a-piece", "/api/citers/a-piece"]);
  expect(host.textContent).toBe("no-doi");
});

it("calls any failed request unavailable: a refusal, a missing article, a broken body", async () => {
  for (const status of [401, 404, 500]) {
    answer = status;
    await show(`piece-${status}`, true);
    expect(host.textContent, String(status)).toBe("unavailable");
  }
});

it("calls a 200 that is not one of the route's answers unavailable, rather than handing it to the panel", async () => {
  /* Found by tests/a-broken-mode-leaves-the-article-readable.test.tsx, whose
     stub answers an unknown route `{}`: the panel switches exhaustively on
     `kind`, so a body with no kind took the whole Debate band down. */
  const bodies: unknown[] = [
    {},
    { kind: "found" },
    { kind: "found", via: "doi", target: TARGET, count: 1, returned: 1, dropped: 0, capped: false, citers: "no", fetchedAt: "2026-10-04T00:00:00Z" },
    /* Plan 261011q: a list must say how it was reached, and name its record. */
    { kind: "found", target: TARGET, count: 0, returned: 0, dropped: 0, capped: false, citers: [], fetchedAt: "2026-10-04T00:00:00Z" },
    { kind: "found", via: "isbn", target: TARGET, count: 0, returned: 0, dropped: 0, capped: false, citers: [], fetchedAt: "2026-10-04T00:00:00Z" },
    { kind: "found", via: "title", target: { openalexId: 7 }, count: 0, returned: 0, dropped: 0, capped: false, citers: [], fetchedAt: "2026-10-04T00:00:00Z" },
    { kind: "found", via: "title", target: { openalexId: "not-a-w-id", title: "A work" }, count: 0, returned: 0, dropped: 0, capped: false, citers: [], fetchedAt: "2026-10-04T00:00:00Z" },
    { kind: "something-new" },
    null,
    [],
  ];
  for (const [i, body] of bodies.entries()) {
    answer = body as CitersResult;
    await show(`odd-${i}`, true);
    expect(host.textContent, JSON.stringify(body)).toBe("unavailable");
  }
  /* The positive control: a well-formed list is passed through. */
  answer = { kind: "found", via: "doi", target: TARGET, count: 0, returned: 0, dropped: 0, capped: false, citers: [], fetchedAt: "2026-10-04T00:00:00Z" };
  await show("fine", true);
  expect(host.textContent).toBe("found");
});

it("asks about another article, and does not show the last one's answer meanwhile", async () => {
  await show("one", true);
  expect(host.textContent).toBe("not-indexed");
  answer = { kind: "no-doi" };
  act(() => {
    root.render(createElement(StrictMode, null, createElement(Probe, { slug: "two", wanted: true })));
  });
  expect(host.textContent).toBe("waiting");
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(gets).toEqual(["/api/citers/one", "/api/citers/two"]);
  expect(host.textContent).toBe("no-doi");
});

it("reads again after a pending article is left for an unwanted section and then revisited", async () => {
  let finish!: (res: Response) => void;
  pending = new Promise<Response>((resolve) => { finish = resolve; });
  await show("one", true);
  await show("two", false);
  pending = null;
  await show("one", true);
  await act(async () => { finish(new Response(JSON.stringify({ kind: "no-doi" }))); });
  expect(gets).toEqual(["/api/citers/one", "/api/citers/one"]);
  expect(host.textContent).toBe("not-indexed");
});

it("refuses malformed citer rows before they can crash the Debate band", async () => {
  const valid = {
    openalexId: "W1", title: "A citing paper", authors: ["Ada Lovelace"],
    authorCount: 1, citedByCount: 0,
  };
  for (const [i, row] of [null, {}, { ...valid, authors: null }, { ...valid, title: {} }].entries()) {
    answer = {
      kind: "found", via: "doi", target: TARGET, count: 1, returned: 1, dropped: 0, capped: false,
      citers: [row], fetchedAt: "2026-10-04T00:00:00Z",
    } as CitersResult;
    await show(`malformed-${i}`, true);
    expect(host.textContent, JSON.stringify(row)).toBe("unavailable");
  }
  answer = {
    kind: "found", via: "doi", target: TARGET, count: 1, returned: 1, dropped: 0, capped: false,
    citers: [valid], fetchedAt: "2026-10-04T00:00:00Z",
  };
  await show("valid-row", true);
  expect(host.textContent).toBe("found");
});

/* ---- *About "keyword"*, plan 261025h, decision 10 (GPT Sol's S1-F5) ---- */

let askTopic: () => void = () => {};
let shownTopic: CitersResult | null | undefined;

function TopicProbe({ slug, wanted = true }: { slug: string; wanted?: boolean }) {
  const citers = useCiters(slug, wanted);
  askTopic = citers.askTopic;
  shownTopic = citers.topic;
  const topic = citers.result?.kind === "found" ? citers.result.topic : undefined;
  return createElement("p", null, topic === undefined ? "no topic" : `${topic.keyword}:${topic.count ?? "?"}`);
}

async function showTopic(slug: string, wanted = true): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(TopicProbe, { slug, wanted })));
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
}

const LANDMARK = {
  kind: "found", via: "doi", target: TARGET, count: 5849, returned: 0, dropped: 0, capped: true, citers: [],
  fetchedAt: "2026-10-25T00:00:00Z", topic: { keyword: "extended mind" },
} as CitersResult;

it("asks the plain list on open and the keyword view only when asked, once", async () => {
  answer = LANDMARK;
  await showTopic("landmark");
  expect(gets).toEqual(["/api/citers/landmark"]);
  expect(host.textContent).toBe("extended mind:?");
  expect(shownTopic).toBeUndefined();
  answer = { ...LANDMARK, count: 1234, topic: { keyword: "extended mind", count: 1234 }, filteredBy: "extended mind" } as CitersResult;
  await act(async () => askTopic());
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(gets).toEqual(["/api/citers/landmark", "/api/citers/landmark?about=topic"]);
  expect(shownTopic?.kind === "found" && shownTopic.filteredBy).toBe("extended mind");
  /* A second press keeps the answer. */
  await act(async () => askTopic());
  expect(gets).toHaveLength(2);

  /* A fresh mount asks for the ordinary list again, but never treats the
     earlier component's choice as a new press of About. */
  await act(async () => root.unmount());
  root = createRoot(host);
  answer = LANDMARK;
  await showTopic("landmark");
  expect(gets).toEqual([
    "/api/citers/landmark",
    "/api/citers/landmark?about=topic",
    "/api/citers/landmark",
  ]);
  expect(shownTopic).toBeUndefined();
});

it("asks again after a pending topic read is invalidated by leaving and returning to the article", async () => {
  const about = {
    ...LANDMARK,
    count: 1234,
    topic: { keyword: "extended mind", count: 1234 },
    filteredBy: "extended mind",
  } as CitersResult;
  answer = LANDMARK;
  await showTopic("landmark");

  let finishOld!: (response: Response) => void;
  pending = new Promise<Response>((resolve) => {
    finishOld = resolve;
  });
  act(() => askTopic());
  expect(gets).toEqual(["/api/citers/landmark", "/api/citers/landmark?about=topic"]);

  /* Changing the callback invalidates the old read in useOrderedRead. The
     middle article does not want citers, as an experiment address does not. */
  await showTopic("another-piece", false);
  pending = null;
  answer = LANDMARK;
  await showTopic("landmark");

  answer = about;
  await act(async () => askTopic());
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(gets).toEqual([
    "/api/citers/landmark",
    "/api/citers/landmark?about=topic",
    "/api/citers/landmark",
    "/api/citers/landmark?about=topic",
  ]);
  expect(shownTopic?.kind === "found" && shownTopic.filteredBy).toBe("extended mind");

  /* The invalidated first reply cannot replace the second one. */
  await act(async () => finishOld(new Response(JSON.stringify(LANDMARK), { status: 200 })));
  expect(shownTopic?.kind === "found" && shownTopic.filteredBy).toBe("extended mind");
});

it("drops a malformed topic label rather than the list", async () => {
  answer = { ...LANDMARK, topic: { keyword: 7 }, filteredBy: 3 } as unknown as CitersResult;
  await showTopic("odd-topic");
  expect(host.textContent).toBe("no topic");
});
