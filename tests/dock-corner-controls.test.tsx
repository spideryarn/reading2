// @vitest-environment jsdom
/**
 * **One way home per page, and never two Feedback buttons — asserted by walking
 * the routes rather than by reading them.**
 *
 * On 2026-09-06 the wordmark and the Feedback button left the top corners of
 * the window on the pages that mount a `Dock` — the article, its metadata page
 * and its tweets page, each in an owner's and a visitor's shape, so three
 * addresses and six components — and became children of that
 * bar (`.dock-home`, `.dock-feedback`). Every other page kept its corners
 * exactly as they were.
 * docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md.
 *
 * That change is **positional**, which is why this file boots the real router
 * rather than rendering a component with props by hand. Nothing about either
 * control's own code says which pages draw it: the answer is where the elements
 * sit relative to `if (!user)`, relative to `ArticlePage`'s six branches, and
 * relative to the `Dock` those branches do or do not mount. A refactor that
 * moves a mount point breaks the rule without touching a single expression —
 * the same argument tests/feedback-button-visibility.test.tsx makes about the
 * corner button's one line, and the reason that file exists too.
 *
 * The two failures this is aimed at, and they are opposite shapes:
 *
 *  - **Two ways home on one screen.** A `<HomeLogo />` left behind on a page
 *    that now draws `DockHome` gives a reader two, one of them fixed over the
 *    top 44px of the spine on a phone that has scrolled its bars away — which
 *    is the live bug this move dissolves rather than fixes,
 *    docs/postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md.
 *  - **None at all.** `ArticlePage`'s final branch lost its `<HomeLogo />`, and
 *    the four branches that mount no `Dock` had to keep theirs, or a reader
 *    waiting for an article — or looking at one that failed — is on a page with
 *    no way off it and nowhere to report it from.
 *
 * ## Why "at most one" is not enough on its own
 *
 * GPT Sol's G2: a count of *at most one* passes just as happily with **one
 * wrong button**. `VisitorDock` in PublicPages.tsx draws a bar for a signed-out
 * stranger, and a Feedback trigger rendered in it unconditionally would be a
 * button whose `POST` can only answer 401. So the signed-out shared article has
 * its own case below asserting **none**, and it is not a refinement of the walk
 * — it is the assertion the walk cannot make.
 *
 * ## What this file cannot see
 *
 * jsdom has no layout, so nothing here can tell a bar that fits from one that
 * overflows, and nothing here can see that `.fb-button` reused inside the bar
 * would **paint in the top-right corner**. The classes are the proxy for that
 * (tests/feedback-button-tooltip.test.tsx § in the bar), and a browser pass is
 * the only thing that can settle it.
 *
 * The harness — the session mock, the auth listeners, the three missing browser
 * APIs, the fixture — is the shape tests/public-network-trace.test.tsx
 * established and tests/a-broken-mode-leaves-the-article-readable.test.tsx
 * borrowed. This one borrows it again, cut down to the smallest article that
 * still renders every one of the six branches.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { readerCssNoComments } from "./helpers/stylesheets.js";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/types.js";
import type { PublicArticle } from "../src/public-types.js";
/* Type-only, so it does not drag `Dock.tsx` — and `lib/api.ts`'s
   `onAuthStateChange` subscription behind it — above `authListeners`. */
import type { DockExperimental } from "../src/web/Dock.js";
import {
  EXPERIMENTAL_OFF,
  EXPERIMENTAL_SIGNED_OUT,
} from "./helpers/experimental-fixtures.js";

/** Who `useSession` says is here. Re-posed by each case before it renders. */
const session: { user: { id: string; email: string } | null } = { user: null };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false }),
}));

/**
 * Whoever is listening to auth events — the experimental-features store, which
 * subscribes here itself rather than being told by an effect in `App.tsx`.
 * `show()` below delivers the current session to them, and it matters here more
 * than anywhere: `experimental.signedIn` is what gates the bar's Feedback
 * trigger, and a run that never fired the event would leave every bar looking
 * like a stranger's.
 */
