# Review prompt — Referee mode, the safeguards made real

You reviewed this mode's plan, and then its code. Your code review's verdict was
**"do not ship this as a completed safeguard layer"**, and its central charge was that
several protections existed only as unused helpers and untested intentions. That was
right. This is the work that answers findings 3, 4, 5, 6, 9 and the theatrical test.

Both of your earlier reviews are in this repo:
- `docs/plans/260831an-referee-mode-review-sol.md` (the plan)
- `docs/plans/260831an-referee-mode-code-review-sol.md` (the code)

The plan itself, updated with what landed, is
`docs/plans/260831an-referee-mode-for-peer-reviewers.md`.

## What to review

Five commits, all on `main`:

- `9dd54a8` — finding 6 (a missing diverging valence became `0`) and the anonymity test
- `9220e92` — finding 1 (the disclosure was missing on the direct-add path)
- `5ccbcec` — a zero-result line that made a claim about the paper, plus doc corrections
- `ded0047` — findings 3, 4 and 9: Mirror's invariants
- `4a39f14` — finding 5: the referee's own `criterionId`/`valence` crossing the app boundary,
  and an export gap that finding 5 did not mention

Get the diff with `git show <sha>` or `git diff 17e4ac0..HEAD -- <paths>`.

## What I want from you

**Be adversarial. Assume I have fooled myself.** The specific way this work has gone wrong
before is a check that reports success while doing nothing, with the obvious test agreeing
because it shares an assumption with the code. Look for that shape.

Concretely:

1. **Is finding 4 actually closed, or only moved?** `coverageAskable(): boolean` became
   `coverageStatus(): CoverageStatus` with a reason. Placement truncation is now
   priority-ordered. Is there still a path by which Mirror asserts coverage over a comment
   that never reached the prompt, or loses a placement?

2. **Is the fence real?** Quoted material now sits between per-call nonce lines and copies of
   the marker are stripped from interpolated text. Can a document still break out? Be
   specific about the attack if so.

3. **Finding 5's round trip.** A negative valence is meant to survive route → store → read.
   Is there a path that still clamps, coerces or drops it? `tidyMark` in `src/routes.ts`
   rejects rather than clamps — is the rejection complete, and is the `criterionId`
   ownership check actually scoped to the requesting owner?

4. **The export coverage guard.** `ARTICLE_TABLE_COVERAGE` in `src/store/export.ts` claims
   that a new article-scoped table cannot arrive unnoticed, and its test derives the table
   list from the schema rather than restating it. Does that hold? The known limit, written
   down, is that it sees a missing *table* and not a missing *column*. Is there a third gap?

5. **A design question I want your opinion on, and it is the one I most want answered.**
   An agent working on Mirror proposed **minting `placement` remarks in code rather than
   asking the model for them**. The argument: nothing about that kind is the model's — the
   fact is computable from the input, the note could be a fixed sentence, and the committed
   eval shows the model's own wording is *worse* than a fixed sentence, because it invents
   the rationale the prompt forbids it to guess ("why lack of participant blinding warrants
   this weight"). It would delete about twenty lines of prompt, remove an injection surface,
   cut tokens, and turn "placement always qualifies" from a prompt wish into an invariant.

   Against it: it is a change to what a referee reads, and the eval cannot be re-run
   cheaply to see what removing kind 5 does to the other seven cases.

   **Should this be done?** If yes, say what would have to be true of the fixed sentence for
   it not to become its own kind of theatre.

6. **Anything still theatrical.** You found `tests/article-prompt.test.ts` proving anonymity
   with blocks containing no identity. Is there another test in this diff that cannot fail?

## What is knowingly still open, so do not spend the review on it

- `src/injection-scan.ts` is **still dead code** — no production caller. Another piece of
  work is closing your finding 2 right now; it is not in this diff.
- **Claims and Candidates are placeholders.** Your finding 8 (the Claims placeholder copy
  still promising the framing the plan rejected) is unfixed and will be fixed by building it.
- There is **no UI** for the referee's own placement yet, and no route for *editing* one — a
  second `create` with a different valence is a 409, not a re-score.
- The Mirror eval has **not been re-run**; its transcript carries a hand-written note saying
  it is stale and that it records a failure its own summary missed.

Tell me what you would fix before this is called done, worst first, and be concrete about
the failure each one produces.
