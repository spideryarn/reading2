## Findings

### P1 — “Sharing: off” is not supported by the controller’s evidence

The plan turns an ambiguous label into an explicit published state claim ([plan:77](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:77>)), but `off` does not always establish that the server is private:

- A second tab can have `ShareAtAddState.kind === "off"` over a public unpublished article. This is the documented open defect ([postmortem:96](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/postmortems/261005r-a-publication-404-does-not-establish-sharing-state.md:96>), [public-readable-sharing.md:247](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/project/public-readable-sharing.md:247>)).
- The row currently recognizes only literal `on` states ([AddSharing.tsx:101](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddSharing.tsx:101>)). Therefore public/link `unknown`, `saving`, and refused turn-offs can show a lock and “Sharing: off” while sharing may be on. The heading is shown precisely in these unsettled states ([AddSharing.tsx:111](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddSharing.tsx:111>)).
- This is worse than the old residual: an unticked control was misleading, but “Sharing: off” plus a lock is an unqualified promise.

Simplest safe v1: keep the stronger styling but call the row “Sharing options” when the public state is not authoritatively known. Use `off` and a lock only after evidence that establishes both controls off. If the explicit “off” status is essential, the deferred pre-publication visibility read must enter v1.

Add tests for public/link `unknown`, `saving` in both directions, refused turn-off, reload, and the documented second-tab case—not just the ordinary off state proposed at [plan:170](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:170>).

### P1 — A job receipt does not mean text has been sent to a model provider

Item 7’s proposed condition is insufficient ([plan:121](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:121>)). The POST result merely causes the returned job to be stored ([AddPage.tsx:823](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddPage.tsx:823>), [AddPage.tsx:855](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddPage.tsx:855>)); the sentence claims the text has already reached a third-party provider ([messages.ts:5866](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/messages.ts:5866>)).

Consequences by case:

- Refused POST: fixed correctly; it stays present tense.
- Repeat paste: correct once the `{article, repeat}` answer arrives, because the disclosure is then hidden. While awaiting the answer it remains present tense.
- Fresh or re-found job: potentially wrong; it may still be queued or fetching.
- Reload of `/add/`: potentially wrong for the same reason. Receiving the existing job says nothing about which stage ran.
- Job later fails: wrong if it fails during fetch/extraction or otherwise before the first model call; true only if a provider call actually occurred.
- Upload: the existing “queued means sent” rule has the same semantic defect and is not sound precedent.

Either derive the past tense from job-step evidence that a provider-backed stage actually started, or change the sentence to the weaker truth that processing has been queued. The latter changes published meaning and therefore needs to be flagged explicitly.

### P2 — A possibly live private link still cannot be taken back from this page

The public-state table is otherwise sound: `off/refused(false) → open`, `waiting/gave-up → untick`, and `on/unknown/refused(true) → untick`; `saving` has an action already in flight. The omitted `probing`, `adopted`, and `unavailable` states should nevertheless be listed as “no control” so the table is exhaustive.

But the literal requirement that every on-or-maybe-on share can be withdrawn is not met for private links:

- A lost create reply produces `LinkAtAddState.unknown`, which explicitly may mean a link exists ([add-share-link.ts:90](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/add-share-link.ts:90>), [add-share-link.ts:445](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/add-share-link.ts:445>)).
- The UI then offers only **Check again** ([AddShareLink.tsx:148](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddShareLink.tsx:148>)).
- `turnOff()` refuses `unknown` ([add-share-link.ts:293](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/add-share-link.ts:293>)).

If reads keep failing, a live private link cannot be disabled here. Add an idempotent “Turn off any private link” action from `unknown`, or explicitly narrow the requirement to public sharing.

### P2 — The reload warning instructs readers to use a control that will no longer exist

`SHARE_AT_ADD_RECALLED` still says “Untick this to make it private” ([messages.ts:4781](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/messages.ts:4781>)). In the proposed UI that state offers **Stop sharing**, not a checkbox ([plan:100](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:100>)).

Add this constant and its assertion to the plan. The confirmation’s own Cancel should remain `share.cancel()`; waiting/gave-up Cancel and Stop sharing use `share.untick()`.

### P2 — The meaning-change inventory is inaccurate

The plan says only the import-card tooltip changes a published sentence’s reading ([plan:132](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:132>)). At least three other changes add meaning:

- “Sharing” → “Sharing: off” adds a state assertion.
- “can pass it on” adds a recipient-rights fact.
- “under Shared articles” adds a discoverability/location fact.

The latter two are true; the problem is that Greg asked for meaning changes to be flagged, and the plan calls them “keeps meaning” ([plan:105](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:105>)). Rewrite that audit plainly.

I found no separate truth problem with the introductory line or the two descriptions in the states where they should be shown. Adopted existing articles bypass the section, and both sharing mechanisms retain the inventory, rights tick, and final press.

### P3 — Missing documentation and test updates

- The Help update should explain that the card copies the ordinary address, that a private link is a different address, and that the ordinary address opens for others only when public. Its current adjacent wording remains easy to misread ([sharing.md:36](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/help/pages/sharing.md:36>)).
- `tests/job-card-copy-link.test.tsx` is absent from the plan’s test list. Its exact assertion still expects “the link leads nowhere” ([job-card-copy-link.test.tsx:101](</var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/tests/job-card-copy-link.test.tsx:101>)); item 6 changes that to “the address leads nowhere.” Update it and assert the public/private-address distinction.
- Update checkbox-specific comments in `src/web/add-share.ts`, `src/messages.ts`, and `tests/add-share.test.ts`, not only the three React components. They repeatedly describe ticked/unticked rendering even though the controller remains UI-independent.
- Add the uncertainty-state summary tests above and a pre-provider job-failure tense test. The proposed positive control “POST answered with a job ⇒ has been sent” would merely encode the false premise.

The confirmation-panel redesign, provider naming, and unrelated Add-page cleanup can remain deferred. The high-value simpler version is the proposed buttons, order, descriptions, Help link, and copy icon—without an unsupported “off” claim.

BUILD WITH CHANGES (make the row uncertainty-safe; replace the job-receipt tense condition; allow unknown private links to be turned off; update the reload copy, meaning audit, Help, and tests).