const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/* The three browser APIs the reading view uses that jsdom does not have. None
   can affect what this file counts — they observe layout. */
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
/* `Reader` calls `CSS.escape` on every render that has sections in it, and the
   fixture below has one. The identity function is enough — these block ids need
   no escaping — and a real browser has the real one. */
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

const SLUG = "a-piece";

/* Two blocks and a two-node tree: the smallest article that gives Outline
   something to draw and the spine something to be. */
const BLOCKS = [
  {
    id: "spya-aaaaaa",
    tag: "h1" as const,
    kind: "heading" as const,
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb",
    tag: "p" as const,
    kind: "text" as const,
    text: "The first paragraph of the piece.",
    words: 6,
    html: "<p>The first paragraph of the piece.</p>",
    gistable: true,
  },
];

const TREE = {
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
      range: ["spya-aaaaaa", "spya-bbbbbb"] as [string, string],
      title: "A piece",
      gist: "What the piece says.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-bbbbbb", "spya-bbbbbb"] as [string, string],
      title: "The argument it makes",
      gist: "Where the piece gets to.",
    },
  },
};

/* `navLabelStatus` is required on both types and neither fixture set it — this
   file and the field arrived on `dev` from two different branches on 2026-09-06,
   so each was right about its own half and the pair did not typecheck. `"ready"`
   because the tree here is fully built: nothing in this file is about labels. */
const OWNED: Article = {
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
};

const SHARED: PublicArticle = {
  meta: { slug: SLUG, title: "A piece", byline: "Somebody" },
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  comments: [],
  searches: [],
};

/**
 * How `/api/article/:slug` answers, and it is the switch that selects which of
 * `ArticlePage`'s six branches a case lands on.
 *
 * A function rather than a payload because three of the six are *statuses*
 * rather than articles: 404 sends the reader to the public route, 401 leaves
 * ownership open (`reauth-required` once the public route also refuses), and a
 * rejection is the `error` branch.
 */
let ownedReply: () => Response | Promise<Response> = () =>
  json(OWNED as unknown as Record<string, unknown>);
/** How the public route answers. 404 here is *nobody shared it*. */
let publicReply: () => Response = () => json(SHARED as unknown as Record<string, unknown>);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* **Dynamic, all three, and it is not only speed.** `src/web/lib/api.ts`
   subscribes to `onAuthStateChange` at module load, and every one of these
   pulls it in — so a static import at the top of this file would run that
   subscription before `authListeners` above had been initialised, and the whole
   suite would fail to load rather than fail a test. `vi.mock` is hoisted above
   this line, so the mocks are already in place.
   tests/public-network-trace.test.tsx says the same about its own two. */
const { App } = await import("../src/web/App.js");
const { Dock, fitSignature, visibleModes } = await import("../src/web/Dock.js");
const { FeedbackHost, FEEDBACK_TRIGGER_SELECTOR } = await import("../src/web/FeedbackButton.js");
/* The shelf's masthead case asks whether the Feedback trigger joined the row
   `Profile` is in, and this is that link's address rather than a second copy of
   the string. Down here with the others because `router.js` is what `App.js`
   above already pulled in. */
const { PROFILE_HREF } = await import("../src/web/router.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.user = null;
  ownedReply = () => json(OWNED as unknown as Record<string, unknown>);
  publicReply = () => json(SHARED as unknown as Record<string, unknown>);
  /* The switch's store is a module singleton and keeps the last case's session,
     so an event is not news unless it is reset first. */
  resetExperimental();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.startsWith(`/api/article/${SLUG}`)) return ownedReply();
    if (url.startsWith("/api/public/article/")) return publicReply();
    if (url.startsWith("/api/library")) return json([]);
    if (url === "/api/jobs") return json({ jobs: [] });
    /* The three endpoints whose *shape* the pages below read into rather than
       merely test for, so a bare `{}` throws where a real answer would not.
       Everything else is answered `{}`, which every hook here treats as
       "nothing built yet". */
    if (url.startsWith("/api/metadata/")) return json({ stages: [] });
    if (url === "/api/models") return json({ tasks: [] });
    if (url === "/api/public/library") return json({ entries: [], truncated: false });
    /* 404, and it is the ordinary answer: most articles have no thread. A 200
       with `{}` in it is the one thing the page cannot read. */
    if (url.startsWith("/api/tweets/")) return json({}, 404);
    return json({});
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

