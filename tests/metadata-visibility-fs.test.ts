/**
 * **The filesystem store does not answer the sharing question, and that is the
 * answer.**
 *
 * `ArticleMetadata.visibility` is optional precisely so this store can leave it
 * out. It has no `visibility` column and nowhere to put one — `data/` is one
 * directory per slug — so it cannot say whether a document is shared.
 *
 * ## Why this is a test and not a comment
 *
 * Because the tempting value is `private`, and it shipped as `private` for
 * about an hour on 2026-08-28 with a reasoned comment defending it: nothing
 * *can* be shared here, so `private` is the truth rather than a default.
 *
 * The argument against it is the one `requirePostgres` already makes on the
 * public route — a store with no honest answer must refuse to answer rather
 * than supply a plausible one. `private` is a claim this store is in no
 * position to make, and the owner's sharing card would have drawn *"Only you
 * can read this"*, confidently and with no way to be right, over every article
 * in development. docs/reusable/silent-success.md.
 *
 * So the assertion is `undefined`, and it is written down here because
 * `private` will look like a tidy-up to somebody who has not read the comment.
 *
 * Absent rather than *thrown*, though: `visibilityStore.set` refuses with a 501
 * on this store, which is right for a write with nowhere to land. A read doing
 * the same would take the whole Metadata page down in development.
 */

import { describe, expect, it } from "vitest";

import { articleMetadata } from "../src/api.js";

/** The checked-in demo article, which every filesystem read can reach. */
const FIXTURE = "example";

describe("the filesystem store's metadata", () => {
  it("leaves visibility absent, rather than guessing private", async () => {
    const meta = await articleMetadata(FIXTURE);
    expect(meta.visibility).toBeUndefined();
    /* Absent, not present-and-empty: `"visibility" in meta` would be true for
       `{ visibility: undefined }`, which is a different thing on the wire —
       `JSON.stringify` drops the second and a client checking `in` would be
       told the store had answered. */
    expect("visibility" in meta).toBe(false);
    expect(JSON.stringify(meta)).not.toContain("visibility");
  });

  /**
   * **And it still answers everything else**, which is the control: if
   * `articleMetadata` threw, or returned nothing, the case above would pass for
   * entirely the wrong reason.
   */
  it("while still answering the rest of the page", async () => {
    const meta = await articleMetadata(FIXTURE);
    expect(meta.slug).toBe(FIXTURE);
    expect(meta.stages.length).toBeGreaterThan(0);
    expect(meta).toHaveProperty("archivedAt");
    expect(meta).toHaveProperty("purpose");
  });
});
