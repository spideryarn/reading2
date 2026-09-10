// @vitest-environment jsdom
/**
 * **The whole request trace of Plain, Ideas and Chat, asserted as a sequence.**
 *
 * docs/plans/260905e-main-app-architecture-review.md's checklist asks for the
 * real trace of those three modes on one fixture article before the Ideas
 * controller is lifted out of `App.tsx`, and finding F9 in
 * docs/plans/260905h-plan-review-sol-2.md says why the tests already here
 * cannot serve as it: **none of them rejects an *additional* request.** Plain's
 * queue test accepts any positive number of `/api/jobs` calls, the
 * private-hooks test uses `toContain`, the Ideas cases check their own GET
 * happened and reject no extra GETs, and the Chat tests assert DOM and URL. An
 * extraction that added an Ideas GET to Plain leaves every one of them green.
 *
 * So this one asserts the **exact list, in order** — `toEqual` on the whole
 * array, which is the only shape of assertion an extra request cannot survive.
 * The lists below are the capture recorded in docs/plans/260905h-traces.md,
 * taken identically from the pre-extraction tree and this one.
 *
 * Everything above the assertions is lifted verbatim from
 * tests/public-network-trace.test.tsx — the mocks, the fixtures, the fake
 * server, `settle`/`open` — minus the parts nothing here uses. That file owns
 * the harness and the explanation of every piece of it; this one only borrows.
 *
 * **When it goes red, read it as a question rather than as a bug.** A changed
 * list is a changed network trace, which may be exactly what you meant. Update
 * the lists *and* docs/plans/260905h-traces.md together, and say in the commit
 * which request moved and why.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, ChatThread, ThreadSummary } from "../src/types.js";
import type { PublicArticle, PublicSketch } from "../src/public-types.js";
/* The word on each button, so a press can be aimed at a named mode without a
   second copy of the mode-to-label mapping here. src/title-text.ts. */
import { MODE_LABEL } from "../src/title-text.js";

/** Who `useSession` says is here. Re-posed by each test before it renders. */
const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
}));

/**
 * Whoever is listening to auth events — the experimental-features store, which
 * subscribes here itself (src/web/experimental-store.ts) rather than being told
 * by an effect in `App.tsx`, so that an account switch cannot draw one frame of
 * the previous reader's settings. `open()` below delivers the current session
 * to them, which is what makes `GET /api/reader` happen at all.
 */
const authListeners: ((event: string, session: unknown) => void)[] = [];

/* Never reached on the visitor path — which is the point — but `lib/api.ts`
   imports it at module load and would go looking for a project URL. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      /* Reached only by the two session-unconfirmed actions below, and they
         `await` it — a mock without this member would make the button throw
         rather than reload, which is the one failure mode those actions were
         written to survive. src/web/PublicChrome.tsx § clearDeadSession. */
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/**
 * The three browser APIs the reading view uses that jsdom does not have.
 *
 * Stubbed rather than avoided, because the whole value of this file is that it
 * mounts the **real** reading view: a version that swapped `Spine` or the
 * scroll tracker for stubs would be testing a page nobody visits. None of the
 * three can affect the trace — they observe layout and none of them fetches.
 */
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

/** Every request the page made, in order, whoever made it. */
const trace: { url: string; method: string; auth: string | null }[] = [];

const SLUG = "a-piece";

/**
 * **What the payload carries and nothing else could put on screen.**
 *
 * The trace proves no private request went out; it cannot prove the page knows
 * which reader it is drawing for — handing `OwnedReader` a visitor capability
 * left every trace assertion passing, because the hooks are called there either
 * way. So each of these is a string that can only have come from
 * `GET /api/public/article/:slug`, and each is asserted **on screen** beside
 * the trace. That is the second assertion slice 1a's review asked every future
 * capability seam to have.
 */
const PUBLIC_TERM = "Integrated information theory";
const PUBLIC_IDEA = "Measurement precedes theory";