/** The whole app, at one address, with the session delivered and settled. */
async function show(path: string): Promise<void> {
  history.replaceState(null, "", path);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await act(async () => {
    const posed = session.user === null ? null : { user: session.user };
    for (const fn of [...authListeners]) {
      fn(session.user === null ? "SIGNED_OUT" : "SIGNED_IN", posed);
    }
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * **Every way home on screen, however it is drawn.**
 *
 * Both classes, because the whole subject of this file is that a page has one
 * of them and never both, and a counter that knew only one of the two could not
 * see the failure. `document` and not `host`: the corner controls are
 * `position: fixed` children of the app's own tree, but a portal is exactly the
 * sort of thing that would move one out of it without changing what a reader
 * sees.
 */
const waysHome = () => document.querySelectorAll(".logo-home, .dock-home");
/**
 * Every Feedback trigger, **in every shape there is**, for the same reason.
 *
 * The selector used to be `.fb-button, .dock-feedback`, typed out here — and
 * that is a hand-maintained list of the shapes that existed the day it was
 * written. When the third shape arrived on 2026-09-08 it would have gone on
 * passing while quietly covering one page fewer: a masthead trigger matching
 * neither class is *uncountable*, so a shelf drawing two buttons would have
 * counted as one and this file would have been green about it. The list is
 * `FEEDBACK_TRIGGER_SELECTOR` now, derived from `FEEDBACK_SHAPE` itself, so a
 * fourth shape is counted by existing.
 * docs/reusable/silent-success.md; tests/feedback-button-tooltip.test.tsx §
 * every shape is countable holds up the other end, that each shape really does
 * render the hook class the selector is built from.
 */
const feedbackTriggers = () => document.querySelectorAll(FEEDBACK_TRIGGER_SELECTOR);

/** A reader, posed before `show`. */
function signIn(): void {
  session.user = { id: "reader-1", email: "reader@example.com" };
}

/**
 * The addresses a signed-in reader can be at that are **not** under `/read/`.
 *
 * The shelf is excluded and gets its own case: it is home, so a link to it
 * would be a dead control, and it is the one page in the app that deliberately
 * draws no way home at all. Every other one of these draws the corner pair.
 */
const PLAIN_ROUTES = [
  /* The address goes in the *path*, not in a query string — a bare `/add`
     lands on the shelf, which draws no way home at all and would fail this
     case for the wrong reason. router.ts § `/add` without the slash. */
  "/add/https://example.com/a",
  "/privacy",
  "/features",
  "/contact",
  "/pricing",
  "/profile",
  "/read/public",
  "/an-address-nobody-minted",
];

describe("the route walk: one way home, never two triggers", () => {
  it.each(PLAIN_ROUTES)("signed in at %s: the corner pair, and only that", async (path) => {
    signIn();
    await show(path);
    expect(waysHome(), `${path} drew ${waysHome().length} ways home`).toHaveLength(1);
    expect(document.querySelector(".logo-home"), `${path} lost its corner`).not.toBeNull();
    expect(feedbackTriggers()).toHaveLength(1);
    expect(document.querySelector(".fb-button")).not.toBeNull();
    /* Nothing from the bar's vocabulary on a page that has no bar. Without this
       the case above passes on a page that grew a `Dock` nobody meant it to
       have — which is the mistake the plan's *"the Dock takes them where there
       is a Dock"* rule invites. */
    expect(document.querySelector(".dock")).toBeNull();
  });

  /**
   * **The shelf is home**, so a link to it is a dead control and `App.tsx` draws
   * none. It is the control for the walk above: without it, a version of this
   * file that found one way home on every page would be indistinguishable from
   * one that could not tell the pages apart.
   *
   * **And its Feedback button is in its own masthead row, not in the corner**,
   * since 2026-09-08 — the third place a trigger can be, and the second time a
   * page with chrome of its own has taken the button out of the window's
   * corner. Greg filed the corner button as missing from this page while it was
   * drawn on it (SPIDERYARN-READING2-2C); the corner is where a reader looking
   * at the shelf's own `Profile`/`Admin` cluster does not look.
   * docs/plans/260908e-feedback-button-in-the-shelf-masthead.md.
   *
   * The `.fb-button` assertion is the load-bearing half. Without it this case
   * passes on a shelf drawing **both** — the count would say two and fail, but
   * only because of the count; naming the corner class says *which* one is
   * supposed to be gone, which is the thing App.tsx's one line decides.
   */
  it("the shelf draws no way home, and puts Feedback in its masthead", async () => {
    signIn();
    await show("/");
    expect(waysHome()).toHaveLength(0);
    expect(feedbackTriggers()).toHaveLength(1);
    expect(document.querySelector(".fb-masthead"), "the shelf lost its trigger").not.toBeNull();
    expect(document.querySelector(".fb-button"), "the corner button came back").toBeNull();
    /* **Inside the shelf's own header**, and not merely somewhere on the page.
       A trigger rendered at the bottom of the shelf would satisfy every line
       above — it is the position that was the whole complaint, and position is
       the one thing a class name does not carry. This is as close to it as
       jsdom gets: the header is the element the `Profile` link is in. */
    const header = document.querySelector("header");
    expect(header?.querySelector(".fb-masthead"), "not in the masthead row").not.toBeNull();
    expect(
      header?.querySelector(`a[href="${PROFILE_HREF}"]`),
      "the row this is supposed to have joined is not here",
    ).not.toBeNull();
  });

  /**
   * **The three pages that mount a `Dock` for their owner** — and the whole
   * point of the change. One way home, in the bar; one Feedback trigger, in the
   * bar; and nothing left in either corner.
   */
  it.each([
    ["the reading view", `/read/${SLUG}`],
    ["the metadata page", `/read/${SLUG}/metadata`],
    ["the tweets page", `/read/${SLUG}/tweets`],
  ])("%s draws both controls in the bar and neither in a corner", async (_name, path) => {
    signIn();
    await show(path);
    expect(document.querySelector(".dock"), "no bar on a page that mounts one").not.toBeNull();
    expect(waysHome()).toHaveLength(1);
    expect(document.querySelector(".dock-home")).not.toBeNull();
    expect(document.querySelector(".logo-home"), "the corner wordmark came back").toBeNull();
    expect(feedbackTriggers()).toHaveLength(1);
    expect(document.querySelector(".dock-feedback")).not.toBeNull();
    expect(document.querySelector(".fb-button"), "the corner button came back").toBeNull();
  });

  /**
   * **The bar's wordmark is not a fourteenth mode**, in the three ways the
   * markup is supposed to say so — outside the radiogroup, a link, and not
   * wearing the class whose hover paints a wash.
   */
  it("the bar's wordmark stays outside the mode segment", async () => {
    signIn();
    await show(`/read/${SLUG}`);
    const home = document.querySelector(".dock-home") as HTMLElement;
    expect(home.tagName).toBe("A");
    expect(home.closest('[role="radiogroup"]'), "it is inside the modes").toBeNull();
    expect(home.classList.contains("dock-btn"), "it would inherit the hover wash").toBe(false);
    expect(home.getAttribute("aria-current")).toBeNull();
    expect(home.getAttribute("aria-checked")).toBeNull();
  });

  /**
   * **And the radiogroup still announces the visible modes.**
   *
   * Against `visibleModes` rather than against a number: there are fourteen
   * modes and five of them are experimental, so a literal count in a test is
   * either wrong today or an invitation to delete a live mode to make it pass.
   * GPT Sol, G6. What it is really guarding is the wordmark and the Feedback
   * button having been added *outside* the group — a `DockHome` rendered as a
   * child of `.dock-modes` would move this number by one and nothing else in
   * this file would notice.
   */
  it("the modes still announce as a radiogroup of the visible set", async () => {
    signIn();
    await show(`/read/${SLUG}`);
    const group = document.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group?.querySelectorAll('[role="radio"]')).toHaveLength(
      visibleModes(false, "plain").length,
    );
  });

  /**
   * **The four branches of `ArticlePage` with no bar keep the corner pair.**
   *
   * These are the branches `App.tsx`'s `route.kind !== "read"` gate stops
   * covering, so each has to draw the corner trigger itself. A reader waiting
   * on an article, or looking at one that failed, is a *likely* author of a bug
   * report — losing the button there would be losing it exactly where it is
   * most wanted.
   *
   * `loading` is reached by never answering the fetch; `error` by rejecting it;
   * `not-shared` by refusing both routes; `reauth-required` by the owned route
   * answering 401 and the public one 404, which is the one state where we know
   * neither whose this is nor whether anybody may read it.
   */
  it("waiting for the article: the corner pair, no bar", async () => {
    signIn();
    ownedReply = () => new Promise<Response>(() => {});
    await show(`/read/${SLUG}`);
    expect(document.querySelector(".dock")).toBeNull();
    expect(waysHome()).toHaveLength(1);
    expect(document.querySelector(".logo-home")).not.toBeNull();
    expect(feedbackTriggers()).toHaveLength(1);
  });

  it("the article failed to load: the corner pair, no bar", async () => {
    signIn();
    ownedReply = () => Promise.reject(new Error("the network went away"));
    await show(`/read/${SLUG}`);
    expect(document.querySelector(".dock")).toBeNull();
    expect(waysHome()).toHaveLength(1);
    expect(feedbackTriggers()).toHaveLength(1);
  });

  it("signed in, and it is not shared: the corner pair, no bar", async () => {
    signIn();
    ownedReply = () => json({}, 404);
    publicReply = () => json({}, 404);
    await show(`/read/${SLUG}`);
    expect(document.querySelector(".dock")).toBeNull();
    expect(waysHome()).toHaveLength(1);
    expect(feedbackTriggers()).toHaveLength(1);
  });

  it("the session cannot be confirmed: the corner pair, no bar", async () => {
    signIn();
    ownedReply = () => json({}, 401);
    publicReply = () => json({}, 404);
    await show(`/read/${SLUG}`);
    expect(document.querySelector(".dock")).toBeNull();
    expect(waysHome()).toHaveLength(1);
    expect(feedbackTriggers()).toHaveLength(1);
  });
});

/**
 * **A stranger gets no Feedback trigger anywhere, and this is its own claim.**
 *
 * The counts above are *at most one*, and GPT Sol's point is that such a count
 * passes with one wrong button. `VisitorDock` draws a bar for a signed-out
 * reader on a shared link, so a trigger rendered in it without a gate would be
 * a control whose `POST /api/feedback` can only answer 401 — and every "at most
 * one" assertion in this file would have stayed green.
 *
 * The other half of the rule is the server's, in tests/feedback-route.test.ts,
 * and neither is evidence without the other: a button the client does not draw
 * is not a gate.
 */
describe("a signed-out stranger on a shared article", () => {
  it("gets a bar with a way home in it and no Feedback trigger at all", async () => {
    await show(`/read/${SLUG}`);
    expect(document.querySelector(".dock"), "no bar for a visitor").not.toBeNull();
    expect(feedbackTriggers(), "a stranger was offered a report box").toHaveLength(0);
    /* The way home is still theirs: a stranger has the most need of something
       on screen that says what this site is. */
    expect(waysHome()).toHaveLength(1);
    expect(document.querySelector(".dock-home")).not.toBeNull();
  });

  it("gets none on the visitor metadata and tweets pages either", async () => {
    for (const view of ["metadata", "tweets"]) {
      await show(`/read/${SLUG}/${view}`);
      expect(feedbackTriggers(), `a stranger was offered one on ${view}`).toHaveLength(0);
      expect(waysHome()).toHaveLength(1);
      await act(async () => root.unmount());
      root = createRoot(host);
    }
  });
});

/**
 * **The bar's own gate, which the route walk above cannot see.**
 *
 * `Dock` draws the Feedback trigger only when `experimental.signedIn` — GPT
 * Sol's G2, because `VisitorDock` mounts a bar for a signed-out stranger and a
 * report from one has nowhere to go. `FeedbackTrigger` *also* renders nothing
 * when it finds no `FeedbackHost` above it, and for a signed-out reader there
 * is none, so **the two gates agree on every page the router can produce** and
 * the walk cannot tell them apart.
 *
 * That was measured rather than assumed: deleting the `experimental.signedIn`
 * condition from `Dock.tsx` left all twenty-two cases above green. So this
 * describe puts the bar in the one arrangement the router never does — a host
 * present, and the bar told nobody is signed in — which is the only way to ask
 * whether the gate is there at all. Without it the gate is a line of code no
 * test has an opinion about, which is how a belt-and-braces pair quietly
 * becomes one brace.
 *
 * The pair is still worth keeping. They answer different questions — *is there
 * an account for a report to belong to* and *is there a box to open* — and they
 * come apart in the frame between `useSession` reporting a reader and the
 * experimental store hearing the same event.
 */
describe("the bar's Feedback trigger is gated on its own", () => {
  /** The bar alone, inside a host, so the only gate left is `Dock`'s. */
  async function bar(experimental: DockExperimental): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(
            FeedbackHost,
            null,
            createElement(Dock, { slug: SLUG, view: "article", experimental }),
          ),
        ),
      );
    });
  }

  it("draws none when the bar is told nobody is signed in", async () => {
    await bar(EXPERIMENTAL_SIGNED_OUT);
    expect(host.querySelector(".dock"), "no bar rendered at all").not.toBeNull();
    expect(host.querySelector(".dock-feedback")).toBeNull();
  });

  /* The control. Without it this describe would pass just as happily against a
     bar that never draws the trigger at all — which is the shape
     docs/reusable/silent-success.md warns about and the one an absence
     assertion is most prone to. */
  it("draws one when it is told somebody is — the control", async () => {
    await bar(EXPERIMENTAL_OFF);
    expect(host.querySelector(".dock-feedback")).not.toBeNull();
  });

  /* And the wordmark is not gated on anything: a stranger needs the way home
     more than an owner does, not less. */
  it("draws the wordmark either way", async () => {
    await bar(EXPERIMENTAL_SIGNED_OUT);
    expect(host.querySelector(".dock-home")).not.toBeNull();
  });
});

