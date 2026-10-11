# 261011s — The guide saves your reason and About you at once, when the words are yours

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-2gy92mvc` (supersedes
`qi-wm5nsweg`); question [q-t3j8hj](../user-feedback/questions/q-t3j8hj.md), reply `spya-ca4fx4`;
report `spya-yk3r03` (#559, SPIDERYARN-READING2-H8). Builds on
[261009q](261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md), which made
the offer a card with a Save button.
**Status: built with Greg's word-for-word check, after GPT Sol broke the looser one; measured
(18/18, 9 of 14 offers save at once); GPT Sol on the plan and the code. One narrow question for
Greg in q-t3j8hj.**

## What Greg asked for

Reply A to q-t3j8hj, 2026-10-11T01:19Z: the Overseer may give 2B (the guide saves without a press,
with an Undo) to an unattended agent, on two conditions — the words are saved only if they appear
**word for word in a message the reader typed in that conversation**, and the security notes
(security-map.md, the `chipFor` row) are updated in the same change; GPT Sol reviews plan and code.

Twenty minutes later, from the Feedback button:

> I think we had said that the guide chat can now update while you're reading. Can we make sure it
> can also update the user's profile? We can make minimal updates to the prompt to say that it
> should stay quite close to their original wording. I don't think that it needs to be an exact
> quote though.
>
> — Greg, 2026-10-11, report `spya-yk3r03`

The two disagree on one word. "Word for word" was the safety catch A rested on; the report loosens
it to "quite close". The brief: find a check that is both safe and close-not-exact if there is one;
if not, build with word for word and ask Greg the narrow remaining question.

## The threat, which decides the check

The guide's prompt holds the whole article, so a planted instruction in an article can make the
guide call `offer_to_save` with words of its choosing. **About you goes into every later prompt on
every article**, so a saved planted sentence is a persistent injection, not a one-off. Today the
press stops that: the reader reads the words first. Without the press, the check is the only thing
between article text and the reader's profile.

## What was tried first, and why it went

The first version of this plan allowed **every word of the offer to be one of the reader's** (typed
this turn, or already in the field) **or a fixed linking word** (*a*, *the*, *I*, *am*, *have*,
*for*, *reading*…), order and punctuation free. It looked close-not-exact and safe. GPT Sol broke it
in the plan review, with cases that all passed:

- "What does this paper say about cancer?" → About you **"I have cancer."**
- "What does the French study show?" → **"I am French."**
- "I do not want links to evil.com." → **"I want links to evil.com."** (a negation taken away)
- "Can you link this to Open AI?" → **"Link to open.ai."** (a link made from words)

A bag of the reader's words is not their meaning. **No check that lets the model rearrange or
substitute words was found that a planted instruction cannot turn into a claim the reader did not
make**, so this is built with Greg's word-for-word condition, and the looser ask is the question.
Those four are tests now (tests/save-closeness.test.ts), and each waits for the press.

## The check, as built: word for word

`savesAtOnce` ([src/save-closeness.ts](../../src/save-closeness.ts)). An offer saves at once only when:

- **a reason** is a contiguous run of the message the reader typed this turn: compared in lower case
  with runs of white space folded, and full stops (or `! ? …`) at the end ignored; at word boundaries;
  at least three words; and not starting straight after a negation (*"I do not | want links…"*, the
  one cut of a quote that turns it round);
- **About you** (the whole new text) is **what it held, unchanged, then such a run**: a save at once
  only adds the reader's words at the end. A correction, a rewrite, or anything that drops what was
  there waits for the press.

Anything else is offered exactly as before: a card with its Save button. So the check only decides
which of two existing behaviours happens. The guide is still told to stay *quite close*, not exact,
which is Greg's report; close-but-not-exact simply means a press.

**What a planted instruction can still do**: choose which run of the reader's own message is saved,
and save it into About you (where it goes into every later prompt) or as the reason. It cannot add a
word, change one, or cut off a leading negation. The reader sees *Saved … from what you wrote* with
the words and an Undo.

### Typed

"A message the reader typed" is not every user message: the guide's *ask* next steps, the greeting's
starts and the suggestions send words a model or our code chose, as the reader's message. So a send
carries **`typed: true`** (a per-turn request flag, like `help: true`: absent or literally `true`,
400 otherwise) only from:

- **the composer** (`SendHow`, src/web/ChatPanel.tsx), dictation included: the reader's words;
- **the command bar's *Ask the guide*** row, the reader's own typed sentence. `ChatHandoffToGuide`
  now has a required `typed`, so a future sender has to say.

Not typed: every button, a retry, and **an edit** — refused by the route, since an edit's box starts
from words that may have been a button's, and editing one word of a model's sentence would launder
the rest (GPT Sol's P1). Only **this turn's** message counts, not the whole conversation: stricter
than "in that conversation", no stored flag and no migration, and the guide offers in the answer to
the message that said it.

The flag is the client's claim, and the client is ours: the party this guards against is an
article's text steering a model, not the reader.

## Where each piece lives

- **The check**: src/save-closeness.ts, pure, tested on its own (the attacks above included).
- **The tool** (`offerToSave`, src/chat-tools.ts): `ToolContext.typed`; the offer gains
  `now: true` (`SaveOffer.now`) when `savesAtOnce` passes. For a `now` offer the model is told the
  page will save it and say so under the answer, and to **say nothing about saving those words**:
  the write happens later, on the page, and may not (Sol's P2).
- **The route** (src/routes.ts `streamChat`): validates `typed`, refuses it on a retry or an edit,
  and hands the question to `converse` as `typed` only on a guide turn.
- **The card** (`GuideSaveOffer`): a `now` offer **saves itself once, on an answer this tab's own
  stream finished** — `markAnsweredHere` in the controller's `done` sink, under the id `begin`
  gave it; `takeAnsweredHere` answers true once per answer and field
  ([src/web/chat/answered-here.ts](../../src/web/chat/answered-here.ts)). The same `save` as the
  button: fresh read, basis check, verify, Undo. Seen any other way (a reload, coming back to it), it
  reads once and shows *Saved* with its Undo if the words are what is stored, or the button if not.
  So an Undo then a reload never saves it again, and the Undo survives a reload.
- **Stored JSON**: `offerOf` keeps `now` only when it is literally `true`.
- **Not in Live**, as before.

## The prompt (minimal, as Greg asked)

In SAVING WHAT THEY TELL YOU: the opening says an exact quote saves at once and anything else has a
button; the closeness bullet says *stay quite close, not necessarily an exact quote*, that an exact
quote of three or more of their words saves at once (*prefer one when it reads well on its own*), and
what that means for About you; the last bullet still forbids saying it is saved. The tool's own
description says the same in a sentence.

## Security notes, same change (Greg's condition)

security-map.md's `chipFor` row names the one exception, with the rule and the three files. Also
chat-tools.md, reader-profile.md, and the Help page's Chat section (`modes/chat.md`).

## After the plan review

[GPT Sol](261011s-plan-review-sol.md): **rethink**. Each finding checked here.

- **P1, harmful claims pass the vocabulary check.** Right; reproduced by reading the rule. Taken in
  full: the vocabulary check is gone, word for word is built (§ What was tried first).
- **P1, edits marked typed launder a button's words.** Right, and the code had already refused
  them; the plan said otherwise and is corrected. Its caller audit found the bar's *Ask the guide*
  losing a provenance it has: now carried (`ChatHandoffToGuide.typed`, required). Its note on a
  guide handoff that waits in the box (the composer would mark those words typed when sent): no
  sender does that with words that are not the reader's; the field's comment says a sender of such
  words must send them, not leave them in the box.
- **P2, "saw pending" is not a sound signal.** Right: a pending row loaded after a reload counted
  as watched. Taken as recommended: the controller marks the reply when this tab's own stream
  delivers `done`, under the server's id, consumed once per field. Tests: a pending-then-done row
  not finished by this tab saves nothing; a second sight saves nothing; the controller marks under
  the server's id and not the minted one, and not on a failure.
- **P2, the transcript could claim a save that did not happen.** Taken: the model is told to say
  nothing about saving a `now` offer; the card is the only thing that says *Saved*.
- **P2, read-then-write, not compare-and-set; Undo only while mounted.** The second half taken: a
  `now` card seen again reads and offers its Undo whenever its words are what is stored. **Not
  taken: a server-side compare-and-set.** What is left is the reader's own other tab writing to the
  same field in the milliseconds between the card's read and its write; an article cannot cause it,
  since the write is still only ever of the reader's own words over the basis it read. 261009q
  accepted the same residual for the press. Named, not fixed.
- **P3, typical paraphrases will often fail.** True of the word-for-word rule too, by design:
  close-but-not-exact is a press. Measured (§ Log): 9 of 14 offers saved at once after a
  one-sentence nudge to prefer an exact quote.

## The simpler options passed over

- **Keep the press for everything** (q-t3j8hj's C). Greg chose A, and the report asks for more.
- **About you always pressed** (Sol's suggestion). Greg's report asks for About you in particular;
  append-only and word for word keeps it to the reader's own words added at the end.
- **The server saves in the tool.** Atomic and survives a closed tab, but makes a model tool write
  the reader's data on the server, a new write path; the card already has the careful
  read-check-write-verify-Undo, and reusing it is one way to do one thing.
- **Typed across the whole conversation** (a stored flag per message, a migration). This turn's
  message covers the case the guide is told to offer on.

## For Greg (in q-t3j8hj)

The narrow question: **should a close paraphrase also save without a press?** Built: only a word-for-
word run of what you typed saves itself; anything reworded shows the card with its Save button, as
before. A looser rule that let the guide reword was broken in review (a question about cancer saved
as "I have cancer"), and no safe middle was found. Options: keep it as built; or accept a looser rule
knowing that risk; or keep About you always pressed.

## Stages

- [x] **0. Plan review**: GPT Sol, read-only. Rethink → redesigned as above.
- [x] **1. The check, the flag, the tool**: tests red first (save-closeness, the tool, the route).
- [x] **2. The card**: the self-save on an answer this tab finished, the second sight, the bar's
      handoff; jsdom tests, each mutation-checked red.
- [x] **3. Measure, docs, review, land**: § Log; security-map row, chat-tools, reader-profile, Help;
      GPT Sol code review; gates; push; bookkeeping.

## Log

- 2026-10-11: **measured**, [261009c § 2026-10-11](../investigations/261009c-the-guide-s-offers-to-save-measured.md#2026-10-11-which-offers-save-at-once-plan-261011s):
  v4 18/18, 6 of 14 at once, one answer said "buttons" beside an offer with none; v5 (two sentences)
  18/18, 9 of 14 at once, every button mentioned was there. The hostile article drew no offer.
