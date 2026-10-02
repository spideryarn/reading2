// @vitest-environment jsdom
/**
 * **The *Look up a term* box adds the term, in the owner's band, through the
 * real hooks** — plan 261002f (docs/plans/261002f-glossary-add-a-looked-up-term.md).
 *
 * Mounts `useGlossaryRead` and the real `GlossaryBand` under the real
 * `NuqsAdapter`, with the network posed like tests/glossary-hide-owner-band.test.tsx:
 * the GET answers the list (including an added entry once the fake server has
 * "written" one), `/ask` streams `begin`/`delta`/`done`, and `DELETE …/hidden/:id`
 * is recorded. The claims, one per `done.added` arm:
 *
 * 1. `added` re-reads the list, selects the new row (`?term=`), empties the box
 *    and drops the answer; the row says *added by you*.
 * 2. `existing`, shown: the answer stays with *Already in the glossary.* and a
 *    *Show it* that selects the row.
 * 3. `existing`, hidden: *Unhide*, which sends the DELETE.
 * 4. `no-glossary`: a note, and `?term=` untouched.
 * 5. A malformed `added` is a failure, never an answer.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryLookup, GlossaryResponse } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const BLOCK = "spya-adq4zt";
const OLD_ID = "spya-adq5wr";
const NEW_ID = "spya-adq6xm";
const HIDDEN_ID = "spya-adq7yn";

const LOOKUP: GlossaryLookup = {
  answer: "What the web says about the term.",
  citations: [{ url: "https://example.org/term", title: "A page" }],
  searches: 1,
  model: "a-model",
  at: "2026-10-02T00:00:00.000Z",
};

function entry(id: string, name: string, extra: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    id,
    name,
    kind: "concept",
    aliases: [],
    senseHere: `What ${name} means here.`,
    difficulty: 0.6,
    centrality: 0.6,
    blocks: [BLOCK],
    ...extra,
  } as GlossaryEntry;
}
const OLD = entry(OLD_ID, "Win-shift");
const HIDDEN = entry(HIDDEN_ID, "Radial arm maze");
const NEW = entry(NEW_ID, "Attention head", { kind: "term", added: true, lookup: LOOKUP });

/* The fake server. */
let serverHasNew = false;
let suppressAddedRow = false;
let hiddenIds = new Set<string>();
let gets = 0;
let writes: string[] = [];
let askDone: unknown = null;

function listResponse(): GlossaryResponse {
  const entries = [OLD, HIDDEN, ...(serverHasNew ? [NEW] : [])];
  return {
    glossary: {
      version: "glossary/3",
      sourceHash: "abc",
      profileHash: null,
      passes: 1,
      entries: entries.map((e) => (hiddenIds.has(e.id) ? { ...e, hidden: true as const } : e)),
    },
    stale: false,
    outdated: false,
    profileChanged: false,
  } as unknown as GlossaryResponse;
}

vi.mock("../src/web/lib/api.js", () => {
  const api = {
    apiFetch: async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (input.includes("/hidden/")) {
        writes.push(`${method} ${input}`);
        const id = decodeURIComponent(input.split("/").pop() ?? "");
        if (method === "PUT") hiddenIds.add(id);
        else hiddenIds.delete(id);
        return new Response(null, { status: 204 });
      }
      if (input.endsWith("/ask")) {
        const done = askDone as { added?: { kind?: string } } | null;
        if (done?.added?.kind === "added") serverHasNew = !suppressAddedRow;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(frame("begin", { term: "x", blockId: BLOCK, quote: "Attention Heads" }));
            c.enqueue(frame("delta", { text: "What the web says" }));
            c.enqueue(frame("done", askDone));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      gets += 1;
      return new Response(JSON.stringify(listResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    readJson: async (res: Response) => {
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? String(res.status));
      return data;
    },
    failure: async (res: Response) => new Error(String(res.status)),
    fetchOk: async (input: string) => api.apiFetch(input),
  };
  return api;
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async () => null,
    cancel: async () => {},
  }),
}));

const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { GlossaryBand } = await import("../src/web/modes/glossary/GlossaryMode.js");

function Reading(): ReactElement {
  const read = useGlossaryRead("a-piece");
  return createElement(GlossaryBand, {
    slug: "a-piece",
    read,
    onJump: () => {},
    onSelected: () => {},
    onAskChat: () => {},
  });
}

enableHistorySync();

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  serverHasNew = false;
  suppressAddedRow = false;
  hiddenIds = new Set();
  gets = 0;
  writes = [];
  askDone = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const param = (key: string) => new URLSearchParams(location.search).get(key);

