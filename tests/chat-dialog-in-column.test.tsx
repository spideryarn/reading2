// @vitest-environment jsdom
/**
 * **The block chat as a card in the Marginalia column: the same panel, moved
 * into a host in its block's cell, and never remounted on the way.**
 *
 * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md. `Reader`
 * decides whether there is a card and hands down the host; this is the panel's
 * half: where its `<aside>` is attached, what it falls back to, the collapsed
 * card, and what a move between the three places keeps.
 *
 * What is NOT here is geometry, and the iPad keyboard: jsdom lays nothing out.
 * Those are the browser check's. tests/chat-dock-wiring.test.tsx has
 * `Reader`'s half.
 */
import { act, StrictMode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId, ChatThread } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-10-04T15:00:00.000Z";
const BLOCK = "spya-crdb01" as BlockId;

const ANSWERED: ChatThread = {
  id: "spya-crdt01",
  kind: "chat",
  title: "why does the bound hold",
  createdAt: AT,
  updatedAt: AT,
  anchor: { blockId: BLOCK },
  messages: [
    { id: "spya-crdq01", role: "user", text: "why does the bound hold", createdAt: AT, status: "done" },
    {
      id: "spya-crda01",
      role: "assistant",
      text: "Because the sum telescopes.\n\nAnd a second paragraph.",
      createdAt: AT,
      status: "done",
    },
  ],
};
/** The same conversation with a second answer on its way. */
const ANSWERING: ChatThread = {
  ...ANSWERED,
  messages: [
    ...ANSWERED.messages,
    { id: "spya-crdq02", role: "user", text: "and then?", createdAt: AT, status: "done" },
    { id: "spya-crda02", role: "assistant", text: "", createdAt: AT, status: "pending" },
  ],
};
/** One whose only answer failed: there is no answer text to show. */
const UNANSWERED: ChatThread = {
  ...ANSWERED,
  messages: [
    { id: "spya-crdq01", role: "user", text: "why does the bound hold", createdAt: AT, status: "done" },
    { id: "spya-crda01", role: "assistant", text: "", createdAt: AT, status: "error" },
  ],
};
const OTHER: ChatThread = { ...ANSWERED, id: "spya-crdt02", title: "another question entirely" };

let threads: ChatThread[] = [ANSWERED, OTHER];
const send = vi.fn(() => "spya-crdnew");

vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads,
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send,
    speak: () => "",
    cancelAndDiscard: () => {},
    retry: () => {},
    edit: () => {},
    stop: () => {},
    begin: () => {},
    discard: () => {},
    rename: () => {},
    remove: () => {},
    deleteFrom: () => {},
    settled: () => true,
    error: null,
  }),
}));

const { ChatDialog } = await import("../src/web/ChatDialog.js");
type Props = Parameters<typeof ChatDialog>[0];

const DRAFT = { kind: "draft", anchor: { blockId: BLOCK }, opening: "a science of bumps" } as const;
const HELP = { ...DRAFT, help: true } as const;
const THREAD = { kind: "thread", threadId: ANSWERED.id } as const;

let rootEl: HTMLDivElement;
let root: Root;
/** The card's host, as `Reader` renders it into the anchor block's cell. */
let cell: HTMLTableCellElement;
let cardHost: HTMLDivElement;

function buildCell(): void {
  const table = document.createElement("table");
  table.className = "zoom";
  table.innerHTML = `<tbody><tr data-block="${BLOCK}"><td class="text"><div class="prose"><p>a science of bumps</p></div></td></tr></tbody>`;
  document.body.append(table);
  cell = table.querySelector("td") as HTMLTableCellElement;
  cardHost = document.createElement("div");
  cardHost.setAttribute("data-chat-card-host", "");
  cardHost.setAttribute("data-marg-note", "");
  cell.append(cardHost);
}

type Place = { card?: Props["card"]; dockRoom?: number | null; reopen?: number };
const inCard = (): Place => ({ card: { host: cardHost, width: 320 }, dockRoom: 272 });

