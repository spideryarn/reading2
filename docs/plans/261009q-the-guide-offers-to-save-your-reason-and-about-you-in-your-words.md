# 261009q — The guide offers to save your reason and About you, in your words

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-x6hteva9`; question
[q-w2740x](../user-feedback/questions/q-w2740x.md) part 1, report `spya-s6qhzv`
(SPIDERYARN-READING2-FB). Follows
[261009i](261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md) § Deferred, which put the
question. Part 2 of the same reply (share, private link, archive) is another session's
(`fbpqaftb-guide-action-buttons`); this one keeps off its files.
**Status: built, GPT Sol on the plan and the code, measured (18/18), on `dev`. Not deployed. Two follow-ups for Greg in q-w2740x.**

## What Greg asked for

> 1 Yeah, I think a mix of 1A and 1C. In other words, yes, the guide should have a tool to enable it
> to save to why you're reading or your profile, and obviously to read from them as well, so it can
> update them. I think the suggestion should be that it tries to stay very close to the user's
> wording, either an exact quote or a, that quote or a very close paraphrase. Perhaps it can add a
> little bit of its own interpretation around. I don't know. Probably best to stay fairly close to
> the user's input, but it doesn't have to be exact.
>
> — Greg, 2026-10-09, reply `spya-ujstyz` to `q-w2740x`

1A was "the guide picks the reason out of your own message and the page saves it by itself, with
an Undo; About you gets a button showing the full text". 1C was "the guide writes a short reason
and offers it as a button to press". The mix: **a guide tool** (1C's shape: a proposal, pressed)
whose words stay **close to the reader's own** (1A's closeness), for the reason and for About you,
with an Undo after the press.

**The boundary.** A save the reader does not press would be the first exception to the rule in
[security-map.md](../project/security-map.md) that anything a model proposes that writes the
reader's data is a press. That is a defence edit, which this unattended run does not make. Built:
the pressed version. Whether the unpressed one is worth having is written up for Greg in the
question file (§ For Greg, below).

## What is already there

- **Reading them.** Every guide turn already carries both, fresh from the store on that turn:
  `WHO IS READING THIS` with *About the reader* and *Why they are reading this piece*
  (`profileSection(…, "with-the-reader")`, src/converse.ts). So a save pressed a minute ago is what
  the next turn sees. A read *tool* would be a model call to fetch what is already in its prompt,
  the `summarise_article` anti-pattern src/chat-tools.ts' header rules out, so "read from them" is
  met by that section and the plan adds no read tool.
- **Writing them.** `savePurpose` (src/web/purpose.ts, `PATCH /api/library/:slug`) and
  `saveProfile` (src/web/useProfile.ts, `PATCH /api/reader`), both forgetting the link summaries,
  both bound to the reader (`madeFor`). `GET /api/reader?slug=` answers both, fresh.
- **Keep this as why you're reading** (261009i): under the reader's first answer to the greeting, a
  button that saves that whole message verbatim, never over an existing reason.

## The design

```
 guide
 ┌────────────────────────────────────────────┐
 │ you: for journal club next week, I don't   │
 │      know much ML                          │
 │ ⚙ offered to save why you're reading       │  ← the tool row, as every tool has
 │ guide: Then start with Summary › Brief…    │
 │ ┌ Why you're reading this one ───────────┐ │
 │ │ For journal club next week; I don't    │ │  ← the proposed words, in the model's face
 │ │ know much ML.                          │ │
 │ │ [Save as why you're reading]           │ │  ← the reader's press
 │ └────────────────────────────────────────┘ │
 │   … after the press:                       │
 │   Saved as why you're reading. [Undo]      │
 └────────────────────────────────────────────┘
```

### 1. A guide-only tool, `offer_to_save`

`{ field: "reason" | "about_you", text: string }`. **It saves nothing.** It is a server tool like
the others (`runTool`, src/chat-tools.ts), offered only to the guide (`toolsFor("guide")`), and
what it does is check the words and hand them back as an **offer** on the turn's `ToolRun`:

- `field` must be one of the two; `text` is normalised as the store would (`normaliseProfileText`)
  and must be non-empty and within the store's cap (`MAX_PURPOSE_CHARS` 600, `MAX_PROFILE_CHARS`
  1,500). Anything else returns a sentence telling the model what was wrong and carries no offer
  (rule 3 of the file: a tool that fails returns a sentence).
- The tool message back to the model: *the reader now sees these words with a button; nothing is
  saved unless they press it; do not say it is saved; WHO IS READING THIS on a later turn shows what
  is saved.*
- `ToolOutcome` and `ToolRun` gain an optional `offer: { field: "purpose" | "profile"; text }`.
  `converse` copies it from the outcome to the finished run, so it streams on the `tool` frame and
  is stored in the message's existing `tools` jsonb with the rest of the run (no migration; the
  column already holds whole `ToolRun`s). The model's `field` names are the reader's words
  (`reason`, `about_you`); the stored ones are ours (`purpose`, `profile`), mapped in the tool.
- **Not in Live.** `liveTools("guide")` keeps offering the article tools only, and
  `LIVE_SERVER_TOOLS` is `CHAT_TOOLS`' names, so the live tool route refuses it too. A spoken offer
  has nowhere to put its button; deferred with the spoken guide's other gaps (261009i § Deferred).

`GUIDE_TOOLS` stays the article tools (Live reads it); a new `GUIDE_TYPED_TOOLS` = those plus
`offer_to_save` is what `toolsFor("guide")` returns. Stable bytes, in the cached prefix like the
rest.

### 2. The prompt: when to offer, and how close to stay

`GUIDE_SYSTEM` gains a short section, **SAVING WHAT THEY TELL YOU**, replacing the sentence that
sends them to the profile page:

- When they say why they are reading this piece and it is not already their saved reason (or
  changes it), call `offer_to_save` with `field: "reason"`. When they tell you something about
  themselves that belongs in About you (their field, background, what they want from reading), call
  it with `field: "about_you"`.
- **Their words, not yours**: an exact quote of what they said, or a very close paraphrase that
  only tidies it into a sentence. You may add a few words of context so it reads on its own later,
  but stay close to their input. Never add claims they did not make.
- **About you is the whole text**: the offer replaces what is there, so start from the current
  About the reader exactly as written, keep every part of it they have not corrected, and add or
  change only what they told you.
- At most one offer per field per answer; do not offer the same words again; do not offer when
  nothing new was said. Never say it is saved: say in a few words that they can save it with the
  button under your answer. And then carry on guiding: the offer is a by-product, not the reply.

Measured before and after on a few hand-made turns (the 261007a guide eval if it still runs, else a
handful of real-model turns on a local article): does it offer on a reason, on a background, not on
"where do I start?", and are the words close to the reader's.

### 3. The card, under the answer, pressed

`GuideSaveOffer` (src/web/GuideSaveOffer.tsx), drawn by ChatPanel under each guide answer for each
finished run with an offer, after the answer's text:

- A heading in our words (*Why you're reading this one* / *About you*), the proposed words in the
  model's face (fonts.md: a model wrote them, however close to the reader's), and one button:
  **Save as why you're reading** / **Save to About you**.
- **The press**: read what is stored now (`GET /api/reader?slug=`, fresh, not the offline copy);
  if it cannot be read, say so and write nothing (the Undo needs the old value). If the stored value
  already equals the offer, say it is already saved. Otherwise write it, and show *Saved …* with an
  **Undo** that writes the value read before the press back (`null`/empty clears). One write in
  flight per card. A rejected write is checked against the server before it is called a failure
  (the `savePurpose` contract).
- **Undo** is offered while the card is mounted. It writes back only if what is stored is still what
  this press saved; if it has changed since (another tab, Metadata, a second offer), it says so and
  leaves it.
- Validated on the client too: a stored run whose `offer` is not that shape, or over the cap, draws
  no card.
- The card stays on reload, with its button: pressing an old offer is the reader's explicit act, and
  the already-saved check covers the common case.

**Keep this as why you're reading goes.** With the guide offering the reason from the reader's own
words, the button under their first message would offer the same save twice, side by side. Greg's
reply picked the guide doing it (1A + 1C) over what was built (1B). `GuideKeepReason`,
`keepableReason`, `Greeting.asksReason` and their tests go; the greeting's About you invitation
says they can tell the guide (and the profile page stays linked).

### What the reader's data is exposed to

The proposed words are model output, and the guide's prompt has the whole article in it, so a
planted instruction in an article could make the guide *offer* words of its choosing. The reader
sees every word before pressing, the button names the field, and Undo puts it back. That is the
existing rule ("anything that writes … is still a press"), applied to a new kind of proposal. No
write path is added on the server: the press uses the two routes the boxes already use.

## After the plan review (overrides the design above where they differ)

[GPT Sol](261009q-plan-review-sol.md): *build with changes*. Each finding checked here.

- **F1 (P1), Save and Undo can overwrite newer words.** Half taken. **Each offer now carries its
  basis**: the route reads the two fields once per guide turn (`resolveProfileParts`, the same
  read the prompt's WHO IS READING THIS comes from) and hands them to the tool as `saved`; the
  offer records what its field held (`SaveOffer.basis`), and the card saves only while the field
  still holds it. So an old card pressed after a later offer was saved, or after Metadata or the
  profile page changed it, saves nothing and says so; the tool also refuses to offer words already
  saved verbatim. The code review made the basis required: if this turn could not read the target
  field (including `useProfile: false`), the tool makes no offer, and a stored run without a basis
  draws no card. **Not taken: an atomic compare-and-set on the two `PATCH` routes.** What is left
  is the reader's own second tab writing in the milliseconds between the card's read and its write,
  the same residual 261009i's F3 accepted; closing it is a store contract change on two routes and
  two stores for a race only the reader can cause. Named, not fixed.
- **F2 (P2), the read is too coarse.** Taken: `storedReader` answers field by field, so a shelf
  that could not be read hides the reason only, not About you; the read is bound to the reader
  (`madeFor`); a write is trusted only when the reply's stored value equals what was sent; a
  rejected Save **or Undo** re-reads before it is called a failure.
- **F3 (P2), a listed defence.** The tool list (`toolsFor`) is where the gate looks, and adding a
  guide-only tool to it uses the gate rather than changing it; `runTool`'s check is untouched. The
  card is a second place model output becomes a write button, beside `chipFor`, so
  security-map.md's table should name it: a rule doc, so the row is proposed to Greg in the
  question file, not written here. Taken in code: a card is drawn only for a `done` run named
  `offer_to_save`, under a settled answer, in a guide, with a valid field, normalised text within
  the cap and a well-typed basis; plain text only. Tests for each refusal, and for a chat whose runs
  carry an offer.
- **F4 (P2), the prompt.** Taken: `YOUR TOOLS` no longer says every tool is the article's; the new
  section says only the reader's own messages may lead to an offer, never the article or a tool
  result; `reason` is about this piece and `about_you` about them whatever they read; About you
  that would not fit with what is kept gets no offer. "One per field per answer" is enforced on the
  page (the last offer per field is the one card). The scored matrix is § Log.
- **F5 (P2), exports carry About you words.** Taken as recommended: the card's run is kept whole in
  both exports (it is part of the conversation, like the reader's own messages), and the bundle's
  README says so beside "your reader profile and settings are not in here".
- **F6 (P3), Live.** Spoken runs are rebuilt from name, label and detail only
  (`parseSpokenTools`), so an offer cannot ride a spoken turn; `LIVE_SERVER_TOOLS` refuses the name
  (tested). live-conversation.md corrected.
- **F7 (P3), removing *Keep this*.** Agreed; its invariants (no write before the press, a double
  press writes once, a lost reply checked, the cap) moved to the card's tests, and the Help page's
  sentence about it is rewritten.

## The simpler options passed over

- **A `[cmd:save-reason:…]` chip token** through `chipFor`. Reuses the chip machinery, but the
  model would have to percent-encode a paragraph into a token (one slip and it draws as raw
  brackets), a chip has no room to show the full About you, and it is a new id on
  `CHAT_PROPOSABLE`, an edit to the chip defence. A tool takes JSON arguments and the card shows
  everything.
- **Keep *Keep this* and add the tool.** Two saves of the same sentence on the first exchange.
- **About you as an addition** (append-only). Cannot drop what the reader wrote, but cannot correct
  "I'm a postdoc" either, which is what Greg's "so it can update them" asks for. The full text is
  shown and Undo restores it.

## Code review

[GPT Sol](261009q-code-review-sol.md) on [the diff](261009q-code-review.diff): *land with fixes*.

- **P1, fixed by the reviewer**: an offer with no basis (the turn could not read that field, or the
  reader had turned the profile off for the turn) skipped the card's staleness check, so its press
  could overwrite whatever the fresh read found. `SaveOffer.basis` is now required: the tool makes
  no offer for a field it could not read, and a stored run without a well-formed basis draws no
  card. Tests on the tool, the route and the card. Checked here: right, and it removes the one path
  where the basis rule had an exception.
- **P2, left for Greg**: the security map's row for the card, proposed in q-w2740x.
- **P3, left as named**: the read-then-write race between two tabs of one reader (§ After the plan
  review, F1).
- Its sandbox could not reach Postgres, so the route test was run here afterwards: 11 files, 213
  passed.

### Second round

After the browser pass's written-twice answers were fixed (§ Log),
[GPT Sol](261009q-code-review-2-sol.md) on [that diff](261009q-code-review-2.diff): *land with
fixes*, both fixed by the reviewer and checked here. **P2**: the paragraph break between rounds had
gone into `roundText` too, so the round replayed to the model, and its character count, carried
bytes the model never wrote; now only the answer gets it, with a three-round test. **P2**: the
eval's written-twice check sampled every fifth offset and missed most repeats; it checks every
offset now, and the saved runs were rescored (9/14 before the fix, 0/14 after).

## For Greg (in the question file, not built)

- **Saving without a press** (1A's "the page saves it by itself"). Would need: an offer whose words
  are checked as a substring of the reader's own message (so a model cannot choose words the reader
  did not write), saved at once with Undo. That is the first exception to the press rule, so a
  defence edit: his.
- **The security map's row.** security-map.md lists `chipFor` as where model output becomes a press;
  the offer card is a second such place. A proposed row for him to approve.

## Stages

### Stage 0: plan review
- [x] GPT Sol, read-only.

### Stage 1: the tool
- [x] Tests red first: `toolsFor("guide")` has `offer_to_save`, `toolsFor("chat")` and
      `liveTools("guide")` do not; `runTool` returns an offer for valid input and none for a bad
      field, empty or over-cap text, and refuses it for a chat; `converse` puts the offer on the
      finished run.
- [x] `offer_to_save`, `GUIDE_TYPED_TOOLS`, `ToolRun.offer`, `describeCall`; the prompt section.

### Stage 2: the card
- [x] Tests red first (jsdom): the card draws for a valid offer and not for a bad one; press reads,
      saves, shows Undo; Undo restores; Undo refuses when changed since; read failure writes
      nothing; already saved.
- [x] `GuideSaveOffer`, ChatPanel wiring, styles; *Keep this* removed.

### Stage 3: measure, browser, review, land
- [x] Prompt check on real-model turns; Sonnet browser pass (desktop and phone); GPT Sol code
      review; docs (chat-tools.md, reader-profile.md); gates; push; question file and note.

## Log

- 2026-10-09: **measured**, [261009c](../investigations/261009c-the-guide-s-offers-to-save-measured.md):
  v1 10/12 (one answer pointed at a button it had not made), v2 18/18 after two prompt sentences,
  v3 14/14 after the tool-result sentence below.
- 2026-10-09: **seen in a browser**, Sonnet subagent, Playwright, 1440 and 390, the local *Attention
  Is All You Need*, two paid turns. Passed: no *Keep this* button; a reason card with the reader's
  words, nothing saved before the press, Metadata showing it after, Undo putting it back; an About
  you card that kept the old text and added the new, saved and undone with /profile exact; the card
  fits at 390 with no horizontal scroll; the card still there after a reload; no console errors.
  Shots: [offer](261009q-shot-1-offer.png), [saved](261009q-shot-2-saved.png),
  [undone](261009q-shot-3-undone.png), [phone](261009q-shot-4-phone.png),
  [About you saved](261009q-shot-5-about.png).
- 2026-10-09: **the browser pass found both answers written twice**, the model having written its
  reply, called the tool, and written it again; and the two copies glued without a space. Fixed in
  the tool's result and in `converse`'s joining of rounds; reproduced and measured 9/14 → 0/14 on
  that article. [Postmortem 261009j](../postmortems/261009j-an-answer-is-every-round-joined-so-words-before-a-tool-call-are-never-taken-back.md).
  A second, focused GPT Sol review of that change: § Code review, second round.
- 2026-10-09: **left as they are**, from the browser pass. After a reload, an offer already saved
  shows its button again (the saved state is the mount's); pressing it says *Already saved*. A card
  under a held answer can sit under the composer until the reader scrolls, as any long answer's end
  does.
- 2026-10-09: **fixed from the browser pass**: the card's buttons (`chat-suggest-btn`, the greeting's
  own) read as plain text, their `--rule` border being the card's colour; inside the card they now
  take `--rule-strong` and size to their words.