/**
 * A **PDF** article, because the private source control only mounts for one.
 *
 * `Masthead` renders it under `meta.source === "pdf"`, so a fixture extracted
 * from a web page never reaches the code at all — which is why nothing noticed
 * that every visitor to a shared PDF was being offered somebody else's uploaded
 * file. GPT Sol, second pass, 2026-08-28.
 *
 * **`PublicMeta` has no `source`**, deliberately — the public projection drops
 * the whole PDF provenance block (src/public-types.ts) — so a visitor never
 * reaches that branch of the masthead at all. That is why the gate itself is
 * tested in tests/masthead-source.test.tsx rather than here: this file can only
 * show that today's wire shape happens not to carry the field, which is a fact
 * about the projection rather than about the control.
 */
const PDF_META = {
  source: "pdf" as const,
  pages: 12,
  pagesChecked: 12,
  unverified: false,
};

/**
 * **A drawing, because the fixture's diagram band is a visitor's default now.**
 *
 * Small on purpose — one scene, one box — but a real `Sketch`: with no sketch
 * at all the band says *nobody has drawn this one yet*, which is a true and
 * common state and proves nothing about the picture a visitor is supposed to
 * get. The absent case is asserted separately below.
 */
const PUBLIC_SKETCH_TITLE = "One claim, one example";
const SKETCH: PublicSketch = {
  title: PUBLIC_SKETCH_TITLE,
  caption: "The example is doing the arguing.",
  scenes: [
    {
      id: "s0",
      title: "Overview",
      height: 200,
      items: [
        {
          kind: "node",
          id: "n1",
          shape: "box",
          x: 10,
          y: 10,
          w: 120,
          h: 40,
          text: "The claim",
          size: "md",
          block: "spya-bbbbbb",
        },
      ],
    },
  ],
};

/** The owner's own words, on the fixture's one paragraph. */
const PUBLIC_NOTE = "The bit I keep coming back to.";
const PUBLIC_ANSWER = "Because the example is doing the arguing.";

/**
 * The owner's saved question, in their own words — the one field of a search
 * run that is disclosure rather than article prose (src/public-types.ts
 * § PublicSearchRun). Distinctive enough that finding it on screen means the
 * payload's list was drawn rather than an empty state.
 */
