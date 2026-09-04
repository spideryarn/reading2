// @vitest-environment jsdom
/**
 * **The acceptance test for public reading is a network trace, not a
 * screenshot.**
 *
 * A signed-out browser on a shared document must issue **no request outside
 * `/api/public/` and no POST at all**. That sentence is the whole of slice 1a's
 * client half, and a screenshot cannot see it: the page renders correctly
 * either way, and the difference is a stream of 401s behind it that only a
 * trace or a devtools panel shows. docs/plans/260827ai-public-read-only-access.md § Stage 1.
 *
 * ## What this proves, stated narrowly on purpose
 *
 * **No application request leaves `/api/public/`.** That is the claim, and it
 * is smaller than the one this comment used to make.
 *
 * The spy is on `globalThis.fetch` rather than on `apiFetch` because `apiFetch`
 * is one of the things being tested: a spy on it would see only the requests
 * that went through the module we already know about, and the failure being
 * guarded against is a hook mounting somewhere nobody remembered. Every request
 * the *client code* makes ends at `fetch`, including `public-api.ts`'s
 * deliberately plain one, so that is where the trace is taken.
 *
 * ## And three things it cannot see, which are not bugs in it
 *
 * This comment asserted *"every request in the client ends at fetch"* until
 * 2026-08-28, and that sentence was false. GPT Sol found it, and it is an
 * instance of exactly the failure this file keeps catching elsewhere — a test
 * whose stated scope exceeds its real one — so the sentence is corrected here
 * rather than quietly narrowed.
 *
 * **1. Browser-native subresource loads from the article's own HTML.**
 * `TableView` injects the extracted HTML, and the sanitiser deliberately keeps
 * external `src`, `srcset`, `poster` and allowlisted iframes — the committed
 * fixture has an `imgix.net` image with a `srcset`. A visitor's browser
 * therefore contacts third parties on mount, on scroll, and on resize, and none
 * of it passes through `fetch`. **A `fetch` spy cannot cover this and neither
 * can jsdom**, which loads no subresources at all; it needs a real browser with
 * an external image and an iframe as positive controls.
 *
 * Whether to *change* that is a product decision rather than a test one — a
 * proxy or click-to-open placeholders would alter what a visitor sees, against
 * the first decision this feature was built on (*the full article, same as the
 * owner*), so it is Greg's. What is not in question is that this file does not
 * prove it, and `Referrer-Policy: no-referrer` is what limits the damage
 * meanwhile: tests/referrer-policy.test.ts.
 *
 * **2. Supabase's own token refresh.** A signed-in visitor with a stale session
 * can cause a POST to Supabase from inside the SDK. Not a Spideryarn API call,
 * not ours to remove, and it happens on every page of this app.
 *
 * **3. Sentry.** In a production build with error reporting configured, a render
 * error causes a POST from the error boundary. Same category.
 *
 * Two and three are known exceptions rather than gaps: they are recorded so
 * that the next person to read a real trace does not find them and conclude the
 * seam leaks. Neither appears here, because neither is configured under
 * vitest.
 *
 * ## The control, and why the file would be worthless without it
 *
 * A test that has never been seen to fail proves nothing —
 * docs/reusable/silent-success.md, and most of a day's bugs here have been
 * something reporting success while doing nothing. So the same harness renders
 * the same address **as the owner**, and asserts the opposite: that the trace
 * fills up with `/api/comments/`, `/api/chat/`, `/api/glossary/` and the
 * record-open POST. If the visitor assertion ever passes because the spy is
 * blind or the page never mounted, that one fails in the same run.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_WITH_YOU } from "../src/messages.js";
import type { Article } from "../src/types.js";
import type { PublicArticle, PublicSketch, PublicTweets } from "../src/public-types.js";
/* The vocabulary itself, so the sweeps below cannot fall behind it — src/modes.ts
   imports nothing, which is why the server can read it too. */
import { DEFAULT_MODE, MODES, type Mode } from "../src/modes.js";
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
const PUBLIC_TWEET = "The first post.";

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
 * The one sentence a visitor's summary band must put on screen — and it is the
 * **tree's own gist**, not an artefact.
 *
 * Stage 5e is gone (docs/plans/260831s-gist-only-summaries.md), so summary mode is now
 * free for a visitor the way the table of contents is. That is worth a rendered
 * assertion rather than a unit test: the mode used to be gated on a
 * `summary.json` the payload might not carry, and a gate left behind would show
 * *"Nobody has built a summary"* over a panel that has everything it needs.
 */
const PUBLIC_GIST = "What the piece says.";

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
         so Outline mode rendered an empty band in every run of this file, and
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
 * The thread, for the one case that needs the tweets page to have one.
 *
 * Kept off `ARTICLE` so that the default fixture can still prove the *absent*
 * half — the page said *"There is a tweet thread for this piece"* about an
 * article whose own response said there was not, and that assertion is worth
 * keeping red-able.
 */
const THREAD: PublicTweets = { limit: 280, tweets: [{ text: PUBLIC_TWEET, chars: 24 }] };


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
 * that need all thirteen mode buttons on screen.
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
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
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
 * it had never run here. Giving the tree a child made Outline mode real and
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
 */
async function remount(): Promise<void> {
  await act(async () => root.unmount());
  host.remove();
  trace.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
}

