# Engineering manager: big jobs, in stages, through subagents

Not project-specific. What to do when a job is too big for one sitting: three weeks of feature, a
migration that touches every layer, a rewrite of a subsystem. The failure mode is not that the work
is hard. It is that a long job done in one long push ends with a tree nobody can commit, a context
window full of file dumps, and no way back to a working state.

Two rules fix most of it.

**Cut the job into a small number of stages, and make every stage end somewhere you could stop.**
Three to six stages, not fifteen. Each one ends with the tests green and the tree safe to commit and
deploy. If the job were cancelled at the end of any stage, what landed would still be coherent.

**Manage; don't type.** The orchestrator — the engineering manager — holds the plan, writes the
briefs, reads the diffs, decides what the reviews were right about, and commits. The implementation
goes to Opus subagents. The low-level work goes to Sonnet. A manager who starts editing files loses
the thread of the job, and their context fills with exactly the material a subagent exists to keep
out of it.

## The shape

```
   BEFORE ANY CODE
   ───────────────
   ask GPT Sol for advice ──▶ write the plan (stages named) ──▶ Sol reviews the plan
                                                                       │
   PER STAGE  ◀─────────────────────────────────────────────────────────┘
   ─────────
        brief ──▶ Opus subagent(s) implement          ┐
                  Sonnet subagents research / trawl   │  manager reads diffs,
                  Sonnet subagent drives the browser  ┘  not page dumps
                       │
                       ▼
                  tests + typecheck green
                       │
                       ▼
                  GPT Sol reviews the stage's diff ──▶ manager triages ──▶ fixes
                       │                                (some findings are wrong)
                       ▼
                  COMMIT ── a good stopping point ── deployable
                       │
                       └──▶ next stage
```

## Before any code

**Ask GPT Sol first, while the shape is still soft.** Not "review this plan" — that comes later —
but "here is the job, here is the codebase it lands in, what would you do, and what am I about to
get wrong?" A different model family, asked before you have committed to an approach, is at its most
useful; asked afterwards, it can only find bugs in the approach you already chose.

Then **write the plan down** — in this repo, one file under `docs/plans/` — with the stages named and
a line on what each one delivers. Send *that* for review, and fold in what survives your own reading
of it. The mechanics of running Sol, and the traps, are in
[codex-cli-as-subagent.md](codex-cli-as-subagent.md).

```bash
npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
  --prompt-file <prompt> --output <answer>
```

Keep the plan alive as the job runs. At the end of each stage, write what actually landed and what
changed about the stages still ahead. A plan that stops matching the tree stops being consulted, and
then the job has no memory outside your context window.

## What makes a stage boundary

A stage boundary is not "a convenient amount of work". It is a state of the tree. Ask of the last
commit in a stage:

- Do the tests and the typecheck pass — the project's real gates, run as the project runs them
  ([code-quality-overview.md](../project/code-quality-overview.md))?
- Could this deploy? Not "is the feature finished", but: is anything half-wired? A migration applied
  with no code reading the column is fine. Code reading a column no migration adds is not.
- Is every new file tracked, and does everything that imports it exist in the commit?
- Could somebody else pick the job up from here with only the plan doc and the commits?

If the answer to any of them is no, the boundary is in the wrong place. Move it — usually earlier,
by shipping the schema, the seam or the dead-but-correct code first, and the behaviour that uses it
in the next stage.

**A stage that grows gets split, not extended.** The temptation at the end of a stage is to fold in
the one more thing that would make it feel complete. That is how a three-stage job becomes a
single-stage job again.

## Who does what

| Who | Work |
|---|---|
| **Manager** (orchestrator) | the plan, the stage boundaries, the briefs, reading diffs, triaging review findings, the commits, and talking to the user |
| **Opus subagent** | the implementation — the change that needs to hold the design in its head, get the edge cases right, and write the tests |
| **Sonnet subagent** | research, repo-wide trawls and rename sweeps, browser work, running and reporting on long test runs, reading logs, gathering evidence |
| **GPT Sol** | advice at the start, advice when a stage goes strange, and the obligatory review at the end of every stage |

