// @vitest-environment jsdom
/**
 * **The band shows the list it already has, instead of asking again in front of
 * the reader.**
 *
 * `useGlossaryRead` runs for every reader of every article, because the dotted
 * underlines in the prose are a standing property of the article
 * (src/web/App.tsx § `Reader`). `useGlossary` runs when the band is opened, and
 * until 2026-08-27 it fetched the identical URL again from `status: "loading"`,
 * with nothing shared between the two — so the panel said *"Looking for a
 * glossary…"* while the list it was looking for was already on screen,
 * underlined, in the prose behind it.
 *
 * On the Postgres store that second request is not cheap. It reads most of the
 * article out of the database to compute one boolean — see
 * docs/plans/260827am-glossary-read-latency.md for the measurements.
 *
 * **The invariant is not "one request for the page's lifetime".** The band still
 * revalidates when it mounts, and it must: `useJobs` treats its first poll as a
 * baseline and does not announce a job that had already finished, so a glossary
 * written in another tab while the band was closed has nothing else to bring it
 * in. A GPT Sol review of the plan found that, and the last test here is the
 * scenario it described. What the band must never do is *wait* — the
 * revalidation happens behind the list already on screen.
 *
 * So there are three separate claims, and they need three different shapes of
 * test: no visible loading state (assert the render, with replies held); no
 * duplicate of a request already in flight (count); and a stale list still gets
 * replaced (drive the job).
 *
 * This is written against the hooks rather than against `Reader`, deliberately
 * — mounting the reading view drags in nuqs, Supabase and the layout — but that
 * is also this test's blind spot, and `tests/glossary-band-wiring.test.ts`
 * beside it is what covers the wiring the hooks cannot see.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryResponse } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";

/* React only permits `act` when the environment says it is a test one. Without
   this every render below still runs, and warns, and the effects it is meant to
   flush may not have — a green test over work that never happened. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every `/api/` request this test's render made, in order. */
const asked: string[] = [];
/** Whether the next reply is a dead network rather than an answer. */
let fails = false;
/** What `POST …/lookup` answers with. Set by the test that cares. */
let staleLookupEntry: unknown = null;

/**
 * Replies are **held** until a test lets them go.
 *
 * The first draft resolved immediately, and its "no loading state" assertion
 * passed on the broken code: the second request was made, `status` went to
 * `loading`, and it came back inside the same `act` — so the flash was real and
 * invisible. A test that cannot see the thing it is about is the shape
 * docs/reusable/silent-success.md is about. Holding the reply makes the wait
 * observable, which is the only way to tell "did not wait" from "waited
 * quickly".
 */
const held: Array<() => void> = [];

/**
 * Release **newest first**, which is the order that hurts.
 *
 * Answering in the order the requests were issued makes the newest reply land
 * last, so the right list ends up on screen whether or not anything is guarding
 * the sequence — and the slug-switch test below passed with the generation
 * counter deleted. Reversing it puts the *stale* reply last, which is the race
 * the counter exists for and the only order in which the test can tell the two
 * states apart.
 */
function releaseAll(): void {
  const waiting = held.splice(0).reverse();
  for (const go of waiting) go();
}

/** The list the server would return, which a test may add to mid-run. */
const entries: Array<{ id: string; name: string; kind: string; aliases: string[] }> = [];

/**
 * **Each article's terms say which article they came from.**
 *
 * The first draft returned the same list for every slug, so the slug-switch
 * test below could not tell a dropped reply from a landed one — it passed with
 * the generation guard deleted. A test that cannot distinguish the two states
 * it is named after is the shape docs/reusable/silent-success.md is about.
 */
