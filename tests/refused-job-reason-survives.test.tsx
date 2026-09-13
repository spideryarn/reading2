// @vitest-environment jsdom
/**
 * **The server's reason for refusing a job must still be on screen a second
 * later.**
 *
 * `useStepJob` says `postFailed ? reason : stopped`, and until 2026-08-28 the
 * reason it read was `queue.error` — which is **shared polling state**, not a
 * record of what happened. The sequence nobody had driven:
 *
 *   1. the POST to `/api/jobs` is refused, and `readJson` throws the server's
 *      own `{ error }` sentence;
 *   2. `act` in useJobs.ts catches it, puts that sentence in `error`, and then
 *      its `finally` **immediately pokes the poller**;
 *   3. the poll answers normally, because the server is perfectly well — and
 *      `setError(null)` on the success path wipes the sentence;
 *   4. `failed` falls back to *"Couldn't start the job."*
 *
 * So the reader gets the truth for one frame — long enough for a test with a
 * static mock to see it, and not long enough for a person to read it. That is
 * exactly the shape docs/reusable/silent-success.md is about: the check agrees
 * with the code because it shares its assumption, and here the shared
 * assumption is that nothing else touches `error` between the failure and the
 * render.
 *
 * ## Why this file mocks so little
 *
 * `tests/background-reload-keeps-the-list.test.tsx` covers the same `failed`
 * expression with a **posed** `useJobs` whose `error` is a fixed value and
 * whose `run` never pokes anything. That proves the ternary. It cannot prove
 * the sequence, because the sequence *is* the poll.
 *
 * So the real `useJobs`, the real `apiFetch` and the real `readJson` run here,
 * against a stubbed global `fetch` — the pattern
 * `tests/refused-writes-are-reported.test.tsx` established, and for the same
 * reason: the durability being tested is a property of how those three
 * interact, and any stand-in for one of them decides the answer.
 *
 * The poll's replies are **held**, so the test can look at the state before the
 * poll lands and again after it. Both readings are asserted, and the first one
 * is what tells a failing run apart from a test that never reached the bug:
 * before the poll, both the broken and the fixed code say the right thing.
 *
 * One *hook* surface is driven rather than three. All three go through
 * `useStepJob`, and `tests/step-job-force.test.tsx` is what proves that they do.
 *
 * The thread page is driven separately below, because it was the fourth copy of
 * this and the one that did **not** go through the hook — so for it, "does the
 * reason survive the poll" was a live question rather than a fact inherited
 * from a shared module. It is kept after the conversion for the same reason the
 * fixture above is: the way this breaks is by somebody reintroducing a private
 * `queue.error` read, and that is exactly what a page mounted whole can catch.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The auth client, and nothing else from `lib/`. `apiFetch` asks for an access
 * token before every request; an anonymous one is what these requests are.
 * Copied from `tests/refused-writes-are-reported.test.tsx`.
 */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      refreshSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

/* The thread page's bottom bar reaches Supabase and the whole visitor layer,
   and none of it is what this file is about. Same reason as
   tests/background-reload-keeps-the-list.test.tsx. */
vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));

