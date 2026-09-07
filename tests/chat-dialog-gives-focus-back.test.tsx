// @vitest-environment jsdom
/**
 * **Closing the chat panel gives the keyboard back.**
 *
 * `ChatDialog`'s draft arm focuses its composer on mount (`focusNonce={1}`), so
 * closing it unmounts the element the reader is standing on and focus falls to
 * `<body>` — the next Tab then starts again from the top of the article.
 * Invisible with a mouse, which is why nothing had noticed.
 *
 * Stage 5a of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md,
 * from GPT Sol's F42. It is the same modeless lifecycle `CommentDialog` and the
 * Dock drawer already have; what makes it worth its own file is that **the
 * opener is always gone by the time it is wanted**, which is the branch those
 * two only ever reach by accident.
 *
 * ## Why the fallback is the passage's own "…"
 *
 * A chat draft is opened from the block gutter's Help button, and that handler
 * calls `setOpen(false)` **before** `onHelp(id)` — the disclosure collapses and
 * takes the pressed button with it (`BlockGutter.tsx` § the help button). So
 * `isConnected` is false on every ordinary path, not on an edge case.
 *
 * There is no Chat button in the dock to fall back to instead: its labels are
 * Commands, Comments, Metadata, Tweets and Spideryarn, and Chat is a *mode* in
 * the radiogroup. Falling back to a mode switch would put the reader somewhere
 * they had never been. The row's `.blk-more` is where they actually were, it is
 * rendered whether or not the disclosure is open, and it is where `BlockGutter`
 * puts focus itself when Escape closes it.
 *
 * ## What is deliberately NOT here: AnnotateDialog
 *
 * Sol's F42 named Annotate alongside Chat, and Annotate is **not** fixed,
 * because there is no loss to fix. It is reachable only through `onMouseUp`
 * after a drag across the prose (`TableView.tsx`), and a drag across
 * non-focusable text has already blurred whatever was focused — measured in real
 * Chrome, 2026-09-07: focus goes from a button to `BODY` during the drag. So
 * Annotate opens from `<body>` and returns to `<body>`, and adding a restore
 * would be machinery for a defect no reader can reach. The asymmetry is the
 * finding, not an omission.
 */
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId } from "../src/types.js";

/* The same stand-ins tests/one-escape-closes-one-surface.test.tsx uses, and for
   the same reason: a mounted dialog reads a profile and a thread list over a
   network jsdom has not got. Nothing here sends anything. */
