// @vitest-environment jsdom
/**
 * **Citations' *Investigate*, the hook half** — src/web/useBibliography.ts §
 * `investigate`, plan 260930a stage 2.
 *
 * The promises it makes are the glossary lookup's, and each is pinned here
 * against a real SSE body: words arrive as a draft and never on the row; only
 * `done` puts an investigation on the row, and a re-read follows it; an
 * `error` clears the whole draft and records what was stored at the press, and
 * re-reads the list because an error does not prove nothing was kept; a
 * refusal before the stream opens re-reads nothing; leaving aborts the fetch;
 * and a second press while one is out sends nothing.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, CitationInvestigation, Bibliography, CitedWork, InvestigatedPaper } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const ID = "spya-c2d3e4";
const BLOCK = "spya-k3m9qt" as BlockId;

const WORK: CitedWork = {
  id: ID,
  key: "work:w",
  title: "A work",
  why: "What the piece uses it for.",
  mentions: [],
  citedAt: [BLOCK],
  firstCited: BLOCK,
  citedInBody: true,
  url: "https://doi.org/10.1000/xyz",
  linkFrom: "doi",
};

function investigation(at: string, answer = "Does it back the claim?\nYes, says arxiv.org."): CitationInvestigation {
  return {
    answer,
    sources: [{ url: "https://arxiv.org/abs/1" }],
    extractsRead: 1,
    longestExtractWords: 200,
    matchedHost: null,
    searches: 1,
    searchesFrom: "x",
    model: "test",
    at,
    contextHash: "ctx",
    promptVersion: "1",
  };
}

function artefact(row: CitedWork): Bibliography {
  return {
    version: "test",
    generator: "test",
    slug: SLUG,
    sourceHash: "hash",
    citations: [row],
    capped: false,
    generatedAt: "2026-09-30T09:00:00.000Z",
    elapsedMs: 1,
  };
}

/** What the GET answers when it arrives. */
let listed: CitedWork = WORK;
let gets = 0;
let posts = 0;
let signal: AbortSignal | null = null;
/** The POST's reply: a live SSE body the test writes frames into, or a refusal. */
let reply: "stream" | { status: number; error: string } = "stream";
let push: ((event: string, data: unknown) => void) | null = null;
let end: (() => void) | null = null;
let breakStream: ((error: Error) => void) | null = null;
/** Make citation re-reads fail without affecting the already-open SSE. */
let getFailure: Error | null = null;
let generatedAt = "2026-09-30T09:00:00.000Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

