/**
 * **The model's two 0–1 judgments — `difficulty` and `centrality` — read the
 * way every stage that asks for them reads them.**
 *
 * The Glossary asked for these first (docs/project/glossary.md § The scores),
 * and the FAQ asks for the same two, under the same names, since 2026-09-29
 * (docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md). One
 * validator and one counter, here, rather than a copy per stage: the Glossary's
 * lived in src/glossary.ts until then. Quotes and Bibliography score other axes and
 * keep their own.
 *
 * ## Absent versus rejected
 *
 * A score that was **not there at all** is `*Absent`; one that was there and
 * `score()` refused — wrong type, not finite, outside 0–1, or a JSON `null` —
 * is `*Rejected`. Keeping them apart is what tells "the model stopped obeying
 * the instruction" from "the model started answering in the wrong shape"
 * (`"high"` for `0.8`), and either one would otherwise quietly switch off the
 * prioritised order with no log line moving (docs/reusable/silent-success.md).
 *
 * **The counters ride no artefact.** A score the model failed to write is a
 * fact about our prompt, not about the reader's article; each stage logs them
 * on its own line in src/pipeline.ts.
 */

/** 0–1, or nothing. Anything outside the range is a model error, not a signal to clamp silently. */
export function score(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

/** Counts of FIELDS, per run: what happened to the two scores the prompt asked for. */
export interface DifficultyCentralityDrops {
  /** `difficulty` was not there at all. */
  difficultyAbsent: number;
  /** `difficulty` was there and `score()` refused it. */
  difficultyRejected: number;
  /** `centrality` was not there at all. */
  centralityAbsent: number;
  /** `centrality` was there and `score()` refused it. */
  centralityRejected: number;
}

/** A fresh set. One per run, threaded by hand so nothing sums two runs. */
export function noDifficultyCentralityDrops(): DifficultyCentralityDrops {
  return { difficultyAbsent: 0, difficultyRejected: 0, centralityAbsent: 0, centralityRejected: 0 };
}

/**
 * Read one 0–1 score and say, in the counters, what happened to it.
 *
 * **`undefined` is absent; everything else `score()` refuses is rejected.** A
 * JSON `null` therefore lands in `rejected` — the model wrote a value and it
 * was not a number, and calling that "absent" would let a model answer `null`
 * on every entry without ever moving the counter that means it stopped obeying.
 *
 * Call it only where an item is about to be kept, so an item the stage refuses
 * for some other reason never contributes a missing score. The twin of
 * `scoreCounting` in src/quotes.ts and src/bibliography.ts, over other axes.
 */
export function scoreCounting(
  value: unknown,
  scores: DifficultyCentralityDrops,
  absent: "difficultyAbsent" | "centralityAbsent",
  rejected: "difficultyRejected" | "centralityRejected",
): number | undefined {
  if (value === undefined) {
    scores[absent]++;
    return undefined;
  }
  const kept = score(value);
  if (kept === undefined) scores[rejected]++;
  return kept;
}
