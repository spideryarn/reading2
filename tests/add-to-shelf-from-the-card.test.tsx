// @vitest-environment jsdom
/**
 * **The Add button in the link card: who is offered it, and what happens after
 * the pointer has gone.**
 *
 * Three claims, and each of them is a way this feature can be wrong while
 * looking right.
 *
 *  1. **A visitor is not offered it, and the seam is that `useJobs` is never
 *     called** — not that it is called and its answer thrown away. A hook
 *     cannot be skipped conditionally, so the enforcement is a component that
 *     does not exist (`WithAddToShelf` in ProseHoverCard.tsx). This is the same
 *     class of bug GPT Sol found in this very file on 2026-08-28, when a
 *     signed-out browser was asking `/api/library` on every hover; a card that
 *     drew no button and still called the hook would look identical to a
 *     correct one and still subscribe a visitor's tab to the job engine, whose
 *     polling cadence a mounted subscriber sets. So the assertion is a call
 *     count on the hook, which is the only thing that can tell the two apart.
 *
 *  2. **The card survives its own teardown.** Pressing Add and moving the
 *     pointer away destroys the card — on `pointerout`, and again whenever the
 *     prose re-renders — so anything about the add that lived in component
 *     state is gone with it. Re-hovering must find the refusal, or the job
 *     where it got to, rather than a second enabled button over a metered
 *     action.
 *
 *  3. **The shelf is re-read when the job finishes.** `link-facts.ts` loads the
 *     shelf once per page load and never again, so without an invalidation the
 *     card goes on offering to add an article the reader has just watched
 *     arrive. **And the card is closed at the moment it finishes**, which is
 *     the ordinary case — an ingest is a minute or two and a hover is a second
 *     — and the one a completion callback silently misses: a `useJobs`
 *     subscriber mounted afterwards is never told about a job that finished
 *     before it existed (useJobs.ts § openedAt). GPT Sol raised all three of
 *     these reviewing the plan on 2026-09-05, finding P2-1.
 *
 * `useJobs` is posed rather than driven, because what is under test is the
 * card's reading of the queue and not the queue itself: the engine has its own
 * suites, and mounting the real one here would make every interesting assertion
 * wait on a poll.
 *
 * **Each test uses its own URL and its own job id**, which is not tidiness. The
 * card deliberately keeps what it has asked in module-level maps, so that they
 * outlive a teardown — and a module map outlives a test too. Sharing an address
 * between two tests here would make one of them depend on the order they ran
 * in.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, LibraryEntry } from "../src/types.js";

/* React only flushes inside `act` when it is told it is under test; without it
   the effects that mount the card run after the assertion has read the DOM. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Floating UI observes the reference element, and jsdom has no ResizeObserver. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/* ------------------------------------------------------------- the shelf -- */

/** What `GET /api/library` answers with, as the test has arranged it. */
let onTheShelf: LibraryEntry[] = [];
/** Every `/api/` path the render asked for, in order. The count is the point. */
const asked: string[] = [];
/** Hold `/api/library` open, so a test can look at the card while it is unknown. */
let holdShelf = false;
let releaseShelf: (() => void) | null = null;
/** Make `/api/library` fail, which is the other way the shelf stays unknown. */
let shelfFails = false;

vi.mock("../src/web/lib/api.js", () => {
  /* A whole-module mock, so anything link-facts.ts reaches for and this omits
     is `undefined` at the moment it is called rather than the real thing
     talking to a server that is not there — the same discipline
     tests/glossary-one-fetch.test.tsx explains at greater length. */
  const api = {
    apiFetch: async (input: string) => {
      asked.push(input);
      /* Held when a test wants to see the card *before* the shelf has answered,
         which is a real state and the one that used to offer to add an article
         the reader already owned. */
      if (holdShelf) await new Promise<void>((go) => (releaseShelf = go));
      if (shelfFails) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ articles: onTheShelf }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    readJson: async (res: Response) => res.json(),
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
    statusOf: () => undefined,
  };
  return api;
});

/* -------------------------------------------------------------- the queue -- */

