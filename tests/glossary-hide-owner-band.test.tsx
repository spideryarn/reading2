// @vitest-environment jsdom
/**
 * **Hiding a glossary entry, in the owner's band, through the real hooks** —
 * plan 261002c § 2, and the lookup lifted onto the read (§ 3, GPT Sol's plan
 * review finding 1).
 *
 * Greg, 2026-10-02 (spya-yqfzkm): *"Give me a way to hide a Glossary entry …
 * Let's go with Hide for now."*
 *
 * Mounts `useGlossaryRead` and the real `GlossaryBand` under the real
 * `NuqsAdapter`, with the network posed: the GET answers the list with
 * `hidden: true` on whatever the fake server has hidden, exactly as
 * `loadGlossary` attaches it, and `PUT`/`DELETE …/hidden/:id` change that set.
 * The claims:
 *
 * 1. A hidden entry has no row, is not counted, and is listed under a
 *    collapsed *Hidden (n)* with *Unhide*.
 * 2. A `?term=` naming a hidden entry is cleared — **in first-use order too**,
 *    where no threshold is in play.
 * 3. The trash button sends the PUT and the row goes once the list is re-read;
 *    *Unhide* sends the DELETE and brings it back. Pessimistic: nothing moves
 *    before the server answers.
 * 4. A refused hide says so in the band's error line, and the row stays.
 * 5. A dig started on the read survives the band unmounting, and its answer
 *    still lands on the list.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryLookup, GlossaryResponse } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const frame = (event: string, data: unknown) =>
  enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const BLOCK = "spya-hdq4zt";
const SHOWN_ID = "spya-hdq5wr";
const HIDDEN_ID = "spya-hdq6xm";
const OTHER_ID = "spya-hdq7yn";

function entry(id: string, name: string): GlossaryEntry {
  return {
    id,
    name,
    kind: "concept",
    aliases: [],
    senseHere: `What ${name} means here.`,
    difficulty: 0.6,
    centrality: 0.6,
    blocks: [BLOCK],
  };
}
const SHOWN = entry(SHOWN_ID, "Win-shift");
const HIDDEN = entry(HIDDEN_ID, "Radial arm maze");
const OTHER = entry(OTHER_ID, "Another article's term");

const LOOKUP: GlossaryLookup = {
  answer: "What the web says about win-shift.",
  citations: [{ url: "https://example.org/win-shift", title: "A page" }],
  searches: 1,
  model: "a-model",
  at: "2026-10-02T00:00:00.000Z",
};

/* The fake server. */
let serverHidden = new Set<string>();
let writes: string[] = [];
let refuseWrite: string | null = null;
let lookupBody: ReadableStreamDefaultController<Uint8Array> | null = null;
let lookupSignal: AbortSignal | undefined;
let lookupLanded = false;
let writeGate: Promise<void> | null = null;
let releaseWrite: (() => void) | null = null;

