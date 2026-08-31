# docs/reusable/

Notes that are **not about this project** and are meant to be carried elsewhere. Several are copied
from Greg's [gjdutils](https://github.com/gregdetre/gjdutils) library of "how to do this kind of task
well" instructions; the rest were written here because a general trap cost real time.

**Read [gjdutils-instructions.md](gjdutils-instructions.md) first** — it says which of those are
copied here and that the rest are one fetch away. When a task matches one, follow it rather than
inventing a process.

## How to do a task

| Doc | Reach for it when |
|---|---|
| [gjdutils-instructions.md](gjdutils-instructions.md) | **start here** — the index of Greg's instruction library, copied and uncopied |
| [engineering-manager.md](engineering-manager.md) | a job too big for one sitting — cut it into stages that each end committable, and hand the work to subagents |
| [capture-sounding-board-conversation.md](capture-sounding-board-conversation.md) | writing a conversation up as a document: quote Greg verbatim, synthesise the rest |
| [write-deep-dive-as-doc.md](write-deep-dive-as-doc.md) | researching a topic and writing it up as a reference doc with its sources attached |
| [third-party-library-selection.md](third-party-library-selection.md) | picking a dependency — favour long-lived, heavily-documented ones, then write the decision down |
| [rename-or-move.md](rename-or-move.md) | `git mv`, then every reference — a rename is never one edit |
| [git-commit-changes.md](git-commit-changes.md) | sweeping up an uncommitted tree — batch it, oldest first, and commit only what you can vouch for |
| [generate-mermaid-diagram.md](generate-mermaid-diagram.md) | authoring `.mermaid` files and rendering them to SVG, plus the house style |
| [write-planning-doc.md](write-planning-doc.md) | starting a piece of work — the doc that holds the decisions and the stages, and what to call it |
| [debrief-progress.md](debrief-progress.md) | reporting where a piece of work stands: what's done, what's left, whether it's still worth it |
| [audit-architecture-mode.md](audit-architecture-mode.md) | a technical audit of an area or a plan — investigate and discuss, change nothing |
| [write-tutorial.md](write-tutorial.md) | explaining how something works to somebody who has never read the code — mental models first, spiral passes, diagrams you actually look at |
| [edit-important-docs.md](edit-important-docs.md) | changing a doc whose wording is a rule — one small set of changes at a time, before/after, approval before each |
| [codex-cli-as-subagent.md](codex-cli-as-subagent.md) | a GPT/Codex subagent for cross-family review or delegated work, via [`scripts/run-codex.ts`](../../scripts/run-codex.ts) |
| [playwright-browser-control.md](playwright-browser-control.md) | driving a browser from a script, with no eyes — on the remote box, where the Chrome extension cannot follow ([browser-control.md](../project/browser-control.md) is which mechanism goes where) |

## Traps, before you meet them

| Doc | What it saves you |
|---|---|
| [silent-success.md](silent-success.md) | **the pattern behind most of a day's bugs** — a thing reports success while doing nothing, and the check you would naturally run agrees with it, because it shares an assumption with the code |
| [written-down-is-not-checked.md](written-down-is-not-checked.md) | **prose cannot fail, so nobody checks it** — a comment or doc that asserts a future, an absence, or a generalisation from a same-shaped sample, believed later because writing it down looked like verifying it |
| [css-sticky-containing-block.md](css-sticky-containing-block.md) | why `position: sticky` can be declared correctly and do nothing — its range is its containing block minus itself |
| [iterm.md](iterm.md) | scripting iTerm2 tabs from `Bash` — address sessions by UUID, and don't trust `is processing`, `index of tab`, or a tty number |
