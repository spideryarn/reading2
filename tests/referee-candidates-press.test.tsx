// @vitest-environment jsdom
/**
 * **Candidates does not spend money on being looked at.**
 *
 * The four sub-mode chips are a radiogroup, and a first-time referee reads a
 * radiogroup by pressing along it. Three of the four are inert to that;
 * Candidates was not. It fired a model call from a `useEffect` the moment the
 * sub-mode first mounted — a paid run over the paper, **and** web searches whose
 * terms are drawn from an unpublished manuscript and go to a search engine.
 * That last part is why this is more than a cost bug: the search engine is a
 * *different third party at a different time* from the model provider the
 * band's confidentiality notice is about, and that notice is in the past tense,
 * so it cannot be covering something that has not happened yet.
 *
 * ## The mutation each test catches
 *
 *  - **"nothing is asked until the button is pressed"** — put the `useEffect`
 *    back, or call `startBrief` from anywhere but the button, and the POST
 *    appears in the first assertion. Nothing else in the suite would notice:
 *    tests/referee-candidates-panel.test.tsx hands the panel a finished thread,
 *    which is the state *after* the press.
 *  - **"the press is what asks"** — a button wired to nothing, or one that only
 *    sets local state, leaves the second assertion at zero. This is the half
 *    that stops the fix from being "delete the feature".
 *  - **"the words say what it costs"** — the button is the only warning a
 *    referee gets before terms from the paper reach a search engine, so its
 *    visible text has to name both parties. A card is not enough: a tooltip is
 *    not read by anybody in a hurry, which is what a referee is.
 *  - **"a stored thread asks nothing and offers no button"** — coming back to
 *    the sub-mode must be free and must not offer to start a second thread.
 *
 * ## What this file can see, and what it cannot
 *
 * Everything here is measured at **this app's own HTTP boundary**: `apiFetch` is
 * mocked, so what is counted is requests the *client* makes to `/api/chat/…`.
 * That is one request per press, and it is worth saying plainly that it is not
 * the same fact as one model call.
 *
 * What happens on the other side of that request is `src/converse.ts`'s, and it
 * is not one call and not a fixed number: web search is offered on every round
 * and the model decides whether to use it, so it may run zero times; and each
 * round in which the model asks for one of our own tools is a fresh provider
 * request, up to `MAX_TOOL_ROUNDS + 1` of them. **No test in this file can see
 * any of that.** The button said *"one model call and a web search"* until
 * 2026-09-02 and a cross-family review showed the claim was wrong in both
 * directions; the assertion below was reworded with it, and now checks what the
 * words promise rather than pretending to have counted anything.
 *
 * Harness: `CandidatesBand` over a stubbed `apiFetch`, the `vi.mock` from
 * tests/referee-claims-band.test.tsx. No `NuqsAdapter` — Candidates owns no
 * query parameter.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, ChatThread } from "../src/types.js";

/** Every request the band made, in order, so a POST cannot hide in a GET's noise. */
let calls: { url: string; method: string }[] = [];
/** What the conversation GET answers, decided by the test that is running. */
let threads: ChatThread[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "GET") {
      return new Response(JSON.stringify({ threads }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    /* A POST is answered with an empty SSE stream. What matters here is that it
       was *made*, not what came back — and an empty stream lets the turn end
       without this file having to model the whole protocol. */
    return new Response(new TextEncoder().encode(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
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

const { CandidatesBand } = await import("../src/web/CandidatesPanel.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const BLOCK = "spya-k3m9qt" as BlockId;
const SLUG = "a-paper";

const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "We fitted a hierarchical Bayesian model to forty subjects.",
    words: 9,
    html: "<p>We fitted a hierarchical Bayesian model to forty subjects.</p>",
    gistable: true,
  },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls = [];
  threads = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(): void {
  act(() => {
    root.render(
      createElement(CandidatesBand, {
        slug: SLUG,
        blocks: BLOCKS,
        byline: "A. Author",
        onJump: () => {},
      }),
    );
  });
}

/** Let the conversation GET and its `.then()` chain settle. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function posts(): { url: string; method: string }[] {
  return calls.filter((c) => c.method === "POST");
}

function startButton(): HTMLElement | null {
  return host.querySelector(".cnd-start-btn");
}

describe("opening the Candidates sub-mode", () => {
  it("asks nothing until the button is pressed", async () => {
    mount();
    await flush();
    expect(
      posts(),
      "opening the sub-mode started a paid run with web searches in it",
    ).toEqual([]);
    expect(startButton(), "there is no way to start it either").not.toBeNull();
  });

  it("sends our own server exactly one request when the button is pressed", async () => {
    mount();
    await flush();
    act(() => {
      startButton()?.click();
    });
    await flush();
    /* One *client* request, which is the thing this harness can count. How many
       provider requests that turn then makes, and whether a web search runs, is
       decided inside src/converse.ts and is invisible from here — see the header. */
    expect(posts().length, "the button did not start the brief").toBe(1);
    expect(posts()[0]?.url).toContain(`/api/chat/${SLUG}`);
    /* And the offer goes away with the press, so it cannot be pressed into a
       second thread while the first is still arriving. */
    expect(startButton(), "the start button survived the press").toBeNull();
  });

  /**
   * **What the words promise, which is all this file is in a position to check.**
   *
   * Three things, and each is a wording a cross-family review found wrong on
   * 2026-09-02:
   *
   *  - Both third parties are **named in visible text**, not in a card. The model
   *    is the one the band's confidentiality notice already covers; the search
   *    engine is the one it does not.
   *  - The search is offered as a **possibility**. It may run zero times: the
   *    opening ask is the fit brief and ends *"No names yet"*, and the model
   *    decides whether to search at all.
   *  - **No count of calls.** *"One model call"* was a number this app cannot
   *    promise — a tool round is a fresh provider request, and there can be four.
   */
  it("promises only what it can keep about the press", async () => {
    mount();
    await flush();
    const visible =
      `${startButton()?.textContent ?? ""} ${host.querySelector(".cnd-start-note")?.textContent ?? ""}`.toLowerCase();
    expect(visible, "the AI turn is not named").toMatch(/model|ai turn/);
    expect(visible, "the web search is not named").toContain("search");
    expect(visible, "the search is promised rather than allowed for").toMatch(/may run a web search/);
    expect(visible, "a number of calls this app cannot promise is back").not.toContain(
      "one model call",
    );
  });

  /**
   * **The disclosure itself, in the visible note and nowhere else.**
   *
   * The test above requires *"model"*, *"search"* and *"may run"*, and a
   * cross-family review pointed out on 2026-09-02 that a note which had stopped
   * saying **where the search terms come from and who receives them** would
   * still satisfy all three. That sentence is the disclosure: the model is the
   * third party the band's confidentiality notice already covers, and the search
   * engine is a *different* third party reached at a *different* time, which is
   * the whole reason the opening run went behind a press
   * (docs/plans/260902f-make-referee-mode-understandable.md § stage 3).
   *
   * Read out of `.cnd-start-note` alone rather than the button-and-note string
   * the case above builds, and deliberately not out of the `ControlTip`, which
   * says the same thing: a card is not read by anybody in a hurry, and a referee
   * deciding whether to press is exactly somebody in a hurry. A card carrying it
   * while the note does not is the failure this is written to catch.
   */
  it("says in the visible note that paper-derived terms would go to a search engine", async () => {
    mount();
    await flush();
    const note = (host.querySelector(".cnd-start-note")?.textContent ?? "").toLowerCase();
    expect(note, "there is no visible note at all").not.toBe("");
    expect(note, "the recipient of the terms is not named as a search engine").toContain(
      "search engine",
    );
    expect(
      note,
      "the note no longer says the search terms are drawn from the paper being reviewed",
    ).toMatch(/(terms|words|phrases)[^.]*from the paper/);
  });

  it("asks nothing, and offers nothing, when the thread is already there", async () => {
    threads = [
      {
        id: "spya-thr2aa",
        kind: "candidates",
        title: "Candidates",
        createdAt: "2026-09-01T09:00:00.000Z",
        updatedAt: "2026-09-01T09:00:00.000Z",
        messages: [
          {
            id: "spya-msg2aa",
            role: "assistant",
            text: "What it would take to review this paper.",
            createdAt: "2026-09-01T09:00:01.000Z",
            status: "done",
          },
        ],
      } as ChatThread,
    ];
    mount();
    await flush();
    expect(posts(), "coming back to a stored thread cost a model call").toEqual([]);
    expect(startButton(), "a stored thread was offered a second start").toBeNull();
  });
});
