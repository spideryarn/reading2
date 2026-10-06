// @vitest-environment jsdom
/**
 * **Changing conversation under a reader who is typing does not cost them the
 * caret.**
 *
 * `ChatDialog` stays mounted while `?thread=` changes underneath it, and it
 * keys `Conversation` on the thread's id so that scroll position and an open
 * editor do not cross from one conversation to the next. The composer is inside
 * that key, so a switch **unmounts the textarea the reader is in** and focus
 * falls to `<body>` — the panel still open in front of them, and the next key
 * press steering the article instead. qi-7dvah74y; F13 of
 * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md.
 *
 * The rule (ChatDialog.tsx § The caret follows the composer): when the commit
 * removes a composer that held focus, the composer that replaces it gets the
 * focus. Nothing else does — docs/plans/261004l-…md § B and its F4.
 *
 * ## How a reader gets here, since every switch control is a button
 *
 * A switch is a change of `?thread=`, which is what these tests do by drawing
 * the same mounted dialog with a new `target`. Two real routes leave the caret
 * in the box while that happens: the browser's Back and Forward (a key chord,
 * or a mouse button, neither of which moves focus), and a press on another
 * paragraph's chat chip or "?" in Safari, where a pressed button does not take
 * focus. In Chrome the pressed chip takes focus first, and that is the first
 * negative test below: the reader is on a control, and stays there.
 *
 * Draft → thread, the first case of this rule, is in
 * tests/chat-dialog-gives-focus-back.test.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId, ChatThread } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-10-04T16:00:00.000Z";
const BLOCK_A = "spya-swba01" as BlockId;
const BLOCK_B = "spya-swbb02" as BlockId;

const A: ChatThread = {
  id: "spya-swta01",
  kind: "chat",
  title: "why does the bound hold",
  createdAt: AT,
  updatedAt: AT,
  anchor: { blockId: BLOCK_A },
  messages: [
    { id: "spya-swqa01", role: "user", text: "why does the bound hold", createdAt: AT, status: "done" },
    { id: "spya-swaa01", role: "assistant", text: "Because the sum telescopes.", createdAt: AT, status: "done" },
  ],
};
const B: ChatThread = {
  ...A,
  id: "spya-swtb02",
  title: "and the second lemma",
  anchor: { blockId: BLOCK_B },
  messages: [
    { id: "spya-swqb02", role: "user", text: "and the second lemma", createdAt: AT, status: "done" },
    { id: "spya-swab02", role: "assistant", text: "It follows from the first.", createdAt: AT, status: "done" },
  ],
};

let threads: ChatThread[] = [A, B];

vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads,
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send: () => "spya-swtnew",
    speak: () => "",
    cancelAndDiscard: () => {},
    retry: () => {},
    edit: () => {},
    stop: () => {},
    begin: () => {},
    discard: () => {},
    rename: () => {},
    remove: () => {},
    error: null,
  }),
}));

const { ChatDialog } = await import("../src/web/ChatDialog.js");
type Props = Parameters<typeof ChatDialog>[0];

const TO_A = { kind: "thread", threadId: A.id } as const;
const TO_B = { kind: "thread", threadId: B.id } as const;
const DRAFT = { kind: "draft", anchor: { blockId: BLOCK_B }, opening: "the second lemma" } as const;

let rootEl: HTMLDivElement;
let root: Root;
/** One host per block's cell, as `Reader` renders the card's. */
let hostA: HTMLDivElement;
let hostB: HTMLDivElement;
/** A control in the article: the chat chip a reader presses to switch. */
let chip: HTMLButtonElement;

function buildArticle(): void {
  const table = document.createElement("table");
  table.className = "zoom";
  table.innerHTML = [BLOCK_A, BLOCK_B]
    .map(
      (id) =>
        `<tr data-block="${id}"><td class="text"><button type="button" class="blk-chat">chat</button><div data-chat-card-host data-marg-note></div></td></tr>`,
    )
    .join("");
  document.body.append(table);
  const hosts = table.querySelectorAll<HTMLDivElement>("[data-chat-card-host]");
  hostA = hosts[0] as HTMLDivElement;
  hostB = hosts[1] as HTMLDivElement;
  chip = table.querySelectorAll<HTMLButtonElement>(".blk-chat")[1] as HTMLButtonElement;
}

type Where = "float" | HTMLDivElement;

function draw(target: Props["target"], where: Where = "float") {
  act(() =>
    root.render(
      <ChatDialog
        slug="a-piece"
        at={null}
        blocks={
          new Map([
            [BLOCK_A, "a science of bumps"],
            [BLOCK_B, "the second lemma"],
          ])
        }
        target={target}
        dockRoom={null}
        card={where === "float" ? null : { host: where, width: 320 }}
        reopen={0}
        onJump={() => {}}
        onClose={() => {}}
        onThread={() => {}}
        onOpenFull={() => {}}
        onNewConversation={() => {}}
        onCreated={() => {}}
        onDropped={() => {}}
        onRenamed={() => {}}
      />,
    ),
  );
}

