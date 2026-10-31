# The Feedback dialog's release line moves into the tab row

Report `spya-j8xe8w` (#744), a suggestion from Greg (admin), 2026-10-31:

> I like that the feedback dialogue now says, you know, released two hours ago and provides a link
> to the changelog. Can we move that onto the same row as right earlier and needs a decision so that
> it doesn't use up vertical space?

The line came from [261030d](261030d-feedback-dialog-shows-admins-the-release-age-and-a-changelog-link.md)
(`spya-hgpctx`), as its own row under the dialog's title.

## What we build

```
Feedback                                                            ×
Write   Earlier                 Needs a decision 3   Released 2 hours ago · Changelog
────────────────────────────────────────────────────────────────────────────────────
                              base-width panel:  2h ago · Changelog
```

- A new `.fb-tabrow` wrapper holds the tablist and then `ReleaseLine`, and carries the row's
  bottom rule; `.fb-tabs` keeps its own rule where it stands alone (`AdminVouchersPage`).
- **The line is beside the tablist, not in it.** A tablist's children are tabs, and a link is not
  one (GPT Sol's code review, citing WAI-ARIA). The *Needs a decision* shortcut stays inside, where
  261008i put it and a test pins it; so the line goes at the row's far end, after the shortcut, and
  the order you see is the order focus takes.
- What 261030d's review asked of its position still holds: after the head in the DOM, so Close
  stays the dialog's first focus; mounted only while the dialog is open; the screen-reader detail
  (`.sr-only`) unchanged.
- **At the panel's 34rem-or-narrower base width, the short form** — `2h ago · Changelog`, with
  `(reload)` or `(rollback)` for the stale-tab notes — from `relativeAgo`'s existing `narrow` style.
  Both forms are rendered and CSS picks one; the long form begins at the panel's 1024px widening
  step. The tabs do not shrink (`.fb-panel .fb-tab { flex-shrink: 0 }`); the line does.

## What the checks changed

The first build put the long form between Earlier and the shortcut. The browser check at 375px
measured about 76px left for it: it wrapped to three lines and grew the row from 31px to 47px — six
lines and 91px with the stale-tab wording — which spends the vertical space Greg asked to save. GPT
Sol's review found the same, and the tablist problem. Hence the short form and the wrapper.

## Simpler and other options passed over

- **Letting the long form wrap on a phone.** Simplest, and measured above: it defeats the request.
- **Taking the shortcut out of the tablist too**, so the line could sit between Earlier and it.
  Reopens a tested decision for a visual order nobody asked for.

## Tests

`tests/feedback-dialog.test.tsx`: the line is in `.fb-tabrow`, after the tablist and not inside it;
the short form's words, including the stale-tab note; Close still first. Browser check at 375px and
1280px, with the long wordings forced.
