# Result review: the Overseer's auto-memory ported into docs

Read-only: change no file. You reviewed the plan for this job earlier
(`docs/plans/261005k-port-overseer-auto-memory-plan-review-sol.md`); this is the result.

## The candidate

Commit `11e1ff2c8` on `dev`. `git show --stat 11e1ff2c8` lists its 27 paths;
`git show 11e1ff2c8 -- docs/project` is the 25 doc edits (183 lines added, 3 removed, twelve files).

Start with, without limiting scope:

- `docs/investigations/261005d-overseer-auto-memory-ported-to-docs-the-mapping.md` — the
  deliverable: one row per memory file, then 43 proposals.
- `docs/plans/261005k-port-overseer-auto-memory-into-docs.md` — the plan and its log.
- `docs/plans/261005k-probes/report-A.md` … `report-D.md` — what each analysing agent wrote,
  doubts included. `brief.md` is what they were told.
- The source: `/home/greg/.claude/projects/-home-greg-code-spideryarn2/memory/` (85 files).

## What will be done with it

The Overseer will delete every memory file whose row says *eligible*, and put the proposals to
Greg. So a wrong *eligible* loses a lesson for good, and that is the consequence to grade by.

## What to do

1. **Every *eligible* row (35).** Read the whole memory file, then the doc passage each *already*
   cites, and each *moved* edit in the commit. Is every lasting lesson in the file really in a doc
   in Git, in a form someone could act on? Is each *dropped* claim really stale or disposable — check
   the tree where the row says it checked? Report every row you would not delete on.
2. **The 25 edits.** Is any of them a rule (an obligation, a prohibition, a permission, a required
   workflow) that should have been a proposal? Does any change the lesson, state as fact something
   the memory hedged, or sit in the wrong doc? Is any link or command in them wrong against the tree?
3. **Secrets and identifiers** in the commit: any key, token, connection string, address, project
   or team id.
4. **Greg.** Every place the commit attributes words or a decision to Greg, in the docs and in the
   mapping's own prose: is it supported? The mapping's section on unverified quotes says how the
   check was done (`docs/plans/261005k-probes/check-quotes.py`); attack the method. The proposals
   quote him too, but none has landed.
5. **A sample of *retain* rows** (ten or so): is any lesson missing from both the row and the
   proposals?
6. `python3 docs/plans/261005k-probes/check-mapping.py <the mapping>` — run it yourself, and say
   whether it could pass on a table that is wrong in a way that matters.

## Severity scale

- **P0** — a secret in Git, an invented Greg quote landed in a doc, or data loss.
- **P1** — an *eligible* row that would lose a lesson; an applied edit that is a rule or misstates
  the memory; the mapping wrong in a way the Overseer would act on.
- **P2** — design or maintainability risk with no wrong outcome today.
- **P3** — prose.

Give every finding an id (`RR-1`, …), its severity, the memory file and doc involved, what is wrong,
and the smallest fix. End with a one-line verdict.

## My own suspicions (already mine; spend most of the run elsewhere)

- Batch D's "already" rows lean on general passages in `silent-success.md`.
- `write-capable-reviewer-can-invent-greg-quotes` is eligible only as a duplicate of a retained file.
- AE1 softens "the classifier judges each command alone" a few sections away from where that is said.
- BE7 and BE8 sit in the box's trap list but are about the harness and npm, not the box.
