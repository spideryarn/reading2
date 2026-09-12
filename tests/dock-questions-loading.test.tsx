// @vitest-environment jsdom
/**
 * **The Questions drawer does not deny the questions before it has looked.**
 *
 * The sibling of tests/chat-list-loading.test.tsx, and the same bug in a second
 * place. Greg hit it in chat mode on a slow connection, 2026-08-27:
 *
 * > it initially told me there were no chats (even though I knew there were)!
 *
 * `useComments` had no way to say it. `comments` was `[]` from the first render
 * and `[]` again once an article with nothing asked about it came back, so the
 * drawer read the first as the second and said *"Nothing marked yet"* to a
 * reader who had asked several things and opened this panel to find them.
 *
 * The last two tests are the ones that stop the fix being "never show the empty
 * state", which would pass the first three on its own.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Comment } from "../src/types.js";
import { Dock } from "../src/web/Dock.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";
import { SLOW_AFTER_MS } from "../src/web/useSlow.js";
import { vi } from "vitest";

/** A comment the reader wrote something on, and never asked the model about. */
const MINE: Comment = {
  id: "cmt-2",
  blockId: "spya-k3m9qt",
  quote: "the sentence he marked",
  start: 0,
  createdAt: "2026-08-27T10:00:00.000Z",
  body: "this is the bit I doubt",
  status: "none",
};

/** A passage marked with nothing written on it. */
const BOOKMARK: Comment = {
  id: "cmt-3",
  blockId: "spya-k3m9qt",
  quote: "a passage worth returning to",
  start: 0,
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "none",
};

/** The gutter's one-press bookmark: the block is the whole anchor. */
const WHOLE_BLOCK: Comment = {
  id: "spya-whole1",
  blockId: "spya-k3m9qt",
  createdAt: "2026-09-12T10:00:00.000Z",
  status: "none",
};

const ASKED: Comment = {
  id: "cmt-1",
  blockId: "spya-k3m9qt",
  quote: "the sentence he asked about",
  start: 0,
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "done",
  answer: "Because of the thing in the paragraph before.",
};

let host: HTMLDivElement;
let root: Root;

/** The bar with its Questions drawer open. */
function paint(
  comments: Comment[],
  loaded: boolean,
  loadFailed = false,
  paragraphs: ReadonlyMap<string, string> = new Map(),
): void {
  act(() => {
    root.render(
      createElement(Dock, {
        slug: "a-piece",
        view: "article" as const,
        /* Off, which is what most readers have. Nothing here is about the
           modes — the drawer is the subject — but the bar cannot be drawn
           without an answer, and this is the ordinary one. */
        experimental: EXPERIMENTAL_OFF,
        drawer: {
          comments,
          paragraphs,
          loaded,
          loadError: loadFailed ? "Couldn't reach the server. [net-down]" : null,
          /* **`null` even when the load failed**, because that is what the real
             hook hands over: since 2026-09-11 a failed load goes in
             `loadError`, and `error` is only a refused write (useComments.ts).
             Until then the two moved together and this fixture set both — GPT
             Sol, 2026-09-08. A refused write has its own file,
             tests/a-failed-comment-write-is-said-on-the-dock.test.tsx. */
          error: null,
          panel: "questions" as const,
          onPanel: () => {},
          onOpenComment: () => {},
        },
      }),
    );
  });
}

/** Past the threshold at which a wait is worth mentioning. useSlow.ts. */
function waitOutTheFlickerWindow(): void {
  act(() => {
    vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the questions drawer while the fetch is out", () => {
  it("does not claim the reader has asked nothing", () => {
    paint([], false);
    waitOutTheFlickerWindow();
    expect(host.textContent).not.toContain("Nothing marked yet");
  });

  it("says what it is waiting for, once the wait is worth mentioning", () => {
    paint([], false);
    expect(host.querySelector(".cmt-spinner")).toBeNull();
    waitOutTheFlickerWindow();
    expect(host.querySelector(".cmt-spinner")).not.toBeNull();
    expect(host.textContent).toContain("Fetching your comments");
  });

  /* Under 600ms the content simply appears. A spinner that flashes and vanishes
     reads as breakage, which is the failure this whole rule replaces rather
     than a second copy of it — useSlow.ts. */
  it("draws nothing at all for a fetch that beats the threshold", () => {
    paint([], false);
    expect(host.querySelector(".cmt-spinner")).toBeNull();
    expect(host.textContent).not.toContain("Nothing marked yet");
  });

  it("says it plainly once the fetch has landed on nothing", () => {
    paint([], true);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("Nothing marked yet");
    expect(host.querySelector(".cmt-spinner")).toBeNull();
  });

  /* The state one beat later, and the one the first version of this fix walked
     straight into: `loaded` means "we have asked", so a request that gave up
     dropped out of the spinner and into the same denial. The transport error is
     printed in the reading view's status line, which is behind this drawer's
     scrim — so there is nowhere else the reader could learn why. */
  it("does not turn a failed fetch into an empty shelf of questions", () => {
    paint([], true, true);
    waitOutTheFlickerWindow();
    expect(host.textContent).not.toContain("Nothing marked yet");
    expect(host.textContent).toContain("Couldn't load your comments");
  });

  it("draws the questions it has, rather than a spinner over them", () => {
    paint([ASKED], true);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("the sentence he asked about");
    expect(host.querySelector(".cmt-spinner")).toBeNull();
  });

  /* **A comment's own words are what the reader is scanning for.** The list
     showed only the sentence a comment was *about*, so it told you where you
     had stopped and not what you had thought — and next to an AI answer, which
     does preview, the row read as broken. Found in the browser pass,
     2026-08-28. */
  it("previews what the reader wrote, not just the sentence it was about", () => {
    paint([MINE], true);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("this is the bit I doubt");
    expect(host.querySelector(".dock-question-state.own")).not.toBeNull();
  });

  it("shows the reader's words even on one the model also answered", () => {
    // The body wins: they made the mark and wrote the note, and the answer is
    // the thing they can open.
    paint([{ ...ASKED, body: "my own note" }], true);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("my own note");
    expect(host.textContent).not.toContain("Because of the thing");
  });

  it("gives a bare bookmark no second line rather than an empty one", () => {
    // There is genuinely nothing to preview — the quote is the whole of it —
    // and an empty line would read as a preview that failed to load.
    paint([BOOKMARK], true);
    waitOutTheFlickerWindow();
    expect(host.textContent).toContain("a passage worth returning to");
    expect(host.querySelector(".dock-question-state")).toBeNull();
  });

  it("names a whole paragraph and shows its opening words", () => {
    paint(
      [WHOLE_BLOCK],
      true,
      false,
      new Map([[WHOLE_BLOCK.blockId, "The opening words that distinguish this paragraph from another."]]),
    );
    waitOutTheFlickerWindow();
    expect(host.querySelector(".dock-question-quote")?.textContent).toBe(
      "Whole paragraph — The opening words that distinguish this paragraph from another.",
    );
  });
});
