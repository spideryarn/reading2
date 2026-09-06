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
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Block, BlockId, NodeId } from "../src/types.js";
import { armJump, clearArmedJump, readStamp } from "../src/web/jump-history.js";
import type { Section } from "../src/web/position.js";
import { ReturnChip } from "../src/web/ReturnChip.js";
import { watchHistoryWrites } from "../src/web/router.js";

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

function mount(): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(createElement(ReturnChip, { sections: SECTIONS, rowOf: ROW_OF })),
  );
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
  const landed = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  history.back();
  await landed;
}

beforeEach(() => {
  history.replaceState(null, "", "/read/x");
  clearArmedJump();
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
   * **The regression the store exists to stop.** A `cols`, `mode` or `sort`
   * toggle after a jump pushes an entry whose Back merely undoes the toggle;
   * the wrapper strips the inherited stamp (GPT Sol F3) and the chip has to go
   * with it, or it promises a return it cannot make.
   */
  it("draws nothing after a cols push has taken the reader on", () => {
    jumped(at(block(15)), block(25));
    act(() => history.pushState(history.state, "", `/read/x?at=${block(25)}&cols=0,2`));
    expect(chip()).toBeNull();
  });

  /**
   * **F6: two entries can share a URL and differ only in the stamp.** A store
   * snapshotting `pathname + search` — `useAddress` — is equal across this
   * write, so the chip would stay on screen with nothing behind it.
   */
  it("notices a stamp being stripped at an unchanged URL", () => {
    jumped(at(block(15)), block(25));
    const before = location.pathname + location.search;
    act(() => history.pushState(history.state, "", before));
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
    expect(readStamp(history.state)).toEqual(at(GHOST));
    expect(chip()).toBeNull();
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
});
