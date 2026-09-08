// @vitest-environment jsdom
/**
 * **Delete permanently, on the Metadata page** — Metadata.tsx §
 * `DeletePermanently`, Stage D of
 * docs/plans/260906h-delete-an-article-permanently.md.
 *
 * This is the first irreversible act a reader can perform on their own data, so
 * the tests here are mostly about the ways it must *refuse* rather than the one
 * way it works.
 *
 * Mounted through `Metadata` rather than by rendering the section directly —
 * the same choice `tests/metadata-export-button.test.tsx` and
 * `tests/metadata-sharing-card.test.tsx` made, and for the same reason: the
 * wiring (which gate it is behind, which slug reaches the URL, whether the
 * metadata we are acting on came off the network) is where a control like this
 * goes wrong, and hand-written props assert the props.
 *
 * ## Six things here are not about React
 *
 *  - **A double-click must not delete.** The confirm button may not appear
 *    where the trigger was, so the second press of a double-click lands on
 *    prose. Asserted structurally — jsdom has no layout — as *the trigger is
 *    the card's first element, and after confirming the card's first element is
 *    the question rather than a button*.
 *  - **Nothing is auto-focused**, so a held Return or a repeated Space cannot
 *    carry through from the trigger to the confirm. The trigger is unmounted
 *    outright, so a keyup has nothing left to land on.
 *  - **Only a FRESH SERVER answer settles what happened.** `apiFetch` answers a
 *    failed GET out of the offline copy with a real 200 and an
 *    `x-spideryarn-offline: copy` header (src/web/lib/api.ts § `attempt`), so
 *    the naive re-read would cheerfully report *"still here, untouched"* about
 *    an article that is gone. Three outcomes, three tests.
 *  - **A successful status is not the route's answer either.** `DELETE
 *    /api/library/:slug` replies `{ destroyed: slug }` and `readJson` turns an
 *    empty success into `{}`, so a 204, a `{}` or a body naming a different
 *    article would all have passed for a confirmed deletion. Three tests.
 *  - **When we cannot say what happened, we offer nothing.** Not a disabled
 *    button — no button, and not the trigger either, which would only invite a
 *    second DELETE for an article that may already be gone.
 *  - **The reader's cached set is retired before we navigate**, and it is the
 *    drawer of the reader who *pressed*, captured before the request rather
 *    than looked up after it. A stale shelf card that paints and then opens a
 *    404 is the visible failure (cached-shelf.ts).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Job } from "../src/types.js";

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

/** Every call to the cache retirement, so the order against `navigate` is visible. */
const forgot: string[] = [];
/** …and **whose** drawer each of those calls was told to empty. */
const forgotFor: (string | null | undefined)[] = [];
vi.mock("../src/web/lib/cached-shelf.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/lib/cached-shelf.js")>()),
  forgetCachedReader: async (reader?: string | null) => {
    forgot.push(location.pathname);
    forgotFor.push(reader);
  },
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});

const { Metadata } = await import("../src/web/Metadata.js");
/**
 * **The only lever that fires a metadata *refresh*.** Every *Generate it again*
 * row hands its `useStepJob` the page's `refresh` (Metadata.tsx §
 * `RerunSection`), so a job this article's queue reports as `done` is what makes
 * the page read its metadata a second time — and a second read is the only way
 * to reach the state F23 is about. Driven through the real engine rather than
 * by mocking the hook, exactly as tests/metadata-rerun-section.test.tsx does.
 */
const { jobEngine } = await import("../src/web/jobEngine.js");
/** To move the signed-in reader under a delete that is already in flight. */
const { rememberUser } = await import("../src/web/lib/offline-store.js");

const SLUG = "a-piece";
const TITLE = "A piece";

const ARTICLE: Article = {
  meta: { slug: SLUG, title: TITLE },
  blocks: [
    {
      id: "spya-aaaaaa",
      tag: "p",
      kind: "text",
      text: "The first paragraph.",
      words: 3,
      html: "<p>The first paragraph.</p>",
      gistable: true,
    },
  ],
  assets: undefined,
  navLabelStatus: "ready",
  tree: {
    version: "t",
    generator: "t",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title: TITLE,
      },
    },
  },
};

