// @vitest-environment jsdom
/**
 * **A search URL with no `?order=` now filters what reaches the article.**
 *
 * Greg, 2026-09-12: *"Make prioritized the default submode for search."* The
 * parser default is one line in params.ts, and a test of that line alone would
 * not see what it changes, which is not only the list. `SearchBand` publishes
 * its filtered results as the passage set, and `Reader` draws the prose washes,
 * paragraph strength, colour segments and spine lanes from that set — so the
 * bar reaches the article as well as the panel (GPT Sol's plan review,
 * docs/plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md).
 *
 * So these arms read what `Reader` would be holding, through the harness
 * tests/passage-mode-cleanup.test.tsx built for exactly that: the real band over
 * a stubbed `apiFetch`, inside a `NuqsAdapter`, with the published set printed
 * into the DOM.
 */
import { act, createElement, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, SearchRun } from "../src/types.js";
import type { Found } from "../src/web/search-hits.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;

/** tests/passage-mode-cleanup.test.tsx § the same mock, and why both exports. */
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

const SLUG = "a-piece";
const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-m4p7rs" as BlockId;
/* A real id: `?runs=` validates through the block-id pattern. */
const RUN = "spya-rnabcd";

const BLOCKS: Block[] = [
  {
    id: ONE,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
  {
    id: TWO,
    tag: "p",
    kind: "text",
    text: "The effect held in a post-hoc subgroup of eleven.",
    words: 9,
    html: "<p>The effect held in a post-hoc subgroup of eleven.</p>",
    gistable: true,
  },
];

/**
 * One finished meaning-search with a weak hit and a middling one — **20 and 60**,
 * either side of the new default bar of 30 and both under an old `?conf=80`.
 */
const RUN_DONE: SearchRun = {
  id: RUN,
  criterion: "how big was the trial",
  createdAt: "2026-09-12T10:00:00.000Z",
  status: "done",
  hits: [
    { blockId: ONE, quote: "Thirty-one participants", confidence: 60, reasoning: "the size" },
    { blockId: TWO, quote: "post-hoc subgroup", confidence: 20, reasoning: "a subgroup, loosely" },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const serve = (url: string): Promise<Response> => {
  const path = url.split("?")[0] ?? url;
  if (path === `/api/search/${SLUG}`) {
    /* `runs`, the key useSearch.ts reads. A stale fingerprint only flags a run;
       it never drops its hits, so "h" is fine here. */
    return Promise.resolve(json({ runs: [RUN_DONE], sourceHash: "h" }));
  }
  return Promise.resolve(json({ error: "not found" }, 404));
};

/** `Reader`, in miniature: it owns the published set and prints its size. */
function Harness() {
  const [found, setFound] = useState<Found[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const onFound = useCallback((next: Found[]) => setFound(next), []);
  const onOpenKey = useCallback((key: string | null) => setOpenKey(key), []);
  return createElement(
    NuqsAdapter,
    null,
    createElement("div", {
      key: "state",
      id: "state",
      "data-found": String(found.length),
      "data-conf": found.map((f) => f.confidence ?? "null").join(","),
    }),
    createElement(SearchBand, {
      key: "b",
      slug: SLUG,
      blocks: BLOCKS,
      onJump: () => {},
      onFound,
      openHit: openKey,
      onOpenHit: onOpenKey,
    }),
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = (url) => serve(url);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Open the band at a URL and report what `Reader` is holding. */
async function open(query: string): Promise<{ found: number; conf: string }> {
  history.replaceState(null, "", `/read/${SLUG}?mode=search&${query}`);
  act(() => root.render(createElement(Harness)));
  await flush();
  const el = host.querySelector("#state");
  return {
    found: Number(el?.getAttribute("data-found") ?? "-1"),
    conf: el?.getAttribute("data-conf") ?? "missing",
  };
}

describe("search opens on the prioritised order", () => {
  it("publishes only the hits the default bar keeps, to the prose as well as the list", async () => {
    const got = await open(`runs=${RUN}`);
    expect(got.conf, "the 60 stays; the 20 is under the bar at 30").toBe("60");
  });

  it("still means place order with nothing hidden when a link says ?order=document", async () => {
    /* The precondition for the arm above: both hits resolve, so a one-hit
       answer there is the bar and not a quote that failed to anchor. */
    const got = await open(`runs=${RUN}&order=document`);
    expect(got.found).toBe(2);
  });

  it("filters at a leftover ?conf= in a link written before the default changed", async () => {
    /* Accepted, not migrated — the plan's § The search default. A reader who
       chose prioritised, dragged to 80 and went back to *by place* left this
       URL behind; it used to filter nothing and now filters at 80. */
    const got = await open(`runs=${RUN}&conf=80`);
    expect(got.found).toBe(0);
  });

  it("leaves the words matcher's list exactly as it was", async () => {
    /* Every literal match has a null confidence, which survives any bar
       (threshold.ts), so defaulting to prioritised changes nothing here — the
       library's passage deep-link included, which says `match=words`. */
    const bare = await open("match=words&find=in");
    act(() => root.unmount());
    root = createRoot(host);
    const byPlace = await open("match=words&find=in&order=document");
    expect(bare.found, "the precondition: the word is found at all").toBeGreaterThan(0);
    expect(bare).toEqual(byPlace);
  });
});
