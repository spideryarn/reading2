# Review this plan before it is built

You are reviewing a **plan**, not code. Repo: Spideryarn, a reading app. You are in a git worktree at
the repo root; read any file you like, and run a test file if it helps.

Read, in this order:

1. `docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md` — the plan under review.
2. `docs/project/experimental-features.md` — the feature's operating manual, written when the switch
   was built and nothing was behind it.
3. `src/web/useExperimental.ts` — the hook stage 1 changes. Read its header comments; a previous
   review of yours is quoted in them.
4. `src/web/Dock.tsx` — the bottom bar. `MODES_UI` (~line 349), `DockModes` (~line 1025), the loose-link
   arm (~line 715), `ModesMissingFromDock` (~line 531), and the `marked` prop's doc (~line 187).
5. `src/web/visitor.ts` — `POLICY`, the total record that says what a visitor may have of each mode.
6. `src/web/dock-fit.ts` and `fitSignature` in `Dock.tsx` (~line 552).
7. `src/web/useSession.ts` — what stage 1 proposes to read.
8. `src/modes.ts` — the thirteen modes.
9. `docs/project/new-mode.md` — the checklist for adding a mode.

## The context you need

The switch exists and **nothing has ever been behind it**. Greg has now chosen the split:

- Always visible: Plain, Structure, Summary, Glossary, Search, Ideas, Chat
- Behind the switch: Quotes, Timeline, Referee, Diagram, Remember

*Structure* is a not-yet-built merge of Hierarchy and Outline
(`docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md`); the plan explains why it
does not block on it.

There is a second, orthogonal mechanism already in the bar: `marked` / `visitor.ts`'s `POLICY`, which
**dims** modes a visitor cannot use but leaves them pressable, deliberately. The plan adds a
mechanism that **removes** buttons. Two mechanisms deciding what the bar draws is the thing I most
want you to attack.

## What I want from you

Rank your findings. For each, say whether it is a **must-fix before building**, a **should**, or a
**noted**. Be concrete about the failing case.

Please cover at least:

1. **Two mechanisms, one bar.** `marked` (dim, still pressable, visitor-facing) and experimental
   (not drawn at all, reader-facing) now both decide the mode segment's contents. Do they interact
   badly? Concretely: a signed-out visitor sees the seven default modes, four of which are dimmed
   owner's-only. Is that the right bar? Is there a combination that produces an empty or nonsensical
   segment, or a radiogroup with nothing checked?

2. **The "always draw the current mode" rule.** Does it actually keep the radiogroup honest in every
   arm? Note that the loose-link arm (metadata/tweets pages) is passed no `mode` at all. What does a
   reader see if they navigate from `?mode=timeline` on the reading view to the metadata page and
   back?

3. **Not building the provider.** The plan declines the shared store that
   `experimental-features.md` says is due at the first gate, on the grounds that both consumers are
   inside one `Dock`. Check that claim against the code — is the Dock really the only place, once
   stage 3's toggle exists? Does `SettingsSection` ever coexist with a Dock? Does the offline cache
   or `apiFetch` change the answer?

4. **Stage 1's session-reading hook.** `useExperimental` would call `useSession()` internally.
   Mounting a second `onAuthStateChange` subscription — any hazard, given that file's warnings about
   `SIGNED_IN` firing on tab focus and about refresh-triggering work? What happens on sign-out while
   the reading view is mounted, and on sign-in? Is `loaded: true` honest for a signed-out reader?

5. **The flash.** Seven buttons, then twelve, one round trip later, for a reader with the switch on.
   The plan accepts this and names the two alternatives it rejected. Is there a third I have missed
   that does not put a second copy of a server-owned fact in the browser?

6. **`dock-fit`.** The plan says `fitSignature` must include the visible count. Read `dock-fit.ts`
   and `fitSignature` and say whether that is sufficient, and whether the ladder can now settle on a
   rung that is wrong in the other direction (labels dropped when there is room).

7. **Anything the plan has not thought of.** In particular: other surfaces that list modes and would
   now disagree with the bar (page titles, `src/title-text.ts`, keyboard shortcuts, the URL parser,
   `search-hits.ts`, the visitor pages), and whether hiding a mode breaks any test that counts
   buttons.

8. **The staging.** Four stages, each meant to end with the tree green and safe to ship. Is stage 2
   shippable without stage 3 — i.e. is a bar with five modes missing and no way to get them back,
   other than typing a URL or visiting `/profile`, an acceptable intermediate state? Say so plainly
   if you think 2 and 3 should be one stage.

Do not rewrite the plan. Tell me what is wrong with it.
