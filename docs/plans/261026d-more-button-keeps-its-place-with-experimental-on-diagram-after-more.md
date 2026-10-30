# More keeps its place with Experimental on: Diagram after More

Report spya-d0pyzt (Greg, admin, suggestion, 2026-10-26), from a Summary page:

> In the bottom bar, move the three dots when we're in experimental features mode to be in roughly
> the same position they are in the main mode. So I think that's to the right of skim maybe, or the
> left, I forget, but it's a bit further right than it currently is. Where in experimental features
> mode, right now it's all the way to the left.

## Why it moves

More stands straight after Skim (`MORE_AFTER` in `src/web/Dock.tsx`, spya-c0va9e). Diagram is the
one experimental mode in the bar, and its row sits *before* Skim, in the shape run:

```
switch off:  Plain | Structure Summary Skim ⋯ | Sources …
switch on:   Plain | Structure Summary Diagram Skim ⋯ | Sources …
```

So with the switch on, More is one button further right, and on a phone, or any window narrow
enough, that place is past the edge. Then the guard from plan 261009c (`moreOffTheEdge` in
`src/web/dock-fit.ts`) moves More to the front of the frame: *"all the way to the left"*. The same
happens with the switch off while Diagram is the open mode.

## The change

Move Diagram's row from just before Skim to just after it. `cutForMore` cuts after Skim, so Diagram
falls after More, still in the shape run:

```
switch off:  Plain | Structure Summary Skim ⋯ | Sources …
switch on:   Plain | Structure Summary Skim ⋯ Diagram | Sources …
```

More then has the same buttons before it whatever the switch says, so the same x at every width,
and its place stays on a phone's screen, so the guard does not fire. The guard stays, for a bar that
grows again.

Diagram's place after Summary (2026-09-29) was the plan's reasoning, not Greg's words (its row
comment says so), so moving it one past Skim and More takes nothing he chose. Its cost: Diagram now
sits after the dots rather than with Summary, and More is no longer the last button of its run when
the switch is on.

**Passed over**: anchoring More by count, or after Summary when Diagram is drawn. Both keep Diagram
where it is but either leave More one button off its usual place or make the rule depend on which
modes are drawn, which is the braid that caused this.

Tests: `tests/dock-mode-order.test.ts`, `tests/dock-groups.test.tsx` and
`tests/dock-more-leads.test.tsx` pin the old order and the guard's Diagram cases; they change with it,
and a new assertion pins More's index as equal with the switch on and off. Browser check before and
after at 1440, 1024, 390 and 360.
