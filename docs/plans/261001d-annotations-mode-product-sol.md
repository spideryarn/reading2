1. **Make it a mode for v1.** It should select `?mode=annotations`, open no left band, and draw the right column. This fits the current URL and mode machinery and avoids immediately solving two independently optional columns, width allocation, and mode combinations. It still lets Greg meaningfully compare Plain ↔ Annotations. Keep the right-column component separable so it can later become an orthogonal `annotations=1` toggle if use shows that coexistence matters.

2. **Stage 1 should be quieter than proposed. Prioritise:**

   1. **Section Socratic questions** — high value, free, sparse, and they change reading from absorption to inquiry.
   2. **Arc sentence** — high value, free, and strongly supported by the decorated research. Keep it strictly about where the argument is going.
   3. **Existing Ideas** — show a compact “assumes”/“introduces” margin stamp beside each occurrence, opening the proposition and reasoning on hover/press. Do not generate Ideas merely because Annotations was opened.
   4. **Relation words** — valuable, but defer initially.
   5. **Automatic ask-for-help comments** — cut. Spending money and writing into the reader’s data must remain an intentional reader action.

   I would also cut the full breadcrumb initially. The spine and section titles already convey structure; combine the arc with, at most, the current section title. Likewise defer dashed prose underlines: first learn whether the margin treatment is useful without introducing another competing mark inside the article.

3. **Defer relation words until the right-column experiment earns a second stage.** They are probably the best eventual dense annotation, but a new paid pipeline artefact is disproportionate before the surface itself is validated.

   When added, classify every prose paragraph, but visually emphasise only informative turns: **but, so, why, e.g., vs, new**. Render additive continuity as a very faint `+`, rather than repeating “and also” at readable strength or omitting it indistinguishably from missing data.

4. **The design fits the vision if it remains sparse and instrumental.** Questions, arc position, relation words, and assumptions help the reader interrogate or connect the author’s prose. It becomes a replacement when every paragraph receives a generated paraphrase or question—a faster second article down the margin. Use a hard budget: normally no more than one prominent annotation near a block, with everything else subdued or disclosed on demand.

5. **Hide it on narrow windows; do not put annotations inline after blocks.** Inline notes interrupt the author’s sequence, reflow the article, and mix machine and author voices precisely where the design should distinguish them. If Annotations is selected while the column no longer fits, hide the surface and give a brief dock tooltip/state message that it needs a wider window. A later touch design could use an on-demand drawer, but that should not be part of v1.