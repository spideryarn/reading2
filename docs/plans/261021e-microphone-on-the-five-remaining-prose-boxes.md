# A microphone on the five remaining prose boxes, and the controls.md row

Report `spya-wc4vku` (`SPIDERYARN-READING2-MQ`), Overseer queue item `qi-d44n9rhc`. The deferred
half of plan [261020r](261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md)
§ Stage 5, and the answer to its question `q-ccv9qq`.

Greg's reply `spya-xd63nn`, 2026-10-20 21:43 UTC, to q-ccv9qq (*"Add a rule to controls.md that any
box for more than a few words of the reader's writing gets a microphone?"*):

> Yes, but keep it a minimal update. And just to be clear, we obviously don't want the URL to, for
> when importing an article from the homepage to have a voice button, because that wouldn't make
> sense. And not so we need a voice button for, like, the search bar on the homepage. So use your
> judgment a little bit.
>
> — Greg, 2026-10-20

## Stage 1 — the controls.md row (option A, with the exclusion)

One row in controls.md § Controls that do the same job look the same, nothing else:

| a control that… | the shared piece | tests |
|---|---|---|
| takes more than a few words of the reader's writing (not a URL, a search or a title) | a microphone: `DictationButton` and `DictationStrip` through `useDictationField`, [dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box) | [`prose-boxes-have-a-microphone`](../../tests/prose-boxes-have-a-microphone.test.ts) (every textarea, or its component listed with why) |

Greg approved option A's wording in this reply, with the URL/search clarification, so this is the
approved set ([edit-important-docs.md](../reusable/edit-important-docs.md)). Plus Greg's quote under
the existing ones in that section, because the rule is his.

## Stage 2 — the five boxes

