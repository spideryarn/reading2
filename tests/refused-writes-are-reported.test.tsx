// @vitest-environment jsdom
/**
 * **A write the server refused must not look like one that worked.**
 *
 * Six call sites across four surfaces send a DELETE, a POST or a PATCH whose
 * body nobody reads, and every one of them once shipped — or nearly shipped —
 * the same defect: the response was never looked at, so a 500 took the row off
 * the reader's screen and said nothing, and they found it back after a reload.
 * The comment above each of them says so. What none of them had was a test, and
 * that is what let the same omission happen twice in two hooks.
 *
 * `fetchOk` (src/web/lib/api.ts) is the check made unforgettable. This file is
 * the measure of it taken from outside: it drives each surface through a real
 * `apiFetch` and a real `fetchOk` against a stubbed **global `fetch`**, so the
 * thing under test is the code that actually runs rather than a stand-in for
 * it.
 *
 * **`lib/api.js` is deliberately not mocked**, and that is the whole design of
 * this file. Two neighbouring tests replace `apiFetch` through `vi.mock`
 * (`use-comments-load-state`, `glossary-one-fetch`), which is right for what
 * they are about and useless here: `fetchOk` calls `apiFetch` *inside* the
 * module, so a mocked `apiFetch` never reaches it, and a mocked `fetchOk` would
 * be the test asserting against its own fake. Only `lib/supabase.js` is stood
 * in for — it is a network client and an access token is not what any of this
 * is about.
 *
 * The control: break `fetchOk` so it returns the refused response instead of
 * throwing, and every test below goes red naming the message it expected. With
 * the check in place and this file absent, 207 tests across the fifteen files
 * that touch these hooks all passed against that same break — which is what
 * "there is no test on the error path" looks like from the inside.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment, LibraryEntry } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";
import type { Shelf } from "../src/web/ShelfEntry.js";

/**
 * The auth client, and nothing else from `lib/`.
 *
 * `apiFetch` asks for an access token before every request; the real client
 * would reach for `localStorage` and the network, and `apiFetch`'s own 1.5s
 * deadline would then be paid once per request here. Resolving to no session is
 * exactly what an anonymous request does, and `apiFetch` handles it — the
 * server's answer is what these tests are about.
 */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      refreshSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

/* The job poller and the reader profile, posed rather than run. `useGlossary`
   needs both to mount, and neither has anything to do with a refused DELETE —
   except `run`, which is the thing a refused reset must NOT reach. */
const ran: boolean[] = [];
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    /* The durable half of `error` — src/web/useJobs.ts § `lastFailure`. Reached
       only if a run fails, which is what a refused reset must never get to. */
    /* Per-job `/advance` failures. Empty, because nothing here has a driver at
       all — but a whole-module mock that omits a field leaves `undefined` where
       `useStepJob` reads it (src/job-state.ts § `driverStalled`), which is the
       landmine this file's siblings already note about `lastFailure`. */
    driverFailures: {},
    lastFailure: () => null,
    run: async (_slug: string, _steps: string[], force?: boolean) => {
      ran.push(force ?? false);
      return null;
    },
    cancel: async () => {},
  }),
}));
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { useComments } = await import("../src/web/useComments.js");
const { useSearch } = await import("../src/web/useSearch.js");
const { useGlossary } = await import("../src/web/useGlossary.js");
const { Actions } = await import("../src/web/ShelfEntry.js");

/* ------------------------------------------------------------- the server --- */

/**
 * What the stubbed `fetch` answers, decided per request.
 *
 * A **real `Response`**, never a hand-built `{ ok, text }`. `failure` reads the
 * status, the body and the `content-type` header, so a flat object would either
 * throw inside the code under test or agree with it by accident — and a fake
 * that cannot express the failure is the shape docs/reusable/silent-success.md
 * is about. Two neighbouring test files build `{ ok: true, text }` literals;
 * that works for `readJson` and would not work here.
 */
