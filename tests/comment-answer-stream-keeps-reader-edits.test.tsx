// @vitest-environment jsdom
/**
 * **An answer stream owns a comment's answer, and nothing else on the row.**
 *
 * A reader can edit their note, move its placement or recolour it while its
 * explanation is being written: `CommentBody` is mounted whatever the status,
 * and the PATCH is deliberately not queued behind the 15 to 25 second stream
 * (`patching` in src/web/useComments.ts). Until 2026-10-07 the stream then put
 * the old note back on screen. `send` captured the row once, before the POST,
 * and every later frame wrote a whole row built from that copy: each `delta`,
 * the `done` frame (which the server also built from its own opening
 * snapshot), and the failure branch. Postgres was right throughout; the tab
 * was not until a reload, and a reader who then edited the stale text they
 * were shown would have saved over their own newer words.
 *
 * And the other way round: every PATCH answers with the whole row and the hook
 * replaced the whole row with it. One that committed while the answer was
 * still `pending` says so, and landing after a delta it blanked the streamed
 * text, or after `done` it brought the spinner back for good.
 *
 * Seventh sweep, WC1 with SV2
 * (docs/investigations/261006d-seventh-sweep-depth-reader-client-review-opus-on-sol.md § WC1);
 * the server's half is tests/comment-answer-stream-lifetime.test.ts.
 *
 * The fake server keeps its own row, the way tests/recolour-write-order.test.tsx
 * does, and every assertion about the screen is made against that row rather
 * than against a value written out again here.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Comment, HighlightColour } from "../src/types.js";

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { useComments } = await import("../src/web/useComments.js");
type Api = ReturnType<typeof useComments>;
type Shown = Api["comments"][number];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-paper";
const ID = "spya-ask001";

/** The server's row. Writes apply to it; every answer is a snapshot of it. */
let stored: Comment;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The row with some keys taken off: how a column is set to NULL. */
function without(row: Comment, ...keys: string[]): Comment {
  const next = { ...row } as Record<string, unknown>;
  for (const k of keys) delete next[k];
  return next as unknown as Comment;
}

/** One PATCH, applied to its own column only, as each route's SQL does. */
function patch(url: string, body: Record<string, unknown>): Response {
  if (url.endsWith("/colour")) {
    const colour = body["colour"];
    stored =
      typeof colour === "string"
        ? { ...stored, colour: colour as HighlightColour }
        : without(stored, "colour");
  } else {
    const next = body["body"];
    stored = typeof next === "string" ? { ...stored, body: next } : without(stored, "body");
  }
  return json({ comment: stored });
}

/** A PATCH the test lands in two steps: the write, then its answer. */
interface Held {
  /** Run the write on the server; the answer is a snapshot taken now. */
  commit(): void;
  /** Hand that answer to the tab. */
  deliver(): void;
}
let held: Held[] = [];

/** The answer stream of the one POST a test makes. */
interface Stream {
  /** What the server claimed, as `beginAnswer` returns it. */
  begun: Comment;
  frame(name: string, data: unknown): void;
  close(): void;
}
let stream: Stream | undefined;

function answer(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  if (method === "GET") return Promise.resolve(json({ comments: [stored] }));
  if (method === "POST" && url.endsWith("/answer")) {
    // `beginAnswer`: the answer columns are blanked and the row is `pending`.
    stored = { ...without(stored, "answer", "citations", "searches", "model", "error"), status: "pending" };
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    stream = {
      begun: stored,
      frame: (name, data) =>
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)),
      close: () => controller.close(),
    };
    return Promise.resolve(new Response(body, { status: 200 }));
  }
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  let deliverWith!: (r: Response) => void;
  const parked = new Promise<Response>((resolve) => {
    deliverWith = resolve;
  });
  let composed: Response | null = null;
  held.push({
    commit: () => {
      composed = patch(url, body);
    },
    deliver: () => deliverWith(composed ?? patch(url, body)),
  });
  return parked;
}

let api: Api | undefined;
function Harness() {
  const comments = useComments(SLUG);
  useEffect(() => {
    api = comments;
  });
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  // A legacy explanation row: the only kind `beginAnswer` will answer again.
  stored = {
    id: ID,
    blockId: "spya-k3m9qt",
    quote: "the words",
    start: 0,
    createdAt: "2026-10-03T09:00:00.000Z",
    status: "done",
    answer: "the first answer",
    model: "test/model",
    body: "old",
    colour: "yellow",
  };
  held = [];
  stream = undefined;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  api = undefined;
});

