# entropy-24-00930-spya-pywwkq — chat-q1 — A-opus

> Why do the authors say that mutual information and transfer entropy are not enough to describe information processing in neurons, and how does that motivation connect to what the empirical PID studies in section 5 actually found?

The authors' complaint is that both measures look at one source at a time, so neither can show how two inputs *combine*, and that combining is what they mean by processing.

Mutual information is ruled out because it is undirected and instantaneous. It measures how much two neurons' activity goes together, but it has "no notion" of one thing flowing to another [spya-f6sbgx]. Transfer entropy fixes the direction: it measures how much a source's past predicts a target's future [spya-p4pyuy]. But it still only tracks "flow". It cannot reveal how separate streams "interact", or how a neuron makes new information out of several inputs [spya-s0db2g]. The PID move is to compare the information the inputs carry together with the sum of what each carries alone [spya-h5dz45]. Synergy is the extra that appears only in the joint pattern, and the authors treat it as the signature of computation [spya-e94ury spya-wer4cd].

The section 5 findings connect to this in a less tidy way than the motivation suggests. The triads are first picked out using transfer entropy [spya-sw5ukx]. Synergy then turns out to be strongly correlated with transfer entropy, reliably about a quarter of it [spya-kqkb58]. My inference is that, by that result alone, flow largely predicts processing.

Where PID earns its keep is in the departures from that pattern:

- **Connections between the two sources.** Links between the sources add synergy beyond what the direct connections to the target account for [spya-sd9fzd].
- **Longer timescales.** As the time window lengthens, total transfer entropy keeps rising, but synergy peaks and then falls while redundancy takes over [spya-ybmve2 spya-cs9fdy]. Here transfer entropy alone would have been misleading: more flow, less processing.
- **Behaving monkeys.** Redundancy rises sharply during movement [spya-t8fayf]. That shift in the *mix* of information types is invisible to a flow measure.

The authors also concede that these are statistical patterns, not explanations of the biological mechanism [spya-spdx0y].