vi.mock("../src/web/lib/api.js", async () => {
  const { ReaderFacingError } = await import("../src/web/lib/reader-facing.js");
  return {
  apiFetch: async (input: string, init?: { method?: string; signal?: AbortSignal }) => {
    if (init?.method === "POST" && input === `/api/bibliography/${SLUG}/${ID}/investigate`) {
      posts++;
      signal = init.signal ?? null;
      if (reply !== "stream") return json({ error: reply.error }, reply.status);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          end = () => controller.close();
          breakStream = (error) => controller.error(error);
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (input === `/api/bibliography/${SLUG}`) {
      gets++;
      if (getFailure) throw getFailure;
      return json({ bibliography: { ...artefact(listed), generatedAt }, stale: false, outdated: false });
    }
    if (input === "/api/bibliography/next-piece") {
      return json({ bibliography: { ...artefact({ ...WORK, title: "The next article's work" }), slug: "next-piece" }, stale: false, outdated: false });
    }
    throw new Error(`the test made an unexpected request: ${input}`);
  },
  leavingFetch: async () => undefined,
  readJson: async (res: Response) => {
    const body = await res.json();
    /* The class the real one throws (`HttpError` extends it): the hook words
       its failure through `describeFetchFailure`, which shows a reader only a
       sentence declared for one. */
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

const { useBibliography, useBibliographyRead } = await import("../src/web/useBibliography.js");

let hook: ReturnType<typeof useBibliography> | null = null;

/** Both halves, wired as the app wires them (tests/bibliography-find-late-reply.test.tsx § Harness). */
function Harness(): ReactElement | null {
  const read = useBibliographyRead(SLUG);
  hook = useBibliography(SLUG, read);
  return null;
}

let host: HTMLDivElement;
let root: Root;
let mounted = false;

beforeEach(() => {
  listed = WORK;
  gets = 0;
  posts = 0;
  signal = null;
  reply = "stream";
  push = null;
  end = null;
  breakStream = null;
  getFailure = null;
  generatedAt = "2026-09-30T09:00:00.000Z";
  hook = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = false;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
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
  mounted = true;
  await flush();
  expect(hook?.status).toBe("ready");
}

function row(): CitedWork | undefined {
  return hook?.bibliography?.citations[0];
}

describe("investigate", () => {
  it("draws words as a draft, then puts the stored answer on the row only at done, and re-reads", async () => {
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    expect(hook?.investigating).toBe(ID);

    await act(async () => push?.("delta", { text: "Does it back " }));
    await act(async () => push?.("delta", { text: "the claim?" }));
    await flush();
    expect(hook?.investigateDraft).toEqual({ id: ID, text: "Does it back the claim?" });
    expect(row()?.investigation, "a draft reached the row").toBeUndefined();

    const kept = investigation("2026-09-30T10:00:00.000Z");
    listed = { ...WORK, investigation: kept };
    const before = gets;
    await act(async () => {
      push?.("done", { investigation: kept });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateDraft).toBeNull();
    expect(hook?.investigating).toBeNull();
    expect(hook?.investigateFailed).toBeNull();
    expect(row()?.investigation).toEqual(kept);
    expect(gets, "no re-read followed the stored answer").toBe(before + 1);
  });

  it("on an error, clears the whole draft, records what was stored at the press, and re-reads", async () => {
    const previous = investigation("2026-09-29T10:00:00.000Z");
    listed = { ...WORK, investigation: previous };
    await open();
    expect(row()?.investigation).toEqual(previous);

    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    await act(async () => push?.("delta", { text: "Half an answ" }));
    await flush();
    expect(hook?.investigateDraft?.text).toBe("Half an answ");

    const before = gets;
    await act(async () => {
      push?.("error", { error: "This answer tried to quote a source directly. [cite-quoted]" });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateDraft, "a cut-off answer stayed on screen under the error").toBeNull();
    expect(hook?.investigateFailed).toEqual({
      id: ID,
      message: "This answer tried to quote a source directly. [cite-quoted]",
      previousAt: previous.at,
      previousLookupAt: null,
      lookupKept: false,
    });
    expect(gets, "an error was trusted to mean nothing was kept").toBe(before + 1);
    expect(row()?.investigation).toEqual(previous);
  });

  it("takes a done whose paper is whole, and refuses one whose paper is not (plan 261001a stage 3)", async () => {
    const paper: InvestigatedPaper = {
      state: "read",
      requestedUrl: "https://arxiv.org/pdf/1",
      finalUrl: "https://arxiv.org/pdf/1",
      host: "arxiv.org",
      words: 900,
      sentWords: 800,
      chunks: ["c1", "c2"],
      matchedBy: "arxiv",
      evidenceSha: "d".repeat(64),
      selectionVersion: "paper-selection/1",
      readAt: "2026-10-01T12:00:00.000Z",
      passages: [{ chunk: "c2", page: 2, text: "A passage the code found.", bears: "context" }],
    };
    for (const [sent, kept] of [
      [{ ...investigation("2026-10-01T10:00:00.000Z"), paper }, true],
      /* A read paper with no word count is not drawn as read. */
      [{ ...investigation("2026-10-01T10:00:00.000Z"), paper: { ...paper, words: undefined } }, false],
      /* A passage with an unknown bearing is not drawn. */
      [
        { ...investigation("2026-10-01T10:00:00.000Z"), paper: { ...paper, passages: [{ chunk: "c2", page: 2, text: "x", bears: "refutes" }] } },
        false,
      ],
      [{ ...investigation("2026-10-01T10:00:00.000Z"), paper: { state: "somewhere", readAt: "x" } }, false],
    ] as const) {
      await open();
      let pressed: Promise<void> | undefined;
      await act(async () => {
        pressed = hook?.investigate(ID);
      });
      await flush();
      listed = kept ? ({ ...WORK, investigation: sent } as CitedWork) : WORK;
      await act(async () => {
        push?.("done", { investigation: sent });
        end?.();
      });
      await act(async () => {
        await pressed;
      });
      await flush();
      if (kept) {
        expect(hook?.investigateFailed).toBeNull();
        expect(row()?.investigation).toEqual(sent);
      } else {
        expect(hook?.investigateFailed?.message, JSON.stringify(sent.paper)).toBeTruthy();
      }
    }
  });

  it("takes a done whose web influence is whole, and refuses one whose influence is not (plan 261003m stage 2)", async () => {
    const influence = {
      value: 0.8,
      quote: "widely cited as a seminal work on scaling",
      sourceUrl: "https://en.wikipedia.org/wiki/Scaling_laws",
      sourceTitle: "Scaling Laws - Wikipedia",
      version: "citation-influence/1",
    };
    const at = "2026-10-03T10:00:00.000Z";
    const { sourceTitle: _title, ...untitled } = influence;
    for (const [sent, kept] of [
      [{ ...investigation(at), influence }, true],
      [{ ...investigation(at), influence: untitled }, true],
      [{ ...investigation(at), influence: { ...influence, value: 0 } }, true],
      /* A number that would draw a bar from nothing, or past the scale. */
      [{ ...investigation(at), influence: { ...influence, value: "0.8" } }, false],
      [{ ...investigation(at), influence: { ...influence, value: 8000 } }, false],
      [{ ...investigation(at), influence: { ...influence, value: -0.1 } }, false],
      [{ ...investigation(at), influence: { ...influence, value: null } }, false],
      /* A number with no words, no source or no version is not drawn as sourced. */
      [{ ...investigation(at), influence: { ...influence, quote: "" } }, false],
      [{ ...investigation(at), influence: { ...influence, sourceUrl: undefined } }, false],
      [{ ...investigation(at), influence: { ...influence, version: undefined } }, false],
      /* An address that is not a web page's never reaches the row. */
      [{ ...investigation(at), influence: { ...influence, sourceUrl: "javascript:alert(1)" } }, false],
      [{ ...investigation(at), influence: 0.8 }, false],
      [{ ...investigation(at), influence: null }, false],
    ] as const) {
      await open();
      let pressed: Promise<void> | undefined;
      await act(async () => {
        pressed = hook?.investigate(ID);
      });
      await flush();
      listed = kept ? ({ ...WORK, investigation: sent } as CitedWork) : WORK;
      await act(async () => {
        push?.("done", { investigation: sent });
        end?.();
      });
      await act(async () => {
        await pressed;
      });
      await flush();
      if (kept) {
        expect(hook?.investigateFailed, JSON.stringify(sent.influence)).toBeNull();
        expect(row()?.investigation).toEqual(sent);
      } else {
        expect(hook?.investigateFailed?.message, JSON.stringify(sent.influence)).toBeTruthy();
      }
    }
  });

  it("a stream that just stops is a failure, not an answer", async () => {
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    await act(async () => {
      push?.("delta", { text: "Some words" });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateDraft).toBeNull();
    expect(hook?.investigateFailed?.message).toBeTruthy();
    expect(hook?.investigateFailed?.previousAt).toBeNull();
    expect(row()?.investigation).toBeUndefined();
  });

  it("a transport error after words arrived removes the whole draft and re-reads", async () => {
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    await act(async () => push?.("delta", { text: "A cut-off answer" }));
    await flush();
    expect(hook?.investigateDraft?.text).toBe("A cut-off answer");

    const before = gets;
    await act(async () => breakStream?.(new TypeError("connection lost")));
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateDraft).toBeNull();
    expect(hook?.investigateFailed?.message).toBeTruthy();
    expect(gets).toBe(before + 1);
  });

  it("a refusal before the stream opens says its sentence and re-reads nothing", async () => {
    reply = { status: 429, error: "Another Investigate is still running." };
    await open();
    const before = gets;
    await act(async () => {
      await hook?.investigate(ID);
    });
    await flush();
    expect(hook?.investigateFailed?.message).toBe("Another Investigate is still running.");
    expect(gets).toBe(before);
    expect(hook?.investigating).toBeNull();
  });

  it("sends one request at a time", async () => {
    await open();
    await act(async () => {
      void hook?.investigate(ID);
      void hook?.investigate(ID);
    });
    await flush();
    await act(async () => {
      void hook?.investigate(ID);
    });
    await flush();
    expect(posts).toBe(1);
  });

  /* ---------------------------------------------- plan 260930d: the first step -- */

  it("follows the stage frames: finding, then reading", async () => {
    await open();
    await act(async () => {
      void hook?.investigate(ID);
    });
    await flush();
    expect(hook?.investigateStage).toBeNull();
    /* Plan 261001p stage 2: Dig deeper's forced search comes first. */
    await act(async () => push?.("stage", { stage: "searching" }));
    await flush();
    expect(hook?.investigateStage).toBe("searching");
    await act(async () => push?.("stage", { stage: "finding" }));
    await flush();
    expect(hook?.investigateStage).toBe("finding");
    /* Plan 261001a stage 3: the paper read is a stage of its own. */
    await act(async () => push?.("stage", { stage: "reading-paper" }));
    await flush();
    expect(hook?.investigateStage).toBe("reading-paper");
    await act(async () => push?.("stage", { stage: "reading" }));
    await flush();
    expect(hook?.investigateStage).toBe("reading");
    await act(async () => push?.("stage", { stage: "anything else" }));
    await flush();
    expect(hook?.investigateStage, "an unknown stage was taken").toBe("reading");
  });

  it("a no-match lookup is a quiet note on the row, and the reading goes on", async () => {
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    const before = gets;
    await act(async () => push?.("lookup", { outcome: "no-match", message: "No page matched." }));
    await flush();
    expect(hook?.findNote).toEqual({ id: ID, kind: "no-match", message: "No page matched." });
    expect(gets, "a no-match stored nothing, so there is nothing to re-read").toBe(before);
    const kept = investigation("2026-09-30T10:00:00.000Z");
    listed = { ...WORK, investigation: kept };
    await act(async () => {
      push?.("done", { investigation: kept });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(row()?.investigation).toEqual(kept);
  });

  it("a found lookup is re-read at once, and survives a reading that fails after it (P-4)", async () => {
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    const before = gets;
    const { lookup: _none, ...bare } = WORK;
    await act(async () =>
      push?.("lookup", {
        outcome: "found",
        work: bare,
        lookup: {
          state: "assessed",
          host: "doi.org",
          searches: 1,
          model: "m",
          at: "x",
          contextHash: "c",
          evidenceHash: "e",
          excerptWords: 10,
          verdict: { support: "not-in-extract" },
        },
      }),
    );
    await flush();
    expect(gets, "the lookup was not re-read, so the server never attached it").toBe(before + 1);
    await act(async () => {
      push?.("error", { error: "The answer stopped. [cite-unfinished]" });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateFailed).toMatchObject({ id: ID, lookupKept: true, previousAt: null });
  });

  it("does not leave an older lookup or investigation attached when the lookup re-read fails", async () => {
    const previous = investigation("2026-09-29T10:00:00.000Z");
    const oldLookup = {
      state: "assessed" as const,
      host: "old.example",
      searches: 1,
      model: "m",
      at: "old",
      contextHash: "old-context",
      evidenceHash: "old-evidence",
      excerptWords: 10,
      verdict: { support: "not-in-extract" as const },
    };
    listed = { ...WORK, lookup: oldLookup, investigation: previous };
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();

    getFailure = new Error("the re-read failed");
    const { lookup: _old, investigation: _previous, ...bare } = listed;
    await act(async () =>
      push?.("lookup", {
        outcome: "found",
        work: bare,
        lookup: { ...oldLookup, host: "new.example", at: "new", evidenceHash: "new-evidence" },
      }),
    );
    await flush();
    expect(row()?.lookup, "the older verdict remained while its replacement could not be checked").toBeUndefined();
    expect(row()?.investigation, "the earlier investigation was shown without a successful re-read").toBeUndefined();

    await act(async () => {
      push?.("error", { error: "The longer investigation failed." });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateFailed).toMatchObject({
      previousAt: previous.at,
      previousLookupAt: oldLookup.at,
      lookupKept: true,
    });
    expect(row()?.investigation).toBeUndefined();
  });

  it("hides older derived fields when a replacement lookup frame is lost and the failure re-read fails", async () => {
    const previous = investigation("2026-09-29T10:00:00.000Z");
    const oldLookup = {
      state: "assessed" as const,
      host: "old.example",
      searches: 1,
      model: "m",
      at: "old",
      contextHash: "old-context",
      evidenceHash: "old-evidence",
      excerptWords: 10,
      verdict: { support: "not-in-extract" as const },
    };
    listed = { ...WORK, lookup: oldLookup, investigation: previous };
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();

    await act(async () => push?.("stage", { stage: "finding" }));
    await flush();
    expect(row()?.lookup, "a verdict that the in-flight lookup can replace remained visible").toBeUndefined();
    expect(row()?.investigation, "an answer derived from that verdict remained visible").toBeUndefined();

    listed = {
      ...WORK,
      lookup: { ...oldLookup, host: "new.example", at: "new", evidenceHash: "new-evidence" },
    };
    getFailure = new Error("the re-read failed");
    await act(async () => {
      push?.("error", { error: "The stream lost the lookup frame." });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(row()?.lookup).toBeUndefined();
    expect(row()?.investigation).toBeUndefined();
    expect(hook?.investigateFailed).toMatchObject({
      previousAt: previous.at,
      previousLookupAt: oldLookup.at,
      lookupKept: false,
    });
  });

  it("a failure with no lookup landed does not say the quick check was kept", async () => {
    await open();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    await act(async () => {
      push?.("stage", { stage: "finding" });
      push?.("error", { error: "The quick check failed. [cite-lookup-failed]" });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(hook?.investigateFailed).toMatchObject({ id: ID, lookupKept: false });
    expect(hook?.investigateStage).toBeNull();
  });

  it("leaving aborts the fetch — the server finishes and stores it regardless", async () => {
    await open();
    await act(async () => {
      void hook?.investigate(ID);
    });
    await flush();
    expect(signal?.aborted).toBe(false);
    act(() => root.unmount());
    mounted = false;
    expect(signal?.aborted).toBe(true);
  });
});

/* Plan 261004b: the state moved onto the read so the prose's hover card can
   start a dig from any mode. So the band is no longer what holds the stream —
   GPT Sol's plan review, F3: the test above unmounts both hooks together and
   cannot tell the two apart. */
describe("the band going does not stop a dig", () => {
  let read: ReturnType<typeof useBibliographyRead> | null = null;

  function Band(props: { read: ReturnType<typeof useBibliographyRead> }): ReactElement | null {
    hook = useBibliography(SLUG, props.read);
    return null;
  }
  function Article({ band, slug = SLUG }: { band: boolean; slug?: string }): ReactElement | null {
    read = useBibliographyRead(slug);
    return band ? createElement(Band, { read }) : null;
  }
  const paint = (band: boolean, slug = SLUG) => act(async () => root.render(createElement(Article, { band, slug })));

  it("keeps a failure across band remounts, but clears it when a replacement list retains the row's id", async () => {
    reply = { status: 429, error: "The previous press was refused." };
    await paint(true);
    mounted = true;
    await flush();
    await act(async () => { await hook?.investigate(ID); });
    expect(read?.investigateFailed?.message).toBe("The previous press was refused.");
    await paint(false);
    await paint(true);
    await flush();
    expect(hook?.investigateFailed?.message).toBe("The previous press was refused.");

    await paint(false);
    generatedAt = "2026-10-04T11:00:00.000Z";
    await act(async () => { await read?.refresh(); });
    await paint(true);
    await flush();
    expect(hook?.bibliography?.citations[0]?.id).toBe(ID);
    expect(hook?.investigateFailed, "a replaced list inherited a failure about the old list").toBeNull();
  });

  it("clears a completed press's no-match note when the list is replaced", async () => {
    await paint(false);
    mounted = true;
    await flush();
    let pressed: Promise<void> | undefined;
    await act(async () => { pressed = read?.investigate(ID); });
    await flush();
    const kept = investigation("2026-10-04T10:00:00.000Z");
    listed = { ...WORK, investigation: kept };
    await act(async () => {
      push?.("lookup", { outcome: "no-match", message: "No page matched the old reference." });
      push?.("done", { investigation: kept });
      end?.();
    });
    await act(async () => { await pressed; });
    await flush();
    expect(read?.findNote?.message).toBe("No page matched the old reference.");

    generatedAt = "2026-10-04T11:00:00.000Z";
    listed = WORK;
    await act(async () => { await read?.refresh(); });
    await flush();
    expect(read?.findNote, "a replaced list inherited a no-match note about the old reference").toBeNull();
  });

  it("aborts when a reused read changes slug, and ignores old stream frames for a retained-shaped id", async () => {
    await paint(false);
    mounted = true;
    await flush();
    let pressed: Promise<void> | undefined;
    await act(async () => { pressed = read?.investigate(ID); });
    await flush();
    await act(async () => { push?.("delta", { text: "Old article draft" }); });
    await flush();
    expect(read?.investigateDraft?.text).toBe("Old article draft");

    await paint(false, "next-piece");
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(read?.bibliography?.slug).toBe("next-piece");
    expect(read?.investigateDraft).toBeNull();
    await act(async () => {
      push?.("stage", { stage: "finding" });
      push?.("lookup", { outcome: "no-match", message: "Old article note" });
      push?.("delta", { text: "Late old article draft" });
      push?.("done", { investigation: investigation("2026-10-04T10:00:00.000Z") });
      end?.();
    });
    await act(async () => { await pressed; });
    await flush();
    expect(read?.bibliography?.citations[0]?.title).toBe("The next article's work");
    expect(read?.bibliography?.citations[0]?.investigation).toBeUndefined();
    expect(read?.investigating).toBeNull();
    expect(read?.investigateStage).toBeNull();
    expect(read?.investigateDraft).toBeNull();
    expect(read?.investigateFailed).toBeNull();
    expect(read?.findNote).toBeNull();
  });

  it("keeps a live stream through list replacement, then drops its old note and late failure", async () => {
    await paint(false);
    mounted = true;
    await flush();
    let pressed: Promise<void> | undefined;
    await act(async () => { pressed = read?.investigate(ID); });
    await flush();
    await act(async () => {
      push?.("lookup", { outcome: "no-match", message: "No page matched the old reference." });
      push?.("delta", { text: "Still reading the old reference" });
    });
    await flush();
    generatedAt = "2026-10-04T11:00:00.000Z";
    await act(async () => { await read?.refresh(); });
    await flush();
    expect(signal?.aborted).toBe(false);
    expect(read?.investigating).toBe(ID);
    expect(read?.investigateDraft?.text).toBe("Still reading the old reference");
    await act(async () => { await read?.investigate(ID); });
    expect(posts).toBe(1);
    await act(async () => {
      push?.("error", { error: "The old reference's reading stopped." });
      end?.();
    });
    await act(async () => { await pressed; });
    await flush();
    expect(read?.investigateFailed, "a late failure branded the replacement list's row").toBeNull();
    expect(read?.findNote, "a late completed press branded the replacement list's row").toBeNull();
    expect(read?.investigating).toBeNull();
  });

  it("carries on reading with the band closed, and the band finds the answer when it is back", async () => {
    await paint(true);
    mounted = true;
    await flush();
    let pressed: Promise<void> | undefined;
    await act(async () => {
      pressed = hook?.investigate(ID);
    });
    await flush();
    expect(hook?.investigating).toBe(ID);

    await paint(false);
    await flush();
    expect(signal?.aborted, "closing the band aborted the stream").toBe(false);
    await act(async () => push?.("delta", { text: "Still reading." }));
    await flush();
    expect(read?.investigateDraft).toEqual({ id: ID, text: "Still reading." });

    /* The band back mid-stream draws the same run, and does not start another. */
    await paint(true);
    await flush();
    expect(hook?.investigating).toBe(ID);
    expect(hook?.investigateDraft?.text).toBe("Still reading.");
    await act(async () => { await hook?.investigate(ID); });
    expect(posts, "remounting the band released the active read's admission").toBe(1);
    await paint(false);

    const kept = investigation("2026-10-04T10:00:00.000Z");
    listed = { ...WORK, investigation: kept };
    await act(async () => {
      push?.("done", { investigation: kept });
      end?.();
    });
    await act(async () => {
      await pressed;
    });
    await flush();
    expect(read?.investigating).toBeNull();
    expect(read?.bibliography?.citations[0]?.investigation).toEqual(kept);
    expect(posts, "a second dig was started").toBe(1);
    await paint(true);
    await flush();
    expect(hook?.bibliography?.citations[0]?.investigation).toEqual(kept);
  });

  it("starts from the read alone, with no band mounted — the card's press", async () => {
    await paint(false);
    mounted = true;
    await flush();
    expect(read?.status).toBe("ready");
    await act(async () => {
      void read?.investigate(ID);
    });
    await flush();
    expect(read?.investigating).toBe(ID);
    expect(posts).toBe(1);
  });
});
