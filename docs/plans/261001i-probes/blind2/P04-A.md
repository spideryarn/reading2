# P04 (after2): Citations band header overflows at 375px

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context): pointed to `design-css-overview.md`, `narrow-windows.md`, `browser-control.md`; helped.
- `docs/project/narrow-windows.md`: very helpful; the "A row that pushes a phone page sideways" section gives the console check (scrollWidth - clientWidth must be 0), the inject-one-rule technique, and the real-Chrome test pattern.
- `docs/project/citations.md` (grepped only; nothing on narrow layout).
- `docs/project/web-client.md` (grepped; maps `CitationsPanel.tsx`, `modes/`).
- Not opened but would: `docs/project/browser-control.md`, `docs/project/browser-testing.md`, `docs/project/design-css-overview.md`.

## 2. Code files you would edit
- `src/web/styles/glossary.css` (`.gloss-gate-row`, `.gloss-sort`; shared by Citations) or `src/web/styles/citations.css` for a Citations-only fix.
- `src/web/styles/mode-band.css` (`.band-head`, which has no `flex-wrap`) only if the culprit is the head row itself.
- Possibly `src/web/CitationsPanel.tsx` (`head=` fragment holding `.gloss-count`; `BarSlider`; `SortBar`).
- New test: `tests/citations-header-wraps-in-chrome.test.tsx`.

## 3. Existing helpers/components/functions to reuse
- `tests/masthead-facts-wrap-in-chrome.test.tsx` as the template (real component to markup, sheets inlined, 390px, control that forces the old rule back).
- `src/web/ModeSurface.tsx` § `head` (wraps in `.band-head`).
- `src/web/styles/glossary.css` § `.gloss-sort` (flex-wrap pattern to copy).
- No new JS helper; a CSS fix.

## 4. Rules/policies
- Reproduce first: failing Chrome test with a control (narrow-windows.md; CLAUDE.md "reproduce a bug with a failing test").
- Row of unknown-width things must wrap, with `min-width: 0` (narrow-windows.md).
- Find the culprit by injecting one rule at a time, not by reading CSS (narrow-windows.md).
- Browser work in a Sonnet subagent, reading browser-control.md first (CLAUDE.md).
- `npm test`, `npm run typecheck`, lint on touched files; GPT Sol review before commit; commit own files by name; push to `dev`; work in a worktree (CLAUDE.md).
- Plan doc under `docs/plans/` via `npx tsx scripts/plan-name.ts`; postmortem for the bug class (CLAUDE.md).
- Edit a stylesheet comment in place; `.gloss-gate-*` rules are shared by Glossary, Quotes, Search, so check those do not regress.

## 5. Where you got lost
- The task says "header row" and I did not know which of three candidates it is: `.band-head` (count only), `.gloss-sort` (wraps already), or `.gloss-gate-row` (label + value + reset, no `flex-wrap`). Static reading suggests `.gloss-gate-row` or `.band-head` with a long label; only injection in a browser would say. I did not run a browser (probe rules), so the culprit is unconfirmed.
- `citations.md` says nothing about phone widths; `narrow-windows.md` covers it only generically.

## 6. Confidence
6/10 that I have all the files and rules; 4/10 on the exact culprit selector.
