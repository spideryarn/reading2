Fixed two established P1 defects. No commits made.

- **F12 — P1, established, fixed:** After a failed list fetch, Chat displayed a locally begun conversation but never recorded its destination. Typed words—and untouched handoff text—were hidden on return. [Destination recording now accepts known local threads](src/web/modes/conversation/ConversationModes.tsx:835).
- **F13 — P1, established, fixed:** Send left a conversation eligible for recovery while awaiting Live hang-up. A follow-up typed during that wait could appear in a new conversation without its first question. [Eligibility is now revoked immediately on accepted submission](src/web/ChatPanel.tsx:2354).
- **F14 — P1, reasoned, wider, not fixed:** Server correction of an optimistic thread id can strand a draft under the old id. This is a pre-existing limitation: correction changes selection without migrating the draft.

F1–F11 checked against the implementation and call sites:

| Finding | Established status |
|---|---|
| F1 — P1 | Fixed in candidate: failed reads cannot trigger draft recovery. |
| F2 — P1 | Fixed in candidate: selected destination and valid URL choice take precedence. |
| F3 — P1 | Fixed in candidate: Recall/Quiz round trips reopen the stored Chat destination. |
| F4 — P1 | Fixed in candidate: Remember drafts belong to their kind. |
| F5 — P1 | Fixed in candidate: dialog shares drafts; Delete and Cancel drop them. Reader excludes simultaneous composers. |
| F6 — P2 | Fixed: irreversible submission eligibility, with timing corrected by F13. |
| F7 — P1 | Fixed in candidate: ordered arrival preserves the list composer’s draft. |
| F8 — P1 | Fixed in candidate: Start over preserves Remember’s words. |
| F9 — P1 | Fixed: spoken writes revoke eligibility; F13 closes the typed handoff gap. |
| F10 — P1 | Fixed in candidate: handoffs are stored once; clearing persists. |
| F11 — P3 | Fixed in candidate: URL-retention explanation is qualified. |

Three new regressions were seen red before fixing. **149 tests across nine files passed**, and **14 mutations failed at their intended assertions**. Client typechecking passes; the full checker reports only the six known peer-file errors. The full suite stopped at database setup because Docker was inaccessible. Lint reported no errors.

Root causes and evidence are recorded in the [postmortem](../postmortems/261004m-draft-recovery-eligibility-must-follow-accepted-submissions-and-known-local-state.md).

APPROVE