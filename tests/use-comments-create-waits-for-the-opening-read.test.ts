// @vitest-environment jsdom
/**
 * **A `create` issued before the opening read has settled waits for it** —
 * `useComments`, D3 of
 * docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md.
 *
 * The opening GET's answer *replaces* the list
 * (docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md), and
 * until 2026-10-03 the only thing ordering a write after it was the Save
 * button's gate on `loaded`. That was enough while a press was the only way to
 * save. It is not now: the box a selection opens stores a draft on its way out
 * (the ×, Escape, another selection, an unmount), and a box that is going away
 * cannot wait at a disabled button. So the order moved into the hook, which is
 * the one place every create passes through.
 *
 * What is asked: both rows on screen after the read answers — requiring the old
 * one too is what rejects the tempting wrong fix, dropping the snapshot when a
 * write begins — and nothing POSTed or drawn before then. Then the same with
 * the read failing, at its deadline, and with the hook torn down while a create
 * is held, which must still reach the server: the words are the reader's.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId, Comment } from "../src/types.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;
const left: { url: string; init: RequestInit }[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  /* The signal is ignored on purpose: an abandoned read must be unable to
     commit even when its answer still arrives. */
  const apiFetch = (url: string, init: RequestInit = {}) => answer(String(url), init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
    leavingFetch: (url: string, init: RequestInit = {}) => {
      left.push({ url, init });
    },
  };
});

const { useComments } = await import("../src/web/useComments.js");
const { OPENING_READ_DEADLINE_MS } = await import("../src/web/lib/opening-read.js");
type Api = ReturnType<typeof useComments>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCK = "spya-k3m9qt" as BlockId;
const OLD: Comment = {
  id: "spya-cmt4wq",
  blockId: BLOCK,
  quote: "entropy",
  start: 12,
  createdAt: "2026-10-01T09:00:00.000Z",
  status: "none",
  body: "the note from last week",
};
const NEW = {
  id: "spya-cmt8hz",
  blockId: BLOCK,
  quote: "a measure of disorder",
  start: 40,
  body: "the note written while the list loaded",
};

let host: HTMLDivElement;
let root: Root;
let latest: Api | undefined;

function Harness({ slug }: { slug: string }) {
  latest = useComments(slug);
  return null;
}

async function show(slug: string | null, strict = false): Promise<void> {
  await act(async () => {
    const node = slug === null ? null : createElement(Harness, { slug });
    root.render(strict && node ? createElement(StrictMode, null, node) : node);
  });
}

async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
      else await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function held(): { promise: Promise<Response>; release(r: Response): void; fail(e: Error): void } {
  let release!: (r: Response) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<Response>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

/** A server whose GET the case holds, and which stores whatever is POSTed. */
function server() {
  const get = held();
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  answer = (url, init) => {
    if ((init.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url, body });
      return Promise.resolve(
        json({ comment: { ...body, createdAt: "2026-10-03T19:42:00.000Z", status: "none" } }),
      );
    }
    /* A clone per request: StrictMode asks twice, and a `Response` can be read
       once — the abandoned read would otherwise use up the live one's answer. */
    return get.promise.then((r) => r.clone());
  };
  return { get, posted };
}

