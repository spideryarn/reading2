---
reports: spya-mn3ruw, spya-sxvq2j
ending: shipped
---
# The reading-time line gets a rich card and reads as lighter; cross-references quieter than the glossary

Two suggestions from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0 for both: this
proves the production rows, not the Sentry events, which had no recorded event id). Both were sent
from the reading view of `jco-2005-01-libre-spya-hk9cc7`, build `e94f588d`.

## [SPIDERYARN-READING2-8S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8S) — spya-mn3ruw, 16:04

> We have a vertical line next to the block that indicates how long you've spent reading it, I think
> based on the time that it's visible on the screen. The tooltip, firstly, can you make it a rich
> tooltip? And indeed, make a note somewhere that we always prefer to use our rich tooltip machinery
> because they're just more attractive.
>
> I think there's a tooltips.md that we should be signposting from, you know, design and places like
> that. Secondly, more importantly, yeah, that vertical line, the tooltip system, like it gets darker
> the longer you have been reading it. I'm not sure if that's great. It almost looks, because the
> background is black, so it almost looks like it's getting brighter, whiter, certainly more visible
> against the black background the longer I've been reading it, or at least that's what I would
> assume would be the case.
>
> In other words, there's no visible line at first, and then for stuff I've been reading a lot, there
> is a visible line, and that visible line would have to be, you know, whitish to show up against the
> default black background.

## [SPIDERYARN-READING2-8W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8W) — spya-sxvq2j, 16:17

> It looks as though we've added extra internal links that point to other parts of the document.
> That's great. The only problem is that it's a little bit difficult to tell the difference between
> them and the glossary. Maybe because they both kind of look like dotted lines, I don't know if
> there's a way to make one of them more distinctive.
>
> And the other thing is I'd say that those internal links (it's great that, by the way, they have
> tooltips), those internal links are probably less important than the glossary. So visually the
> glossary links should be a bit more prominent.

**Ending: Shipped**, both. On `dev` in `abe1d662c` and `8a5eb45d6` (merged at `6bf099c4b`), not deployed.
Resolve 8S and 8W.

## What we did

- **The line was already near-white and getting lighter; its `title` said "darker".** That was the
  confusion. The `title` is gone. Hovering the line now opens the reading view's shared rich card
  ("Reading time"), placed at the pointer's height. The ramp is steeper and is exactly zero for a
  passage you haven't read: 0, .05, .15, .30, .50. The app is dark-only, so there is no light theme
  to check. The colour is the `--ink` token, so it would invert with one.
- **tooltips.md § Prefer the rich card to a native `title`** carries Greg's words, and
  design-css-overview.md's line for tooltips.md says the same.
- **The glossary is the one dotted orange line, and louder** (2px at 70%). A cross-reference is now
  a thin solid grey underline that turns orange on hover.
- Checked in a browser on the box. The cross-reference's look was checked on a mark injected by hand,
  because no local article has real cross-references.

[The plan](../plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md),
with GPT Sol's plan and code reviews beside it.
