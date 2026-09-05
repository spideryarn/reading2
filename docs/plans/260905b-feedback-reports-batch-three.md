# Feedback reports, batch three

Nine reports arrived on the morning of 2026-09-05, all within an hour, all from Greg while reading
[*A Landscape of Consciousness*](https://www.spideryarn.com/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz).
The process is [feedback-reports.md](../project/feedback-reports.md); this is the run.

**Every one is from an admin, so § Who sent it says build it** — no debate about whether it is worth
doing, because the person who decides that is the person who filed it. What is left to judge is
*how much*: [simplest version first](../project/vision.md#simpler-first), with the deferred rest
named here rather than quietly dropped.

This is an unattended run, so questions, decisions and assumptions land in this file, not in chat.

## The nine

| id | kind | one line |
|---|---|---|
| [1H](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1H) | suggestion | a `/contact` page, and links to it |
| [1J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1J) | problem | dictation transcribes the ums and ahs |
| [1K](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1K) | suggestion | `[mic-offline]`: disable the button up front, offer Retry after |
| [1M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1M) | problem | the interface feels sluggish on a really long article |
| [1N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1N) | suggestion | the thank-you should match the kind, and Close should be instant |
| [1P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1P) | suggestion | enlarged Illustrated diagram: the prompt text beside it, scrolling on its own |
| [1Q](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Q) | problem | clicking a comment chip opens a *new* comment instead of the one that is there |
| [1R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1R) | suggestion | mark a comment made by the ? button as a request-for-explanation |
| [1S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1S) | suggestion | that explanation should teach: summary first, then analogy or worked example |

## How they were grouped

Not one agent per report — **one agent per set of files**, because three worktrees editing
`CommentDialog.tsx` is three merge conflicts. Three at a time at most
([feedback-reports.md § The run](../project/feedback-reports.md#the-run)).

- **Wave 1**
  - **1Q + 1R + 1S** — all three are the gutter's ? button and the comment it makes. 1Q is where you
    land, 1R is what gets stored, 1S is what comes back. One agent, one story.
  - **1J + 1K** — both dictation, both `src/web/useDictation*.ts` and the transcription route.
  - **1H + 1N** — a new page and a dialog's copy. Unrelated to each other, but small, and neither
    collides with anything else in the wave.
- **Wave 2**
  - **1P** — Illustrated / Lightbox, on its own.
  - **1M** — the sluggishness. Measure before touching anything; a symptom is a lead, not a
    diagnosis.

## Decisions and assumptions taken without asking

Recorded here because there is nobody in the chat to ask.

1. **1S is a prompt change, not a feature.** "Drawing on pedagogical techniques" could be a whole
   explain-mode. The afternoon-sized version is the wording of the prompt behind the ? button plus
   whatever structure the response already supports. Anything that needs new UI is deferred.
2. **1K's on-device fallback is deferred.** Apple Speech via the Web Speech API is a second
   transcription path with its own permissions, its own failure modes and no server record of what
   was said. The report itself scopes it as "and/or any other improvements" — so the two concrete
   asks (disable when offline, Retry after) ship and the fallback is written up, not built.
3. **1M gets a measurement first and a fix only if the measurement names one.** If the profile says
   the cost is spread across everything, the honest ending is a write-up rather than a speculative
   optimisation.
4. **1Q's shape is Fable's call**, as the report asks. GPT Sol reviews it for simplicity, also as the
   report asks.

## What actually happened

Filled in per agent as each lands. Each agent works in its own worktree, runs
[engineering-manager.md](../reusable/engineering-manager.md), gets a GPT Sol review of its code, and
pushes to `dev` itself.
