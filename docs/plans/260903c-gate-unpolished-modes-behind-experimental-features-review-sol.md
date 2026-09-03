The plan is not ready to build. The filtering idea itself is sound, but the state ownership, fit key, stage counts, and failure behavior have concrete holes.

## Ranked findings

1. **Must-fix — declining the shared store is based on a false lifecycle assumption.**

`SettingsSection` and `Dock` do not coexist, but separate `Dock` instances replace one another as the reader moves among article, metadata, and tweets. The article payload persists across those views, but each view mounts its own Dock ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/App.tsx:741), [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Metadata.tsx:899), [Tweets.tsx](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Tweets.tsx:319)).

Concrete failure:

1. Experimental is off.
2. Reader turns it on in the Dock; the old hook updates optimistically and starts its PATCH.
3. Before the PATCH completes, they click Metadata.
4. The new Dock mounts a new hook and its GET races ahead of the PATCH, reading `off`.
5. The PATCH commits `on`, but its hook is unmounted. The new Dock remains off indefinitely.

The same race exists from `/profile` to an article. This is exactly the disagreement the operating manual says the first gate must prevent ([experimental-features.md](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:71)).

The offline cache does not fix it: `apiFetch` is network-first and consults IndexedDB only after a transport failure ([api.ts](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/lib/api.ts:431), [api.ts](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/lib/api.ts:590)). A shared, user-keyed in-memory owner for the setting is due now.

2. **Must-fix — Stage 3 has no reliable signal for whether to draw the toggle.**

The plan says the toggle is signed-in-only, but `useExperimental`’s public result does not expose authentication. Inferring it from `loaded` is impossible because Stage 1 deliberately makes signed-out mean `loaded: true`.

Using `Dock`’s existing `signedIn` prop also fails: owner metadata and tweets mount `<Dock>` without it. It is currently documented as visitor-copy input, not general authentication ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:189)).

Concrete failure: a signed-in owner sees the toggle on the reading view, clicks Metadata, and the toggle disappears. The plan must settle where the authenticated identity comes from before Stage 3.

3. **Must-fix — Stage 1 specifies the initial anonymous case, not the session lifecycle.**

A second `onAuthStateChange` subscription is not intrinsically dangerous: its callback only updates state and does no refresh-triggering work. It does, however, add a second `pageshow → getSession()` call, and its downstream fetch effect must be keyed on stable `user.id`, not the `User` or `Session` object. Otherwise frequent `SIGNED_IN` events on tab focus can produce repeated `/api/reader` GETs.

More importantly, the plan does not define or test:

- loading → signed in: clear any prior state, become not-loaded, fetch once;
- signed in → signed out: synchronously expose off and invalidate pending loads/saves;
- account A → account B: never render A’s setting for B;
- a late GET/PATCH after sign-out;
- `set()` while signed out issuing no PATCH.

The single proposed anonymous-mount test would pass while several of those are broken. `loaded: true` for signed out is honest as the **effective gate answer**—anonymous is forcibly off—but only if transitions cannot leak the prior account’s value.

4. **Must-fix — visible count is not a sufficient `fitSignature`.**

When experimental is off, the current experimental mode is retained. Changing from `?mode=quotes` to `?mode=remember` keeps the same button count but changes the row width because the labels differ. The fit effect will not rerun, since the present signature receives `mode` but records only `"seg"` or `"links"` ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:554)).

At a threshold width, this can leave overflow after moving to a wider label or leave labels unnecessarily dropped after moving to a narrower one. The signature needs the identities of the visible modes, not just their count. Stage 3 must also include whether the experimental toggle itself is present.

When remeasurement does occur, `chooseDockFit` starts again from rung 0, so it can correctly restore labels when room returns. There is no inherent one-way compaction bug; the missing trigger is the problem.

5. **Must-fix — the Stage 2 counts contradict the plan’s non-blocking claim.**

There are thirteen modes today. Five hidden means:

- off: **8**, because both Hierarchy and Outline remain visible;
- on: **13**.

Seven/twelve is correct only after Structure replaces those two. Therefore the proposed 7/12 tests cannot pass against this tree while the work remains independent of the Structure merge ([plan](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md:133)).

Several existing tests also require deliberate changes, not merely new coverage:

- `profile-settings.test.tsx` mounts the real hook without posing a signed-in session.
- `modes-that-start-themselves.test.tsx` must be able to press Quotes and Timeline.
- `public-network-trace.test.tsx` asserts that every `MODES` member has a visitor button and that a signed-in visitor’s only extra reads are article probing and jobs.
- `dock-fit.test.ts` expects more than ten loose mode links.