/**
 * **The fit signature has to see the Feedback trigger appear.**
 *
 * `useDockFit` re-measures on this string and on nothing else that can notice a
 * content change: the `ResizeObserver` watches the bar's own `100vw` box, which
 * does not move when the row inside it grows (dock-fit.ts § when it
 * re-measures). So a button that arrives without moving the string leaves the
 * bar on a rung chosen for a narrower row — an honest overflow the reader has
 * to drag, rather than a clip, but wrong. Fable's item 2, and the same finding
 * GPT Sol made about the switch's warning marker a stage earlier.
 */
describe("the fit signature", () => {
  const noop = () => {};
  const sig = (feedback: boolean) =>
    fitSignature(visibleModes(false, "plain"), "plain", noop, undefined, null, "ready", feedback);

  it("changes when the Feedback trigger appears", () => {
    expect(sig(true)).not.toBe(sig(false));
  });

  it("is the same string for the same bar", () => {
    expect(sig(true)).toBe(sig(true));
  });
});

/**
 * **And nothing is left holding the space open — stage 2 of the same plan.**
 *
 * The controls were only half of it. The two sticky bars on the reading view
 * reserved the corners in `padding`, and five `<main>` elements on the pages
 * that mount a `Dock` reserved the wordmark's height in top padding, and none
 * of that moved when the controls did. Stage 1 left it standing on purpose and
 * said so in `FeedbackButton.tsx`; this is what took it out.
 *
 * **Source text rather than a rendered box**, for the reason the file above
 * gives: jsdom has no layout, so a padding is a string here whatever else it
 * is. What it can do is what a reader cannot — check every declaration in a
 * 15,000-line stylesheet at once, which is how the third, fourth and fifth
 * copies of the reservation came to be missed by two rounds of review (GPT
 * Sol's G4).
 *
 * Comments are stripped first. `styles.css` quotes its own declarations in
 * prose constantly — this change *added* four such quotations, of the very
 * expressions being asserted absent — so a check that read it raw would be
 * satisfied by a sentence about the code, which is
 * docs/reusable/silent-success.md's exact shape.
 */
