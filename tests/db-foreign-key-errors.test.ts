import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { guardDbStore, violatesForeignKey } from "../src/store/db-errors.js";

const constraint = "comments_criterion_fk";
const driverError = () => Object.assign(new Error("foreign key refused"), { code: "23503", constraint });
const wrapped = () => new DrizzleQueryError("insert into comments ...", [], driverError());

describe("the named foreign-key matcher before the store guard", () => {
  it("reads the actual installed Drizzle wrapper's cause", () => {
    expect(violatesForeignKey(wrapped(), constraint)).toBe(true);
  });
  it("reads an unwrapped driver error and a plain error object", () => {
    expect(violatesForeignKey(driverError(), constraint)).toBe(true);
    expect(violatesForeignKey({ code: "23503", constraint }, constraint)).toBe(true);
  });
  it("does not match the other foreign key on comments", () => {
    expect(violatesForeignKey(Object.assign(driverError(), { constraint: "comments_identity_fk" }), constraint)).toBe(false);
  });
  it("requires SQLSTATE and name on the same link", () => {
    expect(violatesForeignKey({ code: "23503", cause: { constraint } }, constraint)).toBe(false);
    expect(violatesForeignKey({ constraint, cause: { code: "23503" } }, constraint)).toBe(false);
  });
  it("does not match another SQLSTATE or a message that happens to name the key", () => {
    expect(violatesForeignKey(Object.assign(driverError(), { code: "23505" }), constraint)).toBe(false);
    expect(violatesForeignKey(Object.assign(new Error(constraint), { code: "23503" }), constraint)).toBe(false);
  });
  it("safely rejects absent and circular errors", () => {
    const circular: { cause?: unknown } = {};
    circular.cause = circular;
    for (const error of [null, undefined, "23503", circular]) {
      expect(violatesForeignKey(error, constraint)).toBe(false);
    }
  });
  it("uses the shared walker's four-link bound", () => {
    const fourth = { cause: { cause: { cause: driverError() } } };
    expect(violatesForeignKey(fourth, constraint)).toBe(true);
    expect(violatesForeignKey({ cause: fourth }, constraint)).toBe(false);
  });
  it("cannot match a name after the guard has scrubbed it", async () => {
    const store = guardDbStore("test", { async write() { throw wrapped(); } });
    const error = await store.write().catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "StoreFailure", code: "23503" });
    expect(violatesForeignKey(error, constraint)).toBe(false);
  });
});
