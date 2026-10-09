/**
 * **Generate the main modes once an import finishes** — what the add page's
 * tick box says, and the derivation that keeps the list honest.
 *
 * > give me a tick box that's probably default-true that will automatically run
 * > the generation for all of the main modes, i.e. the ones that are not
 * > experimental features … if that's making this much harder, do the simpler
 * > thing first of just a way to automatically kick off the other modes once the
 * > paper is open
 * >
 * > — Greg, 2026-09-30
 *
 * **The page queues nothing.** Since plan 261004h the server queues the jobs in
 * the transaction that publishes an import (src/store/pg-revisions.ts §
 * `publishRevisionIn`), for every way an import can start, and the box is the
 * reader's setting on their own row (`GET`/`PATCH /api/reader`, `autoModes`;
 * src/web/auto-modes-setting.ts). The list of jobs is src/auto-mode-steps.ts, a
 * leaf both sides import.
 * docs/plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md.
 *
 * ## Which modes
 *
 * Every mode not behind the experimental switch
 * (`MODE_CATALOG[mode].experimental`), mapped to the step it makes (`modeStep`,
 * src/web/activation.ts). Structure and Plain make nothing — one reads the tree
 * the import already built, the other is the article — while Chat and Search
 * wait on the reader. Summary is in since 2026-10-02, when its press began
 * writing the plain-words levels
 * (docs/plans/261002a-summary-generates-on-open.md).
 *
 * **That derivation lives here and the list the server uses is written out**,
 * because `modeStep` imports the browser's job engine and the server cannot
 * run it. tests/auto-modes.test.tsx asserts `derivedAutoModeSteps()` equals
 * `AUTO_MODE_STEPS`, so a mode moved in or out of the switch fails a test until
 * the written list follows.
 *
 * **Two modes' steps are named here rather than derived**: Summary, whose press
 * is delegated since 2026-10-03, and Peer review, delegated by sub-mode since
 * 2026-10-09, so `modeStep` cannot answer for either — `DELEGATED_MODE_STEPS`
 * below.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { type Mode, MODES } from "../modes.js";
import { STEP_ORDER } from "../step-order.js";
import { MODE_LABEL } from "../title-text.js";
import type { StepName } from "../types.js";
import { modeStep } from "./activation.js";
import { PEER_REVIEW_SUB_MODES } from "./sub-modes.js";

/**
 * **The steps of a main mode whose press is delegated**, which `modeStep`
 * answers `null` for because the step is the press's, not the mode's.
 *
 * Summary is the one: a press arms `simple` or nothing, by the view it lands on
 * (activation.ts § `activationForSummary`), and the mode shows two artefacts —
 * the plain-words levels and the thread. The box queued both on 2026-10-02,
 * `simple` as Summary's step and `tweets` as the Tweets mode's, and both are
 * queued still. Left to the derivation, making Summary delegated and retiring
 * Tweets would have dropped the pair without a word (GPT Sol, F2 of the 261003l
 * review) — tests/auto-modes.test.tsx asserts the whole list for that reason.
 *
 * Diagram, another delegated mode, is behind the experimental switch and so
 * is not a main mode; if it leaves the switch, its row here is a decision to
 * make then, not a default to inherit.
 *
 * **Marginalia is a main mode, delegated, and absent on purpose.** Its
 * relation words are made the first time the column is shown, not on import
 * (Greg, 2026-10-05; src/web/useRelations.ts). A row here would queue them
 * for every article again.
 */
const DELEGATED_MODE_STEPS: Partial<Record<Mode, readonly StepName[]>> = {
  summary: ["simple", "tweets"],
  /* **Peer review, since 2026-10-09: Bibliography's list, and only that.**
     Its press is delegated by sub-mode (activation.ts §
     `activationForPeerReview`). `citations` is the default sub-mode's, and
     Claims' line of works (plan 261009l § Stage 2) reads it. Not `debate`,
     Reception's web search, the dearest press in the app and often empty; not
     `debate-claims`, which serves a sub-mode many readers will not open. Each
     runs on the press of its chip. One model call per import that was not
     paid before (plan 261009l § On import). */
  "peer-review": ["citations"],
};

/**
 * The main modes that make something, each with its step, in `STEP_ORDER` —
 * one entry per step, so Summary is here twice.
 */
function autoModes(): { mode: Mode; step: StepName }[] {
  const found: { mode: Mode; step: StepName }[] = [];
  for (const mode of MODES) {
    if (MODE_CATALOG[mode].experimental) continue;
    const step = modeStep(mode);
    if (step) found.push({ mode, step });
    for (const delegated of DELEGATED_MODE_STEPS[mode] ?? []) found.push({ mode, step: delegated });
  }
  return found.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));
}

/**
 * **Steps queued that no mode makes**, added by hand because the list above is
 * derived from modes and these are not one.
 *
 * `crossrefs` — the links from a phrase in one passage to the passage that
 * backs it. They sit in the prose in every mode, so there is no mode to derive
 * them from; Greg asked for them as *"a preprocessing step that always
 * happens"*, and this is the "always" for a new article. It reads nothing, so
 * its job is one step.
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md § 3.
 */
export const AUTO_EXTRA_STEPS: readonly StepName[] = ["crossrefs"];

/**
 * **The list as the mode catalogue derives it**, in `STEP_ORDER`. Nothing in
 * the app queues from this: it exists so tests/auto-modes.test.tsx can hold
 * `AUTO_MODE_STEPS` (src/auto-mode-steps.ts), the written list the server
 * queues from, equal to it.
 */
export function derivedAutoModeSteps(): StepName[] {
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
  /* A mode with two steps (Summary: its lengths and its thread) is named once.
     Peer review is named by the one sub-mode it prepares, so the line does
     not promise its Reception search. */
  const names = [
    ...new Set(
      autoModes().map(({ mode }) =>
        mode === "peer-review" ? `${MODE_LABEL[mode]}’s ${PEER_REVIEW_SUB_MODES.bibliography.label}` : MODE_LABEL[mode],
      ),
    ),
  ];
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return `${list} are prepared in the background, with Skim after Quotes and Ideas, and so are the links from one passage of the article to another. This uses paid model calls.`;
}