function refused(): Response {
  return new Response(JSON.stringify({ error: "The store would not take that. [store-no]" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A refusal whose body dies while it is being read — a connection cut after the
 * headers arrived, a proxy giving up mid-response.
 *
 * A real `Response` over an errored stream, so `text()` rejects the way it
 * really does. This is the only shape that tells `failure` and `readJson` apart.
 */
function tornRefusal(): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        c.error(new TypeError("terminated"));
      },
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

function fine(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Which methods the server refuses this test. Everything else succeeds. */
let refusing = new Set<string>();
/** Whether the refusal's body dies mid-read. Set by the one test about it. */
let torn = false;
/** What a GET answers with, per path fragment. */
let reads: Record<string, unknown> = {};
/** Every write the stub was asked to make, so a test can prove one was sent. */
let sent: { method: string; url: string }[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  refusing = new Set();
  torn = false;
  sent = [];
  ran.length = 0;
  reads = {
    "/api/comments/": { comments: [] },
    "/api/search/": { runs: [] },
    "/api/glossary/": {
      glossary: { version: 1, model: "t", sourceHash: "abc", profileHash: null, entries: [] },
      stale: false,
      outdated: false,
      profileChanged: false,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        const key = Object.keys(reads).find((k) => url.startsWith(k));
        return Promise.resolve(fine(key ? reads[key] : {}));
      }
      sent.push({ method, url });
      if (torn) return Promise.resolve(tornRefusal());
      if (refusing.has(method)) return Promise.resolve(refused());
      return Promise.resolve(fine({ comment: STORED, entry: {} }));
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------- the mount --- */

let container: HTMLDivElement;
let root: Root;

/** Let the fetch chain and the state it sets actually settle. */
async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const STORED: Comment = {
  id: "cmt-1",
  blockId: "spya-k3m9qt",
  quote: "the sentence he asked about",
  start: 0,
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "done",
  answer: "Because of the thing in the paragraph before.",
};

/** One saved search on the shelf, so a refused DELETE has something to remove. */
const SAVED = {
  id: "run-1",
  criterion: "where he hedges",
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "done" as const,
  hits: [],
  stale: false,
};

/** The one sentence the server sent, as the reader should end up seeing it. */
const SAID = "The store would not take that. [store-no]";

/* ---------------------------------------------------------------- comments --- */

describe("useComments, when the server refuses the write", () => {
  let api: ReturnType<typeof useComments> | undefined;
  function Harness() {
    api = useComments("a-slug");
    return null;
  }
  async function mount(): Promise<void> {
    await act(async () => root.render(createElement(Harness)));
    await settle();
  }

  /**
   * **What this proves, and what it does not.** An earlier version of this test
   * was called "instead of letting the row look deleted" and started from an
   * empty list, so it could not have seen a row look deleted either way — GPT
   * Sol, 2026-08-28. It is seeded now, and the assertion says what actually
   * happens: `remove` takes the row off the screen straight away and **does not
   * put it back** when the server refuses. That asymmetry with `create` below,
   * which does roll back, is pinned here rather than described, because the next
   * person to read `useComments.ts § remove` should find out from a test whether
   * it is deliberate.
   *
   * What `fetchOk` guarantees is the other half: the reader is *told*. Before
   * it, a 500 took the row away in silence and they found it back after a
   * reload.
   */
  it("tells the reader when a DELETE is refused, though the row stays gone", async () => {
    reads["/api/comments/"] = { comments: [STORED] };
    await mount();
    expect(api?.comments, "the seed did not arrive, so this test proves nothing").toHaveLength(1);
    refusing.add("DELETE");

    await act(async () => api?.remove("cmt-1"));
    await settle();

    expect(sent.map((s) => s.method)).toContain("DELETE");
    expect(api?.error).toBe(SAID);
    /* Optimistic and not rolled back. See the note above. */
    expect(api?.comments).toHaveLength(0);
  });

  it("puts the reader's comment back when the POST is refused, and says why", async () => {
    await mount();
    refusing.add("POST");

    await act(async () => {
      await api?.create({ id: "cmt-new", blockId: "spya-k3m9qt", quote: "a passage", start: 0 });
    });
    await settle();

    expect(sent.map((s) => s.method)).toContain("POST");
    expect(api?.error).toBe(SAID);
    /* The optimistic row is rolled back, so the mark over the passage goes with
       it rather than standing there over a comment the server never took. */
    expect(api?.comments).toHaveLength(0);
  });

  /**
   * **The one thing `fetchOk` does here that `readJson` would not.**
   *
   * `create` and `edit` read the body afterwards, so `readJson` already refuses
   * a 500 — which means the two tests above pass with `fetchOk`'s check deleted,
   * and on their own they would be an argument for deleting it. This is the case
   * that separates them. `failure` reads the body with a `.catch`; `readJson`
   * does not. So a 500 whose connection is cut after the headers arrived reaches
   * the reader as its status through one and as a `TypeError` through the other
   * — and `describeFetchFailure` turns any `TypeError` into *"Couldn't reach the
   * dev server"*, which is both false and unactionable for somebody on a
   * production page whose server answered perfectly well.
   */
  it("keeps the status when a refused reply's body dies mid-read", async () => {
    await mount();
    torn = true;

    await act(async () => {
      await api?.create({ id: "cmt-new", blockId: "spya-k3m9qt", quote: "a passage", start: 0 });
    });
    await settle();

    expect(api?.error).toBe(
      "Request failed (500) — the server's reply wasn't JSON, so the browser console has more.",
    );
  });

  it("says so when an edit is refused, rather than showing the new words", async () => {
    reads["/api/comments/"] = { comments: [STORED] };
    await mount();
    expect(api?.comments).toHaveLength(1);
    refusing.add("PATCH");

    await act(async () => {
      await api?.edit("cmt-1", "words the server will not take");
    });
    await settle();

    expect(sent.map((s) => s.method)).toContain("PATCH");
    expect(api?.error).toBe(SAID);
    /* The stored row is untouched — the reader is told the edit did not land,
       and what is on screen is still what is in the store. */
    expect(api?.comments[0]?.body).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ search --- */

describe("useSearch, when the server refuses the write", () => {
  let api: ReturnType<typeof useSearch> | undefined;
  function Harness() {
    api = useSearch("a-slug");
    return null;
  }
  async function mount(): Promise<void> {
    await act(async () => root.render(createElement(Harness)));
    await settle();
  }

  /** Same shape as `useComments § remove`, same seed, same asymmetry — read the note there. */
  it("tells the reader when a DELETE is refused, though the run stays gone", async () => {
    reads["/api/search/"] = { runs: [SAVED] };
    await mount();
    expect(api?.runs, "the seed did not arrive, so this test proves nothing").toHaveLength(1);
    refusing.add("DELETE");

    await act(async () => api?.remove("run-1"));
    await settle();

    expect(sent.map((s) => s.method)).toContain("DELETE");
    expect(api?.error).toBe(SAID);
    expect(api?.runs).toHaveLength(0);
  });

  it("says so when a colour PATCH is refused, instead of letting the swatch stand", async () => {
    await mount();
    refusing.add("PATCH");

    await act(async () => api?.recolour("run-1", 3));
    await settle();

    expect(sent.map((s) => s.method)).toContain("PATCH");
    expect(api?.error).toBe(SAID);
  });
});

/* ---------------------------------------------------------------- glossary --- */

describe("useGlossary, when the reset DELETE is refused", () => {
  let api: ReturnType<typeof useGlossary> | undefined;
  /* What `Reader` hands the band. Posed rather than run: `useGlossaryRead` is
     the *read* half and none of it is what a refused DELETE is about. */
  const read: GlossaryRead = {
    status: "none",
    glossary: null,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    error: null,
    reload: async () => {},
    refresh: async () => {},
    clear: () => {},
    patchEntry: () => {},
  };

  function Harness() {
    api = useGlossary("a-slug", read);
    return null;
  }

  it("tells the reader, and does not go on to run the step", async () => {
    await act(async () => root.render(createElement(Harness)));
    await settle();
    refusing.add("DELETE");

    await act(async () => {
      await api?.reset();
    });
    await settle();

    expect(sent.map((s) => s.method)).toContain("DELETE");
    /* `error` is `resetFailed ?? error` — the band has one line for both, and
       the refused DELETE is the one the reader needs. */
    expect(api?.error).toBe(SAID);
    /* **The load-bearing half.** Forcing the step *appends* to the list the
       reader just asked to be rid of, so a refused DELETE that fell through to
       `run` would leave them with more terms than they started with — the exact
       opposite of what they pressed. useGlossary.ts § `reset`. */
    expect(ran).toEqual([]);
  });
});

/* ------------------------------------------------------- the shelf's rerun --- */

describe("the shelf's rebuild button, when the queue refuses the job", () => {
  it("reports it, rather than going quiet as though the job were queued", async () => {
    const reported: string[] = [];
    const shelf = { report: (m: string) => reported.push(m) } as unknown as Shelf;
    /* `url` is load-bearing on the fixture, not decoration: the button is drawn
       only for an article that came from a page, because there is nothing to
       re-fetch for one that came from a PDF. Without it this test would look for
       a control that is correctly absent. */
    const entry = {
      slug: "a-slug",
      title: "A piece",
      url: "https://example.com/a-piece",
    } as unknown as LibraryEntry;

    await act(async () => {
      root.render(createElement(Actions, { entry, shelf, onEdit: () => {} }));
    });
    refusing.add("POST");

    const rebuild = [...container.querySelectorAll("button")].find((b) =>
      /Re-fetch and rebuild/i.test(`${b.title} ${b.getAttribute("aria-label") ?? ""}`),
    );
    expect(rebuild, "the rebuild button is on the card").toBeTruthy();

    await act(async () => rebuild?.click());
    await settle();

    expect(sent.map((s) => s.method)).toContain("POST");
    expect(reported).toEqual([`Couldn't queue a rebuild: ${SAID}`]);
  });
});
