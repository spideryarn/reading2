// @vitest-environment jsdom
/**
 * What the prose gutter actually does when it is clicked — src/web/BlockGutter.tsx.
 *
 * The two pure helpers under it have their own tests (block-ref.test.ts,
 * comment-nav.test.ts) and **they were not enough**, which is the reason this
 * file exists. GPT Sol, reviewing the built code on 2026-08-31:
 *
 * > An implementation that always copied, copied on modified clicks, opened the
 * > last comment, used an optimistic tick, threw without Clipboard API support,
 * > or rendered no live region would pass.
 *
 * Every one of those is a test below. What is *not* here is geometry — target
 * sizes, the overhang, and the `(hover: none)` rules — because jsdom computes no
 * layout and would answer those questions with plausible zeroes. Those were
 * measured in a real browser and the numbers are in
 * docs/plans/prose-gutter-icons.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockGutter } from "../src/web/BlockGutter.js";
import type { BlockId, Comment } from "../src/types.js";

const ID = "spya-k3m9qt" as BlockId;

function comment(id: string, start: number, blockId = ID): Comment {
  return { id, blockId, start, quote: "q", createdAt: "2026-08-30T09:00:00Z", status: "none" };
}

let host: HTMLDivElement;
let root: Root;
let jumped: BlockId[];
let opened: string[];
let said: string[];
let chatted: BlockId[];
let helped: BlockId[];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  jumped = [];
  opened = [];
  said = [];
  chatted = [];
  helped = [];
  window.history.replaceState(null, "", "/read/example");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
  vi.useRealTimers();
});

/**
 * `slots` is how a visitor is painted: **absent callbacks**, not flags. The
 * component decides what to draw from the handlers it was given and there is no
 * second switch, so a test that lied about which is which would be testing a
 * component this file does not have.
 */
function paint(
  comments?: Comment[],
  chatCount = 0,
  slots: { chat?: boolean; help?: boolean; bookmark?: (id: BlockId) => Promise<boolean> } = {},
): void {
  const { chat = true, help = true, bookmark } = slots;
  act(() => {
    root.render(
      <BlockGutter
        id={ID}
        linkBase="/read/example"
        {...(comments ? { comments } : {})}
        chatCount={chatCount}
        onOpenComment={(id) => opened.push(id)}
        {...(chat ? { onChatAbout: (id: BlockId) => chatted.push(id) } : {})}
        {...(help ? { onHelp: (id: BlockId) => helped.push(id) } : {})}
        {...(bookmark ? { onBookmark: bookmark } : {})}
        onJump={(id) => jumped.push(id)}
        announce={(s) => said.push(s)}
      />,
    );
  });
}

/** A writable clipboard whose promise this test controls. */
function clipboard(writeText: (t: string) => Promise<void>): string[] {
  const wrote: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        wrote.push(t);
        return writeText(t);
      },
    },
  });
  return wrote;
}

const link = () => host.querySelector("a.blk-permalink") as HTMLAnchorElement;
const icon = () => link().querySelector("svg")?.getAttribute("class") ?? "";

/**
 * A click as a pointer makes one. `detail: 1` is the click count, and it is the
 * fallback the component reads because jsdom's `MouseEvent` has no
 * `pointerType`; a real browser supplies one and the browser checks confirmed
 * both arrive as expected.
 */
function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

