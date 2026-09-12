# The gutter: a second "…" inside its own menu, and the bookmark button that never arrived

**SPIDERYARN-READING2-37** (suggestion, 2026-09-12 08:16Z) and **SPIDERYARN-READING2-38** (problem,
2026-09-12 08:17Z) · Greg (admin, established with `scripts/feedback-reporter.ts`) · an iPad, in
production, build `607b57a0`, on `entropy-24-00930-spya-bmvfyb`.

37:

> Next to each block, there's three icons at the moment by default. There's a permalink, like a
> comment, and a question mark. Great. And then there's a sort of three dots that reveals them if
> it's a really small block. All of that's fine. The issue is I thought we were going to add a sort of
> bookmark icon as well, sort of a fourth one, so you could just say, that would just somehow, yeah,
> bookmark that block as being really interesting. I thought maybe it was going to be represented as
> an empty comment, but I'm not seeing that bookmark icon as the fourth.

38:

> When I click on a really small block, or hover over a small block, there's just the three dots
> icon. And if I click on that, it reveals the extra icons like the permalink and the comment and the
> question mark. All of that's fine. The only issue I notice is when I click on the three dots, it
> actually includes three dots within the menu that expands out, and I don't think that's right. It's
> like three dots, click on that, and then it has yet more three dots, but I don't know what that
> does. I don't think it does anything.

**Ending: shipped** — both reports, on `dev`, not deployed.

What changed:

- **38, the second "…"**: it was the same button. The open column drew every control in it,
  including the "…" that opened it, so the panel ended in another "…" whose only label was a tooltip
  a finger never sees. It closed the panel. Now, while the column is open, that button is an ✕
  labelled "Close paragraph controls".
- **37, the bookmark**: bookmarking existed, but only by selecting text and saving the comment box
  empty. There was never a one-press way from the gutter. Now every unmarked paragraph has a
  bookmark button in its gutter, after the link and chat buttons and before the "?". One press
  bookmarks the whole paragraph, for free. The button turns into the orange mark at the top of the
  column. Nothing is underlined in the text, so tapping the paragraph still selects it. The Comments
  drawer and the comment box show it as "Whole paragraph — <its opening words>". To remove it, press
  the mark and delete it.

For Greg, at the next deploy: the bookmark needs one migration, which `npm run deploy` applies by
itself. It makes two columns on `comments` optional and adds two checks. No existing row changes.
Any iPad tab still running the old code won't show a paragraph bookmark until it reloads. The server
leaves those bookmarks out for old tabs on purpose, because the old code would crash on them.

[260912c](../plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md); the postmortem for 38
is [260912c-a-disclosure-that-draws-itself-inside-what-it-discloses](../postmortems/260912c-a-disclosure-that-draws-itself-inside-what-it-discloses.md).