/** A live server answer for `GET /api/metadata/:slug`. */
function metadataBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    slug: SLUG,
    dir: `spideryarn.article_revisions/rev-1`,
    stages: [],
    comments: 0,
    profile: null,
    purpose: null,
    archivedAt: null,
    ...over,
  });
}

const live = (over?: Record<string, unknown>) =>
  new Response(metadataBody(over), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** What `apiFetch` hands back when the transport failed and a copy was saved. */
const savedCopy = () =>
  new Response(metadataBody(), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-spideryarn-offline": "copy",
      "x-spideryarn-saved-at": String(Date.now()),
    },
  });

const gone = () =>
  new Response(JSON.stringify({ error: "No such article." }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

/**
 * How `GET /api/metadata/:slug` answers, in order. The last entry repeats, so a
 * test that cares only about the first load writes one.
 */
let metadataAnswers: (() => Promise<Response>)[];
/** How `DELETE /api/library/:slug` answers. */
let deleteAnswer: () => Promise<Response>;
/** Every request the page made, as `METHOD path`. */
let asked: string[];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  forgot.length = 0;
  forgotFor.length = 0;
  asked = [];
  jobEngine.reset();
  rememberUser("reader-a");
  metadataAnswers = [async () => live()];
  deleteAnswer = async () =>
    new Response(JSON.stringify({ destroyed: SLUG }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    asked.push(`${method} ${url}`);
    if (url.startsWith("/api/metadata/")) {
      const next = metadataAnswers.length > 1 ? metadataAnswers.shift() : metadataAnswers[0];
      return (next ?? (async () => live()))();
    }
    if (url.startsWith("/api/library/") && method === "DELETE") return deleteAnswer();
    return Promise.resolve(new Response("{}", { status: 200 }));
  });

  history.replaceState(null, "", `/read/${SLUG}/metadata`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  rememberUser(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(article: Article = ARTICLE): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(Metadata, {
          slug: SLUG,
          article,
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      ),
    );
  });
  await settle();
}

/** Let every pending microtask and zero-delay timer run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The section, by the id `Section` derives from its label. */
const section = (): HTMLElement | null => host.querySelector("#sec-delete-this-article");
/** The one card inside it. */
const card = (): HTMLElement | null => section()?.querySelector(":scope > div") ?? null;

const buttonSaying = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));

const trigger = () => buttonSaying("Delete permanently");
const confirmButton = () => buttonSaying("Delete for ever");
const keepButton = () => buttonSaying("Keep it");

async function press(b: HTMLButtonElement | undefined): Promise<void> {
  await act(async () => b?.click());
  await settle();
}

/**
 * **Make the page read its metadata a second time**, the way production does:
 * a *Generate it again* row's job comes back `done` and its `onFinished` — the
 * page's `refresh` — asks again.
 *
 * Two `receive` calls, because the engine treats the first list it ever sees as
 * a baseline rather than as news (`recordCompletions`, src/web/jobEngine.ts).
 */
async function finishARun(): Promise<void> {
  const job: Job = {
    id: "job-1",
    ownerId: "owner" as Job["ownerId"],
    slug: SLUG,
    steps: [{ name: "arc", label: "Doing arc", status: "done" }],
    status: "done",
    createdAt: "2026-09-07T00:00:00.000Z",
  };
  await act(async () => jobEngine.receive([]));
  await act(async () => jobEngine.receive([job]));
  await settle();
}

const alertText = (): string =>
  [...(section()?.querySelectorAll('[role="alert"]') ?? [])]
    .map((n) => n.textContent ?? "")
    .join(" ");

