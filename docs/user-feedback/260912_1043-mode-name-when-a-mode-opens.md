# The mode names itself when a reader opens it

**SPIDERYARN-READING2-3Q** · suggestion · from Greg (an admin, so trusted input) · iPad, reading
`temporal-context-reinstatement-spya-dhqkf9`, build `d358f773` · 2026-09-12 10:43Z

> It's just occurred to me that in an effort to try and make things more compact and quick, we've
> actually got rid of all of the clues that would help a beginner reader understand what each mode
> is. So if I'm on an iPad and I click on a mode, there's no tooltip, there's no heading, there's no
> explanation. Now, I don't want it to be intrusive, but there has to be some kind of indicator. So
> it could be that it shows the mode name at the top of the mode column for a couple of seconds, or
> that you can scroll past it somehow. But the problem with scrolling past it is that, well, it
> interacts with other stuff in a confusing way that I don't know how the display would work. So the
> best idea I have for now.

**Ending: shipped** — on `dev`, not deployed.

His own idea, one notch stronger: a press on a mode (Dock or command bar) lays the mode's name **and
its one-sentence description** over the top of the band for three seconds, then it fades. Never on a
pasted `?mode=`, Back or reload; nothing for Plain and Hierarchy, which have no band. It takes no
taps — a press meant for what it covers goes through and clears it. The cause was three decisions
that were each right alone: the band's title went on 2026-09-05 because the Dock names the mode, the
Dock drops its words at iPad widths, and what is left is a hover card a finger never opens.

Fable made the product call (name and sentence, everyone rather than touch only, on a press only);
GPT Sol reviewed the plan and the code. Deferred: Hierarchy, "only the first few times", and
long-press for the Dock's cards.
[260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md](../plans/260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md).
