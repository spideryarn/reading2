// @vitest-environment jsdom
/**
 * **An always-mounted read hears its own step finish** — Citations, Glossary
 * and Quotes, whose reads `OwnedReader` holds in every mode because the prose
 * marks them (and Marginalia shows the citations).
 *
 * Until 2026-10-02 every revalidation of these belonged to the band: a run
 * that finished after the reader had left the band reached neither the prose
 * nor the margin until the band was reopened or the page reloaded. Each read
 * now listens through `useStepFinished` (src/web/useStepJob.ts), quietly —
 * the same fix as Marginalia's (tests/marginalia-live-refresh.test.tsx, plan
 * 261002d), whose harness this is: the real `jobEngine` on a mocked network.
 *
 * The band is deliberately not mounted here. That is the case: the reader left
 * it, so nothing else is listening.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "always-mounted";
const trace: string[] = [];
let jobs: Job[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    trace.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "GET") return new Response(JSON.stringify({ jobs }), { status: 200 });
    /* Every artefact answers "none yet". The claim is about whether the read
       is asked again, which a body would not change. */
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { useCitationsRead } = await import("../src/web/useCitations.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { useQuotesRead } = await import("../src/web/useQuotes.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const READS = [
  ["citations", useCitationsRead],
  ["glossary", useGlossaryRead],
  ["quotes", useQuotesRead],
] as const;

let host: HTMLDivElement;
let root: Root;

function Probe({ use }: { use: (slug: string) => unknown }) {
  use(SLUG);
  return null;
}

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

/** A job going from running to done, one poll each — as the engine sees it. */
async function runs(running: Job[], done: Job[]): Promise<void> {
  for (const list of [running, done]) {
    jobs = list;
    await act(async () => jobEngine.poke());
    await settle();
  }
}

const artefactReads = () => trace.filter((l) => l.startsWith("GET ") && !l.includes("/api/jobs"));

beforeEach(async () => {
  trace.length = 0;
  jobs = [];
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* Running, as it is for any owner; its first list is the baseline. */
  await act(async () => jobEngine.start("reader-1"));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("a run that finishes after the reader left the band", () => {
  for (const [step, use] of READS) {
    it(`${step}: the always-mounted read asks again, and starts nothing`, async () => {
      await act(async () => root.render(createElement(Probe, { use })));
      await settle();
      const url = `GET /api/${step}/${SLUG}`;
      expect(artefactReads(), "the opening read").toEqual([url]);

      await runs([job("j1", step, "running")], [job("j1", step, "done")]);

      expect(artefactReads(), "one read after the job, not none").toEqual([url, url]);
      expect(trace.filter((l) => l === "POST /api/jobs")).toEqual([]);
    });
  }

  it("another article's run, or another step's, is not news", async () => {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          READS.map(([step, use]) => createElement(Probe, { use, key: step })),
        ),
      ),
    );
    await settle();
    const before = artefactReads().length;

    await runs(
      [job("j2", "quotes", "running", "another-article"), job("j3", "faq", "running")],
      [job("j2", "quotes", "done", "another-article"), job("j3", "faq", "done")],
    );

    expect(artefactReads().length).toBe(before);
  });
});