const bodies = () => (latest?.comments ?? []).map((c) => c.body);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  latest = undefined;
  left.length = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("a create before the opening read has settled", () => {
  it("is held — nothing drawn, nothing sent — and both rows are there once the read answers", async () => {
    const { get, posted } = server();
    await show("a-piece");
    expect(latest?.loaded).toBe(false);

    let result: Comment | null | undefined;
    act(() => {
      void latest!.create(NEW).then((c) => {
        result = c;
      });
    });
    await settle();
    expect(posted, "the create went out while the opening read was still in the air").toHaveLength(0);
    expect(bodies(), "the optimistic row was drawn where the read's answer will erase it").toEqual([]);

    get.release(json({ comments: [OLD] }));
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toMatchObject({ id: NEW.id, quote: NEW.quote, start: NEW.start, body: NEW.body });
    expect(bodies(), "the comment from before was lost").toContain(OLD.body);
    expect(bodies(), "the comment just made is not on screen").toContain(NEW.body);
    expect(result?.id).toBe(NEW.id);
  });

  it("goes ahead when the read fails, and the load's failure is still said", async () => {
    const { get, posted } = server();
    await show("a-piece");
    act(() => {
      void latest!.create(NEW);
    });
    await settle();
    expect(posted).toHaveLength(0);

    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await settle();
    expect(posted).toHaveLength(1);
    expect(bodies()).toEqual([NEW.body]);
    expect(latest?.loadError).toContain("[db-busy]");
  });

  it("goes ahead at the deadline, and the late answer cannot erase it", async () => {
    vi.useFakeTimers();
    const { get, posted } = server();
    await show("a-piece");
    act(() => {
      void latest!.create(NEW);
    });
    await settle();
    expect(posted).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPENING_READ_DEADLINE_MS + 5);
    });
    await settle();
    expect(posted).toHaveLength(1);
    expect(bodies()).toEqual([NEW.body]);

    get.release(json({ comments: [OLD] }));
    await settle();
    expect(bodies(), "the abandoned read erased the comment").toEqual([NEW.body]);
  });

  it("holds under StrictMode too", async () => {
    const { get, posted } = server();
    await show("a-piece", true);
    act(() => {
      void latest!.create(NEW);
    });
    await settle();
    expect(posted).toHaveLength(0);
    get.release(json({ comments: [OLD] }));
    await settle();
    expect(posted).toHaveLength(1);
    expect(bodies()).toEqual([OLD.body, NEW.body]);
  });

  it("is still sent when the hook unmounts while it is held", async () => {
    const { posted } = server();
    await show("a-piece");
    let result: Comment | null | undefined;
    act(() => {
      void latest!.create(NEW).then((c) => {
        result = c;
      });
    });
    await settle();
    expect(posted).toHaveLength(0);

    await show(null);
    await settle();
    expect(posted, "the reader's words never left the tab").toHaveLength(1);
    expect(posted[0]!.url).toContain("/api/comments/a-piece");
    expect(result?.id).toBe(NEW.id);
  });

  it("is sent to the article it was made on, and not drawn on the next one, when the article changes", async () => {
    const { get, posted } = server();
    await show("a-piece");
    act(() => {
      void latest!.create(NEW);
    });
    await settle();

    await show("another-piece");
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toContain("/api/comments/a-piece");
    get.release(json({ comments: [] }));
    await settle();
    expect(bodies(), "a comment on the last article was drawn on this one").toEqual([]);
  });

  it("finishes a queued edit on the old article without replacing a same-id row on the new one", async () => {
    const oldGet = held();
    const newGet = held();
    const post = held();
    const patch = held();
    const writes: { url: string; method: string }[] = [];
    answer = (url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return url.includes("another-piece") ? newGet.promise : oldGet.promise;
      writes.push({ url, method });
      return method === "POST" ? post.promise : patch.promise;
    };

    await show("a-piece");
    let edited = false;
    act(() => {
      void latest!.create(NEW);
      void latest!.edit(NEW.id, "edited on the old article").then(() => {
        edited = true;
      });
    });
    await show("another-piece");
    await settle();
    expect(writes).toEqual([{ url: "/api/comments/a-piece", method: "POST" }]);

    const onNewArticle: Comment = {
      ...OLD,
      id: NEW.id,
      body: "the unrelated same-id row on the new article",
    };
    newGet.release(json({ comments: [onNewArticle] }));
    post.release(json({ comment: { ...NEW, createdAt: OLD.createdAt, status: "none" } }));
    await settle();
    expect(writes).toEqual([
      { url: "/api/comments/a-piece", method: "POST" },
      { url: `/api/comments/a-piece/${NEW.id}`, method: "PATCH" },
    ]);
    expect(bodies()).toEqual([onNewArticle.body]);

    patch.release(
      json({
        comment: {
          ...NEW,
          body: "edited on the old article",
          createdAt: OLD.createdAt,
          status: "none",
        },
      }),
    );
    await settle();
    expect(edited, "the queued caller was left waiting after the slug changed").toBe(true);
    expect(bodies(), "the old PATCH answer replaced a same-id row on the new article").toEqual([
      onNewArticle.body,
    ]);
  });

  it("puts an edit of that id after the held create, not in front of it", async () => {
    const get = held();
    const writes: string[] = [];
    answer = (_url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return get.promise;
      writes.push(method);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Promise.resolve(
        json({
          comment: {
            ...NEW,
            ...body,
            createdAt: "2026-10-03T19:42:00.000Z",
            status: "none",
          },
        }),
      );
    };

    await show("a-piece");
    act(() => {
      void latest!.create(NEW);
      void latest!.edit(NEW.id, "edited after creating");
    });
    await settle();
    expect(writes, "the PATCH overtook the create held behind the GET").toEqual([]);

    get.release(json({ comments: [OLD] }));
    await settle();
    expect(writes).toEqual(["POST", "PATCH"]);
    expect(bodies()).toContain("edited after creating");
  });

  it("cancels a held create deleted before it has become a row", async () => {
    const { get, posted } = server();
    const deleted: string[] = [];
    const prior = answer;
    answer = async (url, init) => {
      if ((init.method ?? "GET").toUpperCase() === "DELETE") {
        deleted.push(url);
        return new Response(null, { status: 204 });
      }
      return prior(url, init);
    };

    await show("a-piece");
    act(() => {
      void latest!.create(NEW);
      latest!.remove(NEW.id);
    });
    await settle();
    expect(deleted, "DELETE was sent before the held POST could create a row").toEqual([]);

    get.release(json({ comments: [OLD] }));
    await settle();
    expect(posted, "a create the reader already deleted was still sent").toEqual([]);
    expect(deleted).toEqual([]);
    expect(bodies()).toEqual([OLD.body]);
  });

  it("lets a later create reuse the id after the cancelled held create has settled", async () => {
    const { get, posted } = server();
    await show("a-piece");

    let cancelled: Comment | null | undefined;
    act(() => {
      void latest!.create(NEW).then((comment) => {
        cancelled = comment;
      });
      latest!.remove(NEW.id);
    });
    get.release(json({ comments: [OLD] }));
    await settle();
    expect(cancelled, "the cancelled caller was left waiting").toBeNull();
    expect(posted).toEqual([]);

    let retried: Comment | null | undefined;
    act(() => {
      void latest!.create(NEW).then((comment) => {
        retried = comment;
      });
    });
    await settle();
    expect(posted, "the old tombstone cancelled a later use of the same id").toHaveLength(1);
    expect(retried?.id).toBe(NEW.id);
    expect(bodies()).toEqual([OLD.body, NEW.body]);
  });

  it("settles every queued patch without sending it when delete cancels the held create", async () => {
    const get = held();
    const writes: string[] = [];
    answer = (_url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return get.promise;
      writes.push(method);
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await show("a-piece");

    let settled = 0;
    act(() => {
      void latest!.create(NEW).then(() => settled++);
      void latest!.edit(NEW.id, "edited").then(() => settled++);
      void latest!.recolour(NEW.id, "pink").then(() => settled++);
      void latest!.place(NEW.id, { criterionId: "spya-crw001", valence: -40 }).then(() => settled++);
      latest!.remove(NEW.id);
    });
    get.release(json({ comments: [OLD] }));
    await settle();

    expect(settled, "one of the cancelled callers was left waiting").toBe(4);
    expect(writes, "a queued write ran after its create was cancelled").toEqual([]);
    expect(bodies()).toEqual([OLD.body]);
  });
});

