# Two job races, a brain icon, and finding more quotes

Batch four of the feedback-reports loop. Four reports, all Greg's, all from one reading session on
`nagel-bat` between 20:50 and 21:06 UTC on 2026-09-05, all against production build `6f563997`.

| | Sentry | what it is | size |
|---|---|---|---|
| 25 | [SPIDERYARN-READING2-25](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-25) | "For the Remember mode button, use a brain icon" | one line |
| 27 | [SPIDERYARN-READING2-27](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-27) | "Add a button in Quotes mode to find more" | small feature |
| 28 | [SPIDERYARN-READING2-28](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-28) | "Debate mode didn't work. Asking the web did not finish." | production bug |
| 29 | [SPIDERYARN-READING2-29](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-29) | glossary re-find: "Finding the terms did not finish." | production bug |

**28 and 29 are one report, not two.** Both are `[jb-step-again]` — the reader-facing copy for a job
step that stopped — and there is an error sitting between them:
[SPIDERYARN-READING2-26](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-26),
`PublishRefused`, status 409, `step: glossary`, `slug: nagel-bat`, **two occurrences**, 20:51:00 and
21:01:19. One reading session, one article, two steps, two refusals.

## The hypothesis, stated before it is checked

`publishRevisionIn` (src/store/pg-revisions.ts) refuses when
`draft.basedOnRevisionId !== article.currentRevisionId` — *"something else published while this draft
was being written, and publishing now would discard it"*. That guard is right, and it was put there
deliberately (GPT Sol, finding 1 of `260901d-stage3-code-review-sol.md`).

So the suspicion is **not that the guard is wrong**. It is that **two reader-triggered steps ran
against one article at the same time**, which the guard then correctly refused — and the reader saw
two modes die for a reason that is nobody's fault and that a retry silently fixes. If that is what
happened, the bug is upstream: whatever is supposed to stop two steps racing on one slug.

The alternative, which has to be ruled out rather than assumed away: the two refusals are unrelated
to each other, and one of them is a stale draft from a deploy.

**Whichever it is, `message_withheld: True` means the refusal's `reasons` list did not reach Sentry**,
so the diagnosis cannot be read off the issue — it has to come from the code and from a reproduction.

## What "the simplest version" means for each

- **25** — change the icon. There is no smaller version.
- **27** — Greg asks for a button that finds more quotes. The pipeline already has a quotes step with
  a `MAX_QUOTES` and a suggestion count; the simplest version is a button that re-runs it asking for
  more, not a new incremental-append mechanism.
- **28 / 29** — root-cause first, fix second, and if the fix is large, ship the smallest thing that
  stops a reader losing work and defer the rest explicitly.

## Stages

- **A** — diagnose the two refusals. Read-only. Produces the root cause, the class it belongs to, and
  the ranked options.
- **B** — report 25, the brain icon.
- **C** — report 27, finding more quotes.
- **D** — the fix that comes out of A, with a postmortem under `docs/postmortems/`.

## Decisions and assumptions recorded here rather than asked

*(The loop runs autonomously; anything that would have been a question goes here.)*

## Stage B — report 25, the brain icon. Done.

`icon: Speech` → `icon: Brain` in `MODES_UI` (`src/web/Dock.tsx`). `Speech` was the mode's *method*
— the reader talks — and Chat sits next to it doing the same thing, so a speech bubble was working
twice in a row of eighteen icons. `Brain` names the subject instead. No test: nothing pins any other
mode's icon, and the exhaustiveness check in the same file already guarantees every mode has one.

## Stage C — report 27, "a button in Quotes mode to find more". Already built.

The button exists (`Foot` in `QuotesPanel.tsx`, **Choose them again**, offered unconditionally), and
**he knows it exists** — yesterday he read that same panel foot and asked us to delete the
`generator · version` line above it. So this is not discoverability.

He meant *more*, not *again*. That shipped ninety minutes before he filed this, in `260905g`:
`MAX_QUOTES` 16 → 32 and the suggestion doubled to one per 300 words. He was on production
`6f563997`, which does not have it. `PROMPT_VERSION` → `quotes/3` means every existing list will wear
the *"chosen by an earlier version of the prompt"* banner with the button under it, and pressing it
returns roughly double.

**Fable arbitrated** between closing it, renaming the label, and building append, and picked closing
it. Two rejections worth keeping:

- **"Find more" as a label** is a lie on an article already at the target, and a version conditional
  on the `outdated` banner is honest only by coincidence — it works today because *this* prompt bump
  happened to be the count, and the next bump makes it wrong again.
- **Append** reverses `quotes.md` § *It replaces. It does not append.* and needs back the
  forbidden-list machinery that was removed on purpose.

**The falsifier, recorded:** if he files it a third time after the deploy, on an article already at
`quotes/3`, then "more" means *beyond the prompt's target* and the right build is a count control —
a re-run with a raised target, still replace-not-append. On the second filing, not this one.
