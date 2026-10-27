// @vitest-environment jsdom
/**
 * **Several Skim briefs, the client half** — plan
 * docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md § Stage 3.
 *
 * - A brief's `skim` job is not the default's (GPT Sol's C4): `useStepJob`
 *   scopes its job, completion and failure by target, so the default band and
 *   Metadata's Skim row (which call it with no brief) neither show a brief's
 *   progress nor offer to retry it — and the id must be on the wire for that.
 * - One route's state is not another's (Sol F4): the read, the dismissal, the
 *   job request and the rewrite hold all name the brief.
 * - The client module mints the brief's id, as Chat mints a thread's.
 * - `?brief=` is remembered with its `?stop=` and `?depth=` (Sol F7).
 *
 * The band itself (an added brief's route drawn, *Plan this route*, the
 * unknown id cleared) is in tests/skim-panel.test.tsx § an added brief.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, SkimResponse } from "../src/types.js";
import type { IdeasRead } from "../src/web/useIdeas.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import { isSpideryarnId } from "../src/ids.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ the network -- */

const requests: Array<{ url: string; method: string; body: unknown }> = [];
/** Answers by path; anything unlisted is a 404. */
let serve: (url: string, method: string) => Response = () => new Response(null, { status: 404 });

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      return serve(url, method);
    },
  };
});

/* The queue, posed: a list of jobs, the callback the engine announces through,
   and what each press asked for. */
let jobs: Job[] = [];
const announcers: Array<(job: Job) => void> = [];
const posted: unknown[] = [];
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (_cadence: unknown, cb?: (job: Job) => void) => {
    if (cb) announcers.push(cb);
    return {
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => null,
      run: async (request: unknown) => {
        posted.push(request);
        return { id: `spya-job${posted.length}x` };
      },
      cancel: async () => {},
      retry: async () => null,
    };
  },
}));

const { useStepJob, writesStep } = await import("../src/web/useStepJob.js");
const { useSkim } = await import("../src/web/useSkim.js");
const { rewriteHeld } = await import("../src/web/rewrite-hold.js");
const { createBrief, deleteBrief, editBrief, listBriefs } = await import("../src/web/skim-briefs.js");
const { rememberableSearch } = await import("../src/web/last-view.js");
type StepJob = import("../src/web/useStepJob.js").StepJob<"skim">;
type UseSkim = import("../src/web/useSkim.js").UseSkim;

const SLUG = "a-piece";
const BRIEF = "spya-bf2abc";
const OTHER_BRIEF = "spya-bf3def";

function skimJob(over: Partial<Job>): Job {
  return {
    id: "spya-jb2abc",
    slug: SLUG,
    status: "running",
    createdAt: "2026-10-27T09:00:00.000Z",
    steps: [{ name: "skim", status: "running" }],
    ...over,
  } as Job;
}

