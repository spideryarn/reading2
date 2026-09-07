// @vitest-environment jsdom
/**
 * **Opening a question is a jump; stepping between them is not** —
 * src/web/comment-jump.ts, Stage B2 of
 * docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * Both paths used to be one function, and the two intents want opposite things
 * from the history stack. The only assertion that can tell them apart is the
 * **entry count**, which is why this file mounts nuqs and the history wrapper
 * rather than asserting on `location` alone: the push a jump makes is nuqs's
 * and lands a task later, and the replace stepping makes has to be shown *not*
 * to be a push.
 *
 * Three claims, one per behaviour the stage exists to fix:
 *
 *  - § the drawer — one selection, one entry, stamped with where the reader was.
 *  - § the arrows — ten steps, no entries, and the stamp still naming the place
 *    the traversal was entered from rather than the previous question. GPT Sol
 *    F9, 2026-09-06: twenty questions must not cost twenty presses of Back
 *    (docs/project/comments.md § Reading order).
 *  - § already on screen — neither path moves the page for a passage the reader
 *    is already looking at, which is why two comments in one paragraph do not
 *    jolt.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { throttle, useQueryState } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId } from "../src/types.js";
import { type AnchoredComment, jumpToComment, stepToComment } from "../src/web/comment-jump.js";
import { clearArmedJump, readStamp } from "../src/web/jump-history.js";
import { beginJump } from "../src/web/keynav.js";
import { atParam, noteParam } from "../src/web/params.js";
import { dismissJumpOrigin, watchHistoryWrites } from "../src/web/router.js";

/* `scrollToBlock` is recorded rather than run — jsdom has no layout, and the
   claim being made about stepping is precisely that it *scrolls* rather than
   pushing. `isBlockOnScreen` stays real: the guard it applies is under test in
   § already on screen, and stubbing it would leave that test asserting against
   its own stub. `vi.hoisted` because `vi.mock` is lifted above declarations. */
const { scrolled, abandoned } = vi.hoisted(() => ({
  scrolled: [] as string[],
  abandoned: [] as true[],
}));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/scroll.js")>();
  return {
    ...actual,
    scrollToBlock: (id: string) => {
      scrolled.push(id);
    },
    /* **Recorded rather than run, and that is the honest limit here.** The
       thing `abandonScroll` stops is a rAF glide driven by `window.scrollTo`,
       which jsdom does not implement — so a test that "ran" it would be
       watching nothing happen and calling that a pass. What is under test is
       the decision: when the reader is already at the passage, the movement we
       started must be called off. GPT Sol F22, 2026-09-06. */
    abandonScroll: () => {
      abandoned.push(true);
    },
  };
});

/* main.tsx's order: nuqs patches history first, so ours is the outer wrapper. */
enableHistorySync();
watchHistoryWrites();

/* jsdom has no `CSS.escape`, and `isBlockOnScreen` reaches it through
   `blockRow` (rows.ts). Ids are `[a-z0-9-]` by construction (src/ids.ts), so
   identity is a correct escape for every value this file uses. Same stub as
   tests/scroll-glide.test.ts. */
globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

/* Ids in the shape this app really mints, and **valid** — `noteParam` is
   `parseAsBlockId`, so a fixture id it rejected would be dropped from the URL
   and every assertion here would pass for the wrong reason. The alphabet has no
   `1`, `i`, `l` or `o` (src/ids.ts), so the rows cannot be spelled `blk015` and
   the comments cannot be spelled `note…`; a letter per decimal digit instead,
   `a` for 0 through `k` for 9. docs/project/block-ids.md. */
const DIGITS = "abcdefghjk";
const spell = (n: number, width: number) =>
  String(n)
    .padStart(width, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("");
const block = (row: number) => `spya-para${spell(row, 2)}` as BlockId;
/** The comment anchored to row `row`. `cmt` because `note` is unspellable. */
const comment = (row: number) => `spya-cmt${spell(row, 3)}`;

const at = (id: BlockId) => ({ kind: "block", blockId: id }) as const;

const BLOCKS: Block[] = Array.from({ length: 32 }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: `para ${i}`,
  words: 2,
  html: `<p>para ${i}</p>`,
  gistable: true,
}));

