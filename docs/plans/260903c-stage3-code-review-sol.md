The stage has two must-fix issues. The fit-signature concern is handled correctly.

### Mutation that survived

At [Dock.tsx:1574](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:1574), I changed `state={state}` to `state={undefined}` in a temporary copy. All 26 switch tests still passed.

That removes the tooltip’s explanation of why saving/waiting/stale controls will not move—the central justification for `aria-disabled`. Add a test that focuses or hovers the control and inspects the rendered tooltip state, particularly for an inert variant.

### Must fix

1. **The stale state has no recovery path.** [Dock.tsx:1562](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:1562), [Dock.tsx:1619](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:1619)

   `stale` is inert, and only `load-failed` calls `reload()`. Yet the store explicitly provides `reload()` for failed **or offline** loads at [experimental-store.ts:443](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/experimental-store.ts:443). There is no online listener that refreshes this setting; [offline.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/offline.ts:88) only listens for going offline.

   Therefore an initial cached answer remains stale after reconnection, across page navigation, until a full reload or account change. I wrote a one-off test expecting a stale button press to request a fresh value; it failed with `reload` called zero times.

   Treat stale like load-failed for activation: retry the read, never toggle the cached value. That means it should not remain `aria-disabled`; its state copy should say to reconnect and press to check again.

2. **The toggle has both a changing accessible name and `aria-pressed`.** [Dock.tsx:1600](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:1600), [Dock.tsx:1613](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:1613)

   In ready states it announces effectively “Experimental features — Off …, toggle button, not pressed,” then changes its name to “Experimental features — On …, toggle button, pressed.” That duplicates the state and changes the toggle’s identity.

   This repository already records the APG rule at [DictationStrip.tsx:20](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/DictationStrip.tsx:20): use either a changing action name or a fixed name with `aria-pressed`, not both.

   Keep `aria-label="Experimental features"` fixed and expose operational/error text through an accessible description or status. The current test at [dock-experimental-switch.test.tsx:296](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-experimental-switch.test.tsx:296) actively enforces the wrong invariant and must change.

### Should fix

- **Narrow the prop type.** [Dock.tsx:188](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/Dock.tsx:188)

  `Omit<ExperimentalSetting, "since">` does not weaken “the bar is told” and the type-only import is not a step toward subscribing. It does, however, make every future store field automatically part of Dock’s required contract. A `Pick<ExperimentalSetting, ...fields actually read...>` preserves derivation without that coupling.

- Add the tooltip-content assertion exposed by the surviving mutation above.

### Considered and fine

- `aria-disabled` is the right trade for **saving** and **waiting**. A native button funnels pointer, touch, Enter, and Space activation through `click`, so the handler guard covers them; `type="button"` prevents form submission. Stale is the exception because it needs a safe read-only retry.
- Dropping `aria-pressed` for waiting and load-failed is correct. There is no known value in waiting, and load-failed activation is a retry action rather than a toggle. The native button role remains stable. The fixed-name change above removes the real identity problem.
- `toggleVariant` ordering is defensible. Saving-first guarantees inertness; keeping `!loaded` after load-error and stale is essential. The profile line and dock button answer different questions.
- The sixth fit argument is sufficient. Absence and warning-icon variants are represented; on/off already changes `visibleModes`; the remaining class and ARIA changes do not affect geometry.
- `experimental-copy.ts` is the right domain-specific home. Putting successful-control copy into the failure-message taxonomy would be the worse boundary.

Checks: requested suite 26/26 passed; four related suites passed 128/128; scoped lint passed; typecheck passed across all 1,107 covered files.