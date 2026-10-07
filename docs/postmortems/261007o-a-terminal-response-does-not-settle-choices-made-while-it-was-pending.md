# A terminal response does not settle choices made while it was pending

Review of [261007k](../plans/261007k-repeat-paste-is-free-and-says-so.md) caught two failures
before the repeat behaviour was committed. While the add request was pending, a reader could
type a purpose or choose High-powered AI. The repeat answer then hid those controls even when
their writes were refused. No reader exposure from this uncommitted change was established.

## A terminal classification discards unfinished user intent

[AddPage.tsx](../../src/web/AddPage.tsx)'s new repeat branch assumed that no import meant no
choices needed settling. It always entered `repeat`, which removed the purpose box and
High-powered control. But those choices were already offered while the POST was pending.
Finishing the server's lookup does not finish an independent reader edit, save or paid choice.
The purpose session still held the draft, and the High-powered intent could still send its write;
only the controls and their failures disappeared.

Both defects were introduced by the uncommitted 261007k diff. They share one cause: the terminal
response classified the server's work correctly, then incorrectly used that classification as
the lifetime of user intent created while waiting for the response.

## Why the original tests agreed

The first repeat test answered immediately. It correctly checked that an untouched repeat shows
one sentence and one button without import options, but created no interval in which a reader
could use the previously offered controls.

The review delayed `{ article, repeat: true }`, edited the purpose or ticked High-powered AI,
then refused the resulting PATCH or PUT. Both tests in
[add-page-purpose.test.tsx](../../tests/add-page-purpose.test.tsx) were observed red: the
purpose case could not find its textarea, and the High-powered case could not find
`[data-add-high-power]`. The missing controls also hid the actionable refusal.

## The fix that preserves the right lifetime

An untouched repeat still takes the simple repeat phase. A touched or unsaved purpose instead
keeps the existing `ready` path: its text and save status stay visible, and Open waits for its
save or offers the existing explicit way to leave without saving. A non-off High-powered intent
keeps its control and outcome visible over either repeat path.

[AddHighPower.tsx](../../src/web/AddHighPower.tsx) also gives a successful repeat choice a
sentence about subsequent generation. Saying the switch applies to later work in this import
would claim an import exists when the route deliberately queued none. The lasting fix is the
same as the review fix: use the existing purpose and High-powered controllers' state to decide
whether their controls still have work or an outcome to show.

## What would have caught it, ranked by ease against value

1. **Hold a response pending, act through the controls offered during that interval, and then
   refuse their writes.** Done for both controls, red before the fix. This tests the transition
   between server completion and reader intent, rather than only the terminal screen.
2. **Review every newly hidden control with its pending controller state.** A small review cost:
   hiding an unused option and hiding a selected option's unresolved outcome are different
   actions. Existing save/refusal states should remain reachable through the transition.
3. **Replace the independent controllers with one combined state machine.** Rejected: combining purpose,
   sharing and High-powered AI would add substantial scope. The existing controllers already
   express their own lifetimes; the page needs to preserve their visible outcomes.

Up: [postmortems.md](../project/postmortems.md).
