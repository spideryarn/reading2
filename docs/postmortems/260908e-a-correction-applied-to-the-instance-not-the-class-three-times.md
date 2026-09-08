# A correction applied to the instance, not the class — three times, by the person who wrote the rule

Building the box-health history on 2026-09-08, GPT Sol's plan review made one finding above all the
others: **a break in the chart does not mean "nothing was running", and saying so claims more than
the evidence supports.** I agreed immediately, called it the most valuable finding, wrote the reason
into the plan, fixed the renderer, and added a test asserting the page never says it.

Then I said it again in three more places, and each one had to be found by somebody else or by a
sweep — never by the fixing itself.

Nothing shipped. The interest is entirely in the shape.

## What happened

> A GAP MUST RENDER AS A GAP, never as a line drawn across it. […] an interpolated line through the
> ninety minutes the box was thrashing is the single most expensive thing this feature could do,
> because it answers his question with a confident "no".
>
> — the `orchestrator-setup` session, 2026-09-08, as the condition of handing the work over

Sol sharpened that into the rule that matters: the record is silent, and **why** it is silent is not
in it. A break is the box down, the dashboard down, a collection that hung, a drain that blocked the
loop, an append that failed, or somebody restarting the server.

The fix, and the three misses:

| where | how it was found |
|---|---|
| `describeGaps` — the sentence a reader actually sees | the finding itself; fixed with a test |
| the plan doc's four-states table — **the design** | a `grep` I ran on a hunch, hours later |
| `health-history.ts`'s module header — the first thing anyone reads before touching the store | the *same* grep, one line later, only because I re-ran it case-insensitively |
| the retention banner: *"Any break after that is this, not the box"* | GPT Sol's **second** review, after I had "finished" |

The fourth is the sharpest. That sentence was written **after** the first fix, by me, in a component
whose whole purpose is to keep causes apart — and it is unknowable in exactly the way the rule
names: if writing failed and the box then crashed, both happened, and the sentence talks a reader out
of the second one.

## The root cause, and the name for it

**A correction lands where the error was pointed at, not where the error lives.** The finding
arrived as *"this sentence claims a cause"*, so a sentence got fixed. The class — *nothing in this
feature may name the cause of a silence* — was understood, agreed, written down at length, and still
not swept for.

The tell is that all three misses were reachable by one `grep` over four words, and that grep was
not the first thing I ran after accepting the finding. Believing the rule and having applied the rule
felt identical from the inside, which is the whole difficulty: there is no sensation attached to the
places you have not looked.

It is the same class as
[260908a-a-rule-written-to-the-width-of-the-complaint](260908a-a-rule-written-to-the-width-of-the-complaint.md),
where a touch-target rule was scoped to the control that had been complained about and travelled one
link in eleven days. That one is about a rule that does not travel; this one is about a rule its own
author does not carry across the room. **A cheaper way to say it: the fix for a finding is a sweep,
and the sweep is not optional because you agreed with the finding.**

## What would have caught it

**A grep, run as part of accepting the finding rather than as an afterthought.** Every one of the
three misses contained the literal words "nothing was running" or "the box was down". The cost was
about fifteen seconds:

```
grep -rin "nothing was running\|the box was down" tools/fleet/ docs/plans/<this plan>.md
```

The rule that generalises: **when a review finding is about WORDING OR A CLAIM, the fix is a search
of the whole feature for that claim, not an edit at the line named.** A finding about a line is a
finding about a habit.

Three things make this cheap enough to do every time:

- the claim is nearly always a short, distinctive phrase, so the search is trivial to write;
- docs and comments are in scope, not just code — two of the three misses were prose, and the plan
  doc's table **was the design**, so it would have taught the next reader the thing being removed;
- run it **case-insensitively**, and after each round of fixes rather than once. My own first sweep
  was case-sensitive and missed the module header, which was the very next line of output.

## What did not work, and is worth knowing

**Writing the rule down at length did not help.** By the time the banner was written, the reasoning
existed in the plan doc, in two module headers, in a test name and in a commit message. Volume of
explanation is not coverage — and note that this is the *inverse* of
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md), which is about prose
that is wrong because nothing can make it fail. Here the prose was **right**, repeatedly and at
length, and the writing of it was mistaken for the applying of it. Both fail for the same underlying
reason: prose does not run, so it neither catches you nor proves you.

**My own test did not help either**, and it could not have: it asserted that `describeGaps` never
says it. A test written at the site of the finding inherits the finding's scope. The test that would
have worked is the grep, which is a different kind of check — over the *source*, not the behaviour —
and this repo already has that habit for React's raw-markup prop, greped for across
`tools/fleet/web/src/`. That guard exists because somebody realised a rule about what may be written
needs a check that reads what was written.

## The fix that is right for the long term

Not a lint rule; the phrase is too particular to be worth encoding, and the next one will be
different words. The durable version is procedural and belongs with how findings are handled:

**When a review finding is that something CLAIMS TOO MUCH, grep the whole feature — code, comments,
docs, tests, commit-message drafts — for the claim, before editing anything. Then fix, then grep
again.**