Each per [dictation.md § Adding it to a box](../project/dictation.md#adding-it-to-a-box):
`useReaderTranscriber`, `useDictationField` with `context: { kind: "article", slug }`, a
`dictationReporter(<surface>)`, a `keepDictation(<name>)`, `readOnly` on the box, the button and the
strip; if the box sends, `onDone` and the double press, the send guarded on `dictate.busy` **and**
its button disabled. Per box, the judgment call:

1. **Skim's *What are you skimming for?*** (`SkimPurpose.tsx`). The same purpose the add page's
   box writes, and that box has a microphone, so this one must too. **Its textarea moves into a
   child component** (`PurposeAsk`): `PurposeLine` stays mounted when the box goes (Cancel, a save,
   a banner), and a hook in the parent would keep recording behind a box that is gone
   (dictation.md § a component that stays mounted). As a child, the unmount aborts. Its hooks also
   could not sit in `PurposeLine` anyway: it returns early before the box. `onDone: plan`, *Plan
   the route for this* disabled while busy, and *Cancel* too (the press would unmount mid-dictation;
   disabled is the honest refusal). Keeper `skim:purpose:<slug>`; surface `skim`.
2. **Referee's *What are you judging this paper against?*** (`CriteriaPanel.tsx#NewCriterion`). A
   question in a sentence, up to 500 characters. It is a form: the submit refuses while
   `dictate.busy`, Run is disabled, `onDone` submits. Keeper `referee:criterion:<slug>`; surface
   `referee`. The poles (`<input>`s) stay without: two or three words each.
3. **Candidates' scope box** (`CandidatesPanel.tsx#Composer`). Sends on Enter like chat. `onDone:
   send`, `send` refuses while busy, Ask disabled. Composer gets `slug` as a prop. Keeper
   `candidates:<slug>`; surface `candidates`.
4. **Rewriting a chat question** (`ChatPanel.tsx#EditQuestion`). The rewrite is a whole question,
   and the composer below it has the microphone, so this does too. `onDone: ask`, Enter and the
   tick refuse while busy, the tick disabled. It unmounts on Cancel/Esc, which aborts (the keeper
   offers the words back next time that question is rewritten). Keeper
   `chat:rewrite:<messageId>`; surface `chat`. **Known gap, not new:** a rewrite keeps the original
   question's `modality` (`withEdit` in src/chat.ts spreads the old row), so a typed question
   rewritten by voice stays `typed`, as a dictated one fixed by typing already stays `dictated`.
   Fixing it means a new field on the edit route and the store; out of scope, written into
   dictation.md where the composer's modality is described rather than left in this plan.
5. **A comment's note** (`CommentDialog.tsx#CommentBody`). The reader's own prose, the most
   obviously worth it of the five. It commits on blur and ⌘+Enter, and has no send. The hook's
   `onCommit` (end of a dictation) commits, so dictated words are saved when they land even if
   focus is on the button; `commit` reads the draft from a ref rather than the render's closure,
   since the hook calls it after the words land. Dictated changes call `onTyped` as typed ones do
   (a dictated note makes the fresh highlight non-pristine). Escape while busy: the box's first
   Escape restores the stored words; while the microphone is on, it does nothing to the words (the
   dictation owns them). Keeper `comment-note:<comment.id>`; surface `comment` (the follow-up box's,
   the same dialog).

New surfaces go in `DictationSurface` (`skim`, `referee`, `candidates`).

**Exemptions.** None of the five (but see Sol's review below: the chat rewrite was exempted after it). Greg's exemptions are URL and search boxes; none of these is
either. The criterion poles and the purpose line's tooltip are not textareas.

Then: delete the five `not yet` lines from the test's `WITHOUT`, and add the five to its
"finds the boxes it is about" list so a broken scan cannot pass them. dictation.md's box count goes
from thirteen to eighteen, naming them.

## After GPT Sol's plan review

[261021e-dictation-plan-review-sol.md](261021e-dictation-plan-review-sol.md), eight findings. What
changed:

- **Skim (F1, F8).** The hold the add page uses: `PurposeAsk` reports `busy` up to `PurposeLine` (a
  layout effect), and while it is busy a banner's arrival does not take the box away; *Plan* is
  refused under a banner as before. The microphone cannot start while a save or a route is in
  flight. The draft stays in `PurposeLine`, so it survives the box going once the words are final.
  The ratchet lists `SkimPurpose.tsx#PurposeAsk` in its inventory.
- **Comment note (F2, F3).** Blur does not commit while `dictate.busy`: Stop moves the focus, and a
  blur-commit then would PATCH Chromium's rough words and race the transcript's own commit. The
  hook's `onCommit` saves once the words land. A draft ref is updated by both paths. Escape while
  busy is contained (`stopPropagation`) and neither restores nor closes. **Not taken: refusing the
  dialog's close, ‹ › and delete while busy.** Those unmount the box, which aborts the
  dictation; the rough words are not saved (blur is skipped while busy) and the keeper offers the
  recording back the next time that comment's note is opened. Saving the rough words as well would
  put them beside the recovered transcript. Dictated changes call `onTyped`.
- **Referee (F4).** The starter buttons refuse while busy (they replace `text`); Run keeps its
  `aria-disabled` design, extended by `busy`, rather than a native `disabled`.
- **Chat rewrite (F5, F6): exempted instead.** Sol is right that it needs a keeper key stable
  across the client-to-server id swap and a modality carried through the edit route and
  `withEdit`, or it stores false provenance. That is a server change and a second keeper scheme for
  a box whose usual job is a small fix to words already there, with the composer's microphone one
  box below. Listed in the ratchet with that reason; it is a judgment Greg can reverse.
- **Tests (F7).** Each sending box is pressed while `armed` and while `transcribing`, by Enter
  where it has one and by its button.

## Tests

Per box, one test in the style of `tests/dictation-field-busy.test.tsx` / the existing box tests:
the send refuses while armed (the box sends), or the note commits when a transcript lands (the
comment note). The ratchet test is the inventory check.

## The simpler option passed over

**Exempt the rewrite box and the Skim box** — a rewrite is usually a typo fix, and Skim's box is
two rows. Passed over: both take a whole sentence, the Skim one is the same field the add page
dictates into, and Greg's rule is "more than a few words", which both are.

## After GPT Sol's code review

[261021e-dictation-code-review-sol.md](261021e-dictation-code-review-sol.md). Sol fixed two in
place: Skim's hold now claims at the press (and at a kept recording's Retry), as the add page's
`useBusyDictation` does, since a press and a banner can share one render; and Referee's and
Candidates' microphones are not drawn where the browser cannot record. **Its third, pre-existing
in the shared hook, is queued as `qi-qxkryezr`** (a proposal for Greg): after a failed Chromium
transcription, Retry puts the transcript beside the rough live words rather than over them, and a
box that commits on blur can save both.

The full suite's other reds on this run (`admin-store`, `seed-admin-signin`: a column missing from
the shared local database) touch no file of this change.
