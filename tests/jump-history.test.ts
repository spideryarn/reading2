// @vitest-environment jsdom
/**
 * **The history entry a jump leaves behind, and whether it names where the
 * reader actually was.**
 *
 * The reading view already pushes a history entry on every deliberate jump and
 * on no scroll at all (docs/project/url-state.md § Position replaces history).
 * What it did not do is record *where the reader was standing* when they
 * jumped, and `?at=` cannot answer that — it is absent at the top, it
 * deliberately holds a stale fine block while the reader moves inside one
 * section, and a jump cancels the write that was queued behind it
 * (keynav.ts § measureOrigin). Stage A of
 * docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * Three layers, and they fail for different reasons:
 *
 *  - **The stamp** — pure functions over an opaque history-state object.
 *  - **The wrapper** — `watchHistoryWrites` (router.ts) is the single choke
 *    point for both nuqs's writes and `navigate`'s, and it decides which
 *    entries carry a stamp. The sharpest case is § does not let a later push
 *    inherit: nuqs hands `pushState` the **current** entry's state verbatim, so
 *    an unstamped push would silently inherit the last jump's origin and the
 *    chip would promise a return it cannot make.
 *  - **The jump** — `beginJump` makes exactly one nuqs push and the wrapper
 *    performs the pair, because two `setAt` calls in one tick are not a
 *    transaction: nuqs keeps pending updates in a `Map` keyed by parameter
 *    name, so the second overwrites the first and the predecessor rewrite
 *    silently never happens (GPT Sol F11, 2026-09-06).
 *
 * The last group mounts React and nuqs rather than asserting on `location`
 * alone, because the flush that performs the push is nuqs's and lands a task
 * later — § one render is the test that would notice if the wrapper's own
 * intermediate write ever escaped into the app.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { throttle, useQueryState } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId } from "../src/types.js";
import {
  armJump,
  clearArmedJump,
  consumeArmedJump,
  type JumpOrigin,
  readStamp,
  withStamp,
} from "../src/web/jump-history.js";
import { beginJump } from "../src/web/keynav.js";
import { atParam } from "../src/web/params.js";
import { dismissJumpOrigin, watchHistoryWrites } from "../src/web/router.js";

/* `scrollToBlock` is stubbed rather than run: jsdom has no layout, and § does
   nothing at all has to assert that the reader was *not moved*, which is a claim
   about this call and not about any URL. Everything else in scroll.ts —
   `stickyOffset` above all, which `measureOrigin` measures against — stays real.
   `vi.hoisted` because `vi.mock` is lifted above every declaration in the file. */
const { scrolled } = vi.hoisted(() => ({ scrolled: [] as string[] }));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/scroll.js")>();
  return {
    ...actual,
    scrollToBlock: (id: string) => {
      scrolled.push(id);
    },
  };
});

/* **In main.tsx's order, and the order is the whole point**: nuqs patches
   history first, so ours is the outer wrapper and sees every call before nuqs's
   does. Installed once, at module scope, because both are idempotent by design
   and a second patch would double every event. */
enableHistorySync();

/**
 * **A tap between the two patches**, which is the only place the transaction is
 * observable at all.
 *
 * `watchHistoryWrites` calls the functions it captured, so its two writes never
 * reach the outside world separately — that is what makes them one operation,
 * and it is also what makes them invisible to any assertion made from outside.
 * Sitting here, under our wrapper and over nuqs's, records exactly the pair.
 *
 * It exists because of what the render-based test could **not** establish: React
 * batches, so two ordinary history writes in one task render as one update too,
 * and § never renders the intermediate origin would have passed just the same
 * had the transaction been split in two. GPT Sol F17, 2026-09-06.
 */
const inner: { kind: "push" | "replace"; marker: string; url: string }[] = [];
for (const name of ["pushState", "replaceState"] as const) {
  const real = history[name].bind(history);
  history[name] = (state: unknown, marker: string, url?: string | URL | null) => {
    inner.push({
      kind: name === "pushState" ? "push" : "replace",
      marker,
      url: String(url ?? location.href),
    });
    real(state, marker, url ?? null);
  };
}

