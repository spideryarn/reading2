// @vitest-environment jsdom
/**
 * **A read hook reads, and that is all it does** — `useIdeasRead` and
 * `useTimelineRead`, split out of their mode hooks for Skim's stop
 * card (Sol F22, docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md
 * § Revised after GPT Sol's stage-3 plan review), and `useFaqRead` and
 * `useDebateRead`, split out for Marginalia's notes (plan 261002b).
 *
 * The card promises that nothing on it starts a run. With the mode hooks that
 * was true only because `useAutoRun` happened not to fire for another mode's
 * activation; with these it is true because there is no job machinery in the
 * hook at all. So the claim here is about the requests: each hook makes its one
 * GET, and **never** a POST to `/api/jobs` nor a poll of the queue — even when
 * the answer is a 404, which is exactly the state in which a mode hook's
 * automatic run would spend.
 *
 * The positive control is the mode hook beside each one, mounted the same way:
 * it polls the queue (`useStepJob`), which is how this test knows the network
 * spy can see a job request at all.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asked: { url: string; method: string }[] = [];
/** Which artefacts exist; the rest answer 404. */
let present = new Set<string>();
let failNext = new Set<string>();

const BODIES: Record<string, unknown> = {
  ideas: {
    ideas: {
      version: "ideas/t",
      generator: "t",
      slug: "read-hooks",
      sourceHash: "h",
      profileHash: null,
      ideas: [{ id: "spya-rh2abc", name: "An idea", provenance: "assumed", statement: "S.", occurrences: [] }],
      generatedAt: "",
      elapsedMs: 0,
    },
    stale: true,
    outdated: false,
    profileChanged: false,
  },
  faq: {
    faq: {
      version: "faq/t",
      generator: "t",
      slug: "read-hooks",
      sourceHash: "h",
      questions: [{ id: "spya-rh3def", question: "Why?", passages: [] }],
      dropped: {},
      generatedAt: "",
      elapsedMs: 0,
    },
    stale: false,
    outdated: true,
  },
  debate: {
    debate: {
      version: "debate/t",
      generator: "t",
      slug: "read-hooks",
      sourceHash: "h",
      direct: { rows: [] },
      claims: { rows: [] },
    },
    stale: false,
    outdated: false,
  },
  timeline: {
    timeline: {
      version: "timeline/t",
      generator: "t",
      slug: "read-hooks",
      sourceHash: "h",
      events: [],
      orderConflicts: 0,
      generatedAt: "",
      elapsedMs: 0,
    },
    stale: false,
    outdated: false,
  },
};

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? "GET" });
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    const kind = /^\/api\/(ideas|faq|debate|timeline)\//.exec(url)?.[1];
    if (kind && failNext.delete(kind)) throw new Error(`${kind} read failed`);
    if (kind && present.has(kind)) return new Response(JSON.stringify(BODIES[kind]), { status: 200 });
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { useIdeas, useIdeasRead } = await import("../src/web/useIdeas.js");
const faqHooks = await import("../src/web/useFaq.js");
const { useFaq, useFaqRead } = faqHooks;
const { useDebate, useDebateRead } = await import("../src/web/useDebate.js");
const { useTimeline, useTimelineRead } = await import("../src/web/useTimeline.js");
const { OwnerMarginFeed } = await import("../src/web/marginalia/MarginaliaColumn.js");

let host: HTMLDivElement;
let root: Root;
let seen: Record<string, unknown> = {};

