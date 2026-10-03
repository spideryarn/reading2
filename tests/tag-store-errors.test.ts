/**
 * The tag store's two pre-database refusals: malformed Unicode is rejected
 * before a query, and a future drift between that validator and the database's
 * named CHECK remains a 400 rather than being scrubbed to a 500.
 */
import { describe, expect, it } from "vitest";

import { normaliseChange, rethrowTagWriteError } from "../src/store/pg-tags.js";

function checkViolation(constraint: string): Error {
  const driver = Object.assign(new Error("value violates check constraint"), {
    code: "23514",
    constraint,
  });
  return Object.assign(new Error("Failed query: insert into article_tags"), { cause: driver });
}

describe("tag write refusals", () => {
  it("rejects malformed Unicode before it can become a different database key", () => {
    expect(() => normaliseChange({ add: ["\ud800"] })).toThrowError(
      "A tag needs valid Unicode characters.",
    );
  });

  it("turns the tag spelling CHECK into the promised reader-facing 400", () => {
    let caught: unknown;
    try {
      rethrowTagWriteError(checkViolation("article_tags_spelling"));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status: 400,
      message: "That tag does not meet the spelling rules.",
    });
  });

  it("does not relabel another CHECK violation as bad tag spelling", () => {
    const other = checkViolation("article_tags_some_future_check");
    expect(() => rethrowTagWriteError(other)).toThrow(other);
  });
});