let host: HTMLDivElement;
let root: Root;
const flush = async () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  requests.length = 0;
  posted.length = 0;
  announcers.length = 0;
  jobs = [];
  serve = () => new Response(null, { status: 404 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/* ============================================================ C4: the job == */

describe("a brief's skim job, told from the default's", () => {
  it("writesStep scopes skim by target, and leaves a brief job's prerequisites ordinary", () => {
    const brief = skimJob({ skimBrief: BRIEF, steps: [{ name: "quotes" }, { name: "skim" }] as Job["steps"] });
    const plain = skimJob({});
    expect(writesStep(brief, "skim")).toBe(false);
    expect(writesStep(brief, "skim", BRIEF)).toBe(true);
    expect(writesStep(brief, "skim", OTHER_BRIEF)).toBe(false);
    expect(writesStep(plain, "skim")).toBe(true);
    expect(writesStep(plain, "skim", BRIEF)).toBe(false);
    expect(writesStep(brief, "quotes"), "a brief job's Quotes are the article's Quotes").toBe(true);
  });

  let seen: Record<string, StepJob> = {};
  const finished: string[] = [];
  function Probe({ brief }: { brief: string | null }) {
    seen[brief ?? "default"] = useStepJob(SLUG, "skim", () => finished.push(brief ?? "default"), "watches-queue", brief);
    return null;
  }

  async function mountBoth() {
    seen = {};
    finished.length = 0;
    await act(async () =>
      root.render(
        createElement("div", null, createElement(Probe, { brief: null }), createElement(Probe, { brief: BRIEF })),
      ),
    );
    await flush();
  }

  it("the default's surface (the band, Metadata's row) neither shows a brief's job nor offers to retry its failure", async () => {
    jobs = [skimJob({ skimBrief: BRIEF, status: "running" })];
    await mountBoth();
    expect(seen.default!.job, "the default band would show the brief's progress").toBeNull();
    expect(seen[BRIEF]!.job?.id).toBe("spya-jb2abc");

    /* It fails: the brief's surface says so; the default's offers no Retry. */
    jobs = [skimJob({ skimBrief: BRIEF, status: "error", error: "It broke." })];
    await mountBoth();
    expect(seen.default!.failed, "Metadata's Skim row would retry the brief's job").toBeNull();

    /* A brief job's completion is not the default's news. */
    for (const announce of announcers) announce(skimJob({ skimBrief: BRIEF, status: "done" }));
    expect(finished, "the default heard a brief's completion").not.toContain("default");
    expect(finished).toContain(BRIEF);
  });

  it("a brief's surface does not take the default's job as its own", async () => {
    jobs = [skimJob({ status: "running" })];
    await mountBoth();
    expect(seen.default!.job?.id).toBe("spya-jb2abc");
    expect(seen[BRIEF]!.job).toBeNull();
  });

  it("a brief's start names the brief on every request", async () => {
    await mountBoth();
    await act(async () => void (await seen[BRIEF]!.start({ force: true })));
    await act(async () => void (await seen.default!.start({ force: true })));
    expect(posted).toEqual([
      { slug: SLUG, steps: ["skim"], force: ["skim"], skimBrief: BRIEF },
      { slug: SLUG, steps: ["skim"], force: ["skim"] },
    ]);
  });
});

/* ======================================================= F4: one route's state == */

const AT = "2026-10-27T10:00:00.000Z";
const routeReply = (over: Partial<SkimResponse> = {}): SkimResponse => ({
  skim: {
    version: "test",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    profileHash: null,
    stops: [],
    visible: [0, 0, 0],
    offered: 0,
    dropped: { collapsed: 0, unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0 },
    generatedAt: AT,
    elapsedMs: 1,
  },
  stale: false,
  outdated: false,
  profileChanged: true,
  profileNoticeDismissed: false,
  notOnRoute: 0,
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fresh = { begin: () => 0, landed: () => {}, begun: () => 0, latest: null };
const quotes = {
  status: "ready",
  quotes: { quotes: [] },
  stale: false,
  fresh,
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
} as unknown as QuotesRead;
const ideas = { ...quotes, ideas: { ideas: [] } } as unknown as IdeasRead;

describe("useSkim on an added brief", () => {
  let read: UseSkim | null = null;
  function Probe({ brief }: { brief: string | null }) {
    read = useSkim(SLUG, quotes, ideas, brief);
    return null;
  }
  async function mount(brief: string | null) {
    await act(async () => root.render(createElement(Probe, { brief })));
    await flush();
  }

  it("reads and dismisses the brief's route, at the brief's own address", async () => {
    serve = (url, method) =>
      url === `/api/skim/${SLUG}/briefs/${BRIEF}` && method === "GET"
        ? json(routeReply())
        : method === "POST"
          ? new Response(null, { status: 204 })
          : new Response(null, { status: 404 });
    await mount(BRIEF);
    expect(read!.status).toBe("ready");
    expect(read!.brief).toBe(BRIEF);
    await act(async () => read!.dismissProfileNotice());
    await flush();
    const urls = requests.map((r) => `${r.method} ${r.url}`);
    expect(urls).toContain(`POST /api/skim/${SLUG}/briefs/${BRIEF}/profile-notice-dismissal`);
    expect(urls.some((u) => u.endsWith(`/api/skim/${SLUG}`) || u.endsWith(`/api/skim/${SLUG}/profile-notice-dismissal`))).toBe(
      false,
    );
  });

  it("an unplanned brief is the empty state; a brief that is not there is a failure, not a button", async () => {
    serve = () => json(null);
    await mount(BRIEF);
    expect(read!.status).toBe("none");

    serve = () => json({ error: "No such Skim brief on this article." }, 404);
    /* Keyed by route, as `SkimBand` mounts it. */
    await act(async () => root.render(createElement(Probe, { key: OTHER_BRIEF, brief: OTHER_BRIEF })));
    await flush();
    expect(read!.status).toBe("error");
  });

  it("holds the brief's forced rewrite under the brief, not under the default", async () => {
    serve = () => json(routeReply({ profileChanged: false }));
    await mount(BRIEF);
    await act(async () => void (await read!.regenerate()));
    await flush();
    expect(posted.at(-1)).toEqual({ slug: SLUG, steps: ["skim"], force: ["skim"], skimBrief: BRIEF });
    expect(read!.rewriting).toBe(true);
    expect(rewriteHeld(SLUG, "skim"), "the brief's press held the default's route").toBe(false);
  });
});

/* ===================================================== the client module == */

describe("skim-briefs.ts", () => {
  it("creates with an id minted here, and edits, lists and deletes at the brief's address", async () => {
    const row = { id: BRIEF, brief: "Only the statistics", createdAt: AT, plannedAt: null, planned: false };
    serve = (_url, method) =>
      method === "DELETE" ? new Response(null, { status: 204 }) : json(method === "GET" ? { briefs: [row] } : row, method === "POST" ? 201 : 200);
    await createBrief(SLUG, "Only the statistics");
    const sent = requests[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(`/api/skim/${SLUG}/briefs`);
    const body = sent.body as { id: string; brief: string };
    expect(isSpideryarnId(body.id), "the client mints the id, as Chat does").toBe(true);
    expect(body.brief).toBe("Only the statistics");

    await createBrief(SLUG, "Only the statistics", body.id);
    expect((requests[1]!.body as { id: string }).id, "a retry sends the same id").toBe(body.id);

    expect(await listBriefs(SLUG)).toEqual([row]);
    await editBrief(SLUG, BRIEF, "Just the methods");
    await deleteBrief(SLUG, BRIEF);
    expect(requests.slice(2).map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/skim/${SLUG}/briefs`,
      `PATCH /api/skim/${SLUG}/briefs/${BRIEF}`,
      `DELETE /api/skim/${SLUG}/briefs/${BRIEF}`,
    ]);
  });
});

/* ======================================================== F7: remembered == */

describe("?brief= remembered with its position", () => {
  it("keeps the brief, its stop and its depth together in the last view", () => {
    const kept = new URLSearchParams(rememberableSearch(`?mode=glossary&brief=${BRIEF}&depth=2&stop=spya-qt2abc`));
    expect(kept.get("brief")).toBe(BRIEF);
    expect(kept.get("depth")).toBe("2");
    expect(kept.get("stop")).toBe("spya-qt2abc");
  });
});
