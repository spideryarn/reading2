/**
 * **A hand-built `QuizRead`** for tests that mount something handed the
 * owner's quiz read (`OwnerMarginFeed`, since plan 261029c) without caring
 * about the quiz. `status` defaults to `"ready"`, so a mount that would
 * otherwise write one on show (`useQuizOnShow`) starts nothing.
 */
import type { QuizRead } from "../../src/web/useQuiz.js";

export function quizReadStub(over: Partial<QuizRead> = {}): QuizRead {
  return {
    status: "ready",
    quiz: null,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
    kept: new Map(),
    keptUnread: false,
    noteMark: () => {},
    claimMark: () => () => {},
    error: null,
    retryRead: async () => {},
    reload: async () => {},
    refresh: async () => {},
    ...over,
  };
}