/** Let a resolved/rejected clipboard promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the permalink", () => {
  it("copies the ABSOLUTE url, not the href's path", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    // The href is a path, which is right for an anchor and useless pasted into
    // a message to somebody else.
    expect(link().getAttribute("href")).toBe("/read/example?at=spya-k3m9qt");
    click(link());
    await settle();
    expect(wrote).toEqual([`${location.origin}/read/example?at=spya-k3m9qt`]);
    expect(jumped).toEqual([]);
  });

  it("shows the tick only AFTER the promise resolves", async () => {
    let release!: () => void;
    clipboard(() => new Promise<void>((r) => { release = r; }));
    paint();
    click(link());
    // The whole point: mid-flight the icon must not be claiming success.
    expect(icon()).toContain("link");
    expect(said).toEqual([]);
    await act(async () => { release(); await Promise.resolve(); });
    expect(icon()).toContain("check");
    expect(said).toEqual(["Copied the link to k3m9qt."]);
  });

  it("says so when the write is refused, and does NOT jump", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    paint();
    click(link());
    await settle();
    expect(icon()).toContain("triangle-alert");
    expect(said).toEqual(["Couldn't copy the link to k3m9qt."]);
    // It used to jump here. A rejection can arrive seconds later, after the
    // reader has moved on, and a scroll out of nowhere is worse than a failure
    // that says it failed.
    expect(jumped).toEqual([]);
  });

  it("does not throw when there is no clipboard object at all", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    paint();
    expect(() => click(link())).not.toThrow();
    await settle();
    expect(icon()).toContain("triangle-alert");
  });

  it("jumps rather than copying when it was not a pointer that activated it", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    // `detail: 0` is how a click generated by Enter on a link arrives. The
    // element announces itself as a link, so this has to behave like one.
    const e = click(link(), { detail: 0 });
    await settle();
    expect(wrote).toEqual([]);
    expect(jumped).toEqual([ID]);
    // And it must cancel the browser's own navigation, which would reload the
    // whole reading view — nothing intercepts anchor clicks in this app.
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves every modified click to the browser", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      const e = click(link(), mod);
      expect(e.defaultPrevented).toBe(false);
    }
    await settle();
    expect(wrote).toEqual([]);
    expect(jumped).toEqual([]);
  });

  it("ignores a stale result that lands after a newer one", async () => {
    // Two presses; the FIRST write settles last. Without the operation token
    // the older result overwrites the newer tick with its own.
    const settlers: Array<(ok: boolean) => void> = [];
    clipboard(
      () => new Promise<void>((res, rej) => settlers.push((ok) => (ok ? res() : rej(new Error("no"))))),
    );
    paint();
    click(link());
    click(link());
    await act(async () => {
      settlers[1]?.(true); // the newer one succeeds
      await Promise.resolve();
    });
    expect(icon()).toContain("check");
    await act(async () => {
      settlers[0]?.(false); // the older one fails, late
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(icon()).toContain("check");
    expect(said).toEqual(["Copied the link to k3m9qt."]);
  });

  it("says nothing once it has been unmounted mid-flight", async () => {
    let release!: () => void;
    clipboard(() => new Promise<void>((r) => { release = r; }));
    paint();
    click(link());
    act(() => root.unmount());
    await act(async () => { release(); await Promise.resolve(); });
    // The continuation is still live; it must not announce, and it must not set
    // state on a component that has gone.
    expect(said).toEqual([]);
    // Re-create so `afterEach` has something to unmount.
    root = createRoot(host);
  });

  it("carries the full id where a reader and a screen reader can each get it", () => {
    paint();
    expect(link().getAttribute("title")).toContain(ID);
    expect(link().getAttribute("aria-label")).toContain(ID);
  });
});

describe("the comment marker", () => {
  it("marks the gutter itself when the paragraph has a mark, which the one-slot rules key on", () => {
    // gutter.css § One slot and a mark: on a one-line row the mark shares the
    // only slot with the "…" rather than fold behind it.
    paint([comment("c1", 5)]);
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-marked")).toBe(true);
    paint();
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-marked")).toBe(false);
  });

  it("is absent on a block with no comments", () => {
    paint();
    expect(host.querySelector(".blk-cmt")).toBeNull();
  });

  it("opens the FIRST comment it was given, not the last", () => {
    // `commentsByBlock` hands them over in reading order, so "first" is index 0
    // — and opening the last would look identical on a one-comment block.
    paint([comment("c-first", 5), comment("c-second", 40)]);
    act(() => {
      (host.querySelector(".blk-cmt") as HTMLButtonElement).click();
    });
    expect(opened).toEqual(["c-first"]);
  });

  it("counts them when there is more than one, and says so out loud", () => {
    paint([comment("c1", 5), comment("c2", 40), comment("c3", 60)]);
    expect(host.querySelector(".blk-n")?.textContent).toBe("3");
    expect(host.querySelector(".blk-cmt")?.getAttribute("aria-label")).toContain("3");
  });

  it("draws no count for a single comment", () => {
    paint([comment("c1", 5)]);
    expect(host.querySelector(".blk-n")).toBeNull();
  });

  it("is drawn for a comment whose quote no longer resolves", () => {
    // The gutter never sees a resolved mark — it is handed comments grouped by
    // blockId. This is the orphan, and it is the reason the marker exists.
    paint([comment("orphan", 999)]);
    expect(host.querySelector(".blk-cmt")).not.toBeNull();
  });
});

describe("the chat button", () => {
  it("says how many conversations a block already has", () => {
    paint(undefined, 2);
    expect(host.querySelector(".block-chat")?.classList.contains("has")).toBe(true);
    expect(host.querySelector(".block-chat-n")?.textContent).toBe("2");
  });

  it("is present and unmarked on a block with none", () => {
    paint();
    expect(host.querySelector(".block-chat")?.classList.contains("has")).toBe(false);
  });

  it("offers to open one of them, rather than promising a new one", () => {
    /* **This assertion has been red once on purpose**, the way the "?" copy
       below was. Until 2026-09-05 the chip said *"Chat about this paragraph (2
       already)"* over a press that started a third — it advertised state it
       would not show, which is the report that produced the fix
       (docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md).
       "Open a conversation" is the verb the press now performs.

       *"(2 total)"* rather than *"your conversations (2)"*: the count is the
       set, and the click opens one of it. Copy that promised the set would be
       the button reporting more than it does. GPT Sol, F-05. */
    paint(undefined, 2);
    const b = host.querySelector(".block-chat") as HTMLButtonElement;
    expect(b.getAttribute("title")).toBe("Open a conversation about this paragraph (2 total)");
    /* **The same sentence, and that is the fix** — unlike the permalink and the
       "?", whose two names diverge on purpose. The accessible name here used to
       be the bare singular, so the number on screen was the one thing a screen
       reader could not hear. */
    expect(b.getAttribute("aria-label")).toBe(
      "Open a conversation about this paragraph (2 total)",
    );
  });

  it("still offers to start one on a paragraph with none", () => {
    // The other half, unchanged — with nothing to open there is nothing to
    // count, and the press really does begin a conversation.
    paint();
    const b = host.querySelector(".block-chat") as HTMLButtonElement;
    expect(b.getAttribute("title")).toBe("Chat about this paragraph");
    expect(b.getAttribute("aria-label")).toBe("Chat about this paragraph");
  });
});

