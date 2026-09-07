# A guard that agreed with the thing it was watching

Not one bug. **Nine, of one shape**, found in a single day's work
([260906d](../plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md)) — six
in guards written that same day, three already in the tree. They are worth one write-up rather than
nine because the fix for each is different and the *class* is identical.

## The class

**An uncalibrated verifier — a check that cannot distinguish the healthy state from the broken one,
anywhere along its length.**

Not "an untested code path": every one of these had a test, the test passed, and a person had read
it. And not, as this document said in its first draft, "a check whose expectation is downstream of
the thing it checks" — GPT Sol's F27 pointed out that this names one *subtype* and presents it as
the whole class. Two of the flavours below involve no derived expectation at all, and two findings
from the review of this very document (F22 and F25) are of exactly those kinds.

A verifier has four stages, and **the failing state can be erased at any of them**:

| | Stage | How it erases the failure |
|---|---|---|
| **acquisition** | what it looks at | The corpus is not the one the property lives in. |
| **normalisation** | what it does to it first | A transform throws away the dimension that carried the fault. |
| **predicate** | what it asks | The question is weaker than the property. |
| **expectation** | what it compares against | The answer came from the same place as the thing being checked. |

Four flavours, in rising order of how hard they are to see — the first two are expectation faults,
the third acquisition, the fourth predicate:

1. **The expectation is derived from the implementation.** Read the value out of the table you are
   checking, and the check is `x === x`.
2. **The expectation is derived from *prose about* the implementation** — a docblock. Feels
   independent. Is not, if the prose is wrong.
3. **The observation is narrower than the behaviour.** The recorder watches one endpoint; the code
   spends through three.
4. **The predicate is weaker than the property.** `toContain(".crit-how")` for "the rule
   `.crit-how` exists"; `Math.max(...) === 8` for "rules 1 through 8 exist"; sorted comparison for
   "in this order".

And a fifth, which the four missed and the review supplied:

5. **The normalisation discards the dimension the fault lives in.** A money contract that
   deduplicated its request log to survive `<StrictMode>`'s effect replay, and so could not tell one
   paid call from two. The expectation was independent, the corpus was right, the predicate was
   exact — and a double charge was still invisible, because the reading passed through a `Set` on
   its way to the assertion. **Dealing with a harness artefact by removing information is how this
   one arrives**, and the fix is always to remove the artefact instead.

The practical value of the wider frame is that it says where to look. Calibration is not one
question but four: *did I look at the right thing, did I keep what mattered, did I ask a strong
enough question, and did my answer come from somewhere else?*

## The nine

| # | The guard | What it could not see |
|---|---|---|
| 1 | `SPENDS` in the new mode sweep | Written from `activation.ts`'s docblock, which said Force/Drift/Trail *"cost nothing and are instant"*. They spend through `/api/similar` and `/api/projection`. **Flavour 2** |
| 2 | The same sweep's network recorder | Captured only `POST /api/jobs` and discarded every other mutation, so three paid Diagram paths were outside the "money contract" entirely. **Flavour 3** |
| 3 | The same sweep's phase A | Observed immediate POSTs, not what was left *armed*. Setting Plain to arm Ideas passed, because no Ideas panel was mounted to claim the token — which a later mount would then spend. **Flavour 3** |
| 4 | `readable()` in the same sweep | Stripped hidden *descendants* but never checked the element or its ancestors. `hidden` on the Quotes `<aside>` passed with the whole surface invisible. **Flavour 4** |
| 5 | `DRAWS.says` / `SPENDS.presses` | Plain `string` and plain array, so `toContain("")` and `presses: []` were legal. **Flavour 4** |
| 6 | `styles-entry-is-imports-only` | Sorted both sides before comparing, so the *order* — the single thing it exists to protect — was unchecked. **Flavour 4** |
| 7 | The same test's node check | `startsWith("@import")` accepted `@important;`, an external URL, and `@import "./styles/table.css" print;`, which makes every table rule print-only. **Flavour 4** |
| 8 | `aimed-column`'s vacuity guard | Allowed arbitrary selector suffixes, so `.never` on all eight `[data-aim]` selectors passed. **Flavour 4** |
| 9 | `annotate`'s hue guard | Asserted `Math.max(...) === BAR_HUES`; rules 1–7 could be deleted. **Flavour 4** |

## The tenth, found afterwards — and the first found by somebody else's test

Later the same day, merging 78 commits of `origin/dev` into the split turned up a tenth, and it is
the most instructive of them because its twin survived.

Two of `origin/dev`'s own tests read `src/web/styles.css` from disk. After the split that path holds
65 lines of `@import` and no rules at all.

| | The guard | What happened |
|---|---|---|
| 10 | `tests/table-selectors-are-scoped.test.ts` | Asserts an **empty** list of offending selectors. With no selectors to scan the list is empty, so it passed while checking nothing — and it is the guard for the very deletions being merged: `origin/dev` was scoping the bare `td {` and `thead th {` that reached the shelf. **Flavour 4** |
| — | `tests/dock-corner-controls.test.tsx` | Same cause, same day, **failed loudly** — because its author asserted the masthead's `--safe-top` padding is found *before* asserting the absences. |

