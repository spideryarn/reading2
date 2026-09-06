Verdict: **refuse as written**. F1–F4 are established P1s from reachable source paths.

### F1 — P1 — established: `?at=` is not the location being left

(a) The proposed stamp is “the `at` I am leaving” ([plan:123](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:123)), but `?at=` deliberately does not always represent the current block:

- At the article top it is `null`, so jumping three thousand words away produces no valid stamp and therefore no chip.
- After a fine-grained jump, manually scrolling within the same section deliberately preserves the old fine block ([position.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/position.ts:154), [position.ts:191](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/position.ts:191)). A later jump records somewhere the reader is no longer standing.
- A scroll write is delayed 300 ms ([params.ts:153](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/params.ts:153)). The jump’s `throttle(0)` aborts that queued update ([App.tsx:1662](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:1662), [nuqs debounce:332](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/debounce-Ynq26WfO.js:332)), leaving the predecessor history entry at its older position. The stamp may name B, but `history.back()` lands at A.

Thus the central claim that browser Back already returns to the pre-jump location ([plan:73](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:73)) is false.

(b) Replace Stage A’s origin rule with:

> Immediately before a jump push is committed, measure the block currently crossing the reading line (`blocks[measureRow()]`, including the first block at the top). Atomically replace the current entry’s `?at=` with that origin, then push the destination with the same origin stamped in its state. The predecessor URL and stamp must always agree.

Do this inside the intercepted push transaction, not as two independently queued nuqs setters. Add tests for jumping from the top, within a section after manual scrolling, and while the 300 ms position replace is pending.

### F2 — P1 — established: the section hide rule suppresses valid returns

(a) The chip hides whenever the destination and origin belong to the same section ([plan:144](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:144)). Sections intentionally contain several blocks ([position.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/position.ts:47)). Clicking a citation five paragraphs away inside the current section therefore performs a real pushed jump but immediately hides its only Back affordance.

(b) Replace that bullet with:

> The chip remains visible for as long as the current history entry carries a valid jump stamp. Returning through Back removes or changes that stamp. Do not infer “home” from section equality.

Manual-return detection can be added later if it measures the actual block; section equality is not sufficient.

### F3 — P1 — established: nuqs propagates stale stamps onto non-jump pushes

(a) nuqs does not treat `history.state` as empty. Every query write passes the current `history.state` into `pushState` or `replaceState` unchanged ([nuqs React adapter:10](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/adapters/react.js:10), especially line 16).

Concrete sequence:

1. Jump A → B; B’s state contains origin A.
2. Toggle `cols`, `mode`, `sort`, or another push-valued setting.
3. nuqs pushes the setting entry using B’s state.
4. Unless the wrapper explicitly removes its old stamp, the chip appears on the setting entry.
5. Pressing it merely undoes the setting and remains at B—not A as the chip promises.

This directly contradicts the plan’s claim that a mode/column/sort push carries no origin ([plan:138](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:138)). nuqs does not otherwise interpret the state object; its `"__nuqs__"` marker is the second History API argument, not a state property ([patch-history:49](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/patch-history-Bze7i4qB.js:49)).

(b) Add this explicit Stage A rule:

> Every push first removes Spideryarn’s existing jump stamp from the supplied state while preserving all foreign state. Only a same-article push that consumes a freshly armed jump origin adds a new stamp. An unarmed same-path push must clear, not inherit, the prior stamp. Replace writes preserve the current entry’s stamp.

Test `jump → cols/mode/sort push`: the new entry must have no chip; Back must reveal the earlier stamped jump entry.

### F4 — P1 — established: not every deliberate reading jump uses `jumpTo`

(a) Previous/next comment navigation is an ordinary reader action that can move arbitrarily far. `goToComment` changes `?note=` and calls `scrollToBlock` directly ([App.tsx:2518](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:2518)); the dialog’s buttons call it directly ([App.tsx:3268](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:3268)). `noteParam` replaces history, so this movement creates neither a predecessor position nor a stamp.

That disproves “Every ‘go there’ in the app funnels through `jumpTo`” ([plan:68](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:68)). A reader who opens a distant question from the drawer, or presses Next, still has no way back.

(b) Either explicitly exclude comment navigation and narrow the central claim, or—preferably—change the plan to route every off-screen `goToComment` movement through the new jump transaction. Keep the existing no-movement behavior when the target is already visible. Test both the drawer selection and dialog Next/Previous paths.

### F5 — P2 — established: Stage D has no implementable identity contract

(a) Stage D says to remember which page was last open and its position using block IDs, while also requiring bare `/read/<slug>` to continue opening the article ([plan:159](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:159)). It does not say where “last page” is consumed.

More importantly, Tweets and Metadata do not expose article-block identities:

- `Tweet` has only `text` and `chars` ([types.ts:336](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/types.ts:336)).
- Tweet rows explicitly use array position as identity and are rebuilt wholesale ([Tweets.tsx:640](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/Tweets.tsx:640)).
- Metadata uses semantic section IDs derived from labels ([Metadata.tsx:2097](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/Metadata.tsx:2097)), not article block IDs.

(b) Replace Stage D with:

> Deferred to a separate plan. It must decide independently: when the remembered page is consulted; stable Metadata section keys; and whether Tweets gain persistent IDs or use a `(sourceHash, index)` position that is discarded when the thread changes. Article block IDs cannot identify either page’s content.

### F6 — P2 — reasoned: the plan lacks a reactive store for `history.state`

(a) Existing subscriptions snapshot only `pathname + search` ([router.ts:1205](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/router.ts:1205)). Two entries can have the same URL but different stamps—for example, clicking a target already named by `?at=` still queues a push because nuqs has no same-query early return in its setter path ([nuqs index:572](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/index.js:572)). Back between those entries fires `popstate`, but every existing external-store snapshot remains equal, so React need not redraw the chip.

(b) Specify a `useJumpOrigin` external-store hook whose snapshot includes the validated stamp and whose subscription listens to both `popstate` and `spideryarn:navigated`. Also suppress a push when measured origin and target are identical. Test two entries with identical URLs and different states.

### F7 — P3 — established: the cited function does not exist

(a) Stage A calls the app-owned path `pushAddress` ([plan:122](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:122)); the function at the cited location is `navigate` ([router.ts:1092](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/router.ts:1092)).

(b) Replace `pushAddress` with `navigate`.

The reload-time `settleAddress`/`liftStrandedText` replace is not an independent defect: preserving a correctly entry-bound stamp across a same-path canonical rewrite is appropriate. I also could not establish a standards-based path where a correctly minted stamp survives while its predecessor alone disappears; the stronger established failures above do not depend on that suspicion.

No files were changed. `tests/url-state.test.ts` passed: 67/67.