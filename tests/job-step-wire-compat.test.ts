import { describe, expect, it } from "vitest";

import { previousClientStepName } from "../src/step-order.js";
import type { Job } from "../src/types.js";
import { currentClientJob } from "../src/web/jobEngine.js";

describe("job step names across the Sources rename deploy", () => {
  it("shows the previous client its spelling and lets the current client read it back", () => {
    const wireNames = ["bibliography", "reception", "sources-claims"].map(previousClientStepName);
    expect(wireNames).toEqual(["citations", "debate", "debate-claims"]);

    const wire = {
      id: "job-1",
      slug: "an-article",
      status: "running",
      createdAt: "2026-10-10T08:00:00.000Z",
      steps: wireNames.map((name) => ({ name, status: "queued" })),
      reset: { regenerate: wireNames },
    } as unknown as Job;

    expect(currentClientJob(wire).steps.map((step) => step.name)).toEqual([
      "bibliography",
      "reception",
      "sources-claims",
    ]);
    expect(currentClientJob(wire).reset?.regenerate).toEqual(["bibliography", "reception", "sources-claims"]);
  });

  it("does not revive older aliases that are outside this deploy", () => {
    expect(previousClientStepName("structure")).toBe("structure");
    expect(previousClientStepName("skim")).toBe("skim");
  });
});