function draw(target: Props["target"], place: Place = {}, strict = false) {
  const el = (
    <ChatDialog
      slug="a-piece"
      at={null}
      blocks={new Map([[BLOCK, "a science of bumps"]])}
      target={target}
      dockRoom={place.dockRoom ?? null}
      card={place.card ?? null}
      reopen={place.reopen ?? 0}
      onJump={() => {}}
      onClose={() => {}}
      onThread={() => {}}
      onOpenFull={() => {}}
      onCreated={() => {}}
      onDropped={() => {}}
      onRenamed={() => {}}
    />
  );
  act(() => root.render(strict ? <StrictMode>{el}</StrictMode> : el));
}

function panel(): HTMLElement {
  const all = document.querySelectorAll<HTMLElement>("aside.chat-dialog");
  if (all.length !== 1) throw new Error(`expected one chat panel in the document, found ${all.length}`);
  return all[0] as HTMLElement;
}
const button = (label: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  );
/** What a reader can see: nothing under a `hidden` element. */
const shown = (selector: string) =>
  [...panel().querySelectorAll<HTMLElement>(selector)].filter((el) => el.closest("[hidden]") === null);

function type(box: HTMLTextAreaElement, text: string) {
  /* Through the prototype's setter, so React's value tracker sees a change. */
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Browsers give a display:none transcript no scroll geometry; jsdom needs
 * that boundary modelled explicitly to exercise a stream arriving while shut. */
function transcriptGeometry() {
  let height = 1000;
  let top = 0;
  const visible = (el: HTMLElement) => el.closest("[hidden]") === null;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["scrollHeight", "clientHeight", "scrollTop"]) {
    originals.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains("chat-scroll")) return 0;
        if (!visible(this)) {
          top = 0;
          return 0;
        }
        return name === "scrollHeight" ? height : name === "clientHeight" ? 200 : top;
      },
      ...(name === "scrollTop" ? {
        set(this: HTMLElement, value: number) {
          if (this.classList.contains("chat-scroll")) {
            top = visible(this) ? Math.max(0, Math.min(value, height - 200)) : 0;
          }
        },
      } : {}),
    });
  }
  return {
    grow() { height = 1600; },
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    },
  };
}

beforeEach(() => {
  threads = [ANSWERED, OTHER];
  send.mockClear();
  rootEl = document.createElement("div");
  document.body.append(rootEl);
  root = createRoot(rootEl);
  buildCell();
});

afterEach(() => {
  act(() => root.unmount());
  rootEl.remove();
  document.querySelectorAll("table").forEach((t) => {
    t.remove();
  });
  vi.restoreAllMocks();
});

