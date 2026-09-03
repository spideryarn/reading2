/**
 * **How a transcript is scored, stated once.**
 *
 * Two benchmarks now ask different questions of the same ten clips —
 * [`bench-vocabulary-sources.ts`](bench-vocabulary-sources.ts) varies the
 * vocabulary against one model, [`bench-models.ts`](bench-models.ts) varies the
 * model against one vocabulary — and their numbers are only comparable if the
 * word error rate means the same thing in both. It used to live inside the
 * first of them, which is fine until there are two; a second copy is a second
 * definition, and the day they drift is the day a table silently compares a
 * lenient WER against a strict one.
 *
 * The leniency is worth knowing and is deliberate: case, punctuation and
 * diacritics are normalised away before anything is compared, so `Muller Lyer`
 * scores as a hit for `Müller-Lyer`. Recall here means *the model found the
 * word*, not *the model spelled it exactly*. It is not lenient about `-ise`
 * against `-ize`. [`README.md`](README.md) has the rest.
 */

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Levenshtein distance in words, and the reference length beside it.
 *
 * **Both numbers, not a ratio**, so the caller can sum them into a corpus WER
 * (total edits over total reference words) as well as average the per-utterance
 * ratios. The two disagree, and the disagreement is the point: an average over
 * utterances lets a five-word dictation weigh as much as a thirty-word one,
 * which flatters or punishes a condition depending on which clip it stumbled
 * over. The first version reported only the average and called it WER. GPT
 * Sol's review, item 7.
 */
export function edits(ref: string, hyp: string): { words: number; edits: number } {
  const r = norm(ref).split(" ");
  const h = norm(hyp).split(" ");
  const w = h.length + 1;
  /* One flat row-major array rather than an array of arrays: the same distance,
     and it types cleanly under `noUncheckedIndexedAccess`. */
  const d = new Int32Array((r.length + 1) * w);
  for (let j = 0; j <= h.length; j++) d[j] = j;
  for (let i = 1; i <= r.length; i++) {
    d[i * w] = i;
    for (let j = 1; j <= h.length; j++) {
      d[i * w + j] =
        r[i - 1] === h[j - 1]
          ? (d[(i - 1) * w + j - 1] as number)
          : 1 +
            Math.min(
              d[(i - 1) * w + j] as number,
              d[i * w + j - 1] as number,
              d[(i - 1) * w + j - 1] as number,
            );
    }
  }
  return { words: r.length, edits: d[r.length * w + h.length] as number };
}

export const has = (haystack: string, needle: string) =>
  ` ${norm(haystack)} `.includes(` ${norm(needle)} `);

/**
 * Vocabulary terms the model produced that the reader did not say.
 *
 * **The floor is three characters, not six.** Six was the first choice, on the
 * reasoning that a short term like `AGI` or `God` turning up is weak evidence
 * of anything — and that reasoning quietly excused the detector from looking at
 * `Gall`, `Ava` and `LLM`, which is exactly the kind of insertion a biasing list
 * causes. The committed run's stored transcripts were re-scored at three
 * afterwards and **every count stayed zero**, so the stricter floor costs
 * nothing and the negative result holds at it. Terms of one or two characters
 * are still out: a two-letter string matches too much English to mean anything.
 *
 * Narrow on purpose and narrow in fact: it matches whole normalised phrases, so
 * it sees a term *inserted* and cannot see a term's influence. Read a zero as
 * "no exact vocabulary term was inserted", never as "no harm" — the control
 * clip's WER is the harm number that does not depend on this detector.
 */
export function invented(vocabulary: string, truth: string, hyp: string): string[] {
  const out: string[] = [];
  for (const term of vocabulary.split(", ")) {
    if (term.length < 3) continue;
    if (has(truth, term)) continue;
    if (has(hyp, term)) out.push(term);
  }
  return out;
}

/**
 * **Make the invented-terms detector fire before believing a zero from it.**
 *
 * The count came back zero everywhere on the first run, and a zero from a
 * detector nobody has watched work is the same shape as a zero from a detector
 * that is broken. So every benchmark that reports the column calls this first:
 * a planted transcript, a term that was never said, and a term that was.
 * docs/reusable/silent-success.md.
 */
export function checkInventedDetectorWorks(): void {
  const vocabulary = "Philoprogenitiveness, Gall, Spideryarn";
  const truth = "the argument in the second half is much weaker";
  /* One long term and one four-letter one, because the four-letter one is what
     the old six-character floor was silently excusing itself from. */
  const found = invented(
    vocabulary,
    truth,
    "the argument is weaker, said Gall of Philoprogenitiveness",
  );
  if (found.sort().join(",") !== "Gall,Philoprogenitiveness") {
    throw new Error(`the invented-terms check does not work: got [${found.join(", ")}]`);
  }
  if (invented(vocabulary, "I like Spideryarn", "I like Spideryarn").length) {
    throw new Error("the invented-terms check counts a term the reader actually said");
  }
}