/** Long enough for a stream chunk to be read and its frames applied. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const shown = (): Shown => {
  const row = api?.comments.find((c) => c.id === ID);
  if (!row) throw new Error("the comment is not on screen");
  return row;
};

/** Press *Try again* (or *Dig deeper*) and wait for the stream to open. */
async function ask(deep = false): Promise<Stream> {
  await act(async () => {
    if (deep) api?.deepen(ID);
    else api?.retry(ID);
  });
  await settle();
  if (!stream) throw new Error("the answer POST was never made");
  await say("begin", stream.begun);
  return stream;
}

async function say(name: string, data: unknown): Promise<void> {
  await act(async () => {
    stream?.frame(name, data);
  });
  await settle();
}

/** Start a PATCH and leave it parked: nothing has reached the server yet. */
async function start(write: () => Promise<void> | undefined): Promise<Held> {
  await act(async () => {
    void write();
  });
  await settle();
  const one = held.shift();
  if (!one) throw new Error("the PATCH was never sent");
  return one;
}

async function land(one: Held): Promise<void> {
  await act(async () => {
    one.commit();
    one.deliver();
  });
  await settle();
}

/**
 * The server finishing: the answer columns are written, and the frame is the
 * stored row (what `settle` in src/routes.ts sends since SV2).
 */
const finished = (): Comment => {
  stored = { ...stored, status: "done", answer: "hello there", model: "test/model" };
  return stored;
};

/**
 * The frame an older server sends: its answer, over the row **as it was when
 * the answer began**. A tab can be talking to one across a deploy, and it is
 * what proves the client's half without leaning on the server's.
 */
const finishedFromTheOpeningSnapshot = (begun: Comment): Comment => {
  finished();
  return { ...begun, status: "done", answer: "hello there", model: "test/model" };
};

describe("an edit made while the answer streams stays on screen", () => {
  it("a new body survives a delta and the terminal frame", async () => {
    const s = await ask();
    await land(await start(() => api?.edit(ID, "new")));
    expect(shown().body).toBe("new");

    await say("delta", { text: "hello" });
    expect(shown().body, "a delta put the old note back").toBe(stored.body);
    expect(shown().answer).toBe("hello");
    expect(shown().status).toBe("pending");

    await say("done", finishedFromTheOpeningSnapshot(s.begun));
    expect(shown().body, "the done frame put the old note back").toBe(stored.body);
    expect(shown().body).toBe("new");
    expect(shown().status).toBe("done");
    expect(shown().answer).toBe("hello there");
  });

  it("a body removed stays removed", async () => {
    const s = await ask();
    await land(await start(() => api?.edit(ID, null)));
    expect("body" in shown()).toBe(false);

    await say("delta", { text: "hello" });
    expect("body" in shown(), "a delta put the removed note back").toBe(false);

    await say("done", finishedFromTheOpeningSnapshot(s.begun));
    expect("body" in stored).toBe(false);
    expect("body" in shown(), "the done frame put the removed note back").toBe(false);
    expect(shown().answer).toBe("hello there");
  });

  it("with no delta at all, the terminal frame alone does not undo it", async () => {
    const s = await ask();
    await land(await start(() => api?.edit(ID, "new")));
    await say("done", finishedFromTheOpeningSnapshot(s.begun));
    expect(shown().body).toBe("new");
    expect(shown().status).toBe("done");
  });

  it("an edit answered before the begin frame is read is not undone by it", async () => {
    // The POST is out and the server has claimed the row; its `begin` frame,
    // a snapshot from that moment, has not reached the tab yet.
    await act(async () => {
      api?.retry(ID);
    });
    await settle();
    if (!stream) throw new Error("the answer POST was never made");
    const begun = stream.begun;
    await land(await start(() => api?.edit(ID, "new")));

    await say("begin", begun);
    expect(shown().body, "the begin frame put the old note back").toBe("new");
    expect(shown().status).toBe("pending");
  });

  it("a colour changed mid-stream survives too, and a removed one stays removed", async () => {
    const s = await ask();
    await land(await start(() => api?.recolour(ID, "blue")));
    await say("delta", { text: "hello" });
    expect(shown().colour).toBe("blue");
    await land(await start(() => api?.recolour(ID, null)));
    await say("delta", { text: " there" });
    expect("colour" in shown()).toBe(false);
    await say("done", finishedFromTheOpeningSnapshot(s.begun));
    expect("colour" in shown()).toBe(false);
    expect(shown().answer).toBe("hello there");
  });

  it("the stream dropping leaves the edit, under the error", async () => {
    const s = await ask();
    await land(await start(() => api?.edit(ID, "new")));
    await say("delta", { text: "hel" });
    await act(async () => {
      s.close();
    });
    await settle();
    expect(shown().status).toBe("error");
    expect(shown().answer).toBe("hel");
    expect(shown().body, "the failure branch put the old note back").toBe("new");
  });

  it("a failed Dig deeper puts the old answer back, and still not the old note", async () => {
    const s = await ask(true);
    // Held, not replaced: the answer the reader could already read.
    expect(shown().answer).toBe("the first answer");
    expect(shown().replacing).toBe(true);
    await land(await start(() => api?.edit(ID, "new")));
    await act(async () => {
      s.close();
    });
    await settle();
    expect(shown().status).toBe("error");
    expect(shown().answer).toBe("the first answer");
    expect(shown().replacing).toBe(true);
    expect(shown().body).toBe("new");
  });

  it("clears what the last attempt left: the terminal frame carries no error, so none stays", async () => {
    // An attempt that failed leaves `error` on the row; the next one succeeds.
    const first = await ask();
    await act(async () => {
      first.close();
    });
    await settle();
    expect(shown().error).toBeTruthy();

    await ask();
    expect("error" in shown(), "the retry kept the last attempt's error").toBe(false);
    await say("delta", { text: "hello" });
    await say("done", finished());
    expect("error" in shown()).toBe(false);
    expect(shown().status).toBe("done");
  });
});

