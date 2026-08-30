## Verdict: STOP — revise the interaction and state design first

The endpoint change is sound. The panel implementation is not. The current plan can lose edits, display stale provenance, and create multiple conflicting editors.

### 1. Blocker — `Tooltip` is not a click-popover

Controlled state does not disable `useHover` or `useFocus`; `Tooltip` always installs both, plus `useDismiss` and `role="tooltip"` ([Tooltip.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tooltip.tsx:168)). `.interactive` changes only `pointer-events` ([styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1516)).

Sequence:

1. The button’s own click sets `open`.
2. The pointer leaves the button toward the card.
3. `useHover` still owns mouse-leave and may close it because the opening was not registered through `useClick`.
4. The proposed wrapper-level `stopPropagation()` also prevents Escape from reaching `getFloatingProps()` on the outer floating node.

`role="tooltip"` is invalid for textareas and buttons. Focus also needs help because the portal sits at the end of `<body>`; without a focus manager, natural Tab order is not adjacent to the trigger.

Use the click-popover already implemented in `ColourPicker`: `useClick`, `useDismiss`, `useRole({role: "dialog"})`, and `FloatingFocusManager modal={false}` ([SearchPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SearchPanel.tsx:1633), [implementation](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SearchPanel.tsx:1685)). Do not modify `Tooltip` into two components disguised as one.

This should be a non-modal dialog: no focus trap, but logical Tab order, Escape dismissal, and focus returned to the trigger.

### 2. Blocker — there is no single owner for the editor

Today `UseProfile` returns `null` when `hasProfile` is false ([WrittenForYou.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/WrittenForYou.tsx:102)). A new reader therefore has neither checkbox, badge, nor profile-panel trigger. The plan’s “write the first profile, then refresh” sequence is unreachable unless the person button remains visible when the checkbox is absent.

At the other end, a profiled artefact can show both a badge and a checkbox. If each trigger owns a `ProfilePanel`, two independent editors can open:

1. Both load profile A.
2. Panel one saves B.
3. Panel two still displays A.
4. Blurring panel two later overwrites B.

Mount exactly one profile-panel controller per owned article. Badges and checkbox-adjacent buttons should only open that controller. Keep its trigger available to owners with an empty profile; hide only the checkbox.

### 3. Blocker — a promise cache cannot implement `refresh()`

A module-level promise can deduplicate the initial request. It cannot update five independent hook states.

Sequence:

1. Five hooks await the same promise and each stores `hasProfile: false`.
2. The panel saves the first profile.
3. Its `refresh()` creates another request and updates its own hook.
4. The other four mounted hooks receive no notification and remain false.

Other failure modes:

- A rejected promise remains rejected forever unless removed on rejection.
- Returning to a previously cached slug gives old global-profile text.
- Saving the global half must invalidate every slug, not only the current one.
- A refresh can replace the cache while an older request still resolves into a caller.
- Unmounting needs a per-subscriber live/generation guard; one subscriber cannot abort a shared request.
- Tests in one file and watch/HMR sessions retain module state. Vitest’s normal file isolation reduces cross-file leakage, but is not a cache lifecycle.
- `flush()` currently returns `void` ([useProfile.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useProfile.ts:92)). Calling `refresh()` immediately races the PATCH and can cache the old value.

Use either a provider at the owned-article level or a small external store with subscriptions/`useSyncExternalStore`. It needs `{status, value, revision, error}`, per-key request generations, rejection eviction, owner/session invalidation, and an awaited mutation/refresh path. The five feature hooks should select only `hasProfile`; they do not need five copies of both private strings.

### 4. Blocker — dismissal can lose edits and dictation

`useDismiss` closes on outside `pointerdown`. Removing a focused textarea need not deliver its blur, so this sequence can skip saving entirely:

1. Type.
2. Press elsewhere.
3. Outside `pointerdown` closes and unmounts the floating content.
4. No blur, therefore no `flush()`.

Even when blur fires, a failed request completes after the error surface has disappeared. Escape and SPA navigation have the same problem; `pagehide` only covers page departure.

Dictation is worse. Its unmount cleanup deliberately aborts transcription and deliberately does not commit ([useDictation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useDictation.ts:1042)). On Safari or Firefox, where words arrive only after stopping, dismissing the panel can lose the whole dictation.

All closing paths need one explicit close routine. It should stop/finish dictation, flush dirty fields, then either:

- remain open until success or error; or
- preserve controller state after visual dismissal and surface failure globally.

During active/transcribing dictation, outside press and Escape should not simply destroy the field.

### 5. High — the artefact will lie immediately after a successful edit

