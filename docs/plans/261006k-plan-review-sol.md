The core diagnosis and CSS fix are sound, but the test and the two follow-up questions need correction before approval.

F1 — The proposed test does not prove the fix. It compares property names, so `-webkit-text-size-adjust: auto`, `50%`, or another ineffective value would pass. Keep the generic Tailwind checklist, but add a direct assertion that the bare `html` rule in `@layer base` contains:

```css
-webkit-text-size-adjust: 100%;
text-size-adjust: 100%;
```

The extraction also needs an explicit non-empty sentinel. The currently visible draft has that sentinel, so it cannot pass completely vacuously, but it still accepts the wrong value. See [the test proposal](/var/tmp/spideryarn-worktrees/qi-d4c5w4fe-fonts-skim-review/docs/plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md:88).

F2 — The screenshot does not support the proposed global 94% reduction for AI text. The section line is requested at `0.88rem` and the quote at `0.84rem`; their requested ratio is 1.0476. The measured sizes, 21.5px and 20.5px, have a ratio of 1.0488. In other words, the whole visible difference is already explained by the deliberately different CSS sizes, with no residual evidence of an optical font-size mismatch. Question 2 should wait for an equal-CSS-size comparison on `/design`. It should also distinguish `font-size-adjust` from multiplying `font-size` by 94%; they are different mechanisms, and the 94% figure is currently unexplained.

F3 — Several audit numbers need correcting:

- The screenshot arithmetic is correct: approximately 16.8px, 20.5px, 21.5px and matching 1.53 multipliers.
- There are 566 `font-size` declarations.
- There are 64 literal value strings, or 63 after treating `0.84rem !important` as the same size; “about 65” is fair.
- There are 26 distinct normalized rem values from `0.72rem` through `0.98rem`, not 23.
- The current utility counts are 242 `text-sm` and 219 `text-xs`, not 218.
- There are 27 arbitrary size-utility occurrences across 11 size values, so “about 25” is fair.
- `debate.css` has 18 distinct sizes, and the five pixel declarations are correct.
- Only 40 files in the stated CSS scan contain a `font-size` declaration, so “45 stylesheets” needs explanation or correction.

F4 — Question 1 understates and misdescribes the large option. Moving “every rule” onto `12, 13, 14, 15, 17px` cannot move each by at most half a pixel: the corpus includes values below 12px, headings, `4.2rem`, clamps, variables, `inherit`, and even `0.98rem` moves 0.68px to its nearest listed step. More importantly, rounding to a numeric scale does not ensure that “the same job is the same size”; only named semantic roles do that. Ask plainly between:

1. aligning the recurring cross-mode roles;
2. designing a fuller scale that also covers headings and exceptional text;
3. leaving the current values alone.

The recommended first option is a real design choice and is answerable. The present full option is not yet sufficiently defined.

F5 — The autosizing diagnosis is a strong, credible inference, but the plan should not call it proved. The responsive viewport does not rule it out: Apple documents text adjustment as separate from viewport control, and the CSS specification describes per-block adjustment that is suppressed for short text—matching the wrapped-row-versus-short-label pattern. The specification does not say buttons are categorically exempt, and both `.skim-place` and `.skim-words` are descendants of the `.skim-go` button, so replace “leaves short labels and buttons alone” with the narrower observed claim. No competing stylesheet explanation is apparent: there is no relevant scale/zoom transform, both Skim elements request smaller sizes than the article, and both receive the same measured multiplier. [Apple’s Safari guidance](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/AdjustingtheTextSize/AdjustingtheTextSize.html), [CSS text-size-adjust specification](https://drafts.csswg.org/css-size-adjust/).

F6 — The rule and placement are right. `html` in `@layer base` makes the inherited setting global while leaving `app` and utility rules above it; it does not override `.prose`’s font size or interfere with ordinary pinch/page zoom. `100%` is Tailwind’s choice and historically avoided an old desktop-WebKit text-only-zoom bug associated with `none`, although the current CSS specification defines `100%` and `none` as equivalent for automatic text adjustment. The real behavioral trade-off is that Safari’s automatic inflation is disabled everywhere, including any surface where it might have been helpful; for this responsive app with 17px article text, that is reasonable but should still be confirmed on a real phone. [Historical WebKit bug and 100% workaround](https://bugs.webkit.org/show_bug.cgi?id=56543).

The clear-cut work is the global rule, an exact-value regression test, and correcting the audit figures. A shared size scale and any global optical adjustment remain design choices.

I made no file changes. The worktree already contained an uncommitted draft implementation when inspected; its focused test currently passes 5/5.

VERDICT: changes needed