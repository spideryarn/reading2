# Review: the experimental-features switch, in the bottom bar (stage 3)

You reviewed the plan for this job and both earlier stages. This is the last one, and it is the one
you left a note for: *"Stage 3 must key fitting on every visible toggle shape, not merely its
presence."*

Read the **built code**, not the prose about it, and weight what you can reproduce over what you can
reason to. Your sandbox can run a test file; please run at least
`npx vitest run tests/dock-experimental-switch.test.tsx` and try to break something.

## What Greg asked for

> And also show a button at the end of the bar to enable "Experimental Features" for logged-in users
> with tooltip to explain what this does.

## The files

- `src/web/Dock.tsx` — `DockExperimental` (now `Omit<ExperimentalSetting, "since">`),
  `toggleVariant`, `SWITCH_STATE`, `DockExperimentalSwitch`, `fitSignature`'s sixth argument.
- `src/web/experimental-copy.ts` — **new.** The sentences both controls say.
- `src/web/SettingsSection.tsx` — reads the shared copy now instead of its own constants.
- `src/web/Tooltip.tsx` — `ControlTip` gained an optional `state` line.
- `src/web/styles.css` — `.dock-btn.soon`, a dead rule, gets its first user.
- `tests/dock-experimental-switch.test.tsx` — **new**, the table.
- `tests/helpers/experimental-fixtures.ts` — widened; a signed-out fixture exists now.
- `tests/dock-experimental-modes.test.tsx` — your two stage-2 *shoulds*, plus the new `fitSignature`
  argument.
- Docs: `docs/project/experimental-features.md` § The two controls, and the plan's stage-3 outcome.

The scoped diff is attached below, and the whole tree is available to you.

## The decisions I most want attacked

1. **`aria-disabled` rather than `disabled`** for *saving*, *waiting* and *stale*, with the refusal
   in the click handler. The argument: a `disabled` button in Chrome fires no pointer events and
   takes no focus, so the tooltip explaining why it will not move would be unreachable in exactly the
   states that need explaining. The cost: a click that does nothing, which this codebase treats as a
   defect elsewhere. Is the trade right, and is the guard actually complete — keyboard, Enter/Space,
   form submission, anything I have missed?
2. **`aria-pressed` is dropped, not `false`, in `waiting` and `load-failed`.** With no answer, or a
   read that failed, there is no value to report. Is dropping the attribute the right ARIA, or does
   it break the control's identity as a toggle for a screen reader mid-session, when it switches from
   pressed-something to plain button and back?
3. **`toggleVariant`'s order.** `saving` first, `!loaded` last. A failed load and an offline copy
   both leave `loaded` false in `experimental-store.ts`, so a `!loaded` test at the top would swallow
   both and strand the reader with a dead button. `SettingsSection.tsx` orders it differently
   (loadError above saving) and I did not make them match — is that divergence defensible for a
   button versus a line of prose, or is it a trap?
4. **`fitSignature`'s sixth argument is the variant, not a boolean.** Six exclusive appearances, and
   the two broken ones draw a second icon. Is there any width-changing thing about this button that
   the signature still does not carry?
5. **`DockExperimental` is now `Omit<ExperimentalSetting, "since">`.** It was a hand-written
   one-field interface. Does this weaken the "the bar is told, it does not subscribe" contract, and
   is the type-only import of the store into `Dock.tsx` a step towards the hook call that was
   deliberately refused?
6. **The copy moved into a new module.** The plan said `src/messages.ts`; I judged that wrong,
   because that file is explicitly the *failure* copy and `FailureKind` governs it. Is
   `experimental-copy.ts` the right home, or is a third home for reader-facing strings a mistake?

## What I already checked, so you can spend your time elsewhere

Every assertion in the new test file was checked by mutation — a test of six failure states that has
never been red is six states nobody has visited. Five mutations, all caught:

| Mutation | Tests that went red |
|---|---|
| `aria-pressed={setting.on}` unconditionally | 2 |
| drop `if (inert) return;` from the handler | 3 |
| press always toggles (no `reload()` branch) | 1 |
| `fitSignature` keys on presence, not variant — your stage-2 warning | 1 |
| the switch keyed on `Dock`'s `signedIn` prop instead of the store's | 10 |

`npm run typecheck` is clean. The full suite has two unrelated server-side failures that predate
this work (`store-revision-policy` sees an `illustrated` column another agent's migration added to
the shared local Postgres; `store-comments`), plus timeouts under machine load.

## What I am *not* asking

The choice of which five modes are behind the switch is Greg's and is settled. The store's internals
were your stage-1 review and have not changed.

## Please answer

**Must fix** (a defect a reader would meet, or an invariant that is not held), **should fix**, and
**considered and fine**. Name the file and line. If you can produce a mutation that survives the new
tests, that outranks everything else in the review.
