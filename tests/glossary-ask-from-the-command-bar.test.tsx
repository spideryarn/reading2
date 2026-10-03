// @vitest-environment jsdom
/**
 * **The bar's *Look up “X” in this article* costs one ask and nothing else** —
 * plan 261003f, Stage 1.2, and GPT Sol's F1 on it, the P0: the first draft
 * moved to Glossary *armed*, so an article whose glossary was empty would
 * generate one on open **and** ask — two paid runs for one press.
 *
 * So the row is offered only once the glossary read is ready, moves the band
 * without arming (tests/command-runners.test.ts § the glossary), and leaves the
 * term in a one-shot hand-off that the band's *Look up a term* box takes. This
 * file mounts the real band over the real read, **under `<StrictMode>`** —
 * which runs every effect twice on mount, the case a take that is not atomic
 * would fail — and counts what reaches the network: one `POST
 * /api/glossary/:slug/ask`, and no job posted by any route.
 */
import { act, createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryResponse } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const BLOCK = "spya-adq4zt";

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** Every request, as `METHOD url`. */
let requests: string[] = [];
/** Every job the band asked the queue for. */
let jobPosts: unknown[] = [];

function listResponse(): GlossaryResponse {
  const entry = {
    id: "spya-adq5wr",
    name: "Win-shift",
    kind: "concept",
    aliases: [],
    senseHere: "What it means here.",
    blocks: [BLOCK],
  } as unknown as GlossaryEntry;
  return {
    glossary: { version: "glossary/3", sourceHash: "abc", profileHash: null, passes: 1, entries: [entry] },
    stale: false,
    outdated: false,
    profileChanged: false,
  } as unknown as GlossaryResponse;
}

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${input}`);
      if (input.endsWith("/ask")) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(frame("begin", { term: "attention head", blockId: BLOCK, quote: "Attention Heads" }));
            c.enqueue(frame("delta", { text: "What it is" }));
            c.enqueue(
              frame("done", {
                term: "attention head",
                blockId: BLOCK,
                quote: "Attention Heads",
                lookup: { answer: "x", citations: [], searches: 0, model: "m", at: "2026-10-03T00:00:00.000Z" },
                added: { kind: "no-glossary" },
              }),
            );
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify(listResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    readJson: async (res: Response) => {
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? String(res.status));
      return data;
    },
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
  };
  return api;
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async (request: unknown) => {
      jobPosts.push(request);
      return null;
    },
    cancel: async () => {},
  }),
}));

const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { GlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");
const { glossaryRunners } = await import("../src/web/command-runners.js");
const { resetGlossaryAskForTests } = await import("../src/web/glossary-ask-handoff.js");
const { pendingActivation, resetActivations } = await import("../src/web/activation.js");

function Reading(): ReactElement {
  const read = useGlossaryRead(SLUG);
  return createElement(GlossaryBand, {
    slug: SLUG,
    read,
    onJump: () => {},
    onSelected: () => {},
    onAskChat: () => {},
  });
}

enableHistorySync();

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  requests = [];
  jobPosts = [];
  resetGlossaryAskForTests();
  resetActivations();
  history.replaceState(null, "", `/read/${SLUG}?mode=glossary&sort=document`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(Reading))));
  });
  await settle();
}

const asks = () => requests.filter((r) => r === `POST /api/glossary/${SLUG}/ask`);
const jobRequests = () => requests.filter((r) => r.startsWith("POST") && r.includes("/api/jobs"));
const box = () => host.querySelector<HTMLInputElement>('input[aria-label="Look up a term in this article"]');

/** The bar's press, as the reading view builds it — `openGlossary` is a plain move. */
async function pressLookUp(slug: string, term: string): Promise<void> {
  const runners = glossaryRunners({
    slug,
    terms: [],
    ready: true,
    openTerm: () => {},
    openGlossary: () => {},
  });
  await runners["glossary-ask"]?.({ id: "glossary-ask", term });
}

describe("a Look up press from the bar, on an article with a ready glossary", () => {
  it("asks once, posts no job, and arms nothing", async () => {
    await pressLookUp(SLUG, "attention head");
    expect(pendingActivation(SLUG, "glossary")).toBeNull();
    await mount();
    expect(asks()).toEqual([`POST /api/glossary/${SLUG}/ask`]);
    expect(jobRequests()).toEqual([]);
    expect(jobPosts).toEqual([]);
  });

  it("shows the term in the box it was asked from", async () => {
    await pressLookUp(SLUG, "attention head");
    await mount();
    expect(box()?.value).toBe("attention head");
  });
});

describe("no hand-off for this article", () => {
  it("asks nothing when the band opens on its own", async () => {
    await mount();
    /* The harness can see a GET, so silence about the ask is not blindness. */
    expect(requests.some((r) => r.startsWith("GET "))).toBe(true);
    expect(asks()).toEqual([]);
  });

  it("asks nothing for a hand-off left for another article", async () => {
    await pressLookUp("another-piece", "attention head");
    await mount();
    expect(asks()).toEqual([]);
  });
});
