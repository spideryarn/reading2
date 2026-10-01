Code review of the work built from docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md (read the plan first, including its section "What GPT Sol's plan review changed" — your own plan review is docs/plans/261001l-autosave-mic-plan-review-sol.md).

See the change with `git diff HEAD` plus the new untracked files: src/web/useAutosavedText.ts, tests/autosaved-text.test.tsx, tests/profile-box-autosave.test.tsx. Touched: src/web/ProfileBox.tsx, src/web/useProfile.ts, src/web/ProfilePage.tsx, src/web/Metadata.tsx (the purpose box), src/web/mic-devices.ts, src/web/useDictation.ts (start(): the fallback verdict after beginCapture), src/web/DictationStrip.tsx, src/web/styles/profile.css, tests/dictation-phases.test.ts, tests/mic-devices.test.ts, docs/project/reader-profile.md, docs/project/dictation.md.

You may FIX what you find inside this change (workspace-write). Keep fixes minimal and in the house style (comments that say why, match surrounding density). Do not commit, do not touch git state, do not run anything that writes to a database. After fixing, run: `npx vitest run tests/autosaved-text.test.tsx tests/profile-box-autosave.test.tsx tests/mic-devices.test.ts tests/dictation-phases.test.ts tests/profile-mic-button.test.tsx tests/profile-shelf-failure.test.tsx` and `npm run typecheck`, and report their results.

Look hardest at:
1. useAutosavedText: the serial queue (inFlight/queued), the epoch on seed, the conditional write-back via the `now` ref, `state` derivation (can it ever say Saved/clean while the server lacks the box's text?), the pagehide/visibilitychange listeners, and the recursive `commit` call in `finally`. Any stuck-inFlight path (e.g. save() throwing synchronously)?
2. ProfileBox: the idle timer keyed on value only (and why), `busy` gating, beforeunload attached only while pending; whether `error` state loops.
3. Metadata: the hook replaces purposeDraft/purposeSaved; the seeding effect per slug; `refresh()` inside save; leavingFetch to /api/library/<slug> with {purpose} — check the server route actually accepts that body for PATCH (src/routes.ts patchShelf).
4. useDictation start(): the `await listInputs()` added between beginCapture and assigning s.track — is the bail-out (stop the track and return) correct w.r.t. the mic claim (mic-lock.ts) and finish()? Does anything else assume no await there? judgeFallback's uniqueness + id rule; rememberDevice clearing the label when the id changes; legacy id-only warns once then forgets.
5. Anything that reports success while doing nothing (docs/reusable/silent-success.md), and any test that could not fail.

Answer with numbered findings, severity P0–P3, file:line, what you fixed (if anything) and what you left for me with a reason. Then the test/typecheck results.
