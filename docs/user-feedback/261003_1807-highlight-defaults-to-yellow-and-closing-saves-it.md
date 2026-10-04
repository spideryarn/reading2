---
reports: spya-ur8kum
ending: shipped
---
# A highlight defaults to yellow, and closing the box saves it

Report `spya-ur8kum` (Sentry `SPIDERYARN-READING2-BF`), a suggestion, from Greg (admin), 2026-10-03
18:07 UTC, filed from `https://www.spideryarn.com/changelog#release-122`:

> I like the new human highlights when I select text - can we default to the yellow colour, and
> default to saving it, so that it requires fewer clicks?

**Ending: Shipped**, on `dev`. Plan:
[261004a](../plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md).
It builds on `spya-rze8qh` ([261003e](../plans/261003e-span-highlights-with-a-colour.md)) and the
[iPad note](261003_0929-highlighting-on-an-ipad-and-highlights-in-quotes.md).

## What changed

Select words and the box opens **with yellow already picked**. Then any one of Save, the × or
Escape saves the highlight. It was two presses (the yellow dot, then Save); it is one, and Escape
needs no pointer at all. Discard keeps nothing.

Three cases where closing does not save, each on purpose:

- **Selecting something else, or leaving the page, without having done anything in the box** saves
  nothing. Otherwise every mis-drag with the mouse would leave a yellow highlight behind.
- **Copy, then close** saves nothing. You wanted the sentence. The box says so as soon as you press
  Copy, and Save still saves.
- **Referee mode** still opens with no colour, and works as before.

Checked in tests and in a browser (Playwright on the box: desktop, an iPad profile with a synthetic
selection, a phone width; 14 of 14). **Not tried on a physical iPad.** GPT Sol reviewed the plan
(six changes, all taken) and the code (three fixes, made).

## Questions

**[Q-save-on-select]** Should selecting words save the highlight with no press at all? Queue item
`qi-tymfbk48`.

Background: as built, one press or Escape saves. The step further is to save the moment you let go
of the mouse (or tap *Highlight or comment* on an iPad), and show the box only to change it.

- **A (as built): one press saves.** Selecting to copy, or dragging again because you missed a
  word, leaves nothing behind.
- **B: saved the moment you select.** No press. The words turn yellow at once and a small box
  offers colours, a comment, Ask AI and *Remove*. About a day. It gives up clean copying: every
  selection, including one made only to copy or by a slip of the mouse, is a highlight until you
  remove it.
- **C: on a finger only.** On an iPad you already press *Highlight or comment*, a clear intent, so
  that press could save at once; a mouse keeps A. About half a day. It gives up the two behaving
  alike.

Recommendation: **A, then C if one press still feels like one too many on the iPad.** B is right if
you rarely select text for any other reason and removing a stray highlight would not bother you.

**[Q-ask-ai-colour]** When you select a word and press Ask AI, should the word also become a yellow
highlight, and so a row in Quotes?

- **A (as built): yes.** The box shows yellow, so it stores yellow. Pick "no colour" first to avoid
  it.
- **B: no.** Ask AI stores the comment with no colour unless you pressed one, so a word you only
  asked about stays out of Quotes. About an hour. It gives up the box storing exactly what it shows.

Recommendation: **A** until it annoys; B is cheap to switch to.
