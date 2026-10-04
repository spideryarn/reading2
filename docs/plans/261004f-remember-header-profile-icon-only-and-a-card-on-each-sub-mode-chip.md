# Remember's header: the profile badge as an icon, a card on each sub-mode chip, and an (i) in short pieces

Three of Greg's own Feedback-dialog reports, filed 2026-10-04 on
`?mode=remember`, all about the top of the Remember band. None was built before: checked against
`docs/plans/`, `docs/user-feedback/`, `git log origin/dev` and `gjd-remote ls` on 2026-10-04 (the only
session on the subject is this one). Queue entry `qi-r88mcqag`.

> In remember mode, you don't need the words written for you at the top. Just the little profile icon
> should be sufficient with a rich tooltip, and the same goes for any other modes.
>
> — Greg, 2026-10-04, `spya-pmjy40`

> Provide rich tooltips for the remember mode submode buttons ant the top and any other submodes.
>
> — Greg, 2026-10-04, `spya-wbhrm7`

> In the remember mode information tooltip, you do describe all of the different submodes, but in a
> previous feedback I said that each submode button should have its own tooltip. I still agree with
> that. I'd also say that for the rich tooltip for the remember mode information, it's like one big
> paragraph. Prefer smaller paragraphs or bullet points because it's much clearer.
>
> — Greg, 2026-10-04, `spya-usyhwy`

## Where things stand (read from the code, 2026-10-04)

- **The badge.** `WrittenForYou` (`src/web/WrittenForYou.tsx`) has a `compact` prop: an icon with no
  words. Six of its seven callers already pass it (Summary, Glossary, Quotes, Ideas, Tweets/Thread,
  Sketch). **Quiz is the only one that still prints "written for you" / "older profile"**
  (`QuizPanel.tsx`). The badge has no hover card anywhere, on purpose: `ProfilePanel.tsx` says *"a
  native tooltip on a button that opens a panel about the same subject is two explanations racing
  each other"*.
- **Sub-mode chips.** Summary (Brief | Fuller | Thread), Structure, Debate, Referee and Diagram each
  already wrap every chip in `Tooltip` + `ControlTip` inside a `TooltipGroup`. **Remember's
  `RememberSubModeToggle` (`QuizPanel.tsx`) is the only one with no card.**
- **Remember's (i).** In Recall, Tutorial and Explore the band is `ChatPanel`, which gives
  `ModeSurface` `mode="remember"`, so the card is `MODE_CATALOG.remember.description` and then
  `MODE_CATALOG.remember.how`, a single 110-word paragraph that walks through three sub-modes. The
  same paragraph is the second half of the Dock's card on the Remember button. In Quiz the (i) is
  `QuizAbout`, which is already short.

## What we will do

### 1. The badge is always an icon, and it gets a card — `spya-pmjy40`

- `WrittenForYou` loses its `compact` prop and its words: it is always the icon (`UserRound`, or
  `UserRoundPen` in the `.changed` colour). Every caller drops `compact`; Quiz gets the icon by
  doing nothing. The `icon-only` class goes on unconditionally so the CSS that sizes it is unchanged;
  the now-dead words-pill rules are removed only where nothing else uses them.
- The trigger is wrapped in our `Tooltip` with a `ControlTip`, inside `ProfilePanel` (which owns the
  button), **enabled only while the panel is closed**. That answers the "two explanations racing"
  objection: the card is up before the press, the panel after it, never both. Words:

  | | written for the current profile | written for an older one |
  |---|---|---|
  | head | Written for your profile | Written for an older profile |
  | what | This was written with your profile in mind. | This was written for your profile as it was before you last changed it. |
  | how | Your profile is what you have said about yourself and why you are reading this piece. | *(same)* |
  | press | Shows your profile, to read or edit here. | Shows your profile, to read or edit here, and offers to write this again for it. *(only when the caller passes `regenerate`; otherwise the first form)* |

  The builder checks each sentence against `ProfilePanel.tsx` and
  [reader-profile.md](../project/reader-profile.md) (what the two boxes are called on screen) and
  corrects the words to match.
- The button keeps its `aria-label`. `Tooltip` adds `aria-describedby` to the card while open.
- **Touch.** A tap opens the panel, as now. The card is for a pointer and for keyboard focus; the
  panel's first line (`note`) still says in words which state it is, so a finger loses nothing.

**Passed over:** leaving `compact` as a prop with the default flipped. Nothing would pass `false`,
and a switch no caller sets is a second way to draw the badge waiting to be used by accident.

### 2. A card on each Remember chip — `spya-wbhrm7`, and the first half of `spya-usyhwy`

