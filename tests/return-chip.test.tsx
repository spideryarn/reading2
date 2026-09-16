// @vitest-environment jsdom
/**
 * **The chip that says where the reader jumped from, and when it is not there.**
 *
 * Stage A put a stamp on the entry a jump pushes (tests/jump-history.test.ts);
 * this is the half the reader can see. Stage B of
 * docs/plans/260906g-back-to-where-you-jumped-from.md.
 *
 * Three things here are not obvious and each has a test of its own:
 *
 *  - **The chip is drawn from `history.state`, not from the address.** Two
 *    entries can share a URL and differ only in the stamp, so a store keyed on
 *    `pathname + search` — which is what `useAddress` is — would leave the chip
 *    on screen after the stamp had gone. GPT Sol F6, 2026-09-06. § notices a
 *    stamp being stripped at an unchanged URL is that case, and it is the one
 *    that would otherwise ship looking fine.
 *  - **There is no hide rule.** The chip lives exactly as long as the entry's
 *    stamp: no distance, no section equality, nothing inferred. GPT Sol F2.
 *  - **Dismissal is a replace, not a push.** It takes the stamp off the entry
 *    the reader is standing on and adds nothing to the stack, or the escape
 *    from the chip would itself need a press of Back. GPT Sol F12.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryState } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Block, BlockId, NodeId } from "../src/types.js";
import { armJump, clearArmedJump, readStamp } from "../src/web/jump-history.js";
import { atParam } from "../src/web/params.js";
import type { Section } from "../src/web/position.js";
import { ReturnChip } from "../src/web/ReturnChip.js";
import { dismissJumpOrigin, watchHistoryWrites } from "../src/web/router.js";

/* main.tsx's order — nuqs patches first, so ours is the outer wrapper. Both are
   idempotent; a second patch would double every event. */
enableHistorySync();
watchHistoryWrites();

/* Ids in the shape this app mints, because `readStamp` validates them and a
   fixture id it rejects would make every assertion pass for the wrong reason.
   The alphabet drops `1`, `i`, `l` and `o` (src/ids.ts), so a row is spelled
   `a` for 0 through `k` for 9 — row 15 is `spya-parabf`. */
const DIGITS = "abcdefghjk";
const block = (row: number) =>
  `spya-para${String(row)
    .padStart(2, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("")}` as BlockId;

const BLOCKS: Block[] = Array.from({ length: 30 }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: `para ${i}`,
  words: 2,
  html: `<p>para ${i}</p>`,
  gistable: true,
}));

/** Three sections over those thirty blocks, in `buildSections`'s shape. */
const SECTIONS: Section[] = [
  { row: 0, blockId: block(0), nodeId: "n0001" as NodeId, title: "Where it opens" },
  { row: 12, blockId: block(12), nodeId: "n0002" as NodeId, title: "The middle bit" },
  { row: 24, blockId: block(24), nodeId: "n0003" as NodeId, title: "How it ends" },
];

const ROW_OF: ReadonlyMap<BlockId, number> = new Map(BLOCKS.map((b, i) => [b.id, i]));

/** A block id in the right shape that this thirty-block article does not have. */
const GHOST = block(99);

const TOP = { kind: "top" } as const;
const at = (id: BlockId) => ({ kind: "block", blockId: id }) as const;

let host: HTMLDivElement;
let root: Root;

/**
 * The scroll spy's write, queued behind `atParam`'s 300ms debounce.
 *
 * Mounted beside the chip because dismissal has to be shown *not* to cancel it
 * (§ does not cancel a position write). A real `useQueryState` rather than a
 * stand-in, since the whole finding is about nuqs's own queue.
 */
let queueAt: (id: BlockId) => void = () => {};

function Harness(): ReactNode {
  const [, set] = useQueryState("at", atParam);
  queueAt = (id) => void set(id);
  return createElement(ReturnChip, { sections: SECTIONS, rowOf: ROW_OF });
}