const { useIdeas } = await import("../src/web/useIdeas.js");
const { Tweets } = await import("../src/web/Tweets.js");
const { AddPage } = await import("../src/web/AddPage.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

/** Enough article for the page to render its head. */
const ARTICLE = {
  meta: { slug: "constitution", title: "A Constitution", url: "https://example.com/c" },
  blocks: [{ id: "spya-a", kind: "p", text: "some words here" }],
  tree: { rootId: "spya-root", nodes: {} },
} as unknown as Article;

/** What the server says when it refuses the job. */
const REFUSED = "You are out of credit for today.";

/**
 * The sentence the refusal carries, so one case can send a **quota** refusal.
 *
 * A variable rather than a second stub: the add-page cases below are about what
 * happens to the server's words, and a `[pay-free]` code changes what the page
 * draws around them (`QuotaNotice`, and the `worthRetrying` gate on *Try
 * again*). Reset to `REFUSED` before each case.
 */
let refused = REFUSED;

/** Every request the stub was asked to make, so a test can prove one happened. */
let sent: { method: string; url: string }[] = [];
/** Whether the next `POST /api/jobs` is refused. The second test turns it off. */
let refusing = true;
/** Job-list polls waiting to be answered. See the header — the holding is the test. */
let heldPolls: Array<() => void> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;
let ideas: ReturnType<typeof useIdeas> | null = null;

function Harness(): ReactElement {
  ideas = useIdeas("constitution");
  return createElement("div", null, ideas.failed?.message ?? "");
}

beforeEach(() => {
  /* **The poller is a tab-level singleton since 2026-09-01**
     (src/web/jobEngine.ts), so it outlives a test the way it outlives a route.
     Every case below counts polls exactly — `toBe(1)`, `toBe(2)` — and without
     this a timer armed by the previous case contributes one of them, which is
     a failure that reads as a race in the code under test. */
  jobEngine.reset();
  sent = [];
  heldPolls = [];
  ideas = null;
  refusing = true;
  refused = REFUSED;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      sent.push({ method, url });
      if (method === "POST" && url === "/api/jobs") {
        /* Received and **refused**, with a reason written for a reader. This is
           the case `postFailed` cannot tell from a dead network on its own. */
        if (refusing) return json({ error: refused }, 402);
        return json({ id: "job1", slug: "constitution", status: "queued", steps: [] });
      }
      if (url === "/api/jobs") {
        /* The poll, and the server is fine — which is the whole point. Held, so
           the test decides when it lands. */
        await new Promise<void>((go) => heldPolls.push(go));
        return json({ jobs: [] });
      }
      /* No thread for this article yet — the ordinary 404, and the state the
         thread page's "Write the thread" button is pressed from. */
      if (url.startsWith("/api/tweets/")) return new Response(null, { status: 404 });
      /* Nobody has asked for ideas on this article yet: the ordinary 404, and
         the state the button is pressed from. */
      return new Response(null, { status: 404 });
    }),
  );
  /* **A session, because a mounted subscriber is no longer enough to wake the
     engine.** It used to be `started || subscribers.size > 0`, which meant a
     component could make the app poll with no authenticated session bound —
     the signed-out guarantee was then a property of the router rather than of
     the engine. GPT Sol, 2026-09-01: *"test compatibility should not define
     production authentication semantics."* So the test signs somebody in. */
  jobEngine.start("reader-1");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  /* Let anything still held go, so no request outlives the test. */
  for (const go of heldPolls.splice(0)) go();
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.unstubAllGlobals();
});

/** Let the microtasks settle and any renders they cause commit. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Answer every poll now waiting, and let the renders finish. */
async function answerPolls(): Promise<void> {
  await act(async () => {
    for (const go of heldPolls.splice(0)) go();
    await Promise.resolve();
  });
  await settle();
}

function polls(): number {
  return sent.filter((r) => r.method === "GET" && r.url === "/api/jobs").length;
}

describe("a job the server received and refused", () => {
  it("goes on saying what the server said after the next poll succeeds", async () => {
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    /* The opening poll, out of the way, so the one that matters below is the
       one the failed POST provoked. */
    await answerPolls();
    expect(polls()).toBe(1);

    await act(async () => {
      await ideas?.regenerate();
    });
    await settle();

    /* Before the poll lands. **The broken code passes this**, which is why it
       is here: it is the frame the reader never sees, and a test that stopped
       at this line is the one that proved a ternary. */
    expect(ideas?.failed?.message).toBe(REFUSED);
    expect(sent.some((r) => r.method === "POST" && r.url === "/api/jobs")).toBe(true);

    /* And the poll the failed POST started really is out — without this the
       test could pass by never reaching the thing that wipes the message. */
    expect(polls()).toBe(2);

    await answerPolls();

    /* After a perfectly successful poll. The job was still refused and the
       reason is still the server's. */
    expect(ideas?.failed?.message).toBe(REFUSED);
    expect(host.textContent).toBe(REFUSED);
  });

  it("lets go of it the moment a run does start", async () => {
    /* The other half, and the risk the fix introduces: a message that survives
       a poll must not survive the reader's next press. Without this, "durable"
       and "stuck" are the same test. */
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    await answerPolls();

    await act(async () => {
      await ideas?.regenerate();
    });
    await settle();
    await answerPolls();
    expect(ideas?.failed?.message).toBe(REFUSED);

    refusing = false;
    await act(async () => {
      await ideas?.regenerate();
    });
    await settle();
    await answerPolls();

    expect(ideas?.failed).toBeNull();
    expect(host.textContent).toBe("");
  });
});

