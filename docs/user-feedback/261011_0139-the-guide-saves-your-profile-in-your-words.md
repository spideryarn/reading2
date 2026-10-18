---
reports: spya-yk3r03
ending: shipped
comment: The guide updates your profile and reason; your exact typed words, or one whole sentence of them with only the spelling tidied, save by themselves with an Undo. You chose to keep the rewording light for now (q-tz5az8).
---
# The guide saves your profile in your words

An admin report from Greg (`scripts/feedback-reporter.ts` exit 0), `spya-yk3r03` (#559,
SPIDERYARN-READING2-H8), filed 2026-10-11 at 01:39:06 UTC from `/` (build `2c38ec32`), no
addenda. Queue item `qi-2gy92mvc` (superseding `qi-wm5nsweg`), session
`fbyk3r03-guide-saves-profile`, with Greg's reply A to
[q-t3j8hj](questions/q-t3j8hj.md) (`spya-ca4fx4`) twenty minutes earlier.

> I think we had said that the guide chat can now update while you're reading. Can we make sure it
> can also update the user's profile? We can make minimal updates to the prompt to say that it
> should stay quite close to their original wording. I don't think that it needs to be an exact
> quote though.

**Ending: shipped**, on `dev`, plan
[261011s](../plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md).

The guide could already offer About you since 261009q, as a card with a Save button. Now an offer
that is word for word what the reader typed in that message (About you: what it held, then their
words) saves itself with an Undo; anything reworded keeps its button. The prompt still asks for
"quite close", with one sentence added. A looser "close" rule for saving without a press was built
first and broken in review, so the remaining choice is Greg's: [q-q7mb3w](questions/q-q7mb3w.md).

**2026-10-12**: Greg answered B on q-q7mb3w (`spya-wwy7sh`): close rewording may save by itself too.
That loosens a defence, so it is planned, not built:
[261012c](../plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md),
with the build held as `qi-ywbfftr2` on [q-pm2j66](questions/q-pm2j66.md).

**2026-10-17**: Greg answered q-pm2j66 (`spya-v33gfs`): *"A or B is fine. I think we're
overthinking this. I want the agent to be able to reword lightly, and for you to tell me if there's
good reason to allow it more discretion (I'm open to that)"*. The light form is **shipped** on
`dev` (queue item `qi-mr3tgs7w`, superseding `qi-ywbfftr2`; commits `50ece5f11` the rule,
`f81ac6bc4` the card): one whole sentence the reader typed, changed only in spelling, saves itself
as *lightly reworded* with their sentence shown beside it and an Undo; both routes refuse quotation
marks, questions, links, meta words and an About you addition saying *you*. Security notes:
security-map.md's `chipFor` row and risk R27 (Medium, accepted). Measured in
[261009c](../investigations/261009c-the-guide-s-offers-to-save-measured.md): 11 of 14 offers save
themselves, from 9. Whether to allow more discretion is [q-tz5az8](questions/q-tz5az8.md), with a
recommendation not to yet.
