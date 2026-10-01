/**
 * **The byline eval's scoring: does the author check take a correct list, and
 * does it ever let a printed author go?** Shared by `evals/pdf/bylines.mts`
 * (old vs new, by hand) and `tests/pdf-bylines-eval.test.ts` (the gate).
 *
 * Each case in `bylines/cases.json` is a real byline as a PDF's text layer gives
 * it, with the answer a correct model gives. The answer is fixed, so this
 * measures `verifyAuthors`, not the model. Plan 261001l § The eval.
 *
 * Two scores:
 *
 * - **positives**: the correct answer — taken as a list, as names only, or
 *   refused (the reader then gets the byline as printed);
 * - **silent drops**: generated and hand-written answers that leave a printed
 *   author out, which must all be refused. Taking one as a list or as names is
 *   the failure that matters, and it must stay at zero.
 */
import type { AuthorAnswer, AuthorsVerdict } from "../../src/pdf-authors.js";

export interface BylineCase {
  id: string;
  source: string;
  shape: string[];
  bylineText: string;
  pages: string[];
  answer: AuthorAnswer[];
  /** Hand-written omissions/replacements that deletion alone cannot express. */
  adversarialDrops?: Dropped[];
  notes?: string;
}

export type Verify = (answer: readonly AuthorAnswer[], bylineText: string, pages: readonly string[]) => AuthorsVerdict;

export type Outcome = "list" | "names" | "refused";

export const outcomeOf = (v: AuthorsVerdict): Outcome =>
  v.authors ? "list" : "names" in v ? "names" : "refused";

/** One answer that leaves somebody out, and how it was made. */
export interface Dropped {
  how: string;
  answer: AuthorAnswer[];
}

/**
 * **Answers that leave a printed author out.** Removing an author alone also
 * removes their affiliation, so it cannot catch the dangerous answer — the one
 * where the dropped author's words are handed to the previous author as an
 * affiliation (GPT Sol, plan review of 261001l, P1-3). So that is derived too,
 * and again with an unrelated affiliation that fails, which is what reaches the
 * names-only arm.
 */
export function droppedAnswers(answer: readonly AuthorAnswer[]): Dropped[] {
  const out: Dropped[] = [];
  const copy = () => answer.map((a) => ({ name: a.name, affiliations: [...a.affiliations] }));
  if (answer.length < 2) return out;
  for (let i = 0; i < answer.length; i++) {
    const without = copy().filter((_, j) => j !== i);
    out.push({ how: `drop ${i + 1}`, answer: without });
    if (i > 0) {
      const gone = answer[i]!;
      const passedOff = copy();
      passedOff[i - 1]!.affiliations.push([gone.name, ...gone.affiliations].join(" "));
      passedOff.splice(i, 1);
      out.push({ how: `drop ${i + 1}, passed off as ${i}'s affiliation`, answer: passedOff });
      const withFailure = passedOff.map((a) => ({ ...a, affiliations: [...a.affiliations] }));
      withFailure.at(-1)!.affiliations.push("Institute That Is Not Printed Anywhere");
      out.push({ how: `drop ${i + 1}, passed off, and a failing affiliation`, answer: withFailure });
    }
    if (i + 1 < answer.length) {
      out.push({ how: `drop ${i + 1} and ${i + 2}`, answer: copy().filter((_, j) => j !== i && j !== i + 1) });
    }
  }
  return out;
}

export interface CaseScore {
  id: string;
  shape: string[];
  positive: Outcome;
  /** Present only when the positive was refused: the check's own reason. */
  refusal?: string;
  dropsTried: number;
  /** Derived answers that were NOT refused — each one a printed author let go. */
  silentDrops: string[];
}

export function scoreCase(verify: Verify, c: BylineCase): CaseScore {
  const verdict = verify(c.answer, c.bylineText, c.pages);
  const positive = outcomeOf(verdict);
  const dropped = [...droppedAnswers(c.answer), ...(c.adversarialDrops ?? [])];
  const silentDrops = dropped
    .filter((d) => outcomeOf(verify(d.answer, c.bylineText, c.pages)) !== "refused")
    .map((d) => d.how);
  return {
    id: c.id,
    shape: c.shape,
    positive,
    ...(positive === "refused" && "note" in verdict && verdict.note ? { refusal: verdict.note } : {}),
    dropsTried: dropped.length,
    silentDrops,
  };
}
