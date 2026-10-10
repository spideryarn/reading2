You are reviewing a PLAN (read-only) in the Spideryarn repo, at this worktree's root.

Read docs/plans/261009x-a-round-that-wrote-the-reply-and-offered-to-save-is-the-last-round.md first.
(That draft is now docs/plans/261009x-next-steps-end-the-turn-even-beside-an-offer-to-save.md,
rewritten after this review.)

Evidence to check it against:
- src/converse.ts: `ENDS_THE_TURN` (around line 262) and the turn-ending `break` near the end of the
  round loop (search "A round that wrote its reply and then asked only for its next steps"); the
  delta joining (search "A later round's first words start a new paragraph"); `GUIDE_SYSTEM`'s
  SAVING WHAT THEY TELL YOU and NEXT STEPS sections (search "SAVING WHAT THEY TELL YOU").
- src/chat-tools.ts: `offerToSave` and `offerNextSteps` (search "function offerToSave").
- tests/guide-next-steps-tool.test.ts (describe "converse, when the guide offers its next steps"),
  tests/guide-offer-converse.test.ts.
- docs/postmortems/261009j-an-answer-is-every-round-joined-so-words-before-a-tool-call-are-never-taken-back.md
- docs/plans/261009u-plan-review-sol.md (your own F1/F2 on the turn-ending rule, which this plan
  partly reverses) and docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md.
- Measurements: evals/guide/results/offers-v4-baseline.json and offers-v4-baseline-referee.json
  (each row has `shape`: prose stretches "P" and tools in order; `repeated`). The doubled answer
  being fixed is in the peer branch: `git show worktree-fbh5aypq-peer-review-research:evals/guide/results/referee-offer-v1.json`
  (case reason-says-referee, run 1).
- evals/guide/offers.ts (the runner; uncommitted edits in this worktree add the shape trace, real
  `offer_next_steps`, and the referee-reason case).

Questions I most want answered:
1. Is the diagnosis right: that the doubled answer came from a refused `offer_to_save` after a
   written reply, with no "already on screen" sentence in the refusal? What else could explain it?
2. Is "prose + only offering tools ⇒ last round, whatever they returned" safe? In particular the
   preamble risk (prose before the offer is only "Let me note that." and the real answer would come
   after), and anything in the route/page (src/routes.ts, the web chat panel) that assumes the model
   got to speak after an `offer_to_save`.
3. Is reversing your 261009u F2 justified, or is there a smaller structural fix that keeps it?
4. Anything missing from the stages or the measurement.

Write findings as a numbered list (F1, F2, …), each with severity (P1/P2/P3), the evidence, and
what you would change. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
Do not edit any file.
