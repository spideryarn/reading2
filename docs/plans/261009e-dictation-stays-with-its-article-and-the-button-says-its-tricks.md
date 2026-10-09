# A dictation stays with its article, and the microphone says its tricks

Two admin reports from Greg, 2026-10-09, and one addendum from the Overseer, all about
[dictation](../project/dictation.md).

> I was in the guide chat for a previous article. The attention is all you need one, and I guess
> there was some kind of error, maybe with voice dictation. All I know is I now opened up this article
> for the first time. It shows me the guide chat, and underneath, Why you're reading this, it says
> there was a problem with the voice transcript or whatever. And so I said, try again. And so it
> pasted in the voice dictation that I had written for the previous article. … Let's do a kind of
> careful trawl of any place we're using voice dictation and check that we aren't going to be
> accidentally pasting in stuff across articles or in other ways that are inappropriate.
>
> — Greg, 2026-10-09 02:05 UTC (`spya-vzj8fc`)

> I think we've set it up so that most of the voice dictation buttons actually allow you to double
> click. That should be in a tooltip (see `tooltips.md`). And any time there's a keyboard shortcut or
> a hard-to-discover trick like double-clicking, it should be in the tooltip. And make a minimal
> update to appropriate doc(s) about that rule.
>
> And more generally, I feel like the voice dictation button should have a tooltip. … It would say
> things like, there's a 15 minute limit … And just to encourage people to use it because … they talk
> more and provide more context to the agents. Maybe we should say that somewhere in the Help
> documentation as well.
>
> — Greg, 2026-10-09 02:07 UTC (`spya-xdvnrg`)

The Overseer's addendum: [261009a](261009a-dictation-transcript-lands-in-the-next-box.md) left Chat's
keeper per article, not per conversation, so a recording left in one conversation could be offered
in another on the same article. Fixed here as part of the trawl.

Prior work: [261009a](261009a-dictation-transcript-lands-in-the-next-box.md) bound every delivery to
the keeper's box name; [260929h](260929h-dictation-that-survives-a-closed-tab.md) made the keeper.
Nothing in `docs/user-feedback/` or `gjd-remote ls` covered either report.

## The bug, and its class

A dictation that never reached its box is kept on the device under a **box name**, and offered back
the next time a box *with the same name* is on screen (dictation-keep.ts § Three partitions). The
four *Why you're reading this one* boxes — the first-open prompt, the profile popover, Metadata, and
the guide's greeting — are per article, but `ProfileBox` named its keeper `profile:<element id>`,
the same on every article. So Greg's tape, left behind on *Attention is all you need* (the page
went away while its words were failing or on their way), was recovered by the guide's box on the
next article, and Try again put it there.

The in-memory path was not involved: the reading view remounts per article
(`<OwnedArticle key={slug}>`, ArticlePage.tsx). And since 261009a the box name is also what binds a
live dictation to its box, so a name that is too broad defeats both.

**The class: a partition key coarser than the thing it partitions.** The name had to be "what the
words are about", and for these boxes that includes the article.

## The fix

The keeper's name carries everything the words are about:

| Box | Was | Now |
|---|---|---|
| *Why you're reading this one* ×4 | `profile:<id>` | `profile:<id>:<slug>` — `ProfileBox` takes a **required** `article: string \| null`, so a new caller cannot forget it |
| About you ×2 (`/profile`, popover) | `profile:<id>` | unchanged (`article={null}`): one field for every article |
| Chat, a conversation | `chat:<slug>` | `chat:<slug>:<thread id>` |
| Chat, the new-conversation box | `chat:<slug>` | `chat:<slug>:new:<kind>` (Learn shares the panel) |
| Chat dialog, a passage draft | `chat:<slug>` | `chat:<slug>:draft:<block>` — the dialog is not remounted per passage, so this also stops a live transcript landing in the next passage's draft |
| Annotate | `annotate:<annotateKey>` | `annotate:<slug>:<annotateKey>` — block ids are unique within an article, not across |
| Command bar | `commands` | `commands:<slug>` — a phrase said on one article was offered on the next, transcribed against the first and run on the second |