/** The whole app, at a shared article's address. `path` selects the view. */
async function open(search = "", path = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${path}${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
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

const outsidePublic = () => trace.filter((r) => !r.url.startsWith("/api/public/"));

/**
 * Every gutter chat button on the page, by the name a reader hears.
 *
 * Shared by the visitor case and the owner control at the foot of this file, so
 * the two ask the same question of the same DOM and only the answer differs.
 */
/**
 * A button by the words on it, or `null`.
 *
 * By its **visible text** rather than by a class or a `data-` hook, because the
 * two session-unconfirmed actions do the same two things and differ only in
 * what they promise the reader — so the label is the thing under test, not an
 * incidental way of finding the element.
 */
const buttonNamed = (label: string): HTMLButtonElement | null =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;

const chatButtons = () =>
  [...host.querySelectorAll("button")].filter(
    (b) => b.getAttribute("aria-label") === "Chat about this paragraph",
  );

/**
 * The dock's mode buttons, in the order they are drawn.
 *
 * `role="radio"` inside the modes radiogroup, which is what the bar is
 * (src/web/Dock.tsx) — not `.dock-btn`, which the panel buttons beside it also
 * carry.
 */
const modeRadios = () => [
  ...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]'),
];

/** Which mode the page is in, read the way a reader's URL bar would show it. */
const modeInUrl = (): string =>
  new URLSearchParams(location.search).get("mode") ?? DEFAULT_MODE;

/**
 * The same reading, **after waiting for the address bar to catch up**.
 *
 * `useQueryState` moves React state with the click and pushes `?mode=` on a
 * throttle (src/web/params.ts § modeParam, `history: "push"`), so a single read
 * of `location.search` straight after a press is a race. It lost about one run
 * in two: the loop recorded the *previous* mode and reported Hierarchy as a dead
 * button, which is exactly the finding the sweep exists to make — so a flaky
 * read here would have been indistinguishable from the bug. Found 2026-09-02.
 *
 * Polled against the value before the press rather than slept blindly, so the
 * only run that pays the whole deadline is one where the mode genuinely did not
 * change — the first press, which is Plain on a page already in Plain. **The
 * deadline is not the check**: a button that really is dead fails on
 * `aria-checked` at the call site before this is reached.
 */
async function modeAfterPress(before: string): Promise<string> {
  for (let i = 0; i < 40 && modeInUrl() === before; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  return modeInUrl();
}

/**
 * **What a reader can actually read**, which is not `host.textContent`.
 *
 * `OutlinePanel` draws five `aria-hidden` copies of its rows to measure them
 * (src/web/OutlinePanel.tsx § the candidates, measured and never seen), so the
 * gists are in the DOM's text whether or not the visible list rendered at all.
 * GPT Sol's review of this stage proved it: delete the real `rows.map(...)` and
 * keep `.outln-measure`, and both sweeps below stayed green while a visitor
 * looked at an empty band.
 *
 * Stripping `aria-hidden` here rather than naming Outline's selector fixes the
 * class instead of the instance — any future measurement copy, off-screen
 * mirror or live region is out of this by construction, and the rule is the one
 * the reader lives under anyway.
 */
function readable(root: Element): string {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const unread of copy.querySelectorAll('[aria-hidden="true"], [hidden]')) unread.remove();
  return copy.textContent ?? "";
}

/**
 * The band a visitor gets where an owner would get a feature — `VisitorBand` in
 * src/web/PublicChrome.tsx, addressed by the label a screen reader hears rather
 * than by a class, because eight of the thirteen modes end here and the class
 * they share is the one every band has.
 */
const VISITOR_BAND = '.mode-band[aria-label="Not available on a shared link"]';

/**
 * The one row Outline can draw on this fixture — the child node's title, and
 * the child exists so that this mode has any structure at all to list.
 *
 * Deliberately **not** the root's gist. That is in the columns beside the prose
 * in this mode too, so an assertion on it passes over an empty band, which is
 * exactly what it was doing until 2026-09-02.
 */
const OUTLINE_ROW = "The argument it makes";

/**
 * **What each mode puts on a visitor's screen, on this fixture** — a total map,
 * so a mode added next month is a red compile here rather than a row nobody
 * wrote.
 *
 * The sweeps below drive off `MODES`, and a sweep that only counted requests
 * would pass just as happily against a mode that rendered nothing at all. So
 * each mode carries **two** facts, because one was not enough:
 *
 *  - `where` — the band that must be open, as a selector, or `null` for the two
 *    modes that open none. Asserted both ways. This was `.mode-close`'s absence
 *    at first, which is a proxy twice over: a band that lost its close button
 *    would have satisfied it, and so would a mode that grew a band it should
 *    not have. Sol's review of this stage, 2026-09-02.
 *  - `says` — one string that must be **readable inside that band**, which can
 *    only be true if it drew what it is supposed to draw.
 *
 * **Both halves of that second sentence are load-bearing, and each one alone
 * was a false pass.** Read from the page as a whole, `outline`'s gist is
 * satisfied by the gist columns beside the prose, which are open in that mode
 * anyway — so the band could be empty. Read as raw `textContent`, it is
 * satisfied by `OutlinePanel`'s five `aria-hidden` measuring copies of the very
 * rows in question. Scoped *and* stripped, deleting the visible list is red.
 *
 * The values are literals rather than calls into `visitor.ts`, deliberately:
 * deriving them from the module under test would make this agree with itself.
 */
const BAND_SAYS: Record<Mode, { where: string | null; says: string | null }> = {
  /* The way out: the article and nothing else — no band, and nothing to check
     beyond its absence. */
  plain: { where: null, says: null },
  /* No band either. It is the *gist columns*, drawn from the tree in the
     payload, so the string is read from the page rather than from a band —
     which is why these two facts had to come apart. */
  hierarchy: { where: null, says: PUBLIC_GIST },
  /* Free for a visitor since slice 1b: the same tree, one nested list. */
  outline: { where: ".mode-band.outln", says: OUTLINE_ROW },
  /* Free since 2026-08-31 — the gist, with no summary artefact behind it. */
  summary: { where: ".mode-band.summ", says: PUBLIC_GIST },
  /* The payload carries a glossary, so the visitor gets the real thing. */
  glossary: { where: ".mode-band.gloss", says: PUBLIC_TERM },
  /* And a list of ideas — the fixture is asymmetric on purpose. */
  ideas: { where: ".mode-band.ideas", says: PUBLIC_IDEA },
  /* No quotes on the payload: the *nobody built one* sentence, in the visitor's
     band rather than the real panel. Which means this row says nothing about
     the *present*-quotes renderer; that one could break with this green, and no
     fixture in this file can reach it. */
  quotes: { where: VISITOR_BAND, says: "Nobody has built a set of quotes for this piece yet" },
  /* No timeline on the payload either, so this is the *nobody built one*
     sentence rather than the boundary — it moved out of the group below on
     2026-09-04, when the payload grew a flag to be sure with.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1. */
  timeline: { where: VISITOR_BAND, says: "Nobody has built a timeline for this piece yet" },
  /* **Free since 2026-09-04, and it is the only one here that draws a real
     picture for a visitor.** Force is built from the tree in the payload; the
     panel's three fetching hooks are off and the picker is hidden. The string
     is a node title off that tree, so this row fails if the picture stops being
     drawn — asserting the band's own heading would pass over an empty
     `<aside>`. § Stage 2. */
  /* **A visitor's diagram is the Sketch**, since 2026-09-04 — and it was the
     free Force picture for one day in between, which is why this row has moved
     twice. Greg: *"only Sketch will be visible to those without Experimental
     Features"*, and an already-drawn one only.

     The string is the drawing's own title, off the payload, so this row is
     about the picture rather than about the panel's furniture. Unlike Force,
     the Sketch needs no layout to put its title on screen, so jsdom can see it
     — which is why this assertion could get stronger when the picture changed.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Sketch. */
  diagram: { where: ".mode-band.diag", says: PUBLIC_SKETCH_TITLE },
  /* The four that spend, each named by `MODE_LABEL[mode]` — the policy in
     src/web/visitor.ts carries no string of its own. */
  /* **Free since 2026-09-04**, and the string is the owner's own criterion off
     the payload — so this row fails if the saved list stops being drawn.
     Asserting the band's *"Search"* heading would pass over an empty `<aside>`,
     which is the trap the two facts in this map exist to close.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4. */
  search: { where: ".mode-band.srch", says: PUBLIC_CRITERION },
  chat: { where: VISITOR_BAND, says: "Chat is for whoever added this article" },
  remember: { where: VISITOR_BAND, says: "Remember is for whoever added this article" },
  /* Referee reached the fall-through until 2026-09-02 and was announced by its
     raw mode id; the capital R is the assertion that it no longer does.
     docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C2. */
  referee: { where: VISITOR_BAND, says: "Referee is for whoever added this article" },
};

/**
 * The whole of `BAND_SAYS`' verdict for one mode, so the two sweeps ask it the
 * same way and cannot drift into asking it differently.
 */
/**
 * **How long a thirteen-mode sweep is allowed to take**, stated rather than
 * inherited from Vitest's 5-second default.
 *
 * The three sweeps below each mount thirteen pages or press thirteen buttons,
 * and most of what they spend is **deliberate waiting**: six settle turns per
 * mode, plus `modeAfterPress` polling for the throttled `?mode=` write. Measured
 * 2026-09-02 on a box at load average 80: 3.6s, 3.7s and 3.8s — all three
 * within a quarter of the default, so a load spike fails one at random.
 *
 * That failure is not contained. A timeout inside `act()` leaves the React root
 * mid-render, and every test after it in the file renders an empty `host` — one
 * spike produced **twenty** further failures, none of them about the code. The
 * budget is generous because the cost of being wrong is one slow run, and the
 * cost of the default being wrong is a suite that looks broken.
 *
 * **Not a licence to be slow**: a sweep that starts genuinely fetching or
 * looping would blow this too. It is the difference between a test that waits
 * and a test that hangs.
 */
const SWEEP_MS = 30_000;

function expectBandFor(mode: Mode, when: string): void {
  const { where, says } = BAND_SAYS[mode];
  expect(!!host.querySelector(".mode-band"), `${when}: a band open`).toBe(where !== null);
  const band = where === null ? host : host.querySelector(where);
  expect(band, `${when}: ${where ?? "the page"}`).not.toBeNull();
  if (says !== null) expect(readable(band as Element), when).toContain(says);
}

describe("a signed-out browser on a shared document", () => {
  it("asks one public endpoint and nothing else", async () => {
    await open();

    expect(host.textContent).toContain("The first paragraph of the piece.");
    /* **The chrome, asserted beside the trace, and the trace alone is not
       enough.** A page could ask only the public endpoints and still hand the
       reading view an owner capability — the hooks would fetch from
       `OwnedReader` either way, so the trace would not notice. The label is
       what the capability actually decides, so it is checked here and its
       absence is checked in the owner control below. */
    expect(host.textContent).toContain("View only");
    /**
     * **One request, and it used to be two.** A second GET, for a public
     * metadata endpoint, was made immediately after the article, purely so a
     * marked mode could pick between two true sentences, with its failure
     * swallowed to `null`. The artefacts ride on the article payload since
     * slice 1b, so the payload answers that question and the request is gone;
     * the endpoint itself was deleted on 2026-09-02. The exact list rather than
     * a prefix, because *one* request is the claim.
     * docs/plans/260827ai-public-read-only-access.md § The second request
     * disappears, and
     * docs/plans/260902j-public-read-only-access-audit-and-improvements.md
     * § Cluster B.
     */
    expect(trace.map((r) => r.url)).toEqual([`/api/public/article/${SLUG}`]);
  });

  it("issues no POST, and sends no Authorization header", async () => {
    await open();

    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
    expect(trace.filter((r) => r.auth !== null)).toEqual([]);
  });

  /**
   * The mode bands are where the private hooks live — `useJobs` polls the job
   * list for ever from three of them — so opening one is the press most likely
   * to mount something that fetches.
   *
   * **Driven from `MODES`, and it was a literal list of seven until
   * 2026-09-02.** That list had never opened Plain, Hierarchy, Outline, Quotes,
   * Timeline or Referee — the two newest modes had never been in a visitor
   * trace at all — while `markedModes` derives from the same vocabulary
   * precisely so that a mode cannot be missed (src/web/visitor.ts). The guard
   * did not, which is a test gap that grows on its own every time a mode is
   * added. docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C4.
   */
  it("stays inside the public namespace through every mode", async () => {
    for (const mode of MODES) {
      trace.length = 0;
      await open(`?mode=${mode}`);
      expect(outsidePublic(), mode).toEqual([]);
      /* **And the method, which `outsidePublic` says nothing about.** It filters
         on the path, so a `POST /api/public/…` from a band satisfies it — and
         this file's own acceptance rule at the top is *"requests to
         `/api/public/` and no POST at all"*. The one test that checked the
         second half only ever opened the default mode. Sol's review, 2026-09-02. */
      expect(trace.filter((r) => r.method !== "GET"), mode).toEqual([]);
      /* And the mode drew what it is for. Without this the sweep passes against
         a band that threw, rendered nothing, or silently fell back to the
         article — all of which ask for nothing either. */
      expectBandFor(mode, mode);
      await remount();
    }
  }, SWEEP_MS);

  /**
   * **The four sentences, rendered rather than unit-tested.**
   *
   * `tests/visitor-gaps.test.ts` proves `visitorGap` tells them apart. It
   * cannot prove the reading view *shows* the right one, and a browser pass on
   * 2026-08-28 found that the "never built" case had never been rendered by
   * anything at all: the article it drove had every artefact generated, so the
   * only one of the four states no human had ever seen was the one that says a
   * piece has no glossary.
   *
   * The fixture is asymmetric on purpose — a glossary and no quotes — so the
   * two artefact sentences are produced by one article in one run, which is the
   * arrangement in which "they blurred into one" is visible.
   */
  it("tells an artefact it has from one nobody built, on screen", async () => {
    await open("?mode=quotes");
    /* No `quotes` key on the payload — nobody built one. This is the state the
       browser pass could not reach, because the article it drove had every
       artefact. */
    expect(host.textContent).toContain("Nobody has built a set of quotes for this piece yet");
    expect(host.textContent).not.toContain(PUBLIC_TERM);

    await remount();

    await open("?mode=glossary");
    /**
     * **And the glossary is really on screen**, which is the slice.
     *
     * `PUBLIC_TERM` can only have come from the article payload — there is no
     * glossary endpoint in this trace and `outsidePublic()` is empty — so this
     * is the rendered-state half that a network trace cannot give. The trace
     * proves nothing private was asked for; this proves the page knows it is a
     * visitor's page and drew the visitor's data.
     */
    expect(host.textContent).toContain(PUBLIC_TERM);
    expect(host.textContent).not.toContain("Nobody has built");
    expect(outsidePublic()).toEqual([]);

    await remount();

    await open("?mode=ideas");
    expect(host.textContent).toContain(PUBLIC_IDEA);
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **The third sentence, which nothing had ever rendered.**
   *
   * The test above draws two of the states an artefact can be in — *here it
   * is*, and *nobody built one* — from one asymmetric fixture. It leaves out
   * the state the whole "presence, not truthiness" rule exists for: an artefact
   * somebody **ran**, that came back with nothing in it.
   *
   * That state is why `artefactsIn` tests `!== undefined` rather than
   * `?.length`, why `visitorGap` cannot answer *not-built* here, and why
   * `builtButEmpty` exists as a separate sentence from `notBuiltYet`. All of
   * which was **untested**: mutating `builtButEmpty` to `return notBuiltYet(noun)`
   * on 2026-08-29 left the entire suite green, so the reader could have been
   * told nobody built a glossary that somebody had in fact built.
   *
   * It is the same shape as the bug the browser pass found the day before —
   * a state no test and no human had ever put on screen — one state along.
   * The negative assertion is the load-bearing half: without it this passes on
   * a page saying both things, or the wrong one.
   */
  /**
   * **The visitor's summary band, which nothing had ever mounted.**
   *
   * GPT Sol found the consequence by reading the component tree, 2026-08-29:
   * deleting the visitor's summary band from App.tsx left the whole suite
   * green, because nothing ever put one on screen.
   *
   * **What it asserts changed on 2026-08-31, and the change is the point.** It
   * used to prove the band drew the *artefact* — `?len=long`, so the assertion
   * could not be satisfied by the tree's own gist. Stage 5e is gone
   * (docs/plans/260831s-gist-only-summaries.md) and the gist is now the whole of what
   * this mode shows, so the thing worth proving is the opposite one: a visitor
   * gets summary mode **for free**, on a payload carrying no summary artefact
   * of any kind, with no *"nobody has built"* boundary in the way. A gate left
   * behind in `visitorGap` is exactly what this reddens.
   */
  it("gives a visitor the summary outline, with no artefact behind it", async () => {
    await open("?mode=summary");

    expect(host.textContent).toContain(PUBLIC_GIST);
    expect(host.textContent).not.toContain("Nobody has built");
    /* And the Depth control, which is the one thing the panel still offers —
       so this cannot pass on a band that rendered its heading and nothing
       else. */
    expect(host.textContent).toContain("Depth");
    expect(outsidePublic()).toEqual([]);
  });

  it("says an artefact came back empty, rather than that nobody built one", async () => {
    /* Present and empty, both of them. `artefactsIn` reports the artefact off
       the *key*, so the band mounts the panel rather than answering
       *not-built* — which is exactly the branch a length test would delete.

       **A state no article can be in**: all four builders throw rather than
       write an empty result. This pins the fallback, not a screen anybody
       reaches. docs/plans/260827ai-public-read-only-access.md § The state that cannot
       happen. */
    const empty: { mode: string; noun: string; article: () => PublicArticle }[] = [
      {
        mode: "glossary",
        noun: "A glossary",
        article: () => ({ ...ARTICLE, glossary: { entries: [] } }),
      },
      {
        mode: "ideas",
        noun: "A list of ideas",
        article: () => ({ ...ARTICLE, ideas: { ideas: [] } }),
      },
    ];
    for (const { mode, noun, article } of empty) {
      await remount();
      served = article();
      await open(`?mode=${mode}`);

      expect(host.textContent, mode).toContain(`${noun} was built for this piece`);
      expect(host.textContent, mode).toContain("came back with nothing in it");
      /* The whole point: not the never-built sentence. */
      expect(host.textContent, mode).not.toContain("Nobody has built");
      expect(outsidePublic(), mode).toEqual([]);
    }
  });

  /**
   * **The owner-only controls are not on a visitor's band**, and this is the
   * assertion the trace genuinely cannot make.
   *
   * Every one of these is a button or a label that only `GlossaryPanel`'s
   * `owner` arm draws, and none of them fires a request until it is *pressed* —
   * so a panel handed a nulled-out owner shape instead of the visitor arm would
   * render all of them and leave the trace spotless. The type now forbids that
   * combination outright; this stays as the runtime half of the same rule.
   * src/web/GlossaryPanel.tsx § GlossaryAccess.
   */
  it("draws none of the owner's controls on the band it does open", async () => {
    await open("?mode=glossary");
    expect(host.textContent).toContain(PUBLIC_TERM);
    for (const control of [
      "Check the web",
      "Find more",
      "Start again",
      "Find the terms",
      "Use my profile",
    ]) {
      expect(host.textContent, control).not.toContain(control);
    }
  });

  /**
   * **The gutter's chat button is not drawn at all for a visitor.**
   *
   * It used to be, on every paragraph, with the press swallowed by an
   * `if (!owner) return;` in App — a button whose only possible outcome was
   * nothing, which is the thing the rest of this feature is careful not to
   * ship. The capability is the callback itself now: no `onChatAbout`, no
   * button. src/web/BlockGutter.tsx, and `onRenamed` on Masthead.tsx is the
   * pattern it follows.
   *
   * Asked for by accessible name rather than by class, because the name is what
   * decides whether a reader can reach it: `.block-chat` is hidden with
   * `opacity` and never `display: none` (styles.css § the gutter), so a button
   * nobody can see is still in the tab order and still announced.
   */
  it("draws no chat button beside a paragraph", async () => {
    await open();

    /* The prose is really on screen, so this cannot pass on a page that never
       mounted the table. */
    expect(host.textContent).toContain("The first paragraph of the piece.");
    expect(chatButtons()).toEqual([]);
    /* And the slot the visitor does keep, which is what makes this an absence
       rather than a gutter that failed to render. */
    expect(host.querySelectorAll("a.blk-permalink").length).toBeGreaterThan(0);
  });

  /**
   * The offer is the one thing keyed on *am I signed in* rather than on *is
   * this mine* — a browser pass read "Make a free account" put to somebody
   * already holding one as a page that had not noticed them. The **reason** is
   * shown to everybody; only the ask is conditional.
   */
  it("does not offer an account to a reader who has one", async () => {
    await open("?mode=chat");
    expect(host.textContent).toContain("Chat is for whoever added this article");
    expect(host.textContent).toContain("Make a free account");

    await remount();

    session.user = { id: "somebody-else", email: "else@example.com" };
    /* Signed in, and not the owner: `/api/article/:slug` 404s, so the two-step
       falls through to the public route and this is a *visitor* who has an
       account. The chrome is identical; the ask is not. */
    owned = () => json({ error: "not yours" }, 404);
    await open("?mode=chat");

    expect(host.textContent).toContain("View only");
    /* **The reason is ownership-neutral**, so it stays true for this reader.
       It said "Chat is for signed-in readers" until 2026-08-28, which told
       somebody already signed in to do the thing they had done — and signing in
       leaves them on this very page. GPT Sol. */
    expect(host.textContent).toContain("Chat is for whoever added this article");
    expect(host.textContent).not.toContain("Make a free account");
  });

  /**
   * **The interaction the trace could not see.**
   *
   * A network trace records requests, and this one needs a *hover* to happen
   * first — so a suite that only ever renders a page and reads its text was
   * green over a visitor whose every hover asked `GET /api/library`
   * (authenticated) and Wikipedia (off-origin). GPT Sol found it by reading the
   * component tree rather than by running anything, 2026-08-28.
   *
   * Both events, not one. The card opens on `pointerover` for a mouse and on
   * `focus` for a keyboard, and they are separate listeners — a fix that
   * covered only the pointer would leave the keyboard path asking.
   *
   * Timers are advanced because the card rests before it opens: firing the
   * event and asserting immediately would prove nothing about a lookup that had
   * not been scheduled yet.
   */
  it("asks nobody about a link, on hover or on focus", async () => {
    await open();

    const link = host.querySelector<HTMLAnchorElement>('a[href^="https://en.wikipedia.org"]');
    expect(link, "the fixture must contain an external link to hover").not.toBeNull();
    /**
     * **The card's own selector, restated here.**
     *
     * Without this the test passes by never opening a card at all — which is
     * exactly what it did on its first run, and a test that cannot reach the
     * code it names is worse than no test. If the fixture, the prose wrapper or
     * the selector ever stop agreeing, this line says so instead of the suite
     * going quietly green.
     */
    expect(link?.closest("mark.term, .prose a[href], a.cited-link")).toBe(link);
    trace.length = 0;

    for (const event of ["pointerover", "focusin"] as const) {
      await act(async () => {
        /* `MouseEvent` rather than `PointerEvent`, which jsdom does not have.
           The handler reads `pointerType` and refuses touches; `undefined` is
           not `"touch"`, so a mouse is what this looks like — which is the
           case that matters, since a touch deliberately opens nothing. */
        link?.dispatchEvent(new MouseEvent(event, { bubbles: true }));
      });
      /**
       * **Past the rest delay, which is the whole reason this is a real wait.**
       *
       * `HOVER_DELAY.open` is 320ms and the card arms a timer rather than
       * opening on the event — so the first version of this test, which
       * advanced no time at all, asserted about a card that had not been built.
       * It passed against a visitor who looked up every link.
       */
      await act(async () => {
        await new Promise((go) => setTimeout(go, 400));
      });
      await settle();
      expect(outsidePublic(), `after ${event}`).toEqual([]);
    }

    /* And the card really did open — the last guard against this test going
       green by doing nothing. */
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  /**
   * **The other two views, which the sweep never opened.**
   *
   * Every request assertion in this file was made at `/read/:slug` with query
   * modes, so `/metadata` and `/tweets` — two of the three addresses a visitor
   * can reach — were untested for requests *and* for copy. GPT Sol, 2026-08-28.
   */
  it("stays inside the public namespace on the metadata and tweets pages", async () => {
    for (const view of ["/metadata", "/tweets"]) {
      await remount();
      await open("", view);
      expect(outsidePublic(), view).toEqual([]);
      expect(trace.filter((r) => r.method !== "GET"), view).toEqual([]);
    }
  });

  /**
   * **The tweets page reads the flag rather than asserting one.**
   *
   * `TWEETS_GAP` was a constant saying `not-yet-public`, so this page told a
   * visitor *"There is a tweet thread for this piece"* about an article whose
   * own response said `tweets: false`. The unit test for `tweetsGap` cannot see
   * that, because the constant was in the *caller* — which is why breaking the
   * call site left `visitor-gaps` entirely green.
   */
  it("does not claim a tweet thread that the wire says is not there", async () => {
    await open("", "/tweets");

    expect(host.textContent).toContain("Nobody has built a tweet thread for this piece yet");
    expect(host.textContent).not.toContain("There is a tweet thread");
  });

  /**
   * **And it draws the real thread when the payload carries one** — the other
   * half of the same branch, which is what makes the case above evidence
   * rather than a page that always says the same thing.
   *
   * Still no request outside `/api/public/`: `Tweets` fetches
   * `GET /api/tweets/:slug` and mounts `useJobs`, and neither may appear here.
   */
  it("renders the tweet thread the payload carries, and asks nobody for it", async () => {
    served = { ...ARTICLE, tweets: THREAD };
    await open("", "/tweets");

    expect(host.textContent).toContain(PUBLIC_TWEET);
    expect(host.textContent).not.toContain("Nobody has built a tweet thread");
    /* The owner's foot: the provenance line and the button that spends. */
    expect(host.textContent).not.toContain("Write it again");
    expect(host.textContent).not.toContain("Written by");
    expect(outsidePublic()).toEqual([]);
    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
  });

  /**
   * **Modes changed by pressing the buttons, not by writing the URL.**
   *
   * Every mode assertion in this file arrives at its mode through `?mode=` on a
   * fresh mount, which is a page load rather than a transition — so a band that
   * only fetches when it is *switched into*, or a dock handler that reaches for
   * something on press, would never be exercised. GPT Sol listed "fetch from a
   * hover/click/timer" as the mutation this file would miss, and the click half
   * was the one still outstanding after the hover test.
   *
   * **Driven from the buttons the dock actually draws**, which is the second of
   * the two sources C4 asks for and a different question from the sweep above.
   * That one asks *does every mode in the vocabulary behave*; this one asks
   * *does every button in the bar behave*, and the two disagree in both of the
   * ways that matter: a mode nobody drew a button for is untestable by press,
   * and a button for something that is not a mode is a control the vocabulary
   * has never heard of. So the modes reached by pressing are collected and
   * compared with `MODES` at the end.
   *
   * A press is identified by the mode it lands the page in rather than by the
   * button's label, because the label is a product word (`MODES_UI` in
   * src/web/Dock.tsx) and matching it to a mode id here would be a third copy
   * of that mapping.
   *
   * ## Two passes since 2026-09-03, and the count is not weakened
   *
   * Five modes are behind the experimental-features switch, and a signed-out
   * reader is **forcibly off** — there is no answer this test could pose that
   * would put Quotes in a stranger's bar, because the store issues no request
   * for them at all. So the sweep runs twice rather than shrinking:
   *
   *  1. the bar as a stranger finds it — the modes that are not behind the
   *     switch, pressed in turn;
   *  2. each remaining mode at **its own address**, because the bar retains
   *     whichever mode the URL names, so `?mode=timeline` really does draw a
   *     Timeline button for a reader who followed a shared link into it.
   *
   * The union is still compared with `MODES`, in both directions, which is the
   * invariant the pre-gate version held. Dropping the second pass would have
   * quietly stopped pressing five of the thirteen.
   */
  it("stays inside the public namespace when the modes are pressed", async () => {
    await open();
    trace.length = 0;

    const buttons = modeRadios();
    expect(buttons.length, "the bar must draw its modes").toBeGreaterThan(0);

    const pressed: string[] = [];
    for (const button of buttons) {
      const label = button.getAttribute("aria-label");
      const before = modeInUrl();
      await act(async () => button.click());
      await settle();
      expect(outsidePublic(), `after pressing ${label}`).toEqual([]);
      /* And no POST — the other half of this file's acceptance rule, which
         `outsidePublic` cannot see. See the sweep above. */
      expect(trace.filter((r) => r.method !== "GET"), `after pressing ${label}`).toEqual([]);

      /* **The bar's own answer first**, because it is React state and lands with
         the click. This is the assertion that a button is live; everything below
         is about *which* mode it opened. */
      expect(button.getAttribute("aria-checked"), `pressing ${label} must select it`).toBe(
        "true",
      );

      /* Where the press landed. A button the vocabulary has never heard of is
         caught here rather than by the table lookup on the next line, which
         would fail with `undefined` and say nothing useful. */
      const mode = await modeAfterPress(before);
      expect(MODES, `pressing ${label} selected ${mode}`).toContain(mode);
      pressed.push(mode);
      expectBandFor(mode as Mode, `after pressing ${label}`);
    }

    /* **The bar drew what a default reader sees, and not one button more.** The
       five behind the switch are absent from a stranger's bar by construction;
       this is the assertion that they really were, so the second pass below is
       testing something rather than repeating the first. */
    expect(pressed.length, "a stranger's bar is the non-experimental modes").toBeLessThan(
      MODES.length,
    );

    /* **The second pass: the hidden five, each at the address that reaches it.**
       Pressing a button that is already checked is a real reader action — it is
       what the empty state's "try again" amounts to — and it runs the same
       `armActivationForMode` + `onMode` path the first pass exercises, which is
       the branch a POST would hide in. */
    for (const mode of MODES) {
      if (pressed.includes(mode)) continue;
      await remount();
      await open(`?mode=${mode}`);
      trace.length = 0;

      const button = modeRadios().find((b) => b.getAttribute("aria-label") === MODE_LABEL[mode]);
      /* **The radiogroup is never left with nothing checked.** Without the
         retain rule this is `undefined` and the group announces one-of-these
         with none of them on. */
      expect(button, `${mode} must keep its button when the URL names it`).toBeDefined();
      expect(button?.getAttribute("aria-checked"), `${mode} must be the checked one`).toBe("true");
      /* And the band is on screen: hidden means hidden from the controls, not
         unreachable — docs/project/experimental-features.md, rule two. */
      expectBandFor(mode, `arriving at ${mode} with the switch off`);

      await act(async () => (button as HTMLButtonElement).click());
      await settle();
      expect(outsidePublic(), `after pressing ${mode}`).toEqual([]);
      expect(trace.filter((r) => r.method !== "GET"), `after pressing ${mode}`).toEqual([]);
      expect(button?.getAttribute("aria-checked"), `${mode} stays checked`).toBe("true");
      expectBandFor(mode, `after pressing ${mode}`);
      pressed.push(mode);
    }

    /* **The bar and the vocabulary are the same set**, in both directions: a
       mode with no button is missing from the left, and a *dead* button leaves
       the page where it was, so it shows up as a duplicate here and as the
       missing mode it failed to open. Sorted, because the bar's order is Greg's
       and `MODES` is only a vocabulary — they are deliberately not the same
       order. This is also what proves every press was live, so there is no
       per-press check that the mode changed: one assertion, at the end, that
       thirteen presses reached thirteen modes. */
    expect([...pressed].sort()).toEqual([...MODES].sort());
  }, SWEEP_MS);

  /**
   * **The five modes that start themselves for an owner start nothing here.**
   *
   * Since 2026-09-02, pressing Glossary, Ideas, Quotes or Timeline with nothing
   * behind it posts a job, and so does picking the Sketch picture inside
   * Diagram. The sweep above already presses every button and asserts no POST,
   * which covers the first four; this names them, so that a future edit which
   * quietly narrowed the sweep is still red here.
   *
   * The seam is capability rather than a check inside the feature: the hooks
   * that can do it mount under `OwnedReader` and never for a visitor. That is
   * what makes this cheap to hold and worth holding — it fails the moment
   * somebody moves one of them up a level.
   */
  it("starts none of the five paid modes, however they are reached", async () => {
    for (const mode of ["glossary", "ideas", "quotes", "timeline"]) {
      await remount();
      await open(`?mode=${mode}`);
      expect(trace.filter((r) => r.method !== "GET"), `on ${mode}`).toEqual([]);
      expect(outsidePublic(), `on ${mode}`).toEqual([]);
    }
  });

  /**
   * **And the sketch, which is not a mode but a picture inside one.**
   *
   * `?mode=diagram&diagram=sketch` is a real address — it is what a reader who
   * had the picture open would copy — and it is the one auto-run that is not
   * armed by a bar button. A visitor gets the *Diagram is for whoever added
   * this article* band instead, so there is no chip to press and no `useSketch`
   * to fire; both halves are asserted, because the absence of a POST alone
   * would pass over a page that had simply failed to render.
   */
  it("draws no sketch chip on a shared link that names one", async () => {
    await open("?mode=diagram&diagram=sketch");

    expect(host.querySelector("[data-diag-kind]"), "no picture chips for a visitor").toBeNull();
    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **The hostile deep link, one picture at a time.**
   *
   * Hiding the chips is not the gate and never could be: `?diagram=` is
   * ordinary query state, so a pasted address — or the Back button onto one —
   * names a picture without pressing anything. Four of the five spend:
   * `drift` and `trail` POST for a projection, `sketch` and `illustrated`
   * mount children that auto-run a job, and `force` itself POSTs for
   * embeddings. `DiagramPanel` pins a visitor's `kind` to `force` and turns
   * off all three of its fetching hooks, and this is the assertion that the
   * pin holds from the URL rather than only from the picker.
   *
   * **Asserted per kind rather than in one loop over a joined string**, so a
   * failure names the picture that leaked. GPT Sol asked for exactly this
   * shape when it reviewed the stage.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2.
   */
  it.each(["force", "drift", "trail", "sketch", "illustrated"])(
    "buys nothing when a visitor arrives at ?diagram=%s",
    async (kind) => {
      await open(`?mode=diagram&diagram=${kind}`);

      /* The band is open — a visitor gets the free picture, so this is not the
         vacuous pass where nothing mounted and therefore nothing fetched. */
      expect(host.querySelector(".mode-band.diag"), `${kind}: the band`).not.toBeNull();
      expect(trace.filter((r) => r.method !== "GET"), `${kind}: no POST`).toEqual([]);
      expect(outsidePublic(), `${kind}: nothing outside /api/public/`).toEqual([]);
      /* Named individually as well, because `outsidePublic` would also be empty
         if the whole panel failed to mount. These are the four addresses this
         stage is about. */
      for (const paid of ["/api/similar/", "/api/projection/", "/api/sketch/", "/api/illustrated/"]) {
        expect(trace.filter((r) => r.url.includes(paid)), `${kind}: ${paid}`).toEqual([]);
      }
    },
  );

  /**
   * **Rewritten 2026-09-04.** This used to assert the drawer said *comments
   * belong to whoever added this article* — the sentence a visitor got instead
   * of the comments. They get the comments now, and still ask for nothing:
   * they arrived in the article payload.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
   */
  /**
   * **The Sketch a visitor is never offered.**
   *
   * Greg asked for Sketch on a shared link and, asked whether a visitor could
   * *draw* one, said an already-drawn Sketch only. The empty state is where
   * that decision is either kept or lost: the owner's version of this screen
   * names the price and carries the button that spends it, and a visitor's must
   * carry neither.
   *
   * **Asserted on an article with no sketch**, which is the ordinary case —
   * `sketch` is not in `DEFAULT_INGEST_STEPS`, so most articles have never had
   * one. The fixture carries one by default, so this case has to take it away.
   */
  it("offers a visitor no way to draw a sketch, and never names its price", async () => {
    /* `delete` rather than `sketch: undefined`, because
       `exactOptionalPropertyTypes` distinguishes an absent key from one holding
       `undefined` — and absent is what the wire actually carries. */
    const { sketch: _drawn, ...withoutSketch } = ARTICLE;
    served = withoutSketch;
    await open("?mode=diagram");

    /* The honest sentence, and the whole of it. */
    expect(host.textContent).toContain("Nobody has drawn this one yet");
    /* And none of the owner's invitation. `$0.20` and the wait are the two
       halves of the price, and "Draw the argument" is the button. */
    expect(host.textContent, "the price").not.toContain("costs one model call");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => (b.textContent ?? "").includes("Draw the argument"),
      ),
      "the Draw button",
    ).toBe(false);
    /* The profile tickbox goes with it — it is an input to a job. */
    expect(host.querySelector(".sk-run"), "the run row").toBeNull();

    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **The owner's saved searches, read and only read.**
   *
   * Greg drew the line at *making* one — *"Only owner can create new searches.
   * Everyone else can see the ones they have already created."* — so the four
   * verbs and the composer are what must not be on this screen, and the list
   * and its marks are what must.
   *
   * **`/api/search/:slug` never being asked is the assertion behind the whole
   * design.** `useSearch` fetches on mount, so it is mounted in `SearchBand`
   * alone; if somebody ever gave `VisitorSearchBand` a slug and a hook, this is
   * the line that goes red rather than a code review.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.
   */
  it("shows the owner's saved searches, and offers no way to add one", async () => {
    await open("?mode=search");

    /* The reader's own question, drawn from the payload. */
    expect(host.textContent).toContain(PUBLIC_CRITERION);
    /* And no composer: the box is one input over both matchers, so its absence
       is the whole of "no new searches, and no words matcher either". */
    expect(host.querySelector(".srch-box"), "the composer").toBeNull();
    expect(
      [...host.querySelectorAll("input")].filter((i) => i.type !== "checkbox"),
      "any text input at all",
    ).toEqual([]);

    /* The three per-row controls, **by their titles**: all three are the same
       `.srch-icon` button, so a class would not tell them apart, and the title
       is what the reader is offered. A control whose only difference from its
       neighbour is a tooltip has to be asserted by the tooltip. */
    const titles = [...host.querySelectorAll("button")].map((b) => b.getAttribute("title") ?? "");
    expect(titles, "delete").not.toContain("Delete this search");
    expect(titles, "reuse").not.toContain("Put this question back in the box");
    expect(titles, "the colour picker").not.toContain("Change this search's colour");
    /* And the row itself is there, or all three absences are absences of
       everything — the row's own button carries the criterion in its title. */
    expect(titles.some((t) => t.includes(PUBLIC_CRITERION)), "the row").toBe(true);

    expect(trace.filter((r) => r.url.includes("/api/search/")), "no search read").toEqual([]);
    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **The stale warning, without the button it used to name.**
   *
   * The fixture's run is fresh, so nothing in the case above reaches this copy
   * at all — which is exactly why GPT Sol found it by reading and not by
   * running: the row's tooltip and the banner both ended *"↺ puts the question
   * back in the box so you can ask it again"*, naming a control a visitor does
   * not have and a box that is not on the screen.
   *
   * The warning itself stays, because it is just as true for them: the marks in
   * their prose may be sitting on words that have moved. What goes is the
   * instruction. Same shape as the empty state — docs/project/copy.md.
   */
  it("warns a visitor a search is out of date, and does not tell them to redo it", async () => {
    served = {
      ...ARTICLE,
      searches: (ARTICLE.searches ?? []).map((run) => ({ ...run, stale: true })),
    };
    await open("?mode=search");

    /* Tick it on, or the banner is about nothing on screen. */
    const box = host.querySelector<HTMLInputElement>('.srch-saved-tick input[type="checkbox"]');
    expect(box, "the tick").not.toBeNull();
    await act(async () => box?.click());

    expect(host.textContent, "the warning").toContain("older version of the article");
    expect(host.textContent, "the instruction").not.toContain("puts its question back in the box");
    const titles = [...host.querySelectorAll("span, button")].map(
      (e) => e.getAttribute("title") ?? "",
    );
    expect(titles.join(" | "), "the row's tooltip").not.toContain("so you can ask it again");
    /* And it does not assert a cause nobody knows: `stale` is also true when a
       run never recorded what it was answered against. */
    expect(host.textContent, "an unsupported claim").not.toContain("The text was re-fetched");

    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **And the controls a visitor *does* get are pressed**, which the case above
   * and its neighbours do not do.
   *
   * GPT Sol named this as the remaining blind spot in the trace, 2026-09-04:
   * every search case opens the mode and reads the page, so a write attached to
   * the tick, the row, select-all or the sort control would escape all of them.
   * The whole point of leaving those controls on a visitor's screen is that they
   * are free — this is what says so.
   */
  it("lets a visitor press everything they are given, and still buys nothing", async () => {
    await open("?mode=search");

    /* Tick it on first, and check the marks land — otherwise everything below
       is clicking around a page with nothing on it, which is the shape of a
       pass that means nothing. */
    const box = host.querySelector<HTMLInputElement>('.srch-saved-tick input[type="checkbox"]');
    expect(box, "the tick").not.toBeNull();
    await act(async () => box?.click());
    expect(host.querySelectorAll("mark.hit").length, "marks in the prose").toBeGreaterThan(0);

    /* Then the row itself (which solos it), then every remaining button and
       every remaining input the band renders — select-all, the two sort
       buttons, the threshold slider. Some of these turn the marks back off,
       which is fine: what is being asserted is that none of them writes. */
    const row = host.querySelector<HTMLButtonElement>(".srch-saved-body");
    expect(row, "the row").not.toBeNull();
    await act(async () => row?.click());
    for (const b of [...host.querySelectorAll("button")]) {
      await act(async () => b.click());
    }
    for (const input of [...host.querySelectorAll<HTMLInputElement>("input")]) {
      await act(async () => input.click());
    }

    expect(trace.filter((r) => r.method !== "GET"), "a write").toEqual([]);
    expect(outsidePublic(), "a request outside the closed room").toEqual([]);
  });

  /**
   * **A pasted `?match=words` does not put a visitor in front of a box that is
   * not there.**
   *
   * `?match=` is ordinary query state, so hiding the toggle would not have been
   * enough — the same reason the diagram panel pins `?diagram=` rather than
   * filtering its chip row. Without the pin this reader gets the words
   * matcher's empty state, *"Type to find words in the article"*, over a panel
   * with nothing to type into.
   */
  it("pins a visitor to the saved searches, whatever ?match= says", async () => {
    await open("?mode=search&match=words&find=prose");

    expect(host.textContent).toContain(PUBLIC_CRITERION);
    expect(host.textContent, "the words matcher's instruction").not.toContain(
      "Type to find words in the article",
    );
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **And an article nobody has searched says so without inviting anything.**
   *
   * The owner's empty state is an instruction — *"Describe what you are
   * after"* — and a visitor cannot follow it. The same shape the comments
   * drawer settled on one stage earlier: a visitor is told what the absence
   * means and nothing else. docs/project/copy.md.
   */
  it("tells a visitor an unsearched article is unsearched, and asks nothing of them", async () => {
    served = { ...ARTICLE, searches: [] };
    await open("?mode=search");

    expect(host.textContent).toContain("hasn't searched it");
    expect(host.textContent, "the owner's instruction").not.toContain("Describe what you are after");
    expect(host.querySelector(".srch-box"), "the composer").toBeNull();
    /* **And it says it once.** Found in the browser pass, 2026-09-04: the
       sentence above was followed by "Nothing matched. The model found nothing
       in this article that matches" — two empty states stacked, saying
       different things about the same article, the second of them a claim about
       a search nobody ran. Pre-existing for owners too; the visitor's screen is
       where it was seen. */
    expect(host.textContent, "a second empty state").not.toContain("Nothing matched");
    expect(outsidePublic()).toEqual([]);
  });

  /**
   * **And the drawing itself comes from the payload**, with no request for it.
   *
   * The negative twin of the case above: with a sketch on the article a visitor
   * sees the picture, and `/api/sketch/:slug` is never asked — which is the
   * assertion that would fail if somebody gave the visitor arm a slug.
   */
  it("draws the owner's sketch from the payload, asking nothing", async () => {
    await open("?mode=diagram");

    expect(host.textContent).toContain(PUBLIC_SKETCH_TITLE);
    expect(trace.filter((r) => r.url.includes("/api/sketch/")), "no sketch read").toEqual([]);
    expect(outsidePublic()).toEqual([]);
  });

  it("shows the owner's comments in the drawer, without asking for them", async () => {
    await open("?panel=questions");

    expect(outsidePublic()).toEqual([]);
    /* The reader's own words, which is what the list previews. */
    expect(host.textContent).toContain(PUBLIC_NOTE);
    /* And the sentence that is no longer true is really gone, rather than
       merely not asserted — the failure mode of a rewritten expectation. */
    expect(host.textContent).not.toContain("belong to whoever added this article");
  });

  /**
   * **Opening one gives the answer and none of the verbs.**
   *
   * The dialog is where every owner capability lives — edit, delete, retry,
   * "search the web", the follow-up composer — and `CommentAccess`'s visitor
   * arm carries none of them. Asserted by *label*, because that is what a
   * reader would press; a query on a class name would pass over a button whose
   * text changed.
   */
  it("opens a comment read-only, with no verbs and no composer", async () => {
    await open("?panel=questions&note=spya-cmt23z");

    expect(host.textContent, "the answer").toContain(PUBLIC_ANSWER);
    for (const verb of ["Delete", "Try again", "Search the web"]) {
      const found = [...host.querySelectorAll("button")].some(
        (b) => (b.textContent ?? "").trim() === verb,
      );
      expect(found, verb).toBe(false);
    }
    /* The follow-up box is absent rather than disabled — a greyed-out one is an
       invitation to press it, and the press would spend the owner's money. */
    expect(host.querySelector(".cmt-followup"), "no composer").toBeNull();
    expect(outsidePublic()).toEqual([]);
    expect(trace.filter((r) => r.method !== "GET")).toEqual([]);
  });

  /**
   * **The heading has to agree with the body it sits above.**
   *
   * A visitor saw *"Your comments"* directly over *"Comments belong to whoever
   * added this article"* — the body right, the heading backwards, and half a
   * second of doubt exactly where the copy is working hardest. A browser pass
   * found it on 2026-08-28 and **no test could have**: both strings were
   * individually correct and nothing put them in the same assertion.
   *
   * So this one reads the heading element rather than the page text, because
   * the word "Comments" is also on the bar button underneath and a substring
   * check on the whole page would pass either way.
   */
  it("does not call somebody else's comments yours", async () => {
    await open("?panel=questions");

    const heading = host.querySelector(".dock-drawer-head h2")?.textContent;
    expect(heading).toBe("Comments");
  });

  /**
   * **And on the other two pages, which reach a different arm of the bar.**
   *
   * `PublicMetadataPage` and `VisitorPage` mount `Dock` with no drawer, so the
   * Comments button degrades to a link back to the reading view — and that link
   * had a hard-coded *"Your comments…"* title. The drawer heading was corrected
   * and the link that leads to it was not, so two of the three visitor pages
   * went on saying it. GPT Sol, second pass, 2026-08-28.
   *
   * The bar cannot infer footing from the drawer's *shape*: a drawer-less bar
   * belongs to the owner on the metadata and tweets pages of their own article,
   * and to a visitor on the public stand-ins. Inferring from its absence is what
   * caused this, so footing is passed.
   */
  it.each(["/metadata", "/tweets"])(
    "does not call somebody else's comments yours on %s",
    async (view) => {
      await open("", view);

      const link = [...host.querySelectorAll("a")].find(
        (a) => a.getAttribute("aria-label") === "Comments",
      );
      expect(link, "the bar must offer a Comments link").toBeDefined();
      expect(link?.getAttribute("title")).not.toContain("Your comments");
    },
  );
});

/**
 * **One reader's article must never be on another reader's screen.**
 *
 * `useArticleAccess` keyed its answer by slug and by the *boolean* `signedIn`
 * until 2026-08-28. Owner A signs out, reader B signs in: the slug has not
 * changed and `signedIn` is `true` both times, so the effect never re-ran and
 * A's private article stayed mounted — with `OwnedReader` and its three
 * authenticated hooks — indefinitely. GPT Sol found it reviewing this half.
 *
 * **The identity changes inside the same mounted root**, which is the only
 * arrangement that can see it. Unmounting and remounting would rebuild the
 * state that holds the stale answer, so a test written that way passes against
 * the bug — and that is exactly how this file was written before, which is why
 * it never noticed.
 *
 * The assertion is made **synchronously after the re-render**, before anything
 * settles. `setAnswer(null)` lives in an effect, and React runs effects after
 * the render that scheduled them, so an implementation relying on the effect to
 * clear shows the previous reader's article for a frame. A frame is enough.
 */
describe("when the reader changes underneath the page", () => {
  it("never shows one reader's article to the next", async () => {
    session.user = { id: "owner-a", email: "a@example.com" };
    await open();
    expect(host.textContent).toContain("as its owner renamed it");

    /* B signs in where A was. Same root, no unmount — `root.render` reconciles,
       so every piece of state in the tree survives except what the code itself
       decides to drop. */
    session.user = { id: "reader-b", email: "b@example.com" };
    owned = () => json({ error: "not yours" }, 404);
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, createElement(App, null)));
    });

    // Synchronously: A's copy is gone. Not "gone once the fetch lands".
    expect(host.textContent).not.toContain("as its owner renamed it");

    await settle();

    /* And B ends up where B belongs: the public view of a document they do not
       own, which is the same page a stranger gets. */
    expect(host.textContent).toContain("View only");
    expect(host.textContent).toContain("The first paragraph of the piece.");
  });

  it("drops the article when the reader signs out", async () => {
    session.user = { id: "owner-a", email: "a@example.com" };
    await open();
    expect(host.textContent).toContain("as its owner renamed it");

    session.user = null;
    owned = () => json({ error: "no" }, 401);
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, createElement(App, null)));
    });

    expect(host.textContent).not.toContain("as its owner renamed it");
  });
});

/**
 * **The control.** Same harness, same address, a session — and the trace must
 * fill up.
 *
 * Without this, every assertion above would pass just as happily against a spy
 * that saw nothing, a render that threw, or a page that never mounted. The
 * three named endpoints are the three hooks the capability seam exists to keep
 * out, and the POST is the record-open.
 */
/**
 * **A signed-in reader who does not own the document asks for the same things a
 * stranger does.**
 *
 * This is the row in docs/plans/260827ai-public-read-only-access.md § How we prove it
 * that nothing automated has ever satisfied. The server half was measured by an
 * end-to-end spike — three requests, SHA-256, no header versus a garbage bearer
 * versus the real owner's token, byte-identical bodies — and a browser pass
 * confirmed the chrome looks the same. **The client half was proved by a human
 * looking once.**
 *
 * It matters more than it sounds. "Visitor" means *anyone who does not own the
 * document*, and a signed-in one is the likeliest first real use of the feature:
 * somebody with an account follows a colleague's link. If the client asked for
 * anything extra in that case — or asked for the same thing with a token
 * attached — the two readers would stop being served identically, whatever the
 * server does with identical inputs.
 *
 * The existing test for this case checked **copy**, which GPT Sol named in
 * finding 7: it says the page reads the same and nothing at all about what the
 * page asked for.
 *
 * ## The one difference about *this article* that is allowed
 *
 * A signed-in reader's two-step asks the owned route first and falls back on a
 * 404. So their trace carries one extra request — `GET /api/article/:slug` —
 * and it must be **one**. Two more are theirs rather than this article's, and
 * each is pinned as exactly-once below: `GET /api/jobs`, their own queue, and
 * `GET /api/reader`, their own experimental-features switch. Anything else is
 * either a hook that mounted for one reader and not the other, or a public read
 * that quietly went through `apiFetch`.
 */
describe("a signed-in reader who does not own it", () => {
  /** Every request, as a comparable line. Method included: a POST is not a GET. */
  const lines = () => trace.map((r) => `${r.method} ${r.url}`);

  /**
   * Open a view and **use it**, then report what was asked for.
   *
   * The hover is not decoration. A first version compared only the requests a
   * page load makes, and letting a signed-in visitor mount the link lookups
   * changed **nothing** in it — because those fire on `pointerover`, and a
   * comparison that never touches the page cannot see a divergence that needs a
   * pointer. That is the same blind spot blocker 2 lived in, one layer up.
   */
  async function asksFor(view: string): Promise<string[]> {
    await open("", view);
    const link = host.querySelector<HTMLAnchorElement>('a[href^="https://en.wikipedia.org"]');
    if (link) {
      await act(async () => {
        link.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      });
      await act(async () => {
        await new Promise((go) => setTimeout(go, 400));
      });
      await settle();
    }
    return lines();
  }

  it.each([
    ["the reading view", ""],
    ["the metadata page", "/metadata"],
    ["the tweets page", "/tweets"],
  ])("asks for the same things as a stranger on %s", async (_name, view) => {
    const stranger = await asksFor(view);
    /* The fixture must actually make requests, or two empty lists match and
       this proves nothing. */
    expect(stranger.length).toBeGreaterThan(0);

    await remount();
    session.user = { id: "somebody-else", email: "else@example.com" };
    /* Signed in and not the owner: the owned route 404s, and the two-step falls
       through to the public one. */
    owned = () => json({ error: "not yours" }, 404);
    const withAnAccount = await asksFor(view);

    const probe = `GET /api/article/${SLUG}`;
    expect(withAnAccount.filter((l) => l === probe), "the owned probe, exactly once").toHaveLength(
      1,
    );

    /**
     * **The second thing a signed-in reader asks that a stranger does not, and
     * it is not about this article.**
     *
     * The job engine binds to `user.id` and reconciles once when a session
     * begins (src/web/jobEngine.ts), so any signed-in reader makes one
     * `GET /api/jobs` wherever they are — it is *their* queue, and it says
     * nothing about whose article this is. Deliberate, and new on 2026-09-01:
     * before that the poller was mounted by three route-scoped surfaces, which
     * is exactly why clicking into an article stopped an import.
     *
     * Pinned as "exactly once" rather than filtered away, because the rule that
     * makes it acceptable is that it does **not** recur on a reading view with
     * nothing in the queue.
     */
    const sessionPoll = "GET /api/jobs";
    expect(stranger.filter((l) => l === sessionPoll), "a stranger polls nothing").toHaveLength(0);
    expect(
      withAnAccount.filter((l) => l === sessionPoll),
      "one session poll, not a loop",
    ).toHaveLength(1);

    /**
     * **The third thing a signed-in reader asks: their own experimental switch.**
     *
     * The switch lives in one store bound to the session since 2026-09-03
     * (src/web/experimental-store.ts), and the store asks the server only once
     * something subscribes to it. Through stage 1 nothing on these three pages
     * did. Since stage 2 each of them mounts a `Dock`, and the bar is **told**
     * which modes to draw rather than going and getting it — so the page calls
     * `useExperimental()` and the store makes one request per session, on
     * whichever of the three views the reader lands on first.
     *
     * **Exactly one**, not "at least one": the whole reason for a shared store
     * rather than a hook per component is that the three Docks replacing one
     * another as a reader moves around an article must not each fetch, and must
     * not disagree for the length of a toggle. A per-component hook passes
     * everything else in this file and fails this line.
     *
     * That zero above is the load-bearing half, and it is unchanged.
     * `GET /api/reader` is behind the auth gate, so the old per-component hook
     * got its "off" out of a 401 it caught as a load error — the right answer
     * for the wrong reason, and the day a feature went behind the switch it
     * would have turned on for strangers with nothing to say so.
     * docs/reusable/silent-success.md. A stranger asking for it *not at all* is
     * the point of the store rather than a side effect of it, and it is what
     * makes the eight-button bar Greg asked for true by construction.
     */
    const readerSetting = "GET /api/reader";
    expect(
      stranger.filter((l) => l === readerSetting),
      "a stranger asks nothing about a reader profile",
    ).toHaveLength(0);
    expect(
      withAnAccount.filter((l) => l === readerSetting),
      "one read of the switch for the session, not one per Dock",
    ).toHaveLength(1);

    expect(
      withAnAccount.filter((l) => l !== probe && l !== sessionPoll && l !== readerSetting),
    ).toEqual(stranger);
  });

  /**
   * **A signed-in reader who does not own it presses the bar and buys nothing.**
   *
   * The signed-out sweep is not enough on its own, and the difference is real
   * rather than theoretical: a signed-in reader has a session, an
   * `Authorization` header that works, and a running job engine — everything a
   * POST needs except the article. `OwnedReader` is what stops them, and this
   * is the measure of it from outside.
   *
   * `GET /api/jobs` is expected and is theirs: the engine binds to `user.id`
   * wherever they are. What must not appear is a **POST**.
   */
  it("presses every mode in the bar and posts nothing", async () => {
    session.user = { id: "somebody-else", email: "else@example.com" };
    owned = () => json({ error: "not yours" }, 404);
    await open();
    trace.length = 0;

    const buttons = modeRadios();
    expect(buttons.length, "the bar must draw its modes").toBeGreaterThan(0);
    for (const button of buttons) {
      const label = button.getAttribute("aria-label");
      await act(async () => button.click());
      await settle();
      expect(trace.filter((r) => r.method !== "GET"), `after pressing ${label}`).toEqual([]);
    }
  });

  /**
   * **And the public reads carry no token, which is the half a request list
   * cannot show.**
   *
   * Swap `publicFetch` for `apiFetch` in the loaders and every assertion above
   * still passes — same paths, same methods, same count — while a signed-in
   * reader's public requests go out with `Authorization` and a stranger's do
   * not. The server ignores it today, deliberately and structurally
   * (`servePublicApi` is never handed the request), but the client would have
   * stopped asking the same question, and the plan's claim is about what is
   * asked as much as what comes back.
   */
  it("sends no token on anything under /api/public/", async () => {
    session.user = { id: "somebody-else", email: "else@example.com" };
    owned = () => json({ error: "not yours" }, 404);
    await open();

    const publicCalls = trace.filter((r) => r.url.startsWith("/api/public/"));
    expect(publicCalls.length).toBeGreaterThan(0);
    expect(publicCalls.filter((r) => r.auth !== null)).toEqual([]);
    /* And the probe that *is* theirs does carry one — otherwise this passes on
       a client that had stopped authenticating anything at all. */
    const probe = trace.find((r) => r.url === `/api/article/${SLUG}`);
    expect(probe?.auth).toMatch(/^Bearer /);
  });

  /**
   * **And they press the modes, which nothing in this file made them do.**
   *
   * The exhaustive button sweep is in the signed-out describe above, and the
   * parity block here only ever loads a page and hovers a link — so *signed in
   * and not the owner*, pressing a mode, was a state no assertion covered. GPT
   * Sol's mutation for it: inside `Reader`'s `onMode`, issue a private request
   * or a POST when `signedIn` is true and `owner` is null. The signed-out sweep
   * never takes that branch and the parity tests never click, so it survived
   * both. Run against this test it is red on the first press.
   *
   * It is a live shape rather than a contrived one: `signedIn` and
   * `sessionUnconfirmed` legitimately cross the visitor seam now, for copy, so
   * there is real code branching on exactly this pair.
   *
   * Same helpers as the signed-out sweep, deliberately — a second `modeRadios`
   * or a second `BAND_SAYS` lookup here would be a copy that could drift, and
   * the whole claim is that the two readers behave identically.
   */
  it("stays inside the public namespace when the modes are pressed", async () => {
    session.user = { id: "somebody-else", email: "else@example.com" };
    owned = () => json({ error: "not yours" }, 404);
    /* **The switch on, so this sweep still presses all thirteen.** Five modes
       went behind it on 2026-09-03, and this reader is the only one in the file
       who *can* turn it on — a stranger is forcibly off. That makes this the
       exhaustive press sweep, and the signed-out one above reaches the hidden
       five by their URLs instead. Neither count was weakened. */
    experimentalSince = "2026-09-01T00:00:00.000Z";
    await open();
    /* Clears the three requests a signed-in reader legitimately makes that a
       stranger does not — the owned probe, the job engine's one reconciliation,
       and one read of their experimental-features switch. Pinned as *exactly*
       those three by the parity test above; here they are simply out of the way
       before anything is pressed. */
    trace.length = 0;

    const buttons = modeRadios();
    expect(buttons.length, "the bar must draw its modes").toBeGreaterThan(0);

    const pressed: string[] = [];
    for (const button of buttons) {
      const label = button.getAttribute("aria-label");
      const before = modeInUrl();
      await act(async () => button.click());
      await settle();

      /* **`/api/jobs` filtered rather than forbidden**, and only here. The
         engine reschedules itself every `IDLE_MS` for as long as a session
         lasts (src/web/jobEngine.ts), so a sweep of thirteen presses is long
         enough to catch one — a flaky failure that says nothing about the
         press. It is the reader's own queue and carries nothing about this
         article. Every *other* private path, and every non-GET including one to
         `/api/jobs`, is still caught below. */
      const extra = outsidePublic().filter((r) => r.url !== "/api/jobs");
      expect(extra, `after pressing ${label}`).toEqual([]);
      expect(trace.filter((r) => r.method !== "GET"), `after pressing ${label}`).toEqual([]);
      /* And the public reads still carry no token, which is the half a path
         list cannot show — the same claim the test above makes on page load,
         made again after a transition. */
      expect(
        trace.filter((r) => r.url.startsWith("/api/public/") && r.auth !== null),
        `after pressing ${label}`,
      ).toEqual([]);

      expect(button.getAttribute("aria-checked"), `pressing ${label} must select it`).toBe(
        "true",
      );
      const mode = await modeAfterPress(before);
      expect(MODES, `pressing ${label} selected ${mode}`).toContain(mode);
      pressed.push(mode);
      /* The same table the signed-out sweep is judged against: a visitor with
         an account sees the same bands, and the only sentence that differs is
         the ask, which `does not offer an account to a reader who has one`
         covers. */
      expectBandFor(mode as Mode, `after pressing ${label}`);
    }

    expect([...pressed].sort()).toEqual([...MODES].sort());
  }, SWEEP_MS);
});

/**
 * **A 401 is *we do not know whose this is*, and it says nothing about whether
 * the piece is world-readable.**
 *
 * `findArticle` treated 401 exactly like 404 until 2026-09-02 — it fell through
 * to the public route and the reader was silently reclassified as a stranger
 * over their own article, while `useSession` went on saying they were signed
 * in, so nothing ever re-asked. `apiFetch` has already refreshed once and
 * retried once by the time this 401 arrives (src/web/lib/api.ts), and its own
 * comment is explicit that a 401 must not trigger an automatic sign-out.
 *
 * So the public route is still asked and **both** answers decide, which is the
 * table in docs/plans/260902j-public-read-only-access-audit-and-improvements.md
 * § Decisions. The two actions below run the same two lines — a local sign-out
 * and a reload of this same address — and carry different labels because the
 * outcomes genuinely differ: shared, the reload returns the reader here as an
 * ordinary visitor; unshared, it reaches `LandingPage`, which draws sign-in
 * itself and keeps the address. A button that said "sign in again" on the first
 * of those would not do what it says.
 */
describe("when the reader's own session cannot be confirmed", () => {
  it("keeps a shared article on screen, says why, and asks for nothing owner-only", async () => {
    session.user = { id: "somebody", email: "somebody@example.com" };
    /* The 401 `apiFetch` gives up on: it has refreshed and retried already, and
       this is the second refusal. */
    owned = () => json({ error: "no" }, 401);
    await open();

    /* The article is still here, which is the whole point of the amendment —
       an unrelated broken session must not take a world-readable piece away. */
    expect(host.textContent).toContain("The first paragraph of the piece.");
    expect(host.textContent).toContain("View only");
    /* And the reader is told, rather than silently demoted. */
    expect(host.textContent).toContain("couldn't confirm that you're signed in");
    expect(buttonNamed("Continue signed out")).not.toBeNull();
    /* Not the other label: signing in is not what this reload does here. */
    expect(buttonNamed("Sign in again")).toBeNull();

    /* Owner capabilities did not mount. Not a claim about the two probes to
       `/api/article/:slug` — those are the question being asked — but about the
       three hooks the capability seam exists to keep out, and the record-open
       POST. They are the same three the owner control at the foot of this file
       asserts are present. */
    const urls = outsidePublic().map((r) => r.url);
    expect(urls.some((u) => u.startsWith("/api/comments/"))).toBe(false);
    expect(urls.some((u) => u.startsWith("/api/chat/"))).toBe(false);
    expect(urls.some((u) => u.startsWith("/api/glossary/"))).toBe(false);
    expect(trace.filter((r) => r.method === "POST")).toEqual([]);
  });

  /**
   * **And on the other two views, which the case above never opened.**
   *
   * The reading view, the metadata page and the tweets page are one click from
   * each other, and `VisitorArticle` says in as many words that the explanation
   * goes to all three *because* they are (App.tsx § `sessionUnconfirmed`). The
   * C3 tests only ever opened the first, so that guarantee was prose: the
   * no-thread tweets arm dropped both the fact and the action, and nothing went
   * red. GPT Sol's review of stage 1b.
   *
   * **Three rows and not two**, because `/tweets` is two different pages. With a
   * thread it draws the thread and the notice under it; without one it draws the
   * *nobody has built a tweet thread* stand-in — a different component, and the
   * one that was missing the chrome. An article with no thread is the default
   * fixture and an ordinary state, not an edge.
   *
   * The fourth column is what the page itself must be showing, so a row cannot
   * pass by rendering an error page that happens to carry the notice.
   */
  it.each([
    ["the metadata page", "/metadata", ARTICLE, "What has been built for it"],
    [
      "the tweets page, when there is a thread",
      "/tweets",
      { ...ARTICLE, tweets: THREAD },
      PUBLIC_TWEET,
    ],
    [
      "the tweets page, when there is none",
      "/tweets",
      ARTICLE,
      "Nobody has built a tweet thread for this piece yet",
    ],
  ])("says it on %s too", async (_name, view, payload, canary) => {
    session.user = { id: "somebody", email: "somebody@example.com" };
    owned = () => json({ error: "no" }, 401);
    served = payload;
    await open("", view);

    // The page is the one this row is about, before anything is claimed about it.
    expect(host.textContent, "the view must have rendered").toContain(canary);
    /* **Not `View only`**, which is the `ViewOnlyChip` in the *reading view's*
       controls bar and is drawn on none of these three (PublicChrome.tsx). What
       carries the same fact here is `SharedNotice`'s first sentence, so that is
       what is asserted.

       **The wording changed on 2026-09-04**: it was *"Somebody shared this
       article with you"*, which stopped being true the day a public article
       could be found through the public listing rather than through a link
       somebody sent. src/messages.ts § SHARED_WITH_YOU.

       **Asserted as the constant, not as a surviving phrase of it.** This held
       the fragment "shared this article with you", which was a substring of the
       old sentence and is a substring of nothing now — so it went red on `dev`,
       and a grep for the whole old sentence could never have found it. A
       fragment of a shared constant is an assertion that goes red for a
       rewording and green for a rename, which is backwards. */
    expect(host.textContent).toContain(SHARED_WITH_YOU);
    /* The two halves of C3: the fact, and the one action that gets the reader
       off this footing. Neither may depend on which view they wandered to. */
    expect(host.textContent).toContain("couldn't confirm that you're signed in");
    expect(buttonNamed("Continue signed out")).not.toBeNull();
    // Not the other label: the article is shared, so signing in is not what the reload does.
    expect(buttonNamed("Sign in again")).toBeNull();

    /* And still nothing owner-only, which is the standing claim these pages
       exist to keep true — `Metadata` and `Tweets` are unreachable from here. */
    const urls = outsidePublic().map((r) => r.url);
    expect(urls.some((u) => u.startsWith("/api/comments/"))).toBe(false);
    expect(urls.some((u) => u.startsWith("/api/chat/"))).toBe(false);
    expect(urls.some((u) => u.startsWith("/api/glossary/"))).toBe(false);
    expect(trace.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("offers the way back in when the article is not shared either", async () => {
    session.user = { id: "somebody", email: "somebody@example.com" };
    owned = () => json({ error: "no" }, 401);
    publicArticle = () => json({ error: "not shared" }, 404);
    await open();

    expect(buttonNamed("Sign in again")).not.toBeNull();
    /* Not the visitor page: there is no entitlement here to draw one from, and
       "View only" would be a claim about an article nobody has served us. */
    expect(host.textContent).not.toContain("View only");
    expect(host.textContent).not.toContain("The first paragraph of the piece.");
    /* Nor `Not shared`, which is the answer for a reader we *did* identify —
       saying it here would assert something about this document that a 401
       leaves us unable to know.

       **`document` and not `host`, and that is the assertion.** This page
       borrowed the `not-shared` tab title for one afternoon, and a `host`-only
       check passed over it: `useDocumentTitle` writes `document.title` and
       mirrors it into an `aria-live` node appended to `document.body`, so the
       page was silently announcing *"Not shared"* to a screen reader while the
       heading said something else. A browser pass found it, 2026-09-02.
       page-title.ts § reauth-required. */
    expect(host.textContent).not.toContain("Not shared");
    expect(document.title).not.toContain("Not shared");
    expect(document.body.textContent).not.toContain("Not shared");
    /* And not the existing error branch, which is a logo and a `<pre>` with
       nothing to press. */
    expect(host.querySelector("pre")).toBeNull();
  });

  /**
   * **The regression guard.** The ordinary signed-in visitor — somebody else's
   * shared article, own session perfectly good — is the feature's likeliest
   * first real user, and they must not start seeing a warning about it.
   */
  it("says nothing extra to a signed-in visitor whose session is fine", async () => {
    session.user = { id: "somebody-else", email: "else@example.com" };
    owned = () => json({ error: "not yours" }, 404);
    await open();

    expect(host.textContent).toContain("View only");
    expect(host.textContent).toContain("The first paragraph of the piece.");
    expect(host.textContent).not.toContain("couldn't confirm");
    expect(buttonNamed("Continue signed out")).toBeNull();
    expect(buttonNamed("Sign in again")).toBeNull();
  });
});

describe("the same address, as the owner", () => {
  /**
   * **The control the acceptance criterion was written around**, and **the one
   * assertion in this file that changed on purpose on 2026-09-01.**
   *
   * It used to read: the job poller runs for as long as its band is mounted, so
   * the sweep above — every mode as a visitor, nothing outside `/api/public/` —
   * is only worth anything if opening the *same* mode as the owner puts the
   * poller in the trace.
   *
   * That is still true and still checked. What changed is why: the poller is
   * not owned by the band any more. It is a tab-level engine started from
   * `App` on `user.id` (src/web/jobEngine.ts), because `App()` is a chain of
   * early returns and a route change therefore unmounted every surface that
   * drove an ingest — so clicking from the shelf into an article stopped the
   * import. **The owner now polls once wherever they are**, and the band is
   * what keeps it on its idle cadence afterwards.
   *
   * The visitor half of this file is untouched and is not negotiable: nothing
   * calls `start()` for a signed-out reader, so they poll nothing at all.
   */
  it("polls the job list from a band the visitor cannot open", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    await open("?mode=glossary");

    expect(trace.map((r) => r.url)).toContain("/api/jobs");
  });

  /**
   * **The owner asks for their queue on the plain reading view too**, with no
   * band open at all.
   *
   * The comment above this pair used to say the owner's default view "mounts no
   * band at all", and that has not been true for a while: `useArc` runs on
   * every owned reading view and goes through `useStepJob`. So the job list was
   * already being polled here before the engine existed — what the engine adds
   * is the one reconciliation at session start, and that the *driving* no
   * longer stops when this route unmounts.
   *
   * The cadence rule that keeps this from being an unbounded idle poll is
   * pinned deterministically, under fake timers, in
   * `tests/job-engine-drives-with-no-view.test.ts` — there are no fake timers in
   * this file and a count here could only ever be a snapshot of one instant.
   */
  it("asks for its own queue on the default view, with no band open", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    await open();

    expect(trace.filter((r) => r.url === "/api/jobs").length).toBeGreaterThan(0);
    // And it is the owner's queue, not something about this article.
    expect(trace.filter((r) => r.url.startsWith("/api/public/"))).toEqual([]);
  });

  /**
   * **And the owner does get the gutter's chat button** — the control for the
   * absence asserted on the visitor above, which would otherwise pass just as
   * happily against a gutter that had lost its third slot for everybody.
   *
   * *Every* paragraph and not merely one, which is the difference between this
   * and the `> 0` it said at first: one surviving button on one block would
   * have satisfied that while the rest of the article had lost the control.
   * Counted against the permalinks, because every gutter draws exactly one of
   * those and it is the same loop over the same blocks (BlockGutter.tsx).
   */
  it("draws the chat button beside every paragraph", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    await open();

    const gutters = host.querySelectorAll("a.blk-permalink").length;
    expect(gutters, "the prose must have rendered").toBeGreaterThan(0);
    expect(chatButtons().length).toBe(gutters);
  });

  /**
   * **The control for the whole of stage 2, and for every "no POST" above it.**
   *
   * A visitor pressing Ideas must buy nothing, and this file has half a dozen
   * assertions saying so. Every one of them would be equally green over a
   * feature that had never worked — which is
   * docs/reusable/silent-success.md, and is why this is here: the owner, on the
   * same address, pressing the same button, on an article with no ideas, posts
   * a job.
   *
   * Ideas rather than any of the other four because it is the one this fixture
   * can put into the *nobody has built one* state with a single line: the rest
   * of `reply` answers `{}`, which the artefact hooks read as an empty but
   * present artefact.
   */
  it("starts the job when the owner presses a mode nobody has run", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    notBuilt = `/api/ideas/`;
    await open();
    trace.length = 0;

    const ideas = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
      (b) => b.getAttribute("aria-label") === "Ideas",
    );
    expect(ideas, "the bar must draw Ideas").toBeDefined();
    await act(async () => ideas?.click());
    await settle();

    /* The artefact read really happened and really said no, so the POST below
       is a decision rather than an accident of ordering. */
    expect(trace.some((r) => r.url.startsWith("/api/ideas/"))).toBe(true);
    expect(
      trace.filter((r) => r.method === "POST" && r.url === "/api/jobs"),
      "exactly one job, under React's double-invoked effects",
    ).toHaveLength(1);
  });

  /**
   * And **arriving** at the same mode at the same address does not, which is
   * the whole of § 2b in one pair of tests. A pasted link, a shared link, a
   * Back step and a link in from the metadata page all reach the panel this
   * way.
   */
  it("does not start it for an owner who merely arrives at the mode", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    notBuilt = `/api/ideas/`;
    await open("?mode=ideas");

    expect(trace.some((r) => r.url.startsWith("/api/ideas/")), "the GET settled").toBe(true);
    expect(trace.filter((r) => r.method === "POST" && r.url === "/api/jobs")).toEqual([]);
  });

  /**
   * **The fifth of the five, and the only one whose gesture is not a bar
   * button.** Sketch is armed by the chip inside Diagram
   * (`DiagramPanel.tsx` § the kind chips), so nothing in
   * tests/modes-that-start-themselves.test.tsx — which mounts the bar and three
   * probe bands — can reach it. Delete that one `armActivation` call, or
   * `useAutoRun` from `useSketch`, and every other test about stage 2 stays
   * green. GPT Sol, 2026-09-02.
   *
   * The negative twin is *draws no sketch chip on a shared link that names one*
   * in the visitor block above: a visitor gets no chip at all, so there is
   * nothing to press.
   */
  it("draws a picture nobody has drawn when the owner presses the sketch chip", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    notBuilt = `/api/sketch/`;
    await open("?mode=diagram");

    /* **Both halves of the arrival, before the trace is cleared.** The read
       really happened and really said no, so the POST below is a decision
       rather than an accident of ordering — and it happens *here* rather than
       after the press, because since 2026-09-04 Sketch is the picture Diagram
       opens on (params.ts § diagramParam). What the reader meets is the empty
       state's invitation with the price on it, and this is the assertion that
       meeting it costs nothing. */
    expect(trace.some((r) => r.url.startsWith("/api/sketch/")), "the GET settled").toBe(true);
    expect(
      trace.filter((r) => r.method === "POST" && r.url === "/api/jobs"),
      "arriving at Diagram bought a picture",
    ).toEqual([]);
    trace.length = 0;

    const chip = host.querySelector<HTMLButtonElement>('[data-diag-kind="sketch"]');
    expect(chip, "Diagram must draw the sketch chip for its owner").not.toBeNull();
    await act(async () => chip?.click());
    await settle();

    expect(
      trace.filter((r) => r.method === "POST" && r.url === "/api/jobs"),
      "exactly one job, under React's double-invoked effects",
    ).toHaveLength(1);
  });

  /**
   * And **arriving** at the same picture buys nothing, which is the address a
   * reader gets when somebody shares the sketch they were looking at.
   */
  it("does not draw one for an owner who merely arrives at the sketch", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    notBuilt = `/api/sketch/`;
    await open("?mode=diagram&diagram=sketch");

    expect(trace.some((r) => r.url.startsWith("/api/sketch/")), "the GET settled").toBe(true);
    expect(trace.filter((r) => r.method === "POST" && r.url === "/api/jobs")).toEqual([]);
  });

  it("mounts the private hooks and the record-open POST", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    await open();

    const urls = trace.map((r) => r.url);
    expect(urls).toContain(`/api/article/${SLUG}`);
    expect(urls.some((u) => u.startsWith("/api/comments/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/chat/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/glossary/"))).toBe(true);
    expect(trace.filter((r) => r.method === "POST").map((r) => r.url)).toContain(
      `/api/library/${SLUG}/open`,
    );
    // And none of it went to the public namespace: the owner path is untouched.
    expect(trace.filter((r) => r.url.startsWith("/api/public/"))).toEqual([]);
    // The other half of the capability check — see the visitor test above.
    expect(host.textContent).not.toContain("View only");
  });
});
