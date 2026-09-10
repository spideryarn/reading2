# Outline rows wrap instead of truncating

**[SPIDERYARN-READING2-2Q](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2Q)** · report
`spya-gazstp` · suggestion · 2026-09-08 17:44 UTC · build `cec18ed8` · **Ending: shipped.** Landed
on `dev` 2026-09-10; not deployed. Built in one job with
[2S](260908_1916-structure-mode-subsumes-outline.md), which also shipped — and which turned the
view this report is about into Structure mode's narrow face.

## What Greg said

> In outline mode, is there a way to show more of each line? It seems like it truncates each line
> after just a few words, and so it's really hard to tell what each one's about.

Reading `temporal-context-reinstatement-spya-dhqkf9` in Outline mode with one gist column open
(`cols=1`), at `spya-qhukqr`.

## What we did

**Titles wrap now; they are not cut.** Every row was clamped to one line, which after the nested
indent and the number gutter left a section title a few words. The clamp is gone from the ordinary
case, so a long title takes two or three lines and reads whole — the same as the rows in Structure's
two-column face, which never clamped.

**On the screen this was reported from, the list is not what you now see.** A desktop window with
one gist column open gives the band 400px (measured at 1000–1600px wide), which is wide enough for
Structure's two columns — so that reader now gets the columns, whose titles were always whole. The
list, and this fix, are what a narrower band gets: a window between about 700px (below which the
band covers the prose and is wide again) and 945px, or a phone narrower than 400px.

The list still never scrolls, so something had to give: it measures every level of detail both ways
and takes the most detailed one that fits **with whole titles**. On a short band that means fewer
rungs (fewer gist sentences, no paragraph rows) rather than cut titles. Only when not even the
top-level parts fit whole does it fall back to the old one-line clamp — which is exactly the list it
drew before this change.

Checked in a browser: two-line titles at 900×900, whole-title fits at 360×500 and 900×360, and the
clamp returning only at 900×300. At that height even the clamped list clips its last part, which
was already true before. [260910g](../plans/260910g-structure-mode-subsumes-outline.md) § 2Q and
§ Browser evidence.

After 2S, "Outline mode" is Structure mode on a narrow band, and `?mode=outline` opens it.