/** How many times a rendered card has called `useJobs`. Zero is the visitor rule. */
let useJobsCalls = 0;
/** The queue as the engine would report it — replaced by the test, not polled. */
let jobs: Job[] = [];
/** What the next `add()` resolves to. Null is a refusal, with `failure` its reason. */
let added: Job | null = null;
let failure: string | null = null;
/** Every URL `add()` was asked for. Two entries is a second slot spent. */
const posted: string[] = [];
/** Set by the one test that watches the card while the POST is still in flight. */
let holdPost = false;
let releasePost: (() => void) | null = null;

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => {
    useJobsCalls += 1;
    return {
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => failure,
      add: async (url: string) => {
        posted.push(url);
        if (holdPost) await new Promise<void>((go) => (releasePost = go));
        return added;
      },
      addUpload: async () => null,
      run: async () => null,
      cancel: async () => {},
      retry: async () => {},
      forget: async () => {},
    };
  },
}));

/* Imported after the mocks, which is what `vi.mock`'s hoisting is for. */
const { ProseHoverCard, describeAdd } = await import("../src/web/ProseHoverCard.js");
const { HOVER_DELAY } = await import("../src/web/useHoverCard.js");

/* ------------------------------------------------------------ the harness -- */

/** The article the reader is standing in — never the link, or it is a self-link. */
const READING = "https://noema.example/the-piece";

function job(id: string, url: string, over: Partial<Job> = {}): Job {
  return {
    id,
    ownerId: "reader-1",
    slug: `slug-${id}`,
    url,
    steps: [{ name: "fetch", label: "Fetching the page", status: "running" }],
    status: "running",
    createdAt: new Date().toISOString(),
    ...over,
  } as unknown as Job;
}

function shelved(id: string, url: string): LibraryEntry {
  return {
    slug: `slug-${id}`,
    title: "An essay",
    url,
    words: 1200,
    minutes: 6,
  } as unknown as LibraryEntry;
}

/** The prose, near enough: one external link, in the container the listener is scoped to. */
function Harness({ url, canAdd }: { url: string; canAdd: boolean }) {
  return (
    <>
      <div className="prose">
        <p>
          as{" "}
          <a href={url} target="_blank" rel="noopener noreferrer">
            somebody argued
          </a>{" "}
          elsewhere.
        </p>
      </div>
      <p id="elsewhere">not a link</p>
      <ProseHoverCard
        entries={[]}
        /* **No slug, so the third lookup never fires**, and that is about
           keeping this suite about one thing. `GET /api/link-preview` is
           article-scoped and needs a slug for permission; handing one over here
           would put a second request through the `apiFetch` mock above — which
           answers every URL with the shelf payload — for no assertion's
           benefit. The preview lookup has its own suite. */
        slug={null}
        sourceUrl={READING}
        blockText={new Map()}
        notes={{ byNote: new Map(), noteOf: new Map(), first: null, titled: false }}
        onOpenTerm={() => {}}
        onJump={() => {}}
        onFollowNote={() => {}}
        lookUpLinks={canAdd}
        canAddToShelf={canAdd}
      />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  onTheShelf = [];
  asked.length = 0;
  posted.length = 0;
  useJobsCalls = 0;
  jobs = [];
  added = null;
  failure = null;
  holdPost = false;
  releasePost = null;
  holdShelf = false;
  releaseShelf = null;
  shelfFails = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** `pointerover` on a node, as a mouse resting there emits it. */
function over(el: Element): void {
  const event = new MouseEvent("pointerover", { bubbles: true, clientX: 5, clientY: 5 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  el.dispatchEvent(event);
}

/** Let every promise chain the render started run to the end. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

const linkEl = () => {
  const el = host.querySelector(".prose a");
  if (!el) throw new Error("no link in the prose");
  return el;
};

/** Rest the pointer on the link and wait out the open delay. */
async function hover(): Promise<void> {
  await act(async () => {
    over(linkEl());
  });
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DELAY.open + 10);
  });
  await settle();
}

/** The pointer leaves the prose entirely, and the card is torn down. */
async function unhover(): Promise<void> {
  await act(async () => {
    const el = host.querySelector("#elsewhere");
    if (!el) throw new Error("no #elsewhere");
    over(el);
  });
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DELAY.close * 2);
  });
  await settle();
}

