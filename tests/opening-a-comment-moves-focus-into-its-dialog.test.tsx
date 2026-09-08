// @vitest-environment jsdom
/**
 * **Opening a saved comment is the fifth close path, and it was the one that
 * dropped the reader.**
 *
 * tests/the-dock-drawer-is-not-a-modal.test.tsx covers the four ways the drawer
 * shuts with nothing else happening — Escape, the scrim, the ×, the same tab
 * again — and every one of them hands focus back to the control that opened it.
 * This is the fifth: pressing a `.dock-question` closes the drawer *and* opens
 * `CommentDialog` in the same interaction (App.tsx § `onOpenComment`), so the
 * Dock's cleanup fires while a new dialog is arriving.
 *
 * Without the dialog's own focus lifecycle the reader is left holding the
 * Comments **tab** — focus goes back to the bar, the dialog that just opened
 * has none, and because the dialog precedes the Dock in DOM order the next Tab
 * carries on through the bar rather than into the thing they just chose. That
 * is not a regression the drawer's focus work introduced: before it, focus had
 * never left the tab either. Moving focus properly is what made the gap
 * visible. GPT Sol, F19 on the Stage 2 review.
 *
 * The fix is the same modeless-dialog lifecycle the drawer has, and it works
 * because React flushes the whole commit's passive **cleanups** before its
 * passive **setups**: the Dock puts focus back on the Comments button first, so
 * the dialog mounting a moment later records *that* button as its opener —
 * stable, still connected, and exactly where the reader should end up when they
 * close the dialog again.
 *
 * jsdom performs no default action for Enter and does not focus what a click
 * lands on, so both are spelled out here, the same way the sibling file does it.
 */
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommentDialog } from "../src/web/CommentDialog.js";
import { Dock } from "../src/web/Dock.js";
import type { Panel } from "../src/web/params.js";
import type { ClientComment } from "../src/web/useComments.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

const COMMENT: ClientComment = {
  id: "spya-p7w2dn",
  blockId: "spya-k3m9qt",
  quote: "a science of bumps",
  start: 0,
  createdAt: "2026-09-05T10:00:00.000Z",
  body: "what is the evidence for this?",
  status: "none",
};

/** A second mark further down the piece, for the swap the drawer can make. */
const OTHER: ClientComment = {
  id: "spya-r4x8bt",
  blockId: "spya-q2n5vc",
  quote: "the phrenology of institutions",
  start: 0,
  createdAt: "2026-09-05T10:05:00.000Z",
  body: "whose institutions?",
  status: "none",
};

let host: HTMLDivElement;
let root: Root;

/**
 * The bar, one saved comment in its drawer, and the dialog that comment opens —
 * wired the way `App` wires them, including the DOM order: the dialog is
 * rendered *before* the Dock, which is why a reader left on the bar tabs away
 * from the dialog rather than into it.
 */
function Harness() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      {openId !== null && (
        <CommentDialog
          comment={COMMENT}
          position={1}
          total={1}
          hasPrev={false}
          hasNext={false}
          onPrev={() => {}}
          onNext={() => {}}
          onClose={() => setOpenId(null)}
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
      )}
      <Dock
        slug="a-piece"
        view="article"
        experimental={EXPERIMENTAL_OFF}
        drawer={{
          comments: [COMMENT],
          loaded: true,
          loadFailed: false,
          error: null, // nothing has failed to save; this file is about focus
          panel,
          onPanel: setPanel,
          /* App.tsx's own closure: shut the drawer on the way through, or the
             dialog opens underneath the dim. */
          onOpenComment: (id) => {
            setPanel(null);
            setOpenId(id);
          },
        }}
      />
    </>
  );
}

