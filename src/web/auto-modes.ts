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
 * (`MODE_CATALOG[mode].experimental`), bar Ideas (`NOT_ON_IMPORT`), mapped to the step it makes (`modeStep`,
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
 * is delegated since 2026-10-03, and Sources, delegated by sub-mode since
 * 2026-10-09, so `modeStep` cannot answer for either — `DELEGATED_MODE_STEPS`
 * below.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { type Mode, MODES } from "../modes.js";
import { STEP_ORDER } from "../step-order.js";
import { MODE_LABEL } from "../title-text.js";
import type { StepName } from "../types.js";
import { modeStep } from "./activation.js";
import { SOURCES_SUB_MODES } from "./sub-modes.js";

/**
 * **The steps of a main mode whose press is delegated**, which `modeStep`
 * answers `null` for because the step is the press's, not the mode's.
 *
 * Summary is the one: a press arms `simple` or nothing, by the view it lands on
 * (activation.ts § `activationForSummary`), and the mode shows two artefacts —
 * the plain-words levels and the thread. Only the levels are queued: the thread
 * was on the list from 2026-09-30 until Greg took it off on 2026-10-22 ("we
 * should generate that if someone presses on it"), and opening the Thread view
 * writes it (docs/plans/261022b-summary-thread-writes-only-when-pressed.md).
 * Left to the derivation, a delegated Summary would drop `simple` without a
 * word (GPT Sol, F2 of the 261003l review) — tests/auto-modes.test.tsx asserts
 * the whole list for that reason.
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
  summary: ["simple"],
  /* **Sources, since 2026-10-09: Bibliography's list, and only that.**
     Its press is delegated by sub-mode (activation.ts §
     `activationForSources`). `bibliography` is the default sub-mode's, and
     Claims' line of works (plan 261009l § Stage 2) reads it. Not `debate`,
     Reception's web search, the dearest press in the app and often empty; not
     `debate-claims`, which serves a sub-mode many readers will not open. Each
     runs on the press of its chip. One model call per import that was not
     paid before (plan 261009l § On import). */
  sources: ["bibliography"],
};

/**
 * **Main modes that make something and are still not prepared on import**,
 * each a decision of Greg's rather than a default.
 *
 * Ideas, since 2026-10-29 (`spya-shwpw5`): "I don't think the ideas mode is
 * that helpful, and from memory, I think it's quite expensive … if it is, I'd
 * be inclined to say that we shouldn't run it by default." It was the dearest
 * step on the list after Summary, a median $0.19 an article. Opening it writes
 * it, and Skim plans without it on import (src/auto-mode-steps.ts §
 * `autoModeRequests`). docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md.
 */
const NOT_ON_IMPORT: ReadonlySet<Mode> = new Set<Mode>(["ideas"]);

/**
 * The main modes that make something, each with its step, in `STEP_ORDER` —
 * one entry per step.
 */
function autoModes(): { mode: Mode; step: StepName }[] {
  const found: { mode: Mode; step: StepName }[] = [];
  for (const mode of MODES) {
    if (MODE_CATALOG[mode].experimental || NOT_ON_IMPORT.has(mode)) continue;
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
  /* A mode is named once, however many steps it has.
     Sources is named by the one sub-mode it prepares, so the line does
     not promise its Reception search. */
  const names = [
    ...new Set(
      autoModes().map(({ mode }) =>
        mode === "sources" ? `${MODE_LABEL[mode]}’ ${SOURCES_SUB_MODES.bibliography.label}` : MODE_LABEL[mode],
      ),
    ),
  ];
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return `${list} are prepared in the background, with Skim after Quotes, and so are the links from one passage of the article to another. This uses paid model calls.`;
}