watchHistoryWrites();

/* Ids in the real shape **and valid**, because `readStamp` checks them against
   `ID_PATTERN` and a fixture id it rejects would make every assertion here pass
   for the wrong reason. The id alphabet drops `1`, `i`, `l` and `o` — the
   characters people misread when copying an id out of a URL (src/ids.ts) — so
   the row cannot be written as `blk015`, which is not an id this app could ever
   have minted — nor as `blk…`, since `l` goes for the same reason. So it is
   `para` and then one letter per decimal digit, `a` for 0 through `k` for 9:
   row 15 is `spya-parabf`. docs/project/block-ids.md. */
const DIGITS = "abcdefghjk";
const block = (row: number) =>
  `spya-para${String(row)
    .padStart(2, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("")}` as BlockId;
const A = block(0);
const B = block(1);
const TOP = { kind: "top" } as const;
const at = (id: BlockId) => ({ kind: "block", blockId: id }) as const;

/* ------------------------------------------------------------- the stamp -- */

describe("the stamp on a history entry", () => {
  it("round-trips a block origin", () => {
    expect(readStamp(withStamp(null, at(A)))).toEqual(at(A));
  });

  /** The top of the article is a case of its own all the way through — F8. */
  it("round-trips the top of the article, distinctly from any block", () => {
    expect(readStamp(withStamp(null, TOP))).toEqual(TOP);
  });

  /** Nothing else writes `history.state` today; that is not a reason to eat it. */
  it("preserves foreign keys when it writes, and when it strips", () => {
    const stamped = withStamp({ scroll: 3 }, at(A)) as Record<string, unknown>;
    expect(stamped.scroll).toBe(3);
    expect(readStamp(stamped)).toEqual(at(A));
    expect(withStamp(stamped, null)).toEqual({ scroll: 3 });
  });

  /** `{}` on every entry would be litter with no owner. */
  it("strips to null rather than to an empty object", () => {
    expect(withStamp(withStamp(null, at(A)), null)).toBeNull();
    expect(withStamp(null, null)).toBeNull();
  });

  it("replaces an older stamp rather than nesting one", () => {
    expect(readStamp(withStamp(withStamp(null, at(A)), at(B)))).toEqual(at(B));
  });

  /** Never throws, whatever another patcher or a browser restore left there. */
  it.each<[unknown, string]>([
    [null, "no state at all"],
    [undefined, "undefined"],
    ["spya-paraaa", "a bare string rather than an object"],
    [42, "a number"],
    [{}, "a foreign object with none of ours"],
    [{ spya: null }, "our key holding null"],
    [{ spya: "spya-paraaa" }, "our key holding a string"],
    [{ spya: {} }, "our key holding an object with no origin"],
    [{ spya: { from: 7 } }, "an origin that is not a string"],
    [{ spya: { from: "n0003" } }, "a node id, which is not a block id"],
    [{ spya: { from: "spya-parab" } }, "an id one character short"],
    [{ spya: { from: "spya-para15" } }, "an id using characters the alphabet drops"],
  ])("reads %j (%s) as no stamp", (state) => {
    expect(readStamp(state)).toBeNull();
  });

  /**
   * A state that is not a plain object has no keys to merge into, so stamping
   * it would mean throwing somebody else's value away. The chip is worth less
   * than that, so we decline and leave the state alone.
   */
  it("declines to stamp a state it cannot merge into", () => {
    expect(withStamp("theirs", at(A))).toBe("theirs");
    expect(withStamp([1, 2], at(A))).toEqual([1, 2]);
  });
});

/* --------------------------------------------------- the arm/consume pair -- */