**Sonnet for anything that generates more output than insight.** Browser work is the clearest case —
it is click-look-click and the screenshots are large, so the point of delegating is that the pixels
never enter the manager's context ([browser-testing.md](../project/browser-testing.md)). Repo sweeps
are the same shape: a hundred grep hits go in, a list of decisions comes back
([rename-or-move.md](rename-or-move.md)).

**Opus for anything where being wrong is expensive and quiet.** Store contracts, migrations,
concurrency, security boundaries, anything whose bugs pass their own tests.

## Briefing a subagent

A subagent starts with nothing but your prompt. What it does not have is everything you learned in
the last two stages, and it will not ask.

- **Name the files.** The ones to change, the ones to read first, the doc that owns the area.
- **Say what the stage is for**, in a sentence, and what it deliberately excludes. Otherwise the
  agent helpfully does the next stage too.
- **Say what done looks like** — which command must go green, which behaviour must be observable.
  Ask for the tests to be written first and watched failing.
- **Ask for the conclusion, not the material.** "Report the three lines that matter and what you
  changed", not the file contents, the page dumps or the full log.
- **Say what is off-limits**: files another agent owns, and any git command that throws work away.

Run subagents in parallel only when their file sets do not overlap. Two agents editing one file in a
shared tree is not a merge conflict — it is a silent overwrite, and the second one to write wins
without either being told.

## When a stage goes strange

Mid-stage is exactly when to spend a review, not just at the end. A design that is not working, a
test you cannot make fail, two plausible fixes with no way to choose — hand Sol the evidence and ask.
**The evidence, not the story**: the scoped diff, the failing output, the script that produced the
number. A reviewer given only your summary can only review your summary, and the most useful finding
is often about the experiment rather than the conclusion.

## The end-of-stage review is not optional

Every stage's diff goes to GPT Sol before it is committed. Weight this higher than the plan review:
prose review cannot find a handler that writes one field and then rejects the request, because that
bug does not exist until somebody writes it.

- **Hand it the scoped diff** for the stage, plus the plan section it was built from.
- **Check each finding yourself.** Some are wrong. Fold in what survives; write down what you
  rejected and why, because the next review will raise it again.
- **Check a verdict actually arrived** — the exit code *and* the answer file. A review that returned
  nothing looks exactly like a review that found nothing. This is
  [silent-success.md](silent-success.md) with a subprocess in it.

The same doubt applies to your subagents. "Done, all tests pass" is a claim, not a result. Read the
diff, and run the gates yourself in the manager before you commit — not the tool the gate wraps, the
gate.

## Then commit

At the end of every stage, without being asked. In a tree several agents share, name your files on
both commands:

```bash
git add path/one.ts path/two.md && git commit -F msg.txt -- path/one.ts path/two.md
```

The trailing `--` pathspec is the load-bearing part — see
[git-commit-changes.md](git-commit-changes.md) and, in this repo,
[version-control.md](../project/version-control.md) and [AGENTS.md](../../AGENTS.md).

One commit per stage is the default. More is fine if the stage genuinely holds several separable
changes; fewer is not, because "I'll commit at the end" is how a week of work ends up in one
unreviewable diff.

## What goes wrong

- **The manager starts implementing.** It always begins with something small and quick. Two hours
  later the context is full, the plan has not been touched, and the subagents are idle. If a task is
  genuinely too small to brief, do it — but notice when that has happened three times in a row.
- **A stage boundary that isn't.** Committed, tests green, and the feature is half-wired to something
  that does not exist yet. The check is the deploy question, not the test result.
- **A subagent reports success and did nothing.** The most common single failure in this whole
  process. Read the diff.
- **Parallel agents on one file.** Disjoint file sets, or serial. There is no third option.
- **The plan doc goes stale in stage two** and the job loses its memory.
- **Scope creeps between stages** because each one ends with "while I'm here". The plan says what the
  stage is; changing it is a decision to write down, not a drift to allow.
