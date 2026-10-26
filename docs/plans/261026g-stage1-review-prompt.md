# Review: 261026g stage 1 — the literature margin notes out of the experimental switch

You are reviewing a small change in the Spideryarn repo (this worktree). Read
docs/plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md (§ Stage 1),
docs/project/marginalia.md (the Literature row) and the diff below (`git diff HEAD` in this worktree
shows it too).

The change: Marginalia's *literature* notes (findings from Sources › Where it sits's literature
search) were only read and drawn with the experimental switch on. They are now read for every
owner. The read must stay a read (no job, no paid call), a stale dossier must still not be drawn,
a visitor must still get none, and nothing else may change.

Check, and fix inside this diff's scope anything you are sure of (you may edit files; run
`npx vitest run tests/marginalia-literature.test.tsx tests/artefact-read-hooks.test.tsx tests/marginalia-note-cards.test.tsx`
and `npm run typecheck`):
1. Can a visitor (shared/public reader) now reach `/api/situate` or see findings? Follow where
   `OwnerMarginFeed` is mounted.
2. Does anything else in the client still gate literature notes on the experimental switch
   (stamps, tips, filters, the margin's kind list, phone layout), leaving the change half-done?
3. Any stale comment or doc still saying "behind the switch" for these notes.
4. Do the rewritten tests actually fail without the fix (they did when written: 2 red)?

Write findings as a numbered list, each with severity P0–P3, file:line, and what you changed if
anything. End with a one-line verdict.
