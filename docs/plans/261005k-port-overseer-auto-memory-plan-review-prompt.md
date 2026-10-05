# Plan review: port the Overseer's auto-memory into docs

You are reviewing a plan before it is built. Read-only: change no file.

## The candidate

A live, uncommitted file in this repo: `docs/plans/261005k-port-overseer-auto-memory-into-docs.md`
(untracked; base is `origin/dev`). Nothing else has been written yet.

## Background you need

- `AGENTS.md` § How we write docs here — the bullet "Record decisions where they belong", added
  today, is the standing rule this job backfills.
- `docs/reusable/edit-important-docs.md` — what counts as a doc whose wording is a rule.
- `docs/reusable/documentation-policy.md` and
  `docs/reusable/signposting-and-single-source-of-truth.md` — one home per fact.
- `docs/plans/261001i-probes/report-W3.md` and `report-W4.md` — an earlier sweep that moved about
  thirty memories into docs, and the shape its mapping took.
- The source is `/home/greg/.claude/projects/-home-greg-code-spideryarn2/memory/` (85 files and an
  index). Read a handful if your sandbox lets you; say so if it does not.

## What to do

Attack the plan. Where would it produce a wrong or harmful result? In particular: a lesson lost, a
rule slipped into a doc without approval, a quote attributed to Greg that he did not say, a secret
copied into Git, a duplicate home for a fact, or a mapping table that claims more than was checked.
Is the line in rule 3 between "edit directly" and "propose" in the right place, and can a subagent
apply it? Is four parallel subagents editing overlapping docs in a shared checkout a real risk, and
what is the cheapest thing that removes it? Is anything in the plan more process than this job is
worth?

## Severity scale

- **P0** — data loss, a secret in Git, or an invented Greg quote landing.
- **P1** — a rule changed without approval, a lesson lost, or the mapping wrong in a way the
  Overseer would act on (deleting a memory that was not really ported).
- **P2** — design or maintainability risk with no wrong outcome today.
- **P3** — prose.

Give every finding an id (`PR-1`, `PR-2`, …), its severity, what is wrong, and the smallest change
to the plan that fixes it. End with a one-line verdict: ready to build, or not, and which findings
block.

## My own suspicions (already mine; spend most of the run elsewhere)

- Rule 3's carve-out for `overseer.md § Things that will catch you` may be too generous.
- Rule 4 trusts that a quotation in a memory file is verbatim; the memory was written by a model.