describe("the thread page, which had its own copy of all this", () => {
  /**
   * The fourth surface, mounted whole and clicked, because it is a component
   * rather than a hook and its `failed` was written out longhand in the
   * component body. It read `queue.error` at render — the spelling the three
   * hooks were fixed out of on 2026-08-28 and this one was not, because the
   * file held another session's uncommitted work that day.
   *
   * Everything real runs: the page's own `load`, the real `useJobs`, the real
   * `apiFetch` and `readJson`. Only the dock is stubbed.
   */
  it("goes on saying what the server said after the next poll succeeds", async () => {
    await act(async () => {
      root.render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
    });
    await settle();
    await answerPolls();
    // The page found no thread, so the button that asks for one is on screen.
    expect(host.textContent).toContain("Nobody has written a thread for this one yet.");

    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Write the thread",
    );
    if (!button) throw new Error("the thread page did not render its write button");

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    await settle();

    /* Before the poll lands — the frame the reader never sees. The broken code
       passes this line, which is why it is here and not left out. */
    expect(host.textContent).toContain(REFUSED);
    expect(sent.some((r) => r.method === "POST" && r.url === "/api/jobs")).toBe(true);

    /* And the poll that the failed POST's own `finally` started really is in
       flight. Without this the test could pass by never reaching the thing
       that wipes the message. */
    const before = polls();
    await answerPolls();
    expect(before).toBeGreaterThan(1);

    /* After a perfectly successful poll. The server refused the job and its
       reason is still the one on screen — not "Couldn't start the job." */
    expect(host.textContent).toContain(REFUSED);
    expect(host.textContent).not.toContain("Couldn't start the job.");
  });

  it("lets go of it the moment a run does start", async () => {
    /* The other half, on this surface too: durable must not mean stuck. */
    await act(async () => {
      root.render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
    });
    await settle();
    await answerPolls();

    const press = async () => {
      const button = [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Write the thread",
      );
      if (!button) throw new Error("the thread page did not render its write button");
      await act(async () => {
        button.click();
        await Promise.resolve();
      });
      await settle();
      await answerPolls();
    };

    await press();
    expect(host.textContent).toContain(REFUSED);

    refusing = false;
    await press();
    expect(host.textContent).not.toContain(REFUSED);
  });
});

describe("the add page, which is the fifth copy and was found in a browser", () => {
  /**
   * **The one that mattered, and the one a passing suite did not catch.**
   *
   * `/add/<url>` posts on mount and had exactly the spelling this whole file is
   * about: a boolean `failed`, and `queue.error` rendered beside it. So the
   * quota's 402 — *"A free account can add 3 articles, and this account's
   * allowance is spent… the pricing page sets one up. [pay-free]"* — was replaced by the generic
   * *"It didn't get as far as the queue"* before anybody could read it, taking
   * the link to the plans with it. **That is the entire point
   * of the surface it was added to**: the refusal names a button, and the page
   * that was meant to hand the reader that button showed them nothing.
   *
   * Found in the browser on 2026-09-03, by a subagent driving a real free
   * account against a real server, after every unit test in the change was
   * green. Written up here rather than in a file of its own because this is the
   * file about this bug, and its own header already predicted the shape:
   * *"the way this breaks is by somebody reintroducing a private `queue.error`
   * read"*.
   *
   * The page is mounted whole, and everything real runs but the auth client.
   */
  const QUOTA = "A free account can add 3 articles, and this account's allowance is spent. [pay-free]";

  it("goes on saying what the server said after the next poll succeeds", async () => {
    refused = QUOTA;
    await act(async () => {
      root.render(createElement(AddPage, { source: { kind: "url", url: "example.com/an-essay" } }));
    });
    await settle();

    /* Before the poll lands — the frame the reader never sees. The broken code
       passes this line, which is why it is here. */
    expect(host.textContent).toContain(QUOTA);
    expect(sent.some((r) => r.method === "POST" && r.url === "/api/jobs")).toBe(true);

    /* And the poll the failed POST's own `finally` started really is in flight.
       Without this the test could pass by never reaching the thing that wipes
       the message. */
    const before = polls();
    await answerPolls();
    expect(before).toBeGreaterThanOrEqual(1);

    /* After a perfectly successful poll. Still the server's sentence, and still
       the way out of it. */
    expect(host.textContent).toContain(QUOTA);
    /* `/pricing` since 2026-09-04, when the buying moved to the page with the
       prices on it — QuotaNotice.tsx. What this line is holding is unchanged:
       the refusal still arrives with somewhere to press. */
    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("/pricing");
  });

  it("does not offer a Try again under a refusal that says trying again will not help", async () => {
    /* The rule `worthRetrying` decides, and the reason it is worth a case: a
       button under a sentence that has just said the count will be the same is
       one that teaches the reader to distrust the sentence. */
    refused = QUOTA;
    await act(async () => {
      root.render(createElement(AddPage, { source: { kind: "url", url: "example.com/an-essay" } }));
    });
    await settle();
    await answerPolls();

    expect(host.textContent).not.toContain("It didn't get as far as the queue");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Try again");
  });

  it("still offers a Try again for a failure another go could fix", async () => {
    /* The mirror, so the case above cannot pass by hiding the button for
       everything. A refusal with no code is unrecognised, and `worthRetrying`
       gives an unrecognised message the benefit of the doubt. */
    refused = "The server was busy.";
    await act(async () => {
      root.render(createElement(AddPage, { source: { kind: "url", url: "example.com/an-essay" } }));
    });
    await settle();
    await answerPolls();

    expect(host.textContent).toContain("The server was busy.");
    expect(host.textContent).toContain("It didn't get as far as the queue");
  });
});
