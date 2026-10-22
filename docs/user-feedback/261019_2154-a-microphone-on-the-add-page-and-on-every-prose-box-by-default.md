---
reports: spya-wc4vku
ending: shipped
comment: Both add-page boxes now have a microphone, and the page waits while you dictate. So do Skim's purpose, Referee's criterion, the Candidates scope and a comment's note. controls.md says so; a test fails on any new writing box without one.
---
# A microphone on the add page, and on every prose box by default

`spya-wc4vku` (#658, `SPIDERYARN-READING2-MQ`), suggestion, from Greg (admin; `feedback-reporter.ts`
exit 0, re-read before this note, no addenda), 2026-10-19 21:54 UTC, from `/`. Overseer queue item
`qi-syvf7st3`. Plan
[261020r](../plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md).

> In the sort of page that shows after they add something while it's importing, make sure there's a
> dictation button next to the Why are you reading this? input box. And indeed, we really want a
> dictate button next to pretty much all of our input boxes that are going to have more than a few
> words of text typed into them. Let's make a minimal tweak to our docs and/or design system to make
> this more likely going forwards.

Handed back unbuilt by
[261020a § C2](../plans/261020a-add-page-asks-why-higher-and-about-you-says-when-it-is-ready-and-shows-import-progress.md),
whose plan review's four P1s were the spec.

**Ending: Shipped**, on `dev`, with one question to Greg and one deferred half queued.

What changed:

- **Both add-page boxes have the microphone**: *Why are you reading this?* and *About you*, the
  button in the label row and the strip under the box, as on Profile.
- **The page waits while either box is dictating.** It does not open the article by itself, both
  *Open the article* buttons, ⌘+Enter, *Open without saving* and the public copy's link are
  disabled, and a box stays on screen through a public-copy or failed answer until its words land.
  Once *Open* is waiting on a save, neither microphone can start.
- **Nothing saves the half-heard words**: About you's save after a pause, and the purpose box's,
  wait for the end of a dictation. So does the purpose box's save when the tab is hidden, and a
  stored purpose read meanwhile.
- **The default, in the design system**: `tests/prose-boxes-have-a-microphone.test.ts` finds every
  `<textarea>` in the app with the component it is in, and fails unless that component has a
  microphone or is listed with its reason. dictation.md says a box for more than a few words gets
  one by default.

**Asked, `q-ccv9qq`**: the one-row rule for controls.md, before and after, since rule wording goes
to Greg ([edit-important-docs.md](../reusable/edit-important-docs.md)). controls.md is unchanged.

**Deferred, queued as `qi-d44n9rhc`**: the five reader prose boxes the test lists as *not yet* — Skim's purpose box,
Referee's new-criterion box, the Candidates search's scope, rewriting a chat question, and editing
a comment's note. Each has its own send and unmount to check.

## 2026-10-21: the rule and the four boxes (q-ccv9qq answered)

Greg's reply `spya-xd63nn`, 2026-10-20 21:43 UTC, quoted in full in
[q-ccv9qq](questions/q-ccv9qq.md): *"Yes, but keep it a minimal update … we obviously don't want the
URL … to have a voice button … And not so we need a voice button for, like, the search bar on the
homepage. So use your judgment a little bit."* Queue item `qi-d44n9rhc`, plan
[261021e](../plans/261021e-microphone-on-the-five-remaining-prose-boxes.md); the report re-read
with `feedback-reporter.ts` (admin, exit 0, no addenda) before this section.

- **controls.md has the row** (option A): a box for more than a few words of the reader's writing
  gets the microphone, *not a URL, a search or a title*, pointing at dictation.md and the test.
- **Four more boxes have the microphone**: Skim's *What are you skimming for?*, Referee's new
  criterion, the box that scopes the Candidates search, and a comment's own note. None sends or
  saves while you are still talking or the words are on their way; Skim's box stays on screen
  through a banner until they land; the note saves when they land, not on the blur that Stop
  causes.
- **One exempted, by judgment**: rewriting a chat question already asked. It is usually a small fix
  to words already there, the composer one box below has the microphone, and a voice rewrite would
  be stored as typed (the rewrite keeps the original question's record of how it was made). Its
  reason is in the test; easy to reverse.

Two GPT Sol reviews (plan, code), both in `docs/plans/261021e-*-sol.md`.

**Ending: still Shipped.**
