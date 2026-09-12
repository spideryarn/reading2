# Hierarchy goes behind the experimental switch; Structure stays in everybody's bar

Feedback [SPIDERYARN-READING2-35](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-35),
2026-09-12 08:12 UTC, from Greg on an iPad in production (build `607b57a0`):

> Hierarchy mode should be one of the Experimental Features.
>
> Structure mode should be a non-Experimental Feature, ie shown to everyone

The note is [260912_0812-hierarchy-experimental-structure-for-everyone.md](../user-feedback/260912_0812-hierarchy-experimental-structure-for-everyone.md).

## What was already true

**Structure has been out from behind the switch since 2026-09-10**
([260910g](260910g-structure-mode-subsumes-outline.md)), and the build Greg was using contains that
change (`08fcf555` is an ancestor of `607b57a0`). So the second sentence needed no work. A reader
with the switch off already sees Structure in Outline's old slot. What this plan changes is the first
sentence.

## What changes

A reader with the switch off no longer sees the Hierarchy button in the bar or its command-bar row.
Signed-out visitors, who have no command bar, no longer see its bar button. With the switch on,
nothing changes. This is the mechanism in
[experimental-features.md](../project/experimental-features.md), used as it has been for five other
modes:

1. `experimental: true` on `hierarchy` in `MODE_CATALOG` ([`src/mode-catalog.ts`](../../src/mode-catalog.ts)).
2. `"hierarchy"` in `BEHIND_THE_SWITCH` ([`tests/dock-experimental-modes.test.tsx`](../../tests/dock-experimental-modes.test.tsx)),
   the independent copy of the policy. It was written first, and six of that file's tests went red
   until the flag moved.
3. The row and the reason in experimental-features.md.

The command bar needs no change: its mode rows are handed in from `visibleModes`, so it follows the
flag by construction ([`CommandBar.tsx`](../../src/web/CommandBar.tsx) § requirement 4).

## The trap: Hierarchy and the zoom tree are one structure

[granularity-zoom.md § The tree](../project/granularity-zoom.md#the-tree): the deeply nested table of
contents and the zoom tree are the same thing. What this change gates is **the two Dock entry
points** — the mode button and the command-bar row — and nothing under them:

- the pipeline still builds the tree for every article (the `hierarchy` step is untouched), and
  Structure and Summary still read it;
- `?mode=hierarchy` still opens the columns for anybody, and the bar draws Hierarchy's button while
  the reader is in it ("hidden means hidden from the controls, not unreachable");
- the ← / → level choice for keyboard stepping is not a mode control and is untouched.

**What it does take away, and this is Greg's call rather than a side effect:** the zoom *columns*,
the gist columns beside the prose, are drawn only in Hierarchy mode (`inMode` is
`mode !== "hierarchy"` in [`Reader.tsx`](../../src/web/reader/Reader.tsx), and
[`layout.ts`](../../src/web/layout.ts) § `BarContents.inMode` says the granularity controls are drawn
nowhere else). So a reader with the switch off now has no button that reaches the zoom view. They
have Structure and Summary instead, which read the same tree. A direct link or the saved last view
can still put them in Hierarchy, where its current-mode button remains visible.

## The one knock-on: the Features page

`/features` captions a screenshot *"Zoom, in Hierarchy mode."*, which would send a new reader
looking for a button their bar no longer draws. The caption keeps its words and gains one sentence:
*"This is one of the Experimental Features; signed-in readers can turn those on from the bar or
their profile."*

**The simpler option passed over:** flip the flag and leave the page alone. That is two edits rather
than three, but the page would then advertise a control most readers cannot find. Taking the zoom
showcase off the page was also passed over, because it is still one of the features the app is for,
and deleting marketing copy is a bigger call than qualifying it.

## Deferred, named

- **Zoom for everybody, some other way.** If Greg wants the columns reachable without the switch,
  for example as a face of Structure, that is a design question and a separate piece of work. Not
  asked for.
- **The Features page's "Outline." showcase** still names a mode retired on 2026-09-10. That is not
  this report's concern, and it is left for whoever next touches the marketing pages.

## Review

GPT Sol reviewed the stage (workspace-write) and fixed four things in it. A third command-bar test
still typed `toc`, so once Hierarchy left the default bar it passed without taking any row. The
`/features` caption now says only signed-in readers can turn the switch on, because the page is
public. The docs' "one button" became the two controls, the mode button and the command-bar row.
A stale comment in `useArc.ts` still called Hierarchy the default mode. Sol found no other way into
Hierarchy that the change breaks: there is no "open in Hierarchy" control in any other panel, the
visitor policy still allows it, and the `?mode=hierarchy&text=0` rewrite and the Dock's fitting are
unchanged.

## Stages

One stage: the flag, the test, the docs and the caption. It is reviewed by GPT Sol, then gated by
`npm test` and `npm run typecheck`.
