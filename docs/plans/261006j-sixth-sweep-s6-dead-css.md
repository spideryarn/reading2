# Sixth sweep, S6: CSS for classes nothing emits, and tokens nothing reads

Cluster S6 of [the sixth codebase sweep](261006j-sixth-codebase-sweep-umbrella.md). It deletes
style rules for seven class names that no code writes onto an element, and six custom properties
that no rule or script reads. Nothing a reader sees should change, and the built stylesheet is the
proof. Built 2026-10-06.

## What landed

Eight stylesheets, 62 lines out, 11 in (the 11 are three shortened selector lists and one rewritten
comment).

### Seven classes, all dead

For each name, three searches, all on today's tree:

1. **The bare name** (`cite-note`, no dot) across `src/`, `tools/`, `scripts/`, `tests/`, `evals/`,
   `docs/`, `public/`, `infra/`, `index.html`, `package.json`.
2. **Its prefix being assembled**: `<prefix>${`, `<prefix>" +`, `<prefix>' +` in every
   `.ts`/`.tsx`/`.js`/`.mjs`/`.html` under `src tools scripts tests evals`, for `cite-`, `sk-`,
   `skim-`, `skim-place-`, `srch-`, `tip-soon-`, `cmt-`.
3. **Arriving in HTML we render**: `src/sanitize-policy.ts` keeps exactly one class on article
   markup, `pdf-uncertain` (`ARTICLE_CLASSES`), plus Temml's on MathML. None of the seven is in
   either list, so neither an article nor a model can bring one in.

| class | file | hits outside its own CSS (search 1) | assembled (search 2) | what went |
|---|---|---|---:|---|
| `.cite-note` | `citations.css` | 0 | 0 | one rule |
| `.sk-crumb` | `diagram-sketch.css` | 0 in code; 12 lines in three old review diffs under `docs/plans/` | 0 | the selector, from three lists shared with `.sk-up` and `.sk-zoom`, which stay |
| `.skim-place-repeat` | `skim.css` | 0 | 0 | one rule |
| `.srch-retry` | `search.css` | 0 | 0 | the rule and its `:hover` |
| `.tip-soon-flag` | `dock.css` | 0 | 0 | one rule |
| `.tip-soon-learned` | `dock.css` | 0 in code; 3 lines in one old review prompt under `docs/plans/` | 0 | the selector, from a list shared with `.tip-soon-tap`, which stays |
| `.cmt-transport-error` | `annotations.css` | 1, a comment in `tests/a-failed-comment-write-is-said-on-the-dock.test.tsx` saying the chip is gone | 0 | one rule |

`.tip-soon-tap` is live (`Tooltip.tsx`, `CitationsPanel.tsx`) and keeps its rule unchanged. The
comment above it described two footers; it now describes one and says when the other went. Two
later comments that said "specificity ladder as `.tip-soon-learned` above" now name
`.tip-soon-tap`.

**No test pinned any of the seven rules**, so no test changed. The one test hit is a prose comment
that is still true.

None of the seven sat inside a media query, `:is()`, `:where()` or a nested block.

### Six tokens, all dead

Searched for `--name` and for the bare name across `src/`, `styles/`, `tools/`, `scripts/`,
`tests/`, `index.html`, `components.json`, `vite*.ts`, `public/`, `docs/project/`,
`docs/tutorials/`, `docs/reusable/`; for a token name built at runtime
(`--depth-${`, `"--sidebar-" +` and the like: 0); for a Tailwind alias in `src/web/tailwind.css`
(0 mentions of `sidebar`, `header-height`, `quote-color`, `depth-3`); and for a Tailwind utility
such as `bg-sidebar-accent` in `src/web` and `tools` (0). The two shadcn components
(`button.tsx`, `toggle.tsx`) name none of them. The fleet dashboard under `tools/` names none of
them. The two places that read tokens by name in script (`ViewportProbe.tsx`) read a fixed list
that includes none of them.

