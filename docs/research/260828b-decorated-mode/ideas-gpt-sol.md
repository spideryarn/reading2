## 1. Argument Topography

**What the reader sees.** Important sentences rise slightly—perhaps 19px and weight 560—while connective prose remains at the normal 17px/450. Low-value boilerplate recedes a little in contrast, but never below comfortable reading contrast.

**Why it helps.** It turns typographic variation into a pre-attentive map: the eye finds argumentative peaks without leaving the prose.

**Mechanism.** Sentence-level spans; variable-font `font-weight` and `font-size`; restrained `color`, `letter-spacing`, and `line-height`; smooth reflow through the View Transition API when the lens is toggled.

**Data.** New pass: sentence boundaries, importance, rhetorical role, confidence.

**Risk.** The model effectively becomes an editor. Large differences would tell readers what matters instead of helping them decide.

## 2. Generated Seams

**What the reader sees.** Where an unheaded stretch changes subject, a small orange rule interrupts the margin and a generated 2–6-word heading sits above the next paragraph. It is visibly labelled as Spideryarn’s heading; author headings retain a stronger, different treatment.

**Why it helps.** Long essays become easier to resume and mentally partition without inserting summaries that can substitute for the prose.

**Mechanism.** Insert semantic `<header>` elements between block containers; `position: sticky` while their range is active; `text-wrap: balance`; `scroll-margin-block-start` for navigation.

**Data.** Existing `tree.json`: range, title and `sourceHeading`.

**Risk.** A bad boundary misrepresents the author’s structure. Too many headings make the essay feel machine-chopped.

## 3. The Argument Baton

**What the reader sees.** A narrow sentence in the outer margin says where the current passage sits in the argument. As the reader enters the next range, the old line slides upward and the new one quietly replaces it.

**Why it helps.** It preserves the argumentative state that working memory loses during examples, digressions and long technical sections.

**Mechanism.** Sticky marginal element keyed to block ranges; Intersection Observer fallback; `view-timeline` and `animation-timeline: view()` for scroll-bound handoffs rather than time-based animation. [Scroll-driven timelines tie animation to element visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines).

**Data.** Existing `arc.json`.

**Risk.** Arc sentences are dangerously summary-like. They must remain peripheral, sparse and clearly generated.

## 4. Rhetorical Score

**What the reader sees.** A hairline bracket runs beside each passage, carrying small glyphs for claim, evidence, example, objection, concession, rebuttal and conclusion. A paragraph may visibly move from “objection” to “concession” to “reply.”

**Why it helps.** Readers often understand every sentence but lose track of what the sentences are doing together. The score makes argumentative function inspectable.

**Mechanism.** Absolutely positioned gutter SVG aligned from measured sentence `Range.getClientRects()` geometry; accessible text labels; hover or focus highlights the corresponding sentence.

**Data.** New pass: rhetorical role per sentence, grouped moves, confidence.

**Risk.** Academic-looking symbols can create false authority. Uncertain classifications should be faint or absent, not merely confidently wrong.

## 5. Claim–Evidence Wiring

**What the reader sees.** Hovering a claim draws thin lines into the gutter and down to the exact evidence passages supporting it. Solid lines mean explicit support; dotted ones mean inferred support; arrowheads show direction.

**Why it helps.** It makes “does the evidence actually support this?” a spatially answerable question while keeping both endpoints in their original places.

**Mechanism.** An SVG overlay with paths calculated from block and quote rectangles; `pointer-events: none`; connectors appear only for the active claim. Text fragments can use `::target-text` when sharing a deep link.

**Data.** New pass: claim spans, evidence spans, edge type, explanation and confidence.

**Risk.** A permanently wired page becomes spaghetti. Inferred edges may launder the model’s interpretation as the author’s logic.

## 6. Assumption Understructure

**What the reader sees.** Passages that depend on an unstated proposition carry a broken underline and a tiny “rests on” mark in the gutter. Activating it reveals the idea and, crucially, what local inferential move fails without it.

**Why it helps.** It directs attention to the hidden work an argument asks the reader to perform.

**Mechanism.** CSS Custom Highlight API ranges styled with `::highlight()` so assumption marks can overlap glossary, search and comments without changing the DOM; anchored popovers for explanations. The API styles arbitrary ranges independently of document structure. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API).

**Data.** Existing `ideas.json`.

**Risk.** This is the feature most likely to mistake a model hypothesis for an authorial fact. The language must remain explicitly provisional.

## 7. Dependency Cascade

**What the reader sees.** Clicking an assumed idea lights its occurrences, then paints a faint downstream path through the claims that rely on it. The reader can switch the idea “off” conceptually: dependent passages remain fully visible but receive a cracked side rule.

