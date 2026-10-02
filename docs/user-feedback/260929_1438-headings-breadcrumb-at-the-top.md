---
reports: spya-m3pteb
ending: shipped
---
# A headings breadcrumb at the top of the reading view

Report `spya-m3pteb`, a suggestion, from Greg (admin), 2026-09-29, Overseer queue item
`qi-n2fhp27k`, on `https://www.spideryarn.com/read/9689-full-spya-m43th2?stop=spya-drs2qw&depth=2&at=spya-apj4w2`:

> I sometimes feel as though I lose track of where I am. The structure mode helps a lot, but then I
> have to have it open. I'm wondering whether we could add a thin horizontal breadcrumb of some kind
> at the top of the reading view. Let's make it always present if experimental features are turned
> on, and invisible if not, because it is an experimental feature. And it could be multiple lines,
> with each line being, you know, one of the heading levels or something, as always, tooltips, etc.
> And, you know, maybe do some web research with Sonnet on how other people have solved this
> problem of, you know, interactively showing your position within a hierarchical document that
> updates as you scroll. I think Visual Studio VS Code does this in a nice way with Markdown, where
> it's sort of, as you scroll, the headings kind of merge into the breadcrumb bar. I mean, maybe
> that's overcomplicating things. But yeah, if there are good UI patterns, or even better still a
> library we could co-opt or learn from, you know, the trade-offs are that it's easy to see at a
> glance where I am, and that it doesn't take up too much space. And there are probably other
> objectives too, use your judgment.

**Ending: Shipped**, on `dev`. Plan, research and both GPT Sol reviews:
[261002h](../plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md).

**What it is.** With Experimental features on, the sticky bar at the top of the reading view holds
one line: *part › section*, updating as you scroll. It uses Structure's tree and the same "you are
here", so the two never disagree. Each crumb jumps to its part or section and has the same rich card
as a Structure row. The bar stays put while you read rather than sliding away, and is not drawn
where an open mode covers the article on a phone. With the switch off nothing changes.

**What the research found.** Sonnet looked at VS Code (breadcrumbs, and sticky scroll's stacked
headings), Wikipedia's sticky header, Obsidian's plugins and docs-site TOCs. No library fits:
tocbot builds its own TOC from `<h*>` tags, and our sections are table rows we already measure. So
it reuses the sampler Structure already has.

**What was deferred**, as proposal `qi-kc2ybggy` in the Overseer queue for you to authorise or drop
after trying it:

- **One line per heading level**, VS Code sticky-scroll style. The research was against it as the
  default, because the height jumps at every section start and it eats a phone screen. A
  tap-to-expand of the single line would be the cheap way to get both.
- **A thinner bar.** It is the existing 44px controls bar, reused so jumps and deep links already
  clear it. Going thinner means teaching the bar-height tokens about a second height.
- **On a phone, after a band link steps a mode aside**, the bar stays hidden, so the prose does not
  move 44px in the middle of the jump.
