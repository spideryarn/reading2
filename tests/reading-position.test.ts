/**
 * **The reading position the scroll spy is not allowed to overwrite.**
 *
 * Greg, 2026-08-30:
 *
 * > Try and fix/improve the Diagram up/down buttons (e.g. for Trail) — they
 * > don't seem to work very reliably. I press them, something changes, and then
 * > sometimes it seems to revert back to the active node it was on.
 *
 * `?at=` is a *section* (position.ts, the top of the file), and the spy that
 * writes it names the section under the sticky line. The diagram panel's ↑ / ↓
 * buttons are not sections: on Trail and Drift a rung is one paragraph
 * (diagram.ts § stepStops), so a press jumps to a block in the middle of a
 * section. The spy then saw a paragraph in the address, computed the enclosing
 * section, found the two different, and wrote the section's first block back
 * over it, when the queued position write landed a moment after the button
 * had moved the mark.
 *
 * The flicker is the half you can see. The half you can measure is worse: the
 * address is now back at the top of the section, so the *next* press computes
 * its target from there and lands on the rung it has already used. The button
 * stops moving anything, which is what "don't work very reliably" is, and
 * § two presses is the test that says so.
 *
 * ## The second bug is the one a fix invents
 *
 * Suppressing the write while the reader is inside the section the address
 * names is not enough on its own, and GPT Sol found the hole before it shipped
 * (2026-08-30): `glide` (scroll.ts) animates a jump by calling `window.scrollTo`
 * on every frame, so a jump across several sections fires exactly the scroll
 * events a hand would. The spy names each section flown *over*, and the last of
 * those writes replaces the block the jump was aimed at. § a jump in flight is
 * that case, and it is the reason `positionToWrite` takes `jumpInFlight` rather
 * than the caller checking `glideTarget()` where no test could reach it.
 */
import { describe, expect, it } from "vitest";

import type { BlockId } from "../src/types.js";
import { stepTarget } from "../src/web/keynav.js";
import { positionToWrite, sectionContaining, type Section } from "../src/web/position.js";

/* Thirty blocks, ids in the real shape because these are the values that go in
   the URL (docs/project/block-ids.md). */
const block = (row: number) => `spya-blk${String(row).padStart(3, "0")}` as BlockId;

/** Every block of the article, so a paragraph id can be placed. */
const ROW_OF = new Map<BlockId, number>(Array.from({ length: 30 }, (_, i) => [block(i), i]));

/* Three sections over those thirty blocks. **A section's id is one of the
   article's own blocks** — its first — which is the fact the whole mechanism
   rests on, so the fixture is built that way rather than out of invented ids. */
const SECTION_ROWS = [0, 10, 25];
const SECTIONS: Section[] = SECTION_ROWS.map((row, i) => ({
  row,
  blockId: block(row),
  nodeId: `n000${i}`,
  title: `Section ${i + 1}`,
}));
const [, MIDDLE, LAST] = SECTIONS.map((s) => s.blockId) as [BlockId, BlockId, BlockId];

/**
 * Section tops as the spy measures them, for a reader standing in `row`.
 *
 * One notional pixel per row with the line at zero: a section already passed
 * sits at a negative offset. The comparison `top > line` is the one the real
 * arithmetic does, over a simpler ruler.
 */
function topsFor(row: number): number[] {
  return SECTION_ROWS.map((start) => start - row);
}
const LINE = 0;

/** The spy's decision, with everything quiet unless a case says otherwise. */
function spy(row: number, held: BlockId | null, over: Partial<Parameters<typeof positionToWrite>[0]> = {}) {
  return positionToWrite({
    sections: SECTIONS,
    rowOf: ROW_OF,
    tops: topsFor(row),
    line: LINE,
    jumpInFlight: false,
    atTop: false,
    held,
    ...over,
  });
}

describe("which section a position lies in", () => {
  it("places a paragraph on the section it is inside", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, block(14))).toBe(MIDDLE);
  });

  it("places a section's own first block on itself", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, MIDDLE)).toBe(MIDDLE);
  });

  it("refuses to place an id the article does not have", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, "spya-gone11" as BlockId)).toBeNull();
  });

  it("has nowhere to put the top of the article", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, null)).toBeNull();
  });
});

