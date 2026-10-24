# Code review, stage 1 of 261024m: *Does it say that?* becomes a chat identity, capped when automatic

You are reviewing AND fixing code in this worktree (Spideryarn: TypeScript ESM, Express in `src/`, Postgres via Drizzle, React in `src/web/`). The candidate is exactly commit `339091370` (`git show 339091370 --stat`; diff with `git show 339091370`). Start with `src/routes.ts` (`streamChat`, `admitCiteCheckTurn`, `refundingOnRefusal`, `parseCiteCheckOrigin`), `src/cite-check.ts`, `src/chat-question.ts`, `src/chat.ts` (`CiteCheckExists`, `withTurn`, `withEdit`), `src/store/pg-chat.ts` (`begin`, `citeCheckConflictOf`), `src/store/pg-rate-limit.ts` (`cancel`, the `reason`), `drizzle/20261024140139_cite_check_origin.sql`, and `tests/cite-check.test.ts`; that list does not limit scope.

The spec is the plan `docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md`: § What we build: option C, overridden where they differ by § After GPT Sol's review of option C (your own plan review, `docs/plans/261024m-c-plan-review-sol.md`, findings C1–C11). This stage is the SERVER only; the hover card and its client loader are stage 2 and not built yet.

**You fix as well as find.** Fix what is inside this stage, narrowly, and red-first (write or adjust a test that fails, then fix). Report — do not fix — anything wider you notice. Do not commit; leave your changes in the working tree. Do not touch production or run migrations against anything.

Tests that need Postgres cannot run in your sandbox (no network, no loopback). Here is their raw output, run by me on `339091370`:

```
npx vitest run tests/cite-check.test.ts tests/chat-origin-route.test.ts tests/fetch-allowance.test.ts tests/chat-handoff.test.ts tests/glossary-and-bibliography-ask-in-chat.test.tsx tests/dig-deeper.test.ts
      Tests  310 passed (310)
npm run typecheck — clean
```

Run any test that needs nothing outside the tree yourself (e.g. `npx vitest run tests/chat-handoff.test.ts`), and `npm run typecheck`.

Attack, in particular:
1. Is anything spent (a model call, or a counted fill that is not refunded) before every refusal? Trace each path: bad `auto`, anchor mismatch, existing thread (route pre-check, in-transaction check, unique-index race), stale Bibliography, work missing, block not citing, question mismatch, cap refusals, edit of the first question.
2. The allowance lease: released exactly once, after the model and the store, on every terminal path (done, error, stop, thrown, client disconnect), never on socket close. The refund: deletes only this fill's row.
3. The question the server builds: is it byte-identical to what the client sends today for the press (Reader.tsx `checkCitedWorkInChat` → `askPassageInChat`)? Could an innocent tab be refused as stale too often (e.g. the block text or work title changing under it)?
4. The migration and the CHECKs: correct, additive, consistent with `src/db/schema.ts`; the existing item CHECK does not refuse a cite-check row; the unique index's name matches what `citeCheckConflictOf` reads.
5. Anything in the stage that breaks existing chat behaviour (other origins, retry, delete-from, Chat's list labels), or any defence in `docs/project/security-map.md` weakened.

Severity: P0 (ships broken or unsafe), P1 (must fix before landing), P2 (should fix), P3 (nit). An ID on each (S1, S2…), file:line evidence, and what you changed for it (or "reported, not fixed: wider"). End with a short verdict and the list of files you modified.

My own suspicions, last (spend most of the run elsewhere): the refund-on-refusal wrapper may miss a throw between the allowance and the model call; `withTurn` refusing "the same first turn resent under the same id" may break Chat's own retry of a first turn that failed before `begin` committed.
