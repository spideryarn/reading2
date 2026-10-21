/**
 * The transaction-local High-powered AI writer added for gift preparation.
 * Its predicate is a safety boundary: Drizzle permits an omitted clause, but
 * this helper must never turn every standard-power article on.
 */
import { describe, expect, it } from "vitest";

import { switchOnHighPowerIn } from "../src/store/pg-high-power.js";

describe("switchOnHighPowerIn", () => {
  it("refuses an absent row predicate before it reaches the executor", async () => {
    await expect(switchOnHighPowerIn({} as never, undefined)).rejects.toThrow(
      "switchOnHighPowerIn requires a predicate that identifies one article",
    );
  });
});