describe("a PATCH answered while the row was pending does not undo the answer", () => {
  it("landing after a delta, it keeps the words already streamed", async () => {
    await ask();
    await say("delta", { text: "hello" });
    // Commits now: the server's row is `pending` with no answer, and says so.
    await land(await start(() => api?.edit(ID, "new")));
    expect(shown().body).toBe("new");
    expect(shown().status).toBe("pending");
    expect(shown().answer, "the PATCH answer blanked the streamed text").toBe("hello");
  });

  it("sent before the answer began and landing mid-stream, it keeps them too", async () => {
    // The request leaves first; the reader presses Try again while it is out.
    const one = await start(() => api?.edit(ID, "new"));
    await ask();
    await say("delta", { text: "hello" });
    await land(one);
    expect(shown().body).toBe("new");
    expect(shown().answer).toBe("hello");
    expect(shown().status).toBe("pending");
  });

  it.each<[string, () => Promise<void> | undefined, (row: Shown) => void]>([
    ["an edit", () => api?.edit(ID, "new"), (row) => expect(row.body).toBe("new")],
    ["a recolour", () => api?.recolour(ID, "blue"), (row) => expect(row.colour).toBe("blue")],
  ])("%s landing after the done frame does not bring the spinner back", async (_name, write, kept) => {
    await ask();
    await say("delta", { text: "hello" });
    // The write commits mid-stream; its answer is still on the wire.
    const one = await start(write);
    await act(async () => {
      one.commit();
    });
    await say("done", finished());
    expect(shown().status).toBe("done");

    await act(async () => {
      one.deliver();
    });
    await settle();
    expect(shown().status, "a PATCH answer from before the answer finished resurrected the spinner").toBe("done");
    expect(shown().answer).toBe("hello there");
    kept(shown());
  });

  it("with no answer in the air, a PATCH answer still replaces the whole row", async () => {
    /* The control, and the behaviour that must not be lost: the response is
       the server's whole row, and when nothing is streaming it is the newest
       word on every column, the answer's included (another tab re-asked). */
    stored = { ...stored, answer: "an answer written in another tab" };
    await land(await start(() => api?.edit(ID, "new")));
    expect(shown().answer).toBe("an answer written in another tab");
    expect(shown().body).toBe("new");
  });
});