function response(slug: string): GlossaryResponse {
  const mine =
    slug === "constitution" ? entries : [{ id: "x1", name: "other", kind: "concept", aliases: [] }];
  return {
    glossary: { version: 1, model: "test", sourceHash: "abc", profileHash: null, entries: mine },
    stale: false,
    outdated: false,
    profileChanged: false,
  } as unknown as GlossaryResponse;
}

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string) => {
      asked.push(input);
      /* **The body is decided when the request arrives, not when it is answered.**
         That is what a server does — it reads the database at the moment it is
         asked — and getting it wrong made two of the tests below tautologies:
         a request issued before a change was answered with the state *after* it,
         so joining a stale request and running a fresh one were indistinguishable
         and both passed. Snapshot here, hold, then reply. */
      if (input.endsWith("/lookup")) {
        /* What `lookUpTerm` returns: the entry **as it was before** the model call
           it just spent thirty seconds on, with the answer attached
           (src/term-lookup.ts). The stale name is the point of the fixture. */
        return new Response(JSON.stringify({ entry: staleLookupEntry }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.stringify(response(input.split("/").pop() ?? ""));
      const dead = fails;
      await new Promise<void>((go) => held.push(go));
      if (dead) throw new TypeError("Failed to fetch");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    /* **A whole-module mock, so anything `useGlossary` imports and this omits is
       `undefined` at the moment it is called** — which TypeScript cannot see
       through a `vi.mock` factory, and no test here reaches. `reset()` calls
       `fetchOk`; nothing below presses reset, so leaving it out would have been a
       landmine set for whoever writes that test.
       `tests/refused-writes-are-reported.test.tsx` is the one that exercises the
       real `fetchOk`, and it mocks none of this module for that reason. */
    fetchOk: async (input: string) => {
      const res = await api.apiFetch(input);
      if (!res.ok) throw new Error(String(res.status));
      return res;
    },
  };
  return api;
});

/**
 * The job poller, posed by the test rather than polling.
 *
 * It was mocked to *never* finish a job, which meant the `onFinished` seam —
 * the one the band's freshness depends on — was not exercised at all. GPT Sol's
 * fifth finding on the built code. `finishJob()` below is what a completed
 * glossary run looks like arriving.
 */
let onFinished: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null =
  null;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (cb?: (job: never) => void) => {
    onFinished = (cb ?? null) as typeof onFinished;
    return {
      jobs: [],
      loaded: true,
      error: null,
      /* `lastFailure` is the durable half of `error` — see src/web/useJobs.ts.
         Nothing here presses a button that can fail, but a whole-module mock
         that omits a field leaves `undefined` at the moment it is called, and
         this file's note above says why that is a landmine rather than a gap. */
      /* Per-job `/advance` failures. Empty, because nothing here has a driver at
         all — but a whole-module mock that omits a field leaves `undefined` where
         `useStepJob` reads it (src/job-state.ts § `driverStalled`), which is the
         landmine this file's siblings already note about `lastFailure`. */
        driverFailures: {},
      lastFailure: () => null,
      run: async () => null,
      cancel: async () => {},
    };
  },
}));

/* Needs a session and a slug; the answer does not affect the count. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { useGlossary, useGlossaryRead } = await import("../src/web/useGlossary.js");

/** What `GlossaryBand` does: the jobs and the verbs, over `Reader`'s read. */
let band: ReturnType<typeof useGlossary> | null = null;

function Band({ slug, read }: { slug: string; read: GlossaryRead }): ReactElement {
  const all = useGlossary(slug, read);
  band = all;
  const { status, glossary, stale, outdated, profileChanged } = all;
  return createElement(
    "aside",
    null,
    `${status}:${glossary?.entries.length ?? 0}:${[stale, outdated, profileChanged].join()}`,
  );
}

/** The live read, so a test can drive `clear()` the way `reset()` does. */
let read: GlossaryRead | null = null;

/** What `Reader` does: one read, always, and the band over it when open. */
function Reading({ slug, open }: { slug: string; open: boolean }): ReactElement {
  read = useGlossaryRead(slug);
  const terms = read.glossary?.entries ?? [];
  return createElement(
    "div",
    null,
    createElement("p", null, terms.map((e) => e.name).join(",") || "none"),
    open ? createElement(Band, { slug, read }) : null,
  );
}

let host: HTMLDivElement;
let root: Root;

/** How many times the glossary itself has been asked for. */
function glossaryAsks(): number {
  return asked.filter((u) => u.startsWith("/api/glossary/")).length;
}

/** A glossary job for this article, landing in the band's poll as finished. */
function finishJob(slug = "constitution"): void {
  onFinished?.({ slug, status: "done", steps: [{ name: "glossary" }] });
}

