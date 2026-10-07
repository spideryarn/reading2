// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRITERIA_AT_CEILING, CRITERION_HAS_COMMENTS, criteriaAtCeiling } from "../src/referee-criteria-store.js";
import { MAX_CRITERIA, type SavedCriterion } from "../src/saved-criteria.js";
import type { CriteriaApi } from "../src/web/useCriteria.js";
import { SignedInReader } from "../src/web/lib/made-for.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const reply = await apiFetch(url, init);
      if (!reply.ok) throw await real.failure(reply);
      return reply;
    },
  };
});
const { useCriteria } = await import("../src/web/useCriteria.js");

const first: SavedCriterion = {
  id: "spya-crt2aa", criterion: "First", config: { kind: "single" },
  createdAt: "2026-09-01T09:00:00.000Z", status: "done", results: [],
};
const second: SavedCriterion = {
  ...first, id: "spya-crt2bb", criterion: "Second", createdAt: "2026-09-01T10:00:00.000Z",
};
let api: CriteriaApi;
let root: Root;
let host: HTMLDivElement;
function Probe({ slug }: { slug: string }) {
  api = useCriteria(slug);
  return null;
}
function mount(slug = "paper", reader: string | null = null) {
  act(() => root.render(createElement(SignedInReader.Provider, { value: reader }, createElement(Probe, { slug }))));
}
async function remount(slug = "paper", reader: string | null = null) {
  await act(async () => root.unmount());
  root = createRoot(host);
  mount(slug, reader);
  await flush();
}
async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function deferred() {
  let resolve!: (reply: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}
function heldStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    push(event: string, data: unknown) {
      controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    end() { controller.close(); },
  };
}
function pendingDeletes(rows: SavedCriterion[], stream?: ReturnType<typeof heldStream>) {
  const deletes: ReturnType<typeof deferred>[] = [];
  answer = (_url, init) => {
    if (init.method === "DELETE") {
      const reply = deferred();
      deletes.push(reply);
      return reply.promise;
    }
    if (init.method === "POST" && stream) return Promise.resolve(stream.response);
    return Promise.resolve(json({ criteria: rows, sourceHash: "h" }));
  };
  return deletes;
}
function refuse(reply: ReturnType<typeof deferred>) {
  reply.resolve(json({ error: CRITERION_HAS_COMMENTS }, 409));
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("refused optimistic criterion deletes under overlapping work", () => {
  it("restores two rows in their original order when both deletes are refused", async () => {
    const deletes = pendingDeletes([first, second]);
    mount(); await flush();
    act(() => api.remove(first.id)); await flush();
    act(() => api.remove(second.id)); await flush();
    expect(api.criteria).toEqual([]);
    refuse(deletes[0]!); await flush();
    refuse(deletes[1]!); await flush();
    expect(api.criteria.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it("keeps a newly added row when a previous delete is refused", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([first, second], stream);
    mount(); await flush();
    act(() => api.remove(second.id)); await flush();
    let id = "";
    act(() => { id = api.ask("Third", { kind: "single" }); }); await flush();
    refuse(deletes[0]!); await flush();
    expect(api.criteria.map((c) => c.id)).toEqual([first.id, second.id, id]);
    stream.push("done", { ...first, id, criterion: "Third", createdAt: new Date().toISOString() });
    stream.end(); await flush();
  });

  it("accepts result and done frames after a refusal clears the tombstone", async () => {
    const stream = heldStream();
    const failed = { ...first, status: "error" as const };
    const deletes = pendingDeletes([failed], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    refuse(deletes[0]!); await flush();
    const result = { kind: "single", blockId: "spya-k3m9qt", quote: "Passage", confidence: 80, reasoning: "Reason" };
    stream.push("result", { result }); await flush();
    expect(api.criteria[0]?.results).toEqual([result]);
    stream.push("done", { ...first, results: [result] });
    stream.end(); await flush();
    expect(api.criteria[0]?.status).toBe("done");
    expect(deletes).toHaveLength(1);
  });

  it("restores the authoritative done row if it arrived before the original delete's refusal", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    const done = { ...first, results: [{ kind: "single", blockId: "spya-k3m9qt", quote: "Finished", confidence: 80, reasoning: "Reason" }] };
    stream.push("done", done); stream.end(); await flush();
    expect(deletes).toHaveLength(1);
    refuse(deletes[0]!); await flush();
    expect(api.criteria[0]?.status).toBe("done");
    expect(api.criteria[0]?.results).toEqual(done.results);
  });

  it("keeps results arriving while the delete is awaiting a refusal", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    const result = { kind: "single", blockId: "spya-k3m9qt", quote: "Arrived meanwhile", confidence: 80, reasoning: "Reason" };
    stream.push("result", { result }); await flush();
    expect(api.criteria).toEqual([]);
    refuse(deletes[0]!); await flush();
    expect(api.criteria[0]?.results).toEqual([result]);
    stream.push("done", { ...first, results: [result] }); stream.end(); await flush();
  });

  it("keeps this tab's colour when a hidden done carries an older server colour", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.recolour(first.id, 4)); await flush();
    act(() => api.remove(first.id)); await flush();
    stream.push("done", { ...first, colour: 1 }); stream.end(); await flush();
    refuse(deletes[0]!); await flush();
    expect(api.criteria[0]?.colour).toBe(4);
  });

  it("restores a stopped stream as an error rather than permanently pending", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    stream.end(); await flush();
    refuse(deletes[0]!); await flush();
    expect(api.criteria[0]?.status).toBe("error");
    expect(api.criteria[0]?.error).toBe("The criterion stopped arriving. Try again.");
  });

  it("does not restore an old article's row into a new delete with the same id", async () => {
    const deletes = pendingDeletes([first]);
    mount("old"); await flush();
    act(() => api.remove(first.id)); await flush();
    // Criterion ids are scoped to an article; the second article may reuse one.
    answer = (_url, init) => {
      if (init.method === "DELETE") {
        const reply = deferred(); deletes.push(reply); return reply.promise;
      }
      return Promise.resolve(json({ criteria: [{ ...first, criterion: "New article" }] }));
    };
    mount("new"); await flush();
    act(() => api.remove(first.id)); await flush();
    refuse(deletes[0]!); await flush();
    expect(api.criteria).toEqual([]);
    refuse(deletes[1]!); await flush();
    expect(api.criteria.map((c) => c.criterion)).toEqual(["New article"]);
  });

  it("waits for the original delete before deciding whether a done frame needs another", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    stream.push("done", first); stream.end(); await flush();
    // A second DELETE could succeed after the first refuses and restores the row.
    expect(deletes).toHaveLength(1);
    refuse(deletes[0]!); await flush();
    expect(deletes).toHaveLength(1);
    expect(api.criteria[0]?.status).toBe("done");
  });

  it("does not let an old article's stream fill a new article's hidden deletion record", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount("old"); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    answer = (_url, init) => {
      if (init.method === "DELETE") {
        const reply = deferred(); deletes.push(reply); return reply.promise;
      }
      return Promise.resolve(json({ criteria: [{ ...first, criterion: "New article" }] }));
    };
    mount("new"); await flush();
    act(() => api.remove(first.id)); await flush();
    stream.push("done", first); stream.end(); await flush();
    expect(deletes).toHaveLength(1);
    refuse(deletes[0]!); await flush();
    expect(api.criteria.map((c) => c.criterion)).toEqual(["New article"]);
  });

  /* The two guards the case above does not reach on its own: it sends `done`,
     which two of the three scope checks both stop. Each of these goes red with
     exactly one check removed — the per-frame one, and the one in the catch. */
  async function oldStreamThenNewDelete() {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount("old"); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    answer = (_url, init) => {
      if (init.method === "DELETE") {
        const reply = deferred(); deletes.push(reply); return reply.promise;
      }
      return Promise.resolve(json({ criteria: [{ ...first, criterion: "New article" }] }));
    };
    mount("new"); await flush();
    act(() => api.remove(first.id)); await flush();
    return { stream, deletes };
  }

  it("does not add an old article's result to a new article's hidden deletion record", async () => {
    const { stream, deletes } = await oldStreamThenNewDelete();
    const result = { kind: "single", blockId: "spya-k3m9qt", quote: "Old article's", confidence: 80, reasoning: "Reason" };
    stream.push("result", { result }); await flush();
    refuse(deletes[0]!); await flush();
    expect(api.criteria.map((c) => [c.criterion, c.results])).toEqual([["New article", []]]);
  });

  it("does not let an old article's stopped stream turn a new article's hidden row into an error", async () => {
    const { stream, deletes } = await oldStreamThenNewDelete();
    stream.end(); await flush();
    refuse(deletes[0]!); await flush();
    expect(api.criteria.map((c) => [c.criterion, c.status])).toEqual([["New article", "done"]]);
  });

  it("still re-deletes after done when the original delete succeeded", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    stream.push("done", first); stream.end(); await flush();
    expect(deletes).toHaveLength(1);
    deletes[0]!.resolve(json({ ok: true })); await flush();
    expect(deletes).toHaveLength(2);
    deletes[1]!.resolve(json({ ok: true })); await flush();
    expect(api.criteria).toEqual([]);
    expect(api.error).toBeNull();
  });

  it("keeps a successful delete hidden when its stream ends without done", async () => {
    const stream = heldStream();
    const deletes = pendingDeletes([{ ...first, status: "error" }], stream);
    mount(); await flush();
    act(() => api.retry(first.id)); await flush();
    stream.push("begin", { ...first, status: "pending" }); await flush();
    act(() => api.remove(first.id)); await flush();
    deletes[0]!.resolve(json({ ok: true })); await flush();
    stream.end(); await flush();
    expect(api.criteria).toEqual([]);
    expect(api.error).toBeNull();
  });
});