function paint(): void {
  act(() => {
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
}

const tab = () => host.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]');
const question = () => host.querySelector<HTMLButtonElement>(".dock-question");
const dialog = () => host.querySelector<HTMLElement>(".cmt-dialog");
const dialogClose = () => host.querySelector<HTMLButtonElement>(".cmt-close");
const drawer = () => host.querySelector<HTMLElement>(".dock-drawer");

function must<T>(el: T | null | undefined, what: string): T {
  expect(el, `no ${what}`).toBeTruthy();
  return el as T;
}

/** Focus the tab, press Enter, let the default action fire the click. */
function openDrawerWithEnter(): HTMLButtonElement {
  const opener = must(tab(), "Comments tab");
  opener.focus();
  act(() => {
    opener.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  act(() => opener.click());
  return opener;
}

/** Tab to the row and press it — the keyboard path into a saved comment. */
function activateTheQuestion(): void {
  const row = must(question(), "comment row");
  row.focus();
  act(() => {
    row.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  act(() => row.click());
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("choosing a comment out of the drawer", () => {
  it("puts focus in the dialog that opens, not back on the bar", () => {
    paint();
    openDrawerWithEnter();
    expect(document.activeElement, "the drawer never took focus").toBe(
      host.querySelector(".dock-close"),
    );

    activateTheQuestion();

    expect(drawer(), "the drawer stayed open over its own dialog").toBeNull();
    const d = must(dialog(), "comment dialog");
    expect(d.contains(document.activeElement), "focus is outside the dialog that just opened").toBe(
      true,
    );
    expect(document.activeElement).toBe(dialogClose());
  });

  it("hands focus back to the Comments button when the dialog closes", () => {
    paint();
    const opener = openDrawerWithEnter();
    activateTheQuestion();
    expect(document.activeElement).toBe(dialogClose());

    /* A pointer click focuses what it lands on in a browser; jsdom does not, so
       say so, or the assertion below passes over a dialog that never held
       focus. */
    const close = must(dialogClose(), "dialog close button");
    close.focus();
    act(() => {
      close.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
    });

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

/**
 * **The gutter, the drawer, the dialog and the bar, all at once.**
 *
 * The harness above opens the dialog one way only. The two sequences below need
 * the other opener — the mark beside a commented block — and they need the
 * comment list to be able to *change* under the dialog, because that is exactly
 * what the two gaps are about:
 *
 * - selecting another comment in the drawer swaps `comment` on a dialog that
 *   stays mounted (App.tsx renders it without a `key`), and
 * - deleting the last comment takes the dialog and the gutter mark that opened
 *   it away in the same commit.
 *
 * **Neither is a regression.** Before this job nothing moved focus at all, so
 * the end state of both sequences was the same as it is here; doing focus
 * properly is what made the gaps reachable and worth closing. GPT Sol, F23 and
 * F24 on the second Stage 2 review, 2026-09-06.
 */
function GutterHarness({ initial }: { initial: ClientComment[] }) {
  const [comments, setComments] = useState<ClientComment[]>(initial);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const at = comments.findIndex((c) => c.id === openId);
  const shown = at >= 0 ? comments[at] : undefined;
  return (
    <>
      {/* The marks beside the prose. Rendered from the same list, so deleting a
          comment removes its opener in the same commit the dialog goes. */}
      {comments.map((c) => (
        <button key={c.id} type="button" data-gutter={c.id} onClick={() => setOpenId(c.id)}>
          Bookmark
        </button>
      ))}
      {shown && (
        <CommentDialog
          comment={shown}
          position={at + 1}
          total={comments.length}
          hasPrev={at > 0}
          hasNext={at < comments.length - 1}
          onPrev={() => {}}
          onNext={() => {}}
          onClose={() => setOpenId(null)}
          access={{
            kind: "owner",
            placing: false,
            pending: 0,
            /* App.tsx's own optimistic delete: the row goes and `?note=` clears
               in one commit. */
            onDelete: () => {
              setComments((cs) => cs.filter((c) => c.id !== shown.id));
              setOpenId(null);
            },
            onRetry: () => {},
            onDeepen: () => {},
            onDiscuss: () => {},
            onEdit: () => {},
            onPlace: () => {},
            error: null,
          }}
        />
      )}
      <Dock
        slug="a-piece"
        view="article"
        experimental={EXPERIMENTAL_OFF}
        drawer={{
          comments,
          loaded: true,
          loadFailed: false,
          error: null, // nothing has failed to save; this file is about focus
          panel,
          onPanel: setPanel,
          onOpenComment: (id) => {
            setPanel(null);
            setOpenId(id);
          },
        }}
      />
    </>
  );
}

function paintGutter(initial: ClientComment[]): void {
  act(() => {
    root.render(
      <StrictMode>
        <GutterHarness initial={initial} />
      </StrictMode>,
    );
  });
}

/** Press the mark beside a block, the way a pointer does — focus, then click. */
function openFromGutter(id: string): HTMLButtonElement {
  const mark = must(host.querySelector<HTMLButtonElement>(gutterFor(id)), "gutter mark");
  mark.focus();
  act(() => mark.click());
  return mark;
}

const gutterFor = (id: string) => `[data-gutter="${id}"]`;

/** A click that focuses what it lands on, which jsdom will not do by itself. */
function pressWithPointer(el: HTMLElement): void {
  el.focus();
  act(() => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

describe("swapping the dialog's comment from the drawer", () => {
  it("moves focus into the newly chosen comment, and back to Comments on close", () => {
    paintGutter([COMMENT, OTHER]);

    /* Comment A, opened from the gutter: the dialog takes focus and remembers
       the mark as its opener. */
    openFromGutter(COMMENT.id);
    expect(document.activeElement, "the dialog never took focus").toBe(dialogClose());

    const bar = openDrawerWithEnter();
    const rows = host.querySelectorAll<HTMLButtonElement>(".dock-question");
    expect(rows.length, "both comments should be listed").toBe(2);
    pressWithPointer(must(rows[1], "the second comment row"));

    /* The dialog is the same element — no `key`, so React kept it — but it is
       showing B now, and focus must have followed. */
    const d = must(dialog(), "comment dialog");
    expect(d.querySelector(".cmt-quote")?.textContent).toBe(OTHER.quote);
    expect(d.contains(document.activeElement), "focus stayed outside the comment just chosen").toBe(
      true,
    );
    expect(document.activeElement).toBe(dialogClose());

    /* And the remembered opener is the Comments button the drawer handed back
       to, not the gutter mark that opened A. */
    pressWithPointer(must(dialogClose(), "dialog close button"));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(bar);
  });
});

describe("deleting the comment the gutter opened", () => {
  it("falls back to the Comments button when the mark goes with it", () => {
    paintGutter([COMMENT]);

    openFromGutter(COMMENT.id);
    expect(document.activeElement).toBe(dialogClose());

    pressWithPointer(must(host.querySelector<HTMLButtonElement>(".cmt-delete"), "Delete button"));

    expect(dialog(), "the dialog outlived its comment").toBeNull();
    expect(
      host.querySelector(gutterFor(COMMENT.id)),
      "the gutter mark outlived its comment",
    ).toBeNull();
    expect(document.activeElement, "the reader was dropped on <body>").toBe(tab());
  });
});
