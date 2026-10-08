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
 *    entries carry a stamp and which one. The sharpest case is § carries
 *    the stamp unchanged: nuqs hands `pushState` the **current**
 *    entry's state verbatim, so what a push carries has to be decided by
 *    `stampFor` rather than inherited by accident — which is what it was until
 *    2026-09-16, when the cure was to strip it and the chip went with it
 *    (docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md).
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
  armReturn,
  clearArmedJump,
  consumeArmedJump,
  isJumpArmed,
  jumpedFrom,
  type JumpOrigin,
  type JumpStamp,
  MAX_EARLIER,
  oneJourneyBack,
  readStamp,
  withStamp,
} from "../src/web/jump-history.js";
import { beginJump } from "../src/web/keynav.js";
import { atParam, termParam } from "../src/web/params.js";
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

/* A stamp, which is an origin **and** the journey behind it. Defaulting to no
   journey keeps every case below reading as a statement about the origin, which
   is what they are about; `earlier` has a section of its own further down. */
const stamp = (origin: JumpOrigin, earlier: readonly JumpOrigin[] = []): JumpStamp => ({
  origin,
  earlier,
});

/* ------------------------------------------------------------- the stamp -- */

describe("the stamp on a history entry", () => {
  it("round-trips a block origin", () => {
    expect(readStamp(withStamp(null, stamp(at(A))))).toEqual(stamp(at(A)));
  });

  /** The top of the article is a case of its own all the way through — F8. */
  it("round-trips the top of the article, distinctly from any block", () => {
    expect(readStamp(withStamp(null, stamp(TOP)))).toEqual(stamp(TOP));
  });

  /** The journey behind the origin, top and blocks alike, in order. */
  it("round-trips the earlier origins, in order", () => {
    const written = stamp(at(A), [TOP, at(B), at(block(9))]);
    expect(readStamp(withStamp(null, written))).toEqual(written);
  });

  /** Nothing else writes `history.state` today; that is not a reason to eat it. */
  it("preserves foreign keys when it writes, and when it strips", () => {
    const stamped = withStamp({ scroll: 3 }, stamp(at(A))) as Record<string, unknown>;
    expect(stamped.scroll).toBe(3);
    expect(readStamp(stamped)).toEqual(stamp(at(A)));
    expect(withStamp(stamped, null)).toEqual({ scroll: 3 });
  });

  /** `{}` on every entry would be litter with no owner. */
  it("strips to null rather than to an empty object", () => {
    expect(withStamp(withStamp(null, stamp(at(A))), null)).toBeNull();
    expect(withStamp(null, null)).toBeNull();
  });

  it("replaces an older stamp rather than nesting one", () => {
    expect(readStamp(withStamp(withStamp(null, stamp(at(A))), stamp(at(B))))).toEqual(
      stamp(at(B)),
    );
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
    [{ spya: { v: 3, origin: 7, earlier: [] } }, "an origin that is not a string"],
    [{ spya: { v: 3, origin: "n0003", earlier: [] } }, "a node id, which is not a block id"],
    [{ spya: { v: 3, origin: "spya-parab", earlier: [] } }, "an id one character short"],
    [
      { spya: { v: 3, origin: "spya-para15", earlier: [] } },
      "an id using characters the alphabet drops",
    ],
    [{ spya: { v: 2, origin: 7, depth: 1 } }, "a v2 origin that is not a string"],
    [{ spya: { v: 2, origin: "n0003", depth: 1 } }, "a v2 node id, which is not a block id"],
    [{ spya: { v: 9, origin: "spya-paraaa", earlier: [] } }, "a version from the future"],
    [
      { spya: { v: 9, from: "spya-paraaa", origin: "spya-paraaa", earlier: [] } },
      "a future version that happens to reuse the legacy field",
    ],
    [{ spya: { v: 1, origin: "spya-paraaa" } }, "a version that never existed"],
  ])("reads %j (%s) as no stamp", (state) => {
    expect(readStamp(state)).toBeNull();
  });

  /**
   * **The shapes earlier deploys wrote**, which a reader who kept a tab open
   * across a deploy still has on their entries. They read as an origin with no
   * journey behind it: the legacy chip was `history.back()`, the v2 one walked
   * `depth` entries, and neither recorded where the reader had been before. A
   * v2 `depth` is not read at all any more — the chip no longer walks the stack
   * — so even a depth the old reader would have refused still yields the origin.
   */
  it("reads a stamp from an earlier deploy as an origin with nothing behind it", () => {
    expect(readStamp({ spya: { from: A } })).toEqual(stamp(at(A)));
    expect(readStamp({ spya: { from: "top" } })).toEqual(stamp(TOP));
    expect(readStamp({ spya: { v: 2, origin: A, depth: 3 } })).toEqual(stamp(at(A)));
    expect(readStamp({ spya: { v: 2, origin: "top", depth: 1 } })).toEqual(stamp(TOP));
    expect(readStamp({ spya: { v: 2, origin: A, depth: 99999 } })).toEqual(stamp(at(A)));
    expect(readStamp({ spya: { v: 2, origin: A } })).toEqual(stamp(at(A)));
  });

  /**
   * **A bad journey costs the journey, not the chip.** The origin is what the
   * label names and what a press moves to; `earlier` only decides what is left
   * *after* the press, so a malformed one reads as empty rather than hiding an
   * origin that is perfectly good.
   */
  it.each<[unknown, string]>([
    ["spya-parabf", "a string rather than a list"],
    [{ 0: A }, "an object rather than a list"],
    [null, "null"],
    [[7], "an entry that is not a string"],
    [[A, "n0003"], "one bad id among good ones"],
    [["spya-para15"], "an id using characters the alphabet drops"],
  ])("reads an earlier of %j (%s) as empty", (earlier) => {
    expect(readStamp({ spya: { v: 3, origin: A, earlier } })).toEqual(stamp(at(A)));
  });

  it("reads a v3 stamp with no earlier at all as empty", () => {
    expect(readStamp({ spya: { v: 3, origin: A } })).toEqual(stamp(at(A)));
  });

  /**
   * **A journey past the cap reads as empty, not clamped**: the same refusal to
   * guess that the old depth ceiling made. `withStamp` never writes more than
   * the cap, so a longer list is somebody else's.
   */
  it("accepts a journey of exactly the cap and reads a longer one as empty", () => {
    const origins = (n: number) => Array.from({ length: n }, (_, i) => block(i % 30));
    const read = (n: number) => readStamp({ spya: { v: 3, origin: A, earlier: origins(n) } });
    expect(read(MAX_EARLIER)?.earlier).toHaveLength(MAX_EARLIER);
    expect(read(MAX_EARLIER + 1)).toEqual(stamp(at(A)));
  });

  /** Writing never produces what reading refuses, however long the journey handed in. */
  it("writes no more than the cap", () => {
    const long = stamp(
      at(A),
      Array.from({ length: MAX_EARLIER + 10 }, () => at(B)),
    );
    expect(readStamp(withStamp(null, long))?.earlier).toHaveLength(MAX_EARLIER);
  });

  /**
   * **And the other direction fails closed**, which is the half that cannot be
   * checked by running this code — so it is checked by *shape*.
   *
   * A rollback puts the previous bundle in front of entries this one stamped.
   * The oldest of those parsers reads `mine.from`, and what it does with a
   * missing one is return `null`: no chip. If a `from` key ever reappeared in
   * what `withStamp` writes, that bundle would draw a chip and press it with a
   * `history.back()` the label does not name. GPT Sol's first finding on the
   * plan, 2026-09-16. The `v` is 3 for the same reason: the v2 reader rejects
   * any other version.
   */
  it("writes nothing an older bundle would mistake for a stamp it can honour", () => {
    const written = withStamp(null, stamp(at(A), [at(B)])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(written.spya).toBeDefined();
    expect(written.spya).not.toHaveProperty("from");
    expect(written.spya).not.toHaveProperty("depth");
    expect(written.spya?.v).toBe(3);
  });

  /* --------------------------------------------------------- the journey -- */

  /**
   * **A jump pushes the place the reader was onto the journey behind it** —
   * newest first, so the next return finds the nearest one at the front.
   */
  it("starts a journey with nothing behind it when there was no stamp", () => {
    expect(jumpedFrom(at(A), null)).toEqual(stamp(at(A)));
  });

  it("puts the stamp it was standing on in front of the earlier ones", () => {
    const first = jumpedFrom(at(A), null);
    const second = jumpedFrom(at(B), first);
    const third = jumpedFrom(TOP, second);
    expect(second).toEqual(stamp(at(B), [at(A)]));
    expect(third).toEqual(stamp(TOP, [at(B), at(A)]));
  });

  /** A chain of jumps cannot outgrow what the reader accepts — the cap again. */
  it("drops the oldest origin rather than growing past the cap", () => {
    const full = stamp(
      at(A),
      Array.from({ length: MAX_EARLIER }, (_, i) => at(block(i % 30))),
    );
    const next = jumpedFrom(at(B), full);
    expect(next.earlier).toHaveLength(MAX_EARLIER);
    expect(next.earlier[0]).toEqual(at(A));
    expect(next.earlier.at(-1)).toEqual(full.earlier[MAX_EARLIER - 2]);
  });

  /**
   * **After a return, the stamp is the journey before that one** — the nearest
   * of `earlier` becomes the origin and the rest stay behind it. The wrapper
   * writes this on the entry the press makes (router.ts § `stampFor`).
   */
  it("steps back along the journey one origin at a time", () => {
    const deep = stamp(at(A), [at(B), TOP]);
    const once = oneJourneyBack(deep);
    expect(once).toEqual(stamp(at(B), [TOP]));
    const twice = oneJourneyBack(once as JumpStamp);
    expect(twice).toEqual(stamp(TOP));
    expect(oneJourneyBack(twice as JumpStamp)).toBeNull();
  });

  it("has nowhere further back when the journey is empty", () => {
    expect(oneJourneyBack(stamp(at(A)))).toBeNull();
  });

  /**
   * **A stamp from an earlier deploy has no journey, so a return from it ends
   * it.** Asserted on the pure pair rather than by driving `history`, because
   * there is no way to *put* a legacy stamp on an entry from inside a test —
   * the wrapper's `replaceState` re-derives the stamp from the entry it finds
   * and ignores what the caller passed, on purpose (router.ts §
   * `dismissJumpOrigin` has why).
   */
  it("treats a stamp from an earlier deploy as a one-stop journey", () => {
    expect(oneJourneyBack(readStamp({ spya: { from: A } }) as JumpStamp)).toBeNull();
  });

  /**
   * A state that is not a plain object has no keys to merge into, so stamping
   * it would mean throwing somebody else's value away. The chip is worth less
   * than that, so we decline and leave the state alone.
   */
  it("declines to stamp a state it cannot merge into", () => {
    expect(withStamp("theirs", stamp(at(A)))).toBe("theirs");
    expect(withStamp([1, 2], stamp(at(A)))).toEqual([1, 2]);
  });
});

/* --------------------------------------------------- the arm/consume pair -- */

describe("arming a jump", () => {
  const HERE = "/read/x?at=spya-paraaa";
  const arm = () => armJump({ pathname: "/read/x", from: HERE, origin: at(A), target: B });

  beforeEach(() => clearArmedJump());

  it("hands the origin back once and then nothing", () => {
    arm();
    expect(consumeArmedJump(HERE, "/read/x", B)).toStrictEqual({
      kind: "jump",
      origin: at(A),
      base: undefined,
    });
    expect(consumeArmedJump(HERE, "/read/x", B)).toBeNull();
  });

  it("lets a marked nuqs batch carry a jump after the position spy retargets it", () => {
    arm();
    expect(consumeArmedJump(HERE, "/read/x", block(9), true)).toStrictEqual({
      kind: "jump",
      origin: at(A),
      base: undefined,
    });
  });

  it("is empty until something arms it", () => {
    expect(consumeArmedJump(HERE, "/read/x", B)).toBeNull();
  });

  /**
   * A push that is not this jump's must not be able to wear its origin. It also
   * ends the arm: nuqs has one global queue, so an actual different push means
   * the expected flush was superseded or abandoned.
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
  ])("refuses (%s) and ends the arm", (here, pathname, target) => {
    arm();
    expect(consumeArmedJump(here, pathname, target)).toBeNull();
    expect(isJumpArmed()).toBe(false);
  });
});

/**
 * **Arming a return** — the other thing the handshake carries. The return chip
 * pushes `?at=` onto the address the reader is on (keynav.ts § `beginReturn`),
 * and the wrapper has to know that push is the chip's, so that it writes the
 * journey that is left rather than carrying the stamp it was standing on.
 */
describe("arming a return", () => {
  const HERE = "/read/x?at=spya-paraaa";
  const NEXT = stamp(at(B), [TOP]);
  const armBack = (target: BlockId | null, next: JumpStamp | null = NEXT) =>
    armReturn({ pathname: "/read/x", from: HERE, target, next });

  beforeEach(() => clearArmedJump());

  it("hands the next stamp back once and then nothing", () => {
    armBack(B);
    expect(consumeArmedJump(HERE, "/read/x", B)).toEqual({ kind: "return", next: NEXT });
    expect(consumeArmedJump(HERE, "/read/x", B)).toBeNull();
  });

  /** The last stop on a journey: nothing is left, and the claim says so. */
  it("hands back null, not nothing, when there is no journey left", () => {
    armBack(B, null);
    expect(consumeArmedJump(HERE, "/read/x", B)).toEqual({ kind: "return", next: null });
  });

  /**
   * **A return to the top is a push with no `?at=`**, which `atOfWrite` reads as
   * `null` — the same way a jump's predecessor writes the top (§ writes the top
   * of the article by taking ?at= away).
   */
  it("matches a push with no ?at= when the return is to the top", () => {
    armBack(null);
    expect(consumeArmedJump(HERE, "/read/x", null)).toEqual({ kind: "return", next: NEXT });
  });

  it("is claimed by a return to the top only by a push that names no block", () => {
    armBack(null);
    expect(consumeArmedJump(HERE, "/read/x", B)).toBeNull();
    expect(isJumpArmed()).toBe(false);
  });

  it("lets a marked nuqs batch carry a return after the position spy retargets it", () => {
    armBack(B);
    expect(consumeArmedJump(HERE, "/read/x", block(9), true)).toEqual({
      kind: "return",
      next: NEXT,
    });
  });

  it("does not let an unmarked push retarget a return", () => {
    armBack(B);
    expect(consumeArmedJump(HERE, "/read/x", block(9), false)).toBeNull();
    expect(isJumpArmed()).toBe(false);
  });

  /** The same refusals a jump's arm makes, for the same reasons (F14 above). */
  it.each<[string, string, BlockId | null, string]>([
    [HERE, "/read/y", B, "another article"],
    [HERE, "/read/x", block(9), "another block"],
    [HERE, "/read/x", null, "a push that names no block at all"],
    ["/read/x?at=spya-parabf", "/read/x", B, "a push from an address the reader has since left"],
  ])("refuses (%s) and ends the arm", (here, pathname, target) => {
    armBack(B);
    expect(consumeArmedJump(here, pathname, target)).toBeNull();
    expect(isJumpArmed()).toBe(false);
  });

  /** Arming one kind replaces the other: there is one slot, and the latest wins. */
  it("is replaced by a jump armed after it, and the other way round", () => {
    armBack(B);
    armJump({ pathname: "/read/x", from: HERE, origin: at(A), target: B });
    expect(consumeArmedJump(HERE, "/read/x", B)).toEqual({
      kind: "jump",
      origin: at(A),
      base: NEXT,
    });
    armJump({ pathname: "/read/x", from: HERE, origin: at(A), target: B });
    armBack(B);
    expect(consumeArmedJump(HERE, "/read/x", B)).toEqual({ kind: "return", next: NEXT });
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

/** The return chip's arm, from wherever the address currently is. */
function armBack(target: BlockId | null, next: JumpStamp | null): void {
  armReturn({
    pathname: location.pathname,
    from: location.pathname + location.search,
    target,
    next,
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
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
  });

  /**
   * **A later push on the same article carries the stamp unchanged**, which is
   * the reversal of 2026-09-16 and the point of the whole change
   * (docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md).
   *
   * This test used to assert the opposite, on GPT Sol's F3 of 2026-09-06: nuqs
   * passes the *current* entry's state into `pushState` verbatim
   * (nuqs/dist/adapters/react.js), so a `cols`, `mode` or `sort` toggle after a
   * jump inherited that jump's origin and drew a chip on an entry whose
   * `history.back()` merely undid the toggle. **That reading was right about
   * the bug and wrong about the cure.** The chip was pointing at the correct
   * origin; it was the *press* that was one entry short. Dropping the stamp
   * fixed the lie by removing the offer — and on a phone, where a covering band
   * means leaving the mode is the only way to see where a jump landed, removing
   * the offer is all it ever did.
   *
   * Since 2026-10-08 the press no longer walks the stack at all, so the
   * distance that was recorded alongside the origin is gone and the stamp rides
   * along as it is. Nothing is inherited blindly: `stampFor` re-derives it from
   * the entry we are standing on rather than trusting the state nuqs handed
   * through, so what the push carries is decided here whatever nuqs does with it.
   */
  it("carries the stamp unchanged on a later push", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    push("/read/x?cols=0,2");
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
    push("/read/x?cols=0,2&mode=citations");
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
  });

  /**
   * **And a push that leaves the article drops it**, which is the half of the
   * old rule that was always right. The label is a section title resolved
   * against *this* article's sections, and a way back to a place in another
   * document is not an offer this chip can make.
   */
  it("drops the stamp on a push that leaves the article", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    push("/read/y");
    expect(readStamp(history.state)).toBeNull();
  });

  /**
   * **A second jump makes a new stamp and keeps the old one behind it.** The
   * arm wins: the entry the reader is leaving *is* the new origin, so a chip
   * pointing at the first jump would be wrong two jumps in. What the reader was
   * standing on before goes into `earlier`, so a return can find it again.
   */
  it("puts the inherited origin behind a fresh jump's own", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    push("/read/x?cols=0,2");
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
    arm(at(B), block(9));
    push(`/read/x?at=${block(9)}&cols=0,2`);
    expect(readStamp(history.state)).toEqual(stamp(at(B), [at(A)]));
  });

  /** And a third, and the top among them: the journey is a list, not a pair. */
  it("chains jumps newest first, including the top of the article", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    arm(TOP, block(9));
    push(`/read/x?at=${block(9)}`);
    arm(at(block(5)), block(12));
    push(`/read/x?at=${block(12)}`);
    expect(readStamp(history.state)).toEqual(stamp(at(block(5)), [TOP, at(A)]));
  });

  /**
   * **A return writes what the press left, and nothing it inherited.** Standing
   * on a stamp with a journey behind it, the return's push carries `next` — the
   * journey minus the stop just taken — rather than the stamp it was made on.
   */
  it("writes a return's next stamp on the push the return armed", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    arm(at(B), block(9));
    push(`/read/x?at=${block(9)}`);
    const here = readStamp(history.state) as JumpStamp;
    expect(here).toEqual(stamp(at(B), [at(A)]));
    armBack(B, oneJourneyBack(here));
    push(`/read/x?at=${B}`);
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
  });

  /** The last stop: the return's entry carries no stamp, so no chip is offered. */
  it("strips the stamp on a return with nothing left behind it", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    armBack(A, null);
    push(`/read/x?at=${A}`);
    expect(readStamp(history.state)).toBeNull();
    expect(isJumpArmed()).toBe(false);
  });

  /** A return to the top is a push with `?at=` taken away. */
  it("claims a return to the top on a push that drops ?at=", () => {
    arm(TOP, B);
    push(`/read/x?at=${B}`);
    armBack(null, null);
    push("/read/x");
    expect(readStamp(history.state)).toBeNull();
    expect(isJumpArmed()).toBe(false);
  });

  /**
   * **A push that is not the return's does not claim it**, and does not wear its
   * `next` either: it takes the ordinary same-article rule and carries the
   * stamp it was standing on, and the arm is spent.
   */
  it("leaves a return's arm unclaimed by a push to a different block", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    armBack(A, null);
    push(`/read/x?at=${block(9)}`);
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
    expect(isJumpArmed()).toBe(false);
  });

  /** A return arm is not a jump: it must not rewrite the entry it leaves. */
  it("does not rewrite the predecessor's ?at= for a return", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    armBack(A, null);
    inner.length = 0;
    push(`/read/x?at=${A}`);
    expect(inner.map((w) => w.kind)).toEqual(["push"]);
  });

  /** The counterpart: a replace must **not** lose it, or the chip blinks out. */
  it("keeps the stamp across a replace, whatever the caller passed", () => {
    arm(at(A), B);
    push(`/read/x?at=${B}`);
    history.replaceState(null, "", `/read/x?at=${block(9)}`);
    expect(readStamp(history.state)).toEqual(stamp(at(A)));
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
    expect(readStamp(history.state)).toEqual(stamp(TOP));
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
   * A non-nuqs history write makes nuqs reset its queue. If that queue held the
   * armed jump, the expected push will never arrive, so the wrapper that saw
   * the write must end the arm just as `popstate` does. Leaving it armed hides
   * the chip and rail mark on every later entry because their snapshots refuse
   * to make a claim while a jump is supposedly still in flight.
   */
  it("throws an unclaimed arm away when another push abandons the jump", () => {
    arm(at(A), B);
    expect(isJumpArmed()).toBe(true);

    push("/read/x?mode=plain");

    expect(isJumpArmed()).toBe(false);
  });

  it("throws an unclaimed arm away when a replace abandons the jump", () => {
    arm(at(A), B);
    expect(isJumpArmed()).toBe(true);

    history.replaceState(history.state, "", "/read/x?mode=plain");

    expect(isJumpArmed()).toBe(false);
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
/**
 * **A second parameter, written with a replace** — `?term=`, which is what the
 * glossary sets as it jumps (GlossaryPanel § onSelect writes the term and then
 * calls `onJump`). It is here because the arm has to survive it: see § a panel
 * that writes another parameter.
 */
let setTerm: ((id: string | null) => void) | null = null;

function Position(): ReactNode {
  const [value, set] = useQueryState("at", atParam);
  const [, setTermId] = useQueryState("term", termParam);
  seen.push(value as BlockId | null);
  pushAt = (id) => {
    void set(id, { history: "push", limitUrlUpdates: throttle(0) });
  };
  queueAt = (id) => void set(id);
  setTerm = (id) => void setTermId(id);
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
  /**
   * **A panel that writes another parameter as it jumps must not lose the
   * stamp**, and this is the test that stands underneath a change made on
   * 2026-09-16: a `replaceState` reaching the wrapper now **ends** any armed
   * jump, because nuqs has one global queue and a different flush means the
   * expected one was superseded or abandoned (GPT Sol's third finding on the
   * built code).
   *
   * That is only safe if a replace cannot land *between* the arm and the jump's
   * own flush — and the case that would do it is ordinary rather than exotic.
   * The glossary writes `?term=` (a replace) and then calls `onJump` (a push)
   * in one click handler; ideas and quotes do the same with their own
   * parameters. nuqs coalesces both into a single flush, and a batch containing
   * a push is pushed, so the arm meets its own write.
   *
   * Written because the alternative was to take that on trust. If nuqs ever
   * stops merging them, this goes red and says so, rather than the chip quietly
   * never appearing from the glossary again.
   */
  it("keeps the stamp when a panel writes another parameter in the same click", async () => {
    layOut(READING_AT_15);
    act(() => {
      setTerm?.("spya-tgnssb");
      void jump(block(25));
    });
    await settled();
    expect(query()).toBe(block(25));
    expect(new URLSearchParams(location.search).get("term")).toBe("spya-tgnssb");
    expect(readStamp(history.state)).toEqual(stamp(at(block(15))));
  });

  /** And in the other order, since a handler may jump before it selects. */
  it("keeps the stamp when the other parameter is written after the jump", async () => {
    layOut(READING_AT_15);
    act(() => {
      void jump(block(25));
      setTerm?.("spya-tgnssb");
    });
    await settled();
    expect(readStamp(history.state)).toEqual(stamp(at(block(15))));
  });

  /**
   * **And on a later tick inside the same flush window**, which is what a
   * handler that selects in a `useEffect` after the render looks like. Still
   * one flush, because the window is nuqs's and is measured from the last
   * flush rather than from each setter.
   */
  it("keeps the stamp when the other parameter is written a tick later", async () => {
    layOut(READING_AT_15);
    act(() => void jump(block(25)));
    act(() => setTerm?.("spya-tgnssb"));
    await settled();
    expect(readStamp(history.state)).toEqual(stamp(at(block(15))));
  });

  /**
   * **The abandonment the arm-clearing rule exists for, shown happening.**
   *
   * A `replaceState` that reaches the wrapper without nuqs's own marker makes
   * nuqs run `sync()`, which **resets its update queue** before it notices
   * nothing has changed (nuqs/dist/patch-history-*.js) — the same mechanism
   * `dismissJumpOrigin` wears the marker to avoid, recorded there as GPT Sol
   * F20 of 2026-09-06.
   *
   * So a jump caught by one does not merely lose its stamp: its queued write is
   * **thrown away entirely**. The push never comes, `?at=` never names the
   * destination, and — before 2026-09-16 — the arm waiting for that push
   * stayed armed. `isJumpArmed()` is what withholds the chip while a jump is in
   * flight, so a jump that never lands used to hide the chip *and* the rail's
   * origin mark until the next `popstate` or the next jump. GPT Sol's third
   * finding on the built code.
   *
   * Hence: any push that does not claim the arm, and any replace, ends it. The
   * three cases above are what says that rule is safe — every real panel that
   * writes a parameter as it jumps goes through nuqs, which merges the pair
   * into one pushed flush and never reaches this path at all.
   */
  it("ends an arm whose queued write a bare replace threw away", async () => {
    layOut(READING_AT_15);
    act(() => void jump(block(25)));
    expect(isJumpArmed()).toBe(true);
    /* Not through nuqs: straight at the patched wrapper, which is where any
       non-nuqs writer arrives. */
    act(() => history.replaceState(history.state, "", location.pathname + location.search));
    await settled();

    /* nuqs abandoned the write, so the address never moved and no entry was
       pushed — which is the pre-existing behaviour this test is not about. */
    expect(query()).toBeNull();
    expect(readStamp(history.state)).toBeNull();
    /* What this test *is* about: nothing is left waiting for a push that will
       never come, so the next jump's chip is not withheld by this one. */
    expect(isJumpArmed()).toBe(false);
  });

  it("records where the reader is, not the stale fine block in the address", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    layOut(READING_AT_15);
    act(() => void jump(block(25)));
    await settled();
    expect(query()).toBe(block(25));
    expect(readStamp(history.state)).toEqual(stamp(at(block(15))));
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
    expect(readStamp(history.state)).toEqual(stamp(TOP));
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
    expect(readStamp(history.state)).toEqual(stamp(TOP));
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
    /* "Nothing" is the history and the scroll: since 2026-09-28 this branch
       also flashes the block (tests/begin-jump-flash.test.ts), which looks the
       row up with `CSS.escape` — absent from jsdom. The ids are `[a-z0-9-]`. */
    globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
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
    expect(readStamp(history.state)).toEqual(stamp(at(block(15))));
  });
});