const PUBLIC_CRITERION = "anywhere the argument turns on a number";

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  sketch: SKETCH,
  /* **A real one, not `[]`.** A visitor's drawer showing nothing would pass
     every assertion about *not fetching* while proving nothing about what they
     are shown — which is the whole of stage 3.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */
  comments: [
    {
      id: "spya-cmt23z",
      blockId: "spya-bbbbbb",
      quote: "The first paragraph of the piece.",
      start: 0,
      createdAt: "2026-09-01T09:00:00.000Z",
      body: PUBLIC_NOTE,
      answer: PUBLIC_ANSWER,
    },
  ],
  /* **A real one too, and for the same reason.** A visitor's search band with
     an empty list draws the *"whoever added this article hasn't searched it"*
     state, which passes every assertion about not fetching while proving
     nothing about what the reader is shown.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4. */
  searches: [
    {
      id: "spya-run23z",
      criterion: PUBLIC_CRITERION,
      createdAt: "2026-09-02T09:00:00.000Z",
      stale: false,
      hits: [
        {
          blockId: "spya-bbbbbb",
          quote: "The first paragraph of the piece.",
          confidence: 90,
          reasoning: "It says the thing.",
        },
      ],
    },
  ],
  /* Absent: this fixture has never been through the `assets` step, so the
     reader hot-links exactly as it always did. The third state, and it is
     what the publisher-host assertions below are measured against. */
  assets: undefined,
  navLabelStatus: "ready",
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "h1",
      kind: "heading",
      level: 1,
      text: "A piece",
      words: 2,
      html: "<h1>A piece</h1>",
      gistable: false,
    },
    {
      id: "spya-bbbbbb",
      tag: "p",
      kind: "text",
      text: "The first paragraph of the piece.",
      words: 6,
      html: "<p>The first paragraph of the piece.</p>",
      gistable: true,
    },
    /* **A paragraph with a real external link in it**, and it is here because
       the trace could not otherwise see the hover card. `useLinkFacts` asks
       `GET /api/library` and Wikipedia about an external link, and a fixture
       with no links never gives it anything to ask about — so the suite was
       green over a page that left the public namespace on any hover.
       GPT Sol, 2026-08-28. */
    {
      id: "spya-cccccc",
      tag: "p",
      kind: "text",
      text: "It cites an argument made elsewhere.",
      words: 6,
      html: '<p>It cites <a href="https://en.wikipedia.org/wiki/Attention">an argument</a> made elsewhere.</p>',
      gistable: true,
    },
  ],
  tree: {
    version: "test",
    generator: "test",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: ["n1"],
        range: ["spya-aaaaaa", "spya-cccccc"],
        title: "A piece",
        gist: "What the piece says.",
      },
      /* **A child, and the tree had none until 2026-09-02.** A one-node tree is
         a tree with no *structure*, and `outlineProjection` draws structure —
         so Structure's list face rendered an empty band in every run of this file, and
         the sweep did not notice because it read the whole page and found the
         root's gist in the columns beside the prose. GPT Sol's review of stage
         1a found the assertion was vacuous; the fixture is why it was.
         docs/plans/260902j-public-read-only-access-audit-and-improvements.md. */
      n1: {
        id: "n1",
        depth: 1,
        parent: "n0",
        children: [],
        range: ["spya-bbbbbb", "spya-cccccc"],
        title: "The argument it makes",
        gist: "Where the piece gets to.",
      },
    },
  },
  /**
   * **Asymmetric on purpose, and it is the fixture that makes slice 1b
   * checkable at all.**
   *
   * A glossary and a list of ideas are here; a set of quotes and a tweet
   * thread are not. So one article in one run produces both of the two answers a visitor
   * can get about an artefact — *here it is* and *nobody has built one* — and
   * "these two blurred into one" is visible. A fixture with all four, or with
   * none, cannot tell them apart. A browser pass made exactly this point on
   * 2026-08-28 about the four sentences of slice 1a.
   */
  glossary: {
    entries: [
      {
        id: "spya-term01",
        name: PUBLIC_TERM,
        kind: "concept",
        aliases: [],
        senseHere: "What the author means by it here.",
        blocks: ["spya-bbbbbb"],
      },
    ],
  },
  ideas: {
    ideas: [
      {
        id: "spya-idea01",
        /* The **name** rather than the statement, because a closed row shows
           only the name — a canary the page cannot draw without opening
           something would be a canary this test never sees. */
        name: PUBLIC_IDEA,
        provenance: "assumed",
        statement: "You cannot theorise about what you have no way to measure.",
        occurrences: [
          {
            blockId: "spya-bbbbbb",
            quote: "The first paragraph",
            reasoning: "It rests on it.",
          },
        ],
      },
    ],
  },
};

/**
 * The same article as its **owner** is served it.
 *
 * The title is deliberately different from the public one. `titleFor()` gives
 * the owner their own rename and the public projection never calls it
 * (src/public/dto.ts), so a distinct string here is not decoration: it is the
 * only thing on screen that says *whose copy this is*, and the identity test
 * below turns on being able to see it disappear.
 */
const OWNED: Article = {
  /* The owner's payload is an `Article`, which has no artefact keys at all —
     theirs come from `GET /api/glossary/:slug` and its siblings. Spreading
     `ARTICLE` would carry the public ones across and make the owner control
     below prove less than it says. */
  blocks: ARTICLE.blocks,
  tree: ARTICLE.tree,
  assets: undefined,
  navLabelStatus: "ready",
  meta: {
    ...ARTICLE.meta,
    ...PDF_META,
    title: "A piece, as its owner renamed it",
    url: "https://example.com/a",
  },
};

