// @vitest-environment jsdom
/**
 * **Marginalia shows what the modes it reads have made — later, and live.**
 *
 * Marginalia keeps no copy of FAQ, Debate or Ideas: `OwnerMarginFeed` reads each
 * through its read half (`useFaqRead` and the rest) when it mounts. Greg's worry
 * on 2026-10-02 was that a mode generated *after* Marginalia first ran would
 * never reach the margin, and his answer to it was to run every missing mode
 * when Marginalia opens. The first test here is the claim that made that
 * unnecessary: a list written while the margin was shut is there the next time
 * it opens.
 *
 * The rest are the gap that claim left: with the margin **open** on the right
 * while the reader generates FAQ (or Debate, or Ideas) in the left band, the
 * margin heard nothing until it was reopened. It now listens to the same
 * completion feed every band's `useStepJob` does — `useJobs`, quietly — and
 * calls the read's own `refresh`. The real `jobEngine` sits on the mocked
 * network, as in tests/first-poll-completion.test.tsx, because a posed queue
 * could not tell a quiet subscriber that hears completions from one that does
 * not. docs/project/marginalia.md § What it reads.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "live-margin";
const trace: string[] = [];
let present = new Set<string>();
let jobs: Job[] = [];
/** While set, a FAQ read answers what was true when it was *asked*, but only once this resolves. */
let holdFaq: Promise<void> | null = null;

