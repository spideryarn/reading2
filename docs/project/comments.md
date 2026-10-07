# Comments — the reader's mark on a passage

Up: [reading-view-overview.md](reading-view-overview.md)

Select a sentence and it is **yours**: bookmarked, with a note on it if you want one, and an
answer from the model only if you ask for one. Saving costs nothing.

> **Reopened, and turned around, 2026-08-28.** For three days this file described a feature that was
> closed: selecting a sentence bought an explanation until 2026-08-26, then opened a chat, and there
> was no way to make a new comment at all. Greg:
>
> *"someone might want to simply add bookmarks or comments to the text, without wanting an AI
> response … you can select some text, and that bookmarks it. You can optionally add a comment. And
> you can request (when you do so) whether you want an AI response (in which case it kicks off a
> Chat)."*
>
> So a comment is now the **free** thing and the model is a tick-box.
> [260828a-comments-and-bookmarks.md](../plans/260828a-comments-and-bookmarks.md) is the plan, and its GPT Sol
> review is beside it.
>
> **The tick-box became a button on 2026-10-03**, and the box stopped losing drafts. **Since
> 2026-10-04 a selection is highlighted the moment it is made**, and the box that opens is the
> comment's own — [§ The box a selection opens](#the-selection-box).
>
> **Read the rest of this file with that in mind.** Everything it says about *anchoring*,
> *streaming*, *reading order*, `?note=` and the failure modes is unchanged and still true. What
> has changed is what a selection creates, and what a comment is allowed to hold.

## What a comment is now

Three independent properties, and a comment may have any combination of them:

```
   the mark      always. blockId + quote + start, onto the permanent id spine.
   the words     optional — `body`. Nothing written is a bare bookmark.
   the answer    only on one made before 2026-08-28, or on a chat it started.
   the placement optional — `criterionId` + `valence`, and only in Referee mode.
```

### The box a selection opens <a id="the-selection-box"></a>

> how about if selecting text automatically applies the highlight and also pops up the fuller box to
> allow the user to customise (or remove) it, and they can just click off if they're happy with the
> highlighting
>
> — Greg, 2026-10-04

**Selecting words writes a yellow highlight and opens that comment's own box.** Outside Referee
mode there is no draft any more: letting go of the drag stores a comment with `colour: "yellow"`
(one `POST`), the words are painted as the ordinary mark of an ordinary row, and the box beside them
is [`CommentDialog`](../../src/web/CommentDialog.tsx), the one a click on any highlight opens. It
is the gutter bookmark's pattern ([§ The whole-block bookmark](#the-whole-block-bookmark): create,
then open the box on the row) applied to words. `selectProse` in
[`Reader.tsx`](../../src/web/reader/Reader.tsx).

```
   select ──► words go yellow, box opens
                │
                ├─ click away / × / Esc / select elsewhere / leave ──► kept
                ├─ write, pick a colour, Ask the AI                 ──► kept, as changed
                ├─ Remove highlight                                 ──► gone
                ├─ Copy, don't highlight / ⌘C                       ──► copied, not kept
                └─ re-select overlapping words (untouched)          ──► replaced by the new one
```

The yellow is Greg's default from the day before:

> I like the new human highlights when I select text - can we default to the yellow colour, and
> default to saving it, so that it requires fewer clicks?
>
> — Greg, 2026-10-03 (spya-ur8kum)

**The fresh box.** A box is *fresh* while it is the one the selection opened on the comment it
made. It stops being fresh when it closes or shows another comment, so the same comment opened
later from its mark, the drawer or a link is an ordinary box. Only a fresh box has these
(`FreshBox` in `CommentDialog.tsx`):

- **A press anywhere else closes it, and the highlight stays.** The press is never swallowed: a link
  still follows, a Dock button still opens, and a drag that begins in the prose becomes the next
  selection. "Inside" means the box and anything it portals (a tooltip is at the end of `<body>`),
  decided by React's own event path through the portal and not by `contains`. Words typed and not
  yet committed are committed before the box goes. A click on the words just highlighted is a click
  away too: it does not open the box straight back up, and it does not make a second highlight
  (its `mouseup` finds those words still selected).
- **It closes when the press ends, not when it begins.** The `pointerdown` outside is only
  recorded. A mouse's box closes at `mouseup`, after `TableView` has read the selection that press
  made; a finger's or a pen's at `pointerup`; either at `pointercancel`. It closed at `pointerdown`
  until a check in real Chrome on 2026-10-04: closing takes the open ring off the mark, which
  rewrites that paragraph through `innerHTML` between `pointerdown` and `mousedown`, so a drag
  begun in the highlight's own paragraph was anchored on nodes no longer in the document and
  selected nothing. The rule that follows: **nothing that re-renders the prose may happen while the
  button is down.** The close is also conditional. If the same press made a new highlight or
  landed on another mark, that comment's box is now open and is left alone. And a mouse press
  whose release never reaches the window closes nothing: the box stays open and fresh, and the
  next press is judged on its own.
- **Delete reads *Remove highlight***, still one press, and closes the box instead of stepping to a
  neighbour.