/** One question on every paragraph, so any row can be chosen or stepped to. */
const COMMENTS: AnchoredComment[] = BLOCKS.map((b, i) => ({
  id: comment(i),
  blockId: b.id,
}));

/**
 * **Three bands, because two facts are being measured, not one.**
 *
 * `measureOrigin` asks which row has crossed the reading line — rows 0–15 have,
 * so the origin is block 15. `isBlockOnScreen` asks whether a row sits between
 * the sticky chrome and the bottom of the viewport — rows 16–20 do, and rows
 * 21+ are far below it. So rows 21+ are the off-screen targets and 16–20 the
 * on-screen ones, and the two questions can be posed independently.
 */
const bandTop = (i: number) => (i <= 15 ? -10 : i <= 20 ? 500 : 4000);

function layOut(): void {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (const [i] of BLOCKS.entries()) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", block(i));
    const top = bandTop(i);
    tr.getBoundingClientRect = () =>
      ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top }) as DOMRect;
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);
}

/**
 * **A comment whose passage is not on this page** — an orphan, in the shape
 * `comment-nav.ts` deliberately keeps and sorts to the end of the list when a
 * re-extraction takes its block away (docs/project/comments.md).
 */
const ORPHAN: AnchoredComment = { id: comment(99), blockId: block(99) };

/**
 * Reshape one row so that it **crosses the reading line** — top above it,
 * bottom far below — which is what a paragraph taller than the viewport looks
 * like. Nothing in `bandTop` can express it, because every row there is drawn
 * with `bottom: top`.
 */
function makeTall(row: number): void {
  const tr = document.querySelector<HTMLElement>(`tr[data-block="${block(row)}"]`);
  if (tr === null) throw new Error(`no row for ${block(row)}`);
  tr.getBoundingClientRect = () =>
    ({ top: -300, bottom: 1200, left: 0, right: 0, width: 0, height: 1500, x: 0, y: -300 }) as DOMRect;
}

/** The origin every jump below is made from — the row at the reading line. */
const ORIGIN = block(15);
/** Off screen, so both paths have something to bring into view. */
const FAR = 25;
/** On screen, so neither path should move anything. */
const NEAR = 18;

let host: HTMLDivElement;
let root: Root;
/** App.tsx's `jumpTo` write, byte for byte. */
let pushAt: ((id: BlockId) => void) | null = null;
/** App.tsx's `setNote`, which is `?note=` and a replace (params.ts). */
let noteSetter: ((id: string) => unknown) | null = null;

function Address(): ReactNode {
  const [, setAt] = useQueryState("at", atParam);
  const [, setNote] = useQueryState("note", noteParam);
  pushAt = (id) => {
    void setAt(id, { history: "push", limitUrlUpdates: throttle(0) });
  };
  noteSetter = (id) => setNote(id);
  return null;
}

/** Exactly what App.tsx's `jumpTo` does, minus its `synced` bookkeeping. */
const jumpTo = (target: BlockId) => void beginJump(BLOCKS, target, (id) => pushAt?.(id));
const note = (id: string) => noteSetter?.(id);

/**
 * Wait past nuqs's whole throttle window rather than one tick.
 *
 * `throttle(0)` cannot lower the queue's floor — it resets `timeMs` to nuqs's
 * own default (50ms outside Safari) and `push` only ever raises it — so a
 * one-tick wait passes or fails depending on how slow the previous test was,
 * which is a coin toss wearing a green tick. tests/jump-history.test.ts § settled.
 */
async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

const param = (key: string) => new URLSearchParams(location.search).get(key);

/** Step back one entry and wait for the browser to actually be there. */
async function goBack(): Promise<void> {
  const landed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  await act(async () => {
    history.back();
    await landed;
  });
}

