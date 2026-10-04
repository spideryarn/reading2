/**
 * **The store contracts require what the store requires** — the attempt token,
 * and a patch that ends the run.
 *
 * ## This file is checked by `npm run typecheck`, not by `npm test`
 *
 * Vitest strips types and never checks them, so nothing below can go red under
 * `npm test`; the one `it` is there so the file is not an empty suite. Every
 * claim is a line the **compiler** has to accept or refuse:
 *
 * - a `@ts-expect-error` line is a call the contract must refuse. If the
 *   contract loosens, the directive becomes unused and typecheck fails on it.
 * - a plain typed assignment is something the contract must promise. If it
 *   stops promising it, the assignment stops compiling.
 *
 * Seen red on 2026-10-04 against the contracts as they were: twelve unused
 * directives and four failed assignments
 * (docs/plans/261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md).
 *
 * ## Why it exists
 *
 * The token was optional in these signatures for the filesystem store, which
 * had none and was deleted on 2026-09-05. The one store left refused a write
 * without it at run time, so the compiler approved a call the only
 * implementation rejected, and a test double could leave the token out.
 * The run-time refusals are still there, for a caller that got round the types
 * with a cast (tests/store-searches-pg.test.ts and its siblings cover them).
 */
import { describe, expect, it } from "vitest";

import type {
  ChatStore,
  CommentStore,
  RefereeClaimsStore,
  RefereeCriteriaStore,
  SearchStore,
} from "../src/store/contracts.js";

/** Never called. Its body is the test, and the compiler is what runs it. */
async function theContracts(
  search: SearchStore,
  criteria: RefereeCriteriaStore,
  claims: RefereeClaimsStore,
  chat: ChatStore,
  comments: CommentStore,
): Promise<string[]> {
  /* ---- Search ---- */
  const searchAttempt: string = (await search.begin("slug", "a criterion", "quick")).attempt;
  await search.finish("slug", "run", { status: "done", hits: [] }, searchAttempt);
  await search.finish("slug", "run", { status: "error", error: "no" }, searchAttempt);
  // @ts-expect-error — no attempt: identity alone cannot say which call is reporting.
  await search.finish("slug", "run", { status: "done", hits: [] });
  // @ts-expect-error — a finish ends the run; `pending` would strip the fence off a live row.
  await search.finish("slug", "run", { status: "pending" }, searchAttempt);
  // @ts-expect-error — a finish reports an answer; it cannot rewrite the question.
  await search.finish("slug", "run", { status: "done", hits: [], criterion: "another" }, searchAttempt);

  /* ---- Referee criteria ---- */
  const criterionAttempt: string = (
    await criteria.begin("slug", "a criterion", { kind: "single" })
  ).attempt;
  await criteria.finish("slug", "id", { status: "done", results: [] }, criterionAttempt);
  // @ts-expect-error — no attempt.
  await criteria.finish("slug", "id", { status: "done", results: [] });
  // @ts-expect-error — a finish ends the criterion.
  await criteria.finish("slug", "id", { status: "pending" }, criterionAttempt);
  // @ts-expect-error — the config is `begin`'s to set, not `finish`'s.
  await criteria.finish("slug", "id", { status: "done", results: [], config: { kind: "single" } }, criterionAttempt);

  /* ---- Referee claims (strict since 261003h; held here so it stays so) ---- */
  const claimsAttempt: string = (await claims.begin("slug", "hash")).attempt;
  // @ts-expect-error — no attempt.
  await claims.finish("slug", { status: "done", claims: [] });
  // @ts-expect-error — a finish must not say which blocks the run was answered against.
  await claims.finish("slug", { status: "done", claims: [], sourceHash: "another" }, claimsAttempt);
  // @ts-expect-error — nor re-date it.
  await claims.finish("slug", { status: "done", claims: [], createdAt: "2026-01-01" }, claimsAttempt);
  await claims.finish("slug", { status: "error", error: "no", claims: [] }, claimsAttempt);

  /* ---- Chat ---- */
  const turnAttempt: string = (await chat.begin("slug", { threadId: "t", question: "q" })).attempt;
  await chat.finish("slug", "t", "m", { status: "done" }, { attempt: turnAttempt });
  // @ts-expect-error — no options at all, so no attempt.
  await chat.finish("slug", "t", "m", { status: "done" });
  // @ts-expect-error — options without the attempt.
  await chat.finish("slug", "t", "m", { status: "done" }, {});
  const spoken = await chat.appendSpoken("slug", {
    threadId: "t",
    question: "q",
    answer: "a",
    expectedTailId: null,
    model: "m",
  });
  // @ts-expect-error — a spoken exchange is stored finished; there is no attempt to carry.
  void spoken.attempt;

  /* ---- Comments ---- */
  const answerAttempt: string = (await comments.beginAnswer("slug", "id")).attempt;
  await comments.patch("slug", "id", { status: "done", answer: "a" }, answerAttempt);
  // @ts-expect-error — no attempt.
  await comments.patch("slug", "id", { status: "done", answer: "a" });
  // @ts-expect-error — a patch ends the answer.
  await comments.patch("slug", "id", { answer: "half" }, answerAttempt);

  return [searchAttempt, criterionAttempt, claimsAttempt, turnAttempt, answerAttempt];
}

describe("the store contracts require the attempt", () => {
  it("is a compile-time file: `npm run typecheck` is what checks it", () => {
    expect(theContracts).toBeTypeOf("function");
  });
});
