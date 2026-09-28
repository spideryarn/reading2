/**
 * **The browser's list of extras is the server's list.**
 *
 * `RESET_ROLE` (src/reset.ts) decides which steps a reset drops, and it cannot
 * reach the browser: that file imports the database client, and the client may
 * import only leaves (tests/client-imports.test.ts). So the reset section keeps
 * its own map of reader-facing names, `RESET_EXTRA_NAME`
 * (src/web/ResetArticle.tsx), exhaustive over `StepName` — and this is what
 * stops the two drifting. A step the server drops that the page does not name
 * would be regenerated without the reader being told it would be lost; a name
 * the page offers that the server keeps would be a promise nothing honours.
 */
import { describe, expect, it } from "vitest";

import { extraSteps } from "../src/reset.js";
import { STEP_ORDER } from "../src/step-order.js";
import { RESET_EXTRA_NAME } from "../src/web/ResetArticle.js";

describe("the reset section's names for the extras", () => {
  it("names exactly the steps a reset drops", () => {
    const named = STEP_ORDER.filter((step) => RESET_EXTRA_NAME[step] !== null);
    expect(named).toEqual(extraSteps());
  });
});
