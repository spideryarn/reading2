# Code review wanted: Referee mode, stages 1, 2 and Mirror

You reviewed the **plan** for this earlier and returned "do not build as written"
(`docs/plans/260831an-referee-mode-review-sol.md`). Eleven of your twelve findings were accepted and
the plan was rewritten. **This is the second review, of the code built from it, and it should carry
more weight than the first** — a plan-stage review reads prose and cannot find a handler that writes
one field and then rejects the request.

## What to review

Four commits, in order. Review the code, not the prose:

```
248cca5  research and plan
3d71c4e  the mode shell, sub-modes, the two confidentiality notices
bd2f38e  Mirror: prompt, call, validator, eval
17e4ac0  the anonymous renderer and the deterministic injection scan
```

`git log --oneline 248cca5~1..HEAD` and `git show <sha>` will get you each one. **Ignore everything
in those commits' neighbourhood that is not Referee work** — thirteen other sessions share this tree
and one unrelated commit (`265356b`, a `toc`→`hierarchy` rename) swept some of this work in
accidentally, so provenance is messy. The files that matter:

- `src/web/referee-views.ts`, `src/modes.ts`, `src/web/params.ts`, `src/web/Dock.tsx`,
  `src/web/App.tsx` (`RefereeBand` and the panels), `src/web/AddArticle.tsx`, `src/messages.ts`
- `src/referee-mirror.ts` — **the system prompt is the feature; read it as such**
- `src/referee-criteria.ts`, the `refereeCriteria` table and the `comments.criterion_id` /
  `comments.valence` columns in `src/db/schema.ts`, `drizzle/0042` and `0043`
- `src/injection-scan.ts`, `src/article-prompt.ts`
- `tests/referee-*.test.ts`, `tests/injection-scan.test.ts`, `tests/arrows-belong-to-the-article.test.tsx`,
  `evals/referee-mirror.ts`, `evals/results/referee-mirror.md`

The current plan is `docs/plans/260831an-referee-mode-for-peer-reviewers.md` — **it has changed a lot
since you read it**, including a fourth sub-mode and a referee-supplied valence.

## What I want

**1. Did the code actually do what your findings asked, or does it look like it did?** You asked for
valence out of the prose stripe, confidence and valence never sharing a field, an identity-stripped
renderer, a deterministic pre-model injection scan, Claims defanged, and Mirror's checks narrowed to
what the ICLR trial tested. Check each against the code. Say plainly where the implementation is
cosmetic.

**2. The Mirror prompt.** It is the highest-stakes text in the feature. Where will it fail? Be
specific about the abstention rule — the eval shows it returning nothing on a set of good comments,
but eight cases is eight cases. What input makes it produce a remark about the *paper*?

**3. The injection scan's honesty.** Its own report says PDFs are not scanned at all, external
stylesheets are never fetched, and the cascade is approximated. Is `coverage` sufficient to stop a UI
from rendering "we looked and found nothing" for a document nobody looked at? What else can bypass it
that the corpus does not cover?

**4. The data model.** `referee_criteria` plus two nullable columns on `comments`. Is the discriminated
result union actually enforced at every boundary, or only at the validator? Does a negative valence
survive from model output to stored row? Is the FK's `no action` right?

**5. Anything genuinely dangerous** — auth, ownership, an unbounded cost, a write path that a visitor
reaches. `visitorGap`'s fail-closed fall-through is what currently marks this mode owners-only; check
that holds.

**6. What is missing that the tests would not catch**, and which test is theatre.

Ordered by severity, most serious first. File and line for every code claim. Say plainly if something
is fine — do not manufacture findings. End with the single change you would make if you could make
only one.