describe("arming a jump", () => {
  const HERE = "/read/x?at=spya-paraaa";
  const arm = () => armJump({ pathname: "/read/x", from: HERE, origin: at(A), target: B });

  beforeEach(() => clearArmedJump());

  it("hands the origin back once and then nothing", () => {
    arm();
    expect(consumeArmedJump(HERE, "/read/x", B)).toEqual(at(A));
    expect(consumeArmedJump(HERE, "/read/x", B)).toBeNull();
  });

  it("is empty until something arms it", () => {
    expect(consumeArmedJump(HERE, "/read/x", B)).toBeNull();
  });

  /**
   * A push that is not this jump's must not be able to wear its origin — and
   * must leave it behind, so the real push can still find it. GPT Sol F11.
   *
   * The last row is F14: nuqs abandons a queued write when the page navigates,
   * so an arm can outlive its jump. Getting back to this article afterwards
   * cannot be done without changing the address on the way, which is what makes
   * "the address is still the one I armed at" a usable proxy for "the reader
   * has not been anywhere since".
   */
  it.each<[string, string, BlockId | null, string]>([
    [HERE, "/read/y", B, "another article"],
    [HERE, "/read/x", block(9), "another block"],
    [HERE, "/read/x", null, "a push that names no block at all"],
    ["/read/x?at=spya-parabf", "/read/x", B, "a push from an address the reader has since left"],
  ])("refuses (%s) and stays armed", (here, pathname, target) => {
    arm();
    expect(consumeArmedJump(here, pathname, target)).toBeNull();
    expect(consumeArmedJump(HERE, "/read/x", B)).toEqual(at(A));
  });
});

/* ------------------------------------------------- the wrapper's decisions -- */

/** What nuqs does: push the entry carrying the current entry's state verbatim. */
function push(url: string, state: unknown = history.state): void {
  history.pushState(state, "", url);
}

/**
 * Arm a jump from wherever the address currently is — which is what
 * `beginJump` does, and the `from` is load-bearing: an arm is spent only by a
 * push made from the address it was set at (GPT Sol F14).
 */
function arm(origin: JumpOrigin, target: BlockId): void {
  armJump({
    pathname: location.pathname,
    from: location.pathname + location.search,
    origin,
    target,
  });
}

