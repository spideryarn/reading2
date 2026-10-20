# Stage 2 code review — GPT Sol

Plan: [261020n](261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md), Stage 2.
Reviewed the uncommitted working-tree diff and the untracked `src/web/InvestigatePanel.tsx`;
ignored `docs/project/reception.md` as requested.

## Findings

### F1 — Medium — the chat-from-a-mode contract still sends lens chats back to Reception

**Evidence:** `docs/project/chat-from-a-mode.md:98-105,122-139` still says that a lens is
Reception's angle box, calls its list *Your angles*, prints *Back to your angle in Sources ›
Reception*, and maps the origin to `sources=reception`. The implementation instead lists every
lens chat under Investigate and sends old and new lens origins back to `sources=investigate`
(`src/web/thread-source.ts:229-246`, `src/web/reader/Reader.tsx:1837-1855`). This is the checklist
for future mode-origin work, so following it would reintroduce the old route and wording.

**Fixed:** yes. Updated the lens exception, gist/list wording, example back line and way-back table
to name Investigate and `sources=investigate`.

### F2 — Medium — the paid one-press path has no double-click regression

**Evidence:** `tests/reception-lens-in-chat.test.tsx:638-695` proves arrival is free and each of a
single suggested, claim, and work press makes one POST, but never fires the new Investigate control
twice. The stage's spend contract explicitly includes a double click. The generic handoff has a
StrictMode identity guard, but a test that calls only once cannot fail if Investigate later starts
two handoffs for one double click.

**Fixed:** yes. Added a rendered-reader test that double-clicks the suggested row before navigation
can replace it, under the suite's `StrictMode`, and asserts one POST and one fresh conversation.

### F3 — Low — the changed integration test fails the touched-file lint gate

**Evidence:** `tests/reception-lens-in-chat.test.tsx:573-575` optional-chains the selected POST and
then immediately reads `.question` or `.threadId` from the possibly undefined result. Biome reports
all three as `lint/correctness/noUnsafeOptionalChaining`. The preceding length assertion makes the
test safe at runtime, but the expressions are still needlessly unsafe and leave the touched-file
lint red.

**Fixed:** yes. Named the two sent bodies after the length assertion and checked their fields
without dereferencing an optional-chain result.

### F4 — Low — Sources' new Investigate section leaves two inventory summaries stale

**Evidence:** a concurrent Stage 2 edit added `docs/project/sources.md` to the working diff while
this review was running. Its address section at `docs/project/sources.md:229` still describes only
`?sources=reception` and `claims`, despite the six-value parameter. Its contents/visitor summary at
line 45 and visitor rule at lines 317-319 say only Not cited is absent, although Investigate is
owner-only too and `?sources=investigate` also falls back to Bibliography.

**Fixed:** yes. The address section now names all six values, and the contents/visitor summaries
name both owner-only sub-modes and both visitor fallbacks.

## Checks

- `npm run typecheck` could not open tsx's IPC pipe in this sandbox (`EPERM`); the prescribed
  `node --import tsx scripts/typecheck.ts` fallback passed all four projects and the source-file
  coverage check.
- The exact requested Vitest command could not initialize the private Postgres lane because this
  sandbox cannot connect to the shared local database port (`EPERM 127.0.0.1:54362`). That prevented
  `tests/chat-origin-route.test.ts` from running here.
- The other 16 requested files passed in the unit lane: **16 files, 728 tests**. After the fixes,
  the three changed/contract files were rerun and passed: **3 files, 63 tests** (including the new
  double-click regression and `doc-links`). After the concurrent Sources doc was corrected,
  `doc-links` passed again: **1 file, 18 tests**.
- Touched-file Biome lint passed for the two changed TypeScript test files. `git diff HEAD --check`
  passed.