describe("what the scroll spy writes", () => {
  it("names the section on the first measurement, when the address says nothing", () => {
    expect(spy(14, null)).toEqual({ at: MIDDLE });
  });

  it("leaves a paragraph the reader was sent to alone while they are still in its section", () => {
    expect(spy(14, block(14))).toBeNull();
  });

  it("still leaves it alone as they read on through that section", () => {
    for (const row of [10, 12, 18, 24]) expect(spy(row, block(14))).toBeNull();
  });

  it("replaces it when they cross into another section", () => {
    expect(spy(26, block(14))).toEqual({ at: LAST });
  });

  it("clears the address above the first section, and only once", () => {
    expect(spy(0, block(14), { atTop: true })).toEqual({ at: null });
    expect(spy(0, null, { atTop: true })).toBeNull();
  });

  it("replaces an unplaceable id with the visible section", () => {
    /* A re-extraction can leave an id in a pasted link that the article no
       longer has. It is not a position, so the next section the reader reaches
       replaces it rather than the spy going quiet forever. */
    expect(spy(14, "spya-gone11" as BlockId)).toEqual({ at: MIDDLE });
  });
});

describe("a jump in flight", () => {
  /* The reader is in section 1 and presses a dot in section 3. `glide` takes
     about 200ms to get there and fires a scroll event every frame on the way. */
  const AIMED_AT = block(27);

  it("writes nothing while the page is still flying over section 1", () => {
    expect(spy(2, AIMED_AT, { jumpInFlight: true })).toBeNull();
  });

  it("writes nothing while it passes section 2 either", () => {
    expect(spy(14, AIMED_AT, { jumpInFlight: true })).toBeNull();
  });

  it("does not clear the address when the jump starts from the very top", () => {
    /* The guard is before the top branch on purpose: a jump that begins at the
       top of the article would otherwise have its own target wiped by the first
       frame of its own animation. */
    expect(spy(0, AIMED_AT, { jumpInFlight: true, atTop: true })).toBeNull();
  });

  it("leaves the aimed-at paragraph standing once it lands", () => {
    expect(spy(27, AIMED_AT)).toBeNull();
  });

  it("and the reader's own scroll out of that section still writes", () => {
    expect(spy(14, AIMED_AT)).toEqual({ at: MIDDLE });
  });
});

describe("the section is worked out again every time, never remembered", () => {
  /* The third rule, and the only one of the three the shipped signature makes
     unbreakable rather than merely tested: `positionToWrite` takes the held
     *value* and no held section, so there is nowhere for a stale one to live.
     What this pins is the property that makes that safe — the same block places
     differently the moment the sections move, so a section worked out once and
     kept would be answering about an article that no longer exists.

     A remembered section going stale is not a loud failure. It compares equal to
     wherever the reader has now reached, so the spy simply stops writing, and a
     tracker that has quietly stopped is the silent-success.md shape. */
  const RESHAPED_ROWS = [0, 12, 20];
  const RESHAPED: Section[] = RESHAPED_ROWS.map((row, i) => ({
    row,
    blockId: block(row),
    nodeId: `n100${i}`,
    title: `Reshaped ${i + 1}`,
  }));

  it("places the same block on a different section once the boundaries move", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, block(14))).toBe(MIDDLE);
    expect(sectionContaining(RESHAPED, ROW_OF, block(14))).toBe(block(12));
  });

  it("keeps writing after a reflow, rather than going quiet", () => {
    /* The reader was sent to a paragraph at row 14 and has since reached row 21.
       Under the old shape that is still section 2 and nothing is written; under
       the new one it is section 3 and it must be. */
    const tops = RESHAPED_ROWS.map((start) => start - 21);
    expect(
      positionToWrite({
        sections: RESHAPED,
        rowOf: ROW_OF,
        tops,
        line: LINE,
        jumpInFlight: false,
        atTop: false,
        held: block(14),
      }),
    ).toEqual({ at: block(20) });
  });
});

describe("two presses of the diagram's ↓ button move twice", () => {
  /* Trail's ladder: one rung per paragraph, which is what makes this visible
     there and not on a picture whose rungs are sections. */
  const RUNGS = Array.from({ length: 30 }, (_, i) => i);

  /** One press: step from where the address says we are, then let the spy run. */
  function press(held: BlockId): BlockId {
    const target = stepTarget(RUNGS, ROW_OF.get(held) ?? 0, 1);
    if (target === null) return held;
    /* The jump puts its own block in the address, then the scroll it caused is
       measured — from the destination, because one rung never leaves the
       section it started in by more than one. */
    const next = spy(target, block(target));
    return next === null ? block(target) : (next.at ?? block(target));
  }

  it("does not spring back to the top of the section between presses", () => {
    let held = block(14);
    const landed: number[] = [];
    for (let i = 0; i < 4; i++) {
      held = press(held);
      landed.push(ROW_OF.get(held)!);
    }
    expect(landed).toEqual([15, 16, 17, 18]);
  });
});
