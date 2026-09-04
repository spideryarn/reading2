# Only the Sketch is good enough for everyone; gate the other four pictures

**[SPIDERYARN-READING2-13](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-13)** · reported
2026-09-04 12:48 UTC · *shipped*

## What the reader said

> We have this idea of experimental features. The only diagram sub-mode that is good enough to show
> everyone is the sketch mode. The other ones should be um only visible to people who have
> experimental features on, because they don't work so well yet. This might require us to slightly
> tweak the way experimental features are set up because we're now saying the diagram mode is visible
> to everyone, but ONLY the sketch sub-mode within that.

Sent from `…/read/xanadu-spya-ueuvaf?mode=diagram&diagram=trail`, so he was looking at Trail when he
wrote it.

## What we did

Exactly that, and the "slight tweak" turned out to be one boolean.

- **Diagram's `MODES_UI` row is `experimental: false`** ([`Dock.tsx`](../../src/web/Dock.tsx)), so
  the mode is in every reader's bar — nine of the thirteen now, not eight.
- **`KIND_UI` rows gained a required `experimental: boolean`**
  ([`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx)): `sketch` false, `force`, `drift`, `trail`
  and `illustrated` true. Required rather than optional for `MODES_UI`'s reason — picture six cannot
  be added without somebody deciding which side of the line it is on.
- **The chip row draws the non-experimental chips plus whichever `?diagram=` names**, which is the
  bar's own rule and is now *literally* the bar's own rule: `shownBehindTheSwitch` in
  [`experimental-visibility.ts`](../../src/web/experimental-visibility.ts), called by `visibleModes`
  and by the new `visibleKinds`. A shared `?diagram=trail` link therefore still opens Trail for a
  reader with the switch off, with a checked chip for it — the radiogroup is never left announcing
  *one of these* with none of them on.
- **The default picture is `sketch`** ([`params.ts`](../../src/web/params.ts) § `diagramParam`),
  on **and** off. One default rather than two, so a pasted link and a fresh arrival land on the same
  picture.

**No generalised sub-feature gating was built**, deliberately: one boolean on one table, and the
next feature that needs this copies the shape rather than inheriting a framework.

## The one thing that had to be checked, and was

Putting Diagram in front of every reader puts a ~$0.20, two-to-three-minute Sketch button in front of
every reader, so the question is what *arriving* costs. Verified in the code and pinned by a test:

- `diagram` is deliberately absent from `MODE_TARGET`
  ([`activation.ts`](../../src/web/activation.ts)), so pressing the bar button arms nothing;
- the Sketch empty state is an invitation carrying the price and the wait, and draws nothing until
  asked;
- `tests/public-network-trace.test.tsx` now asserts that an owner arriving at `?mode=diagram` reads
  the artefact and posts **no** job — it previously cleared the trace before that could be seen.

The rest of the spend picture is unchanged and is written down in the plan doc: an article's owner
could already start unlimited paid reruns, a shared visitor is pinned to the free Force picture with
the picker not rendered at all, and there is no per-owner or cumulative spend cap in this repo. **So
this change moves discoverability, not authority.** Experimental status is control visibility only —
nothing on the server reads it, and it must never be relied on as a boundary.

## Verified in a browser, not only in tests

Playwright against system Chrome on the box, `SPIDERYARN_STORE=postgres`, signed in as the seeded
owner.

- **Switch on** — five chips, `Force · Drift · Trail · Sketch · Illustrated`, and **Sketch** is the
  one checked on arrival at `?mode=diagram`. The bar draws thirteen modes.
- **Switch off** — one chip, **Sketch**, checked; the bar draws nine, Diagram among them and lit.
- **`?diagram=trail` with the switch off** — two chips, `Trail · Sketch`, Trail checked, and the
  Trail picture drawn. `?diagram=illustrated` likewise: `Sketch · Illustrated`, Illustrated checked,
  and its panel rendered. The shared link is not broken by the switch, which was the thing to prove.
- **Illustrated stays immediately right of Sketch** even when the row is filtered, because Sketch is
  the chip that is always drawn — so its refusal copy, *"press Sketch, the chip one to the left"*,
  is still true for a reader with the switch off.
- **The empty state, switch off, on an article with no sketch** — one chip and this, verbatim:

  > Nobody has drawn this one yet.
  >
  > A model reads the whole article, works out what shape the argument is, and draws that. It is the
  > slowest thing here — about two minutes — and it costs one model call, about $0.20, so it is
  > never drawn until you ask.

  with a *Your profile* tick-box and a **Draw the argument** button — and the network capture for
  that load contains **no `POST /api/jobs`**, which is the assertion the whole change rests on.
  Nothing was pressed.

## Docs

[diagram.md](../project/diagram.md) § *Who sees which chip* and § *Why Force was the default, and why
Sketch is now*; [experimental-features.md](../project/experimental-features.md) § *The one thing that
is gated below mode level*; [reading-view-overview.md](../project/reading-view-overview.md) and
[url-state.md](../project/url-state.md) for the counts and the parameter.

And a stale paragraph in [security-map.md](../project/security-map.md) that this stage was asked to
fix: it still said Diagram was owners-only unconditionally and that all its pictures POST, which
stopped being true on 2026-09-04 when a visitor started getting Force. It now says where the boundary
actually is — the `access` union in the panel and `requireUser` on the two endpoints — and says in
its own paragraph that the experimental switch is not a gate of any kind.

Plan: [260904b](../plans/260904b-address-user-feedback-reports-batch.md) § stage 5.
