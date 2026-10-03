You are reviewing a small change in the Spideryarn repo (this worktree). It was small enough to be
built alongside its plan, so this one review covers both. Read the plan
docs/plans/261003b-marginalia-an-opened-line-wraps-and-a-question-s-passage-is-the-author-s.md,
docs/project/fonts.md (the voice rule), src/web/styles/voices.css, src/web/voice.ts,
src/web/marginalia/MarginaliaColumn.tsx, src/web/styles/marginalia.css and
tests/marginalia-shut-notes.test.tsx. The uncommitted diff is `git diff HEAD`.

Check two things, and say plainly if the conclusion is wrong:

1. The plan's claim: after this diff, every piece of text Marginalia draws is in the right face per
   fonts.md (author / ai / reader / ui). Hunt for any element in MarginaliaColumn.tsx (and anything
   it renders: tips.ts cards, notes.ts strings) still in the wrong face. Is `asked.quote` really the
   article's verbatim words? Trace where it comes from.
2. Greg's bug spya-qcgyb0: "when I click to expand, it shows the FAQ answer, but the FAQ question is
   still truncated." Does the new CSS rule actually make the opened label wrap, given the cascade in
   marginalia.css and anything else that styles .marg-shut-label / .marg-shut-button (`all: unset`,
   display, width, overflow on ancestors such as .marg-note or the column's cell)? Is any other
   kind's opened state still hiding words?

Fix what you find inside these files if it is small and clearly right; report anything wider. Then
list findings as P0/P1/P2 with file:line, and end with a one-line verdict.
