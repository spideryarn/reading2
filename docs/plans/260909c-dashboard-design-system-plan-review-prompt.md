# Review prompt: the fleet dashboard design-system plan, before any code is written

You are reviewing a **plan**, not a diff. Nothing has been built. The cheapest thing you can do for
this job is to find the stage that is wrong before an hour goes into it.

## The candidate

Repository: `/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system`, branch
`worktree-dashboard-design-system`, revision **`af0b6928`**. Read that revision, not the working
tree.

Read, in this order:

1. `docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md`
   — the plan under review.
2. `tools/fleet/web/src/UsagePanel.tsx` (786 lines) — the tab Greg called "horrible … really hard to
   scan". Its header and its inline comments are the record of what its states are *for*; several
   were written in response to your own earlier P0/P1 findings, which are cited by number in the
   comments.
3. `tools/fleet/web/src/ui.tsx` and `tools/fleet/web/src/tailwind.css` — the design primitives that
   exist today: the tone record, `Card`/`Pill`/`SectionHeading`/`Button`, and the token file.
4. `docs/project/overseer-direction.md` §§ "Attention, and who the Overseer is really watching",
   "Three surfaces, not one page", "Push almost nothing", "Does the augmentation principle apply?" —
   who this page is for and what it must never do.
5. `docs/project/fleet-dashboard-modes.md` — how a tab is registered, and the two registers checked
   by nothing.
6. `docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md`
   § "The ranked proposal" — a prior, unbuilt, Fable-ranked set of UI findings that this plan
   absorbs in its Stage 5.

You may run commands in the tree (you have no network). Reproducing a claim beats reasoning about
it — in particular, the two censuses in the plan's § "What 'design system' means here" are `grep`
counts you can re-run:

```
grep -rhoE 'tw:text-\[[0-9]+px\]' tools/fleet/web/src/ | sort | uniq -c | sort -rn
grep -rhoE 'tw:text-(ink|ink-soft|ink-faint)\b' tools/fleet/web/src/ | sort | uniq -c | sort -rn
```

**Do not change any file.** This is a read-only review.

## What the job is

Greg, 2026-09-09, verbatim:

> the Usage Limits tab UI is horrible. It's really hard to scan. In general, I think we need a
> design system of some kind. Write screenshots to files, and get input from GPT Sol. Ask the
> question for each screen "what are the main purposes/intent/questions that the user might have,
> and how can we make that more visible. Better still, do some web research with Sonnet about best
> practices for UI/UX, and write up as a prompt in docs/reusable/ , and then apply that throughout
> the web dashboard.

And, the same day, the acceptance test for every screen:

> The main thing I really want from this web dashboard interface is to have a very easy way to see
> answers to questions like: Is anything needed from me? Is anything blocked? Where do things
> stand? And right now, it is very hard to see those things!

The page is a fleet dashboard on a private box: one person, on a phone as often as at a desk,
deciding what to do about ~18 running coding-agent sessions. It is not a product surface and has no
other users.

## The questions I actually want answered

Answer these directly, and rank the findings. Say plainly where you think the plan is fine.

1. **Is the diagnosis right?** The plan claims the mechanical cause of "hard to scan" is (a) a 3px
   type band with no dominant element and (b) the quietest ink being the most-used ink, and that
   the fix is a type/emphasis scale rather than more colour. Is that supported by the code you can
   read? Is there a larger cause it has missed — information architecture, the amount on screen at
   once, the prose-paragraph form of `UsagePanel`?
2. **Is the stage order right?** Stage 5 (a landing surface answering Greg's three questions)
   before Stage 6 (the Usage restyle he explicitly named). Defensible, or does it look like the
   agent substituting its own judgement for the instruction?
3. **What is the smallest version that gets most of the value?** If one of these stages should be
   cut, reframed or dropped outright, say so — that is a legitimate and welcome conclusion. In
   particular: is the `docs/reusable/` doc worth the stage it costs, or is it ceremony?
4. **The honest-absence risk.** `UsagePanel` currently refuses to draw a percentage for an expired
   window, refuses to say "no limits hit" without its coverage numbers, and treats an old 429 as
   history rather than a live block. A restyle whose whole point is "make the important thing loud
   and the rest quiet" is exactly the kind of change that quietly demotes a caveat into invisibility.
   **Name the specific states in that file most at risk**, and say what a check that could actually
   fail would look like — not "be careful".
5. **Is there a way to make this design work testable at all?** Today nothing goes red if a screen
   becomes unscannable. Is there a check worth having — a lint on arbitrary type sizes, a snapshot
   of computed styles, an assertion that certain strings survive — or is that over-engineering for
   a private ops page?
6. **What is the plan asserting that it has not checked?** Anything it states as fact that it has
   not measured, especially about what the data can support for the Stage 5 landing surface.

## Severity scale

- **P0** — the plan will produce something broken, misleading, or that loses a safety property.
- **P1** — a stage is materially wrong: wrong order, wrong scope, wrong deliverable.
- **P2** — worth fixing, not worth blocking on.
- **P3** — taste.

Give every finding an ID (`P1(1)`, `P2(3)`, …), the file or plan section it is about, and, where it
is a claim about the code, the evidence you used. If you could not check something, say so rather
than reasoning past it.

## My own suspicions, last, so they do not steer you

Deliberately at the end. Disagree freely.

- I suspect the real problem with `UsagePanel` is not type size at all but **form**: it is written
  as a document — eleven `<p>` elements of careful provenance — when the reader's question is one
  yes/no ("can this account afford more work?") followed by one number and one time. If so, a type
  scale is necessary and nowhere near sufficient, and the plan under-scopes Stage 6.
- I suspect Stage 5's landing surface is the highest-value item and also the one most likely to
  slip, because it needs agreement from four other live sessions.
- I am unsure whether the `docs/reusable/` doc should be a checklist or a *prompt* an agent runs.
  Greg said "write up as a prompt", which suggests the second, but a prompt that is really a
  checklist wearing a hat is worse than an honest checklist.
