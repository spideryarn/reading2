# Review: a plan for a `reader_notes` Chat tool and an Explore sub-mode of Remember

Repo: the current directory (Spideryarn; TypeScript, ESM, Postgres through drizzle, React client).
Branch `worktree-explore-submode-and-reader-marks-tool`. This is a PLAN review: read-only, change
no file, run no migration.

## The candidate

Live pre-commit: base 48f4c195 (origin/dev at the time of writing); one untracked file:
`docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md`.

Start with that plan. Then the code it leans on: `src/chat-tools.ts` (the tools and `runTool`),
`src/converse.ts` (`systemFor`, `readItFor`, `buildConverseMessages`, `webSearchTool`, the tool
loop), `src/routes.ts` § `streamChat`, `src/chat.ts`, `src/types.ts` (`ThreadKind`,
`SINGLE_THREAD_KINDS`, `Comment`), `src/store/pg.ts` (`ownedByReader`, `ownedSlug`),
`src/store/pg-comments.ts`, `src/store/pg-chat.ts`, `src/live.ts` (it shares `CHAT_TOOLS`), and the
commit that added Tutorial, `849cdcb50` (`git show --stat 849cdcb50`), which is the template for
Stage 2. Docs: `docs/project/chat-tools.md`, `security-map.md`, `remember-mode.md`,
`remembering-vision.md`, `mode.md`, `prompting-guide.md`, `fonts.md`. This list is where to begin,
not the limit.

## What it is meant to do

Greg's words are quoted at the top of the plan and decide the product. Stage 1 adds one read-only
tool that returns the signed-in owner's own comments, highlights and bookmarks on the open article,
an index of their other conversations on it, and a bounded read of one. Stage 2 adds Explore, a
fifth `ThreadKind`, one thread per article, with its own prompt, whose first turn is handed the
notes digest by the server. Invariants: only the owner's own data is ever returned; stored text is
fenced as data; caps are announced and totals exact; the migration is additive; nothing new lacks
a timestamp.

## What I am asking

Independent pass first. Is each statement in the plan's "What is already there" section accurate
against the code? Is there a path by which `runTool` runs for someone who is not the article's
owner (a public or shared link, a visitor, Live, an admin view)? What does the plan miss that
Tutorial's commit had to touch, or that has been added since (command bar, last-view, activation,
export/import, cost attribution, the fleet/admin thread counts, `SpokenKind`)? Is the "first turn
carries the digest" design sound against retry and edit of that first turn, the cache breakpoint,
and `recentHistory`? Is the eval able to show what it claims?

Severity: P0 data loss, exploitable security, wrong charging, service unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk; P3 prose.
Give every finding an ID, `PR-1` upwards, with file:line evidence, and say whether it is
established or reasoned. End with a verdict: build as written, build with the changes named, or do
not build.

## My own suspicions (already mine; spend most of the run elsewhere)

- Whether the tool should be withheld from Recall and Tutorial.
- Whether a digest only on the first turn is lost once `recentHistory` trims, and whether it
  should instead ride on every Explore turn.
- Whether Candidates (Referee, anonymised) must not see the reader's notes.
