# A merge conflict, and a claim in the incoming code I think is wrong

You have reviewed this work twice already (the plan, then the stage). This is a third, narrower
question: a merge conflict, and specifically **whether a sentence in the incoming code is false**.

Working directory is a Spideryarn worktree. **It is mid-merge, so `src/store/db-errors.ts`,
`src/store/pg-comments.ts`, `tests/store-guarded.test.ts` and `docs/project/database.md` in the
working tree contain conflict markers — do not read those for the two sides.** Read these clean
copies instead, in the scratchpad directory
`/tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/`:

- `dev-db-errors.ts` — the incoming version from `origin/dev` (550 lines)
- `dev-store-guard-idempotent.test.ts` — the incoming new test file (210 lines)
- `mine-db-errors.ts` — my committed version (491 lines)

## What happened

Two agents did the same work independently, in different worktrees, on the same afternoon.

- **Mine** (committed as `5c6ab845`): moved `pgCommentStore` behind `guardDbStore` at its own export,
  discovered that would double-wrap because `src/store/index.ts` also wraps it, and made
  `guardDbStore` idempotent.
- **Theirs** (`e8f27caa` on `origin/dev`, from plan `260903f`): did that for **all fifteen** Postgres
  stores, wrote a dedicated `tests/store-guard-idempotent.test.ts`, and also made `guardDbStore`
  idempotent.

Theirs is a superset and I intend to take it almost wholesale, dropping my `pg-comments.ts` comment
and my version of the invariant. That part I am confident about and do not need reviewed.

## The question I actually want answered

**Their justification for the idempotence check says this, and I believe it is false:**

> Already guarded — hand it straight back. See the header above: the second wrapper does not change
> what the caller sees, only what the log says, and what it says is wrong.

My claim: a second wrap **does** change what the caller sees, for one class of failure.

Reasoning, which I checked against *their* file and not mine:

1. `scrubDbError` returns `new Error(failure.message)` — a fresh error with **no `cause`** set to the
   original.
2. It copies **only a SQLSTATE** onto it (`if (sqlstate) Object.assign(scrubbed, { code: sqlstate })`),
   and the comment there explains why an errno must not be copied blindly: `err.code` on a `pg`
   connection failure can be `ENOENT`, and `src/routes.ts` reads exactly that to answer 404.
3. `isTransient` walks the chain looking for a transient SQLSTATE **or** an errno in
   `TRANSIENT_ERRNOS`.
4. So on a second pass, the chain is just the scrubbed error, which carries no errno. An `ECONNRESET`
   or `ETIMEDOUT` that classified as `STORAGE_BUSY` on the first pass classifies as `STORAGE_FAILED`
   on the second.
5. `STORAGE_BUSY` is *"wait a few seconds and try again"*; `STORAGE_FAILED` is *"a bug, and trying
   again will not help"*. `src/jobs.ts` persists the second as `bug`, which removes the reader's
   Retry button.

If that is right, the sentence is not a small wording problem: **their idempotence check is currently
the only thing standing between a connection blip and a reader being told their job is permanently
broken**, and a maintainer who believes "only what the log says" might later decide the check is
optional or reorder the wrapping. Their new test file covers one-log-line, wrapper identity, and
SQLSTATE preservation — I could find **no errno case in it**.

**Please verify this yourself rather than reasoning about it.** A small probe that wraps a store
twice and throws an object with `code: "ECONNRESET"` through both, comparing the resulting message
against `STORAGE_BUSY`/`STORAGE_FAILED` in `src/messages.ts`, settles it in a few lines. Their test
file shows the wrapping idiom. Tell me the actual observed messages.

## Specifically

1. **Is my claim true?** Reproduce it or refute it. If I am wrong, say so plainly and say where the
   reasoning breaks — I would much rather find out now than write a correction into a shared file
   that is itself false.
2. **If it is true, what is the right fix?** Options I see, and I do not have a strong preference:
   (a) correct the comment and add an errno regression case to their test file — minimal, keeps
   their design; (b) additionally make the scrubbed error carry the transient *decision* forward
   (e.g. a non-enumerable marker like the `SCRUBBED` one they already have) so a second pass cannot
   downgrade it even if someone removes the idempotence check — belt and braces, more machinery;
   (c) something else. Note this project's house style is emphatically "prefer simple, fewer moving
   parts", and an earlier round of this same work already had one mechanism rejected for being
   machinery.
3. **Is there anything else in `dev-db-errors.ts` that its own tests do not cover** and that a merge
   is a good moment to catch? You have fresh eyes on a file two people rewrote in parallel today.

Findings ranked, each marked as reproduced or reasoned. Be blunt if my claim is wrong.
