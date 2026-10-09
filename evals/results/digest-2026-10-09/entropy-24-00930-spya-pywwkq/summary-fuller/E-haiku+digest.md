# entropy-24-00930-spya-pywwkq — summary-fuller — E-haiku+digest

This piece is a review that explains how a set of information tools can be used to study how neurons process information. Its central idea is synergy, the extra information that shows up only when several input neurons are looked at together. The authors write for readers both inside and outside neuroscience, so they keep the explanations approachable.

<sub>spya-xn9j9k, spya-gzwbsr</sub>

A central goal of neuroscience is to find out how neurons work together to turn sensory signals into adaptive behavior. Until recently, two things held this work back: too little suitable data and too few analysis methods. Newer recording technologies can now capture hundreds or thousands of neurons at very fine time resolution, which has eased the data problem considerably.

<sub>spya-rxcze4, spya-s9kmxa</sub>

Mutual information measures how much two neurons' activity depends on each other, but it does not say which way information moves. Transfer entropy measures how much a source neuron's past helps predict a target neuron's next state, so it tracks the direction of information flow. Yet neither measure shows how separate streams of information combine inside a target neuron, which the authors call processing. The authors therefore turn to partial information decomposition (PID), a method for splitting that combined information into parts.

<sub>spya-f6sbgx, spya-p4pyuy, spya-s0db2g</sub>

PID splits the information that two input neurons give a target into redundant, unique and synergistic parts. Redundant information can come from either input alone, unique information from just one input, and synergistic information only from both together. If the joint information is larger than the sum of the single-input parts, the surplus is synergy, which the authors treat as a sign of processing. There is no single agreed way to measure redundancy, and the original Imin method, the one most used here, has been criticized.

<sub>spya-h5jzvm, spya-e94ury, spya-rc76qn</sub>

The main evidence comes from slices of mouse brain cortex grown in culture and recorded on grids of tiny electrodes with 512 channels. The authors analyzed thousands of triads, which are groups of two source neurons feeding one target neuron. Synergy was strongly correlated with transfer entropy, and was reliably about a quarter of it in these recordings. Triads inside rich clubs, the densely interconnected neurons that pass on most of the information, had 2.7 times the synergy of those outside. Those rich-club triads accounted for about 88% of network-wide synergy, even though under 40% of neurons were in the club.

<sub>spya-sw5ukx, spya-kqkb58, spya-fud8q3</sub>

Triads with two links between their source neurons and no feedback links had about 50% more synergy than the simplest triads. Feedback links, running from the target back to the sources, were not reliably tied to synergy. Synergy rose as the two sources' spiking became more alike, but only up to about 7% of the maximum possible similarity. Past that point synergy fell, while redundancy kept rising, which the authors suggest means the converging signals become redundant.

<sub>spya-sd9fzd, spya-ybmve2, spya-cs9fdy</sub>

The authors also studied three macaques, a kind of monkey, during a multi-phase task involving symbol recognition, planning, memory and movement. A rich club and higher synergy in well-connected neurons were replicated, and a link between synergy and local clustering was found. During movement, the share of redundant information rose sharply, which the authors interpret as a way to send the move signal reliably. The authors note two caveats: their networks were built from pairwise (two-at-a-time) transfer entropy, and cultured slices are not behaving animals.

<sub>spya-wr7f6y, spya-t8fayf, spya-j4cy9j</sub>

PID becomes hard to use with many inputs, because the number of possible parts grows very fast, so full descriptions of one neuron are out of reach. The authors conclude that synergy suggests neurons do not simply add up their inputs, but respond to the particular patterns those inputs form. They say these findings hint at a large area of future research linking these information dynamics to biology and cognition.

<sub>spya-aby2dp, spya-sp50v3</sub>
