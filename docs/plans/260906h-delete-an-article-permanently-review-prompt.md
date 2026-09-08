# Review: the plan for permanently deleting an article

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently`, branch
`worktree-delete-article-permanently`. TypeScript + ESM, Postgres via Drizzle (schema `spideryarn`),
Supabase Storage, React web client. This is a **plan review, before any implementation code exists**.

## The candidate

Committed: `d55c35d9150a837dcbe0f2ba42a0970903824c73` (one commit, one new file)

```
git show d55c35d9150a837dcbe0f2ba42a0970903824c73
```

changed paths: `docs/plans/260906h-delete-an-article-permanently.md`

Start with that file. This is where to begin, not the limit of what is in scope — the plan cites
roughly twenty source files by path and line, and those are all fair game.

## What it is meant to do

Spideryarn has Archive — `articles.archived_at`, a flag that hides a card from the shelf and erases
nothing. It has no delete at all: there is no `db.delete(articles)` anywhere under `src/` or
`scripts/`, only in a test helper. The store was deliberately built that way; `src/db/schema.ts`
says *"Never a delete; Greg chose archive + Undo"*.

The plan adds a permanent delete, reachable only from one article's metadata page, for the owner
only. **It would be the first irreversible act on a reader's own data in this product**, against
one production database with real paying readers and no staging copy.

The invariants it must not break:

1. **A reader can only ever destroy their own article.** Authorisation here is a SQL `where` clause
   (`ownedSlug`, `src/store/owned-slug.ts:45`), not a route check. A non-owner gets 404, never 403.
2. **Nothing may destroy or corrupt a *different* reader's data.** The blob store is
   content-addressed and deduplicated across owners — two readers uploading identical bytes converge
   on one object (`src/store/blobs.ts`).
3. **Deleting must not change what the owner is charged**, in either direction.
4. **A delete that reports success must have happened**, and one that reports failure must not leave
   the reader believing a false state. This repo has a house doc about exactly this failure mode,
   `docs/reusable/silent-success.md`.

Deliberately out of scope: any delete control on the shelf/library cards; a soft-delete or grace
period; bulk or account-level deletion; admin deleting somebody else's article.

## Context you need that the plan assumes

- `docs/user-feedback/260904_1722-archive-an-article.md` § *Permanent deletion: deferred, and here
  is the shape it should take* — the previously recorded design for this feature. **The plan
  overrules one of its recommendations** (decision 3). Judge that overrule.
- `docs/project/library.md` § *Archive, and Undo is the confirmation*.
- `src/store/pg-glossary.ts:186` `deleteGlossary` — the structural twin the plan copies.
- `src/store/pg-billing.ts:70` — the lock order, and `usageSql` at `:396`.
- `src/db/schema.ts:4272` — a note headed *"Deleting an article silently raises its owner's usage"*,
  written in anticipation of this feature. Stage B is the response to it.
- `drizzle/0001_auth_fks_and_guards.sql:33` — `articles_current_revision_fk`, `NO ACTION` and not
  deferrable.
- `CLAUDE.md` and `docs/reusable/engineering-manager.md` for the house rules the plan must obey.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can build
a throwaway harness under `/tmp`. **You have no network, not even loopback**, so anything needing
Postgres will fail rather than tell you something — do not spend the run on it. I am running the
Stage A spike (a real `DELETE FROM articles` against a fully populated local article) separately and
will hand you its raw output if there is a second round.

## Attack it

Independently, before you read my questions below. **The invariant to break is the second one: find
a sequence in which this plan destroys or corrupts data belonging to a reader who did not ask for
anything.** Then the third: find an ordering in which the money comes out wrong.

Read it as a plan, so a finding is a concrete scenario the plan does not handle, or an authoritative
contract in this repo that the plan contradicts — not a stylistic preference about how plans are
written.

For each finding give:

- an ID (`F1`, `F2`, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario it does not handle, or the exact contract it contradicts, cited by
  file:line
- (b) the smallest change that closes it — exact replacement wording for the plan, or the code block
  the stage should contain

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A finding with no (a) goes last. Refuse only on an **established** P0 or P1, and name what
established it. Established means direct evidence with no unresolved material inference.

Questions I would especially like answered on their own merits, and which are not yet suspicions —
they are gaps I know the plan leaves open:

- **Stage E, article images.** Raw sources have a catalogue table (`raw_sources`) whose rows can be
  counted. Article images and PDF figures deliberately have **no** such row
  (`src/store/artifacts-pg.ts:235`); their only references are `assets` manifests stored as JSON
  inside `article_revisions`. What is the right way to refcount those — add a catalogue, scan the
  manifests, or decline and leave them as orphans? The plan does not pre-answer this on purpose.
- **What should a public link to a deleted article do?** `publicSlug` will 404.
- **Should a private article's deletion leave any audit trace?** Today
  `article_visibility_changes` only has rows if the article was ever shared, so a private delete
  leaves nothing at all. Is that acceptable for a service with a takedown obligation?

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run above this line.

- Stage C step 5 deletes `jobs` rows for the slug **inside** the same transaction as the article
  delete. I am unsure whether that is safe against a job that is mid-flight but not caught by the
  live-job query, and whether `queue_state.running_job_id` can be left dangling.
- The ordering in Stage C — billing lock, then article lock, then live-job check, then the deletes —
  may be wrong in a way that only shows under concurrency.
- Stage B's "stamp the price at charge time" may be the wrong fix. The alternative
  `src/db/schema.ts:4272` actually instructs is to compute the delta and tell the reader what it
  costs. I rejected that on product grounds; say if the rejection is wrong, or if the stamping
  introduces a second source of truth that can disagree with `articles.visibility`.
- Stage E deletes objects **after** the transaction commits. That makes a crash between commit and
  delete an orphan (safe) — but I have not thought hard about a crash *during* the object deletes,
  with some objects gone and some not, and no record of which.
- Decision 3 (not gating delete on the article being archived) overrules a recorded recommendation.
  It is Greg's call and stands, but say if it creates a concrete hazard I should mitigate in the UI.

Do not change any file.
