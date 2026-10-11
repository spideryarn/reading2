---
reports: spya-zh5f23
ending: shipped
comment: On the shelf the add box is now the wider card on the left, with a heading and a link icon, and the search box is narrower and on the right; a link pasted into the search box offers to add it.
---
# The shelf's add box and search box look like different things

A suggestion from Greg (an admin; `scripts/feedback-reporter.ts` exit 0 on the production row),
filed 2026-10-11 from `/`. Plan and reviews:
[261011l](../plans/261011l-shelf-add-box-and-search-box-look-like-different-things.md).

> In the logged in homepage, we have two text input boxes near the top, one for adding a URL and one
> for searching the shelf. Users keep confusing them, so I wonder if we can do something in the UI
> to make them more distinct. For example, can we narrow the search box and perhaps right align it
> with a search icon somewhere?
>
> And then I don't know how to make the add input box look more like an add, maybe an upload icon
> somehow, maybe make it narrower and left aligned. I did consider making the add kind of default
> collapsed with some kind of clear upload label there, but maybe that's too extreme a solution
> because then it'll be confusing for how to add new articles.
>
> — Greg, 2026-10-11 01:47 UTC (`spya-zh5f23`, #564)

**Ending: shipped**, on `dev`.

- **The search box** is narrower (at most 24rem) and on the right, with its magnifier inside on the
  left as before. On a phone it keeps a 2rem step on the left, so the two boxes are different shapes
  there too. Placeholder: *Search your shelf*.
- **The add box** is narrower (at most 42rem) and on the left. *Add an article* is now a heading in
  the foreground colour with a book-plus icon, and the field starts with a link icon, as the search
  box starts with a magnifier. Placeholder: *Paste a link, e.g. example.com/an-essay*. The upload icon
  you suggested is already on the **File** button beside it, so the address field got a link icon
  rather than a second upload icon.
- **A link pasted into the search box is caught.** The search box takes the cursor when the shelf
  opens on a desktop, which is probably where most of the mix-ups start: arrive, paste, and the link
  lands in the search. Now a line under it says *That's a link. Add it to your shelf?* with an
  **Add it** button. It adds nothing until pressed. The other way round, typing words into the add
  box now says *To search your shelf, use the search box below.*
- **Not done:** the collapsed add box (you called it too far yourself), and moving the cursor from
  the search box to the add box on arrival. That was decided the other way in
  [260929g](../plans/260929g-shelf-search-focus-and-metadata-chord.md). If the confusion persists, it
  is the next thing to try.

Sentry: this session has no Sentry sign-in; the next feedback sweep marks it resolved.
