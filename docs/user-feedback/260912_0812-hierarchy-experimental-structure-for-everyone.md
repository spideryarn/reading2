# Hierarchy becomes an experimental feature; Structure is shown to everyone

[SPIDERYARN-READING2-35](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-35) (2026-09-12
08:12 UTC, `kind=suggestion`), from an admin, on an iPad in production, build `607b57a0`, on
`entropy-24-00930-spya-bmvfyb` in Structure mode.

> Hierarchy mode should be one of the Experimental Features.
>
> Structure mode should be a non-Experimental Feature, ie shown to everyone

**Ending: Shipped** — on `dev`, not deployed. Resolve 35.

What we did: with Experimental Features off, the Hierarchy button is gone from the bar and the
command bar. Structure was already shown to everyone, since 2026-09-10, and the build he was using
already had that. Only its two Dock entry points moved — the mode button and command-bar row: every
article still gets the tree, Structure and Summary still read it, and a `?mode=hierarchy` link or
the saved last view still opens the columns. The zoom columns are drawn only in Hierarchy mode, so
a reader with the switch off and another mode open no longer has a button that reaches them. The
`/features` caption *"Zoom, in Hierarchy mode."* now adds that it is one of the Experimental
Features. [260912e-hierarchy-behind-the-experimental-switch.md](../plans/260912e-hierarchy-behind-the-experimental-switch.md).
