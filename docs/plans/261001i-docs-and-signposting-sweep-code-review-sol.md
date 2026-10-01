No P0s. I fixed all issues inside the reviewed change; two wider stale claims remain deliberately untouched.

### Findings

- **C1 — P1 — model-wire claims — fixed.** [setup-dev.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/setup-dev.md:328>) and the added [messages-stream.ts](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/src/messages-stream.ts:12>) comment claimed every pipeline stage uses Messages. `TASK_WIRE` assigns `debate` and `pdf-frontmatter` to chat; `PIPELINE_TASKS` is derived from only the Messages entries. Both claims now say that precisely.

- **C2 — P1 — database opening — fixed.** [database.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/database.md:3>) said “everything” was in Postgres. `src/store/blobs.ts` stores raw documents and images in Supabase Storage, with `data/_blobs/` as its credential-free fallback. The opening now distinguishes relational data from blobs; “Every table” is narrowed to “Every application table.”

- **C3 — P1 — unapproved rule wording under R3 — fixed.** I retained the knowledge but rewrote these additions as facts about existing code or past evidence:

  - [comments.md § streaming](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/comments.md:549>): “where a new streamed answer starts” and “the pattern.”
  - [experimental-features.md § Where it lives](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/experimental-features.md:53>): “the recipe for the next per-reader setting” and its general `localStorage` instruction.
  - [reader-profile.md § Where the pieces are](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/reader-profile.md:672>): the duplicated per-reader-setting “recipe.”
  - [new-mode.md § adjacent shapes](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/new-mode.md:52>): instructions for adding a pipeline step or setting.
  - [new-mode.md § patterns](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/new-mode.md:169>): universal mode rules; these now name only the modes that implement them. The duplicate description-line rule was removed because its full wording and Greg quote remain earlier in the same doc.
  - [narrow-windows.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/narrow-windows.md:45>): “Find the culprit…” and “Pin it…”.
  - [prompting-guide.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/prompting-guide.md:135>): “One bad item should not…” and the imperative retry wording.
  - [tooltips.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/tooltips.md:159>): “describe the artefact rather than the gesture.”
  - [testing.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/testing.md:1107>): “derive membership”; “Test the join”; and prescriptive mutation examples.
  - [quotes.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/quotes.md:764>): “lift rather than write again.”
  - [browser-testing-playwright.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/browser-testing-playwright.md:214>): the new assertion instruction.
  - [email.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/email.md:143>): “if you need it for a mail of your own.”
  - [stream-run.ts](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/src/stream-run.ts:14>) and [sse.ts](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/src/web/lib/sse.ts:14>): “starts/start from” instructions.

- **C4 — P1 — backlink test could pass falsely — fixed.** The original regex accepted link-shaped text inside comments or code. [doc-links.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/tests/doc-links.test.ts:437>) now uses the existing Markdown parser and accepts only parsed link nodes. Its control covers prose mentions, lookalike filenames, fenced/indented/inline code, HTML comments/blocks, escaped links and images. A deliberate `comments.md` backlink mutation produced exactly one failure: `comments.md → reading-view-overview.md`.

- **C5 — P1 — streamed-answer contract — fixed.** [web-client.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/web-client.md:104>) claimed `begin`, deltas and one `done`; `readAnswerStream` permits no `begin` and terminates with either `done` or `error`. The catalogue now matches the implementation.

- **C6 — P1 — email retry claim — fixed.** [email.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/email.md:153>) said `SendResult` is what callers retry on. Callers decide independently; only the arrival notice uses the documented give-the-row-back retry.

- **C7 — P1 — wider stale architecture rule — not fixed.** [architecture.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/project/architecture.md:171>) still tells stages to communicate through “JSON artefacts on disk.” Artefacts have lived in the store since 2026-09-05. This predates the reviewed change and is already proposal K5, so I left it untouched.

- **C8 — P1 — wider stale source header — not fixed.** [messages-stream.ts](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/src/messages-stream.ts:7>) still says “seven pipeline stages”; `TASK_WIRE` currently has many more Messages tasks. This wording predates the added comment, so I did not expand the fix beyond the change under review.

- **C9 — P2 — reusable policy overgeneralised — fixed.** [documentation-policy.md](</home/greg/code/spideryarn2/.claude/worktrees/docs-signposting-sweep/docs/reusable/documentation-policy.md:103>) said every doc links to an owner, contradicting the immediately preceding dated-collection exception. It now says every *evergreen* doc; the remaining additions are general, true and not materially redundant.

All new Greg blockquotes matched their cited source and date verbatim. The Sketch/Illustrated and Debate/Structure/Tweets moves preserved their wording apart from necessary heading levels and cross-file links. All eight `src/` changes remain comment-only, and their bare anchors resolve.

Final checks:

- `npx vitest run tests/doc-links.test.ts` — 16/16 passed, 5.90s.
- Mutation run — 1/16 failed on the intended missing backlink.
- `npx biome check tests/doc-links.test.ts` — passed.
- `git diff --check` — passed.
- No commit made.

A concurrent change to the plan and the untracked review-prompt file remain untouched.