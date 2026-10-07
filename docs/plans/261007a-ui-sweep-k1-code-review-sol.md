K1-CSS-7Q4M

Three findings, all fixed narrowly and left uncommitted. No established P0 or P1.

- **K1-F1 — P2, established: the outline checker inherited a text-only exception.** `resolvesToSurface("--page")` returned false, so `outline: 2px solid var(--page)` passed despite naming a surface. The new regression failed with zero hits instead of one. **Fixed:** outlines reject `--page`, its aliases, and literal page definitions; text retains its existing exception. The checker’s wording now states its actual strength: a token-name tripwire, not measured contrast.

- **K1-F2 — P2, established: the contrast guard could pass below the recorded sampling method’s floor.** Mutating Dark’s `--danger` to `oklch(0.657 0.2 27.325)` passed all 73 original palette tests: continuous contrast was **4.500077:1** on the raised surface. Rounded sRGB bytes `[243, 81, 72]` give **4.495350:1**. **Fixed:** the existing three danger pairs also check byte-sampled contrast. That mutation then failed; the chosen `0.7` value was restored and passes. This models the saved canvas sampling method, not every browser’s gamut mapping.

- **K1-F3 — P3, established: the plan incorrectly said headings change only in Light.** The saved Dark measurements record a new `solid 2px` outline at `2px` offset. **Fixed:** the Light-only statement now covers the profile border and outline-row recolourings; headings gain an outline in both themes.

**1. Does any change alter what a reader sees beyond what the plan says? No established additional change.** Every changed selector falls into these cases:

| Changed selectors | Cascade result |
|---|---|
| `.loading, pre.error` | `.loading` keeps its rule. `pre.error` gains element specificity, with no competing rule on the actual refusal element. Failed chat rows regain inherited `.chat-tools` typography and colour; dock status loses the shell padding and whitespace. |
| `.chat-tool.error .chat-tool-detail` | Overrides ordinary detail opacity `0.7` with `1` and uses danger. The running rule targets the label; no competing detail hover rule exists. |
| `.sk-in-full .sk-scene:not(.on)` | Selected chips cease matching the fullscreen cap, so `.sk-scene.on { max-width: none }` wins. Closed chips keep `20rem`. |
| Guarded `.gloss-btn…:hover` | Unavailable controls retain resting colours. Increased live-hover specificity also outranks `.gloss-btn.primary`, whose affected colours are identical. Citations’ `aria-disabled` change is recorded. |
| `.quotes-empty .quotes-hint` | Beats `.quotes-empty p` for colour and size, preserving the old important declarations. Its sole emitter is inside `.quotes-empty`. |
| Five marginalia focus selectors; `.chat-card-shut:focus-visible` | Outline colour changes; width and offset stay. |
| `.prof-box-input:focus-visible`; `.outln-row.focused` | Border/shadow colour changes only. |
| `PageSection` focus utilities | Add the specified outline while retaining text recolouring. All three new utilities compile. |
| `.tooltip.tip-cite`; `.tip-hit` | Replace their bare maximum with the recorded viewport cap. Narrowing is explicitly documented. |
| Coarse-pointer input/select/textarea selectors | Only the font-size floor changes below a 16px root; larger roots retain their size. Utility overrides remain documented. |
| `.dock-btn.soon`; `.diag-opt-label` | Removing the undefined token’s fallback preserves the rendered colour. |
| Six destructive-fallback sites | Defined tokens already won; removing fallbacks preserves rendering. |
| `.fb-show-button[aria-pressed="true"]` | Saved before/after paint samples agree. |
| Token comments and `/design` swatch row | Comments have no rendering effect; the new swatch is specified. |

**2. Is the bare-class census complete? Yes, for the current source.** The four emitters are ArticlePage, LogoLoader, ChatPanel and Dock. The runtime class mutations and computed class expressions revealed no fifth. Ordinary article HTML cannot retain arbitrary `error` or `loading` classes under the sanitiser’s allowlist. Fleet uses a separate stylesheet.

**3. Is danger fully guarded as claimed? No in the original candidate; corrected by K1-F2.** The chosen values themselves pass all three surfaces in both themes. Dark’s clipping agrees with the saved RGB bytes after rounding. Danger has distinct values from unchanged destructive. Full opacity is appropriate; Candidates never emits the `error` class, so its details remain unaffected.

**4. Is every “What in the umbrella was false” statement accurate? No originally; corrected by K1-F3.** The other statements are supported. The tooltip evidence establishes narrowing and rejects off-screen overflow. Restoring its cap remains within the umbrella’s explicit instruction.

**5. Is the new outline check accurate and justified? No at its original stated strength; yes after K1-F1.** It earns its place by guarding the demonstrated surface-token mistake. It still cannot prove contrast, reachability, border/shadow marks, or theme-specific alias behaviour.

Validation: six targeted suites passed, including both changed test files; typecheck passed. The stylesheet suite passed five checks, with its sixth blocked by `spawnSync git EPERM`. Palette lint passed; token-test lint reports the pre-existing `valueOf` naming violation. No browser, database or whole-suite run was attempted.

Files changed:

- [tests/css-tokens.test.ts](/var/tmp/spideryarn-worktrees/agent-a9363ef371ceb477c/tests/css-tokens.test.ts)
- [tests/appearance-palette.test.ts](/var/tmp/spideryarn-worktrees/agent-a9363ef371ceb477c/tests/appearance-palette.test.ts)
- [K1 plan](/var/tmp/spideryarn-worktrees/agent-a9363ef371ceb477c/docs/plans/261007a-ui-sweep-k1-css-status-rows-focus-marks.md)

VERDICT: ready with these fixes