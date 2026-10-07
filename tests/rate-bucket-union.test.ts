/**
 * **No caller can spend the retired `citation-find` allowance** — plan 261004h.
 *
 * `POST …/find` went on 2026-10-04 and took the bucket's only spender with it.
 * The database CHECK still allows the value, for the rows already written; the
 * type does not, so a new caller cannot reach for it. This is a type-level
 * case: it is `npm run typecheck` that goes red, not vitest.
 */
import { expect, it } from "vitest";

import type { RateBucket } from "../src/store/contracts.js";

it("RateBucket has no citation-find member", () => {
  // @ts-expect-error the bucket is retired; nothing may take from it.
  const retired: RateBucket = "citation-find";
  expect(retired).toBe("citation-find");
});
