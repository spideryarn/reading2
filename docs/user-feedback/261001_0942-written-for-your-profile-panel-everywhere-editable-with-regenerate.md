---
reports: spya-nq6hnu
ending: shipped
---
# "Written for your profile": one panel in every personalised mode, edited in place, with Regenerate

Report `spya-nq6hnu` ([SPIDERYARN-READING2-7S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-7S)),
a suggestion, from Greg (admin), 2026-10-01, dispatched by the Overseer as queue item `qi-wht47dea`, on
`/read/what-if-we-had-bigger-brains-imagining-minds-beyond-ours?mode=summary&remember=quiz&deep=2&summary=fuller`:

> I like the "This was written for your profile" icon & panel in the top-right of the Summary mode.
>
> Make that a reusable component that shows up in any modes where the output is personalised.
>
> And if possible, allow them to edit the text inline (rather than having to click out to separate
> pages.
>
> I suppose if they do edit or if the profile has changed since the mode generated, then it should
> show a handy "Regenerate" button in that mode's "This was written for your profile" panel.

**Shipped**, as [261002b](../plans/261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md):
the panel now edits both boxes in place (autosaving, as on `/profile`), and shows **Regenerate** when
the server says the text was written for a profile you have since changed. The badge was already one
component in Summary, Glossary, Quotes, Ideas and Tweets; Sketch gained it.

Deferred, with reasons in the plan: Regenerate in Quotes (its re-run appends rather than replaces),
Skim (it has its own purpose editor), Quiz (no changed-profile flag yet, and regenerating throws away
your answers), Illustrated, and chat.
