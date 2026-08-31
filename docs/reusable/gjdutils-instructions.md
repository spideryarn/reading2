# gjdutils instructions

Greg keeps a library of reusable agent instructions — "how to do a recurring kind of task well" — in
his [gjdutils](https://github.com/gregdetre/gjdutils) repo, under
[`docs/instructions/`](https://github.com/gregdetre/gjdutils/tree/main/docs/instructions).

They're written to be dropped into any project. **When a task matches one of them, go and read it**
rather than inventing a process. A handful have been copied into this repo already (see below); the
rest are one fetch away.

## Copied here

| Doc | Use it when |
|---|---|
| [capture-sounding-board-conversation.md](capture-sounding-board-conversation.md) | turning a conversation into a preserved document — what to quote verbatim, what to synthesise |
| [generate-mermaid-diagram.md](generate-mermaid-diagram.md) | creating or updating a Mermaid diagram and rendering it to SVG |
| [rename-or-move.md](rename-or-move.md) | renaming/moving files and chasing down every reference to them |
| [write-deep-dive-as-doc.md](write-deep-dive-as-doc.md) | researching a topic on the web and writing it up as a reference doc |
| [third-party-library-selection.md](third-party-library-selection.md) | choosing a library to depend on |
| [write-planning-doc.md](write-planning-doc.md) | writing the planning doc for a piece of work, and naming it |
| [debrief-progress.md](debrief-progress.md) | reporting on how a piece of work is going |
| [audit-architecture-mode.md](audit-architecture-mode.md) | auditing a feature, an area, or a plan against what was built |
| [codex-cli-as-subagent.md](codex-cli-as-subagent.md) | (not from gjdutils) dispatching a GPT/Codex subagent |

## Others worth knowing about

Not copied here, but frequently the right thing to read — all under
`https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/`:

- `SOUNDING_BOARD_MODE.md` — think-with-the-user mode; several of the docs above assume it
- `WRITE_EVERGREEN_DOC.md` — the other doc format the rest refer to (`WRITE_PLANNING_DOC.md` is copied)
- `DETECTIVE_SCIENTIST_MODE.md` / `SURGEON_MODE.md` — debugging and careful-editing stances
- `CODING_PRINCIPLES.md`, `GIT_COMMIT_CHANGES.md`, `GIT_WORKTREES.md`, `TASKS_SUBAGENTS.md`
- `RESEARCH_THIS_TOPIC.md`, `CRITIQUE_OF_PLANNING_DOC.md`

Run `ls` against the directory listing above for the current full set — it grows.

## Copying more of them in

Keep the upstream content close to verbatim; adapt only paths and cross-references that would
otherwise dangle, and add a provenance line at the top saying where and when it came from. Filenames
here are lowercase-kebab; upstream they're `UPPER_SNAKE`. Add a row to the table above and a bullet
in [AGENTS.md](../../AGENTS.md) — a doc nothing links to may as well not exist.
