/**
 * **Which jobs may run on one article at once** — the pure half of
 * docs/plans/260929c-modes-generate-in-parallel-on-one-article.md.
 *
 * `mayOverlap` is what `blockedByAnother` (src/store/pg-jobs.ts) asks of every
 * other active job on the article, so a wrong answer here is either two jobs
 * that must take turns running together (and the second one's paid work
 * refused, or worse, an input changing under a step that reads it) or a mode
 * waiting for nothing. The cases are the plan's, plus the ones that make each
 * condition of the rule necessary on its own.
 *
 * The last block holds the policy against `STORAGE`, because the rebase in
 * src/store/pg-revisions.ts copies exactly the column the policy names — a
 * policy that named the wrong column would publish a job's artefact nowhere
 * and report success.
 */
import { describe, expect, it } from "vitest";

import {
  SHARING_STEPS,
  STEP_SHARING,
  isSharingJob,
  isSharingStep,
  mayOverlap,
  readsOf,
  sharingPolicy,
  type JobShape,
} from "../src/sharing-steps.js";
import { STEP_ORDER } from "../src/step-order.js";
import { STORAGE } from "../src/store/artifact-storage.js";
import type { StepName } from "../src/types.js";

const job = (steps: StepName[], over: Partial<JobShape> = {}): JobShape => ({
  steps,
  reset: false,
  reservesName: false,
  ...over,
});

describe("isSharingJob", () => {
  it("is true for a mode job", () => {
    expect(isSharingJob(job(["quotes"]))).toBe(true);
    expect(isSharingJob(job(["quotes", "ideas", "trajectory"]))).toBe(true);
  });

  it("is false when any step is not a sharing step", () => {
    expect(isSharingJob(job(["hierarchy"]))).toBe(false);
    expect(isSharingJob(job(["labels"]))).toBe(false);
    expect(isSharingJob(job(["assets"]))).toBe(false);
    expect(isSharingJob(job(["fetch", "extract", "blocks", "hierarchy", "arc"]))).toBe(false);
  });

  it("is false for a reset, even one whose steps are all sharing steps", () => {
    expect(isSharingJob(job(["quotes"], { reset: true }))).toBe(false);
  });

  it("is false for a job that reserves a name, even with only sharing steps", () => {
    expect(isSharingJob(job(["quotes"], { reservesName: true }))).toBe(false);
  });

  /* Nothing makes one today; an empty job is the shape of a bug somewhere
     else, and the conservative answer is to let it wait its turn. */
  it("is false for a job with no steps", () => {
    expect(isSharingJob(job([]))).toBe(false);
  });
});

describe("mayOverlap", () => {
  it("lets two independent mode jobs overlap", () => {
    expect(mayOverlap(job(["quotes"]), job(["ideas"]))).toBe(true);
    expect(mayOverlap(job(["tweets"]), job(["sketch"]))).toBe(true);
    expect(mayOverlap(job(["glossary"]), job(["citations"]))).toBe(true);
  });

  it("is symmetric", () => {
    const pairs: [StepName[], StepName[]][] = [
      [["quotes"], ["ideas"]],
      [["trajectory"], ["quotes"]],
      [["sketch"], ["illustrated"]],
      [["quotes"], ["quotes"]],
      [["hierarchy"], ["quotes"]],
    ];
    for (const [a, b] of pairs) {
      expect(mayOverlap(job(a), job(b)), `${a} / ${b}`).toBe(mayOverlap(job(b), job(a)));
    }
  });

  it("never lets one step be made twice at once", () => {
    expect(mayOverlap(job(["quotes"]), job(["quotes"]))).toBe(false);
    expect(mayOverlap(job(["glossary"]), job(["glossary"], {}))).toBe(false);
  });

  it("keeps Trajectory behind a Quotes or Ideas job, whichever side is asked", () => {
    expect(mayOverlap(job(["trajectory"]), job(["quotes"]))).toBe(false);
    expect(mayOverlap(job(["ideas"]), job(["trajectory"]))).toBe(false);
  });

  it("keeps a Trajectory job that names its inputs (precededBy) behind an Ideas job", () => {
    expect(mayOverlap(job(["quotes", "ideas", "trajectory"]), job(["ideas"]))).toBe(false);
    expect(mayOverlap(job(["quotes", "trajectory"]), job(["ideas"]))).toBe(false);
  });

  it("keeps Illustrated behind the Sketch it paints", () => {
    expect(mayOverlap(job(["sketch"]), job(["illustrated"]))).toBe(false);
    expect(mayOverlap(job(["sketch", "illustrated"]), job(["quotes"]))).toBe(true);
  });

  it("keeps every exclusive job exclusive", () => {
    expect(mayOverlap(job(["hierarchy"]), job(["quotes"]))).toBe(false);
    expect(mayOverlap(job(["labels"]), job(["tweets"]))).toBe(false);
    expect(mayOverlap(job(["fetch", "extract", "blocks", "hierarchy"]), job(["arc"]))).toBe(false);
  });

  it("keeps an all-sharing reset exclusive", () => {
    expect(mayOverlap(job(["quotes"], { reset: true }), job(["ideas"]))).toBe(false);
  });

  it("keeps a name-reserving job exclusive", () => {
    expect(mayOverlap(job(["ideas"]), job(["quotes"], { reservesName: true }))).toBe(false);
  });
});

