// @vitest-environment jsdom
/**
 * **The press that turns the margin on starts the literature search, if it
 * has never run.** Greg's answer to q-sxfwqq:
 *
 * > Change my mind. Let's go for A.
 * >
 * > — Greg, 2026-10-28 (spya-nq5ec9)
 *
 * Option A: the first press of the margin button on an article starts
 * Sources' search of the literature (`situate`), whose findings sit beside
 * passages in the margin. A reload, a pasted link, or arriving at an article
 * whose margin was already on does not spend. The press arms
 * `margin-literature` (activation.ts § Marginalia's row); the owner's feed
 * (`OwnerMarginFeed` › `SituateMarginFeed`) is the one mount that claims it.
 *
 * The real `jobEngine` and `useStepJob` sit on a mocked network, as in
 * tests/marginalia-relations-on-open.test.tsx; the relation words post a job
 * of their own on arrival, so these count only the jobs that search.
 * docs/plans/261029h-the-margin-button-starts-the-literature-search.md.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";
import type { ArtefactStatus } from "../src/web/useAutoRun.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "margin-search";
const posted: { steps?: string[]; force?: unknown }[] = [];
/** The queue `GET /api/jobs` answers: every job posted, still queued. */
const jobs: Job[] = [];
/** What `GET /api/situate/:slug` answers. */
let dossier: "none" | "current" | "stale" | "outdated" = "none";

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/jobs" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { steps?: string[] };
      posted.push(body);
      const queued = {
        id: `j-${posted.length}`,
        slug: SLUG,
        status: "queued",
        steps: (body.steps ?? []).map((name) => ({ name, status: "pending" })),
        createdAt: 1,
        updatedAt: 1,
      } as unknown as Job;
      jobs.push(queued);
      return new Response(JSON.stringify(queued), { status: 200 });
    }
    if (url === "/api/jobs") return new Response(JSON.stringify({ jobs }), { status: 200 });
    if (url === `/api/situate/${SLUG}` && dossier !== "none") {
      return new Response(
        JSON.stringify({
          situate: { findings: [], generatedAt: "2026-10-28T00:00:00.000Z" },
          stale: dossier === "stale",
          outdated: dossier === "outdated",
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { OwnerMarginFeed } = await import("../src/web/marginalia/MarginaliaColumn.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { armActivation, armActivationForMode, modeStep, pendingActivation, resetActivations } = await import(
  "../src/web/activation.js"
);
const { useSituate } = await import("../src/web/useSituate.js");
const { useWhereAutoRun } = await import("../src/web/useWhereAutoRun.js");

/** *Where it sits*' door, as `WhereBand` mounts it, with the works cited already listed. */
function WhereDoor(): null {
  const situate = useSituate(SLUG);
  useWhereAutoRun(SLUG, { status: "ready", ensure: async () => {}, retryRead: async () => {} }, situate);
  return null;
}

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The Dock's press on Marginalia while the column is off (Dock.tsx § `useActivateMode`). */
function pressMargin(): void {
  armActivationForMode(SLUG, "marginalia", { diagram: "sketch", summary: "brief", sources: "where" });
}

async function mountFeed({
  strict = false,
  shown = true,
  bibliography = "ready" as ArtefactStatus,
} = {}): Promise<void> {
  const feed = createElement(OwnerMarginFeed, {
    slug: SLUG,
    shown,
    bibliography: { status: bibliography, retryRead: bibliographyRetry },
    onFeed: () => {},
  });
  await act(async () => root.render(strict ? createElement(StrictMode, null, feed) : feed));
  await settle();
}

const searches = () => posted.filter((p) => p.steps?.includes("situate"));
let bibliographyRereads = 0;
const bibliographyRetry = async () => {
  bibliographyRereads += 1;
};

beforeEach(async () => {
  posted.length = 0;
  jobs.length = 0;
  bibliographyRereads = 0;
  dossier = "none";
  jobEngine.reset();
  resetActivations();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => jobEngine.start("reader-1"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("the press that turns the margin on", () => {
  it("arms the margin's own target, and adds nothing to the import's list", () => {
    pressMargin();
    expect(pendingActivation(SLUG, "margin-literature")).not.toBeNull();
    expect(modeStep("marginalia")).toBeNull();
  });

  it("starts the search when none has run, unforced", async () => {
    pressMargin();
    await mountFeed();
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ slug: SLUG, steps: ["situate"] });
    expect(searches()[0]).not.toMatchObject({ force: true });
  });

  it("lists the works the piece cites first when they are missing too, in the same job", async () => {
    pressMargin();
    await mountFeed({ bibliography: "none" });
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ steps: ["bibliography", "situate"] });
  });

  it("waits for the Bibliography read before deciding", async () => {
    pressMargin();
    await mountFeed({ bibliography: "loading" });
    expect(searches(), "nothing until Bibliography has answered").toHaveLength(0);
    await mountFeed({ bibliography: "ready" });
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ steps: ["situate"] });
  });

  it("reads Bibliography again after a failed read, rather than guessing (GPT Sol's MARGIN-2)", async () => {
    pressMargin();
    await mountFeed({ bibliography: "error" });
    expect(searches(), "a failed read is not an answer").toHaveLength(0);
    expect(bibliographyRereads).toBe(1);
    await mountFeed({ bibliography: "none" });
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ steps: ["bibliography", "situate"] });
  });

  it("a stored dossier is the whole answer: Bibliography missing beside it buys nothing", async () => {
    dossier = "current";
    pressMargin();
    await mountFeed({ bibliography: "none" });
    expect(posted.filter((p) => p.steps?.includes("bibliography"))).toHaveLength(0);
  });

  it("starts once under StrictMode's doubled effects", async () => {
    pressMargin();
    await mountFeed({ strict: true });
    expect(searches()).toHaveLength(1);
  });

  it("starts once per tab: a second press on the same article buys nothing", async () => {
    pressMargin();
    await mountFeed();
    await act(async () => root.render(null));
    pressMargin();
    await mountFeed();
    expect(searches()).toHaveLength(1);
  });

  for (const kind of ["current", "stale", "outdated"] as const) {
    it(`never re-runs a stored dossier (${kind}), and retires the press`, async () => {
      dossier = kind;
      pressMargin();
      await mountFeed();
      expect(searches()).toHaveLength(0);
      expect(pendingActivation(SLUG, "margin-literature")).toBeNull();
    });
  }
});

