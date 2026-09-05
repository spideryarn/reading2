/**
 * Which of two answers to the same question the cache keeps — with both halves
 * of the seam real.
 *
 * ## Why this file mocks neither side, when its neighbour mocks one on purpose
 *
 * api-fetch-offline.test.ts mocks the offline store because what it tests is
 * the order of operations inside `apiFetch`, and its own docstring says the two
 * halves are deliberately never exercised together: *"that test would fail for
 * two unrelated reasons and tell you neither"*. That rule is right, and this
 * file is its one exception, for the reason that makes an exception legitimate:
 * **the defect under test is the seam itself.** `apiFetch` decides *when* a
 * response is written and the store decides *whether* to keep it, and the bug is
 * that neither of them carries the one fact that would let the second decide —
 * when the request went out. Mock either half and the test asserts the
 * assumption the code already makes, which is exactly the shape of check that
 * agrees with the bug. docs/reusable/silent-success.md.
 *
 * So: a real `fake-indexeddb`, the real `offline-store`, the real `apiFetch`,
 * and a `fetch` whose promises this file settles by hand — because the whole
 * subject is completion order being decided independently of issue order, and
 * that is not something a stub of either side can be wrong about.
 *
 * The Supabase client is still mocked. It is not part of the seam; it is a
 * network dependency this file has no business reaching, and the session it
 * hands back is what tells `apiFetch` whose drawer to file under.
 *
 * ## The three cases
 *
 * - **Reverse completion.** Two GETs for one URL; the *second* one issued
 *   answers first, the first answers last. The cache must hold the newer body.
 * - **A GET issued before a mutation.** The read went out, the reader then
 *   deleted the thing, and the read answers afterwards with the world as it was.
 *   It must not refill the cache the delete emptied.
 * - **An empty cache and a newer failure.** The control, and the one that stops
 *   the fix being "never cache anything": a request that fails cannot stop an
 *   earlier successful one from filling an empty cache, in either completion
 *   order.
 *
 * See docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { apiFetch } = await import("../src/web/lib/api.js");
const { writeCached } = await import("../src/web/lib/offline-store.js");

/** The reader every request in this file belongs to. */
const READER = "user-1";

/* ------------------------------------------------------------------------- *
 *  A `fetch` this file settles by hand
 * ------------------------------------------------------------------------- */

interface Sent {
  url: string;
  method: string;
  answer: (res: Response) => void;
  die: (e: unknown) => void;
  /** Bookkeeping for `outgoing` below, so two GETs for one URL are handed out
      in the order they were issued rather than both being the first. */
  used?: boolean;
}

let sent: Sent[] = [];

/** A 200 with a JSON body, which is the only thing `saving` will keep. */
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * The request `apiFetch` made for `url`, once it has actually gone out.
 *
 * Polled rather than assumed: `apiFetch` awaits a session before it sends, so
 * the request exists a few turns after the call.
 */
async function outgoing(url: string, method = "GET"): Promise<Sent> {
  let found: Sent | undefined;
  await vi.waitFor(() => {
    found = sent.find((r) => r.url === url && r.method === method && !r.used);
    expect(found).toBeDefined();
  });
  const request = found as Sent;
  request.used = true;
  return request;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  getSession.mockReset();
  refreshSession.mockReset();
  getSession.mockResolvedValue({
    data: { session: { access_token: "TOKEN", user: { id: READER } } },
  });
  vi.stubGlobal("navigator", { onLine: true });
  sent = [];
  vi.stubGlobal(
    "fetch",
    (url: string, init: RequestInit = {}) =>
      new Promise<Response>((answer, die) => {
        sent.push({ url, method: (init.method ?? "GET").toUpperCase(), answer, die });
      }),
  );

  /* **Open the database through the module, and check that it worked**, before
     anything reaches into it raw. A raw `indexedDB.open` with no version on a
     database that does not exist yet creates an empty one, after which the
     module's own `openDB(…, 1)` sees a current version and never runs its
     upgrade — so there is no object store, every write quietly returns `false`,
     and a suite about which write wins would run entirely against a cache that
     is not there. */
  expect(await writeCached("/api/article/__boot__", { boot: true }, "boot", "__boot__")).toBe(
    true,
  );
  await wipe();
});

/* ------------------------------------------------------------------------- *
 *  Looking at what is actually stored
 * ------------------------------------------------------------------------- */

interface Row {
  key: string;
  userId: string;
  url: string;
  body: unknown;
}

async function rawDb(): Promise<IDBDatabase> {
  return await new Promise((go, no) => {
    const req = indexedDB.open("spideryarn-offline");
    req.onsuccess = () => go(req.result);
    req.onerror = () => no(req.error);
  });
}

async function stored(): Promise<Row[]> {
  const db = await rawDb();
  try {
    return await new Promise<Row[]>((go, no) => {
      const req = db.transaction("responses").objectStore("responses").getAll();
      req.onsuccess = () => go(req.result as Row[]);
      req.onerror = () => no(req.error);
    });
  } finally {
    db.close();
  }
}

/** What we hold for `url`, in this reader's partition, or `undefined`. */
async function held(url: string): Promise<unknown> {
  return (await stored()).find((r) => r.userId === READER && r.url === url)?.body;
}