function mount(): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(NuqsAdapter, null, createElement(Harness))));
}

const chip = () => host.querySelector(".return-chip");
/** What the return button itself says, whitespace collapsed. */
const label = () =>
  host.querySelector(".return-chip-go")?.textContent?.replace(/\s+/g, " ").trim() ?? null;

/**
 * A jump, as the wrapper sees one: arm the origin, then push the destination.
 * Straight `history.pushState`, which is what nuqs's flush eventually calls.
 */
function jumped(origin: typeof TOP | ReturnType<typeof at>, target: BlockId): void {
  armJump({
    pathname: location.pathname,
    /* The whole address at the moment of arming — the arm belongs to a moment
       rather than to a page (jump-history.ts § `from`, GPT Sol F14). */
    from: location.pathname + location.search,
    origin,
    target,
  });
  act(() => history.pushState(history.state, "", `/read/x?at=${target}`));
}

/** Step back one entry and wait for the browser to actually be there. */
async function goBack(): Promise<void> {
  await traversed(() => history.back());
}

/** And forward, for the sequences that walk both ways. */
async function goForward(): Promise<void> {
  await traversed(() => history.forward());
}

/** Press the chip, and wait for the entry it asked for to arrive. */
async function pressChip(): Promise<void> {
  await traversed(() => host.querySelector<HTMLButtonElement>(".return-chip-go")?.click());
}

/**
 * Any traversal, awaited properly.
 *
 * `history.go` is asynchronous in every implementation — it queues the
 * traversal and fires `popstate` later — so asserting straight after the call
 * reads the entry the reader is *leaving*. Every one of these sequences would
 * pass against a chip that went back the wrong number of entries if the wait
 * were missing, which is the shape silent-success.md is about.
 */
async function traversed(act_: () => void): Promise<void> {
  const landed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  await act(async () => {
    act_();
    await landed;
  });
}

/** Where a landed entry says the reader is. */
const atNow = () => new URLSearchParams(location.search).get("at");

/** An ordinary same-article push: a mode pill, a column toggle, a sort. */
function viewChanged(search: string): void {
  act(() => history.pushState(history.state, "", `/read/x?${search}`));
}

