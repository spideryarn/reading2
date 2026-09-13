# Code review: 260913a stage 1 — the "Use your profile" row removed

You are the reviewer AND fixer for this stage (house workflow, codex-cli-as-subagent.md). Fix what is
inside this stage, narrowly, red-first where it is behaviour; **report, do not fix**, anything wider.
Do not commit. Do not touch server files (`src/routes.ts`, `src/jobs.ts`, `src/quotes.ts`,
`src/glossary.ts`) — the plan keeps the server untouched on purpose; report instead.

## The candidate

Committed. Base `c222c9a4` (plan only). The stage is the commit(s) after it on branch
`worktree-fb3b-drop-use-profile-checkbox` up to HEAD — see `git log --oneline c222c9a4..HEAD` and
`git diff c222c9a4 HEAD --stat` (these are only this stage's commits; no merge in between). Start
with `src/web/WrittenForYou.tsx`, `src/web/GlossaryPanel.tsx`, `src/web/QuotesPanel.tsx`,
`src/web/useGlossary.ts`, `src/web/useQuotes.ts`, `src/web/useStepJob.ts`,
`src/web/ChatPanel.tsx`, the two CSS files, and the two new tests; that list does not limit scope.

The plan is `docs/plans/260913a-drop-the-use-your-profile-checkbox.md`, including § GPT Sol's plan
review (your previous round, IDs F1–F4) and § What landed. Number new findings from F5.

## The conclusion I want checked

"Every generate request from the client now omits `useProfile` (so the server uses the profile),
except: Find more on glossary and quotes, which sends the list's recorded `profiled`; and
CandidatesPanel's chat, which sends `false`. Nothing else in the client can send `false`." Is that
statement accurate? Trace from every caller of `queue.start`, `useChat`'s `send`, and any direct
`apiFetch`/`fetch` to a generate route.

## Also attack

1. Anything the removal broke that a jsdom test cannot see: CSS left orphaned or a layout that
   depended on `.prof-row` (flex-basis, `order`), especially `.chat-composer` and `.remember` in
   `src/web/styles/mode-band.css` and `src/web/styles/profile.css`.
2. Tests weakened rather than rewritten: an assertion deleted whose subject still exists.
3. Docs that still describe the checkbox or the button as present (`rg -n "Use your profile|Using
   your profile|UseProfile|useHasProfile|prof-row|prof-open" src docs/project tests`).

You can run `npx vitest run <file>` for the jsdom tests; you have no network, so nothing touching
Postgres. The author has run `npm run typecheck` and the full suite separately.

## Severity

P0 data loss / security / incorrect charging / broadly unusable · P1 user-visible wrong behaviour or
an authoritative contract violated · P2 design risk, nothing wrong today · P3 prose. IDs from F5.

## My suspicions (worth less)

- Whether `useStepJob`'s wire format still sends `useProfile: false` only when asked, now that most
  callers pass nothing.
- Whether any auto-run (`useAutoRun`) path relied on `automatic` for something other than the
  sentence.

## Answer

A verdict, findings by ID with severity and file:line, and for each: fixed (with the diff summary and
the test that went red then green) or reported.
