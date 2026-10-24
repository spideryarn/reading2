MAIN-ICON-PLAN-261024

**Verdict: approve.** No established P0/P1 findings. The proposed owner doc, retained anchor, existing rendering paths and focused checks are a sensible minimum.

**F1 — P2, reasoned: clarify what `brand:check` means by “freshness.”** At plan line 19, distinguish PNG/ICO/proof byte freshness from OG structural validation. `make-og-card.ts` always writes; `tests/og-card.test.ts` checks dimensions, size and metadata, but cannot detect an outdated reader image. The smallest solution is explicit command/documentation wording: `brand:update` regenerates OG; `brand:check` verifies icon/proof freshness and OG structure. No new OG renderer/check framework is needed.

Concrete implementation traps:

- Downsample app samples from generated `spideryarn-logo.png`; retain each generated favicon’s own pixels. Enlarge the 16px diagnostic with smoothing disabled.
- Test each proof independently as missing and stale, and confirm check mode creates no destination directories or files.
- Compare public asset hashes before and after exercising `brand:update`; the existing OG documentation explicitly disclaims cross-OS byte equality.
- Use explicit test filenames for the focused alias; a broad `metadata` filter could pull unrelated tests back in.

Read-only review completed; no edits or network access.