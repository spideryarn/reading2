You are reviewing a plan, read-only, in the repo at the current directory (a git worktree of Spideryarn).

Read, in this order:
1. docs/plans/261001a-article-markup-keeps-only-what-we-allow-of-data-attributes-and-classes.md — the plan under review.
2. src/sanitize-policy.ts — the policy being changed (the whole file, including its version history).
3. src/reserved.ts, src/sanitize.ts, src/web/sanitize.ts, src/web/maths.ts (the Temml render + re-sanitise), src/maths-tex.ts (TEMML_OPTIONS, trust:false).
4. docs/plans/260930f-cross-reference-links-code-review-2-sol.md (finding D3, the P0 this closes) and src/web/BlockLinkCard.tsx, src/web/xref.ts.
5. data/survey-5z.mjs — the read-only production survey the plan's evidence comes from. Its output (production, Target aws-0-eu-west-2.pooler.supabase.com:6543): 101,526 blocks; class tokens in the whole corpus: only `pdf-uncertain` (123); data-* names: data-track, data-track-action, data-track-label, data-track-value, data-track-item_id, data-test, data-counter, data-doi, data-spya-pdf-figure, data-link-icon, data-link-icon-type, data-url-iframe, data-ga-action, data-url-original, data-url-archive, data-link-icon-color, data-spya-note-back, data-spya-note, data-spya-note-ref, data-note, data-component-name, data-attrs, data-supp-info-image, data-track-context, data-href-mobile, data-no, data-state, data-aspect-ratio, data-image-width, data-image-height, data-crossmark, data-track-external; forged client markings (attr): 0 rows; (class): 0 rows; controls with the same pattern shapes: 1563 and 123 rows.

The job: Greg approved closing the *class* of bug where an imported article's own markup carries our internal markings (data-block-link etc.), preferring a general, robust rule over extending a denylist. The plan turns both the data-* and class handling into allowlists (ALLOW_DATA_ATTR:false + a declared list; class tokens kept only if declared, with Temml's vocabulary allowed on MathML elements only).

Please check, adversarially, and say concretely:
- Does the allowlist break anything real? Hunt for any code path that reads a data-* attribute or class from article/block HTML *after* a sanitise (server stage 3 onward, the store read seam, citations, notes, callouts, figures/assets/rehost, maths, export, public reader, the reading view) that the plan's lists do not cover. Grep; do not trust the plan's list.
- DOMPurify semantics: does ALLOW_DATA_ATTR:false + ADD_ATTR behave as the plan assumes, in both the jsdom and browser bindings, for HTML, SVG and MathML? Does the class hook see namespace reliably (MathML element detection in jsdom vs Chrome)? Any idempotency trap (the file has a history of two-pass churn)?
- Is the Temml-on-MathML-only carve-out sound? Can author TeX or stored MathML smuggle an app class through it? Is pinning TEMML_CLASSES to Temml-Local.css right?
- Is the completeness test (scan src/web for data-* literals and our CSS class selectors, assert each is stripped) actually able to go red for a newly-added marking, or does it answer a weaker question? Suggest a sharper version if so.
- Is the "no production re-sanitising needed" conclusion right (sanitise-on-read in pg.ts, public-reader.ts and the browser)? Any consumer that reads stored revision_blocks.html without passing through a sanitise?
- Anything simpler that is equally general.

Output: numbered findings, each with severity (P0–P3), the evidence (file:line), and the fix you recommend. Then a one-line verdict. Do not edit any file.
