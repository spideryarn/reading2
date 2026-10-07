// @vitest-environment jsdom
/**
 * ***Ask about Spideryarn*** on the page — src/web/help/HelpAsk.tsx. Plan
 * docs/plans/261007k-help-chatbot.md, Stage 2.
 *
 * What only a render shows: a stranger is told to sign in rather than given a
 * box; a signed-in question is posted as `{ question }` and its answer drawn
 * as it streams; a link in the answer is drawn only to one of the Help's own
 * pages, and anything else — a web address, a script, a Help path that does
 * not exist — is the characters the model typed; raw HTML is text; a
 * `complete: false` is said; an `error` frame's sentence is shown.
 * Which addresses count is tests/help-answer-links.test.ts.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HELP_CHAT_PATH } from "../src/help-chat.js";
import { SignedInShell } from "../src/web/BackLink.js";
import { HelpAsk, useHelpAsk } from "../src/web/help/HelpAsk.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The frames the next request streams, and what it was sent. */
let frames: [string, unknown][] = [];
let posted: { input: string; body: unknown }[] = [];
let held = false;
let signals: AbortSignal[] = [];

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string, init?: { body?: string; signal?: AbortSignal }) => {
    posted.push({ input, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    if (init?.signal) signals.push(init.signal);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (held) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
          return;
        }
        for (const [event, data] of frames) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  },
  readJson: async (res: Response) => res.json(),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  frames = [];
  posted = [];
  held = false;
  signals = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Box() {
  const state = useHelpAsk();
  return <HelpAsk state={state} />;
}

function draw(signedIn: boolean, node: ReactNode = <Box />): void {
  act(() => root.render(<SignedInShell.Provider value={signedIn}>{node}</SignedInShell.Provider>));
}

/** Type into the box the way React hears it, then press Enter. */
async function ask(question: string): Promise<void> {
  const box = host.querySelector("textarea");
  if (!box) throw new Error("no question box");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(box, question);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  /* The stream is read over several microtasks. */
  for (let i = 0; i < 20; i++) await act(async () => {});
}

const answerOf = () => host.querySelector(".voice-ai");

describe("Ask about Spideryarn", () => {
  it("tells a stranger to sign in, and has no box", () => {
    history.replaceState(null, "", "/help/questions#faq-older-profile");
    draw(false);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("Sign in to ask a question about Spideryarn.");
    const link = host.querySelector("a");
    /* Back to this page once signed in. */
    expect(link?.getAttribute("href")).toBe(
      "/login?next=%2Fhelp%2Fquestions%23faq-older-profile",
    );
  });

  it("posts the question alone and draws the answer, with a link only to a Help page", async () => {
    draw(true);
    const answer =
      "See [the spine](/help/spine) and [Help](/help). Not [this](https://evil.example/), " +
      "[this](javascript:alert(1)), [this](/help/no-such-page) or [this](/help/spine/). <b>bold</b>";
    frames = [
      ["delta", { text: answer.slice(0, 20) }],
      ["delta", { text: answer.slice(20) }],
      ["done", { answer, complete: true }],
    ];
    await ask("  What is the spine?  ");

    expect(posted).toEqual([{ input: HELP_CHAT_PATH, body: { question: "What is the spine?" } }]);
    const drawn = answerOf();
    expect(drawn).not.toBeNull();
    const hrefs = [...(drawn?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/help/spine", "/help"]);
    const text = drawn?.textContent ?? "";
    expect(text).toContain("[this](https://evil.example/)");
    expect(text).toContain("[this](javascript:alert(1))");
    expect(text).toContain("[this](/help/no-such-page)");
    expect(text).toContain("[this](/help/spine/)");
    /* Raw HTML is its own characters, never an element. */
    expect(text).toContain("<b>bold</b>");
    expect(drawn?.querySelector("b")).toBeNull();
    expect(host.textContent).not.toContain("cut short");
  });

  it("says an answer was cut short when it was", async () => {
    draw(true);
    frames = [
      ["delta", { text: "Part of it" }],
      ["done", { answer: "Part of it", complete: false }],
    ];
    await ask("Tell me everything");
    expect(answerOf()?.textContent).toContain("Part of it");
    expect(host.textContent).toContain("This answer was cut short.");
  });

  it("shows the server's sentence when the answer fails", async () => {
    draw(true);
    frames = [["error", { error: "The Help's answers are resting until tomorrow." }]];
    await ask("Why?");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("The Help's answers are resting until tomorrow.");
  });

  it("replaces the last answer with the next", async () => {
    draw(true);
    frames = [["done", { answer: "First answer", complete: true }]];
    await ask("One");
    frames = [["done", { answer: "Second answer", complete: true }]];
    await ask("Two");
    expect(answerOf()?.textContent).toBe("Second answer");
    expect(host.textContent).not.toContain("First answer");
  });

  it("aborts the browser request when the Help box leaves", async () => {
    held = true;
    draw(true);
    await ask("What is the spine?");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    draw(true, null);
    expect(signals[0]?.aborted).toBe(true);
  });
});
