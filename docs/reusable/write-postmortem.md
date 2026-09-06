# Write a postmortem

A postmortem is not a record of an incident. **It is an argument that a particular shape of mistake
will happen again, and a proposal for what would catch it next time.** The bug is the evidence; the
class is the point. If you finish one and the reader has learned only what broke, it has failed.

Write one for every bug whose cause was more interesting than the line that broke — not for every
bug. The test is whether you can name a class. If the answer is "somebody typed the wrong variable
and no general lesson follows", fix it and move on.

**Cost is not the trigger.** Some of the best entries cost nothing at all: a defect caught in review
before it shipped, or one tolerated on purpose. What makes it worth a file is that the same hands
will make it again somewhere nothing is watching.

## Name it after the lesson, not the symptom

The filename and the `# ` title are the same sentence, and that sentence is the class:

```
a-signpost-committed-before-the-thing-it-points-at    findable a month later
a-red-first-test-defends-the-change-not-the-code      states the lesson in the title
toc-bug                                               names nothing
fixed-crash-in-parser                                 names the fix, not the mistake
```

A good title is a claim somebody could disagree with. If yours would fit fifty other bugs, it is a
category, not a class.

## The five things it has to say

A postmortem missing any of these is not finished:

1. **The real root cause** — not the line that broke. Keep asking why until the answer stops being
   about this bug and starts being about how the code, the checks or the process are arranged.
2. **The class it belongs to, named.** Give it a name somebody can use in a sentence — *a reference
   committed before its referent*, *a check that shares an assumption with the code it checks*. A
   class you cannot say out loud will not be recognised when it recurs.
3. **Which commit introduced it.** `git log -S` and `git blame` on the line, then read the commit
   message: what the author was trying to do is usually half the explanation. Say if you could not
   find it.
4. **The fix that is right for the long term**, which is often not the one that was shipped. Shipping
   a patch under pressure is fine; pretending it was the right design is what costs later. Name both.
5. **What would have caught the whole class**, ranked by ease against value, with the rejected
   options included and a reason.

## The section that earns the file: ranking the countermeasures

Not a wish list. A ranked, costed list in which **at least one item is cheap enough that you either
did it or could**, and at least one is honestly rejected:

```md
## What would have caught it, ranked by ease against value

1. **<one edit>** — turns an invisible failure into a visible one. Being done.
2. **<a habit, stated as a rule>** — costs nothing and would have prevented both instances.
3. <the heavyweight option> — rejected. The gap was never that the check did not run.
```

Rank by **ease against value**, not by thoroughness. A postmortem whose only recommendation is a
large new system is a postmortem nobody acts on, and an unacted-on countermeasure is worse than
none: it is written down, so it looks handled — [written-down-is-not-checked.md](written-down-is-not-checked.md).

**Say what you rejected and why.** That is the half nobody can reconstruct afterwards, and the half
that stops the next person proposing it again.

## A structure that works

Not a template to fill in — sections earn their place — but this order has held up:

| Section | What goes in it |
|---|---|
| Opening paragraph | What happened, what it cost, and **whether anything reached a user**. Say "nothing reached a reader" plainly if so; it changes how the rest is read. |
| **What happened** | The narrative, short, with the actual error text or output. Enough for someone to recognise it, not a transcript. |
| **The class, named** | A `##` heading that *is* the class. Often the only section a future reader needs. |
| **Why nothing went red** | The most valuable section in most postmortems. Every check that ran and agreed, and why each was satisfied. |
| **What would have caught it, ranked** | Above. |
| **The fix that is right for the long term** | And how it differs from what shipped. |
| **The thing I would tell myself** | One paragraph, first person, no hedging. What you actually knew at the time and decided wrongly. |

That last section is the one people skip and the one people read.

## How to find the class rather than the symptom

- **Ask what the check was doing while this happened.** If a test, a typecheck or a review was green
  over the defect, *that* is usually the class, not the defect. A check that shares an assumption with
  the code it is checking is the commonest one there is —
  [silent-success.md](silent-success.md).
- **Look for the sibling.** Grep the tree for the same shape somewhere else before you write the
  class down. Finding two instances turns a story into a pattern; finding none is worth saying too.
- **Count how many of the existing postmortems it matches.** If a third of the directory is the same
  shape, that is the headline, and it belongs near the top rather than in a footnote.
- **The mechanism, not the moral.** "We should be more careful" is not a class. "The evidence is
  earned per assertion and spent per suite" is.

## How to run it

- **Reproduce it with a failing test before you fix it**, and watch it go red. A test that was never
  red proves nothing about the bug it claims to cover.
- **Do the digging in a subagent** and ask for the write-up back, not the trail. The investigation is
  large and the conclusion is small; only one of them belongs in the main context.
- **Write it while the confusion is fresh.** The specific wrong belief you held — the reason the bug
  was possible — is the first thing to evaporate once you know the answer.
- **No blame, and no softening either.** The useful entries are the ones that say a check was
  written, read, believed, and did nothing. Flinch from that and the file is worth nothing.
- **Quote the evidence.** The failing output, the two predicates and their row counts, the commit
  SHA. A postmortem is prose, and prose cannot fail; the numbers are what make it checkable.

## Traps

- **Writing the incident report instead.** Timeline, impact, mitigation, resolved. Fine for a status
  update, useless a month later — nobody searches for an incident, they search for a shape.
- **A class so broad it predicts nothing.** "Insufficient testing" matches every bug ever written.
- **Recommending only the expensive fix**, so nothing happens.
- **Leaving the shipped patch described as the right answer.**
- **Duplicating the lesson into a rule doc and the postmortem both.** Give the fact one home: the
  postmortem keeps the incident and the reasoning; a rule that comes out of it moves into the doc
  that owns that rule, and links back.

## See also

- [silent-success.md](silent-success.md) — the class behind a large fraction of postmortems anywhere:
  something reports success while doing nothing, and the obvious check agrees.
- [written-down-is-not-checked.md](written-down-is-not-checked.md) — why a countermeasure that is
  only written down is not a countermeasure.
- [write-planning-doc.md](write-planning-doc.md) — where the long-term fix gets planned.
- [documentation-policy.md](documentation-policy.md) — one home per fact, and who each doc is for.
- [postmortems.md](../project/postmortems.md) — this repo's directory, its naming command, and what
  is true here in particular.
