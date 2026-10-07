// @vitest-environment jsdom
/**
 * **A Mirror run that stops without finishing must not be filed as an empty
 * answer** — and this is the file where that matters more than anywhere else in
 * this app.
 *
 * Everywhere else, a stream that stops cleanly two frames in produces something
 * visibly short: half a mark, half an explanation, half a chat reply. Here the
 * correct answer is *usually the empty list*. So a socket that died, an
 * instance that was killed and a model that read nine comments and had nothing
 * to raise all arrive at the same place on screen unless the hook insists on
 * being told which it was. `close()` on a `ReadableStream` is a **clean** end:
 * `reader.read()` resolves `{ done: true }`, nothing throws, and the `for await`
 * in `useMirror` simply finishes. docs/reusable/silent-success.md, and
 * docs/project/comments.md § streaming.
 *
 * So: zero or more `delta` frames, then **exactly one** terminal frame — `done`
 * or `error` — and `"done"` is reached from the `done` frame and nowhere else.
 *
 * The second thing this file pins is cheaper and just as easy to lose: **the
 * hook must not fetch on mount.** Mirror is a paid call, and Referee mode is
 * owners-only precisely so that nobody else's press can spend the owner's
 * money; an effect that ran a run when the panel appeared would spend it with
 * *nobody's* press behind it, once per mode switch. src/web/visitor.ts.
 *
 * Harness copied from tests/quiz-mark-stream.test.tsx, which is the same
 * argument one feature over.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_FAULT } from "../src/messages.js";
import { useMirror, type MirrorApi } from "../src/web/useMirror.js";

const SLUG = "a-paper";

let container: HTMLDivElement;
let root: Root;
let latest: MirrorApi | undefined;

function Harness() {
  latest = useMirror(SLUG);
  return null;
}

const enc = new TextEncoder();

/** One SSE frame, exactly as `sse` in src/routes.ts writes it. */
function frame(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const EMPTY_RUN = {
  remarks: [],
  input: {
    comments: [{ id: "spya-cmt2aa", blockId: "spya-k3m9qt", quote: "a phrase", passage: "A whole sentence about it.", body: "Fine as it stands." }],
    placements: [],
    skippedBookmarks: 0,
    skippedTagged: 0,
    skippedOrphans: 0,
    badValence: 0,
    truncated: 0,
  },
  coverage: { asked: false, reason: "no-criteria" },
  placementsOmitted: 0,
  model: "a-model",
};

/** One remark of every kind the panel draws, each with exactly what it reads. */
const FULL_RUN = {
  ...EMPTY_RUN,
  remarks: [
    { kind: "specificity", trialTested: true, note: "Say which table.", commentId: "spya-cmt2aa", blockId: "spya-k3m9qt" },
    { kind: "tone", trialTested: true, note: "Address the work.", commentId: "spya-cmt2aa", blockId: "spya-k3m9qt" },
    { kind: "misunderstanding", trialTested: true, note: "The passage says otherwise.", commentId: "spya-cmt2aa", blockId: "spya-k3m9qt", passage: "A whole sentence" },
    { kind: "placement", trialTested: false, note: "A number with no words.", commentId: "spya-cmt2bb", blockId: "spya-k3m9qt", passage: "a phrase", valence: -40, criterion: "Novelty" },
    { kind: "coverage", trialTested: false, note: "Nothing here takes this up.", criterion: "Reproducibility" },
  ],
  coverage: { asked: true, criteriaOmitted: 0 },
};

function finishesWith(data: unknown): () => ReadableStream<Uint8Array> {
  return () =>
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(frame("done", data));
        c.close();
      },
    });
}

/**
 * **Two deltas, then `close()` — and nothing else.** The whole point of the
 * file: from inside the `for await` this is indistinguishable from a stream
 * that said `done`, so the hook cannot infer completion from the loop ending.
 */
function stopsWithoutFinishing(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame("delta", { chars: 12 }));
      c.enqueue(frame("delta", { chars: 40 }));
      c.close();
    },
  });
}

function finishesEmpty(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame("delta", { chars: 12 }));
      c.enqueue(frame("done", EMPTY_RUN));
      c.close();
    },
  });
}

function failsMidway(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(frame("delta", { chars: 12 }));
      c.enqueue(frame("error", { error: "The model stopped talking." }));
      c.close();
    },
  });
}

/** What the next `POST /api/referee/mirror/:slug` answers with. */
let runBody: () => ReadableStream<Uint8Array>;
let posts = 0;

/** Let every microtask hop settle — a fetch, a stream reader and React. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  runBody = stopsWithoutFinishing;
  posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.startsWith("/api/referee/mirror/")) {
        posts++;
        return Promise.resolve({ ok: true, status: 200, body: runBody() } as unknown as Response);
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  latest = undefined;
});

async function ask(): Promise<void> {
  await act(async () => {
    latest?.ask();
  });
  await settle();
}

describe("nothing is spent without a press", () => {
  it("makes no request at all on mount", async () => {
    /* The `beforeEach` above has already mounted the hook and drained the
       microtask queue. A `useEffect` that started a run would show up here as a
       POST, and it would be one per article the reader opens in Referee mode. */
    expect(posts).toBe(0);
    expect(latest?.status).toBe("idle");
  });

  it("will not start a second run while one is in the air", async () => {
    /* A never-settling body, so the first run is still open when the second
       press lands. Two presses buying two model calls is the bug `retry` in
       useComments.ts carries a note about. */
    runBody = () => new ReadableStream<Uint8Array>({ start() {} });
    await ask();
    await ask();
    expect(posts).toBe(1);
  });
});

