// @vitest-environment jsdom
/**
 * **The acceptance test for public reading is a network trace, not a
 * screenshot.**
 *
 * A signed-out browser on a shared document must issue **no request outside
 * `/api/public/` and no POST at all**. That sentence is the whole of slice 1a's
 * client half, and a screenshot cannot see it: the page renders correctly
 * either way, and the difference is a stream of 401s behind it that only a
 * trace or a devtools panel shows. docs/plans/public-read-only-access.md § Stage 1.
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
import type { Article } from "../src/types.js";
import type { PublicArticle, PublicMetadata, PublicTweets } from "../src/public-types.js";

/** Who `useSession` says is here. Re-posed by each test before it renders. */
const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
}));

/* Never reached on the visitor path — which is the point — but `lib/api.ts`
   imports it at module load and would go looking for a project URL. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
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

const ARTICLE: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
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
        children: [],
        range: ["spya-aaaaaa", "spya-cccccc"],
        title: "A piece",
        gist: "What the piece says.",
      },
    },
  },
  /**
   * **Asymmetric on purpose, and it is the fixture that makes slice 1b
   * checkable at all.**
   *
   * A glossary and a list of ideas are here; a summary and a tweet thread are
   * not. So one article in one run produces both of the two answers a visitor
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

const METADATA: PublicMetadata = {
  slug: SLUG,
  title: "A piece",
  /* Two `true`s and three `false`s on purpose: a visitor pressing Glossary must
     get a different sentence from one pressing Summary, and a fixture that
     answered the same to every question could not tell that apart. */
  available: { arc: false, tweets: false, glossary: true, summary: false, ideas: false },
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
 * What the public article endpoint serves — `ARTICLE` unless a case says
 * otherwise, and reset in `beforeEach` so one test cannot leak into the next.
 */
let served: PublicArticle;

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
  if (url === `/api/public/article/${SLUG}`) return json(served);
  if (url === `/api/public/metadata/${SLUG}`) return json(METADATA);
  if (url === `/api/article/${SLUG}`) return owned();
  if (method === "POST") return new Response(null, { status: 204 });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/chat/")) return json({ threads: [] });
  if (url.startsWith("/api/glossary/")) return json({ status: "none", glossary: null });
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

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  session.user = null;
  served = ARTICLE;
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
  await settle();
}

const outsidePublic = () => trace.filter((r) => !r.url.startsWith("/api/public/"));

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
     * **One request, and it used to be two.** `GET /api/public/metadata/:slug`
     * was fetched immediately after the article, purely so a marked mode could
     * pick between two true sentences, with its failure swallowed to `null`.
     * The artefacts ride on the article payload since slice 1b, so the payload
     * answers that question and the request is gone. The endpoint itself stays
     * — it is still in the route inventory and still tested — which is why this
     * asserts the exact list rather than a prefix.
     * docs/plans/public-read-only-access.md § The second request disappears.
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
   */
  it("stays inside the public namespace through every mode", async () => {
    for (const mode of ["glossary", "summary", "ideas", "search", "chat", "review", "diagram"]) {
      trace.length = 0;
      await open(`?mode=${mode}`);
      expect(outsidePublic()).toEqual([]);
      await remount();
    }
  });

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
   * The fixture is asymmetric on purpose — `glossary: true`, `summary: false` —
   * so the two artefact sentences are produced by one article in one run, which
   * is the arrangement in which "they blurred into one" is visible.
   */
  it("tells an artefact it has from one nobody built, on screen", async () => {
    await open("?mode=summary");
    /* No `summary` key on the payload — nobody built one. This is the state the
       browser pass could not reach, because the article it drove had every
       artefact. */
    expect(host.textContent).toContain("Nobody has built a summary for this piece yet");
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
  it("says an artefact came back empty, rather than that nobody built one", async () => {
    /* Present and empty, both of them. `artefactsIn` reports the artefact off
       the *key*, so the band mounts the panel rather than answering
       *not-built* — which is exactly the branch a length test would delete. */
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
   * so a panel handed a nulled-out owner shape instead of `owner: null` would
   * render all of them and leave the trace spotless. src/web/GlossaryPanel.tsx
   * § GlossaryOwner.
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
   * The dock buttons carry an accessible name, so the sweep asks for them the
   * way a reader would rather than by class.
   */
  it("stays inside the public namespace when the modes are pressed", async () => {
    await open();
    trace.length = 0;

    for (const label of ["Summary", "Glossary", "Ideas", "Search", "Diagram", "Chat", "Review"]) {
      const button = [...host.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
      expect(button, `the bar must offer ${label}`).toBeDefined();
      await act(async () => button?.click());
      await settle();
      expect(outsidePublic(), `after pressing ${label}`).toEqual([]);
    }

    /* And the presses really did move the band — otherwise this passes by
       clicking seven dead buttons. */
    expect(host.textContent).toContain("Review is for whoever added this article");
  });

  it("opens the comments drawer without asking for anybody's comments", async () => {
    await open("?panel=questions");
    expect(outsidePublic()).toEqual([]);
    /* And it says whose they would be, rather than "nothing asked yet" — which
       is what an empty owner drawer says, and would be a false claim here. */
    expect(host.textContent).toContain("belong to whoever added this article");
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
 * This is the row in docs/plans/public-read-only-access.md § How we prove it
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
 * ## The one difference that is allowed, and why it is exactly one
 *
 * A signed-in reader's two-step asks the owned route first and falls back on a
 * 404. So their trace carries one extra request — `GET /api/article/:slug` —
 * and it must be **one**, and it must be the only difference. Anything else is
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
    expect(withAnAccount.filter((l) => l !== probe)).toEqual(stranger);
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
});

describe("the same address, as the owner", () => {
  /**
   * **The control the acceptance criterion was written around**: `useJobs`
   * polls `GET /api/jobs` for as long as its band is mounted, and it mounts
   * inside `GlossaryBand`, `SummaryBand` and `IdeasBand`. So the sweep above,
   * which opens every mode as a visitor and finds nothing outside
   * `/api/public/`, is only worth anything if opening the *same* mode as the
   * owner puts the poller in the trace. This is that half.
   *
   * It is a separate test from the one below because it needs a mode: the
   * owner's default view is the table of contents, which mounts no band at
   * all — so a control that only opened the default address would have proved
   * the three hooks and said nothing whatever about `useJobs`.
   */
  it("polls the job list from a band the visitor cannot open", async () => {
    session.user = { id: "owner-1", email: "greg@example.com" };
    await open("?mode=glossary");

    expect(trace.map((r) => r.url)).toContain("/api/jobs");
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