describe("the policy", () => {
  it("names the plan's thirteen sharing steps, the fourteenth since, and no others", () => {
    /* `crossrefs` joined on 2026-09-30, a whole column that reads nothing —
       docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
    expect([...SHARING_STEPS].sort()).toEqual(
      [
        "arc", "tweets", "glossary", "quotes", "ideas", "timeline", "quiz", "faq",
        "sketch", "illustrated", "trajectory", "debate", "citations", "crossrefs", "simple",
        /* The glossary's for-you marks, 2026-10-01 — plan 261001m. */
        "glossaryForYou",
      ].sort(),
    );
  });

  it("classifies every step in STEP_ORDER", () => {
    for (const step of STEP_ORDER) expect(step in STEP_SHARING, step).toBe(true);
    expect(Object.keys(STEP_SHARING).sort()).toEqual([...STEP_ORDER].sort());
  });

  it("declares the three known reads", () => {
    expect([...readsOf(job(["illustrated"]))]).toEqual(["sketch"]);
    expect([...readsOf(job(["trajectory"]))].sort()).toEqual(["ideas", "quotes"]);
    /* The marks annotate the glossary's term list, and hash it — plan
       261001m, GPT Sol's finding 6. */
    expect([...readsOf(job(["glossaryForYou"]))]).toEqual(["glossary"]);
    for (const step of SHARING_STEPS) {
      if (step === "illustrated" || step === "trajectory" || step === "glossaryForYou") continue;
      expect([...readsOf(job([step]))], step).toEqual([]);
    }
  });

  it("gives every sharing step exactly one whole column in STORAGE, and it is the policy's", () => {
    for (const step of SHARING_STEPS) {
      const sites = Object.values(STORAGE[step]);
      expect(sites, `${step} must be stored in exactly one place`).toHaveLength(1);
      const site = sites[0]!;
      expect(site.at, `${step} must be a whole column`).toBe("column");
      expect(site.at === "column" && site.column, step).toBe(sharingPolicy(step).column);
    }
  });

  it("lets no other step write a sharing step's column", () => {
    const owned = new Map<string, StepName[]>();
    for (const step of STEP_ORDER) {
      for (const site of Object.values(STORAGE[step])) {
        if (site.at !== "column") continue;
        owned.set(site.column, [...(owned.get(site.column) ?? []), step]);
      }
    }
    for (const step of SHARING_STEPS) {
      const { column } = sharingPolicy(step);
      expect(owned.get(column), column).toEqual([step]);
    }
  });

  it("only ever reads sharing steps", () => {
    for (const step of SHARING_STEPS) {
      for (const read of readsOf(job([step]))) {
        expect(isSharingStep(read), `${step} reads ${read}`).toBe(true);
      }
    }
  });
});