**Why it helps.** Counterfactual reasoning becomes concrete: the reader sees how much of the argument survives if a premise is rejected.

**Mechanism.** CSS highlight sets plus gutter SVG edges; state in the URL; opacity applies only to decorative rules, never the prose.

**Data.** New pass: idea → claim → conclusion dependency graph, with quote-validated endpoints.

**Risk.** The graph may invent a cleaner deductive structure than the essay actually has.

## 8. Hinge Marks

**What the reader sees.** Words such as “but,” “therefore,” “nevertheless” and “in other words” gain tiny typographic ornaments: a turn, arrow, return or widening wedge in the margin. The connective itself remains unchanged.

**Why it helps.** These small words carry disproportionate structural weight. Marking them makes changes of direction easier to catch during fast reading.

**Mechanism.** Quote-anchored inline spans or Custom Highlights; `::before` gutter glyphs; `text-emphasis` where appropriate; orange used only for the strongest pivots.

**Data.** Cheap deterministic detection plus a model pass classifying the actual relation.

**Risk.** Marking every connective creates punctuation confetti. Many uses are grammatical rather than argumentative.

## 9. Question Debt

**What the reader sees.** When the author raises a question or problem, a fine open bracket begins in the gutter. It closes at the passage where the question is answered—or trails unresolved to the section boundary.

**Why it helps.** It holds open loops in working memory and reveals when a promised answer never arrives.

**Mechanism.** SVG or CSS gradient rails spanning block ranges; hover highlights both endpoints; clicking the bracket moves between them without replacing the prose.

**Data.** New pass: question/problem spans, answer spans, explicit versus inferred relationship, unresolved status.

**Risk.** Essays often answer questions diffusely. A neat closing bracket may imply resolution where there is only discussion.

## 10. Antecedent Tethers

**What the reader sees.** Hovering “this view,” “that possibility,” or an ambiguous “it” draws a curved thread back to the phrase it refers to. On touch, a small anchored card repeats the antecedent verbatim.

**Why it helps.** Long argumentative sentences overload referential memory; recovering an antecedent otherwise requires rereading several lines.

**Mechanism.** Anchor-positioned popovers with `position-area` and `position-try-fallbacks`; SVG curves between quote rectangles. Popovers can be implicitly anchored to their invokers. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using).

**Data.** New coreference pass returning pronoun span, antecedent span and confidence.

**Risk.** Wrong coreference is actively confusing. Only high-confidence, genuinely distant cases should appear.

## 11. First-Use Thresholds

**What the reader sees.** A difficult term’s first meaningful use gets a short margin definition and a stronger underline. Later occurrences use only the ordinary glossary underline; the margin note gradually disappears once the concept is established.

**Why it helps.** It delivers background at the moment the reader first needs it without repeatedly interrupting fluent reading.

**Mechanism.** Existing glossary matching; sticky note bounded to the first occurrence’s paragraph; popover for the full entry; difficulty controls prominence.

**Data.** Existing glossary aliases, difficulty, centrality and occurrences; optionally a pass distinguishing mention from meaningful use.

**Risk.** “First occurrence” is not always the point where explanation is needed. Too many notes turn the margin into a glossary panel.

## 12. Concept Echoes

**What the reader sees.** Activating a term paints small beads down the gutter at all its later occurrences. As one enters the viewport, a faint curved echo points from the current occurrence to the previous one.

**Why it helps.** It reveals how a concept accumulates meaning and lets readers notice callbacks separated by many pages.

**Mechanism.** A masked vertical rail using `mask-image`; block positions measured from the DOM; Custom Highlights for the active occurrence; canvas or SVG for the temporary arc.

**Data.** Existing glossary occurrences, augmented by semantic references that use no alias literally.

**Risk.** Frequent concepts become a solid rail. Semantic recurrence can blur distinct senses of the same word.

## 13. The Number Ledger

**What the reader sees.** Important quantities—dates, percentages, sample sizes and monetary values—remain inline, while compact margin rows align beside them: “estimate,” “comparison,” “result,” or “baseline.” Related numbers share a thin connector.

**Why it helps.** Readers struggle to retain and compare numbers scattered through prose. The ledger preserves their roles without extracting them into a substitute summary.

**Mechanism.** Highlight exact numeric spans; CSS grid in the margin; tabular numerals via `font-variant-numeric`; SVG links for comparisons.

**Data.** New pass: exact numeric quote, unit, role, comparator and relationship. Deterministic validation must confirm every quoted number.

**Risk.** A ledger is highly skimmable and could become a “numbers-only” replacement. It should show relationships only beside the live passage.