describe("Delete permanently — when it is offered at all", () => {
  it("is offered once a fresh server answer says there is an article here", async () => {
    await open();
    expect(section()).toBeTruthy();
    expect(trigger()).toBeTruthy();
    /* And it says what it does before it is pressed, not only in the confirm. */
    expect(section()?.textContent).toContain("cannot be undone");
    expect(section()?.textContent).toContain("Archive above");
  });

  it("never says bare 'Delete', which meant archive for nine days", async () => {
    await open();
    const labels = [...(section()?.querySelectorAll("button") ?? [])].map((b) =>
      (b.textContent ?? "").trim(),
    );
    expect(labels).toContain("Delete permanently");
    expect(labels).not.toContain("Delete");
  });

  it("is withheld while we are still asking", async () => {
    /* Held open, so "not told yet" is a state rather than a frame. */
    let release: ((r: Response) => void) | undefined;
    metadataAnswers = [() => new Promise<Response>((go) => (release = go))];
    await open();
    expect(trigger()).toBeUndefined();
    expect(section()?.textContent).toContain("Checking");
    await act(async () => release?.(live()));
    await settle();
    expect(trigger()).toBeTruthy();
  });

  it("is withheld, with a reason, when we could not check", async () => {
    metadataAnswers = [
      async () =>
        new Response(JSON.stringify({ error: "the database went away" }), { status: 500 }),
    ];
    await open();
    expect(trigger()).toBeUndefined();
    expect(alertText()).toContain("Reload the page");
  });

  /**
   * **A failed REFRESH is as disqualifying as a failed first load**, and this is
   * the case the test above cannot reach. `readProvenance` deliberately keeps
   * the previous `provenance` when a revalidation fails — the reader keeps the
   * rows they had rather than watching the page empty out — so the control
   * arrives at `known=true, failed=true`, a state the first load can never
   * produce. Everything else on this page is right to go on drawing what it had;
   * this one may not, because the article may have gone or changed hands in the
   * window the failure hid. ⟨Sol, F23.⟩
   */
  it("is withheld once a REFRESH fails, though the first load worked", async () => {
    await open();
    expect(trigger()).toBeTruthy();

    /* The article disappears, or changes owner, and the revalidation that would
       have told us so is the request that failed. */
    metadataAnswers = [
      async () =>
        new Response(JSON.stringify({ error: "the database went away" }), { status: 500 }),
    ];
    await finishARun();

    expect(asked.filter((a) => a.startsWith("GET /api/metadata"))).toHaveLength(2);
    expect(trigger(), "still offered over metadata we failed to re-establish").toBeUndefined();
    expect(alertText()).toContain("Reload the page");
    /* And nothing is merely disabled — there is no button at all. */
    expect(section()?.querySelectorAll("button")).toHaveLength(0);
  });

  /** The other half of the same lever: a refresh that lands leaves it offered. */
  it("is still offered after a refresh that succeeds", async () => {
    await open();
    await finishARun();
    expect(asked.filter((a) => a.startsWith("GET /api/metadata"))).toHaveLength(2);
    expect(trigger()).toBeTruthy();
  });

  /**
   * **The one Sol asked for.** A saved copy is not evidence the article is
   * still there, still ours, or still un-archived — so it is not a page to
   * destroy anything from.
   */
  it("is withheld when all we have is the offline copy of this page", async () => {
    metadataAnswers = [async () => savedCopy()];
    await open();
    expect(trigger()).toBeUndefined();
    expect(section()?.textContent).toContain("saved copy");
    /* And nothing about it is merely disabled — there is no button at all. */
    expect(section()?.querySelectorAll("button")).toHaveLength(0);
  });

  it("is withheld on an address with no article of its own", async () => {
    metadataAnswers = [async () => live({ dir: "example" })];
    await open();
    expect(trigger()).toBeUndefined();
    expect(section()?.textContent).toContain("no article of its own");
  });
});