/**
 * How the **owned** route answers. A 404 is what a signed-in reader gets for
 * somebody else's article, and it is the only way to reach the case that
 * matters most to the chrome: a visitor who has an account.
 */
let owned: () => Response;
/**
 * A `/api/…/` prefix the server answers 404 for — *nobody has asked for one of
 * these yet*, which is the state the five self-starting modes act on. Null
 * unless a test sets it. See `reply`.
 */
let notBuilt: string | null = null;

/**
 * **What `GET /api/reader` says about the experimental switch**, for the tests
 * that need all fourteen mode buttons on screen.
 *
 * `null` is off, which is what every case here gets unless it says otherwise —
 * and what a **stranger** gets whatever this holds, because the store issues no
 * request at all for a signed-out reader (src/web/experimental-store.ts). A date
 * is on-since-then; the wire carries the date and the client derives the
 * boolean, one field, never both.
 */
let experimentalSince: string | null = null;

/**
 * What the public article endpoint serves — `ARTICLE` unless a case says
 * otherwise, and reset in `beforeEach` so one test cannot leak into the next.
 */
let served: PublicArticle;

/**
 * **How the public article route answers**, as a function rather than as
 * `served` alone — because a 404 there is not "a different article", it is the
 * second half of the decision `findArticle` makes.
 *
 * Both answers decide the reader's footing when the owned route says 401
 * (docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C3),
 * so a suite that could only vary one of them could not reach the case where
 * they disagree.
 */
let publicArticle: () => Response;

/**
 * **The conversations the server already holds for this article.**
 *
 * Empty unless a case seeds one, and served to **both** chat GETs — the
 * reading view's `?summary=1` and the panel's full fetch, which `reply` cannot
 * tell apart and does not need to: one object carrying `turns` as well as
 * `messages` satisfies `ThreadSummary` and `ChatThread` at once, and the two
 * readers each take the fields they know.
 */
let storedChats: (ChatThread & Pick<ThreadSummary, "turns">)[] = [];


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The server, as far as this page is concerned.
 *
 * Everything the *owner* asks for is answered with an empty success rather than
 * refused, so the control below exercises a page that works rather than a page
 * full of error states — a trace of failures would be a different test.
 */
function reply(url: string, method: string): Response {
  if (url === `/api/public/article/${SLUG}`) return publicArticle();
  if (url === `/api/article/${SLUG}`) return owned();
  /* The reader's own row, answered properly rather than with the `{}` below: a
     response that does not mention `experimentalSince` is an **error** in the
     client, not an "off" (experimental-features.md), so `{}` would leave the
     store in `loadError` and every case here reading the same `on: false` for
     the wrong reason — docs/reusable/silent-success.md, one layer out. */
  if (url === "/api/reader") return json({ experimentalSince });
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: storedChats });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
  /* **404, the ordinary case** — most articles have no quotes, and it is the
     branch `useQuotesRead` is written around. Answered explicitly rather than
     left to the `json({})` fallthrough at the foot of this function, which would
     take the hook down its `catch` and make this file's subject — *which
     requests happen, in what order* — depend on an exception path. The read is
     mounted for every owner since 2026-09-08 (see `READING_VIEW`). */
  if (url.startsWith("/api/quotes/")) return new Response(null, { status: 404 });
  /* **Nobody has built this one**, for the owner control at the foot of this
     file: pressing a mode whose artefact is missing is what starts a job, and
     with every artefact answered `{}` there is no such mode on the page. */
  if (notBuilt !== null && url.startsWith(notBuilt)) return new Response(null, { status: 404 });
  /* The job list `useJobs` polls. An empty list rather than `{}` because the
     hook reads `body.jobs` and the owner control below is about the *request*,
     not about anything being in flight. */
  if (url === "/api/jobs") return json({ jobs: [] });
  return json({});
}

