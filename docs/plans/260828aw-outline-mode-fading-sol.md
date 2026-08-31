Verdict: **PROCEED-WITH-CHANGES.** The grid and rails are structurally sound, but there is one real cascade defect and the test/documentation substantially overstate what the regex gate proves.

### Findings

1. **Moderate — a current supplement remains faint.**

[`here`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:9061>) and [`supplement`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:9083>) have equal specificity, and `supplement` comes later. A supplement can be `here now`: `outlineProjection` includes supplements when finding the current part and assigns `here` from containment ([outline.ts:190](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/outline.ts:190>), [outline.ts:228](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/outline.ts:228>)).

Therefore a current endnotes row gets:

- faint title, not `--ink`;
- faint number too, although its number is empty;
- `--highlight-wash` and weight 650 from `now`.

That is about **4.50:1** on the wash, versus **14.45:1** for `--ink`. It technically scrapes past normal-text AA by rounding, but it contradicts “the whole ancestor chain is lifted.” Make `here` win over `supplement`, or dim only `.supplement:not(.here)`.

Separately, `.outln-num` always has an explicit faint colour, so `here` never lifts current row numbers.

2. **Moderate — the gate catches exact spellings, not the claimed defect class.**

The undefined-token half records any declaration anywhere ([css-tokens.test.ts:58](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/css-tokens.test.ts:58>)). It passes when:

- `--x` exists only inside an inactive `@media` or `@supports`;
- `--x` is defined under an unrelated selector that cannot reach the consumer;
- an unused/commented/dead JS object contains `"--x":`, because JS is not decommented and reachability is ignored ([css-tokens.test.ts:65](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/css-tokens.test.ts:65>));
- a syntactically invalid or quoted CSS fragment happens to contain `--x:`.

The surface half is narrower still ([css-tokens.test.ts:125](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/css-tokens.test.ts:125>)). These all pass:

```css
--x: var(--muted);
.foo { color: var(--x); }

.foo { color : var(--muted); } /* whitespace before colon */
.foo { COLOR: var(--muted); }
.foo { color: color-mix(in oklab, var(--muted), white); }
.foo { -webkit-text-fill-color: var(--muted); }
```

It also omits obvious semantic surfaces such as `--page`, `--panel`, `--surface-raised`, `--rule`, and `--highlight-wash`.

A particularly plausible bypass is `tw:text-muted`: Tailwind maps `--color-muted` to the surface token ([tailwind.css:165](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tailwind.css:165>)), but the test never examines generated utilities or TSX class semantics.

Nested fallback is partly covered: `var(--x, var(--y))` will match and check the inner no-fallback `--y`. It will not validate the outer fallback’s semantics.

`font:` and `border:` are not meaningful holes because neither shorthand sets foreground `color`; Tailwind utilities, `-webkit-text-fill-color`, and SVG `fill` are.

Your red/green mutation proves the current regex catches the two exact original spellings in the current four files. It does **not** prove scoping, reachability, alias resolution, generated Tailwind output, fallback validity, completeness of `SURFACES`, or even that a future regex still finds any candidates. The docs should call this a syntactic tripwire unless those claims are strengthened.

3. **Low — the number gutter does not guarantee sibling alignment.**

Each row owns an independent `auto` track ([styles.css:8966](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8966>)). The per-level `min-width`s are floors, not fixed shared gutters ([styles.css:8997](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8997>)).

Thus part `10` or section `10.10` can widen only its own first column and shift that title relative to its siblings. An extreme unbroken number can consume or overflow the panel horizontally because the `auto` track has no cap. This will not cause silent bottom overflow—the measured copy sees the same geometry—but it weakens the stated sibling-alignment guarantee.

### Grid and rails

I found no visible-versus-measured height mismatch introduced here:

- Visible and measuring copies share `RowBody` and `rowClass` ([OutlinePanel.tsx:315](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/OutlinePanel.tsx:315>), [OutlinePanel.tsx:385](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/OutlinePanel.tsx:385>)).
- The visible-only `focused` class adds an inset shadow, not geometry.
- Level 3’s first track collapses to zero, its gap is zero, and the title remains explicitly in column 2.
- Long titles shrink inside `minmax(0, 1fr)` and retain the clamp.
- Gist/arc paragraphs wrap in column 2; any added height is measured.
- An empty level-1 supplement number wastes the reserved gutter but does not overflow.

The rails also work as written:

- Adjacent level-2/3 rows have no margins, so the rails meet; level-1 margins deliberately break part runs.
- `.now.lvl-2::before` has greater specificity than the base rail rule and wins.
- No other outline-row pseudo-elements exist.
- `border-radius` does not clip them because the row does not set `overflow: hidden`.

### Colour results

| Text | On page | On actual `--panel` |
|---|---:|---:|
| old `--muted` | 1.22:1 | 1.14:1 |
| `--ink-faint` | 5.66:1 | 5.28:1 |
| `--ink-soft` | 9.89:1 | 9.23:1 |
| `--ink` | 18.15:1 | 16.93:1 |

Cascade outcomes:

- `here + tier-far`: `here` wins, as intended.
- `now + hover`: `now` background wins, as intended.
- `read + here`: the read title rule would win, but this combination is structurally impossible: `here` requires `focus <= end`, while `read` requires `end < focus`.
- `supplement + now`: supplement faint wins—the defect above.
- Faint text on the raised hover background is approximately **4.44:1**, just below the 4.5:1 normal-text threshold.
- Ordinary cur/near/mid rows are technically less contrasted than before because they changed from inherited `--ink` to `--ink-soft`, but 9.23:1 remains comfortably legible and the hierarchy appears deliberate.

The targeted test run passed: **28 tests across `css-tokens` and `outline-panel`**. The outline-panel tests still do not prove real-browser fit, as their own preamble correctly says.