## 14. Evidence Texture

**What the reader sees.** The gutter uses different physical textures rather than colours: solid for empirical evidence, dots for citation, diagonal hatching for analogy, and a hollow outline for assertion without offered support.

**Why it helps.** It separates kinds of warrant that readers commonly collapse into “the author gave a reason.”

**Mechanism.** Repeating CSS gradients on narrow side bars; accessible glyph and text labels; hover reveals the classification and exact supporting span.

**Data.** New pass: evidence type, source span, claim supported, explicitness and confidence.

**Risk.** “Unsupported” can mean “supported elsewhere” or “common background.” The texture must not become an automated truth score.

## 15. Certainty Contour

**What the reader sees.** Claims gain subtle underlines reflecting the author’s expressed certainty: straight for categorical, dotted for qualified, wavering for speculative. The actual hedging words—“may,” “perhaps,” “suggests”—receive tiny ticks.

**Why it helps.** Readers frequently remember the proposition but lose its degree of qualification.

**Mechanism.** Exact-span highlights; `text-decoration-style`, `text-decoration-thickness` and `text-underline-offset`; gutter legend always available.

**Data.** New pass separating linguistic certainty from model confidence.

**Risk.** Epistemic force is context-sensitive. Decorative strength could reverse the meaning by making a weak claim visually prominent.

## 16. Voice Fingerprints

**What the reader sees.** Quotations, reported beliefs, hypothetical opponents and Seth’s own commitments each receive a distinct side rule. When a paragraph moves between voices, the rule visibly changes midway.

**Why it helps.** Argumentative essays frequently state a view only to reject it later. Voice tracking prevents attribution errors.

**Mechanism.** Quote-level ranges and labelled gutter segments; patterned borders rather than many hues; anchored popover naming the speaker or stance.

**Data.** New pass: speaker, quoted/reported/endorsed status and exact spans.

**Risk.** Irony and indirect discourse are difficult. A mistaken “author endorses this” label could be worse than no decoration.

## 17. Syntax Scaffolding

**What the reader sees.** On demand, a difficult sentence acquires a thin vertical scaffold: main clause, subordinate clauses and parentheticals receive successively indented gutter bars. Corresponding punctuation receives matching ticks.

**Why it helps.** It lowers the cost of parsing syntactically dense sentences without paraphrasing them.

**Mechanism.** Preserve the inline text order; derive `Range` rectangles for clauses; draw bars in an overlay; activate only on focus or long-press.

**Data.** New syntactic pass returning exact clause spans, hierarchy and grammatical relation.

**Risk.** Persistent scaffolding looks like proofreading markup. Reflow can make multi-line nested clauses visually chaotic.

## 18. Parallelism Braces

**What the reader sees.** Repeated constructions—three examples, two opposed definitions, a sequence of “not X but Y” clauses—are joined by a fine brace and numbered dots. Matching phrases receive momentary underlines when one is hovered.

**Why it helps.** It exposes rhetorical parallelism that carries comparison or accumulation across several sentences.

**Mechanism.** SVG braces beside exact ranges; CSS highlights for corresponding phrases; `data-*` groups drive synchronized hover and keyboard focus.

**Data.** New pass: parallel groups, members, relationship and quoted spans.

**Risk.** The decoration can feel schoolbookish. Weak structural similarities should not be forced into patterns.

## 19. Editorial Typesetting

**What the reader sees.** Long paragraphs wrap with fewer ugly final-line fragments; opening quotation marks hang just outside the measure; headings balance cleanly. Dense paragraphs receive a little more leading, while ordinary ones keep the established rhythm.

**Why it helps.** Better line endings and optical edges reduce small navigation costs on every line—a cumulative benefit over 8,300 words.

**Mechanism.** `text-wrap: pretty` for prose and `balance` for headings; `hanging-punctuation`; `hyphens: auto`; complexity-controlled `line-height`. `pretty` asks the browser to favour layout quality for body copy, though at some performance cost. [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-wrap). Hanging punctuation needs progressive enhancement because support remains uneven. [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/hanging-punctuation).

**Data.** Blocks plus an optional sentence-complexity score.

**Risk.** Per-paragraph leading changes can produce a restless vertical rhythm. Hyphenation quality varies.

## 20. Section Initials

**What the reader sees.** The first author-written letter after a major generated boundary becomes a restrained two-line initial, paired with the small section title in the margin. Minor boundaries receive only a hairline marker.

**Why it helps.** It gives otherwise invisible structural seams a recognisable entry point without adding explanatory prose.

**Mechanism.** `::first-letter` plus `initial-letter`; boundary depth selects size; `@supports` preserves an ordinary first letter where unsupported.

