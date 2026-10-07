# Review: UI sweep cluster K1 — a leaking error style, focus marks, an error-text token, six small cascade defects

Echo this nonce on the first line of your answer: **K1-CSS-7Q4M**

Repo: this worktree (`/var/tmp/spideryarn-worktrees/agent-a9363ef371ceb477c`), a branch off `dev`.
TypeScript + ESM, React, hand-written CSS under `src/web/styles/` inside `@layer app`, Tailwind v4
utilities prefixed `tw:` in a later layer. Two themes: a dark `:root` block and a
`:root[data-theme="light"]` block in each of `styles/tokens.css` and `src/web/styles/tokens.css`.
Read `docs/project/design-css-overview.md` § Colour, and `docs/project/controls.md`, for the house
rules.

## The candidate

Committed: commits `74c7ec21b`, `49e5b9ad2`, `3a4d5d745`, in that order, on base `edce9846f`.

    git diff edce9846f...3a4d5d745
    git diff --stat edce9846f...3a4d5d745     # the complete list of changed paths

Plus the one commit after `3a4d5d745` on this branch, which holds evidence and no code:
`docs/plans/261007a-ui-sweep-k1-measure.ts.txt`, `…-measure-lib.ts.txt`,
`…-measure-before.json`, `…-measure-after.json`, this prompt, and a paragraph in the plan doc
that links them.

Start with: `src/web/styles/shell.css` (the `.loading, pre.error` rule), `styles/tokens.css`
(`--danger`, both blocks), `src/web/styles/mode-band.css` and `dock.css` (the two rows),
`src/web/styles/marginalia.css`, `dialogs.css`, `profile.css`, `outline-mode.css`,
`src/web/PageSection.tsx` (focus), and the three tests that changed: `tests/css-tokens.test.ts`,
`tests/appearance-palette.test.ts`, `tests/touch-controls.test.ts`. That is where to begin, not the
limit of scope; the diff is.

## What it is meant to do

The specification is `docs/plans/261007a-ui-sweep-umbrella.md` § K1, K1's line in its File
manifest, and § What the review changed (U1 to U5 are your own plan-review findings). What was
built, measured and left is in `docs/plans/261007a-ui-sweep-k1-css-status-rows-focus-marks.md`.
**Read that doc as a reviewer of its conclusions, not only of the code**: it makes claims about
what a reader sees before and after, and about which of the umbrella's claims were false.

In one paragraph: (1) `shell.css`'s page-level `.loading, .error` rule no longer reaches
`li.chat-tool.error` and `span.dock-question-state.error`; `.loading` keeps it. `--danger` is
defined in both themes as an error-text colour measured at 4.5:1 or better on `--page`, `--panel`
and `--surface-raised`; the failed chat detail is drawn at full opacity and the ordinary detail
keeps its 0.7; `--destructive` is unchanged. `--ink-faintest` and six dead `--destructive`
fallbacks go. (2) Focus marks that could not be seen are recoloured or, for `PageSection`'s
headings, given an outline, each keeping its geometry. (3) Six small cascade defects and three
false comments.

The invariant: **no change alters what a reader sees beyond what the umbrella's K1 section says
and the plan doc records.** No component other than `PageSection.tsx` and one row of
`DesignPage.tsx` is touched. `glossary.css` and `debate.css` belong to another cluster and are not
touched. No new dependency.

## What was measured in a browser

Headless Chrome through Playwright against a dev server from this worktree, both themes, before
and after, at 1440, 820, 600 and 390. The script is `docs/plans/261007a-ui-sweep-k1-measure.ts.txt`
and its raw output is the two JSON files beside it. Headline numbers (all in the plan doc):

