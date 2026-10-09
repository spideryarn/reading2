// @vitest-environment jsdom
/**
 * **The microphone on *Ask about Spideryarn*** — src/web/help/HelpAsk.tsx.
 * Greg, `spya-y5gfpf`, 2026-10-08: *"Add a voice dictate button to the help
 * chat."* Plan docs/plans/261009a-help-dictation-and-mode-tldrs.md.
 *
 * What it must not do, each a way another box has got it wrong before:
 * send while the microphone is on or while the words are on their way (both
 * halves of `busy`, docs/project/dictation.md § Adding it to a box); send a
 * transcript longer than the server takes, which `maxLength` cannot stop
 * (GPT Sol's plan review, F2); or lose a dictation when the reader follows a
 * link from `/help` to a page and the box is drawn somewhere else (F1).
 *
 * `useDictation` is stubbed, as in tests/dictation-double-stop-sends.test.tsx,
 * and each ending is driven through the options the field gave it.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_HELP_QUESTION_CHARS } from "../src/help-chat.js";
import type { HelpAskState } from "../src/web/help/HelpAsk.js";

interface Options {
  onTranscript(text: string): boolean | undefined;
  onEnd(): void;
}
const mic = vi.hoisted(() => ({ armed: false, transcribing: false, options: null as unknown }));
vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (options: unknown) => {
    mic.options = options;
    return {
      supported: true,
      armed: mic.armed,
      transcribing: mic.transcribing,
      level: 0,
      error: null,
      toggle() {},
      dismiss() {},
    };
  },
}));
/* The real button; the strip's own states are tests/dictation-strip-holds-still.test.tsx's. */
vi.mock("../src/web/DictationStrip.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/DictationStrip.js")>()),
  DictationStrip: () => null,
}));
vi.mock("../src/web/dictation-upload.js", () => ({
  useReaderTranscriber: () => async () => {
    throw new Error("not called");
  },
}));

const posted: unknown[] = [];
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (_input: string, init?: { body?: string }) => {
    posted.push(init?.body === undefined ? undefined : JSON.parse(init.body));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: done\ndata: ${JSON.stringify({ answer: "A.", complete: true })}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  },
  readJson: async (res: Response) => res.json(),
}));

const { SignedInShell } = await import("../src/web/BackLink.js");
const { HelpAsk, useHelpAsk } = await import("../src/web/help/HelpAsk.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let state: HelpAskState | null = null;
let moveTo: ((place: "contents" | "page") => void) | null = null;

/**
 * The page's shape: the state held above, the box drawn in one of two places
 * (HelpPage.tsx draws it under the search on `/help` and in the column on a
 * page), so moving between them remounts the box and not the state.
 */
function Page() {
  const s = useHelpAsk();
  state = s;
  const [place, setPlace] = useState<"contents" | "page">("contents");
  moveTo = setPlace;
  return place === "contents" ? (
    <main key="contents">
      <HelpAsk state={s} />
    </main>
  ) : (
    <aside key="page">
      <HelpAsk state={s} />
    </aside>
  );
}

function draw() {
  act(() => root.render(<SignedInShell.Provider value={true}><Page /></SignedInShell.Provider>));
}
const s = (): HelpAskState => {
  if (!state) throw new Error("not drawn");
  return state;
};
const options = () => mic.options as Options;
const box = () => host.querySelector("textarea");
const askButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Ask");

function type(text: string) {
  const el = box();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pressEnter() {
  await act(async () => {
    box()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  for (let i = 0; i < 10; i++) await act(async () => {});
}
function start() {
  act(() => s().dictate.toggle());
  mic.armed = true;
  draw();
}
function stop() {
  act(() => s().dictate.toggle());
  mic.armed = false;
  mic.transcribing = true;
  draw();
}
async function end(transcript: string) {
  act(() => {
    options().onTranscript(transcript);
    mic.transcribing = false;
    options().onEnd();
  });
  draw();
  for (let i = 0; i < 10; i++) await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  posted.length = 0;
  mic.armed = false;
  mic.transcribing = false;
  state = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  draw();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the microphone on Ask about Spideryarn", () => {
  it("is drawn beside Ask, as the same control every other box has", () => {
    const row = askButton()?.parentElement;
    expect(row?.querySelectorAll("button")).toHaveLength(2);
  });

  it("refuses to send while the microphone is on, and says so on the button", async () => {
    type("What is the spine?");
    start();
    expect(askButton()?.disabled).toBe(true);
    await pressEnter();
    act(() => s().ask());
    expect(posted).toEqual([]);
  });

  it("refuses to send while the words are on their way", async () => {
    type("What is the spine?");
    start();
    stop();
    expect(box()?.readOnly).toBe(true);
    expect(askButton()?.disabled).toBe(true);
    await pressEnter();
    act(() => s().ask());
    expect(posted).toEqual([]);
  });

  it("sends the transcript, not the live guess, on a double press of Stop", async () => {
    start();
    stop();
    const again = s().dictate.again;
    expect(again).toBeDefined();
    act(() => again?.());
    expect(posted).toEqual([]);
    await end("What does the orange line mean?");
    expect(posted).toEqual([{ question: "What does the orange line mean?" }]);
  });

  it("never sends a transcript longer than the server takes, and says how long it is", async () => {
    const long = "word ".repeat(250).trim();
    expect(long.length).toBeGreaterThan(MAX_HELP_QUESTION_CHARS);
    start();
    stop();
    act(() => s().dictate.again?.());
    await end(long);
    expect(posted).toEqual([]);
    /* Kept whole: the reader trims it. */
    expect(box()?.value).toBe(long);
    expect(askButton()?.disabled).toBe(true);
    expect(host.textContent).toContain(`${long.length} characters — a question can be at most ${MAX_HELP_QUESTION_CHARS}.`);
    await pressEnter();
    expect(posted).toEqual([]);
  });

  it("keeps a dictation going when the box is drawn somewhere else", async () => {
    start();
    act(() => moveTo?.("page"));
    expect(host.querySelector("aside textarea")).not.toBeNull();
    expect(s().dictate.dictation.armed).toBe(true);
    stop();
    await end("Where is my shelf?");
    expect(host.querySelector<HTMLTextAreaElement>("aside textarea")?.value).toBe("Where is my shelf?");
  });
});
