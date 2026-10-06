**ship**

No P0–P3 findings. No fixes applied; no files changed or committed.

I searched `src/`, `tools/`, `scripts/`, `evals/`, `tests/`, `api/`, `index.html`, `public/`, `styles/` and `docs/tutorials/`.

| Bare-name grep | Matching lines | Assessment |
|---|---:|---|
| `cite-note` | 0 | No emitter found |
| `sk-crumb` | 0 | No emitter found |
| `skim-place-repeat` | 0 | No emitter found |
| `srch-retry` | 0 | No emitter found |
| `tip-soon-flag` | 0 | No emitter found |
| `tip-soon-learned` | 0 | No emitter found |
| `cmt-transport-error` | 1 | Historical comment in a test, no emitter |

The computed-name check also passes. An AST scan parsed **3,379 code files, with zero parse errors**, and found **48 relevant templates**. Their prefixes and substitutions cannot produce the deleted classes: sketch variants remain under `sk-shape-`, `sk-edge-`, `sk-region-` and `sk-label-`; panel templates append fixed state classes. I traced all **five** production `classList.add`/`toggle` sites to unrelated keep, flash and dock-fit classes. Class helpers and suffix tables revealed no additional emitter.

Rendered content provides no missed source: the article allow-list retains only `pdf-uncertain` plus named Temml classes; none of the seven survives it. Temml runs with `trust: false`, markdown renders unsupported HTML as text, and sketch classes come from the structured renderer.

Each deleted token—`--depth-3`, `--quote-color`, `--header-height`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`—has **zero exact-name grep hits** after deletion. Thus no literal CSS reader, nested fallback, script reader, inline style or theme mapping remains. The requested Tailwind utility search returned **zero hits**.

For depth, `rg 'var\(\s*--depth-[0123]'` returns **three lines**: two fixed reads of `--depth-1`, one of `--depth-2`. Computed `--depth-${…}`/concatenation searches return **zero**. The highest requested depth colour is therefore **2**; article tree depth does not select this token family.

Root-token import search returns **three lines**: the two imports in `src/web/styles.css` and one test literal. Marketing and `/design` share that app stylesheet; their consumers request none of the deleted tokens. Fleet loads its own stylesheet. Tutorial stylesheet-link/`@import` grep returns **zero**.

I independently compared all eight stylesheets with the parent commit using PostCSS. Removing only the approved targets produces the candidate exactly, ignoring comments and whitespace: **six whole rules, four shortened selector lists, ten token declarations**. Surviving specificity, declarations and order are unchanged. A deliberate live-declaration mutation failed the comparison.

`--depth-0` is indeed unread: **four hits**, comprising two definitions and two comments; **zero readers**. It remains untouched. `--sidebar` still feeds `--panel`.

Validation: **4 unit test files, 173 tests passed**, covering tokens, appearance, Tailwind resolution and sanitisation. No network or database used. Pixel preservation is reasoned from these checks; no browser comparison was run.