Nine stage findings fixed, each reproduced red-first. No P0 findings. Nothing committed; migration unchanged. [Full review and evidence](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/docs/plans/261004h-reception-lists-citers-code-review-sol.md).

| ID | Severity | Location | Fixed behaviour | Regression in `tests/` |
|---|---|---|---|---|
| C1 | P1 | `citation-index.ts:251` | Correct authors with suffixes, comma order or long compound names no longer fail confirmation. | `citation-index.test.ts`: author cases |
| C2 | P2 | `web/useCiters.ts:113` | Invalidated reads also clear their ask-once mark. Current component keys prevent normal navigation reaching this spinner defect. | `use-citers.test.tsx`: pending article revisited |
| C3 | P2 | `web/useCiters.ts:59` | Malformed citer rows become `unavailable` before rendering. | `use-citers.test.tsx`: malformed rows |
| C4 | P1 | `citer-link.ts:20` | DOI links preserve literal percent escapes and backslashes. | `citation-index.test.ts`: URL metacharacters |
| C5 | P1 | `citation-index.ts:344` | Oversized target records return `too-large`, avoiding an ineffective retry. | `citation-index.test.ts`: oversized target |
| C6 | P1 | `web/DebatePanel.tsx:1152` | The pre-search list uses the band’s scroller. | `debate-panel.test.tsx`: pre-search scroller |
| C7 | P3 | `messages.ts:4821` | Dropped-record copy includes invalid identifiers. | `citation-index.test.ts`: malformed id |
| C8 | P3 | `messages.ts:4780` | The information card discloses the service contact address. | `debate-panel.test.tsx`: contact disclosure |
| C9 | P3 | `web/PrivacyPage.tsx:379` | Privacy copy distinguishes import, later citation lookups and Reception. | `privacy-page.test.ts`: lookup timing |

Wider finding **C10 — P1, not fixed**: raw DOI interpolation also occurs at `source-guess.ts:125`, `paper-evidence.ts:193` and `citations.ts:1097`. An offline `paperAddress` call reproduced the wrong path; the other two sites were inspected.

Validation: **209 focused tests passed**, all four typecheck projects passed, and documentation links passed. The wider run passed 982 assertions; its sole failure was the provider-host audit’s `spawnSync git EPERM`. Lint exited 0 with complexity advisories.

Please return raw results for `citation-index-pg.test.ts`, `bibliographic-pg.test.ts` and the provider-host audit. Database assertions were not checked here; the full suite, browser geometry and shared-local migration application remain outstanding.

**Verdict: land with the fixes I made.**