describe("which entries carry a stamp", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/read/x");
    clearArmedJump();
    /* A same-path replace preserves the stamp on purpose, so the line above
       resets the address and not the entry. Without this the previous test's
       origin rides in. GPT Sol F27, 2026-09-06. */
    dismissJumpOrigin();
  });

  it("stamps the push its jump armed", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    expect(readStamp(history.state)).toEqual(at(A));
  });

  /**
   * **The regression this stage exists to stop shipping**, and the one nobody
   * would have found by hand. nuqs passes the *current* entry's state into
   * `pushState` verbatim (nuqs/dist/adapters/react.js), so a `cols`, `mode` or
   * `sort` toggle after a jump would inherit that jump's origin and draw a chip
   * on an entry whose Back merely undoes the toggle. GPT Sol F3, 2026-09-06.
   */
  it("does not let a later push inherit the last jump's stamp", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    push("/read/x?cols=0,2");
    expect(readStamp(history.state)).toBeNull();
  });

  /** The counterpart: a replace must **not** lose it, or the chip blinks out. */
  it("keeps the stamp across a replace, whatever the caller passed", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    history.replaceState(null, "", `/read/x?at=${block(9)}`);
    expect(readStamp(history.state)).toEqual(at(A));
  });

  /** An excursion belongs to one article. */
  it("clears the stamp when a replace changes the pathname", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    history.replaceState(history.state, "", `/read/y?at=${block(9)}`);
    expect(readStamp(history.state)).toBeNull();
  });

  it("refuses to stamp a push that leaves the article", () => {
    arm(at(A), B);
    push("/read/y");
    expect(readStamp(history.state)).toBeNull();
  });

  /** The armed push rewrites the entry it leaves, in the same operation. */
  it("rewrites the predecessor's ?at= to the origin", async () => {
    history.replaceState(null, "", `/read/x?cols=0,2&at=${block(9)}`);
    arm(at(block(15)), block(25));
    push(`/read/x?cols=0,2&at=${block(25)}`);
    expect(location.search).toBe(`?cols=0,2&at=${block(25)}`);
    await goBack();
    /* Every other parameter carried through as text, `?cols=0,2` unencoded —
       the predecessor is an address the reader could have been sent. */
    expect(location.search).toBe(`?cols=0,2&at=${block(15)}`);
  });

  /**
   * **The top of the article is written as the removal of `?at=`.**
   *
   * `useReadingPosition`'s restore effect branches on exactly this — `at ===
   * null` takes `scrollToTop()` and anything else takes `scrollToBlock()` — so
   * a predecessor holding the first block's id would put the reader with that
   * paragraph under the sticky chrome and the masthead off screen, which is not
   * where they were. GPT Sol F8, 2026-09-06. (The `scrollY === 0` that follows
   * from it is not observable in jsdom, which has no scrolling; the branch that
   * produces it is what this pins.)
   */
  it("writes the top of the article by taking ?at= away", async () => {
    history.replaceState(null, "", `/read/x?cols=0,2&at=${block(9)}`);
    arm(TOP, block(25));
    push(`/read/x?cols=0,2&at=${block(25)}`);
    expect(readStamp(history.state)).toEqual(TOP);
    await goBack();
    expect(location.search).toBe("?cols=0,2");
  });

  /**
   * **An arm that outlived its jump must not be worn by a later push.**
   *
   * nuqs abandons a queued write when the page navigates, and its flush is up
   * to 50ms away here — 320ms on an older Safari — so an arm whose push never
   * comes is ordinary. The address check alone would not catch this sequence:
   * Back lands on exactly the address the jump was armed at, so a stale arm
   * would match again and a later mode push would wear an origin from before
   * the reader ever left. GPT Sol F14, 2026-09-06.
   */
  it("throws an unclaimed arm away when the reader goes Back", async () => {
    push("/read/x?panel=notes");
    /* Armed on the entry we are about to return to, so that only the popstate
       rule can be what refuses it. */
    armJump({ pathname: "/read/x", from: "/read/x", origin: at(A), target: B });
    await goBack();
    expect(location.search).toBe("");
    push(`/read/x?at=${B}`);
    expect(readStamp(history.state)).toBeNull();
  });

  /**
   * **State that is not ours to merge into is forwarded, not flattened.**
   *
   * `typeof x === "object"` is true of a `Date`, a `Map` and every class
   * instance, and spreading one into `{}` throws its data away — a `Date`
   * spreads to nothing, which the old code then stored as `null`. Nothing in
   * this repo writes such a state today; a browser restoring one, or a router
   * added later, must not lose it to a chip. GPT Sol F15, 2026-09-06.
   */
  it("preserves a state it cannot merge into rather than emptying it", () => {
    const when = new Date(0);
    history.replaceState(when, "", "/read/x");
    expect(history.state).toEqual(when);
  });

  /**
   * **Half a pair is worse than neither half.** The predecessor rewrite is the
   * irreversible one; doing it and only then discovering the destination cannot
   * carry a stamp would leave the reader an honest predecessor and no chip to
   * reach it with. GPT Sol F16, 2026-09-06.
   */
  it("leaves the predecessor alone when the destination cannot be stamped", async () => {
    history.replaceState(null, "", `/read/x?at=${block(9)}`);
    arm(at(block(15)), block(25));
    /* An array: a state `withStamp` forwards untouched rather than merging. */
    history.pushState([1, 2, 3], "", `/read/x?at=${block(25)}`);
    expect(readStamp(history.state)).toBeNull();
    expect(history.state).toEqual([1, 2, 3]);
    await goBack();
    expect(location.search).toBe(`?at=${block(9)}`);
  });
});

/** Step back one entry and wait for the browser to actually be there. */
async function goBack(): Promise<void> {
  const landed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history.back();
  await landed;
}

/* ------------------------------------------------------------- the jump -- */

/** A table the reading view would recognise, with each row's top pinned. */
function layOut(tops: number[]): void {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (const [i, top] of tops.entries()) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", block(i));
    tr.getBoundingClientRect = () =>
      ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top }) as DOMRect;
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);
}

/** Rows 0–15 have gone past the reading line; 16 onwards have not. */
const READING_AT_15 = Array.from({ length: 30 }, (_, i) => (i <= 15 ? -10 : 500));

/**
 * **Every row still below the line** — the masthead, the byline and the
 * controls are on screen and no article row has arrived yet. This is the layout
 * at the top of an article, and it stays this layout for the several hundred
 * pixels it takes to scroll the masthead away.
 */
