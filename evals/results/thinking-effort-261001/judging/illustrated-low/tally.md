# illustrated

**rank**: mean U = 1.06 → clear loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 0.5 | base-a 0, base-b -1, low-a -2, low-b -1 |
| entropy-24-00930-spya-pywwkq | 1.5 | base-a 0, base-b -1, low-a 0, low-b -2 |
| noema-mythology-of-conscious-ai | 0 | base-a 0, base-b 0, low-a -2, low-b -1 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 1.5 | base-a 0, base-b -2, low-a -2, low-b -1 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 1.5 | base-a 0, base-b -1, low-a -2, low-b 0 |
| after-work-we-ll-have-each-other-spya-we6h75 | 1.5 | base-a -1, base-b 0, low-a -2, low-b 0 |
| spider-silk-spya-ge30uz | 0 | base-a -1, base-b 0, low-a -3, low-b -2 |
| cargocult-spya-rz663q | 2 | base-a 0, base-b -3, low-a -2, low-b -1 |

**score**: mean U = 0.31 → clear loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 0 | base-a 18, base-b 18, low-a 15, low-b 15 |
| entropy-24-00930-spya-pywwkq | 1 | base-a 17, base-b 22, low-a 18, low-b 13 |
| noema-mythology-of-conscious-ai | 1 | base-a 17, base-b 20, low-a 13, low-b 18 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0.5 | base-a 21, base-b 18, low-a 14, low-b 18 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | base-a 18, base-b 18, low-a 15, low-b 17 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | base-a 19, base-b 19, low-a 14, low-b 17 |
| spider-silk-spya-ge30uz | 0 | base-a 20, base-b 21, low-a 5, low-b 14 |
| cargocult-spya-rz663q | 0 | base-a 21, base-b 17, low-a 14, low-b 15 |

**Combined (worse of the two)**: clear loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 149817 | base | 22517 | 28945 | 0.362 | 265 |
| replication-crisis-spya-hrjamq | 149817 | low | 4316 | 10868 | 0.182 | 101 |
| entropy-24-00930-spya-pywwkq | 56536 | base | 21591 | 28025 | 0.332 | 252 |
| entropy-24-00930-spya-pywwkq | 56536 | low | 1439 | 7359 | 0.125 | 68 |
| noema-mythology-of-conscious-ai | 52573 | base | 21946 | 28518 | 0.332 | 262 |
| noema-mythology-of-conscious-ai | 52573 | low | 3261 | 8589 | 0.133 | 77 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | base | 26663 | 33474 | 0.382 | 295 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | low | 2960 | 9577 | 0.143 | 86 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | base | 19345 | 26057 | 0.310 | 226 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | low | 2077 | 8719 | 0.137 | 82 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | base | 22795 | 29098 | 0.328 | 259 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | low | 1798 | 7256 | 0.109 | 70 |
| spider-silk-spya-ge30uz | 62920 | base | 20593 | 27027 | 0.311 | 240 |
| spider-silk-spya-ge30uz | 62920 | low | 109 | 5289 | 0.094 | 49 |
| cargocult-spya-rz663q | 21195 | base | 11541 | 17716 | 0.203 | 157 |
| cargocult-spya-rz663q | 21195 | low | 1012 | 6260 | 0.089 | 55 |

**Median thinking reduction, articles under 100k characters**: 91% (gate: ≥ 33%)
**Invalid draws**: spider-silk-spya-ge30uz low-a

**Hard gates**: literal (no invalid candidate draw) FAIL; compared (candidate 1 invalid ≤ base 0) FAIL
