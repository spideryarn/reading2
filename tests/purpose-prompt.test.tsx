// @vitest-environment jsdom
/**
 * **"Why are you reading this?", asked once when the article first opens** —
 * src/web/PurposePrompt.tsx, plan 261001s § Stage 3.
 *
 * > Also, if they don't fill this in (e.g. because they didn't notice it), pop
 * > up an input box asking why they're reading it when the article loads for
 * > the first time.
 * >
 * > — Greg, 2026-10-01, spya-hbqezu
 *
 * What is pinned, and why each matters:
 *
 *  - **No mark, no request.** Every owner's article mounts this; a GET per
 *    article view for a question almost never asked would be a cost on every
 *    page, and the public network trace counts requests.
 *  - **The mark is cleared only on a definitive answer** (Sol's item 3). A read
 *    that fails keeps it, so a network blip does not lose the question; a
 *    `purposeFailed` read must never be taken for "you have not said".
 *  - **Done is a latch** (Sol's item 4): it saves what is typed and closes only
 *    once the save has landed; a refusal keeps the dialog open with the reason.
 *  - **Under StrictMode** the dialog opens once and is seeded once.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* --------------------------------------------------------------- storage -- */

const session = new Map<string, string>();
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => void session.set(key, value),
    removeItem: (key: string) => void session.delete(key),
    clear: () => session.clear(),
  },
});
const MARK = "spideryarn.ask-purpose";

/* ------------------------------------------------------------ the network -- */

let readerBody: { purpose: string | null; purposeFailed?: boolean } | "fail" = { purpose: null };
/** How the PATCH answers. The default stores what it was sent. */
let patchAnswer: (body: { purpose: string | null }) => Promise<Response> = async (body) =>
  new Response(JSON.stringify({ purpose: body.purpose?.trim() ?? null }), { status: 200 });
const requested: { url: string; method: string; body?: unknown }[] = [];
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requested.push({ url, method: init?.method ?? "GET", body });
    if (url.startsWith("/api/reader")) {
      return readerBody === "fail"
        ? new Response(JSON.stringify({ error: "Could not read." }), { status: 500 })
        : new Response(JSON.stringify(readerBody), { status: 200 });
    }
    if (url.startsWith("/api/library/") && init?.method === "PATCH") return patchAnswer(body);
    return new Response(null, { status: 404 });
  };
  return { ...real, apiFetch, leavingFetch: () => Promise.resolve() };
});

/* The microphone is not what this file is about; feedback-dialog.test.tsx stubs it the same way. */
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false },
    readOnly: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

/* `showModal`/`close` are not implemented in jsdom — feedback-dialog.test.tsx § the same stand-in. */
let showModals = 0;
beforeEach(() => {
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      showModals++;
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
});

const { PurposePrompt } = await import("../src/web/PurposePrompt.js");

/* ------------------------------------------------------------- the harness -- */

const SLUG = "a-paper";
let host: HTMLDivElement;
let root: Root;

function render(strict = false): void {
  const prompt = createElement(PurposePrompt, { slug: SLUG });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, prompt) : prompt);
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const dialog = (): HTMLDialogElement | null => host.querySelector("dialog");
const isOpen = (): boolean => dialog()?.open === true;
const box = (): HTMLTextAreaElement => {
  const el = host.querySelector<HTMLTextAreaElement>("textarea");
  if (!el) throw new Error("no box in the prompt");
  return el;
};
function type(value: string): void {
  const el = box();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (name: string): void => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === name);
  if (!b) throw new Error(`no ${name} button`);
  act(() => b.click());
};
const patches = () => requested.filter((r) => r.method === "PATCH");