/* Imported here rather than inside `open()`, and it is not tidiness: the first
   dynamic import transforms App.tsx and the whole client graph behind it, which
   takes several seconds — long enough that whichever test ran first blew the
   5-second default and the other four were reported as failures of the code.
   `vi.mock` is hoisted above this, so the mocks are already in place. */
const { App } = await import("../src/web/App.js");
/* The root boundary, because `open()` below mounts the production tree and
   `main.tsx` has one. It catches nothing here; it is in the tree so that the
   tree is the one readers get. */
const { AppBoundary } = await import("../src/web/AppBoundary.js");

/* **Dynamic, for the same reason `App` is** — and here it is not only speed.
   `experimental-store.ts` imports `lib/api.ts`, which subscribes to
   `onAuthStateChange` at module load; a static import at the top of this file
   would run that before `authListeners` above had been initialised, and the
   whole suite would fail to load rather than fail a test. */
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

/**
 * **`CSS.escape`, which jsdom does not have** and `Reader` calls on every
 * render that has sections in it (App.tsx § the section rows).
 *
 * It went unnoticed until 2026-09-02, and that is the tell: this file's tree
 * fixture had a single node and therefore no sections, so the effect that needs
 * it had never run here. Giving the tree a child made Structure's list face real and
 * this the next thing in the way. The identity function is enough — the fixture's
 * block ids are `spya-…`, which need no escaping — and a real browser has the
 * real one.
 */
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  session.user = null;
  served = ARTICLE;
  storedChats = [];
  notBuilt = null;
  experimentalSince = null;
  /* **The switch's store is a module singleton**, so it keeps the last test's
     session the way it keeps a session between page views — which is the point
     of it, and a trap here: an event is not news (`sessionIs` returns early when
     the id has not changed), so a test posing the same reader as the one before
     would inherit that reader's answer and never re-ask. Reset first, and the
     `SIGNED_IN` that `open()` fires is then real news.
     src/web/experimental-store.ts § Forget everything. */
  resetExperimental();
  /* Reads `served` at call time, so a case may still swap the payload without
     also having to restate how the route answers. */
  publicArticle = () => json(served);
  owned = () => json(OWNED);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    trace.push({ url, method, auth: headers.get("Authorization") });
    return Promise.resolve(reply(url, method));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * A clean root, for a test that opens the app twice.
 *
 * `open()` renders into the same root, and React would reconcile rather than
 * remount — so the second address would inherit the first's mode state and the
 * assertion would be about a page that never existed.
/**
 * The whole app, at a shared article's address. `path` selects the view.
 *
 * **`StrictMode → NuqsAdapter → AppBoundary → App`, which is what `main.tsx`
 * mounts** — Sol F11. Until 2026-09-06 this rendered `NuqsAdapter → App` alone,
 * so a duplicate request caused *only* by React double-invoking effects could
 * pass all three exact-sequence assertions below; the tell was already in the
 * file, which explained Ideas' two GETs by a `StrictMode` it did not enable.
 * A trace captured off the production lifecycle is the only one worth holding
 * still. The lists below were re-captured against this mounting, in both trees.
 */