describe("where the panel is attached", () => {
  it("is inside the host it is given, as `in-column`, and not docked", () => {
    draw(THREAD, inCard());
    expect(cardHost.contains(panel())).toBe(true);
    expect(rootEl.contains(panel())).toBe(false);
    expect(panel().classList.contains("in-column")).toBe(true);
    expect(panel().classList.contains("docked")).toBe(false);
    /* The width is the host's to carry: it is the positioned, measured box. */
    expect(cardHost.style.getPropertyValue("--chat-card-w")).toBe("320px");
    expect(panel().style.getPropertyValue("--chat-dock-room")).toBe("");
  });

  it("falls back to the dock without a host, and to the floating panel without either", () => {
    draw(THREAD, { dockRoom: 272 });
    expect(rootEl.contains(panel())).toBe(true);
    expect(panel().classList.contains("docked")).toBe(true);
    expect(panel().classList.contains("in-column")).toBe(false);

    draw(THREAD, {});
    expect(rootEl.contains(panel())).toBe(true);
    expect(panel().classList.contains("docked")).toBe(false);
    expect(panel().classList.contains("in-column")).toBe(false);
  });

  /* Plan § 3, never nothing: a host that has left the document (its cell
     unmounted a commit before `Reader` heard) is not somewhere to draw. */
  it("does not follow a host that has left the document", () => {
    draw(THREAD, inCard());
    cardHost.remove();
    draw(THREAD, inCard());
    expect(rootEl.contains(panel())).toBe(true);
    expect(panel().classList.contains("in-column")).toBe(false);
    expect(panel().classList.contains("docked")).toBe(true);
  });

  it("takes its container out of the host when it closes", async () => {
    draw(THREAD, inCard());
    expect(cardHost.childElementCount).toBe(1);
    act(() => root.render(null));
    /* One microtask later, with the focus it gives back: ChatDialog.tsx
       § deferred, because a cleanup is not proof of an unmount. */
    await Promise.resolve();
    expect(cardHost.childElementCount).toBe(0);
    expect(document.querySelector("aside.chat-dialog")).toBeNull();
  });

  /* The composer sizes itself in a layout effect by measuring `scrollHeight`,
     and a detached element measures 0. So the container has to be attached
     before the panel's children run theirs. */
  it("is in the document by the time the composer measures itself", () => {
    const real = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return this.isConnected ? 44 : 0;
      },
    });
    try {
      draw(DRAFT, {});
      expect(panel().querySelector("textarea")?.style.height).toBe("44px");
      act(() => root.render(null));
      draw(DRAFT, inCard());
      expect(panel().querySelector("textarea")?.style.height).toBe("44px");
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
      if (real) Object.defineProperty(Element.prototype, "scrollHeight", real);
    }
  });
});

