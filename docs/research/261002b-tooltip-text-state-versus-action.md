# Tooltip text: saying what something is, apart from what you could do with it

Research done 2026-10-02 for Greg's report `spya-d886ah`, about the padlock beside an article's
title. Its card read *"Private · Only you can read this. Share it with anyone."*:

> One sentence is a statement of the current state. The other is a potential action. But there's no
> explanation of what this means or how this functionality works, or any UI differentiation between
> these two kinds of sentence.
>
> — Greg, 2026-10-02

The plan built from this is
[261002e-sharing-mark-tooltip-separates-state-from-action.md](../plans/261002e-sharing-mark-tooltip-separates-state-from-action.md).
The house rules for cards are [tooltips.md](../project/tooltips.md).

**How it was gathered, and what that costs.** A Sonnet subagent with web search, one pass. Several
pages came back through a summarising fetch rather than verbatim; those are marked *(summarised)*.
Three sources failed to load and are not relied on: Microsoft Fluent, Shopify Polaris, and the
Material 3 tooltip page beyond its section headings. Dropbox's wording was not retrieved.

## What a tooltip is for

Every design system that was read says the same three things.

- **It clarifies a control and is never essential.** Nielsen Norman Group: *"Important information
  should always be on the page; therefore, tooltips shouldn't be essential for the tasks users need
  to accomplish"*, and actionable instructions *"shouldn't be in a tooltip"*.
  <https://www.nngroup.com/articles/tooltip-guidelines/>
- **It says something the label does not.** Atlassian: only *"short and clear text that quickly
  clarifies or adds value"*; skip it if it adds nothing to the label. Apple's HIG *(summarised)*:
  say what a control does or why you would use it, don't repeat the title, don't say "Click here".
  <https://atlassian.design/components/tooltip/usage> ·
  <https://developer.apple.com/design/human-interface-guidelines/offering-help>
- **No links or buttons inside.** Atlassian *(summarised)* and GitHub's Primer both send interactive
  or long content to a popover, a disclosure or a dialog, because a hover card cannot be reached by
  keyboard. Primer also splits a control's *label* (its name) from its *description*
  (supplementary), which is the split our `aria-label` and card already make.
  <https://primer.style/components/tooltip/guidelines>

## How the leading products word "who can see this"

| Product | State | Descriptor |
|---|---|---|
| Google Drive | **Restricted** | *Only people with access can open with the link* |
| Google Drive | **Anyone with the link** | *Anyone on the internet with the link can view* |
| Notion | **Only people invited** (older: **Private**) | *Only you and people you invite can access* |
| Figma | **Only invited people** | *Only those directly invited to the file can access it* |
| GitHub | **Private** / **Public** | none on the badge; the consequences are on the settings page |

Sources: <https://support.google.com/docs/answer/2494822> ·
<https://www.notion.com/help/sharing-and-permissions> (via a search summary) ·
<https://help.figma.com/hc/en-us/articles/360040531773-Share-files-and-prototypes> ·
<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility>

**The pattern is a one-word state, then one sentence saying who.** None of them appends a suggestion
to share to that sentence. Sharing is a separate control, labelled with a verb.

## State and action on one small surface

No design system addresses this directly; this is inference from the sources above.

- **Grammar.** A state is a noun or a declarative sentence (*Private*; *Only you can read this*). An
  action is an imperative on a control (*Share*). Two plain sentences in one paragraph, one of each
  kind, read as one voice — and the imperative reads as advice, because nothing marks it as the
  thing you press.
- **Rule of thumb.** If the action sentence cannot be pressed, it is either deleted or turned into a
  line that says **where pressing the control goes**, set apart from the state. If it should be
  pressable, it becomes a real control on a surface that allows one.

## Actions inside a card

- **WCAG 1.4.13, Content on Hover or Focus**: anything shown on hover must be dismissible (Escape),
  hoverable (the pointer can move onto it) and persistent.
  <https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html>
- **The ARIA tooltip pattern** keeps focus on the trigger, and says a hover surface with focusable
  content should be a non-modal dialog instead. <https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/>
- **Toggletips** (Heydon Pickering's name, found via
  <https://css-tricks.com/tooltip-best-practices/>, not the primary text) open on click rather than
  hover, close on Escape or an outside click, and are the usual answer when the content is long or
  interactive.
- **Material 3 "rich tooltips"** are recalled as allowing a title and an action or two. Unverified —
  the page loaded only as headings — so it is not relied on here.

So an action *inside* the card is possible, but it makes the card a dialog: it needs focus
management and a pointer that can enter it. In this app that is open question Q10, which Greg
answered on 2026-10-02 (*"(c) would be ideal if we can make it work, but test & check in browser
carefully"*) and which another session is building as an opt-in on `Tooltip`. It was not on `dev`
when this was written.

## What this means for the padlock

The padlock is already a link, to the article's Metadata page where the sharing card is. So the
action exists; the card just did not say that the padlock *is* it. The research points to:

1. **A state the card leads with**: *Private*, then *Only you can read this.*
2. **What sharing would mean**, in the second paragraph, because that is the half a reader cannot
   work out by pressing (tooltips.md's `ControlTip` rule).
3. **Where pressing goes, on its own line and styled as a different kind of sentence** — not an
   imperative tacked onto the state.

An in-card *Share…* button is the step after, once the clickable-card prop lands.

## Rules worth adopting app-wide

Proposed rather than adopted: tooltips.md is a doc whose wording is a rule, so the change goes to
Greg first ([edit-important-docs.md](../reusable/edit-important-docs.md)). The proposal is in the
plan.

1. A card's sentences are statements: what this is, what is true of it now, and what you could not
   guess. **An action is never a sentence in the same paragraph as a state.**
2. If pressing the control goes somewhere or does something worth saying, that is its own line,
   styled apart, saying where it goes or what it does.
3. A card never asks the reader to do something it cannot do for them, unless that line names the
   control that will.
4. Words like *your* are written from the viewer's side: a stranger reading a shared article is not
   its owner.