The two differ in one line. That is the whole argument of this document, arriving as evidence
rather than as reasoning: the guard with a positive control announced the breakage, and the guard
without one absorbed it silently. Neither author did anything else differently.

The repair was calibrated without mutating anything, because the merge supplied both states: the
pre-merge body holds **2** bare selectors and the post-merge body holds **0**, so the repaired
guard separates them, while the version reading `styles.css` reports green for both.

**And note who found it.** Nine instances came from review — mine, or GPT Sol's. This one came from
a stranger's test breaking under a change neither of us was thinking about. A split large enough to
be worth doing is large enough to walk through other people's assumptions, and there is no review
that reliably catches that; merging often enough that each collision is small is the thing that
does.

Plus two near-misses of the same shape, caught before they landed: a `toContain(".crit-how")` guard
satisfied by `.crit-how-x`, the exact rename it existed to catch; and `git diff --stat -- src/web/styles/`
proposed as a verification for a directory that was **untracked**, so it would have reported "no
changes" whatever an agent did.

## Which commit introduced it

No single one, and that is part of the finding. Six were introduced on 2026-09-06 by the work that
was *specifically trying to close this class*; three predate it (#8 and #9 by months, #1's
underlying false docblock by however long ago Force acquired its embedding call). **Writing a guard
is not protection against writing a bad guard**, and being alert to the class demonstrably does not
prevent instances of it — every one of #2–#6 was written by someone who had just read
[silent-success.md](../reusable/silent-success.md).

## The fix that is right for the long term

**Calibrate every guard against its own mutation, and record the failure message.** Not "write a
test"; not "review the test". Break the thing the guard watches, watch the guard go red, put it
back. Nine of nine here were found that way and none was found by reading.

That is already the house rule — CLAUDE.md says *"mutate the finished code at the end of the stage
and check the suite notices"* — and it was followed for the headline assertions and skipped for the
*guards*, on the tacit reasoning that a guard is too simple to be wrong. Seven of the nine are one
line long.

**The asymmetry to internalise:** a headline assertion that is wrong usually fails loudly and gets
fixed on the spot. A *guard* that is wrong is silent by construction — its whole job is to say
nothing when things are fine, and a broken one also says nothing. So guards need calibration more
than the assertions they protect, and they get it less.

## What would have caught the whole class, ranked

1. **Mutation-first as a rule for guards, not a ritual for features** — cheapest by far, and it
   caught all nine. Concretely: a guard may not be committed until its author has pasted the red
   message it produces. Costs about a minute each.
2. **A cross-family reviewer with a sandbox that runs things.** GPT Sol found seven of the nine, and
   **reproduced every one by mutating and running** rather than reasoning. A reviewer that only
   reads would have found few of them — several look completely correct on the page. Worth the
   45 minutes, and worth handing it a tree it can execute in.
3. **Types where a predicate would do.** #5 vanishes entirely under a non-empty tuple type
   (`readonly [T, ...T[]]`); no assertion, no calibration, no way to write the broken form. Prefer
   this whenever the property is structural.
4. **Distrust prose as a source of truth for a test.** #1 is the expensive one and the least
   mechanical to prevent. A docblock is a claim, not a contract; when a table encodes what the code
   *should* do, derive it from the product decision or from an authority that is itself checked —
   and if the only available source is a comment, verify the comment first. `activation.ts`'s claim
   contradicted three other files that all had it right.

   **This one already has a doc, and it names the mechanism exactly**:
   [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — *"a written
   statement is believed later in proportion to how confident it sounds, not to how well it was
   checked"*, and *"nothing can fail, because prose does not run"*. What #1 adds to it is a
   **fifth species worth naming**: prose that a *test* is then written from. The other four species
   are found when a person acts on the claim, which is bad enough. This one gets the claim compiled
   into a green assertion, so the wrong belief acquires a passing test as evidence for itself, and
   the next person who doubts the comment finds a test agreeing with it.

## Done in this run

1, 3 and 4 are done: all nine fixed, each with a recorded before/after mutation; #5 is now a
non-empty tuple type; and the false `activation.ts` prose is corrected along with the same claim in
[diagram.md](../project/diagram.md). Recommendation 2 is the existing house workflow and needs no
change — it worked.

Recommendation 1 is the one that wants writing down where people will meet it, and it is not yet in
[silent-success.md](../reusable/silent-success.md), which says *why* a check can be worthless but
does not say **paste the red message into the commit**. That is a doc edit for whoever next touches
that file — deliberately not made here, because it is a rule-wording change to a `docs/reusable/`
file and CLAUDE.md routes those through
[edit-important-docs.md](../reusable/edit-important-docs.md) one approved change at a time.

---

Up: [postmortems.md](../project/postmortems.md)