describe("two doors, one search (GPT Sol's MARGIN-1)", () => {
  it("Where it sits, pressed while the margin's search is under way, waits for it rather than posting another", async () => {
    pressMargin();
    await mountFeed({ bibliography: "none" });
    expect(searches()).toHaveLength(1);

    armActivation(SLUG, "sources-where");
    const both = createElement(
      "div",
      null,
      createElement(OwnerMarginFeed, {
        slug: SLUG,
        shown: true,
        bibliography: { status: "ready", retryRead: bibliographyRetry },
        onFeed: () => {},
      }),
      createElement(WhereDoor),
    );
    await act(async () => root.render(both));
    await settle();
    expect(searches(), "the job already queued is the answer").toHaveLength(1);
  });

  it("and the margin, pressed while Where it sits' search is under way, waits too", async () => {
    armActivation(SLUG, "sources-where");
    await act(async () => root.render(createElement(WhereDoor)));
    await settle();
    expect(searches()).toHaveLength(1);

    pressMargin();
    const both = createElement(
      "div",
      null,
      createElement(WhereDoor),
      createElement(OwnerMarginFeed, {
        slug: SLUG,
        shown: true,
        bibliography: { status: "ready", retryRead: bibliographyRetry },
        onFeed: () => {},
      }),
    );
    await act(async () => root.render(both));
    await settle();
    expect(searches()).toHaveLength(1);
  });
});

describe("arriving with the margin on spends nothing", () => {
  it("a reload, a pasted link or a restored view: the feed mounts with no press", async () => {
    await mountFeed();
    expect(searches()).toHaveLength(0);
  });

  it("a press on a window too narrow for the notes is dropped, not kept for later", async () => {
    pressMargin();
    await mountFeed({ shown: false });
    expect(searches()).toHaveLength(0);
    expect(pendingActivation(SLUG, "margin-literature")).toBeNull();
    /* The window widens: still the same mount, and still no press. */
    await mountFeed({ shown: true });
    expect(searches()).toHaveLength(0);
  });
});