`RememberSubModeToggle` gets what the other five toggles have: `TooltipGroup`, and on each button a
`Tooltip placement="bottom" keepSide className="tip-soon"` holding a `ControlTip`:

- `head` — `REMEMBER_SUB_MODES[view].label`
- `what` — `REMEMBER_SUB_MODES[view].description` (the command bar's line, already written)
- `how` — a new `REMEMBER_VIEW_HOW` record beside the toggle, the way Structure's and Debate's
  `VIEW_HOW` sit beside theirs. These are the sentences that move out of the catalog paragraph, so
  each is already a checked claim; Quiz's is new and is checked against `quiz.md` and
  `activation.ts`:

  | view | how |
  |---|---|
  | Recall | Nothing runs until you have said or typed what you took from the piece. One adaptive voice corrects briefly, then usually nudges you to remember a little more; if you are stuck, it fills the gap instead. Its replies point back to the passages they use. |
  | Tutorial | It waits on you too. It is about what the author says, and works even if you have not read the piece yet. |
  | Explore | It is sent what you have highlighted, noted and discussed on this article, starts from that, and may search the web to show where the piece stands. |
  | Quiz | Pressing it writes the questions if there are none yet. Each answer is marked by a model against the passages the question came from. |

The buttons stay `aria-pressed` toggle buttons with words on them; only the card is added. The
click handler (arming Quiz) is untouched.

**"And any other submodes"**: the other five toggles already have a card per chip (listed above),
so nothing changes there. The plan review is asked to check that claim rather than take it.

### 3. Remember's (i) in short pieces — the second half of `spya-usyhwy`

- `MODE_CATALOG.remember.how` becomes two short sentences that are true of the mode as a whole,
  because the per-sub-mode detail now lives on the chips:

  > Recall, Tutorial and Explore are conversations, and each waits on you: nothing runs until you
  > say or type something. Quiz writes its questions from the piece and marks your answers against
  > it.

  This also shortens the Dock card on the Remember button, which shows the same string. The test
  that pins *"One adaptive voice"* in the catalog (`tests/mode-catalog.test.ts`) moves to the Recall
  chip's words.
- Under those, Remember's (i) gets **a four-item list, one line per sub-mode**: the label in bold
  and its `REMEMBER_SUB_MODES` description. `ChatPanel` passes it as `about` when it is Remember's
  band. It stays in the (i) as well as on the chips because **a chip's card never opens on a touch
  screen** (a tap presses the chip), and the (i) does open on a tap.

  ```
  (i)
  Work the piece into memory through Recall, a short Tutorial or a Quiz, or Explore …
  Recall, Tutorial and Explore are conversations, and each waits on you: …

   • Recall — Say what you took from the piece, and find out where it holds up
   • Tutorial — Short turns: a little of the piece at a time, then a question …
   • Explore — Think it through for yourself: starts from what you have marked …
   • Quiz — The piece asks you questions, and your answers are marked against it
  ```

  Quiz's (i) (`QuizAbout`) is left alone: it is three short paragraphs already.
- A list style for `.band-about-card ul` in `mode-band.css`, since no (i) has had a list before.
- Greg's rule goes into [tooltips.md](../project/tooltips.md), quoted: prefer short paragraphs or
  bullets in a card. tooltips.md is not an entry point, so no approval round.

**Passed over:** leaving the catalog paragraph as it is and only splitting it into sentences for
the (i). That would keep two descriptions of every sub-mode (the paragraph and the chip), and the
Dock's card would still be the one big paragraph.

## Tests (each seen red first)

- `tests/profile-panel.test.tsx` or a new small file: the Quiz header's badge has no "written for
  you" text; the badge's card says the head for each state; the card is not open while the panel is.
- A test that renders `RememberSubModeToggle` and, on focus of each chip, finds that chip's `how`.
- `tests/mode-catalog.test.ts`: the Remember pin moves; a new check that `remember.how` is under
  ~45 words, so it cannot quietly grow back into the paragraph.
- A render of Remember's (i) content that finds four list items.
- Existing suites that name the words (`quiz-regenerate-revalidation`, `glossary-compact-header`,
  `no-profile-row-beside-paid-buttons`, `every-mode-draws-its-surface`, `pressing-a-chip-arms-it`,
  `touch-controls`) re-run and are updated where they pinned the old words.

Then `npm test`, `npm run typecheck`, lint on the touched files, and a browser look (a Sonnet
subagent, Playwright on the box) at: the Quiz header, each chip's card, the (i) in Recall, the Dock
card on Remember, and the badge in Summary and Glossary, in light and dark and at phone width.

## Docs to touch

`reader-profile.md` and `quiz.md` (the badge has no words), `remember-mode.md` (chips have cards,
the (i) has a list), `tooltips.md` (Greg's rule; the badge's card in the file table), `mode.md` only
if its (i) section needs to say a list is allowed (signposting, not a rule change). The header
comments in `WrittenForYou.tsx`, `ProfilePanel.tsx` and `QuizPanel.tsx` that explain the old choices
are rewritten to say what changed and why, with Greg's words.

## Deferred, and named

- **Other modes' (i) cards that are one long paragraph.** Greg's report is about Remember's; a
  sweep of all fourteen `MODE_CATALOG.how` strings for length is a separate, larger copy job where
  every sentence is a checked claim. Queue entry to be added, with `spya-usyhwy` as its source.

## Questions

None for Greg. One judgement call made here and open to the review: keeping the one-line-per-sub-mode
list in the (i) although each chip now has its own card (the touch-screen reason above).

## One stage

Small enough for one stage: build, test, browser look, GPT Sol code review (`workspace-write`),
commit, push.

## Plan review (GPT Sol, 2026-10-04): approve with changes

[The review](261004f-remember-header-plan-review-sol.md). Six findings, all taken:

1. **Explore's card overstated what is sent.** Earlier conversations go as a list the model may open,
   not as their text. The card now says: *"It is sent your highlights and notes, plus a list of your
   earlier conversations. It can open one of those and may search the web when useful."*
2. **Three consumers missed**: the Help copy that promises a visible "written for you" label
   (`help-topics.tsx`), `mode.md`'s instruction to pass `compact` (now an unconditional edit), and the
   Help page, which prints the catalog's `how` (`help-page.test.tsx` joins the tests to run).
3. **The badge card repeated its own heading.** `what` becomes the operational fact: *"The AI used
   both parts of your profile, About you and Why you're reading this one, when it wrote this."* and,
   for the older state, that it used an earlier version of them. The separate `how` row goes.
4. **Quiz's marking was described too narrowly.** *"A model compares each answer with the article,
   using the question's reference passages."*
5. **"The only one without cards" is true of registered sub-modes only.** Quotes' ordering chips and
   Skim's depth selector are not sub-modes (sub-modes.ts says so) and stay out of scope.
6. **"Never both" was too strong.** The card starts closing when the panel opens. The Tooltip is
   **controlled**, which makes its hover `mouseOnly`, so a finger never opens it; tests assert one
   click opens the panel and that `aria-haspopup`, `aria-expanded` and Escape still work.

## What landed (2026-10-04)

Built as planned, in one stage (commit `1019c380d`, then the review fixes).

**Browser check** (a Sonnet subagent, Playwright on the box, article `fowler-phrenology`): all five
passed. Each chip opens its own card and none covers its neighbours, at 1440px and 390px; the (i) is
a line, two sentences and four bullets, in light and dark; Quiz's header has the icon and no words,
its card opens on hover and goes when the panel opens, and does not come back when Escape closes the
panel; the bottom bar's Remember card has the short paragraph; a tap at 390px opens the panel and no
card. Shots: `261004f-shot-1-chip-card.png` to `261004f-shot-5-touch-tap.png`. The *older profile*
variant of the card was not seen in the browser, only in the test.

**Code review (GPT Sol): approve with fixes applied.**
[The review](261004f-remember-header-code-review-sol.md). What it changed, all read and kept:

1. **A real bug**: closing the panel returns focus to the icon, and the card read that as a new
   keyboard focus and reopened. Fixed in `ProfilePanel.tsx` with a one-event focus suppression, and a
   test that was red before the fix.
2. **Three sentences were stronger than the code.** "Nothing runs until…" became "the AI does not
   reply until…" (opening Remember creates its empty thread); Recall's replies *are asked to* point
   back to passages; the badge card says the AI used *About you, Why you're reading this one, or
   both*, and that it *is told* never to change what the article says.
3. **Help said every mode offers to rewrite.** Quotes' control adds to the list instead, and the
   Help copy and the FAQ entry now say so and describe the icon rather than the old words.
4. Dead word-pill CSS removed; comments and docs that called it the *written for you* badge now say
   profile icon; the tests gained touch, ARIA, layout, arming and keyboard cases.

Two small edits of mine on top: Recall's last sentence reworded, and reader-profile.md's table says
Sketch's icon is in the picture's own bar.

**Wider than this stage, reported by the review and left alone:** `every-mode-draws-its-surface`
passes while logging an undefined `profileHash` exception from `useQuiz.ts` — a fixture or
error-reporting problem that was there before this change.

**Deferred:** the sweep of other modes' long cards, queue entry `qi-mw43dd2y`.
