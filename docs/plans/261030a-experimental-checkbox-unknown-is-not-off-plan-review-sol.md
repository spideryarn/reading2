1. **P2 should fix — an indeterminate Experimental checkbox can be enabled.** [SettingsSection.tsx:84](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/src/web/SettingsSection.tsx:84), [SettingsSection.tsx:96](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/src/web/SettingsSection.tsx:96)  
   Reproduce: successfully load the setting, call its public `reload()`, then make that read fail. The store retains `loaded: true` while setting `loadError`; therefore `hasValue` is false but `disabled={!loaded || saving}` is false. Clicking this enabled mixed box clears `indeterminate` and can write a value. No current UI calls `reload()` from `ready`, but the store permits it and the 32-state table explicitly includes this combination. Disable when `!hasValue(experimental)` too, and add an invariant test that every unknown checkbox state is disabled.

2. **P2 should fix — `hasValue` and Dock agree exactly, but can agree on the wrong answer after a pre-load save failure.** [experimental-store.ts:214](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/src/web/experimental-store.ts:214), [experimental-store.ts:603](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/src/web/experimental-store.ts:603)  
   Hold the opening GET, call `set(true)`, reject the PATCH, and hold the recovery GET. The resulting state is `loaded:false`, `error:…`, `on:false`; `on` is again the never-loaded placeholder, but `hasValue` returns true because every failed save is assumed to have restored a known value. Dock likewise chooses `save-failed` and draws off. Either reject `set()` while `loaded` is false—the simplest and consistent with every current UI—or preserve whether the pre-save value was known and use that in both renderers.

3. **P2 should fix — the reference doc contradicts the implementation and plan.** [experimental-features.md:164](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/project/experimental-features.md:164)  
   “Both ask one function” is false: only `SettingsSection` calls `hasValue`; Dock independently derives a variant and `SWITCH_LOOK`. The plan explicitly chose that arrangement. Say that the checkbox calls `hasValue` and the exhaustive test holds Dock’s independent rule equivalent.

4. **P3 nit — clean up overclaims and draft residue.** [postmortem:29](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/postmortems/261030a-a-second-control-on-one-store-drew-the-placeholder-as-the-answer.md:29), [postmortem:31](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/postmortems/261030a-a-second-control-on-one-store-drew-the-placeholder-as-the-answer.md:31), [postmortem:61](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/postmortems/261030a-a-second-control-on-one-store-drew-the-placeholder-as-the-answer.md:61)  
   Remove `<!-- timing: filled in below -->`; avoid claiming one exact screen-reader utterance without naming a tested browser/AT pair—say it exposed unchecked and disabled semantics. Change “Shipped” until the change has actually landed.

The original diagnosis is otherwise right: there is one store and column; the offline cache is network-first and explicitly marked stale; session changes reset and fence the store; and the collapsed Settings section merely delays mounting and therefore starts the vulnerable loading window later.

The callback refs are correct in React 19. Because each inline function has a new identity, React detaches and reattaches it on every render, so a reused input gets its property updated; the null call is harmless. This matches [React’s callback-ref documentation](https://react.dev/reference/react-dom/components/common#ref-callback).

`indeterminate` plus an explicit loading/failure description is reasonable and preferable to making the row appear late. Intended unknown states remain disabled, so there is no keyboard regression once finding 1 is fixed.

For `HighPowerSwitch`, `since !== undefined` is the right known-value boundary, and the same condition controls both `indeterminate` and `disabled`; it cannot become mixed and enabled. The change does not break its local post-PUT state or later metadata synchronization.

Targeted result: 4 files, 79 tests passed.

**Verdict: approve with fixes.**