describe("once the read has settled", () => {
  it("draws the row in the same turn, as it always has", async () => {
    const { get, posted } = server();
    await show("a-piece");
    get.release(json({ comments: [OLD] }));
    await settle();

    act(() => {
      void latest!.create(NEW);
    });
    /* No settle: the optimistic row and the request are synchronous once the
       list is in, which is what lets a mark appear on mouse-up. */
    expect(bodies()).toEqual([OLD.body, NEW.body]);
    expect(posted).toHaveLength(1);
  });

  it("keeps delete ahead of an in-flight create response", async () => {
    const get = held();
    const post = held();
    const writes: string[] = [];
    answer = (_url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return get.promise;
      writes.push(method);
      if (method === "POST") return post.promise;
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await show("a-piece");
    get.release(json({ comments: [] }));
    await settle();

    act(() => {
      void latest!.create(NEW);
    });
    expect(bodies()).toEqual([NEW.body]);
    act(() => latest!.remove(NEW.id));
    expect(bodies()).toEqual([]);
    expect(writes, "DELETE raced in front of the POST response").toEqual(["POST"]);

    post.release(
      json({ comment: { ...NEW, createdAt: "2026-10-03T19:42:00.000Z", status: "none" } }),
    );
    await settle();
    expect(writes).toEqual(["POST", "DELETE"]);
    expect(bodies(), "the late create answer resurrected the deleted row").toEqual([]);
  });

  it("re-deletes after an in-flight create may have landed but its response was lost", async () => {
    const get = held();
    const post = held();
    const writes: string[] = [];
    let posts = 0;
    answer = (_url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return get.promise;
      writes.push(method);
      if (method === "POST") {
        posts++;
        return posts === 1
          ? post.promise
          : Promise.resolve(
              json({ comment: { ...NEW, createdAt: OLD.createdAt, status: "none" } }),
            );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await show("a-piece");
    get.release(json({ comments: [] }));
    await settle();

    let result: Comment | null | undefined;
    act(() => {
      void latest!.create(NEW).then((comment) => {
        result = comment;
      });
      latest!.remove(NEW.id);
    });
    post.fail(new TypeError("the response was lost after the request left"));
    await settle();

    expect(result, "the deleted create's caller was left waiting").toBeNull();
    expect(writes, "an ambiguously completed POST was not followed by DELETE").toEqual([
      "POST",
      "POST",
      "DELETE",
    ]);
    expect(bodies()).toEqual([]);
  });

  it("does not delete a different same-id row when an ambiguous create proves to be a collision", async () => {
    const get = held();
    const post = held();
    const writes: string[] = [];
    let posts = 0;
    answer = (_url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET") return get.promise;
      writes.push(method);
      if (method === "POST") {
        posts++;
        return posts === 1
          ? post.promise
          : Promise.resolve(json({ error: "That comment id is already in use." }, 409));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    await show("a-piece");
    get.release(json({ comments: [] }));
    await settle();

    act(() => {
      void latest!.create(NEW);
      latest!.remove(NEW.id);
    });
    post.fail(new TypeError("the collision response was lost"));
    await settle();

    expect(writes, "the collision row was deleted without proving the create owned it").toEqual([
      "POST",
      "POST",
    ]);
    expect(bodies()).toEqual([]);
  });
});

describe("createOnLeave: the page is going away", () => {
  it("starts the keepalive write at once, with the body create would send, and waits for nothing", async () => {
    const { posted } = server();
    await show("a-piece");
    expect(latest?.loaded).toBe(false);

    latest!.createOnLeave(NEW);
    expect(left).toHaveLength(1);
    expect(left[0]!.url).toBe("/api/comments/a-piece");
    expect(left[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(left[0]!.init.body))).toEqual(NEW);
    expect(posted, "it also went out the ordinary way").toHaveLength(0);
  });
});
