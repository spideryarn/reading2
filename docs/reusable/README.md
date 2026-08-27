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
| [capture-sounding-board-conversation.md](capture-sounding-board-conversation.md) | writing a conversation up as a document: quote Greg verbatim, synthesise the rest |
| [write-deep-dive-as-doc.md](write-deep-dive-as-doc.md) | researching a topic and writing it up as a reference doc with its sources attached |
| [third-party-library-selection.md](third-party-library-selection.md) | picking a dependency — favour long-lived, heavily-documented ones, then write the decision down |
| [rename-or-move.md](rename-or-move.md) | `git mv`, then every reference — a rename is never one edit |
| [generate-mermaid-diagram.md](generate-mermaid-diagram.md) | authoring `.mermaid` files and rendering them to SVG, plus the house style |
| [codex-cli-as-subagent.md](codex-cli-as-subagent.md) | a GPT/Codex subagent for cross-family review or delegated work, via [`scripts/run-codex.ts`](../../scripts/run-codex.ts) |

## Traps, before you meet them

| Doc | What it saves you |
|---|---|
| [silent-success.md](silent-success.md) | **the pattern behind most of a day's bugs** — a thing reports success while doing nothing, and the check you would naturally run agrees with it, because it shares an assumption with the code |
| [css-sticky-containing-block.md](css-sticky-containing-block.md) | why `position: sticky` can be declared correctly and do nothing — its range is its containing block minus itself |
