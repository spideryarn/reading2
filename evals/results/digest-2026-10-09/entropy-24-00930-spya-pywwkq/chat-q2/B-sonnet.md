# entropy-24-00930-spya-pywwkq — chat-q2 — B-sonnet

> What exactly is 'synergy' in PID, and how far should I trust the finding that synergy concentrates in rich clubs and recurrent connections? What could the choice of redundancy measure, or the amount of data, do to that result?

Synergy is the information about a target neuron's activity that you can get only by looking at two source neurons' joint state, and not from either one alone [spya-h5jzvm]. It shows up when the joint information exceeds the sum of what each source gives separately [spya-e94ury].

The catch is that synergy isn't directly measured. The two-source setup has three known quantities and four unknown pieces, and standard Shannon theory gives no unique solution. You must choose a definition of redundancy, and the other pieces, synergy included, follow from it [spya-bgsd4n]. My inference: a different redundancy measure can therefore change the synergy numbers themselves, not just add noise.

On trust, the headline numbers are large: rich-club triads had 2.7 times the synergy and accounted for about 88% of it [spya-fud8q3], and triads with two recurrent connections had 50% more [spya-sd9fzd]. The article's own caveats:

- The networks came from bivariate transfer entropy, which overestimates connections, and the data were cortical cultures, not behaving animals [spya-j4cy9j].
- A macaque study with a better network-inference method replicated the rich club and the higher synergy in high-degree nodes [spya-wr7f6y]. The article doesn't say it replicated the recurrent-connection result.
- PID shows statistical dependencies, not why a neuron is synergy- or redundancy-dominated [spya-spdx0y].

On the redundancy measure, most studies discussed used the original Imin, which has been criticised for unintuitive behaviour, and no measure is universally accepted [spya-rc76qn]. The article doesn't report re-running these findings with another measure. That is the gap I'd press on. Synergy also falls as sources become more redundant [spya-cs9fdy], so the measure matters most where the rich-club neurons are highly correlated.

On data amount, naive estimates overestimate mutual information, so unrelated processes can look dependent. The authors say this is less worrying for binary spiking with millions of samples, but it grows with the state space, and null-model comparisons are needed [spya-qa7gt2]. The article doesn't say how the null comparisons were done in these studies.
