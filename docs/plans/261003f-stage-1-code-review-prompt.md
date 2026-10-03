# Code review: 261003f stage 1 (the bar takes arguments, toggles Experimental, takes dictation)

You are a reviewer who also fixes. Candidate: commits b3725d71c and f614f5871 in this worktree
(`git diff 1f47d0dc0 f614f5871`). Changed paths: `git diff --name-only 1f47d0dc0 f614f5871`. The
tree is clean at f614f5871; anything you change will be read as your proposal.

The plan is docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md (Stage 1,
part 0 and items 1–5, its Review ledger F1–F9, and § Progress for the builder's stated divergences).
Your own plan review is docs/plans/261003f-plan-review-sol.md.

Start with (does not limit scope): src/web/command-proposal.ts, src/web/command-runners.ts,
src/web/glossary-ask-handoff.ts, src/web/command-match.ts, src/web/CommandBar.tsx, src/web/Dock.tsx,
src/web/reader/Reader.tsx, src/web/Metadata.tsx, src/web/GlossaryPanel.tsx,
src/web/experimental-store.ts, and the tests the diff adds.

Independent pass first. Look for: wrong behaviour a reader can reach; a paid call the reader did not
ask for or two for one press (F1); a write that reports success without happening or state left
stale (F4, F5); the jump bypassing `jumpTo` (F3); hidden glossary terms reachable (F2); verb
collisions with existing commands (F7); the token format's safety for Stage 2 (it will sit in model
prose that a hostile article can steer: can a token be forged into something that runs without a
press, names a block outside the article, or smuggles Markdown?); dictation guards; tests that could
not fail (mutate the code and check). Note the builder says F1's Reader side is held only by a
source-text check: judge whether that is enough.

Fix what is inside this stage, narrowly, red-first (write the failing test, see it red, fix). Do
not fix anything wider: report it. You have no network or loopback: run only tests that need
nothing outside the tree (`npx vitest run <file>` on the jsdom/pure files above works;
`npm run typecheck` works). Do not commit.

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1
user-visible wrong behaviour or a contract violated; P2 design risk with no wrong behaviour today;
P3 prose. Give every finding an ID continuing the ledger (F10, F11, …), severity, evidence
(file:line), whether you fixed it, and which test you saw red. End with a verdict.

## My own suspicions (worth less; spend most of the run elsewhere)

1. The glossary hand-off: StrictMode double-mount, a stale hand-off for another slug, a hand-off
   left behind when the band never mounts.
2. `Verb.except` for `define again` looks like a patch on a collision class rather than a rule.
3. The experimental row during `saving` and the awaitable `set` on a refused save.
4. Dictation context `{ kind: "profile" }` when there is no article.