describe("nothing reserves the corners they left", () => {
  /* The reading-view sheets as a set. `src/web/styles.css` has held nothing
     but `@import`s since the split on 2026-09-06, so that path alone would
     find no declarations at all — the positive control below is what turns
     that into a red test rather than a quiet one. */
  const stylesheet = readerCssNoComments();

  /** Every `padding…` declaration whose value names `token`. */
  const paddingsNaming = (token: string): string[] =>
    [...stylesheet.matchAll(/([a-z-]*padding[a-z-]*)\s*:\s*([^;{}]*)/g)]
      .filter((m) => (m[2] ?? "").includes(token))
      .map((m) => `${m[1]}: ${(m[2] ?? "").trim()}`);

  it("no padding anywhere holds room for the wordmark or the button", () => {
    /* The scanner first, or an assertion that finds nothing proves nothing: the
       masthead's own vertical padding carries `--safe-top`, so this is a term
       that is genuinely in a padding and has to be found. */
    expect(paddingsNaming("--safe-top").length).toBeGreaterThan(0);

    expect(paddingsNaming("--logo-w")).toEqual([]);
    expect(paddingsNaming("--feedback-w")).toEqual([]);
  });

  /**
   * `3.5rem` is `2.5rem` of ordinary space plus **one rem** of clearance for the
   * corner pair — not `--bar-h`, which is 2.75rem and which an earlier draft of
   * this comment claimed (GPT Sol, T3). It is a number each page chose, not a
   * quantity derived from the control's height, and the three that keep it keep
   * it because they still draw the pair.
   *
   * Both halves are asserted: the pages that gave the corner pair to their
   * `Dock` no longer hold the room, and the pages that still draw the pair
   * still do — the second is what stops this passing on a tree where somebody
   * simply deleted the number everywhere.
   */
  it("and no page with a Dock still holds the wordmark's height above it", () => {
    const src = (file: string) =>
      readFileSync(path.join(import.meta.dirname, "../src/web", file), "utf8");

    for (const file of ["Metadata.tsx", "Tweets.tsx", "PublicPages.tsx"]) {
      expect(src(file), `${file} still reserves the corner`).not.toContain("pt-[calc(3.5rem");
      expect(src(file), `${file} lost its top padding`).toContain("pt-[calc(2.5rem");
    }
    for (const file of ["ProfilePage.tsx", "ContactPage.tsx", "PrivacyPage.tsx"]) {
      expect(src(file), `${file} draws the corner pair and needs the room`).toContain(
        "pt-[calc(3.5rem",
      );
    }
  });
});
