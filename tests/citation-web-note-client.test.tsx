// @vitest-environment jsdom
/**
 * **A web note, the client half** — src/web/useBibliography.ts §
 * `findWebNote` and `openFromCiteCard`, plan 261018o stage 2 (R9).
 *
 * Pinned against a real SSE body: the prose card's *Open in Sources* on a row
 * with no note starts one request, and only one; the stages arrive in order;
 * `done` puts the note on the row and a re-read follows; a row that has a note
 * of either kind starts nothing; a 409 `searched` says the row's *found none*
 * line; and the card's press opens the row whatever happens to the search.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bibliography, BlockId, CitedWork } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const ID = "spya-c2d3e4";
const BLOCK = "spya-k3m9qt" as BlockId;

const WORK: CitedWork = {
  id: ID,
  key: "arxiv:2001.08361",
  title: "Scaling Laws for Neural Language Models",
  why: "What the piece uses it for.",
  mentions: [],
  citedAt: [BLOCK],
  firstCited: BLOCK,
  citedInBody: true,
  url: "https://arxiv.org/abs/2001.08361",
  linkFrom: "arxiv",
};

const WEB_NOTE = {
  sentences: [{ text: "It finds that loss falls as a power law.", quote: "The loss scales as a power-law with model size" }],
  url: "https://arxiv.org/abs/2001.08361",
  host: "arxiv.org",
  readAt: "2026-10-19T08:00:00.000Z",
  pageKind: "own" as const,
};

function artefact(row: CitedWork): Bibliography {
  return {
    version: "test",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    citations: [row],
    capped: false,
    generatedAt: "2026-10-19T09:00:00.000Z",
    elapsedMs: 1,
  };
}

let listed: CitedWork = WORK;
let gets = 0;
let posts = 0;
let reply: "stream" | { status: number; body: unknown } = "stream";
let push: ((event: string, data: unknown) => void) | null = null;
let end: (() => void) | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

vi.mock("../src/web/lib/api.js", async () => {
  const { ReaderFacingError } = await import("../src/web/lib/reader-facing.js");
  return {
    apiFetch: async (input: string, init?: { method?: string }) => {
      if (init?.method === "POST" && input === `/api/bibliography/${SLUG}/${ID}/web-note`) {
        posts++;
        if (reply !== "stream") return json(reply.body, reply.status);
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            end = () => controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (input === `/api/bibliography/${SLUG}`) {
        gets++;
        return json({ bibliography: artefact(listed), stale: false, outdated: false });
      }
      throw new Error(`the test made an unexpected request: ${input}`);
    },
    leavingFetch: async () => undefined,
    readJson: async (res: Response) => {
      const body = await res.json();
      if (!res.ok) throw new ReaderFacingError(body.error);
      return body;
    },
    failure: async (res: Response) => new Error(String(res.status)),
  };
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async () => ({ id: "job1" }),
    cancel: async () => {},
  }),
}));

const { openFromCiteCard, useBibliographyRead } = await import("../src/web/useBibliography.js");

let hook: ReturnType<typeof useBibliographyRead> | null = null;
function Harness(): ReactElement | null {
  hook = useBibliographyRead(SLUG);
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  listed = WORK;
  gets = 0;
  posts = 0;
  reply = "stream";
  push = null;
  end = null;
  hook = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function open(): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await flush();
  expect(hook?.status).toBe("ready");
}

/** The card's press as Reader wires it: open the row, and look. */
const opened: string[] = [];
function pressCard(id = ID): void {
  openFromCiteCard((w) => void opened.push(w), hook?.findWebNote)(id);
}

describe("the prose card's Open in Sources on a row with no note", () => {
  it("opens the row, starts one search, draws its stages, then puts the stored note on the row and re-reads", async () => {
    await open();
    opened.length = 0;
    await act(async () => pressCard());
    await flush();
    expect(opened).toEqual([ID]);
    expect(posts).toBe(1);
    expect(hook?.webNoting).toBe(ID);

    /* A second press while the first runs sends nothing. */
    await act(async () => pressCard());
    expect(posts).toBe(1);

    await act(async () => push?.("stage", { stage: "searching" }));
    await flush();
    expect(hook?.webNoteStage).toBe("searching");
    await act(async () => push?.("stage", { stage: "checking" }));
    await flush();
    expect(hook?.webNoteStage).toBe("checking");

    const before = gets;
    listed = { ...WORK, webNote: WEB_NOTE };
    await act(async () => {
      push?.("done", { outcome: "note", webNote: WEB_NOTE });
      end?.();
    });
    await flush();
    expect(hook?.bibliography?.citations[0]?.webNote).toMatchObject({ host: "arxiv.org" });
    expect(hook?.webNoting).toBeNull();
    expect(gets).toBeGreaterThan(before);

    /* And now the row has a note: another press opens it and searches nothing. */
    await act(async () => pressCard());
    await flush();
    expect(posts).toBe(1);
    expect(opened).toEqual([ID, ID, ID]);
  });

  it("says the row's found-none line when the search found nothing", async () => {
    await open();
    await act(async () => pressCard());
    await flush();
    await act(async () => {
      push?.("stage", { stage: "searching" });
      push?.("done", { outcome: "none", why: "not-the-work" });
      end?.();
    });
    await flush();
    expect(hook?.webNoteNone).toBe(ID);
    expect(hook?.bibliography?.citations[0]?.webNote).toBeUndefined();
  });

  it("says it again, for nothing, when the server answers that it searched this week", async () => {
    reply = { status: 409, body: { error: "searched", reason: "searched" } };
    await open();
    await act(async () => pressCard());
    await flush();
    expect(posts).toBe(1);
    expect(hook?.webNoteNone).toBe(ID);
    expect(hook?.webNoting).toBeNull();
  });

  it("starts nothing on a row with an abstract note, or with a web note already", async () => {
    listed = {
      ...WORK,
      blurb: {
        sentences: [{ text: "From the abstract.", quote: "six words of the abstract here" }],
        kind: "author-abstract",
        source: "datacite",
        via: "id",
        workId: "arxiv:2001.08361",
        url: "https://arxiv.org/abs/2001.08361",
        readAt: "2026-10-18T08:00:00.000Z",
      },
    };
    await open();
    opened.length = 0;
    await act(async () => pressCard());
    await flush();
    expect(opened).toEqual([ID]);
    expect(posts).toBe(0);
  });

  it("keeps the server's reader-facing sentence on the row when the press fails", async () => {
    reply = { status: 429, body: { error: "busy" } };
    await open();
    await act(async () => pressCard());
    await flush();
    expect(posts).toBe(1);
    expect(hook?.webNoteNone).toBeNull();
    expect(hook?.webNoting).toBeNull();
    expect(hook?.webNoteFailed).toEqual({ id: ID, message: "busy" });
  });
});
