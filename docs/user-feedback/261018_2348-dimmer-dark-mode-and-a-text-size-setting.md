---
reports: spya-q645m0, spya-ast8cu
ending: shipped
comment: Profile → Settings now has Brightness (down to about a fifth of the light) and Text size (up to 137%, everything in proportion), both kept on this device. Please try them on the iPad app once deployed.
---
# A dimmer dark mode, and a text size setting, for reading on an iPad in the dark

Two suggestions from Greg (admin), 2026-10-18, on a portrait iPad in its home-screen app, both on
`https://www.spideryarn.com/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?at=spya-g83jsr`,
build `956a2380`, batched by the Overseer as queue item `qi-7f32x9h3`. Re-read with
`feedback-reporter.ts` before writing this: both rows an administrator's, **no addenda** on either.

- `spya-q645m0` (#612, SPIDERYARN-READING2-K3, 23:48 UTC):

  > I'm in a dark bedroom, reading on my iPad, and I'm in dark mode for Spideryarn. But even so,
  > it's not quite as dark as I would like. The text is still quite bright, even with the
  > brightness setting down as low as it will go. So I wonder if it would be possible to have a
  > brightness setting, which probably doesn't really need many, many gradations, so that I can make
  > the background darker and the text slightly darker as well […]

- `spya-ast8cu` (#613, SPIDERYARN-READING2-K4, 23:54 UTC):

  > I would like to be able to increase the size of the text. I'm reading on a portrait iPad, and if
  > I have it in plain mode […] there's quite a lot of horizontal margin either side, and the text is
  > quite small from a distance. […] If you do see a way forward that isn't too complex and that you
  > do think is the best of all worlds, then proceed using screenshots and making sure to document
  > accordingly, so that going forwards, future modes and UI changes naturally do the right thing.

**Ending: Shipped**, on `dev`. Plan
[261019g](../plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md), with GPT Sol's
plan and code reviews and screenshots at the iPad's width.

**A text size was declined "not now" on 2026-10-08** ([q-wux4k7](questions/q-wux4k7.md), note
[261002_2036](261002_2036-a-reading-text-size-setting.md)) because browser zoom covered it. The new
fact is that the iPad home-screen app has no browser zoom, so that reason no longer holds on the
device Greg reads on.

What changed:

- **/profile → Settings → Brightness: Full, Dim, Dimmer, Dimmest.** One black layer over the whole
  page, so the ink, the page and pictures all give off less light: about 60 / 38 / 22% of it. Body
  text keeps at least 4.8:1 contrast even at Dimmest. Dialogs dim too, and taps go straight through.
- **/profile → Settings → Text size: Default, Large, Larger, Largest** (100 / 112.5 / 125 / 137.5%).
  It scales the root font size, so everything written in `rem` grows in proportion: the article,
  its headings, the modes and the controls. That is nearly all of the app's type. On the iPad in
  Plain, the article widens into the empty margins: 123px either side at Default, about 45px at
  Largest.
- **Both are kept on this device** and applied before the page first draws. So there is no bright
  flash in the dark, and the iPad can be dim while the desk stays bright.
- **For future modes**: [typography.md § The reader's text size scales the root](../project/typography.md#the-readers-text-size-scales-the-root)
  is the rule (size type in `rem`), and a test fails on a px `font-size` in any stylesheet that is
  not on its allowlist. [web-client.md § Brightness](../project/web-client.md#brightness-a-layer-not-a-third-palette)
  explains why a new colour needs no dim value. A Help page mentions both settings, and feedback
  reports now record them.

Known limits, written down in the plan: the layout's screen-width thresholds stay in px, so at
Largest a band beside the prose leaves it narrower in characters; on a phone at Largest the Dock
scrolls further sideways. Not tested on a real installed iPad, which the box cannot do. **Free
today, independent of this:** iOS's Settings → Accessibility → Display & Text Size → Reduce White
Point dims every app below the brightness slider.
