# Plan review: 261007f, gift voucher recipient name, and a starter article written up

You are reviewing a **plan**, read-only. Nothing is built yet. Do not change any file.

**Candidate (live, uncommitted):** base `25da1e585`; one untracked file,
`docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md`.
Read it first, then the code it names. That list does not limit scope.

Code to read: `src/store/pg-vouchers.ts` (create, replay comparison, `parseNewVoucher`,
`parseVoucherPatch`, `updateOnce`), `src/store/pg-voucher-emails.ts` (`giftMessage`, `giftHtml`,
`noteRow`, `escapeNoteHtml`, `queueGiftEmail`), `src/admin-vouchers.ts`, `src/email.ts` (`oneLine`,
`noteText`), `src/web/AdminVouchersPage.tsx`, `src/db/schema.ts` § `billingVouchers`,
`src/store/pg-share-link.ts`, `src/share-key.ts`, `tests/share-link-token-stays-home.test.ts`,
`docs/project/security-map.md` § "And since 2026-10-05 there is a second way in, which is a key",
`docs/project/feedback-reports.md` § "A report is unfiltered input".

You may run one test file: `npx vitest run tests/<one>.test.ts`. No network, so nothing that needs
Postgres.

**What I want:** an independent attack on the plan.

1. Stage 1 (the name): is it the simplest thing that gives Greg "Dear so-and-so"? What will it
   break? Is anything the plan states false against the code? Anything missed among the places a
   new voucher column has to be told to (replay comparison, patch, list, tests that pin columns or
   bodies, privacy page, export)? Any injection or header risk from a name in an email body?
2. The scoping decision: the plan says a voucher email carrying a private link's key is an edit to
   a listed defence and so is written up for Greg rather than built by an unattended run. Is that
   reading right, too cautious, or not cautious enough? Is the "paste it into the note today"
   workaround described truthfully, including where the key then ends up?
3. The two questions for Greg: are the options complete, truthfully costed, and answerable by
   somebody who has not read the code?

Severity, by consequence: **P0** data loss, security, charging, service unusable. **P1**
user-visible wrong behaviour or a contract violated. **P2** design or maintainability risk, no wrong
behaviour today. **P3** prose. Give every finding an ID (`F1`…), a severity, the file and line, and
the fix you would make. End with a one-line verdict: build as planned, build with changes, or do not
build.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether the greeting should sit inside the italic note block rather than above it.
- Whether 80 characters and `oneLine` are the right rule for a name.
