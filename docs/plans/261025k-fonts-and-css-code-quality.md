# Fonts and CSS code quality: one email frame, voices in a layer, Sketch measured in its face, one name for the app's face

Up: [fonts.md](../project/fonts.md) · [design-css-overview.md](../project/design-css-overview.md) ·
[email.md](../project/email.md)

Asked by Greg on 2026-10-25, passed on by session reading2-c6, whose "one monospace" commit
(`4c4b39d13`: one `--font-mono` for all code and block ids, the wordmark in the system sans in
email too) and Shantell Sans for the reader (`f45464d06`) this builds on. Both are in this plan's
base. (The two-hour check for them reported "not landed": they were committed at 18:46 and reached
origin/dev after the check stopped.) Four items, four commits.

GPT Sol reviewed this plan on 2026-10-25
([…-plan-review-sol.md](261025k-fonts-and-css-code-quality-plan-review-sol.md)): five P1s and
three P2s, all taken; each is marked ⟨Fn⟩ where it changed the plan.

## 1. The email frame has one source

**Now.** The same HTML frame (doctype and head, the outer tables, the spider-and-wordmark row, the
footer row) is written out three times: `giftHtml` in `src/store/pg-voucher-emails.ts`, and
`supabase/templates/confirmation.html` and `recovery.html`. They are identical today; `4c4b39d13`
had to change the Georgia wordmark in all three by hand, which is the point. Nothing tied them
together, so the next change could reach two of three. ⟨F7⟩

**Do.** A new `src/email-frame.ts` holds the frame as exported strings: `emailHead(title)`,
`EMAIL_BODY_OPEN` (through the wordmark row), `EMAIL_FOOTER_ROW` and `EMAIL_BODY_CLOSE`, built
from `PUBLIC_ORIGIN`. `giftHtml` uses them. The two Supabase templates stay hand-written files,
because GoTrue reads them from disk (`content_path`) and the production writer sends them as they
are. A test (`tests/email-frame.test.ts`) asserts each template is exactly
`<its own leading comment> + emailHead(<its title>) + EMAIL_BODY_OPEN + <its own rows> +
EMAIL_FOOTER_ROW + EMAIL_BODY_CLOSE`. The comment at the top of each template is its own, and is
kept ⟨F1⟩. So changing the frame in one place fails until the others match. Red first: the test
against a template with one character of the frame changed.

**Passed over: generating the templates** from TypeScript with a script and a staleness test. It
removes hand-editing but adds a build step that has to run before `supabase start` and before
`supabase-auth-config.ts templates`, for two files that change once a month. Checked is fewer
moving parts.

This commit is byte for byte: every email renders exactly as before. (The wordmark's face was
settled by `4c4b39d13`; it stays orange, as that commit left it.)

## 2. Voices in their own cascade layer

**Now.** `src/web/styles/voices.css` is five `:root :is(…)` rules in `@layer app`. An `:is()`
carries the specificity of its most specific argument. So the model's list weighs (0,4,1) because
`.chat-turn.model :is(.fmt-code, .fmt-pre code)` is in it, and that entry is there partly so the
code rule after it ties. Every voice rule is therefore heavier than almost any component rule, by
accident of which selectors happen to be in it. The two `.passage-whole` resets are written
`:root .x .passage-whole` for the same reason, and fonts.md has to warn that `.voice-author` loses
to `.tip-gist` on one element.

**Do.** A new top-level layer, `voices`, declared between `app` and `utilities` in
`tailwind.css`. The file moves to `src/web/voices.css`, beside `button-tone.css`, and is imported
there as `layer(voices)` (as `button-tone.css` is into `tone`), no longer from `styles.css`. That
keeps "everything under `src/web/styles/` is `app`" true ⟨F4⟩. Inside, every rule is `:where(…)`,
specificity zero, so **source order inside the file decides and nothing else does**: author,
model, code, reader, placeholders, `.voice-ui`. The `.voice-*` classes stay in their lists, and
the rule that one never shares an element with a listed class stays too ⟨F6⟩.

The two "Whole paragraph" resets stay where they are. They set a face on a descendant, which beats
an inherited voice in any layer (Sol checked). All they lose is the `:root` they no longer need.

A layer later than `app` beats every component rule whatever its specificity, which is what the
lists were reaching for with `:root`. `tw:font-*` utilities still win, being a later layer. Sol
found no app rule that beats a voice rule on the same element today, so nothing should change.

Tests and docs that change with it ⟨F4, F8⟩:

- `tests/styles-entry-is-imports-only.test.ts`: the top-level imports and the layer list.
- `tests/helpers/stylesheets.ts`: `readerSheets()` in the real order, `app → voices → utilities →
  tone`.
- `tests/voices-css.test.ts`: the `:root :is` rule becomes `:where`.
- fonts.md, design-css-overview.md, web-client.md, and the headers of `tailwind.css` and
  `styles.css`. These only make the docs match the code. The mechanism paragraph in fonts.md
  describes the code rather than setting a rule, so it is covered too.

