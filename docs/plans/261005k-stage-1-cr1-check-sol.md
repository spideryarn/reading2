CR1 closed. At `82799379b`, all three callers reject repeated Enter, retain fresh-Enter sending, and none depends on repeated sends. The requested 44 tests and the held-Enter handoff regression pass.

New minor defect: held Enter can now insert unwanted blank lines in [Edit Question](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/ChatPanel.tsx:2367) and [Candidates](/var/tmp/spideryarn-worktrees/why-reading-feeds-the-bar/src/web/CandidatesPanel.tsx:867): repeats bypass their `preventDefault()`. This does not reopen CR1.

VERDICT: CR1 closed