Those tests hold important invariants; simply weakening their counts would lose coverage.

6. **Must-fix — the Dock toggle has no failure or retry behavior.**

`useExperimental` exposes `loadError`, `error`, `stale`, and `reload` because a dead or lying switch is unacceptable ([useExperimental.ts](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/useExperimental.ts:95)). Stage 3 uses only `loaded`, `saving`, `on`, and `set`.

Concrete failures:

- A load failure leaves a permanently disabled button with no explanation and no retry.
- A save failure makes the modes appear/disappear optimistically, then snap back, without saying the change was not saved.
- An offline copy disables the control without explaining why.

A static tooltip explaining experimental features does not explain any of those states.

7. **Must-fix — Stage 4 makes Stages 2 and 3 unsafe to ship as documented.**

After Stage 2, the operating manual still says “Nothing is behind it” ([experimental-features.md](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:91)). That directly violates both the manual’s “say so in the same piece” rule and the repo’s update-docs-as-you-go agreement.

The behavior-owning documentation must land with Stage 2. Stage 3’s new control documentation can land with Stage 3. A final docs-only stage is not compatible with “every stage safe to ship.”

8. **Should — make experimental status an explicit total decision.**

“Five rows gain `experimental: true`” suggests an optional flag. If so, a newly added mode that omits it silently becomes polished/default-visible, despite `new-mode.md` saying the author must decide.

`ModesMissingFromDock` proves that every mode has a row; it does not prove that every row made an experimental-status decision. This is only truly compiler-checked if every row carries an explicit boolean or equivalent required classification.

9. **Should — the “always draw current mode” rule does not cover the loose-link arm.**

On reading views, retaining the current mode keeps exactly one radio checked. That part works.

On metadata and tweets, `mode` is absent and the controls are loose links, so the current experimental mode cannot be retained. From `?mode=timeline`:

- Metadata navigation carries `mode=timeline`.
- Metadata’s Dock omits Timeline when experimental is off.
- The page’s Back link or browser Back returns to Timeline.
- The reading-view Dock then restores Timeline as the checked radio.

There is no invalid radiogroup on metadata because there is no radiogroup there, but the bar visibly loses the mode the reader came from and cannot return to it through that bar. The plan needs to declare whether that is intentional and test it; it currently presents “always” as universal.

10. **Should — the combined `marked`/experimental policy needs a matrix test.**

The two mechanisms compose reasonably if visibility is derived once and `marked` is applied afterward:

- Plain guarantees the reading-view segment cannot be empty.
- A direct experimental URL adds its current button, so one radio remains checked.
- If that current mode is visitor-restricted, it is both present and marked, which correctly exposes the visitor explanation.
- Hidden experimental modes simply make entries in `marked` unused.

The visitor description in the prompt needs one correction: after Structure lands, seven default modes are visible, but only Search and Chat are unconditionally owners-only. Glossary and Ideas may also be dimmed when their artefacts are absent, for the distinct “not built” reason. In today’s tree it is eight default modes.

The plan tests only owner-style counts and one current-mode case. It does not prove signed-out visitor, signed-in visitor off/on, missing/present public artefacts, current experimental visitor mode, and both Dock arms.

11. **Should — the flash discussion misses the useful third option and overstates the cache.**

There is no synchronous answer on a cold load under the current bearer-token architecture, so some unknown-state presentation remains unavoidable.

But a shared in-memory store can begin the reader-setting request as soon as the session resolves, in parallel with the article request, and retain it across SPA view changes. That is not a second source of truth like `localStorage`; it is the one client copy of the latest server answer. It often removes the first Dock flash and always removes repeat flashes within the session. The current offline cache does not make an online second visit instant.

## Other surfaces

**Noted — keep these ungated.** `MODES`, the URL parser, page titles, `MODE_LABEL`, feedback diagnostics, activation, and the passage resolvers should continue recognizing all modes. That is what preserves direct links and hidden-mode rendering. There are no global keyboard shortcuts that separately expose modes.

The sharing inventory and public metadata should also continue listing all carried artefacts. A signed-out visitor may therefore be told that quotes exist while Quotes is absent from the Dock; that is slightly awkward, but it is the deliberate distinction between “this data is shared” and “this unfinished control is advertised.”

## Staging answer

Stage 2 does **not** need to be merged with Stage 3 merely for product safety. `/profile` already contains the canonical switch, and signed-out readers are deliberately fixed off, so gating before adding the convenient Dock toggle is a coherent intermediate product.

Stage 2 as currently written is nevertheless not shippable because its counts are wrong, existing tests will fail or lose meaning, and the documentation remains explicitly false until Stage 4.