describe("collapsed and expanded", () => {
  it("opens expanded, with the title once and a Collapse control beside the close", () => {
    draw(THREAD, inCard());
    expect(panel().classList.contains("collapsed")).toBe(false);
    expect(shown(".chat-dialog-title").map((t) => t.textContent)).toEqual([ANSWERED.title]);
    expect(button("Collapse")?.getAttribute("aria-expanded")).toBe("true");
    expect(button("Close")).toBeTruthy();
    expect(shown(".chat-card-shut")).toHaveLength(0);
  });

  it("collapses to one button: the title once, and the first line of the latest answer", () => {
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    expect(panel().classList.contains("collapsed")).toBe(true);
    const shut = shown(".chat-card-shut");
    expect(shut).toHaveLength(1);
    expect(shut[0]?.tagName).toBe("BUTTON");
    expect(shut[0]?.getAttribute("aria-expanded")).toBe("false");
    /* The whole card is that button: nothing else of the panel is showing. */
    expect(shown("button")).toEqual(shut);
    expect(shown(".chat-dialog-title").map((t) => t.textContent)).toEqual([ANSWERED.title]);
    const line = shut[0]?.querySelector(".chat-card-line");
    expect(line?.textContent).toBe("Because the sum telescopes.");
    /* The answer is the model's, the title the reader's (fonts.md). */
    expect(line?.classList.contains("voice-ai")).toBe(true);
    /* It stays a card in the column: collapsing is not leaving. */
    expect(cardHost.contains(panel())).toBe(true);
  });

  it("shows that line in plain words: no markdown, no block references", () => {
    /* It was the answer's raw first line, `**…**` and `[spya-…]` included
       (queue item qi-ezpyknnv). The cut is `answerOpening`, shared with the
       summaries' `lastLine`. */
    threads = [
      {
        ...ANSWERED,
        messages: [
          ANSWERED.messages[0]!,
          {
            ...ANSWERED.messages[1]!,
            text: "**Because** the sum telescopes [spya-k3m9qt].\n\nAnd a second paragraph.",
          },
        ],
      },
    ];
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    expect(shown(".chat-card-shut")[0]?.querySelector(".chat-card-line")?.textContent).toBe(
      "Because the sum telescopes.",
    );
  });

  it("says an answer is arriving, with the spinner, while one is", () => {
    threads = [ANSWERING];
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    const line = shown(".chat-card-line")[0];
    expect(line?.textContent).toBe("answering…");
    expect(line?.querySelector(".chat-dialog-spinner")).not.toBeNull();
  });

  it("counts the questions when there is no answer text to show", () => {
    threads = [UNANSWERED];
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    expect(shown(".chat-card-line")[0]?.textContent).toBe("1 question");
  });

  it.each([
    ["[spya-k3m9qt](https://example.com/source)", "spya-k3m9qt"],
    ["**Unclosed bold", "**Unclosed bold"],
    ["```ts\nconst n = 2;", "const n = 2;"],
  ])("keeps the readable opening of an interrupted answer: %s", (text, opening) => {
    threads = [{
      ...ANSWERED,
      messages: [ANSWERED.messages[0]!, { ...ANSWERED.messages[1]!, text, status: "error" }],
    }];
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    expect(shown(".chat-card-line")[0]?.textContent).toBe(opening);
  });

  it("expands again on a press, to the same transcript it had", () => {
    draw(THREAD, inCard());
    const transcript = panel().querySelector(".chat-scroll");
    expect(transcript).not.toBeNull();
    act(() => button("Collapse")?.click());
    expect(shown(".chat-scroll")).toHaveLength(0);
    act(() => shown(".chat-card-shut")[0]?.click());
    expect(panel().classList.contains("collapsed")).toBe(false);
    expect(shown(".chat-card-shut")).toHaveLength(0);
    /* Not remounted by collapsing: an open editor or a dictation would go. */
    expect(shown(".chat-scroll")[0]).toBe(transcript);
  });

  it("moves the keyboard with the press: to the card, then back to Collapse", () => {
    draw(THREAD, inCard());
    button("Collapse")?.focus();
    act(() => button("Collapse")?.click());
    expect(document.activeElement).toBe(shown(".chat-card-shut")[0]);
    act(() => shown(".chat-card-shut")[0]?.click());
    expect(document.activeElement).toBe(button("Collapse"));
  });

  it("gives a draft, and a help draft, no collapse control", () => {
    draw(DRAFT, inCard());
    expect(button("Collapse")).toBeUndefined();
    act(() => root.render(null));
    draw(HELP, inCard());
    expect(button("Collapse")).toBeUndefined();
  });

  it("has no collapse control outside the column, and shows a collapsed one whole there", () => {
    draw(THREAD, { dockRoom: 272 });
    expect(button("Collapse")).toBeUndefined();

    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    expect(panel().classList.contains("collapsed")).toBe(true);
    /* The fold, or a narrower window: the dock has nothing to collapse to. */
    draw(THREAD, { dockRoom: 272 });
    expect(panel().classList.contains("collapsed")).toBe(false);
    expect(shown(".chat-scroll")).toHaveLength(1);
  });

  /* GPT Sol on the plan, F1: the gutter chip and "?" only write `?thread=`, so
     a press that names the conversation already open changes nothing the panel
     could see. `Reader` counts those presses and this is what hears it. */
  it("expands when the reader asks for the conversation that is already open", () => {
    draw(THREAD, { ...inCard(), reopen: 3 });
    act(() => button("Collapse")?.click());
    expect(panel().classList.contains("collapsed")).toBe(true);
    draw(THREAD, { ...inCard(), reopen: 4 });
    expect(panel().classList.contains("collapsed")).toBe(false);
  });

  it("does not carry a collapse over to another conversation", () => {
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    draw({ kind: "thread", threadId: OTHER.id }, inCard());
    expect(panel().classList.contains("collapsed")).toBe(false);
    expect(shown(".chat-dialog-title").map((t) => t.textContent)).toEqual([OTHER.title]);
  });

  it("opens expanded on returning to a previous thread through a mounted URL change", () => {
    draw(THREAD, inCard());
    act(() => button("Collapse")?.click());
    draw({ kind: "thread", threadId: OTHER.id }, inCard());
    draw(THREAD, inCard());
    expect(panel().classList.contains("collapsed")).toBe(false);
    expect(shown(".chat-scroll")).toHaveLength(1);
  });

  /* It used to be followed to its new bottom. Since 261005f an answer is read
     from its start: the reopened card puts the question back at the top, and
     the pill says the answer runs on below. This file gives turns no
     positions, so "the question's top" is 0 here; the placement arithmetic is
     tests/chat-streamed-answer-stays.test.tsx. */
  it("opens an answer that finished while collapsed at its start, not its end", () => {
    const geometry = transcriptGeometry();
    try {
      threads = [ANSWERING];
      draw(THREAD, inCard());
      const transcript = panel().querySelector<HTMLElement>(".chat-scroll");
      if (!transcript) throw new Error("no transcript");
      expect(transcript.scrollTop, "an arriving answer is opened at its question").toBe(0);
      act(() => button("Collapse")?.click());
      expect(transcript.scrollHeight).toBe(0);
      geometry.grow();
      threads = [{ ...ANSWERING, messages: [
        ...ANSWERING.messages.slice(0, -1),
        { ...ANSWERING.messages[3]!, text: "A much longer answer has arrived.", status: "done" },
      ] }];
      draw(THREAD, inCard());
      act(() => shown(".chat-card-shut")[0]?.click());
      expect(transcript.scrollTop).toBe(0);
      expect(shown(".chat-to-bottom")).toHaveLength(1);
    } finally {
      geometry.restore();
    }
  });

  it("retains the reader's earlier passage and Latest control across hidden stream updates", () => {
    const geometry = transcriptGeometry();
    try {
      threads = [ANSWERING];
      draw(THREAD, inCard());
      const transcript = panel().querySelector<HTMLElement>(".chat-scroll");
      if (!transcript) throw new Error("no transcript");
      act(() => {
        transcript.scrollTop = 120;
        transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      expect(shown(".chat-to-bottom")).toHaveLength(1);
      act(() => button("Collapse")?.click());
      geometry.grow();
      threads = [{ ...ANSWERING, messages: [
        ...ANSWERING.messages.slice(0, -1),
        { ...ANSWERING.messages[3]!, text: "A longer answer arriving out of view.", status: "pending" },
      ] }];
      draw(THREAD, inCard());
      act(() => shown(".chat-card-shut")[0]?.click());
      expect(transcript.scrollTop).toBe(120);
      expect(shown(".chat-to-bottom")).toHaveLength(1);
      threads = [{ ...threads[0]!, messages: [
        ...threads[0]!.messages.slice(0, -1),
        { ...threads[0]!.messages[3]!, text: "A longer answer arriving out of view. More text." },
      ] }];
      draw(THREAD, inCard());
      expect(transcript.scrollTop).toBe(120);
    } finally {
      geometry.restore();
    }
  });

  it("ignores the scroll event caused by hiding a transcript the reader had scrolled up", () => {
    const geometry = transcriptGeometry();
    try {
      draw(THREAD, inCard());
      const transcript = panel().querySelector<HTMLElement>(".chat-scroll");
      if (!transcript) throw new Error("no transcript");
      act(() => {
        transcript.scrollTop = 120;
        transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      act(() => button("Collapse")?.click());
      expect(transcript.scrollHeight).toBe(0);
      act(() => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
      act(() => shown(".chat-card-shut")[0]?.click());
      expect(transcript.scrollTop).toBe(120);
      expect(shown(".chat-to-bottom")).toHaveLength(1);
    } finally {
      geometry.restore();
    }
  });
});

describe("a move between the card, the dock and the corner keeps what the reader had", () => {
  it("keeps a typed draft in the same box, host to no host and back", () => {
    draw(DRAFT, inCard());
    const before = panel();
    const box = before.querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("the draft has no composer — the test would prove nothing");
    type(box, "half a question");

    draw(DRAFT, { dockRoom: 272 });
    expect(panel()).toBe(before);
    expect(rootEl.contains(before)).toBe(true);
    expect(panel().querySelector("textarea")).toBe(box);
    expect(box.value).toBe("half a question");

    draw(DRAFT, inCard());
    expect(panel()).toBe(before);
    expect(cardHost.contains(before)).toBe(true);
    expect(panel().querySelector("textarea")).toBe(box);
    expect(box.value).toBe("half a question");
  });

  it("sends a help question once, however often the panel moves", () => {
    draw(HELP, inCard());
    expect(send).toHaveBeenCalledTimes(1);
    draw(HELP, { dockRoom: 272 });
    draw(HELP, {});
    draw(HELP, inCard());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a help question once under StrictMode, in the card", () => {
    draw(HELP, inCard(), true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(cardHost.contains(panel())).toBe(true);
  });

  it("keeps an open question editor and what was typed into it", () => {
    draw(THREAD, inCard());
    const pencil = [...panel().querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.title === "Rewrite this question",
    );
    if (!pencil) throw new Error("no pencil on the question — the test would prove nothing");
    act(() => pencil.click());
    const editor = panel().querySelector<HTMLTextAreaElement>("textarea.chat-edit-box");
    if (!editor) throw new Error("the editor did not open");
    type(editor, "why does the bound hold here");

    draw(THREAD, { dockRoom: 272 });
    draw(THREAD, inCard());
    expect(panel().querySelector("textarea.chat-edit-box")).toBe(editor);
    expect(editor.value).toBe("why does the bound hold here");
  });

  /* A browser forgets an element's scroll offset when the element leaves the
     document, and jsdom does not — so the removal below does the forgetting,
     as a browser would. With that, this fails unless the move puts it back. */
  it("keeps the transcript's scroll offset", () => {
    draw(THREAD, inCard());
    const transcript = panel().querySelector<HTMLElement>(".chat-scroll");
    if (!transcript) throw new Error("no transcript — the test would prove nothing");
    transcript.scrollTop = 120;
    const appendChild = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, child: Node) {
      if (child instanceof Element && child.contains(transcript)) transcript.scrollTop = 0;
      return appendChild.call(this, child);
    } as typeof Node.prototype.appendChild);

    draw(THREAD, { dockRoom: 272 });
    expect(rootEl.contains(transcript)).toBe(true);
    expect(transcript.scrollTop).toBe(120);
    draw(THREAD, inCard());
    expect(cardHost.contains(transcript)).toBe(true);
    expect(transcript.scrollTop).toBe(120);
  });

  it("keeps the keyboard where it was, without scrolling the page to it", () => {
    draw(DRAFT, inCard());
    const box = panel().querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("the draft has no composer");
    box.focus();
    expect(document.activeElement).toBe(box);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");

    draw(DRAFT, { dockRoom: 272 });
    expect(document.activeElement).toBe(box);
    draw(DRAFT, inCard());
    expect(document.activeElement).toBe(box);
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
  });

  /* The same move, but the host's cell is unmounted in the commit that takes
     the card away (Marginalia turned off, a resize under the threshold): the
     container leaves the document before any effect runs. */
  it("keeps the keyboard when the host is removed in the same commit", () => {
    /* `Reader` renders the host through `TableView`, which React unmounts in
       the commit's mutation phase: after this panel has rendered, before any
       of its effects. An earlier sibling's layout effect is the same moment. */
    function Sibling({ gone }: { gone: boolean }) {
      useLayoutEffect(() => {
        if (gone) cardHost.remove();
      }, [gone]);
      return null;
    }
    const view = (gone: boolean, place: Place) => (
      <>
        <Sibling gone={gone} />
        <ChatDialog
          slug="a-piece"
          at={null}
          blocks={new Map([[BLOCK, "a science of bumps"]])}
          target={DRAFT}
          dockRoom={place.dockRoom ?? null}
          card={place.card ?? null}
          reopen={0}
          onJump={() => {}}
          onClose={() => {}}
          onThread={() => {}}
          onOpenFull={() => {}}
          onCreated={() => {}}
          onDropped={() => {}}
          onRenamed={() => {}}
        />
      </>
    );
    act(() => root.render(view(false, inCard())));
    const again = panel().querySelector<HTMLTextAreaElement>("textarea");
    if (!again) throw new Error("the draft has no composer");
    type(again, "half a question");
    again.focus();
    act(() => root.render(view(true, { dockRoom: 272 })));
    expect(rootEl.contains(again)).toBe(true);
    expect(again.value).toBe("half a question");
    expect(document.activeElement).toBe(again);
  });
});

describe("focus, in the card", () => {
  /* Plan § Focus must not scroll the page: a cold `?thread=` with `at=`
     somewhere else must not be dragged to the card by the close button. */
  it("lands on the close control without scrolling the page to it", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    draw(THREAD, inCard());
    expect(document.activeElement).toBe(button("Close"));
    const onClose = focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === button("Close"));
    expect(onClose.length).toBeGreaterThan(0);
    for (const call of onClose) expect(call[0]).toEqual({ preventScroll: true });
  });

  it("gives the keyboard back to the control that opened it, from the card too", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    draw(DRAFT, inCard());
    expect(cardHost.contains(document.activeElement)).toBe(true);
    act(() => root.render(null));
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps the composer's caret under StrictMode, in the card", async () => {
    draw(DRAFT, inCard(), true);
    await Promise.resolve();
    expect(document.activeElement).toBe(panel().querySelector("textarea"));
    expect(cardHost.contains(panel())).toBe(true);
  });

  /* GPT Sol on the plan, F6: the card has no bottom anchor to hold it above a
     keyboard, so the composer asks to be brought into view when it is typed
     in. Whether Safari then does the right thing is the iPad's to say. */
  it("brings the composer into view when it takes focus in the card, and not in the corner", () => {
    const into = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = into;
    try {
      draw(DRAFT, {});
      const box = panel().querySelector<HTMLTextAreaElement>("textarea");
      act(() => {
        box?.blur();
        box?.focus();
      });
      expect(into).not.toHaveBeenCalled();

      draw(DRAFT, inCard());
      into.mockClear();
      act(() => {
        box?.blur();
        box?.focus();
      });
      expect(into).toHaveBeenCalledWith({ block: "nearest" });
      expect(into.mock.contexts[0]).toBe(panel().querySelector("footer"));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  /* The keyboard arriving is a new visible viewport, and Safari can pan it
     (`offsetTop`) without resizing anything. Either is a reason to ask again,
     while the reader is in the composer and not otherwise. */
  it.each([
    ["draft", DRAFT],
    ["thread", THREAD],
  ] as const)("asks again when the visible viewport changes under a focused %s composer", (_kind, target) => {
    const into = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = into;
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 700,
      offsetTop: 0,
      addEventListener: (name: string, l: () => void) => listeners.set(name, l),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("visualViewport", viewport);
    try {
      draw(target, inCard());
      const box = panel().querySelector<HTMLTextAreaElement>("textarea");
      act(() => box?.focus());
      into.mockClear();

      viewport.height = 380;
      act(() => listeners.get("resize")?.());
      expect(into).toHaveBeenCalledTimes(1);
      viewport.offsetTop = 120;
      act(() => listeners.get("scroll")?.());
      expect(into).toHaveBeenCalledTimes(2);

      /* Focus elsewhere: the reader is not typing, and nothing is moved. */
      act(() => button("Close")?.focus());
      into.mockClear();
      viewport.offsetTop = 0;
      act(() => listeners.get("scroll")?.());
      expect(into).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("brings the thread's composer in the conversation body into view on focus", () => {
    const into = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = into;
    try {
      draw(THREAD, inCard());
      const input = panel().querySelector<HTMLTextAreaElement>("textarea.chat-input");
      if (!input) throw new Error("no thread composer");
      expect(input.closest(".chat-dialog-body")).not.toBeNull();
      into.mockClear();
      act(() => input.focus());
      expect(into).toHaveBeenCalledWith({ block: "nearest" });
      expect(into.mock.contexts[0]).toBe(input.closest(".chat-composer"));
      into.mockClear();
      act(() => button("Close")?.focus());
      expect(into).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
