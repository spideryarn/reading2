# The review prompt template

What to put in a prompt for a cross-family reviewer, and in what order. The mechanics of dispatching
one are [codex-cli-as-subagent.md](codex-cli-as-subagent.md); the workflow it sits in is
[engineering-manager.md](engineering-manager.md). This file is the shape of the message.

> **Why it exists.** A count of 236 review prompts on 2026-09-04 found seven over 100 KB (largest
> ~217 KB) pasting a diff the reviewer could have read itself, 46 leading with the author's own
> suspicions, and 63 distinct `/tmp` paths cited as evidence of which 42 no longer exist. None of
> those is a reviewer problem. [The plan](../plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md).

## The five rules, before the template

**1. Name the candidate durably. Never a `/tmp` path.** A scratch path is unreadable tomorrow and
gone for good on the next machine — most of those 42 dead paths died because the work moved from the
Mac to the box, not because anything was cleaned up. There are two forms and you need the right one:

- **Committed candidate** → a revision pair: `git diff <base>...<head>`.
- **Pre-commit candidate** → the base SHA, the scoped paths, **and an explicit list of untracked
  files**.

The second is the common case and the one that bites, because the house rule is review *before*
commit: run `git diff <merge-base>...HEAD` on work that is not committed yet and the reviewer gets
**nothing**, which looks exactly like a change with no diff. A pathspec cannot name an untracked
file either, so a new file that nobody lists is a new file nobody reviews.

**2. Don't paste the diff.** The tree is readable. Say where to look and what changed; a 200 KB
prompt spends the reviewer's context on transcription instead of investigation, and one such run
has already compacted and then died.

**3. Independent pass first; your own suspicions last, and labelled.** Ask for the attack before
you say where you think the bodies are. Then put your doubts under a heading that says they are
already yours and worth less: *the questions above are my suspicions; spend most of the run
elsewhere.* Reviewers report this ordering works on them, so it is worth the two minutes it costs.
This is [codex-cli-as-subagent.md § If you can write the question, write the fix](codex-cli-as-subagent.md#the-house-workflow-in-this-repo)
applied to the prompt's layout rather than its content.

**4. Fix the severity scale, and fix what a refusal takes.** Without a scale, "blocker", "not
ready" and "P1" mean something different every round and nothing can be triaged without reading
everything.

| | |
|---|---|
| **P0** | wrong behaviour a reader can reach; data loss; security; money |
| **P1** | wrong behaviour a test can reach |
| **P2** | design |
| **P3** | docs and comments |

**Refuse only on an *established* P0 or P1** — one shown by something the reviewer ran, read, or
can point at in an authoritative contract. Not *reproduced*: the sandbox cannot reach Postgres or
any local service, so demanding a runtime reproduction would disarm the reviewer precisely where it
is already weakest. A concern reasoned to is still worth having; it is ranked and labelled as
reasoned, and it does not block.

**5. Give every finding a stable ID.** `F1`, `F2`, … The implementer's brief and the next round's
ledger both address findings by ID, so a finding cannot quietly vanish between the review and the
work. On 2026-08-28 a P1 was lost in relay and *the count still matched*, which is what made it
invisible; IDs make the check mechanical — every ID appears exactly once — instead of a matter of
someone being careful. **Hand the implementer the review artefact itself**, not only your summary of
it.

## The template

```markdown
# Review: <one line — what changed and why>

Repo: <path>, branch <name>. <TypeScript/ESM/whatever a stranger needs to orient.>

## The candidate

<Pick one:>
Committed:   git diff <base-sha>...<head-sha>
Pre-commit:  base <base-sha>; scoped paths: <paths>; untracked files: <explicit list, or "none">

Read these in full: <the two or three files the change lives in>

## What it is meant to do

<The contract in prose. The invariant it must not break. What is deliberately out of scope.>

## What you can and cannot run

The tree is read-only; /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you can
build a throwaway harness under /tmp. You have no network, not even loopback, so anything needing
Postgres or a local service will skip — those I have run, and the raw output is at <path>.

## Attack it

Independently, before you read my questions below. <Name the invariant to break.>

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input under which the code fails its own claim — something I can run
  - (b) the smallest change that closes it, as a code block
A finding with no (a) goes last.

Refuse only on an established P0 or P1, and name what established it.

## Previous findings, if this is a second pass

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | …                 | fixed / disagreed / not attempted | … |

Treat the fixes as unreviewed code written by someone else, and spend most of the run on what has
changed since.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
<…>

Do not change any file.
```

## After it comes back

The rules that were already here and have not moved: check each finding yourself, because some are
wrong; apply (a) and watch it go red before applying (b); relay findings **verbatim**; and check a
verdict actually arrived — exit code *and* answer file.
[codex-cli-as-subagent.md](codex-cli-as-subagent.md) has all four and the accidents behind them.
