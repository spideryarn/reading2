# Five small reports: tooltips, two labels, and one Metadata section

Five of Greg's own Feedback-dialog reports, all small, none built before (checked against `git log
origin/dev`, `docs/plans/`, `docs/user-feedback/` and `gjd-remote ls` on 2026-10-01). Their text is
in the note,
[261001_1200-five-small-tooltips-and-labels.md](../user-feedback/261001_1200-five-small-tooltips-and-labels.md).

## What we will do

### 1. Remember's *Reply* picker gets a card — `spya-xunuum`

`src/web/ChatPanel.tsx`, the `chat-stance` select. The native `title="How much the answer should
say"` becomes a `Tooltip` on the select (not the label: `Tooltip` describes its own child, and the
select is what a screen reader lands on — review finding 4), listing the four stances in a line each. The wording comes
from the prompt itself (`src/converse.ts` § RESPOND / SOCRATIC / SIGNPOSTS / BALANCED) and the table
in [remember-mode.md § One adaptive voice, which replaced the four stances](../project/learn-mode.md#one-adaptive-voice), plus the one
rule a reader could not guess: their own words beat the stance ("just tell me" is honoured on
Socratic).

The select keeps its own accessible name ("Reply", from the label). The card describes it.
Hovering the word *Reply* itself opens nothing; the select beside it is the larger target.

### 2. Topics in detail: a card on the bar, no "N of M", a narrower bar — `spya-f28vqj`

`src/web/ShelfTermsDetail.tsx`.

- `CountBar` gets a tooltip: what the bar is (how many articles in this view use the topic, against
  the topic with the most) and the number. The bar stays `aria-hidden`, because the number is on the
  chip beside it, so the card is for the pointer. **Review finding 2 declined**: it asked for the
  bar's meaning to be reachable by keyboard and screen reader too. The bar is a drawing of the
  chip's number against its neighbours; to somebody not seeing the bar there is nothing to explain,
  and a focusable `aria-hidden` element is itself an accessibility fault.
- The `N of M on the shelf` text in front of the titles goes. The chip's own card still says it, so
  nothing is lost.
- The bar's column goes from 4rem to 3rem.

**Not done here, and named:** the rest of that report — rich cards on the article links, and a
reusable "paper card" for every link to an article anywhere in the app. That is a new component with
its own data question (which facts, from which request), not a tooltip. Put to the Overseer as a
follow-up.

Greg also asked for the rule *"anything hard to guess should always have a tooltip"* to be written
down. It goes into [tooltips.md](../project/tooltips.md), quoted, which is not an entry point and so
needs no approval round.

### 3. The *Topics* label explains itself, and *Sort* goes — `spya-tw6zxw`

- `src/web/ShelfTerms.tsx`: the word *Topics* at the head of the row (in the normal state) becomes a
  dotted-underline `cursor-help` trigger, the convention Metadata already uses, with a card: what a
  topic is, and how they are picked and ordered — a program finds the phrases the articles use, a
  model scores how meaningful each is to this reader, and they are listed roughly in the order they
  were picked, each pick favouring a phrase that reaches articles the earlier ones covered less,
  weighted by that score, with near-copies left out or kept apart. (The first draft said "the most
  articles the ones before it had not reached", which is the lexicographic order `choose.ts` does
  not use — review finding 5.) The facts are
  [shelf-terms.md § Two steps](../project/shelf-terms.md#two-steps-and-only-the-first-is-stored) and
  [§ The model's judgement](../project/shelf-terms.md#the-models-judgement).
- Greg offered the alternative of making the order self-explanatory instead. Simpler first: the
  card. A visible re-ordering is a bigger change to a ranking that was chosen by an eval.
- `src/web/lib/DataTable.tsx` `SortChips` gains `labelHidden`; the shelf (`ShelfControls.tsx`)
  passes it, so the legend is still read to a screen reader but not drawn. Admin keeps its visible
  label.

### 4. The glossary's *asked, not checked* in plain words — `spya-puyb6d`

`src/web/GlossaryPanel.tsx` § `LookupAnswer`. The label becomes *searched the web* or *not searched —
answered from what the model already knows*; the card says the same in a sentence, with the date
and the model, as now.

**Not done here, and put to the Overseer:** the real cause of the confusion is that a button called
*Check the web* sometimes does not search — the model decides. Either the call should be made to
search, or the button renamed. That is a product call with a cost side. The answer's own wording is
`src/explain.ts`'s prompt, which comments share; changing it needs the measuring
[prompting-guide.md](../project/prompting-guide.md) asks for, so it is not part of a small change.
The citations Greg expected appear as new-tab links when the model searched **and** cited — a
search that cites nothing stores `searches > 0` with no sources (review finding 1), so even the
search case is not a guarantee of links.

### 5. Metadata: *What we did to it* joins *Re-run AI processing* — `spya-qgh5ta`

`src/web/Metadata.tsx`. One section, **AI processing**, where *Re-run AI processing* stands now
(just above Archive), shut by default and `keepMounted` as before. Inside: the High-power switch, the
re-run card as it is, then the subheading *What we did to it* and the stage rows, moved out of
*Technical details*. Its heading's aside is the `N of M stages · last wrote …` line that was on
*Technical details*.

- The rule that came with the stage rows comes with them: the section is collapsible only while the
  stage request has not failed, and a failure draws it open with the error at the top. *Technical
  details* keeps its identifiers and fingerprint and becomes always collapsible.
- The two halves stay separate components inside the one section: `RerunSection`'s own comment
  explains why the record and the menu are not one list (an eligibility branch in every stage row),
  and that still holds. Merging the section is what was asked.

**The simpler option passed over:** leaving the two sections and moving *Technical details* next to
*Re-run*. It would put them side by side without amalgamating anything, which is what the report
asks for.

## The plan review, and what changed

GPT Sol, read-only, 2026-10-01: seven findings. Taken: 3 (`metadata-step-timing` opens the old
section), 4 (the card belongs on the select), 5 (the ordering copy), 7 (docs that name the old
section, `shelf-terms.md`'s *7 of 38*). Declined: 2, above. Put to the Overseer rather than built:
1 (make *Check the web* always search, or rename it) and 6 (rich cards on the detail view's article
links) — both are the larger halves of their reports, named here and in the note, so the note's
*shipped* is for the parts the reports turned on and not a claim that nothing is left. The review
agreed the Metadata design keeps both rules: open on error, and `keepMounted`.

## The code review, and the browser

GPT Sol, `workspace-write`, 2026-10-01, fixed what it found: the Balanced and Signposts lines said
more than the prompt does; the *Topics* card hid the program's fallback; a glossary answer that
searched but cited nothing still said *"the sources below"* (now it says it cited none, with a
test); and present-tense mentions of the old section name in `PageContents.tsx`,
`experimental-features.md` and tests. Its *Topics* wording was then cut back to plain words, keeping
each fact. It found nothing wrong in the Metadata merge's error rule, `keepMounted`, or the contents
list.

Playwright at 1280 and 390, on the worktree's own server: all four surfaces open their cards, nothing
clipped or overflowing at 390, Metadata's order is right. It found one bug: the *Topics* label drew
a dotted **box**, because `border-dotted` styles all four sides and this app has no preflight to
zero them — `border-0` first, as Metadata's dotted triggers already do. The glossary label was not
checked in a browser (no stored answer to look at without spending a model call); its two branches
are unit-tested.

## Checks

- `tests/metadata-page-order.test.tsx`, `metadata-rerun-section`, `metadata-reset-section` move to
  the new section name and the error rule's new home; a test for the bar's card and the missing
  "N of M"; a test that the shelf's sort legend is hidden and Admin's is not.
- `npm test`, `npm run typecheck`, lint on the files touched.
- Playwright at desktop and 390px: the Reply card, the Topics card, the detail view's bar card and
  width, Metadata's merged section.
- GPT Sol on this plan (read-only), and on the code (it fixes what it finds).
