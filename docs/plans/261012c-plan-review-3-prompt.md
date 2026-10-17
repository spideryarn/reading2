# 261012c — third GPT Sol plan review: the narrow form, before an unattended build

You are reviewing a plan before it is built. Read-only: do not edit files.

Plan: docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md
Your two earlier reviews: docs/plans/261012c-plan-review-sol.md and docs/plans/261012c-plan-review-2-sol.md
(both RETHINK; the plan's § Plan review says how each finding was handled).
The defence it changes: src/save-closeness.ts (the exact route today), called from src/chat-tools.ts
`offerToSave`; the card src/web/GuideSaveOffer.tsx; tests tests/save-closeness.test.ts.
The question and Greg's answer: docs/user-feedback/questions/q-pm2j66.md. Greg, 2026-10-17, reply
spya-v33gfs: "A or B is fine. I think we're overthinking this. I want the agent to be able to reword
lightly, and for you to tell me if there's good reason to allow it more discretion (I'm open to that)".

Only the NARROW form is to be built now (§ The narrow form and § Shared by both forms). The wide form
is not being built.

Your second review's P3 said the narrow form could become fit for an unattended build once the
context rule, instruction handling and the per-conversation limit were settled. The plan answered each
(§ Plan review, second pass): `;` and line breaks are not boundaries; let's/please/if/imagine/pretend/
suppose starts and any quotation mark refused; About you refuses you/your/yours and must start with I;
no limit, on the argument that every narrow save is an exact-route save with one contraction spelled
differently, and the exact route (accepted by Greg in q-t3j8hj) has none.

Please answer, briefly:

1. Is the narrow form, as now written, specified tightly enough that the builder is not making a
   security decision? Name any remaining ambiguity with a concrete string.
2. Is there any string the narrow route would save that the exact route as it stands
   (src/save-closeness.ts) would not save AND that is a materially worse claim or instruction?
   Concrete strings only.
3. Anything in the "Shared by both forms" tightening of the exact route that would break a legitimate
   case badly enough to reconsider (e.g. the quotation-mark refusal applied to the exact route, or the
   meta-word list)?
4. Verdict: BUILD, BUILD WITH CHANGES (list them), or RETHINK. Keep it under 600 words.
