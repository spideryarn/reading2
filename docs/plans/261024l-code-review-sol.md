## Findings

1. Low — [marginalia.css](/var/tmp/spideryarn-worktrees/fbrgh26u-marginalia-chat-columns/src/web/styles/marginalia.css:27) still says nothing moves when centred prose already leaves room for the notes column. That is now false: the prose moves until the chat card is full or the left-space keep binds. This file was outside my permitted edit scope.

No functional defects found.

- [shiftForCard](/var/tmp/spideryarn-worktrees/fbrgh26u-marginalia-chat-columns/src/web/layout.ts:667) implements exactly `max(0, min(cardFull − right, left − min(left/2, 4rem)))`.
- Re-derived examples agree: 1280/16 shifts 220px for a 480px card; 1512/20 shifts 235px for 517px; 1600/28 shifts 41px and preserves the 286px card.
- `margReserve`, `margLeft`, `margW`, `minWidth`, title reserve, rail-off layouts, bands, and rule-2/rule-3 windows remain consistent.
- The screenshots show no unnamed regression. The conspicuous no-chat left alignment and unchanged narrow card beside a band are both explicitly acknowledged by the plan.

Mutation testing was meaningful:

- Restored 1600px gate: 7 tests failed.
- Restored 100px cap: 7 tests failed.
- Removed the keep: 5 tests failed, including the root-28 case and sweep invariant.

Checks:

- `layout-margin.test.ts`: 47/47 passed.
- Focused layout/chat suite: 95/95 passed.
- All `layout.ts` importers: 437 tests passed; three browser tests could not launch Chrome/WebKit because sandbox IPC is prohibited.
- Direct typecheck passed all 3,939 covered files. The npm wrapper itself hit the same sandbox IPC restriction.
- Full `npm test` could not start because no local database was available.

## Fixed

- [Plan Status](/var/tmp/spideryarn-worktrees/fbrgh26u-marginalia-chat-columns/docs/plans/261024l-the-chat-card-in-the-margin-gets-the-room-left-of-the-prose-at-every-width.md:144): recorded the review, mutation results, test limitations, and outstanding CSS comment.

## Left for the building agent

Correct the stale `marginalia.css` comment before landing. No product decision is needed.

**Verdict: ship with fixes.**