# A landscape phone inflates some of our text, and a quick review of fonts and sizes

One of Greg's reports (admin; `feedback-reporter.ts` exit 0, row proved, event not matched),
Overseer queue item `qi-d4c5w4fe`, report `spya-ar65p3`, Sentry `SPIDERYARN-READING2-DW`. Filed as a
suggestion; its first half is a bug.

> Why are the fonts in this different? Probably the ones in the Skim mode are too big?
>
> Do a quick review of fonts and font sizes more generally.
>
> — Greg, spya-ar65p3, 2026-10-06

**Prior work:** none. No plan, note or commit names this report; the only live session on it is this
one (`fbdw-fonts-differ-skim-too-big-review`). The faces themselves were decided in
[261002b](261002b-a-nicer-ai-typeface-and-the-voices-trawl.md) and
[261002f](261002f-the-three-faces-for-everyone-and-every-surface-voiced.md), and are not reopened
here.

## What "this" is

The screenshot in the production row (1600 × 738, read read-only) shows Skim's band on the left and
the article on the right, with Marginalia's "needs a wider window" line over the prose. The picture
is 2.17 times as wide as it is tall, which is an iPhone held sideways (844 × 390 is 2.16). The
report's own page was `/admin/costs`, where the dialog was opened; the row has no diagnostics, so
the device is read from the picture and is an inference.

In it, three things sit side by side:

- the article, in the author's serif;
- Skim's quote, the same serif but grey, **and visibly bigger than the article**;
- Skim's section line ("Introduction › Why the conflation matters"), in the model's monospace,
  a little bigger again (it is asked to be: 0.88rem against the quote's 0.84rem).

## Why Skim's text is bigger: measured from the picture

Skim's stylesheet asks for *smaller* text than the article, not bigger: the quote is `0.84rem`
(13.4px), the section line `0.88rem` (14.1px), the article `--reading-size` (17px).

Taking the picture as 1600 / 844 = 1.90 picture pixels per CSS pixel:

| Text | Line pitch in the picture | CSS line pitch | Line-height | Size drawn | Size asked for | Ratio |
|---|---|---|---|---|---|---|
| article | 51px | 26.9px | 1.6 | 16.8px | 17px | 1.0 |
| Skim's quote | 54.5px | 28.7px | 1.4 | 20.5px | 13.4px | 1.53 |
| Skim's section line | 55px | 29.0px | 1.35 | 21.5px | 14.1px | 1.53 |

The article comes out at its own size, which checks the scale. Both Skim lines come out at the same
1.53 times what the stylesheet says. The short one-line labels in the same band ("Gist 6",
"Reading for:") are not enlarged.

**That pattern fits iOS Safari's text autosizing, and I found nothing else that does.** It is a
strong inference, not a proof (see below). On an iPhone in landscape, Safari enlarges text block by
block and holds back on short text, unless the page says `-webkit-text-size-adjust: 100%`; a
`width=device-width` viewport does not turn it off
([Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/AdjustingtheTextSize/AdjustingtheTextSize.html),
[the CSS draft](https://drafts.csswg.org/css-size-adjust/)). No transform, zoom or larger size in
the stylesheets explains a uniform 1.53 on two elements that ask for different sizes. Before this
change, nothing in the app said it (`grep -r text-size-adjust src/web styles` was empty).
Tailwind's preflight sets it on `html`, and
[we deliberately do not import preflight](../project/controls.md). So this is the fourth gap in the
hand-written substitute, after the button border, `img { height: auto }` and the button font
(`tests/preflight-substitute.test.ts` lists the three). The fleet dashboard imports preflight whole,
so it already has the rule.

It is not a Skim bug. Any band with wrapped text is open to it; Skim is where Greg saw it. It also
explains "why are the fonts different": the faces are different on purpose
([fonts.md](../project/fonts.md): the quote is the author's, the section line is a model's title),
but the *sizes* were never meant to be.

**What I could not do:** reproduce it. The box has Chrome through Playwright, which has no such
autosizing, and nothing here can drive a real iPhone. The evidence is the arithmetic above and the
documented behaviour of the property. So the fix is confirmed only when Greg next holds a phone
sideways on a build that has it; the note says so.

## The change

One rule, in the `@layer base` substitute in [`tailwind.css`](../../src/web/tailwind.css):

```css
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
```

`100%`, not `none`: the two mean the same in today's CSS draft, but `none` once broke text zoom in
desktop WebKit ([bug 56543](https://bugs.webkit.org/show_bug.cgi?id=56543)), and `100%` is what
preflight uses. It does not touch pinch or page zoom. **What it gives up:** Safari's enlargement is
off everywhere, including anywhere it might have helped. With the article at 17px that is
reasonable, and it is the thing to look at on a real phone.

**The simpler option passed over:** a rule on Skim's classes alone. It would fix the picture and
leave every other band enlarged on the same phone.

**The test**, red first: `tests/preflight-substitute.test.ts` gains three checks. One requires the
exact values, `-webkit-text-size-adjust: 100%` and `text-size-adjust: 100%`, on the bare `html`
rule in `@layer base` (GPT Sol's F1: a check of names alone passes `auto`; seen red with `auto`).
The second reads preflight's own `html` rule out of `node_modules`, and requires every property it
sets there to be either in our base block's `html` rule or declined with a reason, the same shape
the file already uses for `button`. The third rejects a decline that preflight stopped setting or
that our base rule now sets. That makes the next Tailwind upgrade's new `html` property a decision
too. Of the seven properties preflight sets there today, we mirror one and decline six (line-height,
tab-size, the font family and its two settings, the tap highlight), each with the decision in the
test.

**Docs:** a paragraph in [controls.md](../project/controls.md) beside the other three findings, and
a line in [phone-and-touch.md](../project/phone-and-touch.md).

## The quick review

What I looked at: every `font-size` in `src/web/styles/` and `styles/`, the Tailwind text utilities
in the components, the four voice tokens, and the main line of text in each mode's band.

**The faces are in order.** Four tokens, one file of voice lists, a test that makes a new mode or
page a type error until its AI classes are listed ([fonts.md](../project/fonts.md)). I found nothing
drawn in the wrong face in this pass, beyond what fonts.md § Not yet in a voice already lists.

**The sizes are not on a scale.** This is the real finding.

- 566 `font-size` declarations across the 40 stylesheets that set one, using about **65 different
  values**. Between 0.72rem and 0.98rem alone there are 26 steps, most a tenth of a pixel or two
  apart: 0.81rem (50 uses), 0.83 (45), 0.88 (39), 0.85 (34), 0.79 (30), 0.77 (30), 0.84 (27),
  0.8 (25), 0.86 (22) and so on.
- The pages built with Tailwind are tidier: 242 `text-sm`, 219 `text-xs`, and 27 uses of 11 one-off
  sizes.
- **The same job gets a different size in each mode.** The main line of a row is 0.88rem in Skim
  and Timeline, 0.93rem in FAQ, 0.95rem in Glossary, 1.03rem in Quiz. A verbatim quote is 0.83rem
  in Timeline and 0.84rem in Skim. No two of these were chosen against each other; each was chosen
  on the day its mode was written.
- One stylesheet (`debate.css`) uses 18 sizes by itself.
- A handful are in `px` (five rules), which do not follow the reader's browser font setting.

Nobody would see 0.83 against 0.84. What it costs is that there is no answer to "what size should
this be", so each new mode picks its own, and across modes the drift is visible: Quiz's question is
2.4px bigger than Skim's row.

**Whether the three faces look the same size at the same size is not known.** IBM Plex Mono is
wide, so a line of it may read as larger than Geist or the serif at the same size. The picture is
no evidence either way: the section line measures 1.049 times the quote, and it is asked to be
1.048 times (GPT Sol's F2). It needs the three faces side by side at one size on `/design`.

**Clear-cut and built here:** the `text-size-adjust` rule only. Everything else above is a choice
about how the product looks, so it goes to Greg.

## Questions for Greg

One question, in [awaiting-approval.md](../user-feedback/awaiting-approval.md) in plain words. It
does not block the fix. Queue item `qi-f8h393sb`.

**Should the same kind of line be the same size in every mode?** Today each mode chose its own. The
choices:

1. **Line up the roles that recur across modes** (recommended). Name five or six jobs: a row's main
   line, a verbatim quote, a model's sentence, a small label, a count. Give each one size as a
   token, and move the modes' rules for those jobs onto it. *In use:* Quiz's question, Glossary's
   term and Skim's row become one size, somewhere between today's 14px and 16.5px, which is itself
   a choice to look at. *Cost:* perhaps 100 to 150 declarations, some rows rewrapping, a browser
   pass over every mode at three widths; about a session. Everything else keeps its odd value.
2. **A full scale for everything**, headings, tiny labels and the one-off sizes included. *Gives:*
   one answer for any new text. *Cost:* it has to be designed first (which steps, which roles), then
   all 566 declarations audited and their numeric choices moved; several sessions, and many small
   visible shifts. Not yet defined well enough to build.
3. **Leave it.** Nothing is broken; a reader sees the drift only by comparing modes.

*What would make you pick:* 1 if the modes looking like one product matters now; 3 if it does not
yet; 2 only after 1 has shown which roles are real.

**Not a question yet:** whether the model's monospace should be drawn slightly smaller. There is no
evidence it looks bigger (above). The same queue item covers putting the three faces side by side
at one size on `/design`; if they look uneven, that becomes a question with a picture.

## Assumptions

- The screenshot is an iPhone in landscape. If it was a narrow desktop window instead, the 1.53
  ratio has no explanation I can find in the stylesheets, and the rule is still harmless.
- "Skim's are probably too big" is answered by the inflation. Skim's own sizes (0.84 to 0.88rem)
  are in line with the other bands, so I have not changed them.

## Progress

- [x] GPT Sol plan review: changes needed, six findings, all taken ([answer](261006k-plan-review-sol.md)). F1 the exact-value test; F2 the monospace question withdrawn for want of evidence; F3 the counts; F4 the question redrawn as three choices; F5 "inference, not proof"; F6 the trade-off named
- [x] Test red, rule added, test green (names: red before the rule; value: red with `auto`). The rule is in the built `dist` stylesheet
- [x] Docs
- [x] GPT Sol code review: approve, eight findings, seven fixed by the reviewer ([findings](261006k-code-review-findings.md), [answer](261006k-code-review-sol.md)), its diff read and kept; the stage owner must make the note's
  “on `dev`” claim true by pushing after review
- [x] Note, endings, queue (`qi-f8h393sb` holds the question for Greg)