beforeEach(() => {
  session.clear();
  requested.length = 0;
  showModals = 0;
  readerBody = { purpose: null };
  patchAnswer = async (body) =>
    new Response(JSON.stringify({ purpose: body.purpose?.trim() ?? null }), { status: 200 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("PurposePrompt", () => {
  it("without the mark renders nothing and makes no request", async () => {
    render();
    await settle();
    expect(dialog()).toBeNull();
    expect(requested, "an article view without the mark asked the server").toEqual([]);
  });

  it("with a mark for another article renders nothing and makes no request", async () => {
    session.set(MARK, "another-paper");
    render();
    await settle();
    expect(dialog()).toBeNull();
    expect(requested).toEqual([]);
    expect(session.get(MARK)).toBe("another-paper");
  });

  it("with the mark and no purpose, opens the dialog and clears the mark", async () => {
    session.set(MARK, SLUG);
    render();
    await settle();
    expect(requested.map((r) => r.url)).toEqual([`/api/reader?slug=${SLUG}`]);
    expect(isOpen()).toBe(true);
    expect(dialog()?.textContent).toContain("Why are you reading this?");
    expect(box().value).toBe("");
    expect(session.has(MARK), "the question would be asked again").toBe(false);
  });

  it("with the mark and a purpose already set, shows nothing and clears the mark", async () => {
    session.set(MARK, SLUG);
    readerBody = { purpose: "the evidence" };
    render();
    await settle();
    expect(isOpen()).toBe(false);
    expect(session.has(MARK)).toBe(false);
  });

  it("with the mark and a failed read, shows nothing and keeps the mark", async () => {
    session.set(MARK, SLUG);
    readerBody = "fail";
    render();
    await settle();
    expect(isOpen()).toBe(false);
    expect(session.get(MARK), "a failed read lost the question").toBe(SLUG);
  });

  it("with the mark and an unreadable shelf (purposeFailed), shows nothing and keeps the mark", async () => {
    session.set(MARK, SLUG);
    readerBody = { purpose: null, purposeFailed: true };
    render();
    await settle();
    expect(isOpen(), "an unreadable purpose was taken for 'not said'").toBe(false);
    expect(session.get(MARK)).toBe(SLUG);
  });

  it("Done with typed text saves it, then closes", async () => {
    let answer: (r: Response) => void = () => {};
    patchAnswer = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    session.set(MARK, SLUG);
    render();
    await settle();
    type("how they handled missing data");
    press("Done");
    await settle();
    expect(patches().map((p) => p.body)).toEqual([{ purpose: "how they handled missing data" }]);
    expect(patches()[0]?.url).toBe(`/api/library/${SLUG}`);
    expect(isOpen(), "closed before the save had landed").toBe(true);
    answer(new Response(JSON.stringify({ purpose: "how they handled missing data" }), { status: 200 }));
    await settle();
    expect(isOpen()).toBe(false);
  });

  it("Done over a refused save stays open and says why", async () => {
    patchAnswer = async () => new Response(JSON.stringify({ error: "The shelf is unavailable." }), { status: 503 });
    session.set(MARK, SLUG);
    render();
    await settle();
    type("the evidence");
    press("Done");
    await settle();
    expect(isOpen(), "a refused save was closed over").toBe(true);
    expect(host.querySelector(".prof-save")?.textContent).toContain("The shelf is unavailable.");
  });

  it("Done waits for a corrective save when an older autosave is still in flight", async () => {
    const answers: Array<(r: Response) => void> = [];
    patchAnswer = () =>
      new Promise((resolve) => {
        answers.push(resolve);
      });
    session.set(MARK, SLUG);
    render();
    await settle();

    type("the first thought");
    act(() => {
      box().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    expect(patches().map((p) => p.body)).toEqual([{ purpose: "the first thought" }]);

    /* The draft now matches the value originally loaded, but the request that
       will replace that value is still in flight. Done must wait for both that
       request and the queued correction, or a refusal of the correction is
       hidden behind a closed dialog. */
    type("");
    press("Done");
    await settle();
    expect(isOpen(), "closed while the older save could still change the stored value").toBe(true);

    answers[0]?.(new Response(JSON.stringify({ purpose: "the first thought" }), { status: 200 }));
    await settle();
    expect(patches().map((p) => p.body)).toEqual([
      { purpose: "the first thought" },
      { purpose: null },
    ]);
    expect(isOpen(), "closed before the corrective save had landed").toBe(true);

    answers[1]?.(new Response(JSON.stringify({ purpose: null }), { status: 200 }));
    await settle();
    expect(isOpen()).toBe(false);
  });

  it("Done with nothing typed closes without a PATCH", async () => {
    session.set(MARK, SLUG);
    render();
    await settle();
    press("Done");
    await settle();
    expect(isOpen()).toBe(false);
    expect(patches()).toEqual([]);
  });

  it("Not now closes it", async () => {
    session.set(MARK, SLUG);
    render();
    await settle();
    press("Not now");
    await settle();
    expect(isOpen()).toBe(false);
    expect(patches()).toEqual([]);
  });

  it("Not now leaves an in-flight save mounted and sends the queued latest draft", async () => {
    const answers: Array<(r: Response) => void> = [];
    patchAnswer = () =>
      new Promise((resolve) => {
        answers.push(resolve);
      });
    session.set(MARK, SLUG);
    render();
    await settle();

    type("the first thought");
    act(() => {
      box().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    type("the fuller thought");
    /* Clicking another control blurs a real textarea before its click runs.
       jsdom's `.click()` does not move focus, so pose that ordering explicitly:
       the blur queues the newer words behind the request already on the wire. */
    act(() => box().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    press("Not now");
    await settle();
    expect(isOpen()).toBe(false);

    answers[0]?.(new Response(JSON.stringify({ purpose: "the first thought" }), { status: 200 }));
    await settle();
    expect(patches().map((p) => p.body)).toEqual([
      { purpose: "the first thought" },
      { purpose: "the fuller thought" },
    ]);
    answers[1]?.(new Response(JSON.stringify({ purpose: "the fuller thought" }), { status: 200 }));
    await settle();
    expect(isOpen(), "the background save reopened the dismissed question").toBe(false);
  });

  it("Escape (the dialog's own close) closes it and it stays closed", async () => {
    session.set(MARK, SLUG);
    render();
    await settle();
    act(() => dialog()?.close());
    await settle();
    expect(isOpen()).toBe(false);
  });

  it("under StrictMode, opens once and clears the mark", async () => {
    session.set(MARK, SLUG);
    render(true);
    await settle();
    expect(isOpen()).toBe(true);
    expect(showModals).toBe(1);
    expect(session.has(MARK)).toBe(false);
  });
});
