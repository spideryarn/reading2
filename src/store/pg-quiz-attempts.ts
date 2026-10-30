/**
 * The reader's finished quiz marks — both halves, write and read.
 * docs/plans/261005b-quiz-answers-are-kept-and-restored.md § The table;
 * the table's own reasoning is on `quizAttempts` in src/db/schema.ts.
 *
 * `record` **appends**: a second answer to a question is a second row, never
 * an update, so when each try happened is kept. It names no time — the
 * database stamps `created_at` — and hands that time back, because it is the
 * one the client orders this answer by against what a later read returns —
 * and the row's id, which a chat about this mark names (`QuizOrigin`).
 *
 * `latestForBatch` reads every row of one batch, newest first per question,
 * and returns the first of each with the schedule its history gives
 * (src/quiz-spacing.ts, plan 261030c): the rows of a batch that *Write them
 * again* has replaced are still in the table, and are not this read's to
 * return.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is — not the answer, the mark or the verdict. A quiz
 * answer is a record of what somebody did not know. `guardDbStore` below is what keeps a failed insert's parameters — the
 * answer and the mark — out of the error that reaches a log.
 */

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { quizAttempts } from "../db/schema.js";
import type { QuizKeptAnswer } from "../types.js";
import type { QuizAttemptStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";
import { asOf, recallAfterDays, type QuizTry } from "../quiz-spacing.js";

/** What the schedule reads of a row. */
const TRY_COLUMNS = { id: quizAttempts.id, verdict: quizAttempts.verdict, createdAt: quizAttempts.createdAt };

/**
 * **The one order of a question's tries**, newest first — `id` last only so
 * two rows in one microsecond have an order at all. The latest answer and the
 * schedule are both read in it, so they cannot disagree about which is newest.
 */
const NEWEST_FIRST = [desc(quizAttempts.createdAt), desc(quizAttempts.id)] as const;

const asTry = (row: { id: string; verdict: QuizTry["verdict"]; createdAt: Date }): QuizTry => ({
  id: row.id,
  verdict: row.verdict,
  at: row.createdAt.getTime(),
});

const rawPgQuizAttemptStore: QuizAttemptStore = {
  async record(slug, attempt) {
    /* Owner-scoped: a slug the caller does not own is a 404 here, as everywhere. */
    const articleId = await articleIdForOwned(slug);
    const [row] = await getDb()
      .insert(quizAttempts)
      .values({
        articleId,
        batchId: attempt.batchId,
        questionId: attempt.questionId,
        question: attempt.question,
        answer: attempt.answer,
        reply: attempt.reply,
        /* `NULL` when the check failed or declined — never "wrong". */
        verdict: attempt.verdict ?? null,
      })
      .returning({ id: quizAttempts.id, createdAt: quizAttempts.createdAt });
    if (!row) throw new Error("the quiz attempt insert returned no row");
    /* **The schedule as of this mark.** The question's tries, in the read's
       own order, from this row back: a mark that lands between the insert and
       this select is newer and is cut off, so this mark is never sent another
       mark's schedule (GPT Sol's plan review of 261030c, F1). */
    const history = await getDb()
      .select(TRY_COLUMNS)
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.articleId, articleId),
          eq(quizAttempts.batchId, attempt.batchId),
          eq(quizAttempts.questionId, attempt.questionId),
        ),
      )
      .orderBy(...NEWEST_FIRST);
    return {
      id: row.id,
      answeredAt: row.createdAt.toISOString(),
      recallAfterDays: recallAfterDays(asOf(history.map(asTry), row.id)),
    };
  },

  async latestForBatch(slug, batchId): Promise<QuizKeptAnswer[]> {
    const articleId = await articleIdForOwned(slug);
    /* **One select of the batch's rows, not a latest-per-question read and a
       history read beside it**: two reads could return one mark's answer with
       another's schedule (Sol's F1). Tens of rows for a batch of a dozen
       questions. Grouped here; the first of each question is its latest. */
    const rows = await getDb()
      .select({
        ...TRY_COLUMNS,
        questionId: quizAttempts.questionId,
        answer: quizAttempts.answer,
        reply: quizAttempts.reply,
      })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.articleId, articleId), eq(quizAttempts.batchId, batchId)))
      .orderBy(quizAttempts.questionId, ...NEWEST_FIRST);
    const byQuestion = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const tries = byQuestion.get(row.questionId);
      if (tries) tries.push(row);
      else byQuestion.set(row.questionId, [row]);
    }
    return [...byQuestion.values()].flatMap((tries) => {
      const latest = tries[0];
      if (!latest) return [];
      return [
        {
          questionId: latest.questionId,
          attemptId: latest.id,
          answer: latest.answer,
          reply: latest.reply,
          answeredAt: latest.createdAt.toISOString(),
          ...(latest.verdict ? { verdict: latest.verdict } : {}),
          recallAfterDays: recallAfterDays(tries.map(asTry)),
        },
      ];
    });
  },

  async questionOf(slug, mark) {
    const articleId = await articleIdForOwned(slug);
    const [row] = await getDb()
      .select({ question: quizAttempts.question })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.articleId, articleId),
          eq(quizAttempts.id, mark.attemptId),
          eq(quizAttempts.batchId, mark.batchId),
          eq(quizAttempts.questionId, mark.itemId),
        ),
      );
    return row?.question ?? null;
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgQuizAttemptStore: QuizAttemptStore = guardDbStore("quiz-attempts", rawPgQuizAttemptStore);