const NOTHING_REACHED = Array.from({ length: 30 }, (_, i) => 200 + i * 100);

const BLOCKS: Block[] = Array.from({ length: 30 }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: `para ${i}`,
  words: 2,
  html: `<p>para ${i}</p>`,
  gistable: true,
}));

/** Every value of `?at=` React was rendered with, in order. */
let seen: (BlockId | null)[] = [];
let host: HTMLDivElement;
let root: Root;
/** The jump's own write — `jumpTo` in reader/useReadingPosition.ts, byte for byte. */
let pushAt: ((id: BlockId) => void) | null = null;
/** The scroll spy's write: a replace, queued behind atParam's 300ms debounce. */
let queueAt: ((id: BlockId) => void) | null = null;

function Position(): ReactNode {
  const [value, set] = useQueryState("at", atParam);
  seen.push(value as BlockId | null);
  pushAt = (id) => {
    void set(id, { history: "push", limitUrlUpdates: throttle(0) });
  };
  queueAt = (id) => void set(id);
  return null;
}

/** Exactly what the reader's `jumpTo` does, minus its `synced` bookkeeping. */
function jump(target: BlockId): boolean {
  return beginJump(BLOCKS, target, (id) => pushAt?.(id));
}

/**
 * Wait for nuqs to flush the push.
 *
 * **Longer than a tick, and `throttle(0)` is why it has to be.** The queue's
 * `timeMs` is reset to `defaultRateLimit.timeMs` — 50 outside Safari — on every
 * reset, and `push` only ever raises it (`if (timeMs > this.timeMs)`), so
 * `throttle(0)` cannot lower it. The flush therefore lands up to 50ms after the
 * setter, not on the next task, and the delay is the *remainder* of that window
 * since the last flush — which is why a one-tick wait passed whenever the
 * previous test happened to be slow and failed whenever it was quick. That is
 * the shape of a test that is really a coin toss, so this waits past the whole
 * window rather than past the tick. nuqs/dist/debounce-*.js § ThrottledQueue.
 */
async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

