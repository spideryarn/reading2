// @vitest-environment jsdom
/**
 * **The reading view's thread summaries can be asked for again**, and asking
 * again keeps every guard the first fetch has.
 *
 * `useChatAnchors` fetched once per article and was then told about changes
 * by whoever made them. Chat's band tells it nothing, so a conversation
 * started there (Debate's *Check this claim in chat*) had no summary until a
 * reload: no mark on the claim, and nothing for `?thread=` to open beside the
 * mode. Plan 261005i, the plan review's F1. `refresh()` is the fix, and
 * `Reader` calls it when the reader leaves Chat.
 *
 * The hook's header says why a refetch is dangerous: the answer is a snapshot
 * from before whatever the reader did while it was in the air. So the cases
 * below are the ones `foldInLocalWrites` exists for, asked of a refetch.
 *
 * Harness: tests/chat-arrival-race.test.ts's.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "../src/types.js";

/** One entry per request the hook made, each answered by the test. */
const asked: { url: string; resolve(v: Response): void; reject(e: Error): void }[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: (url: string) =>
      new Promise<Response>((resolve, reject) => {
        asked.push({ url: String(url), resolve, reject });
      }),
  };
});

const { useChatAnchors } = await import("../src/web/useChatAnchors.js");

function summary(id: string, over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id,
    title: id,
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    kind: "chat",
    turns: 1,
    ...over,
  };
}

const A = "spya-aaa222";
const B = "spya-bbb222";
const C = "spya-ccc222";

