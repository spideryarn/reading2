# A collapsible section latched shut, and sealed the error in

**Found** 2026-09-03, by a test written for something else — the Metadata page's
section order. **Introduced** by `b3b4311f` (2026-08-27), *"Shut the long
section, and let every stage say when it last wrote"*. **Live for seven days**,
on every metadata page whose `GET /api/metadata/:slug` failed.

## What was broken

`Section` in [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) took a
`collapsible` prop and held its open state as:

```tsx
const [open, setOpen] = useState(!collapsible);
```

Its one varying caller was the pipeline section:

```tsx
<Section label="What we did to it" collapsible={!provenanceError} …>
```

`provenanceError` is `null` until the metadata request rejects. So on the first
render `collapsible` is `true`, `useState` latches `open: false` — and never
looks at the argument again, because that is what an initial value is.

When the request then failed, two things happened at once and they pointed
opposite ways. `collapsible` went `false`, which took the disclosure button
away: the heading stopped being a control. And `open` was still `false`. The
section was left **shut with nothing on the page able to open it**, and what was
shut inside it was the error message explaining why the rest of the page was
empty.

## The thing that makes it worth writing up

That `collapsible={!provenanceError}` was not incidental. It was added
deliberately, by a cross-model review on 2026-08-27, with this comment above it:

> The one thing this section holds that the reader has to see is the error when
> the metadata request fails — and a shut section is exactly where it would have
> gone. So a failure makes the section ordinary: open, with the error at the top
> of it. Found by a cross-model review, 2026-08-27; the first version hid it.

The review found the right hazard, the fix named the right mechanism, the
comment recorded the reasoning — and the code did not do it. The error went to
exactly the place the comment said it must not go, and the comment is what made
that invisible for a week: everybody who read this file, including several
agents editing around it, read the sentence and took it for the behaviour.

**The class: a fix that reads as done because its rationale is written down.**
Prose in the file is not evidence about the file. This is the same shape as
[silent-success.md](../reusable/silent-success.md) — a check that has never been
seen to fail — with the check replaced by a comment.

Second, smaller class: **`useState(derivedFromProps)` for anything that arrives
late.** It is a snapshot of the first render, and every prop on this page that
comes from a fetch is `null` on the first render. The bug is invisible in
development, where the request succeeds.

## What would have caught it

Ranked by value against effort:

1. **A test that fails the request and asserts the error is on the page.** Cheap,
   and it is what caught this in the end — `tests/metadata-page-order.test.tsx §
   the one thing a shut section may not swallow`. The rule existed for seven days
   with no test, which is why it could be wrong for seven days.
2. **Watching a new test go red before the code changes.** The first draft of
   that test asserted only "the heading has no disclosure button", which was
   green against a page with no such section at all. Two of the three assertions
   in this file's tests were vacuous on their first writing and were caught by
   running them against the unfixed page.
3. **A lint rule against `useState(<expression over props>)`.** Real but blunt:
   the pattern is legitimate for a genuinely uncontrolled initial value, so it
   would need suppressions. Not proposed.

## The fix

State the reader's *toggle*, and derive what renders:

```tsx
const [open, setOpen] = useState(false);
const showing = !collapsible || open;
```

A section that is not collapsible shows its children — whenever it stopped being
collapsible, and whatever the reader had toggled before that. That fixes the
class rather than the instance, which matters because the section this rule
protects has since become "Technical details", is shut by *default* rather than
by choice, and now holds the identifiers and the pipeline rows as well as the
error.
