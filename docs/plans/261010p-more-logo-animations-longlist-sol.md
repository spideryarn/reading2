### 1. Cross-section

- **Reach:** letters
- **What the reader sees:** A razor-thin orange cross-section rises through all ten glyphs, briefly colouring only the ink it intersects: descenders, baseline, x-height, then caps. It returns downward and disappears, leaving the white word untouched.
- **Why it’s Spideryarn:** It reveals the hidden structure of the text without replacing any of it.
- **CSS mechanism:** Each `.logo-letter::before` repeats its glyph through ten `content` rules, sits absolutely over the original, and uses an animated horizontal `clip-path: inset(...)` to expose a narrow band of `var(--highlight-text)`. The underlying white letters remain visible throughout; 0% and 100% clip the overlays completely.
- **Risk:** The duplicate must inherit exactly the same font metrics or it will produce a coloured halo. Hard-coding the ten glyphs also makes a future spelling change a rename that must reach this CSS.
- **Suits:** both

### 2. Cross-reference

- **Reach:** letters
- **What the reader sees:** A fine orange arch grows from the first `r` to the second `r`, holds as though one occurrence cites the other, then retracts. Neither letter moves; the repeated form is simply revealed as a connection.
- **Why it’s Spideryarn:** Cross-references make relationships visible while leaving both source passages in place.
- **CSS mechanism:** The sixth letter’s `::after` is an absolutely positioned, rounded top border extending towards letter nine, animated with `scaleX(0 → 1 → 0)` from its left end. Its width and shallow rise use `calc(var(--logo-px) * N)` and its 100% state is invisible.
- **Risk:** The span has to be tuned to Geist’s advances; too low resembles a ligature, while too high resembles an accidental macron.
- **Suits:** both

### 3. Three Readings

- **Reach:** letters
- **What the reader sees:** The word is read three ways over one loop. First every third letter warms in a sparse route, then the letters skipped by that route answer, and finally all ten briefly agree in orange before returning to white.
- **Why it’s Spideryarn:** It is Skim’s three passes at increasing depth, compressed into one intact word.
- **CSS mechanism:** Three sets of `:nth-child()` selectors receive complementary colour keyframes within a shared roughly 2.4-second cycle; a tiny `translateY(calc(var(--logo-px) * -0.5))` distinguishes an active letter without dimming any others. Every keyframe ends at `color: var(--wordmark-ink)` and `transform: none`.
- **Risk:** Without perceptible pauses between the passes, it becomes arbitrary blinking. The timing—not the amplitude—must explain the route.
- **Suits:** loader

### 4. Proofreader’s Carets

- **Reach:** letters
- **What the reader sees:** Three tiny orange insertion carets rise beneath different gaps in the word, one after another, then vanish in reverse order. The word remains perfectly still, as if an invisible reviewer considered three amendments and withdrew them.
- **Why it’s Spideryarn:** Referee, Comments, and Ideas all invite scrutiny without silently rewriting the author.
- **CSS mechanism:** Selected letters receive absolutely positioned `::after` shapes made with `background: var(--highlight)` and `clip-path: polygon(0 100%, 50% 0, 100% 100%, 75% 100%, 50% 45%, 25% 100%)`. Staggered opacity and one-wordmark-pixel vertical transforms raise and lower them; 0% and 100% are hidden.
- **Risk:** At native size the carets may resemble dirt or tiny letter `v`s. They need strong geometry and no more than three appearances.
- **Suits:** both

### 5. Interrogate

- **Reach:** letters
- **What the reader sees:** A small orange question mark materialises beside the final `n`, leans towards the word, and is replaced for one beat by an exclamation mark. Both withdraw, returning the name to silence.
- **Why it’s Spideryarn:** Reading moves from asking what the text means to discovering what it makes you notice.
- **CSS mechanism:** The final letter’s `::before` and `::after` contain `?` and `!`, absolutely positioned just beyond its right edge. Separate opacity and transform keyframes cross-fade them without animating `content`; both are invisible at 0% and 100%.
- **Risk:** Held too long, it changes the apparent brand to “Spideryarn?” or “Spideryarn!” It needs to read as passing punctuation, not a new lock-up.
- **Suits:** both

### 6. Parenthetical

- **Reach:** letters
- **What the reader sees:** Parentheses arrive from just outside the word and gently enclose it, hold for a moment, then open and fade. The letters do not compress: the word has been placed in context, not captured.
- **Why it’s Spideryarn:** Every mode supplies context around the original prose rather than displacing it.
- **CSS mechanism:** The first letter’s `::before` contains `(` and the last letter’s `::after` contains `)`, both absolutely positioned outside their spans. Opacity plus short horizontal transforms bring them inward and back; the final frame hides both.
- **Risk:** The closing parenthesis can collide with “Reading” in the marketing lock-up, so `.site-wordmark-host` may need to suppress this animation. At small size, generous motion would look like the word changing width even though its box does not.
- **Suits:** both

### 7. Loom

- **Reach:** letters
- **What the reader sees:** Odd letters sit one wordmark pixel above the baseline while even letters sit one below, forming an over-under weave; halfway through, the pattern exchanges places. It flattens completely before beginning again.
- **Why it’s Spideryarn:** Ten separate glyphs behave like alternating strands while remaining one readable word.
- **CSS mechanism:** Odd and even `:nth-child()` groups share mirrored `translateY()` keyframes using `calc(var(--logo-px) * 1)`, with simultaneous rather than travelling motion. The loop includes a substantial flat rest at `transform: none`.
- **Risk:** More than one pixel becomes a ransom-note baseline, and too rapid an exchange becomes shimmer. This depends on rigid simultaneity to remain typographic.
- **Suits:** both