beforeEach(() => {
  asked.length = 0;
  held.length = 0;
  read = null;
  band = null;
  onFinished = null;
  fails = false;
  staleLookupEntry = null;
  entries.length = 0;
  entries.push({ id: "t1", name: "reticulation", kind: "concept", aliases: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Render, and let the effects run — but do not answer anything yet. */
async function render(el: ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

/** Answer every request now in flight, and let the renders it causes finish. */
async function settle(): Promise<void> {
  await act(async () => {
    releaseAll();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("opening the glossary band", () => {
  it("shows the list it already has, without waiting", async () => {
    await render(createElement(Reading, { slug: "constitution", open: false }));
    await settle();
    expect(host.querySelector("p")?.textContent).toBe("reticulation");

    /* Opened, and nothing released. Every request the band could have made is
       still unanswered at this point, so a list on screen here is a list it
       already had. On the two-fetch version this read `loading:0:false,...`,
       which is the reported bug: "Looking for a glossary…" over a glossary.

       The three flags are asserted too, not just the count. A seed carrying
       entries without them would render a stale list as a fresh one, and
       "no loading message" alone also passes with an empty list or no panel. */
    await render(createElement(Reading, { slug: "constitution", open: true }));
    expect(host.querySelector("aside")?.textContent).toBe("ready:1:false,false,false");
  });

  it("does not duplicate a request that is already in flight", async () => {
    /* Opened before the opening GET has been answered — the case that happens
       for real whenever the reader lands on `?mode=glossary`. */
    await render(createElement(Reading, { slug: "constitution", open: true }));
    expect(glossaryAsks()).toBe(1);
    await settle();
    expect(glossaryAsks()).toBe(1);
  });

  it("still picks up a glossary written while it was closed", async () => {
    await render(createElement(Reading, { slug: "constitution", open: false }));
    await settle();
    expect(host.querySelector("p")?.textContent).toBe("reticulation");

    /* Another tab finished the job. Nothing in this tab will announce it: the
       band's first `useJobs` poll deliberately treats an already-`done` job as
       baseline rather than as news. The mount revalidate is the only thing that
       can bring it in — so if a future change deletes that fetch to make the
       count test above read 1, this goes red. */
    entries.push({ id: "t2", name: "anastomosis", kind: "concept", aliases: [] });

    await render(createElement(Reading, { slug: "constitution", open: true }));
    await settle();
    expect(host.querySelector("aside")?.textContent).toBe("ready:2:false,false,false");
    expect(host.querySelector("p")?.textContent).toBe("reticulation,anastomosis");
  });
});

describe("a reply that arrives too late", () => {
  it("does not undo a reset that happened while it was in flight", async () => {
    await render(createElement(Reading, { slug: "constitution", open: true }));
    // One GET outstanding, unanswered.
    expect(glossaryAsks()).toBe(1);

    /* The reader presses "start over" before that reply lands. `clear()` bumps
       the generation, so the older reply is news about a list that no longer
       exists and must be dropped — `live` cannot see this, because the slug
       never changed. That is the bug the generation counter replaced the
       `pushed` ref for.

       NOTE: the DELETE is not exercised here and would not describe production
       if it were — `deleteGlossary` answers 501 under `postgres` on purpose
       (src/store/index.ts). This is about ordering, not about the button. */
    await act(async () => {
      read?.clear();
    });
    expect(host.querySelector("aside")?.textContent).toBe("none:0:false,false,false");

    await settle();
    expect(host.querySelector("aside")?.textContent).toBe("none:0:false,false,false");
  });

  it("does not underline the previous article after switching", async () => {
    await render(createElement(Reading, { slug: "constitution", open: false }));
    // The first article's reply is still outstanding when the reader moves on.
    await render(createElement(Reading, { slug: "ball-lightning", open: false }));
    await settle();
    /* Both replies are released together. The one on screen is ball-lightning,
       so its terms must be the ones underlined — the constitution's reply is
       news about an article the reader has left. Naming the term is the point:
       counting them cannot tell the two apart. */
    expect(host.querySelector("p")?.textContent).toBe("other");
  });
});

describe("a list that changes while we are reading it", () => {
  it("does not miss a job that finished while a request was in flight", async () => {
    await render(createElement(Reading, { slug: "constitution", open: true }));
    await settle();
    expect(host.querySelector("aside")?.textContent).toBe("ready:1:false,false,false");

    /* The sequence GPT Sol found. A GET goes out and reads the glossary as it
       stands; the job finishes and writes a new one; `onFinished` fires. If
       that reload merely *joins* the request already out, it is answered with
       the pre-job list — and `useJobs` has already announced the job, so
       nothing ever asks again and the new terms never appear.

       Provoked by opening a second read before the job lands. */
    void read?.reload();
    entries.push({ id: "t2", name: "anastomosis", kind: "concept", aliases: [] });
    finishJob();

    await settle();
    await settle();
    expect(host.querySelector("aside")?.textContent).toBe("ready:2:false,false,false");
  });

  it("keeps the checked term when a read was already in flight", async () => {
    await render(createElement(Reading, { slug: "constitution", open: true }));
    await settle();

    /* A read is out — started before the lookup was stored, so its answer will
       not contain it. The patch has to survive, and the way it survives is a
       trailing read after that one lands, by which time the server has it. */
    void read?.reload();
    read?.patchEntry("t1", {
      answer: "a net",
      citations: [],
      searches: 1,
      model: "m",
      at: "now",
    } as never);
    /* And the server now has it, which is what makes the trailing read the fix
       rather than a hope. */
    entries[0] = {
      ...entries[0]!,
      lookup: { answer: "a net", citations: [], searches: 1, model: "m", at: "now" },
    } as never;

    await settle();
    await settle();
    expect(read?.glossary?.entries[0]).toHaveProperty("lookup");
  });

  it("keeps the list when a background revalidation fails", async () => {
    await render(createElement(Reading, { slug: "constitution", open: false }));
    await settle();
    expect(host.querySelector("p")?.textContent).toBe("reticulation");

    /* The network dies, and the band opens and revalidates. The panel renders
       entries only when `status` is `ready`, so an unconditional `error` here
       took a perfectly good list off the screen — the opposite of revalidating
       behind it. The message is still reported; the list stays. */
    fails = true;
    await render(createElement(Reading, { slug: "constitution", open: true }));
    await settle();
    expect(read?.status).toBe("ready");
    expect(read?.error).toContain("Failed to fetch");
    expect(host.querySelector("p")?.textContent).toBe("reticulation");
  });

  it("still reports a failure that leaves us with nothing", async () => {
    /* The other half, so the test above cannot pass by never reporting an error
       at all: the opening read has no list to fall back on. */
    fails = true;
    await render(createElement(Reading, { slug: "constitution", open: false }));
    await settle();
    expect(read?.status).toBe("error");
  });
});

describe("a lookup that answers about a term we have since re-read", () => {
  it("attaches the answer without putting the old entry back", async () => {
    await render(createElement(Reading, { slug: "constitution", open: true }));
    await settle();
    expect(host.querySelector("p")?.textContent).toBe("reticulation");

    /* A job renamed the term while the lookup's model call was running, and the
       refresh has already landed — so nothing is in flight and the trailing
       read cannot save us. `lookUpTerm` captured the entry BEFORE that call and
       returns it with the answer attached (src/term-lookup.ts), so what comes
       back over the wire is a pre-job snapshot. */
    entries[0] = { id: "t1", name: "anastomosis", kind: "concept", aliases: [] };
    /* `void`, not `await`: the reply is held until `settle()` lets it go, so
       awaiting the reload here would deadlock the test rather than fail it. */
    void read?.reload();
    await settle();
    expect(host.querySelector("p")?.textContent).toBe("anastomosis");

    /* **Through `look()`, not `patchEntry`.** The first version of this test
       called `patchEntry` directly, and once that took an id and a lookup
       rather than an entry there was no stale name in the test at all — it
       asserted something the code could no longer get wrong, which is the sixth
       tautology GPT Sol found in this change. Driving the real verb puts the
       stale entry back on the wire, where it comes from. */
    staleLookupEntry = {
      id: "t1",
      name: "reticulation", // the pre-job snapshot
      kind: "concept",
      aliases: [],
      lookup: { answer: "a net", citations: [], searches: 1, model: "m", at: "now" },
    };
    await act(async () => {
      const done = band?.look("t1");
      releaseAll();
      await done;
    });

    /* The answer arrives; the name does not go backwards. */
    expect(read?.glossary?.entries[0]).toHaveProperty("lookup");
    expect(read?.glossary?.entries[0]?.name).toBe("anastomosis");
    expect(host.querySelector("p")?.textContent).toBe("anastomosis");
  });
});