describe("Delete permanently — the two-step confirm", () => {
  it("sends nothing on the first press", async () => {
    await open();
    expect(trigger()).toBeTruthy();
    await press(trigger());
    /* The question is up, and nothing has been asked of the server. */
    expect(confirmButton()).toBeTruthy();
    expect(asked.filter((a) => a.startsWith("DELETE"))).toEqual([]);
  });

  it("names the article in the question, so the reader reads which one", async () => {
    await open();
    await press(trigger());
    expect(section()?.textContent).toContain(TITLE);
    expect(section()?.textContent).toContain("for ever?");
  });

  /**
   * **An untitled article still gets named, and a browser pass is what found
   * this.** Extraction that produces no title leaves `""`, not null — an
   * ordinary URL paste did it — so `meta.title ?? slug` kept the empty string
   * and the question rendered as `Delete “” for ever?`. The safeguard in naming
   * the article is that the reader reads *which* one; empty quotes are not a
   * name, and the slug at least is. Every case above this one uses a titled
   * fixture, which is exactly why 22 green tests never saw it.
   */
  it("falls back to the slug when the article has no title", async () => {
    await open({ ...ARTICLE, meta: { ...ARTICLE.meta, title: "" } });
    await press(trigger());
    expect(section()?.textContent).toContain(SLUG);
    expect(section()?.textContent).not.toContain('""');
    expect(section()?.textContent).not.toContain("“”");
  });

  /** Whitespace is not a name either, and `||` alone would let it through. */
  it("falls back to the slug when the title is only whitespace", async () => {
    await open({ ...ARTICLE, meta: { ...ARTICLE.meta, title: "   " } });
    await press(trigger());
    expect(section()?.textContent).toContain(SLUG);
  });

  /**
   * **A double-click must not delete.** In the rest state the trigger is the
   * card's first element; after confirming, the card's first element is the
   * question. So the second press of a double-click lands on a heading.
   */
  it("does not put the confirm button where the trigger was", async () => {
    await open();
    expect(card()?.firstElementChild?.tagName).toBe("BUTTON");
    expect(card()?.firstElementChild?.textContent).toContain("Delete permanently");

    await press(trigger());
    expect(card()?.firstElementChild?.tagName).not.toBe("BUTTON");
    expect(card()?.firstElementChild).not.toBe(confirmButton());
    /* The trigger is gone rather than hidden, so a keyup from a held Space has
       nothing to activate. */
    expect(trigger()).toBeUndefined();
    /* And there is prose between the top of the card and the button that
       destroys, which is the whole of the guard. */
    const before = (card()?.textContent ?? "").split("Delete for ever")[0] ?? "";
    expect(before.length).toBeGreaterThan(100);
  });

  it("does not auto-focus the confirm button", async () => {
    await open();
    await press(trigger());
    expect(document.activeElement).not.toBe(confirmButton());
    expect(confirmButton()?.hasAttribute("autofocus")).toBe(false);
  });

  it("goes back, having sent nothing, when the reader keeps it", async () => {
    await open();
    await press(trigger());
    await press(keepButton());
    expect(confirmButton()).toBeUndefined();
    expect(trigger()).toBeTruthy();
    expect(asked.filter((a) => a.startsWith("DELETE"))).toEqual([]);
  });

  it("offers the export before the confirm, and says a downloaded copy cannot be recalled", async () => {
    await open();
    await press(trigger());
    expect(section()?.textContent).toContain("cannot recall");
    /* A button rather than `<a href="#sec-export">`: this app routes its own
       anchors and keeps the address bar clean (PageContents.tsx says so). */
    expect(buttonSaying("Export it first")).toBeTruthy();
  });

  it("says out loud when the article is shared", async () => {
    metadataAnswers = [
      async () =>
        live({ sharing: { visibility: "public", publicAt: "2026-09-01T00:00:00Z", personalised: [] } }),
    ];
    await open();
    await press(trigger());
    expect(section()?.textContent).toContain("anyone with the link will find nothing there");
  });

  it("says nothing about sharing when it is private", async () => {
    await open();
    await press(trigger());
    expect(section()?.textContent).not.toContain("anyone with the link");
  });
});