/**
 * **An add refused at the ceiling** (`CRITERIA_AT_CEILING`, a 409 before any
 * stream: docs/plans/261007f-referee-criteria-are-never-dropped-a-ceiling-of-200-refuses-instead.md).
 * The ordinary pre-stream failure path keeps a failed row with the server's
 * sentence and Retry once room is made; it never shows the criterion as added
 * or touches an existing row. Review added session drafts after reproducing
 * loss on reload. They retain the words and configuration until acceptance or
 * explicit deletion, without automatically resending them.
 */
describe("an add refused at the ceiling", () => {
  it("shows the typed criterion as failed, with the sentence, and leaves the rest alone", async () => {
    answer = (_url, init) =>
      Promise.resolve(init.method === "POST"
        ? json({ error: CRITERIA_AT_CEILING }, 409)
        : json({ criteria: [first, second], sourceHash: "h" }));
    mount(); await flush();
    let id = "";
    act(() => { id = api.ask("One too many", { kind: "single" }); }); await flush();
    expect(api.criteria.slice(0, 2)).toMatchObject([first, second]);
    const refused = api.criteria.find((c) => c.id === id);
    expect(refused).toMatchObject({ criterion: "One too many", status: "error", results: [], error: CRITERIA_AT_CEILING });
    expect(api.criteria).toHaveLength(3);
    expect(api.error).toBe(CRITERIA_AT_CEILING);
  });

  it("keeps refused words and both poles across a reload, without resending", async () => {
    const posts: RequestInit[] = [];
    answer = (_url, init) => {
      if (init.method === "POST") posts.push(init);
      return Promise.resolve(init.method === "POST"
        ? json({ error: CRITERIA_AT_CEILING }, 409)
        : json({ criteria: [first, second], sourceHash: "h" }));
    };
    mount(); await flush();
    const config = { kind: "diverging", poles: { against: "missing controls", favour: "adequate controls" }, scale: "br" } as const;
    let id = "";
    act(() => { id = api.ask("My detailed criterion", config); }); await flush();
    await remount();
    expect(api.criteria.find((c) => c.id === id)).toMatchObject({ criterion: "My detailed criterion", config, status: "error", error: CRITERIA_AT_CEILING });
    expect(api.criteria.slice(0, 2)).toMatchObject([first, second]);
    expect(posts).toHaveLength(1);
  });

  it("keeps a draft refused by a list already past the ceiling, whose sentence names its count", async () => {
    const above = criteriaAtCeiling(MAX_CRITERIA + 1);
    expect(above).not.toBe(CRITERIA_AT_CEILING);
    answer = (_url, init) => Promise.resolve(init.method === "POST"
      ? json({ error: above }, 409)
      : json({ criteria: [first, second], sourceHash: "h" }));
    mount(); await flush();
    let id = "";
    act(() => { id = api.ask("Past the ceiling", { kind: "single" }); }); await flush();
    await remount();
    expect(api.criteria.find((c) => c.id === id)).toMatchObject({ criterion: "Past the ceiling", error: above });
  });

  it("keeps a refused retry as a draft until a begin confirms the add", async () => {
    const posts: RequestInit[] = [];
    let stream: ReturnType<typeof heldStream> | undefined;
    let stored: SavedCriterion[] = [first, second];
    answer = (_url, init) => {
      if (init.method === "POST") {
        posts.push(init);
        return Promise.resolve(stream?.response ?? json({ error: CRITERIA_AT_CEILING }, 409));
      }
      return Promise.resolve(json({ criteria: stored, sourceHash: "h" }));
    };
    mount(); await flush();
    let id = "";
    act(() => { id = api.ask("Retry me", { kind: "single" }); }); await flush();
    act(() => api.retry(id)); await flush();
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[1]!.body as string)).toMatchObject({ id, criterion: "Retry me" });
    expect(api.criteria.find((c) => c.id === id)?.error).toBe(CRITERIA_AT_CEILING);
    await remount();
    expect(api.criteria.find((c) => c.id === id)?.criterion).toBe("Retry me");

    stream = heldStream();
    act(() => api.retry(id)); await flush();
    // A retry in flight is still unsaved until its begin frame.
    await remount();
    expect(api.criteria.find((c) => c.id === id)?.criterion).toBe("Retry me");
    const accepted = { ...first, id, criterion: "Retry me" };
    stream.push("begin", { ...accepted, status: "pending" });
    stream.push("done", accepted); stream.end(); await flush();
    stored = [...stored, accepted];
    await remount();
    expect(api.criteria.filter((c) => c.id === id)).toEqual([expect.objectContaining(accepted)]);
    // Removing the persisted row elsewhere must not resurrect a consumed draft.
    stored = [first, second];
    await remount();
    expect(api.criteria.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it("keeps drafts apart by article and reader, and forgets an explicitly removed draft", async () => {
    answer = (_url, init) => Promise.resolve(init.method === "POST"
      ? json({ error: CRITERIA_AT_CEILING }, 409)
      : json({ criteria: [], sourceHash: "h" }));
    mount("paper", "reader-a"); await flush();
    let id = "";
    act(() => { id = api.ask("Private words", { kind: "literature" }); }); await flush();
    await remount("elsewhere", "reader-a");
    expect(api.criteria).toEqual([]);
    await remount("paper", "reader-b");
    expect(api.criteria).toEqual([]);
    await remount("paper", "reader-a");
    expect(api.criteria.find((c) => c.id === id)?.criterion).toBe("Private words");
    act(() => api.remove(id)); await flush();
    await remount("paper", "reader-a");
    expect(api.criteria).toEqual([]);
  });

  it("still loads, refuses and keeps the row on screen when browser storage is blocked", async () => {
    // What a browser with site data blocked does: merely reading the property throws.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    answer = (_url, init) => Promise.resolve(init.method === "POST"
      ? json({ error: CRITERIA_AT_CEILING }, 409)
      : json({ criteria: [first, second], sourceHash: "h" }));
    mount(); await flush();
    expect(api.loaded).toBe(true);
    expect(api.loadError).toBeNull();
    let id = "";
    act(() => { id = api.ask("Kept while mounted", { kind: "single" }); }); await flush();
    expect(api.criteria.find((c) => c.id === id)).toMatchObject({ criterion: "Kept while mounted", error: CRITERIA_AT_CEILING });
    act(() => api.remove(id)); await flush();
    await remount();
    expect(api.criteria.map((c) => c.id)).toEqual([first.id, second.id]);
  });

  it("does not revive a discarded draft when its refusal arrives after leaving the article", async () => {
    const post = deferred();
    answer = (_url, init) => init.method === "POST"
      ? post.promise
      : Promise.resolve(json({ criteria: [], sourceHash: "h" }));
    mount(); await flush();
    let id = "";
    act(() => { id = api.ask("Words I then discard", { kind: "single" }); }); await flush();
    act(() => api.remove(id)); await flush();
    await remount("elsewhere");
    post.resolve(json({ error: CRITERIA_AT_CEILING }, 409)); await flush();
    await remount();
    expect(api.criteria).toEqual([]);
  });

  it("does not revive a draft deleted by a new mount while an old retry is in flight", async () => {
    const retry = deferred();
    let holding = false;
    answer = (_url, init) => init.method === "POST"
      ? holding ? retry.promise : Promise.resolve(json({ error: CRITERIA_AT_CEILING }, 409))
      : Promise.resolve(json({ criteria: [], sourceHash: "h" }));
    mount(); await flush();
    let id = "";
    act(() => { id = api.ask("Discard after returning", { kind: "single" }); }); await flush();
    holding = true;
    act(() => api.retry(id)); await flush();
    await remount();
    act(() => api.remove(id)); await flush();
    retry.resolve(json({ error: CRITERIA_AT_CEILING }, 409)); await flush();
    await remount();
    expect(api.criteria).toEqual([]);
  });
});
