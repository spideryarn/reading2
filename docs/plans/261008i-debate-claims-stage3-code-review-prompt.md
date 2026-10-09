# Code review and fix: 261008i stage 3, checking the claims the reader picks

Repo: Spideryarn, this worktree. Candidate: commit `570156267` (stage 3) and the merge after it,
`c5f0f9b47`, which put `debate_claim_checks` beside dev's `referee_hidden_checks` and regenerated
the migration as `drizzle/20261009020028_debate_claim_checks.sql`. See them with
`git show --stat 570156267`, `git show 570156267`, and `git show c5f0f9b47` (a merge: look at its
conflict resolutions in schema.ts, routes.ts, store/*.ts and the two tests). Do not diff against
a merge-base, which sweeps in other people's work. Start with `src/debate.ts` (`generateClaimCheck`,
`readCheckedClaimGroup`, `CHECK_SYSTEM`, `checkPrompt`), `src/types.ts` (check types),
`src/store/pg-debate-claim-checks.ts`, `src/routes.ts` (the checks routes), `src/dig-deeper.ts`
(`admitDig`; were its sentences changed, and does that change what Dig deeper says?),
`src/web/useDebateChecks.ts`, `src/web/debate-checks.ts`, `src/web/DebatePanel.tsx`
(`OwnerListedClaims`), the migration, and the three new test files
`tests/debate-claim-check-reader.test.ts`, `tests/debate-claim-checks-panel.test.tsx`,
`tests/debate-claim-checks-routes.test.ts`. The list does not limit scope.

The plan: `docs/plans/261008i-debate-claims-picked-by-the-reader.md` § 3, § 4, § 5, § Stages
(stage 3), § Tests, the plan review ledger and the stage 1 and 2 sections. House rules:
`CLAUDE.md`. Read `docs/project/security-map.md`, `docs/project/sql.md`,
`docs/project/block-ids.md`, `docs/project/prompting-guide.md`, `docs/project/comments.md`
§ streaming.

## What to do

An independent pass first. Is stage 3 correct, and is every way of spending money a press that
the reader meant? In particular:

- **Spend**: refusal order (free refusals, then the reservation, then the allowance, then the
  model); can two presses, two tabs, a retry, a reconnect or a sweep race buy two searches for
  one press, or a search with no reader waiting that nobody can see the result of? Is a
  reservation ever left blocking the article for good? The allowance's lease (170 s) is shorter
  than a check's deadline (720 s): what does that allow, concretely?
- **The reader's typed words**: never in a log, an error, a visitor's payload or a URL; fenced as
  untrusted in the prompt.
- **The answer**: one group per target; missing, duplicate and unknown ids; a listed anchor only
  from the stored list; every pass-B refusal still the one implementation.
- **Ownership and visitors**: non-owners refused on both routes; nothing from checks reaches the
  public reader.
- **Dig further**: the "already found" addresses and the target come from stored rows only.
- **States on screen**: pending, done-empty (found nothing), not-answered, error, swept, another
  tab's check, stale list; the button's holds; dedupe by address.
- **The merge**: did keeping both tables lose or duplicate anything?

**You may fix what you find inside this stage**, narrowly and red first (write the failing test,
see it fail, fix, see it pass). Run test files with `npx vitest run <file>` (Postgres-backed tests
may not run in your sandbox; say so rather than skipping silently). Do not commit. Report, do not
fix, anything wider than stage 3 and anything that changes a defence named in security-map.md
(for example the allowance's limits or lease): those go to Greg.

Severity: P0 data loss, exploitable security, incorrect charging, broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability
risk; P3 prose. Mark each finding established or reasoned, with an ID (E1, E2 …), file:line, and
what you changed (or why not).

Your final answer: the findings, the files you edited, the test commands you ran with results,
and a one-line verdict ("land", "land with the fixes made", "do not land").

## My own suspicions (worth less)

- The builder reworded the allowance's refusal sentences "so they talk about a check": if those
  are Dig deeper's shared constants, Dig deeper now says the wrong thing.
- `OwnerListedClaims` is now large; is any state drawn wrong because two hooks disagree about
  whether a check is pending?
