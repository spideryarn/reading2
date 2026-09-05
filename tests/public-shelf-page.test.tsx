// @vitest-environment jsdom
/**
 * **`/read/public`, the page — and the one property that is about safety rather
 * than about pixels.**
 *
 * The listing's *query* is guarded exhaustively somewhere else:
 * `tests/owner-isolation.test.ts` § ownerless enumeration reads the generated
 * SQL, pins the projection, and runs it across two owners over private,
 * public-readable and public-but-unreadable rows. **This file does not repeat
 * any of that**, and saying so is the point — the risk stage 3b introduces is
 * not a widened predicate, it is a *page*, and a page can leak a private article
 * in exactly one way: by asking for one.
 *
 * So the load-bearing assertion here is an inventory rather than an absence. The
 * page's whole conversation with the server is recorded, and it must be one
 * request, to the ownerless namespace, carrying no session — because the only
 * route this page asks is one that cannot answer with a private article whatever
 * happens to it later. A test that seeded a private article and looked for its
 * title in the DOM would go green the day somebody swapped the loader for
 * `useShelf`, provided the fixture happened not to include one.
 *
 * The four things it pins, then:
 *
 * 1. **One request, and it is `/api/public/library`** — the path
 *    `tests/public-client-fetch.test.ts` already checks against the server's own
 *    inventory, so a rename on either side is red there rather than here.
 * 2. **Anonymously**: no `Authorization` header, `credentials: "omit"`, and
 *    nothing reaching into the auth module at all. The second half is the one
 *    that rots — `lib/supabase.js` is stubbed wholesale, so a mount effect that
 *    asked for a session would make no request and the URL list would stay
 *    clean while the property was gone. Same reasoning and same stub as
 *    `tests/pricing-page-current-plan.test.tsx`.
 * 3. **It draws what the server sent, and nothing else.** Every field of the
 *    DTO that reaches the page, including `truncated`, which exists for one
 *    sentence and would otherwise be a field nothing reads.
 * 4. **An empty shelf is a page, not a 404.** *"Nobody has shared anything"* is
 *    an answer about the world, and the route says so with a 200 and an empty
 *    list (src/store/public-library.ts § `scrubbed`). A page that drew nothing
 *    over it would look exactly like one that failed.
 *
 * ## What it cannot see, named rather than implied
 *
 * **The inventory is of *this page's* requests, not of the tab's.** This file
 * mounts `PublicLibraryPage`; production mounts `App`, which initialises a
 * session and starts the job service before it reaches this branch. So a future
 * `App` arm that wrapped this page in something owner-scoped would leave every
 * assertion here green — GPT Sol's P1 on this stage, 2026-09-04. Closing it
 * needs a suite that renders `<App />`, and **nothing in `tests/` does today**,
 * so it is written down in the plan's log rather than half-built here.
 *
 * **And `lib/supabase.js` is stubbed wholesale**, which is what makes the
 * `supabaseCalls` assertion possible and is also its limit: the real module
 * being constructed at import — `public-api.ts` reaches `lib/api.ts` for
 * `readJson`, which imports it — is invisible from in here. Same stub, same
 * trade and same paragraph as tests/pricing-page-current-plan.test.tsx, where
 * the gap was closed once by a separate check with the real module and an empty
 * browser store.
 *
 * docs/project/public-shelf.md, and
 * docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3b.
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
/* `lib/api.ts` reaches for IndexedDB at module load (the offline cache), and in
   jsdom the failure is a hang rather than a throw — every case here times out
   with no error. Same import and same reason as the two neighbouring page
   suites. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicLibrary } from "../src/public-library-types.js";
import {
  PUBLIC_SHELF_EMPTY,
  PUBLIC_SHELF_FAILED,
  PUBLIC_SHELF_HEADING,
  PUBLIC_SHELF_LEDE,
  PUBLIC_SHELF_RETRY,
  PUBLIC_SHELF_TRUNCATED,
  TAKEDOWN_LINK,
} from "../src/messages.js";
import { TAKEDOWN_HREF } from "../src/web/router.js";

/* React only treats `act()` as authoritative when this is set, and without it
   every render below logs "The current testing environment is not configured to
   support act(...)" — noise that hides a real warning. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every call the page makes into the auth module, in order.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports and
 * cannot close over an ordinary `const`. Asserted empty: a stubbed module makes
 * no request, so the URL recorder alone would stay clean even if something asked
 * it for a session, and *"nothing on this page reaches for the reader"* is the
 * property that rots.
 */