/**
 * The fourth cell of the pad — stage 2 of
 * docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md, where
 * it **opens a draft and spends nothing**. Everything here is about that being
 * true and staying true: the button exists only where the callback does, it is
 * its own callback rather than a second door into chat, and what it says to a
 * reader and to a screen reader does not claim an answer is on its way.
 */
describe('the "?"', () => {
  it("is drawn only where the callback is — a visitor gets no question mark", () => {
    // The callback IS the capability; there is no boolean and nothing dimmed.
    paint(undefined, 0, { help: false });
    expect(host.querySelector(".blk-help")).toBeNull();
    paint();
    expect(host.querySelector(".blk-help")).not.toBeNull();
  });

  it("asks about THIS block, and does not open the free-text composer as well", () => {
    paint();
    act(() => {
      (host.querySelector(".blk-help") as HTMLButtonElement).click();
    });
    expect(helped).toEqual([ID]);
    // Two doors, two intents: pressing one must not fire the other, which is
    // the failure a shared handler would produce and nothing else would show.
    expect(chatted).toEqual([]);
  });

  it("keeps the press out of the row's own handler", () => {
    // The <tr> under this gutter has a click handler of its own (TableView), so
    // a press that propagates jumps the reader somewhere they did not ask to
    // go. The other three slots all stop it; this one has to as well.
    paint();
    let bubbled = 0;
    const spy = () => bubbled++;
    document.body.addEventListener("click", spy);
    try {
      click(host.querySelector(".blk-help") as Element);
    } finally {
      document.body.removeEventListener("click", spy);
    }
    expect(helped).toEqual([ID]);
    expect(bubbled).toBe(0);
  });

  it("says who is being asked, because pressing it spends", () => {
    /* **This assertion has been red once on purpose and that was the point.**
       Through stage 2 the button opened a composer and sent nothing, so the
       copy read "Ask for help with this paragraph" — a promise of a question,
       because "Explain this" would have reported an answer nobody had bought.
       Stage 3 makes one press send, and this exact-string check is what stopped
       the sentence staying true-sounding while the behaviour moved underneath
       it. GPT Sol's condition on stage 2 being coherent alone; the red was
       watched when the copy changed.

       "the AI" rather than a bare verb, because that is the word the reader has
       to see before the finger lands: this is the one control in the gutter
       that costs money without a confirmation. */
    paint();
    const b = host.querySelector(".blk-help") as HTMLButtonElement;
    expect(b.getAttribute("title")).toBe("Ask the AI for help with this paragraph");
    /* Shorter, and divergent on purpose — the same split the permalink above
       makes. A screen reader announces this on focus with three more buttons
       queued behind it in the same gutter, so the accessible name stops at the
       verb while the tooltip has room for the paragraph. */
    expect(b.getAttribute("aria-label")).toBe("Ask the AI for help");
    /* A `toContain("AI")` stood here and could never have contributed a
       failure: the exact equality two lines up already decides it. GPT Sol,
       2026-09-05 — the same species as the `(hover: none)` helper that read the
       wrong block, and worth naming twice because it is the one that keeps
       coming back. */
  });

  it("draws the same 12px ink as the other three", () => {
    // Stage 1 grew the hit box to 24px and deliberately left the glyphs at 12.
    // A fourth icon drawn larger would be the loudest thing in a column whose
    // rule is that it stays quiet.
    paint();
    const svg = host.querySelector(".blk-help svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("12");
    /* `circle-question-mark`, because `CircleHelp` is lucide v1's alias for it
       — the class is the glyph's own name and the import's is a synonym. */
    expect(svg.getAttribute("class")).toContain("circle-question-mark");
  });

  it("comes fourth in the tab order, after the mark, the address and the chat", () => {
    /* **Source order is tab order, and since 2026-09-05 it is also the drawn
       order and the priority order** — one fact where there used to be two. The
       pad placed every slot with `grid-area` precisely so that the markup could
       read address-then-mark while the eye read mark-then-address; a column that
       truncates cannot afford that, because the stylesheet now picks "the first
       k that fit" with `:nth-child`. So this assertion is load-bearing: move an
       element in the JSX and you have changed the layout, not the tab order.

       The mark leads because it is the reader's own — Greg's call, asked
       directly, 2026-09-05 — so a note is never the thing that falls off a short
       paragraph. styles.css § the gutter has the table. */
    paint([comment("c1", 5)]);
    const classes = [...host.querySelectorAll(".blk-gutter > *")].map(
      (el) => el.className.split(" ")[0],
    );
    expect(classes).toEqual(["blk-cmt", "blk-permalink", "block-chat", "blk-help", "blk-more"]);
  });
});

/**
 * Every combination of the three independent props, and what the column is then
 * made of.
 *
 * **This replaces tests/gutter-pad-floor.test.tsx**, which asserted the same
 * boundary about the row floor that has now gone. It is kept rather than dropped
 * because of what that file was written for: `comments`, `onChatAbout` and
 * `onHelp` **are independent here**. App happens to gate the two callbacks on
 * `owner` together, so today's single caller can only ever pass both or neither
 * — and a condition has to hold at the component's boundary, not at its one
 * caller. An earlier version of the row floor read `onChatAbout || comments` on
 * exactly that reasoning and shipped an overhang for an `onHelp`-only caller;
 * GPT Sol found it on 2026-09-04, and found its descendant in the plan for this
 * change on 2026-09-05, where `:has(.blk-cmt)` was standing in for "four
 * controls".
 *
 * What is asserted is the **count** and the presence of the "…", because those
 * two are what the stylesheet reads. Which of them the container query then
 * draws is geometry, and jsdom has none.
 */
describe("the column at every combination of the three props", () => {
  const cases: {
    note: boolean;
    chat: boolean;
    help: boolean;
    controls: number;
    classes: string[];
  }[] = [
    { note: false, chat: false, help: false, controls: 1, classes: ["blk-permalink"] },
    { note: true, chat: false, help: false, controls: 2, classes: ["blk-cmt", "blk-permalink"] },
    {
      note: false,
      chat: true,
      help: false,
      controls: 2,
      classes: ["blk-permalink", "block-chat"],
    },
    { note: false, chat: false, help: true, controls: 2, classes: ["blk-permalink", "blk-help"] },
    {
      note: true,
      chat: true,
      help: false,
      controls: 3,
      classes: ["blk-cmt", "blk-permalink", "block-chat"],
    },
    {
      note: true,
      chat: false,
      help: true,
      controls: 3,
      classes: ["blk-cmt", "blk-permalink", "blk-help"],
    },
    {
      note: false,
      chat: true,
      help: true,
      controls: 3,
      classes: ["blk-permalink", "block-chat", "blk-help"],
    },
    {
      note: true,
      chat: true,
      help: true,
      controls: 4,
      classes: ["blk-cmt", "blk-permalink", "block-chat", "blk-help"],
    },
  ];

  it.each(cases)(
    "counts $controls with note=$note chat=$chat help=$help",
    ({ note, chat, help, controls, classes }) => {
      paint(note ? [comment("c1", 5)] : undefined, 0, { chat, help });
      const gutter = host.querySelector(".blk-gutter") as HTMLDivElement;
      /* The count the stylesheet reads. Wrong by one and the wrong control is
         folded away — or the "…" is drawn over a column that has room for
         everything. */
      expect(gutter.getAttribute("data-controls")).toBe(String(controls));
      const drawn = [...gutter.children].map((el) => el.className.split(" ")[0]);
      expect(drawn.filter((c) => c !== "blk-more")).toEqual(classes);
      /* And the dot is there for exactly the gutters that can hide something.
         The single-control case is the one that used to come out wrong: a
         visitor with no note has nothing behind a dot, and a dot that opens a
         column of one is a button that can only disappoint. */
      expect(drawn.includes("blk-more")).toBe(controls > 1);
    },
  );

  it("never leaves a control with no way to reach it", () => {
    /* The property underneath the table, stated once: **either every control
       fits the smallest row, or there is a "…"**. At one slot the stylesheet
       draws the first control and nothing else, so any gutter with more than one
       control and no dot would have controls a short paragraph could never
       show. That is the failure mode Sol's fourth finding names, and it is
       cheaper to assert than to reason about. */
    for (const { note, chat, help } of cases) {
      paint(note ? [comment("c1", 5)] : undefined, 0, { chat, help });
      const gutter = host.querySelector(".blk-gutter") as HTMLDivElement;
      const n = Number(gutter.getAttribute("data-controls"));
      expect(n === 1 || gutter.querySelector(".blk-more") !== null).toBe(true);
    }
  });
});

/**
 * The "…", which is how a short paragraph reaches what it has no room to draw.
 *
 * **jsdom computes no layout, so nothing here can test which controls are
 * visible** — that is the container query's job and it is asserted structurally
 * in tests/gutter-target-size.test.ts and measured in a real browser
 * (docs/plans/260905c-… § Built, and measured). What this file can hold is the
 * half that is behaviour: when the button exists, what pressing it does, and
 * every way it closes. Those are the parts that would otherwise be checked by
 * hand once and then never again.
 */
describe("the bookmark button", () => {
  /* SPIDERYARN-READING2-37, Greg, 2026-09-12: *"a sort of bookmark icon as
     well, sort of a fourth one, so you could just say … bookmark that block"*.
     docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md. */
  const stored = (answer: boolean) => {
    const asked: BlockId[] = [];
    const fn = (id: BlockId) => {
      asked.push(id);
      return Promise.resolve(answer);
    };
    return { asked, fn };
  };
  const button = () => host.querySelector<HTMLButtonElement>(".blk-bookmark");

  it("is drawn only where the callback is — a visitor gets none", () => {
    paint();
    expect(button()).toBeNull();
    paint(undefined, 0, { bookmark: stored(true).fn });
    expect(button()).not.toBeNull();
  });

  it("gives way to the mark on a paragraph that already has a note", () => {
    // One slot, never two: the mark is the state, and pressing it opens the
    // note — which is also where un-bookmarking lives.
    paint([comment("c1", 5)], 0, { bookmark: stored(true).fn });
    expect(button()).toBeNull();
    expect(host.querySelector(".blk-cmt")).not.toBeNull();
    expect(host.querySelector(".blk-gutter")?.getAttribute("data-controls")).toBe("4");
  });

  it("sits third, after the address and the chat door, before the \"?\"", () => {
    // Greg's order for what folds away first, 260905c: permalink and chat stay.
    paint(undefined, 0, { bookmark: stored(true).fn });
    const gutter = host.querySelector(".blk-gutter") as HTMLDivElement;
    const classes = [...gutter.children].map((el) => el.className.split(" ")[0]);
    expect(classes).toEqual(["blk-permalink", "block-chat", "blk-bookmark", "blk-help", "blk-more"]);
    expect(gutter.getAttribute("data-controls")).toBe("4");
  });

  it("bookmarks THIS block in one press, and says so once it is stored", async () => {
    const { asked, fn } = stored(true);
    paint(undefined, 0, { bookmark: fn });
    click(button() as HTMLButtonElement);
    expect(asked).toEqual([ID]);
    // Nothing is announced before the store has answered.
    expect(said).toEqual([]);
    await settle();
    expect(said).toEqual(["Bookmarked this paragraph."]);
  });

  it("says only what it knows when storage was not confirmed", async () => {
    paint(undefined, 0, { bookmark: stored(false).fn });
    click(button() as HTMLButtonElement);
    await settle();
    /* `false` can also mean the POST committed and its response was lost, so
       the announcement may not claim the server did nothing. */
    expect(said).toEqual(["Bookmark not confirmed."]);
  });

  it("keeps the press out of the row's own handler, and folds the column", () => {
    // On `document.body`, as the "?" test above does: `host` is the React root,
    // and a listener on the root's own node is not something React's
    // `stopPropagation` can keep out.
    paint(undefined, 0, { bookmark: stored(true).fn });
    act(() => (host.querySelector(".blk-more") as HTMLButtonElement).click());
    let bubbled = 0;
    const spy = () => bubbled++;
    document.body.addEventListener("click", spy);
    try {
      click(button() as HTMLButtonElement);
    } finally {
      document.body.removeEventListener("click", spy);
    }
    expect(bubbled).toBe(0);
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(false);
  });
});

describe('the "…"', () => {
  it("is drawn where there is more than one control, and nowhere else", () => {
    /* Not "the reader can chat", which is what the row floor keyed on and what
       the plan for this change proposed: the three props are independent, so a
       visitor with a note has two controls and needs this, and a visitor with
       none has one and must not have it. The whole table is above. */
    paint();
    expect(host.querySelector(".blk-more")).not.toBeNull();
    paint(undefined, 0, { chat: false, help: false });
    expect(host.querySelector(".blk-more")).toBeNull();
    paint([comment("c1", 5)], 0, { chat: false, help: false });
    expect(host.querySelector(".blk-more")).not.toBeNull();
  });

  it("says whether it is open, because the icon alone does not", () => {
    // A disclosure rather than a menu: what it opens is these same controls, at
    // these same addresses in the DOM, so `aria-expanded` is the whole of the
    // extra semantics.
    paint();
    const more = host.querySelector(".blk-more") as HTMLButtonElement;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(true);
    act(() => more.click());
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(false);
  });

  it("draws an ✕ and says Close while it is open, not a second \"…\"", () => {
    /* SPIDERYARN-READING2-38, Greg on an iPad, 2026-09-12: *"it has yet more
       three dots, but I don't know what that does."* The open column ends in
       the button that opened it; the glyph and the name are what say that
       pressing it closes, since a `title` never shows on a finger. */
    paint();
    const more = host.querySelector(".blk-more") as HTMLButtonElement;
    const glyph = () => more.querySelector("svg")?.getAttribute("class") ?? "";
    expect(glyph()).toContain("lucide-ellipsis");
    act(() => more.click());
    expect(glyph()).toContain("lucide-x");
    expect(glyph()).not.toContain("lucide-ellipsis");
    expect(more.getAttribute("aria-label")).toBe("Close paragraph controls");
    act(() => more.click());
    expect(glyph()).toContain("lucide-ellipsis");
    expect(more.getAttribute("aria-label")).toBe("More for this paragraph");
  });

  it("closes on Escape, and puts the focus back where it came from", () => {
    // Without the second half the ring is left on a control that has just been
    // folded away, which is a keyboard reader lost in a column of one row.
    paint();
    const more = host.querySelector(".blk-more") as HTMLButtonElement;
    act(() => more.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(false);
    expect(document.activeElement).toBe(more);
  });

  it("puts the keyboard at the head of the column when it opens", () => {
    /* **The "…" is the last child and everything it reveals is above it**, so
       without this a keyboard reader activates it and then tabs straight out of
       the gutter — the controls that just appeared are reachable only backwards.
       GPT Sol's second finding on the built code, 2026-09-05.

       `detail: 0` is what says "keyboard": Enter and Space give 0, a real click
       gives 1. A pointer press leaves the focus where the reader put it. */
    paint([comment("c1", 5)]);
    const more = host.querySelector(".blk-more") as HTMLButtonElement;
    act(() => more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(document.activeElement).toBe(host.querySelector(".blk-cmt"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.activeElement).toBe(more);
  });

  it("leaves the focus alone when it was a pointer that opened it", () => {
    // Taking the focus off whatever a reader has just clicked is worse than
    // leaving it; only the keyboard path is given a destination.
    paint();
    const more = host.querySelector(".blk-more") as HTMLButtonElement;
    host.querySelector<HTMLElement>(".blk-permalink")?.focus();
    const before = document.activeElement;
    act(() => more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(true);
    expect(document.activeElement).toBe(before);
  });

  it("closes on a press anywhere else on the page", () => {
    /* `pointerdown`, not `click`, so the panel is gone before the press lands on
       whatever is under it — the alternative reads as a paragraph that needed
       two taps. Captured, so a child's `stopPropagation` cannot keep it open. */
    paint();
    act(() => (host.querySelector(".blk-more") as HTMLButtonElement).click());
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(false);
  });

  it("stays open when the press is one of its own controls' surroundings", () => {
    // The check is "inside this gutter", so pointing at the column itself is not
    // a dismissal — only the press that follows on a control is, and that one
    // closes it by choosing something.
    paint();
    const gutter = host.querySelector(".blk-gutter") as HTMLDivElement;
    act(() => (host.querySelector(".blk-more") as HTMLButtonElement).click());
    act(() => {
      gutter.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(gutter.hasAttribute("data-open")).toBe(true);
  });

  it("folds up again when the reader chooses something", () => {
    // Every control closes it, and the "?" is the one worth pinning: it spends
    // money on one press, so leaving the column unfolded over the next paragraph
    // afterwards would put a paid button under the reader's finger by accident.
    paint();
    act(() => (host.querySelector(".blk-more") as HTMLButtonElement).click());
    act(() => (host.querySelector(".blk-help") as HTMLButtonElement).click());
    expect(helped).toEqual([ID]);
    expect(host.querySelector(".blk-gutter")?.hasAttribute("data-open")).toBe(false);
  });
});