**Data.** Existing tree ranges and depths.

**Risk.** Drop caps may look literary or ornamental rather than analytical. They should never be applied after every tiny generated section.

## 21. Reading Aperture

**What the reader sees.** The paragraph nearest the reading line is at full brightness. Nearby paragraphs remain comfortably readable but recede by perhaps 6–10%; the effect moves continuously rather than snapping.

**Why it helps.** It suppresses peripheral competition on a dense page and makes it easier to return to the exact line after glancing at a margin note.

**Mechanism.** Intersection Observer or view-progress timelines set a custom property controlling `color` and decorative contrast; `prefers-reduced-motion` disables movement.

**Data.** None beyond block geometry.

**Risk.** Excessive dimming violates the spirit of keeping all words present and harms accessibility. The range must be tiny and optional.

## 22. Nested Section Strata

**What the reader sees.** Each tree depth creates a barely visible nested band behind the prose: chapter, section, subsection. At boundaries, one band ends and another begins, producing a geological cross-section down the page.

**Why it helps.** The reader perceives containment continuously, not only when consulting the ToC.

**Mechanism.** Layered `linear-gradient` backgrounds or pseudo-elements on range wrappers; depth encoded by inset and rule weight, not hue; container queries simplify narrow layouts.

**Data.** Existing `tree.json`.

**Risk.** Too many nested rectangles make the article resemble a dashboard. Deep trees require aggressive simplification.

## 23. Argument Weather

**What the reader sees.** The extreme page edge—not the prose background—changes atmospheric texture across the essay: calm grain for exposition, tightening lines for objection, clearing space for synthesis. The movement is almost imperceptible.

**Why it helps.** It gives readers a peripheral sense of large-scale phase changes without inserting another explanation.

**Mechanism.** Fixed edge layer with CSS gradients, noise mask and scroll-driven interpolation; no animation independent of scrolling.

**Data.** Existing arc ranges plus a new pass classifying argumentative phase and intensity.

**Risk.** This can become pure mood-board decoration. It must encode a stable legend or remain too subtle to claim semantic meaning.

## 24. Contradiction Lens

**What the reader sees.** When two passages are in tension, each receives a small opposed-corner mark. Activating either shows the other passage verbatim in a narrow side card, with “tension,” “qualification,” or “changed position” as the relationship.

**Why it helps.** It supports interrogation across distant passages and distinguishes genuine contradiction from later refinement.

**Mechanism.** Quote-anchored pairs; popover or sidecard; text-fragment deep links; View Transition for moving from the quoted sidecard back to its full context.

**Data.** New pass: passage pairs, exact quotes, relation, explanation and confidence.

**Risk.** Contradiction detection is sensationally error-prone. The UI must prefer “read these together” over “caught the author.”

## 25. Inline Microdiagrams

**What the reader sees.** At two or three genuinely structural passages, a compact diagram sits between paragraphs: perhaps “anthropomorphism → conscious-AI intuition → ethical conclusion.” Selecting a node highlights the exact prose that establishes it.

**Why it helps.** It externalises multi-step structure while requiring the reader to inspect each source passage.

**Mechanism.** Small accessible SVGs generated from typed graph data; block-range links; `<details>` for optional explanation. `content-visibility: auto` can defer offscreen diagram rendering while retaining find-in-page and focus behaviour. [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility).

**Data.** New pass: 2–5-node local diagrams with typed edges and source block ids.

**Risk.** A diagram can become a perfect substitute summary. Keep it local, incomplete and dependent on prose interaction.

## 26. Evidence Receipts

**What the reader sees.** Citation-like claims receive a small receipt tab. Opening it shows what the passage actually offers: named source, linked work, anecdote, quotation, or no inspectable source in the article.

**Why it helps.** It distinguishes “a citation exists” from “I have checked what kind of support this is.”

**Mechanism.** `<details name="evidence">` allows only one receipt in the group to remain open; exact quote highlight; anchor-positioned panel. Grouped `<details>` elements support mutually exclusive disclosure through the `name` attribute. [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details).

**Data.** Parsed links plus a new evidence-attribution pass.

**Risk.** “No source here” is not “false.” Large receipts could compete with reading.

## 27. Comment Constellation

**What the reader sees.** The reader’s annotations appear as tiny stars beside their anchors. Related comments form a faint constellation in the margin; answered questions have a hollow halo, while bookmarks remain plain points.

**Why it helps.** It turns prior engagement into a personal map for rereading without overlaying large note cards on the prose.

**Mechanism.** Existing quote marks; SVG points and optional edges; hover/focus opens the existing comment dialog; clustering occurs only when stars collide.

