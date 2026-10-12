# Plan review, read-only: 261012c

Do not edit any file. Review docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md
against the code it would change (src/save-closeness.ts, tests/save-closeness.test.ts, src/chat-tools.ts offerToSave,
src/web/GuideSaveOffer.tsx, src/types.ts SaveOffer) and its predecessor docs/plans/261011s-....md.
Your own earlier design advice is docs/plans/261012c-design-consult-sol.md; Opus's is summarised in the plan.

The untrusted party is the article's text, which can steer the guide's `offer_to_save` arguments.
Greg accepted (reply B to q-q7mb3w) that close rewording may save itself. Nothing is built yet; the plan
will be put to Greg as "may an unattended agent build this".

Please:
1. Try hard to break the proposed deterministic rule: find an offer that passes every listed condition but says
   something about the reader they did not say, or carries a link/instruction. Give exact typed/offer strings.
2. Say whether any condition is underspecified enough that two implementers would build different defences.
3. Say whether the exact-route tightening is safe to bundle, and anything missing from the security notes.
4. Verdict on one line at the end: APPROVE, APPROVE WITH CHANGES, or RETHINK, with numbered findings (P1/P2/P3) above it.
