# Adopting shadcn/ui components

> Let's switch to using Shadcn.
>
> — Greg, 2026-08-25

This is the plan, and an honest account of what it buys.

**The framing matters, so it goes first.** This is *adopting shadcn components*, not *switching to
shadcn*. Button, Toggle/ToggleGroup, Collapsible, Separator — covering the roughly eleven clickable
chrome elements in the app — while [`TableView.tsx`](../../src/web/TableView.tsx),
[`Spine.tsx`](../../src/web/Spine.tsx), the modeless comment panel shell, the structural stylesheet
and the tooltip all stay exactly as they are. Anyone reading "switch to shadcn" as "rebuild the
reading view on shadcn" will do a great deal of damage; see [§ 10](#honest-assessment).

Three things reshape the job from what you would expect. All three were settled by experiment, not
argument:

- **Tailwind must be installed with `prefix(tw)`.** Without it, Tailwind's scanner generates 18
  utilities out of our source, two of which collide with live class names, and one of those draws a
  visible 1px outline around the whole table in outline mode. [§ 1](#the-scanner-collision).
- **The app stylesheet must go into a cascade layer**, or utilities you deliberately write will
  silently lose. This is a *different* problem from the prefix and neither fix substitutes for the
  other. [§ 2](#the-cascade-layer-problem).
- **The token bridge is already built.** Our palette came out of a shadcn project and still wears
  shadcn's variable names. [§ 5](#the-token-bridge).

Everything marked **verified** below was checked against the published packages and this repo's real
source on 2026-08-25, by building it. Nothing here has been done to the repo — this is a plan, not a
record.

---

## Where we are today

No Tailwind, no Radix, no shadcn, no `components.json`, no `@/` alias.

**Every stylesheet in the repo, and how it loads.** There are two, and one entry point:

```
src/web/main.tsx      import "./styles.css"          ← the only CSS entry point
  └─ src/web/styles.css                              1,212 lines, the reading view
       └─ @import "../../styles/tokens.css"          line 14 — brand + reading tokens
```

[`index.html`](../../index.html) has **no `<link rel="stylesheet">`** — its only `<link>`s are
favicons and the manifest. [`vite.config.ts`](../../vite.config.ts) has no CSS configuration at all.
So all styling enters through one `import` in [`src/web/main.tsx`](../../src/web/main.tsx), which is
what makes the fix in [§ 2](#the-cascade-layer-problem) a one-line change.

[`styles/tokens.css`](../../styles/tokens.css) sits at the **repo root**, not under `src/`. It is
shared ground: deliberately plain CSS, lifted from the original app —
[original-version/overview.md § Already lifted](../project/original-version/overview.md#already-lifted-into-this-repo).
`styles.css` layers reading-view semantics (`--ink`, `--page`, `--panel`, `--rule`, `--highlight`,
`--surface-raised`) on top of it.

`lucide-react` 1.34.0 is already a dependency, with house defaults set once via
`<LucideProvider size={16} strokeWidth={1.75}>` in [`src/web/main.tsx`](../../src/web/main.tsx) —
[icons.md](../project/icons.md). shadcn's default icon set is Lucide, so **use the existing provider
and do not introduce a second icon convention**; generated components import from `lucide-react` and
inherit those defaults for free.

### Written decisions this touches

| Doc | What it said | What we are doing |
|---|---|---|
| [original-version/overview.md § Deliberately not lifted](../project/original-version/overview.md#deliberately-not-lifted) | *"**shadcn/ui, Radix, Tailwind v4, Phosphor.** … Adopting Tailwind later is fine; inheriting a component library now is not."* | Adopting both. The "later" clause is being cashed in; the component-library half is a straight reversal. |
| [`styles/tokens.css`](../../styles/tokens.css) header | *"Deliberately plain CSS custom properties: no Tailwind, no shadcn, no build step."* | Becomes false. The file stays plain CSS and stays canonical, but a `@theme inline` block now reads it. Rewrite the comment — [§ 11](#docs-to-update). |
| [tooltips.md § What we chose](../project/tooltips.md#what-we-chose) | Floating UI chosen **over** `@radix-ui/react-tooltip` | **Narrowed, not reversed.** One of its two reasons expires; the other stands and decides it. [§ 7](#the-floating-ui-question). |
| [AGENTS.md](../../AGENTS.md) § Working agreements | *"Prefer boring: … no framework churn while the ideas are still moving."* | This is framework churn. Greg has asked for it; that is his call, recorded here so nobody later thinks the principle was forgotten. |

---

## 1. The scanner collision, and `prefix(tw)` <a id="the-scanner-collision"></a>

**Decided: install Tailwind with `prefix(tw)`. This is not optional and not a matter of taste.**

### What happens without it

Tailwind's source scanner is a **plain text scanner**. It extracts bare words from source files and
generates a utility for any that happens to match a utility name — whether or not the word was ever
a class name. Built against this repo's real `src/web/` directory, it generates 18 classes:

```
block  blur  border  collapse  container  contents  fixed  hidden  inline
invisible  outline  relative  resize  sticky  table  transform  underline  visible
```

Most are harmless dead CSS. **Two collide with live class names.**

#### `.outline` — a real, visible bug

Verified end to end:

1. [`TableView.tsx:118`](../../src/web/TableView.tsx) sets
   ``className={`zoom ${showText ? "reading" : "outline"}`}`` — so the `<table>` carries the class
   `outline` in outline mode.
2. `styles.css:633-635` uses `.outline` only as an **ancestor** (`.outline td.gist .sticky`), and
   grepping the whole stylesheet for `outline` shows `outline-*` is set on nothing but the
   `:focus-visible` states of `.spine-hit` and `.cmt-search`. Nothing sets `outline-*` on the table.
3. Tailwind emits `.outline { outline-style: var(--tw-outline-style); outline-width: 1px }`.
4. `--tw-outline-style` is registered by an `@property` rule with `initial-value: solid` — I checked,
   because if it were unregistered the declaration would be invalid at computed-value time and the
   outline would never paint. It is registered, so it resolves to `solid`.

Nothing contests it, so it applies. **Result: a 1px outline drawn around the entire table whenever
the reader switches to outline mode** (`/?text=0`).

Note the shape of this failure. It is not a crash; it is a plausible-looking border that reads as a
deliberate design choice, in a mode you have to opt into. No unit test can see it — nothing renders
React ([§ 9](#tests-and-checks)) — and
[browser-testing.md § Do not judge colour from a screenshot](../project/browser-testing.md#do-not-judge-colour-from-a-screenshot)
is about exactly this class of "looks fine, is wrong". Textbook
[silent success](../reusable/silent-success.md).

#### `.sticky` — benign, but verify rather than assume

[`TableView.tsx:207,247`](../../src/web/TableView.tsx) render `<div className="sticky">`, styled by
`td.gist .sticky` (`styles.css:475`), which already sets `position: sticky` plus padding. Tailwind's
`.sticky { position: sticky }` says the same thing less specifically, so there is no visible effect.
Benign — but it is benign by coincidence, not by design, and that is worth writing down rather than
trusting.

(`.block` is a false positive: our class is `block-id`, and nothing is classed `block`. Not worth
worrying about.)

### The fix, verified

```css
@import "tailwindcss/theme.css" layer(theme) prefix(tw);
@import "tailwindcss/utilities.css" layer(utilities) prefix(tw);
```

Rebuilt against the same real source directory: **zero** bare utilities generated. The only
unprefixed rule in the output was our own `.controls button`.

Usage is colon syntax, v4 style — `tw:flex`, `tw:gap-2`, `tw:hover:bg-accent` — **not** the v3 `tw-`
dash form. Verified compiling.

**One question this raises, answered:** the prefix does *not* change how you write `@theme`. Theme
variables stay unprefixed (`--color-highlight`, not `--tw-color-highlight`), and `tw:bg-highlight`
resolves them correctly. I checked this specifically, because if the prefix had propagated into the
theme block it would have rewritten the whole token bridge in [§ 5](#the-token-bridge). It does not.

### The cost, stated

Every utility anyone writes from now on carries a `tw:` prefix, and shadcn's generated components
arrive **unprefixed** — their `cva` strings say `inline-flex items-center rounded-md`, not
`tw:inline-flex tw:items-center tw:rounded-md`. So every component added by
`npx shadcn@latest add` needs its class strings prefixed before it works. The CLI has no flag for
this; it is a find-and-replace over one file per component, done once at add time.

That is genuinely annoying, and it is worth it: the alternative is an unprefixed namespace where any
future class name we invent might silently collide with a Tailwind utility. We already have two
collisions in a codebase that has never met Tailwind. A prefix makes that impossible by
construction rather than by vigilance.

---

## 2. The cascade-layer problem <a id="the-cascade-layer-problem"></a>

**A separate problem from [§ 1](#the-scanner-collision), with a separate fix. Neither substitutes for
the other** — see [§ 3](#which-mechanism-does-what), which is there specifically so nobody
cargo-cults both without knowing what each is for.

### The mechanics

Verified by unpacking `tailwindcss@4.3.3` and reading `package/index.css`:

```css
@layer theme, base, components, utilities;   /* line 1 */
@layer theme { @theme default { … } }        /* line 3   — design tokens */
@layer base { … }                            /* line 535 — preflight */
@layer utilities { @tailwind utilities; }    /* line 948 — every utility */
```

Everything Tailwind emits sits inside a layer. Meanwhile
[`src/web/main.tsx`](../../src/web/main.tsx) does a bare `import "./styles.css"`, so all 1,212 lines
are **unlayered** — and in the CSS cascade, **unlayered normal declarations beat layered ones,
whatever the layer order and whatever the source order.** `styles.css` outranks every utility.

### It hits exactly where the shadcn components go

Not a theoretical worry about a stray class. `styles.css` styles its buttons by *descendant*
selector:

```css
.controls button { border: 1px solid var(--rule-strong); border-radius: 999px; padding: 0.22rem 0.6rem; … }
```

A shadcn `ToggleGroupItem` inside `.controls` is a `<button>`. That rule (0-1-1, unlayered) beats
`tw:rounded-md` (0-1-0, layered) twice over — once on layer priority, once on specificity. The same
applies to `.cmt-nav button`, `.cmt-dialog button.linky`, `.cmt-dialog header`, `.cmt-dialog footer`,
`.cmt-answer p`, `.cmt-sources li`, `.cmt-sources a`, `.about dd`, `.prose > *`, `td`, `thead th`
and `h1`. **Every one of the places we want to put a shadcn component is already covered by a
descendant rule.**

And it fails with no error, no warning, no console message. You add a class, nothing moves, and the
CSS is served and valid.

### The fix, verified

One new file, `src/web/tailwind.css`:

```css
@layer theme, base, app, utilities;
@import "tailwindcss/theme.css" layer(theme) prefix(tw);
@import "tailwindcss/utilities.css" layer(utilities) prefix(tw);
@import "./styles.css" layer(app);
```

and change [`src/web/main.tsx`](../../src/web/main.tsx) line 7 from `import "./styles.css"` to
`import "./tailwind.css"`. **The 1,212 lines are never touched.**

I built this on `vite@8.2.2` + `@tailwindcss/vite@4.3.3` and read the emitted CSS. It works, and
better than needed:

- `styles.css` **and its nested `@import` of `tokens.css`** both land inside `@layer app { … }`. The
  nested import inherits the layer, so `tokens.css` needs no change at all.
- `:root { --rule-strong: … }` survives intact inside the layer. Layers govern which *declaration*
  wins; nothing else declares these, so they resolve normally. Custom properties are unaffected.
- The declared order is preserved, so utilities come last and win.

The negative control confirms the failure too: remove `layer(app)` from that one import and
`.controls button` is emitted **outside every layer** while `@layer app` sits empty — precisely the
silent condition above.

**A small correction to the shape of this.** Two files imported side by side from `main.tsx` —
`import "./tailwind.css"; import "./styles.css";` — does *not* work: `styles.css` stays unlayered and
the problem returns. Getting `styles.css` into a layer without editing it requires the
`@import "./styles.css" layer(app)` form, so `main.tsx` must import the entry file **only**.

**Two nasty details.** `package/utilities.css` is the bare line `@tailwind utilities;` and
`package/theme.css` a bare `@theme default { … }` — *neither self-wraps*. Import them without
`layer(…)` and the utilities become unlayered too; they then tie on layer priority and lose on
specificity instead, which looks like the same bug with a different cause. And the `@layer` statement
must come **first**, before the `@import`s — a layer statement is one of the few things allowed to
precede `@import`, and it is what fixes the order.

---

## 3. Which mechanism does what <a id="which-mechanism-does-what"></a>

Both fixes are needed. They solve different problems, and a future reader should be able to tell
which is load-bearing for what:

| | `prefix(tw)` | `@layer app` |
|---|---|---|
| **Solves** | *accidental* collisions — Tailwind generating a class we already use for something else | *intended* overrides — a utility you deliberately wrote losing to an existing descendant rule |
| **Symptom without it** | a 1px outline round the table in outline mode; other dead CSS | `tw:rounded-md` on a `ToggleGroupItem` does nothing |
| **Would the other fix cover it?** | No. Layering makes utilities *win* more, which makes an accidental `.outline` collision **worse**, not better. | No. The prefix stops Tailwind inventing `.outline`; it does nothing about `.controls button` beating `tw:rounded-md`. |

The team lead's read was that with a prefix and no preflight the layering "matters much less, since
nothing collides any more". That is right about *accidental* collisions and not right about
*intended* ones: `.controls button` (0-1-1, unlayered) still beats `tw:rounded-md` (0-1-0, layered),
and `.controls button` is precisely the rule sitting on top of the first component we plan to adopt.
Keep both. Step 6 does delete `.controls button`, which would incidentally resolve that one case —
but relying on "we remembered to delete the conflicting rule" is exactly the vigilance the layer
makes unnecessary.

---

## 4. Preflight: skip it <a id="preflight"></a>

**Decided: import `theme.css` and `utilities.css` only. Never `@import "tailwindcss"`.** Both files
are separately importable from the published package — verified.

With the layer order above, our `@layer app` rules beat preflight, so anything `styles.css` states
explicitly would survive. The damage is to everything `styles.css` is **silent** about:

| Preflight rule | What it hits here |
|---|---|
| `h1,…,h6 { font-size: inherit; font-weight: inherit }` (line 78) | `styles.css:131` and `.prose h1/h2/h3` set theirs, so those survive. `.prose h4`–`h6` in the author's own HTML are styled by nothing and would flatten to body text. |
| `table { border-collapse: collapse }` (line 171) | `table.zoom` sets `separate` deliberately — sticky column pinning depends on it (`styles.css:312-316`). Ours wins, so **this one survives**. Any `<table>` in the author's prose does not. |
| `button, input, … { border-radius: 0; background-color: transparent }` (line 243) | `.controls button` and `.cmt-nav button` set their own. `.disclose` and `.cmt-close` set most but not all. |
| blockquote / list / margin resets | `.cmt-quote` is a `<blockquote>` ([`CommentDialog.tsx:119`](../../src/web/CommentDialog.tsx)) with no margin reset of its own; `.prose blockquote` and `.cmt-sources ol` rely on UA defaults in places. |

So preflight produces no single loud break — a dozen quiet ones, mostly in `.prose`, which renders
**the author's own HTML**, the one place we cannot enumerate what tags will appear.

**The cost of skipping it.** shadcn's components assume preflight. Reading their real sources
([§ 6](#component-by-component)), the gap for the four we want is small: `button`, `toggle`,
`toggle-group`, `collapsible` and `scroll-area` all set their own `border-radius`, `background`,
`font-size`, `font-weight` and `outline` in the `cva` base string. What they miss is mainly
`button { background-color: transparent }` and the universal border normalisation. Add those back
scoped to `[data-slot]`, which shadcn puts on every generated element:

```css
@layer components {
  [data-slot] { border: 0 solid; }
  button[data-slot] { background-color: transparent; }
}
```

Four lines against a dozen quiet regressions in the author's prose. `* { box-sizing: border-box }` is
already `styles.css:70` — the one part of preflight we want, and we have it.

---

## 5. The token bridge — mostly already built <a id="the-token-bridge"></a>

**Do not plan this as work. It is nine-tenths done and has been for a week.**

[`styles/tokens.css`](../../styles/tokens.css) came from the original app's `app/globals.css`, which
*was* a shadcn project. It already carries shadcn's default **dark** values, under shadcn's exact
names, in OKLCH, with `--primary` swapped to the Spideryarn orange:

`--background` `--foreground` `--card` `--card-foreground` `--primary` `--primary-foreground`
`--secondary` `--secondary-foreground` `--muted` `--muted-foreground` `--accent` `--accent-foreground`
`--destructive` `--border` `--input` `--ring` `--sidebar` `--sidebar-foreground` `--sidebar-accent`
`--sidebar-border` `--radius: 0.625rem`.

### What is left

**Keep `:root` in `tokens.css` canonical and merely *reference* it from `@theme inline`.** `inline`
is the keyword that matters: it makes Tailwind emit `background-color: var(--background)` rather than
copying the resolved value at build time, so the runtime variable stays authoritative and anything
reading `--background` directly keeps agreeing with anything saying `tw:bg-background`. Verified
working with our tokens inside `@layer app`, and verified unaffected by `prefix(tw)`.

Add to `src/web/tailwind.css`:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);              /* shadcn's meaning: a hover SURFACE */
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-highlight: var(--spideryarn-orange); /* the ORANGE — see Trap A */
  --font-sans: var(--font-ui);
  --font-serif: var(--font-reading);
  --font-mono: var(--font-mono);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
```

Plus three variables `tokens.css` lacks and shadcn expects: `--popover` and `--popover-foreground`
(required by every Radix overlay; natural value `oklch(0.26 0 0)`, the same raised-panel grey
`styles.css` calls `--surface-raised`), and `--destructive-foreground`. Skip `--chart-1`…`--chart-5`;
nothing charts.

### Trap A: `--accent` is a surface, not the orange — and shadcn walks straight into it

Both [`styles/tokens.css`](../../styles/tokens.css) and
[`src/web/styles.css`](../../src/web/styles.css) carry a shouted comment about this, and
[original-version/overview.md § Brand facts](../project/original-version/overview.md#brand-facts-now-load-bearing)
records the failure mode. `--accent` means shadcn's **raised dark surface** for hover states,
`oklch(0.269 0 0)` — *not* the brand orange.

**Good news, checked:** `styles.css` never uses `--accent` at all; the only occurrence is the warning
comment. So nothing today assumes it means orange, and shadcn components using it for hover are
*consistent* with our tokens.

**Bad news, also checked:** shadcn's `toggle` — the component we want for the granularity bar — has
this in its `cva` base string:

```
data-[state=on]:bg-accent data-[state=on]:text-accent-foreground
```

So an out-of-the-box `ToggleGroup` marks its ON state with `--accent`: barely-visible dark grey on a
near-black page. It does not error and is not "wrong" by shadcn's lights — it quietly throws away the
orange wash that currently says which granularity levels are on (`.controls button.on` uses
`--highlight-wash` / `--highlight-ink`). The documented `--accent` trap, arriving through the front
door, in the first component we adopt.

**Mitigation, and why `--color-highlight` is in the block above** — override the on-state, and give
the orange a Tailwind name that cannot be confused with `accent`:

```tsx
className="tw:data-[state=on]:bg-highlight/20 tw:data-[state=on]:text-highlight tw:data-[state=on]:border-highlight"
```

### Trap B: the oklab/oklch hue bug — Tailwind is safe, but the wash is not expressible

`--highlight-wash` mixes `in oklab` deliberately. `styles.css:41-51` explains why: `--page` is written
`oklch(0.145 0 0)`, a hue *explicitly specified* as 0, so polar interpolation drags the orange from
58.6° round to 11.7° and yields a quietly pink wash instead of a warm one.

**Checked, and reassuring:** all 8 `color-mix()` calls in the repo are already `in oklab`. And
Tailwind v4's opacity modifiers emit `in oklab` too — I compiled `bg-highlight/20`,
`text-highlight/55` and `ring-page/80`, and all three produced
`color-mix(in oklab, var(--…) N%, transparent)`. The trap **does not fire** from Tailwind utilities
or from shadcn's `bg-primary/10`-style classes.

**But `--highlight-wash` must still stay a hand-written token, for a different reason.** Tailwind's
opacity modifier always mixes with `transparent` — alpha compositing over whatever is behind. Ours
mixes with `var(--page)` — an opaque blend. Not the same colour, and the difference shows wherever
the wash sits over `--panel` rather than `--page`, which is exactly where `td.gist.active` and
`.spine-part.active` put it. `tw:bg-highlight/20` is a plausible-looking substitution that renders
subtly differently on half its uses. Do not "simplify" it into a utility.

### Light and dark

No light mode, no toggle — Greg's decision
([web-client.md § Dark mode](../project/web-client.md#dark-mode)), with `color-scheme: dark` declared
twice: `:root` in `tokens.css`, and a `<meta>` in [`index.html`](../../index.html) so the browser
paints dark before CSS loads.

**`shadcn init` writes a light `:root` palette and a `.dark` block.** Loaded after `tokens.css`, its
`--background: oklch(1 0 0)` wins and the page goes white with a near-invisible orange. Pointing
`components.json` at `src/web/tailwind.css` limits the blast radius but does not remove it. So: **run
`init`, then immediately diff and revert every palette line it wrote**, keeping only the `@theme
inline` block. "The command succeeded" and "the command did the right thing" come apart here.

If light mode ever returns, the shape is already written down: a `[data-theme]` attribute and a
second block of the same names, *not* `prefers-color-scheme`.

---

## 6. Component by component <a id="component-by-component"></a>

**shadcn has a primitive for four things here, and none for the other nine.** Behaviour below was
read from the actual registry sources, not recalled.

### [`src/web/App.tsx`](../../src/web/App.tsx) — the controls bar

- **Replace with:** `ToggleGroup type="multiple"`, controlled by `fit.columns`.
- **Real gain:** these buttons carry no `aria-pressed` today. Radix supplies it, plus roving tabindex.
  Genuine accessibility, not cosmetics.
- **Must override:** the `data-[state=on]:bg-accent` on-state — [Trap A](#the-token-bridge).
- **Blocked without [§ 2](#the-cascade-layer-problem):** `.controls button` outranks every utility on
  the generated component. Do not attempt this before the layering lands.
- **CSS deleted:** `.controls button`, `:hover`, `.on` — ~22 lines. `.controls button.linky` stays:
  `auto` is a link-shaped action, not a toggle.
- **CSS that must stay:** `.controls` itself — sticky positioning, `left: var(--spine-w)`,
  `width: calc(100vw - var(--spine-w))`, `--bar-h`. That class name is read by JavaScript in three
  other files — [§ 8](#what-breaks).

### [`src/web/Masthead.tsx`](../../src/web/Masthead.tsx) — the `▾` disclosure

- **Replace with:** `Collapsible`, controlled by `?about=`
  ([url-state.md](../project/url-state.md#the-parameters)) — `open={expanded} onOpenChange={onToggle}`,
  or the URL stops being the source of truth.
- **Real gain, corrected:** I first wrote that this buys an animation. It does not. shadcn's
  `collapsible.tsx` is a **pure passthrough** — three functions forwarding props to Radix with a
  `data-slot` added, no `className`, no animation classes at all. What it buys is Radix's
  `aria-controls`/`aria-expanded` wiring, `hidden` management, and
  `--radix-collapsible-content-height` *if* we later animate. Smaller than it first appears. Worth
  doing as the safest first swap; not worth doing for the animation.
- **CSS deleted:** none. `.disclose`, `.chevron`, `.about` all stay.

### [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) — **not** a shadcn Dialog

The name misleads. This is a pinned, **modeless** panel. shadcn's `Dialog` and `Sheet` are modal
Radix dialogs: focus trap, scroll lock, and **the document underneath made inert**.

Each breaks something specific:

- The point of the feature is asking several questions and **reading on while they run** — Greg,
  2026-08-25, *"kick off multiple selection-searches at the same time"*
  ([comments.md § Several at once](../project/comments.md#several-at-once)). An inert document and a
  scroll lock make that impossible.
- The "dodging" behaviour listens for `pointerdown` inside `td.text .prose` and fades to 10% so the
  reader can drag out the next selection *underneath it*. An overlay swallows that pointerdown; a
  focus trap fights the selection.
- It was chosen as a dialog precisely so it would touch nothing —
  [comments.md § Decision: a dialog, not a column](../project/comments.md#decision-a-dialog-not-a-column).

`Dialog modal={false}` disables the trap and the lock — at which point you are paying for a portal,
an overlay you switch off and an animation system, to get an `<aside>`, which is what it already is.

- **Recommendation: keep the `<aside>` and `.cmt-dialog`. Restyle the innards only** — header and
  footer buttons to `Button variant="ghost"|"link"`, and the scrolling body to `ScrollArea` **if** we
  want a visible scrollbar on macOS, where the native one hides until you move. That is a real
  problem here; the same reasoning produced the `.reader:has(table.zoom.overflowing)::after` fade.
- **CSS deleted:** `.cmt-close`, `.cmt-nav button`, `.cmt-dialog button.linky` — ~30 lines.
- **CSS that must stay:** `.cmt-dialog` positioning and `z-index: 70`, deliberately between the spine
  (45) and the tooltip layer (80), with a comment recording that 90 was tried and was wrong.

### [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx)

See [§ 7](#the-floating-ui-question). Leave it alone.

### [`src/web/Spine.tsx`](../../src/web/Spine.tsx) — nothing to replace

`position: fixed`, `overflow: hidden`, bands absolutely positioned in **percentages of the measured
document height** ([granularity-zoom.md](../project/granularity-zoom.md#the-spine-a-birds-eye-rail)).
No shadcn primitive covers this; `Sidebar` is a collapsible nav shell and would fight both the fixed
positioning and the measurement. The ~135 lines of `.spine*` CSS stay, and most of the geometry is
inline `style={{ top, height }}` computed at runtime, so it could not become classes even in
principle.

### [`src/web/TableView.tsx`](../../src/web/TableView.tsx) — nothing to replace, and one hard "never"

**Never use shadcn's `Table` here.** It wraps the table in `relative w-full overflow-x-auto` — which
is precisely the inner overflow container `styles.css:112` says would break everything: *"an inner
overflow-x container would force overflow-y to `auto` too, which would break every vertical sticky
below"*. The page scrolls horizontally on purpose. Beyond that, `table-layout: fixed` with explicit
per-column pixel widths from [`src/web/layout.ts`](../../src/web/layout.ts) and a `<colgroup>` fights
`w-full`, and none of the `rowSpan` geometry, sticky `td.pin-left`, drop-shadow layer or
`@media (max-width: 760px)` rule has an equivalent.

For later: cell classes are built dynamically — `` `depth-${depth}` `` in a class array. **Tailwind's
scanner is a plain text scan and cannot see runtime-assembled names**, so these could not become
utilities without writing all four depths out as literals. Leave them semantic.

### [`src/web/main.tsx`](../../src/web/main.tsx)

Change the CSS import to `./tailwind.css` ([§ 2](#the-cascade-layer-problem)). Add `<TooltipProvider>`
only if the tooltip migrates (don't). No `ThemeProvider` — dark-only. Keep `<LucideProvider>`.

### Score

| Covered by shadcn | Not covered — bespoke, stays |
|---|---|
| ToggleGroup (controls bar) | the spine rail |
| Collapsible (masthead ▾) | the granularity table and its `rowSpan` geometry |
| Button (dialog chrome) | the sticky-bar ladder and its z-index order |
| Separator, ScrollArea (marginal) | reading typography and the 65ch measure |
| | `mark.cmt` and the annotation layer |
| | the arc column, gist cells, column tints |
| | the modeless comment panel shell |

---

## 7. The Floating UI question <a id="the-floating-ui-question"></a>

**Recommendation: keep `@floating-ui/react` and [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx).
Frame this as *narrowing* [tooltips.md](../project/tooltips.md), not reversing it.**

That doc rejected Radix's tooltip for two reasons. One expires here; one stands and decides it.

**Expires:** *"it brings a `Provider` + `Portal` + `asChild` component convention this repo uses
nowhere else."* Adopt ToggleGroup and Collapsible and the repo uses that convention in two other
places, with `radix-ui` already installed. That argument is spent, and the doc should say so.

**Stands — the grouping.**
[tooltips.md § Grouping](../project/tooltips.md#grouping-and-why-the-delays-are-what-they-are): once
one band's tooltip is open, neighbours open instantly **and the fade drops to zero** while the
pointer keeps moving, because a fade reads as lag when the panel tracks the pointer down a fifty-band
rail. That is `useDelayGroup`'s `isInstantPhase` feeding `useTransitionStyles` (`Tooltip.tsx`
106–124), tuned to 240ms warm / instant neighbour / 90ms close / 400ms warm timeout.

Radix's `Tooltip.Provider` has `delayDuration` and `skipDelayDuration` — the *timing* half. It has no
equivalent of `isInstantPhase`: Radix animates from `data-state` attributes in CSS, which do not
distinguish "opening cold" from "opening warm". Radix could probably reach parity with enough custom
CSS, but it buys nothing visible and means **re-proving a tuned interaction that already works** —
and the spine is the one surface where the tooltip *is* the feature.

Two further costs, verified from the registry source:

- shadcn's `tooltip.tsx` is styled `bg-foreground text-background … px-3 py-1.5 text-xs w-fit
  text-balance` — a deliberately **inverted one-liner**. Ours is a raised dark card carrying crumb,
  title, gist, sub-section list and footer. Migrating `BandCard` into it means overriding essentially
  every class it ships, which is the "styling someone else's structure to look like ours" that
  tooltips.md rejected.
- It is the **only** component in our shortlist needing `tw-animate-css` — verified: `button`,
  `toggle`, `toggle-group`, `collapsible` and `scroll-area` use no `animate-in`/`fade-in`/`zoom-in`
  classes at all. One extra dependency bought solely for this swap.

The four load-bearing traps from
[tooltips.md § Four things](../project/tooltips.md#four-things-that-are-load-bearing), against Radix:

| | Floating UI | Radix |
|---|---|---|
| 1. Two elements — position and animation cannot share one `transform` | ours to get right, and we do | handled internally. **Radix wins.** |
| 2. Portal out of the `overflow: hidden` rail | `<FloatingPortal>` | `<Tooltip.Portal>`. Equal. |
| 3. `FloatingArrow`'s `fill`/`stroke` are props; a CSS rule silently draws a seam | a real trap, documented | a plain rotated div with `bg-*`. **Radix wins** — trap gone. |
| 4. Tooltip is `aria-describedby`, so the band still needs its own `aria-label` | true | equally true. |

Radix is modestly better on two of four and materially worse on the interaction the rail was designed
around. No dependency-count win either: `@radix-ui/react-tooltip` sits on `@floating-ui/dom` anyway.

**If Greg wants it regardless** — "one component library, no exceptions" is defensible — do it last,
alone, and accept the scrub feel degrading. The risk is not correctness; it is that the spine stops
feeling like one surface, which is invisible in a screenshot and obvious in use.

---

## 8. What breaks <a id="what-breaks"></a>

Tailwind class churn is cheap. **DOM structure and class-name changes are not**, because seven files
read the DOM by selector.

| Selector | Read by | What happens if it changes |
|---|---|---|
| `.controls` | [`scroll.ts`](../../src/web/scroll.ts) `stickyOffset()` | Returns 0. Every deep link, `?at=` update and arrow-key jump lands **under** the sticky bar. `scrollY` confirms the scroll happened — the exact failure `stickyOffset` exists to prevent. |
| `thead th` | same | same |
| `tr[data-block="…"]` | [`scroll.ts`](../../src/web/scroll.ts), [`App.tsx`](../../src/web/App.tsx), [`Spine.tsx`](../../src/web/Spine.tsx) `measure()`, [`keynav.ts`](../../src/web/keynav.ts) | Spine renders empty, position tracking stops, arrows do nothing. |
| `td.text .prose` | [`selection.ts`](../../src/web/selection.ts) `proseOf()`, [`CommentDialog.tsx`](../../src/web/CommentDialog.tsx) dodge handler | Selecting a passage stops producing a comment; the dialog stops getting out of the way. |
| `[data-nav-depth]` | [`keynav.ts`](../../src/web/keynav.ts) via `closest()` | Arrows fall back to section depth — they still *work*, so nothing looks broken, and the pointer-aimed stride quietly stops existing. [keyboard.md](../project/keyboard.md#what-each-zone-means). |
| `mark.cmt[data-comment]` | [`TableView.tsx`](../../src/web/TableView.tsx) `onMouseUp` | Clicking a mark stops reopening its comment. |

**Rule: never delete a semantic class name, even when its rules move to utilities.** If `.controls`
becomes a Tailwind-styled flex row, keep `className="controls tw:flex …"`.

### `mark.cmt` cannot be Tailwind at all

[`src/web/annotate.ts`](../../src/web/annotate.ts) builds `<mark class="cmt">` as an **HTML string**
injected with `dangerouslySetInnerHTML`, and the styling uses `mark.cmt[data-open]` and
`mark.cmt[data-mark-end]::after` — attribute and pseudo-element selectors on generated markup. Leave
it as CSS, and likewise `.facts span + span::before`, `.tip-kids li::before`, `td.gist .title::before`.

### Sticky positioning

[`css-sticky-containing-block.md`](../reusable/css-sticky-containing-block.md) describes a bug this
repo already shipped once. The fix is the inline `minWidth` [`App.tsx`](../../src/web/App.tsx) sets
on `.reader` from `fit.minWidth`. Two ways to re-break it:

1. **A new wrapper element** between `.reader` and `.controls` becomes a new containing block. Radix
   *providers* render no DOM and are safe; *portals* move content to `<body>` and are safe. Anything
   rendering a wrapper `<div>` around the bars is not.
2. **Replacing the inline `minWidth` with a class.** It is a runtime pixel number. It stays inline.

The doc's [second silent failure](../reusable/css-sticky-containing-block.md#a-second-silent-failure-cancelling-position-cancels-both-axes)
also applies: the `@media (max-width: 760px)` rule uses `left: auto` and **must not** become
`position: static`, or the table head stops pinning vertically on exactly the narrow screens that can
least afford it. `tw:max-sm:static` is the obvious and wrong translation.

### Measurement, and z-index

- [`src/web/layout.ts`](../../src/web/layout.ts) hardcodes `SPINE_FULL = 208` / `SPINE_NARROW = 24`
  with the comment *"Mirrors `--spine-w` in styles.css; change both together."* If the spine's width
  becomes a utility, that mirror is three places, not two.
- [`src/web/Spine.tsx`](../../src/web/Spine.tsx) measures in `requestAnimationFrame` under a
  `ResizeObserver` on `document.body`. Anything changing rendered row heights changes the rail —
  another reason to skip preflight, which would change every row height at once.
- shadcn's portalled content ships `z-50` hardcoded in its class string, which lands *underneath* the
  comment dialog (70). Anything portalled needs an explicit z-index from us.

---

## 9. Tests and checks <a id="tests-and-checks"></a>

**No test renders a React component.** [testing.md](../project/testing.md#what-we-test-and-what-we-dont)
says so: *"The React reading view. No DOM tests yet."*

**So the suite catches none of this** — not the `.outline` collision, not the cascade-layer failure,
not a lost class name. Both of the headline bugs in this plan produce *valid CSS that renders*.
Verification is by hand, in a browser.

Two tests could go red:

| Test | Risk |
|---|---|
| [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) | Fires on any bad link. It globs `docs/**/*.md`, so **this file is checked**, and globs `src/**/*.{ts,tsx,css}` for bare `foo.md#anchor` refs in comments — generated components contain none. |
| [`tests/layout.test.ts`](../../tests/layout.test.ts) | Only if `SPINE_FULL`, `SPINE_NARROW`, `GIST_MIN`, `GIST_IDEAL` or `PROSE_MIN` change. They should not. |

[`tests/selection.test.ts`](../../tests/selection.test.ts) and
[`tests/annotate.test.ts`](../../tests/annotate.test.ts) run under jsdom against hand-built markup —
they check the *function*, not the *wiring*, and stay green even if `td.text .prose` vanishes from
`TableView.tsx`.

**`npm run typecheck` — expect this one noisy.** [`tsconfig.base.json`](../../tsconfig.base.json)
turns on `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and more.
shadcn's components are not written against that set: their sources use
`React.ComponentProps<typeof Primitive.Root>` spreads (which `exactOptionalPropertyTypes` dislikes)
and plain `import { … } from "radix-ui"` for types (which `verbatimModuleSyntax` flags). Fix the
generated file — it is our code once it lands, which is the whole shadcn model. **Do not relax a
base-config flag to make generated code compile**; each earned its place
([typechecking.md](../project/typechecking.md#the-flags-and-why)), and `exactOptionalPropertyTypes`
caught a live bug in `App.tsx`. [`scripts/typecheck.ts`](../../scripts/typecheck.ts) fails if any
project checks zero files, so a misconfigured alias cannot pass silently.

**`npm run lint`.** [`biome.jsonc`](../../biome.jsonc) includes `src/**`, so generated components
**will be linted**. Prefer an `overrides` entry scoped to `src/web/components/ui/**` — the file
already uses that pattern for `tests/layout.test.ts` — over turning a rule off globally. And
[the extension is load-bearing](../project/linting.md#the-file-is-biomejsonc-and-the-extension-is-load-bearing).

**Manual verification, every step** ([browser-testing.md](../project/browser-testing.md)):

- Widths **1600, 1280, 1170, 1000, 860, 736, 700**. 736 is where the pinned columns collide; 1170 is
  where the spine collapses to ticks.
- **`/?text=0` specifically** — outline mode is where the `.outline` collision shows, and it is not
  the default view.
- Scroll, then read the address bar — `?at=` must still update.
- ↑ / ↓ with the pointer over each column, and over the spine.
- Select a passage; then drag a second selection and confirm the dialog dodges.
- Hover the spine, then scrub down it.
- **The spine does not render in a hidden tab** — it measures in `requestAnimationFrame`, which
  Chrome pauses when backgrounded. Check `document.visibilityState` before believing an empty rail.
- **Do not judge colour from a screenshot** — `getComputedStyle(…)` settles it.

---

## 10. Honest assessment <a id="honest-assessment"></a>

**This is "adopting shadcn components", not "switching to shadcn".** Roughly eleven clickable chrome
elements — six in the controls bar, one masthead disclosure, five in the comment dialog — get a
library behind them. Everything that makes this app what it is does not.

**What it genuinely gives us**

- Accessibility we do not have. The granularity toggles have no `aria-pressed`; the disclosure has no
  `aria-controls`. Radix supplies both plus correct keyboard semantics. Real, and work we would
  otherwise never get to.
- A house style for chrome not yet built. If a dropdown, article picker or settings sheet arrives,
  having the primitive there is worth a lot.
- Tailwind itself is a genuine convenience for new UI, independent of shadcn.

**What it costs**

- **Roughly 12% coverage.** The shadcn-replaceable CSS is ~120–150 lines out of 1,212. The other
  ~1,060 — spine, table geometry, sticky ladder, prose measure, annotation marks, arc column, gist
  cells, dialog shell — has no shadcn equivalent and never will. This is not a dashboard; it is a
  bespoke reading instrument.
- **The part shadcn usually helps most with is already done.** The palette came from a shadcn
  project. We have had the benefit for a week without the dependency.
- **Two real hazards, neither visible to any automated check.** The `.outline` collision and the
  cascade-layer failure both produce valid CSS that renders. Together they are ~6 lines of fix, but
  somebody has to know.
- **A `tw:` prefix on every utility, forever**, and hand-prefixing every component the CLI generates.
- **Two ways of styling, permanently.** Utilities for chrome; semantic CSS for everything utilities
  cannot express — dynamic `depth-${n}` classes, injected `mark.cmt` HTML, runtime pixel geometry,
  `::before` decorations, `:has()`, `--highlight-wash`. Nobody will convert the other 1,060 lines.
- Four new direct dependencies, a build-time CSS transform, and a `components.json` to keep honest.
- It is framework churn, and [AGENTS.md](../../AGENTS.md) says not to while the ideas are still
  moving. They *are* — the arc column and the comment dialog both landed today.

**The recommendation:** do steps 1–4. Cheap, reversible, break nothing, and they mean the next piece
of chrome is `npx shadcn add` rather than forty more lines of hand-written CSS. Do 5–8 if the
accessibility gaps bother you, which is a reasonable thing for them to do. Skip 9. Do not go looking
for more of the app to convert — the bespoke parts are bespoke because the product is.

If the underlying want is "the UI should look more finished", this is not what delivers it; a pass
over the existing CSS would. If the want is "stop hand-rolling widgets", the plan is exactly right.

---

## 11. Staged sequence <a id="staged-sequence"></a>

Each step ends with the app running and `npm test && npm run typecheck && npm run lint` green. One
commit per step, naming files explicitly ([AGENTS.md](../../AGENTS.md) — several agents share this
tree).

**Step 1 — Tailwind: prefixed, layered, no preflight.**
Install `tailwindcss` + `@tailwindcss/vite`, add the plugin to
[`vite.config.ts`](../../vite.config.ts) alongside the existing `spideryarn-api` plugin, create
`src/web/tailwind.css` with the four lines from [§ 2](#the-cascade-layer-problem), and point
`main.tsx` at it. `styles.css` is not edited.
*Verify three things, not one:* (a) the app is pixel-identical, (b) **`/?text=0` has no outline round
the table** — the [§ 1](#the-scanner-collision) regression, (c) a temporary `tw:px-4` inside
`.controls` actually changes the padding. Identical-looking is also what total failure looks like, so
(c) is not optional.

**Step 2 — the alias, proved in three runtimes.**
Add `"baseUrl": ".", "paths": { "@/*": ["./*"] }` to
[`src/web/tsconfig.json`](../../src/web/tsconfig.json) — **never** to
[`tsconfig.base.json`](../../tsconfig.base.json), where it would resolve relative to the wrong
directory for `tests/` and the node side. Add `resolve.alias` to
[`vite.config.ts`](../../vite.config.ts) and [`vitest.config.ts`](../../vitest.config.ts) (vitest does
not read the other). Create `src/web/lib/utils.ts` with the standard `cn()` and import it once.
*Verify:* dev server, `npm run typecheck` and `npm test` each resolve it. Three resolvers, three
failure modes.

**Step 3 — the token bridge.**
Add `--popover`, `--popover-foreground`, `--destructive-foreground` to
[`styles/tokens.css`](../../styles/tokens.css); add the `@theme inline` block to `tailwind.css`.
*Verify:* a throwaway `tw:bg-background` resolves to the dark value, then delete it. Rewrite the "no
Tailwind, no shadcn" header comment in `tokens.css` in the same commit.

**Step 4 — `components.json`, and one component, unused.**
Hand-write `components.json` **before** running anything, so the CLI guesses nothing — `"css":
"src/web/tailwind.css"`, aliases `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`,
`iconLibrary: "lucide"`. Then `npx shadcn@latest init` and `add button`. **Diff `tailwind.css` and
`tokens.css` immediately** and revert any palette lines `init` wrote. Prefix the generated component's
class strings with `tw:`. Add the `[data-slot]` resets from [§ 4](#preflight). Fix whatever typecheck
says. Do not use `Button` yet.

> **The `src/components` trap.** `init` defaults to `@/components/ui`, which with our alias lands at
> `src/web/components/ui/` — correct. It must not land at `src/components/ui/`:
> [`tsconfig.json`](../../tsconfig.json) is `"include": ["src"], "exclude": ["src/web"]` with
> `nodenext`, no DOM libs and no `jsx`, so a `.tsx` there fails with confusing errors about JSX and
> `document`. See [typechecking.md](../project/typechecking.md#why-three-and-not-one).

**Step 5 — masthead disclosure → `Collapsible`.** A pure passthrough, so almost nothing can go wrong.
Keep it controlled by `?about=`. *Verify:* `/?about=1` still arrives open; back/forward works.

**Step 6 — controls bar → `ToggleGroup`.** Keep `className="controls …"` on the bar. Override the
`bg-accent` on-state with the highlight wash ([Trap A](#the-token-bridge)). *Verify first* that
`document.querySelector('.controls')` still returns the bar, then that a deep link lands with the row
top clear of the bars — that is `stickyOffset()` still working.

**Step 7 — comment dialog chrome → `Button`, maybe `ScrollArea`.** Keep the `<aside>`, `.cmt-dialog`
and `z-index: 70`. *Verify:* Esc closes, prev/next step in reading order, the dodge fires on a drag
in the prose.

**Step 8 — delete the dead CSS.** Its own commit so the diff is legible: `.controls button*`,
`.cmt-close`, `.cmt-nav button`, `.cmt-dialog button.linky`. ~50 lines. *Verify:* every width in the
browser-testing list.

**Step 9 (optional, recommended against) — the tooltip.** [§ 7](#the-floating-ui-question).

**Step 10 — the docs.** [§ 12](#docs-to-update). Same session, not "later".

Rollback at any step is one `git revert`. Nothing before step 5 changes rendered output.

### Packages — versions verified on the registry, 2026-08-25

| package | version | notes |
|---|---|---|
| `tailwindcss` | **4.3.3** | v3 is on a `v3-lts` dist-tag at 3.4.19 — maintenance, not development |
| `@tailwindcss/vite` | **4.3.3** | peer `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8`; we are on 8.2.2, nothing pinned or forced |
| `radix-ui` | **1.6.7** | **one package, not one per component** — shadcn's `new-york-v4` imports `{ Toggle as TogglePrimitive } from "radix-ui"` |
| `class-variance-authority` | 0.7.1 | needed by `button`, `toggle`, `toggle-group` |
| `clsx` | 2.1.1 | for `cn()` |
| `tailwind-merge` | **3.6.0** | v3 is the Tailwind-v4-aware line; v2 mis-merges v4 class names |
| `tw-animate-css` | 1.4.0 | **not needed** — verified none of our four components uses `animate-in`/`fade-in`/`zoom-in`; only `tooltip` does |
| `lucide-react` | 1.34.0 | **already installed**, with house defaults |
| `shadcn` (CLI) | 4.19.0 | `npx` only, never a dependency |

v4 needs **no `tailwind.config.js` and no PostCSS step** — configuration is CSS-side via `@theme`,
which suits a repo that is deliberately one Vite process and no build cleverness
([architecture.md](../project/architecture.md)).

---

## 12. Docs and comments to update afterwards <a id="docs-to-update"></a>

| File | Change |
|---|---|
| [AGENTS.md](../../AGENTS.md) | A signpost row for `docs/plans/` — this file is currently unlinked, which by the repo's own rule means it may as well not exist. Amend the *"Prefer boring… no framework churn"* bullet to record that shadcn components were adopted deliberately on 2026-08-25. |
| [`styles/tokens.css`](../../styles/tokens.css) **header** | *"no Tailwind, no shadcn, no build step"* becomes false. Rewrite: still plain CSS, still canonical, now *referenced* by `@theme inline`. Extend the `--accent` warning: `tw:bg-accent` utilities now exist and read like "the accent colour", and shadcn's own Toggle uses `--accent` for its on-state. |
| [`src/web/styles.css`](../../src/web/styles.css) **header** | Must say the file is imported into `@layer app` by `src/web/tailwind.css`, and why — otherwise the next person adds a utility and watches it do nothing. |
| [original-version/overview.md § Deliberately not lifted](../project/original-version/overview.md#deliberately-not-lifted) | **The direct reversal.** Move shadcn/Radix/Tailwind into [§ Already lifted](../project/original-version/overview.md#already-lifted-into-this-repo), and say what changed and when. Keep Phosphor where it is. |
| [web-client.md § Where the code is](../project/web-client.md#where-the-code-is) | Rows for `src/web/tailwind.css`, `src/web/components/ui/`, `src/web/lib/utils.ts`, `components.json`. Note `main.tsx` now imports `tailwind.css`, not `styles.css`. |
| [web-client.md § Dark mode](../project/web-client.md#dark-mode) | That `init` writes a light `:root` block we revert every time; the `@theme inline` bridge; `tokens.css` stays canonical. |
| [tooltips.md](../project/tooltips.md) | Record that the choice was revisited on 2026-08-25, that the "no component convention here" argument **expired**, and that it was kept on the grouping behaviour alone. A decision re-affirmed for a *narrower* reason is worth writing down. |
| [icons.md](../project/icons.md) | One line: Lucide was picked partly for being shadcn's default, and that bet paid off — no icon work needed. |
| [typechecking.md § The layout](../project/typechecking.md#the-layout-one-base-of-options-three-projects) | The `@/` alias, why `paths` lives in `src/web/tsconfig.json` and not the base, and the `src/components` trap. |
| [testing.md § What we test](../project/testing.md#what-we-test-and-what-we-dont) | Sharpen the "no DOM tests yet" note: two migration bugs of this size were invisible to the whole suite. The moment to reconsider `@testing-library/react`. |
| [linting.md](../project/linting.md) | The `overrides` entry for generated components, if one is needed. |
| [setup-dev.md](../project/setup-dev.md) | `npx shadcn@latest add <component>` as the way to add UI, **and that its class strings must be `tw:`-prefixed by hand afterwards**, and to diff the CSS. |
| [browser-testing.md](../project/browser-testing.md) | Two new checks: a utility that does nothing means the layer order is wrong, not that Tailwind failed to install; and `/?text=0` is where a scanner collision would show. |
| [../reusable/silent-success.md](../reusable/silent-success.md) | **Two strong new worked examples**, both from this plan and both textbook: a text scanner inventing a class you already use, and unlayered CSS silently outranking layered utilities. Valid CSS, correct install, class present in the DOM, every natural check agreeing with the bug. |

## What actually happened <a id="what-actually-happened"></a>

*Added 2026-08-25, after the work landed. The plan above is left as written; this section says
where it was wrong, because that is the part worth reading twice.*

**Steps 1–6 landed first.** Steps 7 and 8 were deferred that day — not for technical reasons, but
because `CommentDialog.tsx` had ~150 uncommitted lines and `styles.css` ~94 from other agents
working this tree, and a second clobber in one day was not worth it. Both were resolved once those
agents committed:

- **Step 8 was done.** `.controls button`, `:hover` and `.on` are gone, after `.linky` was given a
  complete standalone rule — see [web-client.md § How the migration
  finished](../project/web-client.md#how-the-migration-finished).
- **Step 7 was dropped on purpose, and should stay dropped.** § 11 listed it as work; it is
  negative value. `Button` is not Radix — no state machine, no ARIA to inherit — and every variant
  that fits is wrong in the details, so the conversion is "adopt a component, then write a longer
  class string undoing it". This is the plan's largest single error of judgement: it assumed that
  because `Toggle` paid off on the pills, `Button` would pay off on the dialog. `Toggle` paid off
  because it brought `aria-pressed`. `Button` brings a class string.

### Where the plan was wrong

| The plan said | What happened |
|---|---|
| Generated components arrive unprefixed; find-and-replace each one | `"prefix": "tw"` in `components.json` is enough — the CLI prefixes them itself |
| Watch out for the `src/components` trap | The CLI cannot resolve `@/` at all here (it reads the ROOT tsconfig, our `paths` are in `src/web/`), so it writes a literal `./@/` directory that must be moved by hand |
| Add `"baseUrl": "."` | TypeScript 7 has **removed** `baseUrl` (TS5102). `paths` resolves relative to its own config |
| Use `ToggleGroup` for the controls bar | Rejected. Radix's roving focus binds all four arrow keys; ↑/↓ belong to the article and ←/→ to panning the table. Individual `Toggle`s give the same `aria-pressed` and leave the keys alone |
| Three guards: prefix, layer, no preflight | **Four.** v4 auto-detects sources from the project root, so it scanned `docs/` and compiled the `tw:` examples in *this document's prose* into the production bundle. `source(none)` + an explicit `@source` |

### Two bugs the plan never saw

- **`dark:` was dead.** Tailwind compiles it to `@media (prefers-color-scheme: dark)`; this app is
  dark unconditionally with no media query. On a **light-mode OS** every shadcn `dark:` rule would
  have failed and components would have rendered their light branch on a dark page. The failure
  depended on the OS setting of whoever *viewed* it. `@custom-variant dark (&)`.
- **A layer used but never named is appended after every named one.** The mini-preflight went into
  `@layer components`, absent from `@layer theme, base, app, utilities`, so it outranked the app
  stylesheet *and* the utilities: every pill lost its border and
  `button[data-slot] { background-color: transparent }` beat the orange on-state — the exact signal
  [Trap A](#the-token-bridge) had just been written to protect. Moved to `@layer base`.

  The second one is the lesson of the whole exercise. Both checks run beforehand — *is the utility
  emitted?* and *does twMerge keep ours?* — **passed**, because both ask about the stylesheet and the
  bug was in the cascade. Only `getComputedStyle` on the rendered page disagreed.

### A third bug, found later, and the worst of them

**The migration took the focus ring away from keyboard users.** shadcn's components suppress the
browser's own ring with `outline-none` so they can draw their own at `focus-visible:ring-ring/50`.
With shadcn's stock dark `--ring` that ring measures **1.84:1** against this page — under the 3:1
WCAG 2.2 asks of a focus indicator, and against the **11.4:1** of the native ring it replaced.

It survived every check in "How it was verified" below, and would survive them again. The
screenshots were byte-identical because a focus ring is not in a screenshot unless something has
focus. The computed-style probes matched because they read colour, border and rect, none of which
change. It is only visible if you press Tab and then measure the *contrast* of what appears.

Two related things came out of the same look:

- `focus-visible:border-ring` had focus repaint the pill's border — and on these pills the border
  colour **is** the on/off signal, so tabbing across the bar made the columns appear to switch
  themselves on.
- `.cmt-delete:hover` (0-2-0) had been losing to `.cmt-dialog button.linky:hover` (0-3-1) since long
  before any of this, so the one button in the comment panel that destroys something hovered the
  same friendly orange as Retry.

The fixes and the reasoning are in [web-client.md § The focus
ring](../project/web-client.md#the-focus-ring-which-the-migration-quietly-broke) and in
[tokens.css](../../styles/tokens.css). The general shape is
[silent-success.md](../reusable/silent-success.md), which this is now the eleventh entry in.

### How it was verified

Screenshots and computed values before and after, at 1000×900, in a real Chrome. The result: `/`,
`/?text=0` and `/?cols=0,1,2,3&text=1` are **byte-identical** to their baselines (matching md5), every
rect matches to two decimal places, and the `L0` pill matches its baseline width and height to six.
The arrow keys were checked with event logging: ↑/↓ reach the app with `defaultPrevented: true` and
focus never moves between pills; ←/→ pan with `defaultPrevented: false`. Full account, including
seven things that could **not** be verified because the tab was `hidden` throughout, in the
verification notes kept alongside the baseline capture.

---

## See also

- [web-client.md](../project/web-client.md) — the view being migrated, and its constraints
- [design-css-overview.md](../project/design-css-overview.md) — the short map this plan is the long version of
- [original-version/overview.md](../project/original-version/overview.md) — where the tokens came from, and the decision being reversed
- [tooltips.md](../project/tooltips.md) — the Floating-UI-over-Radix choice this narrows
- [icons.md](../project/icons.md) — Lucide, chosen for shadcn compatibility before we had shadcn
- [typechecking.md](../project/typechecking.md), [testing.md](../project/testing.md), [linting.md](../project/linting.md) — the three checks every step must pass
- [../reusable/css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md) — the sticky bug this can re-introduce
- [../reusable/silent-success.md](../reusable/silent-success.md) — the shape of nearly every risk above
- [../reusable/third-party-library-selection.md](../reusable/third-party-library-selection.md) — the process the tooltip and icon decisions followed
- [vision.md § Principles](../project/vision.md#principles) — none of this changes what the view is for
