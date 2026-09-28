/**
 * **The browser names exactly the extras the server drops.**
 *
 * Since Sol's F14 (docs/plans/260928a-reset-and-regenerate-article-stage2-review-sol.md)
 * there is one classification, `RESET_ROLE` in src/reset-role.ts, and the
 * reset section (src/web/ResetArticle.tsx) derives which steps are extras from
 * it, keeping only their reader-facing names in `RESET_EXTRA_NAME`, keyed by
 * `ExtraStep`. So drift is first a compile error: a new extra is a missing key
 * and a step that stops being one is an excess key.
 *
 * This is the runtime half, for what the compiler cannot see — a cast, a
 * spread, or a key added through some route that widens the literal. A step
 * the server drops that the page does not name would be regenerated without
 * the reader being told it would be lost; a name the page offers for a step the
 * server keeps would be a promise nothing honours.
 */
import { describe, expect, it } from "vitest";

import { extraSteps } from "../src/reset-role.js";
import { STEP_ORDER } from "../src/step-order.js";
import { RESET_EXTRA_NAME } from "../src/web/ResetArticle.js";

describe("the reset section's names for the extras", () => {
  it("names exactly the steps a reset drops", () => {
    const named = STEP_ORDER.filter((step) => Object.hasOwn(RESET_EXTRA_NAME, step));
    expect(named).toEqual(extraSteps());
    expect(Object.keys(RESET_EXTRA_NAME).sort()).toEqual([...extraSteps()].sort());
  });

  it("gives every extra a name a reader can read", () => {
    for (const step of extraSteps()) expect(RESET_EXTRA_NAME[step].trim(), step).not.toBe("");
  });
});