function json(threads: ThreadSummary[]): Response {
  return new Response(JSON.stringify({ threads }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let hook: ReturnType<typeof useChatAnchors> | undefined;
/** Every `loaded` and summary count the hook rendered with, to catch a flicker. */
let renders: { loaded: boolean; ids: string[] }[] = [];

function Harness({ slug }: { slug: string }) {
  hook = useChatAnchors(slug);
  renders.push({ loaded: hook.loaded, ids: hook.summaries.map((s) => s.id) });
  return null;
}

const api = (): ReturnType<typeof useChatAnchors> => {
  if (!hook) throw new Error("the hook is not mounted");
  return hook;
};
const ids = () => api().summaries.map((s) => s.id);

async function answer(i: number, threads: ThreadSummary[]): Promise<void> {
  await act(async () => {
    asked[i]?.resolve(json(threads));
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((go) => setTimeout(go, 0));
  });
}

async function mount(slug = "a-piece"): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { slug }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked.length = 0;
  renders = [];
  hook = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("asking for the summaries again", () => {
  it("brings a conversation made elsewhere, and one changed elsewhere, without blanking the list", async () => {
    await mount();
    await answer(0, [summary(A, { lastLine: "the old line" })]);
    expect(ids()).toEqual([A]);
    renders = [];

    await act(async () => api().refresh());
    expect(asked, "a second request").toHaveLength(2);
    expect(asked[1]?.url).toBe(asked[0]?.url);
    await answer(1, [summary(A, { lastLine: "a newer line", turns: 2 }), summary(B)]);

    expect(ids()).toEqual([A, B]);
    expect(api().summaries[0]?.lastLine).toBe("a newer line");
    expect(api().summaries[0]?.turns).toBe(2);
    /* The marks must not flicker off while the second answer is in the air. */
    expect(renders.every((r) => r.loaded), "loaded stays true throughout").toBe(true);
    expect(renders.every((r) => r.ids.includes(A)), "and the list is never emptied").toBe(true);
  });

  it("drops a conversation the server no longer has", async () => {
    await mount();
    await answer(0, [summary(A), summary(B)]);
    await act(async () => api().refresh());
    await answer(1, [summary(B)]);
    expect(ids()).toEqual([B]);
  });

  /* "No longer has" needs the server to have had it. A conversation added
     here before the refetch went out, whose first question was refused or
     whose insert the list was read ahead of, is in no answer, and the floating
     dialog is drawn from its row.
     docs/postmortems/261005q-a-refetch-cannot-tell-never-had-from-no-longer-has.md */
  it("keeps a conversation added here that the server has never listed, until it does", async () => {
    await mount();
    await answer(0, [summary(A)]);
    await act(async () => api().add(summary(C)));
    await act(async () => api().refresh());
    await answer(1, [summary(A)]);
    expect(ids(), "added before the flight, and never the server's to drop").toEqual([A, C]);

    /* Once an answer names it, it is the server's like any other. */
    await act(async () => api().refresh());
    await answer(2, [summary(A), summary(C)]);
    await act(async () => api().refresh());
    await answer(3, [summary(A)]);
    expect(ids()).toEqual([A]);
  });

  it("does not bring back a never-listed conversation the reader dropped", async () => {
    await mount();
    await answer(0, []);
    await act(async () => api().add(summary(C)));
    await act(async () => api().drop(C));
    await act(async () => api().refresh());
    await answer(1, []);
    expect(ids()).toEqual([]);
  });

  it("takes the server's first confirmed copy when the optimistic add preceded the fetch", async () => {
    await mount();
    await answer(0, []);
    await act(async () => api().add(summary(C, { title: "optimistic", lastLine: "" })));
    await act(async () => api().refresh());
    await answer(1, [summary(C, { title: "confirmed", lastLine: "the answer", turns: 2 })]);
    expect(api().summaries).toEqual([summary(C, { title: "confirmed", lastLine: "the answer", turns: 2 })]);
  });

  it("does not make an already confirmed id unseen again when add replaces it", async () => {
    await mount();
    await answer(0, [summary(C)]);
    await act(async () => api().add(summary(C, { title: "local replacement" })));
    await act(async () => api().refresh());
    await answer(1, []);
    expect(ids()).toEqual([]);
  });

  it("does not confirm an unseen id from a superseded response", async () => {
    await mount();
    await answer(0, []);
    await act(async () => api().add(summary(C)));
    await act(async () => api().refresh());
    await act(async () => api().refresh());
    await answer(2, []);
    await answer(1, [summary(C)]);
    await act(async () => api().refresh());
    await answer(3, []);
    expect(ids()).toEqual([C]);
  });

  it("keeps an unseen id through a failed refresh and the next empty response", async () => {
    await mount();
    await answer(0, []);
    await act(async () => api().add(summary(C)));
    await act(async () => api().refresh());
    await act(async () => asked[1]?.reject(new Error("offline")));
    await act(async () => api().refresh());
    await answer(2, []);
    expect(ids()).toEqual([C]);
  });

  it("resets both unseen and confirmed ids for another article", async () => {
    await mount();
    await answer(0, [summary(C)]);
    await act(async () => api().add(summary(A)));
    await mount("another-piece");
    await answer(1, []);
    expect(ids()).toEqual([]);
    await act(async () => api().add(summary(C)));
    await act(async () => api().refresh());
    await answer(2, []);
    expect(ids()).toEqual([C]);
  });

  it("keeps the same reconciliation under StrictMode's repeated effects and updaters", async () => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness, { slug: "a-piece" }))));
    expect(asked).toHaveLength(2);
    await answer(1, []);
    await act(async () => api().add(summary(C)));
    await act(async () => api().refresh());
    await answer(0, [summary(C)]);
    await answer(2, []);
    expect(ids()).toEqual([C]);
    await act(async () => api().refresh());
    await answer(3, [summary(C, { title: "confirmed" })]);
    expect(api().summaries[0]?.title).toBe("confirmed");
    await act(async () => api().refresh());
    await answer(4, []);
    expect(ids()).toEqual([]);
  });

  it("keeps what the reader did while it was in the air: an add, a touch and a drop", async () => {
    await mount();
    await answer(0, [summary(A, { lastLine: "old" }), summary(B)]);
    await act(async () => api().refresh());
    /* The snapshot the server took, before any of the three writes below. */
    const snapshot = [summary(A, { lastLine: "old" }), summary(B)];
    await act(async () => {
      api().add(summary(C));
      api().touch(A, { lastLine: "said while the refetch was out" });
      api().drop(B);
    });
    await answer(1, snapshot);

    expect(ids().sort()).toEqual([A, C].sort());
    expect(api().summaries.find((s) => s.id === A)?.lastLine).toBe("said while the refetch was out");
  });

  it("does not remember those writes for the refetch after it", async () => {
    await mount();
    await answer(0, [summary(A)]);
    await act(async () => api().refresh());
    await act(async () => api().drop(A));
    await answer(1, [summary(A)]);
    expect(ids(), "dropped during the flight, so not brought back").toEqual([]);

    /* A later refetch is a later snapshot: if the server still has it (the
       delete failed, say), the server is right. */
    await act(async () => api().refresh());
    await answer(2, [summary(A)]);
    expect(ids()).toEqual([A]);
  });

  it("lets only the newest request land, when the first is still out", async () => {
    await mount();
    await act(async () => api().refresh());
    expect(asked).toHaveLength(2);
    await answer(1, [summary(A), summary(B)]);
    expect(ids()).toEqual([A, B]);
    expect(api().loaded).toBe(true);
    /* The first request answers last, with its older snapshot. */
    await answer(0, [summary(A)]);
    expect(ids(), "the older answer does not land on top").toEqual([A, B]);
  });

  it("keeps a write made during the first fetch when a refetch supersedes it", async () => {
    await mount();
    await act(async () => api().add(summary(C)));
    await act(async () => api().refresh());
    await answer(1, [summary(A)]);
    expect(ids().sort()).toEqual([A, C].sort());
  });

  it("keeps the list it had when the refetch fails", async () => {
    await mount();
    await answer(0, [summary(A)]);
    await act(async () => api().refresh());
    await act(async () => {
      asked[1]?.reject(new Error("offline"));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
    expect(ids()).toEqual([A]);
    expect(api().loaded).toBe(true);
    expect(api().error, "a failed refresh is not the list failing to load").toBeNull();
  });

  it("starts clean on another article, whatever was in the air", async () => {
    await mount("a-piece");
    await answer(0, [summary(A)]);
    await act(async () => api().refresh());
    await mount("another-piece");
    expect(api().loaded).toBe(false);
    expect(ids()).toEqual([]);
    /* The old article's refetch answers late. */
    await answer(1, [summary(A), summary(B)]);
    expect(ids()).toEqual([]);
    await answer(2, [summary(C)]);
    expect(ids()).toEqual([C]);
  });

  it("ignores an old composer's completion after changing article", async () => {
    await mount("a-piece");
    const afterOldAnswer = api().refresh;
    await mount("another-piece");
    const count = asked.length;
    await act(async () => afterOldAnswer());
    expect(asked).toHaveLength(count);
    await answer(count - 1, [summary(B)]);
    expect(ids()).toEqual([B]);
  });

  it("ignores an old composer's completion after the article unmounts", async () => {
    await mount();
    const afterOldAnswer = api().refresh;
    await act(async () => root.unmount());
    root = createRoot(container);
    const count = asked.length;
    await act(async () => afterOldAnswer());
    expect(asked).toHaveLength(count);
  });
});
