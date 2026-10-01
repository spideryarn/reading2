---
reports: spya-gxyhcc, spya-b2wzjf, spya-ukr9dp
ending: shipped
---
# Structure: a Fisheye / Expanded toggle, arrows that step blocks and sections, one card sentence fewer

**[SPIDERYARN-READING2-90](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-90)** (spya-gxyhcc),
**[SPIDERYARN-READING2-8R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8R)** (spya-b2wzjf)
and spya-ukr9dp (no Sentry issue) · reported 2026-10-01 16:01–17:35 UTC by Greg (checked with
`scripts/feedback-reporter.ts`, exit 0 on all three) · **shipped** to `dev` in `050a80144`, 2026-10-01

## What Greg said

> Add a toggle to Structure mode to switch between the Fisheye submode (which should be the default,
> and which is what we're using now), and Expanded mode (which would show everything fully, all of
> the summaries and everything expanded and visible).
>
> I guess there's a question about whether Expanded mode scrolls along with the text or not.
> Ideally it would. I suppose that could interfere with the fact that ideally the user would be able
> to scroll independently within the column... Use your judgment. Let's try and avoid too much
> complexity for the v1.

> It looks like we have a keyboard shortcut set for the structure mode, so the up/down jumps
> sections in the structure. That's my best guess anyway. It looks like it's behaving differently
> when I press up and down when the focus is on structure mode. Instead, what I'd suggest is up and
> down should always do the same thing, i.e. jump to the next block in the text, as they do if the
> focus is on the text.
>
> Perhaps there's something to be said for using left and right in structure mode. In the past, I
> think we played with using left and right to move between the columns. But actually, I'm going to
> suggest that left and right should basically jump between the smallest sections. So left and right
> would jump to the previous or next low-level-heading/section.

> In the information tooltip for Structure mode, get rid of the sentence that says something like,
> "Uses the same parts and sections as Summary, so there's nothing to generate."
>
> Can you get rid of that sentence? Partly because it's not that helpful for a user, and partly
> because I think we're about to get rid of the parts and sections from summary mode anyway.

## What we did

All three, in one plan: [261001q](../plans/261001q-structure-fisheye-expanded-and-arrow-keys.md).

- **Fisheye / Expanded** chips in Structure's head row, `?structure=expanded`. Expanded is one
  scrolling list of every part and section with its gist. It follows the reader only when they move
  into another section, so a hand-scrolled column keeps its place until then.
- **↑ / ↓ step one block everywhere except over the spine**, which still steps by part. That one
  reading of "always" was left alone because the spine is a deliberate aim. **← / → step the
  lowest-level sections while Structure is open.** ← in the middle of a section goes to that
  section's start, as ↑ does. Strict "previous section" would be a one-line change.
- **The card's sentence is gone**, replaced by one naming the two views and the keys.