describe("moving to a comment", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/read/x");
    /* Scrolled down, so `measureOrigin` reads the table rather than
       short-circuiting to the top of the article. */
    Object.defineProperty(window, "scrollY", { value: 1000, writable: true, configurable: true });
    clearArmedJump();
    /* A same-path replace preserves the stamp on purpose, so resetting the
       address does not reset the entry — GPT Sol F27, 2026-09-06. */
    dismissJumpOrigin();
    document.body.replaceChildren();
    scrolled.length = 0;
    abandoned.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(NuqsAdapter, null, createElement(Address))));
    layOut();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /* --------------------------------------------------------- the drawer -- */

  /**
   * **One selection, one entry.** The drawer's list is a table of contents for
   * the reader's own questions, and choosing one flings them an arbitrary
   * distance — a deliberate act, which pushes
   * (docs/project/url-state.md § Position replaces history). Without the push
   * there is no Back to press and, on a home-screen shell, no way home at all.
   */
  it("adds exactly one history entry for an off-screen question", async () => {
    const before = history.length;
    act(() => jumpToComment(COMMENTS, comment(FAR), note, jumpTo));
    await settled();
    expect(history.length).toBe(before + 1);
    expect(param("note")).toBe(comment(FAR));
    expect(param("at")).toBe(block(FAR));
  });

  /**
   * **And the entry knows where the reader was**, which is what draws the chip.
   * The origin is measured at the moment of the jump, never read from `?at=`
   * (keynav.ts § measureOrigin).
   */
  it("stamps that entry with the place the reader jumped from", async () => {
    act(() => jumpToComment(COMMENTS, comment(FAR), note, jumpTo));
    await settled();
    expect(readStamp(history.state)).toEqual(at(ORIGIN));
  });

  /**
   * **One entry, not two.** `?note=` and `?at=` are set in the same tick, and
   * nuqs merges pending updates into one flush that any push option upgrades to
   * a push. Split across two ticks they would be two entries, and Back would
   * take the reader half way home.
   */
  it("puts the note and the position on the same entry", async () => {
    const before = history.length;
    act(() => jumpToComment(COMMENTS, comment(FAR), note, jumpTo));
    await settled();
    /* Asserted before the step back, so that a regression which pushes nothing
       fails here rather than hanging for a popstate that never arrives. */
    expect(history.length).toBe(before + 1);
    await goBack();
    expect(param("note")).toBeNull();
    /* The predecessor's `?at=` names where the reader really was — the jump
       transaction rewrote it on the way out (router.ts § originHref). */
    expect(param("at")).toBe(ORIGIN);
  });

  /* --------------------------------------------------------- the arrows -- */

  /**
   * **Ten steps, no entries.** The dialog's arrows are traversal, not jumps:
   * *"Like keynav.ts, it writes no position state of its own"*
   * (docs/project/comments.md § Reading order). Twenty questions spread through
   * an article must not cost twenty presses of Back — browsers throttle rapid
   * Back, so that is not merely tedious. GPT Sol F9.
   */
  it("adds no history entries for ten off-screen steps", async () => {
    const before = history.length;
    for (let i = 0; i < 10; i++) {
      const row = 21 + i;
      act(() => stepToComment(COMMENTS, comment(row), note));
      await settled();
    }
    expect(history.length).toBe(before);
    expect(scrolled).toEqual(Array.from({ length: 10 }, (_, i) => block(21 + i)));
  });

  /**
   * **And the chip still names where the traversal began.**
   *
   * This is what makes the split better than either half alone. The reader
   * enters by the drawer, which stamps the entry; the arrows only ever replace,
   * and a replace preserves the stamp (router.ts). So after ten steps the way
   * home is still the place they were reading before they opened the drawer,
   * rather than the previous question.
   */
  it("keeps the stamp naming where the traversal was entered from", async () => {
    act(() => jumpToComment(COMMENTS, comment(FAR), note, jumpTo));
    await settled();
    const entries = history.length;
    for (let i = 0; i < 10; i++) {
      act(() => stepToComment(COMMENTS, comment(21 + i), note));
      await settled();
    }
    expect(history.length).toBe(entries);
    expect(readStamp(history.state)).toEqual(at(ORIGIN));
    /* Not the previous question, which is what a per-step push would have left. */
    expect(readStamp(history.state)).not.toEqual(at(block(FAR)));
  });

  /** The ends of the list hand `null` straight over, and it must be harmless. */
  it("does nothing at all for a step past the end of the list", async () => {
    const before = history.length;
    act(() => stepToComment(COMMENTS, null, note));
    await settled();
    expect(history.length).toBe(before);
    expect(scrolled).toEqual([]);
    expect(param("note")).toBeNull();
  });

  /* -------------------------------------------------- already on screen -- */

  /**
   * **Two comments in one paragraph must not jolt the page**, which is the
   * existing deliberate behaviour and the reason both paths ask
   * `isBlockOnScreen` before doing anything. The drawer's path must not push
   * either: a Back that undoes nothing visible is worse than no Back.
   */
  it("moves nothing and pushes nothing when the drawer's question is on screen", async () => {
    const before = history.length;
    act(() => jumpToComment(COMMENTS, comment(NEAR), note, jumpTo));
    await settled();
    expect(history.length).toBe(before);
    expect(scrolled).toEqual([]);
    expect(param("at")).toBeNull();
    expect(param("note")).toBe(comment(NEAR));
  });

  it("moves nothing when the step's question is on screen", async () => {
    act(() => stepToComment(COMMENTS, comment(NEAR), note));
    await settled();
    expect(scrolled).toEqual([]);
    expect(param("note")).toBe(comment(NEAR));
  });

  /**
   * **A paragraph taller than the viewport is somewhere the reader already
   * is.** It can never satisfy "fits between the bars" at any scroll position,
   * so it used to count as off screen — and stepping between two questions
   * inside one such paragraph jolted to its top, which is the exact case the
   * no-jolt guard exists to prevent. GPT Sol F10, 2026-09-06, reproduced with a
   * row at `top=-300, bottom=1200`.
   */
  it("treats a paragraph taller than the viewport as somewhere the reader is", async () => {
    makeTall(NEAR + 4);
    const before = history.length;
    act(() => stepToComment(COMMENTS, comment(NEAR + 4), note));
    act(() => jumpToComment(COMMENTS, comment(NEAR + 4), note, jumpTo));
    await settled();
    expect(scrolled).toEqual([]);
    expect(history.length).toBe(before);
  });

  /**
   * **And deciding "already here" has to stop the movement already running.**
   *
   * A step to a far question starts a 200ms glide; while it is passing a nearer
   * one the reader presses Prev. Without this the note changes and the glide
   * carries serenely on, leaving the question they asked for off screen. GPT
   * Sol F22, 2026-09-06.
   */
  it("calls off a glide in flight when the reader is already at the question", async () => {
    act(() => stepToComment(COMMENTS, comment(FAR), note));
    expect(abandoned).toEqual([]);
    act(() => stepToComment(COMMENTS, comment(NEAR), note));
    expect(abandoned).toEqual([true]);
  });

  /**
   * **An orphan comment must not buy a history entry for a journey that cannot
   * happen.**
   *
   * A comment whose block went in a re-extraction is deliberately kept and
   * sorted to the end of the drawer (comment-nav.ts). Its row is not in the
   * document, so `scrollToBlock` returns at its missing-row guard and nothing
   * moves — but the push had already happened, and the chip then offered the
   * way back from somewhere the reader never went. GPT Sol F23, 2026-09-06.
   *
   * The old test could not have caught this: it recorded every `scrollToBlock`
   * call as a scroll, while the real one returns without moving. The assertion
   * that survives that is the **entry count**.
   */
  it("opens an orphan question without pushing or moving", async () => {
    const comments = [...COMMENTS, ORPHAN];
    const before = history.length;
    /* Whatever the way back was, it is **unchanged** — not `null`, which this
       entry need not have been: a replace preserves the stamp on purpose
       (router.ts § the wrapper's three rules), so the reset in `beforeEach`
       carries the previous test's stamp in with it. "Nothing about the way home
       moved" is the claim, and it is the stronger one. */
    const wayBack = readStamp(history.state);
    act(() => jumpToComment(comments, ORPHAN.id, note, jumpTo));
    await settled();
    expect(history.length).toBe(before);
    expect(param("at")).toBeNull();
    expect(readStamp(history.state)).toEqual(wayBack);
    expect(param("note")).toBe(ORPHAN.id);
  });

  it("steps to an orphan question without moving", async () => {
    const comments = [...COMMENTS, ORPHAN];
    act(() => stepToComment(comments, ORPHAN.id, note));
    await settled();
    expect(scrolled).toEqual([]);
    expect(param("note")).toBe(ORPHAN.id);
  });
});
