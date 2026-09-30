/**
 * **The quiz's per-section picture** — each answer's verdict counted against
 * the sections its question is about, and the sections worth looking at again.
 *
 * > Score each quiz answer against the article's blocks, giving a rough
 * > per-section picture of what the reader has got. That could steer your
 * > adaptive quiz (spya-jc2ub9) towards the sections they're weakest on, not
 * > just adjust its difficulty. And somehow indicate to the reader which
 * > sections to (re-)read next.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-6R)
 *
 * **A join, not a model call.** Each answer is already judged against the
 * article (src/quiz-verdict.ts), each question already names its blocks
 * (`QuizEvidence`), and the reading view already has its sections
 * (src/web/position.ts § `buildSections` — the level the reader sees called
 * "Sections", one above the leaves, with the notes collapsed into one). This
 * file only counts. Pure: no React, no DOM.
 *
 * **Per visit, and never stored.** The verdicts are `QuizPanel`'s React state
 * and so is everything computed from them here; nothing is logged or sent.
 * docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md.
 */
import type { BlockId, QuizQuestion, QuizQuestionId, QuizVerdict } from "../types.js";
import { type Section, sectionIndexContaining } from "./position.js";

export interface SectionTally {
  section: Section;
  /** The questions about it, in path order. */
  questionIds: QuizQuestionId[];
  /** Questions whose latest verdict this visit is `right` / `wrong`. No verdict is neither. */
  right: number;
  wrong: number;
}

/** How many sections "Where to look again" names at most. */
export const MAX_WEAK_SECTIONS = 3;

/**
 * The indices of the distinct sections a question's evidence is in, in
 * evidence order. A block the page does not have — a stale id from an older
 * batch — counts nowhere, and so do a supplement and a section with no title,
 * because neither is part of the argument this feature is measuring and an
 * unnamed row cannot be pointed at. Evidence is body-only by construction
 * (`isBodyEvidence` in src/quiz.ts); the supplement check keeps that policy
 * true if malformed or older artefact data reaches this pure boundary.
 *
 * **A block before the first section is in none.** `sectionIndexContaining`
 * clamps a row above the first section into it, which is right for "where is
 * the reader" (`?at=`, the return chip) and wrong for "what is this passage
 * about": it would invent evidence for the first section. Checked here rather
 * than changed there, because those callers want the clamp. GPT Sol's code
 * review.
 */
export function sectionsOfQuestion(
  question: QuizQuestion,
  sections: readonly Section[],
  rowOf: ReadonlyMap<BlockId, number>,
): number[] {
  const first = sections[0]?.row;
  const out: number[] = [];
  for (const e of question.evidence) {
    const row = rowOf.get(e.blockId);
    if (row === undefined || first === undefined || row < first) continue;
    const i = sectionIndexContaining(sections, rowOf, e.blockId);
    if (
      i === null ||
      out.includes(i) ||
      sections[i]?.supplement ||
      !sections[i]?.title.trim()
    ) {
      continue;
    }
    out.push(i);
  }
  return out;
}

/**
 * One row per section any question is about, in article order. A question
 * counts once in each section its evidence is in. **No verdict counts as
 * neither** — unanswered, skipped, a failed mark and a failed classifier are
 * not evidence either way.
 */
export function sectionTally(
  questions: readonly QuizQuestion[],
  verdicts: ReadonlyMap<QuizQuestionId, QuizVerdict>,
  sections: readonly Section[],
  rowOf: ReadonlyMap<BlockId, number>,
): SectionTally[] {
  const rows = new Map<number, SectionTally>();
  for (const question of questions) {
    const verdict = verdicts.get(question.id);
    for (const i of sectionsOfQuestion(question, sections, rowOf)) {
      let row = rows.get(i);
      if (!row) {
        row = { section: sections[i] as Section, questionIds: [], right: 0, wrong: 0 };
        rows.set(i, row);
      }
      row.questionIds.push(question.id);
      if (verdict === "right") row.right++;
      else if (verdict === "wrong") row.wrong++;
    }
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

/**
 * The sections to look at again: those with at least one answer judged wrong,
 * weakest first — the largest share of its judged answers wrong, then the
 * most wrong, then article order. A share rather than a count, so a section
 * with one miss and nothing right comes before one with two misses among
 * twenty right (GPT Sol's F7 on the plan). `tally` arrives in article order
 * and the sort is stable, so the last key is free.
 */
export function weakSections(tally: readonly SectionTally[], max = MAX_WEAK_SECTIONS): SectionTally[] {
  const share = (s: SectionTally) => s.wrong / (s.right + s.wrong);
  return tally
    .filter((s) => s.wrong > 0)
    .sort((a, b) => share(b) - share(a) || b.wrong - a.wrong)
    .slice(0, max);
}

/**
 * The question "its questions" goes back to: the first on the path, in this
 * section, whose latest verdict is `wrong` and which the reader may land on
 * (`allowed` — 61's filter decides that, not this file). Undefined when there
 * is none, and then the panel draws no button.
 */
export function firstWrongIn(
  section: SectionTally,
  verdicts: ReadonlyMap<QuizQuestionId, QuizVerdict>,
  allowed: (id: QuizQuestionId) => boolean,
): QuizQuestionId | undefined {
  return section.questionIds.find((id) => verdicts.get(id) === "wrong" && allowed(id));
}
