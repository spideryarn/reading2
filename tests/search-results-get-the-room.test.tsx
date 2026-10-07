// @vitest-environment jsdom
/**
 * **The results get the room: nothing in the Search panel says what the row
 * above it already says.**
 *
 * Greg, 2026-10-03 (report spya-eqcbay), on a landscape iPad where the results
 * were a 116px window: *"there's something underneath the threshold for
 * prioritize that says nothing is hidden by this threshold. We can get rid of
 * that, I think, because the, you know, n of m above kind of answers that. And
 * there's also a blurb explaining, you know, what the scoring and the visual
 * bars are. Let's rely on tooltips for that"*.
 * docs/plans/261003p-search-results-get-the-room-on-a-landscape-ipad.md.
 *
 * The harness is tests/search-opens-prioritised.test.tsx's: the real band over
 * a stubbed `apiFetch`.
 */
import { readFileSync } from "node:fs";
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
  kind: "meaning",
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

describe("the Search panel keeps its furniture out of the results' way", () => {
  it("prints no foot line under the slider when the threshold hides nothing", async () => {
    await open(`runs=${RUN}&conf=10`);
    expect(host.querySelector(".gloss-gate-value")?.textContent, "the precondition: the slider is drawn").toContain("2 of 2");
    expect(host.querySelector(".gloss-gate-note")).toBeNull();
  });

  it("still says how many are hidden, and the way back, when some are", async () => {
    await open(`runs=${RUN}`);
    expect(host.querySelector(".gloss-gate-value")?.textContent).toContain("1 of 2");
    expect(host.querySelector(".gloss-gate-note")?.textContent).toBe(
      "1 passage is hidden by this threshold. Drag the slider left to show it.",
    );
  });

  it("still says so when the reader has hidden every one, where the list is empty", async () => {
    await open(`runs=${RUN}&conf=80`);
    expect(host.querySelector(".srch-hits")).toBeNull();
    expect(host.querySelector(".gloss-gate-note")?.textContent).toBe(
      "All 2 passages are hidden by this threshold. Drag the slider left to show them.",
    );
  });

  it("draws no legend: the card behind each row's score is what explains it", async () => {
    await open(`runs=${RUN}&conf=10`);
    expect(host.querySelectorAll(".srch-hit").length, "the precondition: rows are drawn").toBe(2);
    expect(host.querySelector(".srch-legend")).toBeNull();
    /* The explanation has to be reachable some other way, or removing the
       legend removed it: each row's gutter is a button that names itself. */
    const gutters = host.querySelectorAll("button.srch-gutter");
    expect(gutters.length).toBe(2);
    expect(gutters[0]?.getAttribute("aria-label")).toMatch(/^About this match: /);
  });

  it("draws no legend in words mode either", async () => {
    const got = await open("match=words&find=in");
    expect(got.found, "the precondition: the word is found").toBeGreaterThan(0);
    expect(host.querySelector(".srch-legend")).toBeNull();
    expect(host.querySelector(".gloss-gate"), "and words mode has no slider at all").toBeNull();
  });

  it("caps the saved searches at a quarter of the panel, so the results get the rest", () => {
    const css = readFileSync("src/web/styles/search.css", "utf8");
    const rule = /\.srch-saved-wrap\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    /* A quarter, with a floor so a phone on its side keeps about two rows. */
    expect(rule).toMatch(/max-height:\s*max\(25%,\s*7\.5rem\)/);
    expect(css).not.toMatch(/\.srch-legend/);
  });
});