function listResponse(slug = "a-piece"): GlossaryResponse {
  const entries = slug === "another-piece" ? [OTHER] : [SHOWN, HIDDEN];
  return {
    glossary: {
      version: "glossary/3",
      sourceHash: "abc",
      profileHash: null,
      passes: 1,
      entries: entries.map((e) => {
        const withLookup = e.id === SHOWN_ID && lookupLanded ? { ...e, lookup: LOOKUP } : e;
        return serverHidden.has(e.id) ? { ...withLookup, hidden: true as const } : withLookup;
      }),
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
        if (writeGate) await writeGate;
        if (refuseWrite) {
          return new Response(JSON.stringify({ error: refuseWrite }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        const id = decodeURIComponent(input.split("/").pop() ?? "");
        if (method === "PUT") serverHidden.add(id);
        else serverHidden.delete(id);
        return new Response(null, { status: 204 });
      }
      if (input.endsWith("/lookup")) {
        lookupSignal = init?.signal ?? undefined;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              lookupBody = c;
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      const slug = decodeURIComponent(input.split("/").pop() ?? "");
      return new Response(JSON.stringify(listResponse(slug)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    readJson: async (res: Response) => {
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as { error?: string };
      /* The server's own sentence, declared as the real `readJson` declares
         it (`HttpError` is a `ReaderFacingError`). */
      if (!res.ok) {
        const { ReaderFacingError } = await import("../src/web/lib/reader-facing.js");
        throw new ReaderFacingError(data.error ?? String(res.status));
      }
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

let reading: GlossaryRead | null = null;

function Reading({ band, slug = "a-piece" }: { band: boolean; slug?: string }): ReactElement {
  const read = useGlossaryRead(slug);
  reading = read;
  return createElement(
    "div",
    null,
    band
      ? createElement(GlossaryBand, {
          slug,
          read,
          onJump: () => {},
          onSelected: () => {},
          onAskChat: () => {},
        })
      : null,
  );
}

enableHistorySync();

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  serverHidden = new Set();
  writes = [];
  refuseWrite = null;
  lookupBody = null;
  lookupSignal = undefined;
  lookupLanded = false;
  writeGate = null;
  releaseWrite = null;
  reading = null;
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

function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

async function mount(search: string, band = true): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Reading, { band })));
  });
  await settle();
}

async function showArticle(slug: string, band = false): Promise<void> {
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(Reading, { band, slug })));
  });
  await settle();
}

const rowIds = () =>
  [...host.querySelectorAll<HTMLElement>(".gloss-list-items > li")].map((li) => li.dataset.termId);
const hiddenSection = () => host.querySelector<HTMLDetailsElement>("details.gloss-hidden");

