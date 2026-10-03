# Citation marks break the line, because a chat chip's class shares their name

Up: [plans.md](../project/plans.md) · report `spya-trg9kz` ·
note: [261003_1425](../user-feedback/261003_1425-weird-line-breaks-around-cited-clauses.md) ·
postmortem: [261003e](../postmortems/261003e-two-components-sharing-one-bare-class-name.md)

Greg, 2026-10-03, from the Feedback button on an Entropy paper:

> Sometimes the formatting gets a bit messed up around footnotes, I think. Like there's weird line
> breaks. Here's an example.

## What is actually wrong

The brief guessed at extraction. It is not extraction, and the stored block is fine.

Production's block `spya-tgqpmx` (read inside `begin read only`) is one `<p>` with no markup in it,
no `<br>` and no newline. The report's screenshot shows the break: each clause that carries a
citation (`…moved into naïve subjects [111–119]`) sits on lines of its own, and the comma after it
starts the next line.

The cause is in the reading view's stylesheets:

- A citation's words in the prose are `<mark class="cite">` (`annotate.ts`, since 2026-09-16).
- The chips a model's answer cites blocks with are `<span class="cite">` (`Cited.tsx`), styled by
  `.cite { display: inline-flex; gap: 0.2rem; margin: 0 0.1rem }` in `mode-band.css`, written
  2026-08-26.
- The chip's selector is bare, so it matches the mark. `mark.cite` sets no `display`, so the
  chip's wins. An `inline-flex` box is atomic: when it does not fit on the line it moves to the next
  one whole, and what follows it starts after the box.

Measured in Chrome with the real sheets: `mark.cite` computes `display: inline-flex`; the other five
mark kinds compute `inline`.

It has been true since 2026-09-16 (`5c8e4213e`, the commit that made a citation a mark). A mark
covers the words the citation was found on, which is `[113]` for some and a whole clause for others,
and only a mark too long for the rest of its line breaks. How many articles showed it before this
report was not measured.

## The fix

**Rename the chip's class from `cite` to `cite-chips`**: `Cited.tsx`, the three rules in
`mode-band.css`, the two in `quiz.css`, and the four tests that select it. After that nothing in the
sheets says `.cite` without `mark` in front.

**The simpler option passed over** is one token: `span.cite` or `.cite:not(mark)` on the chip's
rule. It fixes this report. It leaves two unrelated things answering to one class name, and the
next rule written for either (`.cite .block-ref` is already a second one) has the same reach. The
rename is seven lines more and removes the shared name.

**Renaming the mark's class instead** was not considered for long: `mark.cite` is named in the hover
card, the flash, the row lookup, the sanitiser's comment and a dozen tests.

## Tests

1. `tests/prose-marks-stay-inline-in-chrome.test.ts`, written first and seen red
   (`mark.cite is not an inline: expected 'inline-flex' to be 'inline'`). It draws the opening of the
   real block through `annotateHtml`, once per `MarkKind`, in Chrome with the reader's sheets, and
   asserts the mark is an inline, starts on the line the previous word is on, and that the comma
   after it stays on the line it ends on. Each kind has a control: with the chip's old rule
   forced onto that class the fixture must break, so a column too wide to break cannot pass.
2. A static guard in the same file, no Chrome needed: no selector in the reader's sheets names a
   `MarkKind` class (`.cmt`, `.chat`, `.term`, `.hit`, `.cite`, `.xref`) on anything but a `mark`.
   This is the check for the class of bug rather than the instance, and it runs where the Chrome
   test is skipped. Against the pre-fix HEAD, only `.cite` trips it.

## Not doing

- **The footnote digits.** The same block stores its footnote markers as bare digits glued to the
  word, some with a space before the punctuation (`remarkable28`, `memories29 ,`). That is a real
  defect of the PDF path on an article imported before footnotes were linked (`ebee390cd`, dated
  2026-10-01; the plan was 2026-09-30), it is not
  what the screenshot shows, and a re-import (not tried) is what would run the linking over it. Named in the debrief as a
  question for Greg rather than built here.
- No browser pass over production: the change is not deployed by this session.

## Reviews

- **Plan, GPT Sol, 2026-10-03** ([answer](261003l-plan-review-sol.md)): build with changes. No P0
  or P1; the diagnosis and the rename's scope confirmed. One P2, taken: the static guard accepted
  any `mark` after a `(`, so `:not(mark.xref).cite` passed it while matching a citation's mark. The
  guard now asks whether the class's own element is constrained to a `mark`, and that selector is
  one of its tests.
- **Code, GPT Sol, 2026-10-03**: the guard still accepted comma-truncated compounds, could hide an
  earlier class occurrence behind a later one, and treated marks inside negations as positive
  constraints. The bypasses were reproduced with failing tests, then fixed by retaining function
  context across argument boundaries, checking every occurrence, and inspecting outer negations
  first. The static guard passes over the real sheets. Chrome could not launch in the review
  sandbox (`setsockopt: Operation not permitted`), so this review did not verify layout. Git also
  corrected the postmortem's August recipient (summaries, not Quiz), the test's three-week interval,
  and the footnote linking date. The Chrome test's name and the plan now describe its comma check.
