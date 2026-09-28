import { describe, expect, it } from "vitest";

import { workKeyFor } from "../src/store/jobs.js";

/**
 * A reset's successors are inserted only when it publishes. If two resets can
 * be active on one article, the first reset's successors land behind the second
 * reset and can recreate extras the second reset asked to leave absent. The
 * reset work key is therefore a single-flight key: the requested regeneration
 * plan stays on the row, but it does not make a second active reset admissible.
 */
describe("the reset work key", () => {
  it("keeps one active reset per article while staying distinct from a plain re-read", () => {
    const steps = ["extract", "blocks"] as const;
    const forced = new Set(steps);
    const plain = workKeyFor([...steps], forced);
    const withoutRegeneration = workKeyFor([...steps], forced, undefined, undefined, undefined, {
      reset: { regenerate: [] },
    });
    const withRegeneration = workKeyFor([...steps], forced, undefined, undefined, undefined, {
      reset: { regenerate: ["quotes"], profile: "a physicist" },
    });

    expect(withoutRegeneration).not.toBe(plain);
    expect(withRegeneration).toBe(withoutRegeneration);
  });
});
