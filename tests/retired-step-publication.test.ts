/** Raw job rows used during publication must obey the job reader's rename contract. */
import { describe, expect, it, vi } from "vitest";
import { runAsOwner } from "../src/owner.js";
import { rebaseSharingDraftIn } from "../src/store/pg-revisions.js";
import type { OwnerId } from "../src/types.js";

describe("a retired step in a raw publication job row", () => {
  it("declines to rebase an exclusive structure job whose base moved", async () => {
    const owner = "000000e7-0000-4000-8000-000000000001" as OwnerId;
    const rows = [
      [{ id: "article", currentRevisionId: "new-base", ownerId: owner }],
      [{ articleId: "article", status: "draft", basedOn: "old-base" }],
      [{ draftRevisionId: "draft", steps: [{ name: "hierarchy" }], reset: null, reservesName: false }],
    ];
    const select = vi.fn(() => {
      const result = Promise.resolve(rows.shift());
      const query = Object.assign(result, {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: () => query,
      });
      return query;
    });
    // A transaction double: this test never opens a database connection.
    const tx = { select } as unknown as Parameters<typeof rebaseSharingDraftIn>[0];
    await expect(runAsOwner(owner, () => rebaseSharingDraftIn(tx, {
      slug: "retired-publication",
      revisionId: "draft",
      job: { id: "job", attemptId: "attempt" },
    }))).resolves.toEqual({ kind: "declined", why: "not-a-sharing-job" });
    expect(select).toHaveBeenCalledTimes(3);
  });
});
