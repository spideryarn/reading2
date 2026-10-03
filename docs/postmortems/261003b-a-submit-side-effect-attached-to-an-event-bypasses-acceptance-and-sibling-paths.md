# A submit side effect attached to an event bypasses acceptance and sibling paths

Review of [261003h](../plans/261003h-four-small-ui-fixes-gutter-gap-glossary-card-row-keyboard-dismiss-voucher-form.md)
found three gaps in the new keyboard dismissal. Search dismissed after Enter but not after pressing
Find; glossary dismissed even when a pasted term was refused locally; chat dismissed a new draft
typed while its previous send waited for a live handoff. These were found in the
candidate worktree; this review establishes no production impact. Evidence is jsdom focus, not a
physical soft keyboard.

## The class: an event is mistaken for an accepted action

Commit `54f7dbaf3533db6f684a3e342c6cae0f725dca93` added dismissal to particular event handlers.
Its intent was to let the reader see the result once a send had happened. The handlers were not
the boundary that decided whether an action happened, or the shared path through which all
equivalent gestures acted.

In `SearchPanel.tsx`, the guarded `ask()` already served both Enter and Find; placing dismissal
only in `onKeyDown` omitted the button. In `GlossaryPanel.tsx`, `AskATerm` called the owner's
`ask()` and then dismissed unconditionally. `useGlossary.ts` had refused invalid terms through
`parseAskedTerm` since `b37ba8aa92`, and guarded an in-flight request with a synchronous ref since
`5ab767c6bb`. Submission did not mean acceptance.

Chat made the related temporal mistake: its existing live handoff deliberately clears the box
before awaiting `live.stop()`, so the reader can begin another draft while spoken words are saved.
The new dismissal ran after that await against the current box, treating a later interaction as
part of the old submission. The element survived, but the reader's purpose for keeping it focused
had changed.

## Why the existing checks agreed

The new helper tests established viewport detection and focus changes. The mounted send tests
covered chat and Candidates with no live handoff; they did not press Search's Find button, submit
a locally invalid glossary term, or resume typing during an await. Typechecking cannot distinguish
attempted submission from an accepted request or identify a later draft's ownership of focus.
The supplied browser pass checked layout and exercised no real soft keyboard.

The review added and observed these failures before changing code:

- `tests/quick-search-panel.test.tsx`: both quick and meaning Find cases accepted a request but
  failed the assertion that `activeElement` was no longer the input.
- `tests/glossary-ask-adds-term-band.test.tsx`: submitting `attention\u0001head` displayed
  “A term cannot contain control or formatting characters.” without a request, but failed the
  assertion that `activeElement` remained the input: it was `BODY`.
- `tests/the-enter-key-really-sends.test.tsx`: a deferred live stop let the reader enter a second
  draft before the first question sent. The first question sent and the second draft remained,
  but the focus assertion received `BODY` instead of the textarea. The companion test, an
  awaited handoff with no new draft, already passed.

The first glossary run expected the wrong refusal wording; that failure was corrected and the
focus failure was reproduced separately. The wording mismatch was not the finding.

## What would have caught the class, ranked by ease against value

1. **Test every gesture that reaches one action, plus one refused action and one interaction
   during an await.** Cheap, implemented in the three mounted component suites above. These
   tests observe requests, draft content and focus together;
   helper-only assertions cannot prove the caller's contract.
2. **Put the side effect beside the shared admission guard.** Search now dismisses inside its
   guarded `ask()`. Glossary preserves refusal reporting while checking the shared parser and
   the visible in-flight state before dismissing. Chat captures the submitted element and, after
   an awaited handoff, dismisses only if it is still current, focused and empty. These changes
   close the three observed gaps.
3. **Make every action return an explicit admission result.** A stronger design where callers
   need post-acceptance effects; not adopted here because changing the glossary hook contract
   and all its callers exceeds the four fixes. Its synchronous in-flight guard remains the
   authoritative admission boundary.
4. **A source sweep for calls to the dismissal helper.** Rejected as the primary defence: it
   would find both new calls and still miss their relationship to equivalent gestures and
   refusal paths. A physical keyboard check would test platform behaviour, but would also miss
   these branches unless it deliberately exercised them.

## The fix that holds beyond this instance

Treat dismissal as a consequence of accepting the reader's action, shared by all gestures that
perform it. Where acceptance is hidden behind an asynchronous API, return an explicit admission
result instead of inferring it from the event or eventual network outcome. The narrow glossary
patch uses the existing shared validation rule; it does not introduce a second parser.
After an await, also verify that the reader has not begun the next interaction before applying
the old interaction's focus changes. The chat patch reads the current DOM value after the handoff;
without an await, React has not yet committed its optimistic clear, so that path needs no empty
DOM check.

I would inspect where an action can refuse and every caller that can start it before placing a
focus change. A helper that blurs correctly says nothing about whether this gesture should blur.
