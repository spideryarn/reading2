/** Guard the recording/counting claims corrected in the 261006b stage 2 review. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILURE_DEFINITIONS, FAILURE_NOTES } from "../src/cost-cube.js";

const doc = (name: string) => readFileSync(new URL(`../docs/project/${name}.md`, import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the failure docs' claims", () => {
  it("scopes missing live rows to unfinished responses without terminal usage", () => {
    for (const text of [FAILURE_NOTES.join(" "), doc("ai-gateway")]) {
      expect(text).toContain("unfinished response");
      expect(text).toContain("terminal usage");
      expect(text).not.toContain("usually leaves no row");
    }
  });

  it("documents the Realtime class exception to the gateway's phase contract", () => {
    const spend = readFileSync(new URL("../src/ai-spend.ts", import.meta.url), "utf8").replace(/\s+\*?\s*/g, " ");
    expect(spend).not.toContain("or `abort`) and not otherwise");
    expect(spend).toContain("A stopped Realtime response carries class `abort` with no phase or HTTP status");
    expect(doc("ai-gateway")).toContain("On gateway rows, `failure_phase` and `failure_status`");
  });

  it("does not give every historical job-deadline row a class", () => {
    expect(doc("ai-gateway")).not.toContain("Rows from before that say `abort`");
    expect(doc("ai-gateway")).toContain("older rows can have no class");
  });

  it("does not equate a recognised deadline with this attempt's elapsed time", () => {
    const copy = [FAILURE_DEFINITIONS, FAILURE_NOTES.join(" "), doc("admin-costs"), doc("ai-gateway")];
    for (const text of copy) {
      expect(text).not.toContain("the whole call had taken too long");
      expect(text).not.toContain("any time limit on the call running out");
      expect(text).not.toContain("a time limit on the call ran out");
      expect(text).toContain("a turn, a processing step or a whole pipeline job");
      /* Plan 261006f: the job's deadline is counted as a deadline now. */
      expect(text).not.toContain("is not recognised");
      expect(text).not.toContain("recorded as an ordinary stop");
    }
    const page = readFileSync(new URL("../src/web/AdminCostsPage.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("the whole call had taken too long");
  });

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
