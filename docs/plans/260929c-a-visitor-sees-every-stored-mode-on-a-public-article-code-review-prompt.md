You are GPT Sol, reviewing built code in the repo at the current directory (Spideryarn, TypeScript), and **fixing what you find** inside this change. Report anything wider for me to decide.

## What changed
Plan: docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md (read it, including your own plan review at docs/plans/260929c-…-plan-review-sol.md and how each finding was handled).

A signed-out visitor (or signed-in non-owner) of a **public** article now sees the *stored* output of Trajectory, FAQ, Citations and Debate, carried on the public payload (`GET /api/public/article/:slug`) and drawn by visitor bands that mount no fetching hook. Before, all four were `owners-only` in src/web/visitor.ts § POLICY and a visitor got an explanatory band (bug SPIDERYARN-READING2-56).

The change is three parts; review all of it:
- `git show b0520cf5` — Trajectory.
- `git show 81905905` — FAQ and Citations.
- `git diff HEAD` — Debate (uncommitted), plus an `OWNERS_ONLY` record in tests/visitor-gaps.test.ts.

## The conclusion I most want you to try to break
**"After this change, nothing a visitor can do — press, deep link (?mode=, ?stop=, ?depth=, ?q=, ?remember=quiz, ?diagram=, …), hover, stop-card link — starts a model call or a job, sends a request outside /api/public/, or receives the owner's private data (profile, profileHash, purpose, citation_finds, a credentialled/private-host/query-bearing URL including the article's own source address nested in a Debate row)."**

Look especially at:
1. The visitor bands and panels: TrajectoryPanel/TrajectoryMode (VisitorTrajectoryBand, the stop card's `onOpen`/`canOpen`), FaqPanel/FaqMode, CitationsPanel/CitationsMode, DebatePanel/DebateMode — does any visitor path reach `useTrajectory`, `useFaq`, `useCitations`, `useDebate`, `useAutoRun`, `useStepJob`, `use*Read`, a Find-it action, or an owner-only button? Does an owner path lose anything it had?
2. src/public/dto.ts `publicTrajectory`, `publicFaq`, `publicCitedWork`, `publicDebate` — field-by-field? Any provenance, `key`, `found`, `profileHash`, drop counts leaking? The Debate address handling (row `url` via publicCitationUrl → row dropped; `identifies[].url` via publicSourceUrl; string fields containing a refused address → row dropped; a known gap for percent-encoded addresses). Is the policy choice right? Is the dropped-row count computed at the boundary?
3. src/store/public-reader.ts PUBLIC_PROJECTIONS and the call to publicArticle; src/store/pg.ts shareableArtefacts; src/web/AccessSharing.tsx ARTEFACT_KEYS — an old server's payload lacking the new keys: does asPublicArtefacts now reject the owner's whole sharing card (wrong blast radius)?
4. Copy that is now false: src/web/PrivacyPage.tsx, src/web/PublicReadableSharingPage.tsx, SHARED_LINK_CARRIES and DEBATE_*_NONE_SHARED in src/messages.ts, docs/project/{trajectory,faq,citations,new-mode}.md, the owner's inventory (src/web/shared-inventory.ts).
5. Tests: do the new tests in tests/public-network-trace.test.tsx, public-dto, public-reads, public-visibility-pg, visitor-gaps actually fail if the code is wrong (e.g. a visitor band that did fetch)? Any missing?

## Constraints
- The test runner on this box may refuse to start for memory ("REFUSING TO START"); you may skip running tests, but then say so. `npm run typecheck` works (judge by exit code; errors go to stderr).
- Do not run git commands that change state. Do not touch unrelated files.

## Answer
A numbered list of findings: severity (P0 = a visitor can spend or read private data; P1 wrong/missing behaviour; P2 nit), file:line, what you fixed (or why not). Then the list of files you edited, and a one-line verdict.
