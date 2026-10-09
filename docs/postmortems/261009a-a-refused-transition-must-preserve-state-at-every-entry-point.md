# A refused transition must preserve state at every entry point

Code review of [261009a](../plans/261009a-dictation-transcript-lands-in-the-next-box.md)
caught gaps in the new refusal to deliver dictation into another target. Nothing reached a reader.
These defects were introduced by the current uncommitted stage, so there is no introducing commit
SHA. The existing retry machinery predates it; the new protection was applied incompletely to that
machinery and its field wrapper.

## The class: refusal must protect the retained obligation through every entry point

The first transcription and a successful retry can both produce words that belong to a previous
box. The first path marked its offer `moved`, which prevents a new recording from deleting its only
copy. The retry path cached those same words and showed the same refusal, but omitted the marker.
The next microphone press could therefore erase the retry's words and audio.

The sibling was in the caller. `useDictationField.toggle` reset the previous dictation's insertion
proof and caret before asking the hook to start, then always restored focus. Refusing the start in
the hook preserved the recording but did not undo these caller mutations. The apparent no-op still
changed where a later retry would insert the reader's words.

Two related boundaries were incomplete: rejecting recovery while busy released the tape without
any wake-up when the hook became idle; the refusal sentence said saving would allow another
dictation, although Save only downloads and leaves the protected offer in place. Refusal changes
the next permitted action, so its state, retry scheduling and explanation must agree.

## Why the original tests did not catch it

The original tests had been seen red with their guards disabled. They proved delivery was refused,
but did not follow every refusal through the next action. The review extended
[the real-hook tests](../../tests/dictation-lands-in-its-own-box.test.tsx) and saw five failures:

- A new press after a moved successful retry reached `listening`, expected `idle`.
- A refused field press followed by retry produced `a about comment Alpha beta`, expected
  `alpha about comment A beta`.
- Focus became the textarea, expected the button the reader had focused.
- After settling the current offer, recovery's error stayed `null`, expected `[mic-recovered]`.
- The actual strip retained its offer after Save while saying “save or discard the recording,
  then dictate”.

## What would have caught it, ranked by ease against value

1. **Follow a rejected transition with the next legitimate action through the real caller.** Done:
   these small tests cover first-pass and retry protection, caret and focus preservation, recovery
   after idle, and the strip's real Save action.
2. **Return acceptance before the caller mutates transition state.** Done: hook `toggle` returns
   `false` for refusal, and the field returns before resets or focus work. This makes the boundary
   observable without duplicating the hook's preservation predicate.
3. **Replace the dictation hook with a general transition engine.** Rejected: it would expand this
   small fix substantially. An explicit result and tests across the existing entry points close the
   demonstrated gaps without a second state framework.

## The long-term fix

The review fixes use the same protection marker for a successful retry refused after navigation,
preserve the field's state until start is accepted, and reconsider recovery on phase and recording
changes while keeping a visible recording safe. The sentence now tells the reader to discard the
offer before dictating again, after saving it if wanted. These are the intended boundary fixes,
not temporary patches awaiting a larger rewrite. The recovery lesson also appears in
[the earlier recovery-loop postmortem](260909a-a-recovery-loop-remembered-the-transition-not-the-state.md).

---

Up: [postmortems.md](../project/postmortems.md)
