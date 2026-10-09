// @vitest-environment jsdom
/**
 * **The relation words are made when Marginalia is shown, not when it is
 * pressed, and not on import.**
 *
 * > generate linking words when Marginalia mode is opened
 * >
 * > — Greg, 2026-10-05
 *
 * "Shown" is the owner's column mounting, whatever put it there: a press of
 * the toggle, the first-open default that turns it on with nobody pressing
 * anything, a `?margin=1` link, a reload. Until this, the run waited for a
 * press (`useAutoRun`), so an article that opened with Marginalia on by
 * default had no *so / but / vs* until the column was turned off and on.
 *
 * `OwnerMarginFeed` is the mount: the Reader draws it only inside the open
 * column and only for the owner, so a visitor never reaches the hook
 * (tests/public-network-trace.test.tsx is that claim measured from outside).
 * The real `jobEngine` and `useStepJob` sit on the mocked network, as in
 * tests/marginalia-live-refresh.test.tsx.
 * docs/plans/261005d-marginalia-out-of-the-experimental-switch.md § Relation
 * words on opening.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "words-on-open";
const BLOCK = "spya-rel2bc";
const trace: string[] = [];
const posted: unknown[] = [];
/** What `GET /api/relations/:slug` answers: nothing stored, a list, or a list the article has moved under. */
let stored: "none" | "current" | "stale" | "outdated" = "none";
let readFailures = 0;
let refusePost = false;
let jobs: Job[] = [];