**Proof that nothing renders differently.** A Playwright script (`cap-fonts.ts`, built by a Sonnet
subagent, kept in the session scratchpad) records `getComputedStyle(el).fontFamily` for every
element, the `::placeholder` of every input, and every `::before`/`::after` that has content. It
covers 31 page states: signed-out and signed-in pages, and two articles with every mode opened. It
runs before and after, and the diff must be empty. Two runs on unchanged code diff clean.

**Passed over: flattening in place** (`:where()` inside `@layer app`, with `:root` dropped). Zero
specificity in `app` would lose to every component rule that sets a face, the opposite of now.

## 3. Sketch's labels measured in the face they are drawn in

**Now.** `wrap`, `charsThatFit` and `layoutNodeText` in `src/sketch-scene.ts` assume Geist at
`CHAR_W = 0.53` em a character. The same functions decide `nodeFits`, which the pipeline counts as
`overflowing` and tells the model about when it revises a sketch (`src/sketch.ts`). So the measure
has to be the same number on the server and in the browser, and cannot be read from the browser at
paint time. That is why the labels stay in Geist although they are the model's words.

**Measured** (napi canvas, the self-hosted woff2s, one 98-character English sample): Geist 0.453 em
a character, iA Writer Quattro 0.530, a ratio of 1.17. `CHAR_W` 0.53 is Geist plus a 17% margin.

**Do.** One constant, `SKETCH_LABEL_VOICE`, and a table of per-voice widths, `CHAR_W_BY_VOICE`.
The `ui` entry is exactly 0.53, so this commit moves no boundary. `CHAR_W` is the table's entry for
that voice. The browser painter, the server's scoring, and the offline exporter
`evals/sketch/svg.ts` (which hard-codes Geist and 0.53 twice today) all read it ⟨F2⟩.

A test measures each face's real average width from its woff2 with @napi-rs/canvas, at the weights
the SVG draws (400, 500, 600). It asserts every entry is the measured width times **one** named
margin, within a tolerance, so a stale number that is too large fails as well as one too small
⟨F3⟩. It also checks that the face it measured is the one tokens.css names for that voice.

The painter puts `voiceClass(SKETCH_LABEL_VOICE)` on the `<svg>`, so voices.css sets the face from
the same constant. It stays `"ui"` (Geist): nothing renders differently in this commit.

**Switching it to `"ai"` is a product question**, because it changes existing pictures. Measured
on production's 170 stored sketches (read only, 2026-10-25), with `nodeFits` at the Quattro width
with Geist's margin (0.62):

- node labels cut to fit go from 49 of 4,636 to 197;
- sketches with at least one cut label go from 27 to 68.

New sketches would adapt, since the model is told which labels overflow. Old ones would not until
they are redrawn. Asked as [q-ugekcv](../user-feedback/questions/q-ugekcv.md); the switch is then
a one-word change.

**Passed over: measuring in the browser** (`canvas.measureText` at paint time). Exact, but the
pipeline scores `overflowing` on the server and feeds it back to the model, so the server and the
painter would disagree about what fits. That is the bug `layoutNodeText` was written to end.

## 4. One name for the app's face ⟨F5⟩

**Now.** `--font-sans` is the Geist stack, and `--font-reading`, `--font-ui` and `--font-brand`
are each `var(--font-sans)`. Tailwind adds `--font-prose` and `--font-serif` (both
`var(--font-reading)`). That is five names for one face, and three of them now say something false:

- `--font-brand` was kept so the wordmark could have a face of its own again. Greg settled that the
  other way on 2026-10-25: the wordmark is the UI face (`4c4b39d13`).
- `--font-reading` is "the base reading stack before a voice override", and `tw:font-prose` "the
  face the article is set in". The article has been set in `--font-author` since 2026-10-02. What
  is left in Geist is, by fonts.md's rule, the app's own voice. Its 30 uses are page headings,
  boxes and wrappers whose visible words are either voiced by voices.css or ours.
- `--font-serif` is a transitional alias whose own comment says to delete it once nothing uses
  `tw:font-serif`. Nothing does.

**Do.** One token, `--font-ui`, defined as the stack in tokens.css.

- `--font-sans`, `--font-reading` and `--font-brand` go from tokens.css.
- Every `var(--font-reading)` and `var(--font-brand)` becomes `var(--font-ui)`.
- `--font-prose` and `--font-serif` go from tailwind.css, and every `tw:font-prose` becomes
  `tw:font-sans`, which is `--font-ui`.

Nothing renders differently, and the same capture as item 2 shows it. A rename sweep (subagent)
covers the docs, /design's token table and the tests that name the old tokens. Plans are history,
and keep the old names.

**Passed over: keeping `--font-reading`** for the day the article's fallback should differ from the
chrome. That day already came and went: it is `--font-author`. Nobody can give the name a
different value without breaking fonts.md's rule, so it only misleads.

## Order

1, 3, 2, 4 by ease and value. Each is its own commit, with a code review by Sol before pushing.
