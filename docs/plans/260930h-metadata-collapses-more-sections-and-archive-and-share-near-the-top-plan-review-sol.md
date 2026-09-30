No P0 findings.

### P1

1. The proposed `useArchive(slug, archivedAt)` API cannot enforce “failed metadata read ⇒ unknown ⇒ no button.”

   A failed refresh deliberately keeps the previous metadata while setting `provenanceError` ([Metadata.tsx:503](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:503), [Metadata.tsx:520](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:520)). The existing archive component derives `at` from that retained `archivedAt`; `failed` matters only when `at` is already `undefined` ([Metadata.tsx:2319](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:2319), [Metadata.tsx:2393](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:2393)). Therefore a failed refresh can leave both archive buttons enabled from stale state, contrary to the plan’s claim ([plan:48](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md:48), [plan:67](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md:67)).

   Pass read validity into the hook and use roughly `acted ?? (failed ? unknown : archivedAt)`. A successful write or re-read in `acted` should remain authoritative. The existing failed-write re-read itself is sound and should move intact ([Metadata.tsx:2347](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:2347)).

2. “Focus the first control” is neither stable nor what the plan says it is.

   On a public article, the first focusable control is the read-only public-link input, followed by Copy—not Stop sharing ([AccessSharing.tsx:516](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/AccessSharing.tsx:516), [AccessSharing.tsx:854](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/AccessSharing.tsx:854)). On a private article, the first button is safe: it only opens confirmation ([AccessSharing.tsx:578](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/AccessSharing.tsx:578)); publishing still requires checking the rights box and then pressing the disabled-until-checked button ([AccessSharing.tsx:618](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/AccessSharing.tsx:618), [AccessSharing.tsx:632](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/AccessSharing.tsx:632)). So there is no one-keypress publication risk, but the plan’s “Share or Stop sharing” assertion is wrong ([plan:78](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md:78)).

   Simpler and more reliable: focus the Access & sharing heading or card with `tabIndex={-1}`. That works even in loading/error states and announces where the reader landed without placing an action under Enter. Scope lookup through `body.current`; the file already documents why document-wide lookup is wrong when two metadata pages are mounted ([Metadata.tsx:690](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:690)).

3. `keepMounted` will break existing Delete tests despite the plan saying those suites keep passing.

   `Section` adds an extra wrapper whenever `keepMounted` is used ([Metadata.tsx:3285](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:3285)). The Delete suite assumes the section’s direct child is the card ([metadata-delete-permanently.test.tsx:256](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/tests/metadata-delete-permanently.test.tsx:256)) and asserts that card’s first child is the trigger button ([metadata-delete-permanently.test.tsx:446](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/tests/metadata-delete-permanently.test.tsx:446)). With the wrapper, that assertion sees the card `<div>`, not the button. This contradicts [plan:108](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md:108). Update those helpers and make the action tests open the disclosure before interacting; programmatic `.click()` currently works on hidden controls and can give misleading green results ([metadata-export-button.test.tsx:229](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/tests/metadata-export-button.test.tsx:229)).

4. The planned tests do not protect the shared archive state’s important failure and reverse paths.

   The proposed happy-path test exercises only top → bottom ([plan:102](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md:102)). Add tests for:

   - Bottom Archive/Put back updating the top control.
   - An initially archived article sending `{archived:false}` and relabelling both controls.
   - A failed PATCH followed by a successful re-read: both controls reflect the fresh server state while the error remains.
   - PATCH and re-read both failing: neither location offers an archive control.
   - A failed metadata refresh after an earlier successful read.
   - While one archive request is pending, both buttons are disabled and only one PATCH can be sent.
   - Fixture state hiding both top actions.
   - Share… leaving confirmation closed and issuing no new request; then the existing card flow still requires rights confirmation before any visibility PUT.

### P2

5. Keeping Export/Delete mounted is reasonable for in-flight operations, but keeping a `role="alert"` inside `hidden` does not preserve its announcement.

   The native `hidden` wrapper removes its descendants from the accessibility tree ([Metadata.tsx:3285](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:3285)). Thus an export or delete error arriving while collapsed will not be announced, despite the plan citing the retained alert as a benefit ([plan:26](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md:26); alert locations: [Metadata.tsx:1745](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:1745), [Metadata.tsx:3031](/home/greg/code/spideryarn2/.claude/worktrees/fb-6z-metadata-collapse-archive-share/src/web/Metadata.tsx:3031)). Hidden descendants are not normally keyboard-focusable, so that part is safe. Either auto-open on error, expose a visible heading-level error indicator, or explicitly accept that the error is only discovered on reopening.

Verdict: **build with changes**.