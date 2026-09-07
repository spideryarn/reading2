// @vitest-environment jsdom
/**
 * **One press of Escape closes one surface — the pairs, not the surfaces.**
 *
 * Nine test files in this repo mention Escape and every one of them paints a
 * *single* surface and presses once, so every one of them was green throughout
 * the whole of what this file is about: with two overlays open, one press was
 * closing both, and one of the two it closed was a half-typed annotation.
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md
 * is the audit — 15 surfaces, 18 reachable pairs — and the numbering in the
 * `describe` blocks below is its.
 *
 * ## The five tiers, because every assertion here is about the order they run in
 *
 * | Tier | Who | Target / phase | Stops? |
 * |---|---|---|---|
 * | T0 | the Dock drawer | `window` **capture** | `stopImmediatePropagation` |
 * | T1 | the text boxes | React's root container | some of them |
 * | T2 | Floating UI; `BlockGutter` (`document` bubble); `useHoverCard` (`document` **capture**, so ahead of T1 too) | Floating UI always; the other two **only since this stage** |
 * | T3 | `useEscapeToClose` — Chat, Comment, Annotate | `window` bubble | no |
 * | T4 | a native `<dialog>` | the platform's close request | not a listener at all |
 *
 * `document` bubble is on the path to `window` bubble, so a T2 `stopPropagation`
 * is what stops T3. That is the whole mechanism behind pairs 3–6.
 *
 * ## What this file cannot do, and what stands in for it
 *
 * **jsdom implements no `HTMLDialogElement.showModal`**, and no top layer, and
 * no platform close request — so T4 cannot be driven here at all. What *is*
 * driven is the half this stage builds: the JS tiers asking
 * `document.querySelector("dialog[open]")` and declining. `open` is a real
 * reflected attribute, so an open native dialog is stood in for by a `<dialog>`
 * with `open = true` in the document — exactly the stand-in
 * tests/command-bar.test.tsx already uses for the same query, and the honest
 * limit of it is that the dialog's own closing is the platform's and is asserted
 * nowhere.
 *
 * **jsdom has no layout engine**, so nothing here reads a z-index, a rectangle
 * or a paint order. "Topmost" is expressed in the code as local enablement and
 * is asserted as local enablement.
 *
 * ## The wiring, which is the part a mechanism test cannot see
 *
 * `AnnotateDialog` takes `escapeEnabled` and defaults it to `true`, so every
 * assertion below about Annotate yielding would still pass with `Reader.tsx`
 * never passing the prop at all — the exact shape docs/reusable/silent-success.md
 * collects. The last `describe` reads `Reader.tsx`'s source for it, the way
 * tests/referee-band-fits.test.ts reads `RefereeMode.tsx`, and guards the slice
 * so that a subject which moves fails loudly rather than matching nothing.
 */
import { readFileSync } from "node:fs";

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId, Comment } from "../src/types.js";
import type { ClientComment } from "../src/web/useComments.js";
import { TitleEditor } from "../src/web/TitleEditor.js";

/* `ChatDialog` is the only one of the three that reaches for a server, and
   `useChat` is where it does it. The stand-in is tests/help-sends-once.test.tsx's,
   trimmed to the fields a mounted dialog reads — nothing here sends anything.

   `useProfile` for the same reason: the composer inside `ChatDialog` asks
   whether the reader has one, over a network jsdom has not got. */
