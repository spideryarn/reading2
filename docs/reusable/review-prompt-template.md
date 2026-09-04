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

- **Committed candidate** → the **exact commit SHAs**, a diff command, and a **complete list of
  changed paths** (or the command that produces it). Not a merge-base range: on a shared branch
  that sweeps up everyone else's commits. A range meant to describe two commits and eleven paths
  was measured covering **28 commits and 131 files** — and the one file that broke the gate was in
  the 131 and not in the eleven, so the reviewer only found it by ignoring the reading list. Say
  which files to *start* with, and say that it does not limit scope.
- **Live pre-commit candidate** → the base SHA, the scoped paths, **and an explicit list of
  untracked files**. This is the common case, because the house rule is review *before* commit: run
  `git diff <merge-base>...HEAD` on work that is not committed yet and the reviewer gets
  **nothing**, which looks exactly like a change with no diff. A pathspec cannot name an untracked
  file either, so a new file that nobody lists is a new file nobody reviews.

  **It is called *live* because it is not durable.** It names a tree, not bytes: another agent
  editing one of those paths mid-review silently changes what "the candidate" means, and tomorrow it
  names nothing recoverable at all. Close it afterwards — **write the resulting commit SHA into the
  review artefact** once you commit, so the review can be tied back to what it actually saw.

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

Grade by **consequence**, so two levels can't both fit — an earlier draft had "wrong behaviour a
reader can reach" against "wrong behaviour a test can reach", and a reader-visible UI bug is both:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by the consequence, not the file: a defect in a *doc* that will cause a P1 to ship is not a
P3 because it is made of prose.

**Refuse only on an *established* P0 or P1.** Established means **direct evidence with no unresolved
material inference** — an observed failing run, an exact reachable source path that demonstrates the
violation, or an authoritative contract the candidate directly contradicts. If any load-bearing
premise is still inferred (that a branch is reachable, that a caller exists), it is **reasoned**,
and reasoned findings rank and inform but do not block.

Established rather than *reproduced*, because the sandbox cannot reach Postgres or any local
service, and demanding a runtime reproduction would disarm the reviewer precisely where it is
already weakest. But "read it somewhere" is not the bar either — every static review reads code.

**5. Give every finding a stable ID.** `F1`, `F2`, … The implementer's brief and the next round's
ledger both address findings by ID, so a finding cannot quietly vanish between the review and the
work. On 2026-08-28 a P1 was lost in relay and *the count still matched*, which is what made it
invisible; IDs make the check mechanical — every ID appears exactly once — instead of a matter of
someone being careful. **Hand the implementer the review artefact itself**, not only your summary of
it, and then the ledger can link to it rather than re-transcribing long findings.

**IDs are stable across the whole chain, not per round.** Reuse an ID only for the same finding, and
number new ones above the highest already issued. Otherwise round two's first finding is another
`F1`, the ledger has two of them, and "every ID appears exactly once" stops meaning anything.

## The template

```markdown
# Review: <one line — what changed and why>

Repo: <path>, branch <name>. <TypeScript/ESM/whatever a stranger needs to orient.>

## The candidate

<Pick one:>
Committed:    commits <exact SHAs, in order>
              git diff <first-candidate-parent>..<last-candidate>
              changed paths: <complete manifest, or the command that prints it>
Live pre-commit: base <base-sha>; scoped paths: <paths>; untracked: <explicit list, or "none">
              (not durable — I will record the resulting commit SHA here once it lands)

Start with: <the two or three files the change lives in>. This is where to begin, not the limit
of what is in scope — the manifest above is.

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
  - (a) what shows it fails its own claim —
        reviewing code:       the input or mutation I can run
        reviewing a plan/doc: the concrete scenario it does not handle, or the authoritative
                              contract it contradicts
  - (b) the smallest change that closes it — a code block, or exact replacement wording
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
