# Main app architecture review: review disposition and delivery

Status as of 2026-09-05: reviewed documentation-only candidate; all review findings closed. No application
architecture change has been implemented by this work.

Up: [Proposal](260905e-main-app-architecture-review.md) ·
[Catalog and commands](260905e-mode-catalog-and-command-bar.md) ·
[Validation evidence](260905e-main-app-architecture-evidence.md)

## Review scope

Independent modes, mobile/rendering and data/lifetime audits informed the proposal. GPT Sol was
consulted on the design while it was still being formed, then received the complete documentation
candidate for an independent final-stage review through `scripts/run-codex.ts` with model
`gpt-5.6-sol`, effort `high`. The [first review prompt](260905e-main-app-architecture-review-prompt.md)
identifies the source baseline and complete untracked candidate list. The
[returned review](260905e-main-app-architecture-review-sol.md) exited 0 with a **NOT READY** verdict;
an empty successful process was not treated as approval.

The reviewer assessed the consequences of implementing the prose, not an existing code diff.
Each source claim below was checked by the author before amending the proposal. Severities are
the reviewer's original classifications, preserved for traceability rather than recast as a count
of production incidents.

## Finding disposition

| ID | Original finding | Author's disposition and precise change |
|---|---|---|
| F1, P0 | Lost job response can cause a duplicate paid submission; active-work deduplication is not durable idempotency | Accepted contract gap. Companion § Identity, intent and cancellation now forbids automatic resend on uncertain outcome, returns `unknown`, and distinguishes explicit informed retry. Durable owner/action/key receipts, atomic admission/job binding and terminal/forgotten-job tests are prerequisites if automatic resend is added. |
| F2, P1 | Initial controller throw can leave an ownerless paid-activation token | Accepted. Main A2 requires exact session/slug/target/nonce capture and compare-and-retire outside the failed child's effects; retry carries no spend intent. Added throw → Plain → Back/retry and racing-newer-press tests to the first containment stage. |
| F3, P1 | Minimal action inputs omit profile, thread and other existing semantic choices | Accepted. Added explicit profile choice, new/existing conversation target, turn block, stance and question-origin contracts. Ordinary Chat is the first supported send; other triggers cannot migrate before parity. Regeneration stays on its existing path until exact forced-output semantics have an action. Proposed command default is visibly new Chat, retaining other drafts. |
| F4, P1 | Unambiguous natural language does not ensure prerequisite price disclosure | Accepted. Full prerequisite effects and estimated total price/wait precede the spend-authorising press. Already-priced deterministic rows need no second confirmation; undisclosed free-language/voice plans get one inline confirmation. Material expanded work returns to that preview. |
| F5, P1 | Latest-issued-ticket fencing can discard the only successful offline response | Accepted; chosen fix is simpler than pending-response retention. Compare against the latest **successfully committed** ticket, not latest issued. Newer failures never supersede a successful copy. Bounded reservation timeout permanently disables caching for that request. |
| F6, P1 | Cache LRU touches/eviction can race response writes | Accepted. Main A0 now covers all writers/deleters. Touch current metadata transactionally without resurrecting a body; select/revalidate and delete a whole evicted article atomically, including concurrent fresh touches/writes. Mutation invalidation and its epoch advance are atomic. |
| F7, P3 | Doc-check result had drifted under a peer change | Accepted snapshot correction. Evidence records the reviewer's 13/1 result, the peer citation fix and the author's new 14/14 pass. No unrelated source was changed to make this task green. |
| F8, P1 (round two) | Account teardown was not explicitly part of the cache protocol | Accepted after checking `forgetUser` and the auth callback. Main A0 now requires atomic retained owner-epoch retirement plus body deletion and an exact delayed-response-after-sign-out test. Same-owner re-login does not revive old tickets; new ones remain eligible. Direct account switching keeps its existing partition policy rather than silently gaining a purge. |

Other source refresh: the already-landed `rowsForBlockIds` and `onFontsChanged` helpers are now
explicitly cited in A8, so implementation agents do not repeat that long-article work. The original
app's conditional palette recommendation and flat-registry guidance are cited as agent judgments,
not converted into Greg's decisions.

## Final review and landing

The [second prompt](260905e-main-app-architecture-review-round2-prompt.md) received a successful
process exit and a [NOT READY verdict](260905e-main-app-architecture-review-round2-sol.md):
**F1–F7 closed**, with one new established P1, F8. Sol independently reran the documentation check:
14/14 passed. General discovery closed under the repo's two-round rule. The small F8 amendment
received the required [narrow check](260905e-main-app-architecture-review-f8-prompt.md), which exited
0 and returned [F8 CLOSED — READY](260905e-main-app-architecture-review-f8-sol.md). All F1–F8 are
closed; no established blocking finding is overruled or left to an unreviewed post-review fix.
This is readiness to land the documentation, not authorisation to build every proposed stage.

Candidate commit SHA: pending. This field will be filled after the reviewed files are committed;
its follow-up metadata commit does not imply any application work was implemented.