async function mount(): Promise<void> {
  history.replaceState(null, "", "/a-piece?mode=glossary&sort=document");
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Reading)));
  });
  await settle();
}

const input = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="Look up a term in this article"]');

/** Type into the box and submit the form, as a reader would. */
async function lookUp(text: string, done: unknown): Promise<void> {
  askDone = done;
  const box = input();
  expect(box, "the box is not on screen").toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(box, text);
    box?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box?.closest("form")?.requestSubmit();
  });
  await settle(16);
}

const answerOf = (added: unknown) => ({
  term: "attention head",
  blockId: BLOCK,
  quote: "Attention Heads",
  lookup: LOOKUP,
  added,
});

const buttonNamed = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".gloss-ask-answer button")].find((b) =>
    b.textContent?.includes(label),
  );

async function press(el: Element | null | undefined): Promise<void> {
  expect(el, "the control is not on screen").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

describe("a looked-up term the server added", () => {
  it("re-reads the list, selects the new row, empties the box and drops the answer", async () => {
    await mount();
    const before = gets;
    await lookUp("attention head", answerOf({ kind: "added", entryId: NEW_ID }));

    expect(gets).toBeGreaterThan(before);
    expect(param("term")).toBe(NEW_ID);
    expect(input()?.value).toBe("");
    expect(host.querySelector(".gloss-ask-answer")).toBeNull();
    const row = host.querySelector(`li[data-term-id="${NEW_ID}"]`);
    expect(row, "the new row is not drawn").not.toBeNull();
    expect(row?.querySelector(".gloss-added")?.textContent).toBe("added by you");
  });

  it("keeps the answer when the returned id is absent after the refresh", async () => {
    suppressAddedRow = true;
    await mount();
    await lookUp("attention head", answerOf({ kind: "added", entryId: NEW_ID }));

    expect(param("term")).toBeNull();
    expect(input()?.value).toBe("attention head");
    expect(host.querySelector(".gloss-ask-answer")?.textContent).toContain("Added to your glossary.");
  });
});

describe("a term that was already in the glossary", () => {
  it("keeps the answer, and Show it selects the row", async () => {
    await mount();
    await lookUp("win-shift", answerOf({ kind: "existing", entryId: OLD_ID, hidden: false }));

    const answer = host.querySelector(".gloss-ask-answer");
    expect(answer, "the answer went").not.toBeNull();
    expect(answer?.textContent).toContain("Already in the glossary.");
    expect(param("term")).toBeNull();
    await press(buttonNamed("Show it"));
    expect(param("term")).toBe(OLD_ID);
  });

  it("offers Unhide for a hidden one, and Unhide sends the DELETE", async () => {
    hiddenIds.add(HIDDEN_ID);
    await mount();
    await lookUp("radial arm maze", answerOf({ kind: "existing", entryId: HIDDEN_ID, hidden: true }));

    expect(host.querySelector(".gloss-ask-answer")?.textContent).toContain(
      "Already in your hidden terms.",
    );
    expect(buttonNamed("Show it")).toBeUndefined();
    await press(buttonNamed("Unhide"));
    expect(writes).toEqual([`DELETE /api/glossary/a-piece/hidden/${HIDDEN_ID}`]);
  });
});

describe("an article with no glossary to add to", () => {
  it("says so, and selects nothing", async () => {
    await mount();
    await lookUp("attention head", answerOf({ kind: "no-glossary" }));
    expect(host.querySelector(".gloss-ask-answer")?.textContent).toContain(
      "Not added: this article has no glossary yet.",
    );
    expect(param("term")).toBeNull();
  });
});

describe("a `done` whose `added` is not one of the three", () => {
  it.each([
    ["an id that is not an id", { kind: "added", entryId: "not-an-id" }],
    ["a malformed existing id", { kind: "existing", entryId: "not-an-id", hidden: false }],
    ["an existing result without its hidden flag", { kind: "existing", entryId: OLD_ID }],
    ["an unknown kind", { kind: "teleported", entryId: NEW_ID }],
  ])("is a failure, never an answer (%s)", async (_label, added) => {
    await mount();
    await lookUp("attention head", answerOf(added));
    expect(host.querySelector(".gloss-ask-failed .gloss-error")).not.toBeNull();
    /* The cut-short draft stays under the failure, marked unfinished — it is
       never promoted to a finished answer, so there is no added-note. */
    expect(host.querySelector(".gloss-ask-added")).toBeNull();
    expect(host.querySelector(".gloss-ask-answer .gloss-part-label")?.textContent).toBe("unfinished");
    expect(param("term")).toBeNull();
  });
});
