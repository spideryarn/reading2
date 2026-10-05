// @vitest-environment jsdom
/**
 * **The arc waits for the real structure, and then runs as on any open** —
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
 * § Review record, GPT Sol's F8.
 *
 * `useArc` posts an `arc` job on every owned open of an article that has none
 * (src/web/useArc.ts). On an article opened before its structure is built, that
 * job would be written against the stand-in tree's parts — or, more likely,
 * meet the server's gate and end `blocked`, which has no Retry.
 *
 * Two halves, and the second is the one a careless fix loses: **waiting must
 * not spend the once-guard.** The guard is a ref keyed on the slug, set just
 * before the POST; a version that set it and then declined to post would never
 * ask again once the tree arrived, and the article would have no arc until a
 * reload.
 *
 * Harness from tests/arc-idle-poll.test.ts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let calls: string[] = [];
let queue: unknown[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SLUG = "arc-before-structure";

const arcJob = {
  id: "aws-j1",
  ownerId: "aws-reader",
  slug: SLUG,
  steps: [{ name: "arc", label: "Arc", status: "queued" }],
  status: "queued",
  createdAt: "2026-10-05T09:00:00.000Z",
};

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    /* No arc has been written: the state the job is asked for from. */
    if (url === `/api/arc/${SLUG}`) return Promise.resolve(new Response(null, { status: 404 }));
    if (method === "POST" && url === "/api/jobs") {
      queue = [arcJob];
      return Promise.resolve(json(arcJob));
    }
    if (url.includes("/advance")) {
      return Promise.resolve(json({ job: arcJob, ran: "arc", busy: true, done: false }));
    }
    return Promise.resolve(json({ jobs: queue }));
  },
  readJson: async (r: Response) => {
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return text === "" ? {} : JSON.parse(text);
  },
  statusOf: () => null,
}));

const { useArc } = await import("../src/web/useArc.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let root: Root | null = null;
let host: HTMLElement | null = null;

function Probe({ awaiting }: { awaiting: boolean }) {
  useArc(SLUG, undefined, awaiting);
  return null;
}

async function show(awaiting: boolean): Promise<void> {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(createElement(Probe, { awaiting }));
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const posts = () => calls.filter((c) => c === "POST /api/jobs");

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jobEngine.reset();
  calls = [];
  queue = [];
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  jobEngine.start("aws-reader");
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  jobEngine.reset();
  vi.useRealTimers();
});

describe("the arc, on an article opened before its structure", () => {
  it("asks for no arc while the tree is the stand-in", async () => {
    await show(true);
    await advance(10_000);

    expect(calls, "the control: it did read, and found none").toContain(`GET /api/arc/${SLUG}`);
    expect(posts()).toEqual([]);
  });

  it("asks for one, once, when the real tree is in", async () => {
    await show(true);
    await advance(10_000);
    expect(posts()).toEqual([]);

    await show(false);
    await advance(10_000);

    expect(posts(), "waiting must not have spent the once-guard").toHaveLength(1);
  });

  it("asks at once on an ordinary open, as it always did", async () => {
    await show(false);
    await advance(10_000);

    expect(posts()).toHaveLength(1);
  });
});
