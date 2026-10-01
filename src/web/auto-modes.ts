/**
 * **Generate the main modes once an import finishes** — the add page's tick box.
 *
 * > give me a tick box that's probably default-true that will automatically run
 * > the generation for all of the main modes, i.e. the ones that are not
 * > experimental features … if that's making this much harder, do the simpler
 * > thing first of just a way to automatically kick off the other modes once the
 * > paper is open
 * >
 * > — Greg, 2026-09-30
 *
 * This is the simpler thing. When the import's job is `done` and the box is
 * ticked, the add page queues one job per main mode and opens the article
 * without waiting for them. Opening the article *before* the import's tree
 * exists is deferred: docs/plans/260930c-auto-generate-the-main-modes-after-import.md.
 *
 * ## Which modes
 *
 * **Derived, never listed**: every mode not behind the experimental switch
 * (`MODE_CATALOG[mode].experimental`), mapped to the step it makes
 * (`modeStep`, src/web/activation.ts). Structure and Summary make nothing —
 * they read the tree the import already built — and Plain, Chat and Search wait
 * on the reader. A mode moved in or out of the switch changes this with no
 * second edit; tests/auto-modes.test.tsx pins today's answer so the change is
 * seen.
 *
 * ## One job per mode
 *
 * One job per mode because a job runs its steps one after another, and the
 * point is to run them side by side (docs/plans/260929c-modes-generate-in-parallel-on-one-article.md).
 * A mode that reads another's artefact carries those steps in its own job —
 * `autoModeRequests` says why.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { type Mode, MODES } from "../modes.js";
import { STEP_ORDER } from "../step-order.js";
import { MODE_LABEL } from "../title-text.js";
import type { StepName } from "../types.js";
import { modeStep } from "./activation.js";
import type { UseJobs } from "./useJobs.js";

/** The main modes that make something, each with its step, in `STEP_ORDER`. */
function autoModes(): { mode: Mode; step: StepName }[] {
  const found: { mode: Mode; step: StepName }[] = [];
  for (const mode of MODES) {
    if (MODE_CATALOG[mode].experimental) continue;
    const step = modeStep(mode);
    if (step) found.push({ mode, step });
  }
  return found.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}

/**
 * **Steps the box queues that no mode makes**, added by hand because the list
 * above is derived from modes and these are not one.
 *
 * `crossrefs` — the links from a phrase in one passage to the passage that
 * backs it. They sit in the prose in every mode, so there is no mode to derive
 * them from; Greg asked for them as *"a preprocessing step that always
 * happens"*, and this box is the "always" for a new article. It reads nothing,
 * so its job is one step and goes in the first, parallel group.
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md § 3.
 */
export const AUTO_EXTRA_STEPS: readonly StepName[] = ["crossrefs"];

/** The steps the box queues, in `STEP_ORDER`. */
export function autoModeSteps(): StepName[] {
  const steps = [...autoModes().map(({ step }) => step), ...AUTO_EXTRA_STEPS];
  return steps.sort((a, b) => STEP_ORDER.indexOf(a) - STEP_ORDER.indexOf(b));
}

/** What the box says. */
export const AUTO_MODES_LABEL = "Generate the main modes as soon as it opens";

/**
 * The line under it, naming the modes — from `MODE_LABEL`, so a renamed mode
 * is renamed here too. It says the work is paid for rather than a price, the
 * rule `MODE_CATALOG`'s `how` keeps for the bar.
 */
export function autoModesDetail(): string {
  const names = autoModes().map(({ mode }) => MODE_LABEL[mode]);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return `${list} are prepared in the background, with Trajectory after Quotes and Ideas, and so are the links from one passage of the article to another. This uses paid model calls.`;
}

/**
 * **Which steps read another step's artefact** — a copy of the `reads` in
 * `STEP_SHARING` (src/sharing-steps.ts), which is the rule the server's queue
 * acts on. A copy because that module takes a type from src/store/, and the
 * browser may not reach it even for a type (tests/client-imports.test.ts);
 * tests/auto-modes.test.tsx holds the two equal, so a new dependency there
 * fails here rather than going unnoticed.
 */