`Composer` takes the name as a required `keepAs`, so each of its three callers says what it is about.

Tapes kept under an old name are never offered again and are swept after a week (`MAX_AGE_MS`), or
at sign-out. A `profile:*-purpose` tape cannot be migrated: its `where` has no slug.

### Passed over

- **One name per field, `purpose:<slug>`, shared by the four boxes.** Arguably truer (it is one
  field), but it changes which box offers a tape back as well as fixing the leak, and two of those
  boxes can be on one page at once. Adding the slug to the existing name is the smaller change.
- **Send `{kind: "article", slug}` as the purpose box's transcription context**, so the vocabulary
  fits the article. A nicety, not this bug; left.

## The trawl

Every place dictation is used (`useDictationField(`, `keepDictation(`, `useDictation(`), checked for
a stored or retried recording crossing articles, conversations, boxes, users or tabs. An Opus
subagent read the code; I checked the leaks it found.

| Site | Keeper | Verdict |
|---|---|---|
| `ProfileBox` — `prompt-purpose`, `panel-purpose`, `guide-purpose`, `article-purpose` | `profile:<id>:<slug>` | **Leaked across articles** (the report). Fixed. |
| `ProfileBox` — `reader-profile`, `panel-profile` (About you) | `profile:<id>` | Safe: one field for every article. |
| `ChatPanel` — a conversation | `chat:<slug>:<thread>` | **Leaked across conversations** (the addendum). Fixed. Conversation is keyed by thread id, so the name cannot change under a live dictation. |
| `ChatPanel` — the new-conversation box | `chat:<slug>:new:<kind>` | Same leak; fixed. |
| `ChatDialog` — a passage draft | `chat:<slug>:draft:<block>` | **Leaked across passages, in memory too** (the dialog is not keyed per target). Fixed. |
| `CommentDialog` | `comment:<id>` | Safe: ids are global; reuse across comments is 261009a's. |
| `AnnotateDialog` | `annotate:<slug>:<key>` | Only in theory (a copied article with the same block, offset and quote). Fixed, one line. |
| `QuizPanel` | `quiz:<slug>:<question>` | Safe: question ids are random. |
| `IllustratedView` | `illustrated:<slug>` | Safe: one note box per article. |
| `FeedbackDialog` | `feedback`, only while open | Safe, and site-wide by design (260929h). |
| `FeedbackEarlier` reply | `feedback-reply:<question>`, only while seen | Safe. |
| `CommandBar` | `commands:<slug>`, only while open | **Crossed articles** (minor). Fixed. |
| `HelpAsk` | `help-ask` | Safe: Help is not about an article. |
| Fleet dashboard (`useFleetDictation`: `SessionDetail`, `NewSessionPanel`) | no keeper | Safe: nothing is kept; `SessionDetail` is keyed per session. Its own `DictationControl` gets no card here: the dashboard is the admin's, not a reader's. |
| Live conversation, Learn | no dictation hook of their own | n/a |

**Users: safe.** Tapes carry the signed-in id and are recovered only by an exact match; a lapsed
session clears the remembered user; a switch mid-page is refused by `recordingReaders`
(dictation-upload.ts); sign-out deletes the tapes. **Server: safe.** `/api/transcribe` is stateless —
no upload id to fetch or finish — and the vocabulary is read under the caller's own owner id.
**Tabs: safe.** A Web Lock per tape, recovery with `ifAvailable`.

**Limit:** a tab still running the old build keeps the old names until it reloads.

## The card on the microphone

`DictationButton` gets a `ControlTip`, only while idle (over Stop it would be the wrong words, and a
card opening mid-double-press is in the way), and not offline (the `title` there already says why
the button is dead):

- **what**: talk instead of typing; most people say more out loud than they would type, and that
  context helps the AI.
- **how**: fifteen minutes (`MAX_MS`), with a warning a minute before. Not the privacy promise,
  which is already the button's description (Sol F2).
