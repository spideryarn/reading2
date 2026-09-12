// @vitest-environment jsdom
/**
 * **A late *Find it* must not draw a web page over a link the article gave.**
 *
 * GPT Sol's code review of Citations mode, F14 (docs/plans/260911g-citations-mode.md
 * § Code-review ledger): *Find it* takes up to a minute, and a re-run of the
 * citations step can land inside it. The re-run inherits the work's id by its
 * dedupe key, so the row the reply is about is still there, under the same id —
 * but it may now carry a DOI the new list found in the article. `find` patched
 * every row with that id, so the DOI on screen was replaced by the web result
 * until the next reload.
 *
 * The server half is already safe (`attachFinds` upgrades only `search` rows);
 * this is the client half. The rule is the server's: **only a `search` row is
 * ever upgraded**, because a link the article gave always wins.
 *
 * The find's reply is held, so the list can move under it — a reply that
 * resolved on arrival could not show the race at all. The re-run arrives through
 * `onFinished`, the seam a finished job really uses, as in
 * tests/background-reload-keeps-the-list.test.tsx.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Citations, CitedWork, FindCitationResponse } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const ID = "spya-c2d3e4";
const BLOCK = "spya-k3m9qt" as BlockId;

function work(over: Partial<CitedWork>): CitedWork {
  return {
    id: ID,
    key: "work:searched|someone|1999",
    title: "Searched",
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [BLOCK],
    firstCited: BLOCK,
    citedInBody: true,
    url: "https://scholar.google.com/scholar?q=Searched",
    linkFrom: "search",
    ...over,
  };
}

const SEARCHED = work({});
const NOW_A_DOI = work({ url: "https://doi.org/10.1000/xyz", linkFrom: "doi" });
const WEB = "https://example.org/searched.pdf";

function artefact(row: CitedWork): Citations {
  return {
    version: "test",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    citations: [row],
    capped: false,
    generatedAt: "2026-09-12T09:00:00.000Z",
    elapsedMs: 1,
  };
}

/** What the GET answers **when it arrives**. Tests move it. */
let listed: CitedWork = SEARCHED;
/** The find's reply, held until the test lets it go. */
let releaseFind: (() => void) | null = null;

const FOUND: FindCitationResponse = {
  outcome: "found",
  work: {
    ...SEARCHED,
    url: WEB,
    linkFrom: "web",
    found: { host: "example.org", searches: 1, model: "test", at: "2026-09-12T09:00:00.000Z" },
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init?: { method?: string }) => {
    if (init?.method === "POST" && input.endsWith("/find")) {
      await new Promise<void>((go) => {
        releaseFind = go;
      });
      return json(FOUND);
    }
    if (input === `/api/citations/${SLUG}`) {
      return json({ citations: artefact(listed), stale: false, outdated: false });
    }
    throw new Error(`the test made an unexpected request: ${input}`);
  },
  leavingFetch: async () => undefined,
  readJson: async (res: Response) => res.json(),
  failure: async (res: Response) => new Error(String(res.status)),
}));

let onFinished: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null =
  null;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (cb?: (job: never) => void) => {
    onFinished = (cb ?? null) as typeof onFinished;
    return {
      jobs: [],
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => null,
      run: async () => ({ id: "job1" }),
      cancel: async () => {},
    };
  },
}));

const { useCitations } = await import("../src/web/useCitations.js");

let hook: ReturnType<typeof useCitations> | null = null;
function Harness(): ReactElement | null {
  hook = useCitations(SLUG);
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  listed = SEARCHED;
  releaseFind = null;
  onFinished = null;
  hook = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Let every pending promise and the renders it causes finish. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await flush();
  expect(hook?.citations?.citations[0]?.linkFrom).toBe("search");
}

/**
 * Press *Find it* and leave its reply held. The find's promise comes back in a
 * box: an async function returning a promise would flatten it, and awaiting the
 * press would then wait on the held reply for ever.
 */
async function press(): Promise<{ pending: Promise<void> | undefined }> {
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = hook?.find(ID);
  });
  expect(hook?.finding).toBe(ID);
  expect(releaseFind).not.toBeNull();
  return { pending };
}

async function answer({ pending }: { pending: Promise<void> | undefined }): Promise<void> {
  await act(async () => {
    releaseFind?.();
    await pending;
  });
  await flush();
}

describe("a find whose reply arrives after the list was found again", () => {
  it("leaves a link the article gave where it is", async () => {
    await open();
    const pending = await press();

    /* The re-run finishes mid-find: same id, and now a DOI. */
    listed = NOW_A_DOI;
    await act(async () => {
      onFinished?.({ slug: SLUG, status: "done", steps: [{ name: "citations" }] });
    });
    await flush();
    /* The refresh really landed — without this the test passes on a hook whose
       `onFinished` was never wired to the read. */
    expect(hook?.citations?.citations[0]?.linkFrom).toBe("doi");

    await answer(pending);

    const row = hook?.citations?.citations[0];
    expect(row?.linkFrom).toBe("doi");
    expect(row?.url).toBe("https://doi.org/10.1000/xyz");
    expect(row?.found).toBeUndefined();
  });

  it("still patches a row that is still searched", async () => {
    /* The sibling, so the test above cannot pass by never patching at all. */
    await open();
    const pending = await press();
    await answer(pending);

    const row = hook?.citations?.citations[0];
    expect(row?.linkFrom).toBe("web");
    expect(row?.url).toBe(WEB);
    expect(row?.found?.host).toBe("example.org");
  });
});
