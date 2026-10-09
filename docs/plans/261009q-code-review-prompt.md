You are reviewing built code in the Spideryarn repo (this checkout), and you may fix what you find.

Read first: docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md
(the plan, your own plan review in docs/plans/261009q-plan-review-sol.md, and § After the plan review,
which says how each finding was handled). The diff of the stage is docs/plans/261009q-code-review.diff
(commit e14926aef on top of 56adcafa5). The measurement is
docs/investigations/261009c-the-guide-s-offers-to-save-measured.md with evals/guide/offers.ts.

Main files: src/chat-tools.ts (OFFER_TO_SAVE_TOOL, offerToSave, toolsFor, describeCall),
src/converse.ts (GUIDE_SYSTEM's SAVING WHAT THEY TELL YOU, `saved`, the finished ToolRun),
src/routes.ts (streamChat's profileParts and `saved`), src/types.ts (ToolRun.offer, SaveOffer),
src/web/GuideSaveOffer.tsx (the card), src/web/purpose.ts (storedReader), src/web/ChatPanel.tsx
(wiring), src/web/GuideGreeting.tsx and src/web/guide-greeting.ts (Keep this removed). Tests:
tests/guide-offer-to-save.test.ts, tests/guide-offer-converse.test.ts, tests/guide-in-chat-panel.test.tsx,
tests/guide-route.test.ts, tests/guide-kind.test.ts.

Constraints (trusted, from the admin): the save must be the reader's press; an unpressed save, or any
edit to docs/project/security-map.md or to a listed defence's mechanism, is out of bounds for this run
(write it up instead). Do not deploy, do not touch .env.local, infra/, systemd, or any remote database.
The box is loaded: run only the test files named above plus any you add, not the whole suite.

Review for correctness bugs first (the card's state machine, Save/Undo/basis semantics, the read
helper's field-by-field rules and the existing storedPurpose caller in SkimPurpose.tsx, the route's
single profile read and its wantsProfile=false case, the tool's validation, the converse copy of the
offer, anything that drops or forges an offer), then security (prompt injection -> offer, which runs may
draw a card), then the prompt wording, then tests that would pass while the code is wrong.

Fix what is clearly within this stage, with a test that fails before your fix where possible, and run
the named tests and `npm run typecheck`. Report anything wider for me to decide. Answer with: a verdict
(land / land with fixes / do not land), then numbered findings each with P1/P2/P3, evidence
(file:line), and what you changed or recommend.
