/**
 * **Only a personal step is handed the reader's profile.**
 *
 * Whatever a visitor to a public article can see is written for nobody in
 * particular, so a job that carries the owner's profile must hand it to the
 * steps in `PERSONAL_STEPS` and to nothing else. `stepContextFor` is the one
 * place a `StepContext` is built, and every shared stage reads its profile off
 * `ctx.profile ?? null` — so `undefined` here is no `WHO IS READING` section
 * and a `profileHash: null` stamp, with no edit to the stages.
 *
 * Every `StepName` is walked, not a list typed out here, so a new step is
 * covered the day it is added — and is shared unless somebody says otherwise.
 *
 * docs/plans/261001m-shared-mode-output-for-everyone-personalisation-as-an-addendum.md.
 */
import { describe, expect, it } from "vitest";

import { stepContextFor } from "../src/jobs.js";
import { isPersonalStep, PERSONAL_STEPS } from "../src/profile.js";
import { STEP_ORDER } from "../src/step-order.js";
import type { Job, JobStep, StepName } from "../src/types.js";

const PROFILE = "About the reader: A neuroethologist.";

function contextFor(name: StepName, profile: string | undefined) {
  const step = { name, label: name, status: "pending" } as JobStep;
  const job = {
    id: "job-1",
    slug: "fixture",
    steps: [step],
    ...(profile !== undefined && { profile }),
  } as unknown as Job;
  return stepContextFor(job, step, new AbortController().signal, Date.now() + 60_000, "standard");
}

describe("stepContextFor and the reader profile", () => {
  it("hands the profile to no shared step", () => {
    const shared = STEP_ORDER.filter((name) => !isPersonalStep(name));
    /* The ones a visitor reads, named so the walk above cannot have lost them. */
    for (const name of ["tweets", "glossary", "quotes", "ideas", "sketch"] as const) {
      expect(shared).toContain(name);
    }
    for (const name of shared) {
      expect({ name, profile: contextFor(name, PROFILE).profile }).toEqual({ name, profile: undefined });
    }
  });

  it("hands it to every personal step", () => {
    for (const name of PERSONAL_STEPS) {
      expect({ name, profile: contextFor(name, PROFILE).profile }).toEqual({ name, profile: PROFILE });
    }
  });

  it("hands a personal step nothing when the job carries nothing — the control", () => {
    expect(contextFor("quiz", undefined).profile).toBeUndefined();
  });
});
