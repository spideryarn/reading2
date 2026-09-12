// @vitest-environment jsdom
/**
 * **A panel's opening read must not erase what the reader added while it
 * waited.**
 *
 * Saved searches, referee criteria and comments each GET their whole list when
 * they open and put it on screen with a *replace*. Each also lets the reader add
 * a row. Until 2026-09-11 nothing ordered the two, so this schedule was open on
 * all three: the GET captures old row A → the reader runs / saves B → B
 * completes and is shown → the GET lands and replaces the list with A alone. B
 * was still in Postgres; it was gone from this tab.
 * docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md.
 *
 * Greg chose the order over a merge (2026-09-11): typing stays possible, and
 * Run / Find / Save — including the keyboard's submit — are refused until the
 * opening read settles, **successfully, with an error, or at its deadline**
 * (src/web/lib/opening-read.ts). docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md § A.
 *
 * ## What each surface is asked, and why both rows
 *
 * - **While the read is out**, the action is refused through every door it has
 *   (the button, the form's submit, the key chord), **no request is sent**, and
 *   the reader's draft is still in the box.
 * - **After it succeeds**, the action works and **A and B are both on screen**.
 *   Requiring A as well as B is what rejects the tempting wrong fix — dropping
 *   the opening snapshot whenever a write begins — which leaves B alone and
 *   loses every row saved before today.
 * - **After it fails**, its error is shown and the action works — **and the
 *   panel goes on saying the list did not load once the new row is there.**
 *   Until the follow-up the same day, a load error and a write's error shared
 *   one slot and the write cleared it, so the reader saw their new row alone
 *   with nothing to say the older ones were missing. Each hook now keeps the
 *   load's failure in `loadError`, which only a new load resets, and `error`
 *   is the writes' alone.
 * - **After the deadline**, the action works, B is made, and then the late GET
 *   is released carrying A: B must survive it. That is the ordering the
 *   deadline has to get right — invalidate the snapshot *before* enabling
 *   writes.
 *
 * Every "nothing was sent" is paired with a positive control in the same case —
 * the same press, once loaded, sends exactly one request — so a harness that
 * had silently stopped reaching the handler could not pass as a refusal.
 *
 * **Outside StrictMode first**, as the plan asks: a development remount runs the
 * opening effect twice and can hide an ordering bug behind a second GET. One
 * StrictMode case per surface follows.
 *
 * ## Mounted, and where that stops
 *
 * Criteria and Search mount their real bands (`CriteriaBand`, `SearchBand`),
 * hook and all. Comments mounts the real `AnnotateDialog` over the real
 * `useComments`, wired the way `Reader` wires them; `Reader` itself needs a whole
 * article, a session and a text selection to open the dialog, so the one line of
 * wiring this cannot see — that `Reader` passes the hook's `loaded` — is read
 * from its source at the end, the precedent being
 * tests/one-escape-closes-one-surface.test.tsx.
 */
import { readFileSync } from "node:fs";
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId, Comment, SearchRun } from "../src/types.js";

/** One reply per request, decided by the case that is running. */
let answer: (url: string, init: RequestInit) => Promise<Response>;
/**
 * Real fetch honours an abort, but the deadline's safety must not depend on
 * that courtesy arriving before a late response. The deadline cases turn this
 * off so they prove the losing `read` promise cannot commit even when it does
 * eventually fulfil.
 */
let honourAbort = true;

/* `apiFetch` and `fetchOk` both, because `fetchOk` calls `apiFetch` through the
   module's own binding — tests/referee-criteria-panel.test.tsx § the mock.
   `readJson` and `failure` stay real: they decide whether a reply is an answer.

   **The signal is normally honoured**, as real `fetch` honours it. The deadline
   cases deliberately turn that off: aborting is useful cleanup, but the safety
   claim is that the already-lost race cannot commit even if an answer still
   arrives. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => {
    const reply = answer(url, init);
    const signal = init.signal;
    if (!signal || !honourAbort) return reply;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      reply.then(resolve, reject);
    });
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");
const { SearchBand } = await import("../src/web/modes/search/SearchMode.js");
const { AnnotateDialog } = await import("../src/web/AnnotateDialog.js");
const { NO_MARK } = await import("../src/web/PlaceOnCriterion.js");
const { useComments } = await import("../src/web/useComments.js");
const { OPENING_READ_DEADLINE_MS } = await import("../src/web/lib/opening-read.js");
const { Dock } = await import("../src/web/Dock.js");
const { EXPERIMENTAL_OFF } = await import("./helpers/experimental-fixtures.js");

const SLUG = "a-paper";
const BLOCK = "spya-k3m9qt" as BlockId;
const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;
let strict = false;

function render(node: ReturnType<typeof createElement>): void {
  act(() => {
    root.render(strict ? createElement(StrictMode, null, node) : node);
  });
}

/**
 * Let fetch chains and stream readers settle. Under fake timers the clock is
 * advanced by a millisecond a hop instead, because `setTimeout(0)` would never
 * fire.
 */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
      else await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A finished SSE stream: every frame, then the end. */
