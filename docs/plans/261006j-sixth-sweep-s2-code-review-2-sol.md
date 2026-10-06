**ship with these fixes (applied)**

Round one left no sample manifest, so I rechecked every changed block, including its fixes:

- **Behaviour:** 163 TS/TSX blocks plus nine CSS blocks checked; **64 contained false or overstated claims**.
- **Stylesheet pointers:** all **82 rewrites**, plus round one’s added pointer, checked mechanically; **two section names corrected**. All now resolve.
- **Dead paths:** **12 comment blocks containing 15 references** checked; **none wrong**. The additional `gjd-remote-log.ts` pointer also resolves.

Every finding below was **fixed in comments only**. Related blocks share a finding.

- **C9** — `scripts/db-reown.ts:1`: named removed `db:import` as current.
- **C10** — `scripts/deploy-checks.ts:723`: fixtures are used directly, not copied.
- **C11** — `src/billing/admission.ts:1`: admission inventory omitted minimal papers and upgrades.
- **C12** — `src/block-policy.ts:60`: null-handling explanation predicted an unsupported counting failure.
- **C13** — `src/db/schema.ts:2688`, `src/jobs.ts:1`, `src/store/jobs.ts:724`: inaccurate concurrency, lease fence, automatic requeue, counter, clock and transactional-runner claims.
- **C14** — `src/jobs.ts:337`: obsolete deferral blamed another ongoing edit.
- **C15** — `src/models.ts:1052`: wrong tier inventory, labels output and unsupported cost ranking.
- **C16** — `src/routes.ts:1448`: database errors are scrubbed rather than exposing raw Postgres messages.
- **C17** — `src/source-hash.ts:36`: fingerprint has four fields, not two.
- **C18** — `src/store/job-fence.ts:1`: incorrect call-site count.
- **C19** — `src/store/jobs.ts:237,503`, `src/store/uploads.ts:1`, `src/store/session.ts:334`: deleted adapter and parity mechanisms described as current.
- **C20** — `src/store/pg-jobs.ts:1`, `src/store/pg-revisions.ts:1684`: operations include reads, locks and an owning-job/draft fence.
- **C21** — `src/store/pg-searches.ts:1`: deleted process writer described as live; grace period overstated as proof of writer death.
- **C22** — `src/types.ts:2066`: visibility is not the sole non-artifact field.
- **C23** — `tools/fleet/pause.ts:142`: type has three arms plus omission.
- **C24** — `src/web/article/ArticlePage.tsx:348`: visitor omission of visibility does not mean unknown access.
- **C25** — `src/web/useLibrarySearch.ts:33`: three-character threshold differs from chat’s two-character threshold.
- **C26** — `src/web/AccessSharing.tsx:35`, `src/web/Tooltip.tsx:16`: removed unsupported component/library premises.
- **C27** — `src/web/BlockGutter.tsx:96`, `tests/block-gutter.test.tsx:484`: visitors can see shared marks; marks can fold behind disclosure; source order affects both layout and tab order.
- **C28** — `src/web/DiagramPanel.tsx:1458`: arrows no longer open or close folds.
- **C29** — `src/web/Dock.tsx:1,699,721,2797`, `src/web/dock-fit.ts:1,72,185`: obsolete names, counts, layout assumptions, visibility guards, arrow behaviour, label retention and reversed Comments contexts.
- **C30** — `src/web/HomeLogo.tsx:43`: removed layout behaviour needed historical tense.
- **C31** — `src/web/Masthead.tsx:798`: stale section count and unavailable-navigation claim.
- **C32** — `src/web/OutlinePanel.tsx:167`, `src/web/layout.ts:475`, `tests/chat.test.ts:308`, `tests/shared-notice-hides-with-the-masthead.test.tsx:47`: Reader now owns `.band-covers`.
- **C33** — `src/web/layout.ts:405`, `src/web/reader/Reader.tsx:3571`: `alone` can coexist with Marginalia.
- **C34** — `src/web/PublicChrome.tsx:123,199`: notice hiding depends on a covering band.
- **C35** — `src/web/SearchPanel.tsx:834`: fetched results and historical columns.
- **C36** — `src/web/SettingsSection.tsx:66`: tint comparison overstated the saved-tick rule.
- **C37** — `src/web/StructurePanel.tsx:13`, `src/web/styles/structure-mode.css:29`: measured row windows already exist.
- **C38** — `src/web/TableView.tsx:1259`: sticky offsets no longer measure the head.
- **C39** — `src/web/annotate.ts:127`: sixteen palette slots; paragraph bar separately capped.
- **C40** — `src/web/reader/Reader.tsx:4263`: herald sits at the band’s foot.
- **C41** — `src/web/reader/measure.ts:43`, `src/web/small-screen-hint.ts:8`: obsolete dimensions and laptop exemption.
- **C42** — `src/web/safe-area.ts:27`: registration limitation had a successful retest.
- **C43** — `src/web/scroll.ts:443`: round-one fix incorrectly implied an always-mounted sampler.
- **C44** — `src/web/useArc.ts:7`: pending structure, regeneration and historical fallback misstated.
- **C45** — `src/web/styles/mode-band.css:69`: surviving prose marker excluded from removal claim.
- **C46** — `src/web/styles/narrow-window.css:21,1291`: incorrect phone arithmetic, test coverage and layout generalisations.
- **C47** — `src/web/styles/shell.css:690`: historical empty-bar reasoning presented as current.
- **C48** — `tests/chat.test.ts:281`: old breakpoint presented as current.
- **C49** — `tests/public-network-trace.test.tsx:1729`: capacity rules can use `display: none`.
- **C50** — `tests/spine-width.test.ts:1`: live gist layout and absent checks falsely claimed.
- **C51** — `src/web/Dock.tsx:2470`, `src/web/dock-fit.ts:227`: approximate section names replaced with the actual `.dock` rule.

Changed files are exactly those named above—**51 files**.

Final AST/stripped-CSS comparisons passed for **95 TS/TSX files and seven CSS files**, both for the newest commit and baseline-to-working-tree. Controls detected code mutations and ignored comments. `git diff --check` passed. No network, database or commits.