**Data.** Existing comments plus optional reader-assigned or model-suggested relationships.

**Risk.** Model-grouped personal notes may invent relationships. Fifteen comments are charming; hundreds need filtering.

## 28. Self-Explanation Bays

**What the reader sees.** At a few major section ends, the margin opens into a one-line prompt: “What changed in your view here?” The text area begins as a single quiet line and grows only as the reader writes.

**Why it helps.** Generating an explanation strengthens understanding more than rereading, and the prompt attaches that effort to a precise passage.

**Mechanism.** `<textarea>` with `field-sizing: content`, `min-block-size` and `max-block-size`; saved as a block-range comment. `field-sizing: content` lets controls grow with their contents. [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/field-sizing).

**Data.** Tree boundaries; optionally a pass generating non-summary reflection prompts.

**Risk.** Prompts can feel like homework and fracture reading flow. Use very few and never require an answer.

## 29. Prediction Pegs

**What the reader sees.** Before a major argumentative turn, a tiny margin peg asks something like “What evidence would settle this?” It does not cover or delay the next paragraph; the reader can type, think, or continue.

**Why it helps.** Forming a prediction before seeing the author’s move makes assumptions and surprise more memorable.

**Mechanism.** A non-modal anchored control inserted between blocks; response collapses into a small marker; comparison becomes available only after the reader naturally reaches the later range.

**Data.** New pass: transition points, forward-looking question, reveal range.

**Risk.** Too many pegs manufacture suspense and turn an essay into a lesson plan.

## 30. Hinge Pin

**What the reader sees.** A pivotal author sentence remains pinned in a narrow strip above the prose while the evidence or elaboration beneath it scrolls past. It is duplicated verbatim and clearly quoted; the original remains in place.

**Why it helps.** It keeps the controlling claim in working memory while the reader evaluates several paragraphs against it.

**Mechanism.** `position: sticky`; an `aria-hidden` visual duplicate linked to the original block; range boundaries release it; View Transition softens handoffs.

**Data.** New pass: controlling sentence and the contiguous range it governs.

**Risk.** This resembles a pull quote and may become a shortcut. Pin only sentences whose function is genuinely to govern what follows.

## 31. Callback Echoes

**What the reader sees.** When the author returns to an earlier claim, a small margin echo repeats only the earlier phrase—not a generated summary—with a line pointing backward through the spine. Activating it reveals the full earlier sentence in context.

**Why it helps.** It restores distant context precisely when the author expects the reader to remember it.

**Mechanism.** Exact author-quote cards; gutter arcs terminating on spine positions; deep links keyed by block id.

**Data.** New pass: callback span, antecedent passage, exact quoted fragment and relationship.

**Risk.** Repetition may clutter the margin, and the chosen fragment may bias interpretation by omitting its original qualification.

## 32. The Decoration Microscope

**What the reader sees.** A long-press on any sentence expands one compact lens containing only applicable layers: rhetorical role, glossary terms, assumptions, evidence links, comments and syntax. The page itself stays quiet until the reader asks.

**Why it helps.** It permits extremely rich augmentation without making richness the permanent visual condition.

**Mechanism.** CSS Custom Highlights for the selected sentence; anchored Popover API panel; tabbed or accordion disclosure; `:focus-visible` and keyboard equivalent; URL state makes the lens linkable.

**Data.** All existing artefacts plus the optional passes above.

**Risk.** It could become an inspector for model metadata rather than a reading aid. The first action in every layer should return attention to words on the page.

# Top 5

1. **Rhetorical Score** — the strongest direct aid to following an argument, and difficult to consume without reading the prose.
2. **Generated Seams** — high value on structurally flat long-form essays, using data already present.
3. **Claim–Evidence Wiring** — turns evaluation of support into a concrete interaction rather than another model explanation.
4. **Assumption Understructure** — uses Spideryarn’s most distinctive existing artefact exactly where the reader needs it.
5. **Callback Echoes** — repairs long-range working-memory failure using only the author’s own words.

# One left-field idea: Argument Gravity

Each sentence shifts sideways by at most 6–8px: supporting moves lean subtly toward the claim they serve, objections pull away, and resolutions return to the central measure. Hairline “force vectors” appear only on hover, so the page feels almost normally typeset until its argumentative push and pull becomes visible.

The mechanism is sentence spans with tiny `translate-inline` values, SVG vectors, and a new signed relation pass: supports, attacks, qualifies or resolves. It may create a bodily sense of argumentative tension that a labelled diagram cannot. It may also look like a broken typesetter, induce motion sickness during toggling, and distort line wrapping—hence the embarrassment.

