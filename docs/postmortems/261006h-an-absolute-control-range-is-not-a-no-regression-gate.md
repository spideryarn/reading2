# An absolute control range is not a no-regression gate

Caught in the 2026-10-06 worktree review of
[261006e stage 2](../plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md).
No deployment is part of this review. The candidate's measurements were reproducible, but its
recommendation treated low observed error counts as evidence that the accepted shipping gate had
passed. Up: [postmortems.md](../project/postmortems.md).

## An absolute count was substituted for the paired effect

The [investigation](../investigations/261006b-skim-cue-situates-the-quote-eval.md#round-two-b2-a-scene-only-where-the-quote-needs-one)
reported three B2 context errors against one for A1, and called this inside the control. The
control's old-prompt counts were three and two. B2's absolute count, three, is inside the range
two to three; its paired excess, two, exceeds the control pair's difference, one. Those are
different comparisons. Neither establishes that B2 misstates context no more often.

Independent recounting of the stored keys and judgments gave:

```text
s1 A1 v A2: invents A1 3, A2 2; dangling preference 11 : 10, 7 ties
s5 A1 v B2: invents A1 1, B2 3; dangling preference 8 : 15, 5 ties
s6 B v B2: invents B 10, B2 4
```

The accepted plan required improvement on dangling-reference cases without regression on grounding
or giveaways. The recommendation admitted that the dangling result was not clearly outside the
control, then used the stronger overall preference, 50 to 19, to recommend shipping anyway.
This is **a gate passed by substituting a different comparison**: an absolute error range for a
paired error difference, and an overall benefit for the target subset's benefit.

`git blame` identifies **`06a41d14aeab94b036ff05ce53d38add050226ad`** as introducing the round-two
plan claim and recommendation. Its commit message repeats “both inside the control's spread” and
“the route did not move”. The intent was to retain B's useful context while removing its faults.
The route assertion is a sibling of the same mistake: aggregate similarities near one control
pair do not prove that a prompt has no route effect. The stored runs actually differ in depth,
carrying and order; the review found no established route regression.

## Why nothing went red

The evaluator counted judgments correctly. Its output contains counts, not a verdict on the plan's
shipping requirements. Code checks can verify cue limits and input hashes while saying nothing
about whether those measurements warrant a claim of no regression. One run of B2 and one judge per
comparison, from the writer's model family, leave both run variation and judgment variation poorly
measured. Listing those limits did not prevent the stronger recommendation from being written.

## What would have caught it, ranked by ease against value

1. **Recount and name the comparator** — cheap; done in review. Report both absolute counts and
   paired differences, and correct the candidate's conclusions. Keep the target-subset gate
   explicitly unresolved instead of calling the overall win its substitute.
2. **Require a disposition for each accepted gate** — a small result table for the next measurement:
   target subset, grounding, giveaways and route effects, each with its actual comparator and
   “shown”, “not shown” or “regressed”. A mechanical check can require those fields, but choosing
   valid margins and interpreting evidence still needs review. This check has not been built here.
3. **More independent runs and judges** — useful if the ship decision must establish the target
   benefit and rule out a meaningful error increase. Specify the target subset and acceptable
   regression margin before collecting more results. No paid calls were authorized for this review.
4. **A general statistical approval service for every prompt change** — rejected as disproportionate.
   The immediate failure was replacing the accepted comparison while reading an already correct
   table; a larger service would still need someone to define the right gate.

The narrow correction is to remove unsupported claims from the reference doc and investigation,
and append a dated correction to the plan's historical progress. The long-term answer is evidence
against the same gate that justified the work, or an explicit product decision to accept its
unresolved parts. Documentation corrections alone do not earn permission to ship the measured
prompt. The stage remains not ready on that decision.
