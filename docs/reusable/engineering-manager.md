# Engineering manager: big jobs, in stages, through subagents

Not project-specific. How to run a job that is too big for one sitting.

## The plan doc

Write the plan down **before the work starts**, in a file, not in your head or the chat. It says what
the job is, what the stages are, and what done looks like for each one. It is the single thing that
survives a lost context window, a new subagent, and a handover — and every brief you write is a
quote from it.

**Get it reviewed before you build anything.** A bad plan reviewed at the start costs an hour; found
at the end it costs the stage. GPT Sol below.

**Update it at the end of every stage, at the least** — what actually landed, what changed about the
plan, what you now know that you didn't. A plan that stopped matching the code is worse than no
plan, because the next agent will believe it. Update it mid-stage too whenever the ground moves.

## Stages

Break the job into a **small number of stages**, each ending at a good stopping point — the tests
green, the tree safe to commit and deploy. If the job were abandoned at the end of any stage, what
landed would still make sense.

**Commit at the end of each stage**, with the plan doc updated in the same commit, without being
asked. In a shared tree, name your files on both commands —
[git-commit-changes.md](git-commit-changes.md).

## GPT Sol

- **At the very beginning**, on the plan itself, while the shape is still soft.
- **Whenever things get tricky** mid-stage — a design that isn't working, two plausible fixes.
- **At the end of every stage, as an obligatory review.** Not optional, and not skippable because
  the stage felt small.

Hand it the evidence — the scoped diff, the failing output, the script that produced the number —
not just your account of it. Check each finding yourself; some are wrong. Check a verdict actually
arrived, exit code *and* answer file. Mechanics in
[codex-cli-as-subagent.md](codex-cli-as-subagent.md).

## Delegate

The orchestrator should do **little of the implementation**. Hand the main work to Opus subagents,
and the low-level work — research, repo-wide trawls, Claude-in-Chrome, running tests and reading
logs — to Sonnet. Those are defaults, not rules; use your judgment about what a given piece of work
needs.

Keep for yourself: the plan, the stage boundaries, the briefs, reading the diffs, deciding what the
reviews were right about, and the commits.

A subagent starts with nothing but your prompt. Name the files, say what the stage excludes as well
as what it is for, say what done looks like, and ask for the conclusion rather than the material.
Run them in parallel only when their file sets don't overlap.

## Along the way

- **Docs.** Update them in the same stage as the change, and write a doc where one is missing.
- **Tests.** Write the failing test before the fix; a test that was never red proves nothing.
- **Spikes.** When the answer isn't clear, spend a subagent on a throwaway experiment and find out,
  rather than arguing it out in prose.
- **Static analysis, typecheck, lint** — as well as the suite. Run the gate the project actually
  uses ([code-quality-overview.md](../project/code-quality-overview.md)).
- **Claude-in-Chrome**, in a subagent, for anything with a UI. Tests going green is not evidence
  that a reader can see it ([browser-testing.md](../project/browser-testing.md)).

"Done, all tests pass" is a claim, not a result — read the diff, and run the gates yourself before
you commit. See [silent-success.md](silent-success.md).