| token | defined in | readers | went from |
|---|---|---:|---|
| `--depth-3` | `src/web/styles/tokens.css` | 0 | dark and light |
| `--quote-color` | `styles/tokens.css` | 0 | its one definition, and the two-line comment that was only about it |
| `--header-height` | `styles/tokens.css` | 0 | its one definition |
| `--sidebar-foreground` | `styles/tokens.css` | 0 | dark and light |
| `--sidebar-accent` | `styles/tokens.css` | 0 | dark and light |
| `--sidebar-border` | `styles/tokens.css` | 0 | dark and light |

That is six names; `--depth-3` has two definitions and each `--sidebar-*` has two, so ten
declarations went.

## Kept, and why

- **`--sidebar`** is live: `--panel: var(--sidebar)` in `src/web/styles/tokens.css`, and
  `tests/css-tokens.test.ts`, `tests/appearance-palette.test.ts` and
  `tests/gutter-touch-contrast.test.ts` name it. Both definitions stay.
- **`--quote-rgb`** is live (`spine.css` draws with it). Only its unused alias went.
- **`.sk-up`, `.sk-zoom`, `.tip-soon-tap`**: live, rules kept, only the dead selector left each
  list.
- **`--danger` and `--ink-faintest`**: not touched. Defining either would change a colour a reader
  sees, which is Greg's call.
- **`docs/project/design-css-overview.md`**: not touched (the review, U9).

## Claims that turned out false

- **Where the tokens live.** The brief gave the file set as `src/web/styles/*.css`. Three of the
  four token items (`--header-height`, `--quote-color`, all of `--sidebar-*`) are defined only in
  the root **`styles/tokens.css`**, which `src/web/styles.css` imports first. I edited it, because
  the cluster names those tokens and no other cluster owns the file; say if it should come back
  out.
- **"The `--sidebar-*` family"** is three names, not an open family.
- **Found, not fixed: `--depth-0` has no reader either.** `var(--depth-0` appears nowhere; only
  `--depth-1` (`spine.css`, twice) and `--depth-2` (`tooltip.css`) are read. It was not on the
  list, and two comments use "§ --depth-0" as the name of that section of `tokens.css`
  (`SearchPanel.tsx`, `search.css`), one of them in a `.tsx` this cluster may not edit. Left for a
  decision.
- The umbrella's "a before/after browser look at three modes" was not done; the built-stylesheet
  diff below replaces it, as the brief allows.

## Proof that no pixel moved

Two builds with `vite build --outDir <scratch>`: one with the eight files as they are at `HEAD`,
one with the edits. `main-*.css` went from 355,005 to 353,931 bytes; `Temml-Local-*.css` is
byte-identical. Both `main` files were split onto one line per `{`, `}` and `;` and diffed
(15,053 lines against 15,010). Every differing line is one of:

- the ten token declarations above;
- the rules `.cmt-transport-error`, `.tip-soon-flag`, `.srch-retry`, `.srch-retry:hover`,
  `.cite-note`, `.skim-place-repeat`, whole;
- four selector lists that lost one member and kept their declarations:
  `.tip-soon p.tip-soon-tap`, `.sk-up,.sk-zoom`, and its `:hover` and `:focus-visible` twins.

Nothing else differs. No rule was reordered.

## Gates

- `npm run typecheck`: clean.
- `npm run build`: succeeds.
- The 63 test files that read one of the touched stylesheets as text or through
  `tests/helpers/stylesheets.ts` / `theme-palette.ts`, `tests/css-tokens.test.ts` and
  `tests/appearance-palette.test.ts` among them: 63 passed, 1,165 tests, 9 skipped.
- `npx biome lint` on the eight files: 15 findings (8 `noDuplicateProperties` in
  `annotations.css`, 7 `noDescendingSpecificity`), all in rules this cluster did not touch.
- `npx vitest run tests/doc-links.test.ts`: passes with this file added.