- **A hint**: *Highlighted. Click away to keep it.*
- **Copy** ([§ Copying the passage](#copying-the-passage)).

**Pristine** is the word for a row that is still exactly what the selection wrote: yellow, no
words, no conversation, no answer, no placement (`isPristineHighlight` in
[`fresh-highlight.ts`](../../src/web/fresh-highlight.ts)). Only a pristine row is ever taken away
without being asked for by name. A colour press and an edit reach the stored row only when the
server answers, so the box and `Reader` also keep a *touched* flag set at the press.

**Overlap means correction.** A reader who drags again over some of the same words straight away
is fixing which words, not asking for two highlights. The fresh row is remembered for the one
gesture that closes its box (set by that `pointerdown`, cleared when the gesture ends and again by
the next `pointerdown`), and a selection that
gesture goes on to make, in the same paragraph and sharing at least one character, removes the
first if it is still pristine. Then the new one is created as usual. A mouse only: by touch the
second selection is a new long-press, and both are kept.

**The first seconds of a page.** A create made before the comment list has loaded waits for it
inside `useComments.create`
([260908c](../postmortems/260908c-an-opening-read-can-erase-a-later-write.md)), so in that window
nothing is painted and the box opens when the row exists, a moment after the selection. It then
opens only if nothing else was opened meanwhile and no later selection was made (`bookmarkBlock`'s
two guards); the highlight is stored and painted either way.

**A create that fails removes its row**, and with it the paint and the box, and the Dock says the
write failed. Nothing is shown as highlighted that is not stored or being stored.

**The browser's own selection.** A mouse's is kept: painting replaces the paragraph's nodes, which
collapses a selection, so it is put back over the new mark (`selectAnchor` in
[`selection.ts`](../../src/web/selection.ts)) and ⌘C still copies the words. A finger's is cleared
at the button press, which puts the OS handles and callout away
([touch.md § A finger's selection gets a button](touch.md#a-fingers-selection-gets-a-button)).
Two smaller rules in `TableView.tsx` follow from the paint arriving between `mouseup` and `click`:
the click that ends a drag does not follow the link under it, and a `mouseup` that finds the same
words still selected (a press on a gutter icon) is not a second selection.

**What a reload or a crash can lose.** A highlight is stored by an ordinary request the moment it
is made, so the window is the time that request takes. It is widest in the first seconds of a page,
when a create waits behind the opening read of the comment list: leave or reload then, before the
paint has appeared, and that highlight is not stored. Once the paint is on the words the request has
been sent, and once it has been answered nothing here can lose it. **A resend on `pagehide` was
built for this and taken out again** on 2026-10-04: it was a second `POST` outside the hook's write
queue, and three review rounds each found a new way for it to race a delete
([261004f](../plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md)
§ Landed). The window it guarded is seconds wide; the code it needed was not.
[§ Deliberate limits](#deliberate-limits).

The plan is [261004f](../plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md),
whose last section is the design as built: GPT Sol's review showed that *painted now, stored later*
cost a provisional mark, an unmount flush and a pending handoff, and that writing the row at once
cost a create and a delete for a mis-drag. The tests are
[`tests/selecting-applies-the-highlight.test.tsx`](../../tests/selecting-applies-the-highlight.test.tsx).

#### In Referee mode: the draft box <a id="the-draft-box"></a>

**Referee mode keeps the box as it was before 2026-10-04**, and it is now the only place
[`AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx) opens. A selection there records evidence
against a criterion; a reading highlight nobody picked would mix two meanings, and the placement is
part of the one save ([§ The referee's own placement](#the-referees-own-placement)). Nothing is
stored until the referee says. Whether Referee should follow the rest of the app is a separate
question, not decided.

The quote, a Copy button, a place to write, a colour row that opens on *No colour*, the placement,
and three buttons:

```
   Discard                                  [ Ask AI ]  [ Save ]
```

- **Save** stores the comment. It is the only submit button, so ⌘/Ctrl+Enter is the free Save and
  plain Enter is a newline.
- **Ask AI** stores it and then opens a chat on those words and sends what was written as its
  first question ([§ Asking the model](#asking-the-model-and-the-link-back)); with nothing written
  it asks *Explain this passage.* Until 2026-10-06 it pre-filled the composer and waited for Send
  ([261006j](../plans/261006j-ask-in-chat-sends-the-question.md), D6).
- **Discard** throws the draft away.

Two questions decide what an exit stores (`hasSomething` and `hasIntent` in `AnnotateDialog.tsx`):

```
   something to store   words, a colour, or a placement
   the reader's intent  words, a placement, or the colour row CHANGED

   Save, Ask AI         always store what the box shows
   the ×, Escape        something to store — unless Copy was pressed and there is no intent
   another selection,
   unmount, pagehide    something to store AND intent
   Discard              nothing
```

In Referee mode an untouched box has nothing to store, so every exit from one keeps nothing. (The
box still has its 2026-10-04 behaviour of opening on Yellow and saving it on × or Escape when it is
mounted outside Referee mode, which today only tests do.)

**Ask AI was a tick-box until 2026-10-03**, and the box kept everything as a draft until its one
button was pressed. Greg:

> I highlighted a word I didn't understand and clicked highlight or comment, and then I ticked the
> save and ask AI, and then clicked something else, and I don't know what happened, but it
> disappeared. So maybe save and ask AI should be a button, or I think it should auto-save, and so
> then ask AI would be a button. And it's just generally a bit confusing.
>
> — Greg, 2026-10-03 (spya-pnnamg)

A ticked box looks like an action taken, and it was not one. And five things threw the draft away
without a word: Cancel, the ×, Escape, another selection in the prose, and leaving the page.

**The rule for the draft box: no way out silently discards a draft.** A draft *the reader did
something to* — words, a changed colour, or a Referee placement — is stored as a comment, exactly
as Save would store it and never asking the AI, by each of:

| The way out | What stores it |
|---|---|
| the ×, and the box's Escape | the box, before it closes |
| another selection in the prose | the old box unmounting — the box is keyed on its passage, so each one owns one anchor, one draft id and one latch, and the draft is stored against the passage it was written about |
| leaving the article inside the app | the same unmount |
| a reload, a closed tab, a link out | a `pagehide` listener starts the best-effort keepalive write (`leavingFetch`); if the page returns from the back/forward cache, `pageshow` replays that frozen snapshot through ordinary `create` so the tab learns about it, then closes the old box |

The textarea's own first Escape still clears what was typed — that is the reader removing their
words, not the box losing them.

Three things follow from storing on the way out, and the last two hold for every create:

- **A draft stored mid-dictation is stored as the box stands.** Save refuses while the microphone is
  armed because better words are about to arrive; at an exit nothing better will, so the words the
  reader could see are kept ([dictation.md § Adding it to a box](dictation.md#adding-it-to-a-box)).
- **A create made before the comment list has loaded waits for it**, inside `useComments.create`.
  The Save button already waited ([260908c](../postmortems/260908c-an-opening-read-can-erase-a-later-write.md));
  a box that is going away has no button to wait at, so the order is kept one layer down as well.
- **A create is the first write in that comment's queue.** An edit waits behind it, and a delete
  made while the create is still held cancels it; once its POST is in flight, the delete waits for
  the answer and removes the row afterwards. Neither operation can reach the server before the row
  it names exists. This is what makes *Remove highlight* and the overlap rule above safe to press
  the instant the highlight appears.

What this does **not** promise is under [§ Deliberate limits](#deliberate-limits). The plans are
[261003i](../plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md) and
[261004a](../plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md);
the tests are [`tests/annotate-dialog-keeps-a-draft.test.tsx`](../../tests/annotate-dialog-keeps-a-draft.test.tsx)
and [`tests/use-comments-create-waits-for-the-opening-read.test.ts`](../../tests/use-comments-create-waits-for-the-opening-read.test.ts).

### The whole-block bookmark <a id="the-whole-block-bookmark"></a>

**Since 2026-09-12 the mark can be the whole paragraph, with no quote at all.** The gutter has a
bookmark button beside every unmarked paragraph, and one press stores a comment with `blockId` and
nothing else. Greg, on an iPad:

> The issue is I thought we were going to add a sort of bookmark icon as well, sort of a fourth one,
> so you could just say, that would just somehow, yeah, bookmark that block as being really
> interesting. I thought maybe it was going to be represented as an empty comment […]
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-37)

It **draws nothing in the prose**, and that is the point rather than a gap: storing the whole
paragraph as the quote would underline every word of it and make every tap inside it open the note,
which on an iPad is how a reader selects the block. The gutter mark is the whole of it, exactly as a
whole-block conversation is only its gutter chip — `CommentAnchor` in
[`src/types.ts`](../../src/types.ts) is `ChatAnchor`'s two arms again, with the block arm made strict
(`quote?: never; start?: never`) so half an anchor is not a value.

Four rules hold it, and each is written where it bites:

- **Both or neither**, in the route (`createFree`) and in the database (`comments_anchor_pair`).
- **Only ever a bookmark**: `comments_whole_block_is_free` keeps a quote-less row at `status: none`,
  so the legacy answer path, its sweep and `linkThread` — all of which read the quote — cannot reach
  one. `linkThread` stays selection-only on purpose.
- **Offered only once the opening read has landed without error** — before it, every paragraph
  looks unmarked, so a press could be erased by the list arriving or duplicate a note nobody had
  fetched. `bookmarkBlock` in [`reader/Reader.tsx`](../../src/web/reader/Reader.tsx).
- **Sent only to a client that asks** (`GET …?anchors=whole-block`): a tab still running code from
  before that day reads `c.quote.length` and would lose its reading view. Delete the filter once no
  client can be that old.

The dialog and the drawer show *Whole paragraph —* and the paragraph's opening words (`passageOf` in
[`comment-nav.ts`](../../src/web/comment-nav.ts)); it sorts first in its block. Un-bookmarking is
pressing the mark and deleting, as for any comment.
[260912c](../plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md).

**Since 2026-10-02 the press also opens the comment box on it**, once the store has confirmed the
bookmark. Greg, SPIDERYARN-READING2-9C:

> If I bookmark a block using the icon in the gutter, it should be a bit more visible.
>
> And it should be possible to comment on a block without wanting an AI-chat-response. Enable that
> and make a small UI tweak that will make that clear to the user.
>
> — Greg, 2026-10-01

It was possible — press the mark afterwards and type — and nobody found it. Now the dialog is the
invitation: its box says *"It's yours: the AI doesn't reply"*, the follow-up box under it says *"Ask
the AI about this…"*, and the gutter's chat button says *Chat with the AI*. Closing the dialog
leaves a bare bookmark, so one press still bookmarks. The mark itself is drawn **filled** and at full
strength, the one filled glyph in the column.
[261002j](../plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md).

`status` says **how the model call went, and nothing else**. Every comment made from 2026-08-28
carries `none`: no call was ever attempted. That is also what keeps a bookmark invisible to
`sweepOrphaned`, which turns an abandoned `pending` row into an error — a bookmark is not an answer
that never arrived, and the sweep needed no change at all to leave it alone.

### The referee's own placement <a id="the-referees-own-placement"></a>

**A comment with a `criterionId` is a review comment; one without is a reading note.** That is the
whole distinction, and it falls out of the data rather than being a switch nothing keeps in step.
The referee's mark on a passage *is* a comment, because a comment is already words anchored to a
passage with an id spine, an API and an export under it —
[referee-mode.md § the referee's own mark](referee-mode.md#the-referees-own-mark).

`valence` is their own placement on that criterion's scale: **−100…+100, signed, integer**, and `0`
is a real answer meaning "counts neither way". It is optional on top of `criterionId` — writing a
sentence about a criterion without scoring it is the ordinary case — and `criterionId` is required
under it, because a number with nothing to place it on is a number against nothing.

**Where a referee actually makes one**: the comment box a prose selection opens, in Referee mode
only. It grows a *"Place on a criterion"* section — the criteria with two ends, and five labelled
positions in that criterion's own pole words — and `CommentDialog` shows and changes the placement on
a comment that already exists. Placing stays optional and saving without one is still a single press.
[`src/web/PlaceOnCriterion.tsx`](../../src/web/PlaceOnCriterion.tsx) and
[referee-mode.md § the referee's own mark](referee-mode.md#the-referees-own-mark).

**Changing the criterion clears the number.** A position is not a quantity — it is one of five
labels, and *"leans underpowered"* exists only because that criterion has those two ends. Carried
onto a criterion whose ends say something else, the same −50 records a judgement the referee never
made, about poles they never saw. So the new criterion arrives unplaced and they are asked again in
its own words, which is the ordinary `{ criterionId, valence: null }` state below.

Two rules the route holds, both in `tidyMark` ([`src/routes.ts`](../../src/routes.ts)):

- **A criterion that is not yours is refused, not stored.** `criterionId` comes off a request, so on
  its own it names any string; it is checked against `refereeCriteriaStore.load(slug)`, which is
  scoped to the article *and* the requesting owner.
- **An out-of-range valence is a 400, never a clamp.** This is the one rule the feature exists for.
  `SearchHit.confidence` is a 0–100 match strength whose validator clamps negatives to zero, so a
  placement that travelled anything confidence-shaped arrives as `0` — *"no strong feeling"* — with
  nothing erroring and the referee shown the opposite of what they said. So valence has its own
  clamp (`clampValence`) and its own validator (`markProblem`), both in
  [`src/referee-criteria.ts`](../../src/referee-criteria.ts), and the route uses neither of the
  confidence ones. `tests/comment-referee-mark.test.ts` puts a −80 in through the real route and
  reads it back off the store.

**Changing a placement is `PATCH /api/comments/:slug/:id/mark`**, which arrived on 2026-09-01 as the
fifth operation. A second `create` under a stored id carrying a different valence is still a 409,
exactly as a changed body is: a re-score is not a retry, and letting `create` mean both would
silently overwrite a judgement the referee already made. So the edit is named, like the other four.

The request carries **both fields, always** — `{ criterionId, valence }`, each a value or `null` —
and a body naming only one is a 400. Both `null` clears the placement back to a plain reading note,
leaving the words and the passage alone. It is a path of its own rather than two more fields on
`PATCH /api/comments/:slug/:id`, because a patch route carrying more than one thing has to decide
what an absent key means, and *leave it alone* is one missing branch away from *clear it*: a
judgement destroyed by a request that never mentioned it, with a 200 in the answer and nothing in
the log. A named path cannot express the ambiguity. It goes through the **same `tidyMark`** the
create path uses, so there is one definition of what a placement is and not a second that can drift.

### The five operations, and why there are five

There used to be one writer, `create`, which meant both *make this* and *redo this*. That was safe
only while making one cost a model call, so a colliding id could only ever be a retry. **Once a
comment is free, a collision is an ordinary event** — and a reset would silently overwrite the
anchor and blank the answer of a comment made in another tab. GPT Sol found this reviewing the
plan; it is the reason the store contract now names who may write what.

| operation | writes | refuses |
|---|---|---|
| `create` | the anchor, `body`, the placement, `status: "none"` | a stored id whose anchor, body **or placement** differs — **409**, never an overwrite |
| `beginAnswer` | the answer fields — plus, in Postgres, an attempt id and a lease | a bookmark, and a `pending` row whose attempt is **still live** — one answer at a time |
| `patchBody` | `body`, `updatedAt` | a request with **no `body` key at all** — 400, because absent could mean *clear it* or *leave it* |
| `patchMark` | `criterionId`, `valence`, `updatedAt` | a half-named placement, and everything `tidyMark` refuses on the create path |
| `linkThread` | `threadId`, once, from absent | a second conversation, a comment that is not free, or one about a different passage |

Two more times are stored and shown nowhere ([sql.md § Store when it happened](sql.md#store-when-it-happened)):
`patchColour` stamps `colour_at` — never `updatedAt`, which means the words were edited — and the end
of an answer, by `patch` or by the sweep, stamps `finished_at`, which `beginAnswer` nulls again.

`patchBody` refusing an absent key is a fix rather than a rule that was always there. Until
2026-09-01 the route read `{ body }` off whatever arrived, `tidyBody(undefined)` is `null`, and the
store writes `body` unconditionally — so `PATCH {}` answered **200 and deleted the reader's words**,
with nothing erroring. It was latent only because one caller exists and it always sends the key.
`{ body: null }` is still a reader clearing their words back to a bare bookmark, and is still a 200.

`beginAnswer` takes an id and *nothing else*: it reads the stored passage rather than accepting one,
so a retry cannot quietly move a comment to different words. **It claims a terminal row, or an
abandoned attempt**, and both halves are load-bearing. The first version excluded only bookmarks,
which meant a row already `pending` passed the check, so two presses of *Try again* both succeeded
and bought two model calls. The version after that refused every `pending` row, which left the
opposite bug: only the sweep could heal an abandoned one, the sweep runs only on the comments `GET`,
and *Try again* posts straight at the answer endpoint — so a reader whose answering machine died got
a 409 from every press until they reloaded the page, and an open tab never did. Now the claim itself
takes a `pending` row whose lease has run out, in the same statement that refuses one whose lease is
live. GPT Sol, 2026-09-01.

**The claim hands back an attempt token, and the terminal write has to carry it.** A comment keeps
its id across a retry — that is what makes it the same question — so identity alone cannot say which
model call is reporting. Without the token, an attempt that stalled, had its row swept by another
machine and then woke up would overwrite the retry the reader was watching arrive; with it, that
write matches no row and `patch` answers `undefined`, which means *you were superseded* rather than
*something failed*. `pgSearchStore.finish` made the same decision in August, and the two now read
alike. The filesystem store had no token and needed none — one process, so `begun` in
`src/comments.ts` could say whether an attempt was live without a clock. That half was deleted on
2026-09-05; Postgres, and the token, are now the only way.

The legacy answer patch is `AnswerPatch`, six fields wide, not `Partial<Comment>`. A generic patch
was what let the one remaining writer reach the anchor and the reader's words.

### Asking the model, and the link back

Pressing **Ask AI** (a tick-box, *Also ask the AI about it*, until 2026-10-03) saves the comment
*first* — free, and saved — and then opens the anchored chat that [260826ab-chat-as-gateway.md](../plans/260826ab-chat-as-gateway.md) built and sends
whatever was written as its first question. If the chat call fails, the reader still has their words.

The link between the two is written **on the server**, from inside the chat stream, because that is
the only place a real thread id exists: the browser mints an optimistic one and only hears about an
overrule when there is one, so a link written in the client is a race it cannot see it has lost.
The chat request carries `sourceCommentId`; the route calls `linkThread` once the thread is real,
**with the passage** — because that id comes off a request and on its own names any comment this
reader owns on this article, so a stale one from another tab would attach the conversation to an
unrelated mark. The browser then patches its own copy locally (`noteThread`), so the mark and the
dialog are right before the next reload rather than after it.

`threadId` is **advisory and has no foreign key**, which reverses the reflex this schema follows
everywhere else. A deleted conversation leaves a comment that is still the reader's mark, so
whoever offers "Open the conversation this started" checks the summary list rather than trusting
the stored id. The full reasoning — including that this is a constraint Postgres can keep and the
now-deleted filesystem store never could — is in the plan.

### A click on a doubly-marked passage opens the comment

A comment made with *Ask AI* (*Save & ask*, until 2026-10-03) has a `cmt` mark and a `chat` mark over identical words.
`annotateHtml` merges them into one `<mark class="cmt chat">`, and until 2026-08-28 chat won the
click. That rule was right when comments were closed and an overlap was always an older
explanation under a living conversation — but **every Ask AI now creates the overlap on
purpose**, so it would hide the reader's own note behind the chat it started, every time.

So the comment wins when the comment's `threadId` names that chat. An overlap with an *unrelated*
conversation keeps the old preference. See `MarkKind` in [`annotate.ts`](../../src/web/annotate.ts).

## Intent

Greg, 2026-08-25:

> If I use the mouse to select some text in the VERBATIM-TEXT column, it should:
>
> - Create a persistent UI artifact in the doc for that selection, indicating that there is an
>   explanatory comment there
> - Add an element in the new rightmost column, initially showing a loading spinner
> - Call an LLM with a prompt to try and explain what that sentence means (given the whole text of
>   the article, and after doing some web research)
> - Fill in the rightmost column entry when we have a response from the LLM.

Three of the four decisions below were settled by him the same day; the fourth reversed the "new
rightmost column" in that brief.

### Decision: a dialog, not a column <a id="decision-a-dialog-not-a-column"></a>

Asked whether a fourth column would complicate the UI:

> Perhaps we shouldn't add it as a column of its own. I don't know. Will it complicate the UI
> substantially, do you think? Perhaps for now let's have them show up as a dialog box to avoid
> screwing up the existing UI, until we come up with a better plan.

It would have. A real column has to enter [`layout.ts`](../../src/web/layout.ts)'s shrink-then-drop
arithmetic ([granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)),
take `pin-right` off the prose, and thread through the `rowSpan` geometry in
[`TableView.tsx`](../../src/web/TableView.tsx) — and a comment belongs to a *span of a paragraph*,
not to a row, so a table cell is the wrong shape for it anyway. The dialog
([`CommentDialog.tsx`](../../src/web/CommentDialog.tsx)) touches none of that: **nothing in
`fitView` changed for this feature.**

The cost is that only one answer is visible at a time, and there is no way to see every comment on
the article at once. Marginal cards or a column remain the better long-term answer — this is
explicitly "until we come up with a better plan".

### Copying the passage <a id="copying-the-passage"></a>

**A selection is not always the start of a comment — sometimes the reader just wanted the sentence.**
Greg, 2026-09-05:

> When I select some text in the article to copy it to the clipboard, it automatically pops up the
> Comment panel, so then I would have to reselect it in the Comment panel to be able to then copy it.

Opening the box takes the focus and the selection with it, so the one thing a selection most often
means outside this app had become the one thing it could no longer do. And since 2026-10-04 a
selection is also a highlight, so a reader who selected in order to copy is left with a mark they
did not ask for. **Copy means copy**, in two places:

- **The fresh box has a Copy button** ([§ The box a selection opens](#the-selection-box)). While the
  row is pristine it reads *Copy, don't highlight*: it puts the quote on the clipboard and then
  removes the row and closes the box. **The removal follows the clipboard's real answer, never the
  press** (GPT Sol, E7 on plan 261004f): on a refusal, or with no clipboard at all, the box says
  *Your browser would not allow the copy. The highlight is kept.* and the row stays. Once the reader
  has written, recoloured, placed or asked, the button reads *Copy* and only copies.
- **A native copy does the same.** ⌘C while the box is fresh, the row pristine and the document's
  selection still that passage removes the highlight too. The copy itself is not touched, and the
  removal waits until the event is over, because repainting the paragraph would collapse the
  selection the browser is about to read.

**The draft box (Referee mode) has the older button**, in its header beside Close. It puts
`anchor.quote` on the clipboard: the reader's own words, with no id and no attribution attached.
The block's citable address is a different thing and already has its own button in the gutter
([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx)). It copies and does nothing else: it does not
save, does not close, and buys nothing. There the *press* is what counts, not the clipboard's
answer: the × or Escape after Copy, with nothing else done, stores nothing
([§ In Referee mode: the draft box](#the-draft-box)).

Three states rather than two in both, because a copy that quietly failed is
[silent-success](../reusable/silent-success.md) with a clipboard on it, and `navigator.clipboard` is
undefined in every insecure context.

**The interesting failures are all the same one, and none of them shows in a screenshot: the button
saying something true about a copy that is no longer the copy in front of the reader.** `App` kept
one `AnnotateDialog` mounted and swapped its `anchor`, so a tick from passage A sat there over passage
B's words with A still on the clipboard; a write still in flight when the reader moved on reported
success over the new passage; and of two presses the *older* outcome landed last and reported failure
over a clipboard holding exactly what was asked for. The fixes are a `key` on the anchor (the button's own
until 2026-10-03, the whole box's since — [§ The box a selection opens](#the-selection-box)) in
[`AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx), and a press token, which since 2026-10-04
is [`useCopy`](../../src/web/useCopy.ts)'s. Each has a test that was red first. GPT Sol found all
three reviewing the built code, 2026-09-05.
[`tests/annotate-dialog-copy.test.tsx`](../../tests/annotate-dialog-copy.test.tsx).

**Every copy button in the client goes through one hook since 2026-10-04**:
[`src/web/useCopy.ts`](../../src/web/useCopy.ts) owns the guard for a browser with no clipboard, the
three-state outcome, the press token and the timer, and each caller keeps its own glyphs, words and
announcement. Until then there were eight hand-written copies and they had drifted: the token had
reached two of them. GPT Sol recommended the hook on 2026-09-05; the plan is
[261004e](../plans/261004e-fifth-sweep-cluster-20-one-copy-hook-for-the-nine-clipboard-writers.md),
and [`tests/use-copy.test.tsx`](../../tests/use-copy.test.tsx) fails if a ninth file reaches for the
clipboard itself.

### The two questions a selection raises <a id="the-two-questions"></a>

**A selection is ambiguous about what is being asked, and for a long time the prompt only heard one
reading of it.** Greg, 2026-08-26, having selected the name *Ben Miller* in the acknowledgements line
of *Writes and Write-Nots* and been told that it is an acknowledgements line:

> I asked for more context on this person, Ben Miller, and I basically got an immediate response
> like, oh, it's a person that's been acknowledged. Like, yeah, I get that. But I mean, it'd be much
> more interesting if you'd done some web searching to try and figure out who Ben Miller is.

The model did not decline to search. It was never asked a question whose answer it lacked: it was
sure what an acknowledgements line is, and it was right. So the encouragement below could not fire,
and turning it up would have changed nothing.

The fix came from [glossary.md](glossary.md), which had solved this on *the same article* — an entry
there says two things, not one:

- **what the author means here**, from the article and only the article;
- **what the reader has to bring to it** — who this person is, what this work is — from the model's
  own knowledge, labelled as such.

Explain had the first half only, so it gave the first kind of answer to a question of the second
kind. [`src/glossary.ts`](../../src/glossary.ts)'s own worked example names the failure, and
[`src/explain.ts`](../../src/explain.ts) now borrows the sentence: **that describes the page the
reader is looking at, and it is the whole failure.**

Three rules carry it:

- **A short selection is almost always the second question.** "Somebody who selects two words is not
  asking what the sentence around them does. They are asking who or what that is."
- **The search trigger is about the selection, not the model's confidence** — because confidence was
  the thing that failed. A named person it cannot place *with at least one concrete, checkable fact*
  means search. "A category is not a fact."
- **Outside knowledge is labelled in the sentence** — "Although the article doesn't say so…", "As
  you may know…". Borrowed outright from
  [original-version/glossary.md](original-version/glossary.md#the-prompt-which-is-the-best-written-one-over-there),
  which had recommended it for this exact file and never had it moved across.

> [!NOTE]
> **Measured, not assumed.** Selecting `Ben Miller` went from 0 searches and a description of the
> line, to one search and *"Ben Miller, by contrast, isn't a public figure in the same way"*.
> Selecting `Robert Morris` in the same sentence runs **no** searches and still answers properly —
> which is the result that says this is a fix rather than a bigger hammer. Full before/after in
> [260826l-explain-deeper-answers.md](../plans/260826l-explain-deeper-answers.md#measured-not-assumed).

### Decision: the model decides whether to search <a id="decision-web-research"></a>

Asked how much web research the explain call should do:

> Only when the model asks for it, but encourage the model to ask for it unless it's very sure

That is OpenRouter's **server tool** — `tools: [{ type: "openrouter:web_search" }]` — which hands
the model a search tool and lets it choose. The encouragement is a paragraph of the system prompt in
[`src/explain.ts`](../../src/explain.ts); the choice stays with the model.

The count reports what it actually did, and the dialog prints it — "3 web searches" or "no web
search needed". A claim about research that nobody can check is worth nothing.

That decision is still the first answer's. **Dig deeper** is the reader overruling it for one
comment: the search is run by code before the answer is asked for
([§ pushing back](#pushing-back)).

> [!WARNING]
> **Prefer the server tool over the `plugins` form — but be precise about why.** This was written
> first as `plugins: [{ id: "web", engine: "native" }]`. The *plain* `plugins: [{ id: "web" }]` form
> genuinely does run exactly one search per request whatever the model wanted, and would have broken
> the decision above outright. `engine: "native"` is the documented exception — OpenRouter's docs
> say it "gives the model control over when and how often to search, rather than always running once
> per request" — and live calls on 2026-08-25 bore that out: nine stored comments came back with a
> real mix of search counts, four of them **0**. So the earlier form was honouring the decision, and
> an account of this that says otherwise is wrong about which form was in the file. The server tool
> is still the better spelling: it is the shape OpenRouter documents for model-invoked search, and it
> does not depend on one engine value keeping a special meaning.
>
> **The field name is `usage.server_tool_use_details.web_search_requests`.** OpenRouter's own docs
> say `server_tool_use`; the live API sends `server_tool_use_details`. A cross-model review
> confidently cited the docs, and following it would have made the count permanently `0` — with a
> passing test asserting it, because the test mocked the response shape the docs described. Only
> printing a real `usage` object settled it. [`src/explain.ts`](../../src/explain.ts) now reads
> both names, and `tests/explain.test.ts` pins both. This is
> [silent-success.md](../reusable/silent-success.md) twice over: the check you would naturally run
> shares its assumption with the code.

### Decision: comments persist <a id="decision-persistence"></a>

They survive reload, back/forward and a pasted link. Until 2026-09-05 that meant a file, written
under `data/<slug>/comments.json` even when the article itself came from the committed
[`example/`](../../example/README.md) fixture — the fixture is shared, a reader's questions are not,
and `data/` is gitignored. The filesystem half was deleted that day
([260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md));
comments now live in Postgres (`comments`, via
[`src/store/pg-comments.ts`](../../src/store/pg-comments.ts)) whether the article is a reader's own or
the committed fixture.

## Several at once <a id="several-at-once"></a>

Greg, 2026-08-25:

> improve the UI so it's possible to kick off multiple selection-searches at the same time (and
> navigate between them somehow, e.g. with next/prev arrows)

Concurrency itself was never the obstacle — each POST is independent, `explain` runs against its own
row, and the client never awaits one ask before allowing another. What was missing was any way to
keep track. Three things fix that:

- **Prev/next in the panel header**, with a `3 / 9` counter. The panel shows one comment, so this is
  how you get back to the ones you are not looking at.
- **"2 still working"** in the footer whenever other questions are in flight. Firing one and reading
  on is the whole point, so the panel has to be able to say that work is happening out of sight.
- **The panel steps aside while you drag.** It is pinned bottom-right, over the prose — which is
  exactly where the next sentence you want to ask about is. On a pointerdown that *starts* in the
  prose it drops to 10% opacity and stops taking pointer events; on pointerup it comes back. Only
  for drags that start in the prose, so pressing one of its own buttons doesn't make it vanish under
  your finger.

### Reading order, not ask order <a id="reading-order"></a>

The arrows walk you **down the article**, not back through your own afternoon —
[`comment-nav.ts`](../../src/web/comment-nav.ts), tested in
[`tests/comment-nav.test.ts`](../../tests/comment-nav.test.ts). Ties inside a block break by offset,
then by `createdAt`, so two comments on the same paragraph keep a stable order and the counter
doesn't flicker between renders.

> [!WARNING]
> Document order comes from the **index in `blocks.json`**, never from the id string. Ids are random
> ([block-ids.md](block-ids.md#why-random-and-not-sequential)), so `a.blockId < b.blockId` compiles,
> runs, returns a plausible order, and is meaningless. There is a test that fails on exactly that
> substitution.

The arrows **stop at the ends rather than wrapping**. A live arrow that goes nowhere reads as "there
is more this way" when there isn't, and wrapping from the last comment would fling the reader back to
the top of the article — a big move to get from a small button.

Stepping **scrolls only if the passage isn't already on screen** (`isBlockOnScreen` in
[`scroll.ts`](../../src/web/scroll.ts)). Two comments in one paragraph is the common case, and
jolting the page between them costs the reader their place for nothing. Like
[keynav.ts](keyboard.md), it writes no position state of its own: it scrolls, and the listener in
`useReadingPosition` notices and updates `?at=`.

Deleting steps to the neighbour instead of closing the panel — deleting one of nine is a tidy-up, not
a reason to lose your place.

#### Opening a question is a jump; stepping between them is not <a id="opening-is-a-jump"></a>

Those two sentences used to describe **all** movement between comments, and since 2026-09-06 they
describe only half of it. Both paths went through one function, and they are two different intents:

- **Choosing a question out of the drawer** is an arbitrary jump — the list is a table of contents,
  and pressing an entry can fling the reader three thousand words. That is a deliberate act, so it
  **pushes**, exactly as the glossary and the spine do
  ([url-state.md § Position replaces history](url-state.md#position-replaces-history-deliberate-acts-push)):
  one press of Back undoes it, and a return chip offers the way home on a home-screen shell that has
  no Back button at all
  ([260906g](../plans/260906g-back-to-where-you-jumped-from.md)).
- **The dialog's arrows** are traversal, and the paragraph above still holds for them in full. They
  replace `?note=` and scroll, and add **no history entries** — they do write history, with
  `replaceState`, which is how the address stays current without the stack growing. Twenty questions
  spread through an article must
  not cost twenty presses of Back — the misery `keynav.ts` refuses for a keypress, and browsers
  throttle rapid Back, so it is not merely tedious. GPT Sol F9, 2026-09-06.

**The split is worth more than either half alone**, and this is the part to know: a replace preserves
the entry's stamp, so after stepping through eight questions the chip still points at the place the
reader **entered** the traversal from rather than at the previous question.

Both paths open the note first and **check where the passage is before moving**, so neither jolts
the page — and the drawer's neither moves nor pushes — for one the reader is already looking at.
That check has three answers rather than two, and the two extra ones were both bugs found in review
(GPT Sol F10, F22, F23, 2026-09-06): a paragraph **taller than the viewport** counts as *here*,
because it can never fit between the bars and the reader is standing inside it; a comment whose
passage is **no longer on the page** — an orphan, kept and sorted to the end — opens its dialog and
does nothing else, since a push would buy an entry for a journey that cannot happen; and deciding
*here* now also **stops a glide still running** from the last step, which would otherwise carry the
reader away from what they just asked for.
[`src/web/comment-jump.ts`](../../src/web/comment-jump.ts) holds both, and
[`tests/comment-jump.test.ts`](../../tests/comment-jump.test.ts) pins the entry count on each, which
is the only assertion that can tell the two apart.

### A pasted `?note=` brings its own passage into view <a id="note-arrival"></a>

Stepping was always fine, because stepping has the comment in hand. **Arriving was not.** A link that
comes in from outside — `/read/<slug>?note=<id>` — has only an id, and until 2026-08-26 nothing
connected it to the article: the dialog opened, and the paragraph it was explaining could be anywhere.
That is the ordinary shape of a link you *send someone*, because the `?at=` that would have saved it
is only in the URL if the sender had scrolled. It was found while building the metadata page and left
open there ([260825e-metadata-page.md](../plans/260825e-metadata-page.md)); it is fixed now.

The rule when a URL carries both: **the note wins.** `?at=` is written by scrolling and says where the
sender's eye happened to be; `?note=` is only in a URL because somebody opened a dialog. The argument
in full, and what happens when the two agree, is in
[url-state.md § When `?note=` and `?at=` disagree](url-state.md#when-note-and-at-disagree-the-note-wins).

Two things about it are worth knowing before you touch it, and both come from the anchor being a
comment rather than a block:

- **It waits for the fetch.** The link carries a comment id; the block it is anchored to arrives over
  the wire with the comments. So the jump happens when they land, not when the URL is read — and
  until then it deliberately does nothing, leaving the page where `?at=` put it.
- **It fires once**, for the note the page opened with. After that, moving between comments is
  `goToComment`'s, which holds still when the next passage is already on screen. Two things moving
  the page is two things that have to agree.

It reuses `scrollToBlock` and its glide (`scroll.ts`) rather than adding a second way to move the
page, and it is smooth rather than instant — unlike the `?at=` restore, which runs before the reader
has seen anything. This one lands on a page that is already up and being looked at, so the travel is
what says the article moved rather than was replaced. It is also the safer of the two: the glide gives
way to a wheel or a touch, so a reader who started reading during the fetch is not dragged off their
line. The decision itself is `arrivalTarget`, pure and pinned in
[`tests/scroll.test.ts`](../../tests/scroll.test.ts). The wiring is one effect in `Reader`, and
whether the page *actually moves* can only be checked in a browser — there is no component runner
here. What is guarded is narrower and worth knowing the shape of:
[`tests/note-arrival.test.ts`](../../tests/note-arrival.test.ts) reads
[`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) and checks the call
survives, **with comments stripped first**. The effect's own explanation names `arrivalTarget` twice,
so a guard on the raw file would have been satisfied by prose while the call was gone — the same
silent pass a `sanitizeStoredBlocks` guard hit on 2026-08-26. Match a call, never a mention.

**Checked in a browser, 2026-08-26**, on `constitution` (22,518 words) at 1300px. A fresh load of
`?note=` with no `?at=` scrolled from the top to the commented passage and opened the dialog on it,
then grew `&at=` on its own. With an `?at=` that already had the passage on screen, `scrollY` was
5073.5 on load and 5073.5 a second later — held still, which is the case that costs no movement. With
an `?at=` pointing at the article's first block, the note won and `?at=` was overwritten. A `?note=`
naming nothing rendered normally with no dialog and no console error. One Back went to the library
rather than through a trail of scroll positions, which is `?at=` replacing rather than pushing.

**One thing that pass could *not* establish**, recorded because a silent gap is worse than a stated
one: whether the glide reads as travel or as a jolt. Every round trip through the automation tool
took longer than the 200ms animation, so only "not yet arrived" and "arrived" were ever observable.
See [browser-testing.md § An animation shorter than your round trip](browser-testing.md#short-animation).

### The web-search badge <a id="search-badge"></a>

Greg, 2026-08-25: "indicate (with an icon + hover-tooltip or similar) in the dialog box whether or
not a web search was used."

A globe in the footer, with the search count beside it, and a hover tooltip saying what it did. The
un-searched state gets its **own** icon (`GlobeOff`) rather than no icon at all: the model chooses
per question ([above](#decision-web-research)), so "did not search" is a fact about *this answer*.
A badge that only appeared on searched answers would leave the reader unable to tell "checked, and
it was fine" from "nobody has said".

> [!NOTE]
> The panel sits at `z-index: 70` — above everything structural, but **below** the tooltip layer
> (`.tooltip-anchor`, 80). It was 90 first, on the reasoning that a hover should never cover
> something the reader deliberately opened. That was wrong and visibly so: the panel has a tooltip
> of its own, and at 90 it buried it. A tooltip is dismissed the instant the pointer moves, so it
> cannot obstruct anything.

## The answer arrives a few words at a time <a id="streaming"></a>

**The rule this is an instance of: stream any model call a person is waiting on.** A spinner for
fifteen seconds and the first sentence after two are the same call; only one of them lets the reader
start reading. A batch call in the pipeline, which nobody is watching, does not need this.

Greg, 2026-08-26: *"see if you can make the text stream in (if that won't be too complex)"*. It was
not, because chat had already built every piece and none of them were chat-shaped. The three that
moved into shared modules are worth knowing about, because each carries comments that record a real
bug — and because they are what makes a new streaming endpoint a generator and a route rather than a
project:

- [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) — `sseChunks` (a chunk of bytes is not
  a line; `: OPENROUTER PROCESSING` is a keep-alive, not data; `data: [DONE]` is not JSON) and the
  three abort helpers, which exist because a deadline, a stall and a reader leaving all throw the
  same `AbortError`.
- `sse(res)` in [`src/routes.ts`](../../src/routes.ts) — the frame writer and its headers, including
  why the disconnect listener is on the **response** and not the request.
- [`src/web/lib/sse.ts`](../../src/web/lib/sse.ts) — the client's reader loop.

Two shared shells have since been built on those pieces:

- **Server: [`src/stream-run.ts`](../../src/stream-run.ts) § `runStream`** — one streamed call from
  the clocks to the verdict: the deadline, the stall clock, the `openRouterStream` loop, citations,
  usage and `classifyEnd`. What an ending *means* stays with the caller. `explainStream` and
  Citations' *Dig deeper* ([`src/citation-investigate.ts`](../../src/citation-investigate.ts)) run on
  it.
- **Client: [`src/web/lib/sse.ts`](../../src/web/lib/sse.ts) § `readAnswerStream`** — `begin`,
  `delta`s, then exactly one `done` or `error`, with a body that simply stops treated as a failure.
  The glossary and Citations read their answers through it.

The hand-rolled loops in [`src/search.ts`](../../src/search.ts) and the referee runners
(`src/referee-claims-run.ts`, `src/referee-criteria-run.ts`, `src/referee-mirror.ts`), and the
client hooks that loop over `readEvents` themselves, are older copies of the same shape. Some of
them carry structured items rather than text deltas, which is a real difference —
[`src/ai-call.ts`](../../src/ai-call.ts)'s header names `search`'s strict JSON read as one.

`explain()` did not become a second implementation: `explainStream` is the only one, and `explain`
drains it. No request handler uses the drain since 2026-09-10, when the glossary's two lookups — its
last callers — started streaming too
([260910g](../plans/260910g-stream-glossary-answers-as-they-arrive.md)). One thing they read that
this route does not: **`done` now carries the classified `ending`**, because the glossary refuses
three endings a comment keeps — the reader leaving, the token ceiling and the provider's filter.
A comment keeps half an answer because it has a row to put it on; a glossary answer drawn or stored
as finished would be a claim it cannot back. This route reads the fields it always read.

> [!WARNING]
> **A stream can end by simply stopping, and that looks exactly like finishing** — and an abort can
> end it cleanly too, because `sseChunks` cancels the reader and a cancelled read resolves
> `{ done: true }` rather than throwing. Both are one shared judgement now, `classifyEnd` in
> [`src/ai-call.ts`](../../src/ai-call.ts):
> [ai-gateway.md § How a stream ends](ai-gateway.md#stream-end) is where it is written down, and
> `explainStream` is one of its callers rather than the place the check lives. The sentence that
> used to be here — *"`finish_reason` counts as a second witness"* — was the bug, not the rule.

The `begin` frame carries the whole comment, and that is the point of it: `CommentStore.create`
re-mints an id that is malformed or collides, and a stream has no response body to carry the real one
back.
Without it the client streams an answer into a row the server has never heard of.

### The stream owns the answer, and nothing else on the row <a id="the-stream-owns-the-answer"></a>

A reader can edit their note, move its placement or recolour it while its explanation is being
written: the box is mounted whatever the status, and those PATCHes are deliberately not queued
behind a fifteen-second stream. So two writers share one row and neither waits for the other.

**The rule: each writes its own half.** The answer's half is `status`, `answer`, `citations`,
`searches`, `model` and `error` (and the tab's own `replacing`); everything else is the reader's.

- **On the server**, the answer's write touches only its own columns, and the `done` frame is the
  row read back after that write (`settle` in [`src/routes.ts`](../../src/routes.ts) § `answer`).
  If a newer attempt claimed it before that read, this stream retains its own committed terminal
  answer over the latest reader fields; it cannot watch the replacement attempt. See
  [the postmortem](../postmortems/261007b-a-post-write-read-can-belong-to-a-new-attempt.md).
- **In the tab**, every frame of the stream (`begin`, each `delta`, `done`, and the hook's own
  failure branch) writes the answer's half onto the row as it is on screen now: `putAnswer` and
  `withAnswerOf` in [`src/web/useComments.ts`](../../src/web/useComments.ts). The half is replaced,
  not merged, so a frame with no `error` removes the previous one.
- **And the other way round**, a PATCH's answer is the whole row as stored when the write
  committed, which for the length of a stream says `pending` with no answer. If a stream was open
  at any point while the PATCH was out, only the reader's half of that answer is taken
  (`landPatch`). With no stream in the way it replaces the whole row, as it always did.

Until 2026-10-07 none of the three held: a note edited mid-stream went back to the old one on
screen at the next delta and stayed there after `done`, and a PATCH answered after `done` brought
the spinner back for good. Postgres was right throughout, which is why nothing reported it.
[Plan 261007b](../plans/261007b-seventh-sweep-chat-and-comment-invariants.md), C;
`tests/comment-answer-stream-keeps-reader-edits.test.tsx` and
`tests/comment-answer-stream-lifetime.test.ts`.

### And it stays where it starts <a id="stays-where-it-starts"></a>

> When I ask a question in a chat or a comment, it starts streaming in the output response from the
> AI. That's great. The problem is that it immediately starts scrolling down so I can't read from the
> beginning of the response. What I would prefer is if it streams in, but stays in position so that I
> can start reading without having to scroll back up to the beginning of the response.
>
> — Greg, 2026-10-05

**The rule: an answer a person reads is read from its first sentence, so nothing the stream does may
move it.** Text arrives faster than anyone reads; a view that follows the arriving edge takes the
start away from the reader who is on it.

Every typed conversation is one component, `Conversation` in
[`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) § A streamed answer stays where it starts:
Chat in the band, the block chat in all three of its places, and Learn's Recall, Tutorial and
Explore conversations. When an answer
starts it puts the question at the top of the transcript **once**, with an empty block of *room*
after the last turn so that is a place the scroller can reach, and from then on streamed words, the
finishing frame and a tool row arriving above the text move nothing. *Latest* appears when the
answer outgrows the panel, and one press jumps; it does not start following. The arithmetic is
[`src/web/chat-hold.ts`](../../src/web/chat-hold.ts).

Two exceptions, both deliberate. **Live's spoken lines still follow the bottom**: they are heard, not
read from the top. And **the card in the Marginalia column gets room only at its height cap**,
because below it the card is as tall as its content and room would push every later note down.

The selection comment box needed nothing: `.cmt-body` has never followed, and a browser measurement
confirmed it stays at the top while its answer grows. A new streamed surface should start from that
default, not add a follow. The plan, the measurement and the options passed over are
[261005f](../plans/261005f-a-streamed-answer-stays-where-it-starts.md).

### And a stream that stops without ending <a id="stall-clock"></a>

The warning above is about a stream that **ends** early. There is a third case, and until
2026-08-26 nothing here had an answer to it: a stream that simply goes quiet. A TCP connection that
has gone away without being closed delivers no bytes and no error, so `reader.read()` never settles
and the `for await` over it waits for ever — the dialog spins, and nothing will ever stop it.

So `readEvents` is given `stallMs` here, the same 60-second clock chat uses, and `sse(res)` beats a
`: ping` comment down this route every 15 seconds so that silence means something. Both are
described in [260826r-sse-stall-recovery.md](../plans/260826r-sse-stall-recovery.md); the short version is that the
clock is on **bytes** rather than on frames, because a heartbeat is deliberately not a frame.

Chat responds to a stall by going and looking for the answer, which the server usually finished
writing anyway. **Nothing here does that**, on purpose: there is no `pending` comment row for a
watcher to adopt, and the finished answer simply appears on the next reload. All the clock buys a
comment is a failure the reader can see instead of a spinner that never stops — which is most of
the value, since the bug all of this came from was a panel that said "thinking…" for ever.

## Two more ways to push back on an answer <a id="pushing-back"></a>

Both from Greg, 2026-08-26, on the same weak answer.

**Dig deeper** (*"Search the web"* until 2026-10-01) — *"maybe add the 'Web search' button to do a
deeper web search"*. It used to re-ask with an instruction to go and look properly and leave the
searching to the model. Since 2026-10-01 it is the glossary's and Citations' action too, under one
name, and does what that name promises: a web search forced by code, the reader's other articles
searched beside it, and the answer written by the high-power model whatever the article's switch
says. What a press does, why, and Greg's words are in
[glossary.md § Digging deeper into a term](glossary.md#digging-deeper-into-a-term). It **replaces**
the answer rather than adding one: a comment is one question and one answer, and a second would need
a schema that can hold two and a panel that can show them.

On this route the order is **the allowance, then the search, then the claim**: `answer()` in
[`src/routes.ts`](../../src/routes.ts) takes the `dig-deeper` allowance and runs `searchFirst` before
`beginAnswer` stamps the row `pending`. So a refusal or a failed search is an ordinary JSON answer
with the stored answer untouched, and the search's own deadline never eats into the row's lease
(`COMMENT_ANSWER_LEASE_MS`, sized for the model call). The wire field is still `{ deep: true }`. A
first answer and *Try again* spend no allowance; only a Dig deeper press does. Two truly simultaneous
presses can each buy a search and only one claims the row — accepted, at about a cent, over a new
row state (Sol F12, overruled in the
[plan](../plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md)).

It is offered on a comment that has an answer — `done` or `error` — and on **no other**. It used to
be offered on anything that was not `pending`, which included `status: "none"`: every bookmark and
every note written without pressing Ask AI. Those are exactly what `beginAnswer` refuses
with a 409, *"was never a question, so there is nothing to answer"* — so a reader who wrote
*"what is the evidence for this?"* as a plain comment was offered a button labelled **Search the
web** and told, on pressing it, that they had never asked anything. Fixed 2026-09-05 while
diagnosing report 1X; `tests/comment-dialog-search-the-web.test.tsx` renders all four statuses, so
narrowing it too far goes red as well.

> [!WARNING]
> **The dig's instruction and its findings go after the cache breakpoint, and the tool definition
> does not change at all.** The cached prefix is *tools + system + article*. Putting the instruction in `SYSTEM` costs a
> second cache write of the whole article; changing `max_uses` on the tool is worse, because tools
> render at position 0 and a tool edit invalidates all three tiers
> ([prompt-caching.md](prompt-caching.md)). The first draft did the second of those while carefully
> avoiding the first. The cap is now `MAX_SEARCHES` for everyone — a cap is not a quota, the model
> still decides whether to search *again*; the search a dig promises is a separate call made first. `tests/explain.test.ts` pins the two tool arrays as **equal**, so the test fails on
> the difference rather than on a number somebody might legitimately tune.

The old answer stays on screen, dimmed, while the new one runs, and **comes back if the re-ask
fails**. Losing a good answer to a failed attempt at a better one is the one outcome this button must
not produce. A failure before the claim leaves the stored copy alone; one after it — the answer
itself failing — has overwritten it by then, and the client's is the only one left.

**A follow-up box that opens a chat** — *"if the user enters text into it, it should automatically
open up as a new chat (rather than making the [dialog] itself too complex)"*. Which is what keeps a
comment at one question and one answer: the dialog does not grow a transcript, the reader is moved to
the thing that already is one. The box's button is **Ask in chat**, and since 2026-10-06 pressing it
sends the question there rather than pre-filling it for a second press
([261006j](../plans/261006j-ask-in-chat-sends-the-question.md), D4). `Reader.tsx` owns the handoff;
`ChatDialog.tsx` and `ConversationModes.tsx` own its two sending paths.

> [!WARNING]
> **The question does not go in the URL.** [`useChat.ts`](../../src/web/useChat.ts) already argues
> this for its own POST — the question is arbitrary length and it is the reader's private text,
> which would then be in browser history, in any shared link, and in every access log on the way. It
> travels in the reading view's component state and is lost on reload, which is the right trade:
> the cost is retyping one sentence.

## Anchoring <a id="anchoring"></a>

A comment is `blockId` + the exact `quote` + a `start` offset — and **in that order of authority**.
The block id is the spine ([block-ids.md](block-ids.md)); the quote is the anchor; the offset only
chooses between repeats of the same words inside the block.

That ordering is the whole design. An offset alone drifts the moment the paragraph changes, and
drifts *silently* — you get a mark over plausible, wrong words, which is the failure random block
ids exist to prevent. So [`resolveMark`](../../src/web/annotate.ts) re-finds the quote by text and
returns `null` when it is gone. A comment whose quote has vanished draws no mark at all; it is still
in the list and still openable. Losing the anchor is the safe failure, exactly as in
[block-ids.md § The cost we accepted](block-ids.md#the-cost-we-accepted).

**And since 2026-08-31 it is not invisible either.** Every commented block carries a `Bookmark` in
the prose gutter ([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx)), counted from `comments` by
**`blockId` alone** — never from the resolved marks. That is the point of it: the block id is the
*durable* half of the anchor, so a comment whose quote has been re-extracted away can still have
somewhere to show, for as long as its block keeps that id.

**Durable is not immutable, and the difference bit once.** Stage 3 carries an id over by matching a
new block to an old one **by its text** ([block-ids.md § Surviving stage 2](block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)),
so a block whose words changed can be re-minted and the comment on it then points at an id no
current block carries. The comment still survives, and the id is still what does it: the anchor is
`comments_identity_fk`, which points at `block_identities` rather than at this revision's blocks, and
identities are never deleted ([`pg-comments.ts`](../../src/store/pg-comments.ts) § The anchor is the
block IDENTITY). So the comment is not dependent on the current revision; the old identity remains
even when no block carries it.

Worth stating twice over, because both tidier versions are wrong. *Pinned to the permanent id, so
the comment survives* has the facts right and the causation wrong — that one reached a reader-facing
tooltip on 2026-09-07 before a review caught it. And *what keeps the comment is not the id at all*,
which was this paragraph's first repair on 2026-09-08, over-corrects in the other direction and
denies the id the role it actually has. A false mechanism is easy to replace with another one
([260907b § Stage 3](../plans/260907b-rich-tooltips-on-the-dock-modes.md)). Click it and the dialog opens on the block's first comment in reading order.

Two things follow, and both are easy to get wrong:

- Anything drawing the gutter marker must group on `blockId`, which is what
  [`commentsByBlock`](../../src/web/comment-nav.ts) exists to be the only copy of. Deriving it from
  the marks instead would compile, run, and quietly lose exactly the comments the marker is for.
- It recovers a comment whose **block** still exists. A comment whose block is gone entirely has no
  row to sit beside; `orderComments` sorts it to the end of the dialog list and that is where it
  stays.

### The offset space is the *rendered* text, not `block.text` <a id="offset-space"></a>

> [!WARNING]
> `block.text` is not the string the browser renders. `extractText` in
> [`src/blocks.ts`](../../src/blocks.ts) collapses whitespace **and inserts a space at every nested
> block boundary**, so a two-paragraph `<blockquote>` is one character longer in `block.text` than
> on screen. An offset taken against one and applied to the other lands somewhere plausible and is
> silently wrong.

The offset space used here is the concatenation of the **text nodes of `block.html`** — which is
what `Range.toString()` measures and what a `TreeWalker` over `SHOW_TEXT` produces. Both halves of
the feature use that one definition, and the *browser's own parser* computes it: no entity table, no
tag scanner, nothing of ours that could drift from what the DOM does.

That is also why [`tests/annotate.test.ts`](../../tests/annotate.test.ts) and
[`tests/selection.test.ts`](../../tests/selection.test.ts) carry a
`// @vitest-environment jsdom` line instead of using the node default in
[`vitest.config.ts`](../../vitest.config.ts). A hand-rolled tokenizer tested under node would pass
against itself and disagree with Chrome.

### One `<mark>` per text node <a id="one-mark-per-text-node"></a>

A selection may start inside an `<em>` and end outside it. One `<mark>` around the whole range would
be malformed (`<em>a<mark>b</em>c</mark>`) and the browser would quietly repair it into something
else, so a mark becomes one `<mark>` per text node it touches. The last run carries `data-mark-end`,
which is what the ✳ in [`styles/annotations.css`](../../src/web/styles/annotations.css) hangs off — a mark broken across
three runs still shows one marker. Overlapping comments share a single `<mark>` listing both ids
rather than nesting, because two underlines on the same words read as a rendering bug.

## Why this call is not a pipeline stage <a id="why-this-call-is-not-a-pipeline-stage"></a>

[architecture.md](architecture.md#server-and-client) says "LLM calls happen in the pipeline, not in
request handlers". This is the deliberate exception, and the reason is that its input does not exist
until the reader makes it: a selection cannot be precomputed, cached on a content hash, or run
ahead of time. Everything else about the stage discipline holds — the call is one transport-free
function ([`src/explain.ts`](../../src/explain.ts)), the routes are a thin wrapper
([`src/routes.ts`](../../src/routes.ts)), and the artefact is a row in Postgres.

It is also the only place the project talks to **OpenRouter** rather than the Anthropic SDK the
pipeline uses, because `OPENROUTER_API_KEY` is the key this project has. The model defaults to
`anthropic/claude-sonnet-5` and is overridable with `SPIDERYARN_EXPLAIN_MODEL`.

## What the prompt asks for

The system prompt is in [`src/explain.ts`](../../src/explain.ts) and is written against
[vision.md § Principles](vision.md#principles) rather than against "explain this":

- Supply what the passage **assumes you know** — the term of art, the named person, the debate being
  alluded to, the earlier passage it answers. The reader can already see the words.
- Keep the author's own vocabulary, so the explanation and the prose are recognisably about the same
  thing (principle 2).
- **Do not summarise the article.** The reader is reading it. That is the anti-goal in
  [vision.md](vision.md#anti-goals), one sentence from the prose it would be replacing.
- Say when the article does not say, rather than picking a reading and sounding confident.

The whole article goes in the prompt every time — Greg asked for the answer to be given "the whole
text of the article", and a selection is usually ambiguous without it ("this move", "the same
objection"). At ~15k tokens for the test article that is a few cents a question.

The answer is rendered as **text**, never as HTML: there is no `dangerouslySetInnerHTML` on this
path and there should never be one. It is model output landing beside the author's prose, and it
must not be able to dress itself up as the article.

## The drawer that lists them, and what kind of thing it is <a id="the-drawer"></a>

The Comments button in the bottom bar raises a drawer with the list in it — the one panel the dock
still has ([`Dock.tsx`](../../src/web/Dock.tsx)). Its interaction contract was settled by a browser
pass on 2026-09-06 rather than argued from the CSS, and it is worth writing down because the markup
used to claim the opposite:

- **Modeless with respect to the dock.** `.dock` sits at `z-index: 96`, above the scrim's 92, so the
  bar stays visible and clickable with the drawer open — pressing a mode changes the mode and leaves
  the drawer up.
- **Pointer-blocking over the reader beneath the dock:** the fixed scrim intercepts
  pointer events over the prose and the other reader chrome below it. Nothing behind it
  is inert or hidden from keyboard or assistive-technology navigation.
- **Focus moves in on open** — to the drawer's close button, since `DockTab` otherwise left it on the
  bar and a keyboard reader tabbed straight past the thing they had just opened — **and back to the
  opener on every close path**: Escape, the scrim, the ×, and the same tab pressed again.
- **Choosing a comment is the fifth close path**, and it hands focus on rather than back:
  [`CommentDialog`](../../src/web/CommentDialog.tsx) carries the same lifecycle, so the dialog takes
  focus as it opens and returns it to the Comments button when it closes. React flushes the drawer's
  cleanup before the dialog's setup, which is what makes the hand-off land on a stable control.
  [`tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx`](../../tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx).
  It is also **a jump**, unlike the arrows in the dialog it opens —
  [§ Opening a question is a jump](#opening-is-a-jump).
- **Tab is deliberately not trapped**, because the bar behind it is meant to stay reachable. So the
  drawer keeps a labelled `role="dialog"` and carries **no `aria-modal`**: that attribute tells
  assistive technology the rest of the page does not exist, which was a false statement about a bar
  that is visible, operable and Tab-reachable. It said `true` until 2026-09-06.

[`tests/the-dock-drawer-is-not-a-modal.test.tsx`](../../tests/the-dock-drawer-is-not-a-modal.test.tsx)
holds all of it; the reproduction is in
[260905h](../plans/260905h-a-mode-failure-should-leave-the-article-readable.md#stage-2-the-docks-real-focus-contract-reproduced).
Escape's capture-phase handler in `Dock` is untouched by any of this, and must stay that way — it is
what stops one press closing `CommentDialog` underneath the dim.

### The questions you asked are in it too <a id="asked-questions"></a>

Greg, 2026-09-30
([SPIDERYARN-READING2-6W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6W)):

> I think if I ask a question, I expect that to show up in the comments so that I can find it again
> or find the answer again. Perhaps somehow flagged as a question rather than a comment, but still
> there.

The gutter's "?" and *Chat about this* make a **chat**, not a comment
([260904b § no new `ThreadKind`](../plans/260904b-gutter-help-button-and-detached-streaming-chat.md#no-new-kind)),
and a chat about the whole block draws no mark in the prose. So a reader who closed the answer and
forgot which paragraph they had pressed had nowhere to find it. Nothing was lost: the thread is
stored, and it is in Chat mode's list under the same title as every other "?", *Help me understand.*

Since then the drawer lists **every chat with an anchor** beside the comments, in the one reading
order (`orderDrawer` in [`comment-nav.ts`](../../src/web/comment-nav.ts)), each labelled
*Question*, with the paragraph's opening or the quote. There is **no answer preview**: the
summaries' `lastLine` is not kept live, so a question asked this visit would say *thinking…* under
the answer the reader had just read. Nor the title, which is *Help me understand.* on every "?".
Pressing one goes through the same jump a comment row uses (`jumpToComment`, with `openChatThread`
as the opener): the floating chat dialog, or the band in Chat mode, and from Learn it switches to
Chat. They are still chats, in `chat_threads`; the drawer only shows them. Left out: an unanchored
chat (it is about the whole piece, and stays in Chat mode), and a chat a comment already points at
through `threadId` (*Ask AI*), whose comment row covers it. The count on the Comments
button counts both, and the drawer does not say *"Nothing marked yet"* until both lists have
loaded.

The comment dialog's arrows still walk comments only.
[260930f](../plans/260930f-gutter-questions-listed-in-the-comments-drawer.md) has what was deferred.

### Every mark says which of three it is <a id="three-kinds"></a>

> And perhaps indicate whether, in general, comments should indicate whether they're a comment from
> the user that didn't want an AI chat response, or one that did want an AI chat response, or a
> question with AI chat response.
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-9H)

Since 2026-10-02 the drawer's rows and the margin's lines carry a label: **Comment**, **Comment +
AI**, **Question** (and **Bookmark** in the drawer, for one with no words). The broad *+ AI* stays
true for a legacy explanation that is pending or failed as well as for one answered in place or in
a chat. Nothing new is stored: `commentKind` in
[`comment-nav.ts`](../../src/web/comment-nav.ts) reads the involvement off `threadId`, a legacy
status or an answer, and a question is an anchored chat, which `askedQuestions` already keeps apart
from the comments. *Ask AI* whose chat failed before it existed reads as a plain comment, which
is what it ended up being.

A visitor's copy has neither `threadId` nor status. It therefore keeps *Comment + AI* only when a
legacy answer crosses the public projection; otherwise it becomes *Comment* when it has words, or
*Bookmark* when it has neither words nor an answer. That last case includes a wordless modern
comment whose private conversation link was stripped, and the margin leaves it out as it does any
bare bookmark.
[261002j](../plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md).

**A coloured comment on a selection is also a row in the Quotes band**, in its colour and marked
*yours*, for the article's owner — unless it is a Referee placement:
[quotes.md § Your highlights are rows too](quotes.md#your-highlights-are-rows-too).

## Where the code is

| File | What it does |
|---|---|
| [`src/web/selection.ts`](../../src/web/selection.ts) | mouse selection → `{ blockId, quote, start }`, clamped to one block |
| [`src/web/Dock.tsx`](../../src/web/Dock.tsx) | the drawer the list lives in, and its focus contract — [§ The drawer](#the-drawer) |
| [`src/web/annotate.ts`](../../src/web/annotate.ts) | re-find a quote, and draw the `<mark>` runs over it |
| [`src/web/fresh-highlight.ts`](../../src/web/fresh-highlight.ts) | the default colour, what *pristine* means, and when two selections overlap |
| [`src/web/AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx) | **what a selection opens in Referee mode**: the quote, a Copy button, a box, Ask AI and Save — and the rule that no exit drops a draft |
| [`src/web/useComments.ts`](../../src/web/useComments.ts) | fetch / create / edit / retry / delete, the client-minted id, a create that waits behind the opening read |
| [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) | the panel: the reader's words, then the quote, spinner, answer, sources — and **what a selection opens everywhere else**, with the fresh box's rules |
| [`src/web/BlockGutter.tsx`](../../src/web/BlockGutter.tsx) | the `Bookmark` beside a commented block, and what opens when it is pressed |
| [`src/web/comment-nav.ts`](../../src/web/comment-nav.ts) | reading order, stepping, and grouping onto blocks for the gutter |
| [`src/web/comment-jump.ts`](../../src/web/comment-jump.ts) | **moving** to one: the drawer pushes, the arrows do not — [§ Opening a question is a jump](#opening-is-a-jump) |
| [`src/store/pg-comments.ts`](../../src/store/pg-comments.ts) | the same five operations against Postgres |
| [`src/explain.ts`](../../src/explain.ts) | the OpenRouter call and the system prompt |
| [`src/comments.ts`](../../src/comments.ts) | the shared types and rules (`NewComment`, `MarkPatch`, `AnswerPatch`), and `loadComments` for fixtures |
| [`src/routes.ts`](../../src/routes.ts) | the endpoints, mounted by [`vite.config.ts`](../../vite.config.ts) |
| [`src/env.ts`](../../src/env.ts) | `.env.local` → `process.env` |

```
GET    /api/comments/:slug              every stored comment
POST   /api/comments/:slug              { id?, blockId, quote, start, body? } → the comment
                                        FREE. 201, ordinary JSON, no model call.
                                        409 if that id is a different comment.
PATCH  /api/comments/:slug/:id          { body }  — null clears it back to a bookmark.
                                        The key is required: no `body` key is a 400.
PATCH  /api/comments/:slug/:id/mark     { criterionId, valence } — the referee's own
                                        placement. Both keys, always, each a value or
                                        null; both null clears it.
POST   /api/comments/:slug/:id/answer   {} or { deep: true } → **a stream**
                                        The legacy explanation path: Try again, and
                                        Dig deeper ({ deep: true }). 409 on a bookmark;
                                        429/503 when Dig deeper's allowance is spent.
DELETE /api/comments/:slug/:id
```

**Two routes, because a colliding id means opposite things to them** — a retry to the answer path,
somebody else's comment to the create path. One route could not safely be both.

There is deliberately **no route for linking a comment to its conversation**: the only place that
knows a real thread id is the chat stream, so `POST /api/chat/:slug` carries `sourceCommentId` and
writes the link itself.

The answer POST **is** the answer — it streams and then returns the finished comment, so there is
nothing to poll.

## Three things that fail silently here, and one that used to

1. **Concurrent writes, until 2026-09-05.** Every create was a read-modify-write of the whole file,
   and selecting two passages in quick succession is the normal way to use this. Without a promise
   chain serialising them in `src/comments.ts`, the second read started before the first write
   landed and a comment vanished — with *both* writes reporting success. A test genuinely failed
   when the chain was removed (7 of 8 comments lost); see
   [silent-success.md](../reusable/silent-success.md). The filesystem store, the chain and the race
   it guarded against are gone with it — SQL's own row locking is what a create now competes
   against, and a losing concurrent create gets a refusal rather than a raw key error.
2. **A 200 with no completion.** OpenRouter answers `200` with an empty `content` when the model
   stops for its own reasons. `explain` throws on that rather than storing a blank comment that
   looks answered.
3. **The browser's own selection highlight** sits on top of the mark we just drew, so without
   `removeAllRanges()` after asking, the new artefact is invisible until the reader clicks
   elsewhere — and it looks exactly like a mark that was never drawn. The call is in
   [`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) § `onSelect`.
4. **Retry, which shipped broken and was caught in the browser.** `retry` fired the POST from
   inside a `setComments` updater. An updater must be pure — React StrictMode invokes it twice — so
   one click sent *two* requests; and because `CommentStore.create` refused a client id that was
   already taken, each reply came back under a **new** id. Result: two model calls paid for, two orphan
   comments saved, the original still marked `error`, and a dialog spinning forever on an id
   nothing would ever answer. Every individual piece reported success. The fix is two-layered — the
   updater is pure now, *and* the store is idempotent on the id, so a duplicated POST resets the
   comment in place instead of appending. [`tests/store-comments.test.ts`](../../tests/store-comments.test.ts)
   pins the server half.

The last of those is the shape [silent-success.md](../reusable/silent-success.md) describes almost
exactly: it was invisible to the unit tests (both halves passed in isolation), invisible in the
network tab (two 200s), and only visible as "the spinner never stops".

## When it says "Failed to fetch" <a id="failed-to-fetch"></a>

The dev server is not running. That is nearly always the whole story — an explain call is a normal
`fetch` to `/api/comments/<slug>`, and a bare `TypeError: Failed to fetch` means the request never
got a response at all.

It is the easiest failure to hit here, for a reason worth stating: **an explain call takes 11-25
seconds**, and `npm run dev` restarts whenever `vite.config.ts` changes. With several agents editing
this tree at once, that is a wide window for a request to be orphaned mid-flight. So
`describeFetchFailure` in [`lib/describe-failure.ts`](../../src/web/lib/describe-failure.ts) rewrites the browser's
message into one that names the cause, keeping the original in parentheses so it stays searchable:

> Couldn't reach the dev server — is `npm run dev` still running? (Failed to fetch)

Check the server the way [browser-testing.md](browser-testing.md) says to — don't take another
agent's word for it, or your own from ten minutes ago:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5273/api/article/<slug>
```

A comment whose POST never reached the server is **not** written to disk, so it disappears on
reload rather than leaving a permanent unanswered mark. Nothing to clean up.

## A shared link carries them, since 2026-09-04

**This is the one part of the feature that changed what a promise meant.** Until then the sharing
card said comments and notes never left, and [privacy.md](privacy.md) said the same in the reader's
own words. Greg decided they should go out:
[260904c](../plans/260904c-more-modes-on-a-shared-link.md) § Stage 3.

**What a visitor gets:** the passage, the reader's own words, the model's answer, and its citations.
**What they may do with it:** read it, step through the list, and nothing else — no edit box, no
delete, no retry, no *Dig deeper*, and no follow-up composer. Absent, not disabled: a greyed-out
box that says "ask a follow-up" is an invitation to press it, and the press would spend the owner's
money.

The seam is `CommentAccess` in [`CommentDialog.tsx`](../../src/web/CommentDialog.tsx) — a
discriminated union whose visitor arm carries **none of the eight verbs**, so there is nothing in
scope for a later edit to reach. That is the same shape as `QuotesAccess` and `ReaderCapability`, and
it is deliberately not a `readOnly` boolean beside the callbacks.

### Two rows never cross, and the refusal is in SQL

`PUBLIC_COMMENTS_WHERE` in [`public-reader.ts`](../../src/store/public-reader.ts):

- **`criterion_id is null`.** A comment with a criterion is [referee](referee-mode.md) work — a peer
  reviewer's placement of a passage on a scale, not a reading note. Dropping `criterionId` and
  `valence` from the projection does **not** make the row a reading note; it publishes the body of a
  peer review with its context stripped off, which is worse. The row goes.
- **`status in ('none','done')`.** A `pending` or `error` row published without its error, its retry
  and its polling is an item a visitor cannot act on or understand.

Both were found by GPT Sol reviewing the plan, not by anybody writing the feature.

### The read is its own query, and that is the interesting constraint

The obvious implementation — resolve the article id, hand it to `listFor(articleId)` in
[`pg-comments.ts`](../../src/store/pg-comments.ts) — was blocked. `listFor` is an unrestricted
`.select()`, and more importantly *"obtain an article id, then read a child table by id"* is the
escape hatch [`tests/public-imports.test.ts`](../../tests/public-imports.test.ts) exists to close.
That test keeps child tables out of the public graph and was written after somebody demonstrated the
hole in six lines.

So `publicCommentsQuery` names its columns, joins `articles`, and **repeats the `publicSlug`
predicate in its own `where`** — a naked `articleId` is not authority. The tripwire's allowlist grew
from four tables to five, deliberately, and its comment says what a sixth line would have to prove.

### Citations are re-judged, not copied

Every `Citation.url` goes through `publicCitationUrl` ([`src/urls.ts`](../../src/urls.ts)), which
refuses a credential in the address (`https://user:token@…`) and a host a stranger could not have
reached anyway. **The query string is kept**, unlike `safePublicCanonical` — a canonical is a claim
about *which document this is*, and a query makes it the wrong claim; a citation is *where that came
from*, and half the public web addresses its articles with a query. A citation that fails is dropped
rather than blanked, and if none survives the key comes off entirely.

## Deliberate limits

- **A selection under 2 characters is ignored** — and 2 is the whole floor, deliberately.
  It was 8 until 2026-09-05, on the ground that *"every one of these costs a model call"*; that
  reason died on 2026-08-28, when saving became free and the model became a tick-box, and the
  constant outlived it. Meanwhile it refused `AI`, `GDP`, `Ryle` and `qualia` — the short selection
  [§ The two questions a selection raises](#the-two-questions) calls *almost always the second
  question*. What is left at 2 is the one-character skid, kept because a one-character quote is the
  case `resolveMark` is likeliest to re-anchor over the wrong words
  ([§ Anchoring](#anchoring)). `MIN_SELECTION_CHARS` in
  [`selection.ts`](../../src/web/selection.ts).
- **A selection the floor refuses opens nothing at all** — not a comment box, and *not the mark it
  happened to end in*. `readSelection` answers `"too-short"` rather than `null` so its caller can
  tell a refused drag from no drag; collapsing the two is what made a skid inside a commented phrase
  reopen that comment, against the rule that a real selection wins over the mark it lands in.
  `SelectionRead` in [`selection.ts`](../../src/web/selection.ts), and
  `tests/short-selection-in-a-mark.test.tsx`.
- **A selection spanning two blocks is clamped to the first.** A comment addresses one block —
  that is what makes it storable against the id spine — and silently doing the first paragraph beats
  appearing to ignore the drag.
- **A highlight whose write fails is gone, and says so.** Selecting stores the row at once; if that
  request is refused or the network is down, the optimistic row is removed, the paint and the box go
  with it, and the Dock says the save failed. The same holds for a Referee draft handed to `create`
  on its way out: the words are then in neither the box nor Postgres. Keeping a recoverable failed
  draft is its own piece of work, not built (GPT Sol's review of plan 261003i, D6). The Referee
  box's `pagehide` write is weaker still: it is a keepalive request nobody reads the answer to, and
  a token that expired seconds earlier refuses it.
- **Leaving in the first seconds of a page can lose a highlight made in them**, while its create
  is still held behind the opening read (§ The box a selection opens says why nothing resends it).
  A crash or a killed browser can lose that, and in Referee mode a draft box open at that moment. Keystroke-by-keystroke saving is a different design and is not built.
- **A mis-drag is a create and a delete.** Writing the row on selection means a selection made by
  accident, or made to copy, costs two requests. That was the price of dropping the provisional
  mark; plan 261004f, last section.
- **A finger's selection highlights nothing by itself.** There is no mouseup on an iPad, and the
  same long-press is how a reader copies or looks a word up, so a touch selection gets a "Highlight
  or comment" button below it and the press applies the highlight —
  [touch.md § A finger's selection gets a button](touch.md#a-fingers-selection-gets-a-button).
- **A comment is stored `pending` before the model is called**, so a crash mid-answer leaves a
  visible unanswered question rather than a selection that evaporated. The dialog offers a retry.
- **A `pending` comment nobody is answering becomes an `error` on the next read.** `pending` in the
  store cannot distinguish "an answer is coming" from "the process writing it died" — so the server
  keeps the list of what it is actually answering, and anything else that is `pending` is swept to
  `error` with a message. Without the sweep, a comment orphaned by a `npm run dev` restart reloads
  as a spinner that never stops. `sweepOrphaned` in [`src/routes.ts`](../../src/routes.ts) supplies
  that list; the rule itself is `sweepPending` on each store.
- **A dead attempt heals on the next *Try again*, without a read first.** The sweep only runs on
  `GET /api/comments/:slug`, and the retry button does not do a `GET` — so `beginAnswer` claims an
  abandoned row itself. See the store contract above.
- **…and on Vercel that list is not enough on its own.** It is a fact about *one* process, and every
  request may land on a different machine. So the Postgres store also reads a **lease** stamped on
  the row when the attempt began: a fresh `pending` row is spared even by a machine that knows
  nothing about it, and only an expired lease may be declared dead. `keep` alone would error an
  answer while the reader watched it arrive; the lease alone would kill a long answer the server is
  still writing. `COMMENT_ANSWER_LEASE_MS` and `sweepPending` in
  [`src/store/pg-comments.ts`](../../src/store/pg-comments.ts), and `CommentStore.sweepPending` in
  [`src/store/contracts.ts`](../../src/store/contracts.ts) for why the filesystem store — one
  process, deleted 2026-09-05 — only ever needed half of it. `tests/comment-sweep.test.ts` is the
  reproduction.
- **The model call has a deadline**, and the lease above is derived from it so the two cannot drift.
  `fetch` has none of its own, so a request that never comes back would hold the comment `pending`
  for ever. `EXPLAIN_TIMEOUT_MS` in [`src/explain.ts`](../../src/explain.ts); the timeout is
  reported as a sentence, not `AbortError`.
- **Deleting while the answer is still in the air wins.** The POST returns the whole comment, so
  storing it used to put back a row the reader had already deleted, mark and all. `useComments`
  keeps a tombstone and re-sends the DELETE once the write it was racing has landed.
- **Selecting inside an existing mark makes a new highlight**, rather than reopening the comment that
  is already there. Marking a narrower part of something you marked before is ordinary; the mark
  only takes the click when there is no selection to act on. (The one exception is the overlap rule
  in [§ The box a selection opens](#the-selection-box), which replaces a highlight made a moment
  ago and not yet touched.)
- **No editing, no reply, no follow-up question.** Ask, read, delete. Anything more is a chatbot
  with the article in the context window, which is
  [an explicit anti-goal](vision.md#anti-goals).
- **Comments are per-article, not per-reader.** There is one reader.

## Where the chat panel sits <a id="chat-dock"></a>

A question asked from a block opens the chat panel (`ChatDialog`), fixed to the bottom-right corner
of the window, over the prose. From the report that changed that:

> I think now that we have a right-hand column that we sometimes use for marginalia, why don't we
> put the block-level chat comment in that right-hand column? … But at the moment, it kind of shows
> up in this own panel that kind of occludes things, and I mean, it's okay, but I just feel like
> it's more in the way than it would be if it was in the right-hand column.
>
> — Greg, 2026-10-03 (spya-nseuz2)

So when the [Marginalia](marginalia.md) column is showing and there is room, the panel **docks**: it
moves sideways to start just right of the prose, over the lower part of the column, and covers notes
rather than the article. It is the same panel in the same place in the tree, with the class `docked`
(`.chat-dialog.docked` in [`dialogs.css`](../../src/web/styles/dialogs.css)). Its bottom anchor and
heights are untouched, because they are what keeps it above the iOS keyboard.

`chatDock` in [`layout.ts`](../../src/web/layout.ts) decides, from the same fit the column is drawn
from. The room is from the column's left edge to the window's right edge, less an 8px inset and an
8px gutter, and the panel docks when a column is drawn and that room is at least 256px
(`CHAT_DOCK_MIN`). It is then as wide as the room, up to its usual 26rem. Otherwise it floats as
before: Marginalia off, a phone, any window with no room for the column.

**A full column is enough room, and only just.** The column is at most 288px, so one pressed against
the window's edge (the case with a band open) gives a 272px panel. A column that has shrunk below
272px leaves too little and the panel floats; on a window wide enough that the centred prose leaves
more than the column beside it, the panel is wider, up to 26rem.

Docked or floating, the block the panel is about wears a 2px rule down its right edge
(`td.text.chat-open`), because a panel fixed to the window does not otherwise say which paragraph it
belongs to. A conversation about the whole piece marks nothing. The plan is
[261003p](../plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md).

**The caret follows the composer.** The panel stays open while the conversation in it changes, and
each conversation has its own composer, so a change removes the box the reader may be typing in.
When it does, focus goes to the composer that replaces it, in every placement, and only then: a
reader on any other control is left there (`ChatDialog.tsx` § The caret follows the composer;
[261004l § B](../plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md)).

### On trial since 2026-10-04: a card in the column, level with its block

The dock was option A. Asked whether to try option B, a card beside the block:

> Q-margin-chat I'm not sure what's best. Shall we try B, and see how it goes. Make it
> expandable/collapsible.
>
> — Greg, 2026-10-04

So while the column is showing, a conversation about a block is drawn **in the column, starting
level with its block, and scrolls with the article**. The plan, the review and the screenshots are
[261004k](../plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md).

- **It is the same `ChatDialog`**, not a second chat. Its panel lives in one container element that
  is moved between a host in the block's cell and its old place, so a half-typed question, the
  transcript's position and a "?" already sent all survive a move.
- **Expanded or collapsed, by the reader's press.** It opens expanded. The chevron in its header
  collapses it to one button about a note tall: the title, and either *answering…* or the first
  line of the latest answer. Pressing that, or anything that opens the conversation (the gutter
  chip, "?", the Comments drawer), expands it. Nothing collapses by itself. Close and Esc are
  unchanged.
- **Its width is the room right of the prose**, up to 36rem (`chatCard` in `layout.ts`), not the
  notes' 288px. Report `spya-ntb7p6`: on a very wide screen the docked panel was narrower than the
  space beside it.
- **Notes below it are pushed down** while it is expanded, like below any tall note, and return
  when it collapses or closes. The block's own notes sit under the card. The margin's *Question*
  line for the open conversation is left out while its card is up.
- **Where there is no card, the panel is what it was**: docked if `chatDock` says so, else floating.
  That covers Marginalia off, a phone, a narrow iPad portrait, a conversation about the whole
  piece, a block inside a folded section, and the moment before the host exists.
- **A link in a chat answer is not the paragraph's.** The card sits inside the block's row in the
  DOM, so `blockOfLink` (`link-facts.ts`) answers "no block" inside it, as for the floating panel.

**Going back to the dock is one word**: `BLOCK_CHAT_IN_COLUMN` in `layout.ts`, `"card"` to
`"dock"`. Both are built and tested.

Known costs of the card, for the trial: the composer and a streaming answer scroll away with the
block; a reloaded `?thread=` whose block is off screen shows only the block's rule until you scroll
to it; and the composer staying above an iPad keyboard has not been tried on an iPad.

## The other way to ask

Since 2026-08-25 there are two. This one is scoped to a passage you selected and answers in a
dialog anchored to it. The other is **chat** ([260826a-chat-mode.md](../plans/260826a-chat-mode.md)): you type a
question about the article and the answer cites block ids back.

They are not competing, and the division is worth keeping straight when deciding where a new idea
belongs:

| | Comments (here) | Chat |
|---|---|---|
| What you address | a span you selected | the whole article |
| Where the answer goes | a dialog over the prose, anchored to the words | the band beside the prose |
| The anchor back to the text | the quote itself | block ids the model cites |
| Stored as | `comments`, one flat table | `chat_threads` / `chat_messages` |
| Transport | one POST, the answer comes back with it | a stream |

**Comments are the narrower and safer feature**, and the one whose scoping vision.md's anti-goals
actually argue for. Chat is the one that had to earn its place; the argument is in
[260826a-chat-mode.md § Say the awkward thing first](../plans/260826a-chat-mode.md#say-the-awkward-thing-first).

### And since 2026-08-26, a third caller of this same call

The glossary's **Dig deeper** button ([glossary.md § Digging deeper into a
term](glossary.md#digging-deeper-into-a-term)) calls `explainStream` directly, with the first
matching glossary form — the name or an alias — as the quote, the first block it matches as the
anchor, and the dig's findings. Not a copy of it — the function. Its *Look up* box calls the same
stream without a dig, quoting the exact characters it matched.

That is worth knowing here rather than only there, for two reasons. **A change to `SYSTEM` in
[`src/explain.ts`](../../src/explain.ts) now changes what a glossary entry's checked answer says**,
and nothing in this file would tell you. And it is the first half of a merge our review of the
previous version asked for and
[glossary.md § What is still open](glossary.md#what-is-still-open) has been carrying since: *a
glossary should be the same mechanism as comments with a different prompt, not a second system.* The
second half — one storage artefact, one anchor model — is still open.

One practical consequence: because the article half of the prompt is one cached prefix
([prompt-caching.md](prompt-caching.md)), a call can reuse an earlier one's read of the whole
article — but only on the same model. A typed *Look up* can reuse an ordinary comment's prefix; a
*Dig deeper* press is always `DIG_DEEPER_MODEL`, so on a standard-power article the first dig writes
that model's copy and later digs read it.

## See also

- [vision.md](vision.md#where-this-goes-after-granularity-zoom) — where "ask in place" sits in the plan
- [chat-tools.md § where a passage stands](chat-tools.md#and-so-is-asking-where-a-passage-stands-and-every-claim-says-where-it-came-from) —
  why a question asked from a comment reaches for the web, and marks what is not from the article
- [block-ids.md](block-ids.md) — the spine, and why losing an anchor beats moving it
- [web-client.md](web-client.md) — the reading view this hangs off
- [url-state.md](url-state.md) — `?note=` joins the family; why it replaces rather than pushes
- [setup-dev.md](setup-dev.md) — `OPENROUTER_API_KEY`
