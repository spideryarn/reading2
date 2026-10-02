# Marginalia refreshes when a mode it reads finishes

2026-10-02. Greg's two answers to the open questions in
[interface-vision.md](../project/interface-vision.md), recorded, and the one small fix the second
one turned up.

## What Greg said

On the left column:

> I don't fully understand the question. I definitely like being able to have both a left-hand and
> the right-hand mode open at the same time. I haven't decided whether Marginalia will be the only
> right-hand mode, or whether we'll add other right-hand modes. FWIW I can imagine a future world
> where (on really wide screens) we might want to be able to have multiple left-hand-modes open (e.g.
> both Structure and Summary) plus the Marginalia right-hand mode all open at the same time, for a
> really rich text-reading experience. We can treat that as out of scope for right now if it will add
> too much complexity. I don't know if that answers your question!
>
> — Greg, 2026-10-02

On whether opening Marginalia may spend:

> Hmm, this is tricky. My worry is that if we *don't* fill in stuff that hasn't been generated, then
> even if we do generate that mode afterwards it won't get fed into Marginalia mode... If that concern
> is correct, then let's automatically run any missing modes when we first run Marginalia mode.
> Perhaps the ideal would be for Marginalia mode to notice if new modes that it depends on have been
> run since it first ran, and update itself. But if that's going to add substantial complexity, let's
> hold off on it.
>
> — Greg, 2026-10-02

## What is true, checked

1. **The worry does not hold.** Marginalia keeps no copy. `OwnerMarginFeed`
   (`src/web/marginalia/MarginaliaColumn.tsx`) reads FAQ, Debate and Ideas through their read halves
   each time it mounts; Citations and comments are held by the Reader in every mode. So a list made
   after Marginalia first ran is in the margin the next time it opens. Test:
   `tests/marginalia-live-refresh.test.tsx` § a list made while the margin was shut (green on the
   old code), plus a browser check.
2. **The gap that is left is Greg's "ideal".** With the margin open on the right while the reader
   generates FAQ, Debate or Ideas in the left band, the band's own hook re-reads when its job
   finishes, but the margin's separate read does not, so the notes appear only after closing and
   reopening the margin. Same test file § a list made while the margin is open: red on the old code
   (one read, never a second). Citations does not have *this* gap — the band and the Reader share one
   read (`useCitationsRead`, hoisted to `ArticlePage`) — but GPT Sol's plan review found its
   neighbour: a Citations run that finishes after the reader has left the band refreshes nothing,
   so it reaches neither the margin nor the prose marks until the band is reopened or the page
   reloaded. That is the gap Glossary and Quotes already name and leave alone
   (`src/web/useCitations.ts` § An always-mounted read is not an always-fresh read), so it is left
   alone here too rather than fixed for one of three; `useStepFinished` below would close all three
   with a line each, and is the follow-up.

So: **no auto-run** (its premise was false), and the live refresh is small enough to do.

## The fix

The bands hear "my job finished" through one mechanism: `useJobs(cadence, onFinished)`, which
drains the job engine's completion feed, wrapped by `useStepJob`'s slug-and-step filter, which then
calls the read's `refresh` (`useOrderedRead`, so a reply already in flight cannot overwrite the new
list).

`OwnerMarginFeed` subscribes to the same feed, through a new hook that is `useStepJob`'s
completion half alone:

```ts
useStepFinished(slug, "ideas", ideasRead.refresh);
useStepFinished(slug, "faq", faqRead.refresh);
useStepFinished(slug, "debate", debateRead.refresh);
```

- **`useStepFinished`** (`src/web/useStepJob.ts`) is `useJobs("quiet", …)` behind the same private
  `writesStep` filter `useStepJob` uses — the filter stays in one file.
- **Quiet**, so mounting the margin buys no idle poll and no poll on arrival
  (`jobEngine.subscribeQuietly`); it only hears completions the engine was already polling for —
  which it is whenever a band has a job running.
- **No verbs.** It hands back nothing, so there is no `start` for the margin to call; the reads stay
  spend-free.

**Simpler option passed over:** three `useStepJob(slug, step, read.refresh, "quiet")` calls. Zero
new code, but it hands the feed three `start` verbs it must never call — the exact thing the read
halves were split out to prevent. (The first build was one inline `useJobs` subscriber with
`writesStep` exported; the hook replaced it so the filter stays private and the citations
follow-up is one line.)

**Bigger option passed over:** lift the FAQ/Debate/Ideas reads up to the Reader, as Citations was,
so band and margin share one read. Removes the duplicate GET too, but it moves three hooks across
the Reader and changes every band's wiring; not worth it for this.

**Out of scope:** a job finished in *another tab* while this tab's engine is idle. A quiet
subscriber cannot wake the engine, and the margin's next open reads it anyway.

**Narrower than `useStepJob` by one case, knowingly.** The engine's first job list of a session is
a baseline, so a job already `done` on it is never announced. `useStepJob` recovers that for a job
it started itself (it has the POST's id); this hook starts nothing and has no id. The window is a
band press answered before the session's first poll, and reopening the margin reads it. GPT Sol's
plan review, finding 2; written on the hook.

## GPT Sol's plan review

Four P2s, all taken: (1) Citations' neighbouring gap — the claim narrowed, above; (2) the
first-poll window — named, above; (3) the test could not tell `refresh` from `reload` — a test now
holds the opening GET until after the job finishes, and requires the trailing read; (4) nothing
tested *quiet* — a test now starts and seeds the engine, mounts the margin and runs the clock past
the idle interval, and counts queue requests.

## Docs

- `docs/project/interface-vision.md`: both questions off the list; the answers recorded in the
  doc with Greg's words — left: one band at a time plus the right column alongside (which he likes);
  several left modes plus Marginalia on very wide screens is a direction, out of scope now; whether
  other right-hand modes come is undecided. Spend: Marginalia reads at display time, so no auto-run;
  the open margin now refreshes live.
- `docs/project/marginalia.md` § What it shows: the same, in a sentence or two.

## Stages

One stage: the test (already red), the fix, the docs, `npm test` on touched files,
`npm run typecheck`, Sol code review, push.

## Follow-up, the same day: the always-mounted reads

The Overseer asked for the neighbouring gap to be closed as well, on Greg's "ideally update
itself": `useStepFinished(slug, step, refresh)` added inside `useCitationsRead`, `useGlossaryRead`
and `useQuotesRead`, one line each, red first in `tests/always-mounted-reads-refresh.test.tsx`. The
comments that called the gap deliberate now say what is still not heard (another tab while this
tab's engine is idle, a CLI run) and the cost (with the band open, one extra trailing GET per
completion).