function panel(): HTMLElement {
  const all = document.querySelectorAll<HTMLElement>("aside.chat-dialog");
  if (all.length !== 1) throw new Error(`expected one chat panel in the document, found ${all.length}`);
  return all[0] as HTMLElement;
}
function composer(): HTMLTextAreaElement {
  const box = panel().querySelector<HTMLTextAreaElement>(".chat-composer textarea");
  if (!box) throw new Error("no composer — the test would prove nothing");
  return box;
}
function titled(text: string): HTMLButtonElement {
  const found = [...panel().querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text || b.title === text,
  );
  if (!found) throw new Error(`no "${text}" control in the panel`);
  return found;
}
/** Thread A open, and the reader typing in its box. */
function typingInA(where: Where = "float"): HTMLTextAreaElement {
  draw(TO_A, where);
  const box = composer();
  box.focus();
  expect(document.activeElement).toBe(box);
  return box;
}

beforeEach(() => {
  threads = [A, B];
  rootEl = document.createElement("div");
  document.body.append(rootEl);
  root = createRoot(rootEl);
  buildArticle();
});

afterEach(() => {
  act(() => root.unmount());
  rootEl.remove();
  document.querySelectorAll("table").forEach((t) => {
    t.remove();
  });
  vi.restoreAllMocks();
});

describe("switching conversation while typing", () => {
  it("keeps the caret in the composer, in the floating panel", () => {
    const before = typingInA();

    draw(TO_B);

    /* The premise: this is a new box, not the old one kept. If the key on
       `Conversation` ever goes, this test is no longer about anything. */
    expect(composer()).not.toBe(before);
    expect(panel().textContent).toContain("It follows from the first.");
    expect(document.activeElement).toBe(composer());
  });

  it("carries focus from the outgoing composer's Send control too", () => {
    typingInA();
    titled("Send").focus();
    draw(TO_B);
    expect(document.activeElement).toBe(composer());
  });

  /* The card's own case: B is about another paragraph, so the same commit that
     changes the conversation moves the card to another cell. */
  it("keeps it in the card, which moves to the other paragraph, without scrolling the article", () => {
    typingInA(hostA);
    expect(hostA.contains(panel())).toBe(true);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    draw(TO_B, hostB);

    expect(hostB.contains(panel())).toBe(true);
    expect(document.activeElement).toBe(composer());
    /* The card is in the page: a bare `focus()` scrolls the article to it. */
    expect(focus.mock.calls.length).toBeGreaterThan(0);
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
  });

  /* Back to a conversation whose transcript has not arrived: there is no
     composer to take the caret for one commit or several. */
  it("waits for a conversation that is still arriving", () => {
    threads = [A];
    typingInA();

    draw(TO_B);
    expect(panel().querySelector(".chat-composer")).toBeNull();
    expect(document.activeElement).toBe(document.body);

    threads = [A, B];
    draw(TO_B);
    expect(document.activeElement).toBe(composer());
  });

  it("does not take the caret back from somewhere the reader went while it was arriving", () => {
    threads = [A];
    typingInA();
    draw(TO_B);

    chip.focus();
    threads = [A, B];
    draw(TO_B);

    expect(document.activeElement).toBe(chip);
  });

  it.each(["float", "card"] as const)("%s: forgives pending focus after a visit elsewhere between commits", (place) => {
    threads = [A];
    typingInA(place === "float" ? "float" : hostA);
    draw(TO_B, place === "float" ? "float" : hostB);

    chip.focus();
    chip.blur();
    expect(document.activeElement).toBe(document.body);
    threads = [A, B];
    draw(TO_B, place === "float" ? "float" : hostB);

    expect(document.activeElement).toBe(document.body);
  });

  /* "New conversation" in a dialog that opened as a draft: the draft arm's own
     focus (`focusNonce={1}`) was spent when the dialog opened, so without the
     rule this lands on `<body>` too. */
  it("keeps the caret from a conversation to a new draft, when the dialog's opening focus is already spent", () => {
    draw(DRAFT);
    expect(document.activeElement).toBe(composer());
    typingInA();

    draw(DRAFT);

    expect(panel().textContent).toContain("Nothing is asked until you send.");
    expect(document.activeElement).toBe(composer());
  });
});

describe("switching conversation while NOT typing leaves focus where it is", () => {
  /* Chrome's version of pressing another paragraph's chip: the button took
     focus on the way down, before the conversation changed. */
  it("on a control in the article", () => {
    typingInA();
    chip.focus();

    draw(TO_B);

    expect(document.activeElement).toBe(chip);
  });

  it("on the panel's Close", () => {
    draw(TO_A);
    const close = panel().querySelector<HTMLButtonElement>(".chat-dialog-close");
    if (!close) throw new Error("no close control");
    close.focus();

    draw(TO_B);

    expect(document.activeElement).toBe(close);
  });

  it("on a footer control", () => {
    draw(TO_A);
    const full = titled("Open in full chat");
    full.focus();

    draw(TO_B);

    expect(document.activeElement).toBe(full);
  });

  /* The question editor is a textarea inside the conversation, and it is
     unmounted by the switch exactly as the composer is. It is not the
     composer: its words are a rewrite of one question in A, and B has no box
     that replaces it. */
  it("in the question editor, which goes with its conversation", () => {
    draw(TO_A);
    act(() => titled("Rewrite this question").click());
    const editor = panel().querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
    if (!editor) throw new Error("the pencil opened no editor");
    expect(document.activeElement).toBe(editor);

    draw(TO_B);

    expect(panel().querySelector("textarea.chat-edit-box")).toBeNull();
    expect(document.activeElement).not.toBe(composer());
  });
});
