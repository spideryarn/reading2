// @vitest-environment jsdom
/**
 * **Recall's Hint button, as the reader meets it.**
 *
 * A Recall answer ends with a question, and under it a `Hint:` paragraph the
 * model wrote in the same reply. The panel keeps that paragraph behind a button
 * (`splitHint` in src/recall-hint.ts decides what counts as one). What matters
 * here is what is on screen and on the clipboard before and after the press,
 * and that a new answer in the same row starts closed.
 *
 * The write that records the press is the controller's
 * (tests/recall-hint-reduce.test.ts); this file only checks that the panel asks
 * for it until the stored timestamp comes back, and opens whether or not anyone
 * is listening.
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatThread, ThreadKind } from "../src/types.js";

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-10-04T10:00:00.000Z";
const LATER = "2026-10-04T10:05:00.000Z";
const ANSWER_ID = "spya-ans2aa";
const QUESTION_BLOCK = "spya-bbbbbb";
const HINT_BLOCK = "spya-cccccc";

const BODY = `Do you remember what he says researchers kept doing instead [${QUESTION_BLOCK}]?`;
const HINT = `He names two games where the hand-built approach lost [${HINT_BLOCK}].`;
const HINT_WORDS = "He names two games where the hand-built approach lost";
const HINTED = `${BODY}\n\nHint: ${HINT}`;

function thread(answer: Partial<ChatMessage> = {}, kind: ThreadKind = "learn"): ChatThread {
  return {
    id: "spya-k3m9qt",
    title: "What I took from it",
    createdAt: AT,
    updatedAt: AT,
    kind,
    messages: [
      { id: "spya-usr2aa", role: "user", text: "what I took", createdAt: AT, status: "done" },
      { id: ANSWER_ID, role: "assistant", text: HINTED, createdAt: AT, status: "done", ...answer },
    ],
  };
}

let host: HTMLDivElement;
let root: Root;
const jumped: string[] = [];
const opened: { messageId: string; hint: string }[] = [];
const copied: string[] = [];

function paint(t: ChatThread, opts: { listening?: boolean } = {}) {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: t.kind,
        loaded: true,
        loadFailed: false,
        threads: [t],
        threadId: t.id,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: true,
        onRetry: () => {},
        onEdit: () => {},
        onDeleteFrom: undefined,
        onStop: () => {},
        onJump: (id: string) => {
          jumped.push(id);
        },
        ...(opts.listening === false
          ? {}
          : {
              onHintOpened: (messageId: string, hint: string) => {
                opened.push({ messageId, hint });
              },
            }),
        recovering: new Set<string>(),
        blocks: new Map<string, string>([
          [QUESTION_BLOCK, "Researchers kept building in what they knew."],
          [HINT_BLOCK, "Chess and Go."],
        ]),
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

const answer = () => host.querySelector<HTMLElement>(".chat-turn.model");
const hintButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".chat-turn.model button")].find(
    (b) => b.textContent?.trim() === "Hint",
  ) ?? null;
const press = (el: Element | null) => {
  if (!el) throw new Error("nothing to press");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};
const copy = async () => {
  const button = host.querySelector<HTMLButtonElement>('.chat-turn.model button[title="Copy this answer"]');
  if (!button) throw new Error("no copy button");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  return copied.at(-1);
};

beforeEach(() => {
  jumped.length = 0;
  opened.length = 0;
  copied.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        copied.push(text);
      }),
    },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("a Recall answer with a hint", () => {
  it("keeps the hint off the screen until Hint is pressed", () => {
    paint(thread());
    expect(answer()?.textContent).toContain("Do you remember what he says researchers kept doing");
    expect(answer()?.textContent).not.toContain(HINT_WORDS);
    expect(answer()?.textContent).not.toContain("Hint:");
    expect(hintButton()?.getAttribute("aria-expanded")).toBe("false");

    press(hintButton());
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(hintButton()?.getAttribute("aria-expanded")).toBe("true");
    /* The button says what it controls, and what it controls is there. */
    const region = host.ownerDocument.getElementById(hintButton()?.getAttribute("aria-controls") ?? "");
    expect(region?.textContent).toContain(HINT_WORDS);
  });

  it("asks again after a reopen until the stored press comes back", () => {
    paint(thread());
    press(hintButton());
    expect(opened).toEqual([{ messageId: ANSWER_ID, hint: HINT }]);
    /* No stored timestamp came back: the first write may have failed. */
    press(hintButton());
    expect(answer()?.textContent).not.toContain(HINT_WORDS);
    press(hintButton());
    expect(opened).toEqual([
      { messageId: ANSWER_ID, hint: HINT },
      { messageId: ANSWER_ID, hint: HINT },
    ]);

    /* Once the server's time arrives, later toggles need no write. */
    paint(thread({ hintOpenedAt: LATER }));
    press(hintButton());
    press(hintButton());
    expect(opened).toHaveLength(2);
  });

  it("opens even when nothing is there to record the press", () => {
    paint(thread(), { listening: false });
    press(hintButton());
    expect(answer()?.textContent).toContain(HINT_WORDS);
  });

  it("draws the hint's block id as a chip that jumps, like the question's", () => {
    paint(thread());
    expect(host.querySelector(`.chat-turn.model [data-block-link="${QUESTION_BLOCK}"]`)).not.toBeNull();
    expect(host.querySelector(`[data-block-link="${HINT_BLOCK}"]`)).toBeNull();

    press(hintButton());
    press(host.querySelector(`.chat-turn.model [data-block-link="${HINT_BLOCK}"]`));
    expect(jumped).toEqual([HINT_BLOCK]);
  });

  it("copies what is on screen: the body while closed, the hint as well once open", async () => {
    paint(thread());
    expect(await copy()).toBe(BODY);
    press(hintButton());
    expect(await copy()).toBe(HINTED);
  });

  it("is open on arrival when the reader opened it before, and asks for nothing", () => {
    paint(thread({ hintOpenedAt: LATER }));
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(hintButton()?.getAttribute("aria-expanded")).toBe("true");
    expect(opened).toEqual([]);
  });

  it("opens when the stored press arrives after the answer was already drawn", () => {
    /* Stream recovery, or the write's own answer, patches the message later.
       Open is read on every render, not only when the turn mounts. */
    paint(thread());
    expect(answer()?.textContent).not.toContain(HINT_WORDS);
    paint(thread({ hintOpenedAt: LATER }));
    expect(answer()?.textContent).toContain(HINT_WORDS);
  });

  it("stays open through leaving the conversation and coming back, once the press is stored", () => {
    paint(thread());
    press(hintButton());
    act(() => root.unmount());
    root = createRoot(host);
    /* What the controller holds after the write answered. */
    paint(thread({ hintOpenedAt: LATER }));
    expect(answer()?.textContent).toContain(HINT_WORDS);
  });
});

