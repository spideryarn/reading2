# 261006d — Code review: Glossary and Citations Ask in chat

Up: [plans.md](../project/plans.md) ·
[plan](261006d-glossary-and-citations-ask-in-chat-with-origin.md) ·
[plan review, F1–F6](261006d-glossary-and-citations-ask-in-chat-plan-review-sol.md)

Reviewed `064ba45c7` and only the specified migration and conflict resolutions from `f24959fd1`.
Independent tracing preceded fixes. No Git command changed repository state, no database was
accessed and no quotation was added or changed. Production behaviour needed no correction.

- **F7 — P2, established, fixed: the old absent-term test assumes its button's label is unique.**
  `tests/glossary-ask-in-chat.test.tsx` originally selected the first whole-page `Ask in chat`
  button, and its fixture had no entries. With an open entry present, an explicit uniqueness
  assertion failed: expected one matching button, received two. The refusal currently appears
  first, so this is test fragility, not an established wrong user action. The helper now scopes
  its match to `.gloss-ask-failed`, requires one match and asserts the submitted request has no
  origin. The coexistence fixture remains. Red evidence: `/tmp/ask-in-chat-absent-red.log`.

- **F8 — P3, established, fixed: the whole-name promise exceeds the helper's actual contract.**
  `src/web/chat-handoff.ts:238`, the plan's D1 and `docs/project/glossary.md:984` promised a whole
  name regardless of length. `fencedQuote` bounds escaped text at 2,000 characters and visibly
  clips it; Chat accepts at most 4,000 characters. A test of that promise with 2,200 characters
  failed (`/tmp/ask-in-chat-name-contract-red.log`). Corrected the prose, preserving useful
  clipping rather than making Send reject longer seeds. Regression tests now hold the retained
  contract for a very long name, escaping that crosses the bound and a surrogate pair at the cut.
  Also corrected the plan's stale status using the owner's reported merged-tree evidence.

- **F9 — P2, reasoned, not fixed: optional owner `chats` permits silent loss of both controls.**
  `GlossaryAccess` (`src/web/GlossaryPanel.tsx:231`), `CitationsAccess`
  (`src/web/CitationsPanel.tsx:840`) and both owner bands permit omission. A future caller could
  typecheck while drawing no button or mark. Reader supplies both props correctly today, and
  the whole-app tests catch omissions. This was an explicit builder decision for existing
  fixtures, not an accidental merge loss. Requiring the prop, with an explicit representation
  for deliberately chat-free fixtures, would strengthen the API but changes callers outside
  this stage. Nonblocking maintenance risk, reported rather than widening this review's fixes.

- **F10 — P3, established, not fixed outside scope: the handoff's glossary wording is now broad.**
  `src/web/modes/conversation/ConversationModes.tsx:319` says the glossary's handoffs send no
  origin. That still describes its absent-term handoff, but an entry's handoff now carries one.
  This file is outside the candidate; the comment should distinguish the two senders.

The owner's first Send is connected through Reader, each owner band, the panel and its row to the
pending origin. The route parses both item modes before writes, does not apply the claim block
guard to them, and retains the first snapshot on resend. The column mapper and additive CHECK
agree on shape. ID-only matching retains the mark after rewording. A second chat selects the
newest matching summary. Visitors have no chat prop or private summaries; the glossary also has
its existing lookup guard. Debate retains its prevent-default click, tooltip, answer/count faces,
full-width placement and coarse-pointer height in the shared component and styles. No actionable
Debate regression or remaining functional `remember`/`learn` merge mismatch was found. The new
Help text matches the code.

Added six whole-app lifecycle cases, both modes: leave and return before Send, refused first Send
followed by a mode change and resend, and a second chat from the same entry that reopens the newer
conversation. All pass. Removing the origins and exposing visitor buttons deliberately made all
six lifecycle tests and both visitor tests fail. Those mutations were restored in full:
`/tmp/ask-in-chat-mutation-red.log`. The earlier glossary mutation's green result reflects its
second guard; an actual visitor button now demonstrably reddens the test.

Validation: 263 tests in 14 offline files passed (`/tmp/ask-in-chat-final-tests.log`), including
the entry journeys, Debate checks, origin matching/mapping, sources, draft/handoff lifecycle,
doc links and URL state. The typecheck script passed every project and its source-coverage guard
via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself cannot create tsx's IPC socket
in this sandbox. `npm run db:chain` passed. Touched-file lint passed after correcting one new
unsafe optional-chain assertion. The post-lint reruns passed all 15 entry-journey tests and the
full typecheck, recorded in `/tmp/ask-in-chat-after-lint-tests.log` and
`/tmp/ask-in-chat-after-lint-typecheck.log`.

The stylesheet suite passed five assertions; its remaining assertion could not spawn its read-only
`git ls-files` child (EPERM). Running the same scan with the file list obtained outside that child
found two CSS imports and no offenders. This is a sandbox limitation, not a finding. No database
suite was attempted here. The owner's 319-test merged-tree run, clean typecheck, chain check and
applied local migration are supplied evidence, not this review's independent database evidence.
Positive database-route mutations and browser layout checks remain unverified locally.

Root cause for F7/F8 was independently checked and recorded in
[the postmortem](../postmortems/261006d-fixtures-without-competing-controls-hide-ambiguous-selectors-and-bounds.md).

**Verdict: land — no P0/P1 found; the narrow test and prose fixes are made, with the stated offline
validation limits.**

Files changed:

- `src/web/chat-handoff.ts` (comment only)
- `tests/chat-handoff.test.ts`
- `tests/glossary-ask-in-chat.test.tsx`
- `tests/glossary-and-citations-ask-in-chat.test.tsx`
- `docs/project/glossary.md`
- `docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md`
- `docs/plans/261006d-glossary-and-citations-ask-in-chat-code-review-sol.md` (initially empty)
- `docs/postmortems/261006d-fixtures-without-competing-controls-hide-ambiguous-selectors-and-bounds.md`
