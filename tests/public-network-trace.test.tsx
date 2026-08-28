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
 * ## Why the spy is on `globalThis.fetch` and not on `apiFetch`
 *
 * Because `apiFetch` is one of the things being tested. A spy on it would see
 * only the requests that went through the module we already know about, and the
 * failure this is guarding against is a hook mounting somewhere nobody
 * remembered. Every request in the client ends at `fetch`, including
 * `public-api.ts`'s deliberately plain one, so that is where the trace is taken.
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
import type { PublicArticle, PublicMetadata } from "../src/public-types.js";

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
};

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
  ...ARTICLE,
  meta: { ...ARTICLE.meta, title: "A piece, as its owner renamed it", url: "https://example.com/a" },
};

/**
 * How the **owned** route answers. A 404 is what a signed-in reader gets for
 * somebody else's article, and it is the only way to reach the case that
 * matters most to the chrome: a visitor who has an account.
 */
let owned: () => Response;

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
  if (url === `/api/public/article/${SLUG}`) return json(ARTICLE);
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

/** The whole app, at a shared article's address. */
async function open(search = ""): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await settle();
}

const outsidePublic = () => trace.filter((r) => !r.url.startsWith("/api/public/"));

describe("a signed-out browser on a shared document", () => {
  it("asks the two public endpoints and nothing else", async () => {
    await open();

    expect(host.textContent).toContain("The first paragraph of the piece.");
    /* **The chrome, asserted beside the trace, and the trace alone is not
       enough.** A page could ask only the public endpoints and still hand the
       reading view an owner capability — the hooks would fetch from
       `OwnedReader` either way, so the trace would not notice. The label is
       what the capability actually decides, so it is checked here and its
       absence is checked in the owner control below. */
    expect(host.textContent).toContain("View only");
    expect(trace.map((r) => r.url)).toEqual([
      `/api/public/article/${SLUG}`,
      `/api/public/metadata/${SLUG}`,
    ]);
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
  it("tells a missing artefact from one we do not carry yet, on screen", async () => {
    await open("?mode=summary");
    /* `summary: false` — nobody built one. This is the state the browser pass
       could not reach. */
    expect(host.textContent).toContain("Nobody has built a summary for this piece yet");

    await remount();

    await open("?mode=glossary");
    /* `glossary: true` — it exists, and slice 1b has not shipped the endpoint
       that would carry it. A different sentence, and it has to be. */
    expect(host.textContent).toContain("does not carry it yet");
    expect(host.textContent).not.toContain("Nobody has built");
  });

  /**
   * The offer is the one thing keyed on *am I signed in* rather than on *is
   * this mine* — a browser pass read "Make a free account" put to somebody
   * already holding one as a page that had not noticed them. The **reason** is
   * shown to everybody; only the ask is conditional.
   */
  it("does not offer an account to a reader who has one", async () => {
    await open("?mode=chat");
    expect(host.textContent).toContain("Chat is for signed-in readers");
    expect(host.textContent).toContain("Make a free account");

    await remount();

    session.user = { id: "somebody-else", email: "else@example.com" };
    /* Signed in, and not the owner: `/api/article/:slug` 404s, so the two-step
       falls through to the public route and this is a *visitor* who has an
       account. The chrome is identical; the ask is not. */
    owned = () => json({ error: "not yours" }, 404);
    await open("?mode=chat");

    expect(host.textContent).toContain("View only");
    expect(host.textContent).toContain("Chat is for signed-in readers");
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