describe("a run that stops without a done frame", () => {
  it("does not become an empty answer", async () => {
    await ask();

    /* **The assertion the whole file exists for.** `remarks: []` is what a good
       run usually returns, so filing a dead socket as one would be invisible:
       the referee reads "nothing to raise" about comments the model never
       finished looking at. */
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
    /* The hook's own sentence, exactly — a `toBeTruthy` here stayed green with
       it thrown as a plain `Error`, which `describeFetchFailure` now replaces
       with the page-fault copy (GPT Sol, code review F6, plan 260924a). */
    expect(latest?.error).toMatch(/stopped arriving before it was finished/);
  });

  it("stops saying it is answering", async () => {
    await ask();
    expect(latest?.writing).toBe(false);
  });
});

describe("and the cases that keep that from being vacuous", () => {
  it("takes an empty list from a real done frame as a real answer", async () => {
    /* Without this the tests above would pass on a hook that failed every run,
       which is a broken feature satisfying every assertion in the file. This is
       also the state the panel draws its commonest sentence from. */
    runBody = finishesEmpty;
    await ask();

    expect(latest?.status).toBe("done");
    expect(latest?.result?.remarks).toEqual([]);
    expect(latest?.error).toBeNull();
  });

  it("carries the reason from an explicit error frame", async () => {
    runBody = failsMidway;
    await ask();

    expect(latest?.status).toBe("failed");
    expect(latest?.error).toContain("The model stopped talking.");
  });

  it("refuses a done frame it cannot read rather than drawing the blanks", async () => {
    /* A `done` from a server that has moved on — no `input`, no `coverage`.
       Rendered, that is a panel with the empty state and no counts under it,
       which reads exactly like a good run. */
    runBody = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(frame("done", { remarks: [] }));
          c.close();
        },
      });
    await ask();

    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
  });
});

describe("a done frame is checked as deep as the panel reads it", () => {
  it("accepts a run with one remark of every kind", async () => {
    runBody = finishesWith(FULL_RUN);
    await ask();
    expect(latest?.status).toBe("done");
    expect(latest?.result).toEqual(FULL_RUN);
  });

  it.each(["a-new-kind", "constructor", "__proto__"])("accepts an unknown remark kind %s with the common fields", async (kind) => {
    const data = { ...FULL_RUN, remarks: [{ ...FULL_RUN.remarks[0], kind }] };
    runBody = finishesWith(data);
    await ask();
    expect(latest?.status).toBe("done");
    expect(latest?.result).toEqual(data);
  });

  it.each(FULL_RUN.remarks)("refuses a $kind remark with the opposite trial badge", async (remark) => {
    runBody = finishesWith({ ...FULL_RUN, remarks: [{ ...remark, trialTested: !remark.trialTested }] });
    await ask();
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
  });

  /* GPT Sol's C4 on plan 261007l: only the top level used to be checked, so a
     null remark crashed the panel and a remark with no note drew a blank row
     that reads like a finding. Each case below is one field the panel reads. */
  const remark0 = FULL_RUN.remarks[0];
  it.each([
    { ...FULL_RUN, remarks: [null] },
    { ...FULL_RUN, remarks: [{ ...remark0, note: 42 }] },
    { ...FULL_RUN, remarks: [{ ...remark0, trialTested: "yes" }] },
    { ...FULL_RUN, remarks: [{ ...remark0, blockId: undefined }] },
    { ...FULL_RUN, remarks: [{ ...remark0, commentId: null }] },
    { ...FULL_RUN, remarks: [{ kind: "a-new-kind", note: "n", trialTested: true }] },
    { ...FULL_RUN, remarks: [{ kind: "misunderstanding", trialTested: true, note: "n", commentId: "c", blockId: "b" }] },
    { ...FULL_RUN, remarks: [{ kind: "placement", trialTested: false, note: "n", commentId: "c", blockId: "b", passage: "p", valence: "-40" }] },
    { ...FULL_RUN, remarks: [{ kind: "placement", trialTested: false, note: "n", commentId: "c", blockId: "b", passage: "p", valence: 1, criterion: {} }] },
    { ...FULL_RUN, remarks: [{ kind: "coverage", trialTested: false, note: "n" }] },
    { ...FULL_RUN, input: { ...EMPTY_RUN.input, placements: undefined } },
    { ...FULL_RUN, input: { ...EMPTY_RUN.input, placements: [null] } },
    { ...FULL_RUN, input: { ...EMPTY_RUN.input, comments: [{ id: "c", blockId: "b" }] } },
    { ...FULL_RUN, input: { ...EMPTY_RUN.input, comments: [{ ...EMPTY_RUN.input.comments[0], body: 7 }] } },
    { ...FULL_RUN, input: { ...EMPTY_RUN.input, skippedBookmarks: -1 } },
    { ...FULL_RUN, coverage: { asked: true } },
    { ...FULL_RUN, coverage: { asked: false } },
    { ...FULL_RUN, coverage: null },
    { ...FULL_RUN, placementsOmitted: undefined },
    { ...FULL_RUN, model: undefined },
  ])("refuses a malformed result before the panel can read it: case %#", async (data) => {
    runBody = finishesWith(data);
    await ask();
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
    expect(latest?.error).toMatch(/answer this page could not read/);
  });
});

describe("a done frame that is not JSON", () => {
  it("is the page's fault, not a run that stopped arriving", async () => {
    /* C5 on plan 261007l: `readEvents` used to drop the frame, so this read as
       the body ending early and told the referee to try again — a second paid
       run over a fault of ours. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    runBody = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode("event: done\ndata: {not json\n\n"));
          c.close();
        },
      });
    await ask();
    expect(latest?.status).toBe("failed");
    expect(latest?.result).toBeNull();
    expect(latest?.error).toBe(PAGE_FAULT.message);
  });
});