async function wipe(): Promise<void> {
  const db = await rawDb();
  try {
    await new Promise<void>((go, no) => {
      const req = db.transaction("responses", "readwrite").objectStore("responses").clear();
      req.onsuccess = () => go();
      req.onerror = () => no(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Wait until every save already under way has reached the database.
 *
 * **A negative assertion about an unawaited promise is a test that cannot
 * fail**, and every case here ends in one: *the older body must not be there*,
 * *the invalidated copy must not be back*. Both are true a microsecond after the
 * response arrives, for the uninteresting reason that nothing has happened yet.
 *
 * Two fences rather than a sleep, because the save crosses two different kinds
 * of queue:
 *
 * 1. `saving` reads the cloned body — `res.clone().json()` — which settles on
 *    the promise queue. A handful of macrotask turns is past it.
 * 2. `writeCached` then opens an IndexedDB transaction, and **transactions over
 *    one store commit in the order they were created**. So a write started
 *    *here*, afterwards, cannot commit before one started earlier: when this one
 *    is done, theirs are too. That half is a guarantee, not a guess.
 *
 * The first half is the sleepy one, and what stops it lying is that these tests
 * are red today: the write it is waiting for demonstrably lands inside it.
 */
let fences = 0;
async function savesLanded(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((go) => setTimeout(go, 0));
  await writeCached("/api/article/__fence__", { n: ++fences }, "fence", "__fence__");
}

/* ------------------------------------------------------------------------- *
 *  The cases
 * ------------------------------------------------------------------------- */

describe("two answers to one question, arriving out of order", () => {
  /**
   * **Two GETs for the same URL is an ordinary Tuesday**, not an exotic race: a
   * panel remounts, or the shelf reads while the article's own request is still
   * going. The first one issued is asking an older question. If it answers last
   * it must still lose.
   */
  it("keeps the body of the request that was issued later", async () => {
    const first = apiFetch("/api/article/x");
    const older = await outgoing("/api/article/x");
    const second = apiFetch("/api/article/x");
    const newer = await outgoing("/api/article/x");

    /* The second request issued answers first, and its body is the current one. */
    newer.answer(json({ which: "new" }));
    await second;
    await savesLanded();
    expect(await held("/api/article/x")).toEqual({ which: "new" });

    /* And now the first one finally arrives, carrying the world as it was
       before. It is older, and being slower does not make it fresher. */
    older.answer(json({ which: "old" }));
    await first;
    await savesLanded();

    expect(await held("/api/article/x")).toEqual({ which: "new" });
  });

  /**
   * **A read that went out before the delete cannot bring the deleted thing
   * back.** `saving` empties the cache under a resource whenever a write to it
   * succeeds — that is the whole of how mutable lists stay honest. A GET issued
   * before the write and answered after it describes the world the delete has
   * already left, and refilling the cache with it is indistinguishable, offline,
   * from the delete having failed.
   */
  it("does not let a GET issued before a mutation refill the cache it emptied", async () => {
    /* A copy in hand first, so that the invalidation is something this test can
       watch happen rather than assume. */
    const seed = apiFetch("/api/comments/gibbon");
    (await outgoing("/api/comments/gibbon")).answer(json({ comments: ["before"] }));
    await seed;
    await savesLanded();
    expect(await held("/api/comments/gibbon")).toEqual({ comments: ["before"] });

    /* The read goes out. Nothing has answered it yet. */
    const reading = apiFetch("/api/comments/gibbon");
    const pending = await outgoing("/api/comments/gibbon");

    /* The reader deletes a comment. It succeeds, so our copy of the list is
       wrong and `saving` throws it away. */
    const deleting = apiFetch("/api/comments/gibbon/c-1", { method: "DELETE" });
    (await outgoing("/api/comments/gibbon/c-1", "DELETE")).answer(
      new Response(null, { status: 204 }),
    );
    await deleting;
    await vi.waitFor(async () => expect(await held("/api/comments/gibbon")).toBeUndefined());

    /* And now the earlier read answers, with the comment still in it. */
    pending.answer(json({ comments: ["before"] }));
    await reading;
    await savesLanded();

    expect(await held("/api/comments/gibbon")).toBeUndefined();
  });
});

/**
 * **The control, and it is not decoration.**
 *
 * Every assertion above is satisfied by a cache that never keeps anything, so a
 * fence that simply refuses more than it should would pass all of them. What
 * must go on working is the ordinary case the whole feature exists for: a
 * request that fails has committed nothing, so it cannot stand in the way of an
 * earlier one that succeeded. A failed newer request leaves no mark to compare
 * against.
 */
describe("a request that failed cannot keep an earlier one out of an empty cache", () => {
  it("fills the cache when the older request answers first", async () => {
    const good = apiFetch("/api/article/y");
    const older = await outgoing("/api/article/y");
    const bad = apiFetch("/api/article/y").catch(() => "threw");
    const newer = await outgoing("/api/article/y");

    older.answer(json({ which: "kept" }));
    await good;
    await savesLanded();

    newer.die(new TypeError("Failed to fetch"));
    await bad;
    await savesLanded();

    expect(await held("/api/article/y")).toEqual({ which: "kept" });
  });

  it("fills the cache when the newer request fails first", async () => {
    const good = apiFetch("/api/article/z");
    const older = await outgoing("/api/article/z");
    const bad = apiFetch("/api/article/z").catch(() => "threw");
    const newer = await outgoing("/api/article/z");

    /* Nothing saved yet, so this one falls through to a thrown transport
       error — there is no copy to answer it with. */
    newer.die(new TypeError("Failed to fetch"));
    expect(await bad).toBe("threw");

    older.answer(json({ which: "kept" }));
    await good;
    await savesLanded();

    expect(await held("/api/article/z")).toEqual({ which: "kept" });
  });
});