describe("a retry puts a new answer in the same row", () => {
  it("shows the replacement's hint closed, though the last one was open", () => {
    paint(thread());
    press(hintButton());
    expect(answer()?.textContent).toContain(HINT_WORDS);

    /* The same message id throughout: that is what makes it a retry. */
    paint(thread({ text: "", status: "pending", createdAt: LATER }));
    paint(
      thread({
        text: `Do you remember the other game [${QUESTION_BLOCK}]?\n\nHint: A new clue about Go.`,
        createdAt: LATER,
      }),
    );
    expect(answer()?.textContent).toContain("Do you remember the other game");
    expect(answer()?.textContent).not.toContain("A new clue about Go.");
    expect(hintButton()?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("what is not a hint is shown as written", () => {
  it("leaves a chat answer that ends with a Hint: paragraph alone", () => {
    paint(thread({}, "chat"));
    expect(answer()?.textContent).toContain("Hint:");
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(hintButton()).toBeNull();
  });

  it("leaves a Tutorial answer alone", () => {
    paint(thread({}, "tutorial"));
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(hintButton()).toBeNull();
  });

  it("leaves a Recall answer that asks nothing alone", async () => {
    const text = `He says researchers kept building in what they knew [${QUESTION_BLOCK}].\n\nHint: ${HINT}`;
    paint(thread({ text }));
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(hintButton()).toBeNull();
    expect(await copy()).toBe(text);
  });

  it("shows a hint in a wrong spelling in the open", () => {
    paint(thread({ text: `${BODY}\n\n**Hint:** ${HINT}` }));
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(hintButton()).toBeNull();
  });
});

describe("while the answer is still arriving", () => {
  it("hides the hint as it arrives, and offers no button until the answer has settled", () => {
    /* No button means no press before the answer has settled, so there is
       never a press waiting in the panel for a write that leaving the
       conversation would lose (F17 in the 261004h code review). */
    paint(thread({ text: `${BODY}\n\nHint: He names`, status: "pending" }));
    expect(answer()?.textContent).toContain("Do you remember what he says");
    expect(answer()?.textContent).not.toContain("He names");
    expect(answer()?.textContent).not.toContain("Hint");
    expect(hintButton()).toBeNull();

    /* The whole hint is there, and the answer still has not settled. */
    paint(thread({ status: "pending" }));
    expect(answer()?.textContent).not.toContain(HINT_WORDS);
    expect(hintButton()).toBeNull();

    paint(thread());
    expect(answer()?.textContent).not.toContain(HINT_WORDS);
    expect(hintButton()?.getAttribute("aria-expanded")).toBe("false");
    expect(opened).toEqual([]);

    /* The first press is on the stored answer, and is reported at once. */
    press(hintButton());
    expect(answer()?.textContent).toContain(HINT_WORDS);
    expect(opened).toEqual([{ messageId: ANSWER_ID, hint: HINT }]);
  });

  it("draws neither button nor hint for a pending answer, whatever its stored time says", () => {
    /* The rule is the status alone, so it has no second case to get wrong. */
    paint(thread({ status: "pending", hintOpenedAt: LATER }));
    expect(hintButton()).toBeNull();
    expect(answer()?.textContent).not.toContain(HINT_WORDS);
    expect(opened).toEqual([]);
  });
});
