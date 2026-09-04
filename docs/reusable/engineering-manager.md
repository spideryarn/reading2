# Engineering manager: big jobs, in stages, through subagents

Not project-specific. How to run a job that is too big for one sitting.

## How far to run

Run the job through to the end. If you need to ask questions — to clarify intent, question a
tradeoff, propose a simplification — try to ask them upfront, so the rest of the work can proceed
autonomously without human input until it is finished. After that, stop only for a **product** call:
you're guessing at what the user wants, it changes user-visible behaviour nobody asked for, it's hard
to reverse (a schema, a shared contract, a prompt), somebody has unease that another round of review
won't settle, or **you can see a product tweak that would take a lot of the engineering out** — ask
about that one even mid-run; often it's the route the user will prefer. Technical forks are yours — settle them with a second opinion, not a question.

Running low on context is not a reason to stop. The plan doc is the memory: update it and keep going.

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

**Two rounds per stage, then you decide.** The cadence above is right; what goes wrong is that
nothing ends it. Refusing costs a reviewer nothing and P2s are infinite, so chains here have run to
round seven and round twelve without converging. After two rounds, settle it yourself and write
*"Sol still objects to X; overruled because Y"* in the plan doc — an overruled P0 or P1 goes to
Fable or Greg first, not straight past.

The cap counts P2/P3 churn. A **P0 or P1 newly established on round two** still gets one narrowly
scoped check after its fix, because the alternative is shipping code the cap stopped anyone
reviewing. That check is on the fix; it does not reopen discovery.

Write the prompt the way [review-prompt-template.md](review-prompt-template.md) says — a durable
revision or an explicit untracked-file list rather than a `/tmp` path, your suspicions last, a
fixed severity scale, and an ID on every finding.

Hand it the evidence — the scoped diff, the failing output, the script that produced the number —
not just your account of it, and tell it to run one test file itself: its sandbox allows that, and
a finding it reproduced outranks one it reasoned to. **A test that needs nothing outside the tree**
— the reviewer has no network, not even loopback, so anything touching Postgres or a local service
is **yours to run and hand over as raw output**, and a review promised more comes back with those
assertions quietly skipped. Check each finding yourself; some are wrong. Check a verdict actually
arrived, exit code *and* answer file. Mechanics in
[codex-cli-as-subagent.md](codex-cli-as-subagent.md).

## Delegate

The orchestrator should do **little of the implementation**. Hand the main work to Opus subagents,
and the low-level work — research, repo-wide trawls, browser automation, running tests and reading
logs — to Sonnet. GPT Luna via [codex-cli-as-subagent.md](codex-cli-as-subagent.md) is the cheap tier
for the same low-level and token-heavy work, and it's a different model family, so the variety is
free. Those are defaults, not rules; use your judgment about what a given piece of work needs.

Keep for yourself: the plan, the stage boundaries, the briefs, reading the diffs, deciding what the
reviews were right about, and the commits.

A subagent starts with nothing but your prompt. Name the files, say what the stage excludes as well
as what it is for, say what done looks like, and ask for the conclusion rather than the material.
Run them in parallel only when their file sets don't overlap.

**Parallel subagents share one scratchpad.** The directory is per *session*, and subagents inherit
the parent's path, so "session-specific, isolated" is true of the session and false of the agents
inside it — one overwrote another's helper script mid-task, which looks exactly like the script
being wrong. Give each a unique file prefix. Where two must edit one file, say "small targeted
edits, re-read immediately before editing, never rewrite".

Subagents all reading the same code can agree confidently without anyone having touched real
evidence. Send one to run the thing, read the logs, or reproduce it.

**When a subagent fails, re-dispatch it.** An empty, stale or wrong report means running it again, or
handing it to a different model — not doing its work yourself. Several failures in a row is the
environment being broken; stop and ask rather than taking the whole job back.

## What the work turns up

A cleanup the change exposed, a bug you tripped over, an abstraction in the way, two paths that
should be one — **default to doing them now**, folded into a stage or added as one. The machinery is
already open, and rediscovering it later costs more. Dropping something non-trivial wants a reason
from someone other than you — a reviewer who says it isn't worth it.

The test is whether it leaves the codebase long-term-best — straightforward, and easy to change
later — which is usually *fewer* moving parts, not more. Anything that adds machinery is a proposal
for the plan rather than something to slip in, and the licence is for the engineering, not the
product: features still take the simplest version first.

## Bug-mode

Diagnose before you plan. Send two or three subagents at it with different angles, working from
evidence — a reproduction, the logs, the on-disk state — and not only from reading the code; agents
reasoning from the same source reach the same wrong answer confidently.

At the end, a postmortem in `docs/postmortems/`: the real cause, the commit that introduced it, the
fix that's right for the long term, and what would have caught the whole class. **Name the class
outright** — the shape of the mistake, not this bug — and **rank what you recommend by ease and
value**. Both are for the reader who reads forty of these looking for a pattern worth fixing, and
neither survives being left implicit. **Then do what it says, in this run.** The prevention it recommends becomes a stage — rearchitecting so the class
can't recur is the point of writing it down. Filed at the finish line is filed and never done, and
the machinery is still open now.

## Along the way

- **Docs.** Update them in the same stage as the change, and write a doc where one is missing.
- **Tests.** Write the failing test before the fix; a test that was never red proves nothing.
- **Spikes.** When the answer isn't clear, spend a subagent on a throwaway experiment and find out,
  rather than arguing it out in prose.
- **Static analysis, typecheck, lint** — as well as the suite. Run the gate the project actually
  uses ([code-quality-overview.md](../project/code-quality-overview.md)).
- **Drive a real browser**, in a subagent, for anything with a UI — with whatever automation the
  machine you are on has (Claude-in-Chrome, Playwright, …). Tests going green is not evidence
  that a reader can see it ([browser-testing.md](../project/browser-testing.md)).

"Done, all tests pass" is a claim, not a result — read the diff, and run the gates yourself before
you commit. See [silent-success.md](silent-success.md).

## At the end

**Push it.** Then, if every gate is green and the job is finished, clear the worktree away — check it
is safe to delete first, because gitignored artefacts nobody else has a copy of survive a clean
`git status` ([worktrees.md § Before you remove one](../project/worktrees.md#before-you-remove-one)).
Anything failed or unfinished: leave the tree standing and say why.

Follow [debrief-progress.md](debrief-progress.md).
