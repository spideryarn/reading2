/**
 * **The shelf table shows the first fifty, and offers the rest exactly when
 * there is a rest.**
 *
 * Greg, 2026-09-06: *"the table should by default only show the top 50? or so
 * Articles, with a button at the bottom to show all. Eventually we might
 * consider paging, but probably that's overkill for now."*
 *
 * The behaviour was verified in a browser when it was built — the cap was
 * temporarily lowered to 10, which drew ten rows and a "Show all 30 articles"
 * button that revealed all thirty. That is real evidence and it is also gone the
 * moment the browser closes; a cross-family review of the built code pointed out
 * this was the one thing here with no automated cover. So: this file.
 *
 * ## What it pins
 *
 * The pairing, which is the only thing that can actually go wrong. A list capped
 * with no button is a reader stuck at fifty with no way forward; a button over
 * an uncapped list is a control that does nothing. `capRows` returns both
 * answers together so they cannot disagree — `revealTotal` is a number or
 * `null`, not a boolean beside a count — and these tests are about that
 * invariant rather than about the number 50.
 *
 * The number itself lives in `Library.tsx` and is deliberately not asserted
 * here: it is a product judgement Greg may want to move, and a test that has to
 * be edited when a default changes is a test that will be edited without being
 * read.
 */
import { describe, expect, it } from "vitest";

import { capRows } from "../src/web/lib/row-cap.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("capRows", () => {
  it("shows everything, and offers nothing, when the list fits", () => {
    expect(capRows(rows(30), 50, false)).toEqual({ shown: rows(30), revealTotal: null });
  });

  it("is not off by one at exactly the cap", () => {
    /* The boundary, because this is where a `>=` would hide one row behind a
       button that then reveals a list of the same length. */
    expect(capRows(rows(50), 50, false)).toEqual({ shown: rows(50), revealTotal: null });
  });

  it("caps at the cap and offers the full total the moment there is one more", () => {
    const out = capRows(rows(51), 50, false);
    expect(out.shown).toHaveLength(50);
    expect(out.revealTotal).toBe(51);
  });

  it("offers the FULL count, not the hidden count", () => {
    /* The button reads "Show all 213 articles". Handing it the number hidden
       rather than the number there would make it say "Show all 163", which is
       both wrong and impossible to notice without counting. */
    const out = capRows(rows(213), 50, false);
    expect(out.revealTotal).toBe(213);
  });

  it("shows everything and withdraws the offer once expanded", () => {
    const out = capRows(rows(213), 50, true);
    expect(out.shown).toHaveLength(213);
    expect(out.revealTotal).toBeNull();
  });

  it("never caps without offering the way out", () => {
    /* The invariant, over the whole interesting range and both states: if the
       list was shortened, there is a total to reveal — and if it was not, there
       is not. This is the property the two-conditions-in-JSX version could
       break silently, and the reason `capRows` exists at all. */
    for (const total of [0, 1, 49, 50, 51, 200]) {
      for (const expanded of [false, true]) {
        const out = capRows(rows(total), 50, expanded);
        expect(out.shown.length < total, `${total} rows, expanded=${expanded}`).toBe(
          out.revealTotal !== null,
        );
        if (out.revealTotal !== null) expect(out.revealTotal).toBe(total);
      }
    }
  });

  it("treats a cap of zero or less as no cap rather than as an empty page", () => {
    /* A misconfigured number should give a usable page, not a blank one. */
    expect(capRows(rows(10), 0, false)).toEqual({ shown: rows(10), revealTotal: null });
    expect(capRows(rows(10), -1, false)).toEqual({ shown: rows(10), revealTotal: null });
  });

  it("keeps the order it was given, and does not copy when nothing is hidden", () => {
    const input = rows(10);
    const out = capRows(input, 50, false);
    /* Identity, not just equality: the shelf hands this the result of two
       `sinkLast` passes on every render, and a fresh array each time would be a
       new prop identity for `DataTable` — the shape that caused
       docs/postmortems/260827e-shelf-render-loop.md. */
    expect(out.shown).toBe(input);
  });
});