async function press(el: Element | null | undefined): Promise<void> {
  expect(el, "the control is not on screen").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

describe("a hidden entry in the owner's band", () => {
  it("has no row and is listed under a collapsed Hidden (n), with Unhide", async () => {
    serverHidden.add(HIDDEN_ID);
    await mount("?mode=glossary&sort=document");
    expect(rowIds()).toEqual([SHOWN_ID]);
    const section = hiddenSection();
    expect(section, "no Hidden section").not.toBeNull();
    expect(section?.open).toBe(false);
    expect(section?.querySelector("summary")?.textContent).toBe("Hidden (1)");
    expect(section?.textContent).toContain("Radial arm maze");
    expect(section?.querySelector("button")?.textContent).toContain("Unhide");
  });

  it("draws no Hidden section when nothing is hidden", async () => {
    await mount("?mode=glossary&sort=document");
    expect(rowIds()).toEqual([SHOWN_ID, HIDDEN_ID]);
    expect(hiddenSection()).toBeNull();
  });

  it("clears a ?term= that names it, in first-use order where there is no threshold", async () => {
    serverHidden.add(HIDDEN_ID);
    await mount(`?mode=glossary&sort=document&term=${HIDDEN_ID}`);
    await vi.waitFor(() => expect(param("term")).toBeNull());
  });

  it("keeps a ?term= that names a shown entry", async () => {
    serverHidden.add(HIDDEN_ID);
    await mount(`?mode=glossary&sort=document&term=${SHOWN_ID}`);
    await settle();
    expect(param("term")).toBe(SHOWN_ID);
  });
});

describe("the trash button and Unhide", () => {
  it("hides through a PUT, and the row goes only once the list is read again", async () => {
    await mount("?mode=glossary&sort=document");
    const trash = host.querySelector(`li[data-term-id="${HIDDEN_ID}"] > .gloss-hide`);
    /* A sibling of the row's button, never inside it. */
    expect(trash?.closest(".gloss-term-btn")).toBeNull();
    expect(trash?.getAttribute("aria-label")).toBe("Hide — only for you");
    await press(trash);
    expect(writes).toEqual([`PUT /api/glossary/a-piece/hidden/${HIDDEN_ID}`]);
    expect(rowIds()).toEqual([SHOWN_ID]);
    expect(hiddenSection()?.querySelector("summary")?.textContent).toBe("Hidden (1)");
  });

  it("unhides through a DELETE, and the row comes back", async () => {
    serverHidden.add(HIDDEN_ID);
    await mount("?mode=glossary&sort=document");
    await press(hiddenSection()?.querySelector("button"));
    expect(writes).toEqual([`DELETE /api/glossary/a-piece/hidden/${HIDDEN_ID}`]);
    expect(rowIds()).toEqual([SHOWN_ID, HIDDEN_ID]);
    expect(hiddenSection()).toBeNull();
  });

  it("says a refused hide in the band's error line, and leaves the row", async () => {
    refuseWrite = "That term is not in this article's glossary.";
    await mount("?mode=glossary&sort=document");
    await press(host.querySelector(`li[data-term-id="${HIDDEN_ID}"] > .gloss-hide`));
    expect(rowIds()).toEqual([SHOWN_ID, HIDDEN_ID]);
    const error = host.querySelector(".gloss-error")?.textContent ?? "";
    expect(error).toContain("Hiding that term did not go through.");
    expect(error).toContain("That term is not in this article's glossary.");
  });

  it("does not refresh the previous article when its hide finishes after navigation", async () => {
    await mount("?mode=glossary&sort=document", false);
    writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    let hiding = Promise.resolve();
    await act(async () => {
      hiding = reading?.setHidden(HIDDEN_ID, true) ?? hiding;
      await Promise.resolve();
    });
    expect(reading?.hiding.has(HIDDEN_ID)).toBe(true);

    await showArticle("another-piece");
    expect(reading?.glossary?.entries.map((entry) => entry.id)).toEqual([OTHER_ID]);
    expect(reading?.hiding.has(HIDDEN_ID)).toBe(false);

    releaseWrite?.();
    await act(async () => {
      await hiding;
    });
    await settle();

    expect(reading?.glossary?.entries.map((entry) => entry.id)).toEqual([OTHER_ID]);
  });

  it("reconciles a finishing hide after navigating away and back to its article", async () => {
    await mount("?mode=glossary&sort=document", false);
    writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    let hiding = Promise.resolve();
    await act(async () => {
      hiding = reading?.setHidden(HIDDEN_ID, true) ?? hiding;
      await Promise.resolve();
    });
    await showArticle("another-piece");
    await showArticle("a-piece");
    expect(reading?.glossary?.entries.find((entry) => entry.id === HIDDEN_ID)?.hidden).toBeUndefined();

    releaseWrite?.();
    await act(async () => {
      await hiding;
    });
    await settle();

    expect(reading?.glossary?.entries.find((entry) => entry.id === HIDDEN_ID)?.hidden).toBe(true);
  });
});

describe("a dig lives on the read, not the band", () => {
  it("keeps arriving after the band unmounts, and its answer lands on the list", async () => {
    await mount("?mode=glossary&sort=document");
    let running: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      running = reading?.look(SHOWN_ID) ?? running;
    });
    await settle();
    expect(reading?.looking).toBe(SHOWN_ID);

    /* The band goes — the reader left glossary mode. */
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, createElement(Reading, { band: false })));
    });
    await settle();
    expect(lookupSignal?.aborted, "closing the band disowned the dig").toBe(false);
    expect(reading?.looking).toBe(SHOWN_ID);
    /* A second press anywhere — the card's button — is not admitted. */
    let second = true;
    await act(async () => {
      second = (await reading?.look(SHOWN_ID)) ?? true;
    });
    expect(second).toBe(false);

    lookupLanded = true;
    lookupBody?.enqueue(frame("delta", { text: "What the web says" }));
    lookupBody?.enqueue(frame("done", { entry: { ...SHOWN, lookup: LOOKUP } }));
    lookupBody?.close();
    await act(async () => {
      expect(await running).toBe(true);
    });
    await settle();
    expect(reading?.looking).toBeNull();
    expect(reading?.glossary?.entries.find((e) => e.id === SHOWN_ID)?.lookup).toEqual(LOOKUP);
  });
});