beforeEach(() => {
  history.replaceState(null, "", "/read/x");
  clearArmedJump();
  /* A same-path replace preserves the stamp on purpose, so resetting the
     address is not enough to reset the *entry* — the previous test's origin
     rides in and the chip is already up. GPT Sol F27, 2026-09-06. */
  dismissJumpOrigin();
  document.body.replaceChildren();
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/* ---------------------------------------------------------------- the gate -- */

describe("when the chip is drawn", () => {
  it("draws nothing on an entry with no stamp", () => {
    expect(chip()).toBeNull();
  });

  it("draws on the entry a jump stamped", () => {
    jumped(at(block(15)), block(25));
    expect(chip()).not.toBeNull();
  });

  /**
   * **Not while a jump is in flight**, which is a window of 50ms here and up to
   * 320ms on an older Safari — the gap between the reader asking and nuqs
   * flushing the push that records it.
   *
   * In that gap the page is already scrolling towards the new destination while
   * the entry underneath still describes the *previous* jump. The chip would
   * name the previous origin, and a reader who pressed it would go back one
   * place further than they meant **and** cancel the jump they had just asked
   * for. GPT Sol F19, 2026-09-06 — reproduced against nuqs 2.10.0 before this
   * was written.
   */
  it("draws nothing while a jump is in flight", () => {
    jumped(at(block(15)), block(25));
    expect(chip()).not.toBeNull();
    /* The second jump: armed, and its push not yet flushed. */
    act(() =>
      armJump({
        pathname: location.pathname,
        from: location.pathname + location.search,
        origin: at(block(25)),
        target: block(2),
      }),
    );
    expect(chip()).toBeNull();
  });

  /** And it comes back, saying the new thing, once that push lands. */
  it("draws again on the entry the flight lands on", () => {
    jumped(at(block(15)), block(25));
    jumped(at(block(25)), block(2));
    expect(label()).toBe("↩ back to How it ends");
  });

  /**
   * **F6: two entries can share a URL and differ only in the stamp.** A store
   * snapshotting `pathname + search` — `useAddress` — is equal across the write
   * below, so a chip drawn from the address would stay on screen with nothing
   * behind it. This is the case that would otherwise ship looking fine.
   *
   * **It is driven by a dismissal since 2026-09-16.** It used to be driven by a
   * same-URL *push*, which no longer strips anything: a push that stays on this
   * article now carries the way back one entry further rather than throwing it
   * away (§ a push that does not move the reader). A dismissal is the same
   * event for this test's purposes and a sharper one — the address is
   * byte-for-byte identical, because nothing but the state changed at all.
   */
  it("notices a stamp being stripped at an unchanged URL", () => {
    jumped(at(block(15)), block(25));
    const before = location.pathname + location.search;
    expect(chip()).not.toBeNull();
    act(() => dismissJumpOrigin());
    expect(location.pathname + location.search).toBe(before);
    expect(chip()).toBeNull();
  });

  /** Pressing Back is the ordinary way out, and it fires only `popstate`. */
  it("goes away when the reader presses Back", async () => {
    jumped(at(block(15)), block(25));
    await act(async () => await goBack());
    expect(chip()).toBeNull();
  });

  /**
   * A stamp minted before the article was re-extracted names a block that is
   * no longer there. `scrollToBlock` would give it the same graceful nothing a
   * stale `?at=` gets; a chip that did nothing when pressed is worse than no
   * chip.
   */
  it("draws nothing for a stamp naming a block this article does not have", () => {
    jumped(at(GHOST), block(25));
    expect(readStamp(history.state)).toEqual({ origin: at(GHOST), depth: 1 });
    expect(chip()).toBeNull();
  });
});

/* ------------------------------------------- the same place, another view -- */

/**
 * **A push that changes how the reader is looking, not where they are.**
 *
 * Sentry SPIDERYARN-READING2-41, 2026-09-12, and
 * docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md. Greg:
 * *"we have a kind of back to X thing. But I don't know if I always …"*.
 *
 * On a window too narrow for the band and the prose to share it, the band
 * **covers** the article (`.reader.band-covers`, narrow-window.css § a band
 * with no room). So a reader who taps a citation on a phone has jumped to a
 * paragraph they cannot see, and the only way to see it is to leave the mode —
 * which is `?mode=`, a push. Until this stage that push threw the way back
 * away, so on a phone the chip was gone every time it was needed.
 *
 * The rule 260906g wrote — *the reader taking the stack onwards strips the
 * stamp* — is kept for a reader who has moved, and the test that separates the
 * two cases is the one the wrapper already has in hand: same path, same `?at=`.
 */
describe("a push that does not move the reader", () => {
  it("keeps the way back when the reader only changes mode", () => {
    jumped(at(block(15)), block(25));
    act(() =>
      history.pushState(history.state, "", `/read/x?at=${block(25)}&mode=citations`),
    );
    expect(label()).toBe("↩ back to The middle bit");
  });

  it("keeps it across a cols toggle too — the same rule, not a second one", () => {
    jumped(at(block(15)), block(25));
    act(() => history.pushState(history.state, "", `/read/x?at=${block(25)}&cols=0,2`));
    expect(chip()).not.toBeNull();
  });

  /**
   * **Even a push that changes `?at=`**, and this is the case that says the rule
   * is about the *stack* rather than about the page.
   *
   * The first draft of this change carried the stamp only when `?at=` was
   * unchanged — "the reader has not moved". GPT Sol refused it: `?at=` names a
   * section and deliberately holds still while the reader moves inside one
   * (position.ts), and its write is debounced, so the same gesture would keep
   * or lose the chip depending on what had flushed. A depth is not a claim
   * about where the reader is; it is a count of entries, and a push adds one
   * whatever it changed. So there is nothing here to get wrong.
   *
   * No unarmed push in the app writes a different `?at=` today — `jumpTo` is
   * the only thing that pushes one, and an armed jump takes this branch's place
   * with a fresh origin. The case is pinned anyway, because "no caller does
   * this" is a fact about today and the arithmetic has to be right regardless.
   */
  it("keeps it even when the push names a different block", () => {
    jumped(at(block(15)), block(25));
    act(() => history.pushState(history.state, "", `/read/x?at=${block(2)}`));
    expect(label()).toBe("↩ back to The middle bit");
  });

  /** And a push out of the article is not a view of it at all: the label names
      a section of *this* piece, and `history.go` from another document is not
      an offer this chip can make. */
  it("drops it when the push leaves this article", () => {
    jumped(at(block(15)), block(25));
    act(() => history.pushState(history.state, "", `/read/y?at=${block(25)}`));
    expect(chip()).toBeNull();
  });
});

/* ---------------------------------------------- the depth keeps its promise -- */

/**
 * **The arithmetic, walked rather than asserted at one step.**
 *
 * The happy-path cases above stay green with the depth badly wrong — one
 * inherited push is the only shape they exercise, and `depth + 1` and
 * `depth × 2` agree there. GPT Sol's seventh finding on the plan, 2026-09-16:
 * *"they would all remain green with several of these invariants broken."*
 *
 * So each of these walks a real sequence and then **presses the chip**, because
 * the claim being made is not "the number is 3" but "one press lands the reader
 * where the label says". The origin entry is recognisable: `originHref` rewrote
 * it to `?at=<the origin block>` as the jump was made, so landing there is an
 * assertion about the address rather than about our own bookkeeping.
 */
describe("however the reader wanders the stack", () => {
  /** The whole point: several view changes, still one press. */
  it("comes home in one press after two more view changes", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    viewChanged(`at=${block(25)}&mode=citations`);
    viewChanged(`at=${block(25)}&mode=citations&cols=0,2`);
    expect(label()).toBe("↩ back to The middle bit");

    const entries = history.length;
    await pressChip();
    expect(atNow()).toBe(block(15));
    /* And it spent nothing to get there — a return that costs a forward entry
       is a return the reader has to undo. */
    expect(history.length).toBe(entries);
  });

  /**
   * **Back, then a push**, which truncates the forward stack. The new entry's
   * predecessor is the one the reader was standing on, so its distance is that
   * entry's plus one — and it is right for the same reason it is always right,
   * which is that a push adds exactly one entry.
   */
  it("counts from where the reader is, not from where they have been", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    viewChanged(`at=${block(25)}&mode=citations`);
    await goBack();
    viewChanged(`at=${block(25)}&cols=0,2`);

    await pressChip();
    expect(atNow()).toBe(block(15));
  });

  /** Forward puts the reader back on an entry that already knew its own
      distance, so there is nothing to recompute and nothing to get wrong. */
  it("survives a step back and forward again", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    viewChanged(`at=${block(25)}&mode=citations`);
    await goBack();
    await goForward();

    expect(label()).toBe("↩ back to The middle bit");
    await pressChip();
    expect(atNow()).toBe(block(15));
  });

  /**
   * **A second jump from an inherited entry starts again**, and the two presses
   * unwind the two journeys in order — which is the dropdown Greg imagined,
   * without any of its machinery.
   */
  it("unwinds two journeys in the order they were made", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    viewChanged(`at=${block(25)}&mode=citations`);
    /* From the mode, a second jump — the reader following a citation. */
    jumped(at(block(25)), block(2));
    expect(label()).toBe("↩ back to How it ends");

    await pressChip();
    expect(atNow()).toBe(block(25));
    /* And the entry they land on still remembers the journey before it. */
    expect(label()).toBe("↩ back to The middle bit");

    await pressChip();
    expect(atNow()).toBe(block(15));
  });

  /**
   * **Dismissal is about one entry**, and must not disturb the count on any
   * other. It is a replace, so it adds and removes nothing from the stack —
   * an entry further on is still exactly as far from the origin as it was.
   */
  it("is unmoved by a dismissal on an entry the reader has left", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    viewChanged(`at=${block(25)}&mode=citations`);
    await goBack();
    act(() => host.querySelector<HTMLButtonElement>(".return-chip-close")?.click());
    expect(chip()).toBeNull();

    await goForward();
    expect(label()).toBe("↩ back to The middle bit");
    await pressChip();
    expect(atNow()).toBe(block(15));
  });
});

