// @vitest-environment jsdom
/**
 * **Help's one box, signed in: it searches as you type and asks when you
 * press Ask.** Greg, `spya-fzd5nq`, 2026-10-19: *"Why do we have both "Search
 * help" and "Ask about Spideryarn"? Can we combine to get the best of both
 * worlds?"* Plan docs/plans/261020x-one-box-on-help-for-search-and-ask.md.
 *
 * The whole page, mounted signed in, because what this pins is how the two
 * halves sit together: typing sends nothing (the search is the reader's own
 * device, which is what the privacy page promises of it), Enter asks once,
 * the answer sits between the box and the matches, taking a match folds the
 * list but keeps the words, and the answer says what it answered once the box
 * has moved on. The signed-out box is tests/help-page.test.tsx § the search
 * box; the answer's drawing is tests/help-ask.test.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HELP_CHAT_PATH } from "../src/help-chat.js";
import { SignedInShell } from "../src/web/BackLink.js";
import { HelpPage } from "../src/web/help/HelpPage.js";
import { SignedInReader } from "../src/web/lib/made-for.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DictationOptions {
  onText(text: string): boolean | undefined;
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}

const mic = vi.hoisted(() => ({ armed: false, options: null as unknown }));
vi.mock("../src/web/useDictation.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/useDictation.js")>()),
  useDictation: (options: unknown) => {
    mic.options = options;
    return {
      supported: true,
      armed: mic.armed,
      transcribing: false,
      phase: mic.armed ? "listening" : "idle",
      liveText: true,
      interim: "",
      meter: mic.armed ? "detected" : "none",
      level: { current: 0 },
      quiet: false,
      error: null,
      startedAt: null,
      endsAt: null,
      deviceLabel: null,
      deviceId: null,
      deviceUnavailable: false,
      chooseDevice() {},
      recording: null,
      keptOnDevice: false,
      clearRecording() {},
      canRetry: false,
      retry() {},
      artifact: () => 0,
      toggle() {},
      dismiss() {},
    };
  },
}));

let posted: unknown[] = [];
let answer = "See [the spine](/help/spine).";

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init?: { body?: string }) => {
    posted.push({ input, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer, complete: true })}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  },
  readJson: async (res: Response) => res.json(),
}));

let host: HTMLDivElement;
let root: Root;
const realScrollTo = window.scrollTo;

beforeEach(() => {
  posted = [];
  answer = "See [the spine](/help/spine).";
  mic.armed = false;
  mic.options = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  history.replaceState(null, "", "/");
  window.scrollTo = realScrollTo;
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function mountAt(address: string): void {
  history.replaceState(null, "", address);
  act(() =>
    root.render(
      <SignedInReader.Provider value="reader-a">
        <SignedInShell.Provider value={true}>
          <HelpPage />
        </SignedInShell.Provider>
      </SignedInReader.Provider>,
    ),
  );
}

const box = () => {
  const b = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Search Help or ask a question about Spideryarn"]');
  if (!b) throw new Error("no box");
  return b;
};
const resultHrefs = () =>
  [...host.querySelectorAll('ul[aria-label="Search results"] a')].map((a) => a.getAttribute("href"));
const status = () => host.querySelector('[role="status"]')?.textContent ?? "";

function type(q: string): void {
  const b = box();
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    set?.call(b, q);
    b.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(init: KeyboardEventInit): Promise<KeyboardEvent> {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    box().dispatchEvent(e);
  });
  /* The stream is read over several microtasks. */
  for (let i = 0; i < 20; i++) await act(async () => {});
  return e;
}

