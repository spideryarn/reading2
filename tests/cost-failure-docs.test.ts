/** Guard the recording/counting claims corrected in the 261006b stage 2 review. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILURE_NOTES } from "../src/cost-cube.js";

const doc = (name: string) => readFileSync(new URL(`../docs/project/${name}.md`, import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the failure docs' claims", () => {
  it("does not say every pre-answer failure is retried or every accepted failure is never retried", () => {
    const admin = doc("admin-costs");
    expect(admin).not.toContain("A call that fails before its answer began is asked again");
    expect(admin).toContain("caller-owned loops");
    const gateway = doc("ai-gateway");
    expect(gateway).not.toContain("retrying that means paying for it twice, and it is not built");
  });

  it("keeps the F9 observed provider error distinct from a later abort", () => {
    const gateway = doc("ai-gateway");
    expect(gateway).toContain("On an OpenRouter stream, an in-band provider error already observed remains an error even if a later body read aborts");
    expect(FAILURE_NOTES.join(" ")).toContain("if the provider had already sent an error, the row keeps that error");
  });

  it("does not attribute an increase in failed-or-stopped calls to aborted becoming error", () => {
    const admin = doc("admin-costs");
    expect(admin).not.toContain("three kinds of failure used to be recorded as `ok` or `aborted`");
    expect(admin).toContain("Moving an in-band error from `aborted` to `error` leaves that total unchanged");
  });
});