async function open(search = "", path = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${path}${search}`);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(NuqsAdapter, null, createElement(AppBoundary, null, createElement(App, null))),
      ),
    );
  });
  /* **Then the auth event**, which is how the session reaches anything that
     listens for it — after the render, because the store subscribes on mount.
     Supabase re-emits the current state rather than only changes, so posing the
     same reader twice is what really happens and must stay one request. */
  await act(async () => {
    const posed = session.user === null ? null : { user: session.user };
    for (const fn of [...authListeners]) {
      fn(session.user === null ? "SIGNED_OUT" : "SIGNED_IN", posed);
    }
  });
  await settle();
}

/* ------------------------------------------------------------------ *
 * The trace, and the one thing done to it before it is compared.
 * ------------------------------------------------------------------ */

/** One request, after the one normalisation below. */
type Entry = { url: string; method: string; auth: string | null; repeated?: true };

/** The three fields compared, which is all of them bar the annotation. */
type Shape = { url: string; method: string; auth: string | null };

/**
 * **The only normalisation, and it is the same rule the capture ran under** —
 * docs/plans/260905h-traces.md § The normalisation rule.
 *
 * Consecutive `/api/jobs` polls collapse into one entry carrying
 * `repeated: true`. The poller's cadence is deliberately time-dependent
 * (src/web/jobEngine.ts), so how many times it fires inside six settle turns is
 * a fact about the box's load rather than about the code, and comparing it
 * would make this file fail on a busy afternoon.
 *
 * Nothing else is touched: not the ordering, not the query strings, not `auth`.
 * The **first** `/api/jobs` entry in each list below is a collapse: under
 * `<StrictMode>` the engine's subscription runs twice and polls twice in a row.
 * The second is not — it comes after the article and the record-open POST, and
 * losing it would be a real change.
 */
function normalise(raw: { url: string; method: string; auth: string | null }[]): Entry[] {
  const out: Entry[] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (
      r.url === "/api/jobs" &&
      last !== undefined &&
      last.url === "/api/jobs" &&
      last.method === r.method &&
      last.auth === r.auth
    ) {
      last.repeated = true;
      continue;
    }
    out.push({ url: r.url, method: r.method, auth: r.auth });
  }
  return out;
}

/**
 * The comparison drops `repeated` for the reason above: the annotation records
 * that the poll looped, which is true or false depending on the clock. What is
 * being asserted is the **sequence of requests**, not the cadence of one of
 * them — the cadence is pinned deterministically, under fake timers, in
 * tests/job-engine-drives-with-no-view.test.ts.
 */
const shape = ({ url, method, auth }: Entry): Shape => ({ url, method, auth });

/** Every request in this file carries the mocked Supabase token. */
const AUTH = "Bearer t";
const GET = (url: string): Shape => ({ url, method: "GET", auth: AUTH });
const POST = (url: string): Shape => ({ url, method: "POST", auth: AUTH });

/**
 * **What every owned reading view costs, whatever mode it is in** — the job
 * queue, the article twice, the queue again, the record-open POST. Named rather
 * than spread inline so that the three lists below differ only where the modes
 * really differ.
 *
 * **The doubles are `<StrictMode>`, and they are what the reader's browser
 * really does**: React invokes every effect twice, and a hook whose fetch is
 * not de-duplicated therefore issues it twice. `/api/glossary` and `/api/arc`
 * appear once because theirs is; `/api/article`, `/api/comments` and
 * `/api/chat?summary=1` appear twice because theirs is not. Whether that is
 * worth fixing is a separate question from whether it is being held still —
 * this file's job is the second. Re-captured 2026-09-06,
 * docs/plans/260905h-traces.md.
 */
const ARRIVAL: Shape[] = [
  GET("/api/jobs"),
  GET(`/api/article/${SLUG}`),
  GET(`/api/article/${SLUG}`),
  GET("/api/jobs"),
  POST(`/api/library/${SLUG}/open`),
];

/**
 * The four hooks the reading view mounts for its owner, plus `useArc`.
 *
 * **`/api/quotes/` is the fourth, and it is new on 2026-09-08.** Greg asked for
 * the quotes to be marked in the prose in every mode
 * (docs/plans/260908i-quotes-marked-in-the-prose-in-every-mode.md), so a reader
 * who never opens the band still needs the list — which makes the opening read
 * `OwnedReader`'s, exactly as the glossary's became on 2026-08-27 when the
 * underlines started being drawn outside glossary mode.
 *
 * **One request per article view, and that is the whole price of the feature.**
 * It appears **once** rather than twice for `/api/glossary`'s reason: the read
 * goes through `useOrderedRead`, so `QuotesBand`'s own mount `reload()` joins it
 * rather than issuing a second. If this line ever doubles, that de-duplication
 * has broken.
 *
 * It sits between the glossary's and the arc's because that is the order
 * `OwnedReader` calls the hooks in — recorded rather than sorted away, like the
 * orderings in `CHAT` below.
 */
const READING_VIEW: Shape[] = [
  GET(`/api/comments/${SLUG}`),
  GET(`/api/chat/${SLUG}?summary=1`),
  GET(`/api/glossary/${SLUG}`),
  GET(`/api/quotes/${SLUG}`),
  GET(`/api/arc/${SLUG}`),
  GET(`/api/comments/${SLUG}`),
  GET(`/api/chat/${SLUG}?summary=1`),
];

/** The plain reading view, with no band open. */
const PLAIN: Shape[] = [...ARRIVAL, ...READING_VIEW, GET("/api/reader")];

/**
 * The same, then the Ideas band twice over: the reader's per-article row and
 * the ideas artefact, in that order, once per effect pass.
 */
const IDEAS: Shape[] = [
  ...PLAIN,
  GET(`/api/reader?slug=${SLUG}`),
  GET(`/api/ideas/${SLUG}`),
  GET(`/api/reader?slug=${SLUG}`),
  GET(`/api/ideas/${SLUG}`),
];

/**
 * Chat, arrived at by URL. Two orderings differ from Plain's and Ideas', both
 * properties of arriving at the mode rather than pressing into it: the panel's
 * full thread fetch lands **before** the reading view's `?summary=1` one, in
 * each pass, and the two `/api/reader?slug=` reads come out together ahead of
 * the bare `/api/reader` rather than straddling it. Recorded here rather than
 * sorted away — the ordering is part of what is being held still.
 */
const CHAT: Shape[] = [
  ...ARRIVAL,
  GET(`/api/chat/${SLUG}`),
  GET(`/api/comments/${SLUG}`),
  GET(`/api/chat/${SLUG}?summary=1`),
  GET(`/api/glossary/${SLUG}`),
  GET(`/api/quotes/${SLUG}`),
  GET(`/api/arc/${SLUG}`),
  GET(`/api/chat/${SLUG}`),
  GET(`/api/comments/${SLUG}`),
  GET(`/api/chat/${SLUG}?summary=1`),
  GET(`/api/reader?slug=${SLUG}`),
  GET(`/api/reader?slug=${SLUG}`),
  // The loaded empty Chat list now offers its composer, including Live. Its
  // profile checkbox reads once per StrictMode effect pass too (260906f).
  GET(`/api/reader?slug=${SLUG}`),
  GET(`/api/reader?slug=${SLUG}`),
  GET("/api/reader"),
];

const OWNER = { id: "owner-1", email: "greg@example.com" };

/** The captured sequence, and the positive control that it captured anything. */
function captured(): Shape[] {
  const entries = normalise(trace).map(shape);
  expect(entries.length, "the harness captured no requests at all").toBeGreaterThan(0);
  return entries;
}

describe("the request trace of a mode is the whole of it, in order", () => {
  it("Plain, on arrival", async () => {
    session.user = OWNER;
    trace.length = 0;
    await open();

    expect(captured()).toEqual(PLAIN);
  });

  it("Ideas, arrived at and then pressed", async () => {
    session.user = OWNER;
    trace.length = 0;
    await open();

    /* A **real** click rather than a URL with `?mode=ideas` in it, because that
       is what arms an activation token — the same gesture
       tests/modes-that-start-themselves.test.tsx and the owner cases in
       tests/public-network-trace.test.tsx make. */
    const ideas = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (b) => b.getAttribute("aria-label") === MODE_LABEL.ideas,
    );
    expect(ideas, "the bar must draw Ideas").toBeDefined();
    await act(async () => ideas?.click());
    await settle();

    expect(captured()).toEqual(IDEAS);
  });

  it("Chat, on arrival", async () => {
    session.user = OWNER;
    trace.length = 0;
    await open("?mode=chat");

    expect(captured()).toEqual(CHAT);
  });
});