describe("the jump transaction", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/read/x");
    /* Scrolled down by default, so `measureOrigin` reads the table rather than
       short-circuiting to the top. jsdom's scrollY is writable. */
    Object.defineProperty(window, "scrollY", { value: 1000, writable: true, configurable: true });
    clearArmedJump();
    dismissJumpOrigin();
    document.body.replaceChildren();
    scrolled.length = 0;
    seen = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(NuqsAdapter, null, createElement(Position))));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const query = () => new URLSearchParams(location.search).get("at");

  /**
   * **`?at=` lags on purpose.** It holds a section, and after a jump to a finer
   * block it deliberately keeps that finer block while the reader scrolls
   * around inside its section (position.ts § positionToWrite, and
   * tests/reading-position.test.ts § two presses). So the address can name
   * block 12 while the reader stands at block 15, and only a measurement knows
   * which. GPT Sol F1, 2026-09-06.
   */
  it("records where the reader is, not the stale fine block in the address", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    layOut(READING_AT_15);
    act(() => void jump(block(25)));
    await settled();
    expect(query()).toBe(block(25));
    expect(readStamp(history.state)).toEqual(at(block(15)));
    await act(async () => await goBack());
    expect(query()).toBe(block(15));
  });

  /**
   * At the top there is no block under the reading line, and yet `measureRow()`
   * answers 0 because `activeSectionIndex` clamps there. The origin has to be
   * `top` — F8.
   */
  it("records the top of the article as the top, not as its first block", async () => {
    Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
    layOut(NOTHING_REACHED);
    expect(query()).toBeNull();
    act(() => void jump(block(20)));
    await settled();
    expect(query()).toBe(block(20));
    expect(readStamp(history.state)).toEqual(TOP);
    await act(async () => await goBack());
    expect(query()).toBeNull();
  });

  /**
   * **The band F8's own fix left open.** The first cut asked
   * `window.scrollY <= stickyOffset()`, so a reader who had scrolled a little —
   * past the offset, but not far enough to bring any row to the reading line —
   * counted as standing on a block, and `measureRow()` clamps to row 0
   * throughout. The jump recorded the first block, and Back put that paragraph
   * under the chrome with the masthead gone. The masthead scrolls above the
   * table, so the band is several hundred pixels deep rather than a corner.
   * GPT Sol F13, 2026-09-06.
   */
  it("records the top while the masthead is still on screen, scrolled or not", async () => {
    Object.defineProperty(window, "scrollY", { value: 150, writable: true, configurable: true });
    layOut(NOTHING_REACHED);
    act(() => void jump(block(20)));
    await settled();
    expect(readStamp(history.state)).toEqual(TOP);
    await act(async () => await goBack());
    expect(query()).toBeNull();
  });

  /**
   * **F10, and the assertion that matters is the scroll rather than the URL.**
   *
   * The history write and `scrollToBlock` used to be independent statements, so
   * suppressing only the push would leave the movement — and a tall paragraph
   * can be crossing the reading line while its top is far above the viewport,
   * which search makes reachable by calling `onJump` even for a result already
   * on screen. The reader would be moved with no chip and no way back, so the
   * whole jump is abandoned.
   */
  it("does nothing at all when the target is the block at the reading line", async () => {
    layOut(READING_AT_15);
    const entries = history.length;
    expect(jump(block(15))).toBe(false);
    await settled();
    expect(scrolled).toEqual([]);
    expect(history.length).toBe(entries);
    expect(query()).toBeNull();
    expect(readStamp(history.state)).toBeNull();
  });

  /**
   * **One render.** The wrapper rewrites the predecessor and pushes the
   * destination back to back against the functions it captured, so **no React
   * or nuqs subscriber sees the address in between**: the only `?at=` React is
   * ever given is the destination. (Something *can* see the two writes — the
   * recorder installed between the two history patches, § performs the pair,
   * which is the point of that test.) A transaction that instead asked nuqs for
   * the predecessor
   * rewrite would render the **origin** first, and `useReadingPosition`'s
   * restore effect — which scrolls whenever `at` is not the value it last
   * synced — would drag the reader back to where they came from and then
   * forward again.
   */
  it("never renders the intermediate origin", async () => {
    layOut(READING_AT_15);
    seen = [];
    act(() => void jump(block(25)));
    await settled();
    expect(seen.at(-1)).toBe(block(25));
    expect(seen).not.toContain(block(15));
  });

  /**
   * **What the render assertion above cannot say**, and the reason both are
   * here. React batches: a transaction split into two ordinary writes in one
   * task would render as one update too, and § never renders the intermediate
   * origin would go on passing. So this looks *underneath* our wrapper instead
   * (§ a tap between the two patches) and pins the construction: one replace
   * carrying the origin and one push carrying the destination, back to back,
   * **both wearing nuqs's own `__nuqs__` marker** — which is what makes nuqs's
   * patch skip its `sync()` on the pair and hand the hooks a single update. Let
   * the marker slip on either call and nuqs would publish the intermediate
   * address to every parameter hook in the app. GPT Sol F17, 2026-09-06.
   */
  it("performs the pair beneath nuqs, both writes carrying its marker", async () => {
    layOut(READING_AT_15);
    inner.length = 0;
    act(() => void jump(block(25)));
    await settled();
    expect(inner).toEqual([
      { kind: "replace", marker: "__nuqs__", url: expect.stringContaining(`at=${block(15)}`) },
      { kind: "push", marker: "__nuqs__", url: expect.stringContaining(`at=${block(25)}`) },
    ]);
  });

  /**
   * A scroll write is queued behind a 300ms debounce (params.ts § atParam), and
   * a reader who clicks within that window has one in flight. It must not land
   * on the entry the jump just pushed and overwrite the destination with where
   * they were half a second ago.
   */
  it("discards a position write that was still queued when the jump landed", async () => {
    layOut(READING_AT_15);
    act(() => void queueAt?.(block(8)));
    act(() => void jump(block(25)));
    await settled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(query()).toBe(block(25));
    expect(readStamp(history.state)).toEqual(at(block(15)));
  });
});
