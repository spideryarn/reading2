- F14 — closed: interior blanks are preserved for replay and rejected; both regression cases pass.
- F15 — closed: artefact-directory-only IDs are carried and cannot launch again; regression passes.
- F16 — closed: evidence paths derive from the open store’s `attemptDir`; foreign-store regression passes.
- F17 — closed: resurrected owner reservations produce `release-untracked` and are released; regression passes.
- F19 — closed: `other-boot` uses `identity.recorded/current` despite a failed boot read; regression passes.

Recorded in [260910f-launch-protocol-stage1-fixcheck-sol-findings.md](/tmp/260910f-launch-protocol-stage1-fixcheck-sol-findings.md). Specified suite: 177/177 passed.