# Review prompt — Referee mode, all four sub-modes built

You have reviewed this mode twice: the plan, and then the first code. Both are in the repo:

- `docs/plans/260831an-referee-mode-review-sol.md` (the plan — "do not build as written")
- `docs/plans/260831an-referee-mode-code-review-sol.md` (the first code — "do not ship this as a
  completed safeguard layer")
- `docs/plans/260831an-referee-mode-stage3b5c-review-sol.md` (your second code review — "do not call
  the safeguard layer done yet")

All seven findings of that third review are answered. The plan, kept current, is
`docs/plans/260831an-referee-mode-for-peer-reviewers.md`; the project doc is
`docs/project/referee-mode.md`.

**All four sub-modes are now built.** This review is of the two that were placeholders when you last
looked, plus the two fixes that followed.

## What to review

- `9b636cc` — **Claims**: `GET`/`POST /api/referee/claims/:slug`, `src/referee-claims*.ts`,
  `src/web/ClaimsPanel.tsx`, `resolveClaim`
- `ba6ff2a` — **an eval for Claims' linkage rule**, `evals/referee-claims.ts` and its transcript
- `12e7eab` — **the defect that eval found**, and its fix
- `acb11ba` — **Candidates**: a third `ThreadKind` on chat's machinery, migration 0050,
  `src/referee-candidates*.ts`, `src/web/CandidatesPanel.tsx`, the `converse.ts` branch
- `22a32f7` — **placement remarks minted in code**, which you recommended without hedging

`git show <sha>` for each.

## What I want from you

**Be adversarial. Assume I have fooled myself.** The failure shape this work keeps producing is a
check that reports success while doing nothing, with the obvious test agreeing because it shares an
assumption with the code. Three separate instances of it have been found and fixed in two days: a
fabricated neutral `0`; a panel saying "the model did not find a passage" when it found one and
failed to score it; and a claim silently dropped from a list whose whole defence was that a dropped
claim gets an honest row.

Specifically:

1. **Claims' three hard rules.** Document order is enforced by comparators that cannot see the
   passage count, and a test asserts no digit appears in the list. Linkage-not-adequacy is enforced
   by grammatical frames that blank a `reasoning` line rather than dropping the row. Is either
   evadable? Is there a fourth thing a referee would read as a ranking?

2. **`unaccountedSentences`, and whether it is honest.** It reports sentences, in blocks a claim was
   anchored in, that no claim's quote *begins in*. It deliberately does not look at blocks the model
   ignored entirely, because deciding which blocks are "the opening" is the judgement the sub-mode
   refuses to make. Is the resulting sentence — which says it is a fact about the list rather than
   about the paper, and asks the referee to decide — actually honest, or does it still read as an
   accusation? And is there a case where it produces so much noise that a referee stops reading it?

3. **Candidates' rule 1, which I think is the weakest thing here.** "No name without a source link
   the web search returned" is checked against OpenRouter's `url_citation` annotations. But those
   are emitted only where the model attributes a result *in its prose*, so the supply of the evidence
   the rule checks now rests on a prompt instruction the model can ignore — and when it does, the
   panel empties beside a transcript full of names. A real run had six well-sourced people and zero
   annotations. Is the current shape defensible while `plugins: [{ id: "web" }]` (which annotates
   unconditionally but runs one search per request) is the known alternative? What would you do?

4. **The minted placement.** You set six conditions for it not to become theatre. Are they all met?
   Is the fixed sentence derived only from stored facts, and is the deterministic selection under
   the cap really deterministic?

5. **The eval's frames, now shared with the validator.** They fire on six real ablated adequacy
   lines and stay silent on ten real guarded ones. The eval imports them from the production module
   so there is one copy. Does that sharing make either the eval or the validator weaker — a check
   and the thing it checks agreeing because they are the same code?

6. **Anything theatrical.** You have found two tests that could not fail. Is there a third in this
   diff?

## Knowingly still open, so do not spend the review on it

- **The injection scan is being wired right now** and is not in this diff. Your finding 2's first
  half — that nothing calls it — is still true as of these commits.
- **No browser pass has been done** on Claims, Mirror or Candidates. One is running.
- Candidates has **no eval**.
- There is still **no UI** for the referee's own valence on a comment, so Mirror's `placement`
  remarks cannot arise in the running app yet.
- `MAX_NOTE_CHARS = 600` is the only structural limit on Mirror writing prose a referee could paste.

Tell me what you would fix before this is called done, worst first, and be concrete about the
failure each one produces.