- Failed chat row: padding 48px on four sides, Geist Mono 13px, `pre-wrap`, 543 by 114.8px →
  padding 0, Geist 13.28px, `normal`, 543 by 19.3px (an ordinary row's size). Its label goes from
  `--ink-soft` to `--ink-faint`.
- `--danger`: dark `oklch(0.7 0.2 27.325)` 6.65 / 6.19 / 5.22 on page / panel / raised; light
  `oklch(0.52 0.2 27.325)` 5.83 / 5.44 / 6.09. Before, the word was the raw brand orange: 2.6:1 on
  the light page, 1.9:1 at the chat detail's 0.7 opacity.
- Focus, after a real Tab: marginalia and the shut chat card 1.4 to 2.0:1 → 5.7 to 7.3:1;
  `.prof-box-input` and `.outln-row.focused` in light 2.72 and 2.19 → 5.95 and 4.81;
  `PageSection` headings gain a 2px outline at 2px offset that no ancestor clips on /profile or
  Metadata at 1440 or 390.
- A real block-link card at 390: 375px wide (10 to 385) → 362px (10 to 372).
- A field on a touch screen at a 12px root: 12px → 16px.

## What you can and cannot run, and what you may change

You may edit this worktree. **Fix what is inside this cluster, narrowly and red-first** (for a
behaviour or a text-checked rule: the test, seen red, then the fix), **and report, do not fix,
anything wider** (another cluster's files, a component other than the two named, a design
question). Do not commit. List every file you changed at the end.

You have no network, not even loopback, so no browser, no dev server and no database. Run a single
test file with `npx vitest run tests/<one>` or a script with `node --import tsx <script>`. Useful
ones: `tests/css-tokens.test.ts`, `tests/appearance-palette.test.ts`,
`tests/touch-controls.test.ts`, `tests/chat-tool-row-css.test.ts`,
`tests/styles-entry-is-imports-only.test.ts`, `tests/tailwind-utilities-resolve.test.ts`,
`tests/doc-links.test.ts`. `tests/helpers/theme-palette.ts` computes contrast from the token
files, if you want to check a number without a browser. Do not run the whole suite.

## Attack it

Independently, before you read my suspicions below. The invariant to break is the one above:
find a selector, an element, a theme, a width or a pointer type where one of these changes shows a
reader something the plan does not say, or fails to fix what it claims to.

Answer these directly, each with a yes or no and the evidence:

1. **Does any change alter what a reader sees beyond what the plan says?** Walk every changed
   selector. For each specificity change (`pre.error`, `.sk-in-full .sk-scene:not(.on)`,
   `.gloss-btn:not(:disabled):not([aria-disabled="true"]):hover`,
   `.quotes-empty .quotes-hint`, `.chat-tool.error .chat-tool-detail { opacity: 1 }`), name any
   rule elsewhere in the cascade that now wins or loses where it did not.
2. Is the census of bare `error` and `loading` class emitters complete? Is there any other element
   that depended on the `.error` rule (a `<p className="error">`, a class built at run time, a
   third-party widget, a fleet or admin page)?
3. Is `--danger` right as a token: defined in both blocks, held by a test that would go red if a
   value dropped under 4.5:1 on any of the three surfaces, and not a second name for
   `--destructive`? Is `opacity: 1` on the failed detail the right way to exempt it, or does it
   fight another rule (a hover, a `.running` state, `CandidatesPanel`'s use of the same classes)?
4. Is each statement in the plan doc's § What in the umbrella was false accurate?
5. The new check in `tests/css-tokens.test.ts` (no outline in a surface or hairline token): is the
   statement it makes accurate at its true strength, and does it earn its place or is it
   machinery the plan did not ask for?

For each finding give:
  - an ID (`K1-F1`, `K1-F2`, …), a severity, and whether it is established or reasoned
  - (a) what shows it fails its own claim: the input or mutation I can run, or the rule and
    selector that demonstrates it
  - (b) the smallest change that closes it, and whether you made it
A finding with no (a) goes last.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with one line:
`VERDICT: ready` / `ready with these fixes` / `not ready`.

Do not invent a quotation from Greg in any doc or comment you edit.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

- The sentence I would least like to be wrong about: **"the failed chat row now measures exactly
  what an ordinary row measures, and nothing else on the page depended on `.error`."** The row was
  measured on injected markup inside the real Chat band, not on a real failed tool call.
- I extended the `.gloss-btn` hover guard to `aria-disabled="true"`, which the umbrella does not
  name. It changes what Citations' *Investigate* does under a pointer while it is off.
- I fixed a fifth marginalia button (`.marg-shut-button`) the umbrella's "four" did not count.
- `--danger` in Dark is outside sRGB; Chrome clips it to `rgb(255, 96, 85)` and that is what was
  measured. `tests/helpers/theme-palette.ts` clamps in linear light, which may not be the same
  clip. If the test's number and the browser's differ, which is the claim?
- `PageSection`'s heading keeps `tw:focus-visible:text-highlight-text` and adds the outline. Is
  the pair right, and do `tw:focus-visible:outline-2` / `outline-offset-2` /
  `outline-highlight-text` all compile to rules (`tests/tailwind-utilities-resolve.test.ts`)?
- The tooltip cap narrows a real card at 390 from 375px to 362px. The umbrella marked the overflow
  a hypothesis; I measured no off-screen overflow and built the cap anyway, on the ground that the
  card filled the layout's whole width. Is that within the brief ("a finding marked H is not built
  until you have shown it")?
- `max(1rem, 16px)` on fields: any field whose layout was tuned to 12px at a 12px root on touch?
