Accept. No P0/P1 findings.

### Findings

- **F80 — P2, established, fixed.** A rejected `NewSessionApi.start()` released the posting guard but escaped the click handler as an unhandled rejection, leaving no visible explanation.
  - Input: an injected `start()` throwing `Error("probe rejection")`; Vitest reported the unhandled rejection.
  - Fix: [NewSessionPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/NewSessionPanel.tsx:483) now catches it, presents a refusal, and retains the `finally` guard release. Red-first regression added.

- **F81 — P2, reasoned, wider; not fixed.** 5d is accurate only at the stated `fetch` boundary. Aborting the browser fetch does not stop the server-side transcript work: [server.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/server.ts:789) starts `readRecentMessages()` without observing request closure, and [transcript.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/transcript.ts:1065) accepts no signal. Thus “stops costing the box” overstates the result.
  - Mutation: hold/instrument the server read, abort the client fetch, and observe that the read still completes.
  - Smallest change: derive a signal from request abort/close and check it during transcript discovery and between tail-read chunks. This is outside the allowed write scope.

### Guarantee audit

- **5a:** Accurate after F80. Same-frame taps make one POST; a retry after give-up gets a fresh timestamp; exactly four minutes is accepted under the explicit `>` rule, while `+1 ms` is discarded. Late answers after give-up remain inert. The only production caller of the component action is the Start button. The late-success banner plainly directs readers to the session list.
- **5c:** Accurate. StrictMode’s rehearsal reader is stopped and the real mount gets a fresh reader. A combined null-claim read → tap → claim discovery → second same-frame tap produced reads `[null, null, conv-A]`; the old read was aborted and the new-identity read remained live. The 30-second refusal names that the page stopped waiting and leaves *Read again* available. Given the 1 MiB read cap, 30 seconds is generous, though still a product trade rather than a measured worst-case bound.
- **5d:** The signal reaches `fetch` directly, through `httpMessagesApi`, and through `withClockSkew`. Deadline aborts settle with the page’s “stopped waiting” refusal; unmount and identity replacement draw nothing. F81 is the limit of the stronger server-cost claim.
- **Region:** Correct markup. A named `<section>` maps to a `region`, while negative `tabindex` permits programmatic focus but excludes sequential focus navigation. [W3C HTML-AAM](https://www.w3.org/TR/2021/WD-html-aam-1.0-20210813/), [W3C tabindex guidance](https://www.w3.org/WAI/GL/wiki/Creating_Logical_Tab_Order_with_the_Tabindex_Attribute). Actual spoken output remains reasoned rather than established because jsdom cannot exercise a screen reader.

Both *Start it* and *Read again* use the shared 28px-high button, below the roughly 44px touch-target guidance. They predate Stage 5, but they are Stage 5 controls reviewed here.

Checks:

- 90 focused Stage 5 and existing identity tests passed.
- Final changed-file suite: 27/27 passed.
- Four TypeScript projects passed directly.
- Fleet suite: 98/99 files and 3337/3338 tests passed; the sole failure was `fleet-readiness` because this sandbox rejected `mkfifo` with `EPERM`.
- Fleet production build passed.
- Biome passed on changed files.

Files changed, uncommitted:

- [NewSessionPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/NewSessionPanel.tsx)
- [fleet-new-session-deadline.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tests/fleet-new-session-deadline.test.tsx)
- [fleet-detail-reader.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tests/fleet-detail-reader.test.tsx)