const card = () => document.querySelector(".prose-card");
const text = () => card()?.textContent ?? "";
const footButton = (label: string) =>
  [...document.querySelectorAll(".prose-card-foot button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) ?? null;
const addButton = () => footButton("add to Spideryarn");
/** The same button after a refusal worth repeating — a different label on purpose. */
const tryAgainButton = () => footButton("try again");

async function pressButton(button: Element | null): Promise<void> {
  if (!button) throw new Error("no button to press");
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
  await settle();
}

const press = () => pressButton(addButton());
/** The second attempt, which the card labels differently from the first. */
const press2 = () => pressButton(tryAgainButton());

async function render(url: string, canAdd: boolean): Promise<void> {
  await act(async () => root.render(<Harness url={url} canAdd={canAdd} />));
}

const libraryReads = () => asked.filter((path) => path === "/api/library").length;

/* -------------------------------------------------------------- the tests -- */

describe("who is offered it", () => {
  /**
   * **First, because it is the only test that can run first.** The shelf is a
   * module-level map loaded once per session, so "we have not got it yet" is a
   * state this file can reach exactly once — and it is the state that used to
   * offer to add an article the reader already owned, on the first hover of
   * every session, before `/api/library` had answered. GPT Sol, 2026-09-05,
   * P1-1.
   */
  it("offers nothing until it knows what is on the shelf", async () => {
    holdShelf = true;
    await render("https://example.org/zero", true);
    await hover();
    // The card is drawn and complete from the href alone — only the button waits.
    expect(card()).not.toBe(null);
    expect(text()).toContain("example.org");
    expect(addButton()).toBe(null);

    await act(async () => {
      releaseShelf?.();
    });
    await settle();
    expect(addButton()).not.toBe(null);
  });

  it("draws the button for a reader who owns the shelf", async () => {
    await render("https://example.org/one", true);
    await hover();
    expect(card()).not.toBe(null);
    expect(addButton()).not.toBe(null);
  });

  /**
   * **The one that matters**, and the assertion is the call count rather than
   * the absent button. See the header: a card with no button that still calls
   * `useJobs` is the bug, and it looks exactly like the fix.
   */
  it("neither draws it nor calls useJobs for a visitor", async () => {
    await render("https://example.org/two", false);
    await hover();
    expect(card()).not.toBe(null); // the card itself is still worth drawing
    expect(addButton()).toBe(null);
    expect(useJobsCalls).toBe(0);
    /* **And no lookups either.** A card that drew no button and still asked
       `/api/library` would pass the line above and be the 2026-08-28 bug over
       again — the acceptance test for the public slice is that a signed-out
       browser leaves `/api/public/` never. Only the count can see it, since
       `lookUpLinks` and `canAddToShelf` are one condition in App.tsx today. */
    expect(libraryReads()).toBe(0);
  });

  /** A link back into Spideryarn is a page, not an article: nothing to ingest. */
  it("does not offer it for a link that does not leave the app", async () => {
    await render(`${window.location.origin}/read/something`, true);
    await hover();
    expect(card()).not.toBe(null);
    expect(addButton()).toBe(null);
  });

  /**
   * **The article's link to itself**, which the noema essay really has in its
   * own prose. The shelf lookup would eventually suppress this, but only
   * eventually, and re-ingesting the piece you are reading is the worst thing
   * this button could spend a slot on. The gate reads the href.
   */
  it("does not offer it for a link back to the piece being read", async () => {
    await render(READING, true);
    await hover();
    expect(card()).not.toBe(null);
    expect(addButton()).toBe(null);
  });
});

describe("pressing it", () => {
  it("posts the link's own address and shows the step that is running", async () => {
    const url = "https://example.org/three";
    added = job("job-3", url);
    await render(url, true);
    await hover();
    await press();

    expect(posted).toEqual([url]);
    /* The engine's next poll, posed: the list changes and the card is rendered
       again, exactly as `useSyncExternalStore` would have done.

       **With a decoy in front of it**, sharing this job's slug and URL and
       differing only in its id and its state — an earlier re-run of the same
       article, which is the ordinary thing to find in a real queue. Matching on
       either of the two fields a reader can see would find this one first and
       report a failure over a job that is running fine; only the id tells them
       apart. AddPage.tsx makes the same point about slugs, and GPT Sol asked
       for the decoy on 2026-09-05 because without it the test passes either
       way. */
    jobs = [
      job("decoy", url, { status: "error", error: "An older run of the same article.", steps: [] }),
      job("job-3", url),
    ];
    await render(url, true);
    await settle();
    expect(text()).toContain("Fetching the page");
    expect(text()).not.toContain("An older run");
    expect(addButton()).toBe(null);
  });

  /**
   * The refusal has to outlive the card, or a reader who moved the pointer a
   * centimetre has spent a slot and been told nothing. `lastFailure()` is a ref
   * inside one `useJobs` subscriber, so this can only work if the card wrote
   * the sentence somewhere the teardown does not reach.
   */
  it("keeps a refusal, and its way out, across a teardown", async () => {
    const url = "https://example.org/four";
    added = null;
    /* The bracketed code is at the **end** — `codeOfMessage` anchors there, so
       a fixture with it mid-sentence tests the plain-prose branch instead. */
    failure = "You have used all three free imports, and the pricing page sets one up. [pay-free]";
    await render(url, true);
    await hover();
    await press();
    expect(text()).toContain("all three free imports");

    await unhover();
    await hover();
    expect(text()).toContain("all three free imports");
    // A quota code earns a link to the page that answers it. QuotaNotice.tsx.
    expect(card()?.querySelector('a[href="/pricing"]')).not.toBe(null);
    /* **And no button.** `[pay-free]` is `blocked`, and its own sentence says
       the pricing page is the way forward — a *try again* under it invites the
       reader to spend the attempt they have just been told will not work. GPT
       Sol, 2026-09-05, P1-2. */
    expect(tryAgainButton()).toBe(null);
  });

  /**
   * The other half of that rule: a refusal that *is* worth another go keeps a
   * button, so the fix above is a distinction rather than a deletion.
   */
  it("offers another go after a refusal that another go could fix", async () => {
    const url = "https://example.org/four-b";
    added = null;
    // No bracketed code at all — `worthRetrying` treats an unclassified failure
    // as worth repeating, which is the same benefit of the doubt a job gets.
    failure = "The server did not answer just then.";
    await render(url, true);
    await hover();
    await press();

    expect(text()).toContain("did not answer");
    expect(tryAgainButton()).not.toBe(null);
    expect(addButton()).toBe(null); // it is a second attempt, and says so

    added = job("job-4b", url);
    await press2();
    expect(posted).toEqual([url, url]);
  });

  /**
   * **Between the press and the POST answering there is no job to read**, so a
   * card rebuilt in that window has nothing but the module map to tell it an
   * add is already going. Without that this is a second enabled button over a
   * metered action, which billing deduplicates but can still transiently
   * reserve or refuse. GPT Sol, 2026-09-05, P2-1.
   */
  it("does not offer a second press while the first is still in flight", async () => {
    const url = "https://example.org/five";
    added = job("job-5", url);
    holdPost = true;
    await render(url, true);
    await hover();
    await press();

    await unhover();
    await hover();
    expect(addButton()).toBe(null);
    expect(text()).toContain("adding it to your shelf");

    await act(async () => {
      releasePost?.();
    });
    await settle();
    expect(posted).toEqual([url]);
  });
});

/**
 * **The loop that makes the feature compound.**
 *
 * The pointer is taken away before the job finishes, which is what actually
 * happens. So there is no card mounted at the moment of completion, and nothing
 * for a completion callback to run — the card has to notice the terminal status
 * when it comes back, and re-read a shelf that is otherwise loaded once and
 * never again.
 */
describe("and when it finishes", () => {
  it("re-reads the shelf on the next hover and offers to read it here", async () => {
    const url = "https://example.org/six";
    added = job("job-6", url);
    await render(url, true);
    await hover();
    /* Relative, not absolute: whether this hover loads the shelf depends on
       whether an earlier test in this file already did — the map is
       module-level. What must be true either way is that finishing the job
       costs exactly one more read. */
    const before = libraryReads();

    await press();
    await unhover();

    // The ingest runs and lands while nothing is watching.
    jobs = [job("job-6", url, { status: "done", steps: [] })];
    onTheShelf = [shelved("job-6", url)];

    await hover();
    await settle();

    expect(libraryReads()).toBe(before + 1);
    expect(text()).toContain("on your shelf");
    expect(text()).toContain("read it here");
    expect(addButton()).toBe(null);
  });

  /**
   * **A refresh that failed is not a refresh that happened.**
   *
   * The completed job is marked as spent before the request goes out, so two
   * cards over the same job make one request — and the mark has to come back
   * off when the request found nothing out, or the card sits on *added to your
   * shelf* and nothing ever asks again. GPT Sol, 2026-09-05, P2-1.
   *
   * The second half matters as much: the shelf we already had survives the
   * failure, so a blip does not take *on your shelf* away from every other link
   * in the article.
   */
  it("tries the shelf again on a later hover when the refresh failed", async () => {
    const url = "https://example.org/seven";
    added = job("job-7", url);
    await render(url, true);
    await hover();
    const before = libraryReads();
    await press();
    await unhover();

    jobs = [job("job-7", url, { status: "done", steps: [] })];
    onTheShelf = [shelved("job-7", url)];

    // The network is gone at exactly the moment the job lands.
    shelfFails = true;
    await hover();
    await settle();
    expect(libraryReads()).toBe(before + 1);
    expect(text()).toContain("added to your shelf");
    expect(text()).not.toContain("read it here");

    // And on the next hover it asks again, rather than treating that as done.
    shelfFails = false;
    await unhover();
    await hover();
    await settle();
    expect(libraryReads()).toBe(before + 2);
    expect(text()).toContain("on your shelf");
    expect(text()).toContain("read it here");
  });
});

/**
 * **The arms a mounted card cannot cheaply reach**, asked of the pure function
 * the card draws from.
 *
 * A failed ingest, a stopped one, and a job that has aged out of the queue are
 * all real and none of them is worth a minute of posed hovering. What matters
 * is that each one leads somewhere: a reader whose add failed must be able to
 * try again, or the card is a dead end over a slot they have already spent.
 */
describe("what the card draws, given what the queue says", () => {
  const again = () => {};
  const queued = { kind: "queued", jobId: "j" } as const;

  it("offers the button when nothing has been asked", () => {
    expect(describeAdd(undefined, null, again)).toEqual({ kind: "offer", add: again, after: null });
  });

  /* The two refusal shapes, side by side, because the difference between them
     is the whole of finding P1-2: one is worth pressing again and one is a
     reader being invited to spend an attempt that cannot work. */
  it("keeps a button under a refusal another go could fix", () => {
    const blip = { kind: "refused", message: "The server did not answer." } as const;
    expect(describeAdd(blip, null, again)).toEqual({
      kind: "offer",
      add: again,
      after: "The server did not answer.",
    });
  });

  it("offers nothing to press under a quota refusal", () => {
    const quota = {
      kind: "refused",
      message: "You have used all three free imports. [pay-free]",
    } as const;
    expect(describeAdd(quota, null, again)).toEqual({
      kind: "refused",
      message: "You have used all three free imports. [pay-free]",
    });
  });

  it("says it is going when the job is not in the list yet", () => {
    expect(describeAdd(queued, null, again)).toEqual({
      kind: "working",
      line: "adding it to your shelf…",
    });
  });

  it("names the running step rather than a generic line", () => {
    const running = job("j", "https://example.org/seven");
    expect(describeAdd(queued, running, again)).toEqual({
      kind: "working",
      line: "Fetching the page",
    });
  });

  /* Between two steps there is no running one, and a blank line would be worse
     than a general one. */
  it("falls back to the general line between steps", () => {
    const between = job("j", "https://example.org/eight", { steps: [] });
    expect(describeAdd(queued, between, again)).toEqual({
      kind: "working",
      line: "adding it to your shelf…",
    });
  });

  /**
   * **A failed ingest gets its sentence and nothing to press**, even when the
   * failure is one another attempt could fix. Retrying an ingest is
   * `POST /api/jobs/:id/retry`, which keeps the slug and the finished steps;
   * all this card could press is a fresh `add`, which is a different action
   * wearing the same word. GPT Sol, 2026-09-05, P1-2.
   */
  it("shows a failed ingest's own sentence, and offers no retry of its own", () => {
    const failed = job("j", "https://example.org/nine", {
      status: "error",
      error: "The AI service is busy right now. [ai-429]",
      steps: [],
    });
    expect(describeAdd(queued, failed, again)).toEqual({
      kind: "refused",
      message: "The AI service is busy right now. [ai-429]",
    });
  });

  /* A job the reader stopped is not a failure and needs no sentence — the
     button they pressed Stop on simply comes back. */
  it("offers the button again after the reader stopped it", () => {
    const stopped = job("j", "https://example.org/ten", { status: "cancelled", steps: [] });
    expect(describeAdd(queued, stopped, again)).toEqual({
      kind: "offer",
      add: again,
      after: null,
    });
  });

  it("says it landed when the job is done and the shelf has not caught up", () => {
    const done = job("j", "https://example.org/eleven", { status: "done", steps: [] });
    expect(describeAdd(queued, done, again)).toEqual({ kind: "added" });
  });
});
