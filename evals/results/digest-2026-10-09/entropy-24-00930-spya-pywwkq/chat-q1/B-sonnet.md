# entropy-24-00930-spya-pywwkq — chat-q1 — B-sonnet

> Why do the authors say that mutual information and transfer entropy are not enough to describe information processing in neurons, and how does that motivation connect to what the empirical PID studies in section 5 actually found?

They say the two measures track whether and how much information moves between neurons, but not what a neuron does with inputs from several sources at once. Mutual information is undirected and instantaneous, so it has no notion of "flow" [spya-f6sbgx]. Transfer entropy adds direction, measuring how much a source's past reduces uncertainty about a target's future [spya-p4pyuy]. But the authors say transfer captures the overall flow and is limited in showing how different streams interact and how neurons produce new or modified information from multiple sources [spya-s0db2g]. Processing, for them, means the interaction between two sources' pasts that can't be reduced to either one alone [spya-wer4cd]. That is what PID's synergy term is meant to isolate, using the idea that the joint information can exceed the sum of the parts [spya-e94ury].

Section 5 connects to this in two ways. First, the studies use both tools together: transfer entropy builds the network, and PID is then run on each two-sources-to-one-target triad [spya-sw5ukx]. Synergy tracked transfer entropy closely, at roughly a quarter of it, so propagation predicted processing [spya-kqkb58]. Second, PID found structure that transfer entropy alone would not show:

- Rich-club triads had 2.7 times the synergy of other triads [spya-fud8q3].
- Triads with more recurrent connections had more synergy, while feedback connections did not [spya-sd9fzd].
- As timescales lengthened, total transfer entropy kept rising, but synergy peaked at intermediate source similarity and then fell as redundancy took over [spya-ybmve2 spya-cs9fdy].
- In macaques, redundancy rose sharply during movement execution [spya-t8fayf].

My inference is that the third and fourth points best show the payoff. They are changes in the makeup of the information, not just its amount.

The authors also limit how far this goes. PID shows statistical dependencies, not the biological mechanism behind them [spya-spdx0y]. Calling synergy "processing" is their interpretive choice [spya-sp50v3].
