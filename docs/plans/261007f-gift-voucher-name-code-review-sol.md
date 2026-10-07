Found six issues: four fixed in-stage, two wider findings reported. No commit was made.

- **C1 — P1 — [AdminVouchersPage.tsx:179](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/AdminVouchersPage.tsx:179)** — Native `maxlength=80` counts UTF-16 units, preventing valid 80-code-point astral names such as 80 emoji. **Fixed:** removed `maxlength` from Create and Edit; tests were red first.

- **C2 — P1 — [admin-vouchers.ts:135](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/admin-vouchers.ts:135)** — Bidi controls and invisible characters survived cleaning, permitting reordered or visually blank greetings; the live sketch also disagreed with the eventual email. **Fixed:** shared cleaning now neutralizes Unicode bidi controls and common invisible separators, treats all-invisible names as absent, and preserves meaningful ZWNJ/ZWJ. Text, HTML, and the sketch share the rule. Covered by [voucher-recipient-name.test.ts:6](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/tests/voucher-recipient-name.test.ts:6) and UI tests, both red first.

- **C3 — P1 — [AdminVouchersPage.tsx:95](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/AdminVouchersPage.tsx:95)** — Create and Edit trimmed before checking length, so 80 characters plus a trailing space was silently accepted despite the refuse-first contract. **Fixed:** both forms count raw Unicode code points and visibly refuse before trimming. Tests cover both paths and were red first.

- **C4 — P2 — [privacy-page.test.ts:175](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/tests/privacy-page.test.ts:175)** — Privacy tests pinned the new sentence but not the required date change. Restoring the old date left all 24 tests green. **Fixed:** added an exact `LAST_UPDATED` assertion, observed red with the mutation, then restored 7 October.

- **C5 — P1 — [AdminVouchersPage.tsx:229](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/AdminVouchersPage.tsx:229)** and [AdminVouchersPage.tsx:600](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/AdminVouchersPage.tsx:600) — The pre-existing private-note fields still use native `maxlength=500`, so they have the same UTF-16/code-point mismatch and allow only 250 emoji although the API accepts 500. **Reporting:** wider than this stage; not changed.

- **C6 — P2 — [AdminVouchersPage.tsx:432](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/web/AdminVouchersPage.tsx:432)** and [pg-vouchers.ts:728](/var/tmp/spideryarn-worktrees/fb-vc6pnm-voucher-name-starter/src/store/pg-vouchers.ts:728) — Targeted lint reports complexity 27 and 43 against the configured 25. **Reporting:** maintainability advice, not wrong behavior; no refactor made.

The remaining paths check out:

- Create, normalized replay, patch, readdress, and list consistently carry the name. A control-containing replay is normalized before both insertion and comparison.
- Names never enter headers or subjects; HTML metacharacters are escaped.
- An independent comparison against parent `2f4a904eb` found all four no-name variants byte-identical: invite/reader, with/without note.
- The migration is safe for populated tables: the nullable column gives existing rows `NULL`, which satisfies the check. Snapshot comparison showed only the column and constraint.
- Clearing sends `null`; unchanged or merely invisible formatting sends no name patch.
- Privacy and email documentation now match the implementation.

Verification: 75 standalone tests passed; all four TypeScript projects passed. Postgres suites were not rerun, as requested.

**Verdict: land with the fixes made.**