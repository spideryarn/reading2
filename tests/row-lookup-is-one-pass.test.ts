// @vitest-environment jsdom
/**
 * The row lookup must not scan the document once per section.
 *
 * A mode switch on a 2,046-block article cost **4.7 seconds**, and 38.1% of all
 * script time was `querySelector` — two effects each running
 * `sections.map((s) => document.querySelector('tr[data-block="…"]'))`, which is
 * one full document scan per section. Sentry `SPIDERYARN-READING2-1M`;
 * docs/plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md.
 *
 * **This asserts the shape, not a duration.** A millisecond threshold on a box
 * that several agents share is a flaky test that gets deleted; "how many times
 * did it scan the document" is exact, deterministic, and is the actual defect.
 * That is the same choice tests/idle-work.test.ts made for the job poller, and
 * for the same reason.
 *
 * Watched red against the loop it replaces: with `sections.map(querySelector)`
 * the second test reports 300 calls where it wants at most 1.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rowsForBlockIds } from "../src/web/rows.js";

/** A table shaped like the reading view's: one `<tr data-block>` per block. */
function buildTable(ids: string[]): void {
  const rows = ids
    .map((id) => `<tr data-block="${id}"><td>gist</td><td class="prose">text</td></tr>`)
    .join("");
  document.body.innerHTML = `<table class="zoom"><tbody>${rows}</tbody></table>`;
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `spya-b${i}`);

describe("rowsForBlockIds", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("returns the same elements the per-id querySelector loop returned", () => {
    const all = ids(20);
    buildTable(all);
    const wanted = [all[3]!, all[0]!, all[19]!, "spya-not-here"];

    const got = rowsForBlockIds(wanted);
    /* Not `CSS.escape`d: jsdom has no `CSS`, and block ids are `spya-` plus
       base36 (docs/project/block-ids.md), so there is nothing to escape. */
    const theOldWay = wanted.map((id) =>
      document.querySelector<HTMLElement>(`tr[data-block="${id}"]`),
    );

    expect(got).toEqual(theOldWay);
    /* Positional, holes kept: a missing row must stay in the array or every
       index after it names the wrong section. */
    expect(got).toHaveLength(4);
    expect(got[3]).toBeNull();
  });

  it("scans the document once, however many sections are asked for", () => {
    buildTable(ids(300));
    const single = vi.spyOn(document, "querySelector");
    const all = vi.spyOn(document, "querySelectorAll");

    rowsForBlockIds(ids(300));

    /* The whole point. The loop this replaces called `querySelector` 300 times;
       this must not call it at all, and must reach the DOM once. */
    expect(single).toHaveBeenCalledTimes(0);
    expect(all.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("keeps the first element when an id somehow appears twice", () => {
    document.body.innerHTML =
      `<table><tbody>` +
      `<tr data-block="spya-dup" id="first"><td>a</td></tr>` +
      `<tr data-block="spya-dup" id="second"><td>b</td></tr>` +
      `</tbody></table>`;

    /* Ids are unique (docs/project/block-ids.md), so this is belt and braces —
       but it is the one way a Map could disagree with `querySelector`, and
       "academic" is how a range check goes silently wrong. */
    expect(rowsForBlockIds(["spya-dup"])[0]?.id).toBe("first");
  });

  it("returns nulls rather than throwing when the table is not in the DOM yet", () => {
    /* An effect can run before the table mounts. The loop returned nulls; so
       must this, or a mode switch throws instead of measuring nothing. */
    expect(rowsForBlockIds(["spya-a", "spya-b"])).toEqual([null, null]);
  });
});
