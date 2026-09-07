/**
 * **Saying that a model's JSON had to be repaired, without saying what was in it.**
 *
 * `dropTrailingCommas` in [parse-json.ts](parse-json.ts) mends a malformed model
 * answer — a comma before a `}` or a `]` — and until 2026-09-07 nothing recorded
 * that it had. Its own docstring said so and called it a known cost: a model that
 * starts emitting these on every answer gets quietly accommodated instead of
 * noticed, so "the model got the format wrong" is an invisible tax rather than a
 * rate anybody can watch.
 * docs/postmortems/260906b-asking-a-model-to-omit-a-field-makes-it-emit-the-comma-anyway.md.
 *
 * ## Why this is a file of its own, and not a `log()` call in `parse-json.ts`
 *
 * That module deliberately has **no logger**, and the reason is its whole
 * purpose: `JSON.parse`'s own error message quotes the input back at you, every
 * string it parses is the article's prose or a model's answer about it, and
 * docs/project/logging.md § *What never gets logged* says that text never goes
 * into a line. A logger in scope there makes `logger.warn({ text })` a one-line
 * mistake for the next person, and the module's header is currently the only
 * thing standing in the way.
 *
 * So the seam is this function's **signature** — a `source`, a count, and a
 * two-valued outcome. Said exactly, because the tempting version is false and a
 * comment that overstates a guarantee is worse than none: `source` is a
 * `string`, so `noteJsonRepair(raw, …)` **would typecheck**. What the signature
 * does buy is that the raw text and the repaired span are not among the things
 * it asks for, and what the *module* buys is that they are not in scope here at
 * all — this file cannot reach them however it is edited. `source` rests on the
 * same promise `parseJsonFrom`'s second argument has always rested on: the
 * caller's word that this string is safe to log (see the module header, and
 * src/log.ts rule 3). A type-level guarantee would need `source` to be a closed
 * union, which is a change to thirteen call sites and a different stage.
 * GPT Sol, 2026-09-07, F9.
 *
 * Not an observer that something registers, and not a tally: the first
 * is mutable process state — which
 * [architecture.md](../docs/project/architecture.md) § *Process-wide mutable
 * state must have process lifetime* would send through
 * [process-state.ts](process-state.ts), because Vite re-evaluates server modules
 * in place and a module-level counter silently becomes two — and the second is
 * a number nobody reads. One log line at the seam is the smaller thing that
 * answers the question. GPT Sol, 2026-09-07, F1 and F2.
 *
 * ## It cannot throw, and that matters here more than usual
 *
 * A repair happens *after* a model call has been paid for. A diagnostic that
 * threw would discard an answer that had already been mended and was about to be
 * returned — telemetry changing behaviour, which is the failure
 * [log.ts](log.ts) rule 5 exists to make structural: *"A log call never throws,
 * and never has to be wrapped in a `try`."* This adds nothing on top, on
 * purpose: a `try` here would imply the guarantee were weaker than it is.
 */
import { log } from "./log.js";

/**
 * What became of the answer *after* the commas came out.
 *
 * Both are worth counting and they mean opposite things. `accepted` is the tax —
 * the model got the format wrong and we absorbed it. `still-invalid` is a broken
 * answer that a repair could not save, where the commas were a symptom rather
 * than the fault, and the reader gets a Retry button.
 */
export type RepairOutcome = "accepted" | "still-invalid";

/**
 * Record one **parse-repair invocation**.
 *
 * Named for what it actually counts, which is not the same as "model answers
 * repaired" and must not be read as it. One model answer can be parsed more than
 * once — a stored hierarchy expansion is parsed again when a run resumes, and a
 * refused expansion is parsed twice by design — so this over-counts answers; and
 * a repair that removed commas from an answer with another fault in it is
 * counted here but is not an accommodation. Counting answers would mean
 * instrumenting the model-call seam instead, and distinguishing a fresh answer
 * from a checkpoint. GPT Sol, 2026-09-07, F4.
 *
 * `source` is `parseJsonAnswer`'s own argument — `"the quotes response"`, `"the
 * nav labels"` — which is a project-authored constant at every call site, never
 * anything derived from content. That is what makes it safe to log, and it is
 * the classification: it says *which stage's model* is emitting these.
 */
export function noteJsonRepair(source: string, removed: number, outcome: RepairOutcome): void {
  log("model").warn(
    { source, removed, outcome },
    "repaired trailing commas in a model answer before parsing it",
  );
}
