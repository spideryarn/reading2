# illustrated

**rank**: mean U = 1.56 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 2.5 | base-a -1, base-b -2, medium-a -2, medium-b 0 |
| entropy-24-00930-spya-pywwkq | 2 | base-a -3, base-b 0, medium-a -1, medium-b -2 |
| noema-mythology-of-conscious-ai | 1 | base-a -2, base-b 0, medium-a -3, medium-b -1 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | base-a 0, base-b -1, medium-a -2, medium-b -3 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 2 | base-a -2, base-b -1, medium-a -3, medium-b 0 |
| after-work-we-ll-have-each-other-spya-we6h75 | 2 | base-a -1, base-b -2, medium-a 0, medium-b -3 |
| spider-silk-spya-ge30uz | 2 | base-a -2, base-b -1, medium-a 0, medium-b -3 |
| cargocult-spya-rz663q | 1 | base-a 0, base-b -2, medium-a -3, medium-b -1 |

**score**: mean U = 1.06 → clear loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 3 | base-a 17, base-b 21, medium-a 23, medium-b 19 |
| entropy-24-00930-spya-pywwkq | 0 | base-a 20, base-b 22, medium-a 17, medium-b 17 |
| noema-mythology-of-conscious-ai | 1 | base-a 19, base-b 21, medium-a 17, medium-b 20 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 2 | base-a 23, base-b 19, medium-a 21, medium-b 20 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 2 | base-a 18, base-b 19, medium-a 15, medium-b 23 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | base-a 21, base-b 23, medium-a 20, medium-b 20 |
| spider-silk-spya-ge30uz | 0 | base-a 22, base-b 22, medium-a 21, medium-b 18 |
| cargocult-spya-rz663q | 0.5 | base-a 22, base-b 20, medium-a 17, medium-b 20 |

**Combined (worse of the two)**: clear loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 149817 | base | 22517 | 28945 | 0.362 | 265 |
| replication-crisis-spya-hrjamq | 149817 | medium | 10904 | 17281 | 0.246 | 162 |
| entropy-24-00930-spya-pywwkq | 56536 | base | 21591 | 28025 | 0.332 | 252 |
| entropy-24-00930-spya-pywwkq | 56536 | medium | 8700 | 14767 | 0.199 | 134 |
| noema-mythology-of-conscious-ai | 52573 | base | 21946 | 28518 | 0.332 | 262 |
| noema-mythology-of-conscious-ai | 52573 | medium | 7550 | 13396 | 0.181 | 122 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | base | 26663 | 33474 | 0.382 | 295 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | medium | 8784 | 15539 | 0.203 | 139 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | base | 19345 | 26057 | 0.310 | 226 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | medium | 5749 | 12440 | 0.174 | 112 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | base | 22795 | 29098 | 0.328 | 259 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | medium | 6220 | 12280 | 0.160 | 111 |
| spider-silk-spya-ge30uz | 62920 | base | 20593 | 27027 | 0.311 | 240 |
| spider-silk-spya-ge30uz | 62920 | medium | 6372 | 12583 | 0.167 | 112 |
| cargocult-spya-rz663q | 21195 | base | 11541 | 17716 | 0.203 | 157 |
| cargocult-spya-rz663q | 21195 | medium | 4482 | 9816 | 0.124 | 83 |

**Median thinking reduction, articles under 100k characters**: 67% (gate: ≥ 33%)
**Invalid draws**: none

**Hard gates**: literal (no invalid candidate draw) pass; compared (candidate 0 invalid ≤ base 0) pass