describe("Delete permanently — what happens after the press", () => {
  it("asks the route to destroy this slug, retires the cache, then goes to the library", async () => {
    await open();
    await press(trigger());
    await press(confirmButton());

    expect(asked).toContain(`DELETE /api/library/${SLUG}`);
    /* Retired BEFORE we navigate, or the shelf paints a card for an article
       that is gone. `forgot` records where we were when it ran. */
    expect(forgot).toEqual([`/read/${SLUG}/metadata`]);
    expect(location.pathname).toBe("/");
  });

  it("says the import is in the way, and stays where the reader can try again", async () => {
    deleteAnswer = async () =>
      new Response(
        JSON.stringify({
          error:
            "An import is running on this article, so it cannot be deleted yet. Stop it, or wait for it to finish, then delete.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).toContain("An import is running on this article");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    /* Still in the confirm step: stop the import, press again. */
    expect(confirmButton()).toBeTruthy();
    expect(confirmButton()?.disabled).toBe(false);
    /* A 409 is a fresh server refusal that deleted nothing, so there is nothing
       to re-read. */
    expect(asked.filter((a) => a.startsWith("GET /api/metadata"))).toHaveLength(1);
  });

  /**
   * **A 2xx is not the route's answer, and the route has one.** `DELETE
   * /api/library/:slug` replies `{ destroyed: slug }` (src/routes.ts,
   * `ShelfStore.destroy`), and until 2026-09-08 the client parsed that and threw
   * it away — so a 204, an empty object, or a body naming a *different* article
   * all read as a confirmed deletion, and the reader lost their cache and their
   * page over a request that may have deleted nothing. Exactly the shape
   * docs/reusable/silent-success.md is about. ⟨Sol, F25.⟩
   */
  it("does not treat a 204 as a confirmed deletion", async () => {
    deleteAnswer = async () => new Response(null, { status: 204 });
    metadataAnswers = [async () => live(), async () => live()];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(forgot).toEqual([]);
    expect(alertText()).toContain("did not confirm");
    /* And the honest re-read ran, which is what settles it either way. */
    expect(asked.filter((a) => a.startsWith("GET /api/metadata"))).toHaveLength(2);
  });

  it("does not treat an empty JSON body as a confirmed deletion", async () => {
    deleteAnswer = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    metadataAnswers = [async () => live(), async () => live()];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(forgot).toEqual([]);
    expect(alertText()).toContain("did not confirm");
  });

  /** A success naming somebody else's article is the worst of the three. */
  it("does not accept a success that names a different article", async () => {
    deleteAnswer = async () =>
      new Response(JSON.stringify({ destroyed: "another-piece" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    metadataAnswers = [async () => live(), async () => live()];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(forgot).toEqual([]);
    expect(alertText()).toContain("did not confirm");
    expect(alertText()).toContain("still here, untouched");
  });

  /* --- the three re-read outcomes ------------------------------------- */

  /**
   * **A lost response is not proof nothing happened.** A fresh 404 on the
   * re-read says the delete landed after all, so the reader goes to the library
   * rather than being told it failed.
   */
  it("navigates anyway when a FRESH SERVER 404 proves it went", async () => {
    deleteAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    metadataAnswers = [async () => live(), async () => gone()];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(forgot).toEqual([`/read/${SLUG}/metadata`]);
    expect(location.pathname).toBe("/");
  });

  it("says it is still here, untouched, when a FRESH SERVER 200 proves it survived", async () => {
    deleteAnswer = async () =>
      new Response(JSON.stringify({ error: "the database went away" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    metadataAnswers = [async () => live(), async () => live()];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).toContain("Couldn't delete it");
    expect(alertText()).toContain("the database went away");
    expect(alertText()).toContain("still here, untouched");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(forgot).toEqual([]);
  });

  /**
   * **The trap Sol found (F6).** The re-read came back 200 — but off the
   * offline copy, which is a `Response` we synthesised from a body saved
   * yesterday. It proves nothing in either direction, so it must NOT say "still
   * here, untouched".
   */
  it("admits it cannot tell when the re-read is answered from the offline copy", async () => {
    deleteAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    metadataAnswers = [async () => live(), async () => savedCopy()];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).toContain("Couldn't tell whether that worked");
    expect(alertText()).not.toContain("still here, untouched");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
  });

  /**
   * **A fresh server answer that is neither 404 nor 200 settles nothing.** The
   * server was reached, so this is not the offline copy and not a transport
   * failure — and it is still no evidence in either direction. Written after a
   * mutation survived: `return res.ok ? "here" : "unknown"` collapsed to
   * `return "here"` and the whole suite stayed green.
   */
  it("admits it cannot tell when the re-read itself is refused", async () => {
    deleteAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    metadataAnswers = [
      async () => live(),
      async () =>
        new Response(JSON.stringify({ error: "the database went away" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    ];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).toContain("Couldn't tell whether that worked");
    expect(alertText()).not.toContain("still here, untouched");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
  });

  /**
   * **Only a 200 proves survival, and `res.ok` is four other statuses.** The
   * function's own header says *"only a fresh server 200 proves it survived"*,
   * and `return res.ok ? "here" : "unknown"` admitted 201, 202, 204 and 206 —
   * a re-read answered `204 No Content` made the page say *"still here,
   * untouched"* about an article that had just been destroyed. The comment and
   * the code have to agree, and the code was the one that was wrong. ⟨Sol, F24.⟩
   */
  it("does not call a 204 re-read proof that the article survived", async () => {
    deleteAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    metadataAnswers = [async () => live(), async () => new Response(null, { status: 204 })];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).not.toContain("still here, untouched");
    expect(alertText()).toContain("Couldn't tell whether that worked");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
  });

  it("admits it cannot tell when the re-read cannot reach the server either", async () => {
    deleteAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    metadataAnswers = [
      async () => live(),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).toContain("Couldn't tell whether that worked");
    expect(alertText()).toContain("Reload the page");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
  });

  /**
   * **An unknown outcome takes the button away**, and this is the same rule the
   * whole component is arranged around: never offer a control over a state we
   * have not established. The three "cannot tell" cases above left `asking`
   * true and put `busy` back to false, so *Delete for ever* stood enabled
   * directly beneath a sentence admitting we did not know whether the article
   * still existed — and a reader who pressed it again would be sending a second
   * DELETE for an article that may already be gone. `ArchiveArticle`'s
   * `at === undefined` branch is the shape this borrows. ⟨Sol, F26.⟩
   */
  it("offers no control at all once it cannot tell whether the delete worked", async () => {
    deleteAnswer = async () => {
      throw new TypeError("Failed to fetch");
    };
    metadataAnswers = [
      async () => live(),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ];

    await open();
    await press(trigger());
    await press(confirmButton());

    expect(alertText()).toContain("Couldn't tell whether that worked");
    /* Not a disabled button — no button. A dimmed *Delete for ever* is still
       this page claiming there is something here to delete. */
    expect(confirmButton()).toBeUndefined();
    expect(trigger()).toBeUndefined();
    expect(keepButton()).toBeUndefined();
    expect(section()?.querySelectorAll("button")).toHaveLength(0);
  });

  /**
   * **The drawer emptied is the one the delete belonged to.** ⟨Sol, F27, in
   * part — see the plan for what was deliberately left.⟩
   *
   * `forgetCachedReader` looked the reader up itself, *after* the delete had
   * settled, so a direct A→B sign-in landing in that window emptied B's cache
   * and left A's holding a card for an article that no longer exists — which
   * paints on A's next visit and opens a 404 (cached-shelf.ts § the top).
   */
  it("retires the drawer of the reader who pressed, not whoever is signed in after", async () => {
    let release: ((r: Response) => void) | undefined;
    deleteAnswer = () => new Promise<Response>((go) => (release = go));

    await open();
    await press(trigger());
    await act(async () => confirmButton()?.click());

    /* Another tab signs somebody else in while our DELETE is still out. */
    rememberUser("reader-b");
    await act(async () =>
      release?.(
        new Response(JSON.stringify({ destroyed: SLUG }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await settle();

    expect(forgotFor).toEqual(["reader-a"]);
  });

  it("disables the confirm while the delete is in flight, so it cannot be sent twice", async () => {
    let release: ((r: Response) => void) | undefined;
    deleteAnswer = () => new Promise<Response>((go) => (release = go));

    await open();
    await press(trigger());
    await act(async () => confirmButton()?.click());

    const pending = buttonSaying("Deleting…");
    expect(pending).toBeTruthy();
    expect(pending?.disabled).toBe(true);
    await act(async () => pending?.click());
    expect(asked.filter((a) => a.startsWith("DELETE"))).toHaveLength(1);

    await act(async () =>
      release?.(
        new Response(JSON.stringify({ destroyed: SLUG }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await settle();
    expect(location.pathname).toBe("/");
  });
});