const BODIES: Record<string, unknown> = {
  ideas: {
    ideas: {
      ideas: [{ id: "spya-lm2abc", name: "An idea", provenance: "assumed", statement: "S.", occurrences: [] }],
      profileHash: null,
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  },
  faq: {
    faq: { questions: [{ id: "spya-lm3def", question: "Why?", passages: [] }] },
    stale: false,
    outdated: false,
  },
  debate: {
    debate: { direct: { rows: [] }, claims: { rows: [{ id: "c1" }] } },
    stale: false,
    outdated: false,
  },
};

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    trace.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "GET") return new Response(JSON.stringify({ jobs }), { status: 200 });
    const kind = /^\/api\/(ideas|faq|debate)\//.exec(url)?.[1];
    const there = kind !== undefined && present.has(kind);
    if (kind === "faq" && holdFaq) await holdFaq;
    if (there) return new Response(JSON.stringify(BODIES[kind]), { status: 200 });
    /* **The relation words are already stored.** Since 2026-10-05 the column
       asks for them when it opens on an article with none
       (tests/marginalia-relations-on-open.test.tsx), which is a job of its
       own; every claim below is about the lists the margin reads and never
       makes, on an article at rest. */
    if (url.startsWith("/api/relations/")) {
      return new Response(JSON.stringify({ relations: { relations: {} }, stale: false, outdated: false }), {
        status: 200,
      });
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { OwnerMarginFeed } = await import("../src/web/marginalia/MarginaliaColumn.js");
type MarginFeed = import("../src/web/marginalia/MarginaliaColumn.js").MarginFeed;
const { jobEngine } = await import("../src/web/jobEngine.js");

let host: HTMLDivElement;
let root: Root;
let feed: MarginFeed | null = null;
const onFeed = (next: MarginFeed) => {
  feed = next;
};

function job(id: string, step: string, status: Job["status"], slug = SLUG): Job {
  return {
    id,
    slug,
    status,
    steps: [{ name: step, status: status === "done" ? "done" : "pending" }],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Job;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openMargin(): Promise<void> {
  await act(async () => root.render(createElement(OwnerMarginFeed, { slug: SLUG, shown: true, onFeed })));
  await settle();
}

/** A job going from running to done, one poll each — as the engine sees it. */
async function runs(running: Job[], done: Job[], write?: () => void): Promise<void> {
  jobs = running;
  await act(async () => jobEngine.poke());
  await settle();
  write?.();
  jobs = done;
  await act(async () => jobEngine.poke());
  await settle();
}

const reads = (kind: string) => trace.filter((l) => l === `GET /api/${kind}/${SLUG}`).length;
const artefactReads = () => trace.filter((l) => !l.includes("/api/jobs")).length;

beforeEach(() => {
  trace.length = 0;
  present = new Set();
  jobs = [];
  holdFaq = null;
  feed = null;
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("a list made while the margin was shut", () => {
  it("is in the margin the next time it opens — Marginalia keeps no copy", async () => {
    await openMargin();
    expect(feed?.faq ?? null).toBeNull();
    await act(async () => root.render(null));

    present.add("faq");
    await openMargin();
    expect(feed?.faq?.map((q) => q.id)).toEqual(["spya-lm3def"]);
  });
});

describe("a list made while the margin is open", () => {
  const PICK: Record<string, (f: MarginFeed | null) => readonly unknown[] | null | undefined> = {
    faq: (f) => f?.faq,
    debate: (f) => f?.claims,
    ideas: (f) => f?.ideas,
  };

  for (const step of ["faq", "debate", "ideas"] as const) {
    it(`${step}: appears when its job finishes, with no reopen and no request to start one`, async () => {
      /* The engine is running, as it is for any owner. Its first list is the
         baseline, and history in it is not news. */
      await act(async () => jobEngine.start("reader-1"));
      await openMargin();
      expect(PICK[step]?.(feed) ?? null).toBeNull();
      const before = reads(step);

      await runs([job("j1", step, "running")], [job("j1", step, "done")], () => present.add(step));

      expect(reads(step), "one read after the job, not none").toBe(before + 1);
      expect(PICK[step]?.(feed)?.length).toBe(1);
      /* No job made. The engine does drive the running one
         (`POST /api/jobs/j1/advance`), as it would for the band that started
         it; creating one is `POST /api/jobs` itself. */
      expect(trace.filter((l) => l === "POST /api/jobs")).toEqual([]);
    });
  }

  it("reads nothing again for another article's job, or a step it does not show", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    const before = artefactReads();

    await runs(
      [job("j2", "faq", "running", "another-article"), job("j3", "glossary", "running")],
      [job("j2", "faq", "done", "another-article"), job("j3", "glossary", "done")],
    );

    expect(artefactReads()).toBe(before);
  });

  /* GPT Sol's plan review, finding 3: with every read settled first, `reload`
     would pass the tests above exactly as `refresh` does. Here the margin's
     opening read is still out — having read the article *before* the job wrote
     its list — when the job finishes. `reload` would join it and keep the old
     answer; `refresh` must trail it with a read of its own. */
  it("a read already out when the job finishes is not the answer — a fresh one follows", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await settle();
    let release = () => {};
    holdFaq = new Promise<void>((resolve) => {
      release = resolve;
    });
    await openMargin();
    expect(reads("faq"), "the opening read is out").toBe(1);

    await runs([job("j4", "faq", "running")], [job("j4", "faq", "done")], () => present.add("faq"));
    holdFaq = null;
    await act(async () => release());
    await settle();

    expect(reads("faq"), "the opening read, then one after the job").toBe(2);
    expect(feed?.faq?.map((q) => q.id)).toEqual(["spya-lm3def"]);
  });
});

/* GPT Sol's plan review, finding 4: the zero-request test in
   tests/artefact-read-hooks.test.tsx never starts the engine, and an unstarted
   engine polls for nobody, so it could not see a margin that bought the idle
   poll. tests/arc-idle-poll.test.ts is the harness, and its positive control
   shows the same clock does catch an ordinary subscriber's polls. */
describe("the open margin, at rest", () => {
  it("asks the queue nothing for a minute — it listens, it does not poll", async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      jobEngine.start("reader-1");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(trace.filter((l) => l === "GET /api/jobs").length, "the session's first poll").toBe(1);

      await act(async () => root.render(createElement(OwnerMarginFeed, { slug: SLUG, shown: true, onFeed })));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(trace.filter((l) => l === "GET /api/jobs").length, "queue polls in a minute at rest").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