describe("Help's one box, signed in", () => {
  it("is the only box: no separate search box", () => {
    for (const at of ["/help", "/help/spine"]) {
      mountAt(at);
      expect(host.querySelectorAll("textarea"), at).toHaveLength(1);
      expect(host.querySelector('input[type="search"]'), at).toBeNull();
    }
  });

  it("grows with its words and never scrolls itself (spya-p8h7r3)", () => {
    /* Greg, 2026-10-23: *"The input box for when I ask a question doesn't
       seem to expand. It stays pretty small."* The one fit every other box
       that grows uses (useFitTextarea.ts). jsdom lays nothing out, so the
       height a browser would measure is given here, as the quiz's test does. */
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return this.value.length > 100 ? 240 : 40;
      },
    });
    try {
      mountAt("/help");
      type("x".repeat(400));
      expect(box().style.height).toBe("240px");
      /* Shorter again, it shrinks: `auto` first, or it could only grow. */
      type("heat");
      expect(box().style.height).toBe("40px");
      /* No scroller of its own, and no drag handle to fight the fit. */
      expect(box().className).toContain("tw:overflow-hidden");
      expect(box().className).toContain("tw:resize-none");
      /* Emptied, the rows decide: an empty textarea's `scrollHeight` counts a
         wrapped placeholder in Chrome (ChatPanel.tsx says so of the composer),
         which would grow the untouched box past its two rows. */
      type("");
      expect(box().style.height).toBe("");
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it("lists the matching pages as you type, and sends nothing until asked", async () => {
    mountAt("/help");
    type("heat");
    expect(resultHrefs()[0]).toBe("/help/spine");
    expect(host.querySelector('nav[aria-label="Help contents"]')).toBeNull();
    type("where did my article go");
    expect(resultHrefs()[0]).toBe("/help/questions#faq-find-archived");
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(posted).toEqual([]);
  });

  it("asks once on Enter, and draws the answer between the box and the matches", async () => {
    mountAt("/help");
    type("heat");
    await key({ key: "Enter" });
    expect(posted).toEqual([{ input: HELP_CHAT_PATH, body: { question: "heat" } }]);
    const answerEl = host.querySelector(".voice-ai");
    const list = host.querySelector('ul[aria-label="Search results"]');
    expect(answerEl?.textContent).toBe("See the spine.");
    expect(list).not.toBeNull();
    if (!answerEl || !list) throw new Error("answer or matching pages missing");
    /* The box, then the answer, then the matches. */
    expect(box().compareDocumentPosition(answerEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answerEl.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* The words are kept, and say no "You asked": they are the question. */
    expect(box().value).toBe("heat");
    expect(host.textContent).not.toContain("You asked");
  });

  it("asks nothing on Shift+Enter, a held Enter, or an input method's Enter (both spellings)", async () => {
    mountAt("/help");
    type("heat");
    for (const init of [
      { key: "Enter", shiftKey: true },
      { key: "Enter", repeat: true },
      { key: "Enter", isComposing: true },
      { key: "Enter", keyCode: 229 },
    ] as KeyboardEventInit[]) {
      await key(init);
    }
    expect(posted).toEqual([]);
  });

  it("asks once for two Enters in one tick", async () => {
    mountAt("/help");
    type("heat");
    await act(async () => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 20; i++) await act(async () => {});
    expect(posted).toHaveLength(1);
  });

  it("goes to a match that is pressed, keeps the words, and folds the matches until the next edit", () => {
    mountAt("/help/keyboard");
    type("heat");
    const row = host.querySelector<HTMLAnchorElement>('ul[aria-label="Search results"] a[href="/help/spine"]');
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(location.pathname).toBe("/help/spine");
    expect(box().value).toBe("heat");
    expect(resultHrefs()).toEqual([]);
    expect(host.querySelector('nav[aria-label="Help contents"] a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/help/spine",
    );
    type("heat map");
    expect(resultHrefs()).not.toEqual([]);
  });

  it("folds a match without changing the live words a dictation will replace", () => {
    mountAt("/help");
    const dictate = host.querySelector<HTMLButtonElement>('button[aria-label="Dictate"]');
    if (!dictate) throw new Error("no Dictate button");
    act(() => dictate.click());
    mic.armed = true;
    mountAt("/help");

    const options = mic.options as DictationOptions;
    act(() => {
      options.onText("heat");
    });
    const row = host.querySelector<HTMLAnchorElement>('ul[aria-label="Search results"] a[href="/help/spine"]');
    if (!row) throw new Error("no spine result");
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expect(box().value).toBe("heat");
    expect(resultHrefs()).toEqual([]);

    act(() => {
      options.onTranscript("what is heat?");
      mic.armed = false;
      options.onEnd();
    });
    mountAt("/help/spine");
    expect(box().value).toBe("what is heat?");
  });

  it("keeps the answer across a move from the contents to a page, and says what it answered once the box moves on", async () => {
    mountAt("/help");
    type("heat");
    await key({ key: "Enter" });
    const link = host.querySelector<HTMLAnchorElement>('.voice-ai a[href="/help/spine"]');
    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(location.pathname).toBe("/help/spine");
    expect(host.querySelector("aside .voice-ai")?.textContent).toBe("See the spine.");
    type("something else");
    expect(host.textContent).toContain("You asked: “heat”");
  });

  it("offers Ask when nothing matches, until these words have been answered", async () => {
    mountAt("/help");
    type("zebra");
    expect(resultHrefs()).toEqual([]);
    expect(status()).toContain("Nothing in Help matches “zebra”. Press Ask to ask it instead.");
    answer = "I only answer questions about how Spideryarn works.";
    await key({ key: "Enter" });
    expect(status()).toContain("Try other words.");
    expect(status()).not.toContain("Press Ask");
  });

  it("says back no more than the start of a long question", () => {
    mountAt("/help");
    const long = `zebra ${"quagga ".repeat(40)}`.trim();
    type(long);
    expect(status()).toContain("“zebra quagga quagga quagga quagga quagga…”");
    expect(status()).not.toContain(long);
  });

  it("has the answer's live region from the first render, before anything is asked", () => {
    mountAt("/help");
    expect(host.querySelector('section[aria-label="Search or ask about Spideryarn"] [aria-live="polite"]')).not.toBeNull();
  });
});
