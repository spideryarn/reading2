# A comment stood in for the check it described

**Found 2026-09-04**, in a signed-out browser pass on a shared article, by a subagent that had been
told to look at an article with no saved searches on it. What it saw:

> Whoever added this article hasn't searched it.
>
> **Nothing matched.** The model found nothing in this article that matches. That is an answer, not
> a failure — try describing it differently if you think it is in here.

Two empty states, stacked, saying different things about one article. The second is an answer to a
question nobody asked, and it invites the reader to rephrase a search they never ran — on a page
that, for a visitor, has no box to rephrase it in.

## The root cause, which is not the missing line

[`Results`](../../src/web/SearchPanel.tsx) has a guard at the top:

```ts
if (matcher === "meaning" && !loaded) return null;
```

and directly above it, a comment saying what the guard is for:

> Only when there is a list to tick: with no saved searches at all, `Saved` above is already
> explaining that, and **two empty states stacked is one too many**.

The comment describes a check on `runs.length`. The code checks `loaded`. So for the length of one
request an article with no searches drew nothing here — and the moment the fetch answered, `loaded`
went true, `runs` stayed `[]`, and the component fell through every case to its last one and printed
*"Nothing matched."*

**The line that was missing is the boring half.** The interesting half is that somebody wrote down
the rule, in the right place, in a sentence that names the exact failure — and the rule was never
expressed as anything a machine could check. The comment then read as evidence that the case was
handled, to everyone who came afterwards including the person who added the visitor's empty state
one screen up and did not think to look down.

## The class: **an intention recorded as prose where a check was needed**

This is [silent-success.md](../reusable/silent-success.md)'s shape with the roles swapped. There, the
usual failure is a check that reports success while doing nothing. Here there was no check at all,
and a *comment* did the reporting — which is worse, because a comment cannot go red and nobody
re-reads one to see whether it is still true. The comment was not wrong when it was written; it was
never right, in the sense of never having been true of the code beneath it.

The tell, in hindsight, is grammatical: the comment says *"only when there is a list to tick"*, and
the condition below it does not mention a list. A comment whose subject and its code's subject are
different nouns is a comment describing something that is not there.

## Where it came from

**`dd8de264`, 2026-08-26** — *"Give each saved search a colour, and let several be on at once"* — the
commit that introduced the ticks, and with them the *"searches exist, none is on"* state. That commit
added both the comment and the `!loaded` guard. The `runs.length === 0` case was reasoned about,
written down, and not implemented.

It was an **owner-facing** bug for nine days and nobody reported it: an owner with no saved searches
got both sentences. Publishing saved searches on a shared link
([260904c](../plans/260904c-more-modes-on-a-shared-link.md) § Stage 4) did not cause it — it only put
the pair on a screen somebody had been told to go and read.

## The fix

One line, plus the paragraph saying what it is:

```ts
if (matcher === "meaning" && runs.length === 0) return null;
```

Two tests, one per audience, because the bug had two and only one of them was ever going to be
looked at:

- `tests/public-network-trace.test.tsx` — the visitor's, on an article whose `searches` is `[]`.
- `tests/search-colour-picker.test.tsx` — **the owner's**, which is where the bug actually lived. It
  mounts `SearchPanel` on the owner's arm with no runs, and carries a control that re-mounts with
  runs, so the guard cannot be "widened" into switching the results area off for good.

Both were watched failing with the line commented out.

## What would have caught the class, ranked

1. **Reading the comments as claims.** Cheapest and least reliable, but it is what happened here in
   the end — the browser agent did not read the comment, it read the screen. A pass over a component
   asking *"is each of these sentences true of the code under it?"* would have found this in
   seconds, and there is no tooling for it.
2. **A test per empty state, named after the state.** `Results` has **seven** early returns and this
   repo tests two of them. An empty state is a claim about the article made by us, and each is one
   `it()`; the reason they go untested is that they feel like copy rather than behaviour, which is
   the same misjudgement that let a copy rule live in a comment.
3. **A browser pass on the empty case, routinely.** Every browser pass this repo has run was on
   fixtures chosen to *have* the thing being looked at. The one that found this had a line in its
   brief saying to check an article with none — and that line was there because the plan happened to
   name a visitor-facing empty state, not because anybody had a rule about it. **The rule is worth
   having:** for any feature with a list, look at it with an empty list, signed out.

## Also on this pass, and the same shape

The stale warning on a saved search ended *"↺ puts the question back in the box so you can ask it
again"*, shown to visitors who have neither the button nor the box. Found by GPT Sol reviewing the
same stage. Its class is different — a true sentence carrying a false half, which
[copy.md](../project/copy.md) already names — but it was missed for the same reason: the fixture's
run was fresh, so no test ever rendered the string.