beforeEach(() => {
  asked.length = 0;
  present = new Set();
  failNext = new Set();
  seen = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Probe({ use, name }: { use: (slug: string) => unknown; name: string }): ReactElement | null {
  seen[name] = use("read-hooks");
  return null;
}

async function mount(use: (slug: string) => unknown, name: string): Promise<void> {
  await act(async () => root.render(createElement(Probe, { use, name, key: name })));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

const jobRequests = () => asked.filter((r) => r.url.startsWith("/api/jobs"));

/* FAQ and Debate since 2026-10-02: Marginalia reads both and must never
   spend (plan 261002b, GPT Sol's F1 on it). Debate is the dearest step in the
   app to start by accident. */
const READS = [
  ["ideas", useIdeasRead],
  ["faq", useFaqRead],
  ["debate", useDebateRead],
  ["timeline", useTimelineRead],
] as const;

describe("the read hooks start no job", () => {
  it("the actual owner Marginalia feed performs only its three artefact GETs", async () => {
    await act(async () => {
      root.render(createElement(OwnerMarginFeed, { slug: "read-hooks", onFeed: vi.fn() }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(asked.map((request) => request.url).sort()).toEqual([
      "/api/debate/read-hooks",
      "/api/faq/read-hooks",
      "/api/ideas/read-hooks",
    ]);
    expect(jobRequests()).toEqual([]);
  });

  for (const [kind, use] of READS) {
    it(`${kind}: one GET, no job request, even when there is nothing there`, async () => {
      await mount(use, kind);
      expect(asked).toEqual([{ url: `/api/${kind}/read-hooks`, method: "GET" }]);
      expect(jobRequests()).toEqual([]);
      expect((seen[kind] as { status: string }).status).toBe("none");
    });
  }

  it("each reads what is there, with its freshness", async () => {
    present = new Set(["ideas", "timeline"]);
    await mount(useIdeasRead, "ideas");
    const ideas = seen.ideas as ReturnType<typeof useIdeasRead>;
    expect([ideas.status, ideas.stale, ideas.ideas?.ideas[0]?.name]).toEqual(["ready", true, "An idea"]);

    await mount(useTimelineRead, "timeline");
    const timeline = seen.timeline as ReturnType<typeof useTimelineRead>;
    expect([timeline.status, timeline.timeline?.events]).toEqual(["ready", []]);
    expect(jobRequests()).toEqual([]);
  });

  it("FAQ retryRead repeats only its failed GET", async () => {
    failNext.add("faq");
    await mount(useFaq, "faq");
    const failed = seen.faq as ReturnType<typeof useFaq>;
    expect([failed.status, failed.error]).toEqual(["error", "faq read failed"]);

    await act(async () => failed.retryRead());
    const retried = seen.faq as ReturnType<typeof useFaq>;
    expect([retried.status, retried.error]).toEqual(["none", null]);
    expect(asked.filter((r) => r.url === "/api/faq/read-hooks")).toHaveLength(2);
    expect(jobRequests().filter((request) => request.method === "POST")).toEqual([]);
  });
});

describe("the positive control: a mode hook can reach the queue, and a read hook has no way to", () => {
  const MODES = [
    ["ideas", useIdeas, useIdeasRead],
    ["faq", useFaq, useFaqRead],
    ["debate", useDebate, useDebateRead],
    ["timeline", useTimeline, useTimelineRead],
  ] as const;
  for (const [kind, useMode, useRead] of MODES) {
    it(`${kind}: the mode hook's ensure POSTs a job the spy sees; the read hook has no verb that could`, async () => {
      await mount(useMode, kind);
      const mode = seen[kind] as { ensure(): Promise<void> };
      await act(async () => {
        await mode.ensure().catch(() => undefined);
      });
      expect(jobRequests().some((r) => r.method === "POST")).toBe(true);

      await mount(useRead, `${kind}-read`);
      const read = seen[`${kind}-read`] as Record<string, unknown>;
      for (const verb of ["ensure", "regenerate", "cancel", "job"]) expect(read).not.toHaveProperty(verb);
    });
  }

  it("FAQ's mode hook still reads through its read half, freshness and all", async () => {
    present = new Set(["faq"]);
    await mount(useFaq, "faq");
    const mode = seen.faq as ReturnType<typeof useFaq>;
    expect([mode.status, mode.stale, mode.outdated, mode.faq?.questions[0]?.question]).toEqual([
      "ready",
      false,
      true,
      "Why?",
    ]);
    await act(async () => {
      await mode.ensure().catch(() => undefined);
    });
    expect(jobRequests().some((r) => r.method === "POST")).toBe(true);
  });
});
