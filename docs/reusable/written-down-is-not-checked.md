# Written down is not checked

Not project-specific. A trap, collected because five instances of it turned up in a single day and
two of them cost a working session an hour each.

> **A written statement is believed later in proportion to how confident it sounds, not to how well
> it was checked.** Writing something down looks like having verified it — to the next reader, and to
> the person who wrote it.

This is not [silent success](silent-success.md), where the *code* reports success while doing
nothing. Here the code is honest and the **prose about it** is wrong: a comment, a doc, a plan, a
recorded baseline. Nothing can fail, because prose does not run. It is found when somebody acts on
it, which is always later and usually mid-task.

## Four species, and they fail differently

### 1. A statement that asserts the future

The commonest and the most expensive, because it is written in good faith at the moment a decision
is made and becomes false by nothing happening.

> `src/token-budget.ts` — *"src/toc.ts moved to `"medium"` for exactly this reason."*
> `src/toc.ts` said `"high"`. It had been decided and never done.

Two sessions read that comment while working out where a token budget came from, and both took it as
a fact about the code. The tell was available the whole time — the file it names is one `grep` away —
but nobody greps a statement that sounds settled.

**The fix is not to stop writing them.** A decision that is made and not yet built is worth
recording. It has to carry **a date and an instruction to check the code**, so that a reader can tell
"this is true" from "this was going to be true".

### 2. A statement that asserts an absence

> *"There is no longer a path by which a block is legitimately unlabelled."*

Written to justify tightening a threshold from 0.95 to 1, and **true about the code it was reasoning
about**. What it could not see was that it depended on an unstated assumption about the *data* — that
every unit the previous stage emits can be described in the terms the next stage demands. An input
that broke that assumption never went near the check being reasoned about.

**An absence is only as good as the enumeration behind it, and the enumeration is almost never
written down beside it.** When you find yourself writing "there is no way that…", write what you
enumerated, so the next person can see the edge of it.

### 3. A generalisation from a same-shaped sample

> *"Every tiling failure anyone has observed is off by one block. That is decisively the
> repair-sized world."*

Four observations. All off by one — and all from one kind of input, because that was the only kind
anybody had. A limit was fitted to them. The first instance of a *different* kind of input broke it
within a day of that input becoming reachable.

**"Four observations" reads like a sample. "Two from one experiment and two from one incident" reads
like what it is.** Say which, and the reader can see the sampling problem without having to
reconstruct it.

### 4. An inventory

> *"Twelve call sites."* Fourteen, a day later. *"Three copies."* Eight, in six files.

A count or a list is a measurement, and a measurement is only as good as what took it and when. Some
rot — the code merged on; some were wrong from birth — the grep was truncated, the sweep skipped a
directory — and a bare number cannot tell you which. **Write what produced it, what it covered, and
when**, so the next reader re-runs it rather than believes it. The evidence, and the guard that
came out of it, are in
[260903b-facts-that-were-wrong.md](../research/260903b-facts-that-were-wrong.md).

## The one about your own work, which is the hardest to see

A baseline recorded *after* your own agents have been working is not a baseline.

> A test baseline was captured and written up as "none of these failures are this work's". One of
> them was: a directory written by this session's own investigation subagent **five minutes before
> the baseline was taken**. The failing test named the file. One `stat` said who wrote it and when.

The reason it is hard is that the check feels like it has already happened — you took a baseline
*because* you wanted to be careful, and the care is mistaken for the result. Anything parallel makes
it worse: the moment "before I started" and the moment "before anything of mine ran" stop being the
same instant.

## What to actually do

- **Date any claim about the future**, and tell the reader to check the code. A note that says
  *"decided 2026-08-30, not yet landed — check the code"* stays true for ever. One that says
  *"X moved to Y"* rots the moment the plan slips.
- **Never a bare count.** *"14 by `grep -rn takeRunLock tests/`, 2026-09-02"* — command, scope,
  date.
- **When you change a value, rewrite the argument above it, not just the value.** A comment left
  arguing for the rule that used to be there is worse than no comment: it is a confident,
  well-written explanation of something untrue. If the old argument was sound and is being
  overridden rather than refuted, say that, and say who decided.
- **Prefer a claim that can be falsified to one that cannot.** "All four came from HTML articles with
  headings" invites the counterexample. "Decisively the repair-sized world" repels it.
- **Take baselines before your own work, and prove the timestamp.** `stat` on the file the failure
  names, not memory of when you started.
- **When a doc and the code disagree, fix the doc in the same breath as reading it.** Both sessions
  that were misled by the budget comment noticed it; the second one fixed it. The gap between those
  two is where the hour goes.

## Why it is worth a page

Every instance above was written by somebody careful, in a codebase whose comments are unusually
good, and each was believed *because* the surrounding prose was reliable. **A high standard of
documentation raises the cost of the rare wrong sentence**, because readers stop checking. That is
not an argument for writing less. It is an argument for marking the difference between what you
verified and what you intend.
