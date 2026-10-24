- **P2 — The equality guard is broader than the diagnosed fault.** Removing all whitespace proves non-whitespace characters and order are unchanged, but permits arbitrary redistribution: `AB C` and `A BC` compare equal. Build two heading forms instead: `<br class="ltx_break">` deleted and replaced by one space, while normalizing all other whitespace identically. Apply only when `article.title` equals the deleted-break form. This pins the change specifically to LaTeXML’s lost break.

- **P3 — Compare against Readability’s final `article.title`, not `<title>`.** That is the value being replaced. Comparing with `<title>` could undo Readability’s metadata precedence or separator cleanup. Add one regression where Readability strips ` | Site` or chooses `og:title`; the repair must refuse unless the final title differs only at the measured break.

- **P3 — Markup-only gating is acceptable with the tighter guard.** It grants no meaningful capability: the page already controls both strings, and only one measured whitespace boundary can change. Keep the lookup beneath `article.ltx_document`; preferably recognize the measured `br.ltx_break`, not every generic `<br>`.

- **P3 — Cheap adjacent coverage:** consecutive breaks/whitespace around a break collapse to one space; a title with unrelated whitespace redistribution refuses; a note containing a break is removed before break handling; multiple document-title candidates refuse or choose deterministically. The planned maths, footnote, absent-title, and real-page tests cover the important remainder.

The root cause is correct. The post-Readability override is also simpler and safer than mutating `<title>` before parsing, because adding `: ` can itself activate Readability’s colon-title rewriting.

**Verdict: proceed with changes.**