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
import { isPersonalStep, PERSONAL_STEPS, withPersonalAddenda } from "../src/profile.js";
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

/* **A glossary request grows its personal addendum, and only with a profile**
   — plan 261001m, GPT Sol's finding 6. The jobs route expands the asked-for
   steps before enqueue, the work key and the ordering see them, so this pure
   function is the whole of the decision; the route test beside
   tests/quiz-job-carries-the-reading-goal.test.ts holds the wiring. */
describe("withPersonalAddenda", () => {
  it("adds the glossary's for-you marks when the owner has a profile", () => {
    expect(withPersonalAddenda(["glossary"], PROFILE)).toEqual(["glossary", "glossaryForYou"]);
    expect(withPersonalAddenda(["glossary", "quotes"], PROFILE)).toEqual([
      "glossary",
      "quotes",
      "glossaryForYou",
    ]);
  });

  it("adds nothing without a profile — the control", () => {
    expect(withPersonalAddenda(["glossary"], null)).toEqual(["glossary"]);
  });

  it("adds nothing to a job with no glossary, and never twice", () => {
    expect(withPersonalAddenda(["quotes", "ideas"], PROFILE)).toEqual(["quotes", "ideas"]);
    expect(withPersonalAddenda(["glossary", "glossaryForYou"], PROFILE)).toEqual([
      "glossary",
      "glossaryForYou",
    ]);
  });

  it("only ever adds a personal step", () => {
    for (const added of withPersonalAddenda(STEP_ORDER, PROFILE)) {
      if (!STEP_ORDER.includes(added)) throw new Error(`added ${added}`);
    }
    expect(withPersonalAddenda(["glossary"], PROFILE).filter((s) => s !== "glossary").every(isPersonalStep)).toBe(
      true,
    );
  });
});