/* --------------------------------------------------------------- the label -- */

describe("what the chip says", () => {
  /** The section containing the block, not the block's own id — the title is
      what a reader can recognise, and `?at=` is not it. */
  it("names the section the origin block sits inside", () => {
    jumped(at(block(15)), block(25));
    expect(label()).toBe("↩ back to The middle bit");
  });

  it("names the section a block starts, when the origin is that first block", () => {
    jumped(at(block(24)), block(2));
    expect(label()).toBe("↩ back to How it ends");
  });

  /**
   * **The top of the article is not a section** — GPT Sol F8. Naming the first
   * section here would promise the reader a heading and give them the masthead.
   */
  it("says the beginning rather than a section, for a top origin", () => {
    jumped(TOP, block(25));
    expect(label()).toBe("↩ back to the beginning");
  });
});

/* ------------------------------------------------------------- the presses -- */

describe("pressing the chip", () => {
  it("goes back one entry and adds none", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    const entries = history.length;
    const back = host.querySelector<HTMLButtonElement>(".return-chip-go");
    const landed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    await act(async () => {
      back?.click();
      await landed;
    });
    expect(history.length).toBe(entries);
    expect(new URLSearchParams(location.search).get("at")).toBe(block(15));
  });

  /**
   * **F12.** After a jump, ordinary scrolling goes on replacing the entry and
   * preserving its stamp, so the chip can sit on a phone for the rest of a
   * long session. The escape is one the reader asks for — an inferred hide
   * rule is what F2 refused — and it must not cost a history entry, or leaving
   * the chip would itself need a press of Back.
   */
  it("dismisses by stripping the stamp, without adding an entry", () => {
    jumped(at(block(15)), block(25));
    const entries = history.length;
    const address = location.pathname + location.search;
    act(() => host.querySelector<HTMLButtonElement>(".return-chip-close")?.click());
    expect(readStamp(history.state)).toBeNull();
    expect(chip()).toBeNull();
    expect(history.length).toBe(entries);
    expect(location.pathname + location.search).toBe(address);
  });

  /** Dismissal is about this entry only: Back still lands where it did. */
  it("leaves the entry it came from alone", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    jumped(at(block(15)), block(25));
    act(() => host.querySelector<HTMLButtonElement>(".return-chip-close")?.click());
    await act(async () => await goBack());
    expect(new URLSearchParams(location.search).get("at")).toBe(block(15));
  });

  /**
   * **And it must not cancel a write somebody else had queued.**
   *
   * The captured `replaceState` is nuqs's own wrapper, and that wrapper runs
   * `sync()` — which resets nuqs's update queue before it notices the search
   * string has not changed — for any write not marked `__nuqs__`. So dismissing
   * while the scroll spy's 300ms `?at=` replace was still pending threw that
   * write away, and nothing retried it: `synced.current` had already moved on.
   * The address went on naming the section the reader had left, which a reload
   * or a shared link would then return to. GPT Sol F20, 2026-09-06.
   */
  it("does not cancel a position write that was queued when it was pressed", async () => {
    jumped(at(block(15)), block(25));
    /* A queued nuqs write, exactly as the scroll spy makes one. */
    act(() => void queueAt(block(28)));
    act(() => host.querySelector<HTMLButtonElement>(".return-chip-close")?.click());
    expect(readStamp(history.state)).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(new URLSearchParams(location.search).get("at")).toBe(block(28));
  });
});
