/**
 * The reader's finished quiz marks — both halves, write and read.
 * docs/plans/261005b-quiz-answers-are-kept-and-restored.md § The table;
 * the table's own reasoning is on `quizAttempts` in src/db/schema.ts.
 *
 * `record` **appends**: a second answer to a question is a second row, never
 * an update, so when each try happened is kept. It names no time — the
 * database stamps `created_at` — and hands that time back, because it is the
 * one the client orders this answer by against what a later read returns.
 *
 * `latestForBatch` is `select distinct on (question_id)` over one batch, newest
 * first: the rows of a batch that *Write them again* has replaced are still in
 * the table, and are not this read's to return.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. A quiz answer is a record of what somebody did not
 * know. `guardDbStore` below is what keeps a failed insert's parameters — the
 * answer and the mark — out of the error that reaches a log.
 */

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { quizAttempts } from "../db/schema.js";
import type { QuizKeptAnswer } from "../types.js";
import type { QuizAttemptStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

const rawPgQuizAttemptStore: QuizAttemptStore = {
  async record(slug, attempt): Promise<string> {
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
      })
      .returning({ createdAt: quizAttempts.createdAt });
    if (!row) throw new Error("the quiz attempt insert returned no row");
    return row.createdAt.toISOString();
  },

  async latestForBatch(slug, batchId): Promise<QuizKeptAnswer[]> {
    const articleId = await articleIdForOwned(slug);
    const rows = await getDb()
      .selectDistinctOn([quizAttempts.questionId], {
        questionId: quizAttempts.questionId,
        answer: quizAttempts.answer,
        reply: quizAttempts.reply,
        createdAt: quizAttempts.createdAt,
      })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.articleId, articleId), eq(quizAttempts.batchId, batchId)))
      /* `id` last only so that two rows in one microsecond have an order at all. */
      .orderBy(quizAttempts.questionId, desc(quizAttempts.createdAt), desc(quizAttempts.id));
    return rows.map((row) => ({
      questionId: row.questionId,
      answer: row.answer,
      reply: row.reply,
      answeredAt: row.createdAt.toISOString(),
    }));
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgQuizAttemptStore: QuizAttemptStore = guardDbStore("quiz-attempts", rawPgQuizAttemptStore);