function sse(frames: { event: string; data: unknown }[]): Response {
  const text = frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join("");
  return new Response(new TextEncoder().encode(text), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A reply the case releases by hand — the opening GET, held. */
function held(): { promise: Promise<Response>; release(r: Response): void } {
  let release!: (r: Response) => void;
  const promise = new Promise<Response>((res) => {
    release = res;
  });
  return { promise, release };
}

const method = (init: RequestInit) => (init.method ?? "GET").toUpperCase();
const sentId = (init: RequestInit) => (JSON.parse(String(init.body)) as { id: string }).id;

/** Type into a React-controlled field: the native setter, then the event React listens for. */
function type(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

function key(el: Element, init: KeyboardEventInit): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

/** The form's own submit — what Enter on a focused button, or Space, arrives as. */
function submit(form: HTMLFormElement): void {
  act(() => {
    form.requestSubmit();
  });
}

function must<T extends Element>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  strict = false;
  honourAbort = true;
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/* The deadline cases fake only the clock the deadline runs on, so fetch's own
   promise plumbing is untouched. */
function fakeClock(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

async function pastTheDeadline(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(OPENING_READ_DEADLINE_MS + 1);
  });
  await flush();
}

/* ============================================================== Criteria == */

const OLD_CRITERION = "Are the controls adequate for the comparisons being drawn?";
const NEW_CRITERION = "Is the sample size justified?";

function criterionRow(id: string, criterion: string): SavedCriterion {
  return {
    id,
    criterion,
    config: { kind: "single" },
    createdAt: "2026-09-01T09:00:00.000Z",
    status: "done",
    results: [],
  };
}
const OLD_ROW = criterionRow("spya-crt2aa", OLD_CRITERION);

/** The server: a held GET, and a POST that streams the new criterion to done. */
function criteriaServer() {
  const get = held();
  const posted: string[] = [];
  answer = (_url, init) => {
    if (method(init) === "GET") return get.promise;
    if (method(init) === "POST") {
      const id = sentId(init);
      posted.push(id);
      const row = criterionRow(id, NEW_CRITERION);
      return Promise.resolve(
        sse([
          { event: "begin", data: { ...row, status: "pending", sourceHash: "h" } },
          { event: "done", data: { ...row, sourceHash: "h" } },
        ]),
      );
    }
    return Promise.resolve(json({ ok: true }));
  };
  return { get, posted };
}

function mountCriteria(): void {
  render(
    createElement(
      NuqsAdapter,
      null,
      createElement(CriteriaBand, {
        slug: SLUG,
        blocks: BLOCKS,
        comments: [],
        onJump: () => {},
        onFound: () => {},
        openKey: null,
        onOpenKey: () => {},
      }),
    ),
  );
}

const critText = () => must<HTMLTextAreaElement>("#crit-text");
const critRun = () => must<HTMLButtonElement>(".crit-run");
const critForm = () => must<HTMLFormElement>("form.crit-new");

/** Every door the Run action has: the button, and the form's submit. */
function pressRunEveryWay(): void {
  click(critRun());
  submit(critForm());
}

describe("Criteria: Run waits for the opening read", () => {
  it("refuses Run while the list is loading, keeps the draft, and keeps both rows after", async () => {
    const { get, posted } = criteriaServer();
    mountCriteria();
    await flush();

    type(critText(), NEW_CRITERION);
    pressRunEveryWay();
    await flush();
    expect(posted, "Run sent a criterion while the opening read was still out").toHaveLength(0);
    expect(critRun().getAttribute("aria-disabled")).toBe("true");
    expect(critText().value, "the refused press threw the draft away").toBe(NEW_CRITERION);

    get.release(json({ criteria: [OLD_ROW], sourceHash: "h" }));
    await flush();
    expect(host.textContent).toContain(OLD_CRITERION);

    // The positive control: the same press, now loaded, sends exactly one.
    click(critRun());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent, "the pre-existing criterion was lost").toContain(OLD_CRITERION);
    expect(host.textContent, "the criterion just run is not on screen").toContain(NEW_CRITERION);
  });

  it("shows the opening-read error and releases Run when the read fails", async () => {
    const { get, posted } = criteriaServer();
    mountCriteria();
    await flush();
    type(critText(), NEW_CRITERION);

    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await flush();
    expect(host.textContent).toContain("[db-busy]");

    click(critRun());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(NEW_CRITERION);
  });

  it("goes on saying the list did not load after a new criterion is run", async () => {
    const { get, posted } = criteriaServer();
    mountCriteria();
    await flush();
    type(critText(), NEW_CRITERION);
    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await flush();

    click(critRun());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(NEW_CRITERION);
    expect(host.textContent, "the run cleared the load's error").toContain("[db-busy]");
    expect(host.textContent, "nothing says the earlier criteria are missing").toContain(
      "Couldn't load your criteria",
    );
  });

  it("gives up at the deadline, releases Run, and a late answer cannot erase the new row", async () => {
    fakeClock();
    honourAbort = false;
    const { get, posted } = criteriaServer();
    mountCriteria();
    await flush();
    type(critText(), NEW_CRITERION);

    await pastTheDeadline();
    expect(host.textContent).toContain("[rd-timeout]");

    click(critRun());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(NEW_CRITERION);

    // The GET that was given up on answers after all, carrying only the old row.
    get.release(json({ criteria: [OLD_ROW], sourceHash: "h" }));
    await flush();
    expect(host.textContent, "the abandoned read erased the criterion run after it").toContain(
      NEW_CRITERION,
    );
    /* And it did not sneak the old row in either: the read was given up on,
       so its answer has no right to commit anything at all. The timeout's
       sentence is still there, because the old rows are still not. */
    expect(host.textContent).not.toContain(OLD_CRITERION);
    expect(host.textContent).toContain("[rd-timeout]");
  });

  it("holds under StrictMode too", async () => {
    strict = true;
    const { get, posted } = criteriaServer();
    mountCriteria();
    await flush();
    type(critText(), NEW_CRITERION);
    pressRunEveryWay();
    await flush();
    expect(posted).toHaveLength(0);

    get.release(json({ criteria: [OLD_ROW], sourceHash: "h" }));
    await flush();
    click(critRun());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(OLD_CRITERION);
    expect(host.textContent).toContain(NEW_CRITERION);
  });
});

/* ================================================================ Search == */

const OLD_QUESTION = "arguments against substrate independence";
const NEW_QUESTION = "anywhere he gives numbers";

function runRow(id: string, criterion: string): SearchRun {
  return { id, criterion, createdAt: "2026-09-01T09:00:00.000Z", status: "done", hits: [] };
}
const OLD_RUN = runRow("spya-aaaab2", OLD_QUESTION);

function searchServer() {
  const get = held();
  const posted: string[] = [];
  answer = (_url, init) => {
    if (method(init) === "GET") return get.promise;
    if (method(init) === "POST") {
      const id = sentId(init);
      posted.push(id);
      const run = runRow(id, NEW_QUESTION);
      return Promise.resolve(
        sse([
          { event: "begin", data: { ...run, status: "pending", sourceHash: "h" } },
          { event: "done", data: { ...run, sourceHash: "h" } },
        ]),
      );
    }
    return Promise.resolve(json({ ok: true }));
  };
  return { get, posted };
}

function mountSearch(): void {
  render(
    createElement(
      NuqsAdapter,
      null,
      createElement(SearchBand, {
        slug: SLUG,
        blocks: BLOCKS,
        onJump: () => {},
        onFound: () => {},
        openHit: null,
        onOpenHit: () => {},
      }),
    ),
  );
}

const searchBox = () => must<HTMLInputElement>('input[aria-label="Describe what to look for"]');
const findButton = () => must<HTMLButtonElement>(".srch-go");

function pressFindEveryWay(): void {
  click(findButton());
  key(searchBox(), { key: "Enter" });
}

describe("Search: Find waits for the opening read", () => {
  it("refuses Find and Enter while the list is loading, keeps the draft, and keeps both runs after", async () => {
    const { get, posted } = searchServer();
    mountSearch();
    await flush();

    type(searchBox(), NEW_QUESTION);
    pressFindEveryWay();
    await flush();
    expect(posted, "a search was sent while the opening read was still out").toHaveLength(0);
    expect(findButton().disabled).toBe(true);
    expect(searchBox().value, "the refused press threw the draft away").toBe(NEW_QUESTION);

    get.release(json({ runs: [OLD_RUN] }));
    await flush();
    expect(host.textContent).toContain(OLD_QUESTION);

    key(searchBox(), { key: "Enter" });
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent, "the saved search from before was lost").toContain(OLD_QUESTION);
    expect(host.textContent, "the search just run is not on screen").toContain(NEW_QUESTION);
  });

  it("shows the opening-read error and releases Find when the read fails", async () => {
    const { get, posted } = searchServer();
    mountSearch();
    await flush();
    type(searchBox(), NEW_QUESTION);

    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await flush();
    expect(host.textContent).toContain("[db-busy]");

    click(findButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(NEW_QUESTION);
  });

  it("goes on saying the list did not load after a new search is run", async () => {
    const { get, posted } = searchServer();
    mountSearch();
    await flush();
    type(searchBox(), NEW_QUESTION);
    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await flush();

    click(findButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(NEW_QUESTION);
    expect(host.textContent, "the search cleared the load's error").toContain("[db-busy]");
    expect(host.textContent, "nothing says the earlier searches are missing").toContain(
      "Couldn't load your saved searches",
    );
  });

  it("gives up at the deadline, releases Find, and a late answer cannot erase the new run", async () => {
    fakeClock();
    honourAbort = false;
    const { get, posted } = searchServer();
    mountSearch();
    await flush();
    type(searchBox(), NEW_QUESTION);

    await pastTheDeadline();
    expect(host.textContent).toContain("[rd-timeout]");

    click(findButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(NEW_QUESTION);

    get.release(json({ runs: [OLD_RUN] }));
    await flush();
    expect(host.textContent, "the abandoned read erased the search run after it").toContain(
      NEW_QUESTION,
    );
    expect(host.textContent, "the abandoned read committed after all").not.toContain(OLD_QUESTION);
    expect(host.textContent).toContain("[rd-timeout]");
  });

  it("holds under StrictMode too", async () => {
    strict = true;
    const { get, posted } = searchServer();
    mountSearch();
    await flush();
    type(searchBox(), NEW_QUESTION);
    pressFindEveryWay();
    await flush();
    expect(posted).toHaveLength(0);

    get.release(json({ runs: [OLD_RUN] }));
    await flush();
    click(findButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.textContent).toContain(OLD_QUESTION);
    expect(host.textContent).toContain(NEW_QUESTION);
  });
});

/* ============================================================== Comments == */

const OLD_BODY = "A bookmark from last week.";
const NEW_BODY = "No control group — worth raising.";
const ANCHOR = { blockId: BLOCK, quote: "no unexposed comparison group", start: 44 };

function commentRow(id: string, body: string): Comment {
  return {
    id,
    blockId: BLOCK,
    quote: ANCHOR.quote,
    start: ANCHOR.start,
    createdAt: "2026-09-01T09:00:00.000Z",
    body,
    status: "none",
  };
}
const OLD_COMMENT = commentRow("spya-cmt2aa", OLD_BODY);

function commentsServer() {
  const get = held();
  const posted: string[] = [];
  answer = (_url, init) => {
    if (method(init) === "GET") return get.promise;
    if (method(init) === "POST") {
      const id = sentId(init);
      posted.push(id);
      return Promise.resolve(json({ comment: commentRow(id, NEW_BODY) }));
    }
    return Promise.resolve(json({ ok: true }));
  };
  return { get, posted };
}

/**
 * The real dialog over the real hook, joined as `Reader` joins them: the save
 * closes the dialog and stores the comment. The list is printed so the case can
 * see what the tab is showing.
 */
function CommentsHarness() {
  const comments = useComments(SLUG);
  const [open, setOpen] = useState(true);
  return createElement(
    "div",
    null,
    createElement(
      "ul",
      { className: "listed" },
      comments.comments.map((c) => createElement("li", { key: c.id }, c.body ?? c.quote)),
    ),
    comments.loadError && createElement("p", { className: "listed-error" }, comments.loadError),
    comments.error && createElement("p", { className: "listed-error" }, comments.error),
    open &&
      createElement(AnnotateDialog, {
        anchor: ANCHOR,
        placing: false,
        loaded: comments.loaded,
        onCancel: () => setOpen(false),
        onSave: (id: string, body: string, _ask: boolean, mark: typeof NO_MARK) => {
          setOpen(false);
          void comments.create({
            id,
            blockId: ANCHOR.blockId,
            quote: ANCHOR.quote,
            start: ANCHOR.start,
            ...(body ? { body } : {}),
            mark,
          });
        },
      }),
  );
}

function mountComments(): void {
  render(createElement(CommentsHarness));
}

/** The hook the drawer case is driving, so it can make a second write. */
let drawerApi: ReturnType<typeof useComments> | undefined;

/**
 * The same hook and dialog, with the **real Dock drawer** as the list — joined
 * as `Reader` joins them (`drawer={{ loaded, loadError, error, … }}`), because
 * the drawer is where a reader learns both that the list did not load and that
 * a change did not save, and `CommentsHarness` above prints the hook's fields
 * rather than the app's sentences.
 */
function DrawerHarness() {
  const comments = useComments(SLUG);
  drawerApi = comments;
  const [open, setOpen] = useState(true);
  const [panel, setPanel] = useState<"questions" | null>(null);
  return createElement(
    "div",
    null,
    createElement(Dock, {
      slug: SLUG,
      view: "article" as const,
      experimental: EXPERIMENTAL_OFF,
      drawer: {
        comments: comments.comments,
        paragraphs: new Map(),
        loaded: comments.loaded,
        loadError: comments.loadError,
        error: comments.error,
        panel,
        onPanel: setPanel,
        onOpenComment: () => {},
      },
    }),
    open &&
      createElement(AnnotateDialog, {
        anchor: ANCHOR,
        placing: false,
        loaded: comments.loaded,
        onCancel: () => setOpen(false),
        onSave: (id: string, body: string, _ask: boolean, mark: typeof NO_MARK) => {
          setOpen(false);
          /* Open the drawer only after the dialog closes. Keeping it open
             underneath the dialog lets jsdom click through a scrim that a
             reader cannot click through. */
          setPanel("questions");
          void comments.create({
            id,
            blockId: ANCHOR.blockId,
            quote: ANCHOR.quote,
            start: ANCHOR.start,
            ...(body ? { body } : {}),
            mark,
          });
        },
      }),
  );
}

const commentBox = () => must<HTMLTextAreaElement>('textarea[aria-label="Your comment on this passage"]');
const saveButton = () => must<HTMLButtonElement>(".annotate-save");
const annotateForm = () => must<HTMLFormElement>(".annotate-dialog form");
const listed = () => host.querySelector(".listed")?.textContent ?? "";

function pressSaveEveryWay(): void {
  click(saveButton());
  key(commentBox(), { key: "Enter", ctrlKey: true });
  key(commentBox(), { key: "Enter", metaKey: true });
  submit(annotateForm());
}

describe("Comments: Save waits for the opening read", () => {
  it("refuses Save and ⌘/Ctrl+Enter while the list is loading, keeps the draft, and keeps both after", async () => {
    const { get, posted } = commentsServer();
    mountComments();
    await flush();

    type(commentBox(), NEW_BODY);
    pressSaveEveryWay();
    await flush();
    expect(posted, "a comment was saved while the opening read was still out").toHaveLength(0);
    expect(saveButton().disabled).toBe(true);
    expect(commentBox().value, "the refused press threw the draft away").toBe(NEW_BODY);

    get.release(json({ comments: [OLD_COMMENT] }));
    await flush();
    expect(listed()).toContain(OLD_BODY);

    key(commentBox(), { key: "Enter", ctrlKey: true });
    await flush();
    expect(posted).toHaveLength(1);
    expect(listed(), "the comment from before was lost").toContain(OLD_BODY);
    expect(listed(), "the comment just saved is not on screen").toContain(NEW_BODY);
  });

  it("says why Save is waiting", async () => {
    commentsServer();
    mountComments();
    await flush();
    expect(host.querySelector(".annotate-hint")?.textContent).toMatch(/loading/i);
  });

  it("shows the opening-read error and releases Save when the read fails", async () => {
    const { get, posted } = commentsServer();
    mountComments();
    await flush();
    type(commentBox(), NEW_BODY);

    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await flush();
    expect(host.textContent).toContain("[db-busy]");

    click(saveButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(listed()).toContain(NEW_BODY);
  });

  it("goes on saying the list did not load after a comment is saved, and says a failed change too", async () => {
    const { get, posted } = commentsServer();
    render(createElement(DrawerHarness));
    await flush();
    type(commentBox(), NEW_BODY);
    get.release(json({ error: "The database is busy. [db-busy]" }, 503));
    await flush();

    click(saveButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(host.querySelector(".dock-questions")?.textContent).toContain(NEW_BODY);
    expect(host.textContent, "nothing says the earlier comments are missing").toContain(
      "Couldn't load your comments",
    );
    /* And its code, as Search and Criteria give theirs, so a reader reporting
       it has something to quote. The Overseer's call, 2026-09-11. */
    expect(host.querySelector(".dock-questions")?.previousElementSibling?.textContent).toContain(
      "[db-busy]",
    );

    /* A change that does not save, after that failed load: the drawer used to
       drop every write error while `loadFailed` was set, because the load's
       failure arrived in the same field. */
    const saved = posted[0]!;
    answer = () => Promise.resolve(json({ error: "Could not save that. [db-write]" }, 500));
    await act(async () => {
      await drawerApi!.edit(saved, "changed my mind");
    });
    await flush();
    expect(host.querySelector(".dock-drawer-error")?.textContent, "the failed change was hidden").toContain(
      "[db-write]",
    );
    expect(host.textContent).toContain("Couldn't load your comments");
  });

  it("gives up at the deadline, releases Save, and a late answer cannot erase the new comment", async () => {
    fakeClock();
    honourAbort = false;
    const { get, posted } = commentsServer();
    mountComments();
    await flush();
    type(commentBox(), NEW_BODY);

    await pastTheDeadline();
    expect(host.textContent).toContain("[rd-timeout]");

    click(saveButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(listed()).toContain(NEW_BODY);

    get.release(json({ comments: [OLD_COMMENT] }));
    await flush();
    expect(listed(), "the abandoned read erased the comment saved after it").toContain(NEW_BODY);
    expect(listed(), "the abandoned read committed after all").not.toContain(OLD_BODY);
    expect(host.textContent).toContain("[rd-timeout]");
  });

  it("holds under StrictMode too", async () => {
    strict = true;
    const { get, posted } = commentsServer();
    mountComments();
    await flush();
    type(commentBox(), NEW_BODY);
    pressSaveEveryWay();
    await flush();
    expect(posted).toHaveLength(0);

    get.release(json({ comments: [OLD_COMMENT] }));
    await flush();
    click(saveButton());
    await flush();
    expect(posted).toHaveLength(1);
    expect(listed()).toContain(OLD_BODY);
    expect(listed()).toContain(NEW_BODY);
  });

  it("is wired to the hook's `loaded` by Reader, the one caller this file cannot mount", () => {
    const source = readFileSync("src/web/reader/Reader.tsx", "utf8");
    const start = source.indexOf("<AnnotateDialog");
    const end = source.indexOf("onSave=", start);
    expect(start, "Reader no longer mounts AnnotateDialog").toBeGreaterThan(-1);
    expect(source.slice(start, end)).toContain("loaded={owner.comments.loaded}");
  });

  it("withholds the gutter's bookmark button until the opening read has landed, and landed well", () => {
    /* Before the list arrives every block looks unmarked, so the button would be
       offered everywhere: a press could be erased by the arriving list, or add a
       second mark to a paragraph whose note nobody had fetched. The callback is
       the capability (BlockGutter.tsx), so gating the callback is gating the
       button. GPT Sol, reviewing plan 260912c. */
    const source = readFileSync("src/web/reader/Reader.tsx", "utf8");
    const at = source.indexOf("onBookmark={");
    expect(at, "Reader no longer hands the table a bookmark callback").toBeGreaterThan(-1);
    const prop = source.slice(at, source.indexOf("}\n", at) + 1);
    expect(prop).toContain("owner.comments.loaded");
    expect(prop).toContain("owner.comments.loadError === null");
  });
});