- **press**, only on a box that takes a double press (`useDictationField().doubleStop`, i.e. it has
  an `onDone`): *Press Stop twice quickly to send as soon as the words arrive* — *to press Enter* in
  the command bar, *to save* in the annotate box (a new `DoneAction`, `save`, which also corrects
  that box's strip, which said "sending").

**Limit: a finger does not see it.** It is a hover and focus card, and a tap on the microphone
starts it. Help's Chat page carries the same three things, which is where a phone reader finds them;
a separate (i) beside every microphone was passed over as clutter on eleven boxes.

There is no keyboard shortcut for the microphone, so there is none to name.

The rule goes in [tooltips.md § A shortcut is named on its card](../project/tooltips.md#a-shortcut-is-named-on-its-card),
widened by a sentence to hard-to-discover gestures, quoting Greg. Help's Chat page gets a line on why
dictation is worth it, in the paragraph that already describes it.

## Tests (red first)

- `tests/dictation-keeper-per-article.test.tsx` — each purpose box's keeper differs between two
  articles and names the second; About you's has no article. Red before (`profile:guide-purpose` both
  times).
- `tests/chat-dictation-keeper-per-conversation.test.tsx` — the composer keeps under the name it is
  given, and the real ChatPanel and ChatDialog callers name the open conversation, new-conversation
  kind and passage draft. Red with the old line restored (`chat:a-piece`).
- `tests/dictation-button-card.test.tsx` — the card's words, its merged accessible description, the
  double press only where it applies, its live second-click path, Enter in the command bar, Save in
  Annotate's card and strip, and no card while recording.

The required props (`article`, `keepAs`) make every caller say what it is about; the compiler is the
check for the call sites.

## GPT Sol's plan review, and what was taken

[The review](261009e-dictation-stays-with-its-article-plan-review-sol.md) (run after a first draft of
the code, read-only) agreed the root cause and the trawl, and found the problems in the card:

- **F1, taken.** Annotate's double press saves, and its card said "send" (and its strip said
  "sending"). `DoneAction` gains `save`; the inventory in dictation.md was also wrong (it omitted
  Help's Ask box) and is corrected.
- **F2, taken.** The privacy sentence was in the card and in the button's description, which the
  card joins, so it was read twice. Out of the card.
- **F3, taken as a limit** (above): touch readers get Help, not the card.
- **F4, taken.** No card on a button the box has switched off.
- **F5, taken** in the trawl table: the fleet's new-session box, and why the fleet gets no card.
- **F6, taken in code review.** `keepAs` being required stops an omission but not a caller choosing
  the old article-wide name. The regression test now renders the real ChatPanel and ChatDialog
  callers as well as checking the Composer seam.

## Browser check

A Sonnet subagent, Playwright on the box with system Chrome, `fowler-phrenology`, at 1440 and 390
wide. The box has no microphone, so `getUserMedia` was given an oscillator stream (a real
MediaRecorder behind it) and `/api/transcribe` was held in flight. Chat's composer: the card reads as
written, with the double-press line, sits above the microphone without covering it, keeps a 13px
gutter at 390, and is gone while recording; the tape in IndexedDB is `chat:fowler-phrenology:new:chat`.
Metadata's *Why you're reading this one*: the card has no double-press line, and the tape is
`profile:article-purpose:fowler-phrenology`. Not checked in the browser: the guide greeting, the
command bar and annotate cards, a conversation's thread id in the name (tests cover those).
Shots: `261009e-shot-1-desktop.png`, `261009e-shot-2-phone.png`,
`261009e-shot-3-desktop-metadata.png`, `261009e-shot-4-phone-metadata.png`.

## GPT Sol's code review

[The review](261009e-dictation-stays-with-its-article-code-review-sol.md) approved after fixing four
things inside the stage: Help's Chat page and dictation.md still said Annotate's double press sends
(F1); the card test now covers the description merge, the live `again` window and Annotate's strip
(F2); the chat test now renders the real `ChatPanel` and `ChatDialog` callers (F3, which reverses
the plan-stage F6 decline above); and the keeper examples in `dictation-keep.ts` and `transcriber.ts`
still showed `chat:<slug>` (F4).