const { supabaseCalls } = vi.hoisted(() => ({ supabaseCalls: [] as string[] }));

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => {
        supabaseCalls.push("getSession");
        return { data: { session: { access_token: "TOKEN" } } };
      },
      refreshSession: async () => {
        supabaseCalls.push("refreshSession");
        return { data: { session: null } };
      },
      onAuthStateChange: () => {
        supabaseCalls.push("onAuthStateChange");
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
  googleSignInAvailable: async () => {
    supabaseCalls.push("googleSignInAvailable");
    return true;
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { PublicLibraryPage } = await import("../src/web/PublicLibraryPage.js");

/**
 * Two cards, and every field a card can draw is populated on the first and
 * absent on the second.
 *
 * The second exists because `byline`, `gist`, `siteName` and `words` are all
 * nullable on the wire — a revision published before the scalar existed, an
 * extraction with no site name, a page whose author is nowhere in its markup —
 * and a card that assumed them renders `null words` rather than
 * failing. It is second in the array as well as second by `publicAt`, so the
 * order assertion below is about the server's order rather than about chance.
 */
const TWO: PublicLibrary = {
  entries: [
    {
      slug: "cargocult-spya-rz663q",
      title: "Cargo Cult Science",
      /* **The article's own author, not the reader who shared it.** The value
         comes off `article_revisions.byline`, which extraction took from the
         published page — src/public-library-types.ts § `byline` says what
         would be wrong about the other reading. */
      byline: "Richard P. Feynman",
      gist: "Feynman argues that science demands a rigorous, self-critical honesty.",
      siteName: "Caltech",
      words: 3822,
      publicAt: "2026-09-03T10:00:00.000Z",
    },
    {
      slug: "a-bare-one-spya-000000",
      title: "A piece with nothing else on it",
      byline: null,
      gist: null,
      siteName: null,
      words: null,
      publicAt: null,
    },
  ],
  truncated: false,
};

const EMPTY: PublicLibrary = { entries: [], truncated: false };

let host: HTMLDivElement;
let root: Root;
/** Every URL the page asked for, in order. Most of this file is about this. */
let asked: string[];
/** The `init` each of those was given, so the anonymity can be read off it. */
let inits: (RequestInit | undefined)[];

beforeEach(() => {
  vi.unstubAllGlobals();
  asked = [];
  inits = [];
  supabaseCalls.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", "/read/public");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Let React flush, and any promise already in flight resolve. */
async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * Mount the page with `fetch` answering `answer`, and record what was asked.
 *
 * `answer` returning `null` means the read failed with a 500, which is the case
 * the retry button is for.
 */
async function show(
  answer: () => PublicLibrary | null = () => TWO,
  { signedIn = false, strict = false }: { signedIn?: boolean; strict?: boolean } = {},
): Promise<HTMLElement> {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    inits.push(init);
    const body = answer();
    if (body === null) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const page = <PublicLibraryPage signedIn={signedIn} />;
  await act(async () => {
    root.render(strict ? <StrictMode>{page}</StrictMode> : page);
  });
  await settle();
  return host;
}

/** The cards, in the order they are drawn. */
const cards = (page: HTMLElement) => [...page.querySelectorAll("article")];

/** The link a card carries, which is the whole reason a card is on the page. */
const cardHrefs = (page: HTMLElement) =>
  cards(page).map((c) => c.querySelector("h2 a")?.getAttribute("href"));

describe("the shelf of shared articles", () => {
  it("draws a card for every entry the server sent, in the order it sent them", async () => {
    const page = await show();
    expect(cards(page)).toHaveLength(2);
    expect(cards(page).map((c) => c.querySelector("h2")?.textContent)).toEqual([
      "Cargo Cult Science",
      "A piece with nothing else on it",
    ]);
  });

  /**
   * **Each card opens the article**, which is the one thing a card has to do.
   * `readHref`, so this and the owner's shelf cannot disagree about where an
   * article lives.
   */
  it("and every card links at the article it names", async () => {
    expect(cardHrefs(await show())).toEqual([
      "/read/cargocult-spya-rz663q",
      "/read/a-bare-one-spya-000000",
    ]);
  });

  /**
   * The three nullable fields, absent. A card that assumed them would print
   * *"null words"* rather than throwing, which is why this is an assertion about
   * the text rather than about a render succeeding.
   */
  it("and says only what an entry actually carries", async () => {
    const page = await show();
    const bare = cards(page)[1];
    expect(bare?.textContent).toContain("A piece with nothing else on it");
    expect(bare?.textContent).not.toContain("null");
    expect(bare?.textContent).not.toContain("undefined");
    /* The populated one is the control: without it, a card that drew no meta
       line at all would pass the assertions above. */
    expect(cards(page)[0]?.textContent).toContain("Caltech");
    expect(cards(page)[0]?.textContent).toContain("3,822 words");
  });

  it("and says what the page is, above them", async () => {
    const page = await show();
    expect(page.querySelector("h1")?.textContent).toBe(PUBLIC_SHELF_HEADING);
    expect(page.textContent).toContain(PUBLIC_SHELF_LEDE);
  });

  /**
   * **Who wrote the piece, on the card that offers it.**
   *
   * Greg, asked on 2026-09-04 whether a public article should show whose it is,
   * said yes. The article page already did — the masthead's facts line and the
   * visitor's details page both draw `PublicMeta.byline` — and this shelf did
   * not, though it drew the site the piece was published on, which is the same
   * class of fact about the same document.
   *
   * **It is the article's author and never the reader who shared it**, and the
   * two are different people. Asserted here as well as stated in the type,
   * because a card that started drawing an owner's name would be a page
   * publishing our readers' identities to strangers, and that is not something
   * a wording change should be able to do quietly.
   */
  it("and names the author of the piece, where the piece has one", async () => {
    const page = await show();
    expect(cards(page)[0]?.textContent).toContain("Richard P. Feynman");
    /* The bare card is the control: absent, not "null" and not the slug. */
    expect(cards(page)[1]?.textContent).not.toContain("Feynman");
  });
});

/**
 * **The cap has to be visible**, which is the whole reason `truncated` is on the
 * wire. Nothing can reach it today, so this is the only thing that would ever
 * report the field being dropped.
 */
describe("when the list is capped", () => {
  it("says so, and goes on drawing the cards it has", async () => {
    const page = await show(() => ({ ...TWO, truncated: true }));
    expect(page.textContent).toContain(PUBLIC_SHELF_TRUNCATED);
    expect(cards(page)).toHaveLength(2);
  });

  it("and says nothing about a cap when it was not reached", async () => {
    expect((await show()).textContent).not.toContain(PUBLIC_SHELF_TRUNCATED);
  });
});

/**
 * **An empty shelf is a 200 with an empty list**, and the page has to answer it
 * with a sentence. A page that drew nothing would be indistinguishable from one
 * whose fetch never came back.
 */
describe("when nobody has shared anything", () => {
  it("says so, rather than looking broken or missing", async () => {
    const page = await show(() => EMPTY);
    expect(page.textContent).toContain(PUBLIC_SHELF_EMPTY);
    expect(cards(page)).toHaveLength(0);
    /* And it is still the page: the heading is what says the address meant
       something, which a 404 would have denied. */
    expect(page.querySelector("h1")?.textContent).toBe(PUBLIC_SHELF_HEADING);
  });
});

describe("when the read fails", () => {
  it("says so, and offers another go", async () => {
    const page = await show(() => null);
    expect(page.textContent).toContain(PUBLIC_SHELF_FAILED);
    expect([...page.querySelectorAll("button")].map((b) => b.textContent)).toContain(
      PUBLIC_SHELF_RETRY,
    );
  });

  /**
   * **The retry has to actually ask again**, which is the half that fails
   * silently: a button that re-renders the same failed state looks exactly like
   * one that tried.
   */
  it("and pressing it asks again", async () => {
    const page = await show(() => null);
    const before = asked.length;
    const retry = [...page.querySelectorAll("button")].find(
      (b) => b.textContent === PUBLIC_SHELF_RETRY,
    );
    await act(async () => {
      retry?.click();
    });
    await settle();
    expect(asked.length).toBeGreaterThan(before);
  });
});

/**
 * **Two reads in the air at once, which is the production configuration and not
 * an edge case** — `main.tsx` mounts the app inside `<StrictMode>`, so in
 * development every effect runs mount → cleanup → mount and this page issues two
 * requests before either answers.
 *
 * The failure that reaches for is a page showing **two states at once**. The
 * hook held `shelf` and `failed` as independent flags, each set by one branch of
 * one promise and neither clearing the other, so a failing read landing before a
 * succeeding one left both true — the error paragraph drawn above the list of
 * cards, each of them individually correct. GPT Sol's review of this stage,
 * 2026-09-04; the remedy is a single discriminated state, which makes the
 * combination unrepresentable rather than merely untested.
 *
 * **The assertion is exclusivity rather than a particular winner.** Which read
 * lands last is not something this page promises, and pinning it would make the
 * test fail for a reason that is nobody's fault.
 */
describe("when two reads overlap", () => {
  it("never shows a failure and a list at the same time", async () => {
    /* The first read fails and the second succeeds, which is the ordering that
       produced the defect. `answer` is called per request. */
    let call = 0;
    const page = await show(() => (++call === 1 ? null : TWO), { strict: true });

    const failing = page.textContent?.includes(PUBLIC_SHELF_FAILED) ?? false;
    const listing = cards(page).length > 0;
    const empty = page.textContent?.includes(PUBLIC_SHELF_EMPTY) ?? false;
    /* Exactly one of the three. Counting them rather than asserting `!failing`
       also catches the page settling into *no* state at all, which a botched
       fix would produce and which looks like a page that never loaded. */
    expect({ failing, listing, empty }).toSatisfy(
      () => [failing, listing, empty].filter(Boolean).length === 1,
    );
  });

  it("and does the same when the failure lands second", async () => {
    let call = 0;
    const page = await show(() => (++call === 1 ? TWO : null), { strict: true });
    const failing = page.textContent?.includes(PUBLIC_SHELF_FAILED) ?? false;
    const listing = cards(page).length > 0;
    expect([failing, listing].filter(Boolean)).toHaveLength(1);
  });
});

/**
 * **The whole conversation with the server** — see this file's header for why
 * this, rather than a private-article fixture, is the safety assertion.
 */
describe("what the page asks the server for", () => {
  it("asks the ownerless listing, once, and nothing else", async () => {
    await show();
    expect(asked).toEqual(["/api/public/library"]);
  });

  /**
   * **And it asks the same thing signed in.** A visitor and an owner get
   * identical bytes on this page, which is the rule the whole public namespace
   * follows — and it is worth an assertion because the obvious "improvement" is
   * to enrich the page for somebody who is signed in, which would put an
   * owner-scoped read on a page a stranger renders.
   */
  it("and asks exactly the same thing when somebody is signed in", async () => {
    await show(() => TWO, { signedIn: true });
    expect(asked).toEqual(["/api/public/library"]);
  });

  it("carries no session on it, in either direction", async () => {
    await show();
    expect(inits[0]?.credentials).toBe("omit");
    expect(inits[0]?.headers).toBeUndefined();
    /* The half a URL list cannot see: the auth module is stubbed, so anything
       reaching for the reader would make no request at all. */
    expect(supabaseCalls).toEqual([]);
  });
});

/**
 * **The way to complain about something on this page.**
 *
 * The shelf is where a stranger *finds* a republished article, so it is one of
 * the two places the takedown link has to be — the other being the article's own
 * details page (tests/public-metadata-artefacts.test.tsx). It is one quiet line
 * under the list rather than anything on a card: a card is an offer to read, and
 * a report link on every one of them would read as a warning about each article.
 *
 * Asserted as an `href` rather than as words, because the words will be
 * rewritten and the address is the thing that has to keep working —
 * tests/takedown-privacy-section.test.tsx is what checks there is a section at
 * the other end of it.
 */
describe("if something on the shelf is yours", () => {
  it("offers a way to ask for it to be taken down", async () => {
    const page = await show();
    const hrefs = [...page.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(TAKEDOWN_HREF);
    expect(page.textContent).toContain(TAKEDOWN_LINK);
  });

  /**
   * **And on an empty shelf too.** The link is about the page rather than about
   * the list, and the empty state is the one arm where a "draw it under the
   * cards" implementation quietly loses it.
   */
  it("and says so even when there is nothing on the shelf", async () => {
    const page = await show(() => EMPTY);
    const hrefs = [...page.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(TAKEDOWN_HREF);
  });
});
