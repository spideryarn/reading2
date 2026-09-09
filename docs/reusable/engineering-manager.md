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

When you do ask, make the question answerable by someone who has not been in the code with you:
first the goal, the background and any jargon in plain words, then each option explained fully — an
example of it in use, an ASCII diagram where the shape matters, what it costs and gives up — and
then what would decide between them. A bare list of labels is not a question yet. (Greg, 2026-09-09:
*"Often I get asked a question and I don't understand what the question is asking, or the options,
or how to choose between them."*)

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

**"Fix it" and "overrule it" are not the only endings.** A good objection sometimes shows that the
plan itself is wrong — that the stage costs more than it's worth, that a smaller version gets most
of the value, or that the whole thing should be reframed or dropped. Reframing, reducing or
cancelling is a legitimate conclusion, and reaching it is your job: you are running the work, not
executing a ticket. When the call is genuinely balanced, ask Fable to arbitrate before you commit to
it. When it changes what the user gets, it is a product call — say so and ask. Either way, write the
reasoning into the plan doc, including the version you decided not to build.

**Two rounds per stage, then you decide.** The cadence above is right; what goes wrong is that
nothing ends it. Refusing costs a reviewer nothing and P2s are infinite, so chains here have run to
round seven and round twelve without converging. After two rounds, settle it yourself and write
*"Sol still objects to X; overruled because Y"* in the plan doc — an overruled P0 or P1 goes to
Fable or Greg first, not straight past.

After round two, **discovery closes** — but any established P0 or P1 whose final fix was not in the
round-two snapshot still gets a narrowly scoped check *of that fix*, and if it comes back still
open, settle or overrule it through Fable or Greg before landing. This does not reopen general
discovery.

Say "whose fix was not in the snapshot" rather than "newly found": the sequence that gets missed is
a round-one P1, an inadequate first fix, round two reporting it still open, and a *second* fix after
round two that nothing checks — and the overrule clause never fires, because you believe you fixed
it rather than overrode it.

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

**The code reviewer fixes as well as finds, by default.** Greg, 2026-09-09: *"I'm wondering if we could tweak it so that the reviewer can actually make the fixes itself … I'd suggest that we default to full-access, but … instruct the reviewer-fixer to stay fairly focused on the task at hand for any fixes it makes and to provide feedback on wider changes that it also noticed (so that the caller can decide whether to incorporate those too)."* So the stage review runs
write-capable in your worktree, and its brief says: fix what is inside this stage, narrowly and
red-first; report, do not fix, anything wider you noticed. Commit the stage before the run so the
diff is exactly the reviewer's; read that diff as a proposal, run the gates yourself, commit it naming
the reviewer's fixes, and on the next round say those fixes are unreviewed code by someone else. The
plan review stays read-only (`--sandbox review`) — there is nothing to fix but prose.

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

**A reviewing subagent is read-only by convention, not by construction.** Measured 2026-09-04: an
`Explore`-type subagent has no `Edit` or `Write`, and its prompt forbids creating files — but its
`Bash` runs as the user with the repo writable, no seccomp, and MCP tools reaching Supabase and
Vercel. So the only thing between it and `git commit` or `apply_migration` is a sentence it chooses
to obey, and on the same day another one wrote a file anyway and said so. Write "do not change any
file" into every reviewing brief, and do not lean on the agent type as though it were a boundary.
GPT Sol is the exception, and the reason to prefer it for review: its sandbox refuses the write
whatever the model intends.

**Send a spike to Sol as well as to a Claude subagent.** A `--sandbox workspace-write` run in a
worktree of its own is already supported and, over hundreds of runs, has never been used — every one
was a review. It is the right shape for *after* a review, when a fix wants proving: the deliverable
is a diff **plus a red→green transcript**, read as evidence, never applied unread. Since 2026-09-09
the review itself may write too, so a spike is the shape for a fix that wants proving *outside* the
tree under review.

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
- **Tests.** Write the failing test before the fix; a test that was never red proves nothing. Then
  mutate the finished code at the end of the stage and check the suite notices — red-first only tests
  the diff ([silent-success.md](silent-success.md)).
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

**Report back the way [debrief-progress.md](debrief-progress.md) says** — that is the final output of
the job, not a summary of your own. Lead with what the work was for and which of its three endings it
reached (*finished* / *done enough to stop here* / *important work left*), in those words.