### 8. Asterisk

- **Reach:** mark
- **What the reader sees:** The spider contracts and rises until its radial legs read as a tiny asterisk preceding the word. It pauses as a reference mark, then unfurls into a spider again.
- **Why it’s Spideryarn:** The mascot becomes the oldest compact promise that there is a note, source, or qualification worth following.
- **CSS mechanism:** `.logo-image` animates through `scale(1 → 0.55 → 0.55 → 1)`, a roughly `-3px` vertical translation, and a small rotation that aligns the legs as punctuation. Both ends are `transform: none`; the contracted pose stays inside the mark’s box.
- **Risk:** At native size it may read only as “the logo shrank.” The pause and superscript-like rise have to make the typographic transformation unmistakable.
- **Suits:** both

### 9. Six Stops

- **Reach:** mark
- **What the reader sees:** A tiny pale bead appears beside one spider leg, then jumps among the other legs in a deliberately non-clockwise order, pausing at each as though testing six threads. After the sixth stop it drops into the centre and disappears.
- **Why it’s Spideryarn:** It turns loading from “time passing in a circle” into attention visiting several possible paths.
- **CSS mechanism:** `.logo-mark::after` is a 2px absolutely positioned bead centred on the mark. Enumerated transforms—`rotate(...) translateX(10px) rotate(...)`—place it at six angles using held keyframe steps rather than a continuous orbit; opacity returns to zero at 100%.
- **Risk:** Interpolated angles would instantly turn it back into a conventional spinner. The jumps need short travel and unmistakable holds.
- **Suits:** loader

### 10. Echo Web

- **Reach:** mark
- **What the reader sees:** Two faint spider-shaped impressions expand outward from the real spider at different speeds and evaporate. The original remains sharp and still, so the effect feels like vibrations leaving a web rather than a logo pulsing.
- **Why it’s Spideryarn:** Reception and debate are consequences propagating outward from one source.
- **CSS mechanism:** `.logo-mark::before` and `::after` are boxes masked with `/spideryarn-logo.png`, painted from `var(--highlight)` or `var(--highlight-ink)`, and animated from `scale(1)` to about `scale(1.28)` while fading. Their delays overlap into a two-beat rhythm; both finish invisible and untransformed.
- **Risk:** Excess blur or too many repetitions makes it a generic sonar pulse. The recognisable spider silhouette must survive at the outer scale.
- **Suits:** loader

### 11. Altitude

- **Reach:** mark
- **What the reader sees:** A pale orange version of the spider is revealed from its central knot outward, reaching the inner joints and then the tips of all six legs before contracting to the centre. The ordinary orange spider remains beneath it throughout.
- **Why it’s Spideryarn:** It moves from the gist at the centre to the detail at the edges, then returns with the whole shape still present.
- **CSS mechanism:** A `.logo-mark::after` overlay is masked to the PNG and painted `var(--highlight-ink)`. Its `clip-path: circle()` expands from roughly `0%` to beyond the mark’s corners and back; opacity is zero and the circle collapsed at 100%.
- **Risk:** At 20px, the reveal may cross several strokes in one frame and look like a blink. The duration must be slow enough to expose the radial order but short enough not to resemble buffering.
- **Suits:** both

### 12. Page Turn

- **Reach:** mark
- **What the reader sees:** The spider folds almost edge-on like a tiny printed page, passes through a thread-thin moment, then opens past flat and settles. A faint spider-shaped impression remains behind it, so the mark is never wholly absent.
- **Why it’s Spideryarn:** The digital mascot briefly behaves like the physical object the reader came to engage with.
- **CSS mechanism:** Give `.logo-mark` perspective and animate `.logo-image` through `rotateY(0 → 78deg → -10deg → 0)` with a slight compensating scale. A masked, absolutely positioned `::before` supplies the low-opacity stationary impression and fades to zero by 100%.
- **Risk:** Raster resampling can make the edge-on PNG muddy rather than thin, especially at 1×. The ghost must prevent disappearance without reading as a second spider.
- **Suits:** both

### 13. Listening Post

- **Reach:** mark
- **What the reader sees:** The spider leans towards one invisible thread, pauses, returns to centre, then tests two other directions with different pauses. It ends with a tiny recoil, as though one of the threads answered.
- **Why it’s Spideryarn:** It portrays assistance as listening and checking, not as charging forward with one answer.
- **CSS mechanism:** One `.logo-image` keyframe alternates neutral holds with small combinations of `translate(±1px, ±1px)` and `rotate(±4deg)`, visiting directions in a non-circular order. Every excursion returns through `transform: none`, and the last portion of the loop rests.
- **Risk:** Without clean holds it is merely jitter; with too much rotation it becomes the rejected spinning-spider gag. The asymmetrical timing has to carry the intention.
- **Suits:** both

## Top 4

1. **Asterisk** — The strongest type-designer idea: the existing mark already contains the latent second form, so the animation discovers something rather than decorating it. It is legible quickly on hover, becomes especially charming at loader scale, and connects naturally to sources and provenance.

2. **Cross-section** — The most visually novel letters animation. It uses the actual anatomy of Geist, starts reading immediately, remains fully legible, and is clearly different from the rejected left-to-right Silk Line: this is a typographic section drawing, not a sheen.

3. **Six Stops** — The best loader-specific wildcard. It borrows the expectation of a spinner and then refuses circular progress, producing a self-contained mark track that can sit beside any unknown letters animation without competing with it.

4. **Cross-reference** — The quietest and most product-specific. The repeated `r`s give it a relationship already present in the word, while the drawn connection embodies one of Spideryarn’s central promises with very little motion.