# How long a line, how much leading, how big a paragraph gap: the evidence

Up: [research.md](../project/research.md)

Researched 2026-10-22 by a Sonnet subagent (web search and fetch), for Greg's report `spya-vywcpu`.
The plan it fed is [261022d](../plans/261022d-reading-measure-in-real-characters.md); the rule it
produced lives in [typography.md § The measure](../project/typography.md#the-measure-counted-in-real-characters).

> I did a rough count of the number of characters visible horizontally, and I think it was more like
> 70. … I thought we had done some research on the ideal sort of reading width … between sort of about
> 45 and 65. … if we haven't done the research, do the research, and then let's try and, where we can,
> stay within these bounds. … If there are other things that make a difference, I don't know, line
> spacing, paragraph spacing, blah blah, then let's try and optimize those too.
>
> — Greg, 2026-10-21 (`spya-vywcpu`)

**We had done some of it.** [original-version/typography.md § Line length](../project/original-version/typography.md#line-length)
carried the previous app's figures (60–65 primary, 55–70 acceptable, 75 maximum), and
[261010a/17-typography-and-decoration.md](261010a-reading-and-learning-evidence/17-typography-and-decoration.md)
found the line-length evidence thin. This note re-checks the citations, and **corrects one**: the
"80 characters read ~7% faster and comprehend ~12% worse (Dyson & Kipping 1998)" that sat in
`styles/tokens.css` and `prose.css` is not in that paper, which tested 25, 55 and 100 characters
(abstract re-read by the session that wrote the plan:
[Visible Language 32(2)](https://journals.uc.edu/index.php/vl/article/view/5671), fetched 2026-10-22).

## Measured in our own browser, 2026-10-22

The research below measured `ch` against stand-in fonts; this is the real face. Playwright against
the dev server, Plain view, the essay "Simulators" (933 full lines, last line of each paragraph
left out, spaces counted). Script: `cpl-measure.mjs`, described in the plan.

| Window | Text size | `.prose` width | Median chars/line | 10th–90th percentile | Max |
|---|---|---|---|---|---|
| 725×967 (Greg's iPad, from report `spya-e5t77w`'s diagnostics) | Default | 573.5px | **70** | 62–75 | 80 |
| 725×967 | Large | 632px | 70 | 62–75 | 80 |
| 725×967 | Largest | 630px (window-bound) | 58 | 50–62 | 71 |
| 820×1180, 1440×900 | Default | 573.5px | 70 | 62–75 | 80 |
| 390×844 | Default | 313px | 37 | 32–41 | 46 |

**In Source Serif 4 at 17px a "0" is 8.82px and the average prose character 8.19px**, so `65ch` holds
about 70 characters, not 65. (The stand-in fonts below gave a bigger gap, ~82; Source Serif's zero
is narrow for a serif.) The text-size setting does not change this when there is room, because `ch`
grows with the type.

## The literature, short answer

From here on the "I" is the researching subagent. Many publisher pages were blocked, so each
citation says whether its abstract, a summary, or nothing was read.

| # | Question | Answer | Certainty |
|---|---|---|---|
| 1a | Best line length for comprehension | About 55 characters per line (cpl) gave the best comprehension and the best ease rating in the two Dyson studies. Nobody has shown a cliff between about 45 and 90 cpl. | Medium-low. Two papers by one lab, small N, and Shaikh & Chaparro (N=20) found no comprehension effect. |
| 1b | Longer lines and speed | Reading speed rises with line length up to 95-100 cpl in most screen studies (Dyson & Kipping, Shaikh & Chaparro, Sahito et al.). Bernard et al. found no speed difference across 45/76/132. | Medium-high |
| 1c | Preference | Readers prefer medium lines (about 55-75) and dislike the longest. The extremes are rated worst. Preference does not track performance (Dyson & Kipping). | High |
| 1d | Phones, under 45 cpl | No study I could find tests a phone at its natural 30-40 cpl against a longer measure for ordinary readers. Evidence on very short lines: speed cost at 25 cpl (Dyson & Kipping), but a gain for dyslexic students on a small device. | Low. A gap in the literature |
| 1e | "ch" is not a character | Confirmed. `65ch` holds about 82 average English characters, not 65, in all four fonts I measured. | High (measured, not cited) |
| 2 | Leading | Empirical work says "roughly 1.2-1.5, flat optimum". Nothing shows 1.6 hurts. The long-line rule (more leading with longer lines) is Bringhurst-style convention. I found no experiment that tests it. | Medium-low |
| 3 | Paragraph spacing vs indent | One print study (Hartley et al. 1978, children, secondary description only). Nothing on screen. WCAG's 2x figure is an adaptation floor, not a recommendation. | Low. Convention only |
| 4 | Text size on tablets | Fluent range is 0.2-2 degrees of x-height (Legge & Bigelow 2011). Ordinary body sizes sit well inside it, so the choice is comfort, not a cliff. | High on the range, no tablet-specific study |

## 1. Line length

### What our earlier notes got right and wrong

- Dyson & Kipping 1998 tested 25, 55 and 100 cpl. They did not test 80. I could not find "80 cpl about 7% faster, about 12% worse comprehension" in any source I could open. So those two numbers are dropped. The abstract says only that 100 cpl was read faster than 25 cpl and comprehension "remained constant".
- Bernard, Fernandez & Hull 2002 tested 45, 76 and 132 cpl, not 95. The "fastest at 95 cpl" figure belongs to Shaikh & Chaparro. A search summary blurred the two.
- "80 cpl" does appear in a different Dyson paper: Dyson & Kipping 1997 (CHI), one 80-cpl column against three 25-cpl columns. That is a column-layout test, secondary source only.

### Studies

- **Dyson & Kipping (1998).** *The effects of line length and method of movement on patterns of reading from screen.* Visible Language 32(2), 150-181. https://journals.uc.edu/index.php/vl/article/view/5671 (abstract read; N not on page).
  Two experiments: line length (25, 55, 100 cpl) and paging versus scrolling. Result, quoting the abstract: "Long lines (100 characters) were found to be read faster than very short lines (25 characters), while comprehension remained constant." Judgments of ease "did not correlate with their performance". The long lines were rated "least easy to read", and 55 cpl "easiest to read". People used different scrolling patterns and these changed reading rate.
- **Dyson & Haselgrove (2001).** *The influence of reading speed and line length on the effectiveness of reading from screen.* Int. J. Human-Computer Studies 54(4), 585-612. doi:10.1006/ijhc.2001.0458 (Crossref and OpenAlex have the record but no abstract; I could not open the publisher's page).
  Secondary descriptions say N=36 adults, 25/55/100 cpl, normal and fast reading, and that 55 cpl gave the highest comprehension and was read faster than short lines. Treat as plausible but not checked against the paper. Same authors' companion paper (Dyson & Haselgrove 2000, J. Research in Reading 23(2), 210-223) is about reading speed and comprehension, not line length.
- **Bernard, Fernandez & Hull (2002).** *The effects of line length on children and adults' online reading performance.* Usability News 4.2. Seen via Human Factors International's summary, https://www.humanfactors.com/newsletters/reading_text_online.asp (secondary). Adults 18-61, children 9-12; N not given in the summary. Lines of 132, 76 and 45 cpl. No significant reading-time difference. Comprehension results not reported there; adults found 45 cpl easiest to concentrate on (p<.01). No adult picked 132 as favourite; most picked 76, 45 close. Children strongly preferred 45.
- **Shaikh & Chaparro (2005).** *The effect of line length and passage type on reading speed, comprehension, and user satisfaction* (listed by the university repository as "The Effects of Line Length on Reading Performance of Online News Articles"). Proc. Human Factors and Ergonomics Society 49th Annual Meeting. https://portfolio.erau.edu/en/publications/the-effects-of-line-length-on-reading-performance-of-online-news-/ (abstract read).
  N=20 college students; 35, 55, 75, 95 cpl on a monitor. 95 cpl was fastest. Six question types; the abstract reports that structure questions were harder than factual ones and names no line-length effect on comprehension. Satisfaction was not affected overall, but participants strongly preferred the extreme lengths in a way the abstract does not spell out. Note: a conference paper, not a journal article.
- **Ling & van Schaik (2006).** *The influence of font type and line length on visual search and information retrieval in web pages.* Int. J. Human-Computer Studies 64(5), 395-404. doi:10.1016/j.ijhcs.2005.08.015. Abstract read via Teesside repository: https://research.tees.ac.uk/en/publications/the-influence-of-font-type-and-line-length-on-visual-search-and-i/ .
  Two experiments, visual search and information retrieval. Font had little effect. "Longer line lengths facilitating better scanning" (Experiment 1); shorter lines gave better subjective outcomes in both. The page gives no N and no cpl values, so I cannot confirm what lengths were compared. Scanning for a target is not reading for understanding, so this is weak evidence for a prose default.
- **Sahito et al. (2015).** *Significance of line length for tablet PC users.* DUXU 2015, Springer, pp. 587-596. https://research-portal.uea.ac.uk/en/publications/significance-of-line-length-for-tablet-pc-users/ (abstract read). N=70, ages 20-40, four lengths on a tablet (the page names 60 and 90). 90 cpl preferred by most; some of the 35-40 year olds preferred 60. Speed and accuracy numbers not on the page. This is the only tablet-specific line-length study I found.
- **Sahito et al. (2012).** *Evaluation of efficient line lengths for better readability.* Mehran Univ. Research J. of Eng. & Tech. https://doaj.org/article/a10a500d16f34a25809ae0445a889cdc (abstract seen through a search summary only; the page itself returned 403). N=16, ages 24-36, four lengths between 30 and 120 cpl. Speed rose with length; comprehension peaked at medium lengths; 13 of 16 chose 60 or 90 cpl as favourite.
- **Nanavati & Bias (2005).** *Optimal line length in reading: a literature review.* Visible Language 39(2), 121-145. https://journals.uc.edu/index.php/vl/article/view/5765 (abstract read). A century of research. Past work suggests lines should not exceed about 70 cpl; both very short and very long lines "slow down reading by interrupting the normal pattern of eye movements". Note that this claim of slowing at long lengths sits oddly beside the screen studies above, where long lines were read faster.
- **Eye-movement background.** Readers use roughly 14-15 characters to the right of fixation, saccades average about 8 characters, and a return sweep starts 5-7 characters before the end of a line and lands 3-7 characters in, often undershooting and needing a corrective saccade (summarised from Rayner's work in teaching material and recent papers; I did not open Rayner's own papers). The argument that long lines cost accuracy on the return sweep comes from this. It explains why preference falls at the long end; it does not show a comprehension loss at 80-100 cpl on screen.

### Convention versus measurement

- **Measured:** long lines are read at least as fast as short ones on screen (up to ~100 cpl); 25 cpl is slower; people dislike the longest lines whatever their speed; 55 cpl is rated easiest and had the best comprehension in one lab's two studies.
- **Convention, not measurement:** Bringhurst's 45-75 (66 ideal) is craft tradition. I saw it quoted second-hand ("the 66-character line, counting both letters and spaces, is widely regarded as ideal") but did not open the book. Baymard's 50-75 rests, by its own account, on qualitative observation of e-commerce users plus Emil Ruder's 50-60, with no sample sizes or effect sizes (https://baymard.com/research-articles/line-length-readability). The 65-70 figure in many web guides is the same tradition. WCAG 1.4.8 (AAA) says no more than 80 characters (40 for CJK, because CJK glyphs are about twice as wide): https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation.html . The page cites research under Related Resources but states no line-length result.
- Spencer (1968, ~70 cpl max) and Tinker (1963, about 52 cpl optimum in print, via Rayner & Pollatsek 1989) are cited in the Legible Typography overview, https://legible-typography.com/en/6-overview-of-research-typography (secondary).

### Comprehension specifically

Direct tests are thin: Dyson & Kipping (no effect, 25 vs 100), Dyson & Haselgrove (55 best, secondary), Shaikh & Chaparro (no reported effect), Sahito 2012 (peak at medium, secondary). So the honest summary is "comprehension is insensitive to line length in the 45-100 range in most studies; one lab found a peak at 55". Nothing here supports a claim that 90 cpl harms understanding; nothing rules out a small effect.

### Phones and short measures

- No experiment I found tests phone-width measure (about 30-40 cpl) on ordinary readers. Guides that say "mobile 30-40" are practice, not research.
- Evidence about very short lines: Dyson & Kipping found 25 cpl slower than 100 (comprehension equal). Schneps et al. (2013), "Shorter lines facilitate reading in those who struggle", PLoS ONE 8(8), e71161, doi:10.1371/journal.pone.0071161: high-school students with dyslexia on a small e-reader read 27% faster with 11% fewer fixations and more than halved regressive saccades, comprehension unaffected (abstract via Europe PMC). N and lines-per-screen not seen. Lines were very short (a companion paper per a news summary said two or three words). Read: for a dyslexic group, very short lines helped. It does not say short lines help typical adult readers.
- Baymard: in portrait on a phone line length is "less of a problem"; landscape can push lines over 80 (secondary note from their page).
- The real phone risk is probably ragged, hyphen-poor, justified text at 30 cpl, not the measure itself. That is my inference, not a finding.

### "ch" is not a character

The CSS `ch` unit is the advance width of the "0" glyph in the element's font. Average prose characters (letters and spaces) are narrower than a zero. I measured this with Pillow over 16,000 characters of English prose from `docs/project/vision.md`:

| Font (metric-compatible stand-in) | "0" width | Average prose char | Characters in 65ch | ch needed for 66 characters |
|---|---|---|---|---|
| Liberation Serif (Times New Roman metrics) | 0.500em | 0.396em | 82 | 52 |
| Liberation Sans (Arial metrics) | 0.556em | 0.436em | 83 | 52 |
| DejaVu Serif | 0.636em | 0.506em | 82 | 52 |
| DejaVu Sans | 0.636em | 0.499em | 83 | 52 |

So `65ch` is about 82 real characters, close to WCAG's 80 limit, and the serif/sans difference is within a character or two in these fonts. Rule of thumb: real cpl is about 1.25 x ch, so a 55-75 cpl target is roughly 44-60ch. Caveats: sample is one project's docs (lower-case-heavy English, no digits); fonts with old-style or narrow zeros (Georgia is said to have a wider zero than Helvetica in one blog demo: anecdote) will differ, and Geist (our face) was not measured because the font files could not be read here. Measure it in the browser: render a long paragraph at `width: 65ch` and count characters in the first line. `max-width` in `em` has the same issue in a different form: 1em is not a character either (average prose char is about 0.4-0.5em).

## 2. Line spacing

- **Chung (2004).** *Reading speed benefits from increased vertical word spacing in normal peripheral vision.* Optom Vis Sci 81(7), 525-535. doi:10.1097/00006324-200407000-00014. Abstract read (via PubMed record). N=5 normal observers; rapid serial presentation of word sequences, each target word flanked above and below by other words at 0.8x-2x standard vertical spacing. At the fovea, speed rose with spacing up to about 1.2-1.5x standard, then levelled off at the unflanked speed. In the periphery the benefit continued but never reached unflanked speed. This is a lab crowding task on single words, not continuous prose, and N=5. A later AMD follow-up (Chung et al. 2008) found no benefit from extra line spacing in macular disease patients (secondary). Meaning: a modest benefit up to about 1.2-1.5x the font's default spacing, none beyond, for central reading.
- **Williams & Scharff.** https://laurenscharff.com/research/SWExp.html (page read; undated student-style study). N=14, three spacings (single, 1.5, double) x three sizes (10, 12, 14 pt). Task: find a target shape in a paragraph. Single spacing was slower (220) than 1.5 (158) and double (150). Search task, no comprehension. Small N, early web.
- **Ling & van Schaik (2007).** *The influence of line spacing and text alignment on visual search of web pages.* Displays 28(2), 60-67. Teesside abstract seen: wider spacing gave better accuracy and faster reaction; left-aligned beat justified; people preferred justified. Per the Legible Typography overview: Arial 10pt at single, 1.5, double.
- **Rello, Pielot & Marcos (2016).** *Make it big! The effect of font size and line spacing on online readability.* CHI 2016, pp. 3637-3648. Abstract via search summary only. N=104 on Wikipedia pages, eye tracking. Readability and comprehension rose with font size; the abstract recommends 18pt or larger and default line spacing; line spacing effects were marginal; the extremes (0.8 and 1.8) impaired readability. A summary elsewhere said 1.4 was the top of the range, so the upper value is not settled.
- **Print era.** Bentley (1921): speed rose as added leading grew to 7pt, then fell; Paterson & Tinker (via Tinker 1965): acceptable legibility within 1-4pt extra leading (10pt type, 2pt about 1.2); Becker et al. (1970): sans serif and italic judged to need a point more than serif roman; Luckiesh & Moss dissented, finding 10/12 text worsening as lines lengthened. All secondary (Legible Typography overview and a thesis abstract). I did not find the original 1940 book text.
- **WCAG 1.4.12 (AA):** content must survive a user setting line height to at least 1.5x font size, paragraph spacing at least 2x, letter spacing 0.12x, word spacing 0.16x. The page says these are minimums that users can impose, not recommended defaults, and "authors are encouraged to allow spacing to surpass the values specified". https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html . WCAG 1.4.8 (AAA) asks for at least 1.5 line spacing within paragraphs as a user option. Separate: our text must not break at 1.5/2x, regardless of default.
- **Longer lines need more leading.** I found no empirical test. It follows from the return-sweep argument (the eye must find the right next line) and is stated in Bringhurst and most typography handbooks. Treat as sound craft convention, not measured.
- A relevant ceiling: Rello found 1.8 hurts. Greater than about 1.6-1.7 for body text starts to split lines apart.

## 3. Paragraph spacing

- **Hartley, Burnhill & Davis (1978)**, via the Legible Typography overview (secondary; not opened): 11-12-year-olds scanning for missing words found paragraphs separated by space scanned faster than new-line-no-indent; space was not significantly faster than an indent. The overview says there is no research on paragraph marking on screen. It also notes indents are cheaper in print because they use less space.
- Search found no controlled study comparing block paragraphs (space) to indents for on-screen reading. An on-screen study of one versus two spaces after a period found no significant difference (p=.226) but is about sentences, not paragraphs. A patent filing noting paragraph indent probably matters less than font, character, line or word spacing is not evidence.
- WCAG 1.4.12's 2x font size is a robustness test (content must not clip when a user sets it), not a design target. Baymard says it "recommends" 2em alongside 1.5em line height, but only as the accessibility compliance numbers.
- So 0.7em with no indent follows web convention. Because there is no evidence, the rule is: pick one marker (space or indent, not both) and make paragraph breaks unmistakable. A gap clearly bigger than the line gap (leading of 1.6 means about 0.6em of extra space between lines already; 0.7em is barely more than the interline gap) matters more than the exact value. Check that paragraph gap looks visibly larger than leading gap in your layout.

Quick calculation: at line-height 1.6 and font-size 17px, the line pitch is 27.2px. A 0.7em gap (11.9px) added to that makes a paragraph break only 1.44x the normal line pitch. Fine, but not generous.

## 4. Tablet text size and viewing distance

- **Legge & Bigelow (2011).** *Does print size matter for reading? A review of findings from vision science and typography.* Journal of Vision 11(5):8. doi:10.1167/11.5.8 (abstract read via OpenAlex). The fluent range, over which text can be read at maximum speed, is a factor of 10 in angular x-height, about 0.2 to 2 degrees. At 40 cm that is x-heights of 1.4 mm to 14 mm. The paper argues print sizes in books and newspapers sit inside this range because of properties of human vision. Practical reading: ordinary body text is well inside the flat top of the curve; the size at which speed starts to drop is below normal body text for people with normal vision. I did not find a tablet-specific size study; viewing distance on an iPad is usually 30-45 cm, similar to the 40 cm assumption.
- The Beymer, Russell & Orton (2008) eye-tracking study (N=82, Georgia and Helvetica at 10, 12, 14 pt) found smaller sizes lengthened fixations but not significantly, and suggested 12pt as a speed-plus-preference choice (secondary summaries). Rello 2016 recommends 18 or larger (their unit is CSS-point equivalents on a desktop screen).

## What it means for a default

- **Measure.** When there is room, aim for about 60-75 real characters per line, with a hard cap near 80 (WCAG 1.4.8, and where the measured fatigue and preference penalty grows). Reasoning: speed is roughly flat or rising to 100 cpl and comprehension is flat in most studies, so nothing measured forces a short line; but preference, ease and the one comprehension peak point to 55-75, and craft tradition agrees. Do not push toward 90-100 for essays and papers, where re-reading, tracking and annotation matter more than a few percent in speed. In CSS terms (our face, Geist, is not measured; use the `ch` table above as a guide): `max-width` of about 50-60ch gives about 62-75 real characters. Check by counting a line in the browser.
- **Phones.** Do not fight a short measure. 30-40 cpl at 16-17px is what the screen gives, and the only study that spoke to short lines (25 cpl) found a speed cost but no comprehension cost, while the dyslexia data went the other way. Concentrate instead on side margins (a 16px gutter), ragged-right alignment, and hyphenation off (avoid justified text at that width).
- **Leading.** Keep 1.5-1.6. Evidence for the range 1.2-1.5 times is flat and Rello found 1.8 hurts; WCAG's 1.5 is a floor users can force. Your 1.6 at 17px is defensible, and I would not change it on this evidence. If the measure goes toward 75, 1.6 is right; if it drops to 40 on a phone, 1.45-1.5 is acceptable (convention only; no experiment tests this) and saves screen height.
- **Paragraphs.** No evidence favours either style. Keep space-between, no indent, and make the gap clearly larger than the interline gap (0.8-1em rather than 0.7em), so a paragraph break reads even at the end of a line that happens to fall short. This is a design judgement, not research. Do not use both space and indent.
- **Text size on iPad.** 17-18px at normal tablet distance is well inside the fluent range; any move up or down is about comfort and age, so offer a size control rather than a fixed value.
- Make layout survive WCAG 1.4.12 overrides (1.5 line height, 2x paragraph, 0.12em letter, 0.16em word spacing) without clipping.

## Not verified

- Exact figures in Dyson & Haselgrove 2001 (N=36, 55 cpl peak, speeds): secondary only. Publisher page blocked.
- Ling & van Schaik 2006: no N and no cpl values seen. Their PDF at makinggood.ac.nz was image-only here.
- Bernard, Fernandez & Hull 2002: seen only through Human Factors International's summary; N not given there.
- Sahito et al. 2012: abstract through a search summary only.
- Shaikh & Chaparro: preference result and comprehension null come from a short abstract; I did not see a table.
- Chung 2004: abstract read; but full text, effect sizes and the 5-subject limit mean only the qualitative direction should be used. The 2008 AMD follow-up is secondary.
- Rello, Pielot & Marcos 2016: abstract through summaries; the upper spacing value (1.4 vs 1.8) conflicts across them.
- Bringhurst (66 ideal, 45-75, leading advice): only seen quoted second-hand. Baymard article was read but is a company article, not a study.
- Hartley et al. 1978, Bentley 1921, Paterson & Tinker 1940, Tinker 1963/1965, Becker 1970, Rayner's perceptual-span numbers, Dyson & Kipping 1997 columns: all via secondary descriptions.
- Dyson (2004) review ("How physical text layout affects reading from screen", Behaviour & Information Technology 23(6)) at stu.westga.edu: fetched, but the PDF text was unreadable here. It would be the best single source to open next.
- No phone-specific line-length experiment on ordinary adult readers found. Not a proof that none exists.
- Geist character width vs the `ch` unit: not measured. The Pillow numbers are from Liberation and DejaVu stand-ins.
- Nothing here separates essays or papers from the news-article and web-page material used in most studies.
