# Plan review: 261003h, four small UI fixes

You are reviewing a **plan**, read-only. Nothing is built yet. Do not change any file.

**Candidate (live, uncommitted):** base `451df1f8f`; one untracked file,
`docs/plans/261003h-four-small-ui-fixes-gutter-gap-glossary-card-row-keyboard-dismiss-voucher-form.md`.
Read it first, then the code it names. That list does not limit scope.

Code to read: `src/web/styles/gutter.css` (the `row-gap` and § the count's container queries),
`tests/gutter-target-size.test.ts`, `src/web/ProseHoverCard.tsx` (the term card's foot, about line
2165 on) with `src/web/styles/prose-hover-card.css`, `src/web/ChatPanel.tsx` (the composer, about
line 2135 on), `src/web/useVisualViewport.ts`, `docs/project/touch.md` § What the Enter key
promises, `tests/what-the-enter-key-promises.test.tsx`, `src/web/AdminVouchersPage.tsx`.

You may run one test file: `npx vitest run tests/<one>.test.ts`. No network, so nothing that needs
Postgres.

**What I want:** an independent attack on the plan. For each of the four fixes: is the reading of
Greg's report right, is the proposed change the simplest that gets most of the value, what will it
break, and is anything stated in the plan false against the code? Check the arithmetic of fix 1's
thresholds. For fix 3, say whether detecting an open soft keyboard from the visual viewport is sound
on iOS Safari and Android Chrome, and which boxes should and should not put the keyboard away.

Severity, by consequence: **P0** data loss, security, charging, service unusable. **P1**
user-visible wrong behaviour or a contract violated. **P2** design or maintainability risk, no wrong
behaviour today. **P3** prose. Give every finding an ID (`F1`…), a severity, the file and line, and
the fix you would make. End with a one-line verdict: build as planned, build with changes, or do not
build.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Fix 1: whether a two-line paragraph still has 56px of room.
- Fix 2: whether one wrapped row is tidier than two rows when an entry has an external link.
- Fix 3: blurring in the tutorial conversation, where the reader answers turn after turn.