`refresh()` only refreshes `/api/reader`. The “older profile” state comes from each artefact endpoint and is stored independently—for example summaries set `profileChanged` only during `GET /api/summary/:slug` ([useSummaries.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSummaries.ts:85)).

Sequence:

1. A summary says “written for you”.
2. Edit either profile half and save.
3. The server would now calculate `profileChanged: true`.
4. The summary hook is not reloaded, so the badge still says “written for you”.

No regeneration should happen automatically; that part is correct. But successful profile mutation must invalidate or refetch the mounted artefact hooks, or immediately mark profiled artefacts as changed.

Clearing both boxes is the deliberate exception: `profileIsStale` returns false when the effective profile becomes null ([profile.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/profile.ts:260)). The checkbox should disappear, while the historical “written for you” label remains.

### 6. High — the full editor is too much for this surface

The contextual explanation is worthwhile. Two full `ProfileBox` instances inside a floating 352px card are not the 80–20 answer.

Each box can expand into microphone opening state, meter, timer, device name and picker, transcription state, recording recovery, and errors. The textarea is vertically resizable. There is no planned viewport-height constraint. On touch, focusing either textarea adds the software keyboard to an already tall floating object over the article.

The rejected hover-only tooltip was weak, especially on touch. But a read-only, click-opened popover is a stronger alternative:

- Show both current values and explain their scope.
- Offer explicit “Edit about you” and “Edit this article’s purpose” actions.
- Open a full-height sheet/band panel, or navigate to the existing pages.
- If inline editing proves valuable, reveal one editor at a time after an explicit Edit press.

Editing “About you” casually from one article also changes provenance across the whole library. That deserves more spatial and semantic weight than a small popover.

### 7. High — `usePurpose` should not drag Metadata into the panel change

The save race is real. Fixing it is good. Moving Metadata onto a hook “shaped exactly like `useProfile`” is under-specified.

Metadata currently seeds the purpose from its existing metadata response ([Metadata.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:324)). A standalone fetching hook can add another request, another loading state, and a second source capable of overwriting the first.

Extract the save state machine first, with:

- an explicit initial value;
- a slug/resource identity;
- `flush(): Promise<saved value>`;
- generation and in-flight protection;
- an `onSaved`/store-update path.

Keep the two endpoints and writes separate. Let Metadata continue seeding from `provenance`; let the panel seed from the shared reader-profile store. Land and verify the Metadata migration separately from the panel UI.

### 8. Medium — important integration work is missing

- Both `UseProfile` and `WrittenForYou` currently lack a slug. The slug is held above `GlossaryPanel`, `SummaryPanel`, and `IdeasPanel`, then not passed into them. The plan’s “five one-line changes” is therefore materially incomplete.
- Nine tests mock only `useHasProfile`; replacing the export will make those mocks fail or return no `useReaderProfile`.
- The public view is safe only because the owner/visitor component boundaries avoid mounting owner hooks. Preserve that structural guard and test that a visitor makes zero `/api/reader` requests.
- Make the panel slug required. An article-purpose editor without a slug should be impossible, not represented as `purpose: null`.
- Do not inherit the checkbox’s disabled state blindly. Jobs freeze the profile at start. Either keep profile inspection/editing enabled and explain that the running job uses the earlier profile, or disable editing deliberately. Otherwise a job can finish already marked stale.

### 9. The planned tests contain several false positives

- `tests/tooltip-on-link.test.tsx` asserting only `.interactive` would pass while hover closes the panel, its role is wrong, focus cannot enter, and Escape is broken. Mount the real popover and exercise click → pointer transition → Tab → Escape from inside a textarea → returned focus.

- `tests/reader-profile-cache.test.ts` checking “five callers, one fetch; refresh, one more” passes while four callers remain stale. Return false first and true second, then assert all five rendered consumers change. Add rejection/retry and refresh-versus-old-request cases.

- The proposed `j` test passes without `stopPropagation`: global key navigation handles only arrow keys and already ignores textarea targets ([keynav.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/keynav.ts:331)). Test Escape from the actual textarea and arrow-key caret behavior instead. The wrapper-level suppression should be removed.

- “Both boxes render empty” can pass with a directly mounted open panel while a real empty-profile reader has no trigger. Start through the real `UseProfile` owner surface with `hasProfile: false`, then open it as a reader would.

- “Failed save renders its error” passes if the fixture keeps the panel open. Dismiss immediately, reject afterward, reopen, and prove the error remains visible or was surfaced elsewhere.

- The out-of-order purpose test must give each request the normalized value from its own submitted body. A mock that returns the latest shared server value for both responses masks the race. Also, a new-hook test cannot be “seen red against the current inline code” unless Metadata itself is mounted, or the hook is first extracted without the guard.

The route assertions are good as written; keep the whole-body `toEqual` checks.