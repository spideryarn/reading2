---
reports: spya-ubbygh
ending: shipped
comment: Search mode's box has the same microphone as every other box, in both matchers. Half-heard words never start a search; the words search once they land, and Stop pressed twice (or Enter) searches straight away.
---
# A microphone in Search mode

`spya-ubbygh` (#746), suggestion, from Greg (admin; `feedback-reporter.ts` exit 0, re-read before
this note, no addenda), 2026-11-02 23:07 UTC, on `/read/constitution?mode=search`. Plan
[261103a](../plans/261103a-microphone-in-the-search-box.md).

> Search should have a microphone dictation button

**Ending: Shipped**, on `dev`.

Prior work: [261019_2154](261019_2154-a-microphone-on-the-add-page-and-on-every-prose-box-by-default.md)
put a microphone on every prose box but *not a search* (Greg, 2026-10-20: *"not … the search bar on
the homepage"*). This report asks for the exception by name, and Search mode's meaning matcher
takes a description, which is prose. The shelf's filter and the Dock's quick-search box stay
without. controls.md's rule row is unchanged; the exception is written in dictation.md and
search.md.

What changed:

- **The shared control.** `useDictationField`, `DictationButton` and `DictationStrip`, the same as
  the command bar's, to the right of the field in both matchers.
- **Half-heard words never search.** The box searches as you pause, and a pause asks a paid quick
  search. So while the microphone is on, neither Chromium's live guesses nor keys typed meanwhile
  reach the typing session. The landed words reach it once, and from there they behave like typed
  words. After a failed transcription nothing is searched.
- **Enter, *find*, or Stop pressed twice** stop the microphone and search when the words land, as
  Feedback's Send does. A wish made in words mode is withdrawn if the toggle moves to meaning
  first.
- Help's Search page says the microphone is there.

Tests: `tests/search-box-dictation.test.tsx` (twelve, each seen red first). Two GPT Sol reviews (plan, code),
in `docs/plans/261103a-*-sol.md`.
