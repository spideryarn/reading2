# Code review: 261003f stage 2 (chat offers commands as buttons the reader presses)

You are a reviewer who also fixes. Candidate: commit dd20a8745 in this worktree
(`git show --stat dd20a8745`, `git diff edf4e7eb3 dd20a8745`). The tree is clean at dd20a8745;
anything you change will be read as your proposal. Note: the stage-1 fixes in edf4e7eb3 were yours,
unreviewed by anyone else.

The plan is docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md (Stage 2,
ledger F6, F8, F9, and § Progress for the builder's divergences). The measurement is
docs/investigations/261003b-chat-proposes-commands-as-chips.md with evals/chat-commands/run.ts and
its results/*.json. The accepted line is docs/project/chat-llm-help-commands-vision.md § The line
and § Decided; chat's own line is docs/project/chat-tools.md § Security; docs/project/security-map.md.

Start with (does not limit scope): src/command-token.ts, src/web/chat-commands.ts,
src/web/CommandChip.tsx, src/web/Cited.tsx, src/web/ChatPanel.tsx, src/web/command-runners.ts
(`chatExecutor`), src/web/reader/Reader.tsx, src/citable.ts, src/converse.ts (`COMMAND_CHIPS`),
src/live.ts, and the three new tests.

Independent pass first. This is the security-relevant stage: an answer is model output that a
hostile article, a fetched web page or a tool result can steer. Look for: any path where a token
causes an action without the reader's press, on render, on stream, on mount, on hover, or by focus
plus a stray Enter; a chip whose label misstates what the press does (the label must be the bar's
row, built from the validated proposal, never from model text); a token recognised somewhere other
than an ordinary text node on its own line (code, link label, blockquote of fetched text, a
reader's own message, a stored older turn, other surfaces that render model prose through
`CitedMarkdown`: Remember, Tutorial, Quiz, FAQ, summaries, comments' AI replies — check each either
cannot draw a chip or is meant to); block membership and ownership at the press; a visitor on a
public article; the bookmark going anywhere but Reader's memoised controller; a double press; a
press whose band has unmounted; the change to `citableText` (src/citable.ts) altering citation
checking for anything that is not a token; the prompt section leaking into live conversation or
other `converse` kinds that should not have it; prompt-cache placement. Check the eval's claims
against its results files and the scoring code: is any number in the write-up not reproducible from
them? Mutate the code and check the tests notice.

Fix what is inside this stage, narrowly, red-first. Report, do not fix, anything wider. You have no
network or loopback: `npx vitest run <file>` on the pure/jsdom files works; for typecheck use
`node --import tsx` on the script `npm run typecheck` names if `tsx` cannot open its pipe. Do not
commit. Do not run the paid eval.

Severity: P0 data loss / exploitable security / incorrect charging / service unusable; P1
user-visible wrong behaviour or a contract violated; P2 design risk with no wrong behaviour today;
P3 prose. IDs continue the ledger (F15, F16, …): severity, evidence (file:line), whether fixed,
which test you saw red. End with a verdict.

## My own suspicions (worth less; spend most of the run elsewhere)

1. A hostile article can still get two own-line tokens drawn (the eval saw it once). Each needs a
   press and shows the bar's label; is that enough, or should `glossary-ask` (spends) be off the
   chat allowlist?
2. The streaming hold-back and the own-line rule interacting at the very end of an answer with no
   trailing newline.
3. "Copy answer" copies the raw token (left for stage 3): worth fixing here?
4. The prompt section's length and its place in the cached prefix.
