# A late prerequisite guards the aftermath, not the action

Up: [postmortems.md](../project/postmortems.md) · change:
[plan 261009i](../plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md)

Code review of 261009i found the same ordering mistake at two boundaries. A stored Tutorial,
Explore or Candidates thread could open and, on GPT-Live, bill a Live session before the spoken
append rejected that kind. Separately, the guide could accept a first typed or spoken message while
its purpose read was pending, then draw the greeting afterwards and offer to save those earlier
words as an answer to a question the reader had not seen. Nothing from the greeting change reached
a reader; the Live eligibility gap predated this stage.

## The class: a late prerequisite guards the aftermath, not the action

Both paths had a correct-looking check at the last mutation. `withSpokenTurn` refuses a kind that
does not take Live, and the greeting was limited to a mount that began with an empty thread. Neither
predicate guarded the earlier irreversible event: creating a paid session, or letting the reader
speak before the asynchronous context that would give those words their meaning had arrived.

The mistake is to place a prerequisite beside the final write and then reason backwards as though it
protected the work before it. A refusal after spend protects the transcript, not the spend. A
mount-time empty snapshot protects remounts, not messages that arrive while a read is pending.

Realtime's missing early eligibility check dates to `cc2b67d49` (2026-08-31). GPT-Live inherited
the same shape in `b3d4b4c9e` (2026-10-03). The retroactive greeting was introduced in the reviewed
commit, `86f0ef224` (2026-10-09).

## Why nothing went red

The route tests covered a browser-supplied unsupported kind and a browser kind contradicting a
stored Chat thread. They did not cover the caller omitting `kind` while the stored thread itself was
unsupported—the exact path on which the stored value bypassed validation. The later append tests
then agreed that the turn would be refused, but observed only the mutation after the paid boundary.

The greeting tests resolved `GET /api/reader?slug=` before sending the first message. They proved
the stable case, the save race and a lost reply, but never held the prerequisite read open while
typed or Live words arrived. The delayed typed-message case was seen fail in review: the eventual
DOM contained both “Why are you reading it?” and “Keep this as why you're reading” above and below
the earlier question.

## What would have caught it, ranked by ease against value

1. **Delay every asynchronous prerequisite past the first action in one test.** Done for both a
   typed message and a Live tail. This is the cheapest way to prove that late context cannot
   reinterpret an action already taken.
2. **Assert refusal at the earliest costly boundary, with the caller omitting optional hints.**
   Added for both Live engines: a stored unsupported kind must produce no Realtime mint and no
   GPT-Live journal or create. These database-backed tests could not run in the review environment
   because local Supabase was unavailable; they remain the right route-level guard.
3. **Make eligibility the type returned by the boundary check.** Done: `liveKind` now returns only
   `SpokenKind | undefined`, after validating both stored and sent values, so a full `ThreadKind`
   cannot flow into session construction through that function.
4. **Bind every Live tool call and append to a server-side session record containing the effective
   kind.** Rejected for this stage. It would strengthen defence in depth, but needs a wider journal
   and store contract; the shipped model path already pins the kind in the page, outside model
   control.

## The long-term fix

For Live, the shipped fix is the long-term shape: validate the authoritative stored kind before
either engine mints, journals or creates anything, and narrow the result's type. The later append
gate remains as the transactional second line.

For the greeting, the completed read is snapshotted only while the conversation is still empty,
where empty includes unsaved Live lines. Once shown, that exact greeting stays for the mount. If
words arrive first, no later read may turn them into its answer. Blocking the whole composer on the
profile read was rejected: it would make an optional personalisation read delay the reader's own
conversation when declining to reinterpret the words is enough.

---

Up: [postmortems.md](../project/postmortems.md)