vi.mock("../src/web/useProfile.js", () => ({
  useHasProfile: () => false,
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
/**
 * A conversation the stand-in already has, so the `thread` arm renders its own
 * composer. With `threads: []` it renders a still-arriving placeholder instead,
 * and a test about where the caret goes would have had nowhere for it to go —
 * which is how the first version of the hand-over test failed, usefully.
 */
const EXISTING = {
  id: "spya-oldthr",
  kind: "chat" as const,
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [],
};

vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads: [EXISTING],
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

const { ChatDialog } = await import("../src/web/ChatDialog.js");

const BLOCK = "spya-k3m9qt" as BlockId;

const DRAFT = {
  kind: "draft",
  anchor: { blockId: BLOCK },
  opening: "a science of bumps",
} as const;
/** The `?thread=` route: a conversation the reader already had, reopened. */
const THREAD = { kind: "thread", threadId: "spya-oldthr" } as const;

let host: HTMLDivElement;
let root: Root;

/**
 * A slice of the article shaped the way the reader's actually is: a row that
 * carries its block id, a gutter "…" that stays whatever the disclosure does,
 * and a Help button that is inside the disclosure and therefore removable.
 *
 * A `<table>` because `.closest("tr[data-block]")` is what the fix asks, and a
 * `<tr>` outside a table is not a row the browser will build.
 */
function article(): { help: HTMLButtonElement; more: HTMLButtonElement } {
  const table = document.createElement("table");
  table.innerHTML = `<tbody><tr data-block="${BLOCK}"><td>
      <div class="blk-gutter">
        <button type="button" class="blk-more">…</button>
        <button type="button" class="blk-help">?</button>
      </div>
    </td></tr></tbody>`;
  document.body.append(table);
  const help = table.querySelector<HTMLButtonElement>(".blk-help");
  const more = table.querySelector<HTMLButtonElement>(".blk-more");
  if (!help || !more) throw new Error("fixture did not build");
  return { help, more };
}

function mount(target: Parameters<typeof ChatDialog>[0]["target"] = DRAFT) {
  act(() =>
    root.render(
      <ChatDialog
        slug="a-piece"
        at={null}
        blocks={new Map([[BLOCK, "a science of bumps"]])}
        target={target}
        onJump={() => {}}
        onClose={() => {}}
        onThread={() => {}}
        onOpenFull={() => {}}
        onCreated={() => {}}
        onDropped={() => {}}
      />,
    ),
  );
}

/**
 * Close the panel and let the restore land.
 *
 * The restore is deferred by one microtask on purpose — see `ChatDialog.tsx`
 * § deferred, because a cleanup is not proof of an unmount. So a test that
 * asserted immediately after `unmount()` would be asking before the answer
 * exists, and would go green again the day the deferral was removed for the
 * wrong reason.
 */
async function close() {
  act(() => root.unmount());
  await Promise.resolve();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("table").forEach((t) => t.remove());
});

describe("closing the chat panel gives the keyboard back", () => {
  it("returns focus to the control that opened it, when that control is still there", async () => {
    const { more } = article();
    more.focus();
    expect(document.activeElement).toBe(more);

    mount();
    await close();

    expect(document.activeElement).toBe(more);
  });

  /** The ordinary path, not the edge case: Help closes the disclosure it lives in. */
  it("falls back to the passage's own gutter button when the opener has been unmounted", async () => {
    const { help, more } = article();
    help.focus();

    mount();
    /* What `BlockGutter`'s help handler does: `setOpen(false)` collapses the
       disclosure and the pressed button goes with it. */
    help.remove();
    await close();

    expect(document.activeElement).toBe(more);
  });

  /**
   * The other half of the contract, and the reason this is an `activeElement`
   * test rather than an unconditional `focus()`: a reader who has already gone
   * somewhere real must be left there. `EditableTitle` makes the same
   * distinction for the same reason, TitleEditor.tsx § the pencil and the input
   * swap.
   */
  it("leaves focus alone when it had already gone somewhere real", async () => {
    const { help } = article();
    help.focus();
    mount();

    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    await close();

    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("does nothing at all when there was nowhere to go back to", () => {
    /* No opener, no row: closing must not throw, and must not invent a
       destination. */
    mount();
    expect(() => act(() => root.unmount())).not.toThrow();
  });
});

/**
 * ## Opening an existing conversation lands the keyboard somewhere
 *
 * The `draft` arm focuses its composer; the `thread` arm passed `focusNonce={0}`
 * and focused **nothing**, so arriving at `?thread=` left the reader wherever
 * they had been. GPT Sol's F44.
 *
 * **The composer is deliberately not the target here.** Greg, 2026-08-26: *"when
 * a new chat is started, move focus to the input box"* — and `ChatPanel` records
 * that this is *"the only time it is right"*, because a focused textarea turns
 * ↑ / ↓ from "step through the article" into "move the cursor"
 * (docs/project/keyboard.md). Reopening an old conversation is not starting a
 * new one, so the target is the close control: present in every state this
 * dialog can open in, already a tab stop, already the way out, and what
 * `CommentDialog` does.
 */
describe("opening an existing conversation", () => {
  it("puts the keyboard on the close control", () => {
    mount(THREAD);
    expect(document.activeElement).toBe(host.querySelector(".chat-dialog-close"));
  });

  it("leaves the draft arm's composer alone, which is Greg's decision and not this fix's business", () => {
    mount(DRAFT);
    expect(document.activeElement).not.toBe(host.querySelector(".chat-dialog-close"));
  });

  /**
   * **The regression this could most easily have caused.** `target` changes
   * under a mounted dialog — a draft becomes a thread the moment the first
   * question is sent — and anything keyed on the *current* kind would fire then,
   * moving focus the instant the reader pressed Enter. The arm is frozen at
   * mount for exactly this, and the assertion is about the close control rather
   * than about where focus ends up.
   *
   * **Where it does end up is `<body>`, and that is a separate, unfixed gap.**
   * The draft arm's composer is *unmounted* by the swap, so the reader loses the
   * caret whatever this effect does — GPT Sol noticed the same thing ("Chat also
   * loses focused content when draft becomes thread, before the dialog itself
   * closes"). The first version of this test asserted the composer kept focus
   * and went red, which is how the gap got looked at rather than assumed away.
   * Written down here rather than quietly fixed: the right destination is the
   * thread's own composer, and choosing it changes what happens after you press
   * Enter, which is not this stage's to decide. Recorded in stage 5a step 4.
   */
  it("does not grab the caret for the close control when a draft turns into a thread", () => {
    mount(DRAFT);
    const composer = host.querySelector("textarea");
    if (!composer) throw new Error("no composer");
    composer.focus();

    mount(THREAD); // same root, same mounted component, new target prop

    expect(document.activeElement).not.toBe(host.querySelector(".chat-dialog-close"));
  });

  /**
   * **Sending the first question does not cost the reader the caret.** The
   * draft arm's composer is unmounted by the swap, so before this the reader
   * pressed Enter and landed on `<body>` with the panel still open in front of
   * them. Recorded as a known gap first and left alone; GPT Sol's stage-5a
   * review said that was the wrong call, and it was — moving focus to the
   * composer's *replacement* preserves an interaction the reader was already in,
   * rather than applying the "focus every reopened thread" policy that Greg's
   * 2026-08-26 decision rules out.
   */
  it("hands the caret to the thread's own composer when the reader was typing in the draft's", () => {
    mount(DRAFT);
    const draftComposer = host.querySelector("textarea");
    if (!draftComposer) throw new Error("no composer");
    draftComposer.focus();

    mount(THREAD);

    const after = host.querySelector("textarea");
    expect(after).not.toBeNull();
    expect(document.activeElement).toBe(after);
  });

  /** The condition is "was already typing", not "a swap happened". */
  it("leaves focus alone across the same swap when the reader was not typing", () => {
    const { more } = article();
    mount(DRAFT);
    more.focus();

    mount(THREAD);

    expect(document.activeElement).toBe(more);
  });
});

/**
 * ## Under StrictMode, which is what the app actually runs
 *
 * `main.tsx` wraps the whole reader in `<StrictMode>`, and StrictMode runs every
 * effect **setup → cleanup → setup** on mount. So the restore cleanup above
 * fires once while the dialog is still perfectly well mounted, and if that put
 * focus back on the opener, the composer would be left un-focused for a reader
 * who had just pressed Help — a regression introduced *by the fix*, invisible to
 * every test that does not use StrictMode.
 *
 * GPT Sol raised it on the stage-5a review. This is the test that says whether
 * it is real.
 */
describe("under StrictMode, which is what the app actually runs", () => {
  it("still leaves the draft composer holding the keyboard", async () => {
    const { help } = article();
    help.focus();
    act(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(ChatDialog, {
            slug: "a-piece",
            at: null,
            blocks: new Map([[BLOCK, "a science of bumps"]]),
            target: DRAFT,
            onJump: () => {},
            onClose: () => {},
            onThread: () => {},
            onOpenFull: () => {},
            onCreated: () => {},
            onDropped: () => {},
          }),
        ),
      ),
    );
    /* **The await is not decoration.** The restore is deferred by a microtask, so
       asserting synchronously here would pass whether the fix worked or not —
       which it did, until a mutation refused to redden and said so. */
    await Promise.resolve();
    expect(document.activeElement).toBe(host.querySelector("textarea"));
  });
});