function job(id: string, status: Job["status"]): Job {
  return {
    id,
    slug: SLUG,
    status,
    steps: [{ name: "relations", status: status === "done" ? "done" : "pending" }],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Job;
}

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    trace.push(`${method} ${url}`);
    if (url === "/api/jobs" && method === "POST") {
      posted.push(JSON.parse(String(init?.body)));
      if (refusePost) return new Response(JSON.stringify({ error: "Cannot start this job." }), { status: 500 });
      return new Response(JSON.stringify(job("j-rel", "queued")), { status: 200 });
    }
    if (url === "/api/jobs") return new Response(JSON.stringify({ jobs }), { status: 200 });
    if (url === `/api/relations/${SLUG}` && readFailures > 0) {
      readFailures -= 1;
      return new Response(JSON.stringify({ error: "Cannot read the relation words." }), { status: 500 });
    }
    if (url === `/api/relations/${SLUG}` && stored !== "none") {
      return new Response(
        JSON.stringify({
          relations: { relations: { [BLOCK]: "but" } },
          stale: stored === "stale",
          outdated: stored === "outdated",
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { OwnerMarginFeed } = await import("../src/web/marginalia/MarginaliaColumn.js");
type MarginFeed = import("../src/web/marginalia/MarginaliaColumn.js").MarginFeed;
const { jobEngine } = await import("../src/web/jobEngine.js");
const { armActivationForMode, modeGenerates, pendingActivation, resetActivations } = await import("../src/web/activation.js");

let host: HTMLDivElement;
let root: Root;
let feed: MarginFeed | null = null;
const onFeed = (next: MarginFeed) => {
  feed = next;
};

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The column mounting for the owner. Nothing here presses anything. */
async function openMargin(strict = false, shown = true): Promise<void> {
  const feedEl = createElement(OwnerMarginFeed, { slug: SLUG, shown, onFeed });
  await act(async () => root.render(strict ? createElement(StrictMode, null, feedEl) : feedEl));
  await settle();
}

const starts = () => trace.filter((l) => l === "POST /api/jobs").length;

beforeEach(() => {
  trace.length = 0;
  posted.length = 0;
  stored = "none";
  readFailures = 0;
  refusePost = false;
  jobs = [];
  feed = null;
  jobEngine.reset();
  resetActivations();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("the column opening on an article with no relation words", () => {
  it("marks its mode as generating but leaves no press token to claim", () => {
    armActivationForMode(SLUG, "marginalia", { diagram: "sketch", summary: "brief", peerReview: "bibliography" });
    expect(modeGenerates("marginalia")).toBe(true);
    expect(pendingActivation(SLUG, "relations")).toBeNull();
  });

  it("asks for them with nobody having pressed anything", async () => {
    await act(async () => jobEngine.start("reader-1"));
    expect(pendingActivation(SLUG, "relations"), "no press is in hand").toBeNull();

    await openMargin();

    expect(starts()).toBe(1);
    expect(posted[0]).toMatchObject({ slug: SLUG, steps: ["relations"] });
    /* Unforced: the step's own stamp check decides, so a list that turned out
       to be there costs nothing. */
    expect(posted[0]).not.toMatchObject({ force: true });
  });

  it("draws them when the job finishes, with no reopen", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    expect(feed?.relations ?? null, "the notes are drawn without the words meanwhile").toBeNull();

    jobs = [job("j-rel", "running")];
    await act(async () => jobEngine.poke());
    await settle();
    stored = "current";
    jobs = [job("j-rel", "done")];
    await act(async () => jobEngine.poke());
    await settle();

    expect(feed?.relations).toEqual({ [BLOCK]: "but" });
    expect(starts(), "and nothing was asked for twice").toBe(1);
  });

  it("asks once under StrictMode's doubled effects", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await openMargin(true);
    expect(starts()).toBe(1);
  });

  it("asks once per page load: turning the column off and on again buys nothing", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    await act(async () => root.render(null));
    await openMargin();
    expect(starts()).toBe(1);
  });

  it("does not retry a refused POST when shown repeatedly", async () => {
    refusePost = true;
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    for (let i = 0; i < 3; i += 1) {
      await openMargin(false, false);
      await openMargin();
    }
    await act(async () => root.render(null));
    await openMargin();
    expect(starts()).toBe(1);
  });

  it("does not retry a failed job on the next showing", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    jobs = [job("j-rel", "error")];
    await act(async () => jobEngine.poke());
    await settle();
    await act(async () => root.render(null));
    await openMargin();
    expect(feed?.relations ?? null).toBeNull();
    expect(starts()).toBe(1);
  });

  it("rereads a failed opening GET and runs if the second read says none", async () => {
    readFailures = 1;
    await act(async () => jobEngine.start("reader-1"));
    await openMargin(true);
    expect(trace.filter((line) => line === `GET /api/relations/${SLUG}`)).toHaveLength(2);
    expect(starts()).toBe(1);
  });

  it("stops after two failed reads, including visibility changes", async () => {
    readFailures = 10;
    await act(async () => jobEngine.start("reader-1"));
    await openMargin(true);
    for (let i = 0; i < 3; i += 1) {
      await openMargin(true, false);
      await openMargin(true);
    }
    expect(trace.filter((line) => line === `GET /api/relations/${SLUG}`)).toHaveLength(2);
    expect(starts()).toBe(0);
  });
});

describe("the switch on, on a window with no room for the notes", () => {
  it("asks for nothing until the notes are on screen", async () => {
    await act(async () => jobEngine.start("reader-1"));
    await openMargin(false, false);
    expect(starts(), "words nobody can see are not worth a call").toBe(0);

    /* The window is widened: the same mount, the column now drawn. */
    await openMargin(false, true);
    expect(starts()).toBe(1);
  });
});

/* An article opened before its structure is built: the relations step comes
   after `structure`, so the server refuses it on the stand-in outline, and a
   refused job is a failure card for words nobody asked for. The column waits,
   as the arc does (tests/arc-waits-for-structure.test.tsx), and asks once the
   real tree is in — the same mount, with the wait over.
   docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md. */
describe("the column open on an article still showing its temporary outline", () => {
  it("asks for nothing until the real structure is in, then asks once", async () => {
    await act(async () => jobEngine.start("reader-1"));
    const waiting = createElement(OwnerMarginFeed, { slug: SLUG, shown: true, awaitingStructure: true, onFeed });
    await act(async () => root.render(waiting));
    await settle();
    expect(starts(), "a job the server would refuse was asked for").toBe(0);

    const arrived = createElement(OwnerMarginFeed, { slug: SLUG, shown: true, awaitingStructure: false, onFeed });
    await act(async () => root.render(arrived));
    await settle();
    expect(starts()).toBe(1);
  });
});

describe("the column opening on an article that has them", () => {
  it("starts nothing", async () => {
    stored = "current";
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    expect(feed?.relations).toEqual({ [BLOCK]: "but" });
    expect(starts()).toBe(0);
  });

  it.each(["stale", "outdated"] as const)("rewrites a %s list once across showings", async (state) => {
    stored = state;
    await act(async () => jobEngine.start("reader-1"));
    await openMargin();
    if (state === "stale") expect(feed?.relations ?? null, "a stale word is not drawn").toBeNull();
    await openMargin(false, false);
    await openMargin();
    await act(async () => root.render(null));
    await openMargin();
    expect(starts()).toBe(1);
  });
});