export const STEP_READS: Partial<Record<StepName, readonly StepName[]>> = {
  illustrated: ["sketch"],
  trajectory: ["quotes", "ideas"],
  /* Never an auto mode itself — the jobs route adds it to a glossary request
     (plan 261001m) — and here so the copy stays the server's. */
  glossaryForYou: ["glossary"],
};

/**
 * **What each job asks for**: the mode's step, with the steps it reads in
 * front of it (`STEP_READS` above), in `STEP_ORDER`.
 *
 * So Trajectory's job is `["quotes", "ideas", "trajectory"]` — the same steps
 * the Trajectory panel posts when it has neither (`precededBy`,
 * src/web/useTrajectory.ts). If one of those reads has become ready by the time
 * the panel opens, the panel can post a narrower, differently keyed job; the
 * article line keeps it behind this one and its Trajectory step then skips as
 * current, so it is a redundant row rather than a second paid run.
 *
 * This job's correctness does not depend on age, which it would otherwise:
 * `created_at` comes from the app server's clock, so two POSTs can land in the
 * line out of order (GPT Sol, P1 of the plan review). Normally the Quotes and
 * Ideas jobs are older, this job waits for them (it writes what they write),
 * and its first two steps then skip as current. If the Quotes job failed, this
 * job tries Quotes once more itself.
 */
export function autoModeRequests(): StepName[][] {
  return autoModeSteps().map((step) => {
    const reads = STEP_READS[step] ?? [];
    return STEP_ORDER.filter((s) => s === step || reads.includes(s));
  });
}

/**
 * Queue one job per main mode on `slug`.
 *
 * **The ones that read nothing go together, and the rest after them.** Only
 * the second group's ordering is wanted — Trajectory should find the Quotes and
 * Ideas jobs already in the line, so it waits for them rather than making them
 * itself, one after another — and firing the first group together shortens the
 * window in which a closed tab loses the rest (Sol, P4).
 *
 * A POST that fails is not retried and nothing reports it after the page has
 * gone: the mode simply shows its ordinary Generate button when opened. `run`
 * returns null on a refusal; a throw is the network, caught so one does not
 * stop the others.
 */
export async function queueAutoModes(run: UseJobs["run"], slug: string): Promise<void> {
  const post = (steps: StepName[]) => run({ slug, steps }).catch(() => null);
  const { together, after } = autoModePosts();
  await Promise.all(together.map(post));
  for (const steps of after) await post(steps);
}

/**
 * **The order `queueAutoModes` posts in**: the jobs that read nothing, fired
 * together, then the rest one after another. Not `autoModeRequests()`'s order
 * since `crossrefs` joined (260930f): it sorts last in `STEP_ORDER` but reads
 * nothing, so it goes out before Trajectory. Exported so the tests that pin
 * what the add page posts read this answer rather than a copy of it.
 */
export function autoModePosts(): { together: StepName[][]; after: StepName[][] } {
  const requests = autoModeRequests();
  return {
    together: requests.filter((steps) => steps.length === 1),
    after: requests.filter((steps) => steps.length > 1),
  };
}

const AUTO_MODES_KEY = "spideryarn.add.generate-main-modes";

/**
 * The reader's last choice, or **on** when they have never made one.
 *
 * Per browser rather than on the profile: it is a default for a checkbox, and
 * a column plus a `PATCH` for that would be a lot of machinery. Wrapped for the
 * reasons shelf-hidden-columns.ts gives — private windows throw, and under
 * jsdom `localStorage` can read `undefined`.
 */
export function readAutoModes(): boolean {
  try {
    return window.localStorage.getItem(AUTO_MODES_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeAutoModes(on: boolean): void {
  try {
    window.localStorage.setItem(AUTO_MODES_KEY, on ? "on" : "off");
  } catch {
    /* The choice holds for this visit — it is React state — and is simply
       not remembered for the next one. */
  }
}
