/**
 * **Neither face of Structure pins its row cards to the left and right.**
 * qi-fkyrdns3, plan 261004g.
 *
 * **This is a tripwire, not the evidence.** The defect is a position: at 390px
 * the list face's card opened at x 367..693, off the screen, and widened the
 * page to 706px so rows moved under the reader's finger. jsdom lays nothing
 * out, so no test here can see that; the red and the green were measured in
 * Chrome at 390px, and the numbers are in the plan.
 *
 * What this can do is stop the cause coming back. `keepSide` on a `right`
 * tooltip forbids the drop below the row, which is the only place a card fits
 * on a phone (StructurePanel.tsx § `CardRow` says why at length). It was added
 * to one face, removed, and then written again on the other, so it is the
 * kind of prop somebody adds for tidiness. Read from the source because the
 * prop reaches Floating UI as middleware, which a mounted jsdom tree cannot
 * be asked about.
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** The opening tag of the `<Tooltip>` a component returns. */
function rowTooltip(file: string, component: string): string {
  const source = readFileSync(new URL(`../src/web/${file}`, import.meta.url), "utf8");
  const from = source.indexOf(`function ${component}(`);
  expect(from, `${file} has no ${component}`).toBeGreaterThan(-1);
  const open = source.indexOf("<Tooltip", from);
  const close = source.indexOf("content={", open);
  expect(open > from && close > open, `${component} draws no Tooltip`).toBe(true);
  return source.slice(open, close);
}

it.each([
  ["OutlinePanel.tsx", "Row"],
  ["StructurePanel.tsx", "CardRow"],
])("%s § %s opens to the right and may drop below", (file, component) => {
  const tag = rowTooltip(file, component);
  expect(tag).toContain('placement="right"');
  expect(tag).not.toMatch(/\bkeepSide\b/);
});