vi.mock("../src/web/useProfile.js", () => ({
  useHasProfile: () => false,
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads: [],
    loaded: true,
    loadFailed: false,
    recovering: new Set<string>(),
    send: () => "spya-newthr",
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

const { AnnotateDialog } = await import("../src/web/AnnotateDialog.js");
const { CommentDialog } = await import("../src/web/CommentDialog.js");
const { ChatDialog } = await import("../src/web/ChatDialog.js");
const { BlockGutter } = await import("../src/web/BlockGutter.js");
const { Dock } = await import("../src/web/Dock.js");
const { useHoverCard } = await import("../src/web/useHoverCard.js");
const { HOVER_DELAY } = await import("../src/web/useHoverCard.js");
const { EXPERIMENTAL_OFF } = await import("./helpers/experimental-fixtures.js");

const BLOCK = "spya-k3m9qt" as BlockId;
const DRAFT = "this is the half-typed annotation";

const COMMENT: ClientComment = {
  id: "spya-p7w2dn",
  blockId: BLOCK,
  quote: "a science of bumps",
  start: 0,
  createdAt: "2026-09-05T10:00:00.000Z",
  body: "what is the evidence for this?",
  status: "none",
};

/**
 * Floating UI's `autoUpdate` observes the reference element the moment a card
 * opens, and jsdom has no `ResizeObserver` at all — without this the hook throws
 * on the first open and every assertion about a card is about one that never
 * existed. tests/hover-card-touch.test.tsx carries the same stub.
 */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;
/** Which surfaces asked to be closed on the press under test, in order. */
let closed: string[];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  closed = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState(null, "", "/read/a-piece");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const stray of document.querySelectorAll("dialog")) stray.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function paint(node: ReactNode): void {
  act(() => root.render(node));
}

/**
 * One press, dispatched at an ordinary element in the page.
 *
 * **Not at `document`**, which several existing Escape tests do: an event
 * targeted at `document` has `[document, window]` for its whole path, so a
 * `document`-bubble listener that calls `stopPropagation` is being asked to stop
 * something one hop away rather than the several hops a real press has. The
 * whole subject of pairs 3–6 is that hop, so the press is made where a reader
 * makes it.
 *
 * The three dialogs' own textareas each carry a two-stage Escape of their own
 * (clear the box, then close) on a React `onKeyDown`, and none of them is under
 * test here — the press below targets neither, which is also the case the
 * inventory's F1 describes: clicking a comment mark moves focus out of the
 * annotate box, so the very next press is this one.
 */
function pressEscape(): void {
  const where = document.getElementById("the-prose") ?? document.body;
  act(() => {
    where.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

/** Somewhere in the page for the press to land, and the hover card's prose. */
function Prose() {
  return (
    <p id="the-prose">
      the <mark className="term" data-term="alpha">first term</mark> and some ordinary words
    </p>
  );
}

/* ------------------------------------------------------------------ the three
   modeless dialogs, as one table the pair tests iterate.

   Real components rather than probes calling `useEscapeToClose` directly. A
   probe would prove the hook works and prove nothing about the three callers,
   and two of the three pass an argument this stage invented. */

interface Subject {
  /** The inventory's name for it. */
  name: string;
  /** Rendered behind whatever the pair puts in front of it. */
  node: ReactNode;
  /** The class the surface paints under, so "still there" is not inferred. */
  selector: string;
}

const annotate = (escapeEnabled?: boolean): ReactNode => (
  <AnnotateDialog
    anchor={{ blockId: BLOCK, quote: "a science of bumps", start: 0 }}
    placing={false}
    {...(escapeEnabled === undefined ? {} : { escapeEnabled })}
    onSave={() => {}}
    onCancel={() => closed.push("annotate")}
  />
);

const comment = (): ReactNode => (
  <CommentDialog
    comment={COMMENT}
    position={1}
    total={1}
    hasPrev={false}
    hasNext={false}
    onPrev={() => {}}
    onNext={() => {}}
    onClose={() => closed.push("comment")}
    access={{
      kind: "owner",
      placing: false,
      pending: 0,
      onDelete: () => {},
      onRetry: () => {},
      onDeepen: () => {},
      onDiscuss: () => {},
      onEdit: () => {},
      onPlace: () => {},
      error: null,
    }}
  />
);

const chat = (): ReactNode => (
  <ChatDialog
    slug="a-piece"
    at={null}
    blocks={new Map([[BLOCK, "a science of bumps"]])}
    target={{ kind: "draft", anchor: { blockId: BLOCK }, opening: "a science of bumps" }}
    onJump={() => {}}
    onClose={() => closed.push("chat")}
    onThread={() => {}}
    onOpenFull={() => {}}
    onCreated={() => {}}
    onDropped={() => {}}
  />
);

/** The three, for the pairs that hold against each of them in turn. */
const SUBJECTS: Subject[] = [
  { name: "Annotate", node: annotate(), selector: ".annotate-dialog" },
  { name: "Comment", node: comment(), selector: ".cmt-dialog" },
  { name: "Chat", node: chat(), selector: ".chat-dialog" },
];

/** Put words in the annotate box, the way a reader does. */
function typeTheAnnotation(): HTMLTextAreaElement {
  const box = host.querySelector<HTMLTextAreaElement>(".annotate-dialog textarea");
  expect(box, "no annotate textarea").toBeTruthy();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box as HTMLTextAreaElement, DRAFT);
    (box as HTMLTextAreaElement).dispatchEvent(new Event("input", { bubbles: true }));
  });
  /* Out of the box before the press, which is what a reader who has just clicked
     a comment mark or a hover card has done. With focus still in it and words in
     it, the textarea's own two-stage guard would answer the press instead — a
     different mechanism, tested in its own file. */
  (box as HTMLTextAreaElement).blur();
  return box as HTMLTextAreaElement;
}

/** What the reader can still see in the annotate box, or null if the box is gone. */
const annotationDraft = (): string | null =>
  host.querySelector<HTMLTextAreaElement>(".annotate-dialog textarea")?.value ?? null;

/* ---------------------------------------------------------------- pairs 1 & 2
   the two the plan was written for, and the reason `escapeEnabled` exists. */

describe("pair 1 — Annotate is behind Comment", () => {
  /**
   * The reader selects a passage, which opens Annotate, and then clicks a
   * comment mark inside the same prose — `openCommentDialog` sets `note` and
   * clears nothing, so both are up, both at z-70, Comment painted on top.
   */
  function both(): void {
    paint(
      <>
        <Prose />
        {annotate(false)}
        {comment()}
      </>,
    );
    typeTheAnnotation();
  }

  it("closes the comment and leaves the annotation, draft and all", () => {
    both();
    pressEscape();
    expect(closed).toEqual(["comment"]);
    expect(annotationDraft()).toBe(DRAFT);
  });
});

describe("pair 2 — Annotate is behind the floating chat", () => {
  /**
   * The second door to the same loss, and it is not in the plan's own audit:
   * `chatAboutBlock` and `helpAboutBlock` clear `note` but never `annotating`,
   * so the gutter's chat button over a live selection leaves both up.
   */
  it("closes the chat and leaves the annotation, draft and all", () => {
    paint(
      <>
        <Prose />
        {annotate(false)}
        {chat()}
      </>,
    );
    typeTheAnnotation();
    pressEscape();
    expect(closed).toEqual(["chat"]);
    expect(annotationDraft()).toBe(DRAFT);
  });
});

/* ------------------------------------------------------------- pairs 3, 4, 5
   the prose hover card, which is T2 and stopped nothing until this stage. */

/** The prose, a card over it, and whichever dialog is behind. */
function CardOver({ behind }: { behind: ReactNode }) {
  const { shown, anchorProps } = useHoverCard<{ id: string }>({
    selector: "mark.term",
    read: (el) => {
      const id = el.closest("mark.term")?.getAttribute("data-term");
      return id ? { id } : null;
    },
    tapSelector: "mark.term",
    /* **Both real consumers pass this** — `ProseHoverCard` and `DebatePanel` —
       and it is not inert: it installs the `focusin` listener that closes the
       card when focus leaves for somewhere else. Omitting it here made this
       harness quietly unlike the thing it stands for. GPT Sol, round 2. */
    focusable: true,
  });
  return (
    <>
      <Prose />
      {behind}
      {shown && (
        <div {...anchorProps}>
          <div className="tooltip prose-card hover-card" data-card={shown.data.id}>
            {shown.data.id}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A tap, which opens the card at once rather than after `HOVER_DELAY.open`.
 * The sequence and the two leaving events are tests/hover-card-touch.test.tsx's,
 * which learned them the expensive way — a touch pointer is destroyed at
 * `pointerup`, so `pointerout` and `pointerleave` follow every tap.
 */
function pointer(type: string, target: Element | Document, bubbles = true): void {
  const event = new MouseEvent(type, { bubbles, cancelable: true, clientX: 10, clientY: 10 });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

function tapTheTerm(): void {
  const mark = host.querySelector("mark.term");
  expect(mark, "no term to tap").toBeTruthy();
  act(() => {
    pointer("pointerover", mark as Element);
    pointer("pointerdown", mark as Element);
    pointer("pointerup", mark as Element);
    pointer("pointerout", mark as Element);
    pointer("pointerleave", document, false);
  });
}

const cardIsOpen = (): boolean => document.querySelector("[data-card]") !== null;

describe("pairs 3, 4, 5 — a hover card in front of each of the three dialogs", () => {
  for (const subject of SUBJECTS) {
    it(`closes the card alone, over ${subject.name}`, () => {
      paint(<CardOver behind={subject.node} />);
      if (subject.name === "Annotate") typeTheAnnotation();
      tapTheTerm();
      expect(cardIsOpen(), "the card did not open, so the pair was never posed").toBe(true);

      pressEscape();

      expect(cardIsOpen()).toBe(false);
      expect(closed).toEqual([]);
      expect(host.querySelector(subject.selector)).toBeTruthy();
      if (subject.name === "Annotate") expect(annotationDraft()).toBe(DRAFT);
    });
  }
});

/**
 * **The trap in making the card's stop conditional**, and the reason this test
 * exists rather than being covered by the three above.
 *
 * `shut()` does two things: it drops an open card, and it calls `disarm()`,
 * which cancels a card that is *mid-open-delay*. Writing the conditional as an
 * early return — `if (!currentRef.current) return;` — reads as the same fix and
 * silently drops the second: Escape then cancels nothing, and the card the
 * reader was walking away from opens 320ms later over prose the pointer has
 * left. Nothing else in the suite catches it.
 */
describe("the hover card's Escape still disarms a card that has not opened yet", () => {
  it("cancels the pending open, and does not stop a press it has nothing open for", () => {
    vi.useFakeTimers();
    paint(<CardOver behind={comment()} />);
    const mark = host.querySelector("mark.term") as Element;
    act(() => {
      const over = new MouseEvent("pointerover", { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(over, "pointerType", { value: "mouse" });
      mark.dispatchEvent(over);
    });
    expect(cardIsOpen(), "a mouse hover should not open a card immediately").toBe(false);

    pressEscape();
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY.open + 50);
    });

    expect(cardIsOpen(), "the pending open was not disarmed").toBe(false);
    /* And the other half of the conditional: with nothing shown, the card's
       handler must not have swallowed the press, so the comment behind it heard
       it and closed. A `return` before `shut()` would fail the assertion above;
       an unconditional `stopPropagation` would fail this one. */
    expect(closed).toEqual(["comment"]);
  });
});

/* ------------------------------------------- pair 3, the way a reader reaches it

   Everything above blurs the annotate box before the press, because a reader who
   opened the card by *clicking* has moved the focus themselves. Pair 3 is the one
   that needs no click, and hovering moves no focus at all — so the box is still
   focused and the press lands there first. GPT Sol's P1 on this stage, 2026-09-07:
   the assertions above were true and were being asked in a state a hover does not
   produce. */

describe("pair 3 — the card is opened by hovering, so the annotate box still has focus", () => {
  /**
   * **The press is made in the textarea**, which is where it lands in life:
   * `AnnotateDialog` focuses its box on mount, and nothing about opening a hover
   * card takes that focus away.
   *
   * That box has a two-stage Escape of its own — the first press clears a
   * non-empty draft, the second closes the panel — on a React `onKeyDown`, which
   * is tier T1. React's root container is a *descendant* of `document`, so on the
   * bubble path T1 is reached **before** the card's `document` listener. Until
   * this stage's capture-phase fix, that meant the reader hovered a term, pressed
   * Escape to dismiss the card, and had their half-written annotation wiped
   * instead — with the card left open.
   */
  function pressEscapeInTheAnnotateBox(): void {
    const box = host.querySelector<HTMLTextAreaElement>(".annotate-dialog textarea");
    expect(box, "no annotate textarea").toBeTruthy();
    act(() => {
      (box as HTMLTextAreaElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  }

  it("closes the card, and does not touch the draft under it", () => {
    paint(<CardOver behind={annotate(false)} />);

    /* Typed, and deliberately **not** blurred — the state every other pair in
       this file arranges by hand is the one this pair must not assume. */
    const box = host.querySelector<HTMLTextAreaElement>(".annotate-dialog textarea");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box as HTMLTextAreaElement, DRAFT);
      (box as HTMLTextAreaElement).dispatchEvent(new Event("input", { bubbles: true }));
    });

    tapTheTerm();
    expect(cardIsOpen(), "the card did not open, so the pair was never posed").toBe(true);

    pressEscapeInTheAnnotateBox();

    expect(cardIsOpen(), "the card is still up, so the press went to the box instead").toBe(false);
    expect(closed).toEqual([]);
    expect(annotationDraft(), "the draft was wiped by the textarea's own Escape").toBe(DRAFT);
  });

  /**
   * **The control, and it is what stops the fix being an over-reach.** With no
   * card open, the box's two-stage Escape is still the reader's — pressing
   * Escape in a box with words in it clears the box, which is
   * `AnnotateDialog`'s own documented behaviour and none of this stage's
   * business. A capture listener that stopped every press would take that away,
   * and the assertion above would not notice.
   */
  it("leaves the box's own two-stage Escape alone when no card is open", () => {
    paint(<CardOver behind={annotate(false)} />);
    const box = host.querySelector<HTMLTextAreaElement>(".annotate-dialog textarea");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box as HTMLTextAreaElement, DRAFT);
      (box as HTMLTextAreaElement).dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(cardIsOpen(), "this control needs no card").toBe(false);

    pressEscapeInTheAnnotateBox();

    expect(annotationDraft(), "the box's own first-press clear was swallowed").toBe("");
    expect(closed, "and it must not have closed the panel either").toEqual([]);
  });
});

/* -------------------------------------------------------------------- pair 8
   the third member of T2, which has always stopped. The plan asks for this one
   by name — "a tooltip inside CommentDialog" — and it is the pair the other two
   were measured against, so it is pinned rather than assumed. */

describe("pair 8 — a Floating UI tooltip inside the comment dialog", () => {
  it("closes the tooltip alone", async () => {
    paint(
      <>
        <Prose />
        <CommentDialog
          /* `done` is what draws the web-search badge, whose `tabIndex` exists
             precisely so the tooltip has a keyboard path — `Tooltip.tsx` opens
             on focus (`useFocus`), which is the one door into a Floating UI
             surface that jsdom can open. */
          comment={{ ...COMMENT, status: "done", answer: "because of the bumps" }}
          position={1}
          total={1}
          hasPrev={false}
          hasNext={false}
          onPrev={() => {}}
          onNext={() => {}}
          onClose={() => closed.push("comment")}
          access={{
            kind: "owner",
            placing: false,
            pending: 0,
            onDelete: () => {},
            onRetry: () => {},
            onDeepen: () => {},
            onDiscuss: () => {},
            onEdit: () => {},
            onPlace: () => {},
            error: null,
          }}
        />
      </>,
    );
    const badge = host.querySelector<HTMLElement>(".cmt-search");
    expect(badge, "no web-search badge to point at").toBeTruthy();
    act(() => (badge as HTMLElement).focus());
    expect(
      document.querySelector(".tooltip-anchor"),
      "the tooltip did not open, so the pair was never posed",
    ).toBeTruthy();

    pressEscape();
    /* `useTransitionStyles` keeps the panel in the document for its 80ms fade,
       so "gone" is a question you can only ask after it. Real time rather than
       fake timers: Floating UI's own open path runs on them too, and a harness
       that has to drive both is a harness that can be green for the wrong
       reason. */
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 200));
    });

    expect(document.querySelector(".tooltip-anchor")).toBeNull();
    expect(closed).toEqual([]);
    expect(host.querySelector(".cmt-dialog")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------- pair 6
   the gutter disclosure, the other T2 member that forgot to stop. */

describe("pair 6 — the gutter disclosure in front of each of the three dialogs", () => {
  for (const subject of SUBJECTS) {
    it(`closes the gutter alone, over ${subject.name}`, () => {
      paint(
        <>
          <Prose />
          {subject.node}
          {/* The "…" is drawn only where there is more than one control to
              hide behind it (`controls > 1`), so the gutter is given a note and
              both owner callbacks — which is also the state a reader who has
              just opened one of these three dialogs is in. */}
          <BlockGutter
            id={BLOCK}
            linkBase="/read/a-piece"
            comments={[
              {
                id: "spya-p7w2dn",
                blockId: BLOCK,
                start: 0,
                quote: "a science of bumps",
                createdAt: "2026-09-05T10:00:00.000Z",
                status: "none",
              },
            ]}
            chatCount={0}
            onOpenComment={() => {}}
            onChatAbout={() => {}}
            onHelp={() => {}}
            onJump={() => {}}
            announce={() => {}}
          />
        </>,
      );
      if (subject.name === "Annotate") typeTheAnnotation();
      const more = host.querySelector<HTMLButtonElement>(".blk-more");
      expect(more, "no disclosure to open").toBeTruthy();
      act(() => (more as HTMLButtonElement).click());
      expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(true);

      pressEscape();

      expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(false);
      expect(closed).toEqual([]);
      expect(host.querySelector(subject.selector)).toBeTruthy();
      if (subject.name === "Annotate") expect(annotationDraft()).toBe(DRAFT);
    });
  }
});

/* -------------------------------------------------------------------- pair 7
   the masthead rename, and the only member of tier T1 this file can reach. */

describe("pair 7 — the masthead rename in front of each of the three dialogs", () => {
  /**
   * **The press is made in the input**, not in the prose, because T1 is not a
   * tier you can reach from anywhere: React attaches one listener at its root
   * container and dispatches from the target upwards, so a press in the prose
   * never runs the rename's `onKeyDown` at all. Every other pair in this file
   * presses where a reader presses; so does this one — a reader renaming an
   * article has their cursor in the box.
   *
   * That React listener sits **below** `document`, which is why stopping here
   * also stops T2 and T3: the root container is a descendant of `document`, and
   * a synthetic `stopPropagation` calls the native event's. The rename is the
   * frontmost thing on the screen by the only measure that applies to something
   * with no z-index — the focus is in it — so it owning the press is Q1's rule,
   * not an exception to it.
   */
  function pressEscapeInTheInput(): void {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Title"]');
    expect(input, "no rename input to press in").toBeTruthy();
    act(() => {
      (input as HTMLInputElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  }

  for (const subject of SUBJECTS) {
    it(`cancels the rename alone, over ${subject.name}`, () => {
      paint(
        <>
          <Prose />
          {subject.node}
          <TitleEditor title="A Science of Bumps" onDone={() => closed.push("rename")} />
        </>,
      );
      if (subject.name === "Annotate") typeTheAnnotation();

      pressEscapeInTheInput();

      /* The rename cancels — and nothing behind it hears the press. Before
         2026-09-07 `closed` came back with the dialog's name in it too, and for
         Annotate that was a half-typed annotation thrown away by a reader who
         only meant to stop renaming. */
      expect(closed).toEqual(["rename"]);
      expect(host.querySelector(subject.selector)).toBeTruthy();
      if (subject.name === "Annotate") expect(annotationDraft()).toBe(DRAFT);
    });
  }

  /**
   * **The control**, and it is the half that stops the fix being a silent
   * over-reach. A `stopPropagation` that ran on every press — rather than only
   * on the one the rename actually consumes — would swallow Escape for the whole
   * reader while a title was being edited, and every assertion above would still
   * be green.
   */
  it("lets an ordinary press through while a rename is open", () => {
    paint(
      <>
        <Prose />
        {comment()}
        <TitleEditor title="A Science of Bumps" onDone={() => closed.push("rename")} />
      </>,
    );

    /* In the prose, which is where a reader who has stopped looking at the title
       presses. The rename is untouched; the comment is what closes. */
    pressEscape();

    expect(closed).toEqual(["comment"]);
    expect(host.querySelector('input[aria-label="Title"]'), "the rename cancelled too").toBeTruthy();
  });

  /**
   * **The over-reach the assertion above cannot see.** An unconditional
   * `stopPropagation()` inside the title input would run only for presses *at*
   * the input, and the control above presses at the prose — so it would stay
   * green while every other key a reader needs was being swallowed for as long
   * as a title was open. The press has to be made in the input, and with a key
   * that is not Escape. GPT Sol's P3 on this stage, 2026-09-07.
   */
  it("stops only the Escape, and lets every other key out of the input", () => {
    paint(<TitleEditor title="A Science of Bumps" onDone={() => closed.push("rename")} />);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Title"]');
    expect(input, "no rename input").toBeTruthy();

    /* A listener where the swallowed keys would have been going: `document` is
       both T2's target and on the path to `window`, so one watcher answers for
       every tier behind the input. */
    const heard: string[] = [];
    const watch = (e: Event) => heard.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", watch);
    try {
      act(() => {
        for (const key of ["k", "ArrowDown", "Escape"]) {
          (input as HTMLInputElement).dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          );
        }
      });
    } finally {
      document.removeEventListener("keydown", watch);
    }

    expect(heard, "the input is swallowing keys that are not its own").toEqual(["k", "ArrowDown"]);
    expect(closed, "and the Escape still cancelled the rename").toEqual(["rename"]);
  });
});

/* ---------------------------------------------------------------- pairs 9-11
   the drawer, which has been right since the day it was written. Pinned so it
   stays right — the T0 capture listener is the one thing in this file that was
   not changed by this stage, and it is the one everything else is measured
   against. */

/** The Dock with its drawer already open on the Questions panel. */
function drawer(): ReactNode {
  return (
    <Dock
      slug="a-piece"
      view="article"
      experimental={EXPERIMENTAL_OFF}
      drawer={{
        comments: [] as Comment[],
        loaded: true,
        loadFailed: false,
        panel: "questions",
        onPanel: (next: unknown) => {
          if (next === null) closed.push("drawer");
        },
        onOpenComment: () => {},
      }}
    />
  );
}

describe("pairs 9, 10, 11 — the Dock drawer in front of each of the three dialogs", () => {
  for (const subject of SUBJECTS) {
    it(`closes the drawer alone, over ${subject.name}`, () => {
      paint(
        <>
          <Prose />
          {subject.node}
          {drawer()}
        </>,
      );
      if (subject.name === "Annotate") typeTheAnnotation();

      pressEscape();

      expect(closed).toEqual(["drawer"]);
      expect(host.querySelector(subject.selector)).toBeTruthy();
      if (subject.name === "Annotate") expect(annotationDraft()).toBe(DRAFT);
    });
  }
});

/* --------------------------------------------------------------- pairs 13-15
   a native <dialog>, which no JS tier can outrank and which every JS tier was
   answering anyway. */

/**
 * An open native modal, stood in for by the one thing jsdom does implement.
 *
 * `showModal()` does not exist here and there is no top layer, so what is left
 * is `open`, which is a real reflected attribute — the same stand-in
 * tests/command-bar.test.tsx uses against the very same query. Five `<dialog>`s
 * in `src/web/` can be in this state: the Lightbox, Feedback, Illustrated full,
 * Sketch full and, since 2026-09-07, the command bar.
 */
function openNativeDialog(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.open = true;
  document.body.append(d);
  return d;
}

describe("pairs 13, 14, 15 — an open native <dialog> in front of each of the three dialogs", () => {
  for (const subject of SUBJECTS) {
    it(`leaves ${subject.name} alone`, () => {
      paint(
        <>
          <Prose />
          {subject.node}
        </>,
      );
      if (subject.name === "Annotate") typeTheAnnotation();
      openNativeDialog();

      pressEscape();

      expect(closed).toEqual([]);
      expect(host.querySelector(subject.selector)).toBeTruthy();
      if (subject.name === "Annotate") expect(annotationDraft()).toBe(DRAFT);
    });
  }

  /**
   * Pair 16, and the reason the same query goes in two places. The drawer is
   * T0 — it beats every JS tier by phase — so it is the one surface that has to
   * decline for itself. Reachable exactly as the inventory says: the dock bar
   * sits above the scrim, so Feedback can be pressed with the drawer open.
   */
  it("pair 16 — leaves the Dock drawer alone", () => {
    paint(
      <>
        <Prose />
        {drawer()}
      </>,
    );
    openNativeDialog();

    pressEscape();

    expect(closed).toEqual([]);
  });

  /**
   * And the half that makes the two above mean something: with no native dialog
   * up, the very same press closes each of them. Without this, a
   * `useEscapeToClose` that had simply stopped working would pass every
   * assertion in this describe.
   */
  it("with no dialog open, the same press closes each of them", () => {
    for (const subject of SUBJECTS) {
      closed = [];
      paint(
        <>
          <Prose />
          {subject.node}
        </>,
      );
      pressEscape();
      expect(closed, `${subject.name} did not close`).toHaveLength(1);
    }
    closed = [];
    paint(
      <>
        <Prose />
        {drawer()}
      </>,
    );
    pressEscape();
    expect(closed).toEqual(["drawer"]);
  });
});

/* ------------------------------------------------------------------- pair 17
   the same platform fact, one tier further out. Pairs 13-15 hold it for T3; the
   two T2 members had the identical hole and it went unnoticed until GPT Sol's
   P2 on this stage, 2026-09-07 — the brief scoped the native dialogs against the
   three modeless dialogs and simply did not ask about the card and the gutter.

   Reachable, and not by contrivance: hover a term or open a gutter row, press
   Ctrl-K. The command bar shuts the *drawer* before it opens (Dock.tsx
   § useCommandBarChord) and does nothing about either of these, so both are
   still up when the bar takes the top layer. */

describe("pair 17 — a native <dialog> in front of the two document-tier surfaces", () => {
  it("leaves a hover card standing, because the press was never ours", () => {
    paint(<CardOver behind={null} />);
    tapTheTerm();
    expect(cardIsOpen(), "the card did not open, so the pair was never posed").toBe(true);

    openNativeDialog();
    pressEscape();

    /* The platform closes the dialog — jsdom has no top layer, so that half is
       not observable here and is not asserted. What is observable, and what was
       wrong, is that the card used to go with it. */
    expect(cardIsOpen(), "the card closed on a press that belonged to the dialog").toBe(true);
  });

  it("leaves the gutter disclosure open, for the same reason", () => {
    paint(
      <>
        <Prose />
        <BlockGutter
          id={BLOCK}
          linkBase="/read/a-piece"
          comments={[
            {
              id: "spya-p7w2dn",
              blockId: BLOCK,
              start: 0,
              quote: "a science of bumps",
              createdAt: "2026-09-05T10:00:00.000Z",
              status: "none",
            },
          ]}
          chatCount={0}
          onOpenComment={() => {}}
          onChatAbout={() => {}}
          onHelp={() => {}}
          onJump={() => {}}
          announce={() => {}}
        />
      </>,
    );
    const more = host.querySelector<HTMLButtonElement>(".blk-more");
    expect(more, "no disclosure to open").toBeTruthy();
    act(() => (more as HTMLButtonElement).click());
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(true);

    openNativeDialog();
    pressEscape();

    expect(
      host.querySelector(".blk-gutter")?.hasAttribute("data-open"),
      "the gutter closed on a press that belonged to the dialog",
    ).toBe(true);
  });

  /**
   * **The control**, which is what stops the two above passing because the
   * listeners have simply stopped working. Same two surfaces, same press, no
   * dialog — both must still close.
   */
  it("and with no dialog open, both still close on the press", () => {
    paint(<CardOver behind={null} />);
    tapTheTerm();
    expect(cardIsOpen()).toBe(true);
    pressEscape();
    expect(cardIsOpen(), "the card no longer answers Escape at all").toBe(false);
  });
});

/* ------------------------------------------------------------------- wiring
   what a mechanism test cannot see. */

describe("Reader.tsx hands Annotate the enablement", () => {
  const FILE = "src/web/reader/Reader.tsx";
  const SOURCE = readFileSync(FILE, "utf8");

  /**
   * The whole `<AnnotateDialog … />` element, or null if it is not there in the
   * shape this file knows how to read.
   *
   * **Not "up to the first `>`"**, which was the first spelling and stopped
   * inside the arrow of `onCancel={() =>` — so where in the prop list the
   * enablement happened to be written decided whether the test could see it.
   */
  function annotateElement(): string | null {
    const at = SOURCE.indexOf("<AnnotateDialog");
    if (at === -1) return null;
    const end = SOURCE.indexOf("\n        />", at);
    if (end === -1) return null;
    /* **Comments stripped, and it is not tidiness.** Both a JSX comment and a
       plain block comment can sit in a prop list, and either can contain the
       whole of the thing this file looks for: replacing the real prop with a
       commented-out copy of itself left every assertion below green while
       `Reader` fell back to `true`. GPT Sol proved that mutation rather than
       suggesting it, round 2, 2026-09-07 — and it is the third time on this
       plan that an assertion has been satisfied by prose.
       docs/reusable/silent-success.md. */
    return SOURCE.slice(at, end)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
  }

  /**
   * The guard, and it is not decoration: every assertion below slices a string
   * out of a file, and a slice that stops matching returns `""`, which satisfies
   * nothing and *fails* nothing worth reading. docs/reusable/silent-success.md.
   */
  it("the element is still where this file looks for it", () => {
    const el = annotateElement();
    expect(el, `no <AnnotateDialog …> in ${FILE} — this file's other assertions are vacuous`).not
      .toBeNull();
    expect(el, `<AnnotateDialog> in ${FILE} no longer takes the anchor this file assumes`).toContain(
      "anchor={annotating}",
    );
  });

  /**
   * **The prop defaults to `true`, so its absence here is silent.** Annotate
   * yields to whatever is in front of it, and the two things that can be are
   * `openComment` — the comment dialog's own render condition — and `overlay`,
   * the floating chat's. Both are named, so a change that drops one of the two
   * doors fails here rather than in a reader's half-typed annotation.
   */
  it("passes escapeEnabled, and passes the exact expression", () => {
    const el = annotateElement() ?? "";
    expect(el).toContain("escapeEnabled={");

    /* **The expression itself, whitespace-normalised — not the identifiers in
       it.** Asking only that `openComment` and `overlay` appear somewhere after
       `escapeEnabled={` is satisfied by `openComment || overlay`, by
       `!openComment || !overlay`, and by a literal `false` with the two names
       sitting in a comment beside it.
       The first two are the fix inverted: Annotate would be silenced exactly
       when nothing is in front of it, so Escape would do nothing at all — a
       worse bug than the one this stage fixes, and an invisible one. GPT Sol's
       P2 on this stage, 2026-09-07. */
    const at = el.indexOf("escapeEnabled={");
    const close = el.indexOf("}", at);
    expect(close, "the escapeEnabled prop has no closing brace").toBeGreaterThan(at);
    const expression = el.slice(at + "escapeEnabled={".length, close).replace(/\s+/g, " ").trim();
    expect(expression).toBe("!openComment && !overlay");
  });
});
