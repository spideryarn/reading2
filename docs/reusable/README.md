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
| [documentation-policy.md](documentation-policy.md) | **what a doc is for** — intent and signposts rather than descriptions of code, one home per fact, and who each kind of doc is written for |
| [capture-sounding-board-conversation.md](capture-sounding-board-conversation.md) | writing a conversation up as a document: quote Greg verbatim, synthesise the rest |
| [write-deep-dive-as-doc.md](write-deep-dive-as-doc.md) | researching a topic and writing it up as a reference doc with its sources attached |
| [third-party-library-selection.md](third-party-library-selection.md) | picking a dependency — favour long-lived, heavily-documented ones, then write the decision down |
| [rename-or-move.md](rename-or-move.md) | `git mv`, then every reference — a rename is never one edit |
| [find-previous-work.md](find-previous-work.md) | finding what was done before — the commit, the plan, the conversation — most durable source first, in a Sonnet subagent |
| [get-ready-to-deploy.md](get-ready-to-deploy.md) | the sweep that gets a shared tree to `dev` — commit, look, pull, check, fix, commit, push, in that order and for a reason; also what the three-hourly loop runs |
| [git-commit-changes.md](git-commit-changes.md) | sweeping up an uncommitted tree — batch it, oldest first, and commit only what you can vouch for |
| [git-resolve-merge-conflicts.md](git-resolve-merge-conflicts.md) | a merge, rebase or pull left conflict markers — read both sides' history, propose before editing |
| [generate-mermaid-diagram.md](generate-mermaid-diagram.md) | authoring `.mermaid` files and rendering them to SVG, plus the house style |
| [write-planning-doc.md](write-planning-doc.md) | starting a piece of work — the doc that holds the decisions and the stages, and what to call it |
| [debrief-progress.md](debrief-progress.md) | reporting where a piece of work stands: what's done, what's left, whether it's still worth it |
| [improve-the-codebase.md](improve-the-codebase.md) | the periodic sweep — find the rework worth doing across the whole tree, cluster and prioritise it, and land the clusters that fit |
| [write-tutorial.md](write-tutorial.md) | explaining how something works to somebody who has never read the code — mental models first, spiral passes, diagrams you actually look at |
| [write-postmortem.md](write-postmortem.md) | a bug whose cause was more interesting than the line that broke — name the class, say why nothing went red, and rank what would have caught it |
| [edit-important-docs.md](edit-important-docs.md) | changing a doc whose wording is a rule — one small set of changes at a time, before/after, approval before each |
| [codex-cli-as-subagent.md](codex-cli-as-subagent.md) | a GPT/Codex subagent for cross-family review or delegated work, via [`scripts/run-codex.ts`](../../scripts/run-codex.ts) |
| [claude-cli-as-subagent.md](claude-cli-as-subagent.md) | the mirror image — reaching Opus from something that is *not* a Claude session (a Codex run, a script, the box), via [`scripts/run-claude.ts`](../../scripts/run-claude.ts) |
| [claude-subscriptions.md](claude-subscriptions.md) | one repo must bill a different Claude subscription from the rest — `CLAUDE_CONFIG_DIR`, why the wrapper has to be a `PATH` script rather than a shell function, and how to prove which account you are on |
| [codex-subscriptions.md](codex-subscriptions.md) | the same for the Codex CLI — `CODEX_HOME`, why `codex --cd` walks straight past directory routing, and why no Codex command will tell you whose ChatGPT subscription you are about to spend |
| [review-prompt-template.md](review-prompt-template.md) | writing the prompt for that review — name the candidate durably, suspicions last, a severity scale, an ID on every finding |
| [claude-in-chrome.md](claude-in-chrome.md) | driving a browser through the Chrome extension, and it will not connect — `list_connected_browsers` returning `[]` is almost always the wrong Chrome profile |
| [playwright-browser-control.md](playwright-browser-control.md) | driving a browser from a script, with no eyes — on the remote box, where the Chrome extension cannot follow ([browser-control.md](../project/browser-control.md) is which mechanism goes where) |
| [long-waits.md](long-waits.md) | waiting hours rather than minutes — which mechanism survives what, and the two that outlive the session |
| [gjd-remote.md](gjd-remote.md) | driving the always-on box — the commands you actually type, and what bites when you run it from a repo that has never heard of it ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) is the whole of it) |
| [count-lines-in-a-repo.md](count-lines-in-a-repo.md) | making "how big is this thing" a command rather than an argument — take the file list from git, categorise by purpose, and the four ways cloc goes quiet |
| [agent-fleet-dashboard.md](agent-fleet-dashboard.md) | building a page that watches — and steers — many coding agents on one machine: why the fast session listing is not enough on its own, why a socket write that cannot fail proves nothing, and why "needs you" is usually a menu rather than a prompt |
| [find-big-files.md](find-big-files.md) | "which files are biggest, and should we worry" — rank by code rather than lines, then size × churn × braiding, because a long file nobody touches costs nothing |
| [diagnose-box-resources.md](diagnose-box-resources.md) | a shared box is slow, or something got OOM-killed — measure, attribute, and add swap without disrupting anyone |

## Traps, before you meet them

| Doc | What it saves you |
|---|---|
| [silent-success.md](silent-success.md) | **the pattern behind most of a day's bugs** — a thing reports success while doing nothing, and the check you would naturally run agrees with it, because it shares an assumption with the code |
| [name-is-evidence.md](name-is-evidence.md) | **a name is assigned by one mechanism and consumed by another** — so it has provenance, decays, and is not necessarily unique; code that treats it as identity addresses the wrong object while every step succeeds |
| [written-down-is-not-checked.md](written-down-is-not-checked.md) | **prose cannot fail, so nobody checks it** — a comment or doc that asserts a future, an absence, an inventory, or a generalisation from a same-shaped sample, believed later because writing it down looked like verifying it |
| [trawl-session-transcripts.md](trawl-session-transcripts.md) | Greg says "this is not the first time" — extract the prose from every recent session transcript and have Sonnets read it, so the answer has names and timestamps |
| [css-sticky-containing-block.md](css-sticky-containing-block.md) | why `position: sticky` can be declared correctly and do nothing — its range is its containing block minus itself |
| [iterm.md](iterm.md) | scripting iTerm2 tabs from `Bash` — address sessions by UUID, and don't trust `is processing`, `index of tab`, or a tty number |
